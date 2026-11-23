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
// 115-03 (user wish W-1115-02): the building model ("Gebäudemodell", key `bim`) sits in area 3 "Gebäude" as its
// first tab — it IS the building; keys never change, only the grouping. Added: the direct views of the building
// model (floor plan / section / 3D, `?tab=bim&ansicht=…`) and the tabs per kind of project (reiterFuerProjektart).
//
// In:  nothing (static data + lucide icon components).
// Out: DESIGNER_BEREICHE (5 areas), DESIGNER_REITER (31 tabs), TAB_ALIAS,
//      BESTAND_LESART (73-02), BIM_ANSICHTEN + AUSGEBLENDET_JE_PROJEKTART (115-03) and the lookups the page needs.

import {
  MapPin, Boxes, ClipboardList, ShieldCheck, Building, Mountain, Frame, Trees,
  Thermometer, Flame, ClipboardCheck, Accessibility, Volume2,
  ThermometerSnowflake, Layers, ThermometerSun, HandCoins, LayoutTemplate,
  Puzzle, Sofa, Sun, Sparkles, CheckSquare, Calculator, Plug, CalendarRange,
  Droplets, LifeBuoy, ScanLine, Grid2x2, Scissors, Box,
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
  // 115-03: reads the shared building programme (storeys, outline) the massing writes, so it says "Baukörper" —
  // the building model moved to area 3 and can no longer be a prerequisite of a tab in area 2.
  { key: "buildings", label: "Gebäude & Nutzung", icon: Building, bereich: "baukoerper",
    braucht: ["Baukörper"], liefert: ["Nutzungsmix"], stand: "modell" },

  // --- 3 Gebäude ----------------------------------------------------------
  // 115-03 (W-1115-02): the building model (BIM studio: 3D, floor plan, section) is the FIRST tab of area 3 —
  // it was under "2 · Baukörper" and the user did not find the floor plan. The key stays `bim` (deep links).
  { key: "bim", label: "Gebäudemodell", icon: Boxes, bereich: "gebaeude",
    braucht: ["Baukörper"], liefert: ["Geschosse", "Bauteile"], stand: "modell" },
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
 * is hidden in either kind of work (BEST-02), the kind of work does not change the result. 115-03: the kind
 * of project (reiterFuerProjektart) does not change it either — a tab hidden for a single-family house still
 * resolves here and the page shows it (option `aktiv`).
 * @param {string|null|undefined} param raw URL value
 * @returns {string|null} a valid tab key, or null (caller falls back to 'site')
 */
export function aufloesen(param) {
  if (!param) return null;
  const key = TAB_ALIAS[param] ?? param;
  return istGueltigerTab(key) ? key : null;
}

// ---------------------------------------------------------------------------------------------------------
// 115-03: direct views of the building model
// ---------------------------------------------------------------------------------------------------------

/** Key of the building model tab (BIM studio). Deep links `?tab=bim` hang on it — never renamed. */
export const GEBAEUDEMODELL_TAB = "bim";

/** Name of the query parameter that carries the view of the building model: `?tab=bim&ansicht=grundriss`. */
export const ANSICHT_PARAMETER = "ansicht";

/**
 * The three views of the building model that can be opened directly, in the order of the direct buttons
 * (floor plan first — the way the user asked for). `id` equals the view state of BitBimStudio.jsx
 * ("3d" | "grundriss" | "schnitt"); `label` is the German UI text (goes through t()).
 * @type {ReadonlyArray<{ id: "grundriss"|"schnitt"|"3d", label: string, icon: import("lucide-react").LucideIcon }>}
 */
export const BIM_ANSICHTEN = Object.freeze([
  { id: "grundriss", label: "Grundriss", icon: Grid2x2 },
  { id: "schnitt", label: "Schnitt", icon: Scissors },
  { id: "3d", label: "3D", icon: Box },
]);

/**
 * Resolves a raw `?ansicht=` value to a view of the building model. Case and surrounding whitespace are
 * ignored; anything else returns null (the studio then keeps its own start view, 3D).
 * @param {string|null|undefined} param raw URL value
 * @returns {"grundriss"|"schnitt"|"3d"|null} a view id of BIM_ANSICHTEN, or null
 */
export function bimAnsichtAusParam(param) {
  if (typeof param !== "string") return null;
  const roh = param.trim().toLowerCase();
  return BIM_ANSICHTEN.find((a) => a.id === roh)?.id ?? null;
}

/**
 * Query string that opens the building model in one view, e.g. "tab=bim&ansicht=grundriss" (no leading "?").
 * @param {string|null} [ansicht] view id of BIM_ANSICHTEN; an unknown or missing value gives the plain tab link "tab=bim"
 * @returns {string} query string for /ComplexDesigner
 */
export function gebaeudemodellSuche(ansicht) {
  const a = bimAnsichtAusParam(ansicht);
  return `tab=${GEBAEUDEMODELL_TAB}` + (a ? `&${ANSICHT_PARAMETER}=${a}` : "");
}

// ---------------------------------------------------------------------------------------------------------
// 115-03: tabs per kind of project
// ---------------------------------------------------------------------------------------------------------

/**
 * Kinds of project the navigation knows, with their German UI name. Only the single-family house so far;
 * every other project (and every project the app cannot classify) shows all tabs, as before 115-03.
 * @type {Readonly<Record<string, { titel: string }>>}
 */
export const PROJEKTARTEN = Object.freeze({
  efh: Object.freeze({ titel: "Einfamilienhaus" }),
});

/**
 * Tabs hidden per kind of project (keys of DESIGNER_REITER). Hidden means: not in the tab row by default —
 * "Alle Reiter zeigen" brings them back and a deep link `?tab=<key>` still opens them.
 *
 * The list for the single-family house: proposal of plan 115-03, confirmed by the user on 16.11.2026 WITHOUT "Hochwasser"
 * (flood_risk stays visible — the HQ levels of the plot are entered there). Deliberately conservative — only what clearly
 * serves apartment blocks or workplaces, plus the tab the wish itself names as irrelevant for a house:
 *   - apartments  "Wohnungsplaner": spreads several dwellings over the floor area (apartment block).
 *   - compliance  "Wohnungen & Compliance": unit mix, quotas and parking key of a housing complex.
 *   - asr         "ASR-Raumdatenblatt": workplace regulations (Arbeitsstättenregeln) — offices, not homes.
 * Everything else stays visible, also "Wohnungs-Werkstatt" (it generates the rooms of the house and carries
 * the typology "efh") and "Gebäude & Nutzung" (the unit mix that makes the project a single-family house).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const AUSGEBLENDET_JE_PROJEKTART = Object.freeze({
  efh: Object.freeze(["compliance", "apartments", "asr"]),
});

/** Project types (Project.type) that can be a single-family house; empty = the project form was not filled in. */
const EFH_PROJEKT_TYPEN = new Set(["", "residential"]);

/**
 * Kind of project for the navigation, from what the project says about its use. Same rule as the density
 * figures (lib/kennzahlen.js, 108-12): a single-family house is a residential building with ONE dwelling —
 * the typology "efh" of the dwelling workshop, or a unit mix of exactly one dwelling. Stricter than there:
 * a mixed-use project never counts (it has more than the house), and neither does any non-residential type.
 * @param {{ projektTyp?: string|null, werkstattTyp?: string|null, wohneinheiten?: number|null }} [nutzung]
 *   projektTyp = Project.type key ("residential", "commercial", …), werkstattTyp = werkstatt_layer.typ,
 *   wohneinheiten = number of dwellings of the unit mix (pieces; 0 or null = no mix)
 * @returns {"efh"|null} key of PROJEKTARTEN, or null when the kind is not known (= show every tab)
 */
export function projektartVon(nutzung) {
  const typ = nutzung?.projektTyp == null ? "" : String(nutzung.projektTyp);
  if (!EFH_PROJEKT_TYPEN.has(typ)) return null;
  if (nutzung?.werkstattTyp === "efh") return "efh";
  return Number(nutzung?.wohneinheiten) === 1 ? "efh" : null;
}

/**
 * Keys of the tabs hidden for a kind of project, in registry order.
 * @param {string|null|undefined} projektart key of PROJEKTARTEN; unknown, null or undefined = nothing hidden
 * @returns {string[]} tab keys (new array)
 */
export function ausgeblendeteReiter(projektart) {
  const liste = projektart != null && Object.prototype.hasOwnProperty.call(AUSGEBLENDET_JE_PROJEKTART, projektart)
    ? AUSGEBLENDET_JE_PROJEKTART[projektart]
    : [];
  return DESIGNER_REITER.filter((r) => liste.includes(r.key)).map((r) => r.key);
}

/**
 * The visible tabs per area for a kind of project — what the tab row shows. Pure.
 * Default (unknown kind): every tab, exactly reiterImBereich() per area. An area never comes back empty: if a
 * list would hide all of its tabs, the area shows all of them (no dead step in the phase bar).
 * @param {string|null|undefined} projektart key of PROJEKTARTEN ("efh"); null/unknown = everything
 * @param {{ alle?: boolean, aktiv?: string|null }} [optionen] alle = the user switched "Alle Reiter zeigen" on;
 *   aktiv = key of the open tab — it stays in its row even when hidden (deep link to a hidden tab)
 * @returns {Record<string, Array<object>>} area id → registry entries in registry order (new arrays)
 */
export function reiterFuerProjektart(projektart, optionen = {}) {
  const weg = optionen.alle ? [] : ausgeblendeteReiter(projektart);
  /** @type {Record<string, Array<object>>} */
  const jeBereich = {};
  for (const b of DESIGNER_BEREICHE) {
    const alle = reiterImBereich(b.id);
    const sichtbar = alle.filter((r) => !weg.includes(r.key) || r.key === optionen.aktiv);
    jeBereich[b.id] = sichtbar.length ? sichtbar : alle;
  }
  return jeBereich;
}
