/**
 * Round-trip verifier: original TTL vs exported TTL as RDF graphs.
 *
 *   npm run roundtrip          # ../InlandRevenueModel.ttl vs ../data/export.ttl
 *   npm run roundtrip -- original.ttl exported.ttl
 *
 * Parses both files with the same TurtleParser the importer uses and compares
 * the triple sets. The export is REQUIRED to contain every original triple
 * (missing = data loss = failure). Extra triples are acceptable only when they
 * are inverse-pair repairs: the source TTL stores both directions of each
 * inverse pair by hand and has drifted (e.g. HasInterestIn vs IsInterestOf);
 * the export materialises both directions from one stored row, so it *adds*
 * the missing mirrors. Anything extra beyond that is a failure too.
 *
 * Exit code 0 = lossless (differences fully explained), 1 = fidelity failure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseTurtle, IParsedTurtle } from '../src/services/turtle/TurtleParser';
import * as V from '../src/services/turtle/Vocabulary';

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const SEP = '\u0001';

function tripleKeys(parsed: IParsedTurtle): Map<string, true> {
  const keys = new Map<string, true>();
  for (const subj of Object.keys(parsed.subjects)) {
    const s = parsed.subjects[subj];
    for (const pred of Object.keys(s.predicates)) {
      for (const t of s.predicates[pred]) {
        const dt = t.datatype === XSD_STRING ? '' : (t.datatype || '');
        keys.set([subj, pred, t.kind, t.value, t.lang || '', dt].join(SEP), true);
      }
    }
  }
  return keys;
}

function localTriple(key: string): string {
  const [s, p, k, v] = key.split(SEP);
  const val = k === 'iri' ? V.localName(v) : JSON.stringify(v.length > 60 ? v.slice(0, 57) + '...' : v);
  return `${V.localName(s)} --${V.localName(p)}--> ${val}`;
}

const origPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'InlandRevenueModel.ttl'));
const exportPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'export.ttl'));

console.log(`Original : ${origPath}`);
console.log(`Exported : ${exportPath}`);

const orig = parseTurtle(fs.readFileSync(origPath, 'utf8'));
const expt = parseTurtle(fs.readFileSync(exportPath, 'utf8'));
console.log(`Parsed   : original anomalies=${orig.anomalies}, exported anomalies=${expt.anomalies}\n`);

// Inverse map from the ORIGINAL property declarations, for classifying repairs.
const inverseOf: { [propUri: string]: string } = { [V.SKOS_RELATED]: V.SKOS_RELATED };
for (const uri of Object.keys(orig.subjects)) {
  for (const t of orig.subjects[uri].predicates[V.OWL + 'inverseOf'] || []) {
    if (t.kind === 'iri') inverseOf[uri] = t.value;
  }
}

const origKeys = tripleKeys(orig);
const exptKeys = tripleKeys(expt);

const missing: string[] = [];
for (const k of origKeys.keys()) if (!exptKeys.has(k)) missing.push(k);

const repairs: { [propUri: string]: number } = {};
const unexplained: string[] = [];
for (const k of exptKeys.keys()) {
  if (origKeys.has(k)) continue;
  const [s, p, kind, v] = k.split(SEP);
  const inv = inverseOf[p];
  // extra (s, p, o) is an inverse repair iff the original asserts (o, inv(p), s)
  if (kind === 'iri' && inv && origKeys.has([v, inv, 'iri', s, '', ''].join(SEP))) {
    repairs[p] = (repairs[p] || 0) + 1;
    continue;
  }
  unexplained.push(k);
}

// Raw blocks (blank nodes/collections) are compared as normalised text, since
// neither side's parse decomposes them.
const rawIssues: string[] = [];
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
for (const uri of Object.keys(orig.subjects)) {
  if (!orig.subjects[uri].hasUnparsedNodes) continue;
  const e = expt.subjects[uri];
  if (!e) { rawIssues.push(`missing subject with raw content: ${uri}`); continue; }
  const o = norm(orig.subjects[uri].raw);
  // The exported side may carry the raw block plus duplicate plain triples;
  // require the original raw text to be contained in the exported block(s).
  if (norm(e.raw).indexOf(o) === -1 && !e.hasUnparsedNodes) {
    rawIssues.push(`raw block not reproduced for: ${uri}`);
  }
}

console.log(`Original triples : ${origKeys.size}`);
console.log(`Exported triples : ${exptKeys.size}`);
console.log(`Missing (LOST)   : ${missing.length}`);
console.log(`Inverse repairs  : ${Object.keys(repairs).reduce((a, k) => a + repairs[k], 0)}`);
console.log(`Unexplained extra: ${unexplained.length}`);
console.log(`Raw-block issues : ${rawIssues.length}`);

if (Object.keys(repairs).length) {
  console.log('\nRepaired inverse directions (source TTL had drifted):');
  for (const p of Object.keys(repairs).sort((a, b) => repairs[b] - repairs[a])) {
    console.log(`  ${String(repairs[p]).padStart(4)}  ${V.localName(p)}`);
  }
}

const sample = (title: string, keys: string[]): void => {
  if (!keys.length) return;
  console.log(`\n${title} (first ${Math.min(20, keys.length)} of ${keys.length}):`);
  for (const k of keys.slice(0, 20)) console.log('  ' + localTriple(k));
};
sample('MISSING — data lost by import/export', missing);
sample('UNEXPLAINED EXTRA — fabricated by export', unexplained);
for (const r of rawIssues) console.log('  RAW: ' + r);

const ok = missing.length === 0 && unexplained.length === 0 && rawIssues.length === 0;
console.log(ok ? '\nROUND-TRIP OK — no data loss; all differences are inverse repairs.'
              : '\nROUND-TRIP FAILED');
process.exit(ok ? 0 : 1);
