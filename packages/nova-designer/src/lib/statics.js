// Tragwerksplanungs-Vorbemessung (DACH/Eurocode) — reine, deterministische
// Faustformel-Funktionen analog src/lib/compliance.js. ALLE Werte sind bewusst
// Richtwerte/Überschlagswerte für die Konzept-/Machbarkeitsphase, KEIN prüffähiger
// Standsicherheitsnachweis. Längen in m, Lasten in kN, Spannungen in kN/m².
// Divisionen mit fachlich zwingend positivem Nenner geben bei fehlender Eingabe null
// zurück („nicht berechenbar") statt eines plausibel aussehenden Falschwerts.

// Nutzlast-Kategorien nach EC1 (DIN EN 1991-1-1 Tab. 6.1DE), qk in kN/m².
// [ASSUMED A4] NA-DE-Defaultwerte, überschreibbar in der Komponente.
export const LOAD_CATEGORIES = {
  A: { label: "A Wohn-/Aufenthaltsräume", qk: 2.0 },
  B: { label: "B Büroflächen", qk: 2.0 },
  C: { label: "C Versammlung", qk: 5.0 },
  D: { label: "D Verkaufsflächen", qk: 5.0 },
  E: { label: "E Lager", qk: 7.5 },
};

// Betongüten nach EC2 (DIN EN 1992-1-1), fck in N/mm² (= MPa).
// Bemessungswert fcd = fck / 1.5 (γc = 1.5, αcc vereinfacht 1.0).
// [ASSUMED A8] αcc=1.0 vernachlässigt; bewusst konservativ-grobe Faustformel.
export const BETON_GRADES = {
  "C20/25": { label: "C20/25", fck: 20 },
  "C25/30": { label: "C25/30", fck: 25 },
  "C30/37": { label: "C30/37", fck: 30 },
  "C35/45": { label: "C35/45", fck: 35 },
};

// Erforderliche Deckenstärke (cm) aus Spannweite (m) — Biegeschlankheit l/d.
// Stahlbeton-Flachdecke ≈ l/30, Holzdecke ≈ l/20. Strengere Durchbiegungsbegrenzung
// erfordert eine kleinere zulässige Schlankheit ⇒ KLEINERER Teiler ⇒ DICKERE Decke
// (Stahlbeton l/25, Holz l/17). Der Systemteiler wird dabei nur verschärft, nie gelockert.
// Ergebnis in cm, aufgerundet auf das nächste Vielfache von 5. [ASSUMED A1]
export function deckenstaerke(span, deckensystem = "flachdecke", strengeDurchbiegung = false) {
  const l = Math.max(0.1, Number(span) || 0);
  let teiler = 30; // Stahlbeton-Flachdecke (Richtwert l/30)
  if (deckensystem === "holz") teiler = 20; // Holz-/Balkendecke (l/20)
  if (strengeDurchbiegung) teiler = Math.min(teiler, deckensystem === "holz" ? 17 : 25); // streng ⇒ kleinerer Teiler ⇒ dickere Decke
  const dM = l / teiler;          // erf. statische Höhe in m
  const dCm = dM * 100;           // in cm
  return Math.ceil(dCm / 5) * 5;  // auf 5 cm aufgerundet
}

// Gesamtlast je Geschoss (kN) = (gk + Δg + qk) [kN/m²] · Grundfläche [m²].
export function gesamtlast({ gk = 0, dg = 0, qk = 0, footArea = 0 }) {
  const flaeche = Math.max(0, Number(footArea) || 0);
  return ((Number(gk) || 0) + (Number(dg) || 0) + (Number(qk) || 0)) * flaeche;
}

// Vertikale Gesamt-Gebäudelast (kN) = Last je Geschoss · Geschossanzahl.
export function gebaeudelast(gesamtlastProGeschoss, storeys) {
  return (Number(gesamtlastProGeschoss) || 0) * Math.max(0, Number(storeys) || 0);
}

