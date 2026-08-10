import * as React from 'react';
import {
  SearchBox, Spinner, SpinnerSize, MessageBar, MessageBarType,
  CommandBar, ICommandBarItemProps, Pivot, PivotItem
} from '@fluentui/react';
import initSqlJs, { SqlJsStatic } from 'sql.js';
// Resolved by the asset-module rule in gulpfile.js to the deployed URL, so the
// binary ships with the package rather than needing a manual upload.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm';

import styles from './OntologyEditor.module.scss';
import { IOntologyEditorProps } from './IOntologyEditorProps';
import SourcePicker, { ISourceChoice } from './SourcePicker';
import ConceptTree from './ConceptTree';
import ConceptList from './ConceptList';
import ConceptDetailPane from './ConceptDetail';

import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { importTurtle, ImportPhase } from '../../../services/import/OntologyImporter';
import {
  FileService, readLocalFileAsText, readLocalFileAsArrayBuffer, downloadBytes
} from '../../../services/sharepoint/FileService';
import { IOntologyStats } from '../../../models/IOntology';

type Stage = 'choosing' | 'working' | 'ready';
type ViewMode = 'tree' | 'list';

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

  const fileService = React.useMemo(
    () => (context ? new FileService(context) : undefined), [context]
  );

  /**
   * sql.js fetches its .wasm at runtime. The URL comes from the bundled asset,
   * so it always points at the deployed copy — no upload step, and it survives
   * the site moving.
   */
  const locateWasm = React.useCallback((file: string): string => {
    return /\.wasm$/.test(file) ? sqlWasmUrl : file;
  }, []);

  const adopt = React.useCallback((database: OntologyDatabase, label: string): void => {
    setDb(database);
    setStats(database.getStats());
    setClassColours(database.getClassColourMap());
    setClassLabels(database.getClassLabelMap());
    setSourceLabel(label);
    setSelectedId(undefined);
    setStage('ready');
  }, []);

  // -- Loading paths ---------------------------------------------------------

  const openSqlite = React.useCallback(async (bytes: ArrayBuffer, label: string): Promise<void> => {
    setProgress('Opening database…');
    const database = await OntologyDatabase.load(bytes, locateWasm);
    adopt(database, label);
  }, [locateWasm, adopt]);

  const runImport = React.useCallback(async (ttl: string, label: string, bytes: number): Promise<void> => {
    setProgress(PHASE_TEXT.parsing);
    await yieldToBrowser();

    const SQL: SqlJsStatic = await initSqlJs({ locateFile: locateWasm });

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
  }, [locateWasm, adopt]);

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

      } else {
        throw new Error('That source is not available in this context.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('choosing');
    }
  }, [fileService, openSqlite, runImport]);

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

  const commands: ICommandBarItemProps[] = [
    {
      key: 'download', text: 'Save .sqlite', iconProps: { iconName: 'Download' },
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

      <div className={styles.panes}>
        <div className={styles.leftPane}>
          <SearchBox
            placeholder="Search concepts, acronyms, codes…"
            value={search}
            onChange={(_, v) => onSearch(v || '')}
            onClear={() => onSearch('')}
          />

          <Pivot
            selectedKey={view}
            onLinkClick={item => setView((item && item.props.itemKey as ViewMode) || 'tree')}
            className={styles.viewPivot}
          >
            <PivotItem headerText="Tree" itemKey="tree" itemIcon="BulletedTreeList" />
            <PivotItem headerText="List" itemKey="list" itemIcon="BulletedList" />
          </Pivot>

          <div className={styles.leftPaneBody}>
            {view === 'tree' ? (
              <ConceptTree
                db={db}
                selectedId={selectedId}
                onSelect={setSelectedId}
                revealPath={revealPath}
              />
            ) : (
              <ConceptList
                db={db}
                search={search}
                selectedId={selectedId}
                onSelect={setSelectedId}
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
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default OntologyEditor;
