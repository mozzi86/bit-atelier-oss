// zugriffRegeln.js — the pure rules of the edge functions `einladung` and
// `freigabe` (Phase 74-01 Task 9). Plain JavaScript with JSDoc so the SAME
// file runs in Deno (imported by the functions) and in Node (unit tests,
// tests/unit/zugriffRegeln-7401.test.js) — no network, no Deno/Node API.
//
// What lives here: role words, the flags an external role gets (fixed by the
// role, NEVER taken from a request parameter), request validation, and the
// object path of a released file (built from the record, never from the
// request).
//
// In:  request bodies, membership/record rows. Out: verdicts and paths.

/** Internal roles after migration 0006. */
export const ROLLEN_INTERN = Object.freeze(['owner', 'planner', 'leser']);
/** External roles after migration 0006 — the only ones an invitation may grant. */
export const ROLLEN_EXTERN = Object.freeze(['bidder', 'investor', 'gast']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same id whitelist as the blob ids (packages/nova-core/server/blobs.js).
const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Stage-1 words → 0006 words; unknown → 'gast' (fail-shut).
 * @param {unknown} rolle
 * @returns {string}
 */
export function rolleNormalisieren(rolle) {
  const r = typeof rolle === 'string' ? rolle.trim() : '';
  if (r === 'admin') return 'owner';
  if (r === 'mitglied') return 'planner';
  return ROLLEN_INTERN.includes(r) || ROLLEN_EXTERN.includes(r) ? r : 'gast';
}

/**
 * The membership columns an invitation writes for an external role. Fixed by
 * the role: internal rights are always false (0006 check constraint), and
 * submitting is for bidder/investor only.
 * @param {string} rolle one of ROLLEN_EXTERN
 * @returns {{ role: string, stufe: string, can_edit_model: boolean, can_export_ifc: boolean,
 *   can_view_audit_reports: boolean, can_submit_bid: boolean }}
 * @throws {Error} for an internal or unknown role
 */
export function mitgliedschaftFuerExterne(rolle) {
  if (!ROLLEN_EXTERN.includes(rolle)) throw new Error(`Keine externe Rolle: ${rolle}`);
  return {
    role: rolle,
    stufe: 'free',
    can_edit_model: false,
    can_export_ifc: false,
    can_view_audit_reports: false,
    can_submit_bid: rolle === 'bidder' || rolle === 'investor',
  };
}

/**
 * Validates the body of `einladung`.
 * aktion 'einladen': org_id, email, rolle (external), projekt_id; optional
 * vergabe_id, kontakt_id, gueltig_bis (ISO date).
 * aktion 'widerruf': org_id, email; optional projekt_id/vergabe_id to revoke
 * only that access (without: everything of this person in the org).
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, daten: Record<string, any> } | { ok: false, fehler: string }}
 */
export function einladungPruefen(body) {
  const b = body || {};
  const aktion = String(b.aktion || '');
  if (aktion !== 'einladen' && aktion !== 'widerruf') return { ok: false, fehler: `Unbekannte Aktion: ${aktion || '(leer)'}` };
  const orgId = String(b.org_id || '');
  if (!UUID.test(orgId)) return { ok: false, fehler: 'org_id fehlt oder ist keine UUID.' };
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, fehler: 'email fehlt oder ist ungültig.' };
  const projektId = b.projekt_id == null || b.projekt_id === '' ? null : String(b.projekt_id);
  const vergabeId = b.vergabe_id == null || b.vergabe_id === '' ? null : String(b.vergabe_id);
  if (projektId !== null && !ID.test(projektId)) return { ok: false, fehler: 'projekt_id ist ungültig.' };
  if (vergabeId !== null && !ID.test(vergabeId)) return { ok: false, fehler: 'vergabe_id ist ungültig.' };
  if (aktion === 'widerruf') return { ok: true, daten: { aktion, orgId, email, projektId, vergabeId } };

  const rolle = String(b.rolle || '');
  if (!ROLLEN_EXTERN.includes(rolle)) {
    return { ok: false, fehler: 'rolle muss bidder, investor oder gast sein — interne Rollen vergibt nur das Freischalt-Skript.' };
  }
  if (!projektId) return { ok: false, fehler: 'projekt_id fehlt — eine Einladung gilt immer für ein Projekt.' };
  if (rolle === 'bidder' && !vergabeId) return { ok: false, fehler: 'vergabe_id fehlt — ein Bieter wird zu einer Vergabe eingeladen.' };
  const kontaktId = b.kontakt_id == null || b.kontakt_id === '' ? null : String(b.kontakt_id);
  if (kontaktId !== null && !ID.test(kontaktId)) return { ok: false, fehler: 'kontakt_id ist ungültig.' };
  let gueltigBis = null;
  if (b.gueltig_bis) {
    const t = Date.parse(String(b.gueltig_bis));
    if (!Number.isFinite(t)) return { ok: false, fehler: 'gueltig_bis ist kein Datum.' };
    gueltigBis = new Date(t).toISOString();
  }
  return { ok: true, daten: { aktion, orgId, email, rolle, projektId, vergabeId, kontaktId, gueltigBis } };
}

