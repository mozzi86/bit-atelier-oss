// Wohnungs-Typen (Phase 61, Wohnungs-Werkstatt) — regelbasiertes Typen-
// Datenmodell + Bewohnbarkeits-Checks + WoFlV/MF-G-Flächen. Reine Lib,
// node-testbar; Schwester-Imports nur für fire.js (Rettungsweg, Don't-Hand-
// Roll) und raumklima.js (polygonAreaXZ). UI-Anschluss in Plan 61-05.
//
// KONZEPT-Charakter: Richtwert-Checks nach deutschem Baurecht, NUR
// pass/warn/offen — NIE fail. Der automatische Check ist KEIN
// Bauantrags-Nachweis (Ehrlichkeits-Konvention; Banner liegt beim UI-Plan).
//
// Quellen-Status je Konstante:
//   CITED   = Gesetzeswortlaut in der RESEARCH-Session verifiziert
//             (Belichtung: MBO §47 Abs. 1; Balkon/Dachschrägen: WoFlV §4).
//   [ASSUMED] = Richtwert aus Trainingswissen/Planwerk, nicht einzeln
//             verifiziert — als Konzept-Richtwert überschreibbar.

import { anleiterZulaessig, ANLEITER_TRAGBAR } from "@designer/lib/fire";
import { polygonAreaXZ, fensterZuRaeumen } from "@designer/lib/raumklima";

// Zahlen-Härtung (apartments.js-Muster): nie NaN/Infinity weiterreichen.
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const safeDiv = (a, b) => num(a) / Math.max(0.1, num(b));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --- Konstanten (Quellen-Status im Kommentar) --------------------------------

// Lichte Mindest-Raumhöhe Aufenthaltsraum (üblicher LBO-Wert, Länder abweichend).
export const RAUMHOEHE_MIN = 2.4; // [ASSUMED A1]
// Konstruktionsaufbau Rohdecke → lichte Höhe (Bodenbelag + Deckenputz/Abhang).
export const KONSTRUKTIONS_AUFBAU = 0.35; // [ASSUMED]
// Belichtung Aufenthaltsraum: Fensterfläche (Rohbaumaß) ≥ 1/8 Netto-Raumfläche.
export const BELICHTUNG_ANTEIL = 1 / 8; // CITED — MBO §47 Abs. 1
// Innenliegendes Bad/WC: zulässig mit ausreichender Lüftung (i. d. R.
// mechanisch), MBO §47 Abs. 2 erlaubt fensterlose Küchen/Bäder/WCs mit Lüftung.
export const BAD_LUEFTUNG_HINWEIS = "mechanische Lüftung erforderlich"; // [ASSUMED A2]
// Abstellraum je WE: kein bundeseinheitlicher Mindestwert; Richtwert 4–6 m²
// bzw. ~2 % Wohnfläche. Nutzer-überschreibbar.
export const ABSTELL_MIN_M2 = 4; // [ASSUMED A3]
// Balkon-/Terrassenanrechnung: in der Regel 1/4, höchstens 1/2.
export const BALKON_ANRECHNUNG_DEFAULT = 0.25; // CITED — WoFlV §4 Abs. 4
export const BALKON_ANRECHNUNG_MAX = 0.5;      // CITED — WoFlV §4 Abs. 4
// Dachschrägen-Anrechnung: < 1 m lichte Höhe 0 %, 1–2 m 50 %, ≥ 2 m 100 %.
export const DACHSCHRAEGE = { unter1m: 0, m1bis2: 0.5, ab2m: 1 }; // CITED — WoFlV §4 Abs. 2
// MF/G: Gewerbefläche nach gif-Richtlinie — Netto-Konzept ohne WoFlV-
// Sonderregeln (keine Balkon-/Dachschrägen-Anrechnung).
// [ASSUMED A4] — Detailregeln nicht einzeln verifiziert.

// Raum-Kategorien (art) — anschlussfähig an Phase 39 (PLAN_RAUMARTEN-Schlüssel
// wohnen/buero/laut/flur bleiben für raumartSchall reserviert).
const ART = {
  aufenthalt: "aufenthalt", // Wohnen/Schlafen/Kinder — Fensterpflicht
  kueche: "kueche",         // Küche oder Kochnische
  sanitaer: "sanitaer",     // Bad/WC
  abstell: "abstell",       // Abstellraum/HWR
  flur: "flur",             // Wohnungsflur/Erschließung
};

// Hilfsbaustein: kompakte Raumzeile für die Presets.
const R = (raum, art, min_m2, max_m2, fensterpflicht = false, extra = {}) =>
  ({ raum, art, min_m2, max_m2, fensterpflicht, ...extra });

