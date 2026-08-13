import * as React from 'react';
import {
  SearchBox, Spinner, SpinnerSize, MessageBar, MessageBarType,
  CommandBar, ICommandBarItemProps, Pivot, PivotItem, Icon
} from '@fluentui/react';
import { SqlJsStatic } from 'sql.js';

import styles from './OntologyEditor.module.scss';
import { IOntologyEditorProps } from './IOntologyEditorProps';
import SourcePicker, { ISourceChoice } from './SourcePicker';
import ConceptTree, { ITreeFilter } from './ConceptTree';
import ConceptList from './ConceptList';
import ModelManager from './ModelManager';
import ConceptDetailPane from './ConceptDetail';

import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { exportTurtle } from '../../../services/export/TurtleExporter';
import { getSqlJs } from '../../../services/database/sqlJsLoader';
import { OntologyWriter, ValidationFailure, ILabelFlagEdit } from '../../../services/database/OntologyWriter';
import { importTurtle, ImportPhase } from '../../../services/import/OntologyImporter';
import {
  FileService, readLocalFileAsText, readLocalFileAsArrayBuffer, downloadBytes,
  defaultOntologyFolder
} from '../../../services/sharepoint/FileService';
import { IOntologyStats, ITreeNode, ILabel, IAnnotation, IConcept } from '../../../models/IOntology';
import { IConceptEditHandlers } from './ConceptDetail';
import {
  NewConceptDialog, ConceptPickerDialog, LabelDialog, AnnotationDialog,
  RenamePrompt, PropertyPicker, ConfirmDialog, NewPropertyDialog, ChangeClassDialog,
  SaveAsDialog
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
  | { kind: 'pickRelationshipProperty'; replace?: { relationshipId: number } }
  | { kind: 'newProperty'; replace?: { relationshipId: number } }
  | { kind: 'pickRelationshipTarget'; propertyId: number; propertyLabel: string;
      replace?: { relationshipId: number } }
  | { kind: 'pickBroader' }
  | { kind: 'addAnnotation' }
  | { kind: 'editAnnotation'; annotation: IAnnotation }
  | { kind: 'confirmDelete'; node: ITreeNode; impact: string }
  | { kind: 'saveAs' }
  | { kind: 'confirm'; title: string; message: string; act: () => void };

type Stage = 'choosing' | 'working' | 'ready';
/** The two workspaces: browsing/editing concepts, or editing the model. */
type MainView = 'concepts' | 'model';
/** How the left-hand browser presents concepts within the Concepts view. */
type BrowseMode = 'tree' | 'list';

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

  const [mainView, setMainView] = React.useState<MainView>('concepts');
  const [browse, setBrowse] = React.useState<BrowseMode>('tree');
  const [search, setSearch] = React.useState<string>('');
  const [selectedId, setSelectedId] = React.useState<number | undefined>(undefined);
  const [revealPath, setRevealPath] = React.useState<number[] | undefined>(undefined);
  const [treeFilter, setTreeFilter] = React.useState<ITreeFilter | undefined>(undefined);
  const [sourceLabel, setSourceLabel] = React.useState<string>('');
  const [fileName, setFileName] = React.useState<string>('ontology.sqlite');
  // Where the last-saved copy of this file lives, so Revert can reload it.
  // Undefined for local files / scratch ontologies never saved to the library.
  const [revertSource, setRevertSource] = React.useState<ISourceChoice | undefined>(undefined);

  const [writer, setWriter] = React.useState<OntologyWriter | undefined>(undefined);
  // In-place operations (save, revert) show this over the workspace instead
  // of unmounting it into the full-screen loading state.
  const [busy, setBusy] = React.useState<string | undefined>(undefined);
  const [dialog, setDialog] = React.useState<DialogState>({ kind: 'none' });
  const [dialogError, setDialogError] = React.useState<string | undefined>(undefined);
  // Views memoise their queries; bumping this refetches after a mutation.
  const [refreshToken, setRefreshToken] = React.useState<number>(0);
  const [pendingChanges, setPendingChanges] = React.useState<number>(0);
  // Journal size at the last save — the journal is cumulative (it is the audit
  // trail), so "unsaved" is the difference, not the total.
  const [savedChanges, setSavedChanges] = React.useState<number>(0);

  const fileService = React.useMemo(
    () => (context ? new FileService(context) : undefined), [context]
  );

  // The property-pane folder wins; otherwise the hard-coded site convention.
  const effectiveFolder = React.useMemo(
    () => (libraryFolder && libraryFolder.trim())
      || (context ? defaultOntologyFolder(context) : ''),
    [libraryFolder, context]
  );

  const adopt = React.useCallback((database: OntologyDatabase, label: string): void => {
    setDb(database);
    const w = new OntologyWriter(
      database.raw,
      (context && context.pageContext.user && context.pageContext.user.email) || 'unknown'
    );
    setWriter(w);
    setStats(database.getStats());
    setClassColours(database.getClassColourMap());
    setClassLabels(database.getClassLabelMap());
    setSourceLabel(label);
    // Derive the save name from the source: ontology.ttl -> ontology.sqlite,
    // an opened .sqlite keeps its own name, anything else gets the default.
    const base = label.split('/').pop() || '';
    if (/\.sqlite$/i.test(base)) setFileName(base);
    else if (/\.ttl$/i.test(base)) setFileName(base.replace(/\.ttl$/i, '.sqlite'));
    else setFileName('ontology.sqlite');
    setSelectedId(undefined);
    // A reopened database carries its journal (the audit trail); everything in
    // it was saved by definition, so the unsaved baseline starts there.
    setPendingChanges(w.getChangeCount());
    setSavedChanges(w.getChangeCount());
    setRefreshToken(t => t + 1);
    setStage('ready');
  }, [context]);

  /**
   * Run a mutation, refresh the views, and surface validation failures in the
   * dialog rather than as an unexplained no-op.
   * Returns true when the mutation succeeded.
   */
  /** Refetch everything the views derive from the database. */
  const refreshAfterChange = React.useCallback((): void => {
    if (!writer || !db) return;
    setStats(db.getStats());
    // Model-tab edits can add classes/colours the tree needs.
    setClassColours(db.getClassColourMap());
    setClassLabels(db.getClassLabelMap());
    setPendingChanges(writer.getChangeCount());
    setRefreshToken(t => t + 1);
  }, [writer, db]);

  const mutate = React.useCallback((fn: () => void): boolean => {
    if (!writer || !db) return false;
    try {
      setDialogError(undefined);
      // Every edit gets its own savepoint: the Undo command steps back
      // through them, and a failed edit rolls back instead of half-applying.
      writer.beginUndoPoint();
      fn();
      refreshAfterChange();
      return true;
    } catch (e) {
      writer.undoLast();
      if (e instanceof ValidationFailure) setDialogError(e.message);
      else setDialogError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [writer, db, refreshAfterChange]);

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

  const choose = React.useCallback(async (choice: ISourceChoice, opts?: { inPlace?: boolean }): Promise<void> => {
    // inPlace: keep the current workspace on screen (dimmed) while the file
    // reloads, instead of tearing down to the loading screen.
    if (opts && opts.inPlace) setBusy('Reloading last saved…');
    else setStage('working');
    setError(undefined);
    // Library files can be reverted to; local files and scratch ontologies
    // have no saved copy until the first Save.
    setRevertSource(
      (choice.kind === 'sqlite-library' || choice.kind === 'turtle-library') && choice.path
        ? choice
        : undefined
    );
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
      if (!(opts && opts.inPlace)) setStage('choosing');
    } finally {
      setBusy(undefined);
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

  const saveLocally = React.useCallback((name?: string): void => {
    if (!db) return;
    if (name) setFileName(name);
    if (writer) writer.releaseUndoPoints();
    downloadBytes(db.export(), name || fileName);
    if (writer) { writer.markClean(); setSavedChanges(writer.getChangeCount()); }
  }, [db, writer, fileName]);

  const saveToLibrary = React.useCallback(async (name?: string): Promise<void> => {
    if (!db || !fileService || !effectiveFolder) return;
    if (name) setFileName(name);
    setBusy('Saving to SharePoint…');
    try {
      // Flatten the undo stack first so the export is a committed database,
      // not a serialised mid-transaction state.
      if (writer) writer.releaseUndoPoints();
      await fileService.ensureFolder(effectiveFolder);
      await fileService.writeFile(effectiveFolder, name || fileName, db.export());
      if (writer) { writer.markClean(); setSavedChanges(writer.getChangeCount()); }
      // The library copy is now current — Revert reloads it from here on.
      setRevertSource({
        kind: 'sqlite-library',
        path: `${effectiveFolder.replace(/\/$/, '')}/${name || fileName}`
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }, [db, fileService, effectiveFolder, writer, fileName]);

  const onSearch = React.useCallback((term: string): void => {
    setSearch(term);
    if (!db || !term.trim()) { setRevealPath(undefined); setTreeFilter(undefined); return; }
    // In tree mode, prune the tree to the hits: every path to a match stays
    // (polyhierarchy included), everything else disappears, matches bold.
    if (browse === 'tree') {
      const hits = db.searchConcepts(term.trim(), 200);
      const visible: { [id: number]: true } = {};
      const matches: { [id: number]: true } = {};
      const stack: number[] = [];
      for (const h of hits) {
        matches[h.id] = true;
        if (!visible[h.id]) { visible[h.id] = true; stack.push(h.id); }
      }
      while (stack.length) {
        const id = stack.pop() as number;
        for (const p of db.getParents(id)) {
          if (!visible[p.id]) { visible[p.id] = true; stack.push(p.id); }
        }
      }
      setTreeFilter({ visible, matches });
      if (hits.length) {
        // Select the best hit so the detail pane and the tree agree.
        setRevealPath(db.getAncestorPath(hits[0].id));
        setSelectedId(hits[0].id);
      }
    }
  }, [db, browse]);

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
      onEditRelationship: (relationshipId) =>
        setDialog({ kind: 'pickRelationshipProperty', replace: { relationshipId } }),
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
        message: `Delete this ${annotation.displayLabel || localName(annotation.predicateUri)} value?`,
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

  const unsaved = pendingChanges - savedChanges;
  const hasUnsaved = unsaved > 0;

  // The database lives in this tab's memory — leaving the page or opening
  // another file without saving discards every edit. Guard both exits.
  React.useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (e: BeforeUnloadEvent): string => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  // New concepts are created in place (tree ghost rows / narrower "+"), and
  // local .sqlite downloads come straight from the SharePoint library — the
  // bar carries the classic file triad: Open, Save, Save as.
  const commands: ICommandBarItemProps[] = [
    {
      key: 'open', text: 'Open…', iconProps: { iconName: 'OpenFolderHorizontal' },
      onClick: () => {
        if (unsaved > 0) {
          setDialog({
            kind: 'confirm',
            title: 'Discard unsaved changes?',
            message: `This file has ${unsaved} unsaved change${unsaved === 1 ? '' : 's'} that exist only ` +
                     'in this browser tab. Save first, or they are lost when another file opens.',
            act: () => { closeDialog(); setStage('choosing'); setError(undefined); }
          });
          return;
        }
        setStage('choosing'); setError(undefined);
      }
    },
    ...(fileService ? [{
      key: 'upload',
      text: unsaved > 0 ? `Save (${unsaved} unsaved)` : 'Save',
      iconProps: { iconName: 'CloudUpload', style: unsaved > 0 ? { color: '#a4262c' } : undefined },
      title: `Saves ${fileName} to ${effectiveFolder}`,
      onClick: () => { void saveToLibrary(); }
    }] : [{
      // No SharePoint context (e.g. local workbench) — downloading is the
      // only way changes leave the tab.
      key: 'download',
      text: unsaved > 0 ? `Save .sqlite (${unsaved} unsaved)` : 'Save .sqlite',
      title: `Downloads ${fileName}`,
      iconProps: { iconName: 'Download' },
      onClick: () => { saveLocally(); }
    }]),
    {
      key: 'saveAs', text: 'Save as…', iconProps: { iconName: 'SaveAs' },
      onClick: () => { setDialog({ kind: 'saveAs' }); }
    },
    {
      key: 'exportTtl', text: 'Export Turtle…', iconProps: { iconName: 'Export' },
      title: 'Downloads the whole ontology as a Semaphore-compatible .ttl (includes unsaved changes)',
      onClick: () => {
        if (!db) return;
        const { ttl } = exportTurtle(db.raw);
        downloadBytes(new TextEncoder().encode(ttl), fileName.replace(/\.sqlite$/i, '') + '.ttl');
      }
    },
    {
      key: 'undo', text: 'Undo', iconProps: { iconName: 'Undo' },
      title: 'Undo the most recent change (repeat to step further back; stops at the last save)',
      disabled: !writer || !writer.canUndo(),
      onClick: () => { if (writer && writer.undoLast()) refreshAfterChange(); }
    },
    {
      key: 'revert', text: 'Revert', iconProps: { iconName: 'History' },
      title: revertSource
        ? 'Throw away ALL unsaved changes and reload the last-saved copy'
        : 'Nothing to revert to — this file has never been saved to the library',
      disabled: unsaved === 0 || !revertSource,
      onClick: () => {
        const src = revertSource;
        if (!src) return;
        setDialog({
          kind: 'confirm',
          title: 'Revert to last saved?',
          message: `Throw away ${unsaved} unsaved change${unsaved === 1 ? '' : 's'} and reload ` +
                   `${src.path ? src.path.split('/').pop() : 'the file'} as last saved?`,
          act: () => { closeDialog(); void choose(src, { inPlace: true }); }
        });
      }
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
          libraryFolder={effectiveFolder}
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
      {busy && (
        <div className={styles.busyOverlay}>
          <Spinner size={SpinnerSize.large} label={busy} />
        </div>
      )}
      {error && (
        <MessageBar messageBarType={MessageBarType.warning} onDismiss={() => setError(undefined)}>
          {error}
        </MessageBar>
      )}

      <CommandBar items={commands} className={styles.commandBar} />

      {stats && (
        <div className={styles.statusBar}>
          <span title={sourceLabel}>
            <Icon iconName="Database" className={styles.statusBarIcon} /> {sourceLabel}
          </span>
          <span>{stats.concepts.toLocaleString()} concepts</span>
          <span>{stats.classes} classes</span>
          <span>{stats.properties} relationship types</span>
          <span>{stats.relationships.toLocaleString()} relationships</span>
          <span>{stats.broaderEdges.toLocaleString()} hierarchy edges</span>
          {unsaved > 0 && (
            <span className={styles.unsavedBadge}>
              ● {unsaved} unsaved change{unsaved === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {/* Two real workspaces; tabs format makes the active one unmistakable.
          Tree/List is not a sibling — it only flips the left-hand browser,
          so it lives beside the search box below. */}
      <Pivot
        selectedKey={mainView}
        onLinkClick={item => setMainView((item && item.props.itemKey as MainView) || 'concepts')}
        linkFormat="tabs"
        className={styles.viewPivot}
      >
        <PivotItem headerText="Concepts" itemKey="concepts" itemIcon="BulletedTreeList" />
        <PivotItem headerText="Model" itemKey="model" itemIcon="Org" />
      </Pivot>

      {mainView === 'model' && writer ? (
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
            <div className={styles.leftPaneHeader}>
              <div className={styles.leftPaneSearch}>
                <SearchBox
                  placeholder="Search concepts, acronyms, codes…"
                  value={search}
                  onChange={(_, v) => onSearch(v || '')}
                  onClear={() => onSearch('')}
                />
              </div>
              <button
                type="button"
                className={browse === 'tree' ? styles.browseBtnActive : styles.browseBtn}
                title="Browse as hierarchy"
                aria-label="Browse as hierarchy"
                aria-pressed={browse === 'tree'}
                onClick={() => setBrowse('tree')}
              >
                <Icon iconName="BulletedTreeList" />
              </button>
              <button
                type="button"
                className={browse === 'list' ? styles.browseBtnActive : styles.browseBtn}
                title="Browse as flat list"
                aria-label="Browse as flat list"
                aria-pressed={browse === 'list'}
                onClick={() => setBrowse('list')}
              >
                <Icon iconName="BulletedList" />
              </button>
            </div>

            <div className={styles.leftPaneBody}>
              {browse === 'tree' ? (
                <ConceptTree
                  db={db}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  revealPath={revealPath}
                  filter={treeFilter}
                  onAddChild={onTreeAddChild}
                  onDelete={onTreeDelete}
                  onAddRoot={() => setDialog({ kind: 'newConcept', parent: undefined })}
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

      case 'saveAs':
        return (
          <SaveAsDialog
            initialName={fileName}
            canSaveToSharePoint={!!fileService}
            folderPath={effectiveFolder || undefined}
            onCancel={closeDialog}
            onDownload={(name) => { saveLocally(name); closeDialog(); }}
            onSaveToSharePoint={(name) => { closeDialog(); void saveToLibrary(name); }}
          />
        );

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
              setDialog({ kind: 'pickRelationshipTarget', propertyId, propertyLabel, replace: dialog.replace })}
            onDefineNew={() => setDialog({ kind: 'newProperty', replace: dialog.replace })}
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
                  propertyLabel: opts.label,
                  replace: dialog.replace
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
              const replace = dialog.replace;
              const ok = mutate(() => replace
                ? writer.replaceRelationship(replace.relationshipId, selectedId as number, dialog.propertyId, targetId)
                : writer.addRelationship(selectedId as number, dialog.propertyId, targetId));
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
            conceptId={selectedId}
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
            conceptId={selectedId}
            predicateUri={dialog.annotation.predicateUri}
            initialValue={dialog.annotation.value}
            onCancel={closeDialog}
            onSave={(pred, value) => {
              if (mutate(() => writer.replaceAnnotation(dialog.annotation.id, pred, value))) closeDialog();
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
