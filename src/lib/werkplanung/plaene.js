// plaene.js — plan management (Planverwaltung, 88-06, RE-17): plan number after
// the title-block scheme of 90-01, revision index with history, status lifecycle
// and the release that leaves an AuditLog entry.
//
// Data contract — entity `Plan` (schemaless, new):
//   {project_id, projekt_kurz, lph, gewerk, nr, titel, massstab ("1:100"),
//    format ("A0"…"A4" | "Sonder"), status, index ('' = first issue, then 'A', 'B' …),
//    indizes: [{index, datum (ISO date), aenderung}], freigabe: {von, am} | null,
//    datei_ref (Document id, via dokumentAblegen) | null, created_date}
// - nummer is DERIVED (planNummer), never stored as truth — so the scheme stays one
//   function (@pdf/lib/plankopf.js plannummer, D-SK-01).
// - status: 'in_arbeit' → 'vorabzug' → 'geprueft' → 'freigegeben' (forward only).
//   [ASSUMED] release only from 'geprueft' (four-eyes principle); a new index sets
//   the status back to 'in_arbeit' and clears freigabe (the old one stays in the
//   AuditLog and in indizes).
// - Index letters A…Z, then AA, AB … [ASSUMED office practice; DIN EN ISO 7200
//   requires a revision field, not a scheme]. '' = first issue, shown as "—".
//
// In:  Plan records, form values. Out: numbers, findings, patches, AuditLog records.
// Pure — no React, no API.

import { plannummer } from "@pdf/lib/plankopf";

/** Status keys in lifecycle order with German labels (labels double as i18n keys). */
export const PLAN_STATUS = Object.freeze([
  Object.freeze({ key: "in_arbeit", label: "In Arbeit" }),
  Object.freeze({ key: "vorabzug", label: "Vorabzug" }),
  Object.freeze({ key: "geprueft", label: "Geprüft" }),
  Object.freeze({ key: "freigegeben", label: "Freigegeben" }),
]);

/** Paper formats offered in the form (DIN EN ISO 216 A series + special). */
export const PLAN_FORMATE = Object.freeze(["A0", "A1", "A2", "A3", "A4", "Sonder"]);

/**
 * Allowed transitions, from → to (forward only; see header).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const PLAN_UEBERGAENGE = Object.freeze({
  in_arbeit: Object.freeze(["vorabzug", "geprueft"]),
  vorabzug: Object.freeze(["geprueft"]),
  geprueft: Object.freeze(["freigegeben"]),
  freigegeben: Object.freeze([]),
});

/**
 * @typedef {object} PlanRecord
 * @property {string} [id]
 * @property {string} [project_id]
 * @property {string} [projekt_kurz]
 * @property {string|number} [lph]
 * @property {string} [gewerk]
 * @property {string|number} [nr]
 * @property {string} [titel]
 * @property {string} [massstab]
 * @property {string} [format]
 * @property {string} [status]
 * @property {string} [index]
 * @property {Array<{index: string, datum: string, aenderung: string}>} [indizes]
 * @property {{von: string, am: string}|null} [freigabe]
 * @property {string|null} [datei_ref]
 */

/**
 * German label of a status.
 * @param {unknown} status
 * @returns {string}
 */
export function planStatusLabel(status) {
  return PLAN_STATUS.find((s) => s.key === status)?.label || String(status || "");
}

/**
 * Next revision index: '' → 'A', 'A' → 'B', 'Z' → 'AA', 'AZ' → 'BA'.
 * @param {string|null|undefined} index current index ('' = first issue)
 * @returns {string}
 */
export function naechsterIndex(index) {
  const s = String(index || "").trim().toUpperCase();
  if (!/^[A-Z]*$/.test(s)) throw new Error(`Index „${index}“ ist kein Buchstabenindex`);
  if (s === "") return "A";
  const z = s.split("");
  let i = z.length - 1;
  while (i >= 0) {
    if (z[i] !== "Z") { z[i] = String.fromCharCode(z[i].charCodeAt(0) + 1); return z.join(""); }
    z[i] = "A";
    i -= 1;
  }
  return "A" + z.join("");
}

/**
 * Plan number without and with index (scheme of @pdf/lib/plankopf.js).
 * @param {PlanRecord} p
 * @returns {{basis: string, voll: string}} e.g. {basis: "MUS-LP5-AR-012", voll: "MUS-LP5-AR-012-B"}
 */
export function planNummer(p) {
  const teile = { projektKurz: p?.projekt_kurz, lph: p?.lph, gewerk: p?.gewerk, nr: p?.nr };
  return { basis: plannummer(teile), voll: plannummer({ ...teile, index: p?.index || "" }) };
}

/**
 * Whether a status transition is allowed.
 * @param {unknown} alt
 * @param {unknown} neu
 * @returns {boolean}
 */
export function planUebergangErlaubt(alt, neu) {
  if (typeof alt !== "string" || !Object.prototype.hasOwnProperty.call(PLAN_UEBERGAENGE, alt)) return false;
  return typeof neu === "string" && PLAN_UEBERGAENGE[alt].includes(neu);
}

