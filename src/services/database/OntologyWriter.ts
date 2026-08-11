/**
 * Every mutation to the ontology goes through here.
 *
 * Two rules this class exists to enforce, both from docs/ARCHITECTURE.md:
 *
 *  - **Decision 3** — a relationship is ONE row; the mirror is derived by
 *    `v_concept_links`. Writing both directions by hand is what let the source
 *    data drift (HasInterestIn 985 vs IsInterestOf 982). Adding a link from the
 *    inverse end therefore stores the *forward* row of the inverse property,
 *    and deleting from either end deletes the single stored row.
 *  - **Decision 5** — every change is journalled to `changes`, which buys undo,
 *    an audit trail, and the change-set export. No mutation may bypass it.
 *
 * It also reimplements the constraint Semaphore enforced in its own UI and
 * which dies with it: preferred labels must be unique **within a class**, not
 * globally (five labels are legitimately shared across classes today).
 */

import { Database } from 'sql.js';
import {
  SKOSXL_PREF_LABEL, SKOS_BROADER, RDF_TYPE, RDFS_LABEL,
  OWL_OBJECT_PROPERTY, OWL_CLASS, SKOS_DEFINITION
} from '../turtle/Vocabulary';

/** Namespace for concepts created in this editor, so provenance stays visible. */
export const NEW_CONCEPT_NAMESPACE = 'http://example.com/InlandRevenueModel-editor#';

export interface IValidationError {
  field: string;
  message: string;
}

export class ValidationFailure extends Error {
  public errors: IValidationError[];
  public constructor(errors: IValidationError[]) {
    super(errors.map(e => e.message).join('; '));
    this.name = 'ValidationFailure';
    this.errors = errors;
  }
}

/** A label's matching settings. `undefined` = not set = Semaphore's "Default". */
export interface ILabelFlagEdit {
  [predicateUri: string]: string | undefined;
}

