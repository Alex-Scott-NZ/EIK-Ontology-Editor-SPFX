/**
 * Database-shape helpers for the Explorer web part: what tables exist, how they
 * reference each other, and where to draw them.
 *
 * Everything comes from SQLite's own PRAGMAs rather than knowledge of this
 * project's schema, so the diagram is correct for any database opened.
 */

import { Database } from 'sql.js';

export interface IColumn { name: string; type: string; pk: boolean }

export interface ITableNode {
  name: string;
  cols: IColumn[];
  w: number;
  h: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface IForeignKey {
  s: ITableNode;
  t: ITableNode;
  label: string;
  /** Fans apart several keys joining the same pair of tables. */
  bend: number;
}

export interface ISchema { nodes: ITableNode[]; links: IForeignKey[] }

function rows(db: Database, sql: string): unknown[][] {
  const r = db.exec(sql);
  return r.length ? (r[0].values as unknown[][]) : [];
}

export function listTables(db: Database): Array<{ name: string; kind: 'table' | 'view'; rows: number }> {
  const out: Array<{ name: string; kind: 'table' | 'view'; rows: number }> = [];
  const push = (kind: 'table' | 'view'): void => {
    for (const r of rows(db,
      `SELECT name FROM sqlite_master WHERE type='${kind}' AND name NOT LIKE 'sqlite_%' ORDER BY name`)) {
      const name = String(r[0]);
      let count = 0;
      try { count = Number(rows(db, `SELECT COUNT(*) FROM "${name}"`)[0][0]); } catch { count = -1; }
      out.push({ name, kind, rows: count });
    }
  };
  push('table');
  push('view');
  return out;
}

/** Tables, their columns, and the foreign keys between them. */
export function readSchema(db: Database): ISchema {
  const names = rows(db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map(r => String(r[0]));

  const nodes: ITableNode[] = names.map(name => {
    const cols: IColumn[] = rows(db, `PRAGMA table_info("${name}")`).map(r => ({
      name: String(r[1]),
      type: String(r[2] || ''),
      pk: Number(r[5]) > 0
    }));
    const widest = Math.max(
      name.length + 2,
      ...cols.map(c => (c.name + ' ' + c.type).length)
    );
    return {
      name, cols,
      w: Math.min(300, Math.max(130, widest * 6.6 + 20)),
      h: 24 + cols.length * 14 + 8,
      x: 0, y: 0, vx: 0, vy: 0
    };
  });

  const byName = new Map(nodes.map(n => [n.name, n]));
  const links: IForeignKey[] = [];
  for (const n of nodes) {
    for (const r of rows(db, `PRAGMA foreign_key_list("${n.name}")`)) {
      const target = byName.get(String(r[2]));
      if (target) links.push({ s: n, t: target, label: String(r[3] || ''), bend: 0 });
    }
  }

  // Several keys can join the same pair (properties → classes is both
  // domain_class_id and range_class_id); fan them so labels do not collide.
  const seen = new Map<string, number>();
  for (const l of links) {
    const key = [l.s.name, l.t.name].sort().join(' ');
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    l.bend = n === 0 ? 0 : (n % 2 ? Math.ceil(n / 2) : -Math.ceil(n / 2));
  }

  return { nodes, links };
}

/** Force layout: links pull, boxes push apart, everything drifts to centre. */
export function layout(nodes: ITableNode[], links: IForeignKey[], width = 1200, height = 820): void {
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2;
    n.x = width / 2 + Math.cos(a) * 300;
    n.y = height / 2 + Math.sin(a) * 240;
  });

  for (let step = 0; step < 400; step++) {
    for (const n of nodes) { n.vx = 0; n.vy = 0; }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const want = (a.w + b.w) / 2 + 70;
        if (d < want) {
          const push = ((want - d) / d) * 0.5;
          dx *= push; dy *= push;
          a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
        }
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const want = (l.s.w + l.t.w) / 2 + 110;
      const pull = ((d - want) / d) * 0.06;
      l.s.vx += dx * pull; l.s.vy += dy * pull;
      l.t.vx -= dx * pull; l.t.vy -= dy * pull;
    }
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.004;
      n.vy += (height / 2 - n.y) * 0.004;
      n.x += Math.max(-20, Math.min(20, n.vx));
      n.y += Math.max(-20, Math.min(20, n.vy));
    }
  }
}

