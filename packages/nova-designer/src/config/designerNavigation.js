// Designer navigation registry — the ONE source for the structure of the
// Komplex-Designer's 30 tabs (72-02, review finding N-09).
//
// Why this file exists: ComplexDesigner.jsx (30 KB) carried keys, labels, icons
// and order inline in its JSX, interleaved with the panels and their hooks. Every
// change to the ORDER forced an agent to rewrite the whole file — which is how
// earlier attempts broke imports and hooks. Same move as 65-05 did for the
// sidebar (navigation.js): structure as data, the JSX only reads.
//
// Deliberately NOT in here: the panel render components. The 30 <TabsContent>
// blocks stay exactly where they are, so their hooks keep their call order
// (Rules of Hooks) and the diff in ComplexDesigner.jsx stays small.
//
// In:  nothing (static data + lucide icon components).
// Out: DESIGNER_BEREICHE (5 areas), DESIGNER_REITER (31 tabs), TAB_ALIAS,
//      BESTAND_LESART (73-02) and the lookups the page needs.

import {
  MapPin, Boxes, ClipboardList, ShieldCheck, Building, Mountain, Frame, Trees,
  Thermometer, Flame, ClipboardCheck, Accessibility, Volume2,
  ThermometerSnowflake, Layers, ThermometerSun, HandCoins, LayoutTemplate,
  Puzzle, Sofa, Sun, Sparkles, CheckSquare, Calculator, Plug, CalendarRange,
  Droplets, LifeBuoy, ScanLine,
} from "lucide-react";

/**
 * The five work areas, in the order an architect walks a project.
 * `id` is internal, `titel` is the UI label (German), `kurz` the narrow variant.
 * @type {ReadonlyArray<{ id: string, titel: string, kurz: string }>}
 */
export const DESIGNER_BEREICHE = Object.freeze([
  { id: "standort", titel: "1 · Standort", kurz: "Standort" },
  { id: "baukoerper", titel: "2 · Baukörper", kurz: "Baukörper" },
  { id: "gebaeude", titel: "3 · Gebäude", kurz: "Gebäude" },
  { id: "nachweise", titel: "4 · Nachweise", kurz: "Nachweise" },
  { id: "ergebnis", titel: "5 · Ergebnis", kurz: "Ergebnis" },
]);

/**
 * All 31 tabs of the Komplex-Designer (30 until 73-09 added "bauaufnahme").
 *
 * `key` MUST equal the <TabsContent value="…"> in ComplexDesigner.jsx — store
 * fields, deep links and the headless suites hang on these strings, so they are
 * never renamed (the unit test enforces the match against the file itself).
 *
 * WATCH OUT: `studio` is the Massing-Studio, `massing` is the Baufeld-Planung.
 * The names were swapped historically; only the labels say what they are.
 *
 * `braucht` / `liefert`: one to three short terms for the PanelHeader — what a
 * tab reads and what it produces, so a newcomer sees the chain instead of a
 * wall of text.
 * `stand`: default badge — 'modell' = works on captured geometry, 'richtwert' =
 * computes on [ASSUMED] reference values, 'offen' = nothing to compute yet.
 * @type {ReadonlyArray<{ key: string, label: string, icon: Function, bereich: string,
 *   braucht: string[], liefert: string[], stand: 'modell'|'richtwert'|'offen' }>}
 */
