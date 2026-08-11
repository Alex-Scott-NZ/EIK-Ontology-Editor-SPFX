import * as React from 'react';
import { IconButton } from '@fluentui/react';
import styles from './OntologyEditor.module.scss';
import { OntologyDatabase } from '../../../services/database/OntologyDatabase';

export interface IConceptListProps {
  db: OntologyDatabase;
  search: string;
  selectedId?: number;
  onSelect: (conceptId: number) => void;
  /** Bump to refetch after an edit. */
  refreshToken?: number;
}

const PAGE_SIZE = 100;

/** Page numbers to render: first, last, current neighbourhood, with gaps. */
function pageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    const all: number[] = [];
    for (let i = 1; i <= total; i++) all.push(i);
    return all;
  }
  const out: Array<number | '…'> = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

/**
 * Flat alphabetical list, paginated — Semaphore's "list view".
 *
 * Paged in SQL rather than by slicing a full result set: 10,788 rows would be
 * wasteful to fetch and render for one visible page.
 */
const ConceptList: React.FC<IConceptListProps> = ({ db, search, selectedId, onSelect, refreshToken }) => {
  const [page, setPage] = React.useState<number>(1);

  const total = React.useMemo(() => db.countConcepts(search), [db, search, refreshToken]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // A new search invalidates the current page number.
  React.useEffect(() => { setPage(1); }, [search]);

  const safePage = Math.min(page, totalPages);
  const rows = React.useMemo(
    () => db.listConcepts((safePage - 1) * PAGE_SIZE, PAGE_SIZE, search),
    [db, safePage, search, refreshToken]
  );

  return (
    <div className={styles.list}>
      <div className={styles.listRows}>
        {rows.map(c => (
          <button
            key={c.id}
            type="button"
            className={`${styles.listRow} ${selectedId === c.id ? styles.listRowSelected : ''}`}
            onClick={() => onSelect(c.id)}
            title={c.prefLabel || c.uri}
          >
            {c.prefLabel || c.uri}
          </button>
        ))}
        {rows.length === 0 && <div className={styles.emptyState}>No matching concepts.</div>}
      </div>

      {totalPages > 1 && (
        <div className={styles.pager}>
          <IconButton
            iconProps={{ iconName: 'ChevronLeft' }}
            ariaLabel="Previous page"
            disabled={safePage === 1}
            onClick={() => setPage(safePage - 1)}
          />
          {pageWindow(safePage, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`gap${i}`} className={styles.pagerGap}>…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`${styles.pagerPage} ${p === safePage ? styles.pagerPageActive : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )
          )}
          <IconButton
            iconProps={{ iconName: 'ChevronRight' }}
            ariaLabel="Next page"
            disabled={safePage === totalPages}
            onClick={() => setPage(safePage + 1)}
          />
        </div>
      )}

      <div className={styles.listCount}>
        {total.toLocaleString()} concept{total === 1 ? '' : 's'}
        {search ? ' matching' : ''}
      </div>
    </div>
  );
};

export default ConceptList;
