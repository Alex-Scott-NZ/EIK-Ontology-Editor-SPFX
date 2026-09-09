/**
 * Build the standalone offline SQLite viewer.
 *
 * Inlines sql.js's JS glue AND its .wasm (as base64) into one HTML file, so the
 * result opens straight from disk over file:// — a file:// page cannot fetch a
 * sibling .wasm, which is why the binary has to travel inside the document.
 *
 *   node tools/build-sqlite-viewer.mjs
 *   -> tools/sqlite-viewer.html   (open it in any browser; nothing is uploaded)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'node_modules', 'sql.js', 'dist');

const template = readFileSync(join(here, 'sqlite-viewer.template.html'), 'utf8');
const glue = readFileSync(join(dist, 'sql-wasm.js'), 'utf8');
const wasmB64 = readFileSync(join(dist, 'sql-wasm.wasm')).toString('base64');

const html = template
  .replace('__SQLJS__', () => glue)
  .replace('__WASM_B64__', () => wasmB64);

const out = join(here, 'sqlite-viewer.html');
writeFileSync(out, html);

const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
console.log(`wrote ${out} (${mb} MB, self-contained)`);
