/**
 * Integrity failures, explained and navigable.
 *
 * `INTEGRITY_CHECKS` answers "is anything broken?" with a count. That is the
 * right thing to block a publish on, but a count cannot be acted on: "relationships
 * with missing source = 2" tells an author nothing about WHICH two, or where to look.
 *
 * This turns each failing check into one row per problem, carrying:
 *   - a sentence naming what is wrong, in the author's vocabulary
 *   - `conceptId`, the concept to select so the author can SEE the damage
 *
 * On `conceptId`: for a dangling relationship the broken end is a concept that no
 * longer exists, so there is nothing to navigate to. The anchor is therefore the
 * end that SURVIVED — the concept still holding a relationship to a ghost. That is
 * both the only thing that can be shown and the thing the author has to fix.
 */
import type { Database } from 'sql.js';

export interface IIntegrityProblem {
  /** Which INTEGRITY_CHECKS label this came from. */
  check: string;
  /** One sentence, for an author rather than a developer. */
  description: string;
  /** Concept to select and reveal. Undefined when nothing survived to point at. */
  conceptId?: number;
  /** Label of that concept, for the list. */
  conceptLabel?: string;
  /** Row id in its own table, so a fix can be scripted later. */
  rowId?: number;
}

function rows(db: Database, sql: string): unknown[][] {
  const r = db.exec(sql);
  return r.length ? r[0].values : [];
}

/**
 * Every integrity problem in the database, one entry each.
 *
 * Read-only. Safe to call whenever; cost is a handful of indexed lookups.
 */
export function describeIntegrityProblems(db: Database): IIntegrityProblem[] {
  const out: IIntegrityProblem[] = [];

  // --- dangling relationships, both directions --------------------------------
  // The surviving end is the anchor; `missing` is the id that no longer resolves.
  const dangling: Array<{ col: string; other: string; which: string }> = [
    { col: 'source_concept_id', other: 'target_concept_id', which: 'source' },
    { col: 'target_concept_id', other: 'source_concept_id', which: 'target' }
  ];
  for (const d of dangling) {
    const sql = `
      SELECT r.id, r.${d.col}, r.${d.other}, COALESCE(p.label, 'unnamed relationship'),
             COALESCE(oc.pref_label, '(also missing)')
      FROM relationships r
      LEFT JOIN concepts c   ON c.id = r.${d.col}
      LEFT JOIN concepts oc  ON oc.id = r.${d.other}
      LEFT JOIN properties p ON p.id = r.property_id
      WHERE c.id IS NULL`;
    for (const row of rows(db, sql)) {
      const [relId, missingId, otherId, property, otherLabel] = row as [number, number, number, string, string];
      const survived = otherLabel !== '(also missing)';
      out.push({
        check: `relationships with missing ${d.which}`,
        description: survived
          ? `"${otherLabel}" has a "${property}" relationship whose ${d.which} concept (id ${missingId}) no longer exists.`
          : `A "${property}" relationship survives with BOTH ends missing (ids ${missingId} and ${otherId}).`,
        conceptId: survived ? Number(otherId) : undefined,
        conceptLabel: survived ? String(otherLabel) : undefined,
        rowId: Number(relId)
      });
    }
  }

  // --- hierarchy edges pointing at a deleted parent ---------------------------
  for (const row of rows(db, `
      SELECT b.concept_id, b.parent_concept_id, COALESCE(cc.pref_label, '(also missing)')
      FROM broader b
      LEFT JOIN concepts c  ON c.id = b.parent_concept_id
      LEFT JOIN concepts cc ON cc.id = b.concept_id
      WHERE c.id IS NULL`)) {
    const [childId, parentId, childLabel] = row as [number, number, string];
    const survived = childLabel !== '(also missing)';
    out.push({
      check: 'broader edges pointing nowhere',
      description: survived
        ? `"${childLabel}" sits under a parent concept (id ${parentId}) that no longer exists.`
        : `A hierarchy edge survives with both ends missing (child ${childId}, parent ${parentId}).`,
      conceptId: survived ? Number(childId) : undefined,
      conceptLabel: survived ? String(childLabel) : undefined
    });
  }

  // --- labels with no text ----------------------------------------------------
  for (const row of rows(db, `
      SELECT l.id, l.concept_id, COALESCE(c.pref_label, '(concept missing)')
      FROM labels l
      LEFT JOIN concepts c ON c.id = l.concept_id
      WHERE l.literal_form IS NULL OR l.literal_form = ''`)) {
    const [labelId, conceptId, conceptLabel] = row as [number, number, string];
    const survived = conceptLabel !== '(concept missing)';
    out.push({
      check: 'labels with no literal form',
      description: survived
        ? `"${conceptLabel}" has a label with no text in it.`
        : `A label with no text belongs to a concept (id ${conceptId}) that no longer exists.`,
      conceptId: survived ? Number(conceptId) : undefined,
      conceptLabel: survived ? String(conceptLabel) : undefined,
      rowId: Number(labelId)
    });
  }

  // --- concepts with no URI ---------------------------------------------------
  for (const row of rows(db, `
      SELECT id, COALESCE(pref_label, '(unnamed)')
      FROM concepts WHERE uri IS NULL OR uri = ''`)) {
    const [conceptId, conceptLabel] = row as [number, string];
    out.push({
      check: 'concepts with no URI',
      description: `"${conceptLabel}" has no URI, so it cannot be published or linked to.`,
      conceptId: Number(conceptId),
      conceptLabel: String(conceptLabel)
    });
  }

  return out;
}
