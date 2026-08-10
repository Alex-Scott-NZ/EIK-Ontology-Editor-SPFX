/**
 * Turtle -> SQLite import, environment-agnostic.
 *
 * Pure logic: string in, in-memory Database out. No fs, no path, no process —
 * so the identical code runs in `tools/import-ttl.ts` (Node CLI) and in the web
 * part (browser, WASM). One implementation means the browser cannot silently
 * diverge from the audited Node path.
 *
 * Fidelity rules are documented in docs/ARCHITECTURE.md Decisions 2 and 3, and
 * verified by `npm --prefix tools run audit` / `run roundtrip`. In short:
 * anything not promoted to a column is preserved verbatim in a `flags_json`
 * blob or in `passthrough_triples`, so unknown Semaphore vocabulary survives.
 */

import { Database, SqlJsStatic } from 'sql.js';
import { parseTurtle, ITurtleSubject, ITurtleTerm } from '../turtle/TurtleParser';
import * as V from '../turtle/Vocabulary';
import { SCHEMA_SQL } from '../database/schema';

export interface IImportStats { [key: string]: number }

/** Coarse phases, for progress reporting on a 21 MB file. */
export type ImportPhase =
  | 'parsing'
  | 'classifying'
  | 'schema'
  | 'classes'
  | 'properties'
  | 'labels'
  | 'concepts'
  | 'relationships'
  | 'passthrough'
  | 'finalising';

export interface IImportOptions {
  /** Recorded in import_metadata.source_file. */
  sourceName?: string;
  /** Recorded in import_metadata.source_bytes. */
  sourceBytes?: number;
  /**
   * Called between phases. In a browser, `await`-ing a macrotask inside this
   * callback is what lets the UI repaint — the import itself is synchronous.
   */
  onProgress?: (phase: ImportPhase, detail?: string) => void;
}

export interface IImportResult {
  database: Database;
  stats: IImportStats;
  /** Statements the parser could not attribute to a subject. Should be 0. */
  parseAnomalies: number;
  subjectCounts: {
    classes: number;
    properties: number;
    concepts: number;
    labels: number;
    other: number;
  };
}

function typeOf(subject: ITurtleSubject): string[] {
  return (subject.predicates[V.RDF_TYPE] || [])
    .filter(t => t.kind === 'iri')
    .map(t => t.value);
}

function has(types: string[], uri: string): boolean {
  return types.indexOf(uri) !== -1;
}

/**
 * Term-preserving flag encoding: { predicateUri: [{v, t:'i'|'l', lang?, dt?}] }.
 * Without kind/lang/datatype the exporter could not tell an IRI from a string
 * or re-emit "Money"@en / "2026-03-27"^^xsd:date faithfully.
 */
interface IFlagTerm { v: string; t: 'i' | 'l'; lang?: string; dt?: string }

function flagTerm(t: ITurtleTerm): IFlagTerm {
  const f: IFlagTerm = { v: t.value, t: t.kind === 'iri' ? 'i' : 'l' };
  if (t.lang) f.lang = t.lang;
  if (t.datatype) f.dt = t.datatype;
  return f;
}

/**
 * Collect every predicate/term on a subject EXCEPT the ones `claim` returns
 * true for (those live in dedicated columns). Everything else — including
 * rdfs:label with its language tag, extra rdf:types, unresolvable
 * domain/range — is preserved verbatim so export can replay it.
 */
function residualFlags(
  s: ITurtleSubject,
  claim: (pred: string, t: ITurtleTerm, index: number) => boolean
): string | null {
  const flags: { [k: string]: IFlagTerm[] } = {};
  for (const pred of Object.keys(s.predicates)) {
    const terms = s.predicates[pred];
    for (let i = 0; i < terms.length; i++) {
      if (claim(pred, terms[i], i)) continue;
      (flags[pred] = flags[pred] || []).push(flagTerm(terms[i]));
    }
  }
  return Object.keys(flags).length ? JSON.stringify(flags) : null;
}

