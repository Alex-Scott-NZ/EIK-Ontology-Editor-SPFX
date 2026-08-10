# Inland Revenue Model — TTL ➜ Semaphore UI ➜ SQLite mapping

This document maps every content-level construct in `InlandRevenueModel.ttl` to (a) where it
appears in the Semaphore KMM UI (v5.10.0, evidenced by the files in [`/screenshots`](../screenshots)),
and (b) a proposed embedded-SQLite schema for the SPFX ontology editor.

> **Key fact:** `InlandRevenueModel_shaclgraph.ttl` is empty (prefixes only — no shapes).
> The only machine-readable schema is the set of OWL property/class definitions inside the
> main TTL. Everything below was extracted from those definitions plus verification against
> the UI screenshots. **`rdfs:label` on a property definition is exactly the display name the
> UI shows** — never derive display names from URI fragments (they frequently disagree, e.g.
> `DisposalTrigger` displays as "Minimum retention period", `Is-replaced-by` displays as
> "Is repealed by").

---

## 1. Model at a glance

| Thing | Count | Notes |
|---|---|---|
| Concepts | ~10,800 | every concept has a unique `sem:guid` (UUID) |
| SKOS-XL labels | ~26,400 | labels are first-class resources, not strings |
| `skos:broader` links | ~10,800 | the tree hierarchy |
| `skos:related` links (incl. sub-properties) | ~10,000+ | 145 typed relationship properties, almost all in inverse pairs |
| Property definitions | 173 | object + datatype, each with UI label / domain / range / inverse |
| Classes | 108 | single-inheritance tree rooted at `skos:Concept` |
| Concept schemes | 11 | Activities, Authority, Classification, Events, Information, Locations, Money, Objects, Parties, Products and services, Topics |

Namespaces holding content (everything else is Semaphore system machinery):
`http://example.com/InlandRevenueModel#`, `…/InlandRevenueModel-current-#`,
`…/Cleaned-Inland-Revenue-model#`, `…/NZ-IRD#`, `…/IRD-test-model#`,
`http://smartlogic.com/class#`, `http://smartlogic.com/relationship#`,
`http://smartlogic.com/term#` (opaque auto-minted concept IDs), `http://smartlogic.com/conceptScheme#`.

---

## 2. The concept page — UI sections and their TTL sources

Layout confirmed by `2_IncomeTaxAct1994_1.png`, `TaxReturn_Detail.png`, `AISA_Agreement_Details_1.png`:

| UI section | TTL source | Notes |
|---|---|---|
| Title | `skosxl:prefLabel` ➜ `skosxl:literalForm` | brackets `[...]` around the literal = superseded/hidden term convention |
| Concept Class chip | `rdf:type` ➜ class definition's `rdfs:label` | chip colour from class `sem:color` (see §6) |
| Preferred Labels | `skosxl:prefLabel` | one per language |
| Alternative Labels | `skosxl:altLabel` **and every sub-property of it** | typed entries render as "Acronym ›", "Has code ›", "Has Māori term ›" etc. (§4) |
| Metadata | datatype properties + SKOS notes (§3) | fields appear only when populated, or always if `sem:AlwaysVisibleProperty` |
| Instance toggle | `InlandRevenueModel#Instance` (`xsd:boolean`) | |
| Top Concept Of | `skos:topConceptOf` / scheme `skos:hasTopConcept` | |
| Related Concepts | `skos:related` + all 145 sub-properties (§5) | each row shows the property's UI label; paginated ~13/page |
| Broader / Narrower Concepts | `skos:broader` (narrower is its inverse view) | |
| Mappings | Semaphore mapping relationships | **model contains none** — "0" everywhere is correct |
| History tab | Semaphore audit graph (not in the TTL export) | `10 TaxReturnHistory.png` — full audit incl. TTL import event |
| Visualizer | same data, graph view | edge labels = property UI labels; node colours = class colours |

The **Filter Details** dropdown (`12 Filter Details Expanded.png`) is the authoritative list of
metadata sections the UI can render: comment, Action_Period, Business definition, definition,
editorial note, history note, Instance, Last Reviewed Date, Legal definition, Minimum retention
period, note, Owner, RDS note, scope note, Source of business definition, Source of definition,
Source of legal definition, Source of term only, used as IR Topic, used in ME2 value set,
used in ME3 value set, Used in Semantics.

