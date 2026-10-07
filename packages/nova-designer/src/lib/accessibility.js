// Barrierefreiheit — reine, deterministische Faustformel-Funktionen für das
// Barrierefreiheits-KONZEPT der Vorplanung nach DIN 18040 (analog src/lib/fire.js,
// src/lib/hvac.js, src/lib/landscape.js und src/lib/statics.js).
// ALLE Werte sind bewusst Konzept-Richtwerte: KEIN Nachweis nach Landesbauordnung —
// Aufzugspflicht und Wohnungsquoten (barrierefrei/rollstuhlgerecht) sind
// BUNDESLANDABHÄNGIG; Prüfung und Nachweis durch Bauvorlageberechtigte:r /
// Fachplanung erforderlich.
// Normbezug (Orientierung): MBO §39 (Aufzüge) / §50 (Barrierefreies Bauen),
// DIN 18040-1/-2 (Barrierefreies Bauen), DIN EN 81-70 (Aufzugskabinen).
// ABGRENZUNG: Barrierefreie KFZ-Stellplätze (Anzahl & Maß 3,50 × 5,00 m) liegen im
// Landschaft-Tab (src/lib/landscape.js, erfBarrierefrei/BF_STPL_MASS) — hier NUR die
// gebäudeinterne Barrierefreiheit (Erschließung, Aufzug, Wohnungen, Bewegungsflächen,
// Sanitär). Jede Division ist gegen 0/leer/negativ gehärtet (safeDiv), jede Eingabe
// defensiv coerced (num). OKF (Fußbodenoberkante höchstes Geschoss) wird NIE mit der
// Gesamthöhe verwechselt — accessibility.js rechnet nur mit dem übergebenen okf-Wert;
// die Näherung OKF ≈ (storeys−1)·storeyHeight erzeugt die Komponente.

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);
// de-DE-Zahlformat für Check-Detailtexte (ganzzahlig gerundet).
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
// de-DE-Zahlformat mit max. 1 Nachkommastelle (Maße wie 1,1 / 1,4 m).
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

// --- Richtwert-Konstanten (Defaults, überschreibbar in der Komponente) ----------------

export const AUFZUG_GESCHOSS_GRENZE = 3;   // [ASSUMED A2] Aufzugspflicht ab > 3 Vollgeschossen (LBO-abhängig)
export const AUFZUG_OKF_GRENZE = 13;       // [ASSUMED A2] Aufzugspflicht ab OKF > 13 m (MBO §39, LBO-abhängig)
export const KABINE_BREITE = 1.10;         // [ASSUMED A5] Aufzugskabine Mindestbreite (m, DIN EN 81-70 Typ 2)
export const KABINE_TIEFE = 1.40;          // [ASSUMED A5] Aufzugskabine Mindesttiefe (m, DIN EN 81-70 Typ 2)
export const BEWEGUNG_VOR_AUFZUG = 1.50;   // [ASSUMED A4] Bewegungsfläche vor dem Aufzug (m, DIN 18040)
export const BEWEGUNG_B = 1.20;            // [ASSUMED A8] Bewegungsfläche barrierefrei B (m, DIN 18040-2)
export const BEWEGUNG_R = 1.50;            // [ASSUMED A9] Bewegungsfläche rollstuhlgerecht R (m, DIN 18040-2)
export const TUER_BREITE_B = 0.80;         // [ASSUMED A10] lichte Türbreite barrierefrei B (m, DIN 18040-2)
export const TUER_BREITE_R = 0.90;         // [ASSUMED A10] lichte Türbreite rollstuhlgerecht R (m, DIN 18040-2)
export const TUER_HOEHE = 2.05;            // [ASSUMED A11] lichte Türhöhe (m, Richtwert)
export const FLUR_BREITE = 1.20;           // [ASSUMED A10] Flurbreite in der Wohnung (m, DIN 18040-2)
export const WC_SEITLICH = 0.90;           // [ASSUMED A12] seitliche Fläche neben WC bei Stufe R (m, DIN 18040-2)
export const DEFAULT_R_QUOTE = 0;          // [ASSUMED A7] R-Quote-Default (%, LBO-abhängig — teils feste Zahl/Quote)
export const QM_JE_WE = 75;                // [ASSUMED A6] m² NGF je Wohneinheit (projektweit etablierte Näherung)

// Ausbaustufen nach DIN 18040-2 (B = barrierefrei, R = rollstuhlgerecht).
export const AUSBAUSTUFEN = {
  B: "B — barrierefrei",
  R: "R — rollstuhlgerecht",
};

// --- Faustformeln (reine Werte, Formatierung in der Komponente) -----------------------

// Aufzugspflicht (ODER-Verknüpfung, beide Kriterien LBO-abhängig). [ASSUMED A2]
export function aufzugPflicht(storeys, okf) {
  return num(storeys) > AUFZUG_GESCHOSS_GRENZE || num(okf) > AUFZUG_OKF_GRENZE;
}

