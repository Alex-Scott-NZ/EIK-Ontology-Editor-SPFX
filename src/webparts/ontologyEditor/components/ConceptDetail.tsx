import * as React from 'react';
import { Icon } from '@fluentui/react';
import styles from './OntologyEditor.module.scss';
import { OntologyDatabase } from '../../../services/database/OntologyDatabase';
import { IConcept, IConceptDetail, ILabel, IAnnotation } from '../../../models/IOntology';
import { localName, SKOSXL_PREF_LABEL } from '../../../services/turtle/Vocabulary';

export interface IConceptEditHandlers {
  onRename: () => void;
  onChangeClass: () => void;
  onAddLabel: () => void;
  onEditLabel: (label: ILabel) => void;
  onDeleteLabel: (label: ILabel) => void;
  onAddRelationship: () => void;
  onEditRelationship: (relationshipId: number) => void;
  onDeleteRelationship: (relationshipId: number, description: string) => void;
  onAddBroader: () => void;
  onRemoveBroader: (parentId: number, parentLabel: string) => void;
  onAddNarrower: () => void;
  onAddAnnotation: () => void;
  onEditAnnotation: (annotation: IAnnotation) => void;
  onDeleteAnnotation: (annotation: IAnnotation) => void;
}

export interface IConceptDetailProps {
  db: OntologyDatabase;
  conceptId: number;
  onNavigate: (conceptId: number) => void;
  classColours: { [classId: number]: string };
  classLabels: { [classId: number]: string };
  /** Omit for a read-only pane. */
  edit?: IConceptEditHandlers;
  /** Bump to refetch after an edit. */
  refreshToken?: number;
}

/** Small inline action, revealed on row hover. */
const RowAction: React.FC<{ icon: string; title: string; onClick: () => void; danger?: boolean }> =
  ({ icon, title, onClick, danger }) => (
    <button
      type="button"
      className={danger ? styles.rowActionDelete : styles.rowActionEdit}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon iconName={icon} />
    </button>
  );

