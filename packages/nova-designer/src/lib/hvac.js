// Haustechnik/TGA — reine, deterministische Faustformel-Funktionen für die
// Konzept-/Vorplanungsphase (analog src/lib/landscape.js und src/lib/statics.js).
// ALLE Werte sind bewusst Konzept-Richtwerte: KEINE Anlagenplanung, KEIN Nachweis
// nach GEG / DIN V 18599 / DIN EN 12831 — Auslegung durch TGA-Fachplaner:in erforderlich.
// Einheiten: spez. Heizlast W/m², Heizlast kW, Energie kWh/a, Volumenstrom m³/h,
// Trinkwasser l/d bzw. m³/a, Elektro-Anschlusswert kW, PV kWp.
// Jede Division ist gegen 0/leer/negativ gehärtet (safeDiv), jede Eingabe defensiv
// coerced (num). Einheiten-Umrechnungen (/1000, ·365/1000) sind im Code kommentiert.

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);

// de-DE-Zahlformat für Check-Detailtexte (ganzzahlig gerundet).
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

// --- Richtwert-Konstanten (Defaults, überschreibbar in der Komponente) ----------------

// Gebäudestandards mit spez. Heizlast (W/m²), spez. Heizwärmebedarf (kWh/(m²·a))
// und Plausibilitäts-Band [min,max] für den Heizlast-Check. [ASSUMED A1/A2]
export const GEBAEUDESTANDARDS = {
  "bestand-unsaniert": { label: "Bestand (unsaniert)", heizlast: 120, bedarf: 160, band: [90, 150] },
  "bestand-saniert": { label: "Bestand (saniert)", heizlast: 70, bedarf: 90, band: [50, 90] },
  "geg-neubau": { label: "GEG-Neubau", heizlast: 50, bedarf: 55, band: [30, 60] },
  "kfw-55": { label: "KfW-55", heizlast: 35, bedarf: 40, band: [25, 45] },
  "kfw-40": { label: "KfW-40", heizlast: 25, bedarf: 30, band: [15, 35], wrgEmpfohlen: true },
  "passivhaus": { label: "Passivhaus", heizlast: 12, bedarf: 15, band: [8, 20], wrgEmpfohlen: true },
};

// Wärmeerzeuger; ee = erfüllt den GEG-§71-65%-EE-Kontext (nur Hinweis, kein Nachweis);
// jaz = typische Jahresarbeitszahl bei Wärmepumpen. [ASSUMED A3/A4]
export const WAERMEERZEUGER = {
  "wp-luft": { label: "Wärmepumpe (Luft/Wasser)", ee: true, jaz: 3.5 },
  "wp-sole": { label: "Wärmepumpe (Sole/Wasser)", ee: true, jaz: 4.0 },
  "gas": { label: "Gas-Brennwert", ee: false },
  "fernwaerme": { label: "Fernwärme", ee: true },
  "pellet": { label: "Pellet/Biomasse", ee: true },
  "hybrid": { label: "Hybrid (Gas + WP)", ee: true, jaz: 3.0 },
};

// Lüftungssysteme; wrg = Wärmerückgewinnung vorhanden, eta = typischer WRG-Wirkungsgrad (%). [ASSUMED A7]
export const LUEFTUNGSSYSTEME = {
  "fenster": { label: "Fensterlüftung", wrg: false },
  "abluft": { label: "Abluftanlage", wrg: false },
  "zentral-wrg": { label: "Zentrale Lüftung mit WRG", wrg: true, eta: 80 },
  "dezentral-wrg": { label: "Dezentrale Lüftung mit WRG", wrg: true, eta: 75 },
};

