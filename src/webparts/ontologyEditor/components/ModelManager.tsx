import * as React from 'react';
import {
  DefaultButton, PrimaryButton, TextField, Dropdown, IDropdownOption,
  Dialog, DialogType, DialogFooter, MessageBar, MessageBarType,
  SearchBox, Icon
} from '@fluentui/react';
import styles from './OntologyEditor.module.scss';
import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { OntologyWriter } from '../../../services/database/OntologyWriter';
import { IOntologyClass, IOntologyProperty } from '../../../models/IOntology';
import { NewPropertyDialog } from './ConceptDialogs';

/**
 * The Model tab: Semaphore's model-administration screens, reduced to the two
 * things that matter — concept classes and relationship types. This is where a
 * NEW ontology gets its shape before any concept exists: classes first (they
 * are the domain/range choices), then relationship types, then concepts.
 */

export interface IModelManagerProps {
  db: OntologyDatabase;
  writer: OntologyWriter;
  /** The shell's mutate(): runs fn, refreshes stats, catches ValidationFailure. */
  mutate: (fn: () => void) => boolean;
  /** Error text from the last failed mutate, shown in whichever dialog is open. */
  mutateError?: string;
  /** Clears the shell's error when a dialog closes, so it never goes stale. */
  onClearError: () => void;
  refreshToken: number;
}

interface ISimpleDefinition {
  id: number; uri: string; label?: string; domainClassId?: number;
  domainClassName?: string; definition?: string; uses: number;
}

type ModelDialog =
  | { kind: 'none' }
  | { kind: 'newClass' }
  | { kind: 'editClass'; cls: IOntologyClass }
  | { kind: 'newProperty' }
  | { kind: 'editProperty'; prop: IOntologyProperty }
  | { kind: 'newField' }
  | { kind: 'editField'; def: ISimpleDefinition }
  | { kind: 'newLabelType' }
  | { kind: 'editLabelType'; def: ISimpleDefinition };

const ClassDialog: React.FC<{
  title: string;
  initial?: { label: string; definition?: string; colour?: string; parentClassId?: number };
  classes: IOntologyClass[];
  /** Parent is set at creation only — moving a class re-parents its whole subtree. */
  showParent: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (v: { label: string; definition?: string; colour?: string; parentClassId?: number }) => void;
}> = ({ title, initial, classes, showParent, error, onCancel, onSave }) => {
  const [label, setLabel] = React.useState(initial ? initial.label : '');
  const [definition, setDefinition] = React.useState((initial && initial.definition) || '');
  const [colour, setColour] = React.useState((initial && initial.colour) || '');
  const [parentClassId, setParentClassId] = React.useState<number | undefined>(
    initial ? initial.parentClassId : undefined
  );

  const parentOptions: IDropdownOption[] = [
    { key: -1, text: '(top level)' },
    ...classes.filter(c => !!c.label).map(c => ({ key: c.id, text: c.label as string }))
  ];
  const colourOk = !colour.trim() || /^#?[0-9a-fA-F]{6}$/.test(colour.trim());

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{ type: DialogType.normal, title }}
      modalProps={{ isBlocking: true }}
      minWidth={480}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
      <TextField
        label="Name" required autoFocus placeholder="e.g. Vehicle type"
        value={label} onChange={(_, v) => setLabel(v || '')}
      />
      {showParent && (
        <Dropdown
          label="Parent class"
          selectedKey={parentClassId === undefined ? -1 : parentClassId}
          options={parentOptions}
          onChange={(_, o) => setParentClassId(o && Number(o.key) >= 0 ? Number(o.key) : undefined)}
        />
      )}
      <TextField
        label="Colour"
        placeholder="#a3c1e0"
        description="The tree swatch, as a hex colour. Optional."
        value={colour}
        errorMessage={colourOk ? undefined : 'Six hex digits, e.g. #a3c1e0'}
        onChange={(_, v) => setColour(v || '')}
        onRenderSuffix={() => (
          <span style={{
            display: 'inline-block', width: 16, height: 16, borderRadius: 3,
            background: colourOk && colour.trim() ? (colour.trim().charAt(0) === '#' ? colour.trim() : `#${colour.trim()}`) : 'transparent',
            border: '1px solid #ccc'
          }} />
        )}
      />
      <TextField
        label="Definition" multiline rows={3}
        description="What membership of this class means."
        value={definition} onChange={(_, v) => setDefinition(v || '')}
      />
      <DialogFooter>
        <PrimaryButton
          text="Save" disabled={!label.trim() || !colourOk}
          onClick={() => onSave({
            label: label.trim(),
            definition: definition.trim() || undefined,
            colour: colour.trim() || undefined,
            parentClassId
          })}
        />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/** Name + optional domain + definition — metadata fields and label types. */
