# Semaphore comparison checklist — v0.2.0.0

Side-by-side verification of the editor against Semaphore KMM (still the master).
Every expected value below was extracted from a **pristine import** of
`InlandRevenueModel.ttl` (no edits) on 2026-08-11. Regenerate after any re-export
with `npm --prefix tools run compare` (writes `data/compare-extract.txt`).

Results live in [comparison-results/RESULTS.md](comparison-results/RESULTS.md)
— verdicts per section, discrepancy log, and the screenshots themselves (naming
convention at the top of that file).

How to record a discrepancy: note the section number, what Semaphore shows, what
the editor shows, and a screenshot of each. Every discrepancy will be one of
three things — an import decision (documented in ARCHITECTURE.md), a Semaphore
display filter, or a genuine bug. Don't try to classify while comparing; just
capture both sides.

---

## 1. Top-level tree (screenshot: Semaphore concepts tree, collapsed)

Semaphore's left tree shows the **concept schemes** (plural names — "Activities",
"Parties"); expanding each shows one top concept (singular). The editor's tree
starts at the top concepts directly. Expected: **11** schemes / top concepts.

| Top concept | Total descendants | Direct children |
|---|---|---|
| Activity | 903 | 5 |
| Authority | 1,660 | 13 |
| Classification | 1,457 | 10 |
| Event | 778 | 10 |
| Information | 1,491 | 21 |
| Location | 333 | 3 |
| Money | 497 | 7 |
| Object | 568 | 14 |
| Party | 2,077 | 6 |
| Product or service | 752 | 2 |
| Topic | 266 | 16 |

Caveat: if Semaphore shows *fewer* concepts somewhere, check its display filters
first (it can hide candidate/deprecated concepts). The editor hides nothing.

## 2. Second level (screenshot: each root expanded one level)

Compare the direct-child lists exactly — names and count. Expected lists:

- **Activity (5):** Business activity · Machinery of government · System functionality · Taxpaying activity · Third party activity
- **Authority (13):** Agreement · Certificate · Commissioner's authority · Commissioner's guidance · Crown · Financial arrangement · Judicial authority · Legislative authority · Licence, certification or permission · Model or method · Penalty · Policy · Rights
- **Classification (10):** Activity type · Authority type · Event type · Information type · Location type · Money type · Object type · Party type · Product type · Service type
- **Event (10):** Business event · Case · Life event · Natural event · Offence · Tax event · Third party event · Time · Transaction · [Previous event]
- **Information (21):** Change management information · Compliance information · Customer financial information · Customer information · Customer marketing information · Customer obligations and entitlements · Deliver customer services information · External relationship information · Generic information · IR financial information · Knowledge information · Legal information · Operational services information · People management information · Procurement information · Product information · Quality, measures, and insights information · Strategy and governance information · Tax policy information · Technology management information · [Archived information facets]
- **Location (3):** Country or territory · IR region · NZ geographic area
- **Money (7):** Currency · Debt or liability · Entitlement · Expenditure · Income · Money held · Tax, duty or levy
- **Object (14):** Animal · Books, music and manuscripts · Channel · Clothing · Consumable · Equipment · Furniture · Material · Media · Plant life · Real estate · Structure · System · Vehicle
- **Party (6):** Group · Inland Revenue · Named organisation · Organisation type · Party attribute · Party role
- **Product or service (2):** Goods · Service
- **Topic (16):** Behavioural science · Business capability · Climate change · Culture · Data science · Demographics · Economics · Employment · Ethics · Jurisprudence · Measurement · Māori Crown relations · Politics · Rate · Technology · Wellbeing

The bracketed entries (`[Previous event]`, `[Archived information facets]`) are
real concepts whose names start with `[` — expect them to sort oddly in one or
both tools.

## 3. Deep-dive concept: United States of America

Screenshot the full concept page in Semaphore (labels, relationships, notes).
Expected in the editor:

- **Class:** Country — **Parent:** Country or territory — **Children:** 0
- **Labels:** prefLabel "United States of America" (Exact phrase match);
  altLabel "United States" (Exact phrase match); altLabel "America" (no flags);
  Has-acronym "USA" (Stemming off)
- **Relationships (16 total, both directions):**
  - Is country signed to agreement → Double tax agreement · Hague Convention on the International Recovery of Child Support and Other Forms of Family Maintenance · Trans-Pacific Partnership
  - Is location of → Internal Revenue Service · Special Operations Command
  - related → Double Tax Agreements (United States of Ameria – FATCA) Order 2014 · North America
  - ← Has interest in (7): American Samoa · Guam · Northern Mariana Islands · Partner jurisdiction · Puerto Rico · Tokelau · Virgin Islands (United States)
  - ← Is country signed to agreement: Competent Authority Arrangement
  - ← related: Global Intermediary Identification Number
- **Notes:** definition (source Wikipedia), Source-of-term "ISO 3166; OCTC content", Instance = false

Semaphore renders each direction under its own relationship name (the inverse
name), so "← Has interest in: Guam" may appear on USA's page as "Is interest of"
— that's the same fact. What matters is that **every link on Semaphore's page
appears in the editor and vice versa.** Note the typo "Ameria" in the DTA order
name — expected; it's in the source data.

## 4. Deep-dive concept: Competent Authority Arrangement