---

## 3. Metadata fields (datatype properties + notes)

All render inside the **Metadata** column of the Details page.

| TTL predicate | UI label | Datatype | Domain | Evidence |
|---|---|---|---|---|
| `skos:definition` | definition | string@lang | any | `5 Banglasdesh_Country_Details.png` |
| `InlandRevenueModel-current-#BusinessDefinition` | Business definition | string@lang (may contain HTML) | any | `TaxReturn_Detail.png` — a concept can have **both** definition and Business definition (`AISA_Agreement_Details_2.png`) |
| `Cleaned-Inland-Revenue-model#LegalDefinition` | Legal definition | string@lang | any | Filter Details list |
| `InlandRevenueModel#SourceOfDefinition0` | Source of definition | string@lang | any | `AISA_Agreement_Details_2.png` |
| `InlandRevenueModel#SourceOfDefinition` | Source of business definition | string@lang | any | Filter Details list ⚠ URI says "SourceOfDefinition", label says *business* |
| `InlandRevenueModel#SourceOfLegalDefinition` | Source of legal definition | string@lang | any | Filter Details list |
| `NZ-IRD#Source-of-term` | Source of term only | string@lang (may contain HTML) | any | always visible; nearly every concept has it |
| `skos:historyNote` | history note | string@lang | any | `2_IncomeTaxAct1994_1.png` |
| `skos:editorialNote` | editorial note | string@lang | any | `Notes_EditorialNote_Author.png` |
| `skos:scopeNote` | scope note | string@lang | any | `Notes_ScopeNotes_DigitalSourceRecords.png` |
| `skos:note` | note | string@lang | any | Filter Details list |
| `rdfs:comment` | comment | string@lang | any | Filter Details list |
| `InlandRevenueModel#Instance` | Instance | boolean | any | toggle; `true` on `2_IncomeTaxAct1994_1.png` |
| `InlandRevenueModel#LastReviewedDate` | Last Reviewed Date | date | any | `6 AdjustedTaxableIncome_Details.png` |
| `InlandRevenueModel#UsedInSemantics` | Used in Semantics | boolean | any | toggle |
| `InlandRevenueModel#usedAsIRTopic` | used as IR Topic | boolean | any | toggle, `7 AdminSupportServices.png` |
| `InlandRevenueModel#usedInInME2ValueSet` | used in ME2 value set | boolean | any | Filter Details list |
| `InlandRevenueModel#usedInME3ValueSet` | used in ME3 value set | boolean | any | Filter Details list |
| `InlandRevenueModel-current-#Owner` | Owner | string | any | Filter Details list |
| `InlandRevenueModel#Action_Period` | Action_Period | string@lang | RDS only | always visible; raw underscore name is the real label |
| `InlandRevenueModel#DisposalTrigger` | **Minimum retention period** | string@lang | RDS only | always visible; ⚠ URI ≠ label |
| `InlandRevenueModel#RDSNote` | RDS note | string@lang (may contain HTML) | RDS only | always visible |

⚠ Several string fields contain embedded HTML (`BusinessDefinition`, `Source-of-term`,
`historyNote`, `RDSNote`). The editor must sanitise/render HTML, not treat them as plain text.

---

## 4. Labels (SKOS-XL) and label relations

Labels are resources: `<labelUri> rdf:type skosxl:Label ; skosxl:literalForm "text"@lang`.
Label URIs are conventionally `<conceptUri>/<LabelText>_<lang>` but must be treated as opaque.

**Concept ➜ label properties** (all `rdfs:subPropertyOf skosxl:altLabel` except prefLabel;
UI renders them inside "Alternative Labels" prefixed with their display name):

