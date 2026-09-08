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

function copyText(text: string): void {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      void navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* fall through */ }
  // Fallback for contexts where the async clipboard API is unavailable.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* nothing else to try */ }
  document.body.removeChild(ta);
}

/** A value to type into the editor — click to copy it, paste it in. */
const Copy: React.FC<{ t: string }> = ({ t }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className={styles.walkthroughCopy}
      title={copied ? 'Copied!' : 'Click to copy'}
      onClick={() => {
        copyText(t);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      <span>{t}</span>
      <Icon iconName={copied ? 'CheckMark' : 'Copy'} />
    </button>
  );
};

/** A colour: the swatch to recognise it by, the hex to paste into the Colour box. */
const Colour: React.FC<{ c: string }> = ({ c }) => (
  <>
    <Swatch c={c} />
    <Copy t={c} />
  </>
);

const STEPS: IStep[] = [
  {
    key: 'b1', title: 'Start a new ontology',
    body: <>
      <p>Values in boxes like <Copy t="example" /> can be clicked to copy,
        then pasted into the editor — no retyping.</p>
      <p>On the opening screen, choose <b>Create a new ontology</b> (under
        “Start a new ontology”). If an ontology is already open, use
        <b> Open…</b> in the command bar to get back to that screen first.</p>
      <Expect>an empty editor — 0 concepts, an empty tree. The status strip
        reads “New ontology (unsaved)”.</Expect>
      <p>The build order matters, and the editor teaches it:
        classes → relationship types → concepts → links. Everything lives in
        this browser tab until you Save.</p>
    </>
  },
  {
    key: 'b2', title: 'Classes (Model tab)',
    body: <>
      <p>A class says what KIND of thing a concept is, and (later) which
        relationships it may take. Switch to the <b>Model</b> tab →
        <b> +</b> on the <b>Concept classes</b> card. Create these four —
        name, colour, parent, definition:</p>
      <table className={styles.walkthroughTable}>
        <tbody>
          <tr><td><Copy t="Party" /></td><td><Colour c="#e0a3a3" /></td>
            <td>top level</td><td><Copy t="A person or organisation" /></td></tr>
          <tr><td><Copy t="Organisation" /></td><td><Colour c="#c98080" /></td>
            <td>parent: Party</td><td><Copy t="A group acting as one party" /></td></tr>
          <tr><td><Copy t="Activity" /></td><td><Colour c="#a3c1e0" /></td>
            <td>top level</td><td><Copy t="Something a party does" /></td></tr>
          <tr><td><Copy t="Document" /></td><td><Colour c="#a3e0b8" /></td>
            <td>top level</td><td><Copy t="Recorded information" /></td></tr>
        </tbody>
      </table>
      <Expect>4 rows with colour swatches; Organisation’s parent reads
        Party.</Expect>
      <p>Also try creating another class called <b>Party</b> — it is refused
        as a duplicate name.</p>
    </>
  },
  {
    key: 'b3', title: 'Relationship types',
    body: <>
      <p>Relationship types are defined once, as a forward/inverse pair with
        a source class (domain) and target class (range).
        <b> +</b> on the <b>Relationship types</b> card. Create:</p>
      <table className={styles.walkthroughTable}>
        <tbody>
          <tr><td><Copy t="Performs" /></td><td><Copy t="Is performed by" /></td>
            <td>Party → Activity</td></tr>
          <tr><td><Copy t="Produces" /></td><td><Copy t="Is produced by" /></td>
            <td>Activity → Document</td></tr>
          <tr><td><Copy t="Mentions" /></td><td><Copy t="Is mentioned in" /></td>
            <td>Document → Any concept</td></tr>
        </tbody>
      </table>
      <Expect>3 pair rows. The preview sentence in the dialog reads sensibly
        before you hit Create — that’s the domain/range talking.</Expect>
    </>
  },
  {
    key: 'b3b', title: 'Metadata field + label type',
    body: <>
      <p>Still on the Model tab:</p>
      <ul>
        <li>New metadata field → <Copy t="Risk rating" />, applies to
          <b> Activity</b>, definition <Copy t="How risky this activity is." /></li>
        <li>New label type → <Copy t="Acronym" />, applies to
          <b> Any concept</b>.</li>
      </ul>
      <Expect>one row in each table, Uses = 0. Creating a field called
        “Performs” is refused — names are unique across types and
        fields.</Expect>
    </>
  },
  {
    key: 'b4', title: 'Concepts',
    body: <>
      <p>Back on the <b>Concepts</b> tab. The empty tree shows a dashed
        “+ Add the first concept” row; click it (after the first concept it
        becomes “+ New top concept”). Create three at top level:</p>
      <ul>
        <li><Copy t="ACME Ltd" /> — class Organisation</li>
        <li><Copy t="Tax filing" /> — class Activity</li>
        <li><Copy t="Filing guide" /> — class Document</li>
      </ul>
      <p><b>As a child</b> — hover Tax filing in the tree and click the small
        green <b>+</b> that appears on the row. Create
        <Copy t="Annual return" />; the class comes pre-set to Activity
        (children default to their parent’s class).</p>
      <Expect>three at top level, Annual return nested under Tax filing
        (click the chevron to expand), class colours on the tree
        rows.</Expect>
    </>
  },
  {
    key: 'b4b', title: 'Change a class after the fact',
    body: <>
      <p>Select Annual return. In the detail pane, every editable row shows
        faint pencil/bin icons that sharpen on hover — that’s how all editing
        works here. Click the pencil next to the class chip → change to
        <b> Document</b> → then try <b>+</b> on Related Concepts.</p>
      <Expect>Performs and Produces are gone from the picker — a Document
        can’t perform or produce. What remains is what a Document CAN do:
        Mentions, plus inverse directions like “Is produced by”.</Expect>
      <p>Change it back to <b>Activity</b>. That’s the class doing its job:
        it governs which relationships are offered, independent of tree
        position.</p>
    </>
  },
  {
    key: 'b5', title: 'Second parent (polyhierarchy)',
    body: <>
      <p>With Annual return selected → <b>+</b> on <b>Broader Concepts</b> →
        pick <b>ACME Ltd</b> (nonsense semantically, but it proves the
        mechanics — a concept may sit under several branches at once).</p>
      <Expect>Annual return now appears under BOTH Tax filing and ACME
        Ltd.</Expect>
      <p>Remove the ACME parent again: hover that row under Broader Concepts
        and click its bin icon.</p>
    </>
  },
  {
    key: 'b6', title: 'Links',
    body: <>
      <p>Select each source concept, then <b>+</b> on
        <b> Related Concepts</b>:</p>
      <ul>
        <li>ACME Ltd → <b>Performs</b> → Tax filing. (Organisation is a
          <i> subclass</i> of Party, so the type is still offered — that’s
          class inheritance working.)</li>
        <li>Tax filing → <b>Produces</b> → Filing guide.</li>
        <li>Filing guide → <b>Mentions</b> → anything (“Any concept” range
          means everything is offered).</li>
      </ul>
      <Expect>each link readable from both ends under the inverse name
        (Tax filing shows “Is performed by → ACME Ltd”); wrong-direction
        pairings (e.g. Performs from Filing guide) are not offered.</Expect>
    </>
  },
  {
    key: 'b7', title: 'Labels with matching flags',
    body: <>
      <p>ACME Ltd → <b>+</b> on <b>Alternative Labels</b> → the Role dropdown
        offers <b>Acronym</b> (from step 4) as well as Alternative label.
        Add <Copy t="ACME" /> as an Acronym, and set Case sensitivity to
        <b> On</b> and Stemming to <b>Off</b>.</p>
      <Expect>a “2 settings” chip on the label row, and Uses = 1 on the
        Acronym row back on the Model tab.</Expect>
    </>
  },
  {
    key: 'b8', title: 'Metadata',
    body: <>
      <p>Tax filing → <b>+</b> on the <b>Metadata</b> card → the Field box
        (type to filter) offers <b>Risk rating</b> — because Tax filing is an
        Activity. Set it to <Copy t="High" />. Check the field is NOT offered
        on ACME Ltd or Filing guide.</p>
      <p>Also add a standard one: ACME Ltd → Metadata <b>+</b> →
        definition → <Copy t="A test organisation." /></p>
      <p>Hover anywhere over a metadata field: the pencil edits the value,
        the bin deletes it. Edit one to prove the round trip.</p>
    </>
  },
  {
    key: 'b8b', title: 'Undo',
    body: <>
      <p>Command bar → <b>Undo</b>.</p>
      <Expect>the last edit steps back (repeat to go further; it stops at
        the last save). There is no redo — if you step back too far,
        re-apply the change by hand.</Expect>
      <p>Every change is also journalled with author and timestamp — the
        audit trail travels inside the saved file.</p>
    </>
  },
  {
    key: 'b9', title: 'Save and reopen',
    body: <>
      <p><b>Save</b> (command bar).</p>
      <Expect>no setup needed — it creates Shared Documents/Ontology on this
        site, writes ontology.sqlite there, and the red “● unsaved changes”
        badge clears.</Expect>
      <p>Then <b>Open…</b> → the picker auto-lists that folder → open the
        file again.</p>
      <Expect>everything back as it was. Bonus check: hover Tax filing in
        the tree and click its bin — the delete warning itemises everything
        it would take with it: the child concept, relationships, labels and
        metadata. Cancel.</Expect>
    </>
  },
  {
    key: 'b10', title: 'Export Turtle',
    body: <>
      <p>Command bar → <b>Export Turtle…</b></p>
      <Expect>a .ttl downloads immediately (it serialises what you’re
        looking at, unsaved changes included). Open it in a text editor:
        your classes as owl:Class blocks, the relationship pairs with
        domain/range/inverseOf, every link written in BOTH directions,
        concepts with skos:broader, SKOS-XL labels with their matching
        flags, and Risk rating as a typed annotation.</Expect>
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
  },
  {
    key: 'b12', title: 'Export a branch as its own ontology',
    body: <>
      <p>Select <b>Tax filing</b>. Next to its name at the top of the detail
        pane are three icons: rename, <b>export branch</b>, and
        <b> attach ontology</b>. Click the export icon.</p>
      <Expect>the dialog counts the branch — “Tax filing” and everything
        narrower, 2 concepts. It keeps the full class/relationship-type
        schema, so the subset is a complete, openable ontology on its
        own.</Expect>
      <p>Keep the suggested name, tick <b>Turtle</b>, and choose
        <b> Save to SharePoint</b>.</p>
      <Expect>a green bar confirms the file landed in the ontology
        folder.</Expect>
    </>
  },
  {
    key: 'b13', title: 'Attach an ontology under a concept',
    body: <>
      <p>Now graft that branch somewhere else. Select <b>Filing guide</b> →
        click the <b>attach ontology</b> icon next to its name → the dialog
        lists the ontology folder → <b>Attach</b> on the file you just
        exported.</p>
      <Expect>a green bar reports what happened: concepts whose URIs already
        exist are REUSED, not duplicated — so here the branch’s top concept
        simply gains Filing guide as a second parent. Attaching a file from
        a different ontology would add its concepts, classes and
        relationship types wholesale.</Expect>
      <p><b>Undo</b> reverses the entire attach in one step. Do that now —
        and that’s the tour. Delete the practice files from
        Shared Documents/Ontology if you’re done with them.</p>
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
