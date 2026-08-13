/**
 * Floating "build an ontology from scratch" walkthrough — Part B of
 * comparison/TEST-SCRIPT.md, embedded so it can be followed alongside the
 * editor. Draggable by its header, resizable from the bottom-right corner,
 * nothing persisted: it opens fresh in its default spot every time.
 */

import * as React from 'react';
import { Checkbox, IconButton, Icon } from '@fluentui/react';
import styles from './OntologyEditor.module.scss';

interface IStep {
  key: string;
  title: string;
  body: React.ReactNode;
}

const Swatch: React.FC<{ c: string }> = ({ c }) => (
  <span className={styles.walkthroughSwatch} style={{ backgroundColor: c }} />
);

const Expect: React.FC = ({ children }) => (
  <p className={styles.walkthroughExpect}>Expect: {children}</p>
);

const STEPS: IStep[] = [
  {
    key: 'b1', title: 'Start a new ontology',
    body: <>
      <p><b>Open… → Start a new ontology → Create a new ontology.</b></p>
      <Expect>an empty editor — 0 concepts, empty tree. Status strip shows
        “New ontology (unsaved)”.</Expect>
      <p>The build order matters and the UI teaches it:
        classes → relationship types → concepts → links.</p>
    </>
  },
  {
    key: 'b2', title: 'Classes (Model tab)',
    body: <>
      <p>Model tab → <b>+</b> on the Concept classes card. Create:</p>
      <table className={styles.walkthroughTable}>
        <tbody>
          <tr><td><Swatch c="#e0a3a3" /> Party</td><td>top level</td><td>A person or organisation</td></tr>
          <tr><td><Swatch c="#c98080" /> Organisation</td><td>parent: Party</td><td>A group acting as one party</td></tr>
          <tr><td><Swatch c="#a3c1e0" /> Activity</td><td>top level</td><td>Something a party does</td></tr>
          <tr><td><Swatch c="#a3e0b8" /> Document</td><td>top level</td><td>Recorded information</td></tr>
        </tbody>
      </table>
      <Expect>4 rows with swatches; Organisation’s parent reads Party.</Expect>
      <p>Also try creating another class called <b>Party</b> — it should be
        refused as a duplicate name.</p>
    </>
  },
  {
    key: 'b3', title: 'Relationship types',
    body: <>
      <p><b>+</b> on the Relationship types card. Create:</p>
      <table className={styles.walkthroughTable}>
        <tbody>
          <tr><td>Performs</td><td>Is performed by</td><td>Party → Activity</td></tr>
          <tr><td>Produces</td><td>Is produced by</td><td>Activity → Document</td></tr>
          <tr><td>Mentions</td><td>Is mentioned in</td><td>Document → Any concept</td></tr>
        </tbody>
      </table>
      <Expect>3 pair rows. The preview line in the dialog reads sensibly
        before you hit Create — that’s the domain/range talking.</Expect>
    </>
  },
  {
    key: 'b3b', title: 'Metadata field + label type',
    body: <>
      <p>Still on the Model tab:</p>
      <ul>
        <li>New metadata field → <b>Risk rating</b>, applies to
          <b> Activity</b>, definition “How risky this activity is.”</li>
        <li>New label type → <b>Acronym</b>, applies to <b>Any concept</b>.</li>
      </ul>
      <Expect>one row in each table, Uses = 0. Creating a field called
        “Performs” is refused — names are unique across types and fields.</Expect>
    </>
  },
  {
    key: 'b4', title: 'Concepts',
    body: <>
      <p><b>Top-level</b> — the empty tree shows a dashed
        “+ Add the first concept” row; click it. Create:</p>
      <ul>
        <li><b>ACME Ltd</b> — class Organisation</li>
        <li><b>Tax filing</b> — class Activity</li>
        <li><b>Filing guide</b> — class Document</li>
      </ul>
      <p><b>As a child</b> — hover Tax filing in the tree, click the
        add-child <b>+</b> on the row. Create <b>Annual return</b>; the class
        comes pre-set to Activity (children default to their parent’s class).</p>
      <Expect>three at top level, Annual return nested under Tax filing,
        class colours on the tree nodes.</Expect>
    </>
  },
  {
    key: 'b4b', title: 'Change a class after the fact',
    body: <>
      <p>Select Annual return → pencil next to the class chip → change to
        <b> Document</b> → try Add relationship.</p>
      <Expect>only Mentions is offered now, not Performs/Produces.</Expect>
      <p>Change it back to <b>Activity</b>. That’s the class doing its job: it
        governs the relationship picker, independent of tree position.</p>
    </>
  },
  {
    key: 'b5', title: 'Second parent (polyhierarchy)',
    body: <>
      <p>Annual return → add broader → pick <b>ACME Ltd</b> (nonsense
        semantically, but it proves the mechanics).</p>
      <Expect>Annual return now appears under BOTH Tax filing and ACME Ltd.</Expect>
      <p>Remove the ACME parent again afterwards.</p>
    </>
  },
  {
    key: 'b6', title: 'Links',
    body: <>
      <ul>
        <li>ACME Ltd → Add relationship → <b>Performs</b> → Tax filing.
          (Organisation is a <i>subclass</i> of Party — the type must still be
          offered. If not, that’s a bug in class inheritance.)</li>
        <li>Tax filing → <b>Produces</b> → Filing guide.</li>
        <li>Filing guide → <b>Mentions</b> → anything (“Any” range means every
          concept is offered).</li>
      </ul>
      <Expect>each link readable from both ends under the inverse name;
        wrong-direction pairings (e.g. Performs from Filing guide) not
        offered.</Expect>
    </>
  },
  {
    key: 'b7', title: 'Labels with matching flags',
    body: <>
      <p>ACME Ltd → add a label → the Role dropdown now offers
        <b> Acronym</b> (from the earlier step) as well as Alternative label.
        Add <b>ACME</b> as an Acronym → Case sensitivity
        <b> Case sensitive</b>, Stemming <b>Off</b>.</p>
      <Expect>flag chips on the label, and Uses = 1 on the Acronym row back
        on the Model tab.</Expect>
    </>
  },
  {
    key: 'b8', title: 'Metadata',
    body: <>
      <p>Tax filing → <b>+</b> on the Metadata card → the Field box (type to
        filter) offers <b>Risk rating</b> — because Tax filing is an Activity.
        Check it is NOT offered on ACME Ltd or Filing guide. Set it to
        “High”.</p>
      <p>Also add a standard one: ACME Ltd → definition → “A test
        organisation.”</p>
      <p>Then hover a metadata row: the pencil edits the value in place, the
        bin deletes it. Edit one to prove the round trip.</p>
    </>
  },
  {
    key: 'b9', title: 'Save and reopen',
    body: <>
      <p><b>Save</b> (command bar).</p>
      <Expect>no setup needed — it creates Shared Documents/Ontology on the
        site, writes ontology.sqlite there, and the red “● unsaved changes”
        badge clears.</Expect>
      <p>Then <b>Open…</b> → the picker auto-lists that folder → open the
        file.</p>
      <Expect>all of it back — and deleting Tax filing warns it takes 1 child
        + 2 relationships with it. Cancel.</Expect>
    </>
  },
  {
    key: 'b10', title: 'Export Turtle',
    body: <>
      <p>Command bar → <b>Export Turtle…</b></p>
      <Expect>an .ttl downloads immediately (it serialises what you’re
        looking at, unsaved changes included). Open it in a text editor: your
        classes as owl:Class blocks, the relationship pairs with
        domain/range/inverseOf, every link written in BOTH directions,
        concepts with skos:broader, SKOS-XL labels with their matching flags,
        and Risk rating as a typed annotation.</Expect>
    </>
  },
  {
    key: 'b11', title: 'The round trip',
    body: <>
      <p><b>Open… → Import a Turtle export →</b> choose the .ttl you just
        downloaded.</p>
      <Expect>it parses with zero anomalies and shows the same counts as
        before the export — classes, relationship-type pairs, concepts,
        links, labels, metadata. That file is Semaphore-compatible: this is
        the eventual production export path.</Expect>
    </>
  }
];

