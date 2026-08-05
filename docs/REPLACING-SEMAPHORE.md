# Replacing Semaphore: the embedded knowledge that must survive

**Decision (2026-08-05):** Semaphore is currently the master, but this web part
will replace it. The editor does not have to mimic Semaphore's interface, but
nothing the model carries may be lost in the handover.

That reframes the project. A sync tool can afford to model 80% and let Semaphore
hold the rest. A replacement cannot: **anything the importer fails to carry
across stops existing the day Semaphore is switched off.**

---

## Fidelity status: 100%

`npm --prefix tools run audit` walks the source and classifies every triple by
the table it lands in. It is wired to exit non-zero if anything is unaccounted
for, so this stays true rather than merely having been true once.

```
Subjects: 38,354   Triples: 202,693   (parser anomalies: 0)

Carried across : 202,693
Dropped        : 0
Coverage       : 100.0000%
```

The first audit run found **39 dropped triples** — small in number, large in
value: they were the taxonomy team's own written definitions of the relationship
types. Those are now first-class columns. See "What was nearly lost" below.

---

## The four kinds of embedded knowledge

### 1. What the model says — the obvious part

Concepts, the `skos:broader` tree, 25,214 typed relationships, labels,
definitions, scope notes, sources. All modelled in dedicated tables.

### 2. What the model *means* — the schema's own documentation

Written by whoever built the ontology, and irreplaceable once Semaphore is gone
because it exists nowhere else:

| Where | What |
|---|---|
| `classes.definition` | 101 class definitions ("RDS — Retention and disposal schedules") |
| `properties.definition` / `.comment` | 8 relationship-type definitions |

Examples now preserved:

> **Last Reviewed Date** — "Needed so that we can determine what will need to be
> reviewed and when. Put this at the top level of any cohesive set, but not at
> all the lower levels."

> **Provides** — "Was made Party to concept because the relationship is needed
> for both Party to service and Party to Product."

> **used as IR Topic** — "used for second level concepts that are included in
> the metadata value set for IR Topic"

These are design decisions with reasoning attached. **Surface them in the
editor** — in the relationship picker and the class picker — or they will be
preserved but never read, which is the same as losing them.

### 3. How text should be matched — the largest hidden asset

Semaphore is not only a taxonomy; it is a text-classification engine, and the
model carries per-label instructions for how each term should be matched in
documents. This is by far the biggest body of embedded knowledge, and it is
invisible in any CSV export:

| Flag | Labels | Values seen |
|---|---|---|
| `rulebaseBehaviour` | 16,329 | ExactPhrase |
| `stemming` | 6,643 | Off 6,634 / **On 9** |
| `caseSensitivity` | 3,444 | Sensitive 3,423 / **Insensitive 21** |
| `rulebaseAction` | 1,363 | DoNotGenerate |
| `conceptMapping` | 992 | Off 991 / **On 1** |
| `autocompletion` | 961 | Off |
| `alphabeticalIndex` | 298 | On 294 / **Off 4** |
| `rulebaseInfluence` | 271 | None 168 / High 77 / Low 17 / TagIfPresent 9 |
| `characterEscaping` | 7 | EscapeSpecialCharacters |

Read the minority values, not the majority: 9 labels stem, 21 are
case-insensitive, 77 have high rulebase influence. Someone made those calls
deliberately, one term at a time. A bulk default would erase the decisions while
appearing to preserve the data.

All are held in `labels.flags_json` and round-trip intact. **Whether the new
editor lets you *edit* them depends on whether IR still runs Semaphore's
classifier downstream — settle that separately from this migration.** If the
classifier goes too, these become historical record; if it stays, they are live
configuration and the editor needs UI for them.

### 4. How the editing tool should behave — field rules

A handful of properties carry constraints Semaphore enforced in *its* UI. This
is the closest thing the export has to a specification for the editor:

| Flag | Meaning (inferred from name and use) |
|---|---|
| `changeable` (7 properties, all `1`) | field may be edited by users |
| `unique` (`0`) | duplicate values permitted |
| `translatable` (`1`) | field participates in multi-language |
| `noteRangeFrom` / `noteRangeTo` (`0`–`4000`) | length limits on a note field |
| `defaultValue` (`false`) | value for new concepts — `Instance` defaults to false |
| `abbreviatiedLabel` (6) | short form for narrow UI (Semaphore's own typo, kept verbatim) |
| `color` (10 classes) | tree swatch — e.g. Activity `cf7bd9`, Event `71c4f4` |

The class colours are worth honouring: users navigate by them today.

---

## Constraints Semaphore enforced that the editor must now enforce

Semaphore's model header imports two constraint modules, so these rules were
enforced *by the tool*, not by the data. When the tool goes, the rules go with
it unless reimplemented:

| Constraint | Evidence | New home |
|---|---|---|
| `unique-concept-label-constraint` | model header `spin:imports` | validation on save |
| `unique-concept-label-in-class-constraint` | model header `spin:imports` | validation on save |

The second is the subtle one: labels must be unique *within a class*, not
globally. Five labels are legitimately shared across classes today (see
ONTOLOGY-MODEL.md §6) and a naive global-uniqueness rule would reject the
existing data.

Also carried but not yet enforced:

- **Domain/range** on 151 properties — already queryable via
  `v_allowed_properties`, which walks the class tree so subclasses inherit.
- **11 concept schemes** — preserved in `passthrough_triples`. Decide whether
  the editor manages scheme membership or treats it as archival.

---

## What was nearly lost

Worth recording, because it shows how the failure mode looks in practice.

The first importer version modelled classes and properties with fixed columns
and dropped anything unrecognised. That silently discarded 39 triples: property
definitions, class colours, and the field rules above. Nothing errored; the
counts all matched; only a triple-by-triple audit surfaced it.

**The fix generalises.** Classes, properties and labels each keep a
`flags_json` blob holding every predicate not promoted to a column, and
everything else lands in `passthrough_triples`. Unknown vocabulary is now
preserved by default rather than dropped by default — so a Semaphore feature we
have never seen still survives the migration.

A second near-miss, same shape: `skos:related` (4,248 links) has no
`owl:ObjectProperty` definition block because it is a SKOS built-in Semaphore
never redeclares. The importer originally routed all 4,248 to passthrough,
demoting real relationships to opaque triples.

---

## Consequences for the build

1. **Full-fidelity Turtle export is now mandatory**, not optional. It is the
   proof the migration is reversible and the archival format if the tool is ever
   replaced in turn. Build it early, not last.
2. **The audit is a regression test.** Run `npm --prefix tools run audit` in CI;
   it exits non-zero on any dropped triple.
3. **Round-trip test before switch-off**: original TTL → SQLite → TTL, compared
   as triple sets. Coverage proves nothing is dropped *on the way in*; only a
   round trip proves it comes back out.
4. **Editing must not silently normalise.** Preserve five namespaces, existing
   URI patterns, and per-label flags on save. A "tidy-up" pass that rewrites
   URIs would break every relationship and every external reference.
5. **The change journal becomes the migration audit trail** — what changed after
   the model left Semaphore.

---

## Open, and worth deciding early

- **Does IR keep running Semaphore's classifier?** Decides whether the matching
  flags are live configuration needing editing UI, or historical record to
  preserve untouched. This is the single biggest scope question remaining.
- **Who owns URI minting for new concepts?** Five namespaces exist; new
  concepts need a rule. Recommend one new namespace for anything created here,
  so provenance stays visible.
- **Are concept schemes still meaningful** post-migration, or archival?