/** Curved edge clipped to both box borders, plus a point to hang the label on. */
export function edgePath(s: ITableNode, t: ITableNode, bend: number): { d: string; lx: number; ly: number } {
  const dx = t.x - s.x, dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const clip = (n: ITableNode, ux: number, uy: number): [number, number] => {
    const hw = n.w / 2 + 4, hh = n.h / 2 + 4;
    const scale = Math.min(hw / (Math.abs(ux) || 1e-6), hh / (Math.abs(uy) || 1e-6));
    return [n.x + ux * scale, n.y + uy * scale];
  };
  const [x1, y1] = clip(s, dx / len, dy / len);
  const [x2, y2] = clip(t, -dx / len, -dy / len);
  const curve = 0.12 + bend * 0.22;
  const mx = (x1 + x2) / 2 + (y2 - y1) * curve;
  const my = (y1 + y2) / 2 - (x2 - x1) * curve;
  return {
    d: `M${x1},${y1} Q${mx},${my} ${x2},${y2}`,
    lx: (x1 + 2 * mx + x2) / 4,
    ly: (y1 + 2 * my + y2) / 4 - 3
  };
}

/**
 * Statements this web part will run. sql.js works on an in-memory copy so a
 * write could never reach SharePoint, but refusing them outright means the
 * read-only claim is visible in the code rather than something a reviewer has
 * to reason about.
 */
const WRITE = /^\s*(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|vacuum|pragma\s+\w+\s*=)/i;

export function isReadOnlySql(sql: string): boolean {
  // Strip comments and take each statement separately.
  const cleaned = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  return !cleaned.split(';').some(part => part.trim() && WRITE.test(part));
}

/** Canned queries offered in the UI. Keyed to this project's schema. */
export const CANNED: Array<{ label: string; sql: string }> = [
  {
    label: 'Concepts per class',
    sql: `SELECT COALESCE(cl.label,'(no class)') AS class, COUNT(*) AS concepts
FROM concepts c LEFT JOIN classes cl ON cl.id = c.class_id
GROUP BY 1 ORDER BY concepts DESC`
  },
  {
    label: 'Top concepts (no broader)',
    sql: `SELECT c.id, c.pref_label, cl.label AS class
FROM concepts c LEFT JOIN classes cl ON cl.id = c.class_id
WHERE NOT EXISTS (SELECT 1 FROM broader b WHERE b.concept_id = c.id)
ORDER BY c.pref_label`
  },
  {
    label: 'Concepts with several parents',
    sql: `SELECT c.pref_label, COUNT(*) AS parents
FROM broader b JOIN concepts c ON c.id = b.concept_id
GROUP BY b.concept_id HAVING parents > 1 ORDER BY parents DESC, c.pref_label`
  },
  {
    label: 'Publish / provenance metadata',
    sql: `SELECT key, value FROM import_metadata ORDER BY key`
  },
  {
    label: 'Change journal (latest 100)',
    sql: `SELECT id, changed_at, author, op, entity, entity_uri
FROM changes ORDER BY id DESC LIMIT 100`
  },
  {
    label: 'Relationships, readable (source → type → target)',
    sql: `SELECT s.pref_label AS source,
       COALESCE(p.label, p.uri) AS relationship,
       t.pref_label AS target
FROM relationships r
JOIN concepts   s ON s.id = r.source_concept_id
JOIN properties p ON p.id = r.property_id
JOIN concepts   t ON t.id = r.target_concept_id
ORDER BY source, relationship, target
LIMIT 500`
  },
  {
    label: 'One concept, everything about it',
    sql: `-- Change the name on the next line.
WITH me AS (SELECT id, pref_label FROM concepts WHERE pref_label = 'Income tax')
SELECT 'parent' AS kind, p.pref_label AS value, '' AS detail
  FROM broader b JOIN me ON me.id = b.concept_id JOIN concepts p ON p.id = b.parent_concept_id
UNION ALL SELECT 'child', c.pref_label, ''
  FROM broader b JOIN me ON me.id = b.parent_concept_id JOIN concepts c ON c.id = b.concept_id
UNION ALL SELECT 'label', l.literal_form, COALESCE(pr.label, l.label_property)
  FROM labels l JOIN me ON me.id = l.concept_id LEFT JOIN properties pr ON pr.uri = l.label_property
UNION ALL SELECT 'metadata', a.value, COALESCE(pr.label, a.predicate_uri)
  FROM annotations a JOIN me ON me.id = a.concept_id LEFT JOIN properties pr ON pr.uri = a.predicate_uri
UNION ALL SELECT 'related', o.pref_label, COALESCE(pr.label, pr.uri)
  FROM v_concept_links v JOIN me ON me.id = v.concept_id
  JOIN properties pr ON pr.id = v.property_id JOIN concepts o ON o.id = v.other_concept_id`
  },
  {
    label: 'Label types in use',
    sql: `SELECT COALESCE(p.label, l.label_property) AS type, COUNT(*) AS n
FROM labels l LEFT JOIN properties p ON p.uri = l.label_property
GROUP BY 1 ORDER BY n DESC`
  },
  {
    label: 'Integrity: links with a missing end',
    sql: `SELECT COUNT(*) AS broken FROM relationships r
LEFT JOIN concepts s ON s.id = r.source_concept_id
LEFT JOIN concepts t ON t.id = r.target_concept_id
WHERE s.id IS NULL OR t.id IS NULL`
  }
];