const SimpleDefinitionDialog: React.FC<{
  title: string;
  domainHint: string;
  initial?: { label: string; definition?: string };
  classes: IOntologyClass[];
  /** Domain is set at creation only, like relationship types. */
  showDomain: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (v: { label: string; domainClassId?: number; definition?: string }) => void;
}> = ({ title, domainHint, initial, classes, showDomain, error, onCancel, onSave }) => {
  const [label, setLabel] = React.useState(initial ? initial.label : '');
  const [definition, setDefinition] = React.useState((initial && initial.definition) || '');
  const [domainClassId, setDomainClassId] = React.useState<number | undefined>(undefined);

  const domainOptions: IDropdownOption[] = [
    { key: -1, text: 'Any concept' },
    ...classes.filter(c => !!c.label).map(c => ({ key: c.id, text: c.label as string }))
  ];

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{ type: DialogType.normal, title }}
      modalProps={{ isBlocking: true }}
      minWidth={480}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
      <TextField
        label="Name" required autoFocus
        value={label} onChange={(_, v) => setLabel(v || '')}
      />
      {showDomain && (
        <Dropdown
          label="Applies to (domain)"
          selectedKey={domainClassId === undefined ? -1 : domainClassId}
          options={domainOptions}
          onChange={(_, o) => setDomainClassId(o && Number(o.key) >= 0 ? Number(o.key) : undefined)}
        />
      )}
      {showDomain && <p style={{ fontSize: 12, margin: '4px 0 0' }}>{domainHint}</p>}
      <TextField
        label="Definition" multiline rows={3}
        description="What this means and when to use it."
        value={definition} onChange={(_, v) => setDefinition(v || '')}
      />
      <DialogFooter>
        <PrimaryButton
          text="Save" disabled={!label.trim()}
          onClick={() => onSave({
            label: label.trim(), domainClassId,
            definition: definition.trim() || undefined
          })}
        />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

const EditPropertyDialog: React.FC<{
  prop: IOntologyProperty;
  inverseLabel?: string;
  error?: string;
  onCancel: () => void;
  onSave: (v: { label: string; inverseLabel?: string; definition?: string }) => void;
}> = ({ prop, inverseLabel, error, onCancel, onSave }) => {
  const [label, setLabel] = React.useState(prop.label || '');
  const [inv, setInv] = React.useState(inverseLabel || '');
  const [definition, setDefinition] = React.useState(prop.definition || '');
  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: 'Edit relationship type',
        subText: 'Domain and range are fixed — changing them would silently invalidate existing links. Delete and recreate if the constraint is wrong.'
      }}
      modalProps={{ isBlocking: true }}
      minWidth={480}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
      <TextField label="Name" required value={label} onChange={(_, v) => setLabel(v || '')} />
      {inverseLabel !== undefined && (
        <TextField label="Inverse name" value={inv} onChange={(_, v) => setInv(v || '')} />
      )}
      <TextField
        label="Definition" multiline rows={3}
        value={definition} onChange={(_, v) => setDefinition(v || '')}
      />
      <DialogFooter>
        <PrimaryButton
          text="Save" disabled={!label.trim()}
          onClick={() => onSave({
            label: label.trim(),
            inverseLabel: inverseLabel !== undefined ? inv.trim() : undefined,
            definition: definition.trim() || undefined
          })}
        />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/**
 * Card section matching the concept pane's visual language: tinted header
 * band (chevron, icon, title, count chip, docked +), with the section's
 * blurb, filter box and table inside. The band toggles the fold.
 */
