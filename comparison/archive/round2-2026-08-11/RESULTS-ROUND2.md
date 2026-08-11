# Semaphore comparison — round 2 results

Compared 2026-08-11 against editor 0.2.1.0 (pristine import). Round 1 results:
[round1-2026-08-11/RESULTS.md](../archive/round1-2026-08-11/RESULTS.md).

The reports came as JSON exports (better than screenshots — exact numbers).

## Verdicts

| Check | Status | Notes |
|---|---|---|
| Duplicate Preferred Label Report | ✅ | **exactly** our predicted 5 names, 2 each: Chinese, General Ledger, Intelligence, Party, Property |
| Orphans Listing | ✅ | empty — consistent with every concept having a broader chain |
| Model Statistics: altLabel count | ✅ | Semaphore 15,599 = our non-pref label attachments **to the digit** (26,387 − 10,788) |
| Model Statistics: prefLabel count | ⚠️ | Semaphore 10,796 vs our 10,788 — see D1, the export is stale |
| Class tree (Concept Classes) | ✅ | child-for-child match against our `classes.parent_class_id`: Authority 10, Location 4, Money 8, Party 7 (incl "DO NOT USE" and Worker type), Topic→Measurement, Security metadata 2, Object→System, Information→IR form |
| Concept scheme tree (§1/§2 of round 1) | ⬜ | screenshots captured the *class* tree (model admin), not the concepts-task scheme tree — still open, now low priority given everything else matches |

## D1 — the export is stale by 8 concepts (first genuine discrepancy)

Semaphore's live master reports **10,796** English prefLabels. The TTL export
contains **exactly 10,788** `skosxl:prefLabel` triples (grep-verified), and our
database matches the export exactly — no concept carries two prefLabels. So the
import is perfect; the **export file lags the live model by 8 prefLabels**
(concepts added or renamed in Semaphore after the export was taken).

**Action:** take a fresh export from Semaphore before any cutover — re-import
is ~4 seconds and the whole verification suite (audit + round-trip) reruns
automatically. Worth diffing old vs new export to see what the 8 are.

## O8 — class polyhierarchy exists, and survives the import

`Business type` is `rdfs:subClassOf` BOTH `PersonType` ("Party role") and
`ANOClass` ("DO NOT USE"). Our schema's single `parent_class_id` holds
Party role; the second parent is preserved verbatim in the class's
`flags_json` and re-emitted on export (the 100% coverage audit already proved
no triple is dropped). Explains why KMM's tree shows Business type at top
level: a two-parent class can't nest singly. One-off in this model (only class
with two parents).

## O9 — URI archaeology in the class scheme

Class labels and URIs diverge freely: `#PersonType` is labelled "Party role",
`current-#PersonType` is "Worker type", `#ANOClass` is "DO NOT USE", and
Activity's URI is `class#Function`. The editor must never derive display names
from URIs — it doesn't (labels come from `rdfs:label`), recorded so nobody
"simplifies" that later.

## Files

- `ModelStatisticsReport.json` — prefLabel/altLabel counts per language
- `DuplicatePreferredLabelReport.json` — the 5 duplicate names
- `OrphansListing.json` — empty result set
- `Tree Collapsed.png`, `Tree Expanded - 1.png`, `Tree Expanded - 2.png` —
  the Concept Classes tree (verified) with the Measurement class detail pane