export const DESIGNER_REITER = Object.freeze([
  // --- 1 Standort ---------------------------------------------------------
  { key: "site", label: "Standort & Karte", icon: MapPin, bereich: "standort",
    braucht: [], liefert: ["Koordinaten", "Parzelle"], stand: "modell" },
  { key: "terrain", label: "Gelände 3D", icon: Mountain, bereich: "standort",
    braucht: ["Koordinaten"], liefert: ["Geländemodell"], stand: "richtwert" },
  { key: "landscape", label: "Landschaft / Außenanlagen", icon: Trees, bereich: "standort",
    braucht: ["Parzelle"], liefert: ["Außenanlagen", "Stellplätze"], stand: "richtwert" },
  { key: "flood_risk", label: "Hochwasser", icon: Droplets, bereich: "standort",
    braucht: ["Koordinaten"], liefert: ["Hochwasser-Einstufung"], stand: "richtwert" },
  { key: "analysis", label: "Klima-Analyse", icon: Sun, bereich: "standort",
    braucht: ["Koordinaten"], liefert: ["Klimadaten"], stand: "richtwert" },

  // --- 2 Baukörper --------------------------------------------------------
  // 73-09: the survey of an existing building — deliveries, georeference, provenance tiles. Visible in
  // both kinds of work (extensions on existing buildings start with a survey too).
  { key: "bauaufnahme", label: "Bauaufnahme", icon: ScanLine, bereich: "baukoerper",
    braucht: [], liefert: ["Bauaufnahme", "Georeferenz"], stand: "offen" },
  { key: "studio", label: "Massing-Studio", icon: Boxes, bereich: "baukoerper",
    braucht: ["Parzelle"], liefert: ["Baukörper", "GRZ/GFZ", "BGF"], stand: "modell" },
  { key: "massing", label: "Baufeld-Planung", icon: Building, bereich: "baukoerper",
    braucht: ["Parzelle"], liefert: ["Baukörper", "Footprints"], stand: "modell" },
  { key: "bim", label: "Gebäudemodell", icon: Boxes, bereich: "baukoerper",
    braucht: ["Baukörper"], liefert: ["Geschosse", "Bauteile"], stand: "modell" },
  { key: "buildings", label: "Gebäude & Nutzung", icon: Building, bereich: "baukoerper",
    braucht: ["Gebäudemodell"], liefert: ["Nutzungsmix"], stand: "modell" },

  // --- 3 Gebäude ----------------------------------------------------------
  { key: "program", label: "Raumprogramm", icon: ClipboardList, bereich: "gebaeude",
    braucht: ["Gebäudemodell"], liefert: ["Räume", "NUF"], stand: "modell" },
  { key: "compliance", label: "Wohnungen & Compliance", icon: ShieldCheck, bereich: "gebaeude",
    braucht: ["Wohnungen"], liefert: ["Prüfungen"], stand: "richtwert" },
  { key: "apartments", label: "Wohnungsplaner", icon: LayoutTemplate, bereich: "gebaeude",
    braucht: ["Geschossfläche"], liefert: ["Wohnungen"], stand: "richtwert" },
  { key: "werkstatt", label: "Wohnungs-Werkstatt", icon: Puzzle, bereich: "gebaeude",
    braucht: ["Wohnungstypen"], liefert: ["Grundrisse", "WoFlV"], stand: "richtwert" },
  { key: "interiors", label: "Innenausbau", icon: Sofa, bereich: "gebaeude",
    braucht: ["Räume"], liefert: ["Möblierung"], stand: "richtwert" },

  // --- 4 Nachweise --------------------------------------------------------
  { key: "statics", label: "Statik", icon: Frame, bereich: "nachweise",
    braucht: ["Gebäudemodell"], liefert: ["Lastabtrag", "Querschnitte"], stand: "richtwert" },
  { key: "haustechnik", label: "Haustechnik (TGA)", icon: Thermometer, bereich: "nachweise",
    braucht: ["Räume"], liefert: ["TGA-Netze"], stand: "richtwert" },
  { key: "brandschutz", label: "Brandschutz", icon: Flame, bereich: "nachweise",
    braucht: ["Geschosse", "Räume"], liefert: ["Rettungswege"], stand: "richtwert" },
  { key: "asr", label: "ASR-Raumdatenblatt", icon: ClipboardCheck, bereich: "nachweise",
    braucht: ["Räume"], liefert: ["Raumdatenblatt"], stand: "richtwert" },
  { key: "barrierefreiheit", label: "Barrierefreiheit", icon: Accessibility, bereich: "nachweise",
    braucht: ["Räume"], liefert: ["DIN-18040-Checks"], stand: "richtwert" },
  { key: "acoustics", label: "Schallschutz", icon: Volume2, bereich: "nachweise",
    braucht: ["Bauteile"], liefert: ["DIN-4109-Checks"], stand: "richtwert" },
  { key: "waermebruecken", label: "Wärmebrücken", icon: ThermometerSnowflake, bereich: "nachweise",
    braucht: ["Bauteilaufbau"], liefert: ["Psi-Werte"], stand: "richtwert" },
  { key: "bauphysik", label: "Bauphysik", icon: Layers, bereich: "nachweise",
    braucht: ["Bauteilaufbau"], liefert: ["U-Werte", "Tauwasser"], stand: "richtwert" },
  { key: "raumklima", label: "Raumklima", icon: ThermometerSun, bereich: "nachweise",
    braucht: ["Räume", "Fenster"], liefert: ["Sommerlicher Wärmeschutz"], stand: "richtwert" },

  // --- 5 Ergebnis ---------------------------------------------------------
  { key: "energy", label: "Energie", icon: CheckSquare, bereich: "ergebnis",
    braucht: ["Bauteilaufbau", "Anlagen"], liefert: ["Endenergie", "GEG"], stand: "richtwert" },
  { key: "costs", label: "Kosten", icon: Calculator, bereich: "ergebnis",
    braucht: ["Mengen"], liefert: ["Kostenschätzung DIN 276"], stand: "richtwert" },
  { key: "funding", label: "Förderungen", icon: HandCoins, bereich: "ergebnis",
    braucht: ["Energiestandard"], liefert: ["Förderprogramme"], stand: "richtwert" },
  { key: "generative", label: "Generativ (KI)", icon: Sparkles, bereich: "ergebnis",
    braucht: ["Parzelle", "Raumprogramm"], liefert: ["Varianten"], stand: "richtwert" },
  { key: "integrations", label: "Integrationen", icon: Plug, bereich: "ergebnis",
    braucht: [], liefert: ["Schnittstellen"], stand: "offen" },
  { key: "planner", label: "Planer", icon: CalendarRange, bereich: "ergebnis",
    braucht: ["Projekt"], liefert: ["Terminplan"], stand: "richtwert" },
  { key: "support", label: "Hilfe", icon: LifeBuoy, bereich: "ergebnis",
    braucht: [], liefert: ["Erklärungen"], stand: "offen" },
]);

