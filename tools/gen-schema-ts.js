/**
 * Generates src/services/database/schema.ts from tools/schema.sql.
 *
 * The schema must exist as TypeScript so the web part can create a database in
 * the browser (no file read available there), while the Node tools import the
 * same constant — one definition, no drift.
 *
 *   node tools/gen-schema-ts.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'schema.sql');
const OUT = path.join(__dirname, '..', 'src', 'services', 'database', 'schema.ts');

const sql = fs.readFileSync(SRC, 'utf8');

// Escape for a template literal: backslashes, backticks, and ${ interpolation.
const escaped = sql
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const out = `/**
 * The ontology database schema.
 *
 * GENERATED FILE — do not edit by hand.
 * Source: tools/schema.sql    Regenerate: npm run gen:schema
 *
 * Exists as TypeScript so the web part can create a database in the browser
 * without a file read, while the Node tools import the same constant — one
 * definition of the schema, no drift between environments.
 */

export const SCHEMA_SQL: string = \`${escaped}\`;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`Wrote ${OUT} (${sql.length} chars of SQL)`);
