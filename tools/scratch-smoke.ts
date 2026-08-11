/* Smoke test: the from-scratch authoring flow, entirely node-side.
   Blank schema DB -> classes -> property pair -> concepts -> hierarchy ->
   relationship -> labels -> annotation -> export -> reparse -> assertions. */
import * as fs from 'fs';
import { execSync } from 'child_process';
import initSqlJs from 'sql.js';
import { SCHEMA_SQL } from '../src/services/database/schema';
import { OntologyWriter, ValidationFailure } from '../src/services/database/OntologyWriter';
import { parseTurtle } from '../src/services/turtle/TurtleParser';

let failures = 0;
const check = (name: string, ok: boolean, detail?: string): void => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  for (const [p, u] of [
    ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
    ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
    ['owl', 'http://www.w3.org/2002/07/owl#'],
    ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
    ['skos', 'http://www.w3.org/2004/02/skos/core#'],
    ['skosxl', 'http://www.w3.org/2008/05/skos-xl#'],
    ['sem', 'http://www.smartlogic.com/2014/08/semaphore-core#']
  ]) db.run('INSERT INTO prefixes (prefix, uri) VALUES (?, ?)', [p, u]);

  const w = new OntologyWriter(db, 'smoke-test');

  console.log('== classes ==');
  const party = w.createClass({ label: 'Party', colour: '#e0a3a3', definition: 'A person or organisation.' });
  const org = w.createClass({ label: 'Organisation', parentClassId: party, colour: 'a3c1e0' });
  const activity = w.createClass({ label: 'Activity', definition: 'Something someone does.' });
  check('three classes created', party > 0 && org > party && activity > org);
  try { w.createClass({ label: 'Party' }); check('duplicate class name rejected', false); }
  catch (e) { check('duplicate class name rejected', e instanceof ValidationFailure); }

  console.log('== relationship types ==');
  const pair = w.createPropertyPair({
    label: 'Performs', inverseLabel: 'Is performed by',
    domainClassId: party, rangeClassId: activity,
    definition: 'The party carries out the activity.'
  });
  check('pair created with inverse', pair.inversePropertyId !== undefined);

  console.log('== concepts ==');
  const acme = w.createConcept({ prefLabel: 'ACME Ltd', classId: org });
  const filing = w.createConcept({ prefLabel: 'Tax filing', classId: activity });
  const audits = w.createConcept({ prefLabel: 'Audits', classId: activity, parentConceptId: filing });
  check('concepts created', acme > 0 && filing > 0 && audits > 0);
  const parentRow = db.exec('SELECT parent_concept_id FROM broader WHERE concept_id = ' + audits);
  check('hierarchy edge stored', Number(parentRow[0].values[0][0]) === filing);

  console.log('== relationship (domain/range enforcement) ==');
  try {
    w.addRelationship(filing, pair.propertyId, acme); // Activity performs Org: wrong domain
    check('wrong-domain link rejected', false);
  } catch (e) { check('wrong-domain link rejected', e instanceof ValidationFailure); }
  w.addRelationship(acme, pair.propertyId, filing);   // Org (subclass of Party) performs Activity
  const links = db.exec('SELECT COUNT(*) FROM v_concept_links WHERE concept_id IN (' + acme + ',' + filing + ')');
  check('subclass honoured; link renders from both ends', Number(links[0].values[0][0]) === 2);

  console.log('== labels + annotation ==');
  w.addLabel({ conceptId: acme, labelProperty: 'http://www.w3.org/2008/05/skos-xl#altLabel', literalForm: 'ACME', lang: 'en' });
  w.addAnnotation(acme, 'http://www.w3.org/2004/02/skos/core#definition', 'A test organisation.', 'en');

  console.log('== metadata fields + label types (model-level definitions) ==');
  const risk = w.createMetadataField({ label: 'Risk rating', domainClassId: activity, definition: 'How risky.' });
  const acro = w.createLabelType({ label: 'Acronym' });
  check('field + label type created', risk > 0 && acro > 0);
  try { w.createMetadataField({ label: 'Performs' }); check('name clash with existing type rejected', false); }
  catch (e) { check('name clash with existing type rejected', e instanceof ValidationFailure); }
  const riskUri = String(db.exec('SELECT uri FROM properties WHERE id=' + risk)[0].values[0][0]);
  const acroUri = String(db.exec('SELECT uri FROM properties WHERE id=' + acro)[0].values[0][0]);
  w.addAnnotation(filing, riskUri, 'High', 'en');
  w.addLabel({ conceptId: acme, labelProperty: acroUri, literalForm: 'ACM', lang: 'en' });
  try { w.deleteMetadataField(risk); check('in-use field delete refused', false); }
  catch (e) { check('in-use field delete refused', e instanceof ValidationFailure); }
  try { w.deleteLabelType(acro); check('in-use label type delete refused', false); }
  catch (e) { check('in-use label type delete refused', e instanceof ValidationFailure); }

  console.log('== type edit + guarded deletes ==');
  w.updatePropertyPair(pair.propertyId, { definition: 'The party actively carries out the activity.' });
  try { w.deletePropertyPair(pair.propertyId); check('in-use type delete refused', false); }
  catch (e) { check('in-use type delete refused', e instanceof ValidationFailure); }
  try { w.deleteClass(activity); check('in-use class delete refused', false); }
  catch (e) { check('in-use class delete refused', e instanceof ValidationFailure); }
  const scrap = w.createClass({ label: 'Scrap' });
  w.deleteClass(scrap);
  check('unused class deleted', db.exec('SELECT COUNT(*) FROM classes WHERE label=\'Scrap\'')[0].values[0][0] === 0);
  check('changes journalled', w.getChangeCount() >= 12);

  fs.writeFileSync('../data/scratch-smoke.sqlite', Buffer.from(db.export()));
  db.close();

  console.log('== export -> reparse ==');
  execSync('npx tsx export-ttl.ts ../data/scratch-smoke.sqlite ../data/scratch-smoke.ttl', { stdio: 'pipe' });
  const ttl = fs.readFileSync('../data/scratch-smoke.ttl', 'utf8');
  const parsed = parseTurtle(ttl);
  check('export reparses with 0 anomalies', parsed.anomalies === 0, String(parsed.anomalies));

  const has = (needle: string): boolean => ttl.indexOf(needle) !== -1;
  check('class exported as owl:Class with colour', has('Party') && has('e0a3a3'));
  check('subclass edge exported', has('subClassOf'));
  check('property pair exported with inverseOf', has('inverseOf'));
  check('domain/range exported', has('domain') && has('range'));
  check('concept + broader exported', has('ACME') && has('broader'));
  check('relationship exported both directions', has('Performs') && has('Is-performed-by') || has('IsPerformedBy'));
  check('label + annotation exported', has('literalForm') && has('A test organisation.'));
  check('metadata field exported as DatatypeProperty', has('DatatypeProperty') && has('Risk rating') && has('High'));
  check('label type + its label exported', has('Acronym') && has('ACM'));

  console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