const MIN_W = 300;
const MIN_H = 240;

export const WalkthroughPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // null = the default CSS spot (top-right). Set once dragged/resized;
  // deliberately NOT persisted anywhere.
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [done, setDone] = React.useState<{ [k: string]: boolean }>({});
  const [open, setOpen] = React.useState<string>('b1');

  const dragStart = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const resizeStart = React.useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement;
    if (t.closest('button')) return; // the close button is not a drag handle
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragStart.current = { px: e.clientX, py: e.clientY, x: r.left, y: r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragStart.current;
    const el = panelRef.current;
    if (!d || !el) return;
    let x = d.x + (e.clientX - d.px);
    let y = d.y + (e.clientY - d.py);
    x = Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - 48));
    setPos({ x, y });
  };
  const endDrag = (): void => { dragStart.current = null; };

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Resizing from the corner must not let the panel's default right-anchored
    // position slide — pin the current top-left first.
    if (!pos) setPos({ x: r.left, y: r.top });
    resizeStart.current = { px: e.clientX, py: e.clientY, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  const moveResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = resizeStart.current;
    if (!d) return;
    const w = Math.max(MIN_W, Math.min(d.w + (e.clientX - d.px), window.innerWidth - 16));
    const h = Math.max(MIN_H, Math.min(d.h + (e.clientY - d.py), window.innerHeight - 16));
    setSize({ w, h });
  };
  const endResize = (): void => { resizeStart.current = null; };

  const doneCount = STEPS.filter(s => done[s.key]).length;

  const style: React.CSSProperties = {};
  if (pos) { style.left = pos.x; style.top = pos.y; style.right = 'auto'; }
  if (size) { style.width = size.w; style.height = size.h; }

  return (
    <div ref={panelRef} className={styles.walkthroughPanel} style={style} role="dialog"
         aria-label="Walkthrough: build an ontology from scratch">
      <div
        className={styles.walkthroughHeader}
        onPointerDown={startDrag} onPointerMove={moveDrag}
        onPointerUp={endDrag} onPointerCancel={endDrag}
      >
        <Icon iconName="Move" className={styles.walkthroughGrip} />
        <span className={styles.walkthroughTitle}>Build an ontology from scratch</span>
        <span className={styles.walkthroughProgress}>{doneCount} / {STEPS.length}</span>
        <IconButton
          iconProps={{ iconName: 'Cancel' }} title="Close" ariaLabel="Close walkthrough"
          onClick={onClose} className={styles.walkthroughClose}
        />
      </div>
      <div className={styles.walkthroughBody}>
        {STEPS.map((s, i) => (
          <div key={s.key} className={done[s.key] ? styles.walkthroughStepDone : styles.walkthroughStep}>
            <div
              className={styles.walkthroughStepHeader}
              onClick={() => setOpen(open === s.key ? '' : s.key)}
            >
              <span onClick={e => e.stopPropagation()}>
                <Checkbox
                  checked={!!done[s.key]}
                  onChange={(_, checked) => {
                    setDone({ ...done, [s.key]: !!checked });
                    // Ticking a step folds it and unfolds the next unticked one.
                    if (checked && open === s.key) {
                      const next = STEPS.slice(i + 1).filter(n => !done[n.key])[0];
                      setOpen(next ? next.key : '');
                    }
                  }}
                  ariaLabel={`Mark step done: ${s.title}`}
                />
              </span>
              <span className={styles.walkthroughStepTitle}>{i + 1}. {s.title}</span>
            </div>
            {open === s.key && <div className={styles.walkthroughStepBody}>{s.body}</div>}
          </div>
        ))}
      </div>
      <div
        className={styles.walkthroughResize} title="Drag to resize"
        onPointerDown={startResize} onPointerMove={moveResize}
        onPointerUp={endResize} onPointerCancel={endResize}
      />
    </div>
  );
};
