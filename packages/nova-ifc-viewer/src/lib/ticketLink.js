// ticketLink.js — addressable tickets and the Issue data contract (72-13, N-10).
//
// Why: the ticket is the hinge of the chain model → finding → ticket → change order.
// Until now a ticket could only be created by clicking into the 3D model and no URL
// addressed one. This module fixes the URL contract that other modules link to
// (IFC viewer, BCF findings, change orders): the parameter names are a contract.
//
// Issue data contract — additive and schemaless, no migration:
// - element_guid = IFC GlobalId of the affected element. Writers set element_guid
//   AND the legacy field element_id to the same value; readers take
//   element_guid || element_id (seed and older records only carry element_id).
// - location ({x, y, z} in metres, model coordinates) may be null: a ticket without
//   a model point gets no marker in the 3D view.
// - quelle: 'manuell' | 'bcf' | 'ifc' — where the ticket came from.
// - bcf_topic_guid: optional, the BCF topic a ticket was created from.
// - status and priority values stay English keys; the display goes through the
//   German label maps below (the labels double as i18n keys for t()).
//
// In:  ticket ids, prefill values, URLSearchParams-like objects, Issue records.
// Out: router paths ('/BimViewer?…' — valid for BrowserRouter and HashRouter),
//      parsed parameters, labels. Pure — no DOM, no React — so it runs under Node.

/** Router path of the BIM viewer page that hosts the ticket list. */
export const TICKET_SEITE = '/BimViewer';

/** Allowed values of Issue.quelle. */
export const TICKET_QUELLEN = ['manuell', 'bcf', 'ifc'];

/** Query parameters that open the new-ticket form; removed again after opening. */
export const NEU_PARAMETER = ['neu', 'element', 'titel', 'quelle'];

// Upper bound for values taken from a link. A link can carry anything; a title of
// several kilobytes would break the form layout. [ASSUMED] 200 characters is far
// above any real ticket title and below anything that looks like abuse.
const MAX_LAENGE = 200;

/** Ticket status (Issue.status) → German label. */
export const TICKET_STATUS_LABELS = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  resolved: 'Gelöst',
  closed: 'Geschlossen',
};

/** Ticket priority (Issue.priority) → German label. */
export const PRIORITAET_LABELS = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  critical: 'Kritisch',
};

/**
 * Label lookup with a readable fallback. Own keys only — a raw value such as
 * "constructor" must not resolve to an Object.prototype member.
 * @param {Record<string, string>} map
 * @param {unknown} wert
 * @returns {string}
 */
function label(map, wert) {
  if (wert === null || wert === undefined || wert === '') return '';
  const s = String(wert);
  return Object.prototype.hasOwnProperty.call(map, s) ? map[s] : s.replace(/_/g, ' ');
}

/**
 * Trimmed string or null for anything empty or not a string/number.
 * @param {unknown} v
 * @returns {string|null}
 */
function text(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().slice(0, MAX_LAENGE);
  return s || null;
}

/**
 * Link to one ticket: the BIM viewer selects it and scrolls it into view.
 * @param {string} id Issue id, e.g. "iss-2"
 * @returns {string} router path, e.g. "/BimViewer?ticket=iss-2"; the bare page path
 *   when the id is empty
 */
export function ticketUrl(id) {
  const t = text(id);
  return t ? `${TICKET_SEITE}?ticket=${encodeURIComponent(t)}` : TICKET_SEITE;
}

/**
 * Link that opens the new-ticket form, prefilled. Empty values are dropped so the
 * link stays short; the parameter order is fixed so equal input gives equal links.
 * @param {{element?: string, titel?: string, quelle?: string}} [vorbelegung]
 *   element = IFC GlobalId, titel = ticket title, quelle = one of TICKET_QUELLEN
 *   (anything else is dropped)
 * @returns {string} router path, e.g. "/BimViewer?neu=1&element=…&titel=Wand"
 */
