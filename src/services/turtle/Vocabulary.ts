/** Fully-expanded IRIs for the predicates and classes this model uses. */

export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const OWL = 'http://www.w3.org/2002/07/owl#';
export const SKOS = 'http://www.w3.org/2004/02/skos/core#';
export const SKOSXL = 'http://www.w3.org/2008/05/skos-xl#';
export const SEM = 'http://www.smartlogic.com/2014/08/semaphore-core#';

export const RDF_TYPE = RDF + 'type';

export const RDFS_LABEL = RDFS + 'label';
export const RDFS_DOMAIN = RDFS + 'domain';
export const RDFS_RANGE = RDFS + 'range';
export const RDFS_SUBCLASS_OF = RDFS + 'subClassOf';
export const RDFS_SUBPROPERTY_OF = RDFS + 'subPropertyOf';

export const OWL_CLASS = OWL + 'Class';
export const OWL_OBJECT_PROPERTY = OWL + 'ObjectProperty';
export const OWL_DATATYPE_PROPERTY = OWL + 'DatatypeProperty';
export const OWL_INVERSE_OF = OWL + 'inverseOf';
export const OWL_ONTOLOGY = OWL + 'Ontology';

export const SKOS_CONCEPT = SKOS + 'Concept';
export const SKOS_CONCEPT_SCHEME = SKOS + 'ConceptScheme';
export const SKOS_BROADER = SKOS + 'broader';
export const SKOS_NARROWER = SKOS + 'narrower';
export const SKOS_RELATED = SKOS + 'related';
export const SKOS_DEFINITION = SKOS + 'definition';

export const SKOSXL_LABEL = SKOSXL + 'Label';
export const SKOSXL_PREF_LABEL = SKOSXL + 'prefLabel';
export const SKOSXL_ALT_LABEL = SKOSXL + 'altLabel';
export const SKOSXL_LITERAL_FORM = SKOSXL + 'literalForm';

export const SEM_GUID = SEM + 'guid';

/**
 * Predicates handled by dedicated tables. Everything else on a concept becomes
 * an annotation (literal object) or a relationship (IRI object).
 */
export const STRUCTURAL_PREDICATES: { [uri: string]: true } = {
  [RDF_TYPE]: true,
  [SEM_GUID]: true,
  [SKOS_BROADER]: true,
  [SKOSXL_PREF_LABEL]: true,
  [SKOSXL_ALT_LABEL]: true
};

/** Short display name for a URI: the part after the last # or /. */
export function localName(uri: string): string {
  const hash = uri.lastIndexOf('#');
  const slash = uri.lastIndexOf('/');
  const cut = Math.max(hash, slash);
  return cut >= 0 ? uri.slice(cut + 1) : uri;
}
