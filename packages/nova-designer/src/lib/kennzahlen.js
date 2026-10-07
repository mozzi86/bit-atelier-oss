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
