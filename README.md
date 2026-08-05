# EIK Ontology Editor

A SharePoint Framework web part for browsing and editing the Inland Revenue
ontology — ~10,800 concepts, a 10,800-edge taxonomy, and 25,000 typed
relationships — sourced from the Smartlogic Semaphore Turtle export.

## Why this exists

The predecessor (`IKM-Ontology-Admin-WebPart`) was built from a flattened CSV
report, which was the only export available at the time. That pipeline was
audited and found **correct** — but the CSV could never carry concept classes,
the relationship rules, or the URIs needed to write Turtle back out. This project
starts from the Turtle export instead, so nothing has to be inferred.

Full audit: [docs/LEGACY-AUDIT.md](docs/LEGACY-AUDIT.md).

## Read these first

| Doc | What it covers |
|---|---|
| [docs/ONTOLOGY-MODEL.md](docs/ONTOLOGY-MODEL.md) | How the model is represented: triples, concepts, classes, `skos:broader`, domain/range/inverse, SKOS-XL labels. Start here if RDF is unfamiliar. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design decisions and their reasoning, plus the one open question to settle. |
| [docs/LEGACY-AUDIT.md](docs/LEGACY-AUDIT.md) | What the old pipeline got right and wrong, and what carries forward. |
| [tools/schema.sql](tools/schema.sql) | The database schema, commented with the reason for each choice. |

## Layout

```
InlandRevenueModel.ttl          the Semaphore export (source of truth, 21 MB)
InlandRevenueModel_shaclgraph.ttl  companion file — an empty stub, no SHACL shapes
data/ontology.sqlite            generated; git-ignored, rebuild with npm run import-ttl
docs/                           the four documents above
tools/                          Node-side Turtle -> SQLite conversion (own package.json)
src/services/turtle/            Turtle parser + vocabulary — shared by tools and web part
src/services/database/          OntologyDatabase: typed queries over sql.js
src/models/                     TypeScript shapes
src/webparts/ontologyEditor/    the SPFx web part
```

## Getting started

**Node 22 is required** (`engines: >=22.14 <23`). This machine has 22.23.1
installed but defaults to 20.19.5 in Git Bash — run `nvm use 22.23.1` first, or
call the binary directly. Per-shell version skew is a known trap here.

```bash
# 1. Build the database from the Turtle export (~15 s)
npm run import-ttl

# 2. Install web part dependencies and build
npm install
npm run build

# 3. Local debug against a real page
npm run start -- --nobrowser
```

Then append this to a SharePoint page URL (note the `/build/` segment — the old
Gulp-era path silently loads the *deployed* bundle instead):

```
?debugManifestsFile=https%3A%2F%2Flocalhost%3A4321%2Ftemp%2Fbuild%2Fmanifests.js&debug=true&noredir=true
```

### Deploying the database

Upload `data/ontology.sqlite` to a document library and point the web part at
its server-relative path via the property pane. `sql.js`'s `sql-wasm.wasm` must
also be reachable — the component expects it at
`/SiteAssets/ontology-editor/sql-wasm.wasm`. It cannot come from a CDN;
SharePoint's CSP blocks that.

## Importer output

`npm run import-ttl` verifies itself against the reference counts in
ONTOLOGY-MODEL.md §10 and prints an integrity check. Current state — all green:

```
OK   concepts                             10788
OK   classes                              108
OK   properties (151 obj + 22 data + 1 synth) 174
OK   inverse declarations                 142
OK   broader edges                        10826
OK   polyhierarchy concepts               49
OK   links via view (both directions)     25214   <- equals the TTL's triple count
OK   label attachments                    26387
OK   annotations                          30811
```

The `links via view` line is the round-trip proof: 12,752 stored rows plus
12,462 derived inverses reproduce the source's 25,214 relationship triples
exactly, with no relationship stored in both directions.

## Design decisions worth knowing before you touch the code

1. **Relationships are stored once, not twice.** The TTL physically stores both
   directions of every inverse pair, and they have already drifted apart in the
   source data. Here, one row is authored and the mirror is derived by the
   `v_concept_links` view, so a half-written relationship is impossible. Read
   the view; write the table.
2. **Hierarchy is an edge table, not a `parent_id` column.** 49 concepts have
   more than one parent. The old schema faked this with duplicate rows.
3. **Validity comes from declared class rules**, not from tree depth. See
   LEGACY-AUDIT.md §4.2 for why the depth heuristic is retired.
4. **Everything unmodelled is preserved** in `passthrough_triples`, so Turtle
   export stays faithful without modelling all of Semaphore's vocabulary.
5. **Key on URI/GUID, never on label.** Five labels are shared between concepts
   of different classes; disambiguate in the UI only.

## Current state

Working: the Turtle parser (0 unparsed statements against the full file), the
importer with self-verification, the schema, and a read-only browser web part
(search, concept detail, both ends of every relationship, navigation).

## Before editing goes live

- [ ] Settle the open question in ARCHITECTURE.md — is Semaphore still the
      master, or is this web part becoming it? It decides which export profile
      is primary.
- [ ] Write the write-layer, journalling every change to the `changes` table.
- [ ] Build the Turtle exporter (modelled entities + passthrough, inverses
      materialised).
- [ ] Sanitise HTML before rendering notes as markup — Semaphore stores them as
      HTML fragments and this web part will make them editable. Currently
      stripped to text.
- [ ] Decide the concurrency story: a single `.sqlite` has no merge path. Either
      lock the file or make the change journal the unit of merge.
- [ ] Snapshot to IndexedDB periodically — an unsaved tab close loses work.