function uuid(): string {
  const c = (typeof crypto !== 'undefined' ? crypto : undefined) as
    { randomUUID?: () => string } | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Turn a label into a URI-safe local name, matching the model's existing style. */
function slugify(label: string): string {
  const base = label
    .replace(/[^A-Za-z0-9\- ]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return base || `Concept-${Date.now()}`;
}

export class OntologyWriter {
  private _db: Database;
  private _author: string;
  private _dirty: boolean = false;

  public constructor(db: Database, author: string) {
    this._db = db;
    this._author = author;
  }

  public get isDirty(): boolean {
    return this._dirty;
  }

  public markClean(): void {
    this._dirty = false;
  }

  // -- internals -------------------------------------------------------------

  private _rows(sql: string, params: unknown[] = []): unknown[][] {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params as never);
      const out: unknown[][] = [];
      while (stmt.step()) out.push(stmt.get() as unknown[]);
      return out;
    } finally {
      stmt.free();
    }
  }

  private _run(sql: string, params: unknown[] = []): void {
    const stmt = this._db.prepare(sql);
    try {
      stmt.run(params as never);
    } finally {
      stmt.free();
    }
  }

  private _lastId(): number {
    return this._db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
  }

  private _one(sql: string, params: unknown[] = []): unknown {
    const r = this._rows(sql, params);
    return r.length ? r[0][0] : undefined;
  }

  /** Record a change. Every public mutation calls this; nothing else may write. */
  private _journal(
    op: 'insert' | 'update' | 'delete',
    entity: 'concept' | 'relationship' | 'label' | 'annotation' | 'broader' | 'class',
    entityUri: string | undefined,
    detail: unknown
  ): void {
    this._run(
      'INSERT INTO changes (author, op, entity, entity_uri, detail_json) VALUES (?, ?, ?, ?, ?)',
      [this._author, op, entity, entityUri || null, JSON.stringify(detail)]
    );
    this._dirty = true;
  }

  private _conceptUri(conceptId: number): string | undefined {
    const v = this._one('SELECT uri FROM concepts WHERE id = ?', [conceptId]);
    return v === undefined || v === null ? undefined : String(v);
  }

  // -- validation ------------------------------------------------------------

  /**
   * Semaphore's unique-concept-label-in-class rule. Global uniqueness would
   * reject valid existing data, so scope it to the class — and treat "no class"
   * as its own bucket rather than matching everything.
   */
  public checkLabelUniqueInClass(
    label: string,
    classId: number | undefined,
    exceptConceptId?: number
  ): IValidationError[] {
    const params: unknown[] = [label.trim()];
    let sql = 'SELECT COUNT(*) FROM concepts WHERE pref_label = ? AND ';
    if (classId === undefined || classId === null) {
      sql += 'class_id IS NULL';
    } else {
      sql += 'class_id = ?';
      params.push(classId);
    }
    if (exceptConceptId !== undefined) {
      sql += ' AND id <> ?';
      params.push(exceptConceptId);
    }
    const n = Number(this._one(sql, params) || 0);
    return n > 0
      ? [{
          field: 'prefLabel',
          message: `Another concept in this class is already called "${label.trim()}". ` +
                   `Labels must be unique within a class.`
        }]
      : [];
  }

  /** Is `propertyId` allowed from this source, and is the target the right class? */
  public checkRelationshipAllowed(
    sourceConceptId: number,
    propertyId: number,
    targetConceptId: number
  ): IValidationError[] {
    const errors: IValidationError[] = [];

    const allowed = Number(this._one(
      'SELECT COUNT(*) FROM v_allowed_properties WHERE concept_id = ? AND property_id = ?',
      [sourceConceptId, propertyId]
    ) || 0);
    if (!allowed) {
      const propLabel = this._one('SELECT label FROM properties WHERE id = ?', [propertyId]);
      errors.push({
        field: 'property',
        message: `"${String(propLabel)}" is not declared for this concept's class.`
      });
    }

    const rangeClassId = this._one('SELECT range_class_id FROM properties WHERE id = ?', [propertyId]);
    if (rangeClassId !== undefined && rangeClassId !== null) {
      const ok = Number(this._one(
        `SELECT COUNT(*) FROM concepts c
         JOIN v_class_ancestry a ON a.class_id = c.class_id
         WHERE c.id = ? AND a.ancestor_id = ?`,
        [targetConceptId, rangeClassId]
      ) || 0);
      if (!ok) {
        const rangeLabel = this._one('SELECT label FROM classes WHERE id = ?', [rangeClassId]);
        errors.push({
          field: 'target',
          message: `The target must be a ${String(rangeLabel)}.`
        });
      }
    }

    return errors;
  }

  // -- concepts --------------------------------------------------------------

  /**
   * Create a concept, optionally under a parent. Returns the new concept id.
   * New URIs use a dedicated namespace so anything created after the migration
   * is visibly distinguishable from what came out of Semaphore.
   */
  public createConcept(options: {
    prefLabel: string;
    classId?: number;
    parentConceptId?: number;
    lang?: string;
  }): number {
    const label = options.prefLabel.trim();
    if (!label) throw new ValidationFailure([{ field: 'prefLabel', message: 'A label is required.' }]);

    const errors = this.checkLabelUniqueInClass(label, options.classId);
    if (errors.length) throw new ValidationFailure(errors);

    // Ensure the URI is unique even if two concepts slugify identically.
    let uri = NEW_CONCEPT_NAMESPACE + slugify(label);
    if (this._one('SELECT 1 FROM concepts WHERE uri = ?', [uri]) !== undefined) {
      uri = `${uri}-${uuid().slice(0, 8)}`;
    }
    const guid = uuid();

    this._run(
      'INSERT INTO concepts (uri, guid, class_id, pref_label) VALUES (?, ?, ?, ?)',
      [uri, guid, options.classId === undefined ? null : options.classId, label]
    );
    const conceptId = this._lastId();

    // The prefLabel also lives in `labels` — that is the source of truth, with
    // concepts.pref_label a denormalised copy for display and search.
    this._run(
      'INSERT INTO labels (uri, concept_id, label_property, literal_form, lang) VALUES (?, ?, ?, ?, ?)',
      [`${uri}/${slugify(label)}_${options.lang || 'en'}`, conceptId, SKOSXL_PREF_LABEL, label, options.lang || 'en']
    );

    this._journal('insert', 'concept', uri, {
      prefLabel: label, classId: options.classId, guid, parentConceptId: options.parentConceptId
    });

    if (options.parentConceptId !== undefined) {
      this.addBroader(conceptId, options.parentConceptId);
    }
    return conceptId;
  }

  /** Rename a concept: updates the prefLabel row and the denormalised copy. */
  public renameConcept(conceptId: number, newLabel: string): void {
    const label = newLabel.trim();
    if (!label) throw new ValidationFailure([{ field: 'prefLabel', message: 'A label is required.' }]);

    const classId = this._one('SELECT class_id FROM concepts WHERE id = ?', [conceptId]);
    const errors = this.checkLabelUniqueInClass(
      label, classId === null ? undefined : Number(classId), conceptId
    );
    if (errors.length) throw new ValidationFailure(errors);

    const before = this._one('SELECT pref_label FROM concepts WHERE id = ?', [conceptId]);

    this._run('UPDATE concepts SET pref_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [label, conceptId]);
    this._run('UPDATE labels SET literal_form = ? WHERE concept_id = ? AND label_property = ?',
      [label, conceptId, SKOSXL_PREF_LABEL]);

    this._journal('update', 'concept', this._conceptUri(conceptId),
      { field: 'prefLabel', before: before === null ? undefined : String(before), after: label });
  }

  public setConceptClass(conceptId: number, classId: number | undefined): void {
    // Moving into a class must honour the same rule as being created in it:
    // preferred labels are unique within a class.
    const label = this._one('SELECT pref_label FROM concepts WHERE id = ?', [conceptId]);
    if (label !== undefined && label !== null) {
      const errors = this.checkLabelUniqueInClass(String(label), classId, conceptId);
      if (errors.length) throw new ValidationFailure(errors);
    }
    const before = this._one('SELECT class_id FROM concepts WHERE id = ?', [conceptId]);
    this._run('UPDATE concepts SET class_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [classId === undefined ? null : classId, conceptId]);
    this._journal('update', 'concept', this._conceptUri(conceptId),
      { field: 'classId', before, after: classId });
  }

  /**
   * Delete a concept. Labels, annotations, relationships and hierarchy edges go
   * with it via ON DELETE CASCADE, so the caller is told what will be lost
   * first — see `describeDeleteImpact`.
   */
  public deleteConcept(conceptId: number): void {
    const uri = this._conceptUri(conceptId);
    const impact = this.describeDeleteImpact(conceptId);
    this._run('DELETE FROM concepts WHERE id = ?', [conceptId]);
    this._journal('delete', 'concept', uri, impact);
  }

  /** What deleting this concept would take with it. Show before confirming. */
  public describeDeleteImpact(conceptId: number): {
    prefLabel?: string; children: number; relationships: number; labels: number; annotations: number;
  } {
    const n = (sql: string): number => Number(this._one(sql, [conceptId]) || 0);
    const label = this._one('SELECT pref_label FROM concepts WHERE id = ?', [conceptId]);
    return {
      prefLabel: label === null || label === undefined ? undefined : String(label),
      children: n('SELECT COUNT(*) FROM broader WHERE parent_concept_id = ?'),
      // Both ends: a relationship stored elsewhere still disappears if this
      // concept is its target.
      relationships: Number(this._one(
        'SELECT COUNT(*) FROM relationships WHERE source_concept_id = ? OR target_concept_id = ?',
        [conceptId, conceptId]
      ) || 0),
      labels: n('SELECT COUNT(*) FROM labels WHERE concept_id = ?'),
      annotations: n('SELECT COUNT(*) FROM annotations WHERE concept_id = ?')
    };
  }

  // -- hierarchy -------------------------------------------------------------

  public addBroader(conceptId: number, parentConceptId: number): void {
    if (conceptId === parentConceptId) {
      throw new ValidationFailure([{ field: 'parent', message: 'A concept cannot be its own parent.' }]);
    }
    if (this._isDescendant(parentConceptId, conceptId)) {
      throw new ValidationFailure([{
        field: 'parent',
        message: 'That would create a loop — the chosen parent sits below this concept.'
      }]);
    }
    this._run('INSERT OR IGNORE INTO broader (concept_id, parent_concept_id) VALUES (?, ?)',
      [conceptId, parentConceptId]);
    this._journal('insert', 'broader', this._conceptUri(conceptId),
      { parent: this._conceptUri(parentConceptId) });
  }

  public removeBroader(conceptId: number, parentConceptId: number): void {
    this._run('DELETE FROM broader WHERE concept_id = ? AND parent_concept_id = ?',
      [conceptId, parentConceptId]);
    this._journal('delete', 'broader', this._conceptUri(conceptId),
      { parent: this._conceptUri(parentConceptId) });
  }

  /** Re-parent in one step, so the tree is never transiently orphaned. */
  public moveConcept(conceptId: number, fromParentId: number, toParentId: number): void {
    this.addBroader(conceptId, toParentId);
    this.removeBroader(conceptId, fromParentId);
  }

  /** Walks down from `ancestorId` looking for `candidateId`. Cycle-safe. */
  private _isDescendant(candidateId: number, ancestorId: number): boolean {
    const seen: { [id: number]: true } = {};
    const stack = [ancestorId];
    while (stack.length) {
      const current = stack.pop() as number;
      if (seen[current]) continue;
      seen[current] = true;
      if (current === candidateId && current !== ancestorId) return true;
      for (const r of this._rows('SELECT concept_id FROM broader WHERE parent_concept_id = ?', [current])) {
        const child = Number(r[0]);
        if (child === candidateId) return true;
        stack.push(child);
      }
    }
    return false;
  }

  // -- relationships ---------------------------------------------------------

  /**
   * Add a relationship. Stores exactly one row.
   *
   * If the pair already exists in the opposite direction (because the user is
   * adding from the far end), nothing is inserted — the view already renders
   * it from both ends, and a second row would be the very duplication that let
   * the source data drift.
   */
  public addRelationship(sourceConceptId: number, propertyId: number, targetConceptId: number): void {
    const errors = this.checkRelationshipAllowed(sourceConceptId, propertyId, targetConceptId);
    if (errors.length) throw new ValidationFailure(errors);

    const inverseId = this._one('SELECT inverse_property_id FROM properties WHERE id = ?', [propertyId]);
    if (inverseId !== undefined && inverseId !== null) {
      const mirrorExists = Number(this._one(
        'SELECT COUNT(*) FROM relationships WHERE source_concept_id = ? AND property_id = ? AND target_concept_id = ?',
        [targetConceptId, inverseId, sourceConceptId]
      ) || 0);
      if (mirrorExists) return;   // already represented; the view derives this direction
    }

    this._run(
      'INSERT OR IGNORE INTO relationships (source_concept_id, property_id, target_concept_id) VALUES (?, ?, ?)',
      [sourceConceptId, propertyId, targetConceptId]
    );
    this._journal('insert', 'relationship', this._conceptUri(sourceConceptId), {
      property: this._one('SELECT uri FROM properties WHERE id = ?', [propertyId]),
      target: this._conceptUri(targetConceptId)
    });
  }

  /**
   * Delete a relationship by its stored row id. The UI may be showing the
   * derived inverse, but `v_concept_links` carries the underlying
   * relationship_id either way, so one call handles both ends.
   */
  public deleteRelationship(relationshipId: number): void {
    const row = this._rows(
      `SELECT s.uri, p.uri, t.uri
       FROM relationships r
       JOIN concepts s ON s.id = r.source_concept_id
       JOIN properties p ON p.id = r.property_id
       JOIN concepts t ON t.id = r.target_concept_id
       WHERE r.id = ?`,
      [relationshipId]
    )[0];
    this._run('DELETE FROM relationships WHERE id = ?', [relationshipId]);
    this._journal('delete', 'relationship', row ? String(row[0]) : undefined,
      row ? { property: row[1], target: row[2] } : {});
  }

  // -- labels ----------------------------------------------------------------

  /**
   * Add an alternative label (acronym, shoulder code, Maori term, …).
   *
   * `flags` are the matching settings. Omitting a key means "Default" — which
   * in the data means the predicate is absent, not present-with-a-default. That
   * distinction is why flags are written only when explicitly set.
   */
  public addLabel(options: {
    conceptId: number;
    labelProperty: string;
    literalForm: string;
    lang?: string;
    flags?: ILabelFlagEdit;
  }): number {
    const form = options.literalForm.trim();
    if (!form) throw new ValidationFailure([{ field: 'literalForm', message: 'A value is required.' }]);

    const conceptUri = this._conceptUri(options.conceptId);
    const uri = `${conceptUri}/${slugify(form)}_${options.lang || 'en'}`;

    this._run(
      'INSERT INTO labels (uri, concept_id, label_property, literal_form, lang, flags_json) VALUES (?, ?, ?, ?, ?, ?)',
      [uri, options.conceptId, options.labelProperty, form, options.lang || 'en',
       this._encodeFlags(options.flags)]
    );
    const id = this._lastId();
    this._journal('insert', 'label', conceptUri,
      { labelProperty: options.labelProperty, literalForm: form, flags: options.flags });
    return id;
  }

  public updateLabel(labelId: number, literalForm: string, flags?: ILabelFlagEdit): void {
    const form = literalForm.trim();
    if (!form) throw new ValidationFailure([{ field: 'literalForm', message: 'A value is required.' }]);

    const before = this._rows(
      'SELECT literal_form, flags_json, concept_id FROM labels WHERE id = ?', [labelId]
    )[0];

    this._run('UPDATE labels SET literal_form = ?, flags_json = ? WHERE id = ?',
      [form, this._encodeFlags(flags), labelId]);

    // Keep the denormalised copy in step when the preferred label changes.
    const isPref = this._one('SELECT 1 FROM labels WHERE id = ? AND label_property = ?',
      [labelId, SKOSXL_PREF_LABEL]);
    if (isPref !== undefined && before) {
      this._run('UPDATE concepts SET pref_label = ? WHERE id = ?', [form, Number(before[2])]);
    }

    this._journal('update', 'label', before ? this._conceptUri(Number(before[2])) : undefined,
      { before: before ? before[0] : undefined, after: form, flags });
  }

  public deleteLabel(labelId: number): void {
    const before = this._rows(
      'SELECT literal_form, label_property, concept_id FROM labels WHERE id = ?', [labelId]
    )[0];
    if (before && String(before[1]) === SKOSXL_PREF_LABEL) {
      throw new ValidationFailure([{
        field: 'label',
        message: 'The preferred label cannot be deleted — rename the concept instead.'
      }]);
    }
    this._run('DELETE FROM labels WHERE id = ?', [labelId]);
    this._journal('delete', 'label', before ? this._conceptUri(Number(before[2])) : undefined,
      before ? { literalForm: before[0], labelProperty: before[1] } : {});
  }

  /**
   * Flags are stored term-preserving (`{pred: [{v, t, lang?, dt?}]}`) so the
   * Turtle exporter can replay them verbatim. Matching settings are always
   * IRIs, and an unset key is omitted entirely — that absence *is* "Default".
   */
  private _encodeFlags(flags?: ILabelFlagEdit): string | null {
    if (!flags) return null;
    const out: { [k: string]: Array<{ v: string; t: 'i' }> } = {};
    for (const key of Object.keys(flags)) {
      const value = flags[key];
      if (value === undefined || value === '') continue;   // "Default" -> absent
      out[key] = [{ v: value, t: 'i' }];
    }
    return Object.keys(out).length ? JSON.stringify(out) : null;
  }

  // -- classes (schema-level) ------------------------------------------------

  /**
   * Define a new concept class. A model-level change: the class becomes a
   * choice on every concept and a valid domain/range for relationship types.
   * The colour is Semaphore's tree swatch (sem:color), stored the way the
   * importer stores it so export re-emits it identically.
   */
  public createClass(options: {
    label: string;
    parentClassId?: number;
    /** `#rrggbb` or `rrggbb`. */
    colour?: string;
    definition?: string;
  }): number {
    const label = options.label.trim();
    if (!label) throw new ValidationFailure([{ field: 'label', message: 'A name is required.' }]);
    if (this._one('SELECT 1 FROM classes WHERE label = ?', [label]) !== undefined) {
      throw new ValidationFailure([{ field: 'label', message: `A class called "${label}" already exists.` }]);
    }

    let uri = NEW_CONCEPT_NAMESPACE + slugify(label);
    if (this._one('SELECT 1 FROM classes WHERE uri = ?', [uri]) !== undefined) {
      uri = `${uri}-${uuid().slice(0, 8)}`;
    }
    const colour = options.colour ? options.colour.replace(/^#/, '').toLowerCase() : undefined;

    // The exporter replays rdf:type, rdfs:label, skos:definition and sem:color
    // from flags_json — same invariant as createPropertyPair, see there.
    const flags: { [k: string]: Array<{ v: string; t: string; lang?: string; dt?: string }> } = {
      [RDF_TYPE]: [{ v: OWL_CLASS, t: 'i' }],
      [RDFS_LABEL]: [{ v: label, t: 'l', lang: 'en' }]
    };
    if (options.definition) flags[SKOS_DEFINITION] = [{ v: options.definition, t: 'l', lang: 'en' }];
    if (colour) flags[SEM + 'color'] = [{ v: colour, t: 'l', dt: 'http://www.w3.org/2001/XMLSchema#hexBinary' }];

    this._run(
      'INSERT INTO classes (uri, label, definition, parent_class_id, flags_json) VALUES (?, ?, ?, ?, ?)',
      [uri, label, options.definition || null,
       options.parentClassId === undefined ? null : options.parentClassId, JSON.stringify(flags)]
    );
    const id = this._lastId();
    this._journal('insert', 'class', uri, {
      label, parentClassId: options.parentClassId, colour, definition: options.definition
    });
    return id;
  }

  /** Rename a class or change its definition/colour. URI never changes. */
  public updateClass(classId: number, changes: {
    label?: string; definition?: string; colour?: string;
  }): void {
    const row = this._rows('SELECT uri, label, definition, flags_json FROM classes WHERE id = ?', [classId])[0];
    if (!row) throw new ValidationFailure([{ field: 'class', message: 'That class no longer exists.' }]);
    const [uri, oldLabel, oldDefinition, flagsJson] = [String(row[0]), row[1], row[2], row[3]];

    const label = changes.label === undefined ? undefined : changes.label.trim();
    if (label !== undefined) {
      if (!label) throw new ValidationFailure([{ field: 'label', message: 'A name is required.' }]);
      const clash = this._one('SELECT 1 FROM classes WHERE label = ? AND id != ?', [label, classId]);
      if (clash !== undefined) {
        throw new ValidationFailure([{ field: 'label', message: `A class called "${label}" already exists.` }]);
      }
    }

    // Patch the columns AND the flags terms the exporter replays.
    let flags: { [k: string]: Array<{ v: string; t: string; lang?: string; dt?: string }> } = {};
    try { flags = flagsJson ? JSON.parse(String(flagsJson)) : {}; } catch { flags = {}; }
    if (label !== undefined) flags[RDFS_LABEL] = [{ v: label, t: 'l', lang: 'en' }];
    if (changes.definition !== undefined) {
      if (changes.definition) flags[SKOS_DEFINITION] = [{ v: changes.definition, t: 'l', lang: 'en' }];
      else delete flags[SKOS_DEFINITION];
    }
    if (changes.colour !== undefined) {
      const colour = changes.colour.replace(/^#/, '').toLowerCase();
      if (colour) flags[SEM + 'color'] = [{ v: colour, t: 'l', dt: 'http://www.w3.org/2001/XMLSchema#hexBinary' }];
      else delete flags[SEM + 'color'];
    }

    this._run(
      'UPDATE classes SET label = COALESCE(?, label), definition = ?, flags_json = ? WHERE id = ?',
      [label === undefined ? null : label,
       changes.definition === undefined ? (oldDefinition === undefined ? null : oldDefinition) : (changes.definition || null),
       JSON.stringify(flags), classId]
    );
    this._journal('update', 'class', uri, {
      before: { label: oldLabel, definition: oldDefinition }, after: changes
    });
  }

  /**
   * Delete a class. Refused while anything references it — silently nulling
   * concepts' classes (which the FK would do) loses information.
   */
  public deleteClass(classId: number): void {
    const row = this._rows('SELECT uri, label FROM classes WHERE id = ?', [classId])[0];
    if (!row) return;
    const n = (sql: string, p: unknown[]): number => Number(this._one(sql, p) || 0);
    const concepts = n('SELECT COUNT(*) FROM concepts WHERE class_id = ?', [classId]);
    const children = n('SELECT COUNT(*) FROM classes WHERE parent_class_id = ?', [classId]);
    const properties = n(
      'SELECT COUNT(*) FROM properties WHERE domain_class_id = ? OR range_class_id = ?',
      [classId, classId]
    );
    const blockers: string[] = [];
    if (concepts) blockers.push(`${concepts} concept${concepts === 1 ? '' : 's'} of this class`);
    if (children) blockers.push(`${children} subclass${children === 1 ? '' : 'es'}`);
    if (properties) blockers.push(`${properties} relationship type${properties === 1 ? '' : 's'} using it as domain or range`);
    if (blockers.length) {
      throw new ValidationFailure([{
        field: 'class',
        message: `Cannot delete "${String(row[1])}" — still referenced by ${blockers.join(', ')}.`
      }]);
    }
    this._run('DELETE FROM classes WHERE id = ?', [classId]);
    this._journal('delete', 'class', String(row[0]), { label: row[1] });
  }

  // -- relationship TYPES (schema-level) -------------------------------------

  /**
   * Define a new relationship type, and usually its inverse at the same time.
   *
   * This is a change to the *model*, not to a concept: it adds an
   * `owl:ObjectProperty` with a domain and range, which then governs every
   * future use. Creating the pair together is deliberate — 142 of the model's
   * 151 properties are paired, and a one-directional relationship is a
   * decision worth making explicitly rather than by omission.
   *
   * Returns the new property id (and the inverse's, when created).
   */
  public createPropertyPair(options: {
    label: string;
    inverseLabel?: string;
    domainClassId?: number;
    rangeClassId?: number;
    definition?: string;
    /** Defaults to skos:related, matching how the model declares its own. */
    subPropertyOf?: string;
  }): { propertyId: number; inversePropertyId?: number } {
    const label = options.label.trim();
    if (!label) {
      throw new ValidationFailure([{ field: 'label', message: 'A name is required.' }]);
    }
    if (options.inverseLabel && options.inverseLabel.trim() === label) {
      throw new ValidationFailure([{
        field: 'inverseLabel',
        message: 'The inverse needs a different name — it reads in the opposite direction.'
      }]);
    }

    const existing = this._one('SELECT 1 FROM properties WHERE label = ?', [label]);
    if (existing !== undefined) {
      throw new ValidationFailure([{
        field: 'label', message: `A relationship type called "${label}" already exists.`
      }]);
    }

    const sub = options.subPropertyOf || 'http://www.w3.org/2004/02/skos/core#related';

    const insert = (lbl: string, domainId?: number, rangeId?: number): number => {
      let uri = NEW_CONCEPT_NAMESPACE + slugify(lbl);
      if (this._one('SELECT 1 FROM properties WHERE uri = ?', [uri]) !== undefined) {
        uri = `${uri}-${uuid().slice(0, 8)}`;
      }

      // The exporter replays rdf:type, rdfs:label and skos:definition from
      // flags_json — the importer leaves them there so multiple types and
      // language tags survive. A new property with empty flags would therefore
      // export with NO type and NO label, i.e. not recognisably a property at
      // all. Seed them here.
      const flags = JSON.stringify({
        [RDF_TYPE]: [{ v: OWL_OBJECT_PROPERTY, t: 'i' }],
        [RDFS_LABEL]: [{ v: lbl, t: 'l', lang: 'en' }],
        ...(options.definition
          ? { [SKOS_DEFINITION]: [{ v: options.definition, t: 'l', lang: 'en' }] }
          : {})
      });

      this._run(
        `INSERT INTO properties
           (uri, label, domain_class_id, range_class_id, sub_property_of, is_label_property,
            definition, flags_json)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [uri, lbl, domainId === undefined ? null : domainId,
         rangeId === undefined ? null : rangeId, sub, options.definition || null, flags]
      );
      const id = this._lastId();
      this._journal('insert', 'relationship', uri, {
        kind: 'propertyDefinition', label: lbl, domainClassId: domainId, rangeClassId: rangeId
      });
      return id;
    };

    const propertyId = insert(label, options.domainClassId, options.rangeClassId);

    let inversePropertyId: number | undefined;
    if (options.inverseLabel && options.inverseLabel.trim()) {
      // The inverse reads the other way, so its domain and range swap.
      inversePropertyId = insert(
        options.inverseLabel.trim(), options.rangeClassId, options.domainClassId
      );
      this._run('UPDATE properties SET inverse_property_id = ? WHERE id = ?', [inversePropertyId, propertyId]);
      this._run('UPDATE properties SET inverse_property_id = ? WHERE id = ?', [propertyId, inversePropertyId]);
    }

    return { propertyId, inversePropertyId };
  }

  /**
   * Rename a relationship type or change its definition; optionally rename its
   * inverse in the same call. Domain and range are deliberately NOT editable —
   * changing them would silently invalidate existing links; delete and
   * recreate instead if the constraint was wrong.
   */
  public updatePropertyPair(propertyId: number, changes: {
    label?: string; inverseLabel?: string; definition?: string;
  }): void {
    const row = this._rows(
      'SELECT uri, label, definition, inverse_property_id FROM properties WHERE id = ?', [propertyId]
    )[0];
    if (!row) throw new ValidationFailure([{ field: 'property', message: 'That relationship type no longer exists.' }]);
    const inverseId = row[3] === null || row[3] === undefined ? undefined : Number(row[3]);

    const apply = (id: number, uri: string, label?: string, definition?: string): void => {
      if (label !== undefined) {
        const trimmed = label.trim();
        if (!trimmed) throw new ValidationFailure([{ field: 'label', message: 'A name is required.' }]);
        const clash = this._one('SELECT 1 FROM properties WHERE label = ? AND id != ?', [trimmed, id]);
        if (clash !== undefined) {
          throw new ValidationFailure([{ field: 'label', message: `A relationship type called "${trimmed}" already exists.` }]);
        }
      }
      const fj = this._one('SELECT flags_json FROM properties WHERE id = ?', [id]);
      let flags: { [k: string]: Array<{ v: string; t: string; lang?: string }> } = {};
      try { flags = fj ? JSON.parse(String(fj)) : {}; } catch { flags = {}; }
      if (label !== undefined) flags[RDFS_LABEL] = [{ v: label.trim(), t: 'l', lang: 'en' }];
      if (definition !== undefined) {
        if (definition) flags[SKOS_DEFINITION] = [{ v: definition, t: 'l', lang: 'en' }];
        else delete flags[SKOS_DEFINITION];
      }
      this._run(
        'UPDATE properties SET label = COALESCE(?, label), definition = COALESCE(?, definition), flags_json = ? WHERE id = ?',
        [label === undefined ? null : label.trim(),
         definition === undefined ? null : (definition || null), JSON.stringify(flags), id]
      );
      this._journal('update', 'relationship', uri, { kind: 'propertyDefinition', changes: { label, definition } });
    };

    apply(propertyId, String(row[0]), changes.label, changes.definition);
    if (changes.inverseLabel !== undefined && inverseId !== undefined) {
      const invUri = this._one('SELECT uri FROM properties WHERE id = ?', [inverseId]);
      apply(inverseId, String(invUri), changes.inverseLabel, undefined);
    }
  }

  /**
   * Delete a relationship type and its inverse. Refused while any link uses
   * either direction — those links would become undisplayable.
   */
  public deletePropertyPair(propertyId: number): void {
    const row = this._rows(
      'SELECT uri, label, inverse_property_id FROM properties WHERE id = ?', [propertyId]
    )[0];
    if (!row) return;
    const inverseId = row[2] === null || row[2] === undefined ? undefined : Number(row[2]);

    const ids = inverseId !== undefined && inverseId !== propertyId ? [propertyId, inverseId] : [propertyId];
    const usage = Number(this._one(
      `SELECT COUNT(*) FROM relationships WHERE property_id IN (${ids.map(() => '?').join(',')})`, ids
    ) || 0);
    if (usage) {
      throw new ValidationFailure([{
        field: 'property',
        message: `Cannot delete "${String(row[1])}" — ${usage} relationship${usage === 1 ? '' : 's'} use it. Remove those first.`
      }]);
    }

    for (const id of ids) {
      const uri = this._one('SELECT uri FROM properties WHERE id = ?', [id]);
      this._run('DELETE FROM properties WHERE id = ?', [id]);
      this._journal('delete', 'relationship', uri === undefined ? undefined : String(uri), {
        kind: 'propertyDefinition'
      });
    }
  }

  // -- annotations (metadata) ------------------------------------------------

  public addAnnotation(conceptId: number, predicateUri: string, value: string, lang?: string): number {
    this._run(
      'INSERT INTO annotations (concept_id, predicate_uri, value, lang) VALUES (?, ?, ?, ?)',
      [conceptId, predicateUri, value, lang || null]
    );
    const id = this._lastId();
    this._journal('insert', 'annotation', this._conceptUri(conceptId), { predicateUri, value });
    return id;
  }

  public updateAnnotation(annotationId: number, value: string): void {
    const before = this._rows(
      'SELECT value, predicate_uri, concept_id FROM annotations WHERE id = ?', [annotationId]
    )[0];
    this._run('UPDATE annotations SET value = ? WHERE id = ?', [value, annotationId]);
    this._journal('update', 'annotation', before ? this._conceptUri(Number(before[2])) : undefined,
      { predicateUri: before ? before[1] : undefined, before: before ? before[0] : undefined, after: value });
  }

  public deleteAnnotation(annotationId: number): void {
    const before = this._rows(
      'SELECT value, predicate_uri, concept_id FROM annotations WHERE id = ?', [annotationId]
    )[0];
    this._run('DELETE FROM annotations WHERE id = ?', [annotationId]);
    this._journal('delete', 'annotation', before ? this._conceptUri(Number(before[2])) : undefined,
      before ? { predicateUri: before[1], value: before[0] } : {});
  }

  // -- change log ------------------------------------------------------------

  public getChangeCount(): number {
    return Number(this._one('SELECT COUNT(*) FROM changes') || 0);
  }

  public getRecentChanges(limit: number = 50): Array<{
    id: number; changedAt: string; author: string; op: string; entity: string;
    entityUri: string | undefined; detail: string | undefined;
  }> {
    return this._rows(
      `SELECT id, changed_at, author, op, entity, entity_uri, detail_json
       FROM changes ORDER BY id DESC LIMIT ?`, [limit]
    ).map(r => ({
      id: Number(r[0]),
      changedAt: String(r[1]),
      author: String(r[2]),
      op: String(r[3]),
      entity: String(r[4]),
      entityUri: r[5] === null ? undefined : String(r[5]),
      detail: r[6] === null ? undefined : String(r[6])
    }));
  }
}

/** The matching-setting predicates Semaphore exposes, in its dialog's order. */
export const SEM = 'http://www.smartlogic.com/2014/08/semaphore-core#';

export interface IFlagOption { value: string; text: string }

export interface IFlagDefinition {
  predicate: string;
  label: string;
  options: IFlagOption[];
}

/**
 * Mirrors Semaphore's "Edit Label Settings" dialog. Every control is
 * tri-state — an absent value means Default, so "Default" must write nothing
 * rather than writing a default-valued triple.
 */
export const LABEL_FLAG_DEFINITIONS: IFlagDefinition[] = [
  {
    predicate: `${SEM}caseSensitivity`, label: 'Case sensitivity',
    options: [{ value: `${SEM}CaseSensitive`, text: 'On' }, { value: `${SEM}CaseInsensitive`, text: 'Off' }]
  },
  {
    predicate: `${SEM}rulebaseAction`, label: 'Rulebase action',
    options: [
      { value: `${SEM}RulebaseActionGenerate`, text: 'Generate rulebase' },
      { value: `${SEM}RulebaseActionDoNotGenerate`, text: 'Do not generate' }
    ]
  },
  {
    predicate: `${SEM}rulebaseBehaviour`, label: 'Behaviour in rulebase',
    options: [
      { value: `${SEM}RulebaseBehaviourExactPhrase`, text: 'Exact phrase' },
      { value: `${SEM}RulebaseBehaviourAllowPhraseVariants`, text: 'Allow phrase variants' }
    ]
  },
  {
    predicate: `${SEM}rulebaseInfluence`, label: 'Influence in rulebase',
    options: [
      { value: `${SEM}RulebaseInfluenceHigh`, text: 'High' },
      { value: `${SEM}RulebaseInfluenceLow`, text: 'Low' },
      { value: `${SEM}RulebaseInfluenceNone`, text: 'None' },
      { value: `${SEM}RulebaseInfluenceTagIfPresent`, text: 'Tag if present' }
    ]
  },
  {
    predicate: `${SEM}stemming`, label: 'Stemming',
    options: [{ value: `${SEM}StemmingOn`, text: 'On' }, { value: `${SEM}StemmingOff`, text: 'Off' }]
  },
  {
    predicate: `${SEM}conceptMapping`, label: 'Use for concept mapping',
    options: [{ value: `${SEM}ConceptMappingOn`, text: 'On' }, { value: `${SEM}ConceptMappingOff`, text: 'Off' }]
  },
  {
    predicate: `${SEM}autocompletion`, label: 'Autocompletion',
    options: [{ value: `${SEM}AutocompletionOn`, text: 'On' }, { value: `${SEM}AutocompletionOff`, text: 'Off' }]
  },
  {
    predicate: `${SEM}alphabeticalIndex`, label: 'Alphabetical index',
    options: [
      { value: `${SEM}AlphabeticalIndexingOn`, text: 'On' },
      { value: `${SEM}AlphabeticalIndexingOff`, text: 'Off' }
    ]
  }
];

export { SKOS_BROADER };