const ModelSection: React.FC<{
  domId: string;
  icon: string;
  title: string;
  count: string;
  addLabel: string;
  onAdd: () => void;
  filterValue: string;
  onFilterChange: (v: string) => void;
  filterPlaceholder: string;
  blurb: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}> = (p) => (
  <section className={styles.detailSection} id={p.domId}>
    <h3
      className={`${styles.detailSectionHeading} ${styles.modelSectionToggle}`}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={p.onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onToggle(); }
      }}
    >
      <Icon iconName={p.open ? 'ChevronDown' : 'ChevronRight'} className={styles.detailSectionChevron} />
      <Icon iconName={p.icon} className={styles.detailSectionIcon} />
      {p.title}
      <span className={styles.countChip}>{p.count}</span>
      <button
        type="button"
        className={styles.rowActionAdd}
        title={p.addLabel}
        aria-label={p.addLabel}
        onClick={(e) => { e.stopPropagation(); p.onAdd(); }}
      >
        <Icon iconName="Add" />
      </button>
    </h3>
    {p.open && (
      <div className={styles.detailSectionBody}>
        <p className={styles.muted}>{p.blurb}</p>
        <div className={styles.modelSectionFilter}>
          <SearchBox
            placeholder={p.filterPlaceholder}
            value={p.filterValue}
            onChange={(_, v) => p.onFilterChange(v || '')}
          />
        </div>
        {p.children}
      </div>
    )}
  </section>
);

const MODEL_SECTIONS_KEY = 'ontologyEditor.modelSections';

