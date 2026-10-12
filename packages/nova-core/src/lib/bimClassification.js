// Bauteil-Klassifizierung (Phase 25 — AVA filter-basierte Mengenermittlung).
// Liefert eine normalisierte, flache Liste klassifizierter Bauteile
//   { id, kind, kg, gewerk, schicht:string[], status, mengen:{area,volume,length,count} }
// als gemeinsame Quelle für die Filter-Engine (src/lib/avaFilters.js) — nach dem
// NOVA-AVA-Leitprinzip: Menge = WAS-Filter (KG/Gewerk/Schicht) ∩ ZUSTAND-Filter (Status).
//
// Ein echter IFC-Import (web-ifc, Archicad-Property-Sets/Klassifizierung) ist bewusst
// OUT-OF-SCOPE dieser Phase — ein späterer Importer müsste NUR dieselbe Liste befüllen
// (Property-Sets → kg/gewerk/schicht/status mappen), danach greifen dieselben Filter
// unverändert. Das grobe BIT-BIM-Demo-Modell nutzt dieselbe Methode bei niedrigerer
// Granularität (synthHull-Fallback für Modelle ohne gezeichnete Custom-Elemente).
//
// ALLE Vokabulare sind [ASSUMED] überschreibbare Projekt-Defaults — KEINE
// normverbindlichen Kostengruppen (DIN 276 nur als Orientierung, Schichten aus den
// Demo-Composites gespiegelt, Gewerke aus den bestehenden trade-Werten).
//
// Self-contained: KEINE @/-Alias-Imports (node-Smoke-Testbarkeit, Muster src/lib/fire.js)
// — Geometrie-Helfer inline (Polygonfläche/-umfang; die frühere Kopiervorlage
//   @ava/lib/bimQuantities.js ist in Phase 33/W3 entfallen).
// Einzige Ausnahme: der paket-interne, ebenfalls isomorphe Katalog-Resolver (kataloge.js),
// weil die Status-Normalisierung genau EINMAL existieren darf (T-33-04).

import { normalisiereStatus } from "./kataloge.js";
// 89-03: workshop components (walls/doors) as classified elements.
import { werkstattBauteile } from "./werkstattBauteile.js";

// Defensive, nicht-negative, endliche Zahl.
const num = (x) => Math.max(0, Number(x) || 0);

// --- Inline-Geometrie (bewusst lokal, kein Paket-übergreifender Import) --------------

const polygonArea = (pts) => {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
};

const polygonPerimeter = (pts) => {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return s;
};

const wallLength = (w) =>
  w?.a && w?.b ? Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) : 0;

// Default-Footprint (Kopie aus buildingModel.js DEFAULT_FOOTPRINT — nicht importiert).
const DEFAULT_FOOTPRINT = [
  { x: -10, z: -7 },
  { x: 10, z: -7 },
  { x: 10, z: 7 },
  { x: -10, z: 7 },
];

// --- Klassifizierungs-Vokabulare (überschreibbare Projekt-Defaults) -------------------

// [ASSUMED A1] Kostengruppen-Katalog: DIN-276-Bauteilgruppen als Basis, projektspezifisch
// erweiterbar (Feingliederung eines Referenzprojekts wie „342 Nichttragende Innenwände" bewusst
// NICHT hart kodiert). KEINE normverbindliche Zuordnung.
export const KG_KATALOG = {
  "320": "Gründung, Unterbau",
  "330": "Außenwände / Vertikale Baukonstruktionen",
  "340": "Innenwände",
  "350": "Decken / Horizontale Baukonstruktionen",
  "360": "Dächer",
  "390": "Sonstige Baukonstruktionen",
};

// [ASSUMED A2] Gewerke: exakt die bestehenden trade-Werte des LV + Trockenbau.
export const GEWERKE = ["Rohbau", "Ausbau", "Fassade", "TGA", "Dach", "Erdarbeiten", "Trockenbau"];