/**
 * May an existing membership be turned into the requested external one?
 * Never for an internal member (the sets stay disjoint; a planner invited as
 * bidder would otherwise lose or mix rights), always for no membership or an
 * external one.
 * @param {{ role?: string } | null} bestehend existing org_members row or null
 * @returns {{ ok: boolean, grund?: string }}
 */
export function einladungErlaubt(bestehend) {
  if (!bestehend) return { ok: true };
  const rolle = rolleNormalisieren(bestehend.role);
  if (ROLLEN_INTERN.includes(rolle)) {
    return { ok: false, grund: 'Diese Person ist bereits internes Mitglied des Büros — keine externe Einladung möglich.' };
  }
  return { ok: true };
}

/** @param {string} datei @returns {boolean} true for IFC originals (.ifc / .ifczip) */
export function istIfcDatei(datei) {
  return /\.ifc(zip)?$/i.test(String(datei || ''));
}

/**
 * Object path of a released file in bucket `freigaben`, built ONLY from the
 * record — never from the request (A-32: the neighbour file with the same stem
 * must not be reachable by a crafted name).
 * @param {{ org_id?: string, projekt_id?: string|null, vergabe_id?: string|null,
 *   data?: { datei?: string, project_id?: string, tender_id?: string } }} zeile ModellFreigabe row
 * @returns {string|null} '<org>/<projekt>/<vergabe|_allgemein>/<datei>' or null when not buildable
 */
export function freigabePfad(zeile) {
  const org = String(zeile?.org_id || '');
  const projekt = String(zeile?.projekt_id || zeile?.data?.project_id || '');
  const vergabe = String(zeile?.vergabe_id || zeile?.data?.tender_id || '') || '_allgemein';
  const datei = String(zeile?.data?.datei || '');
  if (!UUID.test(org) || !ID.test(projekt) || !(vergabe === '_allgemein' || ID.test(vergabe))) return null;
  if (!datei || /[\\/]/.test(datei) || datei.startsWith('.') || datei.length > 200) return null;
  return `${org}/${projekt}/${vergabe}/${datei}`;
}

/**
 * Which roles may run which action of the `llm` function (74-01 Task 9).
 * Managing and testing connections touches the office's stored API keys:
 * owner only. Calling the model: internal roles only — an invited bidder must
 * not spend the office's key, and must never reach `test`, which used to send
 * the stored key to a base_url from the request (closed in c8442fb).
 * @param {string} aktion e.g. 'invoke', 'connections.list'
 * @param {unknown} rolle role as stored (old or new vocabulary)
 * @returns {boolean}
 */
export function llmAktionErlaubt(aktion, rolle) {
  const r = rolleNormalisieren(rolle);
  if (aktion === 'test' || String(aktion).startsWith('connections.')) return r === 'owner';
  if (aktion === 'invoke' || aktion === 'defaults') return ROLLEN_INTERN.includes(r);
  return false;
}
