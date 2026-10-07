// nachtraege.js — change orders (Nachträge): one truth per project, status
// lifecycle, sums (72-14, N-13), the prefill from a ticket and the link contract
// of the Finance page (72-14, N-14).
//
// Why: the seed change orders co-1…co-4 only carry project_name, Finance filtered
// by project_id alone (zero change orders for proj-1) while the AVA settlement
// matched id OR name (two). A new change order stored no project_id and vanished
// from the list right after saving. And no code could approve one, although
// settlement and cost control only count approved change orders. This module is
// the single rule that every page uses to scope and decide change orders.
//
// ChangeOrder data contract — additive and schemaless (JSON-DB, IndexedDB,
// Supabase jsonb), no migration:
// - project_id is written from the active project on every create and update;
//   project_name stays and is written along with it (readers without an id and
//   exports keep working).
// - Legacy records without project_id belong to the project whose name matches.
//   They get project_id only on their next update (lazy backfill) — never in a
//   bulk rewrite, so nothing changes behind the user's back.
// - cost_impact in euros (negative = saving); null = deliberately not quantified
//   yet, counts as 0 € in sums.
// - status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'completed'.
//   Keys stay English; the display goes through NACHTRAG_STATUS_LABELS (the labels
//   double as i18n keys for t()).
// - decided_date: ISO timestamp, set when a change order is approved or rejected.
// - issue_id (N-14): optional id of the ticket (Issue) the change order came
//   from. Additive like project_id; records without it simply have no ticket.
//
// Link contract (N-14): '/Finance?neu=1' opens the empty change order form,
// '/Finance?neu=1&ticket=<issue id>' the form prefilled from that ticket. The
// parameter names are a contract with the IFC viewer, the site control room and
// the AVA settlement; Finance removes them after opening (reload does not reopen).
//
// In:  ChangeOrder records, projects ({id, name}), status keys, Issue records,
//      URLSearchParams-like objects.
// Out: filtered lists, sums in euros, allowed transitions, update patches,
//      prefills, router paths ('/Finance?…' — valid for BrowserRouter and HashRouter).
// Pure — no DOM, no React, no API — so it runs under Node.

/**
 * @typedef {object} Nachtrag
 * @property {string} [id]
 * @property {string} [project_id]
 * @property {string} [project_name]
 * @property {string} [title]
 * @property {number|null} [cost_impact] euros; negative = saving, null = not quantified
 * @property {string} [status]
 * @property {string} [submission_date] ISO timestamp
 * @property {string} [decided_date] ISO timestamp
 * @property {string|null} [issue_id] ticket the change order came from (N-14)
 */

/**
 * @typedef {object} Projekt
 * @property {string} id
 * @property {string} [name]
 */

/** Change order status (ChangeOrder.status) → German label. */
export const NACHTRAG_STATUS_LABELS = Object.freeze({
  pending: 'Offen',
  in_progress: 'In Bearbeitung',
  approved: 'Genehmigt',
  rejected: 'Abgelehnt',
  completed: 'Abgeschlossen',
});

/** All status keys in lifecycle order (for selects). */
export const NACHTRAG_STATUS = Object.freeze(Object.keys(NACHTRAG_STATUS_LABELS));

/**
 * Allowed status transitions, from → list of targets.
 * [ASSUMED] Domain assumption, not taken from a standard or contract template:
 * an undecided change order (pending, in_progress) can be approved or rejected;
 * pending can move to in_progress (under review); an approved one can only be
 * completed. Approved, rejected and completed are decisions — correcting one
 * means a new change order, not an edit of the old one. To be confirmed by the
 * user before it is treated as a rule.
 */
export const ERLAUBTE_UEBERGAENGE = Object.freeze({
  pending: Object.freeze(['approved', 'rejected', 'in_progress']),
  in_progress: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['completed']),
  rejected: Object.freeze([]),
  completed: Object.freeze([]),
});