/**
 * 73-02: second reading of the registry for existing-building projects (bauartVon → "bestand"). In a
 * refurbishment the MEASUREMENT creates the geometry, so tabs that build on the design model read the
 * survey instead, and the room-based checks read the rooms of the survey model (IfcSpace). Only `braucht`
 * and `stand` change — keys, labels, areas and order stay, and NO tab is hidden (BEST-02: extension,
 * topping-up and courtyard infill are everyday refurbishment work). The five site tabs have no entry on
 * purpose: they read the same in both kinds of work — the probe that the distinction is technical, not
 * cosmetic. stand "gemessen" = works on measured geometry (fourth badge, BEST-03).
 * @type {Readonly<Record<string, { braucht: string[], stand?: 'modell'|'richtwert'|'offen'|'gemessen' }>>}
 */
export const BESTAND_LESART = Object.freeze({
  bauaufnahme: { braucht: ["Aufmaß / Scan"], stand: "gemessen" },
  bim: { braucht: ["Bauaufnahme"], stand: "gemessen" },
  buildings: { braucht: ["Bauaufnahme"], stand: "gemessen" },
  program: { braucht: ["Bauaufnahme"], stand: "gemessen" },
  statics: { braucht: ["Bauaufnahme"] },
  interiors: { braucht: ["Räume aus IfcSpace"] },
  haustechnik: { braucht: ["Räume aus IfcSpace"] },
  brandschutz: { braucht: ["Geschosse", "Räume aus IfcSpace"] },
  asr: { braucht: ["Räume aus IfcSpace"] },
  barrierefreiheit: { braucht: ["Räume aus IfcSpace"] },
  raumklima: { braucht: ["Räume aus IfcSpace", "Fenster"] },
});

/**
 * German deep-link aliases → internal tab keys (moved here from
 * ComplexDesigner.jsx:89 in 72-02 — one source). `/EnergyAnalysis` redirects to
 * `?tab=energie` since 72-01 A-13.
 * @type {Readonly<Record<string, string>>}
 */
export const TAB_ALIAS = Object.freeze({ energie: "energy" });

/** Lookup key → entry, built once. @type {Map<string, object>} */
const NACH_KEY = new Map(DESIGNER_REITER.map((r) => [r.key, r]));

/**
 * @param {string} key tab key
 * @returns {boolean} true when the key is one of the registered tabs
 */
export function istGueltigerTab(key) {
  return NACH_KEY.has(key);
}

/**
 * Area of a tab. Returns null for unknown keys ON PURPOSE — a silent fallback
 * would drop unknown tabs into area 1 without anyone noticing (exactly how the
 * rejected draft of this plan would have failed, with 24 of 30 tabs).
 * @param {string} key tab key
 * @returns {string|null} area id or null
 */
export function bereichFuerTab(key) {
  return NACH_KEY.get(key)?.bereich ?? null;
}

/**
 * @param {string} key tab key
 * @param {"neubau"|"bestand"} [bauart] kind of work (73-02); omitted or "neubau" returns the registry entry
 *   itself (byte-identical to before), "bestand" a copy with the second reading of BESTAND_LESART
 * @returns {object|null} the registry entry (label, icon, braucht, liefert, stand)
 */
export function reiterFuerTab(key, bauart) {
  const r = NACH_KEY.get(key) ?? null;
  if (!r || bauart !== "bestand" || !BESTAND_LESART[key]) return r;
  return { ...r, ...BESTAND_LESART[key], bauart: "bestand" };
}

/**
 * All tabs of one area, in registry order.
 * @param {string} bereichId area id
 * @returns {Array<object>} entries, empty array for an unknown area
 */
export function reiterImBereich(bereichId) {
  return DESIGNER_REITER.filter((r) => r.bereich === bereichId);
}

/**
 * Resolves a `?tab=` URL parameter: alias first, then validity. Deep-link guard (73-02): an unknown or
 * invalid key returns null and the page falls back to the first tab instead of an empty card; since no tab
 * is hidden in either kind of work (BEST-02), the kind of work does not change the result.
 * @param {string|null|undefined} param raw URL value
 * @returns {string|null} a valid tab key, or null (caller falls back to 'site')
 */
export function aufloesen(param) {
  if (!param) return null;
  const key = TAB_ALIAS[param] ?? param;
  return istGueltigerTab(key) ? key : null;
}
