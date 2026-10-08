# Regression tests

Run these before every release. The automated tests take about 15 seconds; the
browser checks about 10 minutes.

When a bug is fixed, add a test here that fails without the fix. If it can be
automated, add it to `tools/regress.ts` as well, so this list and the runner
stay in step.

## Automated

One-time setup on a new machine (from the repo root):

```bash
npm --prefix tools install
```

Then, every time:

```bash
npm run regress
```

It runs each test below in order, carries on after a failure so one run shows
everything that is broken, prints a PASS/FAIL summary, and exits non-zero if
anything failed. Each test can also be run on its own with
`npm --prefix tools run <name>`.

| Test | What it protects |
|---|---|
| `import:default` | The full IR ontology (`InlandRevenueModel.ttl`) imports, matches the reference counts and passes the integrity checks. Writes `data/ontology.sqlite`, which `verify` and `export` read. |
| `smoke` | Building an ontology from scratch through the write layer: classes, relationship types, concepts, hierarchy, domain/range enforcement, labels, metadata, guarded deletes, journalling, then Turtle export and re-parse. |
| `fk` | Deleting concepts **after a save** still removes their labels, notes, relationships and hierarchy edges; and "Remove leftovers" repairs a file already damaged, is journalled, and can be undone. Added in 0.6.12.23. See below. |
| `verify` | The queries the web part runs return the right answers, including the inverse derivation and polyhierarchy. |
| `audit` | 100% of the Semaphore export's statements are accounted for by the importer. |
| `export` | The imported database exports to Turtle (feeds `roundtrip`). |
| `roundtrip` | Turtle in, database, Turtle out: nothing lost, nothing invented. |

### Why `fk` exists

sql.js's `Database.export()` closes the SQLite connection and reopens it, and
`PRAGMA foreign_keys` is per connection and off by default. Before 0.6.12.23
every Save and Publish therefore switched off every `ON DELETE CASCADE` until
the file was next opened. Save, delete a parent, delete its child, and the
hierarchy edge between them survived with both ends missing, which blocked
every later publish with nothing the author could select to fix.

No earlier test caught it because none deleted a concept after an export. `fk`
runs exactly that sequence against the old export (to show the test can see the
damage) and the new one (to show it no longer happens). With the fix removed it
fails three checks.

## Browser checks (manual)

On the dev tenant, page
`https://5pbdxb.sharepoint.com/sites/dpex-testing/SitePages/Ontology-Editor---2.aspx`,
library folder `/sites/dpex-testing/Shared Documents/Ontology`. Load the
version being released (check the version in the app catalog, or run from the
dev server per `docs/LIVE-TESTING.md`).

1. **Delete after save.** Open any small ontology. Create a concept with a child
   under it. Save. Delete the child's parent, then the child. Publish. Expect:
   no problems reported, publish succeeds.
2. **Damaged file can be repaired.** Build a fresh damaged file with
   `npm --prefix tools run fixture:damaged` (writes `data/BothEndsMissing.sqlite`),
   upload it to the library folder and open it. A copy used in an earlier run is
   no longer damaged: publishing repairs and re-saves it. Publish. Expect: "A hierarchy edge survives with both
   ends missing", and a **Remove leftovers** row saying how many entries
   belong only to deleted concepts. Click it. Expect: the problem list clears,
   "unsaved changes" appears. Publish. Expect: success.
3. **Remove leftovers can be undone.** Repeat check 2 up to Remove leftovers,
   close the dialog, click **Undo**, Publish again. Expect: the problem is back.
4. **Problems with a surviving end.** Open `IntegrityDemo.sqlite` and Publish.
   Expect: each problem names the concept that survived, with **Go to**; Go to
   selects and reveals that concept. **Copy details** puts a text report on the
   clipboard.
5. **Master folder guard.** With any master open, set the publish target to a
   file in the master folder. Expect: publish is refused with an explanation.
6. **Published copy is readable.** After a successful publish, open the viewer
   page pointed at the published file and check the concepts appear.

For a wider hands-on pass of the Model tab and building an ontology from
scratch, use `comparison/TEST-SCRIPT.md`.
