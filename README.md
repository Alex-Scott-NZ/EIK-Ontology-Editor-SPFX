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
| [comparison/TEST-SCRIPT.md](comparison/TEST-SCRIPT.md) | **Hands-on walkthrough**: Part A exercises the Model tab on the real IR ontology; Part B builds an ontology from scratch — classes → relationship types → concepts → links → labels → metadata → save → Turtle export. |
| [docs/DEMO-FAQ.md](docs/DEMO-FAQ.md) | **Demo prep**: the two questions audiences ask — classes vs the concept tree (108 vs 11, and the namesake trap), and how domain/range + subclass inheritance decide where relationships can go. |
| [docs/ONTOLOGY-MODEL.md](docs/ONTOLOGY-MODEL.md) | How the model is represented: triples, concepts, classes, `skos:broader`, domain/range/inverse, SKOS-XL labels. Start here if RDF is unfamiliar. |
| [docs/REPLACING-SEMAPHORE.md](docs/REPLACING-SEMAPHORE.md) | **The embedded knowledge that must survive** — matching flags, schema definitions, field rules, and the constraints Semaphore enforced that this tool must now enforce. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design decisions and their reasoning. |
| [docs/LEGACY-AUDIT.md](docs/LEGACY-AUDIT.md) | What the old pipeline got right and wrong, and what carries forward. |
| [tools/schema.sql](tools/schema.sql) | The database schema, commented with the reason for each choice. |

## This tool replaces Semaphore

Semaphore is the master today; this web part takes over from it. That makes
fidelity the primary constraint rather than a nice-to-have — **anything the
importer fails to carry across stops existing** once Semaphore is switched off.

Coverage is currently **100% of 202,693 triples**:

```bash
npm --prefix tools run audit     # exits non-zero if any triple is unaccounted for
```

Run it in CI. It is the regression test that keeps this true.

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

## Using the web part

Add it to a page. On first load it asks where the ontology comes from:

| Source | What happens |
|---|---|
| **Open a `.sqlite`** | Loads a database built earlier. Near-instant. |
| **Import a `.ttl`** | Builds the database in the browser. ~4 s for the full model. |

Either can come from your machine or from a SharePoint library (set the folder
in the property pane, then **Browse**). Once loaded, **Save .sqlite** downloads
the database and **Save to library** writes it back to SharePoint, so the import
is a one-off.

Set **Database to open on load** in the property pane to skip the picker
entirely and go straight to browsing.

`sql-wasm.wasm` is emitted into the bundle by an asset-module rule in
`gulpfile.js`, so it deploys with the package — no manual upload.

### Views

Mirrors Semaphore's Details tab (minus the visualiser):

- **Tree** — the 11 top concepts, children fetched on expand. Searching reveals
  the first hit in place.
- **List** — flat alphabetical, paged in SQL.
- **Detail** — two columns. Left: concept class chip (in the model's own
  `sem:color`), preferred and alternative labels, metadata. Right: related,
  broader and narrower concepts, plus URI/GUID.

Labels containing classifier wildcard syntax (`FIU-INFO-####`) are shown in
monospace with a **pattern** badge, so they are not mistaken for corrupted text
and "fixed" — see [docs/REPLACING-SEMAPHORE.md](docs/REPLACING-SEMAPHORE.md) §3.

## Getting started

`package.json` declares `engines: >=22.14 <23`, matching what SPFx 1.21
officially supports. In practice the install and `gulp bundle` both completed
on Node **20.19.5**, so the engines field is advisory here rather than
enforced — but prefer Node 22 for anything you intend to ship. This machine has
22.23.1 installed alongside 20.19.5; Git Bash defaults to 20, so run
`nvm use 22.23.1` if you want to match the declared version.

The first `npm install` pulls ~2,400 packages and took **27 minutes**. Budget
for it.

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

Verified working:

- **Turtle parser** — 0 unparsed statements against the full 21 MB export;
  typechecks clean under `--strict`.
- **Importer** — self-verifies against the reference counts and passes its
  integrity checks.
- **Database queries** — `npm --prefix tools run verify` smoke-tests the
  queries the web part issues, including the inverse derivation (one stored
  row correctly yields two view rows) and polyhierarchy.
- **Write layer** — `src/services/database/OntologyWriter.ts` is the single
  mutation path: concepts, relationships, labels, metadata and classes all go
  through it, journalled to `changes`, with undo, and it reimplements
  Semaphore's unique-label-within-class rule. New concepts are minted under
  `http://example.com/InlandRevenueModel-editor#`.
- **Turtle exporter + round trip** — `npm run roundtrip` is graph-identical:
  202,693 triples in, 202,693 out, zero lost, zero fabricated. The web part's
  "Export Turtle" command uses the same code.
- **Editing UI** — Tree/List/Detail plus a Model tab (classes, relationship
  types with inverses, domain/range with link validation), create/rename/delete
  throughout, and save-to-SharePoint with an unsaved-changes guard.
- **SPFx build** — `gulp bundle` completes clean, producing
  `dist/ontology-editor-web-part.js`.
- **Live testing** — dev-server workflow in `docs/LIVE-TESTING.md`, with a CDP
  browser harness under `tools/browser-harness/`.

## Decisions and remaining work

Settled (2026-08-24), recorded so they survive the next read-through:

- **The classifier stops with Semaphore.** The whole suite goes, so the 16,000+
  per-label matching flags are historical record rather than live
  configuration. They already round-trip intact and the UI shows/edits them as
  matching rules, but no further flag UX is required and the export only needs
  to be valid Turtle — not ingestible by a running classifier.
- **Notes stay plain text.** Semaphore stored them as HTML fragments (often
  because they were pasted that way, though Semaphore rendered the HTML). This
  web part shows them as pasted text and never renders HTML, so no
  sanitisation layer is needed unless rich-text notes are ever wanted.
- **Single editor at a time.** The ontology is one `.sqlite` file with no merge
  path, so only one person may edit at once. The file will need a lock — not
  yet implemented, so for now this is a process agreement rather than an
  enforced one.
- **URI minting** — new concepts are minted under
  `http://example.com/InlandRevenueModel-editor#` (scratch ontologies use their
  own namespace), so provenance stays visible.

Still to decide:

- [ ] **Concept schemes** — whether the editor manages the 11 concept schemes'
      membership or treats them as archival (currently preserved in
      `passthrough_triples` either way).

Remaining work (decided, not yet built):

- [ ] **Lock the file while editing** — enforce the single-editor decision.
- [ ] **IndexedDB snapshots** — periodically persist the in-memory database and
      offer to recover it when the page is reloaded after a crash or forced
      refresh, so unsaved work is not lost.