// Gründungs-/Sohldruck σ (kN/m²) = vertikale Last N / Gründungs-/Grundfläche.
// Grundfläche fachlich zwingend > 0: fehlt sie, ist σ NICHT berechenbar ⇒ null
// (kein plausibel aussehender Falschwert durch safeDiv-Klemmen).
export function gruendungslast({ N = 0, footArea = 0 }) {
  const A = Number(footArea) || 0;
  return A > 0 ? (Number(N) || 0) / A : null;
}

// Bemessungswert der Betondruckfestigkeit fcd in kN/m² aus Betongüte.
// fck [N/mm²] / 1.5 → fcd [N/mm²]; · 1000 → fcd [kN/m²] (1 N/mm² = 1000 kN/m²).
export function betonFcd(betonguete = "C25/30") {
  const g = BETON_GRADES[betonguete] || BETON_GRADES["C25/30"];
  const fcdNmm2 = g.fck / 1.5;
  return fcdNmm2 * 1000; // kN/m²
}

// Erforderlicher Stützenquerschnitt A_c (cm²) — Vordimensionierung.
// N_Stütze [kN] = Last/Geschoss · Geschosse · Lasteinzugsfläche / Grundfläche.
// A_c [m²] ≈ N_Stütze / (0,5 · fcd); → cm² (·10000). [ASSUMED A5]
// Grundfläche und fcd fachlich zwingend > 0: fehlen sie, ist A_c NICHT berechenbar
// ⇒ null (kein massiv überhöhter Falschwert durch safeDiv-Klemmen).
export function stuetzenVordim({ gesamtlastProGeschoss = 0, storeys = 0, footArea = 0, einzugA = 0, fcd = 0 }) {
  const A = Number(footArea) || 0;
  const f = Number(fcd) || 0;
  if (A <= 0 || f <= 0) return null;
  const nGesamt = (Number(gesamtlastProGeschoss) || 0) * Math.max(0, Number(storeys) || 0);
  const nStuetze = (nGesamt * Math.max(0, Number(einzugA) || 0)) / A;
  const acM2 = nStuetze / (0.5 * f); // m²
  return acM2 * 10000; // cm²
}

// Bewehrungs-Richtwerte (kg/m³ Beton) je Bauteil. [ASSUMED A2]
const BEWEHRUNG_RICHTWERT = { decke: 100, stuetze: 200, platte: 110 };

// Bewehrungsmasse (kg) = Betonvolumen [m³] · Richtwert [kg/m³].
export function bewehrungMasse(volumenM3, bauteil = "decke") {
  const r = BEWEHRUNG_RICHTWERT[bauteil] ?? BEWEHRUNG_RICHTWERT.decke;
  return (Number(volumenM3) || 0) * r;
}

// Betonvolumen aller Decken (m³) = Dicke [cm]/100 · Bruttogrundfläche BGF [m²].
export function betonvolumenDecken(dickeCm, bgf) {
  return ((Number(dickeCm) || 0) / 100) * Math.max(0, Number(bgf) || 0);
}