// --- Typen-Katalog (volles Spektrum, Nutzer-Nachtrag Revision 1) -------------
//
// Zwei Preset-Gruppen (Feld `gruppe`, additiv zum Datenmodell):
//   "referenz" — REALER Wohnungsmix eines eigenen Referenzprojekts (2023),
//                angezeigt als „Referenzmix Laubengang" (Nutzer-PDFs Wohnungskonzept
//                Var a/b, privat — kein Projektname im Produkt, Nutzer 23.09.2026),
//                EOF-Wohnen, Erschließung Laubengang, M 1:500 — Kennwerte daraus
//                übernommen; die PDFs selbst werden nicht eingelesen).
//                Wo keine Spanne genannt ist: ±5 % Toleranzband [ASSUMED].
//   "standard" — „1–5 Zimmer (Richtwerte dt. Baurecht)": generische Bänder
//                [ASSUMED], im Editor anpassbar. PLUS ein Büro-/Gewerbe-Typ.
//
// Das Datenmodell erzwingt KEINE Kombinationsbeschränkung — alle Typen sind
// frei mischbar (Solver-Garantie aus Plan 61-03, „alle möglichkeiten").
export const WERKSTATT_TYPEN = [
  // --- Gruppe "referenz" — Referenzmix Laubengang (2023) ---------------------
  {
    key: "hd-2zi", name: "2-Zi/2P (Referenzmix)", gruppe: "referenz",
    nutzung: "wohnen", zimmer: 2,
    flaeche_m2: 54, min_m2: 53, max_m2: 55, // Quellen-Spanne 53–55
    balkon: { anzahl: 1, m2: 8 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 18, 28, true),
      R("Schlafen", ART.aufenthalt, 11, 16, true),
      R("Küche", ART.kueche, 6, 10, false),
      R("Bad", ART.sanitaer, 4, 7, false),
      R("Abstellraum", ART.abstell, 2, 4, false),
      R("Flur", ART.flur, 4, 7, false),
    ],
  },
  {
    key: "hd-3zi", name: "3-Zi/3P (Referenzmix)", gruppe: "referenz",
    nutzung: "wohnen", zimmer: 3,
    flaeche_m2: 74, min_m2: 73, max_m2: 75, // Quellen-Spanne 73–75
    balkon: { anzahl: 1, m2: 8 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 22, 32, true),
      R("Schlafen", ART.aufenthalt, 12, 17, true),
      R("Kind/Büro", ART.aufenthalt, 10, 14, true),
      R("Küche", ART.kueche, 7, 11, false),
      R("Bad", ART.sanitaer, 5, 8, false),
      R("Abstellraum", ART.abstell, 2, 4, false),
      R("Flur", ART.flur, 5, 8, false),
    ],
  },
  {
    key: "hd-4zi4p", name: "4-Zi/4P (Referenzmix)", gruppe: "referenz",
    nutzung: "wohnen", zimmer: 4,
    // Quellenangabe ~90 m² ohne Spanne → ±5 % Toleranzband [ASSUMED].
    flaeche_m2: 90, min_m2: 85.5, max_m2: 94.5,
    balkon: { anzahl: 1, m2: 8 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 24, 34, true),
      R("Schlafen", ART.aufenthalt, 13, 18, true),
      R("Kind 1", ART.aufenthalt, 10, 14, true),
      R("Kind 2/Büro", ART.aufenthalt, 9, 13, true),
      R("Küche", ART.kueche, 8, 12, false),
      R("Bad", ART.sanitaer, 5, 9, false),
      R("Gäste-WC", ART.sanitaer, 2, 4, false),
      R("Abstellraum", ART.abstell, 3, 5, false),
      R("Flur", ART.flur, 6, 9, false),
    ],
  },
  {
    key: "hd-4zi5p", name: "4-Zi/5P (Referenzmix)", gruppe: "referenz",
    nutzung: "wohnen", zimmer: 4,
    // Quellenangabe ~98 m² ohne Spanne → ±5 % [ASSUMED].
    flaeche_m2: 98, min_m2: 93.1, max_m2: 102.9,
    balkon: { anzahl: 1, m2: 8 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 26, 36, true),
      R("Schlafen", ART.aufenthalt, 14, 19, true),
      R("Kind 1", ART.aufenthalt, 11, 15, true),
      R("Kind 2", ART.aufenthalt, 10, 14, true),
      R("Küche", ART.kueche, 8, 13, false),
      R("Bad", ART.sanitaer, 6, 9, false),
      R("Gäste-WC", ART.sanitaer, 2, 4, false),
      R("Abstellraum", ART.abstell, 3, 5, false),
      R("Flur", ART.flur, 6, 10, false),
    ],
  },
  {
    key: "hd-5zi7p", name: "5-Zi/7P (Referenzmix)", gruppe: "referenz",
    nutzung: "wohnen", zimmer: 5,
    // Quellenangabe ~128 m² ohne Spanne → ±5 % [ASSUMED].
    flaeche_m2: 128, min_m2: 121.6, max_m2: 134.4,
    balkon: { anzahl: 1, m2: 10 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 30, 42, true),
      R("Schlafen", ART.aufenthalt, 14, 20, true),
      R("Kind 1", ART.aufenthalt, 11, 15, true),
      R("Kind 2", ART.aufenthalt, 11, 15, true),
      R("Kind 3/Büro", ART.aufenthalt, 10, 14, true),
      R("Küche", ART.kueche, 9, 14, false),
      R("Bad", ART.sanitaer, 6, 10, false),
      R("Gäste-WC", ART.sanitaer, 2, 4, false),
      R("Abstellraum", ART.abstell, 3, 6, false),
      R("Flur", ART.flur, 8, 12, false),
    ],
  },
  {
    // Sonderform Wohngemeinschaft: mehrere gleichwertige Individualräume +
    // Gemeinschafts-Küche/-Bäder (Plan-61-02-Behavior).
    key: "hd-5zi-wg", name: "5-Zi/5P-WG (Referenzmix)", gruppe: "referenz",
    nutzung: "wohnen", zimmer: 5,
    // Quellenangabe ~250 m² ohne Spanne → ±5 % [ASSUMED].
    flaeche_m2: 250, min_m2: 237.5, max_m2: 262.5,
    balkon: { anzahl: 1, m2: 12 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Individualraum 1", ART.aufenthalt, 14, 20, true),
      R("Individualraum 2", ART.aufenthalt, 14, 20, true),
      R("Individualraum 3", ART.aufenthalt, 14, 20, true),
      R("Individualraum 4", ART.aufenthalt, 14, 20, true),
      R("Individualraum 5", ART.aufenthalt, 14, 20, true),
      R("Gemeinschafts-Wohnen", ART.aufenthalt, 30, 45, true),
      R("Gemeinschaftsküche", ART.kueche, 12, 18, false),
      R("Bad 1", ART.sanitaer, 6, 9, false),
      R("Bad 2", ART.sanitaer, 6, 9, false),
      R("Gäste-WC", ART.sanitaer, 2, 4, false),
      R("Abstellraum", ART.abstell, 4, 7, false),
      R("Flur", ART.flur, 12, 18, false),
    ],
  },
  // --- Gruppe "standard" — „1–5 Zimmer (Richtwerte dt. Baurecht)" [ASSUMED] --
  {
    // 1-Zimmer-Apartment mit Sonderregeln [ASSUMED]: kombinierter Wohn-/
    // Schlafraum (Aufenthaltsraum, fensterpflichtig), Kochnische statt
    // separater Küche, Duschbad — validiereTyp akzeptiert das ohne warn.
    key: "st-1zi", name: "1-Zimmer-Apartment", gruppe: "standard",
    nutzung: "wohnen", zimmer: 1,
    flaeche_m2: 35, min_m2: 25, max_m2: 45,
    balkon: { anzahl: 0, m2: 0 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Schlafen", ART.aufenthalt, 16, 26, true),
      R("Kochnische", ART.kueche, 3, 6, false, { kochnische: true }),
      R("Duschbad", ART.sanitaer, 3, 6, false),
      R("Abstellnische", ART.abstell, 2, 4, false),
      R("Flur", ART.flur, 2, 5, false),
    ],
  },
  {
    key: "st-2zi", name: "2-Zimmer-Wohnung", gruppe: "standard",
    nutzung: "wohnen", zimmer: 2,
    flaeche_m2: 55, min_m2: 45, max_m2: 65,
    balkon: { anzahl: 1, m2: 6 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 18, 28, true),
      R("Schlafen", ART.aufenthalt, 11, 17, true),
      R("Küche", ART.kueche, 6, 10, false),
      R("Bad", ART.sanitaer, 4, 7, false),
      R("Abstellraum", ART.abstell, 2, 4, false),
      R("Flur", ART.flur, 4, 7, false),
    ],
  },
  {
    key: "st-3zi", name: "3-Zimmer-Wohnung", gruppe: "standard",
    nutzung: "wohnen", zimmer: 3,
    flaeche_m2: 75, min_m2: 65, max_m2: 85,
    balkon: { anzahl: 1, m2: 7 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 22, 32, true),
      R("Schlafen", ART.aufenthalt, 12, 17, true),
      R("Kind/Büro", ART.aufenthalt, 10, 14, true),
      R("Küche", ART.kueche, 7, 11, false),
      R("Bad", ART.sanitaer, 5, 8, false),
      R("Abstellraum", ART.abstell, 2, 4, false),
      R("Flur", ART.flur, 5, 8, false),
    ],
  },
  {
    key: "st-4zi", name: "4-Zimmer-Wohnung", gruppe: "standard",
    nutzung: "wohnen", zimmer: 4,
    flaeche_m2: 97, min_m2: 85, max_m2: 110,
    balkon: { anzahl: 1, m2: 8 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 25, 35, true),
      R("Schlafen", ART.aufenthalt, 13, 18, true),
      R("Kind 1", ART.aufenthalt, 10, 14, true),
      R("Kind 2/Büro", ART.aufenthalt, 9, 13, true),
      R("Küche", ART.kueche, 8, 12, false),
      R("Bad", ART.sanitaer, 5, 9, false),
      R("Abstellraum", ART.abstell, 3, 5, false),
      R("Flur", ART.flur, 6, 9, false),
    ],
  },
  {
    key: "st-5zi", name: "5-Zimmer-Wohnung", gruppe: "standard",
    nutzung: "wohnen", zimmer: 5,
    flaeche_m2: 125, min_m2: 110, max_m2: 140,
    balkon: { anzahl: 1, m2: 10 },
    raumartSchall: "wohnen",
    raumprogramm: [
      R("Wohnen/Essen", ART.aufenthalt, 30, 42, true),
      R("Schlafen", ART.aufenthalt, 14, 19, true),
      R("Kind 1", ART.aufenthalt, 11, 15, true),
      R("Kind 2", ART.aufenthalt, 10, 14, true),
      R("Büro/Gast", ART.aufenthalt, 9, 13, true),
      R("Küche", ART.kueche, 9, 13, false),
      R("Bad", ART.sanitaer, 6, 10, false),
      R("Gäste-WC", ART.sanitaer, 2, 4, false),
      R("Abstellraum", ART.abstell, 3, 6, false),
      R("Flur", ART.flur, 7, 11, false),
    ],
  },
  {
    // Gewerbe-/Büro-Einheit mit EIGENEM Regel-Set (Plan-2b): keine WoFlV,
    // MF/G-Flächenansatz [ASSUMED A4], Pflichtraum WC (ArbStättV-Anschluss),
    // Schallschutz-Raumart buero (bei lauter Nutzung "laut").
    key: "st-buero", name: "Büro-/Gewerbeeinheit", gruppe: "standard",
    nutzung: "gewerbe", zimmer: 0,
    flaeche_m2: 80, min_m2: 60, max_m2: 120,
    raumartSchall: "buero",
    raumprogramm: [
      R("Bürofläche 1", ART.aufenthalt, 20, 40, true),
      R("Bürofläche 2", ART.aufenthalt, 15, 30, true),
      R("WC", ART.sanitaer, 3, 6, false),
      R("Teeküche", ART.kueche, 4, 8, false),
      R("Flur", ART.flur, 5, 10, false),
    ],
  },
];