/**
 * Status values whose fields may still be edited.
 * [ASSUMED] Same reasoning as ERLAUBTE_UEBERGAENGE: a decided change order is a
 * contract record; editing its amount would silently change approved sums.
 */
export const BEARBEITBARE_STATUS = Object.freeze(['pending', 'in_progress']);

/** Status values that count as "open" (not decided yet). */
const OFFENE_STATUS = ['pending', 'in_progress'];

/**
 * Own-key lookup — a raw value such as "constructor" must not resolve to an
 * Object.prototype member.
 * @param {object} map
 * @param {unknown} key
 * @returns {boolean}
 */
function hatEigenen(map, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * German label of a status with a readable fallback for unknown values.
 * @param {unknown} status ChangeOrder.status
 * @returns {string} e.g. "Genehmigt"; unknown values with "_" replaced by spaces; '' for empty
 */
export function nachtragStatusLabel(status) {
  if (status === null || status === undefined || status === '') return '';
  return hatEigenen(NACHTRAG_STATUS_LABELS, status)
    ? NACHTRAG_STATUS_LABELS[/** @type {keyof typeof NACHTRAG_STATUS_LABELS} */ (status)]
    : String(status).replace(/_/g, ' ');
}

/**
 * Whether a change order belongs to a project: same project_id, or — for legacy
 * records without project_id — the same project_name. A record with a foreign
 * project_id never matches by name (two projects may share a name).
 * @param {Nachtrag|null|undefined} order
 * @param {Projekt|null|undefined} project
 * @returns {boolean}
 */
export function gehoertZuProjekt(order, project) {
  if (!order || !project || !project.id) return false;
  if (order.project_id) return order.project_id === project.id;
  return !!project.name && order.project_name === project.name;
}

/**
 * The change orders of one project (see gehoertZuProjekt). Keeps the order of
 * the input list.
 * @param {Nachtrag[]|null|undefined} orders
 * @param {Projekt|null|undefined} project the active project; null → empty list
 * @returns {Nachtrag[]}
 */
export function nachtraegeDesProjekts(orders, project) {
  if (!Array.isArray(orders) || !project) return [];
  return orders.filter((o) => gehoertZuProjekt(o, project));
}

/**
 * The one project a change order belongs to, or null when none or more than one
 * matches (legacy record whose name is shared by several projects — then a
 * backfill would be a guess).
 * @param {Nachtrag|null|undefined} order
 * @param {Projekt[]|null|undefined} projects
 * @returns {Projekt|null}
 */
export function projektDesNachtrags(order, projects) {
  if (!order || !Array.isArray(projects)) return null;
  const treffer = projects.filter((p) => gehoertZuProjekt(order, p));
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * Change orders that are not decided yet (pending or in_progress).
 * @param {Nachtrag[]|null|undefined} orders
 * @returns {Nachtrag[]}
 */
export function offeneNachtraege(orders) {
  if (!Array.isArray(orders)) return [];
  return orders.filter((o) => OFFENE_STATUS.includes(/** @type {string} */ (o?.status)));
}

/**
 * Count and sum per decision bucket.
 * - genehmigt: approved and completed (completed is only reachable from approved,
 *   so its amount stays part of the contract sum).
 * - offen: pending and in_progress.
 * - abgelehnt: rejected.
 * Unknown status values are left out. cost_impact null (not quantified) counts
 * as a change order with 0 €.
 * @param {Nachtrag[]|null|undefined} orders
 * @returns {{genehmigt: {anzahl: number, summe: number}, offen: {anzahl: number, summe: number}, abgelehnt: {anzahl: number, summe: number}}}
 *   anzahl = number of change orders, summe in euros
 */
export function nachtragsSummen(orders) {
  const summen = {
    genehmigt: { anzahl: 0, summe: 0 },
    offen: { anzahl: 0, summe: 0 },
    abgelehnt: { anzahl: 0, summe: 0 },
  };
  if (!Array.isArray(orders)) return summen;
  for (const o of orders) {
    const status = o?.status;
    const topf = status === 'approved' || status === 'completed' ? summen.genehmigt
      : status === 'pending' || status === 'in_progress' ? summen.offen
        : status === 'rejected' ? summen.abgelehnt
          : null;
    if (!topf) continue;
    const betrag = Number(o.cost_impact);
    topf.anzahl += 1;
    topf.summe += o.cost_impact == null || !Number.isFinite(betrag) ? 0 : betrag;
  }
  return summen;
}

/**
 * Whether a status transition is allowed (ERLAUBTE_UEBERGAENGE). Staying on the
 * same status is not a transition.
 * @param {unknown} alt current status
 * @param {unknown} neu target status
 * @returns {boolean}
 */
export function uebergangErlaubt(alt, neu) {
  if (!hatEigenen(ERLAUBTE_UEBERGAENGE, alt)) return false;
  const ziele = ERLAUBTE_UEBERGAENGE[/** @type {keyof typeof ERLAUBTE_UEBERGAENGE} */ (alt)];
  return typeof neu === 'string' && ziele.includes(neu);
}

/**
 * Whether a change order's fields may still be edited (BEARBEITBARE_STATUS).
 * @param {Nachtrag|null|undefined} order
 * @returns {boolean}
 */
export function bearbeitbar(order) {
  return BEARBEITBARE_STATUS.includes(/** @type {string} */ (order?.status));
}

/**
 * Project fields to write on an update: project_id and project_name of the
 * project — but only when the change order belongs to it. In the "all projects"
 * view the active project is not the order's project; writing it would move a
 * foreign change order.
 * @param {Nachtrag|null|undefined} order
 * @param {Projekt|null|undefined} project
 * @returns {{project_id?: string, project_name?: string}} empty object when nothing is to be written
 */
export function projektFelder(order, project) {
  if (!project || !gehoertZuProjekt(order, project)) return {};
  return project.name
    ? { project_id: project.id, project_name: project.name }
    : { project_id: project.id };
}

/**
 * Update patch for a status change, or null when the transition is not allowed.
 * Sets decided_date on approval and rejection and backfills project_id /
 * project_name (lazy backfill, see the data contract above).
 * @param {Nachtrag} order
 * @param {string} neu target status
 * @param {Projekt|null|undefined} project the order's project (see projektDesNachtrags)
 * @param {Date} [jetzt] decision time (default: now)
 * @returns {({status: string, decided_date?: string, project_id?: string, project_name?: string})|null}
 *   decided_date as ISO timestamp
 */
export function statusWechsel(order, neu, project, jetzt = new Date()) {
  if (!order || !uebergangErlaubt(order.status, neu)) return null;
  /** @type {{status: string, decided_date?: string, project_id?: string, project_name?: string}} */
  const patch = { status: neu, ...projektFelder(order, project) };
  if (neu === 'approved' || neu === 'rejected') patch.decided_date = jetzt.toISOString();
  return patch;
}

// --- From ticket to change order (N-14) -------------------------------------------

/** Router path of the Finance page that hosts the change order list and form. */
export const NACHTRAG_SEITE = '/Finance';

/** Query parameters that open the change order form; removed again after opening. */
export const NACHTRAG_PARAMETER = Object.freeze(['neu', 'ticket']);

// Upper bound for a ticket id taken from a link — same reasoning as MAX_LAENGE in
// @ifc/lib/ticketLink.js (core must not import from @ifc). [ASSUMED] 200 characters
// is far above any real id.
const MAX_ID_LAENGE = 200;

/**
 * Trimmed string or '' for anything empty or not a string/number.
 * @param {unknown} v
 * @returns {string}
 */
function textWert(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).trim();
}

/**
 * Whether a ticket may become a change order of this project: the ticket has no
 * project_id (legacy or manual record) or the same one. A ticket of another
 * project must not silently turn into a change order of the active one.
 * @param {{project_id?: string}|null|undefined} issue
 * @param {Projekt|null|undefined} project
 * @returns {boolean}
 */
export function ticketGehoertZuProjekt(issue, project) {
  if (!issue || !project || !project.id) return false;
  return !issue.project_id || issue.project_id === project.id;
}

/**
 * Prefill of a new change order from a ticket (Issue). The texts are stored data,
 * not UI chrome — German like the rest of the records, not translated.
 * - title: "Nachtrag: <ticket title>"
 * - description: "Aus Ticket „<title>“", the element's IFC GlobalId
 *   (element_guid || element_id, the reader side of the Issue contract in
 *   @ifc/lib/ticketLink.js) and the ticket description, one per paragraph.
 * - status 'pending', cost_impact null (not quantified yet — the amount comes from
 *   the offer, never from the ticket).
 * @param {{id?: string, title?: string, description?: string, element_guid?: string,
 *   element_id?: string, project_id?: string}|null|undefined} issue
 * @param {Projekt|null|undefined} project the active project; without one the
 *   ticket's project_id is kept and project_name stays null
 * @returns {({title: string, description: string, issue_id: string|null,
 *   project_id: string|null, project_name: string|null, status: string,
 *   cost_impact: null, ticket_titel: string})|null} null without a ticket.
 *   ticket_titel is display only (the form's reference line), not a record field.
 */
export function nachtragAusTicket(issue, project) {
  if (!issue) return null;
  const id = textWert(issue.id);
  const titel = textWert(issue.title) || (id ? `Ticket ${id}` : 'Ticket');
  const guid = textWert(issue.element_guid) || textWert(issue.element_id);
  const beschreibung = textWert(issue.description);
  const absaetze = [`Aus Ticket „${titel}“`];
  if (guid) absaetze.push(`Bauteil (IFC-GUID): ${guid}`);
  if (beschreibung) absaetze.push(beschreibung);
  return {
    title: `Nachtrag: ${titel}`,
    description: absaetze.join('\n\n'),
    issue_id: id || null,
    project_id: project?.id || textWert(issue.project_id) || null,
    project_name: project?.name || null,
    status: 'pending',
    cost_impact: null,
    ticket_titel: titel,
  };
}

/**
 * Link that opens the change order form on the Finance page, prefilled from a
 * ticket when an id is given.
 * @param {string|null} [ticketId] Issue id, e.g. "iss-1"
 * @returns {string} router path, e.g. "/Finance?neu=1&ticket=iss-1" or "/Finance?neu=1"
 */
export function neuerNachtragUrl(ticketId) {
  const id = textWert(ticketId).slice(0, MAX_ID_LAENGE);
  return id
    ? `${NACHTRAG_SEITE}?neu=1&ticket=${encodeURIComponent(id)}`
    : `${NACHTRAG_SEITE}?neu=1`;
}

/**
 * Reads the change order parameters of the current URL. Broken input never throws.
 * @param {URLSearchParams|string|null|undefined} searchParams URLSearchParams
 *   (e.g. from useSearchParams) or a query string with or without leading "?"
 * @returns {{neu: boolean, ticket: string|null}} ticket only counts together with neu=1
 */
export function leseNachtragParameter(searchParams) {
  let p = null;
  if (typeof searchParams === 'string') p = new URLSearchParams(searchParams);
  else if (searchParams && typeof searchParams.get === 'function') p = searchParams;
  const neu = !!p && textWert(p.get('neu')) === '1';
  const ticket = p ? textWert(p.get('ticket')).slice(0, MAX_ID_LAENGE) : '';
  return { neu, ticket: neu && ticket ? ticket : null };
}

/**
 * Copy of the query without the change order parameters (NACHTRAG_PARAMETER), so a
 * reload does not open the form a second time. Other parameters stay.
 * @param {URLSearchParams|string} searchParams
 * @returns {URLSearchParams} new instance; the input is not changed
 */
export function ohneNachtragParameter(searchParams) {
  const kopie = new URLSearchParams(searchParams);
  for (const k of NACHTRAG_PARAMETER) kopie.delete(k);
  return kopie;
}
