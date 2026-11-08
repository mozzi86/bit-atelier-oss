// Kennzahlen je Projekttyp (72-01 A-5, Befund N-05).
//
// Warum: das Massing-Studio zeigte für JEDES Projekt „Wohneinheiten" — bei
// einem Gewerbe-Projekt sind das falsche Zahlen im Produkt-Kern. Die
// Ableitung ist hier EINE pure Funktion (node-testbar), die Anzeigekomponente
// rendert nur.
//
// In:  projektTyp (Project.type-Key) + { nuf, bgf } in m².
// Out: KPI-Einträge { key, label, value, sub, icon } — Reihenfolge = Anzeige.
//
// Alle Richtwerte sind [ASSUMED] ohne Normbezug (Review §3 A-5, 18.09.2026):
// - Wohnen:      Wohneinheiten = NUF / 75 m²   [ASSUMED] m² NUF je WE
//                Stellplätze    = WE × 1,0      [ASSUMED] Schlüssel (Stellplatzschlüssel)
// - Gewerbe:     Arbeitsplätze  = NUF / 12 m²   [ASSUMED] m² NUF je Arbeitsplatz
//                Stellplätze    = BGF / 40 m²   [ASSUMED] m² BGF je Stellplatz
// - Öffentlich/Rest: wie Gewerbe (kein WE-Eintrag).
//
// 108-12 (finding 15a): the dwellings and parking spaces come from the USE of the project before the NUF estimate (optional third
// argument `nutzung`; without it every value is exactly as before):
//   Wohneinheiten: 1. by hand (BuildingComplex.kennzahlen_hand.wohneinheiten), 2. unit mix of the site planning (sum of
//                  unit_types[].count, the list BuildingConfig edits), 3. workshop typology "efh" → 1, 4. NUF / 75 m² [ASSUMED].
//   Stellplätze:   1. by hand, 2. WE × parking key of the site planning (parking.parking_key — rounded up like the "Stellplatz-Soll" of
//                  BuildingConfig), 3. single-family house: WE × 2 [ASSUMED], 4. WE × 1,0 [ASSUMED].
// 108-12 review:
//   - the planning key counts only when it was SET (parking_key_gesetzt, written by BuildingConfig when the key is typed in) or differs
//     from the start value 1.0 every new design record carries (komplexStart) — an untouched default is no planning decision; and only
//     when the dwellings are known (unit mix, hand value, single-family house), else the estimate stays as before;
//   - single-family house (EFH) = workshop typology "efh" or a unit mix of exactly one dwelling (a residential building with one
//     dwelling), not in a mixed-use project;
//   - a project WITHOUT a type (Project.type empty) takes the residential branch when its use says so (unit mix or typology "efh");
//     an explicit non-residential type keeps the commercial branch.

import { din277Flaechen } from "@core/lib/bauteil/raeume.js";

/**
 * [ASSUMED] Share of NUF in the BGF of a storey without zones, unit 1. The old flat value (programMetrics.ngf, MassingStudio); since
 * 107-11 it is only the fallback for storeys that have no zones. Way to a proven value: zones on every storey (then it is not used).
 */
export const NUF_PAUSCHAL_ANTEIL = 0.8;

/**
 * 107-11 (BK-54): NUF of the density figures, m². Per storey above ground: a storey WITH zones takes the DIN 277 NUF of its row
 * (raeume.js din277Flaechen — KGF from the workshop shell `rohbau` of that storey, or else from the hull walls `waende`); a storey
 * WITHOUT zones keeps BGF × NUF_PAUSCHAL_ANTEIL as before. Without any zone or footprint the whole result is bgf × NUF_PAUSCHAL_ANTEIL.
 * The sum is clamped to [0, bgf] (the BGF tile shown next to it). Basements do not count here (programMetrics stays above ground).
 * @param {{ bgf: number, zonen?: Array<any>, footprint?: Array<{x: number, z: number}>|null, storeys?: number,
 *   rohbau?: Array<{level: number, rohbau_m2: number, aussenwand_m2: number, innenwand_m2: number}>|null, waende?: Array<any>|null }} e
 *   bgf: gross floor area above ground in m² (the KPI tile value; also the fallback); zonen: store zones (points in m); footprint: the
 *   SAME footprint the bgf comes from, in m; storeys: number of storeys above ground; rohbau: workshop shell per level in m²
 *   (werkstattBauteile); waende: hull walls as entries {schluessel, wand} (createBuildingModel walls) — used only on storeys without a
 *   `rohbau` row, so the workshop outer walls are never counted twice
 * @returns {{ nuf: number, quelle: "din277"|"gemischt"|"pauschal" }} NUF in m²; "gemischt" = some storeys from zones, some flat
 */