| TTL predicate | UI label | Inverse (label ➜ concept) | Evidence |
|---|---|---|---|
| `skosxl:prefLabel` | Preferred Labels | — | everywhere |
| `skosxl:altLabel` | alternative label | — | `AISA_Agreement_Details_1.png` |
| `Cleaned-Inland-Revenue-model#Abbreviation` | Abbreviation | — | `2_IncomeTaxAct1994_1.png` ("ITA 1994") |
| `IRD-test-model#Has-acronym` | Acronym | — | `AISA_Agreement_Details_1.png` ("AISA") |
| `Cleaned-Inland-Revenue-model#Maori` | Has Māori term | — | AISA, Tax return |
| `NZ-IRD#Evidence` | Has evidence | — | GDA6, Income Tax Act |
| `smartlogic.com/relationship#Has-code_14_None_None` | Has code | `Is-code-of_14_None_None` "Is code of" | Bangladesh "BD"/"BGD", ANZSIC codes |
| `smartlogic.com/relationship#Previously-known-as_4_None_None` | Previously known as | `Now-known-as_4_None_None` "Now known as" | Bangladesh "East Pakistan" |
| `InlandRevenueModel#HasShoulderCode` | Has shoulder code | — | Information concepts (IR forms) |
| `InlandRevenueModel#NotInNPT` / `#NotNPT` | Not in NPT / Not NPT | — | tagging suppression lists |
| `InlandRevenueModel-current-#TermInLegislation` | Term in legislation | — | rare (2 uses) |
| `smartlogic.com/noteType#Source_npt` | Source (note **on a label**) | — | label-level text note |

**Label-level settings** (Edit Label Settings dialog, `9 Bangladesh_Label_BD_Popup.png`):

| TTL predicate (on the label) | UI field | Values seen |
|---|---|---|
| `sem:caseSensitivity` | Case sensitivity | `sem:CaseSensitive` ⇒ On (absent ⇒ Default) |
| `sem:stemming` | Stemming | `sem:StemmingOff` ⇒ Off |
| `sem:rulebaseAction` | Rulebase action | `sem:RulebaseActionDoNotGenerate` |
| `sem:rulebaseBehaviour` | Behaviour in rulebase | `sem:RulebaseBehaviourExactPhrase` |
| `sem:rulebaseInfluence` | Influence in rulebase | `sem:RulebaseInfluenceNone` |
| `sem:conceptMapping` | Use for concept mapping | `sem:ConceptMappingOff` |
| `sem:autocompletion` | (advanced) | `sem:AutocompletionOff` |

The UI shows little icons next to a label (U = case sensitive, ⚠ = rulebase action, puzzle
piece = behaviour, etc.) — all derived from these settings.

---

## 5. Concept ➜ concept relationships

`skos:broader` drives the tree; everything else is `rdfs:subPropertyOf skos:related` and
renders under **Related Concepts** with the property's UI label (and as edge labels in the
Visualizer). Almost every property has an `owl:inverseOf` partner — **Semaphore maintains both
directions**, so the editor/DB must too.

Full catalogue of inverse pairs (UI labels; `domain ➜ range` in class UI names, "any" = `skos:Concept`):