/**
 * Build the ontology database from Turtle source.
 *
 * Synchronous and CPU-bound. Measured on the 21 MB IR model in Node: 3.9 s
 * total (0.9 s parse, 2.3 s passthrough, rest under 0.4 s each), 286 MB RSS,
 * producing a 30 MB database. A browser will be somewhat slower but is in the
 * same order — short enough to run on the UI thread behind a spinner rather
 * than needing a worker. `onProgress` fires between phases and cannot
 * interrupt one, so the tab is unresponsive throughout.
 */
export function importTurtle(
  ttlText: string,
  SQL: SqlJsStatic,
  options: IImportOptions = {}
): IImportResult {
  const report = (phase: ImportPhase, detail?: string): void => {
    if (options.onProgress) options.onProgress(phase, detail);
  };

  report('parsing');
  const parsed = parseTurtle(ttlText);
  const subjectUris = Object.keys(parsed.subjects);

  // -- Classify subjects -----------------------------------------------------
  report('classifying', `${subjectUris.length} subjects`);
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

  // -- Create the database ---------------------------------------------------
  report('schema');
  const db: Database = new SQL.Database();
  db.run(SCHEMA_SQL);
  db.run('BEGIN TRANSACTION');

  const stats: IImportStats = {};
  const bump = (k: string, n: number = 1): void => { stats[k] = (stats[k] || 0) + n; };

  const lastId = (): number => db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;

  // Prefixes
  const insPrefix = db.prepare('INSERT OR REPLACE INTO prefixes (prefix, uri) VALUES (?, ?)');
  for (const p of Object.keys(parsed.prefixes)) {
    insPrefix.run([p, parsed.prefixes[p]]);
    bump('prefixes');
  }
  insPrefix.free();

  // -- Classes (two passes: rows first, then subClassOf links) ---------------
  report('classes', `${classUris.length}`);
  const classId: { [uri: string]: number } = {};
  const classDefUris: { [uri: string]: true } = {};
  for (const uri of classUris) classDefUris[uri] = true;

  const insClass = db.prepare(
    'INSERT INTO classes (uri, label, definition, flags_json) VALUES (?, ?, ?, ?)'
  );
  // The single subClassOf stored in parent_class_id per class: the FIRST one
  // that resolves to another class row. Extra/unresolvable parents stay in flags.
  const chosenParent: { [uri: string]: string } = {};
  for (const uri of classUris) {
    const s = parsed.subjects[uri];
    for (const p of (s.predicates[V.RDFS_SUBCLASS_OF] || [])) {
      if (p.kind === 'iri' && classDefUris[p.value]) { chosenParent[uri] = p.value; break; }
    }
    const label = (s.predicates[V.RDFS_LABEL] || [])[0];
    const def = (s.predicates[V.SKOS_DEFINITION] || [])[0];
    // Claimed by columns/constants: `a owl:Class` (re-emitted by export) and the
    // chosen parent. rdfs:label & skos:definition stay in flags (language tags)
    // AND in the columns (display convenience).
    let claimedParent = false;
    const flags = residualFlags(s, (pred, t) => {
      if (pred === V.RDF_TYPE && t.value === V.OWL_CLASS) return true;
      if (pred === V.RDFS_SUBCLASS_OF && !claimedParent && t.value === chosenParent[uri]) {
        claimedParent = true; return true;
      }
      return false;
    });
    insClass.run([uri, label ? label.value : null, def ? def.value : null, flags]);
    classId[uri] = lastId();
    bump('classes');
    if (flags) bump('classesWithResidualFlags');
  }
  insClass.free();

  const updClassParent = db.prepare('UPDATE classes SET parent_class_id = ? WHERE id = ?');
  for (const uri of classUris) {
    if (chosenParent[uri]) {
      updClassParent.run([classId[chosenParent[uri]], classId[uri]]);
      bump('classHierarchyEdges');
    }
  }
  updClassParent.free();

  // -- Properties (two passes: rows first, then inverseOf links) -------------
  report('properties', `${propertyUris.length}`);
  const propId: { [uri: string]: number } = {};
  const insProp = db.prepare(
    `INSERT INTO properties
       (uri, label, domain_class_id, range_class_id, sub_property_of, is_label_property,
        definition, comment, flags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const propDefUris: { [uri: string]: true } = {};
  for (const uri of propertyUris) propDefUris[uri] = true;

  for (const uri of propertyUris) {
    const s = parsed.subjects[uri];
    const label = (s.predicates[V.RDFS_LABEL] || [])[0];
    const domain = (s.predicates[V.RDFS_DOMAIN] || [])[0];
    const range = (s.predicates[V.RDFS_RANGE] || [])[0];
    const sub = (s.predicates[V.RDFS_SUBPROPERTY_OF] || [])[0];
    const def = (s.predicates[V.SKOS_DEFINITION] || [])[0];
    const comment = (s.predicates[V.RDFS_COMMENT] || [])[0];

    // range skos:Concept means "any concept" and is stored as NULL.
    const rangeUri = range && range.kind === 'iri' ? range.value : undefined;
    const isLabelProp = rangeUri === V.SKOSXL_LABEL ? 1 : 0;

    const domainResolved = !!(domain && domain.kind === 'iri' && classId[domain.value] !== undefined);
    const rangeResolved = rangeUri !== undefined && classId[rangeUri] !== undefined;

    // Claimed by columns: the FIRST domain/range only when it resolved to a
    // class row (skos:Concept / skosxl:Label / xsd:* ranges stay in flags —
    // previously they were dropped, making NULL ambiguous on export), the first
    // subPropertyOf, and every inverseOf that resolves (linked in pass two).
    // rdf:type is NOT claimed: owl:ObjectProperty vs owl:DatatypeProperty vs
    // sem:AlwaysVisibleProperty must survive, and there is no kind column.
    let claimedDomain = false, claimedRange = false, claimedSub = false;
    const flags = residualFlags(s, (pred, t) => {
      if (pred === V.RDFS_DOMAIN && domainResolved && !claimedDomain && t.value === (domain as ITurtleTerm).value) {
        claimedDomain = true; return true;
      }
      if (pred === V.RDFS_RANGE && rangeResolved && !claimedRange && t.value === rangeUri) {
        claimedRange = true; return true;
      }
      if (pred === V.RDFS_SUBPROPERTY_OF && !claimedSub && sub && t.value === sub.value) {
        claimedSub = true; return true;
      }
      if (pred === V.OWL_INVERSE_OF && t.kind === 'iri' && propDefUris[t.value]) return true;
      return false;
    });

    insProp.run([
      uri,
      label ? label.value : null,
      domainResolved ? classId[(domain as ITurtleTerm).value] : null,
      rangeResolved ? classId[rangeUri as string] : null,
      sub ? sub.value : null,
      isLabelProp,
      def ? def.value : null,
      comment ? comment.value : null,
      flags
    ]);
    propId[uri] = lastId();
    bump('properties');
    if (isLabelProp) bump('labelProperties');
    if (def || comment) bump('propertiesWithDefinition');
    if (flags) bump('propertiesWithResidualFlags');
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

  const insSynth = db.prepare(
    'INSERT INTO properties (uri, label, is_label_property, synthesised) VALUES (?, ?, 0, 1)'
  );
  for (const uri of synthesised) {
    insSynth.run([uri, V.localName(uri)]);
    propId[uri] = lastId();
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
  // Flags keep EVERY term (not just the first) with kind/lang/datatype, minus
  // the literalForm stored in the column and the implicit `a skosxl:Label`.
  report('labels', `${labelUris.length}`);
  interface ILabelRes { form: string; lang?: string; flagsJson: string | null }
  const labelRes: { [uri: string]: ILabelRes } = {};
  const labelsWithoutForm: string[] = [];
  for (const uri of labelUris) {
    const s = parsed.subjects[uri];
    const form = (s.predicates[V.SKOSXL_LITERAL_FORM] || [])[0];
    if (!form) {
      // Typed as skosxl:Label but no literal form: cannot live in `labels`
      // (literal_form NOT NULL) — preserve the whole block via passthrough.
      labelsWithoutForm.push(uri);
      continue;
    }
    let claimedForm = false;
    const flagsJson = residualFlags(s, (pred, t) => {
      if (pred === V.SKOSXL_LITERAL_FORM && !claimedForm && t.value === form.value) {
        claimedForm = true; return true;
      }
      if (pred === V.RDF_TYPE && t.value === V.SKOSXL_LABEL) return true;
      return false;
    });
    labelRes[uri] = { form: form.value, lang: form.lang, flagsJson };
  }

  // -- Concepts --------------------------------------------------------------
  report('concepts', `${conceptUris.length}`);
  const conceptId: { [uri: string]: number } = {};
  const insConcept = db.prepare('INSERT INTO concepts (uri, guid, class_id, pref_label) VALUES (?, ?, ?, ?)');
  // rdf:type triples beyond the one stored in class_id (221 in the model —
  // multi-typed concepts). Queued for passthrough_triples so export keeps them.
  const extraTypeTriples: Array<[string, string]> = [];
  for (const uri of conceptUris) {
    const s = parsed.subjects[uri];
    const guid = (s.predicates[V.SEM_GUID] || [])[0];
    const types = typeOf(s);
    let cls: number | null = null;
    let clsUri: string | undefined;
    for (const t of types) {
      if (classId[t] !== undefined) { cls = classId[t]; clsUri = t; break; }
    }
    let claimedType = false;
    for (const t of types) {
      if (!claimedType && t === clsUri) { claimedType = true; continue; }
      extraTypeTriples.push([uri, t]);
    }
    const prefRef = (s.predicates[V.SKOSXL_PREF_LABEL] || [])[0];
    const pref = prefRef && labelRes[prefRef.value] ? labelRes[prefRef.value].form : null;

    insConcept.run([uri, guid ? guid.value : null, cls, pref]);
    conceptId[uri] = lastId();
    bump('concepts');
    if (cls === null) bump('conceptsWithoutClass');
  }
  insConcept.free();

  // -- Hierarchy, relationships, labels, annotations -------------------------
  report('relationships');
  const insBroader = db.prepare('INSERT OR IGNORE INTO broader (concept_id, parent_concept_id) VALUES (?, ?)');
  const insRel = db.prepare(
    'INSERT OR IGNORE INTO relationships (source_concept_id, property_id, target_concept_id) VALUES (?, ?, ?)'
  );
  const insLabel = db.prepare(
    'INSERT INTO labels (uri, concept_id, label_property, literal_form, lang, flags_json) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insAnn = db.prepare(
    'INSERT INTO annotations (concept_id, predicate_uri, value, lang, datatype) VALUES (?, ?, ?, ?, ?)'
  );
  const insPass = db.prepare(
    'INSERT INTO passthrough_triples (subject, predicate, object, object_kind, lang, datatype) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Queued fidelity extras: concept rdf:types beyond class_id, and typed
  // labels that had no literal form (their whole block).
  for (const pair of extraTypeTriples) {
    insPass.run([pair[0], V.RDF_TYPE, pair[1], 'iri', null, null]);
    bump('passthroughExtraConceptTypes');
  }
  for (const uri of labelsWithoutForm) {
    const s = parsed.subjects[uri];
    for (const pred of Object.keys(s.predicates)) {
      for (const t of s.predicates[pred]) {
        insPass.run([uri, pred, t.value, t.kind === 'iri' ? 'iri' : 'literal', t.lang || null, t.datatype || null]);
        bump('passthroughLabelsWithoutForm');
      }
    }
  }

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
          insAnn.run([cId, pred, t.value, t.lang || null, t.datatype || null]);
          bump('annotations');
          continue;
        }

        // IRI object: a label resource, another concept, or something unmodelled.
        const lr = labelRes[t.value];
        if (lr) {
          insLabel.run([t.value, cId, pred, lr.form, lr.lang || null, lr.flagsJson]);
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

  // -- Passthrough: every subject block we did not model ---------------------
  report('passthrough', `${otherUris.length}`);
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
  report('finalising');
  const insMeta = db.prepare('INSERT OR REPLACE INTO import_metadata (key, value) VALUES (?, ?)');
  insMeta.run(['source_file', options.sourceName || 'unknown']);
  insMeta.run(['source_bytes', String(options.sourceBytes !== undefined ? options.sourceBytes : ttlText.length)]);
  insMeta.run(['imported_at', new Date().toISOString()]);
  insMeta.run(['importer_version', '2']);
  insMeta.run(['stats_json', JSON.stringify(stats)]);
  insMeta.free();

  db.run('COMMIT');

  return {
    database: db,
    stats,
    parseAnomalies: parsed.anomalies,
    subjectCounts: {
      classes: classUris.length,
      properties: propertyUris.length,
      concepts: conceptUris.length,
      labels: labelUris.length,
      other: otherUris.length
    }
  };
}

/**
 * The counts a correct import of the IR model produces. Shared by the CLI and
 * the web part so both flag a regression the same way.
 * Source: docs/ONTOLOGY-MODEL.md section 10.
 */
export const REFERENCE_CHECKS: Array<{ label: string; sql: string; expected?: number }> = [
  { label: 'concepts', sql: 'SELECT COUNT(*) FROM concepts', expected: 10788 },
  { label: 'classes', sql: 'SELECT COUNT(*) FROM classes', expected: 108 },
  { label: 'class hierarchy edges', sql: 'SELECT COUNT(*) FROM classes WHERE parent_class_id IS NOT NULL', expected: 94 },
  { label: 'properties (151 obj + 22 data + 1 synth)', sql: 'SELECT COUNT(*) FROM properties', expected: 174 },
  {
    label: 'inverse declarations',
    sql: 'SELECT COUNT(*) FROM properties WHERE inverse_property_id IS NOT NULL AND id <> inverse_property_id',
    expected: 142
  },
  { label: 'broader edges', sql: 'SELECT COUNT(*) FROM broader', expected: 10826 },
  {
    label: 'polyhierarchy concepts',
    sql: 'SELECT COUNT(*) FROM (SELECT concept_id FROM broader GROUP BY concept_id HAVING COUNT(*) > 1)',
    expected: 49
  },
  // The decisive round-trip check: derived links must equal the TTL's triple count.
  { label: 'links via view (both directions)', sql: 'SELECT COUNT(*) FROM v_concept_links', expected: 25214 },
  { label: 'label attachments', sql: 'SELECT COUNT(*) FROM labels', expected: 26387 },
  { label: 'annotations', sql: 'SELECT COUNT(*) FROM annotations', expected: 30811 },
  { label: 'concepts with no class', sql: 'SELECT COUNT(*) FROM concepts WHERE class_id IS NULL' },
  { label: 'passthrough triples', sql: 'SELECT COUNT(*) FROM passthrough_triples' }
];

/** Invariants that must hold for any import, of any source. All expect 0. */
export const INTEGRITY_CHECKS: Array<{ label: string; sql: string; expected: number }> = [
  {
    label: 'relationships with missing source',
    sql: 'SELECT COUNT(*) FROM relationships r LEFT JOIN concepts c ON c.id=r.source_concept_id WHERE c.id IS NULL',
    expected: 0
  },
  {
    label: 'relationships with missing target',
    sql: 'SELECT COUNT(*) FROM relationships r LEFT JOIN concepts c ON c.id=r.target_concept_id WHERE c.id IS NULL',
    expected: 0
  },
  {
    label: 'broader edges pointing nowhere',
    sql: 'SELECT COUNT(*) FROM broader b LEFT JOIN concepts c ON c.id=b.parent_concept_id WHERE c.id IS NULL',
    expected: 0
  },
  {
    label: 'labels with no literal form',
    sql: "SELECT COUNT(*) FROM labels WHERE literal_form IS NULL OR literal_form = ''",
    expected: 0
  },
  {
    label: 'concepts with no URI',
    sql: "SELECT COUNT(*) FROM concepts WHERE uri IS NULL OR uri = ''",
    expected: 0
  }
];

/** Run a check list against a database. */
export function runChecks(
  db: Database,
  checks: Array<{ label: string; sql: string; expected?: number }>
): Array<{ label: string; value: number; expected?: number; ok: boolean }> {
  return checks.map(c => {
    const r = db.exec(c.sql);
    const value = r.length ? Number(r[0].values[0][0]) : 0;
    return { label: c.label, value, expected: c.expected, ok: c.expected === undefined || value === c.expected };
  });
}