// [ASSUMED A3] Schicht-/Baustoff-Katalog: spiegelt die WALL_COMPOSITES-Skins des
// Demo-Modells (Stahlbeton/Klinker/Dämmung/KS/GK/Holz) + Putz. Reale Baustoffe wie
// Asbest fehlen bewusst — genau das erzeugt die gewollte Lücken-Warnung (0 Treffer).
export const SCHICHTEN = ["Stahlbeton", "Klinker", "Dämmung", "Kalksandstein", "Gipskarton", "Holz", "Putz"];

// [ASSUMED A4] Status-Achse (ZUSTAND-Filter). KEIN Default mehr: ein Bauteil ohne
// belegten Status ist `null` ("unbekannt"), nicht "neubau" (Phase 33 / L8).
export const STATUS_WERTE = ["abbruch", "neubau", "bestand"];
export const STATUS_LABEL = { abbruch: "Abbruch", neubau: "Neubau", bestand: "Bestand" };

// Sentinel für die UI: `status === null` ist ein echter Zustand („das Modell sagt es
// nicht") und muss sichtbar sein. Ein leeres Select-Feld würde als „egal" gelesen.
export const STATUS_UNBEKANNT = "unbekannt";
export const STATUS_WERTE_UI = [...STATUS_WERTE, STATUS_UNBEKANNT];

// --- Status-Normalisierung: GENAU EINE Stelle (T-33-04) ---------------------------------
//
// Jeder Pfad im Repo, der einen Status-Rohwert sieht (IFC-Pset, Pipeline-Export,
// Filter-Eingabe, Import-Bundle), ruft `normalizeStatus`. Die Abbildung selbst steht
// im Katalog `StatusKonvention` (büroweit editierbar) und wird von
// `kataloge.normalisiereStatus` aufgelöst — hier liegt bewusst KEINE zweite Tabelle.
//
// Ein Casing-Mismatch ("Bestand" vs. "bestand") ergäbe sonst 0 Treffer OHNE
// Fehlermeldung; deshalb ist ein unbekannter Wert `null` PLUS Warnung, nie ein Default.

/**
 * Status-Rohwert → interne Schreibweise (`"bestand"|"neubau"|"abbruch"|null`).
 * @param {*} raw Rohwert aus IFC-Pset, Pipeline oder UI.
 * @param {object|null} snapshot optionaler Katalog-Snapshot (`{ StatusKonvention: [...] }`).
 * @returns {"bestand"|"neubau"|"abbruch"|null}
 */
export function normalizeStatus(raw, snapshot = null) {
  return normalisiereStatus(raw, snapshot);
}

/** 89-04 (D-BW-03): display text of an element without status in the viewer and counters. */
export const STATUS_OHNE_LABEL = "ohne Status";

/**
 * Count elements per status (89-04). `null`/unknown values count as "ohne" — never as "neubau".
 * @param {Array<{status?: string|null}>} elemente classified or IFC elements
 * @returns {{abbruch: number, neubau: number, bestand: number, ohne: number}}
 */
export function statusZaehler(elemente = []) {
  const z = { abbruch: 0, neubau: 0, bestand: 0, ohne: 0 };
  for (const el of elemente || []) {
    const s = el?.status;
    if (s === "abbruch" || s === "neubau" || s === "bestand") z[s] += 1;
    else z.ohne += 1;
  }
  return z;
}

/** Anzeigetext eines internen Status — `null` wird sichtbar als „unbekannt". */
export function statusAnzeige(intern) {
  return STATUS_LABEL[intern] || "unbekannt";
}

// --- 73-04 (BEST-04): Erfassungsgrad — the SECOND axis of an element, right below the status axis on
// purpose so nobody opens a second table. Status says WHAT an element is (bestand/abbruch/neubau), the
// Erfassungsgrad says HOW WELL we know it: in a new build the decision creates the geometry (always exact),
// in an existing building the measurement does — element by element with different reliability.
// `null` = visibly unknown; there is NO default anywhere (a silent "gemessen" would turn an assumption
// into a measurement — exactly the liability case this axis exists for).
export const ERFASSUNG_WERTE = ["gemessen", "abgeleitet", "altplan", "angenommen"];
export const ERFASSUNG_LABEL = { gemessen: "Gemessen", abgeleitet: "Abgeleitet", altplan: "Altplan", angenommen: "Annahme" };
/** Reliability rank (higher = better known); a finding may only raise it (73-10 "hochstufen"). */
export const ERFASSUNG_RANG = Object.freeze({ angenommen: 1, altplan: 2, abgeleitet: 3, gemessen: 4 });
export const ERFASSUNG_UNBEKANNT = "unbekannt";

