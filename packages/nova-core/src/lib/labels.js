// labels.js — EINE Label-Abbildung für Projekt-Rohwerte (72-01 A-7).
//
// Warum hier (Befund N-07/N-12, REVIEW-NUTZBARKEIT-2026-09-18.md): die App
// hat ZWEI Datengenerationen — Seed-Projekte speichern deutsche Anzeigewerte
// („LP 5 - Ausführungsplanung", Köppen-Code „Cfb"), neue Formulare speichern
// Enum-Keys („concept", „temperate", 5). Ohne zentrale Abbildung mischen die
// Anzeigen beides („Review Testhaus — undefined", „Zone: temperate").
//
// Regel: in der DB stehen KEYS (oder Alt-Werte); die ANZEIGE läuft immer über
// diese Datei. `normalisiereProjekt` mappt alte Label-Werte beim LESEN auf
// Keys — db.json wird nie per Hand editiert (Seed-Migration in server/seed.js
// nutzt dieselbe Funktion beim Schreiben).
//
// In:  Rohwerte (Strings/Zahlen) aus Datensätzen.
// Out: deutsche Anzeigelabels bzw. normalisierte Datensatz-Kopien.
// Pure, node-testbar — keine React-/DOM-Importe.

// --- Anzeigelabels je Key ----------------------------------------------------

/** Projekttyp (Project.type) → deutsches Label. */
export const TYPE_LABELS = {
  residential: "Wohnen",
  commercial: "Gewerbe",
  institutional: "Öffentlich/Institutionell",
  mixed_use: "Mischnutzung",
  heritage_conservation: "Denkmalpflege",
  urban_development: "Stadtentwicklung",
};

/** Projektstatus (Project.status) → deutsches Label. */
export const STATUS_LABELS = {
  concept: "Konzept",
  feasibility: "Machbarkeit",
  design: "Entwurfsplanung",
  design_development: "Entwurfsplanung",
  technical_design: "Ausführungsplanung",
  construction: "Im Bau",
  handover: "Übergabe",
  completed: "Fertiggestellt",
  operation: "Betrieb",
};

/** Klimazone (Project.climate_zone) → deutsches Label. */
export const CLIMATE_ZONE_LABELS = {
  tropical: "Tropisch",
  subtropical: "Subtropisch",
  temperate: "Gemäßigt",
  continental: "Kontinental",
  polar: "Polar",
  mediterranean: "Mediterran",
  arid: "Trocken (arid)",
};

/** Energiestandard (Project.energy_target) → deutsches Label. */
export const ENERGY_TARGET_LABELS = {
  passive_house: "Passivhaus",
  kfw_55: "KfW 55",
  kfw_40: "KfW 40",
  net_zero: "Netto-Null",
  plus_energy: "Plusenergie",
};

/**
 * Fallback-Anzeige: bekannter Key → Label, unbekannter Wert unverändert,
 * leer/undefined → Gedankenstrich (nie „undefined" im Text, Befund N-07).
 * @param {Record<string, string>} map Label-Tabelle
 * @param {string|null|undefined} value Rohwert aus dem Datensatz
 * @returns {string} Anzeigetext
 */
export const labelFor = (map, value) => {
  if (value == null || value === "") return "—";
  return map[value] || String(value);
};

// --- Normalisierung: alte Label-Werte → Keys (beim LESEN) --------------------

// Deutsche Status-Labels (Seed-Generation) → Key. Rückwärts abbildbar, weil
// jeder Label-Text genau einem Key entspricht („Entwurfsplanung" → design:
// design_development bleibt als Alias-Key gültig).
const STATUS_VON_LABEL = {
  "Konzept": "concept",
  "Machbarkeit": "feasibility",
  "Entwurfsplanung": "design",
  "Ausführungsplanung": "technical_design",
  "Im Bau": "construction",
  "Übergabe": "handover",
  "Fertiggestellt": "completed",
  "Betrieb": "operation",
};

// Köppen-Klimaklassifikation (Seed: alle deutschen Standorte „Cfb") →
// vereinfachte Zonen-Keys dieser App. Cfa/Cfb/Cfc = gemäßigtes Klima.
const CLIMATE_VON_KOEPPEN = {
  Cfa: "temperate",
  Cfb: "temperate",
  Cfc: "temperate",
  Dfa: "continental",
  Dfb: "continental",
  Dfc: "continental",
  BSk: "arid",
  BWk: "arid",
};

// Deutsche Klimazonen-Labels (Formular-Generation vor Key-Umstellung) → Key.
const CLIMATE_VON_LABEL = {
  "Tropisch": "tropical",
  "Subtropisch": "subtropical",
  "Gemäßigt": "temperate",
  "Kontinental": "continental",
  "Polar": "polar",
  "Mediterran": "mediterranean",
  "Trocken (arid)": "arid",
};

/**
 * HOAI-Phase normalisieren: „LP 5 - Ausführungsplanung" → 5, Zahl bleibt Zahl,
 * „5" → 5. Unbrauchbar → null (Anzeige zeigt dann „—", nie „undefined").
 * @param {string|number|null|undefined} wert Rohwert aus Project.hoai_phase
 * @returns {number|null} Phase 1–9 oder null
 */
