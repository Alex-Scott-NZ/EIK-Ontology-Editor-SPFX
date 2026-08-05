# Audit of the legacy CSV → SQLite pipeline

**Audited:** 2026-08-05
**Subject:** `D:\Code\Work\IKM-Ontology-Admin-WebPart` — `Data/ontology.sqlite`,
its source CSVs, and `src/services/database/DatabaseService.ts`
**Reference:** `InlandRevenueModel.ttl` (this repo)

Method: parsed the full TTL, replayed the importer's logic over the CSVs in
isolation, extracted the SQLite contents, and diffed all three at GUID level
(concepts, hierarchy edges, and `source|type|target` relationship triples).

---

## Verdict

**The conversion code is correct.** Against the CSV it was actually built from,
`ontology.sqlite` is a lossless replication — **zero differences in both
directions** on all three dimensions:

| Dimension | CSV | SQLite | In CSV not DB | In DB not CSV |
|---|---|---|---|---|
| Term rows | 10,629 | 10,629 | 0 | 0 |
| Hierarchy edges | 10,594 | 10,594 | 0 | 0 |
| Relationship triples | 21,092 | 21,092 | 0 | 0 |

Also verified: 0 dangling relationship targets, 0 duplicate relationship rows,
polyhierarchy count preserved (51 both sides). The stack-based parent inference at
`DatabaseService.ts:221-231` reproduces the `skos:broader` hierarchy exactly.

The gaps below are **not** conversion bugs. They are (a) one label-splitting bug,
(b) source-data staleness, and (c) limits of what the CSV report could ever carry.

---

## Finding 1 — the DB was built from a different CSV than the one in `Data/`

`ontology.sqlite` matches `csvs/HierarchicalReportWithDetailsAndGUIDs.csv` exactly.
It does **not** match `Data/HierarchicalReportWithDetailsAndGUIDs2025_11_03.csv`
(differs by 25 + 2 concepts and ~1,600 relationship values).

The Nov-2025 CSV in `Data/` is a *newer* report than the database beside it. Anyone
reading that folder would reasonably assume they correspond. They don't.

---

## Finding 2 — multi-value labels were never split (real bug)

`DatabaseService.ts:249` splits relationship cells on `;`. The synonym insert at
`DatabaseService.ts:257-268` does not.

Result: **2,295 of 8,286 synonym rows are unsplit blobs**:

```
[HasEvidence]       "Agriculture;Horticulture"
[HasEvidence]       "Business change;Change activity;Change capability;Change control process;..."
[alternativeLabel]  "Building strengthening;Earthquake strengthening"
```

This is a large part of why the DB holds 2,374 evidence labels where the TTL holds
7,093. Any search or matching built on the synonym table silently under-performs.

Metadata cells also contain semicolons (2,279 rows), but those are mostly prose —
`"IR website; OCTC content"` — where leaving them intact is correct.

**In the new design this bug cannot recur:** labels come from the TTL as discrete
`skosxl:Label` resources, one row each, never from a delimiter-joined cell.

---

## Finding 3 — the database is a generation behind the live model

The TTL is a later snapshot and the model has moved substantially.

**Concepts:** 279 exist in the TTL but not in the DB (Academic qualification, the
Access service family, COVID-19 support, world regions…). ~45 DB concepts have since
been deleted or restructured, mostly the old PAYE / tax-type area.

**Relationship types were renamed** — so the DB's `relationship_types` names are stale:

| Legacy name | Current name in TTL |
|---|---|
| IsActivityOf | IsDoneBy |
| AdministersLegislation | AdministersAct |
| Repeals | Replaces |
| Creates | Publishes |
| HasClassID | HasRetentionClass |
| UsesModelOrMethod | UsesModel |
| IsProvidedBy | IsOfferedBySupplier |
| HasMoneyObject | HasFinancialObject |
| HasOrganisationType (+ siblings) | consolidated into HasType / IsTypeOf |

**New types exist only in the TTL:** `HasSubEvent`, `HasDate`, `HasPeriod`,
`HasAttribute`, `IsAppliedTo`, `IsValidFor`, `ResultsFrom` / `ResultsIn`,
`Regulates`, `UsesEquipment`, `Owns`.

**Existing relations grew:** `skos:related` 3,629 → 4,248; `IsInterestOf` 982 → 1,145;
`IsCountrySignedToAgreement` 85 → 171.

Net: **25,214 relationship triples in the TTL vs 21,092 in the DB.**

---

## Finding 4 — structural information the CSV report never carried

These were never in the CSV, so no importer could have recovered them.

### 4.1 Real concept classes
The TTL types every concept against one of 108 classes (`IRForm`,
`Tax-payer-activity`, `RDS`, …) which have their own `subClassOf` tree. The CSV
exported no `rdf:type` at all. The legacy `class_id` column holds only the level-0
root label ("Activities", "Parties") — far coarser.

### 4.2 The property model
`rdfs:domain`, `rdfs:range` and `owl:inverseOf` for all 151 properties. The legacy
`relationship_constraints` table (633 rows) was *inferred empirically from the data*
as `(rootClass, startLevel)` pairs.

**That inference was a sound reading of the only signal available** — and it worked
because class membership correlates with tree depth. Verified: of 239
`IsIRFormRelatedTo` sources, 236 are typed `IRForm`, and all sit at depths 4–7
because IR forms happen to live under "Tax-related form".

But depth is a shadow of class, not a substitute:

- Classes span many depths — `IR-core-function` 2–8, `Information` 1–6, `Property` 1–8 —
  so a depth rule both over-permits (right depth, wrong class) and under-permits
  (valid concept placed shallower).
- 33 properties have `range = skos:Concept`; `HasSourceOfRules` sources span 60+
  classes and depths 2–8. Depth rules were never going to converge for those.
- It breaks silently on restructure: move a branch up one level in Semaphore and
  every depth constraint is wrong, while the class rule is untouched.

The TTL supplies the declared rules, so the new design stops inferring.

### 4.3 URIs
The legacy schema stores only `original_guid`. The TTL identifies everything by URI
across five namespaces, and a GUID cannot reconstruct one. **Without URIs, faithful
Turtle export is impossible** — this alone forces a schema change.

### 4.4 Label matching behaviour and concept schemes
Per-label case-sensitivity / stemming / rulebase flags, and the 11 concept schemes,
are absent from the report.

---

## Finding 5 — polyhierarchy is stored as duplicate rows

51 concepts have multiple parents. A single `parent_id` column cannot express that,
so the report duplicated the concept and the importer faithfully created **73
duplicate-GUID rows** — the same concept existing as two `terms.id` values.

Consequences: relationships attach to only one of the copies; edits to one copy
don't affect the other; counting concepts requires `DISTINCT`. The new schema uses a
separate `broader` edge table so a concept is stored exactly once.

---

## Carried forward into the new design

| Legacy decision | Verdict |
|---|---|
| Key on `original_guid` | **Keep** — correct call; add `uri` alongside |
| Normalised type tables (`relationship_types`, etc.) | **Keep** — mirrors how RDF defines properties once |
| Stack-based parent inference from depth | **Drop** — read `skos:broader` directly |
| `relationship_constraints` inferred from data | **Drop** — read `domain`/`range`/`inverseOf` |
| `parent_id` column | **Drop** — replace with `broader` edge table (polyhierarchy) |
| Splitting `;` cells | **Obsolete** — labels arrive discrete from the TTL |
| sql.js + IndexedDB caching | **Keep** — proven, fast |

Full design rationale: [ARCHITECTURE.md](ARCHITECTURE.md).
