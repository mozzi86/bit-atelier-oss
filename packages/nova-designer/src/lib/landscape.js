// Außenanlagen-/Landschaftsplanung — reine, deterministische Faustformel-Funktionen
// (analog src/lib/statics.js). ALLE Werte sind bewusst Richtwerte/Überschlagswerte für
// die Konzept-/Machbarkeitsphase, KEIN Genehmigungsnachweis. Stellplatz-, Begrünungs-
// und Entwässerungsanforderungen sind kommunal unterschiedlich (Stellplatzsatzung,
// Entwässerungssatzung) und durch Fachplaner:in zu prüfen.
// Längen in m, Flächen in m², Spitzenabfluss in l/s, Volumen in m³.
// Divisionen mit fachlich zwingend positivem Nenner (Grundstücksfläche) geben bei
// fehlender Eingabe null zurück („nicht berechenbar") statt eines Falschwerts.

// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);

// --- Richtwert-Konstanten (Defaults, überschreibbar in der Komponente) ----------------
export const DEFAULT_KFZ_SCHLUESSEL = 1.0;       // [ASSUMED A1] KFZ-Stellplätze je WE (kommunal abweichend)
export const DEFAULT_FAHRRAD_SCHLUESSEL = 2.0;   // [ASSUMED A2] Fahrradstellplätze je WE bzw. je 100 m² BGF
export const DEFAULT_BARRIEREFREI_PCT = 3;       // [ASSUMED A3] barrierefreier Anteil an erf. KFZ-Stellplätzen (%)
export const DEFAULT_BARRIEREFREI_MIN = 1;       // [ASSUMED A3] mindestens 1 barrierefreier Stellplatz
export const BF_STPL_MASS = "3,50 × 5,00 m";     // [ASSUMED A4] Maß barrierefreier Stellplatz (informativ)
export const DEFAULT_STPL_BREITE = 2.5;          // [ASSUMED A6] Stellplatzbreite (m)
export const DEFAULT_STPL_LAENGE = 5.0;          // [ASSUMED A6] Stellplatzlänge (m)
export const DEFAULT_FLAECHENFAKTOR = 2.0;       // [ASSUMED A7] Flächenfaktor inkl. Fahrgasse (× Nettofläche)
export const PSI_DACH = 0.9;                      // [ASSUMED A8] Abflussbeiwert ψ Dachflächen
export const PSI_BEFESTIGT = 0.9;                // [ASSUMED A8] Abflussbeiwert ψ befestigte/asphaltierte Flächen
export const PSI_GRUEN = 0.2;                     // [ASSUMED A8] Abflussbeiwert ψ Grün-/Vegetationsflächen
export const DEFAULT_REGEN_R = 200;              // [ASSUMED A9] Bemessungsregenspende r in l/(s·ha)
export const DEFAULT_REGENDAUER_MIN = 15;       // [ASSUMED A10] Regendauer für Rückhaltevolumen (min)
export const DEFAULT_FW_BREITE = 3.5;           // [ASSUMED A11] Breite Feuerwehr-Aufstell-/Bewegungsfläche (m, DIN 14090)

// Erforderliche KFZ-Stellplätze = aufgerundet(WE · Schlüssel).
export function erfKfzStellplaetze(we, schluessel = DEFAULT_KFZ_SCHLUESSEL) {
  return Math.ceil(num(we) * num(schluessel));
}

// Erforderliche Fahrradstellplätze. basis "we": ceil(WE · Schlüssel);
// basis "bgf": ceil(BGF/100 · Schlüssel) — je 100 m² Bruttogrundfläche.
export function erfFahrradStellplaetze({ we = 0, bgf = 0, schluessel = DEFAULT_FAHRRAD_SCHLUESSEL, basis = "we" } = {}) {
  const s = num(schluessel);
  if (basis === "bgf") return Math.ceil((num(bgf) / 100) * s);
  return Math.ceil(num(we) * s);
}

// Erforderliche barrierefreie Stellplätze = max(Mindestanzahl, ceil(erf. KFZ · pct/100)).
export function erfBarrierefrei(erfKfz, pct = DEFAULT_BARRIEREFREI_PCT, min = DEFAULT_BARRIEREFREI_MIN) {
  return Math.max(num(min), Math.ceil((num(erfKfz) * num(pct)) / 100));
}

// Flächenbedarf je Stellplatz (m²) = Breite · Länge · Flächenfaktor (inkl. Fahrgasse).
export function stellplatzFlaecheJe(breite = DEFAULT_STPL_BREITE, laenge = DEFAULT_STPL_LAENGE, faktor = DEFAULT_FLAECHENFAKTOR) {
  return num(breite) * num(laenge) * num(faktor);
}

// Gesamte Stellplatzfläche (m²) = erf. KFZ-Stellplätze · Fläche je Stellplatz.
export function stellplatzFlaecheGesamt(erfKfz, breite = DEFAULT_STPL_BREITE, laenge = DEFAULT_STPL_LAENGE, faktor = DEFAULT_FLAECHENFAKTOR) {
  return num(erfKfz) * stellplatzFlaecheJe(breite, laenge, faktor);
}

