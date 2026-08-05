# How the Inland Revenue model is represented

Everything here was verified against `InlandRevenueModel.ttl` (21 MB, 312,065 lines),
the Smartlogic Semaphore export that is the source of truth for this project.

---

## 1. The format in one paragraph

The file is **Turtle**, a syntax for **RDF** (Resource Description Framework — the
W3C standard for describing data). RDF's single idea: all information is written as
three-part statements called **triples** — `subject → predicate → object`
("this thing → has this relationship → that thing or value"). Every thing and every
relationship is named by a URI. Layered on top of raw RDF are three vocabularies,
all present in this file:

| Layer | Adds | Used here for |
|---|---|---|
| RDFS | `subClassOf`, `domain`, `range`, `label` | the class tree, relationship rules |
| OWL | `Class`, `ObjectProperty`, `inverseOf` | class + relationship definitions |
| SKOS / SKOS-XL | `broader`, `related`, `definition`, `Label` | the taxonomy tree, labels |

Plus a vendor layer (`sem:`, `teamwork:`, `urn:x-evn-*`) holding Semaphore's own
bookkeeping: GUIDs, text-matching flags, model header.

---

## 2. The three kinds of block in the file

Read any 30-line chunk of the TTL and it will be one of these three shapes.

### (a) A concept block — a bag of arrows leaving one thing

```turtle
#CompetentAuthorityArrangement
    rdf:type                  class#Agreement ;              # what kind of thing it is
    Has-source-of-rules       #ForeignAccountTaxComplianceAct ;
    HasParticipatingCountry   #UnitedStatesOfAmerica ,
                              term#84951202648... ;          # comma = another target, same relationship
    BusinessDefinition        "An arrangement to ... implement FATCA."@en ;
    sem:guid                  "57e61eac-7f59-417b-9dd1-418777f5b487" ;
    skos:broader              term#198788318597... ;         # its PARENT in the tree
    skosxl:prefLabel          .../CompetentAuthorityArrangement_en .
```

Each line is one arrow leaving the concept. `;` separates predicates, `,` adds
another object to the same predicate, `.` ends the block.

There are **10,788 concept blocks**.

### (b) A definition block — the rules for one relationship type, written once

```turtle
#HasParticipatingCountry
    rdf:type        owl:ObjectProperty ;          # "I am a relationship type"
    rdfs:label      "Has participating country"@en ;
    rdfs:domain     class#Agreement ;             # arrows may only START from an Agreement
    rdfs:range      class#Country ;               # arrows may only POINT AT a Country
    rdfs:subPropertyOf  skos:related ;
    owl:inverseOf   #IsCountrySignedToAgreement . # my mirror-image twin
```

All 171 uses of this relationship reference this one definition. The URI is the
identity; `rdfs:label` is only display text.

There are **151 object-property definitions** and **108 class definitions**
(classes additionally carry `rdfs:subClassOf`, e.g. `RDS subClassOf Government-policy`).

### (c) A label block — the actual display text

```turtle
#UnitedStatesOfAmerica/UnitedStatesOfAmerica_en
    rdf:type               skosxl:Label ;
    sem:caseSensitivity    sem:CaseSensitive ;
    sem:stemming           sem:StemmingOff ;
    skosxl:literalForm     "United States of America"@en .
```

Labels are **not** plain strings on the concept. Semaphore uses SKOS-XL: the concept
points at a small label *resource*, which holds the text plus text-matching flags.
There are **26,377 label blocks** and **zero** `skos:prefLabel` literals in the file.

---

## 3. The two hierarchies (they are independent)

**Class hierarchy** — `rdfs:subClassOf` between the 108 classes. Schema-level,
small. "An RDS is a kind of Government-policy."

**Concept hierarchy** — the big taxonomy tree. Represented *only* as one
`skos:broader` arrow per child pointing **up** at its parent:

```turtle
#1.11_Digital_source_records
    skos:broader  #1_Facilitative_transitory_and-or_short-term_value_records .
```

No depth numbers, no ordering, no child lists on the parent. The tree exists solely
as the set of upward arrows (**10,826** of them).

Critically, the two are orthogonal: a concept's class does not determine its tree
position, and one branch freely mixes classes. Verified: `IR-core-function`
instances sit at CSV depths 2–8; `Information` at 1–6; `Property` at 1–8.

