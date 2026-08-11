import * as React from 'react';
import {
  Dialog, DialogType, DialogFooter, PrimaryButton, DefaultButton,
  TextField, Dropdown, IDropdownOption, SearchBox, MessageBar, MessageBarType,
  ChoiceGroup, IChoiceGroupOption, Label as FluentLabel
} from '@fluentui/react';
import styles from './OntologyEditor.module.scss';
import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import {
  ILabelFlagEdit, LABEL_FLAG_DEFINITIONS
} from '../../../services/database/OntologyWriter';
import { IConcept, ILabel } from '../../../models/IOntology';
import { localName } from '../../../services/turtle/Vocabulary';

/* ------------------------------------------------------------------ new -- */

export interface INewConceptDialogProps {
  db: OntologyDatabase;
  parent?: IConcept;
  onCancel: () => void;
  onCreate: (prefLabel: string, classId: number | undefined) => void;
  error?: string;
}

export const NewConceptDialog: React.FC<INewConceptDialogProps> = (props) => {
  const { db, parent, onCancel, onCreate, error } = props;
  const [label, setLabel] = React.useState('');
  // Default to the parent's class: children are usually the same kind of thing,
  // and an unclassed concept can hold no relationships at all.
  const [classId, setClassId] = React.useState<number | undefined>(parent ? parent.classId : undefined);

  const classOptions: IDropdownOption[] = React.useMemo(
    () => db.getClasses()
      .filter(c => !!c.label)
      .map(c => ({ key: c.id, text: c.label as string })),
    [db]
  );

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: parent ? `New concept under "${parent.prefLabel}"` : 'New concept'
      }}
      modalProps={{ isBlocking: true }}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}

      <TextField
        label="Preferred label"
        required
        autoFocus
        value={label}
        onChange={(_, v) => setLabel(v || '')}
        onKeyDown={e => { if (e.key === 'Enter' && label.trim()) onCreate(label, classId); }}
      />

      <Dropdown
        label="Concept class"
        placeholder="Select a class"
        selectedKey={classId}
        options={classOptions}
        onChange={(_, o) => setClassId(o ? Number(o.key) : undefined)}
      />
      <p className={styles.muted}>
        The class decides which relationships this concept may take. Without one
        it can hold none.
      </p>

      <DialogFooter>
        <PrimaryButton text="Create" disabled={!label.trim()} onClick={() => onCreate(label, classId)} />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/* --------------------------------------------------------------- picker -- */

export interface IConceptPickerDialogProps {
  db: OntologyDatabase;
  title: string;
  /** Restrict to concepts valid as the target of this property. */
  propertyId?: number;
  excludeConceptId?: number;
  onCancel: () => void;
  onPick: (conceptId: number) => void;
}

export const ConceptPickerDialog: React.FC<IConceptPickerDialogProps> = (props) => {
  const { db, title, propertyId, excludeConceptId, onCancel, onPick } = props;
  const [term, setTerm] = React.useState('');

  // With a property in hand, offer only concepts its range permits — the user
  // never sees a choice that validation would then reject.
  const results = React.useMemo(() => {
    const rows = propertyId !== undefined
      ? db.getValidTargets(propertyId, term, 60)
      : (term.trim() ? db.searchConcepts(term, 60) : []);
    return rows.filter(c => c.id !== excludeConceptId);
  }, [db, propertyId, term, excludeConceptId]);

  const classLabels = React.useMemo(() => db.getClassLabelMap(), [db]);

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{ type: DialogType.normal, title }}
      modalProps={{ isBlocking: true }}
      minWidth={520}
    >
      <SearchBox
        placeholder="Search concepts…"
        value={term}
        onChange={(_, v) => setTerm(v || '')}
      />
      <div className={styles.pickerResults}>
        {results.map(c => (
          <button key={c.id} type="button" className={styles.pickerRow} onClick={() => onPick(c.id)}>
            <span>{c.prefLabel || c.uri}</span>
            {c.classId !== undefined && classLabels[c.classId] && (
              <span className={styles.inlineClassChip}>{classLabels[c.classId]}</span>
            )}
          </button>
        ))}
        {results.length === 0 && (
          <div className={styles.muted} style={{ padding: 8 }}>
            {term.trim() ? 'No matches.' : 'Type to search.'}
          </div>
        )}
      </div>
      <DialogFooter>
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/* ---------------------------------------------------------------- label -- */

