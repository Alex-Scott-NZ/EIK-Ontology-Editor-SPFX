/**
 * Serialise a database without losing its foreign keys.
 *
 * sql.js's `Database.export()` closes the SQLite connection to read the file
 * back out, then reopens it. `PRAGMA foreign_keys` is a per-connection setting
 * that SQLite defaults OFF, so every export (every Save and every Publish)
 * silently switched off every ON DELETE CASCADE until the file was next opened.
 * Deleting a concept after a save then left its labels, annotations,
 * relationships and hierarchy edges behind. Save, delete a parent, delete its
 * child, and a hierarchy edge survives with BOTH ends missing.
 *
 * Kept free of the wasm loader so node-side tools can use it.
 */
import type { Database } from 'sql.js';

export function exportDatabase(db: Database): Uint8Array {
  const bytes = db.export();
  db.run('PRAGMA foreign_keys = ON');
  return bytes;
}