**Polyhierarchy is real** — 51 concepts have more than one `skos:broader` parent.
Any storage design using a single `parent_id` column cannot represent this
(see [LEGACY-AUDIT.md](LEGACY-AUDIT.md)).

---

### The top of the tree

The taxonomy has exactly **11 root concepts** — the model's upper ontology, and
the natural top level for any tree UI:

```
Activity   Authority   Classification   Event   Information   Location
Money      Object      Party            Product or service    Topic
```

Largest classes by instance count: `Information` (1,306), `ANZSIC
classification` (826), `Named organisation` (699), `IR activity` (616),
`Legislative authority` (494), `Business event` (383), `RDS` (337),
`Service` (336).

---

## 4. How relationship applicability is actually decided

**By class, never by depth.** A relationship is usable when the source concept's
`rdf:type` matches the property's `rdfs:domain`, and the target's type matches
`rdfs:range`.

| Property | domain | range | inverse |
|---|---|---|---|
| Has penalty | Function | Penalty | Is-penalty-for |
| Has system type | System | System-type | Is-system-type-of |
| Has participating country | Agreement | Country | IsCountrySignedToAgreement |
| Has business type | Commercial-organisation | BusinessType | IsBusinessTypeOf |
| Is IR form related to | IRForm | skos:Concept | HasRelatedIRForm |

Notes:
- Only **2 of 151** properties declare no domain.
- **33 of 151** have `range = skos:Concept`, i.e. "target may be any concept".
- Subclassing matters: a domain of `Party` also admits every subclass of `Party`,
  so validity checks must walk the class tree, not compare a single URI.

---

## 5. Direction: relationships are one-way arrows that come in declared pairs

A stored triple is a **single arrow**. Two-way behaviour comes from two separate
things:

1. **A declaration** — `HasParticipatingCountry owl:inverseOf IsCountrySignedToAgreement`.
   The model has **142 inverse declarations**; a handful of properties have no
   inverse and are genuinely one-directional.
2. **Materialised reverse triples** — Semaphore *also* physically writes the
   opposite arrow into the other concept's block. Both arrows exist independently:

```turtle
#CompetentAuthorityArrangement
    HasParticipatingCountry     #UnitedStatesOfAmerica ...

#UnitedStatesOfAmerica
    IsCountrySignedToAgreement  #CompetentAuthorityArrangement ...
```

Nothing enforces that they stay in step. Observed drift in the source data itself:
`HasInterestIn` 985 vs `IsInterestOf` 982 in the Nov-2025 CSV era. **This is the
single most important hazard for an editor** and drives the storage decision in
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## 6. Identity: URIs and GUIDs, never labels

Every concept is identified by its URI plus a `sem:guid`. Labels are just data
hanging off the concept, so two concepts may share a label without ambiguity —
each arrow points at a URI.

Measured: of 10,799 labelled concepts there are only **5 shared preferred labels**,
and every one is a cross-class pair (a real concept vs. an entry in a metadata
value list):

| Label | Concept A | Concept B |
|---|---|---|
| General Ledger | `Information` | `MetadataValue` |
| Intelligence | `IRBusinessGroup` | `MetadataValue` |
| Party | `Party` | `MetadataValue` |
| Property | `Object-classification` | `MetadataValue` |
| Chinese | `Tax-payer-attribute` | `MetadataValue` |

That cleanliness is enforced: the model header imports
`unique-concept-label-constraint` and `unique-concept-label-in-class-constraint`,
so Semaphore forbids duplicate labels *within a class* while allowing the same word
across classes.

**Rule for this project: key on URI/GUID internally, never on label.** Where a
picker would show two identical labels, disambiguate by class in the UI only.

---

## 7. Concept URIs span five namespaces

The model was merged from earlier models over time. Concept URIs live under:

```
http://example.com/InlandRevenueModel#...
http://example.com/Cleaned-Inland-Revenue-model#...
http://example.com/IRD-test-model#...
http://example.com/NZ-IRD#...
http://example.com/InlandRevenueModel-current-#...
http://smartlogic.com/term#...            (numeric-id concepts)
http://smartlogic.com/class#...           (classes)
```

They cross-reference each other freely. A GUID does **not** let you reconstruct the
URI, which is why the URI must be stored (the legacy database did not store it).

---

## 8. What a triple cannot do

