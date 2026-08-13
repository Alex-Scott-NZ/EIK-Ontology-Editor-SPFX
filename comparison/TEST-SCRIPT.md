# Editor test script — Model tab & building an ontology from scratch

Version 0.6.5.0. Two parts: **A** exercises the Model tab on the real IR
ontology; **B** builds a small ontology from nothing and ends by exporting it
as Turtle. Every step says what you should see — anything different is a bug,
note it and carry on. The flow mirrors how the IR model itself is structured
(classes with colours and a hierarchy, paired relationship types with
domain/range, concepts with alt labels/acronyms, polyhierarchy, metadata),
without trying to be exhaustive.

Where things live since 0.6.4.0:
- Two workspace tabs: **Concepts** (tree/list browser + concept card) and
  **Model** (classes, relationship types, metadata fields, label types as
  foldable cards with filter boxes and jump pills). Tree vs List is the small
  icon toggle beside the search box inside Concepts.
- The command bar is **Open… · Save · Save as… · Export Turtle… · Undo ·
  Revert**. Save writes to the SharePoint library; a red **● n unsaved
  changes** badge sits in the status strip until you do.
- Section **+** buttons sit right after each card's title.

Notes:
- The change journal grew a new entry type in 0.3.0.0, so **.sqlite files
  saved before then must be rebuilt from Turtle** (import the .ttl again)
  before editing classes in them.
- Since 0.5.0.0 the Model tab also defines **metadata fields** and **label
  types**. The standard SKOS notes and "Alternative label" work without any
  definitions.

---

## Part A — the Model tab on the IR ontology

1. **Load the ontology** (import the .ttl or open a .sqlite as usual).
2. Open the **Model** tab (next to Concepts).
   - *Expect:* four foldable cards, each with a filter box. **Concept classes (108)** with colour swatches
     (Activity's should be purple-ish `#cf7bd9` — same as Semaphore), parent
     class, live concept counts (Information ≈ 1,306) and definitions.
     **Relationship types (72)** listed once per pair with Name, Inverse,
     From, To, Uses (has related ≈ 2,124; many are 0) and definitions.
     **Metadata fields (22)** — Business definition, Last Reviewed Date, …
     with usage counts (5 unnamed "(system)" rows are Semaphore internals).
     **Label types (10)** — Acronym, Has code, Has evidence, … with usage
     counts matching Semaphore's Concept-to-Label list.
3. **Create a type:** the **+** on the Relationship types card → name
   `Is regulated under`, inverse `Regulates use of`, From **Party**, To
   **Legislative authority** (type in the box — it filters), definition
   something meaningful → Create.
   - *Expect:* appears in the table, Uses = 0.
4. **Use it:** Concepts tab → find a Party concept (e.g. a Named
   organisation) → **+** on the Related Concepts card → your new type is
   offered (Party domain; the list has a filter box) → link it to a
   Legislative authority concept.
   - *Expect:* back on Model tab, Uses = 1. On the *target* concept, the link
     reads from the other end as "Regulates use of".
5. **Guarded delete:** try deleting `Is regulated under`.
   - *Expect:* refused — "1 relationship uses it". Remove the link from the
     concept, delete again — now it works and the inverse goes with it.
6. **Edit a class:** Model tab → edit a class you can find in the tree (pick
   something small, e.g. **Feature**) → change its colour → Save.
   - *Expect:* the tree swatches for its concepts change immediately.
7. **Save** (writes the .sqlite to the library), then reopen it (**Open…** →
   choose the file).
   - *Expect:* everything from steps 3–6 is still there.

## Part B — an ontology from scratch

The build order matters and the UI teaches it: **classes → relationship types
→ concepts → links**. Classes must exist to be domain/range choices; types
must exist before concepts can be linked.

1. **Open… → Start a new ontology → Create a new ontology.**
   - *Expect:* an empty editor — 0 concepts, empty tree. Status strip shows
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
3b. **Metadata field + label type.** Still on the Model tab:
   - New metadata field → `Risk rating`, applies to **Activity**, definition
     "How risky this activity is."
   - New label type → `Acronym`, applies to **Any concept**.
   - *Expect:* one row in each table, Uses = 0. Creating a field called
     `Performs` is refused — names are unique across all types and fields.
4. **Concepts.** Two different routes, depending on whether the concept has a
   parent:
   - **Top-level** — the empty tree shows a dashed **"+ Add the first
     concept"** row; click it (afterwards it reads "+ New top concept" at the
     bottom of the root level). Create:
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
7. **Labels with matching flags.** ACME Ltd → add a label → the Role dropdown
   now offers **Acronym** (your §B3b definition) as well as Alternative
   label. Add `ACME` as an **Acronym** → set Case sensitivity **Case
   sensitive**, Stemming **Off**.
   - *Expect:* flag chips/badges on the label like the IR data shows, and
     Uses = 1 on the Acronym row back on the Model tab.
8. **Metadata.** Tax filing → **+** on the Metadata card → the Field box
   (type to filter) offers **Risk rating** (because Tax filing is an Activity
   — check it is NOT offered on ACME Ltd or Filing guide, whose classes don't
   match its domain) plus the standard SKOS set → Risk rating → "High".
   - Also add a standard one: ACME Ltd → definition → "A test organisation."
   - Then hover a metadata row: a pencil edits the value in place, the bin
     deletes it. Edit one to prove the round trip.
9. **Save** (command bar) → *expect:* no setup needed — it creates
   `Shared Documents/Ontology` on the site and writes `ontology.sqlite`
   there; the red **● unsaved changes** badge in the status strip clears.
   Then **Open…** → *expect:* the picker auto-lists that folder with your
   file in it → open it.
   - *Expect:* all of it back — including a delete test: deleting Tax filing
     should warn it takes 1 child + 2 relationships with it. Cancel.
   - (Want a local copy? Download the .sqlite from the Ontology library like
     any document.)
10. **Export Turtle.** Command bar → **Export Turtle…** → *expect:* a
    `ontology.ttl` downloads immediately (the export includes unsaved
    changes — it serialises what you're looking at). Open it in a text
    editor: your classes as `owl:Class` blocks, the relationship pairs with
    `rdfs:domain`/`rdfs:range`/`owl:inverseOf`, every link written in BOTH
    directions, concepts with `skos:broader`, SKOS-XL label resources with
    their matching flags, and your Risk rating as a typed annotation.
11. **The round trip.** **Open… → Import a Turtle export → choose the .ttl
    you just downloaded.**
    - *Expect:* it parses with zero anomalies and the editor shows the same
      counts as before the export — 4 classes (or 4+ if you kept extras),
      3 relationship-type pairs, your concepts, links, labels, metadata.
      That file is Semaphore-compatible: this is the eventual production
      export path.
    - The same check runs headless as `npm --prefix tools run smoke`
      (CLI equivalent: `npm --prefix tools run export -- your.sqlite out.ttl`
      — same serialiser module as the button).

## What this deliberately covers from the IR model

class hierarchy + colours (§B2) · paired types with domain/range (§B3) ·
class vs tree-position independence (§B4b) · subclass inheritance in the
picker (§B6) · "Any" ranges (§B6) · one-row both-ends links (§B6) ·
polyhierarchy (§B5) · alt labels with matching flags (§B7) · annotations,
including edit-in-place (§B8) · guarded deletes (§A5, §B9) · save to
SharePoint and reload (§B9) · Turtle export and re-import round trip
(§B10–11). Not covered on purpose: SKOS-XL label URIs per language, wildcard
patterns, field-code rules — those exist in the import path and round-trip
already.
