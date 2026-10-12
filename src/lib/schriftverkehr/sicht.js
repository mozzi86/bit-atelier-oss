// Visibility rules of the correspondence (phase 82, 82-05): which letters and
// register entries an access may see, which areas the editor offers, who may
// maintain templates. One place for the letter list, the register and the
// editor, testable with baueZugriff (82-01) — without 82-02 the page runs as
// owner (fallback of ZugriffContext, E-17).
//
// Areas (D-P82-32): projekt (only projects in the access's project view),
// buero (module schriftverkehr), buchhaltung (also module buchhaltung). There is
// no area personal in v1 (E-14).
//
// In:  records, a Zugriff. Out: sichtbar, sichtbareEintraege, bereicheFuer, darfVorlagenPflegen.

import { darf, darfProjekt } from "@core/lib/rechte.js";

/**
 * Whether an access may see a letter or register entry.
 * @param {{bereich?: string, project_id?: string|null}|null|undefined} eintrag
 * @param {import("@core/lib/rechte.js").Zugriff|null|undefined} zugriff
 * @returns {boolean}
 */
export function sichtbar(eintrag, zugriff) {
  if (!eintrag || !darf(zugriff, "schriftverkehr")) return false;
  const bereich = eintrag.bereich || "projekt";
  if (bereich === "buchhaltung") return darf(zugriff, "buchhaltung");
  if (bereich === "buero") return true;
  return darfProjekt(zugriff, eintrag.project_id || null);
}

/**
 * @template {{bereich?: string, project_id?: string|null}} T
 * @param {ReadonlyArray<T>} eintraege
 * @param {import("@core/lib/rechte.js").Zugriff|null|undefined} zugriff
 * @returns {T[]}
 */
export function sichtbareEintraege(eintraege, zugriff) {
  return (eintraege || []).filter((e) => sichtbar(e, zugriff));
}

/**
 * Areas the editor offers for a new letter (never 'personal', E-14).
 * @param {import("@core/lib/rechte.js").Zugriff|null|undefined} zugriff
 * @returns {Array<'projekt'|'buero'|'buchhaltung'>}
 */
export function bereicheFuer(zugriff) {
  if (!darf(zugriff, "schriftverkehr", "voll")) return [];
  /** @type {Array<'projekt'|'buero'|'buchhaltung'>} */
  const b = ["projekt", "buero"];
  if (darf(zugriff, "buchhaltung", "voll")) b.push("buchhaltung");
  return b;
}

/**
 * Templates are office settings: maintained only with full rights on the settings.
 * @param {import("@core/lib/rechte.js").Zugriff|null|undefined} zugriff
 * @returns {boolean}
 */
export function darfVorlagenPflegen(zugriff) {
  return darf(zugriff, "einstellungen", "voll");
}
