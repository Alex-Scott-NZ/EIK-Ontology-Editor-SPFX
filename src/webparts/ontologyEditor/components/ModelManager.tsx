import * as React from 'react';
import {
  DefaultButton, PrimaryButton, TextField, Dropdown, IDropdownOption,
  Dialog, DialogType, DialogFooter, MessageBar, MessageBarType, IconButton
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

type ModelDialog =
  | { kind: 'none' }
  | { kind: 'newClass' }
  | { kind: 'editClass'; cls: IOntologyClass }
  | { kind: 'newProperty' }
  | { kind: 'editProperty'; prop: IOntologyProperty };

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

const ModelManager: React.FC<IModelManagerProps> = (props) => {
  const { db, writer, mutate, mutateError, onClearError, refreshToken } = props;

  const [dialog, setDialog] = React.useState<ModelDialog>({ kind: 'none' });
  const close = (): void => { setDialog({ kind: 'none' }); onClearError(); };

  const classes = React.useMemo(() => db.getClasses(), [db, refreshToken]);
  const properties = React.useMemo(() => db.getProperties(), [db, refreshToken]);
  const usage = React.useMemo(() => db.getPropertyUsage(), [db, refreshToken]);
  const conceptCounts = React.useMemo(() => db.getClassConceptCounts(), [db, refreshToken]);

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

  return (
    <div className={styles.modelManager}>
      <section>
        <div className={styles.modelSectionHeader}>
          <h3>Concept classes ({classes.length})</h3>
          <DefaultButton
            text="New class" iconProps={{ iconName: 'Add' }}
            onClick={() => setDialog({ kind: 'newClass' })}
          />
        </div>
        <p className={styles.muted}>
          What kind of thing a concept is. Classes govern which relationship
          types a concept may use; the hierarchy below is between classes
          (subclasses inherit their parent&apos;s relationship types) and is separate
          from the concept tree.
        </p>
        {classes.length === 0 ? (
          <MessageBar>No classes yet. Create classes first — they become the domain and range choices when relationship types are defined.</MessageBar>
        ) : (
          <table className={styles.fileTable}>
            <thead>
              <tr><th /><th>Name</th><th>Parent</th><th>Concepts</th><th>Definition</th><th /></tr>
            </thead>
            <tbody>
              {classes.map(c => {
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
                      <IconButton
                        iconProps={{ iconName: 'Edit' }} title="Edit"
                        onClick={() => setDialog({ kind: 'editClass', cls: c })}
                      />
                      <IconButton
                        iconProps={{ iconName: 'Delete' }} title="Delete"
                        onClick={() => { if (mutate(() => writer.deleteClass(c.id))) close(); }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <div className={styles.modelSectionHeader}>
          <h3>Relationship types ({pairRows.length})</h3>
          <DefaultButton
            text="New relationship type" iconProps={{ iconName: 'Add' }}
            onClick={() => setDialog({ kind: 'newProperty' })}
          />
        </div>
        <p className={styles.muted}>
          Each row is a pair: the relationship and its inverse are defined
          together and every link is stored once, readable from both ends.
          &quot;Uses&quot; counts stored links; a type in use cannot be deleted.
        </p>
        {pairRows.length === 0 ? (
          <MessageBar>No relationship types yet. Define the types before linking concepts.</MessageBar>
        ) : (
          <table className={styles.fileTable}>
            <thead>
              <tr><th>Name</th><th>Inverse</th><th>From</th><th>To</th><th>Uses</th><th>Definition</th><th /></tr>
            </thead>
            <tbody>
              {pairRows.map(p => {
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
                      <IconButton
                        iconProps={{ iconName: 'Edit' }} title="Edit"
                        onClick={() => setDialog({ kind: 'editProperty', prop: p })}
                      />
                      <IconButton
                        iconProps={{ iconName: 'Delete' }} title="Delete"
                        onClick={() => { if (mutate(() => writer.deletePropertyPair(p.id))) close(); }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

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