// Aufzugskabine ausreichend (DIN EN 81-70 Typ 2: ≥ 1,10 × 1,40 m). [ASSUMED A5]
export function kabineOk(b, t) {
  return num(b) >= KABINE_BREITE && num(t) >= KABINE_TIEFE;
}

// Wohneinheiten aus NGF (projektweit etablierte Näherung ngf/75, mind. 1). [ASSUMED A6]
export function weAusNgf(ngf) {
  return Math.max(1, Math.round(safeDiv(num(ngf), QM_JE_WE)));
}

// Wohneinheiten je Geschoss (storeys gegen 0 per Math.max(1, …) abgesichert).
export function weJeGeschoss(we, storeys) {
  return Math.ceil(safeDiv(num(we), Math.max(1, num(storeys))));
}

// Erf. barrierefrei erreichbare WE: mit Aufzug alle Geschosse/WE, ohne Aufzug
// mind. die Wohnungen EINES Geschosses (MBO §50). [ASSUMED A3]
export function erfBarrierefreiErreichbar(we, storeys, aufzug) {
  return aufzug ? num(we) : Math.max(1, weJeGeschoss(we, storeys));
}

// Erf. rollstuhlgerechte Wohnungen aus Quote (%). Default 0 % — LBO-abhängig. [ASSUMED A7]
export function erfRollstuhlgerecht(we, quotePct = DEFAULT_R_QUOTE) {
  return Math.max(0, Math.ceil(num(we) * num(quotePct) / 100));
}

// Erf. Bewegungsfläche (quadratisch) je Ausbaustufe: B 1,20 / R 1,50 m. [ASSUMED A8/A9]
export function bewegungsflaeche(stufe) {
  return stufe === "R" ? BEWEGUNG_R : BEWEGUNG_B;
}

// Lichte Türbreite ausreichend je Ausbaustufe: B ≥ 0,80 / R ≥ 0,90 m. [ASSUMED A10]
export function tuerBreiteOk(vorh, stufe) {
  return num(vorh) >= (stufe === "R" ? TUER_BREITE_R : TUER_BREITE_B);
}

// Flurbreite (Wohnung) ausreichend: ≥ 1,20 m. [ASSUMED A10]
export function flurOk(breite) {
  return num(breite) >= FLUR_BREITE;
}

// Sanitärraum plausibel (Konzept): Bewegungsfläche vor Objekten ≥ Zielwert der
// Ausbaustufe UND bodengleiche Dusche; bei Stufe R zusätzlich seitliche Fläche
// neben WC ≥ 0,90 m und unterfahrbarer Waschtisch. [ASSUMED A12]
export function sanitaerOk({ stufe = "R", bewegung, dusche = "ja", wcSeitlich = WC_SEITLICH, waschtisch = "ja" } = {}) {
  const ja = (v) => v === true || v === "ja";
  if (num(bewegung) < bewegungsflaeche(stufe)) return false;
  if (!ja(dusche)) return false;
  if (stufe === "R" && !(num(wcSeitlich) >= WC_SEITLICH && ja(waschtisch))) return false;
  return true;
}

