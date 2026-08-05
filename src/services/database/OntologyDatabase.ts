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

import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js';
import {
  IConcept, IConceptDetail, IConceptLink, IAllowedProperty,
  ILabel, IAnnotation, IOntologyClass, IOntologyProperty, IOntologyStats
} from '../../models/IOntology';

/** Nullable column -> undefined, so callers never see null. */
function str(v: SqlValue): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}
function num(v: SqlValue): number | undefined {
  return v === null || v === undefined ? undefined : Number(v);
}

/** flags_json holds every Semaphore predicate not promoted to a column. */
function parseFlags(v: SqlValue): { [k: string]: string | string[] } | undefined {
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
  }

  /**
   * @param bytes  the .sqlite file contents
   * @param wasmLocateFile  maps 'sql-wasm.wasm' to a URL inside the bundle.
   *   Must resolve to a bundled asset — SharePoint's CSP blocks CDN fetches.
   */
  public static async load(
    bytes: ArrayBuffer,
    wasmLocateFile: (file: string) => string
  ): Promise<OntologyDatabase> {
    const SQL: SqlJsStatic = await initSqlJs({ locateFile: wasmLocateFile });
    return new OntologyDatabase(new SQL.Database(new Uint8Array(bytes)));
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
      `SELECT id, predicate_uri, value, lang FROM annotations
       WHERE concept_id = ? ORDER BY predicate_uri`,
      [conceptId]
    ).map(r => ({
      id: Number(r[0]),
      predicateUri: String(r[1]),
      value: str(r[2]),
      lang: str(r[3])
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
        const v = cls.flags[key];
        return `#${Array.isArray(v) ? v[0] : v}`;
      }
    }
    return undefined;
  }

  public getProperties(): IOntologyProperty[] {
    return this._rows(
      `SELECT id, uri, label, domain_class_id, range_class_id, inverse_property_id,
              sub_property_of, definition, comment, flags_json
       FROM properties WHERE is_label_property = 0 ORDER BY label`
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
      properties: one('SELECT COUNT(*) FROM properties'),
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
