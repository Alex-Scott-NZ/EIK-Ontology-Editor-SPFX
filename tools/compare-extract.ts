/* One-off: extract expected values for the Semaphore comparison checklist.
   Run: npx tsx _compare-extract.ts   (from tools/) */
import * as fs from 'fs';
import initSqlJs from 'sql.js';

const localName = (u: string) => u.replace(/^.*[#/]/, '');

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('../data/ontology.sqlite'));
  const q = (s: string, p: any[] = []) => {
    const st = db.prepare(s); st.bind(p);
    const out: any[][] = []; while (st.step()) out.push(st.get() as any[]); st.free(); return out;
  };

  console.log('=== GLOBAL COUNTS ===');
  console.log('concepts:', q('SELECT COUNT(*) FROM concepts')[0][0]);
  console.log('classes:', q('SELECT COUNT(*) FROM classes')[0][0]);
  console.log('properties total:', q('SELECT COUNT(*) FROM properties')[0][0]);
  console.log('  object (non-label, declared):', q(`SELECT COUNT(*) FROM properties WHERE synthesised=0 AND is_label_property=0 AND flags_json LIKE '%ObjectProperty%'`)[0][0]);
  console.log('  label-pointing:', q('SELECT COUNT(*) FROM properties WHERE is_label_property=1')[0][0]);
  console.log('  datatype:', q(`SELECT COUNT(*) FROM properties WHERE flags_json LIKE '%DatatypeProperty%'`)[0][0]);
  console.log('  synthesised:', q('SELECT COUNT(*) FROM properties WHERE synthesised=1')[0][0]);
  console.log('roots:', q('SELECT COUNT(*) FROM v_root_concepts')[0][0]);

  console.log('\n=== PER-ROOT: DESCENDANT COUNT + DIRECT CHILDREN ===');
  const roots = q('SELECT id, pref_label FROM v_root_concepts ORDER BY pref_label');
  for (const [rid, rlabel] of roots) {
    const desc = q(`WITH RECURSIVE d(id) AS (
        SELECT concept_id FROM broader WHERE parent_concept_id = ?
        UNION SELECT b.concept_id FROM broader b JOIN d ON b.parent_concept_id = d.id)
      SELECT COUNT(DISTINCT id) FROM d`, [rid])[0][0];
    const kids = q(`SELECT c.pref_label FROM broader b JOIN concepts c ON c.id=b.concept_id
                    WHERE b.parent_concept_id=? ORDER BY c.pref_label`, [rid]);
    console.log(`\n${rlabel}  — total descendants: ${desc}, direct children: ${kids.length}`);
    for (const [k] of kids) console.log(`    ${k}`);
  }

  console.log('\n=== DEEP-DIVE CONCEPTS ===');
  const picks = ['United States of America', 'Competent Authority Arrangement'];
  const irform = q("SELECT c.pref_label FROM concepts c WHERE c.class_id=(SELECT id FROM classes WHERE label='IRForm') ORDER BY c.pref_label LIMIT 1");
  if (irform.length) picks.push(irform[0][0] as string);
  for (const name of picks) {
    const row = q('SELECT id, uri, class_id FROM concepts WHERE pref_label = ?', [name]);
    if (!row.length) { console.log(`\n${name}: NOT FOUND`); continue; }
    const [id, uri, classId] = row[0];
    const cls = classId ? q('SELECT label FROM classes WHERE id=?', [classId])[0][0] : '(none)';
    console.log(`\n--- ${name} ---`);
    console.log('uri:', uri);
    console.log('class:', cls);
    const parents = q('SELECT c.pref_label FROM broader b JOIN concepts c ON c.id=b.parent_concept_id WHERE b.concept_id=?', [id]);
    console.log('parents:', parents.map(r => r[0]).join(' | '));
    const childCount = q('SELECT COUNT(*) FROM broader WHERE parent_concept_id=?', [id])[0][0];
    console.log('children:', childCount);
    const labels = q(`SELECT label_property, literal_form, lang, flags_json FROM labels WHERE concept_id=? ORDER BY label_property, literal_form`, [id]);
    console.log('labels:');
    for (const [role, lf, lang, fl] of labels) console.log(`    [${localName(String(role))}] "${lf}"${lang ? '@' + lang : ''}${fl && fl !== '{}' ? '  flags=' + fl : ''}`);
    const links = q(`SELECT p.label, o.pref_label, v.direction FROM v_concept_links v
                     JOIN properties p ON p.id=v.property_id JOIN concepts o ON o.id=v.other_concept_id
                     WHERE v.concept_id=? ORDER BY v.direction, p.label, o.pref_label`, [id]);
    console.log(`relationships (${links.length}):`);
    for (const [p, o, d] of links) console.log(`    [${d}] ${p} -> ${o}`);
    const annos = q('SELECT predicate_uri, value FROM annotations WHERE concept_id=? ORDER BY predicate_uri LIMIT 12', [id]);
    console.log('annotations:');
    for (const [p, v] of annos) console.log(`    ${localName(String(p))}: ${String(v).slice(0, 90)}`);
  }

  console.log('\n=== POLYHIERARCHY EXAMPLES (3) ===');
  const poly = q(`SELECT b.concept_id, c.pref_label FROM broader b JOIN concepts c ON c.id=b.concept_id
                  GROUP BY b.concept_id HAVING COUNT(*)>1 LIMIT 3`);
  for (const [pid, plabel] of poly) {
    const ps = q('SELECT c.pref_label FROM broader b JOIN concepts c ON c.id=b.parent_concept_id WHERE b.concept_id=?', [pid]);
    console.log(`  ${plabel}  <-  ${ps.map(r => r[0]).join('  AND  ')}`);
  }

  console.log('\n=== DUAL-ROLE LABELS ===');
  const dual = q(`SELECT c.pref_label, l.literal_form, GROUP_CONCAT(l.label_property, ' + ') FROM labels l
                  JOIN concepts c ON c.id=l.concept_id
                  GROUP BY l.uri, l.concept_id HAVING COUNT(*)>1 LIMIT 12`);
  for (const [c, lf, roles] of dual) console.log(`  ${c}: "${lf}" as ${String(roles).split(' + ').map(localName).join(' + ')}`);

  console.log('\n=== WILDCARD LABELS (sample of 5) ===');
  const wild = q(`SELECT c.pref_label, l.label_property, l.literal_form FROM labels l
                  JOIN concepts c ON c.id=l.concept_id WHERE l.literal_form LIKE '%*%' LIMIT 5`);
  for (const [c, role, lf] of wild) console.log(`  ${c} [${localName(String(role))}]: "${lf}"`);

  console.log('\n=== MATCHING-FLAG EXAMPLES ===');
  const flagged = q(`SELECT c.pref_label, l.literal_form, l.flags_json FROM labels l
                     JOIN concepts c ON c.id=l.concept_id
                     WHERE l.flags_json LIKE '%caseSensitivity%' AND l.flags_json LIKE '%stemming%' LIMIT 3`);
  for (const [c, lf, fl] of flagged) console.log(`  ${c}: "${lf}"  ${fl}`);

  console.log('\n=== FULL PROPERTY TABLE (concept-to-concept relationship types) ===');
  const props = q(`SELECT p.label,
                          (SELECT label FROM properties i WHERE i.id = p.inverse_property_id),
                          (SELECT label FROM classes d WHERE d.id = p.domain_class_id),
                          (SELECT label FROM classes r WHERE r.id = p.range_class_id),
                          (SELECT COUNT(*) FROM relationships rel WHERE rel.property_id = p.id),
                          p.synthesised
                   FROM properties p
                   WHERE p.is_label_property = 0
                     AND (p.flags_json IS NULL OR p.flags_json NOT LIKE '%DatatypeProperty%')
                   ORDER BY p.label`);
  console.log('label | inverse | domain | range | storedRows | synthesised');
  for (const r of props) console.log(`  ${r.map(x => x === null ? '(any)' : x).join(' | ')}`);

  console.log('\n=== LABEL-POINTING PROPERTIES ===');
  const lprops = q(`SELECT p.label, (SELECT label FROM classes d WHERE d.id=p.domain_class_id),
                           (SELECT COUNT(*) FROM labels l WHERE l.label_property = p.uri OR l.label_property = p.label)
                    FROM properties p WHERE p.is_label_property=1 ORDER BY p.label`);
  for (const r of lprops) console.log(`  ${r.map(x => x === null ? '(any)' : x).join(' | ')}`);

  console.log('\n=== DATATYPE PROPERTIES ===');
  const dprops = q(`SELECT p.label, (SELECT label FROM classes d WHERE d.id=p.domain_class_id),
                           (SELECT COUNT(*) FROM annotations a WHERE a.predicate_uri = p.uri)
                    FROM properties p WHERE p.flags_json LIKE '%DatatypeProperty%' ORDER BY p.label`);
  for (const r of dprops) console.log(`  ${r.map(x => x === null ? '(any)' : x).join(' | ')}`);

  db.close();
})();