A triple has exactly three parts, so a relationship instance **cannot carry
attributes** — there is nowhere in this model to record "this link was added in
2014" or "this link is provisional". If per-link metadata is ever needed, the
SQLite layer can add columns, but plain RDF cannot round-trip it without
reification. Design accordingly.

---

## 9. Portability to other ontology tools

Syntactically the file is standard Turtle (Jena-serialised) and **any** RDF tool —
Protégé, TopBraid, PoolParty, GraphDB, Jena/Fuseki, rdflib — will parse it.
Semantically it is a Smartlogic dialect, and three things confuse generic tools:

1. **No plain `skos:prefLabel` literals** — all labels are SKOS-XL reified.
2. **Concepts are not typed `skos:Concept`** — they carry custom classes, whose
   relation to SKOS lives in `semaphore-core`, referenced via `owl:imports` but not
   bundled and probably not publicly resolvable.
3. **Vendor plumbing** (`sem:`, `teamwork:`, SPIN, `urn:x-evn-*`) is meaningless
   noise elsewhere.

A "clean export" profile fixes all three mechanically (roughly 50 lines / a couple
of SPARQL CONSTRUCTs): materialise `skos:prefLabel`/`skos:altLabel` literals from
the XL forms, assert `rdf:type skos:Concept` on everything with a `sem:guid` (or
declare the custom classes `rdfs:subClassOf skos:Concept`), and drop the vendor
triples and the unresolvable import. This is a planned export mode — see
[ARCHITECTURE.md](ARCHITECTURE.md) §Export profiles.

---

## 10. Counts (measured, for regression-testing the importer)

All figures below are emitted and checked by `tools/import-ttl.ts` on every run.

| Thing | Count |
|---|---|
| Subject blocks parsed (0 unparsed) | 38,354 |
| Concepts (with `sem:guid`, excl. concept schemes) | 10,788 |
| Concept schemes | 11 |
| Classes (`owl:Class`) | 108 |
| `rdfs:subClassOf` edges (so 14 class roots) | 94 |
| Object properties (`owl:ObjectProperty`) | 151 |
| Datatype properties (`owl:DatatypeProperty`) | 22 |
| `owl:inverseOf` declarations | 142 |
| `skos:broader` edges | 10,826 |
| Concepts with >1 parent (polyhierarchy) | 49 |
| Relationship triples (concept→concept, incl. `skos:related`) | 25,214 |
| Label resources (`skosxl:Label`) | 26,377 |
| Concept→label attachments (10 resources serve two roles) | 26,387 |
| Literal-valued annotations on concepts | 30,811 |
| Dangling relationship targets | 0 |

Two counts deserve a note because they are easy to get wrong:

- **Polyhierarchy is 49 in the TTL**, not 51. The legacy database reported 51
  because duplicated concept rows inflated it (see [LEGACY-AUDIT.md](LEGACY-AUDIT.md)
  Finding 5).
- **`skos:related` (4,248 uses) has no `owl:ObjectProperty` definition block** —
  it is a SKOS built-in that Semaphore never redeclares. An importer that only
  trusts definition blocks will silently drop those 4,248 links. It is also
  symmetric, so it is its own inverse.

An importer reproducing these numbers has almost certainly read the file correctly.

---

## 11. Data-quality observations (for the taxonomy team, not bugs)

Surfaced by the import; none block the editor, but each is worth a decision.

**Eight concepts carry no custom class** — they are typed only as
`skos:Concept`, so no relationship rule can apply to them and they cannot be
validated:

```
Fruit tree                    Portfolio investment entity   Revenue account
Cyber insurance               Foreign mortgage              Governance Document Centre
Apple pieces                  Uni-lateral opt-out
```

(`Apple pieces` also has the URI `...#PineapplePieces` — a copy-paste artefact
worth confirming.)

**`Has related activity` has no declared `owl:inverseOf`** despite being a real
concept-to-concept relationship. Every other relationship of its kind is paired.
Either it is deliberately one-directional or the declaration was missed; the
editor will treat it as one-way until told otherwise.

**The SHACL companion file is empty.** `InlandRevenueModel_shaclgraph.ttl`
contains prefixes and a placeholder declaration and **zero shapes**. That may be
correct — this model expresses its constraints through OWL domain/range instead
— but if constraints were authored in Semaphore's SHACL editor, they did not
come through in this export.
