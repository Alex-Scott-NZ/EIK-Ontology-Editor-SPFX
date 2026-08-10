/**
 * The ontology database schema.
 *
 * GENERATED FILE — do not edit by hand.
 * Source: tools/schema.sql    Regenerate: npm run gen:schema
 *
 * Exists as TypeScript so the web part can create a database in the browser
 * without a file read, while the Node tools import the same constant — one
 * definition of the schema, no drift between environments.
 */

export const SCHEMA_SQL: string = `-- Ontology editing schema
-- Populated by tools/import-ttl.ts from InlandRevenueModel.ttl.
-- Rationale for every design choice: docs/ARCHITECTURE.md

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Namespace prefixes, preserved so export can re-serialise readable Turtle
-- ---------------------------------------------------------------------------
CREATE TABLE prefixes (
  prefix TEXT PRIMARY KEY,
  uri    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Classes (owl:Class) — 108 in the model, with their own subClassOf tree.
-- Domain/range checks must walk this tree: a domain of Party admits subclasses.
-- ---------------------------------------------------------------------------
CREATE TABLE classes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uri             TEXT NOT NULL UNIQUE,
  label           TEXT,
  definition      TEXT,
  parent_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  -- Every other predicate found on the class, verbatim (e.g. sem:color, the
  -- swatch Semaphore shows in its tree). Blob rather than columns so a
  -- Semaphore vocabulary we have not seen can never be silently dropped.
  -- Format: { predicateUri: [{v, t:'i'|'l', lang?, dt?}] } (term-preserving).
  -- label/definition also appear here with their language tags; the columns
  -- above are display conveniences only.
  flags_json      TEXT
);
CREATE INDEX idx_classes_parent ON classes(parent_class_id);

-- ---------------------------------------------------------------------------
-- Relationship type definitions (owl:ObjectProperty) — 151 in the model.
-- Defined once; every instance references one. Replaces the legacy
-- relationship_types + empirically-inferred relationship_constraints tables.
-- ---------------------------------------------------------------------------
CREATE TABLE properties (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uri                 TEXT NOT NULL UNIQUE,
  label               TEXT,
  -- rdfs:domain — allowed class of the SOURCE. NULL = unrestricted (2 of 151).
  domain_class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  -- rdfs:range — allowed class of the TARGET. NULL = any concept (33 of 151
  -- declare skos:Concept, which is stored as NULL).
  range_class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  -- owl:inverseOf — 142 declared. NULL means genuinely one-directional.
  inverse_property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  -- rdfs:subPropertyOf, e.g. skos:related. Kept verbatim for export.
  sub_property_of     TEXT,
  -- 1 = points at a skosxl:Label resource (Acronym, HasShoulderCode, ...)
  -- rather than at another concept; those instances land in \`labels\`.
  is_label_property   INTEGER NOT NULL DEFAULT 0,
  -- What this relationship type MEANS, as written by the taxonomy team
  -- (skos:definition / rdfs:comment). This is knowledge that exists nowhere
  -- else once Semaphore is retired — surface it in the editor's picker.
  definition          TEXT,
  comment             TEXT,
  -- Every remaining predicate verbatim: sem:autocompletion, sem:conceptMapping,
  -- sem:defaultValue and anything else Semaphore attaches.
  -- Format: { predicateUri: [{v, t:'i'|'l', lang?, dt?}] } — term-preserving so
  -- export can re-emit IRIs vs literals with language tags and datatypes intact.
  flags_json          TEXT,
  -- 1 = row synthesised by the importer for a predicate with no definition block
  -- in the source (e.g. skos:related). Export must NOT emit a definition for it.
  synthesised         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_properties_domain  ON properties(domain_class_id);
CREATE INDEX idx_properties_range   ON properties(range_class_id);
CREATE INDEX idx_properties_inverse ON properties(inverse_property_id);

-- ---------------------------------------------------------------------------
-- Concepts — 10,788. Stored EXACTLY ONCE each (the legacy DB duplicated 73 of
-- them to fake polyhierarchy). \`uri\` is mandatory: without it no faithful
-- Turtle export is possible, and a GUID cannot reconstruct one.
-- ---------------------------------------------------------------------------
CREATE TABLE concepts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uri        TEXT NOT NULL UNIQUE,
  guid       TEXT UNIQUE,                                  -- sem:guid
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,  -- rdf:type
  -- Denormalised copy of the skosxl:prefLabel literal, for display and search
  -- only. \`labels\` remains the source of truth.
  pref_label TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_concepts_class ON concepts(class_id);
CREATE INDEX idx_concepts_label ON concepts(pref_label);
CREATE INDEX idx_concepts_guid  ON concepts(guid);

-- ---------------------------------------------------------------------------
-- Hierarchy (skos:broader) — 10,826 edges. A TABLE, not a parent_id column,
-- because 51 concepts have more than one parent.
-- ---------------------------------------------------------------------------
CREATE TABLE broader (
  concept_id        INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  parent_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  PRIMARY KEY (concept_id, parent_concept_id),
  CHECK (concept_id <> parent_concept_id)
);
CREATE INDEX idx_broader_parent ON broader(parent_concept_id);

-- ---------------------------------------------------------------------------
-- Relationship instances — ONE ROW PER LOGICAL LINK.
-- The inverse direction is NOT stored; it is derived by v_concept_links below,
-- which makes half-written relationships structurally impossible.
-- ---------------------------------------------------------------------------
CREATE TABLE relationships (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  property_id       INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  target_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_concept_id, property_id, target_concept_id)
);
CREATE INDEX idx_rel_source   ON relationships(source_concept_id);
CREATE INDEX idx_rel_target   ON relationships(target_concept_id);
CREATE INDEX idx_rel_property ON relationships(property_id);

-- ---------------------------------------------------------------------------
-- Labels (skosxl:Label) — 26,377 resources. One row per label, which is why
-- the legacy ";"-joined synonym bug (2,295 unsplit rows) cannot recur.
-- \`flags_json\` keeps Semaphore's matching settings for round-trip.
-- ---------------------------------------------------------------------------
-- NOTE: uri is NOT unique. 10 label resources in the model are attached to the
-- same concept under two different roles (e.g. both Evidence and Has-code), so
-- the natural key is (uri, concept, role). Every label resource in the file is
-- referenced by at least one concept — there are no orphans.
CREATE TABLE labels (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uri               TEXT,
  concept_id        INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  -- prefLabel / altLabel / Acronym / HasShoulderCode / HasMaoriTerm / ...
  label_property    TEXT NOT NULL,
  literal_form      TEXT NOT NULL,
  lang              TEXT DEFAULT 'en',
  flags_json        TEXT,
  UNIQUE (uri, concept_id, label_property)
);
CREATE INDEX idx_labels_concept ON labels(concept_id);
CREATE INDEX idx_labels_form    ON labels(literal_form);
CREATE INDEX idx_labels_uri     ON labels(uri);

-- ---------------------------------------------------------------------------
-- Literal-valued predicates on concepts: definitions, scope notes, sources,
-- BusinessDefinition, RDSNote, Instance, ... Kept generic (predicate URI +
-- value) so new annotation types need no migration.
-- ---------------------------------------------------------------------------
CREATE TABLE annotations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id    INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  predicate_uri TEXT NOT NULL,
  value         TEXT,
  lang          TEXT,
  -- xsd datatype IRI (xsd:date, xsd:boolean, ...); NULL = plain/lang string.
  -- Without this, \`"2026-03-27"^^xsd:date\` would round-trip as a bare string.
  datatype      TEXT
);
CREATE INDEX idx_annotations_concept   ON annotations(concept_id);
CREATE INDEX idx_annotations_predicate ON annotations(predicate_uri);

-- ---------------------------------------------------------------------------
-- Every triple not claimed by the tables above, kept verbatim so export can
-- reproduce it. This is what makes round-trip fidelity independent of how much
-- of Semaphore's vocabulary we have modelled. See ARCHITECTURE.md Decision 2.
-- ---------------------------------------------------------------------------
CREATE TABLE passthrough_triples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject     TEXT NOT NULL,
  predicate   TEXT NOT NULL,
  object      TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('iri', 'literal', 'raw')),
  lang        TEXT,
  datatype    TEXT
);
CREATE INDEX idx_passthrough_subject ON passthrough_triples(subject);

-- ---------------------------------------------------------------------------
-- Change journal: undo, audit trail, and the change-set export profile.
-- ---------------------------------------------------------------------------
CREATE TABLE changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  changed_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  author      TEXT,
  op          TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  entity      TEXT NOT NULL CHECK (entity IN ('concept','relationship','label','annotation','broader')),
  entity_uri  TEXT,
  detail_json TEXT
);
CREATE INDEX idx_changes_at ON changes(changed_at);

-- Provenance of this database: which TTL, when, and the counts it produced.
CREATE TABLE import_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------------

-- Both ends of every relationship, without storing both directions.
-- 'forward' rows are as authored; 'inverse' rows are derived through
-- properties.inverse_property_id. The UI reads this; writes go to the table.
CREATE VIEW v_concept_links AS
  SELECT
    r.id                AS relationship_id,
    r.source_concept_id AS concept_id,
    r.property_id       AS property_id,
    r.target_concept_id AS other_concept_id,
    'forward'           AS direction
  FROM relationships r
  UNION ALL
  SELECT
    r.id,
    r.target_concept_id,
    p.inverse_property_id,
    r.source_concept_id,
    'inverse'
  FROM relationships r
  JOIN properties p ON p.id = r.property_id
  WHERE p.inverse_property_id IS NOT NULL;

-- Transitive class ancestry, so domain/range checks can honour subclassing.
CREATE VIEW v_class_ancestry AS
  WITH RECURSIVE anc(class_id, ancestor_id) AS (
    SELECT id, id FROM classes
    UNION
    SELECT a.class_id, c.parent_class_id
      FROM anc a
      JOIN classes c ON c.id = a.ancestor_id
     WHERE c.parent_class_id IS NOT NULL
  )
  SELECT class_id, ancestor_id FROM anc;

-- Which properties may legally be used from a given concept, and what class
-- the target must be. NULL range_class_id = any concept.
CREATE VIEW v_allowed_properties AS
  SELECT
    c.id  AS concept_id,
    p.id  AS property_id,
    p.label,
    p.range_class_id
  FROM concepts c
  JOIN v_class_ancestry a ON a.class_id = c.class_id
  JOIN properties p       ON p.domain_class_id = a.ancestor_id
  WHERE p.is_label_property = 0
  UNION
  SELECT c.id, p.id, p.label, p.range_class_id
  FROM concepts c
  JOIN properties p ON p.domain_class_id IS NULL
  WHERE p.is_label_property = 0;

-- Concepts with no parent — the roots of the taxonomy tree.
CREATE VIEW v_root_concepts AS
  SELECT c.* FROM concepts c
  WHERE NOT EXISTS (SELECT 1 FROM broader b WHERE b.concept_id = c.id);
`;
