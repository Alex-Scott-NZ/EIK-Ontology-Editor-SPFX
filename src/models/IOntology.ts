/** Shapes returned by OntologyDatabase. Mirrors tools/schema.sql. */

export interface IOntologyClass {
  id: number;
  uri: string;
  label: string | undefined;
  definition: string | undefined;
  parentClassId: number | undefined;
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
}

export interface IConcept {
  id: number;
  uri: string;
  guid: string | undefined;
  classId: number | undefined;
  /** Denormalised skosxl:prefLabel literal, for display and search. */
  prefLabel: string | undefined;
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
}

export interface IAnnotation {
  id: number;
  predicateUri: string;
  value: string | undefined;
  lang: string | undefined;
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
}

export interface IOntologyStats {
  concepts: number;
  classes: number;
  properties: number;
  relationships: number;
  broaderEdges: number;
  labels: number;
}