// Raw spellings seen in IFC psets, survey exports and the UI → internal value. Unknown → null (no default).
const ERFASSUNG_SYNONYME = {
  gemessen: "gemessen", aufmass: "gemessen", "aufmaß": "gemessen", scan: "gemessen", punktwolke: "gemessen", measured: "gemessen",
  abgeleitet: "abgeleitet", derived: "abgeleitet", interpoliert: "abgeleitet",
  altplan: "altplan", archivplan: "altplan", bestandsplan: "altplan", "as-built": "altplan", asbuilt: "altplan",
  angenommen: "angenommen", assumed: "angenommen", "geschätzt": "angenommen", geschaetzt: "angenommen", regelaufbau: "angenommen",
};

/**
 * Erfassungsgrad raw value → internal spelling, or null. Never a default.
 * @param {*} raw value from IFC pset, survey export or UI (case-insensitive)
 * @returns {"gemessen"|"abgeleitet"|"altplan"|"angenommen"|null}
 */
export function normalizeErfassung(raw) {
  if (raw == null) return null;
  const k = String(raw).trim().toLowerCase();
  return /** @type {any} */ (ERFASSUNG_SYNONYME[k] ?? null);
}

/** Display text of an internal Erfassungsgrad — `null` is visibly "unbekannt". */
export function erfassungAnzeige(intern) {
  return ERFASSUNG_LABEL[intern] || ERFASSUNG_UNBEKANNT;
}

/**
 * 73-04: schema of a documented deviation from a current rule in an existing building (third check exit
 * "Abweichung / Bestandsschutz", 73-13; inherited by 71-10). Defined ONCE here so the check, the finding
 * list and the export share one shape. A deviation is never a pass: it carries a reason, a compensation
 * and the state of the application to the authority.
 */
export const ABWEICHUNG_SCHEMA = Object.freeze({
  felder: Object.freeze(["regel_id", "art", "begruendung", "kompensation", "antrag_status", "datum"]),
  arten: Object.freeze({ bestandsschutz: "Bestandsschutz", abweichung: "Abweichung (Landesbauordnung)", befreiung: "Befreiung" }),
  antragStatus: Object.freeze({ offen: "offen", beantragt: "beantragt", genehmigt: "genehmigt", abgelehnt: "abgelehnt" }),
});

// --- 73-04 (BEST-09): provenance of a build-up (Bauteilaufbau). In an existing building the WALL_COMPOSITES
// are reference values, not the real wall. Acoustics, thermal bridges, building physics and energy keep
// computing (no switch-off) but name their basis and are raised after an opening.
export const AUFBAU_HERKUNFT = Object.freeze({ oeffnung: "Bauteilöffnung", archivplan: "Archivplan", regelaufbau: "Regelaufbau angenommen" });

/**
 * Basis of the build-up figures for the tab header.
 * @param {"neubau"|"bestand"} bauart kind of work (bauartVon)
 * @param {*} herkunft stored provenance (project.aufbau_herkunft) — raw, normalised here
 * @returns {{herkunft: "oeffnung"|"archivplan"|"regelaufbau"|null, text: string|null}} text null in a new
 *   build (the planned build-up IS the truth there)
 */
export function aufbauGrundlage(bauart, herkunft) {
  if (bauart !== "bestand") return { herkunft: null, text: null };
  const h = Object.prototype.hasOwnProperty.call(AUFBAU_HERKUNFT, herkunft) ? /** @type {"oeffnung"|"archivplan"|"regelaufbau"} */ (herkunft) : null;
  if (!h) return { herkunft: null, text: "Bauteilaufbau: Grundlage nicht angegeben — es gelten Regelaufbauten (Richtwerte); im Reiter Bauphysik festlegen." };
  const zusatz = h === "oeffnung" ? "" : " — nach einer Bauteilöffnung hochstufen";
  return { herkunft: h, text: `Bauteilaufbau: ${AUFBAU_HERKUNFT[h]}${zusatz}.` };
}

