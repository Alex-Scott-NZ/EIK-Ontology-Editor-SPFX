# Linking the Ontology Editor to the Ontology Viewer

Status: **DESIGN — agreed direction, implementation not started.**
Ticket: NWR-40260 ("Create instructions and process for linking to the
'viewer' webpart"). Written 2026-09-15.

## Decision

The viewer (`IKM-Ontology-WebPart`, "OntologyBrowserWebPart") is upgraded to
read the **editor's database schema directly**. No compatibility with the
legacy CSV-derived schema is kept: the viewer is not yet in real use anywhere,
so there is nothing to migrate. After this work, ONE `.sqlite` format exists —
the editor's (`tools/schema.sql`) — and "publishing" the ontology is simply
the editor's **Save** button writing to the folder the viewer reads.

Rejected alternative: an editor-side exporter producing legacy-format files.
That would preserve a schema whose flaws (duplicated concepts for
polyhierarchy, `;`-joined synonym rows, GUID ambiguity) the editor's schema
was specifically designed to eliminate.

## The two web parts today

|  | Editor (`EIK-Ontology-Editor-SPFX`) | Viewer (`IKM-Ontology-WebPart`) |
|---|---|---|
| SPFx / Node | 1.21.1 / **Node 22** | 1.20.0 / **Node 18** |
| Reads/writes | `<web>/Shared Documents/Ontology/<file>` (folder configurable) | reads `<web>/Ontology/<file>` — **hard-coded folder**, file name a property |
| Schema | `concepts / broader / labels / annotations / properties / relationships` (+views) | legacy `terms / relationships(+types) / synonyms(+types) / metadata(+types)` |
| sql.js wasm | inlined in bundle (`asset/inline` + `wasmBinary`) | **fetched from sql.js.org CDN at runtime** (unpinned) |
| Caching | none (loads on open) | IndexedDB cache, 12 h TTL, `CACHE_VERSION` string |

> **Toolchain hazard:** nvm-windows switches Node machine-wide. Editor work
> needs `nvm use 22`, viewer work `nvm use 18` — run `node -v` before any
> build, and never serve both projects at once. (This mismatch caused the
> editor's intermittent build OOMs before; see the repo history.)

## Changes to the viewer

All changes are confined to the **data layer** (`DatabaseService.ts`,
`DataLoaderService.ts`, web-part properties). The UI components
(`OntologyBrowser.tsx`, `OntologyGraphD3.tsx`) consume the same
`TermData` / `TermDetails` shapes as today and are not modified.

### 1. Load layer rewritten against the editor schema

`DatabaseService.loadFromBinary` currently reads a flat `terms` table with
`(id, label, level, parent_id, original_guid, class_id)`. Replacement: build
the same in-memory `termMap` by walking the editor schema at load time.

- **Positions, not concepts.** The UI is a single-parent tree (breadcrumb,
  one `parent`, one `fullPath`). The editor supports polyhierarchy via the
  `broader` table. As the legacy data did, a concept with N parents becomes
  **N term positions** (same `guid`, different synthetic position id,
  `parent_id`, `level`, `fullPath`). Recursive walk: start at
  `v_root_concepts`, descend `broader`, one position per distinct path.
  Depth-derived `level` is contiguous by construction (the UI requires
  `child.level === parent.level + 1`).
- **Class-level roots.** Legacy level-0 rows were the classes themselves.
  Synthesize one level-0 position per **class that has root concepts**,
  labelled with `classes.label`, and parent the top concepts beneath it.
  Concepts keep `class` = their own class's label (drives colours/legend).
- **Identity.** `guid` = `concepts.guid` (sem:guid) when present, else
  `concepts.uri`. Same caveat as today: selecting by guid resolves to one
  position when a concept appears in several places.
- **Relationships** from `v_concept_links` (which already derives inverse
  directions) joined to `properties.label` for the type name. Strictly more
  complete than the legacy outbound-only rows. Targets always resolve (the
  view guarantees both ends exist), fixing the legacy "target not found —
  edge dropped" case.
- **Synonyms** from `labels` where `label_property` is not prefLabel:
  `synonym_type` = the property's `properties.label` (fallback: URI local
  name), `value` = `literal_form`. One row per label — the `;`-joining
  disease does not come back.
- **Metadata** from `annotations`: `metadata_type` = the defined field's
  label (fallback: local name), `value` verbatim (HTML fragments stripped
  for display, as the editor does).
- **Synthetic `CsvRow` kept.** The detail accordions still key off
  `relatedConcept_*` / `label_*_en_literalForm` / `metadata_*_en` — the
  rewrite reproduces those keys from the new sources. (Removing the CsvRow
  dependency is future UI work, out of scope.)
- **Bug fixed en route:** `getTermDetailsForDisplay` today returns a
  `centerTerm` without `row`, which blanks the Relationships/Synonyms/
  Metadata accordions after selection. The rewrite sets `row` on every
  `TermData` it produces.

### 2. Folder becomes a property, aligned with the editor

New web-part property `libraryFolder` (server-relative), **default
`Shared Documents/Ontology`** — the editor's default output folder — with the
file name property as today (`ontology.sqlite`). Pointing both web parts at
the same folder + file IS the link. Per-site overrides stay possible on both
sides via their property panes.

### 3. Cache correctness

- Bump `CACHE_VERSION` so all previously cached legacy databases are
  discarded on first load of the new build.
- Keep the 12 h TTL, and document it: after the editor saves, viewers may
  show the old data for up to 12 hours unless the cache is cleared
  (`DataLoaderService.clearCache()` is exposed in the admin panel).
  Improvement worth taking if cheap: compare the SharePoint file's
  `TimeLastModified`/ETag before trusting the cache, so an editor save is
  picked up on the next page load.

### 4. sql.js wasm pinned

Replace `https://sql.js.org/dist/` (unpinned — silently drifts to whatever
sql.js ships next) with the versioned cdnjs URL matching the bundled JS glue
(`sql.js` 1.13.x): `https://cdnjs.cloudflare.com/ajax/libs/sql.js/<exact
version>/sql-wasm.wasm`. Inlining as the editor does is the fully-offline
option; not required for this phase.

### 5. Known degradation: term-store tagged-content search

The legacy DB carried `term_store_id` per hierarchy position; the viewer uses
it to search pages tagged with the term (`owstaxIdOntologyx0020Terms`). The
editor's schema has no term-store mapping, so `getTermStoreIds` returns
nothing and that panel shows no results. Acceptable for now (the term-store
sync itself is a separate concern); revisit if/when ontology→term-store
publishing returns.

## Publishing: master and live copy are two different files

**Decided 2026-09-15.** The editor cannot be assumed to live on a site the
whole organisation can read, so a single shared file is not an option: there
are two copies.

| | Where | Who |
|---|---|---|
| **Master** | the editor's site, e.g. `<editor-site>/Shared Documents/Ontology/<name>.sqlite` | editors read+write |
| **Live copy** | a site everyone can read (hosting TBD — IKM / EIK / DPEx Shared Workspace per NWR-40260) | everyone reads; editors write so they can publish |

**Save ≠ Publish.** Save writes the master (a working copy, invisible to
readers). Publish copies it to the live location. Editors can therefore work
through a series of changes without the organisation seeing half-finished
states.

### Where the publish target is remembered

In the master file itself, as `publish_target` in `import_metadata` — NOT in
the web part's properties. The target belongs to the ontology, not to the page
it happens to be opened on: open the same file from any page or machine and it
still knows where it publishes, and two ontologies can publish to different
places. A web-part property supplies the default for files that have no target
yet. (Known gap: `import_metadata` is not carried through a Turtle export, so
a re-imported .ttl needs its target set again.)

The target is a **full absolute URL** including site, folder and file name,
because the live copy is normally on a different site collection.

### How "is the live copy current?" is answered

Not by comparing file timestamps — those are skewed by clocks and touched by
unrelated events. Instead the editor stamps the master at publish time:

- `published_change_id` — `MAX(changes.id)` at the moment of publishing
- `published_at`, `published_to`, `published_by`

Because every edit is journalled to `changes`, the question "are there
unpublished edits?" is then answerable **from the master alone**:
`MAX(changes.id) > published_change_id`, and the difference is how many.
The live copy carries the same stamp, so reading it tells you exactly which
revision of the master is live.

This gives the status strip a third state alongside the existing red unsaved
badge: unsaved → saved but not published → live.

### Required alongside: the viewer must revalidate its cache

The viewer caches the database in IndexedDB for 12 hours without checking the
server, so without a change a publish would take up to a day to reach readers
— which would make "Publish" a lie. The viewer must compare the file's ETag /
Last-Modified before reusing a cached copy, and refetch when it differs.

### Constraint this puts on the hosting decision

The viewer reads from **its own site** — `pageContext.web.absoluteUrl` plus the
folder property; it has no notion of reading across site collections. So:

> the site hosting the **viewer page** must be the site holding the
> **published copy**, and that site must be readable by everyone.

The editor publishes *out* across sites (verified), but the viewer only reads
*locally*. That is the right split — readers never need access to the editor's
site — but it means choosing the viewer's home site and the published file's
location is a single decision, not two.

### Publish-time safeguards

- Run the existing integrity checks before writing the live copy, so a broken
  ontology cannot go organisation-wide.
- Publish into a library with versioning enabled: rollback and publish history
  come free.

## The update process (the instructions the ticket asks for)

Once implemented, the process for content owners:

1. Open the ontology in the **Editor** page, make changes.
2. **Save** (or Save as… to the shared folder). That's the publish step —
   the viewer reads the same file.
3. Viewers see the new data on next load, or immediately after a cache clear
   (up to 12 h otherwise — see §3).

Operational prerequisites for anyone who will SAVE:
- Write access to the ontology folder (see edit-gating below).
- **Zscaler exception list** membership — uploads of `.sqlite` to SharePoint
  are otherwise blocked with HTTP 403 (resolved by WTE under RITM0365739;
  Alex S and Noni are on the list; each new editor must be added).

## Testing plan (dev tenant first, then production)

1. Deploy the updated viewer sppkg to the dpex-testing app catalog; add the
   viewer web part to a page on the dpex-testing site.
2. Point it at `Shared Documents/Ontology/ontology.sqlite` (the walkthrough
   demo file) — verify tree, search, breadcrumb, detail accordions, graph,
   class colours.
3. Open `InlandRevenueModel.sqlite` (10,788 concepts) — verify load time and
   navigation at real scale; spot-check a polyhierarchical concept (49 exist)
   appears under each of its parents.
4. Edit-save-reload loop: change a label in the editor, Save, clear viewer
   cache, reload viewer, confirm the change shows.
5. Only then: production deployment (site TBD per NWR-40260's hosting AC).

## Out of scope here

- Edit-access gating (separate work item; design agreed: folder permissions
  as enforcement + read-only editor mode from an effective-permissions
  check).
- Removing the viewer's AdminPanel/CsvLookupService write surfaces (audit
  item from the ticket; to be done in the viewer repo alongside this work).
- True polyhierarchy in the viewer UI (multiple parents/breadcrumbs).
