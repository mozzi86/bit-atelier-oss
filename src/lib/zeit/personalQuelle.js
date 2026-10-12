// The ONE place that interprets phase-80 personnel data for time tracking and
// controlling (phase 81). Phase 80 owns persons, contracts, salaries and project
// assignments; 81 only reads them — and only through the adapter
// src/lib/people/zeitHonorarPersonal.js, which hands the lists in here. This
// module is pure: it never names the personnel storage (80-02 leak guard,
// tests/unit/personalLeck.test.js).
//
// E-17 (freelancer path = acceptance path): without a single personnel record
// the time tracking offers the virtual owner "inhaber" (shown as t("Inhaber/in"),
// the existing 79 key, never stored as a name). Once 80 has a record with
// art 'inhaber', personIdFuer maps the virtual id onto it (D-P81-36).
//
// In:  lists of Mitarbeiter (80 shape), a key date. Out: INHABER_ID,
//      personenFuerZeiterfassung, personIdFuer, aktiverVertrag/gehaltAm (80,
//      re-exported), zuordnungenFuer, istProjektleitung, personAnzeigeName.

export { aktiverVertrag, gehaltAm } from "@/lib/people/vertrag.js";

/** Id of the virtual owner (E-17); also the mitarbeiter_id of her bookings and cost rates. */
export const INHABER_ID = "inhaber";

/** The virtual owner as a person-like record (never stored). */
const VIRTUELLE_INHABERIN = Object.freeze({ id: INHABER_ID, art: "inhaber", virtuell: true });

/**
 * Whether a person counts as active on a day: status 'aktiv' (or 'onboarding'
 * once the entry date is reached) and not left before the day.
 * @param {Record<string, any>} m Mitarbeiter
 * @param {string} stichtagIso 'YYYY-MM-DD'
 * @returns {boolean}
 */
function istAktiv(m, stichtagIso) {
  if (!m) return false;
  const eingetreten = !m.eintritt || m.eintritt <= stichtagIso;
  const nochDa = !m.austritt || m.austritt >= stichtagIso;
  if (m.status === "aktiv") return nochDa;
  if (m.status === "onboarding") return eingetreten && nochDa;
  return false;
}

/**
 * Persons that can book time on a day: the active 80 records, owners first,
 * then by surname. Without an active record of art 'inhaber' the virtual owner
 * is put first (E-17) — so a sole proprietor without any personnel record can
 * book right away.
 * @param {ReadonlyArray<Record<string, any>>} mitarbeiter all Mitarbeiter records (may be empty)
 * @param {string} stichtagIso 'YYYY-MM-DD'
 * @returns {Array<Record<string, any>>}
 */
export function personenFuerZeiterfassung(mitarbeiter, stichtagIso) {
  const aktiv = (Array.isArray(mitarbeiter) ? mitarbeiter : []).filter((m) => istAktiv(m, stichtagIso));
  const sortiert = [...aktiv].sort((a, b) => {
    const ia = a.art === "inhaber" ? 0 : 1;
    const ib = b.art === "inhaber" ? 0 : 1;
    if (ia !== ib) return ia - ib;
    return `${a.nachname || ""} ${a.vorname || ""}`.localeCompare(`${b.nachname || ""} ${b.vorname || ""}`, "de");
  });
  if (sortiert.some((m) => m.art === "inhaber")) return sortiert;
  return [{ ...VIRTUELLE_INHABERIN }, ...sortiert];
}

/**
 * Maps the virtual owner id onto the real owner record once 80 has one
 * (D-P81-36); every other id is returned unchanged.
 * @param {string} mitarbeiterId
 * @param {ReadonlyArray<Record<string, any>>} mitarbeiter
 * @returns {string}
 */
export function personIdFuer(mitarbeiterId, mitarbeiter) {
  if (mitarbeiterId !== INHABER_ID) return mitarbeiterId;
  const echt = (Array.isArray(mitarbeiter) ? mitarbeiter : []).find((m) => m?.art === "inhaber" && m.status !== "ausgeschieden");
  return echt ? echt.id : INHABER_ID;
}

/**
 * True when an assignment's function names the project lead. 80 stores the
 * function as free text (ProjektZuordnung.jsx), so "Projektleitung",
 * "Projektleiter:in" and "PL Projektleitung" all count; case does not matter.
 * @param {{funktion?: string}|null|undefined} zuordnung
 * @returns {boolean}
 */
export function istProjektleitung(zuordnung) {
  return /projektleit/i.test(String(zuordnung?.funktion || ""));
}

/**
 * Project assignments of ONE person on a key date (Mitarbeiter.projekt_zuordnungen,
 * 80-04 — the only source, D-P81-20). An assignment counts when von ≤ key date
 * ≤ bis (empty von/bis = open). A person without any assignment counts for all
 * projects (`alle: true`, E-17) — never as "not assigned".
 * @param {Record<string, any>|null|undefined} person Mitarbeiter or the virtual owner
 * @param {{projectId?: string|null, stichtagIso: string}} filter projectId optional
 * @returns {{alle: boolean, zuordnungen: Array<{project_id: string, funktion?: string, anteil_prozent?: number, von?: string, bis?: string}>}}
 */
export function zuordnungenFuer(person, { projectId = null, stichtagIso }) {
  const liste = Array.isArray(person?.projekt_zuordnungen) ? person.projekt_zuordnungen : [];
  if (!liste.length) return { alle: true, zuordnungen: [] };
  const gueltig = liste.filter((z) => z && (!z.von || z.von <= stichtagIso) && (!z.bis || stichtagIso <= z.bis));
  return { alle: false, zuordnungen: projectId ? gueltig.filter((z) => z.project_id === projectId) : gueltig };
}

/**
 * Display name of a person: the virtual owner as the translated key
 * "Inhaber/in", otherwise "Vorname Nachname".
 * @param {Record<string, any>|null|undefined} person
 * @param {(s: string) => string} t translator of @core/lib/i18n
 * @returns {string}
 */
export function personAnzeigeName(person, t) {
  if (!person) return "";
  if (person.virtuell || person.id === INHABER_ID) return t("Inhaber/in");
  return [person.vorname, person.nachname].filter(Boolean).join(" ") || String(person.id);
}