// Plausibilitäts-Checks (Vorbemessung) im Muster von checkCompliance.
// Sohldruck-Item ist bewusst nur "pass"/"warn" (Hinweis-Charakter), nie "fail" —
// es ist KEIN zulässiger Nachweis (T-15-03, Haftung).
export function vorbemessungChecks({ sigma = 0, zulSohldruck = 0, gesamtlastProGeschoss = 0, storeys = 0, footArea = 0 } = {}) {
  // sigma == null ⇒ Gründungsfläche fehlt, σ nicht berechenbar (gruendungslast).
  const sig = sigma == null ? null : Number(sigma) || 0;
  const zul = Number(zulSohldruck) || 0;
  const nf = (n) => Math.round(n).toLocaleString("de-DE");

  const items = [
    {
      key: "sohldruck",
      label: "Sohldruck-Plausibilität",
      status: sig != null && sig <= zul ? "pass" : "warn",
      detail: sig == null
        ? "σ nicht berechenbar — Grundfläche fehlt (Gebäudemodell pflegen)"
        : `σ ${nf(sig)} / zul. ${nf(zul)} kN/m² (Richtwert, EC7)`,
    },
    {
      key: "footArea",
      label: "Grundfläche aus Gebäudemodell",
      status: footArea > 0 ? "pass" : "warn",
      detail: footArea > 0 ? `${nf(footArea)} m² übernommen` : "kein Footprint im Modell gesetzt",
    },
    {
      key: "storeys",
      label: "Geschossanzahl aus Gebäudemodell",
      status: storeys > 0 ? "pass" : "warn",
      detail: `${Math.max(0, Math.round(storeys))} Geschosse · Last/Geschoss ${nf(gesamtlastProGeschoss)} kN`,
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Vorbemessung mit Hinweisen" : "Vorbemessung plausibel";
  return { items, score, warns, verdict };
}

// ---- Erdbeben (vereinfacht, EC8 / DIN EN 1998-1 NA-DE-nah) ----
// KONZEPT/Visualisierung — KEIN Erdbebennachweis. Referenz-Bodenbeschleunigung agR
// je Erdbebenzone in m/s². [ASSUMED A9] DIN-4149-/EC8-NA-nahe Richtwerte.
export const EC8_ZONES = {
  "0": { label: "Zone 0 — keine Erdbebenbemessung", agR: 0.0 },
  "1": { label: "Zone 1 (niedrig)", agR: 0.4 },
  "2": { label: "Zone 2 (mittel)", agR: 0.6 },
  "3": { label: "Zone 3 (hoch)", agR: 0.8 },
};

// Vereinfachte Erdbeben-Kennwerte für die Konzept-Simulation.
// T1 = Ct·H^0,75 (Ct=0,05); Sd = agR·S·2,5/q (Plateauwert); Basisschub Fb = (Sd/g)·W·λ;
// Kopfauslenkung grob aus Spektralverschiebung. Alle Divisionen gehärtet.
// [ASSUMED A10] Baugrundbeiwert S=1,25 und Verhaltensbeiwert q=1,5 grob angenommen.
export function erdbebenKennwerte({ zone = "0", height = 0, gebaeudelastKN = 0, q = 1.5, S = 1.25 } = {}) {
  const z = EC8_ZONES[String(zone)] || EC8_ZONES["0"];
  const H = Math.max(0.1, Number(height) || 0);
  const W = Math.max(0, Number(gebaeudelastKN) || 0); // vertikale Gebäudelast als Gewicht [kN]
  const agR = z.agR;                                   // m/s²
  const T1 = 0.05 * Math.pow(H, 0.75);                 // Eigenperiode [s]
  // Verhaltensbeiwert q fachlich >= 1 (EC8): Eingabefehler q<=0 nicht in Sd-Überhöhung
  // verwandeln, sondern auf das Minimum 1 klemmen.
  const qEff = Math.max(1, Number(q) || 0);
  const Sd = agR > 0 ? (agR * S * 2.5) / qEff : 0;     // Plateau-Spektralbeschleunigung [m/s²]
  const seismicCoeff = Sd / 9.81;                      // dimensionsloser Erdbebenbeiwert (g konstant)
  const lambda = 0.85;                                 // Massenanteil-Korrektur (>2 Geschosse)
  const Fb = seismicCoeff * W * lambda;                // Erdbeben-Ersatzkraft / Basisschub [kN]
  const topDisp = (Sd * T1 * T1) / (4 * Math.PI * Math.PI) * 1.4 * 100; // Kopfauslenkung [cm], grob
  return { agR, S, q: qEff, T1, Sd, seismicCoeff, Fb, topDisp, zoneLabel: z.label, active: agR > 0 };
}
