import * as React from 'react';
import {
  SearchBox, Spinner, SpinnerSize, MessageBar, MessageBarType,
  CommandBar, ICommandBarItemProps, Pivot, PivotItem
} from '@fluentui/react';
import { SqlJsStatic } from 'sql.js';

import styles from './OntologyEditor.module.scss';
import { IOntologyEditorProps } from './IOntologyEditorProps';
import SourcePicker, { ISourceChoice } from './SourcePicker';
import ConceptTree from './ConceptTree';
import ConceptList from './ConceptList';
import ModelManager from './ModelManager';
import ConceptDetailPane from './ConceptDetail';

import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { getSqlJs } from '../../../services/database/sqlJsLoader';
import { OntologyWriter, ValidationFailure, ILabelFlagEdit } from '../../../services/database/OntologyWriter';
import { importTurtle, ImportPhase } from '../../../services/import/OntologyImporter';
import {
  FileService, readLocalFileAsText, readLocalFileAsArrayBuffer, downloadBytes
} from '../../../services/sharepoint/FileService';
import { IOntologyStats, ITreeNode, ILabel, IAnnotation, IConcept } from '../../../models/IOntology';
import { IConceptEditHandlers } from './ConceptDetail';
import {
  NewConceptDialog, ConceptPickerDialog, LabelDialog, AnnotationDialog,
  RenamePrompt, PropertyPicker, ConfirmDialog, NewPropertyDialog, ChangeClassDialog
} from './ConceptDialogs';
import { localName } from '../../../services/turtle/Vocabulary';

/** Which modal is open, and what it is operating on. */
type DialogState =
  | { kind: 'none' }
  | { kind: 'newConcept'; parent?: IConcept }
  | { kind: 'rename' }
  | { kind: 'changeClass' }
  | { kind: 'addLabel' }
  | { kind: 'editLabel'; label: ILabel }
  | { kind: 'pickRelationshipProperty' }
  | { kind: 'newProperty' }
  | { kind: 'pickRelationshipTarget'; propertyId: number; propertyLabel: string }
  | { kind: 'pickBroader' }
  | { kind: 'addAnnotation' }
  | { kind: 'editAnnotation'; annotation: IAnnotation }
  | { kind: 'confirmDelete'; node: ITreeNode; impact: string }
  | { kind: 'confirm'; title: string; message: string; act: () => void };

type Stage = 'choosing' | 'working' | 'ready';
type ViewMode = 'tree' | 'list' | 'model';

/** Lets the browser repaint between import phases. */
function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const PHASE_TEXT: { [k in ImportPhase]: string } = {
  parsing: 'Parsing Turtle…',
  classifying: 'Classifying subjects…',
  schema: 'Creating the database…',
  classes: 'Importing classes…',
  properties: 'Importing relationship types…',
  labels: 'Reading labels…',
  concepts: 'Importing concepts…',
  relationships: 'Importing relationships…',
  passthrough: 'Preserving unmodelled triples…',
  finalising: 'Finalising…'
};

