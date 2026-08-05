/**
 * TTL -> SQLite importer.
 *
 *   npm run import -- ../InlandRevenueModel.ttl ../data/ontology.sqlite
 *
 * Reads the Semaphore Turtle export and writes the editing database described
 * by schema.sql. Prints a summary that can be checked against the reference
 * counts in docs/ONTOLOGY-MODEL.md section 10.
 *
 * Uses sql.js (WASM) rather than better-sqlite3 so there is no native build
 * step, and so the schema code is identical to what runs in the web part.
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { parseTurtle, ITurtleSubject, ITurtleTerm } from '../src/services/turtle/TurtleParser';
import * as V from '../src/services/turtle/Vocabulary';

interface IStats { [key: string]: number }

function typeOf(subject: ITurtleSubject): string[] {
  return (subject.predicates[V.RDF_TYPE] || [])
    .filter(t => t.kind === 'iri')
    .map(t => t.value);
}

function has(types: string[], uri: string): boolean {
  return types.indexOf(uri) !== -1;
}

async function main(): Promise<void> {
  const ttlPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'InlandRevenueModel.ttl'));
  const outPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'ontology.sqlite'));

  console.log(`Reading  ${ttlPath}`);
  const text = fs.readFileSync(ttlPath, 'utf8');

  console.log('Parsing Turtle...');
  const t0 = Date.now();
  const parsed = parseTurtle(text);
  const subjectUris = Object.keys(parsed.subjects);
  console.log(`  ${subjectUris.length} subjects, ${parsed.anomalies} anomalies, ${Date.now() - t0} ms`);
  if (parsed.anomalies > 0) {
    console.warn('  WARNING: unparsed statements present — investigate before trusting the output.');
  }

  // -- Classify subjects -----------------------------------------------------
  const classUris: string[] = [];
  const propertyUris: string[] = [];
  const conceptUris: string[] = [];
  const labelUris: string[] = [];
  const otherUris: string[] = [];

  for (const uri of subjectUris) {
    const s = parsed.subjects[uri];
    const types = typeOf(s);
    if (has(types, V.OWL_CLASS)) classUris.push(uri);
    else if (has(types, V.OWL_OBJECT_PROPERTY) || has(types, V.OWL_DATATYPE_PROPERTY)) propertyUris.push(uri);
    else if (has(types, V.SKOSXL_LABEL)) labelUris.push(uri);
    else if (s.predicates[V.SEM_GUID] && !has(types, V.SKOS_CONCEPT_SCHEME)) conceptUris.push(uri);
    else otherUris.push(uri);
  }

  console.log(`  classes=${classUris.length} properties=${propertyUris.length} ` +
              `concepts=${conceptUris.length} labels=${labelUris.length} other=${otherUris.length}`);

  // -- Create the database ---------------------------------------------------
  const SQL = await initSqlJs();
  const db: Database = new SQL.Database();
  db.run(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  db.run('BEGIN TRANSACTION');

  const stats: IStats = {};
  const bump = (k: string, n = 1): void => { stats[k] = (stats[k] || 0) + n; };

  // Prefixes
  const insPrefix = db.prepare('INSERT OR REPLACE INTO prefixes (prefix, uri) VALUES (?, ?)');
  for (const p of Object.keys(parsed.prefixes)) {
    insPrefix.run([p, parsed.prefixes[p]]);
    bump('prefixes');
  }
  insPrefix.free();

  // -- Classes (two passes: rows first, then subClassOf links) ---------------
  const classId: { [uri: string]: number } = {};
  const insClass = db.prepare('INSERT INTO classes (uri, label, definition) VALUES (?, ?, ?)');
  for (const uri of classUris) {
    const s = parsed.subjects[uri];
    const label = (s.predicates[V.RDFS_LABEL] || [])[0];
    const def = (s.predicates[V.SKOS_DEFINITION] || [])[0];
    insClass.run([uri, label ? label.value : null, def ? def.value : null]);
    classId[uri] = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
    bump('classes');
  }
  insClass.free();

  const updClassParent = db.prepare('UPDATE classes SET parent_class_id = ? WHERE id = ?');
  for (const uri of classUris) {
    const parent = (parsed.subjects[uri].predicates[V.RDFS_SUBCLASS_OF] || [])[0];
    if (parent && parent.kind === 'iri' && classId[parent.value] !== undefined) {
      updClassParent.run([classId[parent.value], classId[uri]]);
      bump('classHierarchyEdges');
    }
  }
  updClassParent.free();

  // -- Properties (two passes: rows first, then inverseOf links) -------------
  const propId: { [uri: string]: number } = {};
  const insProp = db.prepare(
    'INSERT INTO properties (uri, label, domain_class_id, range_class_id, sub_property_of, is_label_property) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const uri of propertyUris) {
    const s = parsed.subjects[uri];
    const label = (s.predicates[V.RDFS_LABEL] || [])[0];
    const domain = (s.predicates[V.RDFS_DOMAIN] || [])[0];
    const range = (s.predicates[V.RDFS_RANGE] || [])[0];
    const sub = (s.predicates[V.RDFS_SUBPROPERTY_OF] || [])[0];

    // range skos:Concept means "any concept" and is stored as NULL.
    const rangeUri = range && range.kind === 'iri' ? range.value : undefined;
    const isLabelProp = rangeUri === V.SKOSXL_LABEL ? 1 : 0;

    insProp.run([
      uri,
      label ? label.value : null,
      domain && domain.kind === 'iri' && classId[domain.value] !== undefined ? classId[domain.value] : null,
      rangeUri && classId[rangeUri] !== undefined ? classId[rangeUri] : null,
      sub ? sub.value : null,
      isLabelProp
    ]);
    propId[uri] = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
    bump('properties');
    if (isLabelProp) bump('labelProperties');
  }
  insProp.free();

  // Some predicates are used as relationships but have no definition block —
  // notably skos:related (4,248 uses), a SKOS built-in Semaphore never redeclares.
  // Synthesise unrestricted property rows for them so they are first-class links
  // rather than passthrough. skos:related is symmetric, so it is its own inverse.
  const definedProps: { [uri: string]: true } = {};
  for (const uri of propertyUris) definedProps[uri] = true;
  const conceptUriSet: { [uri: string]: true } = {};
  for (const uri of conceptUris) conceptUriSet[uri] = true;

  const synthesised: string[] = [];
  const seenPredicate: { [uri: string]: true } = {};
  for (const uri of conceptUris) {
    const preds = parsed.subjects[uri].predicates;
    for (const pred of Object.keys(preds)) {
      if (definedProps[pred] || seenPredicate[pred] || V.STRUCTURAL_PREDICATES[pred]) continue;
      const pointsAtConcept = preds[pred].some(t => t.kind === 'iri' && conceptUriSet[t.value]);
      if (!pointsAtConcept) continue;
      seenPredicate[pred] = true;
      synthesised.push(pred);
    }
  }

  const insSynth = db.prepare('INSERT INTO properties (uri, label, is_label_property) VALUES (?, ?, 0)');
  for (const uri of synthesised) {
    insSynth.run([uri, V.localName(uri)]);
    propId[uri] = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
    bump('propertiesSynthesised');
  }
  insSynth.free();

  const updInverse = db.prepare('UPDATE properties SET inverse_property_id = ? WHERE id = ?');
  const inverseOf: { [propertyId: number]: number } = {};

  // Symmetric properties are their own inverse, so mirrored pairs collapse to
  // one row and the view still renders both ends.
  const SYMMETRIC = [V.SKOS_RELATED];
  for (const uri of SYMMETRIC) {
    if (propId[uri] !== undefined) {
      updInverse.run([propId[uri], propId[uri]]);
      inverseOf[propId[uri]] = propId[uri];
      bump('symmetricProperties');
    }
  }
  for (const uri of propertyUris) {
    const inv = (parsed.subjects[uri].predicates[V.OWL_INVERSE_OF] || [])[0];
    if (inv && inv.kind === 'iri' && propId[inv.value] !== undefined) {
      updInverse.run([propId[inv.value], propId[uri]]);
      inverseOf[propId[uri]] = propId[inv.value];
      bump('inverseDeclarations');
    }
  }
  updInverse.free();

  // -- Label resources: URI -> {text, lang, flags} ---------------------------
  interface ILabelRes { form: string; lang?: string; flags: { [k: string]: string }; }
  const labelRes: { [uri: string]: ILabelRes } = {};
  for (const uri of labelUris) {
    const s = parsed.subjects[uri];
    const form = (s.predicates[V.SKOSXL_LITERAL_FORM] || [])[0];
    if (!form) continue;
    const flags: { [k: string]: string } = {};
    for (const pred of Object.keys(s.predicates)) {
      if (pred === V.SKOSXL_LITERAL_FORM || pred === V.RDF_TYPE) continue;
      const v = s.predicates[pred][0];
      if (v) flags[pred] = v.value;
    }
    labelRes[uri] = { form: form.value, lang: form.lang, flags };
  }

  // -- Concepts --------------------------------------------------------------
  const conceptId: { [uri: string]: number } = {};
  const insConcept = db.prepare('INSERT INTO concepts (uri, guid, class_id, pref_label) VALUES (?, ?, ?, ?)');
  for (const uri of conceptUris) {
    const s = parsed.subjects[uri];
    const guid = (s.predicates[V.SEM_GUID] || [])[0];
    const types = typeOf(s);
    let cls: number | null = null;
    for (const t of types) {
      if (classId[t] !== undefined) { cls = classId[t]; break; }
    }
    const prefRef = (s.predicates[V.SKOSXL_PREF_LABEL] || [])[0];
    const pref = prefRef && labelRes[prefRef.value] ? labelRes[prefRef.value].form : null;

    insConcept.run([uri, guid ? guid.value : null, cls, pref]);
    conceptId[uri] = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
    bump('concepts');
    if (cls === null) bump('conceptsWithoutClass');
  }
  insConcept.free();

  // -- Hierarchy, relationships, labels, annotations -------------------------
  const insBroader = db.prepare('INSERT OR IGNORE INTO broader (concept_id, parent_concept_id) VALUES (?, ?)');
  const insRel = db.prepare(
    'INSERT OR IGNORE INTO relationships (source_concept_id, property_id, target_concept_id) VALUES (?, ?, ?)'
  );
  const insLabel = db.prepare(
    'INSERT INTO labels (uri, concept_id, label_property, literal_form, lang, flags_json) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insAnn = db.prepare(
    'INSERT INTO annotations (concept_id, predicate_uri, value, lang) VALUES (?, ?, ?, ?)'
  );
  const insPass = db.prepare(
    'INSERT INTO passthrough_triples (subject, predicate, object, object_kind, lang, datatype) VALUES (?, ?, ?, ?, ?, ?)'
  );

  /** Store a relationship, collapsing declared inverse pairs to one row. */
  const seenLinks: { [key: string]: true } = {};
  function addRelationship(srcUri: string, propUri: string, tgtUri: string): void {
    const sId = conceptId[srcUri];
    const tId = conceptId[tgtUri];
    const pId = propId[propUri];
    if (sId === undefined || tId === undefined || pId === undefined) return;

    // If the mirror triple was already stored, skip this direction: the view
    // v_concept_links derives it. See ARCHITECTURE.md Decision 3.
    const invId = inverseOf[pId];
    if (invId !== undefined && seenLinks[`${tId}|${invId}|${sId}`]) {
      bump('relationshipsCollapsedAsInverse');
      return;
    }

    seenLinks[`${sId}|${pId}|${tId}`] = true;
    insRel.run([sId, pId, tId]);
    bump('relationships');
  }

  for (const uri of conceptUris) {
    const s = parsed.subjects[uri];
    const cId = conceptId[uri];

    for (const pred of Object.keys(s.predicates)) {
      const terms = s.predicates[pred];

      if (pred === V.RDF_TYPE || pred === V.SEM_GUID) continue;

      if (pred === V.SKOS_BROADER) {
        for (const t of terms) {
          if (t.kind === 'iri' && conceptId[t.value] !== undefined) {
            insBroader.run([cId, conceptId[t.value]]);
            bump('broaderEdges');
          } else if (t.kind === 'iri') {
            bump('broaderTargetsMissing');
          }
        }
        continue;
      }

      for (const t of terms) {
        if (t.kind === 'literal') {
          insAnn.run([cId, pred, t.value, t.lang || null]);
          bump('annotations');
          continue;
        }

        // IRI object: a label resource, another concept, or something unmodelled.
        const lr = labelRes[t.value];
        if (lr) {
          insLabel.run([
            t.value, cId, pred, lr.form, lr.lang || null,
            Object.keys(lr.flags).length ? JSON.stringify(lr.flags) : null
          ]);
          bump('labels');
          continue;
        }

        if (conceptId[t.value] !== undefined && propId[pred] !== undefined) {
          addRelationship(uri, pred, t.value);
          continue;
        }

        if (conceptId[t.value] !== undefined) {
          // Points at a real concept but the predicate has no definition block.
          insPass.run([uri, pred, t.value, 'iri', null, null]);
          bump('relationshipsWithUndefinedProperty');
          continue;
        }

        insPass.run([uri, pred, t.value, 'iri', null, null]);
        bump('passthroughIri');
      }
    }
  }

  // -- Passthrough: every subject block we did not model -----------------
  for (const uri of otherUris) {
    const s = parsed.subjects[uri];
    for (const pred of Object.keys(s.predicates)) {
      for (const t of s.predicates[pred]) {
        insPass.run([
          uri, pred, t.value, t.kind === 'iri' ? 'iri' : 'literal',
          t.lang || null, t.datatype || null
        ]);
        bump('passthroughTriples');
      }
    }
    if (s.hasUnparsedNodes) {
      insPass.run([uri, '', s.raw, 'raw', null, null]);
      bump('passthroughRawBlocks');
    }
  }

  insBroader.free(); insRel.free(); insLabel.free(); insAnn.free(); insPass.free();

  // -- Provenance ------------------------------------------------------------
  const insMeta = db.prepare('INSERT OR REPLACE INTO import_metadata (key, value) VALUES (?, ?)');
  insMeta.run(['source_file', path.basename(ttlPath)]);
  insMeta.run(['source_bytes', String(fs.statSync(ttlPath).size)]);
  insMeta.run(['imported_at', new Date().toISOString()]);
  insMeta.run(['importer_version', '1']);
  insMeta.run(['stats_json', JSON.stringify(stats)]);
  insMeta.free();

  db.run('COMMIT');

  // -- Report ----------------------------------------------------------------
  console.log('\nImported:');
  for (const k of Object.keys(stats).sort()) {
    console.log(`  ${k.padEnd(36)} ${stats[k]}`);
  }

  const check = (label: string, sql: string, expected?: number): void => {
    const r = db.exec(sql);
    const v = r.length ? r[0].values[0][0] : 0;
    const flag = expected !== undefined ? (v === expected ? 'OK  ' : 'DIFF') : '    ';
    console.log(`  ${flag} ${label.padEnd(36)} ${v}${expected !== undefined ? `  (expected ${expected})` : ''}`);
  };

  console.log('\nAgainst reference counts (docs/ONTOLOGY-MODEL.md §10):');
  check('concepts', 'SELECT COUNT(*) FROM concepts', 10788);
  check('classes', 'SELECT COUNT(*) FROM classes', 108);
  check('class hierarchy edges', 'SELECT COUNT(*) FROM classes WHERE parent_class_id IS NOT NULL', 94);
  check('properties (151 obj + 22 data + 1 synth)', 'SELECT COUNT(*) FROM properties', 174);
  check('inverse declarations',
    'SELECT COUNT(*) FROM properties WHERE inverse_property_id IS NOT NULL AND id <> inverse_property_id', 142);
  check('broader edges', 'SELECT COUNT(*) FROM broader', 10826);
  check('polyhierarchy concepts',
    'SELECT COUNT(*) FROM (SELECT concept_id FROM broader GROUP BY concept_id HAVING COUNT(*) > 1)', 49);
  // The decisive round-trip check: derived links must equal the TTL's triple count.
  check('links via view (both directions)', 'SELECT COUNT(*) FROM v_concept_links', 25214);
  check('label attachments', 'SELECT COUNT(*) FROM labels', 26387);
  check('annotations', 'SELECT COUNT(*) FROM annotations', 30811);
  check('concepts with no class', 'SELECT COUNT(*) FROM concepts WHERE class_id IS NULL');
  check('passthrough triples', 'SELECT COUNT(*) FROM passthrough_triples');

  // Integrity: these must all be zero.
  console.log('\nIntegrity (all should be 0):');
  check('relationships with missing source', 'SELECT COUNT(*) FROM relationships r LEFT JOIN concepts c ON c.id=r.source_concept_id WHERE c.id IS NULL', 0);
  check('relationships with missing target', 'SELECT COUNT(*) FROM relationships r LEFT JOIN concepts c ON c.id=r.target_concept_id WHERE c.id IS NULL', 0);
  check('broader edges pointing nowhere', 'SELECT COUNT(*) FROM broader b LEFT JOIN concepts c ON c.id=b.parent_concept_id WHERE c.id IS NULL', 0);
  check('labels with no literal form', "SELECT COUNT(*) FROM labels WHERE literal_form IS NULL OR literal_form = ''", 0);
  check('concepts with no URI', "SELECT COUNT(*) FROM concepts WHERE uri IS NULL OR uri = ''", 0);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(db.export()));
  db.close();
  console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size / 1048576).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