/**
 * Findings of one plan within its project list. All are hints/warnings, never
 * errors: a duplicate number may be intended (two sheets of one drawing during
 * renumbering) — the office decides; the list makes it visible.
 * @param {PlanRecord} p
 * @param {PlanRecord[]} alle all plans of the project (incl. p)
 * @returns {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>}
 */
export function planPruefung(p, alle = []) {
  /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} */
  const h = [];
  const { basis } = planNummer(p);
  if (!basis) h.push({ code: "nummer_fehlt", stufe: "warn", text: "Plannummer fehlt" });
  else if (alle.some((x) => x !== p && x.id !== p.id && planNummer(x).basis === basis)) {
    h.push({ code: "nummer_doppelt", stufe: "warn", text: "Plannummer im Projekt doppelt" });
  }
  // Scale as "1:n" (DIN ISO 5455 scales; any n accepted, the office may use 1:25).
  if (p.massstab && !/^1\s*:\s*\d+$/.test(String(p.massstab).trim())) {
    h.push({ code: "massstab", stufe: "hinweis", text: "Maßstab nicht im Format 1:n" });
  }
  if (!String(p.titel || "").trim()) h.push({ code: "titel_fehlt", stufe: "hinweis", text: "Planinhalt fehlt" });
  if (p.status === "freigegeben" && !p.datei_ref) {
    h.push({ code: "freigabe_ohne_datei", stufe: "hinweis", text: "Freigegeben ohne hinterlegte Plandatei" });
  }
  return h;
}

/**
 * Patch for a status change (not for the release — see freigabePatch).
 * @param {PlanRecord} p
 * @param {string} neu
 * @returns {{status: string}|null} null when not allowed or when neu is 'freigegeben'
 */
export function statusPatch(p, neu) {
  if (neu === "freigegeben" || !planUebergangErlaubt(p?.status, neu)) return null;
  return { status: neu };
}

/**
 * Patch for the release.
 * @param {PlanRecord} p
 * @param {string} von name of the releasing person (typed in; required)
 * @param {Date} [jetzt]
 * @returns {{status: 'freigegeben', freigabe: {von: string, am: string}}|null} am as ISO timestamp; null when not allowed
 */
export function freigabePatch(p, von, jetzt = new Date()) {
  const name = String(von || "").trim();
  if (!name || !planUebergangErlaubt(p?.status, "freigegeben")) return null;
  return { status: "freigegeben", freigabe: { von: name, am: jetzt.toISOString() } };
}

/**
 * Patch for a new revision index: next letter, history entry, status back to
 * 'in_arbeit', release cleared, file reference cleared (the old file belongs to
 * the old index).
 * @param {PlanRecord} p
 * @param {string} aenderung description of the change (required)
 * @param {Date} [jetzt]
 * @returns {{index: string, indizes: Array<{index: string, datum: string, aenderung: string}>, status: string, freigabe: null, datei_ref: null}|null}
 */
export function indexPatch(p, aenderung, jetzt = new Date()) {
  const text = String(aenderung || "").trim();
  if (!p || !text) return null;
  const index = naechsterIndex(p.index);
  return {
    index,
    indizes: [...(Array.isArray(p.indizes) ? p.indizes : []), { index, datum: jetzt.toISOString().slice(0, 10), aenderung: text }],
    status: "in_arbeit",
    freigabe: null,
    datei_ref: null,
  };
}

/**
 * AuditLog record for a release or an index change (append-only liability record,
 * same shape as useSiteSimulation's audit()).
 * @param {{projectId: string, plan: PlanRecord, aktion: 'freigabe'|'index', actor: string, detail?: string, jetzt?: Date}} a
 * @returns {{project_id: string, ts: string, actor: string, action: string, detail: string, unit_id: string|null, unit_name: string}}
 */
export function auditEintrag({ projectId, plan, aktion, actor, detail = "", jetzt = new Date() }) {
  const nr = planNummer(plan).voll || "(ohne Nummer)";
  return {
    project_id: projectId,
    ts: jetzt.toISOString(),
    actor: String(actor || "Bediener"),
    action: aktion === "freigabe" ? "Plan freigegeben" : "Planindex geändert",
    detail: `${nr}${plan.titel ? ` · ${plan.titel}` : ""}${detail ? ` · ${detail}` : ""}`,
    unit_id: plan.id || null,
    unit_name: nr,
  };
}

/**
 * New plan record from form values (status 'in_arbeit', first issue).
 * @param {Record<string, any>} w form values
 * @param {string} projectId
 * @returns {PlanRecord & {project_id: string}}
 */
export function neuerPlan(w, projectId) {
  return {
    project_id: projectId,
    projekt_kurz: String(w.projekt_kurz || "").trim(),
    lph: String(w.lph || "").trim(),
    gewerk: String(w.gewerk || "").trim(),
    nr: String(w.nr || "").trim(),
    titel: String(w.titel || "").trim(),
    massstab: String(w.massstab || "").trim(),
    format: PLAN_FORMATE.includes(w.format) ? w.format : "",
    status: "in_arbeit",
    index: "",
    indizes: [],
    freigabe: null,
    datei_ref: null,
  };
}
