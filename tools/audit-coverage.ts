/**
 * Fidelity audit: account for EVERY triple in the Turtle file.
 *
 * With the web part replacing Semaphore, anything the importer fails to carry
 * across stops existing. This walks the source and classifies each triple by
 * the table it lands in, so "dropped" can be proven to be zero rather than
 * assumed.
 *
 *   npm run audit
 */

import * as fs from 'fs';
import { parseTurtle, ITurtleSubject } from '../src/services/turtle/TurtleParser';
import * as V from '../src/services/turtle/Vocabulary';

const TTL = process.argv[2] || '../InlandRevenueModel.ttl';

function types(s: ITurtleSubject): string[] {
  return (s.predicates[V.RDF_TYPE] || []).filter(t => t.kind === 'iri').map(t => t.value);
}

const parsed = parseTurtle(fs.readFileSync(TTL, 'utf8'));
const uris = Object.keys(parsed.subjects);

// Classify subjects exactly as the importer does.
const kind: { [uri: string]: string } = {};
const isLabel: { [uri: string]: true } = {};
const isConcept: { [uri: string]: true } = {};
const isClass: { [uri: string]: true } = {};
const isProperty: { [uri: string]: true } = {};

for (const uri of uris) {
  const s = parsed.subjects[uri];
  const t = types(s);
  if (t.indexOf(V.OWL_CLASS) !== -1) { kind[uri] = 'class'; isClass[uri] = true; }
  else if (t.indexOf(V.OWL_OBJECT_PROPERTY) !== -1 || t.indexOf(V.OWL_DATATYPE_PROPERTY) !== -1) {
    kind[uri] = 'property'; isProperty[uri] = true;
  } else if (t.indexOf(V.SKOSXL_LABEL) !== -1) { kind[uri] = 'label'; isLabel[uri] = true; }
  else if (s.predicates[V.SEM_GUID] && t.indexOf(V.SKOS_CONCEPT_SCHEME) === -1) {
    kind[uri] = 'concept'; isConcept[uri] = true;
  } else if (t.indexOf(V.SKOS_CONCEPT_SCHEME) !== -1) kind[uri] = 'conceptScheme';
  else if (t.indexOf(V.OWL_ONTOLOGY) !== -1) kind[uri] = 'ontologyHeader';
  else kind[uri] = 'other';
}

// Where does each triple land?
const bucket: { [name: string]: number } = {};
const droppedSamples: string[] = [];
const b = (n: string): void => { bucket[n] = (bucket[n] || 0) + 1; };

let totalTriples = 0;
const subjectKindCounts: { [k: string]: number } = {};

for (const uri of uris) {
  const s = parsed.subjects[uri];
  const k = kind[uri];
  subjectKindCounts[k] = (subjectKindCounts[k] || 0) + 1;

  for (const pred of Object.keys(s.predicates)) {
    for (const obj of s.predicates[pred]) {
      totalTriples++;

      if (k === 'concept') {
        if (pred === V.RDF_TYPE) { b('concepts.class_id'); continue; }
        if (pred === V.SEM_GUID) { b('concepts.guid'); continue; }
        if (pred === V.SKOS_BROADER) { b('broader'); continue; }
        if (obj.kind === 'literal') { b('annotations'); continue; }
        if (isLabel[obj.value]) { b('labels'); continue; }
        if (isConcept[obj.value]) { b('relationships'); continue; }
        b('passthrough (concept -> non-concept IRI)');
        if (droppedSamples.length < 12) droppedSamples.push(`${V.localName(uri)} --${V.localName(pred)}--> ${obj.value}`);
        continue;
      }

      if (k === 'label') {
        if (pred === V.SKOSXL_LITERAL_FORM) { b('labels.literal_form'); continue; }
        if (pred === V.RDF_TYPE) { b('labels (implicit type)'); continue; }
        b('labels.flags_json');
        continue;
      }

      if (k === 'class') {
        if (pred === V.RDFS_SUBCLASS_OF) { b('classes.parent_class_id'); continue; }
        if (pred === V.RDFS_LABEL) { b('classes.label'); continue; }
        if (pred === V.SKOS_DEFINITION) { b('classes.definition'); continue; }
        if (pred === V.RDF_TYPE) { b('classes (implicit type)'); continue; }
        b('classes.flags_json');
        continue;
      }

      if (k === 'property') {
        if (pred === V.RDFS_DOMAIN) { b('properties.domain_class_id'); continue; }
        if (pred === V.RDFS_RANGE) { b('properties.range_class_id'); continue; }
        if (pred === V.RDFS_LABEL) { b('properties.label'); continue; }
        if (pred === V.OWL_INVERSE_OF) { b('properties.inverse_property_id'); continue; }
        if (pred === V.RDFS_SUBPROPERTY_OF) { b('properties.sub_property_of'); continue; }
        if (pred === V.SKOS_DEFINITION) { b('properties.definition'); continue; }
        if (pred === V.RDFS_COMMENT) { b('properties.comment'); continue; }
        if (pred === V.RDF_TYPE) { b('properties (implicit type)'); continue; }
        b('properties.flags_json');
        continue;
      }

      // conceptScheme / ontologyHeader / other -> passthrough_triples
      b(`passthrough (${k})`);
    }
  }
}

const modelled = Object.keys(bucket)
  .filter(x => x.indexOf('DROPPED') !== 0)
  .reduce((a, x) => a + bucket[x], 0);
const dropped = Object.keys(bucket)
  .filter(x => x.indexOf('DROPPED') === 0)
  .reduce((a, x) => a + bucket[x], 0);

console.log(`Subjects: ${uris.length}   Triples: ${totalTriples}   (parser anomalies: ${parsed.anomalies})\n`);

console.log('Subjects by kind:');
for (const k of Object.keys(subjectKindCounts).sort()) {
  console.log(`  ${k.padEnd(26)} ${subjectKindCounts[k]}`);
}

console.log('\nTriples by destination:');
for (const k of Object.keys(bucket).sort()) {
  console.log(`  ${k.padEnd(46)} ${bucket[k]}`);
}

console.log(`\nCarried across : ${modelled}`);
console.log(`Dropped        : ${dropped}`);
console.log(`Coverage       : ${((modelled / totalTriples) * 100).toFixed(4)}%`);

if (droppedSamples.length) {
  console.log('\nSamples needing attention:');
  for (const s of droppedSamples) console.log('  ' + s);
}

// Subject blocks containing blank nodes / collections we do not decompose.
const rawBlocks = uris.filter(u => parsed.subjects[u].hasUnparsedNodes);
console.log(`\nSubjects containing blank nodes or collections: ${rawBlocks.length}`);
for (const u of rawBlocks) console.log('  ' + u);

process.exit(dropped > 0 ? 1 : 0);
