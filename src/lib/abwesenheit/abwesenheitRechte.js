// Who sees and decides which absences (phase 82, 82-04). Pure, on the access of
// 82-02 and the narrow assignment projection (no names, no other personnel fields).
//
// - team calendar: owner/bookkeeping (project view "alle") everybody; a project
//   lead the persons of her projects; an employee the team and herself — all
//   WITHOUT reasons (the raster never reads the kind);
// - request list and balance: with personnel rights all, otherwise the own
//   entries, a project lead additionally the requests of the persons she decides;
// - deciding: with full absence rights and personnel rights (owner, bookkeeping),
//   or as project lead for persons of projects where she is "Projektleitung"
//   (81 istProjektleitung). Nobody decides her own request except the owner.
//
// In:  persons, absences, Zugriff, assignments. Out: sichtbarePersonen,
//      entscheidbarePersonen, sichtbareAntraege, darfEntscheiden.

import { darf } from "@core/lib/rechte.js";

/**
 * @typedef {{mitarbeiter_id: string, alle: boolean, zuordnungen: ReadonlyArray<{project_id: string, funktion?: string|null}>}} Zuordnung
 */

/** @param {ReadonlyArray<Zuordnung>} z @param {string} id @returns {Zuordnung|undefined} */
const zuordnungVon = (z, id) => (z || []).find((x) => x?.mitarbeiter_id === id);

/**
 * Persons of the team calendar.
 * @template {{id: string}} P
 * @param {ReadonlyArray<P>} personen
 * @param {any} zugriff
 * @param {ReadonlyArray<Zuordnung>} zuordnungen
 * @returns {P[]}
 */
export function sichtbarePersonen(personen, zugriff, zuordnungen) {
  if (!zugriff || zugriff.projektIds === null || zugriff.projektIds === undefined || zugriff.rolle === "mitarbeiter") return [...(personen || [])];
  return (personen || []).filter((p) => {
    if (p.id === zugriff.mitarbeiterId) return true;
    const z = zuordnungVon(zuordnungen, p.id);
    return !z || z.alle || z.zuordnungen.some((x) => zugriff.projektIds.has(x.project_id));
  });
}

/**
 * Persons a project lead decides for: assigned to a project where she is "Projektleitung".
 * @param {any} zugriff
 * @param {ReadonlyArray<Zuordnung>} zuordnungen
 * @returns {Set<string>}
 */
export function entscheidbarePersonen(zugriff, zuordnungen) {
  const eigene = zuordnungVon(zuordnungen, zugriff?.mitarbeiterId || "");
  const projekte = new Set((eigene?.zuordnungen || []).filter((x) => String(x.funktion || "").toLowerCase() === "projektleitung").map((x) => x.project_id));
  const aus = new Set();
  for (const z of zuordnungen || []) {
    if (z.mitarbeiter_id === zugriff?.mitarbeiterId) continue;
    if (z.zuordnungen.some((x) => projekte.has(x.project_id))) aus.add(z.mitarbeiter_id);
  }
  return aus;
}

/**
 * Whether the access decides (approve/reject) an absence.
 * @param {any} zugriff
 * @param {Record<string, any>} abwesenheit
 * @param {ReadonlyArray<Zuordnung>} zuordnungen
 * @returns {boolean}
 */
export function darfEntscheiden(zugriff, abwesenheit, zuordnungen) {
  if (!darf(zugriff, "abwesenheiten", "voll")) return false;
  const eigen = Boolean(zugriff?.mitarbeiterId) && abwesenheit?.mitarbeiter_id === zugriff.mitarbeiterId;
  if (zugriff?.rolle === "inhaber") return true;
  if (eigen) return false;
  if (darf(zugriff, "personal", "voll")) return true;
  return zugriff?.rolle === "projektleitung" && entscheidbarePersonen(zugriff, zuordnungen).has(abwesenheit?.mitarbeiter_id);
}

/**
 * Requests and entries the request list shows.
 * @template {{mitarbeiter_id?: string}} A
 * @param {ReadonlyArray<A>} abwesenheiten
 * @param {any} zugriff
 * @param {ReadonlyArray<Zuordnung>} zuordnungen
 * @returns {A[]}
 */
export function sichtbareAntraege(abwesenheiten, zugriff, zuordnungen) {
  if (!zugriff || darf(zugriff, "personal")) return [...(abwesenheiten || [])];
  const entscheidbar = zugriff.rolle === "projektleitung" ? entscheidbarePersonen(zugriff, zuordnungen) : new Set();
  return (abwesenheiten || []).filter((a) => (zugriff.mitarbeiterId && a.mitarbeiter_id === zugriff.mitarbeiterId) || entscheidbar.has(/** @type {string} */ (a.mitarbeiter_id)));
}
