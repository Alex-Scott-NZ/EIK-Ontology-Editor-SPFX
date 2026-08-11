/**
 * Read/query layer over the ontology SQLite database (sql.js / WASM).
 *
 * The database lives entirely in memory. Edits mutate it instantly; nothing is
 * persisted until `export()` is called and the bytes are written back to
 * SharePoint. See docs/ARCHITECTURE.md Decision 1.
 *
 * Write methods deliberately do NOT exist yet — they belong in a service that
 * also journals to the `changes` table. Adding writes that bypass the journal
 * would break undo and the change-set export.
 */

import { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { getSqlJs } from './sqlJsLoader';
import { SCHEMA_SQL } from './schema';
import {
  IConcept, IConceptDetail, IConceptLink, IAllowedProperty,
  ILabel, IAnnotation, IOntologyClass, IOntologyProperty, IOntologyStats,
  FlagMap, ITreeNode
} from '../../models/IOntology';

/** Nullable column -> undefined, so callers never see null. */
function str(v: SqlValue): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}
function num(v: SqlValue): number | undefined {
  return v === null || v === undefined ? undefined : Number(v);
}

/**
 * flags_json holds every Semaphore predicate not promoted to a column, as
 * term-preserving `{ predicateUri: [{v, t:'i'|'l', lang?, dt?}] }` (see
 * tools/schema.sql) so the Turtle exporter can replay it verbatim.
 */
function parseFlags(v: SqlValue): FlagMap | undefined {
  if (v === null || v === undefined) return undefined;
  try {
    return JSON.parse(String(v));
  } catch {
    return undefined;
  }
}

export class OntologyDatabase {
  private _db: Database;

  private constructor(db: Database) {
    this._db = db;
    // MUST be re-asserted on every connection. `PRAGMA foreign_keys` is a
    // connection setting, not a property of the file — SQLite defaults it OFF,
    // so the ON in schema.sql applies only to the connection that ran it.
    // Reopening a saved database without this silently disables every
    // ON DELETE CASCADE, and deleting a concept would strand its labels,
    // annotations, relationships and hierarchy edges.
    db.run('PRAGMA foreign_keys = ON');
  }

  /** @param bytes  the .sqlite file contents */
  public static async load(bytes: ArrayBuffer): Promise<OntologyDatabase> {
    const SQL: SqlJsStatic = await getSqlJs();
    return new OntologyDatabase(new SQL.Database(new Uint8Array(bytes)));
  }

  /** Wrap a Database built in-process — e.g. the result of a Turtle import. */
  public static fromDatabase(db: Database): OntologyDatabase {
    return new OntologyDatabase(db);
  }

  /**
   * A brand-new, empty ontology: full schema, no content. Seeds the standard
   * namespace prefixes (so a later Turtle export serialises readably) and a
   * provenance marker; everything else — classes, relationship types,
   * concepts — is authored in the editor.
   */
  public static async createBlank(): Promise<OntologyDatabase> {
    const SQL: SqlJsStatic = await getSqlJs();
    const db = new SQL.Database();
    db.exec(SCHEMA_SQL);
    const insPrefix = db.prepare('INSERT OR REPLACE INTO prefixes (prefix, uri) VALUES (?, ?)');
    const prefixes: Array<[string, string]> = [
      ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
      ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
      ['owl', 'http://www.w3.org/2002/07/owl#'],
      ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
      ['skos', 'http://www.w3.org/2004/02/skos/core#'],
      ['skosxl', 'http://www.w3.org/2008/05/skos-xl#'],
      ['sem', 'http://www.smartlogic.com/2014/08/semaphore-core#']
    ];
    for (const [p, uri] of prefixes) insPrefix.run([p, uri]);
    insPrefix.free();
    db.run('INSERT OR REPLACE INTO import_metadata (key, value) VALUES (?, ?)',
      ['source_file', 'Created in the editor (blank ontology)']);
    return new OntologyDatabase(db);
  }

  /** Raw handle, for queries this class does not yet wrap. */
  public get raw(): Database {
    return this._db;
  }

  /** Serialise for upload back to SharePoint. */
  public export(): Uint8Array {
    return this._db.export();
  }

  public close(): void {
    this._db.close();
  }