// --- validiereTyp -------------------------------------------------------------
//
// Prüft die strukturelle Vollständigkeit eines Typs. Rückgabe
// { ok, checks: [{ key, label, status, detail }] } — ok ist true, sobald der
// Typ strukturell benutzbar ist; Regelverstöße sind warns (nie fail).
// min > max wird normalisiert (geclampt) + warn — wirft nie.
export function validiereTyp(typIn) {
  const typ = typIn || {};
  const checks = [];
  const warn = (key, label, detail) => checks.push({ key, label, status: "warn", detail });
  const pass = (key, label, detail) => checks.push({ key, label, status: "pass", detail });

  const nutzung = typ.nutzung === "gewerbe" ? "gewerbe" : "wohnen";
  const programm = Array.isArray(typ.raumprogramm) ? typ.raumprogramm : [];

  // Flächen-Korridor härten + normalisieren (clampen, nicht werfen).
  let flaeche = Math.max(0, num(typ.flaeche_m2));
  let min = Math.max(0, num(typ.min_m2, flaeche));
  let max = Math.max(0, num(typ.max_m2, flaeche));
  if (min > max) {
    warn("korridor", "Flächen-Korridor", `min (${min}) > max (${max}) — normalisiert`);
    const t = min; min = max; max = t;
  }
  flaeche = clamp(flaeche, min || flaeche, max || flaeche);
  if (flaeche <= 0) warn("flaeche", "Zielfläche", "keine gültige Zielfläche angegeben");

  const hat = (pred) => programm.some(pred);
  const raeume = (pred) => programm.filter(pred);

  if (nutzung === "wohnen") {
    // Pflichträume: Bad/WC (sanitaer), Küche ODER Kochnische, Abstellraum.
    if (!hat((r) => r?.art === ART.sanitaer)) {
      warn("bad", "Pflichtraum Bad/WC", "kein Bad/WC im Raumprogramm (Pflichtraum)");
    } else pass("bad", "Pflichtraum Bad/WC", "vorhanden");

    const kueche = hat((r) => r?.art === ART.kueche);
    if (!kueche) warn("kueche", "Pflichtraum Küche", "weder Küche noch Kochnische im Raumprogramm");
    else pass("kueche", "Pflichtraum Küche/Kochnische", "Küche oder Kochnische vorhanden");

    if (!hat((r) => r?.art === ART.abstell)) {
      // [ASSUMED A3] — warn statt hart, Richtwert überschreibbar.
      warn("abstell", "Abstellraum", `fehlt — Richtwert ~${ABSTELL_MIN_M2} m² [ASSUMED], kein Pflichtkriterium`);
    } else pass("abstell", "Abstellraum", "vorhanden");

    // Fensterbedarf: JEDER Aufenthaltsraum braucht ein Fenster.
    const ohneFenster = raeume((r) => r?.art === ART.aufenthalt && !r?.fensterpflicht);
    if (ohneFenster.length) {
      warn("fenster", "Fensterbedarf Aufenthaltsraum",
        `${ohneFenster.length} Aufenthaltsraum/-räume ohne Fensterpflicht: ${ohneFenster.map((r) => r.raum).join(", ")}`);
    } else pass("fenster", "Fensterbedarf Aufenthaltsraum", "alle Aufenthaltsräume mit Fensterpflicht");
  } else {
    // Gewerbe-Regel-Set: WC Pflicht, KEINE WoFlV-Felder (MF/G statt WoFlV).
    if (!hat((r) => r?.art === ART.sanitaer)) {
      warn("wc", "Pflichtraum WC", "kein WC im Raumprogramm (ArbStättV-Anschluss)");
    } else pass("wc", "Pflichtraum WC", "vorhanden");

    if (typ.balkon && (num(typ.balkon.anzahl) > 0 || num(typ.balkon.m2) > 0)) {
      warn("gewerbe_woflv", "Gewerbe-Flächenregeln",
        "Balkon-/WoFlV-Felder werden bei Gewerbe ignoriert — MF/G-Ansatz statt WoFlV [ASSUMED]");
    }
    const rs = typ.raumartSchall;
    if (rs && rs !== "buero" && rs !== "laut") {
      warn("raumart", "Schallschutz-Raumart", `unerwartete Raumart „${rs}" — Gewerbe nutzt buero/laut`);
    }
  }

  // Raumzeilen-Härtung: min > max je Raum melden (num() macht NaN unmöglich).
  for (const r of programm) {
    if (r && num(r.min_m2) > num(r.max_m2)) {
      warn(`raum_${r.raum}`, `Raum „${r.raum}"`, "min > max — normalisiert");
    }
  }

  return {
    ok: !checks.some((c) => c.status === "warn"), // vollständig = ohne warn
    nutzung,
    flaeche_m2: flaeche,
    min_m2: min,
    max_m2: max,
    checks,
    warns: checks.filter((c) => c.status === "warn").length,
  };
}

