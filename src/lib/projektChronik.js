// projektChronik.js — the project file "what happened" (72-07, register no. 53): one
// timeline from records that exist anyway. Nothing is logged anew.
//
// Sources and what a line shows (never a person's name — actor/author fields are
// left out on purpose, the chronicle is shown to every role that sees the project):
//   AuditLog      → 'aenderung'  action + unit name (plan releases, site actions);
//   PruefLauf     → 'prueflauf'  model + number of findings (69-20);
//   Document      → 'dokument'   file name, only what sichtbareDokumente lets through (82-02);
//   ModelVersion  → 'modell'     saved project state "v{n}" + message;
//   Schreiben     → 'brief'      subject of a frozen/sent letter, only with right "schriftverkehr".
//
// In:  record lists of one project, the access of 82-02 (optional). Out: CHRONIK_ARTEN, chronik.

import { darf, sichtbareDokumente } from "@core/lib/rechte.js";

/** Kinds of a chronicle line (German label = i18n key) and the page a line leads to. */
export const CHRONIK_ARTEN = Object.freeze({
  aenderung: Object.freeze({ label: "Änderung", ziel: null }),
  prueflauf: Object.freeze({ label: "Prüflauf", ziel: "/ModelCheck" }),
  dokument: Object.freeze({ label: "Dokument", ziel: "/Reports" }),
  modell: Object.freeze({ label: "Projektstand", ziel: "/ModelVersions" }),
  brief: Object.freeze({ label: "Brief", ziel: "/Correspondence" }),
});

/**
 * One line of the chronicle.
 * @typedef {{id: string, datum: string, art: keyof typeof CHRONIK_ARTEN, titel: string, info: string, ziel: string|null}} ChronikZeile
 *   datum ISO timestamp or day; titel/info are record data (not translated); ziel in-app link
 */

/** @param {...unknown} werte @returns {string} first non-empty date string */
const ersterTag = (...werte) => /** @type {string} */ (werte.find((w) => typeof w === "string" && w.length >= 10) || "");

/**
 * Builds the chronicle of one project, newest first.
 * @param {{auditLog?: any[], prueflaeufe?: any[], dokumente?: any[], modelle?: any[], schreiben?: any[]}} quellen
 * @param {{zugriff?: any}} [opt] zugriff of 82-02; without it nothing is filtered (tests, no rights layer)
 * @returns {ChronikZeile[]}
 */
export function chronik(quellen, { zugriff = null } = {}) {
  /** @type {ChronikZeile[]} */
  const zeilen = [];
  for (const a of quellen?.auditLog || []) {
    const datum = ersterTag(a?.ts, a?.created_date);
    if (!datum) continue;
    zeilen.push({ id: `audit:${a.id}`, datum, art: "aenderung", titel: String(a.action || ""), info: String(a.unit_name || ""), ziel: /plan/i.test(String(a.action || "")) ? "/Werkplanung" : null });
  }
  for (const l of quellen?.prueflaeufe || []) {
    const datum = ersterTag(l?.datum, l?.created_date);
    if (!datum) continue;
    const anzahl = Number.isFinite(Number(l?.anzahl)) ? Number(l.anzahl) : (Array.isArray(l?.befunde) ? l.befunde.length : null);
    zeilen.push({ id: `lauf:${l.id}`, datum, art: "prueflauf", titel: String(l.modell || ""), info: anzahl === null ? "" : String(anzahl), ziel: CHRONIK_ARTEN.prueflauf.ziel });
  }
  const dokumente = zugriff ? sichtbareDokumente(quellen?.dokumente || [], zugriff) : (quellen?.dokumente || []);
  for (const d of dokumente) {
    const datum = ersterTag(d?.created_date);
    if (!datum) continue;
    zeilen.push({ id: `dok:${d.id}`, datum, art: "dokument", titel: String(d.name || ""), info: String(d.type || ""), ziel: CHRONIK_ARTEN.dokument.ziel });
  }
  for (const m of quellen?.modelle || []) {
    const datum = ersterTag(m?.created_date);
    if (!datum) continue;
    zeilen.push({ id: `stand:${m.id}`, datum, art: "modell", titel: m.version ? `v${m.version}` : "", info: String(m.message || ""), ziel: CHRONIK_ARTEN.modell.ziel });
  }
  if (!zugriff || darf(zugriff, "schriftverkehr")) {
    for (const s of quellen?.schreiben || []) {
      if (s?.status !== "festgeschrieben" && s?.status !== "versendet") continue;
      const datum = ersterTag(s.versendet_am, s.festgeschrieben_am);
      if (!datum) continue;
      zeilen.push({ id: `brief:${s.id}`, datum, art: "brief", titel: String(s.betreff || ""), info: String(s.status), ziel: CHRONIK_ARTEN.brief.ziel });
    }
  }
  return zeilen.sort((a, b) => b.datum.localeCompare(a.datum) || a.id.localeCompare(b.id));
}