export function nufFuerKennzahlen({ bgf, zonen = [], footprint = null, storeys = 1, rohbau = null, waende = null }) {
  const B = Math.max(0, Number(bgf) || 0);
  const mitFlaeche = (Array.isArray(zonen) ? zonen : []).filter((z) => Array.isArray(z?.points) && z.points.length >= 3 && z.raumart !== "balkon" && Math.round(Number(z.level) || 0) >= 0);
  if (!mitFlaeche.length || !Array.isArray(footprint) || footprint.length < 3) return { nuf: B * NUF_PAUSCHAL_ANTEIL, quelle: "pauschal" };
  const mitRohbau = new Set((Array.isArray(rohbau) ? rohbau : []).map((r) => Math.round(Number(r.level) || 0)));
  const huelle = (Array.isArray(waende) ? waende : []).filter((e) => !mitRohbau.has(Math.round(Number((e?.wand ?? e)?.level) || 0)));
  const d = din277Flaechen({ zonen: mitFlaeche, footprint, storeys: Math.max(1, Math.round(Number(storeys) || 1)), rohbau, waende: huelle });
  const zeilen = d.geschosse.filter((g) => g.level >= 0);
  const nuf = zeilen.reduce((s, g) => s + (g.quelle === "zonen" ? g.nuf : g.bgf * NUF_PAUSCHAL_ANTEIL), 0);
  const alle = zeilen.every((g) => g.quelle === "zonen");
  return { nuf: Math.min(B, Math.max(0, nuf)), quelle: alle ? "din277" : "gemischt" };
}

/** [ASSUMED] m² NUF je Wohneinheit — Einheit: m²/WE. */
export const NUF_JE_WOHNUNG_M2 = 75;
/** [ASSUMED] Stellplatz-Schlüssel Wohnen — Einheit: Stellplätze je WE. */
export const STELLPLATZ_SCHLUESSEL_WOHNEN = 1.0;
/**
 * [ASSUMED] parking spaces per single-family house (EFH), unit: spaces per dwelling. Common requirement of municipal parking statutes
 * (many Bavarian Stellplatzsatzungen ask 2 per single-family house); no norm value — way to a proven value: the parking statute of the
 * project site (enter it as parking key in the site planning, which then wins).
 */
export const STELLPLATZ_SCHLUESSEL_EFH = 2;
/**
 * Start value of the parking key of a new design record (ComplexDesigner komplexStart, BuildingConfig fallback), spaces per dwelling.
 * 108-12 review: a key equal to it without `parking_key_gesetzt` counts as "not entered" (no planning decision).
 */
export const PARKING_KEY_STARTWERT = 1.0;
/** [ASSUMED] m² NUF je Arbeitsplatz (Gewerbe/Öffentlich) — Einheit: m²/AP. */
export const NUF_JE_ARBEITSPLATZ_M2 = 12;
/** [ASSUMED] m² BGF je Stellplatz (Gewerbe/Öffentlich) — Einheit: m²/Stpl. */
export const BGF_JE_STELLPLATZ_M2 = 40;

/** Projekttypen mit Wohn-Kennzahlen (Rest bekommt Arbeitsplätze). */
const WOHN_TYPEN = new Set(["residential", "mixed_use"]);

/**
 * @typedef {object} Nutzung 108-12: what the project says about its use (all optional; missing = not known)
 * @property {Array<{count?: unknown}>|null} [wohnungsmix] unit mix of the site planning (BuildingComplex.unit_types)
 * @property {{parking_key?: unknown, total_spaces?: unknown, parking_key_gesetzt?: unknown}|null} [stellplatzPlanung] parking of the site
 *   planning (BuildingComplex.parking; parking_key in spaces per dwelling, total_spaces = spaces planned, parking_key_gesetzt = true once
 *   the key was typed in)
 * @property {string|null} [werkstattTyp] typology of the dwelling workshop (werkstatt_layer.typ, e.g. "efh")
 * @property {{wohneinheiten?: unknown, stellplaetze?: unknown}|null} [hand] values typed in by hand (BuildingComplex.kennzahlen_hand;
 *   null/empty = automatic)
 */

/**
 * 108-12: a count typed in by hand, or null (empty, negative or not a number = automatic). Integers 0 … 9999.
 * @param {unknown} v stored value
 * @returns {number|null}
 */
export function handZahl(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(9999, Math.round(n));
}

/**
 * 108-12: number of dwellings of the unit mix (sum of `count`), 0 without a mix.
 * @param {unknown} mix BuildingComplex.unit_types
 * @returns {number} dwellings (integer ≥ 0)
 */
export function wohnungsmixAnzahl(mix) {
  if (!Array.isArray(mix)) return 0;
  return mix.reduce((s, u) => s + Math.max(0, Math.round(Number(u?.count) || 0)), 0);
}

