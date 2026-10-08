/* Regression: deleting concepts after a save must still cascade.

   sql.js's Database.export() closes and reopens the SQLite connection, and
   PRAGMA foreign_keys is per connection, so a save used to switch every
   ON DELETE CASCADE off until the file was next opened. Saving, then deleting
   a parent and its child, left a hierarchy edge with both ends missing, and
   blocked every publish after.

   1. the bare export reproduces the damage (so this test can see the bug)
   2. exportDatabase does not
   3. removeLeftovers repairs a file already damaged, and publish checks pass */
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL } from '../src/services/database/schema';
import { OntologyWriter } from '../src/services/database/OntologyWriter';
import { exportDatabase } from '../src/services/database/exportDatabase';
import { describeIntegrityProblems, countLeftovers } from '../src/services/database/IntegrityReport';
import { runChecks, INTEGRITY_CHECKS } from '../src/services/import/OntologyImporter';

let failures = 0;
const check = (name: string, ok: boolean, detail?: string): void => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? ' - ' + detail : ''}`);
  if (!ok) failures++;
};

/** Save (with the given export), then delete a parent and then its child. */
async function saveThenDelete(save: (db: Database) => Uint8Array): Promise<{ db: Database; w: OntologyWriter }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  db.run('PRAGMA foreign_keys = ON');            // what OntologyDatabase's constructor does
  const w = new OntologyWriter(db, 'fk-test');
  const parent = w.createConcept({ prefLabel: 'Parent' });
  const child = w.createConcept({ prefLabel: 'Child', parentConceptId: parent });
  w.addAnnotation(child, 'http://www.w3.org/2004/02/skos/core#note', 'a note');
  w.releaseUndoPoints();
  save(db);
  w.deleteConcept(parent);
  w.deleteConcept(child);
  return { db, w };
}

(async () => {
  console.log('== 1. bare sql.js export (the old Save) ==');
  const old = await saveThenDelete(db => db.export());
  const oldProblems = describeIntegrityProblems(old.db);
  check('reproduces "both ends missing"',
    oldProblems.some(p => /both ends missing/.test(p.description)), JSON.stringify(oldProblems));
  check('also strands labels and the note', countLeftovers(old.db) === 4, String(countLeftovers(old.db)));

  console.log('== 2. exportDatabase (the new Save) ==');
  const fixed = await saveThenDelete(exportDatabase);
  check('foreign keys still on after save',
    fixed.db.exec('PRAGMA foreign_keys')[0].values[0][0] === 1);
  check('no integrity problems', describeIntegrityProblems(fixed.db).length === 0);
  check('no leftovers', countLeftovers(fixed.db) === 0);

  console.log('== 3. Remove leftovers on an already-damaged file ==');
  old.w.beginUndoPoint();
  const removed = old.w.removeLeftovers();
  check('removes all 4 leftover rows', removed === 4, String(removed));
  check('publish checks now pass', runChecks(old.db, INTEGRITY_CHECKS).every(c => c.ok));
  check('journalled, so it counts as an unsaved change', old.w.isDirty);
  old.w.undoLast();
  check('undo brings them back', countLeftovers(old.db) === 4, String(countLeftovers(old.db)));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
