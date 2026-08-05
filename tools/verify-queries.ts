/* Smoke-test the queries OntologyDatabase issues, against the real generated DB. */
import * as fs from 'fs';
import initSqlJs from 'sql.js';

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('../data/ontology.sqlite'));
  const q = (s: string, p: any[] = []) => {
    const st = db.prepare(s); st.bind(p);
    const out: any[][] = []; while (st.step()) out.push(st.get() as any[]); st.free(); return out;
  };

  console.log('roots:', q('SELECT COUNT(*) FROM v_root_concepts')[0][0]);

  // A concept with both directions of relationships + known inverse pair
  const usa = q("SELECT id, pref_label FROM concepts WHERE pref_label = 'United States of America'")[0];
  console.log('\nUSA concept id:', usa[0]);
  const links = q(`SELECT p.label, o.pref_label, v.direction FROM v_concept_links v
                   JOIN properties p ON p.id=v.property_id JOIN concepts o ON o.id=v.other_concept_id
                   WHERE v.concept_id = ? ORDER BY v.direction, p.label LIMIT 8`, [usa[0]]);
  for (const [p, o, d] of links) console.log(`  [${d}] ${p} -> ${o}`);
  console.log('  total links:', q('SELECT COUNT(*) FROM v_concept_links WHERE concept_id = ?', [usa[0]])[0][0]);

  // Verify the inverse pair renders from BOTH ends with only one stored row
  const caa = q("SELECT id FROM concepts WHERE pref_label = 'Competent Authority Arrangement'")[0];
  console.log('\nStored rows between CAA and USA:',
    q('SELECT COUNT(*) FROM relationships WHERE (source_concept_id=? AND target_concept_id=?) OR (source_concept_id=? AND target_concept_id=?)',
      [caa[0], usa[0], usa[0], caa[0]])[0][0]);
  console.log('Views rows between them (both ends):',
    q('SELECT COUNT(*) FROM v_concept_links WHERE (concept_id=? AND other_concept_id=?) OR (concept_id=? AND other_concept_id=?)',
      [caa[0], usa[0], usa[0], caa[0]])[0][0]);

  // Polyhierarchy: a concept with multiple parents
  const poly = q(`SELECT c.pref_label, COUNT(*) FROM broader b JOIN concepts c ON c.id=b.concept_id
                  GROUP BY b.concept_id HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC LIMIT 3`);
  console.log('\nPolyhierarchical concepts:');
  for (const [l, n] of poly) console.log(`  ${l}: ${n} parents`);

  // Allowed properties for a typed concept
  const form = q("SELECT id, pref_label FROM concepts WHERE class_id=(SELECT id FROM classes WHERE label='IRForm') LIMIT 1")[0];
  if (form) {
    const allowed = q('SELECT label, range_class_id FROM v_allowed_properties WHERE concept_id=? LIMIT 6', [form[0]]);
    console.log(`\nAllowed properties for "${form[1]}" (an IRForm):`);
    for (const [l, r] of allowed) console.log(`  ${l}${r === null ? '  (target: any concept)' : ''}`);
  }

  // Search across alternate labels (shoulder codes)
  const s = q(`SELECT DISTINCT c.pref_label FROM concepts c JOIN labels l ON l.concept_id=c.id
               WHERE l.literal_form LIKE '%IR470A%' LIMIT 3`);
  console.log('\nSearch "IR470A" via alternate labels:', s.map(r => r[0]).join(', ') || '(none)');
  db.close();
})();
