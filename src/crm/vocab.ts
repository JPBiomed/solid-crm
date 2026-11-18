/**
 * The vocabularies the CRM writes. Standard terms first (vCard, schema.org,
 * iCalendar, Dublin Core), so another Solid app that has never heard of this
 * one can still read a contact or a task. The `crm:` namespace only holds what
 * no standard vocabulary says — and terms in it are only ever added, never
 * renamed: documents on the pod carry these IRIs.
 *
 * See docs/data-model.md for the full shape of each record.
 */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const ns = (base: string) => (term: string) => base + term;

export const VCARD = ns("http://www.w3.org/2006/vcard/ns#");
export const SCHEMA = ns("https://schema.org/");
export const ICAL = ns("http://www.w3.org/2002/12/cal/ical#");
export const DCT = ns("http://purl.org/dc/terms/");

/**
 * Not dereferenceable yet. Like the kit's `sc:` namespace, nothing fetches it
 * today; IRIs are only compared. A w3id redirect can come later without
 * changing a single stored triple.
 */
export const CRM_NS = "https://w3id.org/solid-crm/vocab#";
export const CRM = ns(CRM_NS);