export const DEFAULT_LUFTWECHSEL = 0.5;      // [ASSUMED A5] Luftwechselrate n (1/h) Wohnen
export const DEFAULT_AUSSENLUFT_P = 30;      // [ASSUMED A6] Außenluft je Person (m³/(h·P))
export const DEFAULT_TRINKWASSER_LPD = 125;  // [ASSUMED A8] Trinkwasserbedarf (l/(P·d))
export const DEFAULT_WW_ANTEIL_PCT = 30;     // [ASSUMED A8] Warmwasseranteil am Trinkwasser (%)
export const DEFAULT_PERSONEN_JE_WE = 2.5;   // [ASSUMED A9] Personen je Wohneinheit
export const DEFAULT_SANITAER_JE_WE = 4;     // [ASSUMED A10] Sanitärobjekte je WE (WC, WT, Dusche/Wanne, Küche)
export const DEFAULT_VA_M2 = 30;             // [ASSUMED A11] spez. Elektro-Anschlusswert (VA/m²) Wohnen
export const DEFAULT_KW_JE_WE = 14.5;        // [ASSUMED A12] Anschlusswert je WE (kW, DIN 18015-Orientierung)
export const DEFAULT_GZF = 0.6;              // [ASSUMED A12] Gleichzeitigkeitsfaktor
export const DEFAULT_PV_KWP_M2 = 0.18;       // [ASSUMED A13] PV-Leistungsdichte (kWp/m² Dachfläche)
export const DEFAULT_PV_ERTRAG = 950;        // [ASSUMED A13] spez. PV-Ertrag (kWh/(kWp·a), Deutschland)

// --- Faustformeln (reine Zahlen, Formatierung in der Komponente) ----------------------

// Heizlast (kW) = spez. Heizlast q (W/m²) · beheizte Fläche (m²) / 1000.
// /1000: Einheiten-Umrechnung W → kW.
export function heizlastKW(qWm2, flaecheM2) {
  return (num(qWm2) * num(flaecheM2)) / 1000; // /1000: W → kW
}

// Jahres-Heizwärmebedarf (kWh/a) = spez. Bedarf q (kWh/(m²·a)) · beheizte Fläche (m²).
export function jahresHeizwaermebedarf(qKwhM2a, flaecheM2) {
  return num(qKwhM2a) * num(flaecheM2);
}

// Wärmepumpen-Strombedarf (kWh/a) = Heizwärmebedarf / JAZ.
// JAZ via safeDiv gehärtet: JAZ=0/leer liefert endlichen Wert statt Infinity.
export function waermepumpeStrombedarf(bedarfKwhA, jaz) {
  return safeDiv(num(bedarfKwhA), num(jaz));
}

// Lüftungs-Volumenstrom (m³/h).
// basis "luftwechsel": n (1/h) · Nettoluftvolumen (m³).
// basis "personen":    Personen · Außenluftrate (m³/(h·P)).
export function lueftungVolumenstrom({ basis = "luftwechsel", n = 0, volumen = 0, personen = 0, aussenluft = 0 } = {}) {
  if (basis === "personen") return num(personen) * num(aussenluft);
  return num(n) * num(volumen);
}

// Trinkwasserbedarf (l/d) = Personen · Bedarf je Person (l/(P·d)).
export function trinkwasserBedarf(personen, literProPersonTag = DEFAULT_TRINKWASSER_LPD) {
  return num(personen) * num(literProPersonTag);
}

// Warmwasserbedarf (l/d) = Trinkwasserbedarf (l/d) · Warmwasseranteil (%) / 100.
export function warmwasserBedarf(trinkwasserLd, anteilPct = DEFAULT_WW_ANTEIL_PCT) {
  return (num(trinkwasserLd) * num(anteilPct)) / 100;
}

// Trinkwasser-Jahresmenge (m³/a) = l/d · 365 / 1000.
// ·365: Tage/Jahr; /1000: Einheiten-Umrechnung Liter → m³.
export function trinkwasserJahrM3(trinkwasserLd) {
  return (num(trinkwasserLd) * 365) / 1000; // ·365 d/a, /1000: l → m³
}