export function normalisiereHoaiPhase(wert) {
  if (wert == null || wert === "") return null;
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  const m = String(wert).match(/LP\s*(\d)/i) || String(wert).match(/^\s*(\d)\s*$/);
  return m ? Number(m[1]) : null;
}

/**
 * Klimazone normalisieren: Key bleibt Key, Köppen-Code und deutsches Label
 * werden gemappt, Unbekanntes bleibt unverändert (Anzeige-Fallback).
 * @param {string|null|undefined} wert Rohwert aus Project.climate_zone
 * @returns {string|null} Zonen-Key (z. B. "temperate") oder null bei leer
 */
export function normalisiereKlimazone(wert) {
  if (wert == null || wert === "") return null;
  const s = String(wert);
  if (CLIMATE_ZONE_LABELS[s]) return s; // schon ein Key
  return CLIMATE_VON_KOEPPEN[s] || CLIMATE_VON_LABEL[s] || s;
}

/**
 * Projektstatus normalisieren: Key bleibt Key, deutsches Seed-Label → Key.
 * @param {string|null|undefined} wert Rohwert aus Project.status
 * @returns {string|null} Status-Key (z. B. "concept") oder null bei leer
 */
export function normalisiereStatus(wert) {
  if (wert == null || wert === "") return null;
  const s = String(wert);
  if (STATUS_LABELS[s]) return s;
  return STATUS_VON_LABEL[s] || s;
}

/**
 * Projektdatensatz beim LESEN normalisieren (status/climate_zone/hoai_phase).
 * Ändert NICHTS am Eingabeobjekt — liefert eine flache Kopie mit Keys.
 * Filter/Vergleiche (Projects.jsx, Dashboard-Donut) arbeiten damit auf einer
 * Wertebasis mit neuen Datensätzen; die Anzeige läuft über labelFor.
 * @param {Record<string, any>} projekt Projektdatensatz
 * @returns {Record<string, any>} Kopie mit normalisierten status/climate_zone/hoai_phase
 */
export function normalisiereProjekt(projekt) {
  if (!projekt || typeof projekt !== "object") return projekt;
  return {
    ...projekt,
    status: normalisiereStatus(projekt.status),
    climate_zone: normalisiereKlimazone(projekt.climate_zone),
    hoai_phase: normalisiereHoaiPhase(projekt.hoai_phase),
  };
}

/**
 * ProjektLISTE normalisieren (für bitApi-Antworten an Anzeigestellen).
 * @param {Array<Record<string, any>>} liste Projekt-Datensätze
 * @returns {Array<Record<string, any>>} neue Liste mit normalisierten Kopien
 */
export function normalisiereProjekte(liste) {
  return Array.isArray(liste) ? liste.map(normalisiereProjekt) : [];
}

// --- A-8 (72-01): Klimazone automatisch aus dem Standort --------------------

// [ASSUMED] DACH-Stichwörter im Standort-Text → gemäßigtes Klima (Köppen Cfb,
// in ganz DE/AT/CH dominant). Bewusst konservativ: nur eindeutige Länder- und
// Regionen-Keywords, keine Stadtliste. Einheit: keine (Kategorie-Mapping).
// Quelle: Review §3 A-8 (18.09.2026) — „DE/AT/CH → gemäßigt".
const DACH_KEYWORDS = [
  "deutschland", "germany", "österreich", "oesterreich", "austria",
  "schweiz", "switzerland", "bayern", "bavaria", "baden-württemberg",
  "hessen", "nordrhein", "sachsen", "thüringen", "thueringen", "tirol",
  "vorarlberg", "salzburg", "steiermark", "kärnten", "kaernten",
];
// Zusätzlich deutsche Städte/Regionen aus Seed + Review (Nürnberg, Frankfurt,
// München, Hamburg, Hofheim …) — [ASSUMED] Kurzliste, erweiterbar.
const DACH_CITIES = [
  "nürnberg", "nuernberg", "frankfurt", "münchen", "muenchen", "hamburg",
  "berlin", "köln", "koeln", "stuttgart", "düsseldorf", "duesseldorf",
  "leipzig", "dortmund", "essen", "bremen", "dresden", "hannover",
  "hofheim", "erlangen", "fürth", "fuerth", "würzburg", "wuerzburg",
  "innsbruck", "wien", "vienna", "graz", "linz", "zürich", "zuerich",
  "bern", "basel", "genf", "geneva", "lausanne", "luzern",
];

/**
 * Klimazone aus dem Standort-Text ableiten (A-8).
 * @param {string|null|undefined} standort Project.location — Freitext
 *   („Stadt, Land") oder Objekt mit address/city/country
 * @returns {string|null} Zonen-Key ("temperate" für DACH) oder null, wenn
 *   nichts erkannt wurde — das Feld bleibt dann leer (kein Ratespiel).
 */
export function klimazoneAusStandort(standort) {
  const text = typeof standort === "string"
    ? standort
    : `${standort?.address || ""} ${standort?.city || ""} ${standort?.country || ""}`;
  const s = text.toLowerCase().trim();
  if (!s) return null;
  // Ländercode DE/AT/CH als eigenes Wort (Seed: location.country = "DE").
  if (/\b(de|at|ch)\b/.test(s)) return "temperate";
  if (DACH_KEYWORDS.some((k) => s.includes(k))) return "temperate";
  if (DACH_CITIES.some((k) => s.includes(k))) return "temperate";
  return null;
}
