import * as React from 'react';
import { SearchBox, Spinner, SpinnerSize } from '@fluentui/react';
import { SPHttpClient } from '@microsoft/sp-http';
import styles from './OntologyEditor.module.scss';
import { IOntologyEditorProps } from './IOntologyEditorProps';
import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { IConcept, IConceptDetail, IOntologyStats } from '../../../models/IOntology';
import { localName } from '../../../services/turtle/Vocabulary';

/**
 * Read-only browser over the ontology database. This is the scaffold the
 * editing UI grows into: it proves the whole stack — SharePoint file fetch,
 * sql.js load, and the relationship view that renders both ends of every link.
 *
 * Editing is deliberately absent. Writes must go through a service that also
 * journals to the `changes` table; see docs/ARCHITECTURE.md Decisions 3 and 5.
 */
const OntologyEditor: React.FC<IOntologyEditorProps> = (props) => {
  const { databaseUrl, context } = props;

  const [db, setDb] = React.useState<OntologyDatabase | undefined>(undefined);
  const [stats, setStats] = React.useState<IOntologyStats | undefined>(undefined);
  const [concepts, setConcepts] = React.useState<IConcept[]>([]);
  const [selected, setSelected] = React.useState<IConceptDetail | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [loading, setLoading] = React.useState<boolean>(true);

  // -- Load the database -----------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!databaseUrl) {
        setError('No database file configured. Set it in the property pane.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(undefined);

        // Encode each path segment: library and file names may contain
        // apostrophes, ampersands and braces.
        const encoded = databaseUrl.split('/').map(encodeURIComponent).join('/');
        const endpoint =
          `${context.pageContext.web.absoluteUrl}` +
          `/_api/web/GetFileByServerRelativePath(decodedurl='${encoded}')/$value`;

        const response = await context.spHttpClient.get(
          endpoint,
          SPHttpClient.configurations.v1
        );
        if (!response.ok) {
          throw new Error(`Could not read ${databaseUrl} (HTTP ${response.status})`);
        }
        const bytes = await response.arrayBuffer();

        // sql.js needs its .wasm at runtime. Serve it from the bundle —
        // SharePoint's CSP blocks CDN fetches.
        const database = await OntologyDatabase.load(
          bytes,
          (file: string) => `${context.pageContext.web.absoluteUrl}/SiteAssets/ontology-editor/${file}`
        );

        if (cancelled) { database.close(); return; }

        setDb(database);
        setStats(database.getStats());
        setConcepts(database.getRootConcepts());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [databaseUrl, context]);

  const onSearch = React.useCallback((term: string | undefined): void => {
    if (!db) return;
    setConcepts(term && term.trim() ? db.searchConcepts(term.trim()) : db.getRootConcepts());
  }, [db]);

  const onSelect = React.useCallback((conceptId: number): void => {
    if (!db) return;
    setSelected(db.getConceptDetail(conceptId));
  }, [db]);

  if (loading) return <Spinner size={SpinnerSize.large} label="Loading ontology..." />;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.ontologyEditor}>
      {stats && (
        <div className={styles.statusBar}>
          <span>{stats.concepts.toLocaleString()} concepts</span>
          <span>{stats.classes} classes</span>
          <span>{stats.properties} relationship types</span>
          <span>{stats.relationships.toLocaleString()} relationships</span>
          <span>{stats.broaderEdges.toLocaleString()} hierarchy edges</span>
        </div>
      )}

      <SearchBox
        placeholder="Search concepts (preferred labels, acronyms, codes)..."
        onSearch={onSearch}
        onClear={() => onSearch(undefined)}
      />

      <div className={styles.panes}>
        <div className={styles.listPane}>
          {concepts.map(c => (
            <button
              key={c.id}
              type="button"
              className={`${styles.conceptRow} ${selected && selected.id === c.id ? styles.selected : ''}`}
              onClick={() => onSelect(c.id)}
            >
              {c.prefLabel || c.uri}
            </button>
          ))}
          {concepts.length === 0 && <div className={styles.conceptRow}>No matches.</div>}
        </div>

        <div className={styles.detailPane}>
          {!selected && <p>Select a concept to see its details.</p>}
          {selected && <ConceptDetail detail={selected} onNavigate={onSelect} />}
        </div>
      </div>
    </div>
  );
};

/** Semaphore stores notes as HTML fragments; show the readable text. */
function stripHtml(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

const ConceptDetail: React.FC<{
  detail: IConceptDetail;
  onNavigate: (conceptId: number) => void;
}> = ({ detail, onNavigate }) => (
  <>
    <h2>{detail.prefLabel || detail.uri}</h2>
    <div className={styles.statusBar}>
      {detail.className && <span>Class: {detail.className}</span>}
      {detail.guid && <span>GUID: {detail.guid}</span>}
      <span>{detail.childCount} children</span>
    </div>

    {detail.parents.length > 0 && (
      <>
        <div className={styles.sectionHeading}>
          {/* 49 concepts sit under more than one parent. */}
          Parent{detail.parents.length > 1 ? `s (${detail.parents.length})` : ''}
        </div>
        {detail.parents.map(p => (
          <div key={p.id} className={styles.linkRow}>
            <button type="button" className={styles.conceptRow} onClick={() => onNavigate(p.id)}>
              {p.prefLabel || p.uri}
            </button>
          </div>
        ))}
      </>
    )}

    {detail.labels.length > 0 && (
      <>
        <div className={styles.sectionHeading}>Labels</div>
        {detail.labels.map(l => (
          <div key={l.id} className={styles.linkRow}>
            <span className={styles.propertyName}>{localName(l.labelProperty)}</span>
            <span>{l.literalForm}</span>
          </div>
        ))}
      </>
    )}

    {detail.links.length > 0 && (
      <>
        <div className={styles.sectionHeading}>Relationships ({detail.links.length})</div>
        {detail.links.map((l, i) => (
          <div key={`${l.relationshipId}-${l.direction}-${i}`} className={styles.linkRow}>
            <span className={styles.propertyName}>{l.propertyLabel}</span>
            <button type="button" className={styles.conceptRow} onClick={() => onNavigate(l.otherConceptId)}>
              {l.otherConceptLabel}
              {l.otherConceptClass && <span className={styles.conceptClass}>{l.otherConceptClass}</span>}
            </button>
            {l.direction === 'inverse' && <span className={styles.inverseBadge}>inverse</span>}
          </div>
        ))}
      </>
    )}

    {detail.annotations.length > 0 && (
      <>
        <div className={styles.sectionHeading}>Notes</div>
        {detail.annotations.map(a => (
          <div key={a.id} className={styles.linkRow}>
            <span className={styles.propertyName}>{localName(a.predicateUri)}</span>
            {/*
              Definitions and notes are stored as HTML fragments by Semaphore
              ("<p><span>...").  Rendered as text for now: the moment this
              becomes innerHTML it needs a sanitiser, because the content
              becomes editable in this very web part.  See README "Before
              editing goes live".
            */}
            <span>{stripHtml(a.value)}</span>
          </div>
        ))}
      </>
    )}
  </>
);

export default OntologyEditor;