/** Semaphore stores definitions and notes as HTML fragments. Render as text. */
function stripHtml(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Wildcard syntax used by the classifier — see docs/REPLACING-SEMAPHORE.md §3. */
function looksLikePattern(form: string): boolean {
  return /[*~#]/.test(form) || /^\\|\\$/.test(form);
}

const Section: React.FC<{
  icon: string; title: string; count?: number;
  addLabel?: string; onAdd?: () => void;
  children?: React.ReactNode;
}> = ({ icon, title, count, addLabel, onAdd, children }) => (
  <section className={styles.detailSection}>
    <h3 className={styles.detailSectionHeading}>
      <Icon iconName={icon} className={styles.detailSectionIcon} />
      {title}
      {count !== undefined && <span className={styles.countChip}>{count}</span>}
      {/* The verb lives in the tooltip; the header line stays quiet. */}
      {onAdd && (
        <button
          type="button"
          className={styles.rowActionAdd}
          title={addLabel || 'Add'}
          aria-label={addLabel || 'Add'}
          onClick={onAdd}
        >
          <Icon iconName="Add" />
        </button>
      )}
    </h3>
    {children}
  </section>
);

const ConceptChip: React.FC<{
  concept: IConcept;
  classLabels: { [classId: number]: string };
  classColours: { [classId: number]: string };
  onNavigate: (id: number) => void;
}> = ({ concept, classLabels, classColours, onNavigate }) => (
  <button type="button" className={styles.conceptLink} onClick={() => onNavigate(concept.id)}>
    {concept.prefLabel || concept.uri}
    {concept.classId !== undefined && classLabels[concept.classId] && (
      <span
        className={styles.inlineClassChip}
        style={{ backgroundColor: classColours[concept.classId] || undefined }}
      >
        {classLabels[concept.classId]}
      </span>
    )}
  </button>
);

/** Label row: `role > value (lang)`, with a badge when the value is a match pattern. */
const LabelRow: React.FC<{ label: ILabel; edit?: IConceptEditHandlers }> = ({ label, edit }) => {
  const pattern = looksLikePattern(label.literalForm);
  const flagCount = label.flags ? Object.keys(label.flags).length : 0;
  return (
    <div className={styles.labelRow}>
      <span className={styles.labelRole}>{localName(label.labelProperty)}</span>
      <Icon iconName="ChevronRight" className={styles.labelArrow} />
      <span className={pattern ? styles.patternValue : undefined}>{label.literalForm}</span>
      {label.lang && <span className={styles.langChip}>{label.lang}</span>}
      {pattern && (
        <span
          className={styles.patternBadge}
          title="Contains classifier wildcard syntax (* ~ #). Editing this changes how documents are matched."
        >
          pattern
        </span>
      )}
      {flagCount > 0 && (
        <span
          className={styles.flagBadge}
          title={`${flagCount} matching setting${flagCount === 1 ? '' : 's'} set on this label`}
        >
          {flagCount} setting{flagCount === 1 ? '' : 's'}
        </span>
      )}
      {edit && (
        <span className={styles.rowActions}>
          <RowAction icon="Edit" title="Edit label and matching settings" onClick={() => edit.onEditLabel(label)} />
          <RowAction icon="Delete" title="Delete label" danger onClick={() => edit.onDeleteLabel(label)} />
        </span>
      )}
    </div>
  );
};

/**
 * Concept detail, laid out like Semaphore's Details tab: identity and labels on
 * the left, the concept's place in the graph on the right.
 */
const ConceptDetailPane: React.FC<IConceptDetailProps> = (props) => {
  const { db, conceptId, onNavigate, classColours, classLabels, edit, refreshToken } = props;

  const detail: IConceptDetail | undefined = React.useMemo(
    () => db.getConceptDetail(conceptId), [db, conceptId, refreshToken]
  );
  const children = React.useMemo(
    () => db.getChildren(conceptId), [db, conceptId, refreshToken]
  );

  if (!detail) return <div className={styles.emptyState}>Concept not found.</div>;

  const prefLabels = detail.labels.filter(l => l.labelProperty === SKOSXL_PREF_LABEL);
  const altLabels = detail.labels.filter(l => l.labelProperty !== SKOSXL_PREF_LABEL);
  const colour = detail.classId !== undefined ? classColours[detail.classId] : undefined;

  return (
    <div className={styles.detail}>
      <h1 className={styles.detailTitle}>
        {detail.prefLabel || localName(detail.uri)}
        {edit && (
          <RowAction icon="Edit" title="Rename this concept" onClick={edit.onRename} />
        )}
      </h1>

      <div className={styles.detailColumns}>
        {/* ---------------- Left: identity, labels, metadata ---------------- */}
        <div className={styles.detailColumn}>
          <Section icon="Tag" title="Concept Class">
            {detail.className ? (
              <span className={styles.classChip} style={{ backgroundColor: colour || undefined }}>
                {detail.className}
              </span>
            ) : (
              <span className={styles.muted}>
                No class — nothing constrains which relationships may be used here.
              </span>
            )}
            {edit && (
              <RowAction icon="Edit" title="Change the class" onClick={edit.onChangeClass} />
            )}
          </Section>

          <Section icon="FavoriteStar" title="Preferred Labels">
            {prefLabels.length === 0 && <span className={styles.muted}>None</span>}
            {prefLabels.map(l => (
              <div key={l.id} className={styles.labelRow}>
                <span>{l.literalForm}</span>
                {l.lang && <span className={styles.langChip}>{l.lang}</span>}
              </div>
            ))}
          </Section>

          <Section
            icon="Dictionary" title="Alternative Labels" count={altLabels.length}
            addLabel="Create an alternative label"
            onAdd={edit ? edit.onAddLabel : undefined}
          >
            {altLabels.length === 0 && <span className={styles.muted}>None</span>}
            {altLabels.map(l => <LabelRow key={l.id} label={l} edit={edit} />)}
          </Section>

          <Section
            icon="PageList" title="Metadata" count={detail.annotations.length}
            addLabel="Add metadata field"
            onAdd={edit ? edit.onAddAnnotation : undefined}
          >
            {detail.annotations.length === 0 && <span className={styles.muted}>None</span>}
            {detail.annotations.map(a => (
              <div key={a.id} className={styles.metadataField}>
                <div className={styles.metadataName}>
                  {a.displayLabel || localName(a.predicateUri)}
                  {edit && (
                    <span className={styles.rowActions}>
                      <RowAction icon="Edit" title="Edit value" onClick={() => edit.onEditAnnotation(a)} />
                      <RowAction icon="Delete" title="Delete field" danger onClick={() => edit.onDeleteAnnotation(a)} />
                    </span>
                  )}
                </div>
                <div className={styles.metadataValue}>
                  {stripHtml(a.value)}
                  {a.lang && <span className={styles.langChip}>{a.lang}</span>}
                </div>
              </div>
            ))}
          </Section>
        </div>

        {/* ---------------- Right: position in the graph ---------------- */}
        <div className={styles.detailColumn}>
          <Section
            icon="Relationship" title="Related Concepts" count={detail.links.length}
            addLabel="Select a related concept"
            onAdd={edit ? edit.onAddRelationship : undefined}
          >
            {detail.links.length === 0 && <span className={styles.muted}>None</span>}
            {detail.links.map((l, i) => (
              <div key={`${l.relationshipId}-${l.direction}-${i}`} className={styles.linkRow}>
                <span className={styles.linkProperty}>{l.propertyLabel}</span>
                <Icon iconName="ChevronRight" className={styles.labelArrow} />
                <span className={styles.linkTarget}>
                  <button
                    type="button"
                    className={styles.conceptLink}
                    onClick={() => onNavigate(l.otherConceptId)}
                  >
                    {l.otherConceptLabel}
                  </button>
                  {l.otherConceptClass && (
                    <span
                      className={styles.inlineClassChip}
                      style={{ backgroundColor: colourForClassName(l.otherConceptClass, classLabels, classColours) }}
                    >
                      {l.otherConceptClass}
                    </span>
                  )}
                  {l.direction === 'inverse' && <span className={styles.inverseBadge}>inverse</span>}
                </span>
                {edit && (
                  <span className={styles.rowActions}>
                    {/* Editing and deleting work from either end: the view
                        carries the id of the single stored row, so there is
                        no half-deleted state to get into. */}
                    <RowAction
                      icon="Edit" title="Change this relationship"
                      onClick={() => edit.onEditRelationship(l.relationshipId)}
                    />
                    <RowAction
                      icon="Delete" title="Remove this relationship" danger
                      onClick={() => edit.onDeleteRelationship(
                        l.relationshipId, `${l.propertyLabel} → ${l.otherConceptLabel}`
                      )}
                    />
                  </span>
                )}
              </div>
            ))}
          </Section>

          <Section
            icon="Up" title="Broader Concepts" count={detail.parents.length}
            addLabel="Select a broader concept"
            onAdd={edit ? edit.onAddBroader : undefined}
          >
            {detail.parents.length === 0 && <span className={styles.muted}>None — this is a top concept.</span>}
            {detail.parents.map(p => (
              <div key={p.id} className={styles.linkRow}>
                <span className={styles.linkProperty}>has broader</span>
                <Icon iconName="ChevronRight" className={styles.labelArrow} />
                <ConceptChip
                  concept={p}
                  classLabels={classLabels}
                  classColours={classColours}
                  onNavigate={onNavigate}
                />
                {edit && detail.parents.length > 0 && (
                  <span className={styles.rowActions}>
                    <RowAction
                      icon="Delete" title="Remove this parent" danger
                      onClick={() => edit.onRemoveBroader(p.id, p.prefLabel || p.uri)}
                    />
                  </span>
                )}
              </div>
            ))}
          </Section>

          <Section
            icon="Down" title="Narrower Concepts" count={detail.childCount}
            addLabel="Add a narrower concept"
            onAdd={edit ? edit.onAddNarrower : undefined}
          >
            {children.length === 0 && <span className={styles.muted}>None</span>}
            {children.map(c => (
              <div key={c.id} className={styles.linkRow}>
                <span className={styles.linkProperty}>has narrower</span>
                <Icon iconName="ChevronRight" className={styles.labelArrow} />
                <ConceptChip
                  concept={c}
                  classLabels={classLabels}
                  classColours={classColours}
                  onNavigate={onNavigate}
                />
              </div>
            ))}
          </Section>

          <Section icon="Fingerprint" title="Identity">
            <div className={styles.metadataField}>
              <div className={styles.metadataName}>URI</div>
              <div className={styles.uriValue}>{detail.uri}</div>
            </div>
            {detail.guid && (
              <div className={styles.metadataField}>
                <div className={styles.metadataName}>GUID</div>
                <div className={styles.uriValue}>{detail.guid}</div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
};

/** Class chips are keyed by label in link rows; map back to a colour. */
function colourForClassName(
  className: string,
  classLabels: { [classId: number]: string },
  classColours: { [classId: number]: string }
): string | undefined {
  for (const idStr of Object.keys(classLabels)) {
    const id = Number(idStr);
    if (classLabels[id] === className) return classColours[id];
  }
  return undefined;
}

export default ConceptDetailPane;