/**
 * Dichte-Kennzahlen je Projekttyp.
 * @param {string|null|undefined} projektTyp Project.type-Key ("residential",
 *   "commercial", "institutional", …); null/unbekannt → Gewerbe-Logik (108-12 review: null/empty WITH a unit mix or the workshop
 *   typology "efh" → Wohnen)
 * @param {{ nuf: number, bgf: number }} flachen Nutzfläche und Brutto-
 *   Grundfläche, beide in m²
 * @param {Nutzung|null} [nutzung] 108-12: use of the project (unit mix, parking, workshop typology, hand values); null = as before
 * @returns {Array<{ key: string, label: string, value: number, sub: string, icon: 'home'|'car'|'users',
 *   quelle?: "hand"|"wohnungsmix"|"efh"|"planung"|"schaetzung", schluessel?: number, geplant?: number|null }>}
 *   KPI-Einträge in Anzeigereihenfolge; `value` ganzzahlig (gerundet). 108-12: `quelle` = where the value comes from ("schaetzung" =
 *   the [ASSUMED] estimate of before), `schluessel` = parking key used (spaces per dwelling), `geplant` = spaces planned in the site
 *   planning (null = none)
 */
export function kennzahlenJeTyp(projektTyp, { nuf, bgf }, nutzung = null) {
  const safeNuf = Number.isFinite(nuf) ? Math.max(0, nuf) : 0;
  const safeBgf = Number.isFinite(bgf) ? Math.max(0, bgf) : 0;
  const hand = nutzung?.hand ?? null;
  const handWe = handZahl(hand?.wohneinheiten);
  const handStpl = handZahl(hand?.stellplaetze);
  const geplantRoh = Number(nutzung?.stellplatzPlanung?.total_spaces);
  const geplant = Number.isFinite(geplantRoh) && geplantRoh > 0 ? Math.round(geplantRoh) : null;
  const mix = wohnungsmixAnzahl(nutzung?.wohnungsmix);
  const efhTyp = nutzung?.werkstattTyp === "efh";
  const ohneTyp = projektTyp == null || projektTyp === "";
  if (WOHN_TYPEN.has(projektTyp) || (ohneTyp && (mix > 0 || efhTyp))) {
    // EFH = a residential building with ONE dwelling: workshop typology or a unit mix of one (not inside a mixed-use project)
    const efh = efhTyp || (mix === 1 && projektTyp !== "mixed_use");
    /** @type {"hand"|"wohnungsmix"|"efh"|"schaetzung"} */
    const weQuelle = handWe != null ? "hand" : mix > 0 ? "wohnungsmix" : efhTyp ? "efh" : "schaetzung";
    const wohneinheiten = weQuelle === "hand" ? /** @type {number} */ (handWe)
      : weQuelle === "wohnungsmix" ? mix
        : weQuelle === "efh" ? 1
          : Math.max(0, Math.round(safeNuf / NUF_JE_WOHNUNG_M2));
    const planung = nutzung?.stellplatzPlanung ?? null;
    const planKey = Number(planung?.parking_key);
    const keyGesetzt = Number.isFinite(planKey) && planKey > 0
      && (planung?.parking_key_gesetzt === true || Math.abs(planKey - PARKING_KEY_STARTWERT) > 1e-9);
    /** @type {"planung"|"efh"|"schaetzung"} */
    const keyQuelle = keyGesetzt && (mix > 0 || handWe != null || efh) ? "planung" : efh ? "efh" : "schaetzung";
    const schluessel = keyQuelle === "planung" ? planKey : keyQuelle === "efh" ? STELLPLATZ_SCHLUESSEL_EFH : STELLPLATZ_SCHLUESSEL_WOHNEN;
    // the site planning rounds the requirement up (BuildingConfig "Stellplatz-Soll"); the estimate keeps its old rounding
    const soll = keyQuelle === "planung" ? Math.ceil(wohneinheiten * schluessel - 1e-9) : Math.round(wohneinheiten * schluessel);
    return [
      {
        key: "wohneinheiten",
        label: "Wohneinheiten",
        value: wohneinheiten,
        sub: `Ø ${NUF_JE_WOHNUNG_M2} m² NUF [ASSUMED]`,
        icon: "home",
        quelle: weQuelle,
      },
      {
        key: "stellplaetze",
        label: "Stellplätze",
        value: handStpl != null ? handStpl : soll,
        sub: `Schlüssel ${STELLPLATZ_SCHLUESSEL_WOHNEN.toFixed(1)} [ASSUMED]`,
        icon: "car",
        quelle: handStpl != null ? "hand" : keyQuelle,
        schluessel,
        geplant,
      },
    ];
  }
  // Gewerbe, Öffentlich, Unbekannt: Arbeitsplätze + BGF-Stellplatzschlüssel.
  return [
    {
      key: "arbeitsplaetze",
      label: "Arbeitsplätze",
      value: Math.round(safeNuf / NUF_JE_ARBEITSPLATZ_M2),
      sub: `Ø ${NUF_JE_ARBEITSPLATZ_M2} m² NUF/AP [ASSUMED]`,
      icon: "users",
      quelle: "schaetzung",
    },
    {
      key: "stellplaetze",
      label: "Stellplätze",
      value: handStpl != null ? handStpl : Math.round(safeBgf / BGF_JE_STELLPLATZ_M2),
      sub: `1 je ${BGF_JE_STELLPLATZ_M2} m² BGF [ASSUMED]`,
      icon: "car",
      quelle: handStpl != null ? "hand" : "schaetzung",
      geplant,
    },
  ];
}
