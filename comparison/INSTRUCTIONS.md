# Semaphore comparison — what's left

Two rounds done, both archived below. Verdict so far: **the import is
verified against the master** — every count, concept, label flag, class and
relationship type checked matches. One genuine discrepancy found, and it's in
Semaphore's favour, not ours:

> **D1: the TTL export is stale.** The live master has 10,796 prefLabels; the
> export (and therefore our database) has 10,788. Eight concepts were added or
> renamed in Semaphore after the export was taken.

- [archive/round1-2026-08-11/](archive/round1-2026-08-11/) — 24 screenshots; deep
  dives, edge cases, relationship types, class detail. 10 checks ✅, 0 discrepancies.
- [archive/round2-2026-08-11/](archive/round2-2026-08-11/) — validation report
  JSONs + class tree. Duplicate labels exact, orphans empty, altLabels match to
  the digit; D1 found.

## 1. Fresh export from Semaphore (the one that matters)

Re-export the model the same way as last time (the full model export that
produced `InlandRevenueModel.ttl`). Save it over the old file at the repo root,
or drop it in this folder if you'd rather keep both.

Then tell Claude — re-import takes ~4 seconds and the full verification
(coverage audit + graph round-trip + these comparison counts) reruns. If the
new file has 10,796 prefLabels, D1 closes and we can also diff the two exports
to see exactly what changed in Semaphore since.

## 2. Optional: the concepts-task tree

Round 2's tree screenshots captured the **class** tree in model admin (now
verified ✅). The original §1/§2 ask was the *concepts task* tree — the left
panel where "Activities", "Parties" etc. are browsed:

- one shot collapsed (11 schemes expected)
- one per root expanded a single level (child lists in
  [archive/round1-2026-08-11/CHECKLIST.md](archive/round1-2026-08-11/CHECKLIST.md) §2)

Low priority now — the hierarchy is already indirectly verified (10,826 broader
edges, orphans report empty, deep-dive parents all correct) — but it's the last
box unticked if we want the comparison exhaustive.

## 3. After that: the editor side

Once the fresh export is imported, the same concepts get screenshotted in OUR
web part next to Semaphore's pages (USA, CAA, Company test…) — the final
"replacement shows what the master shows" evidence. Claude drives that with the
live-test workflow; you just need the dev server or the installed 0.2.1.0.