// --- bewohnbarkeitChecks ------------------------------------------------------
//
// Bewohnbarkeits-Checks je WE nach deutschem Baurecht (Konzept-Richtwerte,
// NUR pass/warn/offen — nie fail). Gesamtreihenfolge der Schwere:
// pass < offen < warn.
//
// raeume = [{ name, art, flaeche_m2, fensterpflicht, fensterflaecheM2? }]
// (aggregierte Fensterfläche je Raum als Eingabe; die geometrische Zuordnung
// via fensterZuRaeumen kommt in Plan 61-04).
export function bewohnbarkeitChecks(opts) {
  const {
    we = "", raeume = [], storeyHeight = 3, level = 0,
    lueftungBad, amErschliessungsweg, anleiterArt, treppenraumOk,
  } = opts || {};
  const liste = Array.isArray(raeume) ? raeume : [];
  const checks = [];

  // 1) Belichtung Aufenthaltsräume — CITED MBO §47 Abs. 1: ≥ 1/8 Raumfläche.
  //
  // Drei Auflagen aus der externen Review 02.09. (M-10/M-11/M-12):
  //  - `fensterpflicht: false` bekommt GAR KEINEN Check. Vorher lief der Filter
  //    nur über `art`, und ein Hobbyraum ohne Fensterpflicht wurde trotzdem als
  //    "offen" gemeldet (Plan 61-04 Task 3 fordert ausdrücklich das Gegenteil).
  //  - Die Raumfläche wird bei 0 geklemmt. Ohne die Klemme ergab −100 m² einen
  //    Bedarf von −12,5 m² und damit ein grünes "0 ≥ −12,5" — ein Mangel, der
  //    als bestanden erschien.
  //  - Der Key trägt eine laufende Nummer. Zwei Räume "Kind" erzeugten zwei
  //    Einträge mit demselben Key; jeder Consumer mit `find(c => c.key === …)`
  //    sah nur den ersten (pass) und der zweite Mangel verschwand aus der Anzeige.
  const aufenthalte = liste.filter(
    (r) => r?.art === ART.aufenthalt && r?.fensterpflicht !== false,
  );
  aufenthalte.forEach((r, i) => {
    const f = Math.max(0, num(r.flaeche_m2));
    // BELICHTUNG_ANTEIL ist der ANTEIL (1/8), nicht der Teiler — also
    // multiplizieren. Vorher stand hier ein hartcodiertes safeDiv(f, 8): dieselbe
    // Zahl, aber die CITED-Konstante wirkte auf nichts (N-04).
    const bedarf = f * BELICHTUNG_ANTEIL;
    const name = r.name || `Raum ${i + 1}`;
    // Laufende Nummer im Key, lesbarer Name im Label.
    const key = `belichtung_${i + 1}_${name}`;
    if (r.fensterflaecheM2 === undefined || r.fensterflaecheM2 === null) {
      checks.push({
        key, label: `Belichtung ${name}`, status: "offen",
        detail: "keine Fensterfläche angegeben (1/8-Regel nicht prüfbar)",
      });
    } else if (num(r.fensterflaecheM2) >= bedarf - 1e-9) {
      checks.push({
        key, label: `Belichtung ${name}`, status: "pass",
        detail: `${num(r.fensterflaecheM2).toFixed(1)} m² ≥ ${bedarf.toFixed(1)} m² (1/8-Regel n. MBO §47, CITED)`,
      });
    } else {
      checks.push({
        key, label: `Belichtung ${name}`, status: "warn",
        detail: `${num(r.fensterflaecheM2).toFixed(1)} m² < ${bedarf.toFixed(1)} m² (1/8-Regel n. MBO §47, CITED)`,
      });
    }
  });

  // 2) Lichte Raumhöhe — [ASSUMED A1] 2,40 m; Abzug KONSTRUKTIONS_AUFBAU.
  const lichte = num(storeyHeight) - KONSTRUKTIONS_AUFBAU;
  checks.push({
    key: "hoehe", label: "Lichte Raumhöhe",
    status: lichte >= RAUMHOEHE_MIN - 1e-9 ? "pass" : "warn",
    detail: `${lichte.toFixed(2)} m lichte Höhe (${num(storeyHeight).toFixed(2)} m − ${KONSTRUKTIONS_AUFBAU} m Aufbau [ASSUMED]) — Richtwert ${RAUMHOEHE_MIN} m [ASSUMED A1]`,
  });

  // 3) 2. Rettungsweg — fire.js wiederverwenden (Don't Hand-Roll).
  // Brüstungshöhe ≈ level · storeyHeight + 0,9 m [ASSUMED, im Kommentar].
  //
  // Drei Auflagen aus der externen Review 02.09.:
  //  - M-01: `anleiterArt: "nein"` heißt in fire.js und im BrandschutzPlanner
  //    nein (baulicher 2. RW) und gilt dort als GESICHERT. Hier wurde daraus
  //    ein warn — derselbe UI-Wert bedeutete in zwei Panels das Gegenteil.
  //  - M-16: die Grenze kommt jetzt als ANLEITER_TRAGBAR aus fire.js statt als
  //    eigene 8. Plan 61-02 schließt eigene Leiter-Konstanten aus.
  //  - M-16: OHNE Angabe wird keine Drehleiter mehr unterstellt. Vorher ergab
  //    Level 6 bei 3 m Geschosshöhe (Brüstung 18,9 m) ein pass, ohne dass je
  //    geprüft war, ob eine Drehleiter dort aufgestellt werden kann. Für einen
  //    Sicherheitscheck ist "offen" die ehrliche Antwort.
  const bruestung = num(level) * num(storeyHeight) + 0.9; // [ASSUMED] Brüstung 0,9 m
  const baulicherZweiterRw = anleiterArt === "nein";
  const artGewaehlt = anleiterArt && !baulicherZweiterRw ? anleiterArt : null;
  const anleiterOk = artGewaehlt ? anleiterZulaessig(bruestung, artGewaehlt) : false;

  if (treppenraumOk || baulicherZweiterRw) {
    checks.push({
      key: "rettung2", label: "2. Rettungsweg", status: "pass",
      detail: treppenraumOk
        ? "zweiter Treppenraum vorhanden"
        : "baulicher 2. Rettungsweg angegeben (fire.js: anleiterArt = nein)",
    });
  } else if (anleiterOk) {
    checks.push({
      key: "rettung2", label: "2. Rettungsweg", status: "pass",
      detail: `Anleiterung ok (Brüstung ≈ ${bruestung.toFixed(1)} m, ${artGewaehlt === "tragbar" ? "tragbare Leiter" : "Drehleiter"}, fire.js)`,
    });
  } else if (!artGewaehlt) {
    // Ohne Angabe: unterhalb der Grenze der tragbaren Leiter ist die Annahme
    // vertretbar, darüber nicht — dann bleibt der Check offen statt grün.
    if (bruestung <= ANLEITER_TRAGBAR) {
      checks.push({
        key: "rettung2", label: "2. Rettungsweg", status: "pass",
        detail: `Anleiterung ok (Brüstung ≈ ${bruestung.toFixed(1)} m ≤ ${ANLEITER_TRAGBAR} m, tragbare Leiter, fire.js)`,
      });
    } else {
      checks.push({
        key: "rettung2", label: "2. Rettungsweg", status: "offen",
        detail: `Brüstung ≈ ${bruestung.toFixed(1)} m > ${ANLEITER_TRAGBAR} m — Rettungsweg nicht angegeben (Drehleiter-Aufstellfläche oder 2. Treppenraum nachweisen, fire.js)`,
      });
    }
  } else {
    checks.push({
      key: "rettung2", label: "2. Rettungsweg", status: "warn",
      detail: `Brüstung ≈ ${bruestung.toFixed(1)} m — mit ${artGewaehlt} nicht erreichbar und kein 2. Treppenraum angegeben (fire.js)`,
    });
  }

  // 4) Bad/WC innenliegend — mit Lüftung pass; ohne Angabe offen [ASSUMED A2].
  //
  // H-04 (externe Review 02.09.): Geprüft wurde nur der ERSTE Sanitärraum. Bei
  // [Bad mit Fenster, Gäste-WC ohne Fenster] meldete der Check "Bad/WC mit
  // Fenster" — das innenliegende WC ohne Lüftung wurde nie bewertet. Das betrifft
  // 6 der 12 Katalog-Typen (alle mit Bad UND Gäste-WC). Jetzt bekommt jeder
  // Sanitärraum seinen eigenen Check mit eigenem Key.
  const sanitaer = liste.filter((r) => r?.art === ART.sanitaer);
  sanitaer.forEach((raum, i) => {
    const name = raum.name || `Bad/WC ${i + 1}`;
    const key = sanitaer.length > 1 ? `badlueftung_${i + 1}` : "badlueftung";
    const label = sanitaer.length > 1 ? `Belüftung ${name}` : "Bad/WC-Belüftung";
    const fensterlos = num(raum.fensterflaecheM2) <= 0;
    if (!fensterlos) {
      checks.push({ key, label, status: "pass", detail: `${name} mit Fenster` });
    } else if (lueftungBad === true) {
      checks.push({ key, label, status: "pass", detail: `${name} innenliegend, mechanische Lüftung vorhanden` });
    } else if (lueftungBad === false) {
      checks.push({ key, label, status: "warn", detail: `${name} innenliegend ohne Lüftung — ${BAD_LUEFTUNG_HINWEIS} [ASSUMED A2]` });
    } else {
      checks.push({ key, label, status: "offen", detail: `${name} innenliegend, Lüftung nicht angegeben — ${BAD_LUEFTUNG_HINWEIS} [ASSUMED A2]` });
    }
  });

  // 5) Abstellraum — fehlt → warn mit Richtwert-Hinweis [ASSUMED A3].
  const abstell = liste.find((r) => r?.art === ART.abstell);
  if (abstell) {
    checks.push({
      key: "abstell", label: "Abstellraum",
      status: num(abstell.flaeche_m2) >= ABSTELL_MIN_M2 ? "pass" : "warn",
      detail: `${num(abstell.flaeche_m2).toFixed(1)} m² (Richtwert ≥ ${ABSTELL_MIN_M2} m² [ASSUMED A3])`,
    });
  } else {
    checks.push({ key: "abstell", label: "Abstellraum", status: "warn", detail: `fehlt — Richtwert ≥ ${ABSTELL_MIN_M2} m² [ASSUMED A3]` });
  }

  // 6) Wohnungseingang am Erschließungsweg.
  if (amErschliessungsweg === true) {
    checks.push({ key: "eingang", label: "Wohnungseingang", status: "pass", detail: "Eingang am Erschließungsweg" });
  } else if (amErschliessungsweg === false) {
    checks.push({ key: "eingang", label: "Wohnungseingang", status: "warn", detail: "Eingang NICHT am Erschließungsweg" });
  } else {
    checks.push({ key: "eingang", label: "Wohnungseingang", status: "offen", detail: "Lage des Eingangs nicht angegeben" });
  }

  // Gesamtstatus: schlechtester Einzelstatus in der Reihenfolge pass < offen < warn.
  const rang = { pass: 0, offen: 1, warn: 2 };
  const status = checks.reduce((s, c) => (rang[c.status] > rang[s] ? c.status : s), "pass");
  return { we, checks, status };
}

