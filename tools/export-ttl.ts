/**
 * SQLite -> Turtle exporter (the "Full Turtle" profile in ARCHITECTURE.md).
 *
 *   npm run export            # ../data/ontology.sqlite -> ../data/export.ttl
 *   npm run export -- in.sqlite out.ttl
 *
 * Regenerates a Semaphore-compatible Turtle file from the editing database:
 * modelled entities re-serialised, flags replayed verbatim, both directions of
 * every inverse pair materialised (ARCHITECTURE.md Decision 3), and everything
 * unmodelled replayed from passthrough_triples.
 *
 * Verified by tools/roundtrip-diff.ts: original vs exported must differ only by
 * inverse-pair repairs (directions the source TTL had dropped).
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_INVERSE_OF = 'http://www.w3.org/2002/07/owl#inverseOf';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain';
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const SEM_GUID = 'http://www.smartlogic.com/2014/08/semaphore-core#guid';
const SKOS_BROADER = 'http://www.w3.org/2004/02/skos/core#broader';
const SKOSXL_LABEL = 'http://www.w3.org/2008/05/skos-xl#Label';
const SKOSXL_LITERAL_FORM = 'http://www.w3.org/2008/05/skos-xl#literalForm';

interface IFlagTerm { v: string; t: 'i' | 'l'; lang?: string; dt?: string; }
type FlagMap = { [pred: string]: IFlagTerm[] };

function iri(u: string): string { return `<${u}>`; }

function escapeLit(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function lit(value: string, lang?: string | null, dt?: string | null): string {
  // Booleans and decimals were bare tokens in the Jena export; re-emit bare so
  // the parser assigns the same implicit datatype.
  if (dt === XSD + 'boolean' || dt === XSD + 'decimal') return value;
  let out = `"${escapeLit(value)}"`;
  if (lang) out += `@${lang}`;
  else if (dt) out += `^^${iri(dt)}`;
  return out;
}

function flagTermStr(t: IFlagTerm): string {
  return t.t === 'i' ? iri(t.v) : lit(t.v, t.lang, t.dt);
}

async function main(): Promise<void> {
  const dbPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'ontology.sqlite'));
  const outPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'export.ttl'));

  const SQL = await initSqlJs();
  const db: Database = new SQL.Database(fs.readFileSync(dbPath));

  const rows = (sql: string): any[][] => {
    const r = db.exec(sql);
    return r.length ? r[0].values as any[][] : [];
  };

  const out: string[] = [];

  // -- Prefixes --------------------------------------------------------------
  for (const [prefix, uri_] of rows('SELECT prefix, uri FROM prefixes ORDER BY prefix')) {
    out.push(`@prefix ${prefix}: <${uri_}> .`);
  }
  out.push('');

  /** Predicate/object lines grouped per subject, emitted as one Turtle block. */
  const block = (subject: string, lines: string[]): void => {
    if (!lines.length) return;
    out.push(iri(subject));
    for (let i = 0; i < lines.length; i++) {
      out.push(`        ${lines[i]}${i === lines.length - 1 ? ' .' : ' ;'}`);
    }
    out.push('');
  };

  const flagLines = (flagsJson: string | null): string[] => {
    if (!flagsJson) return [];
    const flags: FlagMap = JSON.parse(flagsJson);
    const lines: string[] = [];
    for (const pred of Object.keys(flags)) {
      for (const t of flags[pred]) lines.push(`${iri(pred)} ${flagTermStr(t)}`);
    }
    return lines;
  };

  // -- Passthrough: everything unmodelled, replayed verbatim -----------------
  // Raw blocks (blank nodes/collections) are emitted as source text; their
  // sibling triple rows for the same subject are duplicates of what the raw
  // block already contains, and Turtle graph semantics dedupe them.
  let passthroughCount = 0;
  const passBySubject: { [s: string]: string[] } = {};
  for (const [subj, pred, obj, kind, lang, dt] of rows(
    "SELECT subject, predicate, object, object_kind, lang, datatype FROM passthrough_triples WHERE object_kind <> 'raw'"
  )) {
    const o = kind === 'iri' ? iri(String(obj)) : lit(String(obj), lang as string | null, dt as string | null);
    (passBySubject[String(subj)] = passBySubject[String(subj)] || []).push(`${iri(String(pred))} ${o}`);
    passthroughCount++;
  }
  for (const s of Object.keys(passBySubject)) block(s, passBySubject[s]);
  for (const [, , raw] of rows("SELECT subject, predicate, object FROM passthrough_triples WHERE object_kind = 'raw'")) {
    out.push(String(raw) + ' .');
    out.push('');
    passthroughCount++;
  }

  // -- Classes ---------------------------------------------------------------
  const classUri: { [id: number]: string } = {};
  for (const [id, u] of rows('SELECT id, uri FROM classes')) classUri[Number(id)] = String(u);
  let classCount = 0;
  for (const [, u, parentId, flagsJson] of rows('SELECT id, uri, parent_class_id, flags_json FROM classes')) {
    const lines = [`a ${iri(OWL_CLASS)}`];
    if (parentId !== null) lines.push(`${iri(RDFS_SUBCLASS_OF)} ${iri(classUri[Number(parentId)])}`);
    lines.push(...flagLines(flagsJson as string | null));
    block(String(u), lines);
    classCount++;
  }

  // -- Properties (declared only; synthesised rows have no source block) -----
  const propUri: { [id: number]: string } = {};
  const propInverse: { [id: number]: number | null } = {};
  for (const [id, u, inv] of rows('SELECT id, uri, inverse_property_id FROM properties')) {
    propUri[Number(id)] = String(u);
    propInverse[Number(id)] = inv === null ? null : Number(inv);
  }
  let propCount = 0;
  for (const [id, u, domainId, rangeId, sub, inv, flagsJson] of rows(
    `SELECT id, uri, domain_class_id, range_class_id, sub_property_of, inverse_property_id, flags_json
     FROM properties WHERE synthesised = 0`
  )) {
    const lines: string[] = [];
    // rdf:type(s), label, definition, comment, unresolved domain/range all
    // live in flags — replay first, then the resolved structural columns.
    lines.push(...flagLines(flagsJson as string | null));
    if (domainId !== null) lines.push(`${iri(RDFS_DOMAIN)} ${iri(classUri[Number(domainId)])}`);
    if (rangeId !== null) lines.push(`${iri(RDFS_RANGE)} ${iri(classUri[Number(rangeId)])}`);
    if (sub !== null) lines.push(`${iri(RDFS_SUBPROPERTY_OF)} ${iri(String(sub))}`);
    if (inv !== null && Number(inv) !== Number(id)) lines.push(`${iri(OWL_INVERSE_OF)} ${iri(propUri[Number(inv)])}`);
    block(String(u), lines);
    propCount++;
  }

  // -- Concepts --------------------------------------------------------------
  const conceptUri: { [id: number]: string } = {};
  const conceptLines: { [id: number]: string[] } = {};
  for (const [id, u, guid, clsId] of rows('SELECT id, uri, guid, class_id FROM concepts')) {
    const cid = Number(id);
    conceptUri[cid] = String(u);
    const lines: string[] = [];
    if (clsId !== null) lines.push(`a ${iri(classUri[Number(clsId)])}`);
    if (guid !== null) lines.push(`${iri(SEM_GUID)} ${lit(String(guid))}`);
    conceptLines[cid] = lines;
  }

  for (const [cid, pid] of rows('SELECT concept_id, parent_concept_id FROM broader')) {
    conceptLines[Number(cid)].push(`${iri(SKOS_BROADER)} ${iri(conceptUri[Number(pid)])}`);
  }

  for (const [cid, pred, value, lang, dt] of rows(
    'SELECT concept_id, predicate_uri, value, lang, datatype FROM annotations'
  )) {
    conceptLines[Number(cid)].push(`${iri(String(pred))} ${lit(String(value), lang as string | null, dt as string | null)}`);
  }

  for (const [cid, labelUri, pred] of rows('SELECT concept_id, uri, label_property FROM labels')) {
    conceptLines[Number(cid)].push(`${iri(String(pred))} ${iri(String(labelUri))}`);
  }

  // Relationships: the stored direction plus the materialised inverse
  // (ARCHITECTURE.md Decision 3 — export repairs any drift in the source).
  let relTriples = 0;
  for (const [src, propId, tgt] of rows('SELECT source_concept_id, property_id, target_concept_id FROM relationships')) {
    const s = Number(src), p = Number(propId), t = Number(tgt);
    conceptLines[s].push(`${iri(propUri[p])} ${iri(conceptUri[t])}`);
    relTriples++;
    const inv = propInverse[p];
    if (inv !== null && inv !== undefined) {
      conceptLines[t].push(`${iri(propUri[inv])} ${iri(conceptUri[s])}`);
      relTriples++;
    }
  }

  let conceptCount = 0;
  for (const idStr of Object.keys(conceptLines)) {
    block(conceptUri[Number(idStr)], conceptLines[Number(idStr)]);
    conceptCount++;
  }

  // -- Label resources (deduped: multi-attached labels share one block) ------
  let labelCount = 0;
  const seenLabel: { [u: string]: true } = {};
  for (const [u, form, lang, flagsJson] of rows('SELECT uri, literal_form, lang, flags_json FROM labels')) {
    const uStr = String(u);
    if (seenLabel[uStr]) continue;
    seenLabel[uStr] = true;
    const lines = [
      `a ${iri(SKOSXL_LABEL)}`,
      `${iri(SKOSXL_LITERAL_FORM)} ${lit(String(form), lang as string | null)}`
    ];
    lines.push(...flagLines(flagsJson as string | null));
    block(uStr, lines);
    labelCount++;
  }

  db.close();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.join('\n'), 'utf8');

  console.log(`Exported ${outPath} (${(fs.statSync(outPath).size / 1048576).toFixed(1)} MB)`);
  console.log(`  classes=${classCount} properties=${propCount} concepts=${conceptCount} ` +
              `labels=${labelCount} relationshipTriples=${relTriples} passthrough=${passthroughCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
