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

Semaphore is not only a taxonomy; it reads documents and tags them with
concepts automatically. The settings on each label are the instructions for
**how to recognise that concept in text**. This is by far the biggest body of
embedded knowledge, and it is invisible in any CSV export.

One concept, three labels, three different configurations:

```
Concept: Ground 5 - high cost of contact worksheet

  "IR470A"                                     caseSensitive, stemmingOff
  "IR 470A"                                    caseSensitive, stemmingOff, exactPhrase
  "Ground 5 - high cost of contact worksheet"  exactPhrase
```

A document containing `IR470A` is tagged with that concept; one containing
`ir470a` is not — deliberately, because the lowercase form is more likely noise
than a real form reference.

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

Read the minority values, not the majority. Each was set deliberately, one term
at a time, and a bulk default would erase the decisions while appearing to
preserve the data:

- **Stemming on (9)** — `Asset retiring`, `Tax exemption`, `Logging incident`.
  Phrases where variants are wanted ("asset retired", "tax exemptions").
  Everything else is exact, because stemming a form code produces nonsense.
- **Case-insensitive (21)** — `KiwiSaver`, `BEFU`, `HYEFU`,
  `Working for Families tax credit`. Terms people genuinely type inconsistently.
- **rulebaseInfluence High (77)** — `Contents of this Cabinet paper`,
  `Recommend that the Cabinet`. Phrases that are near-proof of what a document
  is.
- **TagIfPresent (9)** — `CONTRIBUTION_HOLIDAY_EXPIRY_DT` and similar database
  field names: if it appears at all, that settles it.
- **rulebaseAction DoNotGenerate (1,363)** — "never auto-tag with this". Almost
  entirely the GDA7 retention classes, and it pairs exactly with the note those
  concepts carry: *"GDA7 Classes not used for auto-categorisation. Too difficult
  for system to assess."* The note is the human reasoning; the flag is that
  reasoning enforced in the engine. Same decision, stored in two places — change
  one without the other and they contradict.

#### Some "labels" are match patterns, not names

227 labels contain wildcard syntax rather than readable text:

```
FIU-INFO-####     matches FIU-INFO-1234
CAB-##-           matches CAB-12-
ADV~~~~~IR*       BN~~~~/*       \Intranet\       $orted Money Week
```

This is why `characterEscaping = EscapeSpecialCharacters` exists on 7 labels —
for terms containing characters that would otherwise be read as wildcards.

**Checked specifically: none of the 227 is a preferred label.** They are
confined to three roles — `Evidence` (177), `Has-code` (40), `NotInNPT` (10) —
so display names are clean.

That is a direct UI requirement. Someone seeing `FIU-INFO-####` in an Evidence
field will reasonably assume it is corrupted text and "fix" it, silently
destroying a matching rule. **Mark those fields as patterns or make them
read-only; do not present them as ordinary free text.** The preferred-label
field is safe to edit normally.

All settings are held in `labels.flags_json` and round-trip intact regardless of
what is decided below.

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

- **When Semaphore goes, does anything downstream still consume this model** —
  document tagging, search, auto-classification? **SETTLED (2026-08-24): the
  whole suite goes — the classifier stops too.** The matching flags are
  therefore historical record, not live configuration: a new label with no
  flags is fine, and the export only needs to be valid Turtle, not ingestible
  by a running classifier. (The flags still round-trip intact and the editor
  shows/edits them as matching rules.)
- **Who owns URI minting for new concepts?** **SETTLED (2026-08-24):** new
  concepts are minted under `http://example.com/InlandRevenueModel-editor#`
  (scratch ontologies use their own namespace), so provenance stays visible.
- **Are concept schemes still meaningful** post-migration, or archival?
  (Tracked in README "Decisions and remaining work".)