export interface ILabelDialogProps {
  db: OntologyDatabase;
  /** Existing label to edit; omit to create a new one. */
  label?: ILabel;
  onCancel: () => void;
  onSave: (literalForm: string, labelProperty: string, flags: ILabelFlagEdit) => void;
  error?: string;
}

/**
 * Mirrors Semaphore's "Edit Label Settings" dialog.
 *
 * Every setting is tri-state, and **Default is not a value** — it means the
 * predicate is absent from the data. Writing an explicit default where nothing
 * existed would change the model, so "Default" saves nothing.
 */
export const LabelDialog: React.FC<ILabelDialogProps> = (props) => {
  const { db, label, onCancel, onSave, error } = props;

  const [form, setForm] = React.useState(label ? label.literalForm : '');
  const [role, setRole] = React.useState(
    label ? label.labelProperty : 'http://www.w3.org/2008/05/skos-xl#altLabel'
  );
  const [flags, setFlags] = React.useState<ILabelFlagEdit>(() => {
    const initial: ILabelFlagEdit = {};
    if (label && label.flags) {
      for (const pred of Object.keys(label.flags)) {
        const terms = label.flags[pred];
        if (terms && terms.length) initial[pred] = terms[0].v;
      }
    }
    return initial;
  });

  // Label roles are the properties whose range is a skosxl:Label.
  const roleOptions: IDropdownOption[] = React.useMemo(() => {
    const rows = db.raw.exec(
      `SELECT uri, label FROM properties WHERE is_label_property = 1 ORDER BY label`
    );
    const opts: IDropdownOption[] = rows.length
      ? rows[0].values.map(r => ({ key: String(r[0]), text: r[1] ? String(r[1]) : localName(String(r[0])) }))
      : [];
    const altLabel = 'http://www.w3.org/2008/05/skos-xl#altLabel';
    if (!opts.some(o => o.key === altLabel)) {
      opts.unshift({ key: altLabel, text: 'Alternative label' });
    }
    return opts;
  }, [db]);

  const isPattern = /[*~#]/.test(form);

  const setFlag = (predicate: string, value: string | undefined): void => {
    setFlags(prev => {
      const next = { ...prev };
      if (value === undefined) delete next[predicate];
      else next[predicate] = value;
      return next;
    });
  };

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: label ? `Edit label — "${label.literalForm}"` : 'Add a label'
      }}
      modalProps={{ isBlocking: true }}
      minWidth={560}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}

      <TextField label="Value" required autoFocus value={form} onChange={(_, v) => setForm(v || '')} />

      {isPattern && (
        <MessageBar messageBarType={MessageBarType.warning} isMultiline>
          This value contains classifier wildcard syntax (<code>* ~ #</code>).
          It is a matching rule, not prose — changing it changes which documents
          get tagged.
        </MessageBar>
      )}

      <Dropdown
        label="Role"
        selectedKey={role}
        options={roleOptions}
        disabled={!!label}
        onChange={(_, o) => setRole(String(o ? o.key : role))}
      />

      <h4 className={styles.flagsHeading}>Matching settings</h4>
      <p className={styles.muted}>
        These tell the classifier how to recognise this term in documents.
        <strong> Default</strong> means no setting is stored — leave it there
        unless you mean to override it.
      </p>

      {LABEL_FLAG_DEFINITIONS.map(def => {
        const options: IChoiceGroupOption[] = [
          { key: '__default__', text: 'Default' },
          ...def.options.map(o => ({ key: o.value, text: o.text }))
        ];
        return (
          <div key={def.predicate} className={styles.flagRow}>
            <FluentLabel className={styles.flagLabel}>{def.label}</FluentLabel>
            <ChoiceGroup
              className={styles.flagChoices}
              selectedKey={flags[def.predicate] || '__default__'}
              options={options}
              onChange={(_, o) => setFlag(def.predicate, !o || o.key === '__default__' ? undefined : String(o.key))}
            />
          </div>
        );
      })}

      <DialogFooter>
        <PrimaryButton text="Save" disabled={!form.trim()} onClick={() => onSave(form, role, flags)} />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/* -------------------------------------------------------------- rename -- */

export const RenamePrompt: React.FC<{
  initial: string;
  error?: string;
  onCancel: () => void;
  onSave: (value: string) => void;
}> = ({ initial, error, onCancel, onSave }) => {
  const [value, setValue] = React.useState(initial);
  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{ type: DialogType.normal, title: 'Rename concept' }}
      modalProps={{ isBlocking: true }}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
      <TextField
        label="Preferred label"
        autoFocus
        value={value}
        onChange={(_, v) => setValue(v || '')}
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onSave(value); }}
      />
      <p className={styles.muted}>
        The URI does not change, so existing relationships are unaffected.
      </p>
      <DialogFooter>
        <PrimaryButton text="Save" disabled={!value.trim()} onClick={() => onSave(value)} />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/* ----------------------------------------------------- property picker -- */