// Elektro-Anschlusswert (kW).
// basis "va-m2": spez. Anschlusswert (VA/m²) · Bezugsfläche (m²) · GZF / 1000
//                (/1000: Einheiten-Umrechnung VA → kW, cos φ ≈ 1 als Überschlag).
// basis "we":    Anschlusswert je WE (kW/WE) · WE · GZF.
export function elektroAnschlusswert({ basis = "va-m2", vaM2 = 0, bezugsflaeche = 0, kwJeWe = 0, we = 0, gzf = DEFAULT_GZF } = {}) {
  if (basis === "we") return num(kwJeWe) * num(we) * num(gzf);
  return (num(vaM2) * num(bezugsflaeche) * num(gzf)) / 1000; // /1000: VA → kW
}

// PV-Dachpotenzial: kwp = Dachfläche (m²) · Leistungsdichte (kWp/m²);
// kwhA = kwp · spez. Ertrag (kWh/(kWp·a)).
export function pvPotenzial({ dachflaeche = 0, kwpJeM2 = DEFAULT_PV_KWP_M2, ertrag = DEFAULT_PV_ERTRAG } = {}) {
  const kwp = num(dachflaeche) * num(kwpJeM2);
  return { kwp, kwhA: kwp * num(ertrag) };
}

// Plausibilitäts-Checks (Konzept) — bewusst NUR "pass"/"warn", nie "fail" (Haftung):
// Richtwerte dürfen nicht als prüffähiger GEG-/DIN-Nachweis erscheinen (T-17-04).
export function tgaChecks({
  standard = "geg-neubau", qHeizlast = 0, erzeuger = "wp-luft",
  lueftungssystem = "zentral-wrg", beheizteFlaeche = 0, we = 0,
} = {}) {
  const std = GEBAEUDESTANDARDS[standard] || GEBAEUDESTANDARDS["geg-neubau"];
  const erz = WAERMEERZEUGER[erzeuger] || {};
  const lueft = LUEFTUNGSSYSTEME[lueftungssystem] || {};
  const q = num(qHeizlast);
  const [bandMin, bandMax] = std.band;

  const items = [
    {
      key: "heizlast",
      label: "Spez. Heizlast (Richtwert)",
      status: q >= bandMin && q <= bandMax ? "pass" : "warn",
      detail: `q ${de(q)} W/m² (Orientierung ${de(bandMin)}–${de(bandMax)} für ${std.label})`,
    },
    {
      key: "wrg",
      label: "Wärmerückgewinnung (Richtwert)",
      status: std.wrgEmpfohlen && !lueft.wrg ? "warn" : "pass",
      detail: std.wrgEmpfohlen && !lueft.wrg
        ? "Niedrigenergie-Standard ohne Wärmerückgewinnung unplausibel"
        : `${lueft.label || "Lüftungssystem"} passt zum Standard ${std.label}`,
    },
    {
      key: "erzeuger_ee",
      label: "Erneuerbare Wärme (GEG §71, Hinweis)",
      status: erz.ee ? "pass" : "warn",
      detail: erz.ee
        ? `${erz.label || "Wärmeerzeuger"} im 65-%-EE-Kontext plausibel (Hinweis, kein Nachweis)`
        : "Gas-Brennwert allein erfüllt GEG-65%-EE-Vorgabe i. d. R. nicht (Hinweis, kein Nachweis)",
    },
    {
      key: "flaeche",
      label: "Beheizte Fläche erfasst",
      status: num(beheizteFlaeche) > 0 ? "pass" : "warn",
      detail: num(beheizteFlaeche) > 0
        ? `${de(beheizteFlaeche)} m² beheizte Fläche`
        : "Beheizte Fläche eingeben / Gebäudemodell pflegen",
    },
    {
      key: "we",
      label: "Wohneinheiten erfasst",
      status: num(we) > 0 ? "pass" : "warn",
      detail: num(we) > 0 ? `${de(we)} WE als Sanitär-/Elektro-Bezug` : "Wohneinheiten eingeben",
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}
