import * as React from 'react';
import {
  PrimaryButton, DefaultButton, Dropdown, IDropdownOption,
  MessageBar, MessageBarType, Spinner, SpinnerSize, Icon
} from '@fluentui/react';
import { Database, SqlValue } from 'sql.js';

import styles from './OntologyExplorer.module.scss';
import { IOntologyExplorerProps } from './IOntologyExplorerProps';
import { getSqlJs } from '../../../services/database/sqlJsLoader';
import { FileService, ILibraryFile, defaultOntologyFolder } from '../../../services/sharepoint/FileService';
import {
  listTables, readSchema, layout, edgePath, isReadOnlySql, CANNED,
  ITableNode, IForeignKey
} from '../../../services/database/SchemaDiagram';

const PAGE = 200;

type View = 'browse' | 'query' | 'diagram';

interface IResult { columns: string[]; values: SqlValue[][] }

/** SQLite value → display text, keeping NULL and blobs distinguishable. */
const Cell: React.FC<{ v: SqlValue }> = ({ v }) => {
  if (v === null || v === undefined) return <span className={styles.nullValue}>NULL</span>;
  if (v instanceof Uint8Array) return <span className={styles.nullValue}>{v.length} bytes</span>;
  return <>{String(v)}</>;
};

const Grid: React.FC<{ result: IResult | undefined }> = ({ result }) => {
  if (!result) return <div className={styles.muted} style={{ padding: 16 }}>No rows.</div>;
  return (
    <table className={styles.grid}>
      <thead>
        <tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {result.values.map((row, i) => (
          <tr key={i}>{row.map((v, j) => <td key={j}><Cell v={v} /></td>)}</tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * The entity-relationship diagram. The force layout gives a starting
 * arrangement; boxes are then draggable so a crowded diagram can be tidied by
 * hand, and those positions are remembered per database.
 */
const LAYOUT_KEY = 'ontologyExplorer.erLayout';

/** Hand-tidied box positions, remembered per database in this browser. */
function savedLayout(file: string): { [table: string]: { x: number; y: number } } | undefined {
  try {
    const all = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || '{}');
    return all[file];
  } catch { return undefined; }
}

function saveLayout(file: string, nodes: ITableNode[]): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || '{}');
    all[file] = {};
    for (const n of nodes) all[file][n.name] = { x: Math.round(n.x), y: Math.round(n.y) };
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch { /* private mode — the layout is a convenience, not data */ }
}

function forgetLayout(file: string): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || '{}');
    delete all[file];
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch { /* nothing to do */ }
}

