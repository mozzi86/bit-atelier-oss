// Export model of the time tracking (phase 81-02, ZEIT-04): the bookings of a
// filter as one table model of 79's table export (@core/lib/tabellenExport.js,
// re-exported by src/lib/accounting/tabellenExport.js). CSV and XLSX are written
// there — one model, two files that cannot disagree. Approved hours are
// receipts for time-based fees; the page names the retention period.
//
// In:  bookings, persons (80 shape or the virtual owner), projects, a filter and
//      the translator. Out: Tabellenmodell {titel, spalten, zeilen}; hours as a
//      number (1,5 h = 1.5 — the writer formats it), dates 'YYYY-MM-DD'.

import { INHABER_ID } from "./personalQuelle.js";
import { LEISTUNG_LABELS, KATEGORIE_INTERN_LABELS, ZEIT_STATUS_LABELS } from "./zeitbuchung.js";

/**
 * Bookings of a filter. Rejected bookings are only included when the status
 * filter names them explicitly (they are no hours to be paid).
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @param {{monat?: string|null, mitarbeiterId?: string|null, projectId?: string|null, status?: ReadonlyArray<string>|null}} [filter]
 *   monat 'YYYY-MM'; status: allowed statuses (empty/absent = all except 'abgelehnt')
 * @returns {Array<Record<string, any>>} sorted by date, then person
 */
export function gefilterteBuchungen(buchungen, { monat = null, mitarbeiterId = null, projectId = null, status = null } = {}) {
  const erlaubt = Array.isArray(status) && status.length ? new Set(status) : null;
  return (Array.isArray(buchungen) ? buchungen : [])
    .filter((b) => b
      && (!monat || String(b.datum || "").startsWith(monat))
      && (!mitarbeiterId || b.mitarbeiter_id === mitarbeiterId)
      && (!projectId || b.project_id === projectId)
      && (erlaubt ? erlaubt.has(b.status || "entwurf") : b.status !== "abgelehnt"))
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || String(a.mitarbeiter_id).localeCompare(String(b.mitarbeiter_id)));
}

/**
 * Initials or personnel number of a person for the column "Kürzel".
 * @param {Record<string, any>|undefined} person
 * @returns {string}
 */
function kuerzel(person) {
  if (!person) return "";
  if (person.personalnummer) return String(person.personalnummer);
  return `${String(person.vorname || "").slice(0, 1)}${String(person.nachname || "").slice(0, 1)}`.toUpperCase();
}

/**
 * Table model of the time bookings.
 * Columns: Datum, KW, Mitarbeiter, Kürzel, Projekt, LPH, Leistung, Stunden, Status, Notiz.
 * @param {ReadonlyArray<Record<string, any>>} buchungen all bookings
 * @param {{mitarbeiter?: ReadonlyArray<Record<string, any>>, projekte?: ReadonlyArray<Record<string, any>>,
 *   filter?: Parameters<typeof gefilterteBuchungen>[1]}} kontext
 * @param {(s: string) => string} t translator (labels are translated here)
 * @returns {import("@core/lib/tabellenExport.js").Tabellenmodell}
 */
export function zeitTabelle(buchungen, { mitarbeiter = [], projekte = [], filter = {} } = {}, t = (s) => s) {
  const personen = new Map((mitarbeiter || []).map((m) => [m.id, m]));
  const projektNamen = new Map((projekte || []).map((p) => [p.id, p.name]));
  const zeilen = gefilterteBuchungen(buchungen, filter).map((b) => {
    const person = personen.get(b.mitarbeiter_id);
    const name = b.mitarbeiter_id === INHABER_ID || person?.virtuell
      ? t("Inhaber/in")
      : [person?.vorname, person?.nachname].filter(Boolean).join(" ") || String(b.mitarbeiter_id);
    const leistung = b.project_id
      ? t(/** @type {Record<string, string>} */ (LEISTUNG_LABELS)[b.leistung] || "Grundleistung")
      : `${t("Bürozeit")}: ${t(/** @type {Record<string, string>} */ (KATEGORIE_INTERN_LABELS)[b.kategorie_intern] || "Sonstiges")}`;
    return {
      datum: b.datum,
      kw: b.kw || "",
      mitarbeiter: name,
      kuerzel: b.mitarbeiter_id === INHABER_ID ? "INH" : kuerzel(person),
      projekt: b.project_id ? projektNamen.get(b.project_id) || b.project_id : "",
      lph: b.lph ?? "",
      leistung,
      stunden: Math.round(((Number(b.minuten) || 0) / 60) * 100) / 100,
      status: t(/** @type {Record<string, string>} */ (ZEIT_STATUS_LABELS)[b.status || "entwurf"] || String(b.status)),
      notiz: b.notiz || "",
    };
  });
  return {
    titel: t("Stunden"),
    spalten: [
      { key: "datum", label: t("Datum"), typ: "datum" },
      { key: "kw", label: t("KW"), typ: "text" },
      { key: "mitarbeiter", label: t("Mitarbeiter:in"), typ: "text" },
      { key: "kuerzel", label: t("Kürzel"), typ: "text" },
      { key: "projekt", label: t("Projekt"), typ: "text" },
      { key: "lph", label: t("LPH"), typ: "zahl" },
      { key: "leistung", label: t("Leistung"), typ: "text" },
      { key: "stunden", label: t("Stunden"), typ: "zahl" },
      { key: "status", label: t("Status"), typ: "text" },
      { key: "notiz", label: t("Notiz"), typ: "text" },
    ],
    zeilen,
  };
}
