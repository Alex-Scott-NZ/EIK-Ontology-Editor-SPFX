# Semaphore comparison — round 2 instructions

Round 1 is done and archived in [archive/round1-2026-08-11/](archive/round1-2026-08-11/)
— 10 checks passed, **zero discrepancies**; see its RESULTS.md for the verdicts
and observations. What remains is the tree structure and Semaphore's own counts.

**Where to save:** drop every screenshot straight into this `comparison/`
folder. Names below are suggestions — anything recognisable works.

---

## 1. The tree, collapsed — `tree-collapsed.png`

In the concepts task, collapse everything so just the top level shows (the
concept schemes — "Activities", "Parties", etc.). One screenshot.

Expected: 11 entries.

## 2. Each top concept expanded one level — `tree-<root>.png` × 11

Expand each scheme → top concept → its direct children (one level only, no
grandchildren needed). One screenshot per root:

tree-activity, tree-authority, tree-classification, tree-event,
tree-information, tree-location, tree-money, tree-object, tree-party,
tree-product-or-service, tree-topic

Expected child counts: Activity 5 · Authority 13 · Classification 10 ·
Event 10 · Information 21 · Location 3 · Money 7 · Object 14 · Party 6 ·
Product or service 2 · Topic 16. (Full name lists are in
[archive/round1-2026-08-11/CHECKLIST.md](archive/round1-2026-08-11/CHECKLIST.md) §2.)

If Information shows fewer than 21, look for a display filter hiding archived
concepts — `[Archived information facets]` and `[Previous event]` under Event
are real concepts whose names start with `[`.

## 3. Model Statistics Report — `stats-report.png` (the important one)

You found this screen already: **Reporting → Standard → Model Statistics
Report**. Run it and screenshot the output (multiple shots if it's long).
This gives Semaphore's own counts to line up against ours:

| Measure | Editor expects |
|---|---|
| Concepts | 10,788 |
| Concept classes | 108 |
| Relationship types (associative pairs) | 141 declared + has related |
| Hierarchy edges (has broader) | 10,826 |
| Label attachments | 26,387 |

Don't worry if Semaphore's numbers differ — capture them and we'll reconcile;
each side counts slightly different things.

## 4. Duplicate Preferred Label Report — `dup-labels-report.png`

**Reporting → Validation → Duplicate Preferred Label Report.** We expect it to
list exactly these five names, two concepts each: Chinese, General Ledger,
Intelligence, Party, Property.

## 5. Orphans Listing — `orphans-report.png`

**Reporting → Validation → Orphans Listing.** Cross-checks our 8
concepts-with-no-class and anything unparented. Whatever it lists, capture it.

---

When the screenshots are in, tell Claude — comparison happens here, verdicts
get recorded, and the round gets archived like round 1.
