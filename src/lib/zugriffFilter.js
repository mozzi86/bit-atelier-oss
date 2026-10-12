// Access filters of the shell (phase 82, 82-02, RECHT-02/05): which menu
// entries the command palette offers, which "Weiter mit" targets stay, which
// rows of the export dialog a role may tick. Only applications of navSichtbar,
// darf and modulFuer — no second rights logic.
//
// Export rows: a row carries office data of ALL projects and persons, so it
// needs every module it touches at least at 'lesen' AND an unrestricted project
// view (projektIds null). "Zeiten & Aufträge" needs the approval sub-right,
// offers and controlling (otherwise an employee would take everybody's hours
// and the fee offers); "Schriftverkehr & Postbuch" also needs accounting
// (dunning letters). Unknown rows → owner only.
//
// In:  navigation entries, a Zugriff. Out: paletteEintraege, weiterMitFuer,
//      EXPORT_ZEILEN_MODULE, exportBereicheFuer.

import { darf } from "@core/lib/rechte.js";
import { navSichtbar } from "@/navigation.js";
import { modulFuer } from "@/huellenZustand.js";
import { naechsteSchritteFuer, zielPfad } from "@/naechsteSchritte.js";

/** Modules a row of the export registry needs (key → modules). */
export const EXPORT_ZEILEN_MODULE = Object.freeze({
  buchhaltung: Object.freeze(["buchhaltung"]),
  personal: Object.freeze(["personal"]),
  zeiten: Object.freeze(["zeiterfassung:freigabe", "auftrag", "controlling"]),
  fristen: Object.freeze(["fristen"]),
  schriftverkehr: Object.freeze(["schriftverkehr", "buchhaltung"]),
  rechte: Object.freeze(["rechte"]),
});

/**
 * Menu entries the palette may offer.
 * @template {{modul?: string}} E
 * @param {ReadonlyArray<E>} eintraege navFlach
 * @param {{personalZugang?: string, zugriff?: any}} kontext
 * @returns {E[]}
 */
export function paletteEintraege(eintraege, kontext) {
  return (eintraege || []).filter((e) => navSichtbar(/** @type {any} */ (e), kontext));
}

/**
 * "Weiter mit" steps of a page whose target module the access may read.
 * @param {string} pathname
 * @param {any} zugriff
 * @param {ReadonlyArray<any>} eintraege navFlach (target → module)
 * @returns {Array<import("@/naechsteSchritte.js").NaechsterSchritt>}
 */
export function weiterMitFuer(pathname, zugriff, eintraege) {
  return naechsteSchritteFuer(pathname).filter((s) => {
    const m = modulFuer(zielPfad(s.ziel), /** @type {any} */ (eintraege));
    return !m || !zugriff || darf(zugriff, m, "lesen");
  });
}

/**
 * Rows of the export registry the access may tick.
 * @template {{key: string}} R
 * @param {ReadonlyArray<R>} registry EXPORT_BEREICHE
 * @param {any} zugriff
 * @returns {R[]}
 */
export function exportBereicheFuer(registry, zugriff) {
  if (!zugriff) return [...(registry || [])];
  return (registry || []).filter((r) => {
    const module = /** @type {Record<string, ReadonlyArray<string>>} */ (EXPORT_ZEILEN_MODULE)[r.key];
    if (!module) return zugriff.rolle === "inhaber";
    return zugriff.projektIds === null && module.every((m) => darf(zugriff, m, "lesen"));
  });
}