/**
 * Wie `normalizeStatus`, liefert aber zusätzlich die Warnung für `warnungen[]`.
 * @returns {{status: string|null, warnung: string|null}}
 */
export function normalizeStatusMitWarnung(raw, snapshot = null) {
  const status = normalizeStatus(raw, snapshot);
  if (status) return { status, warnung: null };
  const roh = raw == null || String(raw).trim() === "" ? "(kein Wert)" : String(raw).trim();
  return { status: null, warnung: `Status nicht belegt oder unbekannt: ${roh}` };
}

// --- Auto-Ableitung (überschreibbar durch eigene Element-Attribute) --------------------

// [ASSUMED A3] Composite → Schichten: spiegelt die WALL_COMPOSITES-Skins
// (buildingModel.js — single24/cavity/timber). Unbekannt/undefined → [].
export function schichtFromComposite(compositeId) {
  const map = {
    single24: ["Stahlbeton"],
    cavity: ["Klinker", "Dämmung", "Kalksandstein"],
    timber: ["Holz", "Dämmung"],
  };
  return map[compositeId] || [];
}

// [ASSUMED A1] Elementart → Kostengruppe (DIN-276-Orientierung, nicht normverbindlich).
export function kgFromKind(kind) {
  const map = {
    "wall-inner": "340",
    "wall-hull": "330",
    column: "330",
    slab: "350",
    roof: "360",
    floorplate: "320",
    window: "330",
    door: "340",
    zone: "390",
  };
  return map[kind] || "390";
}

// [ASSUMED A2] Elementart → Gewerk (Projekt-Default, im Editor überschreibbar).
export function gewerkFromKind(kind) {
  const map = {
    "wall-inner": "Ausbau",
    "wall-hull": "Rohbau",
    column: "Rohbau",
    slab: "Rohbau",
    roof: "Dach",
    floorplate: "Rohbau",
    window: "Fassade",
    door: "Ausbau",
    zone: "Ausbau",
  };
  return map[kind] || "Rohbau";
}

// --- Normalisierung ---------------------------------------------------------------------

// Eigenes Attribut auf dem Custom-Element überschreibt die Auto-Ableitung.
const normalizeElement = (raw, id, kind, mengen) => ({
  id,
  kind,
  kg: typeof raw?.kg === "string" && raw.kg ? raw.kg : kgFromKind(kind),
  gewerk: typeof raw?.gewerk === "string" && raw.gewerk ? raw.gewerk : gewerkFromKind(kind),
  schicht: Array.isArray(raw?.schicht)
    ? raw.schicht
    : typeof raw?.schicht === "string" && raw.schicht
      ? [raw.schicht]
      : schichtFromComposite(raw?.composite),
  // 89-04 (D-BW-03): no default. The raw value runs through the ONE normalisation (catalogue
  // StatusKonvention, "Bestand"/"EXISTING" → "bestand"); unknown or missing stays null and is
  // shown as "ohne Status". Before: every element without status became "neubau" (BW-06), so a
  // status filter "neubau" counted elements nobody had classified.
  status: normalizeStatus(raw?.status),
  // 73-07 (BEST-08): optional Erfassungsgrad of a drawn element — only present when the element carries
  // one, so legacy models produce byte-identical elements (AVA quantities of new builds change by 0).
  ...(raw?.erfassung != null ? { erfassung: normalizeErfassung(raw.erfassung) } : {}),
  mengen: {
    area: num(mengen.area),
    volume: num(mengen.volume),
    length: num(mengen.length),
    count: num(mengen.count),
  },
});

// --- Synthetische Hülle (Fallback für das grobe Demo-Modell) ----------------------------

