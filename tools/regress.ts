/* Run every automated regression test, in dependency order, and report each.

   Keeps going after a failure so one run shows everything that is broken, and
   exits non-zero if anything failed. What each test protects is listed in
   docs/REGRESSION-TESTS.md; add new tests there and here together. */
import { spawnSync } from 'child_process';

const TESTS: Array<{ script: string; protects: string }> = [
  { script: 'import:default', protects: 'the IR ontology imports and passes the integrity checks' },
  { script: 'smoke', protects: 'building an ontology from scratch, through to Turtle export' },
  { script: 'fk', protects: 'deletes still cascade after a save; Remove leftovers repairs damage' },
  { script: 'verify', protects: 'the queries the web part runs (needs import:default first)' },
  { script: 'audit', protects: '100% of the Semaphore statements are carried across' },
  { script: 'export', protects: 'the database exports to Turtle (feeds roundtrip)' },
  { script: 'roundtrip', protects: 'Turtle in -> database -> Turtle out loses nothing' }
];

const results: Array<{ script: string; ok: boolean; seconds: number }> = [];
for (const t of TESTS) {
  console.log(`\n=== ${t.script}: ${t.protects}`);
  const start = Date.now();
  const r = spawnSync('npm', ['run', '-s', t.script], { stdio: 'inherit', shell: process.platform === 'win32' });
  results.push({ script: t.script, ok: r.status === 0, seconds: Math.round((Date.now() - start) / 1000) });
}

console.log('\n=== summary');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.script.padEnd(16)} ${r.seconds}s`);
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