// Plausibilitäts-Checks (Konzept) — bewusst NUR "pass"/"warn", NIE "fail" (Haftung):
// Barrierefreiheits-Anforderungen sind bundeslandabhängig; Richtwerte dürfen nicht
// als geprüfter DIN-18040-Nachweis nach Landesbauordnung erscheinen (T-19-04).
// Genau 8 Items (Keys: aufzug, erschliessung, erreichbar, rollstuhl, bewegung,
// tuer, flur, sanitaer).
export function bfChecks({
  storeys = 0, okf = 0, aufzugMode = "auto", kabineB, kabineT, // Kabinenmaße ohne Default — fehlend ≠ Mindestmaß erfüllt (ME-05)
  erschliessung = "ja", we = 0, quotePct = DEFAULT_R_QUOTE, vorhErreichbar = 0, vorhR = 0,
  stufe = "B", bewegung = 0, tuerBreite = 0, tuerHoehe = 0, flur = 0,
  saniStufe = "R", saniBewegung = 0, saniDusche = "ja", saniWcSeitlich = WC_SEITLICH, saniWaschtisch = "ja",
} = {}) {
  const pflicht = aufzugMode === "auto" ? aufzugPflicht(storeys, okf) : aufzugMode === "ja";
  const kabErfasst = num(kabineB) > 0 && num(kabineT) > 0;
  const kab = kabErfasst && kabineOk(kabineB, kabineT);
  const erfErr = erfBarrierefreiErreichbar(we, storeys, pflicht);
  const erfR = erfRollstuhlgerecht(we, quotePct);

  const aufzugItem = (() => {
    if (pflicht && kab) {
      return { status: "pass", detail: `Aufzugspflicht abgeleitet — Kabine ${de1(kabineB)} × ${de1(kabineT)} m ausreichend (DIN EN 81-70)` };
    }
    if (pflicht && !kab) {
      return {
        status: "warn",
        detail: kabErfasst
          ? "Aufzugspflicht abgeleitet — Kabine unter 1,10 × 1,40 m (DIN EN 81-70 Typ 2)"
          : "Aufzugspflicht abgeleitet — Kabinenmaße pflegen (DIN EN 81-70 Typ 2)",
      };
    }
    if (aufzugMode === "nein" && aufzugPflicht(storeys, okf)) {
      return { status: "warn", detail: "manuell auf nein gesetzt, Ableitung ergibt Aufzugspflicht — Landesbauordnung prüfen" };
    }
    return { status: "pass", detail: "keine Aufzugspflicht abgeleitet (LBO-abhängig)" };
  })();

  const items = [
    {
      key: "aufzug",
      label: "Aufzugspflicht & Kabine (Richtwert)",
      ...aufzugItem,
    },
    {
      key: "erschliessung",
      label: "Stufenlose Erschließung (Konzept)",
      status: erschliessung === "ja" ? "pass" : "warn",
      detail: erschliessung === "ja"
        ? "stufenlose Erschließung vorgesehen"
        : "stufenlose Erschließung fehlt — DIN 18040 / MBO §50",
    },
    {
      key: "erreichbar",
      label: "Barrierefrei erreichbare Wohnungen (Richtwert)",
      status: num(vorhErreichbar) >= erfErr ? "pass" : "warn",
      detail: `${de(vorhErreichbar)}/${de(erfErr)} barrierefrei erreichbare Wohnungen (mit Aufzug: alle Geschosse)`,
    },
    {
      key: "rollstuhl",
      label: "Rollstuhlgerechte Wohnungen (Richtwert)",
      status: num(quotePct) === 0 || num(vorhR) >= erfR ? "pass" : "warn",
      detail: num(quotePct) === 0
        ? "R-Quote 0 % — Landesbauordnung prüfen (teils feste Zahl/Quote gefordert)"
        : `${de(vorhR)}/${de(erfR)} rollstuhlgerechte Wohnungen bei ${de(quotePct)} % Quote`,
    },
    {
      key: "bewegung",
      label: "Bewegungsflächen (Richtwert)",
      status: num(bewegung) >= bewegungsflaeche(stufe) ? "pass" : "warn",
      detail: num(bewegung) >= bewegungsflaeche(stufe)
        ? `Bewegungsfläche ≥ ${de1(bewegungsflaeche(stufe))} m (Ausbaustufe ${stufe === "R" ? "R" : "B"}) eingehalten`
        : `Bewegungsfläche unter Zielwert ${de1(bewegungsflaeche(stufe))} m (B 1,20 / R 1,50 m, DIN 18040-2)`,
    },
    {
      key: "tuer",
      label: "Türbreiten & Türhöhe (Richtwert)",
      status: tuerBreiteOk(tuerBreite, stufe) && num(tuerHoehe) >= TUER_HOEHE ? "pass" : "warn",
      detail: tuerBreiteOk(tuerBreite, stufe) && num(tuerHoehe) >= TUER_HOEHE
        ? `Türbreite ${de1(tuerBreite)} m und Höhe ${de1(tuerHoehe)} m ausreichend (Ausbaustufe ${stufe === "R" ? "R" : "B"})`
        : "Türbreite B ≥ 0,80 / R ≥ 0,90 m, Höhe ≥ 2,05 m (DIN 18040-2) prüfen",
    },
    {
      key: "flur",
      label: "Flurbreite (Richtwert)",
      status: flurOk(flur) ? "pass" : "warn",
      detail: flurOk(flur)
        ? `Flurbreite ${de1(flur)} m ≥ 1,20 m eingehalten`
        : "Flurbreite unter 1,20 m (DIN 18040-2)",
    },
    {
      key: "sanitaer",
      label: "Sanitärräume (Richtwert)",
      status: sanitaerOk({ stufe: saniStufe, bewegung: saniBewegung, dusche: saniDusche, wcSeitlich: saniWcSeitlich, waschtisch: saniWaschtisch }) ? "pass" : "warn",
      detail: sanitaerOk({ stufe: saniStufe, bewegung: saniBewegung, dusche: saniDusche, wcSeitlich: saniWcSeitlich, waschtisch: saniWaschtisch })
        ? `Sanitärraum plausibel (Ausbaustufe ${saniStufe === "R" ? "R" : "B"})`
        : "R: 1,50 m vor Objekten, seitlich ≥ 0,90 m, bodengleiche Dusche, unterfahrbarer Waschtisch (DIN 18040-2)",
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}