// Erzeugt klassifizierte Grund-Bauteile (Außenwände, Bodenplatte, Geschossdecken, Dach)
// aus footprintM + storeys + storeyHeight, damit Grund-Filter (Außenwand/Decke/Dach)
// auch ohne gezeichnete Custom-Elemente sofort Zahlen liefern (RESEARCH §Pitfall 1).
// Feinere Filter (z. B. Trockenbau/Putz) treffen hier bewusst nichts → Lücken-Warnung.
export function synthHull(bimModel) {
  const m = bimModel || {};
  const fp = Array.isArray(m.footprintM) && m.footprintM.length >= 3 ? m.footprintM : DEFAULT_FOOTPRINT;
  const n = Math.max(1, Math.round(num(m.storeys) || 4));
  const sh = num(m.storeyHeight) || 3;
  const area = num(polygonArea(fp));
  const per = num(polygonPerimeter(fp));

  const el = (id, kind, kg, gewerk, schicht, mengen) => ({
    id,
    kind,
    kg,
    gewerk,
    schicht,
    // 89-04 (D-BW-03): no default — the synthetic hull is derived from the outline, nothing
    // says whether it is new, existing or demolished. Before: fixed "neubau".
    status: null,
    mengen: {
      area: num(mengen.area),
      volume: num(mengen.volume),
      length: num(mengen.length),
      count: num(mengen.count),
    },
  });

  return [
    // Außenwände: Umfang × Geschosshöhe × Geschosse. [ASSUMED] Dicke 24 cm für Volumen.
    el("hull-wall", "wall-hull", "330", "Rohbau", ["Stahlbeton"], {
      area: per * sh * n,
      volume: per * sh * n * 0.24,
      length: per * n,
      count: 1,
    }),
    // Bodenplatte. [ASSUMED] Dicke 40 cm für Volumen.
    el("hull-floor", "floorplate", "320", "Rohbau", ["Stahlbeton"], {
      area,
      volume: area * 0.4,
      length: 0,
      count: 1,
    }),
    // Geschossdecken: Grundfläche × Geschosse. [ASSUMED] Dicke 25 cm.
    el("hull-slab", "slab", "350", "Rohbau", ["Stahlbeton"], {
      area: area * n,
      volume: area * n * 0.25,
      length: 0,
      count: n,
    }),
    // Dach (Flachdach = Grundfläche).
    el("hull-roof", "roof", "360", "Dach", [], {
      area,
      volume: 0,
      length: 0,
      count: 1,
    }),
  ];
}

// --- Flattener ---------------------------------------------------------------------------

// classifiedElements(bimModel, building) → normalisierte Liste aller klassifizierten
// Bauteile. 1) Gezeichnete Custom-Elemente (customWalls/…/customRoofs, je _idx) werden
// mit Inline-Geometrie vermengt und namespaced (wall-<idx>, column-<idx>, window-<idx>,
// door-<idx>, env-window-<idx>, zone-<idx>, slab-<idx>, roof-<idx> — kollisionsfrei,
// RESEARCH §Pitfall 6). 2) synthHull ergänzt ADDITIV alle Hüllen-Kategorien, deren kind
// nicht bereits custom gezeichnet ist (ohne Custom-Elemente = kompletter Fallback).
// Defensiv: bimModel null → synthHull ohne Throw; alle Mengen endlich (kein NaN/Infinity).
/**
 * @param {any} bimModel BimModel record
 * @param {any} [building] building (fallback storeys)
 * @param {{werkstattZonen?: Array<any>}} [optionen] 89-03: workshop zones (store, " ·WT") → interior
 *   walls/doors as elements "wt-wall-<guid>"/"wt-door-<guid>"
 * @returns {Array<any>}
 */