const OntologyEditor: React.FC<IOntologyEditorProps> = (props) => {
  const { databaseUrl, libraryFolder, context } = props;

  const [stage, setStage] = React.useState<Stage>('choosing');
  const [progress, setProgress] = React.useState<string>('');
  const [error, setError] = React.useState<string | undefined>(undefined);

  const [db, setDb] = React.useState<OntologyDatabase | undefined>(undefined);
  const [stats, setStats] = React.useState<IOntologyStats | undefined>(undefined);
  const [classColours, setClassColours] = React.useState<{ [id: number]: string }>({});
  const [classLabels, setClassLabels] = React.useState<{ [id: number]: string }>({});

  const [view, setView] = React.useState<ViewMode>('tree');
  const [search, setSearch] = React.useState<string>('');
  const [selectedId, setSelectedId] = React.useState<number | undefined>(undefined);
  const [revealPath, setRevealPath] = React.useState<number[] | undefined>(undefined);
  const [sourceLabel, setSourceLabel] = React.useState<string>('');

  const [writer, setWriter] = React.useState<OntologyWriter | undefined>(undefined);
  const [dialog, setDialog] = React.useState<DialogState>({ kind: 'none' });
  const [dialogError, setDialogError] = React.useState<string | undefined>(undefined);
  // Views memoise their queries; bumping this refetches after a mutation.
  const [refreshToken, setRefreshToken] = React.useState<number>(0);
  const [pendingChanges, setPendingChanges] = React.useState<number>(0);

  const fileService = React.useMemo(
    () => (context ? new FileService(context) : undefined), [context]
  );

  const adopt = React.useCallback((database: OntologyDatabase, label: string): void => {
    setDb(database);
    setWriter(new OntologyWriter(
      database.raw,
      (context && context.pageContext.user && context.pageContext.user.email) || 'unknown'
    ));
    setStats(database.getStats());
    setClassColours(database.getClassColourMap());
    setClassLabels(database.getClassLabelMap());
    setSourceLabel(label);
    setSelectedId(undefined);
    setPendingChanges(0);
    setRefreshToken(t => t + 1);
    setStage('ready');
  }, [context]);

  /**
   * Run a mutation, refresh the views, and surface validation failures in the
   * dialog rather than as an unexplained no-op.
   * Returns true when the mutation succeeded.
   */
  const mutate = React.useCallback((fn: () => void): boolean => {
    if (!writer || !db) return false;
    try {
      setDialogError(undefined);
      fn();
      setStats(db.getStats());
      // Model-tab edits can add classes/colours the tree needs.
      setClassColours(db.getClassColourMap());
      setClassLabels(db.getClassLabelMap());
      setPendingChanges(writer.getChangeCount());
      setRefreshToken(t => t + 1);
      return true;
    } catch (e) {
      if (e instanceof ValidationFailure) setDialogError(e.message);
      else setDialogError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [writer, db]);

  // -- Loading paths ---------------------------------------------------------

  const openSqlite = React.useCallback(async (bytes: ArrayBuffer, label: string): Promise<void> => {
    setProgress('Opening database…');
    const database = await OntologyDatabase.load(bytes);
    adopt(database, label);
  }, [adopt]);

  const runImport = React.useCallback(async (ttl: string, label: string, bytes: number): Promise<void> => {
    setProgress(PHASE_TEXT.parsing);
    await yieldToBrowser();

    const SQL: SqlJsStatic = await getSqlJs();

    // The import is synchronous and CPU-bound; onProgress paints the phase name
    // but cannot interrupt a phase. The tab will be unresponsive during the
    // long ones — the picker warns about this before we get here.
    const result = importTurtle(ttl, SQL, {
      sourceName: label,
      sourceBytes: bytes,
      onProgress: (phase) => setProgress(PHASE_TEXT[phase])
    });

    if (result.parseAnomalies > 0) {
      setError(
        `${result.parseAnomalies} statements could not be parsed. The database was still ` +
        `created, but treat it as suspect until this is investigated.`
      );
    }
    adopt(OntologyDatabase.fromDatabase(result.database), label);
  }, [adopt]);

  const choose = React.useCallback(async (choice: ISourceChoice): Promise<void> => {
    setStage('working');
    setError(undefined);
    try {
      if (choice.kind === 'sqlite-local' && choice.file) {
        await openSqlite(await readLocalFileAsArrayBuffer(choice.file), choice.file.name);

      } else if (choice.kind === 'sqlite-library' && choice.path && fileService) {
        setProgress('Downloading database…');
        await yieldToBrowser();
        await openSqlite(await fileService.readFile(choice.path), choice.path);

      } else if (choice.kind === 'turtle-local' && choice.file) {
        setProgress('Reading file…');
        await yieldToBrowser();
        const text = await readLocalFileAsText(choice.file);
        await runImport(text, choice.file.name, choice.file.size);

      } else if (choice.kind === 'turtle-library' && choice.path && fileService) {
        setProgress('Downloading Turtle…');
        await yieldToBrowser();
        const text = await fileService.readText(choice.path);
        await runImport(text, choice.path, text.length);

      } else if (choice.kind === 'new') {
        setProgress('Creating an empty ontology…');
        await yieldToBrowser();
        adopt(await OntologyDatabase.createBlank(), 'New ontology (unsaved)');

      } else {
        throw new Error('That source is not available in this context.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('choosing');
    }
  }, [fileService, openSqlite, runImport, adopt]);

  // Auto-open the configured database, so a page-embedded web part needs no clicks.
  const autoLoaded = React.useRef(false);
  React.useEffect(() => {
    if (autoLoaded.current || !databaseUrl || !fileService) return;
    autoLoaded.current = true;
    void choose({ kind: 'sqlite-library', path: databaseUrl });
  }, [databaseUrl, fileService, choose]);

  // -- Actions ---------------------------------------------------------------

  const saveLocally = React.useCallback((): void => {
    if (!db) return;
    downloadBytes(db.export(), 'ontology.sqlite');
  }, [db]);

  const saveToLibrary = React.useCallback(async (): Promise<void> => {
    if (!db || !fileService || !libraryFolder) return;
    setProgress('Uploading to SharePoint…');
    setStage('working');
    try {
      await fileService.writeFile(libraryFolder, 'ontology.sqlite', db.export());
      setStage('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('ready');
    }
  }, [db, fileService, libraryFolder]);

  const onSearch = React.useCallback((term: string): void => {
    setSearch(term);
    if (!db || !term.trim()) { setRevealPath(undefined); return; }
    // In tree mode, reveal the first hit rather than leaving the user to hunt.
    if (view === 'tree') {
      const hits = db.searchConcepts(term.trim(), 1);
      if (hits.length) {
        setRevealPath(db.getAncestorPath(hits[0].id));
        setSelectedId(hits[0].id);
      }
    }
  }, [db, view]);

  // -- editing ---------------------------------------------------------------

  const closeDialog = React.useCallback((): void => {
    setDialog({ kind: 'none' });
    setDialogError(undefined);
  }, []);

  const editHandlers: IConceptEditHandlers | undefined = React.useMemo(() => {
    if (!db || !writer || selectedId === undefined) return undefined;
    return {
      onRename: () => setDialog({ kind: 'rename' }),
      onChangeClass: () => setDialog({ kind: 'changeClass' }),
      onAddLabel: () => setDialog({ kind: 'addLabel' }),
      onEditLabel: (label) => setDialog({ kind: 'editLabel', label }),
      onDeleteLabel: (label) => setDialog({
        kind: 'confirm',
        title: 'Delete label',
        message: `Delete "${label.literalForm}"? Any matching settings on it go too.`,
        act: () => { if (mutate(() => writer.deleteLabel(label.id))) closeDialog(); }
      }),
      onAddRelationship: () => setDialog({ kind: 'pickRelationshipProperty' }),
      onDeleteRelationship: (relationshipId, description) => setDialog({
        kind: 'confirm',
        title: 'Remove relationship',
        message: `Remove ${description}? This removes it from both concepts, ` +
                 `because the pair is stored once.`,
        act: () => { if (mutate(() => writer.deleteRelationship(relationshipId))) closeDialog(); }
      }),
      onAddBroader: () => setDialog({ kind: 'pickBroader' }),
      onRemoveBroader: (parentId, parentLabel) => setDialog({
        kind: 'confirm',
        title: 'Remove parent',
        message: `Remove "${parentLabel}" as a parent? If it is the only one, ` +
                 `this concept becomes a top concept.`,
        act: () => { if (mutate(() => writer.removeBroader(selectedId, parentId))) closeDialog(); }
      }),
      onAddNarrower: () => {
        const parent = db.getConcept(selectedId);
        setDialog({ kind: 'newConcept', parent });
      },
      onAddAnnotation: () => setDialog({ kind: 'addAnnotation' }),
      onEditAnnotation: (annotation) => setDialog({ kind: 'editAnnotation', annotation }),
      onDeleteAnnotation: (annotation) => setDialog({
        kind: 'confirm',
        title: 'Delete metadata',
        message: `Delete this ${localName(annotation.predicateUri)} value?`,
        act: () => { if (mutate(() => writer.deleteAnnotation(annotation.id))) closeDialog(); }
      })
    };
  }, [db, writer, selectedId, mutate, closeDialog]);

  const onTreeAddChild = React.useCallback((parent: ITreeNode): void => {
    setDialog({ kind: 'newConcept', parent });
  }, []);

  const onTreeDelete = React.useCallback((node: ITreeNode): void => {
    if (!writer) return;
    const i = writer.describeDeleteImpact(node.id);
    const parts: string[] = [];
    if (i.children) parts.push(`${i.children} child concept${i.children === 1 ? '' : 'ren'}`);
    if (i.relationships) parts.push(`${i.relationships} relationship${i.relationships === 1 ? '' : 's'}`);
    if (i.labels) parts.push(`${i.labels} label${i.labels === 1 ? '' : 's'}`);
    if (i.annotations) parts.push(`${i.annotations} metadata field${i.annotations === 1 ? '' : 's'}`);
    setDialog({
      kind: 'confirmDelete',
      node,
      impact: parts.length ? parts.join(', ') : 'nothing else'
    });
  }, [writer]);

  const commands: ICommandBarItemProps[] = [
    {
      key: 'new', text: 'New concept', iconProps: { iconName: 'Add' },
      onClick: () => { setDialog({ kind: 'newConcept', parent: undefined }); }
    },
    {
      key: 'download',
      text: pendingChanges > 0 ? `Save .sqlite (${pendingChanges} change${pendingChanges === 1 ? '' : 's'})` : 'Save .sqlite',
      iconProps: { iconName: 'Download' },
      onClick: () => { saveLocally(); }
    },
    ...(fileService && libraryFolder ? [{
      key: 'upload', text: 'Save to library', iconProps: { iconName: 'CloudUpload' },
      onClick: () => { void saveToLibrary(); }
    }] : []),
    {
      key: 'switch', text: 'Open another…', iconProps: { iconName: 'OpenFolderHorizontal' },
      onClick: () => { setStage('choosing'); setError(undefined); }
    }
  ];

  // -- Render ----------------------------------------------------------------

  if (stage === 'working') {
    return (
      <div className={styles.ontologyEditor}>
        <Spinner size={SpinnerSize.large} label={progress || 'Working…'} />
        <p className={styles.muted} style={{ textAlign: 'center' }}>
          Importing the full model takes a few seconds and holds the tab.
        </p>
      </div>
    );
  }

  if (stage === 'choosing' || !db) {
    return (
      <div className={styles.ontologyEditor}>
        <SourcePicker
          libraryFolder={libraryFolder || ''}
          onBrowseLibrary={
            fileService
              ? (folder) => fileService.listFiles(folder, ['.ttl', '.sqlite'])
              : undefined
          }
          onChoose={(c) => { void choose(c); }}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className={styles.ontologyEditor}>
      {error && (
        <MessageBar messageBarType={MessageBarType.warning} onDismiss={() => setError(undefined)}>
          {error}
        </MessageBar>
      )}

      <CommandBar items={commands} className={styles.commandBar} />

      {stats && (
        <div className={styles.statusBar}>
          <span title={sourceLabel}>{sourceLabel}</span>
          <span>{stats.concepts.toLocaleString()} concepts</span>
          <span>{stats.classes} classes</span>
          <span>{stats.properties} relationship types</span>
          <span>{stats.relationships.toLocaleString()} relationships</span>
          <span>{stats.broaderEdges.toLocaleString()} hierarchy edges</span>
        </div>
      )}

      <Pivot
        selectedKey={view}
        onLinkClick={item => setView((item && item.props.itemKey as ViewMode) || 'tree')}
        className={styles.viewPivot}
      >
        <PivotItem headerText="Tree" itemKey="tree" itemIcon="BulletedTreeList" />
        <PivotItem headerText="List" itemKey="list" itemIcon="BulletedList" />
        <PivotItem headerText="Model" itemKey="model" itemIcon="Org" />
      </Pivot>

      {view === 'model' && writer ? (
        <ModelManager
          db={db}
          writer={writer}
          mutate={mutate}
          mutateError={dialogError}
          onClearError={() => setDialogError(undefined)}
          refreshToken={refreshToken}
        />
      ) : (
        <div className={styles.panes}>
          <div className={styles.leftPane}>
            <SearchBox
              placeholder="Search concepts, acronyms, codes…"
              value={search}
              onChange={(_, v) => onSearch(v || '')}
              onClear={() => onSearch('')}
            />

            <div className={styles.leftPaneBody}>
              {view === 'tree' ? (
                <ConceptTree
                  db={db}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  revealPath={revealPath}
                  onAddChild={onTreeAddChild}
                  onDelete={onTreeDelete}
                  refreshToken={refreshToken}
                />
              ) : (
                <ConceptList
                  db={db}
                  search={search}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  refreshToken={refreshToken}
                />
              )}
            </div>
          </div>

          <div className={styles.rightPane}>
            {selectedId === undefined ? (
              <div className={styles.placeholder}>Please select a concept.</div>
            ) : (
              <ConceptDetailPane
                db={db}
                conceptId={selectedId}
                onNavigate={setSelectedId}
                classColours={classColours}
                classLabels={classLabels}
                edit={editHandlers}
                refreshToken={refreshToken}
              />
            )}
          </div>
        </div>
      )}

      {renderDialog()}
    </div>
  );

  function renderDialog(): JSX.Element | undefined {
    if (!db || !writer || dialog.kind === 'none') return undefined;

    switch (dialog.kind) {
      case 'newConcept':
        return (
          <NewConceptDialog
            db={db}
            parent={dialog.parent}
            error={dialogError}
            onCancel={closeDialog}
            onCreate={(label, classId) => {
              let newId: number | undefined;
              const ok = mutate(() => {
                newId = writer.createConcept({
                  prefLabel: label,
                  classId,
                  parentConceptId: dialog.parent ? dialog.parent.id : undefined
                });
              });
              if (ok) {
                closeDialog();
                if (newId !== undefined) {
                  setSelectedId(newId);
                  if (dialog.parent) setRevealPath(db.getAncestorPath(newId));
                }
              }
            }}
          />
        );

      case 'rename': {
        const current = db.getConcept(selectedId as number);
        return (
          <RenamePrompt
            initial={current ? current.prefLabel || '' : ''}
            error={dialogError}
            onCancel={closeDialog}
            onSave={(value) => {
              if (mutate(() => writer.renameConcept(selectedId as number, value))) closeDialog();
            }}
          />
        );
      }

      case 'changeClass': {
        const current = db.getConcept(selectedId as number);
        return (
          <ChangeClassDialog
            db={db}
            conceptLabel={(current && current.prefLabel) || ''}
            currentClassId={current ? current.classId : undefined}
            error={dialogError}
            onCancel={closeDialog}
            onSave={(classId) => {
              if (mutate(() => writer.setConceptClass(selectedId as number, classId))) closeDialog();
            }}
          />
        );
      }

      case 'addLabel':
        return (
          <LabelDialog
            db={db}
            error={dialogError}
            onCancel={closeDialog}
            onSave={(form, role, flags: ILabelFlagEdit) => {
              const ok = mutate(() => writer.addLabel({
                conceptId: selectedId as number, labelProperty: role, literalForm: form, flags
              }));
              if (ok) closeDialog();
            }}
          />
        );

      case 'editLabel':
        return (
          <LabelDialog
            db={db}
            label={dialog.label}
            error={dialogError}
            onCancel={closeDialog}
            onSave={(form, _role, flags: ILabelFlagEdit) => {
              if (mutate(() => writer.updateLabel(dialog.label.id, form, flags))) closeDialog();
            }}
          />
        );

      case 'pickRelationshipProperty': {
        const allowed = db.getAllowedProperties(selectedId as number);
        return (
          <PropertyPicker
            properties={allowed}
            onCancel={closeDialog}
            onPick={(propertyId, propertyLabel) =>
              setDialog({ kind: 'pickRelationshipTarget', propertyId, propertyLabel })}
            onDefineNew={() => setDialog({ kind: 'newProperty' })}
          />
        );
      }

      case 'newProperty': {
        const current = db.getConcept(selectedId as number);
        return (
          <NewPropertyDialog
            db={db}
            suggestedDomainClassId={current ? current.classId : undefined}
            error={dialogError}
            onCancel={closeDialog}
            onCreate={(opts) => {
              let created: { propertyId: number } | undefined;
              const ok = mutate(() => { created = writer.createPropertyPair(opts); });
              if (ok && created) {
                // Flow straight into using it, which is why you defined it.
                setClassLabels(db.getClassLabelMap());
                setDialog({
                  kind: 'pickRelationshipTarget',
                  propertyId: created.propertyId,
                  propertyLabel: opts.label
                });
              }
            }}
          />
        );
      }

      case 'pickRelationshipTarget':
        return (
          <ConceptPickerDialog
            db={db}
            title={`${dialog.propertyLabel} — choose the target`}
            propertyId={dialog.propertyId}
            excludeConceptId={selectedId}
            onCancel={closeDialog}
            onPick={(targetId) => {
              const ok = mutate(() =>
                writer.addRelationship(selectedId as number, dialog.propertyId, targetId));
              if (ok) closeDialog();
            }}
          />
        );

      case 'pickBroader':
        return (
          <ConceptPickerDialog
            db={db}
            title="Choose a broader concept"
            excludeConceptId={selectedId}
            onCancel={closeDialog}
            onPick={(parentId) => {
              if (mutate(() => writer.addBroader(selectedId as number, parentId))) closeDialog();
            }}
          />
        );

      case 'addAnnotation':
        return (
          <AnnotationDialog
            db={db}
            onCancel={closeDialog}
            onSave={(pred, value) => {
              if (mutate(() => writer.addAnnotation(selectedId as number, pred, value))) closeDialog();
            }}
          />
        );

      case 'editAnnotation':
        return (
          <AnnotationDialog
            db={db}
            predicateUri={dialog.annotation.predicateUri}
            initialValue={dialog.annotation.value}
            onCancel={closeDialog}
            onSave={(_pred, value) => {
              if (mutate(() => writer.updateAnnotation(dialog.annotation.id, value))) closeDialog();
            }}
          />
        );

      case 'confirmDelete':
        return (
          <ConfirmDialog
            title={`Delete "${dialog.node.prefLabel}"`}
            message={`This also deletes ${dialog.impact}. It cannot be undone from the UI, ` +
                     `though the change is journalled.`}
            confirmText="Delete"
            danger
            error={dialogError}
            onCancel={closeDialog}
            onConfirm={() => {
              const ok = mutate(() => writer.deleteConcept(dialog.node.id));
              if (ok) {
                if (selectedId === dialog.node.id) setSelectedId(undefined);
                closeDialog();
              }
            }}
          />
        );

      case 'confirm':
        return (
          <ConfirmDialog
            title={dialog.title}
            message={dialog.message}
            confirmText="Confirm"
            error={dialogError}
            onCancel={closeDialog}
            onConfirm={dialog.act}
          />
        );

      default:
        return undefined;
    }
  }
};

export default OntologyEditor;