| Forward (UI label) | Inverse (UI label) | Domain ➜ Range |
|---|---|---|
| Has classification | Is classification of | any ➜ Classification |
| Has class ID | Is class ID of | any ➜ RDS |
| Has possible class ID | Is possible class ID Of | any ➜ RDS |
| Has example | Is example of | RDS ➜ any |
| Has related information | Is information related to | any ➜ Information |
| Has activity-related information | Is used in activity | Activity ➜ Information |
| Generates information | Is used in event | Event ➜ Information |
| Has information classification | Is information classification of | Information ➜ Information classification |
| Has metadata | Is metadata of | Information ➜ Metadata |
| has metadata value set | is metadata value set for | Metadata ➜ Metadata value |
| Is created by | Creates | Information ➜ Party |
| Is information used by | Uses information | Information ➜ Party |
| Has related IR form | Is IR form related to | any ➜ IR form |
| Has ANZSIC code | Is ANZSIC code of | any ➜ ANZSIC classification |
| Repeals | Is repealed by | Legislative authority ➜ Legislative authority |
| Amends legislation | Is amended by | Legislative authority ➜ Legislative authority |
| Administers legislation | Is administered by | Party ➜ Legislative authority |
| Provides legal definition of | Is legally defined by | Authority ➜ Legally defined term |
| Is documented as | Is document form of | Authority ➜ Information |
| Produces authority | Is authority produced by | Party ➜ Authority |
| Has authority subject | Is authority subject of | Activity ➜ Authority |
| Has outcome | Is outcome of | Activity ➜ Authority |
| Has source of rules | Is source of rules for | any ➜ Authority |
| Has penalty | Is penalty for | Activity ➜ Penalty |
| Has agreement party | Is party to agreement | Agreement ➜ Party |
| Has participating country | Is country signed to agreement | Agreement ➜ Country |
| Has participant | Is participant in | Event ➜ any |
| Has event | Is event involved in | Activity ➜ Event |
| Has related event | Is event related to | any ➜ Event |
| Involves activity | Is involved in | Event ➜ Activity |
| Involves object | Is involved in event | Event ➜ Object |
| Has related activity | *(no inverse)* | Activity ➜ Activity |
| Does activity | Is activity of | Party ➜ Activity |
| Has obligation to | Is obligation for | any ➜ Activity |
| Supports activity | Is supported by system | System ➜ Activity |
| Uses system | Is system used by | Party ➜ System |
| Has system type | Is system type of | System ➜ System type |
| Is built on product | Is product used for | System ➜ Product |
| Uses service | Is used by | any ➜ Service |
| Makes use of service | Is service used in activity | Activity ➜ Service |
| Provides | Is provided by | Party ➜ any |
| Has focus on | Is focus of | Product or service ➜ any |
| Has IR product instance | Belongs to IR product group | IR product grouping ➜ Money |
| Has money object | Is money object of | Activity ➜ Money |
| Receives income | Is income of | Party ➜ Income |
| Makes payment | Is payment made by | Party ➜ Expenditure |
| Is entitled to | Is entitlement of | Party ➜ Entitlement |
| Has attribute | Is attribute of | any ➜ Party attribute |
| Has member | Is member of | Party ➜ Party |
| Has role | Is role of | Party ➜ Role |
| Has related role | Is role related to | any ➜ Party role |
| Has organisation type | Is organisation type of | Party ➜ Organisation type |
| Has party type | Is party type of | Party ➜ Party classification |
| Has party subject | Is party subject of | Activity ➜ Party |
| Has business type | Is business type of | Named organisation ➜ Business type |
| Has group type | Is group type of | IR group ➜ Group |
| Manages | Is managed by | Party ➜ any |
| Regulates | Is regulated by | Party ➜ any |
| Owns | Is owned by | any ➜ any |
| Has interest in | Is interest of | any ➜ any |
| Is applied to | Is valid for | any ➜ any |
| Results from | Results in | any ➜ any |
| Has date | Is date of | any ➜ Time |
| Has period | Is period of | any ➜ Time |
| Has location | Is location of | any ➜ Location |
| Has site | Is site of | Object ➜ Location |
| Has measure | Is measure used in | any ➜ Measurement |
| Uses model or method | Is model or method used in | any ➜ Model or method |
| Uses object | Is object involved in activity | Activity ➜ Object |
| Is displayed under | has lower level term | any ➜ any (browse-order hierarchy, separate from `skos:broader`) |

---

## 6. Classes (concept classes)

108 classes, single inheritance rooted at `skos:Concept`. `rdfs:label` is the chip text;
`sem:color` (hex, only on some roots) drives chip/visualizer node colour.

Root classes and colours:

| Class | UI label | Colour |
|---|---|---|
| `class#Function` | **Activity** | `cf7bd9` |
| `class#Authority` | Authority | — |
| `class#Classification` | Classification | — |
| `class#Event` | Event | `71c4f4` |
| `class#Information` | Information | `f6f97b` |
| `class#Place` | **Location** | `84e65e` |
| `class#Money` | Money | `e27238` |
| `class#Property` | **Object** | `f8db0c` |
| `class#Party` | Party | `f52718` |
| `class#Topic` | Topic | `7d0ef7` |
| `-current-#ProductOrService` | Product or service | `3535f1` |
| `NZ-IRD#Legally-defined-term` | Legally defined term | `f2ddfa` |

⚠ More URI ≠ label traps: `class#Function` = "Activity", `class#Property` = "Object",
`class#Place` = "Location", `class#Law` = "Legislative authority", `class#Payment` = "Expenditure",
`class#Obligation` = "Tax or duty", `class#Rules` = "Tax regime", `class#Taxpayer` = "Organisation type",
`class#Commercial-organisation` = "Named organisation", `class#Method` = "Model or method",
`NZ-IRD#Profession` = "Occupation", `Cleaned…#PersonType` = "Party role",
`-current-#PersonType` = "Worker type", `-current-#ANOClass` = "DO NOT USE".