// --- WoFlV / MF-G ---------------------------------------------------------------
//
// Wohnflächenberechnung nach WoFlV (Konzept-Umsetzung, CITED-Werte oben):
//   - Räume 100 %, Dachschrägen: unter 1 m → 0 %, 1–2 m → 50 %, ab 2 m → 100 %
//   - Balkone: default 25 %, hart auf max. 50 % geclampt.
// Rückgabe { wohnflaeche_m2, details }.
export function woflvFlaeche(opts) {
  const { raeume = [], balkone = [] } = opts || {};
  const details = [];
  let summe = 0;

  for (const r of Array.isArray(raeume) ? raeume : []) {
    const f = Math.max(0, num(r?.flaeche_m2));
    const s = r?.dachschraege;
    if (s && (num(s.unter1m_m2) > 0 || num(s.zwischen1und2m_m2) > 0)) {
      const u1 = Math.min(Math.max(0, num(s.unter1m_m2)), f);
      const z = Math.min(Math.max(0, num(s.zwischen1und2m_m2)), f - u1);
      const rest = Math.max(0, f - u1 - z);
      const anteil = u1 * DACHSCHRAEGE.unter1m + z * DACHSCHRAEGE.m1bis2 + rest * DACHSCHRAEGE.ab2m;
      summe += anteil;
      details.push(`${r?.name || "Raum"}: ${f} m² → ${anteil.toFixed(1)} m² (Dachschrägen, CITED WoFlV §4 Abs. 2)`);
    } else {
      summe += f;
    }
  }

  for (const b of Array.isArray(balkone) ? balkone : []) {
    const f = Math.max(0, num(b?.m2));
    const anrechnung = clamp(num(b?.anrechnung, BALKON_ANRECHNUNG_DEFAULT), 0, BALKON_ANRECHNUNG_MAX);
    summe += f * anrechnung;
    details.push(`Balkon: ${f} m² × ${(anrechnung * 100).toFixed(0)} % (CITED WoFlV §4 Abs. 4)`);
  }

  return { wohnflaeche_m2: summe, details };
}