const ModelManager: React.FC<IModelManagerProps> = (props) => {
  const { db, writer, mutate, mutateError, onClearError, refreshToken } = props;

  // Which sections are unfolded — remembered per browser.
  const [openSections, setOpenSections] = React.useState<{ [id: string]: boolean }>(() => {
    const all = { classes: true, types: true, fields: true, labeltypes: true };
    try { return { ...all, ...JSON.parse(window.localStorage.getItem(MODEL_SECTIONS_KEY) || '{}') }; }
    catch { return all; }
  });
  const setSection = (id: string, open: boolean): void => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: open };
      try { window.localStorage.setItem(MODEL_SECTIONS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };
  const jumpTo = (id: string): void => {
    setSection(id, true);
    // Two frames let React commit and layout settle before the scroll starts.
    // Smooth scrollIntoView is an animation toward a coordinate, and SharePoint
    // pages scroll in a nested region — on some machines/browsers the animation
    // is abandoned mid-flight, so after it should have finished we check
    // whether it arrived and snap the rest of the way if not.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(`model-${id}`);
      if (!el || !el.scrollIntoView) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        const top = el.getBoundingClientRect().top;
        if (top < 0 || top > 160) el.scrollIntoView({ block: 'start' });
      }, 700);
    }));
  };

  const [dialog, setDialog] = React.useState<ModelDialog>({ kind: 'none' });
  const close = (): void => { setDialog({ kind: 'none' }); onClearError(); };

  const classes = React.useMemo(() => db.getClasses(), [db, refreshToken]);
  const properties = React.useMemo(() => db.getProperties(), [db, refreshToken]);
  const usage = React.useMemo(() => db.getPropertyUsage(), [db, refreshToken]);
  const conceptCounts = React.useMemo(() => db.getClassConceptCounts(), [db, refreshToken]);
  const metadataFields = React.useMemo(() => db.getMetadataFields(), [db, refreshToken]);
  const labelTypes = React.useMemo(() => db.getLabelTypes(), [db, refreshToken]);

  const classById = React.useMemo(() => {
    const m: { [id: number]: IOntologyClass } = {};
    for (const c of classes) m[c.id] = c;
    return m;
  }, [classes]);
  const propById = React.useMemo(() => {
    const m: { [id: number]: IOntologyProperty } = {};
    for (const p of properties) m[p.id] = p;
    return m;
  }, [properties]);

  const className = (id?: number): string => (id !== undefined && classById[id] && classById[id].label) || 'Any';

  // Show each pair once, from its "forward" side (the lower id), like the
  // Semaphore screen does — 280 rows would just be every pair twice.
  const pairRows = React.useMemo(
    () => properties.filter(p =>
      p.inversePropertyId === undefined || p.id <= p.inversePropertyId
    ),
    [properties]
  );

  // Per-section filters — 108 classes and 72 relationship pairs are too many
  // to scan by eye.
  const [classFilter, setClassFilter] = React.useState('');
  const [propFilter, setPropFilter] = React.useState('');
  const [fieldFilter, setFieldFilter] = React.useState('');
  const [labelTypeFilter, setLabelTypeFilter] = React.useState('');
  const has = (needle: string, ...hay: Array<string | undefined>): boolean =>
    hay.some(h => !!h && h.toLowerCase().indexOf(needle) >= 0);

  const shownClasses = React.useMemo(() => {
    const n = classFilter.trim().toLowerCase();
    if (!n) return classes;
    return classes.filter(c => has(n, c.label, c.definition,
      c.parentClassId !== undefined ? className(c.parentClassId) : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, classFilter, classById]);

  const shownPairs = React.useMemo(() => {
    const n = propFilter.trim().toLowerCase();
    if (!n) return pairRows;
    return pairRows.filter(p => {
      const inv = p.inversePropertyId !== undefined ? propById[p.inversePropertyId] : undefined;
      return has(n, p.label, inv && inv.label, p.definition,
        className(p.domainClassId), className(p.rangeClassId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairRows, propFilter, propById, classById]);

  const shownFields = React.useMemo(() => {
    const n = fieldFilter.trim().toLowerCase();
    if (!n) return metadataFields;
    return metadataFields.filter(f => has(n, f.label, f.definition, f.domainClassName));
  }, [metadataFields, fieldFilter]);

  const shownLabelTypes = React.useMemo(() => {
    const n = labelTypeFilter.trim().toLowerCase();
    if (!n) return labelTypes;
    return labelTypes.filter(t => has(n, t.label, t.definition, t.domainClassName));
  }, [labelTypes, labelTypeFilter]);

  const countText = (shown: number, total: number): string =>
    shown === total ? String(total) : `${shown} of ${total}`;

  return (
    <div className={styles.modelManager}>
      {/* Everything below is long tables — one row of pills to get anywhere. */}
      <div className={styles.modelJumpBar}>
        <span className={styles.muted}>Jump to:</span>
        <button type="button" className={styles.jumpPill} onClick={() => jumpTo('classes')}>Concept classes</button>
        <button type="button" className={styles.jumpPill} onClick={() => jumpTo('types')}>Relationship types</button>
        <button type="button" className={styles.jumpPill} onClick={() => jumpTo('fields')}>Metadata fields</button>
        <button type="button" className={styles.jumpPill} onClick={() => jumpTo('labeltypes')}>Label types</button>
      </div>

      <ModelSection
        domId="model-classes" icon="Tag" title="Concept classes"
        count={countText(shownClasses.length, classes.length)}
        addLabel="New class" onAdd={() => setDialog({ kind: 'newClass' })}
        filterValue={classFilter} onFilterChange={setClassFilter}
        filterPlaceholder="Filter classes…"
        blurb={'What kind of thing a concept is. Classes govern which relationship types a concept may use; ' +
          'the hierarchy below is between classes (subclasses inherit their parent’s relationship types) ' +
          'and is separate from the concept tree.'}
        open={!!openSections.classes} onToggle={() => setSection('classes', !openSections.classes)}
      >
        {classes.length === 0 ? (
          <MessageBar>No classes yet. Create classes first — they become the domain and range choices when relationship types are defined.</MessageBar>
        ) : (
          <table className={styles.fileTable}>
            <thead>
              <tr><th /><th>Name</th><th>Parent</th><th>Concepts</th><th>Definition</th><th /></tr>
            </thead>
            <tbody>
              {shownClasses.map(c => {
                const colour = db.getClassColour(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <span style={{
                        display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                        background: colour || '#e1e1e1'
                      }} />
                    </td>
                    <td>{c.label}</td>
                    <td>{c.parentClassId !== undefined ? className(c.parentClassId) : '—'}</td>
                    <td>{conceptCounts[c.id] || 0}</td>
                    <td className={styles.muted}>
                      {(c.definition || '').replace(/<[^>]+>/g, '').slice(0, 80)}
                    </td>
                    <td>
                      <button type="button" className={styles.rowActionEdit} title="Edit" aria-label="Edit" onClick={() => setDialog({ kind: 'editClass', cls: c })}><Icon iconName="Edit" /></button>
                      <button type="button" className={styles.rowActionDelete} title="Delete" aria-label="Delete" onClick={() => { if (mutate(() => writer.deleteClass(c.id))) close(); }}><Icon iconName="Delete" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ModelSection>

      <ModelSection
        domId="model-types" icon="Relationship" title="Relationship types"
        count={countText(shownPairs.length, pairRows.length)}
        addLabel="New relationship type" onAdd={() => setDialog({ kind: 'newProperty' })}
        filterValue={propFilter} onFilterChange={setPropFilter}
        filterPlaceholder="Filter relationship types…"
        blurb={'Each row is a pair: the relationship and its inverse are defined together and every link ' +
          'is stored once, readable from both ends. "Uses" counts stored links; a type in use cannot be deleted.'}
        open={!!openSections.types} onToggle={() => setSection('types', !openSections.types)}
      >
        {pairRows.length === 0 ? (
          <MessageBar>No relationship types yet. Define the types before linking concepts.</MessageBar>
        ) : (
          <table className={styles.fileTable}>
            <thead>
              <tr><th>Name</th><th>Inverse</th><th>From</th><th>To</th><th>Uses</th><th>Definition</th><th /></tr>
            </thead>
            <tbody>
              {shownPairs.map(p => {
                const inv = p.inversePropertyId !== undefined ? propById[p.inversePropertyId] : undefined;
                const uses = (usage[p.id] || 0) + (inv && inv.id !== p.id ? (usage[inv.id] || 0) : 0);
                return (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{inv ? (inv.id === p.id ? '(itself)' : inv.label) : '—'}</td>
                    <td>{className(p.domainClassId)}</td>
                    <td>{className(p.rangeClassId)}</td>
                    <td>{uses}</td>
                    <td className={styles.muted}>{(p.definition || '').slice(0, 60)}</td>
                    <td>
                      <button type="button" className={styles.rowActionEdit} title="Edit" aria-label="Edit" onClick={() => setDialog({ kind: 'editProperty', prop: p })}><Icon iconName="Edit" /></button>
                      <button type="button" className={styles.rowActionDelete} title="Delete" aria-label="Delete" onClick={() => { if (mutate(() => writer.deletePropertyPair(p.id))) close(); }}><Icon iconName="Delete" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ModelSection>

      <ModelSection
        domId="model-fields" icon="PageList" title="Metadata fields"
        count={countText(shownFields.length, metadataFields.length)}
        addLabel="New metadata field" onAdd={() => setDialog({ kind: 'newField' })}
        filterValue={fieldFilter} onFilterChange={setFieldFilter}
        filterPlaceholder="Filter metadata fields…"
        blurb={'The note fields concepts may carry (Semaphore’s Resource Metadata) — defined once here so ' +
          'every value uses the same field, never invented by typo on a concept. The standard SKOS notes ' +
          '(definition, scope note, …) are always available without being defined.'}
        open={!!openSections.fields} onToggle={() => setSection('fields', !openSections.fields)}
      >
        {metadataFields.length === 0 ? (
          <MessageBar>No custom metadata fields. Concepts still get the standard SKOS notes.</MessageBar>
        ) : (
          <table className={styles.fileTable}>
            <thead>
              <tr><th>Name</th><th>Applies to</th><th>Uses</th><th>Definition</th><th /></tr>
            </thead>
            <tbody>
              {shownFields.map(f => (
                <tr key={f.id}>
                  <td>{f.label || '(system)'}</td>
                  <td>{f.domainClassName || 'Any'}</td>
                  <td>{f.uses}</td>
                  <td className={styles.muted}>{(f.definition || '').slice(0, 60)}</td>
                  <td>
                    <button type="button" className={styles.rowActionEdit} title="Edit" aria-label="Edit" onClick={() => setDialog({ kind: 'editField', def: f })}><Icon iconName="Edit" /></button>
                    <button type="button" className={styles.rowActionDelete} title="Delete" aria-label="Delete" onClick={() => { if (mutate(() => writer.deleteMetadataField(f.id))) close(); }}><Icon iconName="Delete" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ModelSection>

      <ModelSection
        domId="model-labeltypes" icon="Dictionary" title="Label types"
        count={countText(shownLabelTypes.length, labelTypes.length)}
        addLabel="New label type" onAdd={() => setDialog({ kind: 'newLabelType' })}
        filterValue={labelTypeFilter} onFilterChange={setLabelTypeFilter}
        filterPlaceholder="Filter label types…"
        blurb={'The roles a label can play beyond preferred/alternative — Acronym, Has code, Has evidence ' +
          'and so on. Defined here, then offered in the label dialog on every concept.'}
        open={!!openSections.labeltypes} onToggle={() => setSection('labeltypes', !openSections.labeltypes)}
      >
        {labelTypes.length === 0 ? (
          <MessageBar>No label types. Labels can still be added as &quot;Alternative label&quot;.</MessageBar>
        ) : (
          <table className={styles.fileTable}>
            <thead>
              <tr><th>Name</th><th>Applies to</th><th>Uses</th><th>Definition</th><th /></tr>
            </thead>
            <tbody>
              {shownLabelTypes.map(t => (
                <tr key={t.id}>
                  <td>{t.label || '(unnamed)'}</td>
                  <td>{t.domainClassName || 'Any'}</td>
                  <td>{t.uses}</td>
                  <td className={styles.muted}>{(t.definition || '').slice(0, 60)}</td>
                  <td>
                    <button type="button" className={styles.rowActionEdit} title="Edit" aria-label="Edit" onClick={() => setDialog({ kind: 'editLabelType', def: t })}><Icon iconName="Edit" /></button>
                    <button type="button" className={styles.rowActionDelete} title="Delete" aria-label="Delete" onClick={() => { if (mutate(() => writer.deleteLabelType(t.id))) close(); }}><Icon iconName="Delete" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ModelSection>

      {dialog.kind === 'newClass' && (
        <ClassDialog
          title="New class" classes={classes} showParent error={mutateError}
          onCancel={close}
          onSave={v => { if (mutate(() => writer.createClass(v))) close(); }}
        />
      )}
      {dialog.kind === 'editClass' && (
        <ClassDialog
          title="Edit class"
          classes={classes}
          showParent={false}
          initial={{
            label: dialog.cls.label || '',
            definition: dialog.cls.definition,
            colour: db.getClassColour(dialog.cls),
            parentClassId: dialog.cls.parentClassId
          }}
          error={mutateError}
          onCancel={close}
          onSave={v => {
            if (mutate(() => writer.updateClass(dialog.cls.id, {
              label: v.label, definition: v.definition || '', colour: v.colour || ''
            }))) close();
          }}
        />
      )}
      {dialog.kind === 'newProperty' && (
        <NewPropertyDialog
          db={db}
          error={mutateError}
          onCancel={close}
          onCreate={options => { if (mutate(() => writer.createPropertyPair(options))) close(); }}
        />
      )}
      {(dialog.kind === 'newField' || dialog.kind === 'newLabelType') && (
        <SimpleDefinitionDialog
          title={dialog.kind === 'newField' ? 'New metadata field' : 'New label type'}
          domainHint={dialog.kind === 'newField'
            ? 'Restrict which concepts may carry this field, e.g. RDS note only on RDS.'
            : 'Restrict which concepts may carry this label role, e.g. Has shoulder code only on Information.'}
          classes={classes}
          showDomain
          error={mutateError}
          onCancel={close}
          onSave={v => {
            const create = dialog.kind === 'newField'
              ? () => writer.createMetadataField(v)
              : () => writer.createLabelType(v);
            if (mutate(create)) close();
          }}
        />
      )}
      {(dialog.kind === 'editField' || dialog.kind === 'editLabelType') && (
        <SimpleDefinitionDialog
          title={dialog.kind === 'editField' ? 'Edit metadata field' : 'Edit label type'}
          domainHint=""
          classes={classes}
          showDomain={false}
          initial={{ label: dialog.def.label || '', definition: dialog.def.definition }}
          error={mutateError}
          onCancel={close}
          onSave={v => {
            if (mutate(() => writer.updateSimpleProperty(dialog.def.id, {
              label: v.label, definition: v.definition
            }))) close();
          }}
        />
      )}
      {dialog.kind === 'editProperty' && (
        <EditPropertyDialog
          prop={dialog.prop}
          inverseLabel={
            dialog.prop.inversePropertyId !== undefined &&
            dialog.prop.inversePropertyId !== dialog.prop.id &&
            propById[dialog.prop.inversePropertyId]
              ? propById[dialog.prop.inversePropertyId].label
              : undefined
          }
          error={mutateError}
          onCancel={close}
          onSave={v => {
            if (mutate(() => writer.updatePropertyPair(dialog.prop.id, v))) close();
          }}
        />
      )}
    </div>
  );
};

export default ModelManager;