## 7. Concept schemes

11 schemes (`skos:ConceptScheme`, each with `rdfs:label`, `sem:guid`, `skos:hasTopConcept`):
Activities, Authority, Classification, Events, Information, Locations, Money, Objects,
Parties, Products and services, Topics. These are the accordion headers in the left tree
(`Tree View.png`) and have their own details page (`11 Scheme_TopConcept.png`).

## 8. Gotchas the editor must handle

1. **Display names come from `rdfs:label`**, never from URI fragments (see ⚠ items above).
2. **Bracketed pref labels** `[...]` = superseded/hidden concepts; excluded from normal search
   (why "[Income Tax Act 1994]" wasn't findable by title search).
3. **Inverse pairs are materialised both ways** in the data; edits must write/delete both.
4. **HTML inside literals** in several metadata fields and even some `Source-of-term` values.
5. **`smartlogic.com/term#…` opaque URIs**: many concepts (auto-created ones) have no
   human-readable URI; `sem:guid` is the only reliable stable identity.
6. **Multiple values per field** are common (two "Has code" labels, two "Has Māori term"
   labels, 10 "Is amended by" targets…). Everything is effectively multi-valued.
7. **Domain/range are advisory** — the data mostly conforms but is not SHACL-validated
   (SHACL file is empty). Validate softly (warnings), don't hard-reject.
8. **Language tags**: model is `en`-only today, but the schema carries `@en` everywhere and
   the UI has a language switcher — keep `lang` columns.
9. `Is displayed under` / `has lower level term` is a **second, display-oriented hierarchy**
   independent of `skos:broader`.

---

## 9. SQLite schema — SUPERSEDED, see `tools/schema.sql`

> **⚠ This section is a pre-implementation draft, kept only for the UI-driven rationale.**
> The implemented schema is [`tools/schema.sql`](../tools/schema.sql), with design decisions in
> [ARCHITECTURE.md](ARCHITECTURE.md). It differs deliberately from the draft below — most
> importantly **Decision 3**: relationships are stored **once** per logical link and the inverse
> direction is *derived* by `v_concept_links` (this draft's mirror-triggers approach would allow
> the same drift already present in the source TTL, e.g. `HasInterestIn` 985 vs `IsInterestOf` 982).
>
> How this doc's draft concepts map onto the real schema:
>
> | Draft table (below) | Implemented as |
> |---|---|
> | `property_def` | `properties` (+ `flags_json` for unmodelled predicates) |
> | `class_def` | `classes` (+ `flags_json`, colours land there) |
> | `concept` / `label` / `label_setting` | `concepts` / `labels` (settings in `labels.flags_json`) |
> | `metadata_value` | `annotations` |
> | `relation` + mirror triggers | `relationships` + `v_concept_links` view (Decision 3) |
> | `extra_triple` | `passthrough_triples` (Decision 2 — 100% triple coverage, `npm --prefix tools run audit`) |
> | `change_log` | `changes` |
>
> Sections 1–8 of this document (UI mapping, display-name catalogue, gotchas) remain current
> and are complementary to [ONTOLOGY-MODEL.md](ONTOLOGY-MODEL.md).

Original draft rationale: `sem:guid` is the durable key for sync; URIs kept for round-tripping;
the 173 property definitions become a **reference table** so the editor UI and validation are
data-driven (add a property → no schema change); inverse maintenance and one-pref-label-per-language
are enforced by the engine.

```sql
PRAGMA foreign_keys = ON;

-- ===== reference (loaded from the TTL property/class/scheme definitions) =====

CREATE TABLE class_def (
  uri        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,                 -- UI display name (rdfs:label)
  parent_uri TEXT REFERENCES class_def(uri),
  color      TEXT                            -- hex, nullable; inherit from ancestor at render time
);

CREATE TABLE property_def (
  uri            TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('relation','label_relation','metadata','hierarchy')),
  label          TEXT NOT NULL,             -- UI display name (rdfs:label)
  domain_uri     TEXT REFERENCES class_def(uri),  -- NULL = any concept
  range_uri      TEXT REFERENCES class_def(uri),  -- relations only; NULL = any
  datatype       TEXT CHECK (datatype IN ('string','html','boolean','date')), -- metadata only
  inverse_uri    TEXT REFERENCES property_def(uri),
  always_visible INTEGER NOT NULL DEFAULT 0 CHECK (always_visible IN (0,1))
);

CREATE TABLE scheme (
  uri   TEXT PRIMARY KEY,
  guid  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

-- ===== core data =====

CREATE TABLE concept (
  uri         TEXT PRIMARY KEY,
  guid        TEXT NOT NULL UNIQUE,          -- sem:guid — the sync key
  class_uri   TEXT NOT NULL REFERENCES class_def(uri),
  is_instance INTEGER NOT NULL DEFAULT 0 CHECK (is_instance IN (0,1)),
  -- derived: pref label starts with '[' => superseded/hidden
  is_hidden   INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1))
);

CREATE TABLE label (
  uri          TEXT PRIMARY KEY,
  concept_uri  TEXT NOT NULL REFERENCES concept(uri) ON DELETE CASCADE,
  literal_form TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'en',
  role         TEXT NOT NULL DEFAULT 'alt' CHECK (role IN ('pref','alt')),
  -- which alt-label sub-property: Acronym, Has code, Has Māori term, … NULL = plain altLabel
  relation_uri TEXT REFERENCES property_def(uri)
);
-- exactly one preferred label per concept per language
CREATE UNIQUE INDEX ux_label_pref ON label(concept_uri, lang) WHERE role = 'pref';
CREATE INDEX ix_label_concept ON label(concept_uri);

CREATE TABLE label_setting (               -- Edit Label Settings dialog; row optional
  label_uri          TEXT PRIMARY KEY REFERENCES label(uri) ON DELETE CASCADE,
  case_sensitivity   TEXT CHECK (case_sensitivity  IN ('on','off','default')) DEFAULT 'default',
  stemming           TEXT CHECK (stemming          IN ('on','off','default')) DEFAULT 'default',
  rulebase_action    TEXT,                 -- e.g. 'DoNotGenerate', NULL = default
  rulebase_behaviour TEXT,                 -- e.g. 'ExactPhrase',   NULL = default
  rulebase_influence TEXT,
  concept_mapping    TEXT CHECK (concept_mapping   IN ('on','off','default')) DEFAULT 'default',
  autocompletion     TEXT CHECK (autocompletion    IN ('on','off','default')) DEFAULT 'default'
);

-- skos:broader (the tree). A concept may have multiple broaders (poly-hierarchy).
CREATE TABLE broader (
  concept_uri TEXT NOT NULL REFERENCES concept(uri) ON DELETE CASCADE,
  broader_uri TEXT NOT NULL REFERENCES concept(uri) ON DELETE CASCADE,
  PRIMARY KEY (concept_uri, broader_uri),
  CHECK (concept_uri <> broader_uri)
);
CREATE INDEX ix_broader_parent ON broader(broader_uri);

-- typed concept↔concept relations (skos:related and all its sub-properties)
CREATE TABLE relation (
  subject_uri  TEXT NOT NULL REFERENCES concept(uri)      ON DELETE CASCADE,
  property_uri TEXT NOT NULL REFERENCES property_def(uri),
  object_uri   TEXT NOT NULL REFERENCES concept(uri)      ON DELETE CASCADE,
  PRIMARY KEY (subject_uri, property_uri, object_uri)
);
CREATE INDEX ix_relation_object ON relation(object_uri, property_uri);

-- metadata values (multi-valued, language-tagged)
CREATE TABLE metadata_value (
  concept_uri  TEXT NOT NULL REFERENCES concept(uri)      ON DELETE CASCADE,
  property_uri TEXT NOT NULL REFERENCES property_def(uri),
  value        TEXT NOT NULL,              -- booleans '0'/'1', dates ISO-8601
  lang         TEXT NOT NULL DEFAULT 'en',
  PRIMARY KEY (concept_uri, property_uri, lang, value)
);

CREATE TABLE scheme_top_concept (
  scheme_uri  TEXT NOT NULL REFERENCES scheme(uri)  ON DELETE CASCADE,
  concept_uri TEXT NOT NULL REFERENCES concept(uri) ON DELETE CASCADE,
  PRIMARY KEY (scheme_uri, concept_uri)
);

-- ===== engine-enforced invariants =====

-- keep inverse pairs materialised both ways (mirrors Semaphore behaviour)
CREATE TRIGGER trg_relation_mirror_ins AFTER INSERT ON relation
WHEN (SELECT inverse_uri FROM property_def WHERE uri = NEW.property_uri) IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO relation (subject_uri, property_uri, object_uri)
  VALUES (NEW.object_uri,
          (SELECT inverse_uri FROM property_def WHERE uri = NEW.property_uri),
          NEW.subject_uri);
END;

CREATE TRIGGER trg_relation_mirror_del AFTER DELETE ON relation
WHEN (SELECT inverse_uri FROM property_def WHERE uri = OLD.property_uri) IS NOT NULL
BEGIN
  DELETE FROM relation
  WHERE subject_uri = OLD.object_uri
    AND property_uri = (SELECT inverse_uri FROM property_def WHERE uri = OLD.property_uri)
    AND object_uri = OLD.subject_uri;
END;

-- ===== soft validation (report, don't reject — SHACL file is empty, data is advisory) =====

CREATE VIEW v_domain_violations AS
SELECT r.subject_uri, r.property_uri, pd.domain_uri AS expected_class, c.class_uri AS actual_class
FROM relation r
JOIN property_def pd ON pd.uri = r.property_uri
JOIN concept c       ON c.uri = r.subject_uri
WHERE pd.domain_uri IS NOT NULL
  AND c.class_uri <> pd.domain_uri
  AND NOT EXISTS (              -- allow subclasses via recursive class walk
    WITH RECURSIVE up(u) AS (
      SELECT c.class_uri
      UNION ALL
      SELECT cd.parent_uri FROM class_def cd JOIN up ON cd.uri = up.u WHERE cd.parent_uri IS NOT NULL
    ) SELECT 1 FROM up WHERE u = pd.domain_uri);

-- ===== search (mirrors the UI search/list view) =====

CREATE VIRTUAL TABLE label_fts USING fts5(
  literal_form, content='label', content_rowid='rowid'
);
CREATE TRIGGER trg_label_fts_ins AFTER INSERT ON label BEGIN
  INSERT INTO label_fts(rowid, literal_form) VALUES (NEW.rowid, NEW.literal_form);
END;
CREATE TRIGGER trg_label_fts_del AFTER DELETE ON label BEGIN
  INSERT INTO label_fts(label_fts, rowid, literal_form) VALUES ('delete', OLD.rowid, OLD.literal_form);
END;
CREATE TRIGGER trg_label_fts_upd AFTER UPDATE OF literal_form ON label BEGIN
  INSERT INTO label_fts(label_fts, rowid, literal_form) VALUES ('delete', OLD.rowid, OLD.literal_form);
  INSERT INTO label_fts(rowid, literal_form) VALUES (NEW.rowid, NEW.literal_form);
END;

-- ===== change tracking (mirrors the History tab; base of the sync story) =====

CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  author      TEXT,
  subject_uri TEXT NOT NULL,               -- concept or label URI
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  detail      TEXT                          -- JSON: {property, old, new}
);
```

### Loading & sync notes

- **Load order:** `class_def` ➜ `property_def` ➜ `scheme` ➜ `concept` ➜ `label`(+settings)
  ➜ `broader` ➜ `relation` ➜ `metadata_value` ➜ `scheme_top_concept`. Disable the mirror
  triggers during bulk import (the TTL already contains both directions); re-enable for editing.
- **Sync key:** match on `guid`, never URI — Semaphore mints opaque `term#…` URIs and URIs
  can drift from labels (`IncomeTaxAct1997` is labelled "Income Tax Act 1994").
- **Round-trip:** treat the SQLite DB as a working copy; export/diff back to TTL (or the
  Semaphore API) using `change_log` as the outbound delta, mirroring the History-tab
  semantics ("New relationship X added to Y", "Metadata true of type Instance updated").
- The `hierarchy` kind in `property_def` is for `skos:broader` and `IsDisplayedUnder`/
  `hasLowerLevelTerm` if you prefer to keep the display hierarchy in `relation` — either
  works; just be consistent.
