/**
 * Single place sql.js gets initialised from.
 *
 * The .wasm is inlined into the bundle as a base64 data URI (asset/inline rule
 * in gulpfile.js) and handed to emscripten as raw bytes. There is deliberately
 * NO runtime fetch: a fetched .wasm URL has to be resolved against the bundle's
 * public path, and inside SharePoint's module loader that resolution is
 * environment-dependent — it worked under `gulp serve` but broke when the
 * packaged web part ran from ClientSideAssets ("both async and sync fetching
 * of the wasm failed"). Bytes in the bundle cannot mis-resolve.
 *
 * Cost: ~880 KB of base64 in the bundle. Acceptable for an internal editor;
 * revisit only if bundle size ever matters more than deployment robustness.
 */
import initSqlJs, { SqlJsStatic } from 'sql.js';
import sqlWasmDataUri from 'sql.js/dist/sql-wasm.wasm';

let instance: Promise<SqlJsStatic> | undefined;

function decodeDataUri(dataUri: string): ArrayBuffer {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function getSqlJs(): Promise<SqlJsStatic> {
  if (!instance) {
    // wasmBinary is a standard emscripten Module option that sql.js passes
    // through; it skips the fetch entirely. Not in @types/sql.js, hence the cast.
    instance = initSqlJs({ wasmBinary: decodeDataUri(sqlWasmDataUri) } as never);
  }
  return instance;
}
