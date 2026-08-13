/**
 * SQLite -> Turtle exporter (CLI wrapper).
 *
 *   npm run export            # ../data/ontology.sqlite -> ../data/export.ttl
 *   npm run export -- in.sqlite out.ttl
 *
 * The serialisation itself lives in src/services/export/TurtleExporter.ts —
 * the same module the web part's "Export Turtle" command uses, so this tool
 * (and the smoke test that calls it) verifies exactly the code that ships.
 *
 * Verified by tools/roundtrip-diff.ts: original vs exported must differ only by
 * inverse-pair repairs (directions the source TTL had dropped).
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { exportTurtle } from '../src/services/export/TurtleExporter';

async function main(): Promise<void> {
  const dbPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'ontology.sqlite'));
  const outPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'export.ttl'));

  const SQL = await initSqlJs();
  const db: Database = new SQL.Database(fs.readFileSync(dbPath));
  const { ttl, stats } = exportTurtle(db);
  db.close();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, ttl, 'utf8');

  console.log(`Exported ${outPath} (${(fs.statSync(outPath).size / 1048576).toFixed(1)} MB)`);
  console.log(`  classes=${stats.classes} properties=${stats.properties} concepts=${stats.concepts} ` +
              `labels=${stats.labels} relationshipTriples=${stats.relationshipTriples} passthrough=${stats.passthrough}`);
}

main().catch(e => { console.error(e); process.exit(1); });
