import * as React from 'react';
import { Icon } from '@fluentui/react';
import styles from './OntologyEditor.module.scss';
import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { ITreeNode } from '../../../models/IOntology';

export interface IConceptTreeProps {
  db: OntologyDatabase;
  selectedId?: number;
  onSelect: (conceptId: number) => void;
  /** Ancestor chain to expand and reveal, e.g. after a search hit. */
  revealPath?: number[];
}

interface IRowProps {
  node: ITreeNode;
  depth: number;
  db: OntologyDatabase;
  expanded: { [id: number]: true };
  toggle: (id: number) => void;
  selectedId?: number;
  onSelect: (id: number) => void;
}

/**
 * One tree row plus its children when expanded.
 *
 * Children are fetched on expand rather than up front: the model has 10,788
 * concepts and loading the whole tree eagerly would be both slow and pointless,
 * since only one branch is ever visible.
 */
const TreeRow: React.FC<IRowProps> = ({ node, depth, db, expanded, toggle, selectedId, onSelect }) => {
  const isOpen = !!expanded[node.id];
  const children = React.useMemo(
    () => (isOpen ? db.getChildNodes(node.id) : []),
    [isOpen, node.id, db]
  );

  return (
    <>
      <div
        className={`${styles.treeRow} ${selectedId === node.id ? styles.treeRowSelected : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {node.childCount > 0 ? (
          <button
            type="button"
            className={styles.treeChevron}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            aria-expanded={isOpen}
            onClick={() => toggle(node.id)}
          >
            <Icon iconName={isOpen ? 'ChevronDown' : 'ChevronRight'} />
          </button>
        ) : (
          <span className={styles.treeChevronSpacer} />
        )}

        <button
          type="button"
          className={styles.treeLabel}
          onClick={() => onSelect(node.id)}
          title={node.prefLabel || node.uri}
        >
          {node.prefLabel || node.uri}
        </button>
      </div>

      {isOpen && children.map(child => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          db={db}
          expanded={expanded}
          toggle={toggle}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

/**
 * The hierarchy browser. Roots are the 11 top concepts (Activity, Authority,
 * Classification, …) — the model's upper ontology.
 */
const ConceptTree: React.FC<IConceptTreeProps> = ({ db, selectedId, onSelect, revealPath }) => {
  const roots = React.useMemo(() => db.getRootNodes(), [db]);
  const [expanded, setExpanded] = React.useState<{ [id: number]: true }>({});

  const toggle = React.useCallback((id: number): void => {
    setExpanded(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = true;
      return next;
    });
  }, []);

  // Expand the path to a revealed concept without collapsing anything already open.
  React.useEffect(() => {
    if (!revealPath || !revealPath.length) return;
    setExpanded(prev => {
      const next = { ...prev };
      for (const id of revealPath) next[id] = true;
      return next;
    });
  }, [revealPath]);

  return (
    <div className={styles.tree}>
      {roots.map(root => (
        <TreeRow
          key={root.id}
          node={root}
          depth={0}
          db={db}
          expanded={expanded}
          toggle={toggle}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

export default ConceptTree;