const Diagram: React.FC<{ db: Database; file: string }> = ({ db, file }) => {
  const [resetToken, setResetToken] = React.useState(0);

  const schema = React.useMemo(() => {
    const s = readSchema(db);
    layout(s.nodes, s.links);
    // Restore anything the user arranged by hand. Tables absent from the saved
    // set keep their computed position, so a changed schema degrades sensibly
    // instead of throwing the whole arrangement away.
    const saved = resetToken === 0 ? savedLayout(file) : undefined;
    if (saved) {
      for (const n of s.nodes) {
        const p = saved[n.name];
        if (p) { n.x = p.x; n.y = p.y; }
      }
    }
    return s;
  }, [db, file, resetToken]);

  const [, force] = React.useState(0);
  const dragging = React.useRef<{ node: ITableNode; px: number; py: number; ox: number; oy: number } | undefined>();
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  const toSvg = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform((svg.getScreenCTM() as DOMMatrix).inverse());
    return { x: p.x, y: p.y };
  };

  if (!schema.nodes.length) {
    return <div className={styles.muted} style={{ padding: 16 }}>This database has no tables.</div>;
  }

  const pad = 60;
  const minX = Math.min(...schema.nodes.map(n => n.x - n.w / 2)) - pad;
  const minY = Math.min(...schema.nodes.map(n => n.y - n.h / 2)) - pad;
  const maxX = Math.max(...schema.nodes.map(n => n.x + n.w / 2)) + pad;
  const maxY = Math.max(...schema.nodes.map(n => n.y + n.h / 2)) + pad;

  return (
    <div className={styles.diagram}>
      <div className={styles.diagramBar}>
        <span className={styles.muted}>
          Drag a table to arrange it — the layout is remembered for this database.
        </span>
        <DefaultButton
          text="Reset layout"
          iconProps={{ iconName: 'Refresh' }}
          onClick={() => { forgetLayout(file); setResetToken(t => t + 1); }}
        />
      </div>
      <svg
        ref={svgRef}
        className={styles.erSvg}
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        onPointerMove={(e) => {
          const d = dragging.current;
          if (!d) return;
          const p = toSvg(e);
          d.node.x = d.ox + (p.x - d.px);
          d.node.y = d.oy + (p.y - d.py);
          force(v => v + 1);
        }}
        onPointerUp={() => {
          if (dragging.current) saveLayout(file, schema.nodes);
          dragging.current = undefined;
        }}
      >
        <defs>
          <marker id="erArrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" opacity="0.55" />
          </marker>
        </defs>

        {schema.links.map((l: IForeignKey, i: number) => {
          const { d, lx, ly } = edgePath(l.s, l.t, l.bend);
          return (
            <g key={i}>
              <path className={styles.erEdge} d={d} markerEnd="url(#erArrow)" />
              <text className={styles.erEdgeLabel} x={lx} y={ly} textAnchor="middle">{l.label}</text>
            </g>
          );
        })}

        {schema.nodes.map((n: ITableNode) => {
          const x = n.x - n.w / 2, y = n.y - n.h / 2;
          return (
            <g
              key={n.name}
              className={styles.erNode}
              onPointerDown={(e) => {
                const p = toSvg(e);
                dragging.current = { node: n, px: p.x, py: p.y, ox: n.x, oy: n.y };
                // Capture on the <svg>, not the <g>: the pointer routinely
                // leaves the box being dragged and the move handler lives here.
                if (svgRef.current) svgRef.current.setPointerCapture(e.pointerId);
              }}
            >
              <rect className={styles.erBox} x={x} y={y} width={n.w} height={n.h} rx={5} />
              <rect className={styles.erHeader} x={x} y={y} width={n.w} height={22} rx={5} />
              <text className={styles.erTitle} x={x + 9} y={y + 15}>{n.name}</text>
              {n.cols.map((c, k) => (
                <text
                  key={c.name}
                  className={c.pk ? styles.erColPk : styles.erCol}
                  x={x + 9}
                  y={y + 38 + k * 14}
                >
                  {c.pk ? '• ' + c.name : c.name}
                  <tspan className={styles.erType} dx={6}>{c.type.toLowerCase()}</tspan>
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const OntologyExplorer: React.FC<IOntologyExplorerProps> = ({ libraryFolder, context }) => {
  const fileService = React.useMemo(() => new FileService(context), [context]);
  const folder = React.useMemo(
    () => (libraryFolder && libraryFolder.trim()) || defaultOntologyFolder(context),
    [libraryFolder, context]
  );

  const [files, setFiles] = React.useState<ILibraryFile[] | undefined>();
  const [db, setDb] = React.useState<Database | undefined>();
  const [openName, setOpenName] = React.useState<string>('');
  const [busy, setBusy] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  const [tables, setTables] = React.useState<Array<{ name: string; kind: string; rows: number }>>([]);
  const [table, setTable] = React.useState<string | undefined>();
  const [offset, setOffset] = React.useState(0);
  const [view, setView] = React.useState<View>('browse');
  const [sql, setSql] = React.useState('SELECT * FROM concepts LIMIT 50');
  const [result, setResult] = React.useState<IResult | undefined>();
  const [total, setTotal] = React.useState(0);

  // List the folder once, so there is something to pick without configuration.
  React.useEffect(() => {
    fileService.listFiles(folder, ['.sqlite', '.db'])
      .then(setFiles)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [fileService, folder]);

  const run = React.useCallback((statement: string, database?: Database): void => {
    const target = database || db;
    if (!target) return;
    setError(undefined);
    if (!isReadOnlySql(statement)) {
      setError('This explorer only runs read-only statements. Nothing here can change the file.');
      setResult(undefined);
      return;
    }
    try {
      const r = target.exec(statement);
      setResult(r.length ? { columns: r[0].columns, values: r[0].values } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(undefined);
    }
  }, [db]);

  const browse = React.useCallback((name: string, at: number, database?: Database): void => {
    const target = database || db;
    if (!target) return;
    setTable(name); setOffset(at); setView('browse');
    try {
      const r = target.exec(`SELECT * FROM "${name}" LIMIT ${PAGE} OFFSET ${at}`);
      setResult(r.length ? { columns: r[0].columns, values: r[0].values } : undefined);
      setTotal(Number(target.exec(`SELECT COUNT(*) FROM "${name}"`)[0].values[0][0]));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [db]);

  const open = React.useCallback(async (file: ILibraryFile): Promise<void> => {
    setBusy(`Opening ${file.name}…`);
    setError(undefined);
    try {
      const bytes = await fileService.readFile(file.serverRelativeUrl);
      const SQL = await getSqlJs();
      const database = new SQL.Database(new Uint8Array(bytes));
      if (db) db.close();
      setDb(database);
      setOpenName(file.name);
      const list = listTables(database);
      setTables(list);
      const first = list.find(t => t.kind === 'table');
      if (first) browse(first.name, 0, database);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }, [fileService, db, browse]);

  const cannedOptions: IDropdownOption[] = CANNED.map((c, i) => ({ key: i, text: c.label }));

  return (
    <div className={styles.explorer}>
      <div className={styles.headerBar}>
        <Icon iconName="Database" />
        <span className={styles.fileName}>{openName || 'No database open'}</span>
        <span className={styles.readOnlyChip}>read-only</span>
        {db && <span className={styles.muted}>{tables.length} tables and views</span>}
        <span style={{ flex: '1 1 auto' }} />
        <Dropdown
          placeholder={files ? `Open from ${folder.split('/').slice(-2).join('/')}` : 'Listing…'}
          options={(files || []).map(f => ({
            key: f.serverRelativeUrl,
            text: `${f.name}  (${Math.round(f.size / 1024)} KB)`
          }))}
          styles={{ root: { minWidth: 340 } }}
          onChange={(_, o) => {
            const f = (files || []).find(x => x.serverRelativeUrl === o?.key);
            if (f) void open(f);
          }}
        />
      </div>

      {error && (
        <MessageBar messageBarType={MessageBarType.error} onDismiss={() => setError(undefined)}>
          {error}
        </MessageBar>
      )}
      {busy && <Spinner size={SpinnerSize.medium} label={busy} />}

      {!db && !busy && (
        <MessageBar>
          Pick a database above. Files are read from SharePoint with your own permissions and
          parsed in this browser tab — nothing is downloaded to disk and nothing is written back.
        </MessageBar>
      )}

      {db && (
        <div className={styles.panes}>
          <div className={styles.sidebar}>
            <div style={{ padding: '4px 12px 8px' }}>
              <DefaultButton
                text="Schema diagram"
                iconProps={{ iconName: 'Relationship' }}
                onClick={() => setView('diagram')}
                styles={{ root: { width: '100%' } }}
              />
            </div>
            <h3>Tables</h3>
            {tables.filter(t => t.kind === 'table').map(t => (
              <button
                key={t.name}
                type="button"
                className={table === t.name && view === 'browse' ? styles.tableBtnActive : styles.tableBtn}
                onClick={() => browse(t.name, 0)}
              >
                {t.name}<span className={styles.rowCount}>{t.rows < 0 ? '?' : t.rows.toLocaleString()}</span>
              </button>
            ))}
            {tables.some(t => t.kind === 'view') && <h3>Views</h3>}
            {tables.filter(t => t.kind === 'view').map(t => (
              <button
                key={t.name}
                type="button"
                className={table === t.name && view === 'browse' ? styles.tableBtnActive : styles.tableBtn}
                onClick={() => browse(t.name, 0)}
              >
                {t.name}<span className={styles.rowCount}>{t.rows < 0 ? '?' : t.rows.toLocaleString()}</span>
              </button>
            ))}
          </div>

          <div className={styles.main}>
            <div className={styles.queryBar}>
              <textarea
                className={styles.queryBox}
                spellCheck={false}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setView('query'); run(sql); }
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
                <PrimaryButton
                  text="Run  (Ctrl+Enter)"
                  onClick={() => { setView('query'); run(sql); }}
                />
                <Dropdown
                  placeholder="Canned queries…"
                  options={cannedOptions}
                  selectedKey={null}
                  onChange={(_, o) => {
                    if (!o) return;
                    const q = CANNED[Number(o.key)].sql;
                    setSql(q); setView('query'); run(q);
                  }}
                />
              </div>
            </div>

            {view === 'diagram' ? (
              <Diagram db={db} file={openName} />
            ) : (
              <>
                <div className={styles.results}><Grid result={result} /></div>
                {view === 'browse' && table && total > PAGE && (
                  <div className={styles.pager}>
                    <DefaultButton
                      text="‹ Prev" disabled={offset === 0}
                      onClick={() => browse(table, Math.max(0, offset - PAGE))}
                    />
                    <span className={styles.muted}>
                      {table} — rows {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()}
                    </span>
                    <DefaultButton
                      text="Next ›" disabled={offset + PAGE >= total}
                      onClick={() => browse(table, offset + PAGE)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OntologyExplorer;