export const PropertyPicker: React.FC<{
  properties: Array<{ propertyId: number; label: string | undefined; rangeClassName: string | undefined; definition: string | undefined }>;
  onCancel: () => void;
  onPick: (propertyId: number, propertyLabel: string) => void;
}> = ({ properties, onCancel, onPick }) => (
  <Dialog
    hidden={false}
    onDismiss={onCancel}
    dialogContentProps={{
      type: DialogType.normal,
      title: 'Choose a relationship type',
      subText: 'Only relationships declared for this concept\'s class are listed.'
    }}
    modalProps={{ isBlocking: true }}
    minWidth={560}
  >
    <div className={styles.pickerResults}>
      {properties.map(p => (
        <button
          key={p.propertyId}
          type="button"
          className={styles.pickerRow}
          onClick={() => onPick(p.propertyId, p.label || 'relationship')}
        >
          <span>
            <strong>{p.label}</strong>
            {/* The taxonomy team's own note on when to use this — it exists
                nowhere else once Semaphore is gone. */}
            {p.definition && <div className={styles.pickerHint}>{p.definition}</div>}
          </span>
          <span className={styles.inlineClassChip}>
            {p.rangeClassName || 'any concept'}
          </span>
        </button>
      ))}
      {properties.length === 0 && (
        <div className={styles.muted} style={{ padding: 8 }}>
          No relationships are declared for this concept&rsquo;s class. Give it a
          class first, or add the property to the model.
        </div>
      )}
    </div>
    <DialogFooter>
      <DefaultButton text="Cancel" onClick={onCancel} />
    </DialogFooter>
  </Dialog>
);

/* ------------------------------------------------------------- confirm -- */

export const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, message, confirmText, danger, error, onCancel, onConfirm }) => (
  <Dialog
    hidden={false}
    onDismiss={onCancel}
    dialogContentProps={{ type: DialogType.normal, title, subText: message }}
    modalProps={{ isBlocking: true }}
  >
    {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
    <DialogFooter>
      <PrimaryButton
        text={confirmText}
        onClick={onConfirm}
        styles={danger ? { root: { backgroundColor: '#a4262c', borderColor: '#a4262c' } } : undefined}
      />
      <DefaultButton text="Cancel" onClick={onCancel} />
    </DialogFooter>
  </Dialog>
);

/* ------------------------------------------------------------- metadata -- */

export interface IAnnotationDialogProps {
  initialValue?: string;
  predicateUri?: string;
  db: OntologyDatabase;
  onCancel: () => void;
  onSave: (predicateUri: string, value: string) => void;
}

export const AnnotationDialog: React.FC<IAnnotationDialogProps> = (props) => {
  const { db, initialValue, predicateUri, onCancel, onSave } = props;
  const [value, setValue] = React.useState(initialValue || '');
  const [pred, setPred] = React.useState(
    predicateUri || 'http://www.w3.org/2004/02/skos/core#definition'
  );

  // Offer the annotation predicates already used in the model, so the editor
  // does not invent new vocabulary by accident.
  const predOptions: IDropdownOption[] = React.useMemo(() => {
    const rows = db.raw.exec(
      `SELECT predicate_uri, COUNT(*) n FROM annotations GROUP BY 1 ORDER BY n DESC LIMIT 40`
    );
    return rows.length
      ? rows[0].values.map(r => ({ key: String(r[0]), text: localName(String(r[0])) }))
      : [];
  }, [db]);

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: predicateUri ? `Edit ${localName(predicateUri)}` : 'Add metadata'
      }}
      modalProps={{ isBlocking: true }}
      minWidth={520}
    >
      <Dropdown
        label="Field"
        selectedKey={pred}
        options={predOptions}
        disabled={!!predicateUri}
        onChange={(_, o) => setPred(String(o ? o.key : pred))}
      />
      <TextField label="Value" multiline rows={5} autoFocus value={value} onChange={(_, v) => setValue(v || '')} />
      <DialogFooter>
        <PrimaryButton text="Save" onClick={() => onSave(pred, value)} />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};