// MF/G-Gewerbefläche: Netto-Summe der Räume OHNE WoFlV-Sonderregeln [ASSUMED A4].
export function mfgFlaeche(opts) {
  const { raeume = [] } = opts || {};
  const summe = (Array.isArray(raeume) ? raeume : [])
    .reduce((s, r) => s + Math.max(0, num(r?.flaeche_m2)), 0);
  return {
    mfg_m2: summe,
    details: [`MF/G: Netto-Raumsumme ohne Balkon-/Dachschrägen-Sonderregeln [ASSUMED A4]`],
  };
}

// Geometrie-Helfer-Durchreiche für die späteren Pläne (61-04: Raumflächen aus
// Polygonen statt Flächeneingabe — Don't Hand-Roll).
export { polygonAreaXZ };

// --- Belichtungs-Verdrahtung (61-04 Task 3, TESS-04-Anschluss) ------------------
//
// belichtungJeWE: verdrahtet die geometrische Fenster→Raum-Zuordnung
// (fensterZuRaeumen, raumklima.js Phase 45) mit den bewohnbarkeitChecks —
// Belichtung 1/8 (CITED MBO §47) wird je Raum einer WE geometrisch bewertet.
// Rückgabe je WE: [{ we, checks, status }] — Räume ohne we (Flur/Kern)
// erscheinen nicht als WE.
//
// Semantik der Fensterfläche: Zone OHNE zugeordnete Fenster → offen (nicht
// warn — Fensterdaten unvollständig, kein Befund); mit Fenstern → Summe der
// Flächen gegen 1/8 der Raumfläche.
export function belichtungJeWE(opts) {
  const {
    zonen = [], fenster = [], waende = [], northAngle = 0,
    storeyHeight = 3, level, lueftungBad, amErschliessungsweg, anleiterArt, treppenraumOk,
  } = opts || {};
  const zs = Array.isArray(zonen) ? zonen : [];
  const { proRaum } = fensterZuRaeumen({ fenster, waende, zonen: zs, northAngle });

  // Gruppierung nach we (Zählung über das we-Feld, nicht über Zonen-Anzahl —
  // ersetzt das weJeTyp-Antipattern, RESEARCH Integrationskarte).
  const jeWe = new Map();
  for (const z of zs) {
    if (!z || !z.we) continue;
    if (!jeWe.has(z.we)) jeWe.set(z.we, []);
    jeWe.get(z.we).push(z);
  }

  const ergebnis = [];
  for (const [we, weZonen] of jeWe) {
    const raeume = weZonen.map((z) => {
      const key = `${z.level ?? 0}:${z.name ?? "Raum"}`;
      const eintrag = proRaum.get(key);
      const hatFenster = !!eintrag && eintrag.fenster.length > 0;
      const fensterflaeche = hatFenster
        ? eintrag.fenster.reduce((s, f) => s + Math.max(0, num(f?.flaeche)), 0)
        : undefined; // keine Zuordnung → offen statt warn
      return {
        name: z.name,
        art: z.art,
        flaeche_m2: num(z.flaeche_m2, polygonAreaXZ(z.points)),
        fensterpflicht: !!z.fensterpflicht,
        fensterflaecheM2: fensterflaeche,
      };
    });
    // H-03 (externe Review 02.09.): Das Geschoss kam aus den OPTIONEN, nicht aus
    // der Zone — ohne explizite Option also immer 0. Eine Wohnung im 5. OG bekam
    // damit einen grünen 2. Rettungsweg über die tragbare Leiter. Maßgeblich ist
    // das Geschoss der Zonen dieser WE; das höchste, falls eine WE (Reihenhaus,
    // Maisonette) über mehrere Geschosse läuft — die Anleiterung entscheidet sich
    // oben, nicht unten. Eine ausdrücklich übergebene Option gewinnt weiterhin,
    // damit Aufrufer ohne Zonen-Level nicht schlechter dastehen.
    const weLevel = level ?? weZonen.reduce((max, z) => Math.max(max, num(z?.level)), 0);
    const c = bewohnbarkeitChecks({
      we, raeume, storeyHeight, level: weLevel,
      lueftungBad, amErschliessungsweg, anleiterArt, treppenraumOk,
    });
    ergebnis.push({ we, checks: c.checks, status: c.status });
  }
  return ergebnis;
}

// WE-Zählhelfer (61-05): zählt WEs statt Zonen — Werkstatt über das we-Feld,
// Schnellmodus über den ·W-Namens-Marker (apartments.js-Äquivalent ohne
// Import-Abhängigkeit). Manuelle Zonen zählen nicht mit.
export function weGruppen(zonen) {
  const zs = Array.isArray(zonen) ? zonen : [];
  const werkstatt = new Set();
  const schnellmodus = new Set();
  for (const z of zs) {
    if (z?.we) werkstatt.add(z.we);
    else if (typeof z?.name === "string" && z.name.endsWith(" ·W")) schnellmodus.add(z.name.slice(0, -3));
  }
  return { werkstatt: werkstatt.size, schnellmodus: schnellmodus.size };
}