export function classifiedElements(bimModel, building, optionen = {}) {
  const m = bimModel || {};
  const sh = num(m.storeyHeight) || 3;
  const arr = (a) => (Array.isArray(a) ? a : []);
  const els = [];

  // 89-03 (BW-08): workshop components as classified elements — interior walls and interior doors
  // (the envelope pieces are the hull below: no double count). KG/trade/material come with the
  // component (werkstattBauteile), so the quantity rules (KG ∩ trade ∩ layer ∩ status) reach them.
  // Ids "wt-wall-<guid>"/"wt-door-<guid>" stay stable over re-tessellation. Without workshop
  // zones (optionen.werkstattZonen empty/missing) the list is byte-identical to before.
  // Status: normalizeElement still defaults to "neubau" — the D-BW-03 fix belongs to 89-04.
  if (Array.isArray(optionen?.werkstattZonen) && optionen.werkstattZonen.length) {
    const wt = werkstattBauteile(optionen.werkstattZonen, { storeyHeight: sh });
    wt.waende.filter((w) => !w.huelle).forEach((w) => {
      els.push(normalizeElement({ kg: w.kg, gewerk: w.gewerk, schicht: ["Kalksandstein", "Putz"] }, `wt-wall-${w.guid}`, "wall-inner", {
        area: w.flaeche_m2, volume: w.volumen_m3, length: w.lichteLaenge_m, count: 1,
      }));
    });
    wt.tueren.filter((t) => !t.huelle).forEach((t) => {
      els.push(normalizeElement({ kg: t.kg, gewerk: t.gewerk, schicht: ["Holz"] }, `wt-door-${t.guid}`, "door", { area: 0, volume: 0, length: 0, count: 1 }));
    });
  }

  arr(m.customWalls).forEach((w, i) => {
    const len = num(wallLength(w));
    const h = num(w?.height) || sh;
    els.push(
      normalizeElement(w, `wall-${w?._idx ?? i}`, "wall-inner", {
        area: len * h,
        volume: len * h * (num(w?.thickness) || 0.24), // [ASSUMED] Default-Dicke 24 cm
        length: len,
        count: 1,
      }),
    );
  });

  arr(m.customColumns).forEach((c, i) => {
    const size = num(c?.size) || 0.3; // [ASSUMED] Default-Querschnitt 30 cm
    els.push(
      normalizeElement(c, `column-${c?._idx ?? i}`, "column", {
        area: 0,
        volume: size * size * sh,
        length: sh,
        count: 1,
      }),
    );
  });

  arr(m.customWindows).forEach((o, i) => {
    const kind = o?.kind === "door" ? "door" : "window";
    els.push(
      normalizeElement(o, `${kind}-${o?._idx ?? i}`, kind, {
        area: 0,
        volume: 0,
        length: 0,
        count: 1,
      }),
    );
  });

  arr(m.envOpenings).forEach((o, i) => {
    const kind = o?.kind === "door" ? "door" : "window";
    els.push(
      normalizeElement(o, `env-${kind}-${o?._idx ?? i}`, kind, {
        area: 0,
        volume: 0,
        length: 0,
        count: 1,
      }),
    );
  });

  arr(m.customZones).forEach((z, i) => {
    const area = num(polygonArea(z?.points));
    els.push(
      normalizeElement(z, `zone-${z?._idx ?? i}`, "zone", {
        area,
        volume: area * sh,
        length: 0,
        count: 1,
      }),
    );
  });

  arr(m.customSlabs).forEach((s, i) => {
    const area = num(polygonArea(s?.points));
    els.push(
      normalizeElement(s, `slab-${s?._idx ?? i}`, "slab", {
        area,
        volume: area * 0.25, // [ASSUMED] Deckendicke 25 cm
        length: 0,
        count: 1,
      }),
    );
  });

  arr(m.customRoofs).forEach((r, i) => {
    const area = num(polygonArea(r?.points));
    els.push(
      normalizeElement(r, `roof-${r?._idx ?? i}`, "roof", {
        area,
        volume: 0,
        length: 0,
        count: 1,
      }),
    );
  });

  // Hüllen-Fallback ADDITIV (HI-03): synthHull darf nicht komplett entfallen, sobald ein
  // einziges Custom-Element (Fenster, Zone, Innenwand …) existiert — sonst springen alle
  // Hüllen-Mengen (KG 320/330/350/360) still auf 0. Es werden nur die Hüllen-Kategorien
  // synthetisiert, deren kind NICHT bereits als Custom-Element vorhanden ist (keine
  // Doppelzählung: custom slab/roof verdrängen hull-slab/hull-roof; customWalls sind
  // "wall-inner" und ersetzen die Außenwand-Hülle "wall-hull" bewusst nicht).
  const haveKinds = new Set(els.map((e) => e.kind));
  const hull = synthHull(bimModel || (building ? { storeys: building.floors } : null))
    .filter((h) => !haveKinds.has(h.kind));
  return [...hull, ...els];
}
