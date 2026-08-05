# Architecture & design decisions

Read [ONTOLOGY-MODEL.md](ONTOLOGY-MODEL.md) first — it establishes the vocabulary
used here.

---

## Data flow

```
InlandRevenueModel.ttl                    (Semaphore export — source of truth)
        │
        │  tools/import-ttl.ts   (Node, one-time + on each refresh)
        ▼
  ontology.sqlite                         (editing store, ~10 MB)
        │
        │  uploaded to a SharePoint document library
        ▼
  SPFx web part                           (sql.js in WASM + IndexedDB cache)
        │  edits mutate the in-memory DB; changes journalled
        ▼
  export ──┬── full Turtle      (modelled entities + passthrough → Semaphore-compatible)
           ├── clean Turtle     (standard SKOS/OWL for other tools)
           └── change set       (only what this session altered)
```

---

## Decision 1 — SQLite as the editing store, Turtle as the interchange format

Both options were considered seriously.

**Note first that persistence is identical either way.** In a browser, sql.js does
not write to a `.sqlite` file as you go — the database lives entirely in WASM
memory, edits mutate it instantly, and a file only exists when `db.export()` is
called and the bytes are uploaded. An in-memory Turtle store (N3.js) behaves exactly
the same: parse on load, mutate in memory, serialise on save. "Hold in memory, save
at the end" is not a differentiator.

| | Turtle in memory (N3.js) | **SQLite in memory (sql.js)** |
|---|---|---|
| Round-trip fidelity | perfect by construction | only as good as schema + passthrough |
| Load cost | 21 MB download, ~2–5 s parse | 10 MB, near-instant |
| Tree / search / constraint queries | hand-written traversals, no indexes | indexed SQL |
| Integrity (orphans, dangling targets, inverse pairs) | all in app code | FKs + constraints + views |

**Chosen: SQLite.** The editor is query-shaped, not graph-shaped — every screen is a
tree, a filtered list, or a "what may link here" lookup. The fidelity gap is the only
real cost of SQLite, and Decision 2 closes it.

## Decision 2 — model what we edit, pass through what we don't

Fidelity risk is not in editing SQLite; it is in *regenerating Turtle from a schema
that didn't capture everything*.

So: concepts, hierarchy, relationships, labels and annotations get proper tables.
**Every triple not claimed by those tables is stored verbatim in
`passthrough_triples`** — Semaphore matching flags, SPIN imports, concept-scheme
wiring, the model header.

Export = regenerate the modelled entities + append the passthrough. Fidelity no
longer depends on modelling 100% of Semaphore's vocabulary up front, which is the
failure mode that would otherwise bite six months in.

## Decision 3 — store one row per logical relationship, derive the inverse

The hazard from §5 of ONTOLOGY-MODEL.md: the TTL physically stores both directions
of an inverse pair as independent triples, and **nothing keeps them in step**. The
source data has already drifted (`HasInterestIn` 985 vs `IsInterestOf` 982).

Three options:

1. Store both directions, keep them in sync in a service method — drift remains
   *possible*; one forgotten code path corrupts the model silently.
2. Store one canonical direction, present both via a view — drift becomes
   *structurally impossible*.
3. Store both with a shared pair id — extra bookkeeping, same guarantees as (2).

**Chosen: (2).** `relationships` holds one row per logical link. A view unions the
forward direction with the inverse-flipped direction, so the UI can ask "what links
touch this concept?" and get both ends. Export materialises both arrows from the
view. There is no code path that can write half a relationship.

Properties with no declared inverse (a handful) simply produce no reverse row —
correct, since one arrow is the whole story for them.

## Decision 4 — validity from declared class rules, not inferred depth

Replaces the legacy `relationship_constraints` table. The check becomes:

> the source concept's class is the property's `rdfs:domain` **or a subclass of it**,
> and the target's class is the `rdfs:range` **or a subclass of it**
> (a range of `skos:Concept` means "anything")

This needs the class tree loaded, since domains are inherited. See
[LEGACY-AUDIT.md](LEGACY-AUDIT.md) §4.2 for why the depth heuristic is being retired.

## Decision 5 — journal every change

A `changes` table records op / entity / URI / before / after / timestamp / author.
It buys three things: undo, an audit trail for the taxonomy team, and the change-set
export below.

## Decision 6 — key on URI and GUID, never on label

Labels are display data and may legitimately collide across classes (5 pairs today).
Every internal reference uses `concept.id` → `uri` / `guid`. Pickers that would show
two identical labels disambiguate by class **in the UI layer only**.

---

## Export profiles

| Profile | Contents | For |
|---|---|---|
| **Full Turtle** | modelled entities + `passthrough_triples`, both inverse directions materialised, all prefixes | returning to Semaphore / archival |
| **Clean Turtle** | `skos:prefLabel`/`altLabel` literals materialised from SKOS-XL, concepts asserted as `skos:Concept`, vendor triples and unresolvable `owl:imports` dropped | Protégé, PoolParty, GraphDB, SPARQL endpoints |
| **Change set** | only rows in `changes` since a baseline | applying edits back in Semaphore by hand |

The change-set profile matters because of an open question below.

---

## Open question that should be settled before building the export

**Is Semaphore still the master, or is this web part becoming the master?**

- *Semaphore stays master* → do not plan to re-ingest a 21 MB foreign full-graph
  export; Semaphore will not take it cleanly. The change-set profile becomes the
  primary output and `passthrough_triples` matters less.
- *This web part becomes master* → full Turtle is the archival/interchange format
  and passthrough fidelity is essential.

The architecture serves both; only the emphasis changes. **Decide before writing the
export.**

---

## Storage & runtime notes (SharePoint specifics)

- The `.sqlite` binary lives in a document library; read/write via PnP `sp.web
  .getFileByServerRelativePath(...)`. Path encoding rules for anything with special
  characters: see `~/.claude/notes/sharepoint-file-urls.md`.
- Cache the loaded database in IndexedDB keyed by the file's ETag so a returning
  user skips the download; invalidate when the ETag changes.
- Snapshot the in-memory DB to IndexedDB periodically — neither storage option gives
  incremental durability, so an unsaved tab close loses work otherwise.
- Concurrency: a single `.sqlite` file has no merge story. Either take a checkout
  lock on the library file, or (better) treat the change journal as the unit of
  merge. **Decide before multi-user editing is enabled.**
- sql.js ships a `.wasm` that must be reachable at runtime — serve it from the
  bundle rather than a CDN, since SharePoint CSP and offline dev both punish
  external fetches.

---

## Build/runtime environment

- SPFx **1.21.1**, React 17, TypeScript 5.3 — matched to the existing
  IKM-Ontology-Admin web part so tooling knowledge transfers.
- **Node 22 required** (`engines: >=22.14 <23`). This machine defaults to Node
  20.19.5 in Git Bash while 22.23.1 is installed — run `nvm use 22.23.1` first, or
  call the binary explicitly. Per-shell version skew is a known trap here.
- Debug URL for SPFx ≥1.19 (Heft) is
  `?debugManifestsFile=https%3A%2F%2Flocalhost%3A4321%2Ftemp%2Fbuild%2Fmanifests.js&debug=true&noredir=true`
  — note the `/build/` segment; the old Gulp-era path silently loads the deployed
  bundle instead.
