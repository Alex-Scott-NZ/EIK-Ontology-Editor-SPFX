import * as React from 'react';
import {
  Dialog, DialogType, DialogFooter, PrimaryButton, DefaultButton,
  TextField, Dropdown, IDropdownOption, ComboBox, IComboBox, SearchBox, MessageBar, MessageBarType,
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

      <FilteringCombo
        label="Concept class"
        placeholder="Select a class"
        selectedKey={classId}
        options={classOptions}
        onPick={(k) => setClassId(Number(k))}
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

/* ------------------------------------------------------------ save as -- */

export const SaveAsDialog: React.FC<{
  initialName: string;
  /** Hidden when there is no SharePoint context (e.g. local workbench). */
  canSaveToSharePoint: boolean;
  folderPath?: string;
  onDownload: (fileName: string) => void;
  onSaveToSharePoint: (fileName: string) => void;
  onCancel: () => void;
}> = ({ initialName, canSaveToSharePoint, folderPath, onDownload, onSaveToSharePoint, onCancel }) => {
  const [name, setName] = React.useState(initialName);
  const cleaned = (): string => {
    const n = name.trim().replace(/[\\/:*?"<>|]/g, '-');
    return /\.sqlite$/i.test(n) ? n : `${n}.sqlite`;
  };
  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: 'Save as…',
        subText: canSaveToSharePoint && folderPath
          ? `SharePoint saves go to ${folderPath}. Later quick-saves reuse this name.`
          : 'Later quick-saves reuse this name.'
      }}
      modalProps={{ isBlocking: true }}
      minWidth={480}
    >
      <TextField
        label="File name" required autoFocus
        value={name}
        onChange={(_, v) => setName(v || '')}
        description=".sqlite is added automatically"
      />
      <DialogFooter>
        {canSaveToSharePoint && (
          <PrimaryButton
            text="Save to SharePoint" disabled={!name.trim()}
            onClick={() => onSaveToSharePoint(cleaned())}
          />
        )}
        <DefaultButton
          text="Download" disabled={!name.trim()}
          onClick={() => onDownload(cleaned())}
        />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

/* ------------------------------------------------------- change class -- */

export const ChangeClassDialog: React.FC<{
  db: OntologyDatabase;
  conceptLabel: string;
  currentClassId?: number;
  error?: string;
  onCancel: () => void;
  onSave: (classId: number | undefined) => void;
}> = ({ db, conceptLabel, currentClassId, error, onCancel, onSave }) => {
  const [classId, setClassId] = React.useState<number | undefined>(currentClassId);

  const options: IDropdownOption[] = React.useMemo(
    () => [
      { key: -1, text: '(no class)' },
      ...db.getClasses().filter(c => !!c.label).map(c => ({ key: c.id, text: c.label as string }))
    ],
    [db]
  );

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: `Change class of "${conceptLabel}"`,
        subText: 'The class decides which relationship types this concept may take. ' +
                 'Its position in the tree does not change.'
      }}
      modalProps={{ isBlocking: true }}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}

      <FilteringCombo
        label="Concept class"
        selectedKey={classId === undefined ? -1 : classId}
        options={options}
        onPick={(k) => setClassId(Number(k) >= 0 ? Number(k) : undefined)}
      />
      <MessageBar messageBarType={MessageBarType.info} isMultiline>
        Existing relationships are kept even if the new class would not allow
        creating them today — review them after changing.
      </MessageBar>

      <DialogFooter>
        <PrimaryButton
          text="Change" disabled={classId === currentClassId}
          onClick={() => onSave(classId)}
        />
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
  // never sees a choice that validation would then reject. An empty search
  // shows the first candidates rather than an empty list, so there is always
  // something to pick from.
  const results = React.useMemo(() => {
    const rows = propertyId !== undefined
      ? db.getValidTargets(propertyId, term, 60)
      : db.searchConcepts(term.trim(), 60);
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
          <div className={styles.muted} style={{ padding: 8 }}>No matches.</div>
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
      minWidth={680}
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
  /** Offers "define a new type" inline, so a missing type is not a dead end. */
  onDefineNew?: () => void;
}> = ({ properties, onCancel, onPick, onDefineNew }) => {
  const [term, setTerm] = React.useState('');
  const needle = term.trim().toLowerCase();
  const shown = needle
    ? properties.filter(p =>
        (p.label || '').toLowerCase().indexOf(needle) >= 0 ||
        (p.definition || '').toLowerCase().indexOf(needle) >= 0 ||
        (p.rangeClassName || '').toLowerCase().indexOf(needle) >= 0)
    : properties;
  return (
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
    <SearchBox
      placeholder="Filter relationship types…"
      value={term}
      onChange={(_, v) => setTerm(v || '')}
    />
    <div className={styles.pickerResults}>
      {shown.map(p => (
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
      {shown.length === 0 && (
        <div className={styles.muted} style={{ padding: 8 }}>
          {properties.length === 0
            ? 'No relationships are declared for this concept’s class. Give it a class, or define a new relationship type below.'
            : 'No relationship types match the filter.'}
        </div>
      )}
    </div>
    <DialogFooter>
      {onDefineNew && (
        <DefaultButton
          text="Define a new type…"
          iconProps={{ iconName: 'Add' }}
          onClick={onDefineNew}
        />
      )}
      <DefaultButton text="Cancel" onClick={onCancel} />
    </DialogFooter>
  </Dialog>
  );
};

/* --------------------------------------------- new relationship TYPE -- */

export interface INewPropertyDialogProps {
  db: OntologyDatabase;
  /** Pre-selects the domain — usually the class of the concept you started from. */
  suggestedDomainClassId?: number;
  error?: string;
  onCancel: () => void;
  onCreate: (options: {
    label: string; inverseLabel?: string;
    domainClassId?: number; rangeClassId?: number; definition?: string;
  }) => void;
}

/**
 * Defines a new relationship type — a change to the model, not to a concept.
 *
 * Domain and range are the whole point: they decide which concepts may use it
 * and what they may point at. Leaving them blank is allowed but makes the
 * relationship unconstrained, which is how validation stops being useful.
 */
export const NewPropertyDialog: React.FC<INewPropertyDialogProps> = (props) => {
  const { db, suggestedDomainClassId, error, onCancel, onCreate } = props;

  const [label, setLabel] = React.useState('');
  const [inverseLabel, setInverseLabel] = React.useState('');
  const [domainClassId, setDomainClassId] = React.useState<number | undefined>(suggestedDomainClassId);
  const [rangeClassId, setRangeClassId] = React.useState<number | undefined>(undefined);
  const [definition, setDefinition] = React.useState('');

  const classOptions: IDropdownOption[] = React.useMemo(
    () => db.getClasses().filter(c => !!c.label).map(c => ({ key: c.id, text: c.label as string })),
    [db]
  );
  const anyOption: IDropdownOption = { key: -1, text: 'Any concept' };

  const domainName = domainClassId !== undefined
    ? (classOptions.filter(o => o.key === domainClassId)[0] || { text: '?' }).text : 'any concept';
  const rangeName = rangeClassId !== undefined
    ? (classOptions.filter(o => o.key === rangeClassId)[0] || { text: '?' }).text : 'any concept';

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: 'Define a new relationship type',
        subText: 'This changes the model — every concept of the chosen class will be able to use it.'
      }}
      modalProps={{ isBlocking: true }}
      minWidth={560}
    >
      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}

      <TextField
        label="Name" required autoFocus placeholder="e.g. Has responsible team"
        value={label} onChange={(_, v) => setLabel(v || '')}
      />
      <TextField
        label="Inverse name"
        placeholder="e.g. Is responsible team for"
        description="Leave blank only if the relationship genuinely reads one way. 142 of the model's 151 types are paired."
        value={inverseLabel} onChange={(_, v) => setInverseLabel(v || '')}
      />

      <FilteringCombo
        label="From (domain)"
        selectedKey={domainClassId === undefined ? -1 : domainClassId}
        options={[anyOption, ...classOptions]}
        onPick={(k) => setDomainClassId(Number(k) >= 0 ? Number(k) : undefined)}
      />
      <FilteringCombo
        label="To (range)"
        selectedKey={rangeClassId === undefined ? -1 : rangeClassId}
        options={[anyOption, ...classOptions]}
        onPick={(k) => setRangeClassId(Number(k) >= 0 ? Number(k) : undefined)}
      />

      <MessageBar messageBarType={MessageBarType.info} isMultiline>
        {label.trim() || 'This relationship'} will be usable from <strong>{domainName}</strong>
        {' '}and may point at <strong>{rangeName}</strong>. Subclasses are included.
      </MessageBar>

      <TextField
        label="Definition"
        multiline rows={3}
        description="Why this exists and when to use it. Shown in the picker — and it is the only place this reasoning will survive."
        value={definition} onChange={(_, v) => setDefinition(v || '')}
      />

      <DialogFooter>
        <PrimaryButton
          text="Create" disabled={!label.trim()}
          onClick={() => onCreate({
            label, inverseLabel: inverseLabel.trim() || undefined,
            domainClassId, rangeClassId, definition: definition.trim() || undefined
          })}
        />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

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

/* ------------------------------------------------- filtering combo box -- */

/**
 * A ComboBox whose menu actually narrows as you type. Fluent's own
 * autoComplete only moves the highlight to the first match — with 108
 * classes that reads as "there is no search". Substring, case-insensitive.
 */
export const FilteringCombo: React.FC<{
  label: string;
  placeholder?: string;
  selectedKey: number | string | undefined;
  options: IDropdownOption[];
  onPick: (key: number | string) => void;
}> = ({ label, placeholder, selectedKey, options, onPick }) => {
  const [filter, setFilter] = React.useState('');
  const comboRef = React.useRef<IComboBox>(null);
  const menuOpen = React.useRef(false);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? options.filter(o => o.text.toLowerCase().indexOf(needle) >= 0)
    : options;
  return (
    <ComboBox
      componentRef={comboRef}
      label={label}
      placeholder={placeholder || 'Type to filter…'}
      selectedKey={selectedKey}
      options={shown.length ? shown : [{ key: '__none__', text: 'No matches', disabled: true }]}
      allowFreeform
      autoComplete="off"
      useComboBoxAsMenuWidth
      openOnKeyboardFocus
      // Capped so the unfiltered list of 100+ classes still fits BELOW the
      // field and scrolls inside — otherwise Fluent's positioning gives up
      // and throws a full-height column beside the dialog.
      calloutProps={{ calloutMaxHeight: 320 }}
      onMenuOpen={() => { menuOpen.current = true; }}
      onMenuDismissed={() => { menuOpen.current = false; }}
      onInputValueChange={(v) => {
        setFilter(v || '');
        // Typing into a closed box must open the menu, or the filtering is
        // invisible — Fluent only opens it from the caret by default.
        if (!menuOpen.current && comboRef.current) comboRef.current.focus(true);
      }}
      onChange={(_, o) => {
        if (o && o.key !== '__none__') { onPick(o.key); setFilter(''); }
      }}
    />
  );
};

/* ------------------------------------------------------------- metadata -- */

export interface IAnnotationDialogProps {
  initialValue?: string;
  predicateUri?: string;
  db: OntologyDatabase;
  /** Filters defined metadata fields to those whose domain fits this concept. */
  conceptId?: number;
  onCancel: () => void;
  onSave: (predicateUri: string, value: string) => void;
}

export const AnnotationDialog: React.FC<IAnnotationDialogProps> = (props) => {
  const { db, initialValue, predicateUri, conceptId, onCancel, onSave } = props;
  const [value, setValue] = React.useState(initialValue || '');
  const [pred, setPred] = React.useState(
    predicateUri || 'http://www.w3.org/2004/02/skos/core#definition'
  );

  // The standard note fields (Semaphore's "first class metadata"), so a blank
  // ontology has somewhere to start...
  const SKOS = 'http://www.w3.org/2004/02/skos/core#';
  const standard: Array<[string, string]> = [
    [SKOS + 'definition', 'definition'],
    [SKOS + 'scopeNote', 'scope note'],
    [SKOS + 'editorialNote', 'editorial note'],
    [SKOS + 'historyNote', 'history note'],
    [SKOS + 'example', 'example'],
    ['http://www.w3.org/2000/01/rdf-schema#comment', 'comment']
  ];
  // ...then the model's own DEFINED fields (domain-aware — a field restricted
  // to RDS is not offered on a Country), then any predicate already in use
  // that neither list covers, so imported vocabulary keeps working.
  const predOptions: IDropdownOption[] = React.useMemo(() => {
    const seen: { [uri: string]: true } = {};
    const options: IDropdownOption[] = [];
    if (conceptId !== undefined) {
      for (const f of db.getMetadataFieldsFor(conceptId)) {
        if (!seen[f.uri]) {
          seen[f.uri] = true;
          options.push({ key: f.uri, text: f.label || localName(f.uri) });
        }
      }
    }
    for (const [uri, text] of standard) {
      if (!seen[uri]) {
        seen[uri] = true;
        options.push({ key: uri, text });
      }
    }
    const rows = db.raw.exec(
      `SELECT predicate_uri, COUNT(*) n FROM annotations GROUP BY 1 ORDER BY n DESC LIMIT 40`
    );
    if (rows.length) {
      for (const r of rows[0].values) {
        const uri = String(r[0]);
        if (!seen[uri]) { seen[uri] = true; options.push({ key: uri, text: localName(uri) }); }
      }
    }
    // The field being edited must be selectable even if nothing above found it.
    if (predicateUri && !seen[predicateUri]) {
      options.push({ key: predicateUri, text: localName(predicateUri) });
    }
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, conceptId]);

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
      {/* The model defines dozens of fields — typing filters the list. */}
      <FilteringCombo
        label="Field"
        selectedKey={pred}
        options={predOptions}
        onPick={(k) => setPred(String(k))}
      />
      <TextField label="Value" multiline rows={5} autoFocus value={value} onChange={(_, v) => setValue(v || '')} />
      <DialogFooter>
        <PrimaryButton text="Save" onClick={() => onSave(pred, value)} />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};
