# Demo FAQ — the two questions that will come up

Both questions are really the same trap: the model contains **two independent
hierarchies over the same 10,788 concepts**, and they use nearly the same
names at the top. Everything below is verified against the live database.

---

## Q1. "What's the difference between the classes and the things in the tree?"

- **Concept classes** — 108 `owl:Class` definitions (Party, Function,
  Information, …) in their own hierarchy built from `rdfs:subClassOf`:
  14 root classes, the rest nested beneath. A class is **what kind of thing a
  concept is** — its `rdf:type`. Classes govern everything rule-like: which
  relationship types a concept may use, which metadata fields apply, the
  swatch colour in the tree. The Model tab's first card shows all of them:
  **Concept classes (108)**.
- **Concepts** — the 10,788 entities themselves, arranged for browsing by
  `skos:broader` into a tree with **11 top-level concepts**. Tree position is
  **navigation only**: it says where a concept is filed, never what it is.

A tidy way to hold it:

> **108 classes sort the 10,788 concepts into kinds; 11 top concepts sort the
> same 10,788 into browsing branches.** One tree answers "what is it?", the
> other "where do I find it?"

### The namesake trap

The 11 top-of-tree concepts carry almost the same names as the root classes —
both vocabularies contain Party, Classification, Event, Authority, Money,
Topic, Information — so the tree's top branches *look like* the class system.
They are not, and the mapping isn't even the identity:

| Top concept (tree branch) | Its actual class (`rdf:type`) |
|---|---|
| Activity | **Function** |
| Object | **Property** |
| Location | **MetadataValue** |
| Party | Party (happens to match) |

"It lives under the Activity branch" has never implied "its class is
Activity". Classes span tree depths 1–8 and cross branches freely.

This confusion has history: the old CSV export carried no `rdf:type`, so the
legacy pipeline's `class_id` column stored just the root **branch** label and
relationship rules were inferred from tree depth. That heuristic is retired —
see [LEGACY-AUDIT.md](LEGACY-AUDIT.md) §4.2 — because depth is a shadow of
class, not a substitute.

### An example class subtree (under Party)

```
Party
├─ Taxpayer
│  ├─ Role
│  │  ├─ IRBoardOrCommittee
│  │  └─ IRBusinessGroup
│  ├─ BusinessType, Profession, InlandRevenue, …
├─ Commercial-organisation, PersonType, …
```

**Demo move:** walkthrough step "Change a class after the fact" — reclassify
a concept without moving it in the tree, and the relationship picker changes
while the hierarchy doesn't.

---

## Q2. "So when I create a relationship, what decides where it can go?"

**The class hierarchy — never the tree.** A relationship type's **From** and
**To** are classes (`rdfs:domain` / `rdfs:range`), and the editor applies
them in two ways when linking actual concepts:

1. **Direct match** — a concept whose class equals the domain can be a
   source; same for the range on the target side.
2. **Subclass inheritance** — a concept whose class sits *anywhere below*
   the domain class also qualifies. `Performs` is declared From **Party**;
   ACME Ltd is an **Organisation**, a subclass of Party, so Performs is
   offered. (Internally: the `v_class_ancestry` view answers "is this
   concept's class a descendant-or-self of the declared class?")

Refinements:

- **"Any concept"** — a type with no declared domain (or range) is offered
  from (or to) everything. The real model leans on this: 33 properties have
  `range = skos:Concept`; `HasSourceOfRules` sources span 60+ classes.
- **Guarded editing** — the same check runs in reverse on the Model tab: if
  editing a type's From/To to a tighter class would strand existing links,
  the editor refuses and reports how many links are in the way.
- **Both directions from one edit** — every type is half of an inverse pair
  (`Performs` / `Is performed by`); authoring a link one way makes it
  readable from both ends automatically.

**Demo move:** walkthrough step "Links" — Performs offered on ACME Ltd
(subclass inheritance working), and wrong-direction pairings (Performs from a
Document) simply not offered.
