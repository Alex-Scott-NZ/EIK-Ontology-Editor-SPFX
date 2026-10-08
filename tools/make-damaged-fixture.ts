/* Build a damaged ontology for browser check 2 in docs/REGRESSION-TESTS.md.

   Uses a bare sql.js export() as the old Save did, which switched foreign keys
   off, then deletes a parent and its child. The result reports "A hierarchy
   edge survives with both ends missing" on Publish. Writes
   data/BothEndsMissing.sqlite (or the path given); upload it to the dev
   library and open it in the editor. Publishing it repairs and overwrites the
   master, so build a fresh one for each run. */
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { SCHEMA_SQL } from '../src/services/database/schema';
import { OntologyWriter } from '../src/services/database/OntologyWriter';
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  db.run('PRAGMA foreign_keys = ON');
  for (const [p, u] of [['rdf','http://www.w3.org/1999/02/22-rdf-syntax-ns#'],['rdfs','http://www.w3.org/2000/01/rdf-schema#'],['owl','http://www.w3.org/2002/07/owl#'],['xsd','http://www.w3.org/2001/XMLSchema#'],['skos','http://www.w3.org/2004/02/skos/core#'],['skosxl','http://www.w3.org/2008/05/skos-xl#'],['sem','http://www.smartlogic.com/2014/08/semaphore-core#']]) db.run('INSERT INTO prefixes (prefix, uri) VALUES (?, ?)', [p, u]);
  db.run("INSERT OR REPLACE INTO import_metadata (key, value) VALUES ('editor_namespace','http://example.com/repro#')");
  const w = new OntologyWriter(db, 'repro');
  const root = w.createConcept({ prefLabel: 'Topics' });
  w.createConcept({ prefLabel: 'Kept concept', parentConceptId: root });
  const parent = w.createConcept({ prefLabel: 'Parent to delete', parentConceptId: root });
  const child = w.createConcept({ prefLabel: 'Child to delete', parentConceptId: parent });
  w.setPublishTarget('https://5pbdxb.sharepoint.com/sites/dpex-testing/Shared Documents/Ontology Viewer/BothEndsMissing.sqlite');
  w.releaseUndoPoints();
  db.export();                         // the old Save: foreign keys now off
  w.deleteConcept(parent);
  w.deleteConcept(child);
  w.releaseUndoPoints();
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'BothEndsMissing.sqlite'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, db.export());
  console.log('wrote', out);
  console.log('parent', parent, 'child', child, 'broader rows:', db.exec('SELECT * FROM broader')[0].values);
})();
