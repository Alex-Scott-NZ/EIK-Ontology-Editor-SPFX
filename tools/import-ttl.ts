/**
 * TTL -> SQLite importer (Node CLI).
 *
 *   npm run import -- ../InlandRevenueModel.ttl ../data/ontology.sqlite
 *
 * Thin wrapper: file I/O and reporting only. All import logic lives in
 * src/services/import/OntologyImporter.ts so the web part runs the identical
 * code path in the browser — the browser cannot silently diverge from what
 * `npm run audit` and `npm run roundtrip` verify here.
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';
import {
  importTurtle, runChecks, REFERENCE_CHECKS, INTEGRITY_CHECKS
} from '../src/services/import/OntologyImporter';

async function main(): Promise<void> {
  const ttlPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'InlandRevenueModel.ttl'));
  const outPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'ontology.sqlite'));

  console.log(`Reading  ${ttlPath}`);
  const text = fs.readFileSync(ttlPath, 'utf8');
  const sourceBytes = fs.statSync(ttlPath).size;

  const SQL = await initSqlJs();

  const t0 = Date.now();
  const result = importTurtle(text, SQL, {
    sourceName: path.basename(ttlPath),
    sourceBytes,
    onProgress: (phase, detail) => {
      console.log(`  [${phase}]${detail ? ' ' + detail : ''}`);
    }
  });
  const elapsed = Date.now() - t0;

  const { database: db, stats, parseAnomalies, subjectCounts } = result;

  console.log(`\nParsed and imported in ${elapsed} ms`);
  console.log(`  classes=${subjectCounts.classes} properties=${subjectCounts.properties} ` +
              `concepts=${subjectCounts.concepts} labels=${subjectCounts.labels} other=${subjectCounts.other}`);
  if (parseAnomalies > 0) {
    console.warn(`  WARNING: ${parseAnomalies} unparsed statements — investigate before trusting the output.`);
  }

  console.log('\nImported:');
  for (const k of Object.keys(stats).sort()) {
    console.log(`  ${k.padEnd(36)} ${stats[k]}`);
  }

  const show = (rows: ReturnType<typeof runChecks>): boolean => {
    let allOk = true;
    for (const r of rows) {
      const flag = r.expected !== undefined ? (r.ok ? 'OK  ' : 'DIFF') : '    ';
      if (!r.ok) allOk = false;
      console.log(`  ${flag} ${r.label.padEnd(36)} ${r.value}` +
                  (r.expected !== undefined ? `  (expected ${r.expected})` : ''));
    }
    return allOk;
  };

  console.log('\nAgainst reference counts (docs/ONTOLOGY-MODEL.md §10):');
  const refOk = show(runChecks(db, REFERENCE_CHECKS));

  console.log('\nIntegrity (all should be 0):');
  const integrityOk = show(runChecks(db, INTEGRITY_CHECKS));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(db.export()));
  db.close();
  console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size / 1048576).toFixed(1)} MB)`);

  if (!integrityOk) {
    console.error('\nFAILED: integrity checks did not pass.');
    process.exit(1);
  }
  if (!refOk) {
    console.warn('\nNote: reference counts differ. Expected if the source TTL is not the IR model.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