- **Class:** Agreement — **Parent:** International agreement — **Children:** 0
- **Labels:** prefLabel "Competent Authority Arrangement" (Exact phrase);
  altLabel "Competent Authority Agreement" (Exact phrase); Has-acronym "CAA"
  (Case sensitive + Stemming off); NotNPT × 4: "CAYD", "CST CAA",
  "Civil Aviation Authority", "RPC" (first two carry case/stemming flags)
- **Relationships (3):** Has participating country → New Zealand · United States
  of America; Has source of rules → Foreign Account Tax Compliance Act 2010
- **Notes:** BusinessDefinition ("An arrangement to establish and prescribe
  rules…"), Source-of-term "Annual Report 2016; IR website", Instance = false

This is the same USA↔CAA link seen from both ends — stored once in the editor,
rendered twice. If Semaphore shows it on both pages and the editor on both
pages, the one-row-per-logical-link design is verified against the master.

## 5. Edge cases (one screenshot each)

**Polyhierarchy** — these concepts appear under TWO parents; check both places
in Semaphore's tree and that the editor shows both parents:
- Company test ← Associated persons test AND Test
- Depreciable intangible property ← Intangible asset AND Depreciable property
- Deregistration ← Registration management AND Taxpaying activity

**Duplicate names** — two distinct concepts each: Chinese, General Ledger,
Intelligence, Party, Property. Confirm Semaphore shows two entries too (they
differ by URI/class, not by name).

**Wildcard labels** — e.g. Briefing note has Evidence labels "BN~~~~/*",
"BN~~~~-*", "~~BN~~~*"; TCO Advising report has Has-code "ADV~~~~~IR*",
"iradv*". Confirm Semaphore displays the same raw pattern strings.

**Dual-role labels** — the same label resource attached under two roles, e.g.
Private rulings work: "PRI~~~~~*" as both Evidence and Has-code; Tax Counsel
Office: "OCTC" as both Evidence and Previously-known-as. Semaphore should show
the string under both roles.

**Concepts with no class** — the editor reports 8 (a source-data quality issue,
see ONTOLOGY-MODEL.md §11). See how Semaphore presents them.

## 6. The model relationships screen (Semaphore side)

This is the screen where relationship **types** are defined — where you would
add a new relationship type, not where you link two concepts. In KMM it lives
under the model's own menu ("Inland Revenue Model ▾"), not the concepts task.
Please capture, for as much of the list as practical:

1. **The full list of relationship types** — even partial screenshots scrolled
   through the list are enough. For each type I need to see four things:
   **name**, **inverse/reciprocal name**, **From class (domain)**, **To class
   (range)**.
2. **One type opened in detail** — pick "Has participating country". I want to
   see exactly which fields Semaphore stores on a relationship type (definition?
   comment? symmetry flags? anything unexpected).
3. **The label/attribute relation screens** if present — where Acronym,
   Has evidence, Has code etc. are defined, and where the datatype attributes
   (Business definition, Last Reviewed Date, …) are defined.
4. **The class list** — the 108 classes with their hierarchy, and one class
   opened in detail (colour, definition).

Expected on the editor side (from the pristine import):

- **141 concept-to-concept relationship types** plus `related` (SKOS built-in,
  no explicit declaration in the export — Semaphore may or may not list it).
  `related` is the single biggest type: 2,124 stored links (4,248 ends).
- **10 label-pointing types** with usage counts: Has evidence 7,093 ·
  Term in legislation 2 · Acronym 1,167 · Has code 1,759 · Has shoulder code 683
  (domain Information) · Has Māori term 515 · Abbreviation 340 · Not NPT 367 ·
  Not in NPT 163 · Previously known as 259
- **22 datatype attributes** — 17 named (Instance 10,793 · Source of term only
  9,408 · Business definition 2,160 · Source of definition 1,494 · … ) plus 5
  unnamed Smartlogic system types (DateNoteType, DecimalNoteType, NoteType,
  RegexNoteType, TextNoteType) with zero usage — expect these to be invisible
  in Semaphore's UI.
- **142 inverse pairings**; the handful of one-directional types include
  "Has related activity" (no inverse). If Semaphore's screen shows a reciprocal
  where the editor shows none (or vice versa), capture it — that's exactly the
  kind of discrepancy this exercise is for.
- Spot-check domains/ranges against the full expected table in
  `data/compare-extract.txt` (§ FULL PROPERTY TABLE), e.g.:
  - Has participating country / Is country signed to agreement — Agreement ↔ Country
  - Administers legislation / Is administered by — Party ↔ Legislative authority
  - Has interest in / Is interest of — any ↔ any
  - Has shoulder code — domain Information (the only label type with a domain)

## 7. Global counts (if Semaphore surfaces them anywhere)

| Measure | Editor (pristine import) |
|---|---|
| Concepts | 10,788 |
| Classes | 108 |
| Relationship types (concept-to-concept, declared) | 141 (+ `related`) |
| Label-pointing types | 10 |
| Datatype attributes | 22 (17 named + 5 system) |
| Inverse pairings | 142 |
| Hierarchy edges | 10,826 |
| Polyhierarchical concepts | 49 |
| Relationship link ends (both directions) | 25,214 |
| Label attachments | 26,387 |
| Notes/annotations | 30,811 |

Semaphore's own counts (if shown) may differ for legitimate reasons: display
filters, counting schemes as concepts, counting each direction separately, or
including label resources. Capture the number and where it appeared; we'll
reconcile rather than assume either side is wrong.
