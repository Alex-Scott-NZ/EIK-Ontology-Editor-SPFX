/** Shapes returned by OntologyDatabase. Mirrors tools/schema.sql. */

/**
 * One preserved RDF term inside a flags blob: `v` value, `t` 'i' (IRI) or
 * 'l' (literal), optional language tag and datatype IRI. Term-preserving so
 * the Turtle exporter can replay flags verbatim.
 */
export interface IFlagTerm {
  v: string;
  t: 'i' | 'l';
  lang?: string;
  dt?: string;
}

export type FlagMap = { [predicateUri: string]: IFlagTerm[] };

export interface IOntologyClass {
  id: number;
  uri: string;
  label: string | undefined;
  definition: string | undefined;
  parentClassId: number | undefined;
  /** Semaphore extras kept verbatim, e.g. `color` — the tree swatch users navigate by. */
  flags: FlagMap | undefined;
}

export interface IOntologyProperty {
  id: number;
  uri: string;
  label: string | undefined;
  /** rdfs:domain. undefined = usable from any concept. */
  domainClassId: number | undefined;
  /** rdfs:range. undefined = target may be any concept. */
  rangeClassId: number | undefined;
  /** owl:inverseOf. undefined = genuinely one-directional. */
  inversePropertyId: number | undefined;
  subPropertyOf: string | undefined;
  /**
   * What this relationship type means, as written by the taxonomy team. Exists
   * nowhere else once Semaphore is retired — show it in the picker.
   */
  definition: string | undefined;
  comment: string | undefined;
  /** Field rules Semaphore enforced: changeable, unique, noteRange, defaultValue. */
  flags: FlagMap | undefined;
}

export interface IConcept {
  id: number;
  uri: string;
  guid: string | undefined;
  classId: number | undefined;
  /** Denormalised skosxl:prefLabel literal, for display and search. */
  prefLabel: string | undefined;
}

/** A concept carrying its child count, so the tree can draw chevrons up front. */
export interface ITreeNode extends IConcept {
  childCount: number;
}

/** A concept plus the bits the detail pane always needs. */
export interface IConceptDetail extends IConcept {
  className: string | undefined;
  parents: IConcept[];
  childCount: number;
  labels: ILabel[];
  annotations: IAnnotation[];
  links: IConceptLink[];
}

export interface ILabel {
  id: number;
  labelProperty: string;
  literalForm: string;
  lang: string | undefined;
  /**
   * Per-label text-matching instructions (stemming, caseSensitivity,
   * rulebaseBehaviour, rulebaseInfluence, ...). Set deliberately, one term at a
   * time — never bulk-default these. See docs/REPLACING-SEMAPHORE.md section 3.
   */
  flags: FlagMap | undefined;
}

export interface IAnnotation {
  id: number;
  predicateUri: string;
  value: string | undefined;
  lang: string | undefined;
  /** xsd datatype IRI (date, boolean, ...); undefined = plain/lang string. */
  datatype: string | undefined;
  /**
   * The defined field's rdfs:label ("Risk rating"), when the predicate has a
   * definition in `properties`. Display falls back to the URI's local name
   * ("Risk-rating") only for predicates with no definition.
   */
  displayLabel: string | undefined;
}

/**
 * One end of a relationship as seen from a concept. `direction` says whether
 * this is the stored row ('forward') or the derived mirror ('inverse') — see
 * ARCHITECTURE.md Decision 3.
 */
export interface IConceptLink {
  relationshipId: number;
  propertyId: number;
  propertyLabel: string | undefined;
  otherConceptId: number;
  otherConceptLabel: string | undefined;
  otherConceptClass: string | undefined;
  direction: 'forward' | 'inverse';
}

/** A relationship type that may legally be used from a given concept. */
export interface IAllowedProperty {
  propertyId: number;
  label: string | undefined;
  /** undefined = any concept may be the target. */
  rangeClassId: number | undefined;
  rangeClassName: string | undefined;
  /** The taxonomy team's own note on when to use this. Show it in the picker. */
  definition: string | undefined;
}

export interface IOntologyStats {
  concepts: number;
  classes: number;
  properties: number;
  relationships: number;
  broaderEdges: number;
  labels: number;
}
