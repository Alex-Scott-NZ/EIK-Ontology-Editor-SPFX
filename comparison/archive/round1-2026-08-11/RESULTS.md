# Semaphore comparison — results

Companion to [CHECKLIST.md](CHECKLIST.md), which holds the checklist and every
expected value. Run date, model version, and verdicts get recorded here;
screenshots go in this folder.

---

## Run info

- Date compared: 2026-08-11
- Compared by: Alex (screenshots) / Claude (verification against the editor DB)
- Editor version: 0.2.1.0 (pristine import of InlandRevenueModel.ttl)
- Semaphore/KMM version: 5.10.0 (visible in model_relationship_activity_1 footer)

## Verdicts

Status: ✅ match · ⚠️ differs (see notes) · ⬜ not checked yet

| § | Check | Status | Notes |
|---|---|---|---|
| 1 | Top-level tree (11 roots, descendant counts) | ⬜ | no screenshot yet |
| 2 | Second level — child lists per root | ⬜ | no screenshot yet |
| 3 | Deep dive: United States of America | ✅ | exact — see below |
| 4 | Deep dive: Competent Authority Arrangement | ✅ | exact — see below |
| 5a | Polyhierarchy (3 concepts, both parents) | ✅ | all 3 show both parents |
| 5b | Duplicate names (Chinese ×2) | ✅ | two distinct concepts confirmed |
| 5c | Wildcard labels | ✅ | raw patterns displayed verbatim |
| 5d | Dual-role labels | ✅ | same string under Has code AND Has evidence |
| 5e | Concepts with no class (8) | ⬜ | not captured |
| 6.1 | Relationship-type list | ✅ | pairs, nesting under "has related", one-directional types all match |
| 6.2 | Has participating country detail | ✅ | Agreement↔Country mirrored; URIs match ours |
| 6.3 | Label + attribute definition screens | ✅ | see O1/O2 |
| 6.4 | Class list + Activity class detail | ✅ | colour #cf7bd9 verified in TTL; subclass tree; per-class relationship list = our v_allowed_properties |
| 7 | Global counts | ⬜ | run KMM's "Model Statistics Report" (Reporting → Standard) |

## Section notes

**§3 USA** — Related Concepts **16** = our 16 link ends exactly, including the
9 inverse-derived ones (Has interest in ×7, Is country signed to agreement ×1,
related ×1). Semaphore renders derived directions under the flipped property
name, same as our v_concept_links. Labels, class, broader, definition, sources,
Instance=false: all match.

**§3/§4 label flag icons decoded** — Semaphore marks label matching flags with
icons: **U** = case sensitive, **red jigsaw** = stemming off, **blue star** =
exact phrase, **bar chart** = rulebase influence. Checked icon-by-icon against
our `labels.flags_json` for USA and CAA: perfect correspondence (e.g. CST CAA
shows U + star + jigsaw = CaseSensitive + ExactPhrase + StemmingOff, exactly
our three flags).

**§6.1** — every associative pair is nested UNDER "has related" in Semaphore's
tree, confirming our `sub_property_of = skos:related` on all of them. "Has
related activity" and "has related" carry the one-directional arrow (↔) —
matches our two no-inverse/self-inverse rows. Pair spot-checks across all four
screenshots: no differences found against the FULL PROPERTY TABLE in
data/compare-extract.txt.

**§6.4** — the Activity class detail shows: URI `smartlogic.com/class#Function`
(historical URI ≠ label — our classes table stores it), colour #cf7bd9
(**verified byte-for-byte in the TTL** as `sem:color "cf7bd9"^^xsd:hexBinary`),
definition, Sub-Class of Concept, and the per-class applicable-relationship
list which is what our `v_allowed_properties` computes.

## Observations (new knowledge, no action unless noted)

**O1 — "forced preclusion" label relationship** exists in Semaphore's
Concept-to-Label tree (with an l-n language-neutral badge) but has **zero
occurrences in the TTL export** (grep: 0). A KMM built-in we never used.
Nothing lost; nothing to build.

**O2 — label relationships have inverses** — "Previously known as / Now known
as" is a concept→label pair with mirrored URIs (`#Previously-known-as_4_None_None`
/ `#Now-known-as_4_None_None`). Explains why our import carries a "Now known
as / Previously known as" object-property pair with 0 stored rows alongside the
label property with 259 uses. Consistent; documented here so nobody "fixes" it.

**O3 — the 5 unnamed datatype properties explained** — `OntologyServer#DateNoteType`,
`DecimalNoteType`, `NoteType`, `RegexNoteType`, `TextNoteType` are Semaphore's
attribute *datatypes* (calendar icon on Last Reviewed Date, toggles on booleans,
etc.), not IR content. Zero usage as predicates; safe to hide in the editor UI.

**O4 — class-level UI settings are NOT in the export** — "Set
related/broader/narrower as ordered list (Custom)", "Set class as abstract",
"Default Alternative Label", "Default Narrower Relationship", and per-type
"Permitted First Class Metadata" checkboxes appear in KMM's UI but have no
predicates in the TTL (grep: 0 structural matches). If they matter, they'd have
to be re-captured manually post-Semaphore; they do not affect the data itself.

**O5 — SKOS mapping properties unused** — has broader/close/exact/related
match: zero instances in the export. The Mapping section of KMM's tree is
empty machinery for us.

**O6 — the two hierarchies visibly differ** — class tree under Activity:
Business activity, International taxation, System functionality, Taxpayer
activity, Third party activity. Concept tree under Activity: Business activity,
Machinery of government, System functionality, Taxpaying activity, Third party
activity. Similar names, not the same lists — a clean demonstration that
rdf:type and skos:broader are independent.

**O7 — KMM's Reporting screens** (Standard: Alphabetical Listing, Model
Statistics, Metadata Report…; Validation: Constraint Violations, Duplicate
Preferred Label, Orphans Listing, SHACL Validation) are *features to consider
replicating* in the editor — Duplicate Preferred Label and Orphans in
particular are one SQL query each for us.

## Discrepancies

None found so far. Every difference discovered was explainable (O1–O5) and
none involves data loss in the import.

## Still to capture

1. §1/§2 — tree collapsed + each root expanded one level (checklist has the
   expected lists).
2. §7 — run **Reporting → Standard → Model Statistics Report** and screenshot
   the output; that gives Semaphore's own counts to line up against ours.
3. Optionally **Validation → Duplicate Preferred Label Report** and **Orphans
   Listing** — direct cross-checks of our 5 duplicate names and 8 no-class
   concepts.
