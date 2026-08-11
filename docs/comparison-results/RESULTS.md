# Semaphore comparison — results

Companion to [../SEMAPHORE-COMPARISON.md](../SEMAPHORE-COMPARISON.md), which
holds the checklist and every expected value. Run date, model version, and
verdicts get recorded here; screenshots go in this folder.

**Screenshot naming:** `<section>-<what>-<side>.png`, where side is `sem`
(Semaphore) or `ed` (editor). Examples:

- `01-tree-collapsed-sem.png` / `01-tree-collapsed-ed.png`
- `02-authority-children-sem.png`
- `03-usa-sem.png` / `03-usa-ed.png`
- `06-reltypes-list-1-sem.png` (repeat -2, -3 while scrolling)
- `06-has-participating-country-detail-sem.png`

Partial captures are fine — several scrolled screenshots of one screen beat one
unreadable full-page shot.

---

## Run info

- Date compared:
- Compared by:
- Editor version: 0.2.0.0 (pristine import of InlandRevenueModel.ttl)
- Semaphore/KMM version:

## Verdicts

Status: ✅ match · ⚠️ differs (see notes) · ⬜ not checked yet

| § | Check | Status | Notes |
|---|---|---|---|
| 1 | Top-level tree (11 roots, descendant counts) | ⬜ | |
| 2 | Second level — child lists per root | ⬜ | |
| 3 | Deep dive: United States of America | ⬜ | |
| 4 | Deep dive: Competent Authority Arrangement | ⬜ | |
| 5a | Polyhierarchy (3 concepts, both parents) | ⬜ | |
| 5b | Duplicate names (5 pairs) | ⬜ | |
| 5c | Wildcard labels | ⬜ | |
| 5d | Dual-role labels | ⬜ | |
| 5e | Concepts with no class (8) | ⬜ | |
| 6.1 | Relationship-type list (name/inverse/from/to) | ⬜ | |
| 6.2 | One type in detail (Has participating country) | ⬜ | |
| 6.3 | Label + attribute definition screens | ⬜ | |
| 6.4 | Class list (108) + one class detail | ⬜ | |
| 7 | Global counts | ⬜ | |

## Discrepancies

One entry per discrepancy. Don't classify — capture both sides; classification
(import decision / display filter / genuine bug) happens during reconciliation.

### D1 — (short title)

- **Section:**
- **Semaphore shows:**
- **Editor shows:**
- **Screenshots:**
- **Resolution:** (filled in later)
