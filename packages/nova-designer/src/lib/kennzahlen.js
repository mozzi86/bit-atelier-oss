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
/** [ASSUMED] m² NUF je Arbeitsplatz (Gewerbe/Öffentlich) — Einheit: m²/AP. */
export const NUF_JE_ARBEITSPLATZ_M2 = 12;
/** [ASSUMED] m² BGF je Stellplatz (Gewerbe/Öffentlich) — Einheit: m²/Stpl. */
export const BGF_JE_STELLPLATZ_M2 = 40;

/** Projekttypen mit Wohn-Kennzahlen (Rest bekommt Arbeitsplätze). */
const WOHN_TYPEN = new Set(["residential", "mixed_use"]);

/**
 * Dichte-Kennzahlen je Projekttyp.
 * @param {string|null|undefined} projektTyp Project.type-Key ("residential",
 *   "commercial", "institutional", …); null/unbekannt → Gewerbe-Logik
 * @param {{ nuf: number, bgf: number }} flachen Nutzfläche und Brutto-
 *   Grundfläche, beide in m²
 * @returns {Array<{ key: string, label: string, value: number, sub: string, icon: 'home'|'car'|'users' }>}
 *   KPI-Einträge in Anzeigereihenfolge; `value` ganzzahlig (gerundet)
 */
export function kennzahlenJeTyp(projektTyp, { nuf, bgf }) {
  const safeNuf = Number.isFinite(nuf) ? Math.max(0, nuf) : 0;
  const safeBgf = Number.isFinite(bgf) ? Math.max(0, bgf) : 0;
  if (WOHN_TYPEN.has(projektTyp)) {
    const wohneinheiten = Math.max(0, Math.round(safeNuf / NUF_JE_WOHNUNG_M2));
    return [
      {
        key: "wohneinheiten",
        label: "Wohneinheiten",
        value: wohneinheiten,
        sub: `Ø ${NUF_JE_WOHNUNG_M2} m² NUF [ASSUMED]`,
        icon: "home",
      },
      {
        key: "stellplaetze",
        label: "Stellplätze",
        value: Math.round(wohneinheiten * STELLPLATZ_SCHLUESSEL_WOHNEN),
        sub: `Schlüssel ${STELLPLATZ_SCHLUESSEL_WOHNEN.toFixed(1)} [ASSUMED]`,
        icon: "car",
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
    },
    {
      key: "stellplaetze",
      label: "Stellplätze",
      value: Math.round(safeBgf / BGF_JE_STELLPLATZ_M2),
      sub: `1 je ${BGF_JE_STELLPLATZ_M2} m² BGF [ASSUMED]`,
      icon: "car",
    },
  ];
}