  private _rows(sql: string, params: SqlValue[] = []): SqlValue[][] {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      const out: SqlValue[][] = [];
      while (stmt.step()) out.push(stmt.get());
      return out;
    } finally {
      stmt.free();
    }
  }

  private _conceptFromRow(r: SqlValue[]): IConcept {
    return {
      id: Number(r[0]),
      uri: String(r[1]),
      guid: str(r[2]),
      classId: num(r[3]),
      prefLabel: str(r[4])
    };
  }

  private static readonly CONCEPT_COLS = 'c.id, c.uri, c.guid, c.class_id, c.pref_label';

  // -- Tree ------------------------------------------------------------------

  /** Concepts with no parent — the taxonomy roots. */
  public getRootConcepts(): IConcept[] {
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
       WHERE NOT EXISTS (SELECT 1 FROM broader b WHERE b.concept_id = c.id)
       ORDER BY c.pref_label`
    ).map(r => this._conceptFromRow(r));
  }

  public getChildren(conceptId: number): IConcept[] {
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
       JOIN broader b ON b.concept_id = c.id
       WHERE b.parent_concept_id = ?
       ORDER BY c.pref_label`,
      [conceptId]
    ).map(r => this._conceptFromRow(r));
  }

  /**
   * All parents of a concept. Usually one, but 49 concepts are polyhierarchical
   * — the tree UI must cope with a concept appearing under several branches.
   */
  public getParents(conceptId: number): IConcept[] {
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
       JOIN broader b ON b.parent_concept_id = c.id
       WHERE b.concept_id = ?
       ORDER BY c.pref_label`,
      [conceptId]
    ).map(r => this._conceptFromRow(r));
  }

  public getChildCount(conceptId: number): number {
    const r = this._rows('SELECT COUNT(*) FROM broader WHERE parent_concept_id = ?', [conceptId]);
    return r.length ? Number(r[0][0]) : 0;
  }

  /**
   * Roots with their child counts, so the tree can draw expand chevrons without
   * a follow-up query per node.
   */
  public getRootNodes(): ITreeNode[] {
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS},
              (SELECT COUNT(*) FROM broader b2 WHERE b2.parent_concept_id = c.id)
       FROM concepts c
       WHERE NOT EXISTS (SELECT 1 FROM broader b WHERE b.concept_id = c.id)
       ORDER BY c.pref_label`
    ).map(r => ({ ...this._conceptFromRow(r), childCount: Number(r[5]) }));
  }

  /** Children with their own child counts. One query per expanded node. */
  public getChildNodes(conceptId: number): ITreeNode[] {
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS},
              (SELECT COUNT(*) FROM broader b2 WHERE b2.parent_concept_id = c.id)
       FROM concepts c
       JOIN broader b ON b.concept_id = c.id
       WHERE b.parent_concept_id = ?
       ORDER BY c.pref_label`,
      [conceptId]
    ).map(r => ({ ...this._conceptFromRow(r), childCount: Number(r[5]) }));
  }

  /**
   * The chain of ancestors from a root down to `conceptId`, for revealing a
   * search hit in the tree. Follows one parent at each step; with 49
   * polyhierarchical concepts a node can sit under several branches, and this
   * returns the first path found.
   */
  public getAncestorPath(conceptId: number): number[] {
    const path: number[] = [];
    const seen: { [id: number]: true } = {};
    let current = conceptId;
    // Bounded: the deepest branch in the model is ~10 levels.
    for (let depth = 0; depth < 64; depth++) {
      if (seen[current]) break;              // cycle guard — data is not guaranteed acyclic
      seen[current] = true;
      const r = this._rows(
        'SELECT parent_concept_id FROM broader WHERE concept_id = ? ORDER BY parent_concept_id LIMIT 1',
        [current]
      );
      if (!r.length) break;
      current = Number(r[0][0]);
      path.unshift(current);
    }
    return path;
  }

  // -- Flat list (paginated) -------------------------------------------------

  public countConcepts(search?: string): number {
    if (search && search.trim()) {
      const like = `%${search.trim()}%`;
      const r = this._rows(
        `SELECT COUNT(DISTINCT c.id) FROM concepts c
         LEFT JOIN labels l ON l.concept_id = c.id
         WHERE c.pref_label LIKE ? OR l.literal_form LIKE ?`,
        [like, like]
      );
      return r.length ? Number(r[0][0]) : 0;
    }
    const r = this._rows('SELECT COUNT(*) FROM concepts');
    return r.length ? Number(r[0][0]) : 0;
  }

  /** One page of concepts, alphabetical — the Semaphore "list view". */
  public listConcepts(offset: number, limit: number, search?: string): IConcept[] {
    if (search && search.trim()) {
      const like = `%${search.trim()}%`;
      return this._rows(
        `SELECT DISTINCT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
         LEFT JOIN labels l ON l.concept_id = c.id
         WHERE c.pref_label LIKE ? OR l.literal_form LIKE ?
         ORDER BY c.pref_label LIMIT ? OFFSET ?`,
        [like, like, limit, offset]
      ).map(r => this._conceptFromRow(r));
    }
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
       ORDER BY c.pref_label LIMIT ? OFFSET ?`,
      [limit, offset]
    ).map(r => this._conceptFromRow(r));
  }

  /**
   * classId -> `#rrggbb`, for the class chips. Semaphore users navigate by
   * these colours, so they are worth honouring rather than inventing new ones.
   */
  public getClassColourMap(): { [classId: number]: string } {
    const out: { [classId: number]: string } = {};
    for (const cls of this.getClasses()) {
      const colour = this.getClassColour(cls);
      if (colour) out[cls.id] = colour;
    }
    return out;
  }

  /** classId -> label, so lists can show a class chip without N queries. */
  public getClassLabelMap(): { [classId: number]: string } {
    const out: { [classId: number]: string } = {};
    for (const r of this._rows('SELECT id, label FROM classes')) {
      if (r[1] !== null) out[Number(r[0])] = String(r[1]);
    }
    return out;
  }

  // -- Lookup ----------------------------------------------------------------

  public getConcept(conceptId: number): IConcept | undefined {
    const r = this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c WHERE c.id = ?`, [conceptId]
    );
    return r.length ? this._conceptFromRow(r[0]) : undefined;
  }

  public getConceptByGuid(guid: string): IConcept | undefined {
    const r = this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c WHERE c.guid = ?`, [guid]
    );
    return r.length ? this._conceptFromRow(r[0]) : undefined;
  }

  /**
   * Label search. Matches preferred labels and every alternate form
   * (acronyms, shoulder codes, Maori terms, ...).
   */
  public searchConcepts(term: string, limit: number = 50): IConcept[] {
    const like = `%${term}%`;
    return this._rows(
      `SELECT DISTINCT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
       LEFT JOIN labels l ON l.concept_id = c.id
       WHERE c.pref_label LIKE ? OR l.literal_form LIKE ?
       ORDER BY CASE WHEN c.pref_label LIKE ? THEN 0 ELSE 1 END, c.pref_label
       LIMIT ?`,
      [like, like, like, limit]
    ).map(r => this._conceptFromRow(r));
  }

  // -- Detail ----------------------------------------------------------------

  public getLabels(conceptId: number): ILabel[] {
    return this._rows(
      `SELECT id, label_property, literal_form, lang, flags_json FROM labels
       WHERE concept_id = ? ORDER BY label_property, literal_form`,
      [conceptId]
    ).map(r => ({
      id: Number(r[0]),
      labelProperty: String(r[1]),
      literalForm: String(r[2]),
      lang: str(r[3]),
      flags: parseFlags(r[4])
    }));
  }

  public getAnnotations(conceptId: number): IAnnotation[] {
    return this._rows(
      `SELECT a.id, a.predicate_uri, a.value, a.lang, a.datatype, p.label
       FROM annotations a
       LEFT JOIN properties p ON p.uri = a.predicate_uri
       WHERE a.concept_id = ? ORDER BY a.predicate_uri`,
      [conceptId]
    ).map(r => ({
      id: Number(r[0]),
      predicateUri: String(r[1]),
      value: str(r[2]),
      lang: str(r[3]),
      datatype: str(r[4]),
      displayLabel: str(r[5])
    }));
  }

  /**
   * Every relationship touching this concept, both authored and derived.
   * Reads v_concept_links so a stored row and its mirror are always consistent.
   */
  public getLinks(conceptId: number): IConceptLink[] {
    return this._rows(
      `SELECT v.relationship_id, v.property_id, p.label,
              v.other_concept_id, o.pref_label, oc.label, v.direction
       FROM v_concept_links v
       JOIN properties p ON p.id = v.property_id
       JOIN concepts   o ON o.id = v.other_concept_id
       LEFT JOIN classes oc ON oc.id = o.class_id
       WHERE v.concept_id = ?
       ORDER BY p.label, o.pref_label`,
      [conceptId]
    ).map(r => ({
      relationshipId: Number(r[0]),
      propertyId: Number(r[1]),
      propertyLabel: str(r[2]),
      otherConceptId: Number(r[3]),
      otherConceptLabel: str(r[4]),
      otherConceptClass: str(r[5]),
      direction: String(r[6]) as 'forward' | 'inverse'
    }));
  }

  public getConceptDetail(conceptId: number): IConceptDetail | undefined {
    const concept = this.getConcept(conceptId);
    if (!concept) return undefined;

    let className: string | undefined;
    if (concept.classId !== undefined) {
      const r = this._rows('SELECT label FROM classes WHERE id = ?', [concept.classId]);
      className = r.length ? str(r[0][0]) : undefined;
    }

    return {
      ...concept,
      className,
      parents: this.getParents(conceptId),
      childCount: this.getChildCount(conceptId),
      labels: this.getLabels(conceptId),
      annotations: this.getAnnotations(conceptId),
      links: this.getLinks(conceptId)
    };
  }

  // -- Schema ----------------------------------------------------------------

  public getClasses(): IOntologyClass[] {
    return this._rows(
      'SELECT id, uri, label, definition, parent_class_id, flags_json FROM classes ORDER BY label'
    ).map(r => ({
      id: Number(r[0]),
      uri: String(r[1]),
      label: str(r[2]),
      definition: str(r[3]),
      parentClassId: num(r[4]),
      flags: parseFlags(r[5])
    }));
  }

  /** Semaphore's tree swatch for a class, as `#rrggbb`, if one was set. */
  public getClassColour(cls: IOntologyClass): string | undefined {
    if (!cls.flags) return undefined;
    for (const key of Object.keys(cls.flags)) {
      if (key.indexOf('#color') !== -1) {
        const terms = cls.flags[key];
        if (terms && terms.length) return `#${terms[0].v}`;
      }
    }
    return undefined;
  }

  public getProperties(): IOntologyProperty[] {
    return this._rows(
      `SELECT id, uri, label, domain_class_id, range_class_id, inverse_property_id,
              sub_property_of, definition, comment, flags_json
       FROM properties
       WHERE is_label_property = 0
         AND (flags_json IS NULL OR flags_json NOT LIKE '%DatatypeProperty%')
       ORDER BY label`
    ).map(r => ({
      id: Number(r[0]),
      uri: String(r[1]),
      label: str(r[2]),
      domainClassId: num(r[3]),
      rangeClassId: num(r[4]),
      inversePropertyId: num(r[5]),
      subPropertyOf: str(r[6]),
      definition: str(r[7]),
      comment: str(r[8]),
      flags: parseFlags(r[9])
    }));
  }

  /**
   * Metadata field definitions — datatype properties, e.g. Business
   * definition, Last Reviewed Date. Semaphore calls these Resource Metadata;
   * the concepts task shows them under "Metadata". Distinguished from
   * relationship types by their rdf:type in flags_json (no dedicated column,
   * so saved databases stay compatible).
   */
  public getMetadataFields(): Array<{
    id: number; uri: string; label?: string; domainClassId?: number;
    domainClassName?: string; definition?: string; uses: number;
  }> {
    return this._rows(
      `SELECT p.id, p.uri, p.label, p.domain_class_id, dc.label,
              COALESCE(p.definition, p.comment),
              (SELECT COUNT(*) FROM annotations a WHERE a.predicate_uri = p.uri)
       FROM properties p
       LEFT JOIN classes dc ON dc.id = p.domain_class_id
       WHERE p.flags_json LIKE '%DatatypeProperty%'
       ORDER BY p.label`
    ).map(r => ({
      id: Number(r[0]),
      uri: String(r[1]),
      label: str(r[2]),
      domainClassId: num(r[3]),
      domainClassName: str(r[4]),
      definition: str(r[5]),
      uses: Number(r[6])
    }));
  }

  /**
   * Metadata fields usable on this concept: unrestricted fields always, plus
   * fields whose domain is the concept's class or an ancestor of it.
   */
  public getMetadataFieldsFor(conceptId: number): Array<{ uri: string; label?: string }> {
    return this._rows(
      `SELECT p.uri, p.label
       FROM properties p
       WHERE p.flags_json LIKE '%DatatypeProperty%'
         AND (p.domain_class_id IS NULL OR p.domain_class_id IN (
           SELECT a.ancestor_id FROM v_class_ancestry a
           JOIN concepts c ON c.class_id = a.class_id
           WHERE c.id = ?
         ))
       ORDER BY p.label`,
      [conceptId]
    ).map(r => ({ uri: String(r[0]), label: str(r[1]) }));
  }

  /** Label type definitions (Acronym, Has code, …) with usage counts. */
  public getLabelTypes(): Array<{
    id: number; uri: string; label?: string; domainClassId?: number;
    domainClassName?: string; definition?: string; uses: number;
  }> {
    return this._rows(
      `SELECT p.id, p.uri, p.label, p.domain_class_id, dc.label,
              COALESCE(p.definition, p.comment),
              (SELECT COUNT(*) FROM labels l WHERE l.label_property = p.uri)
       FROM properties p
       LEFT JOIN classes dc ON dc.id = p.domain_class_id
       WHERE p.is_label_property = 1
       ORDER BY p.label`
    ).map(r => ({
      id: Number(r[0]),
      uri: String(r[1]),
      label: str(r[2]),
      domainClassId: num(r[3]),
      domainClassName: str(r[4]),
      definition: str(r[5]),
      uses: Number(r[6])
    }));
  }

  /** Stored-link count per relationship type (forward rows only, by design). */
  public getPropertyUsage(): { [propertyId: number]: number } {
    const out: { [propertyId: number]: number } = {};
    for (const r of this._rows('SELECT property_id, COUNT(*) FROM relationships GROUP BY property_id')) {
      out[Number(r[0])] = Number(r[1]);
    }
    return out;
  }

  /** Concept count per class, for the model screen and delete guards. */
  public getClassConceptCounts(): { [classId: number]: number } {
    const out: { [classId: number]: number } = {};
    for (const r of this._rows(
      'SELECT class_id, COUNT(*) FROM concepts WHERE class_id IS NOT NULL GROUP BY class_id'
    )) {
      out[Number(r[0])] = Number(r[1]);
    }
    return out;
  }

  /**
   * Relationship types legally usable from this concept, honouring class
   * inheritance. Replaces the legacy depth-based constraint heuristic — see
   * docs/LEGACY-AUDIT.md section 4.2.
   */
  public getAllowedProperties(conceptId: number): IAllowedProperty[] {
    return this._rows(
      `SELECT ap.property_id, ap.label, ap.range_class_id, rc.label,
              COALESCE(p.definition, p.comment)
       FROM v_allowed_properties ap
       JOIN properties p ON p.id = ap.property_id
       LEFT JOIN classes rc ON rc.id = ap.range_class_id
       WHERE ap.concept_id = ?
         AND (p.flags_json IS NULL OR p.flags_json NOT LIKE '%DatatypeProperty%')
       ORDER BY ap.label`,
      [conceptId]
    ).map(r => ({
      propertyId: Number(r[0]),
      label: str(r[1]),
      rangeClassId: num(r[2]),
      rangeClassName: str(r[3]),
      definition: str(r[4])
    }));
  }

  /**
   * Concepts eligible as the target of `propertyId`. A property with no range
   * accepts any concept, so callers should pass a search term for those.
   */
  public getValidTargets(propertyId: number, search?: string, limit: number = 50): IConcept[] {
    const like = search ? `%${search}%` : '%';
    return this._rows(
      `SELECT ${OntologyDatabase.CONCEPT_COLS} FROM concepts c
       WHERE (
         (SELECT range_class_id FROM properties WHERE id = ?) IS NULL
         OR c.class_id IN (
           SELECT a.class_id FROM v_class_ancestry a
           WHERE a.ancestor_id = (SELECT range_class_id FROM properties WHERE id = ?)
         )
       )
       AND c.pref_label LIKE ?
       ORDER BY c.pref_label
       LIMIT ?`,
      [propertyId, propertyId, like, limit]
    ).map(r => this._conceptFromRow(r));
  }

  // -- Misc ------------------------------------------------------------------

  public getStats(): IOntologyStats {
    const one = (sql: string): number => {
      const r = this._rows(sql);
      return r.length ? Number(r[0][0]) : 0;
    };
    return {
      concepts: one('SELECT COUNT(*) FROM concepts'),
      classes: one('SELECT COUNT(*) FROM classes'),
      // Pairs counted once, matching the Model tab — not raw rows, which
      // would double every inverse pair and drag in label types and
      // metadata fields.
      properties: one(
        `SELECT COUNT(*) FROM properties p
         WHERE p.is_label_property = 0
           AND (p.flags_json IS NULL OR p.flags_json NOT LIKE '%DatatypeProperty%')
           AND (p.inverse_property_id IS NULL OR p.id <= p.inverse_property_id)`
      ),
      relationships: one('SELECT COUNT(*) FROM relationships'),
      broaderEdges: one('SELECT COUNT(*) FROM broader'),
      labels: one('SELECT COUNT(*) FROM labels')
    };
  }

  /** Provenance written by tools/import-ttl.ts. */
  public getImportMetadata(): { [key: string]: string } {
    const out: { [key: string]: string } = {};
    for (const r of this._rows('SELECT key, value FROM import_metadata')) {
      out[String(r[0])] = String(r[1]);
    }
    return out;
  }
}
