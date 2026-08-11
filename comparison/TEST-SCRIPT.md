# Editor test script — Model tab & building an ontology from scratch

Version 0.4.1.0. Two parts: **A** exercises the new Model tab on the real IR
ontology; **B** builds a small ontology from nothing. Every step says what you
should see — anything different is a bug, note it and carry on. The flow
mirrors how the IR model itself is structured (classes with colours and a
hierarchy, paired relationship types with domain/range, concepts with alt
labels/acronyms, polyhierarchy, metadata), without trying to be exhaustive.

Notes:
- The change journal grew a new entry type in 0.3.0.0, so **.sqlite files
  saved before then must be rebuilt from Turtle** (import the .ttl again)
  before editing classes in them.
- Known gaps, on the list, not bugs: defining **metadata fields** and **label
  types** at the model level isn't built yet — a scratch ontology offers the
  standard SKOS note fields and the "Alternative label" role only.

---

## Part A — the Model tab on the IR ontology

1. **Load the ontology** (import the .ttl or open a .sqlite as usual).
2. Next to Tree and List there is now a **Model** tab. Open it.
   - *Expect:* two tables. **Concept classes (108)** with colour swatches
     (Activity's should be purple-ish `#cf7bd9` — same as Semaphore), parent
     class, live concept counts (Information ≈ 1,306) and definitions.
     **Relationship types (~142)** listed once per pair with Name, Inverse,
     From, To, Uses (has related ≈ 2,124; many are 0) and definitions.
3. **Create a type:** New relationship type → name `Is regulated under`,
   inverse `Regulates use of`, From **Party**, To **Legislative authority**,
   definition something meaningful → Create.
   - *Expect:* appears in the table, Uses = 0.
4. **Use it:** Tree tab → find a Party concept (e.g. a Named organisation) →
   Add relationship → your new type is offered (Party domain) → link it to a
   Legislative authority concept.
   - *Expect:* back on Model tab, Uses = 1. On the *target* concept, the link
     reads from the other end as "Regulates use of".
5. **Guarded delete:** try deleting `Is regulated under`.
   - *Expect:* refused — "1 relationship uses it". Remove the link from the
     concept, delete again — now it works and the inverse goes with it.
6. **Edit a class:** Model tab → edit a class you can find in the tree (pick
   something small, e.g. **Feature**) → change its colour → Save.
   - *Expect:* the tree swatches for its concepts change immediately.
7. **Save .sqlite**, reopen it (Open another… → choose the file).
   - *Expect:* everything from steps 3–6 is still there.

## Part B — an ontology from scratch

The build order matters and the UI teaches it: **classes → relationship types
→ concepts → links**. Classes must exist to be domain/range choices; types
must exist before concepts can be linked.

1. **Open another… → Start a new ontology → Create a new ontology.**
   - *Expect:* an empty editor — 0 concepts, empty tree. Status bar shows
     "New ontology (unsaved)".
2. **Model tab → classes.** Create:
   | Name | Parent | Colour | Definition |
   |---|---|---|---|
   | Party | (top level) | `#e0a3a3` | A person or organisation |
   | Organisation | Party | `#c98080` | A group acting as one party |
   | Activity | (top level) | `#a3c1e0` | Something a party does |
   | Document | (top level) | `#a3e0b8` | Recorded information |
   - *Expect:* 4 rows, swatches shown, Organisation's parent reads Party.
   - Also try creating another class called `Party` — *expect:* refused,
     duplicate name.
3. **Relationship types.** Create:
   | Name | Inverse | From | To |
   |---|---|---|---|
   | Performs | Is performed by | Party | Activity |
   | Produces | Is produced by | Activity | Document |
   | Mentions | Is mentioned in | Document | Any concept |
   - *Expect:* 3 pair rows. The preview line in the dialog should read
     sensibly before you hit Create (that's the domain/range talking).
4. **Concepts.** Two different routes, depending on whether the concept has a
   parent:
   - **Top-level** — the empty tree shows a dashed **"+ Add the first
     concept"** row; click it (afterwards it reads "+ New top concept" at the
     bottom of the root level — the command-bar **New concept** button does
     the same thing). Create:
     - `ACME Ltd` — class **Organisation**
     - `Tax filing` — class **Activity**
     - `Filing guide` — class **Document**
   - **As a child** — hover **Tax filing** in the tree and click the
     **add-child (+) icon** that appears on the row. The dialog opens as
     "New concept under \"Tax filing\"". Create:
     - `Annual return` — the class dropdown comes pre-set to **Activity**
       (children default to their parent's class; change the dropdown only
       when the child is a different kind of thing).
   - *Expect:* ACME, Tax filing and Filing guide at top level; Annual return
     nested under Tax filing; class colours on the tree nodes.
   - (A third route if you forgot the parent: create top-level, then select
     the concept → **add broader** in the detail pane → pick the parent.)
4b. **Change a class after the fact.** Select Annual return → in the detail
   pane, click the pencil next to the class chip → change it to **Document**
   → try Add relationship (*expect:* only **Mentions** offered now, not
   Performs/Produces) → change the class back to **Activity**.
   That's the class doing its actual job: it governs the relationship picker,
   independent of where the concept sits in the tree.
5. **Hierarchy, second parent (polyhierarchy).** Select Annual return → add
   broader → pick ACME Ltd (nonsense semantically, but it proves the
   mechanics).
   - *Expect:* Annual return now appears under BOTH Tax filing and ACME Ltd.
     Remove the ACME parent again afterwards.
6. **Links.**
   - ACME Ltd → Add relationship → **Performs** → Tax filing.
     (Organisation isn't Party, but it's a *subclass* of Party — the type
     must still be offered. If it isn't, that's a bug in class inheritance.)
   - Tax filing → Add relationship → **Produces** → Filing guide.
   - Filing guide → Add relationship → **Mentions** → anything ("Any" range
     means every concept is offered).
   - *Expect:* each link readable from both ends under the inverse name;
     wrong-direction pairings (e.g. Performs from Filing guide) not offered.
7. **Labels with matching flags.** ACME Ltd → add an alternative label
   `ACME` → set Case sensitivity **Case sensitive**, Stemming **Off**.
   - *Expect:* flag chips/badges on the label like the IR data shows.
8. **Metadata.** ACME Ltd → add metadata → the Field dropdown offers the
   standard SKOS set (definition pre-selected, plus scope note, editorial
   note, history note, example, comment) → definition → "A test organisation."
   - Then hover the metadata row: a pencil edits the value in place, the bin
     deletes it. Edit it to prove the round trip.
9. **Save to SharePoint** (command bar) → *expect:* no setup needed — it
   creates `Shared Documents/Ontology` on the site and writes
   `ontology.sqlite` there; the unsaved-changes counter on "Save .sqlite"
   resets. Then **Open another…** → *expect:* the picker auto-lists that
   folder with your file in it → open it.
   - *Expect:* all of it back — including a delete test: deleting Tax filing
     should warn it takes 1 child + 2 relationships with it. Cancel.
   - ("Save .sqlite" still downloads a local copy — same data, your choice
     of destination.)
10. **The proof.** Keep the saved `.sqlite` — the same flow runs headless as
    `npm --prefix tools run smoke`, and a Turtle export of exactly this
    shape re-parses with zero anomalies (verified in CI-style by the smoke
    test). If you want to see your own file as Turtle:
    `npm --prefix tools run export -- path/to/your.sqlite out.ttl`.

## What this deliberately covers from the IR model

class hierarchy + colours (§B2) · paired types with domain/range (§B3) ·
class vs tree-position independence (§B4b) · subclass inheritance in the
picker (§B6) · "Any" ranges (§B6) · one-row both-ends links (§B6) ·
polyhierarchy (§B5) · alt labels with matching flags (§B7) · annotations,
including edit-in-place (§B8) · guarded deletes (§A5, §B9) · save to
SharePoint and reload (§B9). Not covered on purpose: SKOS-XL label URIs per
language, wildcard patterns, field-code rules — those exist in the import
path and round-trip already.