// Versiegelungsgrad (0..1) = (bebaute Fläche + Stellplatzfläche) / Grundstücksfläche.
// Grünflächen bleiben unversiegelt. Grundstücksfläche fachlich zwingend > 0: fehlt sie,
// ist der Grad NICHT berechenbar ⇒ null (kein Falschwert wie „4000 % versiegelt").
export function versiegelungsgrad({ footArea = 0, stellplatzflaeche = 0, gruenflaeche = 0, plot = 0 } = {}) {
  const p = num(plot);
  if (p <= 0) return null;
  const versiegelt = num(footArea) + num(stellplatzflaeche);
  return versiegelt / p;
}

// Begrünungsgrad/Grünflächenanteil (0..1) = Grünfläche / Grundstücksfläche.
// Plot fehlt ⇒ null (analog versiegelungsgrad).
export function gruenflaecheAnteil(gruenflaeche, plot) {
  const p = num(plot);
  return p > 0 ? num(gruenflaeche) / p : null;
}

// Reduzierte Abflussfläche A_red (m²) = Σ (Teilfläche · Abflussbeiwert ψ).
export function abflussFlaeche({ footArea = 0, psiDach = PSI_DACH, stellplatzflaeche = 0, psiBefestigt = PSI_BEFESTIGT, gruenflaeche = 0, psiGruen = PSI_GRUEN } = {}) {
  return (
    num(footArea) * num(psiDach) +
    num(stellplatzflaeche) * num(psiBefestigt) +
    num(gruenflaeche) * num(psiGruen)
  );
}

// Spitzenabfluss Q (l/s) = r · A_red / 10000.
// r in l/(s·ha), A_red in m². 1 ha = 10000 m² → /10000 rechnet die Regenspende
// von „je Hektar" auf die in m² angegebene Abflussfläche um (ha→m²-Umrechnung).
export function spitzenabflussQ(r = DEFAULT_REGEN_R, aRed = 0) {
  return (num(r) * num(aRed)) / 10000; // /10000: ha→m² (1 ha = 10000 m²)
}

// Regenrückhaltevolumen V (m³) = Q · Dauer · 60 / 1000.
// Q in l/s, Dauer in min → ·60 (s/min) ergibt Liter, /1000 ergibt m³.
export function rueckhaltevolumen(Q = 0, dauerMin = DEFAULT_REGENDAUER_MIN) {
  return (num(Q) * num(dauerMin) * 60) / 1000;
}

// Plausibilitäts-Checks (Konzept) — bewusst NUR "pass"/"warn", nie "fail" (Haftung):
// Richtwerte dürfen nicht als prüffähiger Genehmigungsnachweis erscheinen (T-16-04).
export function aussenanlagenChecks({
  erfKfz = 0, vorhandenKfz = 0,
  erfBarrierefrei = 0, barrierefreiVorh = 0,
  versiegelung = 0, gruen = 0, volumen = 0,
  fwBreite = 0, plot = 0,
} = {}) {
  const nf = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
  const pct = (g) => `${Math.round((Number(g) || 0) * 100)} %`;

  const items = [
    {
      key: "kfz",
      label: "KFZ-Stellplätze (Richtwert)",
      status: num(vorhandenKfz) >= num(erfKfz) ? "pass" : "warn",
      detail: `vorh. ${nf(vorhandenKfz)} / erf. ${nf(erfKfz)} Stpl. (kommunal abweichend)`,
    },
    {
      key: "barrierefrei",
      label: "Barrierefreie Stellplätze (Richtwert)",
      status: num(barrierefreiVorh) >= num(erfBarrierefrei) ? "pass" : "warn",
      detail: `vorh. ${nf(barrierefreiVorh)} / erf. ${nf(erfBarrierefrei)} Stpl.`,
    },
    {
      key: "versiegelung",
      label: "Versiegelungsgrad (Richtwert)",
      // null = Grundstücksfläche fehlt ⇒ Hinweis statt stiller pass/Falschwert.
      status: versiegelung != null && (Number(versiegelung) || 0) <= 0.6 ? "pass" : "warn",
      detail: versiegelung == null
        ? "nicht berechenbar — Grundstücksfläche eingeben"
        : `${pct(versiegelung)} versiegelt (Orientierung ≤ 60 %, Satzung beachten)`,
    },
    {
      key: "gruen",
      label: "Begrünungsgrad (Richtwert)",
      status: gruen != null && (Number(gruen) || 0) >= 0.2 ? "pass" : "warn",
      detail: gruen == null
        ? "nicht berechenbar — Grundstücksfläche eingeben"
        : `${pct(gruen)} Grünfläche (Orientierung ≥ 20 %)`,
    },
    {
      key: "retention",
      label: "Regenrückhaltevolumen (Richtwert)",
      status: num(volumen) > 0 ? "pass" : "warn",
      detail: `${nf(volumen)} m³ Konzept-Rückhalt (Entwässerungssatzung beachten)`,
    },
    {
      key: "feuerwehr",
      label: "Feuerwehr-Aufstellfläche (DIN 14090)",
      status: num(fwBreite) >= 3.5 ? "pass" : "warn",
      detail: `Breite ${(Number(fwBreite) || 0).toLocaleString("de-DE")} m (Richtwert ≥ 3,50 m)`,
    },
    {
      key: "plot",
      label: "Grundstücksfläche erfasst",
      status: num(plot) > 0 ? "pass" : "warn",
      detail: num(plot) > 0 ? `${nf(plot)} m² Grundstück` : "Grundstücksfläche eingeben",
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}