export function neuesTicketUrl({ element, titel, quelle } = {}) {
  const teile = [['neu', '1']];
  const guid = text(element);
  const t = text(titel);
  const q = text(quelle);
  if (guid) teile.push(['element', guid]);
  if (t) teile.push(['titel', t]);
  if (q && TICKET_QUELLEN.includes(q)) teile.push(['quelle', q]);
  return `${TICKET_SEITE}?${teile.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * Reads the ticket parameters of the current URL. Broken input never throws:
 * missing, empty or unknown values come back as null (neu as false).
 * @param {URLSearchParams|string|null|undefined} searchParams URLSearchParams
 *   (e.g. from useSearchParams) or a query string with or without leading "?"
 * @returns {{ticket: string|null, neu: boolean, element: string|null,
 *   titel: string|null, quelle: string|null}}
 */
export function leseTicketParameter(searchParams) {
  let p = null;
  if (typeof searchParams === 'string') p = new URLSearchParams(searchParams);
  else if (searchParams && typeof searchParams.get === 'function') p = searchParams;
  const lies = (k) => (p ? text(p.get(k)) : null);
  const quelle = lies('quelle');
  return {
    ticket: lies('ticket'),
    neu: lies('neu') === '1',
    element: lies('element'),
    titel: lies('titel'),
    quelle: quelle && TICKET_QUELLEN.includes(quelle) ? quelle : null,
  };
}

/**
 * Copy of the query without the new-ticket parameters (NEU_PARAMETER), so a reload
 * does not open the form a second time. Other parameters (e.g. ticket) stay.
 * @param {URLSearchParams|string} searchParams
 * @returns {URLSearchParams} new instance; the input is not changed
 */
export function ohneNeuParameter(searchParams) {
  const kopie = new URLSearchParams(searchParams);
  for (const k of NEU_PARAMETER) kopie.delete(k);
  return kopie;
}

/**
 * True while a ticket still needs work. A missing status counts as open — a record
 * without status was never closed by anyone.
 * @param {{status?: string}|null|undefined} issue
 * @returns {boolean}
 */
export function istOffen(issue) {
  if (!issue) return false;
  return issue.status !== 'resolved' && issue.status !== 'closed';
}

/**
 * True when the ticket has a usable model point. The 3D view places a marker at
 * (x||0, y||0, z||0), so a missing or broken location would sit at the origin —
 * only tickets passing this check are handed to the viewer.
 * @param {{location?: {x?: unknown, y?: unknown, z?: unknown}|null}|null|undefined} issue
 * @returns {boolean} x, y and z (metres) are all finite numbers
 */
export function hatModellpunkt(issue) {
  const l = issue?.location;
  return !!l && [l.x, l.y, l.z].every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * IFC GlobalId of the ticket's element (reader side of the contract).
 * @param {{element_guid?: string, element_id?: string}|null|undefined} issue
 * @returns {string} GlobalId or "" when the ticket has no element
 */
export function bauteilGuid(issue) {
  return text(issue?.element_guid) || text(issue?.element_id) || '';
}

/**
 * Writer side of the contract: returns a copy with element_guid AND element_id set
 * to the same trimmed GlobalId ("" for none).
 * @template {object} T
 * @param {T} daten Issue fields
 * @param {string} guid IFC GlobalId
 * @returns {T & {element_guid: string, element_id: string}}
 */
export function mitBauteilGuid(daten, guid) {
  const g = text(guid) || '';
  // Object.assign instead of spread: tsc rejects spreading a generic T.
  return Object.assign({}, daten, { element_guid: g, element_id: g });
}

/**
 * German label of a status; unknown values stay readable (underscores → spaces),
 * missing ones give "".
 * @param {string|null|undefined} status
 * @returns {string}
 */
export function statusLabel(status) {
  return label(TICKET_STATUS_LABELS, status);
}

/**
 * German label of a priority; same fallback as statusLabel.
 * @param {string|null|undefined} prioritaet
 * @returns {string}
 */
export function prioritaetLabel(prioritaet) {
  return label(PRIORITAET_LABELS, prioritaet);
}
