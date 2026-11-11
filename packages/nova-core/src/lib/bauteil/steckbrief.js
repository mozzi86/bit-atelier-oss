// Element data sheet ("Bauteil-Steckbrief", phase 97-02a, concept
// .planning/phases/97-brillen/97-KONZEPT.md §1a). Every element of the ONE model — architecture,
// structure, building services, penetrations, fire stops — answers the same questions:
// IFC class + PredefinedType, renovation status, build-up/material, trade (STLB-Bau LB),
// cost group DIN 276 with quantity, construction section and place in the site sequence, GUID.
// The lenses (97-03 ff.) only READ this sheet; they store nothing of their own.
//
// Rule against wrong planning: every value says where it comes from — `gesetzt` (stored on the
// element by a person), `abgeleitet` (default from the element type, an assumption the planner
// should confirm) or `offen` (nothing known). Nothing assumed is shown as if it were decided,
// and a missing status stays "ohne Status", never Neubau (D-BW-03).
//
// Stored overrides are optional fields on the element (additive, no layer version needed):
//   bauteil_typ, ifc_klasse, ifc_typ, status, kg, gewerk_lb, bauabschnitt, guid, material,
//   schicht_status (97-05: { "<layer index>": status }, outside → inside),
//   schicht_funktion / schicht_prioritaet (107-03: { "<layer index>": "kern"|"bekleidung"|"sonstig" } and { "<layer index>": 0-999 },
//   same pattern; the build-up's own value or a proposal applies where the element states none, see aufbauten.js).
//
// 107-08: further optional fields — feuerwiderstand (text, e.g. "REI90"), schallschutz_rw_db (R'w in dB), u_wert (W/(m²·K)) and
// bauteil_typ_quelle ("automatisch" | "nutzer" | "zurueckgenommen", D-BK-09). steckbrief() reports the three building-physics
// values with their origin in `kennwerte` (never in `quelle`: a new `quelle` key would change the IFC "Herkunft" text of every
// element). bauteilVorschlag() sets the type of a Massing box from its proportions (D-BK-09: automatically, marked as derived).
// 107-09: optional `verschneidungsgruppe` (intersection group, integer ≥ 0, default 1, 0 = never intersects, D-BK-15) — reported in
// `verschneidungsgruppe` with its origin (gesetzt / offen = default applies), and the result of the intersection of a wall or slab
// (quantity from the solid or the hand rule, warning of the volume comparison) in `verschneidung` when the caller passes it. Neither
// is a `quelle` key, so the IFC "Herkunft" text stays byte-identical.
//
// In: an element object plus its type key. Out: steckbrief() data sheet, BAUTEIL_TYPEN registry,
// bauteilGuid(), typFuerWand(), typFuerNetz(), bauteilVorschlag(), kennwerteVon(). No I/O.

import { stabileGuid } from "../werkstattBauteile.js";
import { aufbauVon, kernLage, aufbauById } from "./aufbauten.js";
import { materialById } from "./materialien.js";
import { kernFehlt, wandDicke_m, KERN_REF_LINIEN } from "./referenz.js";
import { wandHoehe, oberkanteFolgtGeschoss, geschosshoehe } from "./hoehen.js";
import { lbEintrag } from "./gewerke.js";
import { normalizeStatus } from "../bimClassification.js";

/** Intersection group of an element without the field (D-BK-15): 1 — every wall intersects with every other one by default. */
export const STANDARD_VERSCHNEIDUNGSGRUPPE = 1;

/**
 * Intersection group of an element (107-09, D-BK-15): the stored integer ≥ 0 (0 = never intersects), else the default 1. The one
 * rule for the 2D bands, the 3D solids and the data sheet.
 * @param {any} el element record (optional field `verschneidungsgruppe`)
 * @returns {number} integer ≥ 0
 */
export function verschneidungsgruppe(el) {
  const g = Number(el?.verschneidungsgruppe);
  return el?.verschneidungsgruppe != null && Number.isInteger(g) && g >= 0 ? g : STANDARD_VERSCHNEIDUNGSGRUPPE;
}

/**
 * @typedef {object} BauteilTyp
 * @property {string} label            display name (German UI string, i18n key)
 * @property {'architektur'|'tragwerk'|'tga'|'durchbruch'} bereich
 * @property {string} ifc              IFC4 entity
 * @property {string} ifcTyp           PredefinedType (without dots)
 * @property {string|null} kg          DIN 276:2018 cost group (3 digits), null = depends on context
 * @property {string|null} lb          STLB-Bau Leistungsbereich, null = depends on context
 * @property {'m2'|'m3'|'m'|'Stk'} einheit  quantity unit
 * @property {boolean} [tragend]
 * @property {boolean} [extern]
 * @property {string} [gewerkGrob]     coarse AVA trade (bimClassification GEWERKE)
 * @property {string} [annahme]        why the default is an assumption
 */

/**
 * Element types. KG per DIN 276:2018 (2nd level 3 digits), LB per STLB-Bau. [ASSUMED] defaults:
 * the planner confirms or overrides them per element. Penetrations and fire stops carry no fixed
 * KG — they follow the host element / the penetrating system (see steckbrief()).
 * @type {Readonly<Record<string, Readonly<BauteilTyp>>>}
 */
export const BAUTEIL_TYPEN = Object.freeze({
  // --- Architecture / envelope -------------------------------------------------------
  "wand-aussen": { label: "Außenwand", bereich: "architektur", ifc: "IfcWall", ifcTyp: "STANDARD", kg: "331", lb: "012", einheit: "m2", tragend: true, extern: true, gewerkGrob: "Rohbau" },
  "wand-tragend": { label: "Tragende Innenwand", bereich: "tragwerk", ifc: "IfcWall", ifcTyp: "STANDARD", kg: "341", lb: "012", einheit: "m2", tragend: true, gewerkGrob: "Rohbau" },
  // 97-05: closing an opening in an existing wall is its OWN element (new build), never an
  // automatic fill — it has its own quantity, trade and cost group.
  "zumauerung": { label: "Zumauerung", bereich: "architektur", ifc: "IfcWall", ifcTyp: "STANDARD", kg: "341", lb: "012", einheit: "m2", tragend: false, gewerkGrob: "Rohbau",
    annahme: "KG 341/342 nach der Wand, in der die Öffnung liegt" },
  "wand-innen": { label: "Nichttragende Innenwand", bereich: "architektur", ifc: "IfcWall", ifcTyp: "PARTITIONING", kg: "342", lb: "012", einheit: "m2", tragend: false, gewerkGrob: "Ausbau",
    annahme: "Mauerwerk; als Trockenbauwand LB 039 setzen" },
  "decke": { label: "Decke", bereich: "tragwerk", ifc: "IfcSlab", ifcTyp: "FLOOR", kg: "351", lb: "013", einheit: "m2", tragend: true, gewerkGrob: "Rohbau" },
  "bodenplatte": { label: "Bodenplatte", bereich: "tragwerk", ifc: "IfcSlab", ifcTyp: "BASESLAB", kg: "322", lb: "013", einheit: "m2", tragend: true, gewerkGrob: "Rohbau" },
  "dach-flach": { label: "Flachdach", bereich: "architektur", ifc: "IfcRoof", ifcTyp: "FLAT_ROOF", kg: "361", lb: "021", einheit: "m2", gewerkGrob: "Dach" },
  "dach-geneigt": { label: "Geneigtes Dach", bereich: "architektur", ifc: "IfcRoof", ifcTyp: "GABLE_ROOF", kg: "361", lb: "020", einheit: "m2", gewerkGrob: "Dach" },
  "treppe": { label: "Treppe", bereich: "tragwerk", ifc: "IfcStair", ifcTyp: "STRAIGHT_RUN_STAIR", kg: "351", lb: "013", einheit: "Stk", tragend: true, gewerkGrob: "Rohbau" },
  "fenster": { label: "Fenster", bereich: "architektur", ifc: "IfcWindow", ifcTyp: "WINDOW", kg: "334", lb: "026", einheit: "Stk", gewerkGrob: "Fassade" },
  "tuer-aussen": { label: "Außentür", bereich: "architektur", ifc: "IfcDoor", ifcTyp: "DOOR", kg: "334", lb: "026", einheit: "Stk", gewerkGrob: "Fassade" },
  "tuer-innen": { label: "Innentür", bereich: "architektur", ifc: "IfcDoor", ifcTyp: "DOOR", kg: "344", lb: "027", einheit: "Stk", gewerkGrob: "Ausbau" },
  "gelaender": { label: "Geländer", bereich: "architektur", ifc: "IfcRailing", ifcTyp: "BALUSTRADE", kg: "359", lb: "031", einheit: "m", gewerkGrob: "Ausbau" },
  "bekleidung": { label: "Bekleidung", bereich: "architektur", ifc: "IfcCovering", ifcTyp: "CLADDING", kg: "345", lb: "023", einheit: "m2", gewerkGrob: "Ausbau" },
  "raum": { label: "Raum", bereich: "architektur", ifc: "IfcSpace", ifcTyp: "SPACE", kg: null, lb: null, einheit: "m2" },
  // --- Structure (phase 40) ------------------------------------------------------------
  "stuetze": { label: "Stütze", bereich: "tragwerk", ifc: "IfcColumn", ifcTyp: "COLUMN", kg: "343", lb: "013", einheit: "Stk", tragend: true, gewerkGrob: "Rohbau",
    annahme: "Innenstütze; Außenstütze ist KG 333" },
  "traeger": { label: "Träger / Unterzug", bereich: "tragwerk", ifc: "IfcBeam", ifcTyp: "BEAM", kg: "351", lb: "013", einheit: "m", tragend: true, gewerkGrob: "Rohbau" },
  "fundament": { label: "Fundament", bereich: "tragwerk", ifc: "IfcFooting", ifcTyp: "STRIP_FOOTING", kg: "322", lb: "013", einheit: "m3", tragend: true, gewerkGrob: "Rohbau" },
  "pfahl": { label: "Pfahl", bereich: "tragwerk", ifc: "IfcPile", ifcTyp: "BORED", kg: "323", lb: "006", einheit: "Stk", tragend: true, gewerkGrob: "Rohbau" },
  // --- Building services (phase 41 network) -------------------------------------------
  "leitung-heizung": { label: "Heizungsleitung", bereich: "tga", ifc: "IfcPipeSegment", ifcTyp: "RIGIDSEGMENT", kg: "422", lb: "041", einheit: "m", gewerkGrob: "TGA" },
  "leitung-trinkwasser": { label: "Trinkwasserleitung", bereich: "tga", ifc: "IfcPipeSegment", ifcTyp: "RIGIDSEGMENT", kg: "412", lb: "042", einheit: "m", gewerkGrob: "TGA" },
  "leitung-abwasser": { label: "Abwasserleitung", bereich: "tga", ifc: "IfcPipeSegment", ifcTyp: "RIGIDSEGMENT", kg: "411", lb: "044", einheit: "m", gewerkGrob: "TGA" },
  "kanal-lueftung": { label: "Lüftungskanal", bereich: "tga", ifc: "IfcDuctSegment", ifcTyp: "RIGIDSEGMENT", kg: "431", lb: "075", einheit: "m", gewerkGrob: "TGA" },
  "kabel-elektro": { label: "Elektroleitung", bereich: "tga", ifc: "IfcCableSegment", ifcTyp: "CABLESEGMENT", kg: "444", lb: "053", einheit: "m", gewerkGrob: "TGA" },
  "waermeerzeuger": { label: "Wärmeerzeuger", bereich: "tga", ifc: "IfcBoiler", ifcTyp: "NOTDEFINED", kg: "421", lb: "040", einheit: "Stk", gewerkGrob: "TGA",
    annahme: "Kessel; Wärmepumpe ist IfcChiller/IfcUnitaryEquipment" },
  "heizflaeche": { label: "Heizfläche", bereich: "tga", ifc: "IfcSpaceHeater", ifcTyp: "RADIATOR", kg: "423", lb: "041", einheit: "Stk", gewerkGrob: "TGA" },
  "lueftungsgeraet": { label: "Lüftungsgerät", bereich: "tga", ifc: "IfcUnitaryEquipment", ifcTyp: "AIRHANDLER", kg: "431", lb: "075", einheit: "Stk", gewerkGrob: "TGA" },
  "luftdurchlass": { label: "Luftdurchlass", bereich: "tga", ifc: "IfcAirTerminal", ifcTyp: "DIFFUSER", kg: "431", lb: "075", einheit: "Stk", gewerkGrob: "TGA" },
  "speicher": { label: "Trinkwasserspeicher", bereich: "tga", ifc: "IfcTank", ifcTyp: "STORAGE", kg: "412", lb: "042", einheit: "Stk", gewerkGrob: "TGA" },
  "sanitaerobjekt": { label: "Sanitärobjekt / Zapfstelle", bereich: "tga", ifc: "IfcSanitaryTerminal", ifcTyp: "NOTDEFINED", kg: "412", lb: "045", einheit: "Stk", gewerkGrob: "TGA" },
  "ablauf": { label: "Ablauf", bereich: "tga", ifc: "IfcWasteTerminal", ifcTyp: "NOTDEFINED", kg: "411", lb: "044", einheit: "Stk", gewerkGrob: "TGA" },
  "verteiler-elektro": { label: "Elektroverteiler", bereich: "tga", ifc: "IfcElectricDistributionBoard", ifcTyp: "DISTRIBUTIONBOARD", kg: "443", lb: "053", einheit: "Stk", gewerkGrob: "TGA" },
  "steckdose": { label: "Elektro-Auslass", bereich: "tga", ifc: "IfcOutlet", ifcTyp: "POWEROUTLET", kg: "444", lb: "053", einheit: "Stk", gewerkGrob: "TGA" },
  "rohrformteil": { label: "Verteiler / Abzweig (Rohr)", bereich: "tga", ifc: "IfcPipeFitting", ifcTyp: "JUNCTION", kg: null, lb: null, einheit: "Stk", gewerkGrob: "TGA" },
  "kanalformteil": { label: "Verteiler / Abzweig (Kanal)", bereich: "tga", ifc: "IfcDuctFitting", ifcTyp: "JUNCTION", kg: "431", lb: "075", einheit: "Stk", gewerkGrob: "TGA" },
  "abzweigdose": { label: "Abzweigdose", bereich: "tga", ifc: "IfcJunctionBox", ifcTyp: "POWER", kg: "444", lb: "053", einheit: "Stk", gewerkGrob: "TGA" },
  "hausanschluss": { label: "Hausanschluss", bereich: "tga", ifc: "IfcPipeFitting", ifcTyp: "ENTRY", kg: null, lb: null, einheit: "Stk", gewerkGrob: "TGA" },
  // --- Penetrations and fire stops (phase 88 + 97-02a) --------------------------------
  // Before it exists on site a penetration is a "provision for void" (IFC4 IfcBuildingElementProxy
  // PROVISIONFORVOID, buildingSMART); once made it is a real IfcOpeningElement in its host.
  "durchbruch": { label: "Durchbruch (geplant)", bereich: "durchbruch", ifc: "IfcBuildingElementProxy", ifcTyp: "PROVISIONFORVOID", kg: null, lb: null, einheit: "Stk" },
  "oeffnung": { label: "Durchbruch (hergestellt)", bereich: "durchbruch", ifc: "IfcOpeningElement", ifcTyp: "OPENING", kg: null, lb: null, einheit: "Stk" },
  // [ASSUMED] IFC4/4.3 have no entity for a fire stop; until buildingSMART settles it, a proxy with
  // ObjectType "Brandschott" (USERDEFINED). Trade LB 047 (fire protection at technical systems);
  // the KG follows the penetrating system (4xx).
  "brandschott": { label: "Brandschott", bereich: "durchbruch", ifc: "IfcBuildingElementProxy", ifcTyp: "USERDEFINED", kg: null, lb: "047", einheit: "Stk", gewerkGrob: "TGA",
    annahme: "IFC-Klasse vorläufig (Proxy, ObjectType Brandschott)" },
});

/** Assumption texts of the core reference lines without a core (107-01; UI strings, EN in i18nTeile/bauteilkern-107.js). */
const KERN_ANNAHME = Object.freeze({
  coreOutside: "Referenzlinie „Kern außen“ ohne Kern-Schicht wie Mitte behandelt",
  coreInside: "Referenzlinie „Kern innen“ ohne Kern-Schicht wie Mitte behandelt",
  coreCenter: "Referenzlinie „Kern Mitte“ ohne Kern-Schicht wie Mitte behandelt",
});

/** Assumption texts when the core of a core reference line is only PROPOSED from the material (107-03; UI strings, EN in i18nTeile/bauteilkern-107.js). */
const KERN_VORSCHLAG = Object.freeze({
  coreOutside: "Referenzlinie „Kern außen“ bezieht sich auf die vorgeschlagene Kern-Schicht — bitte bestätigen",
  coreInside: "Referenzlinie „Kern innen“ bezieht sich auf die vorgeschlagene Kern-Schicht — bitte bestätigen",
  coreCenter: "Referenzlinie „Kern Mitte“ bezieht sich auf die vorgeschlagene Kern-Schicht — bitte bestätigen",
});

/** KG of a penetrating network trade (fire stop / penetration follow the system). */
const KG_NETZ = Object.freeze({ heizung: "422", trinkwasser: "412", abwasser: "411", lueftung: "431", elektro: "444" });

/**
 * Type key of a wall from what the element says: explicit `bauteil_typ`, workshop `klasse`,
 * envelope flag, else from the build-up. Returns whether it was derived (an assumption).
 * @param {{bauteil_typ?: string, klasse?: string, huelle?: boolean, composite?: string, thickness?: number}} w
 * @returns {{typ: string, abgeleitet: boolean}}
 */
export function typFuerWand(w) {
  if (w?.bauteil_typ && BAUTEIL_TYPEN[w.bauteil_typ]) return { typ: w.bauteil_typ, abgeleitet: false };
  if (w?.huelle || w?.klasse === "aussen") return { typ: "wand-aussen", abgeleitet: !w?.huelle && !w?.klasse };
  if (w?.klasse === "tragend") return { typ: "wand-tragend", abgeleitet: false };
  if (w?.klasse === "leicht") return { typ: "wand-innen", abgeleitet: false };
  // Drawn wall: layered envelope build-ups (cavity, timber) are exterior; otherwise ≥ 17.5 cm is
  // [ASSUMED] load-bearing (usual minimum of load-bearing masonry), thinner is a partition.
  if (w?.composite === "cavity" || w?.composite === "timber") return { typ: "wand-aussen", abgeleitet: true };
  const d = aufbauVon(w).dicke_m;
  return { typ: d >= 0.175 ? "wand-tragend" : "wand-innen", abgeleitet: true };
}

/** Origins of a type stored on a Massing body (107-08, D-BK-09). */
export const TYP_QUELLEN = Object.freeze(["automatisch", "nutzer", "zurueckgenommen"]);

// Thresholds of the box heuristic (D-BK-09, spec IV "Box → Wand/Decke/Stütze"). All [ASSUMED] guide values chosen by the
// planning of 107 (research §4 D-BK-09), not from a standard; a proven value would come from the planner's own modelling rules.
/** Largest side of a column cross-section, m [ASSUMED: 0.60 × 0.60 m; the spec names 0.24 × 0.24 m as the lower end]. */
export const BOX_STUETZE_MAX_M = 0.6;
/** Smallest height of a column, m [ASSUMED: about one storey minus slab, 2.00 m]. */
export const BOX_STUETZE_MIN_HOEHE_M = 2.0;
/** Largest thickness (short side) of a wall, m [ASSUMED: 0.60 m, thicker is a block, not a wall]. */
export const BOX_WAND_MAX_DICKE_M = 0.6;
/** Smallest height of a wall, m [ASSUMED: 1.00 m, lower is a plinth or parapet left open]. */
export const BOX_WAND_MIN_HOEHE_M = 1.0;
/** Largest thickness (body height) of a slab, m [ASSUMED: 0.50 m]. */
export const BOX_DECKE_MAX_DICKE_M = 0.5;
/** Smallest plan area of a slab, m² [ASSUMED: 2.0 m², smaller flat boxes stay open]. */
export const BOX_DECKE_MIN_FLAECHE_M2 = 2.0;
/** Tolerance of a right angle in a rectangle profile, degrees [ASSUMED: 1°, drawing inaccuracy of a snapped corner]. */
export const BOX_WINKEL_TOL_GRAD = 1;

/** Comparison tolerance of the thresholds, m (profiles are rounded to 1e-6 m; 0.6 must stay ≤ 0.6). */
const BOX_EPS = 1e-6;

/**
 * Sides of a rectangle profile (four corners, right angles within BOX_WINKEL_TOL_GRAD), or null for any other profile.
 * @param {Array<{x: number, y?: number, z?: number}>} profil plan points in m ({x, y} of the Massing frame or {x, z} of the BIM model)
 * @returns {{kurz: number, lang: number}|null} the two side lengths in m (mean of the opposite sides)
 */
export function rechteckSeiten(profil) {
  if (!Array.isArray(profil) || profil.length !== 4) return null;
  const p = profil.map((q) => ({ x: Number(q.x), y: Number(q.y ?? q.z) }));
  if (!p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return null;
  const kanten = p.map((a, i) => { const b = p[(i + 1) % 4]; return { x: b.x - a.x, y: b.y - a.y, l: Math.hypot(b.x - a.x, b.y - a.y) }; });
  if (kanten.some((k) => k.l < 1e-6)) return null;
  const tol = Math.sin((BOX_WINKEL_TOL_GRAD * Math.PI) / 180);
  for (let i = 0; i < 4; i++) {
    const a = kanten[i], b = kanten[(i + 1) % 4];
    // |cos| of the corner angle; a right angle has cos 0 (|cos| ≤ sin(tol) ⇔ angle within 90° ± tol)
    if (Math.abs((a.x * b.x + a.y * b.y) / (a.l * b.l)) > tol) return null;
  }
  const s1 = (kanten[0].l + kanten[2].l) / 2, s2 = (kanten[1].l + kanten[3].l) / 2;
  return { kurz: Math.min(s1, s2), lang: Math.max(s1, s2) };
}

/**
 * Type of a Massing box from its proportions (D-BK-09, 24.10.: set AUTOMATICALLY, marked "abgeleitet (Annahme)", revertible).
 * Only rectangle profiles; the first rule that holds wins (they exclude each other in this order):
 *  1. column: long side ≤ BOX_STUETZE_MAX_M and height ≥ BOX_STUETZE_MIN_HOEHE_M;
 *  2. wall: short side ≤ BOX_WAND_MAX_DICKE_M, long side > BOX_WAND_MAX_DICKE_M and height ≥ BOX_WAND_MIN_HOEHE_M — the wall type
 *     follows the thickness rule of typFuerWand with the short side as thickness (never "wand-aussen": the box knows nothing about
 *     its position in the building; outside position and build-up are set by the planner);
 *  3. slab: height (= slab thickness) ≤ BOX_DECKE_MAX_DICKE_M and plan area > BOX_DECKE_MIN_FLAECHE_M2.
 * Otherwise null ("Bauteiltyp offen").
 * @param {Array<{x: number, y?: number, z?: number}>} profil plan profile in m
 * @param {number} hoehe body height in m
 * @returns {{typ: string, abgeleitet: true, annahme: string, kurz_m: number, lang_m: number}|null}
 */
export function bauteilVorschlag(profil, hoehe) {
  const r = rechteckSeiten(profil);
  const h = Number(hoehe);
  if (!r || !(h > 0)) return null;
  const { kurz, lang } = r;
  const m = (/** @type {number} */ v) => v.toFixed(2).replace(".", ",");
  if (lang <= BOX_STUETZE_MAX_M + BOX_EPS && h >= BOX_STUETZE_MIN_HOEHE_M - BOX_EPS) {
    return { typ: "stuetze", abgeleitet: true, kurz_m: kurz, lang_m: lang,
      annahme: `Bauteiltyp „Stütze“ aus den Proportionen abgeleitet (Querschnitt ${m(kurz)} × ${m(lang)} m, Höhe ${m(h)} m)` };
  }
  if (kurz <= BOX_WAND_MAX_DICKE_M + BOX_EPS && lang > BOX_WAND_MAX_DICKE_M + BOX_EPS && h >= BOX_WAND_MIN_HOEHE_M - BOX_EPS) {
    const typ = typFuerWand({ thickness: kurz }).typ;
    return { typ, abgeleitet: true, kurz_m: kurz, lang_m: lang,
      annahme: `Bauteiltyp „${BAUTEIL_TYPEN[typ].label}“ aus den Proportionen abgeleitet (Dicke ${m(kurz)} m, Länge ${m(lang)} m, Höhe ${m(h)} m)` };
  }
  if (h <= BOX_DECKE_MAX_DICKE_M + BOX_EPS && kurz * lang > BOX_DECKE_MIN_FLAECHE_M2 + BOX_EPS) {
    return { typ: "decke", abgeleitet: true, kurz_m: kurz, lang_m: lang,
      annahme: `Bauteiltyp „Decke“ aus den Proportionen abgeleitet (Dicke ${m(h)} m, Fläche ${m(kurz * lang)} m²)` };
  }
  return null;
}

/** Mark of an automatically set type in the data sheet (D-BK-09; German UI string, EN in i18nTeile/bauteilkern-107.js). */
export const TYP_ABGELEITET_TEXT = "abgeleitet (Annahme)";
/** Text of an open type (no type, or the automatic type taken back). */
export const TYP_OFFEN_TEXT = "Bauteiltyp offen";

// Surface resistances for the U-value, m²K/W, DIN EN ISO 6946 Tab. 7 (horizontal heat flow): Rsi 0.13, Rse 0.04; behind a well
// ventilated air layer the outer layers are left out and Rse = Rsi (DIN EN ISO 6946 6.9.4).
const RSI = 0.13, RSE = 0.04;

/**
 * U-value of a build-up, W/(m²·K), DIN EN ISO 6946 (layers in series, no thermal bridges, no corrections): 1 / (Rsi + Σ d/λ + Rse).
 * Null when a layer has no catalogue material with a λ (a thickness-only wall, an unknown material) — the value stays open then.
 * @param {Array<{material: string|null, dicke_m: number}>} schichten outside → inside, thickness in m
 * @returns {number|null} W/(m²·K), rounded to 0.01
 */
export function uWertAusSchichten(schichten) {
  if (!Array.isArray(schichten) || !schichten.length) return null;
  let start = 0, rse = RSE;
  schichten.forEach((l, i) => { if (l.material === "luftbel") { start = i + 1; rse = RSI; } });
  const innen = schichten.slice(start);
  if (!innen.length) return null;
  let r = RSI + rse;
  for (const l of innen) {
    const lambda = Number(materialById(l.material)?.lambda);
    if (!(lambda > 0) || !(l.dicke_m > 0)) return null;
    r += l.dicke_m / lambda;
  }
  return Math.round((1 / r) * 100) / 100;
}

/**
 * @typedef {{wert: any, quelle: 'gesetzt'|'abgeleitet'|'offen'}} Kennwert
 * @typedef {{feuerwiderstand: Kennwert, schallschutz_rw_db: Kennwert, u_wert: Kennwert}} Kennwerte
 */

/**
 * Building-physics values of an element with their origin (107-08, spec V pset_common): fire resistance (only set, e.g. "REI90";
 * "ohne" = none), sound insulation R'w in dB (set, else the build-up's `rw`, an [ASSUMED] guide value of aufbauten.js) and U-value
 * in W/(m²·K) (set, else from λ and thickness of the build-up layers, uWertAusSchichten).
 * @param {any} el element with optional feuerwiderstand / schallschutz_rw_db / u_wert / composite
 * @param {{schichten: Array<{material: string|null, dicke_m: number}>, quelle: string}|null} [aufbau] its build-up (aufbauVon)
 * @returns {Kennwerte}
 */
export function kennwerteVon(el, aufbau = null) {
  const fw = typeof el?.feuerwiderstand === "string" && el.feuerwiderstand.trim() ? el.feuerwiderstand.trim() : null;
  const rwGesetzt = Number(el?.schallschutz_rw_db);
  const rwAufbau = el?.composite ? aufbauById(el.composite)?.rw : undefined;
  const uGesetzt = Number(el?.u_wert);
  const uAbgeleitet = aufbau && aufbau.quelle !== "dicke" && aufbau.quelle !== "keine" ? uWertAusSchichten(aufbau.schichten) : null;
  return {
    feuerwiderstand: fw ? { wert: fw, quelle: "gesetzt" } : { wert: null, quelle: "offen" },
    schallschutz_rw_db: el?.schallschutz_rw_db != null && rwGesetzt > 0 ? { wert: rwGesetzt, quelle: "gesetzt" }
      : Number.isFinite(rwAufbau) ? { wert: rwAufbau, quelle: "abgeleitet" } : { wert: null, quelle: "offen" },
    u_wert: el?.u_wert != null && uGesetzt > 0 ? { wert: uGesetzt, quelle: "gesetzt" }
      : uAbgeleitet != null ? { wert: uAbgeleitet, quelle: "abgeleitet" } : { wert: null, quelle: "offen" },
  };
}

/**
 * Type key of a network element (phase 41 netz_layer). Edges by trade, nodes by trade × kind.
 * @param {{gewerk?: string, art?: string}} el edge (no `art`) or node
 * @returns {string}
 */
export function typFuerNetz(el) {
  const g = el?.gewerk;
  if (!el?.art) return { heizung: "leitung-heizung", trinkwasser: "leitung-trinkwasser", abwasser: "leitung-abwasser", lueftung: "kanal-lueftung", elektro: "kabel-elektro" }[g] || "leitung-heizung";
  const tabelle = {
    heizung: { erzeuger: "waermeerzeuger", auslass: "heizflaeche", verteiler: "rohrformteil", schacht: "rohrformteil", anschluss: "hausanschluss" },
    trinkwasser: { erzeuger: "speicher", auslass: "sanitaerobjekt", verteiler: "rohrformteil", schacht: "rohrformteil", anschluss: "hausanschluss" },
    abwasser: { erzeuger: "rohrformteil", auslass: "ablauf", verteiler: "rohrformteil", schacht: "rohrformteil", anschluss: "hausanschluss" },
    lueftung: { erzeuger: "lueftungsgeraet", auslass: "luftdurchlass", verteiler: "kanalformteil", schacht: "kanalformteil", anschluss: "kanalformteil" },
    elektro: { erzeuger: "verteiler-elektro", auslass: "steckdose", verteiler: "verteiler-elektro", schacht: "abzweigdose", anschluss: "verteiler-elektro" },
  };
  return tabelle[g]?.[el.art] || "rohrformteil";
}

/**
 * Stable IFC GlobalId of an element: a stored `guid` wins; otherwise derived from project, type
 * and the element's identity (`_idx`/`id`), so it is the same in every export without a save.
 * @param {string|number|null|undefined} projektId
 * @param {string} quelle source array or kind (e.g. "customWalls", "netz-kante")
 * @param {{guid?: string, _idx?: number, id?: string}} el
 * @returns {string} 22 characters IFC base-64
 */
export function bauteilGuid(projektId, quelle, el) {
  if (typeof el?.guid === "string" && el.guid.length === 22) return el.guid;
  return stabileGuid(`${projektId ?? "-"}|${quelle}|${el?.id ?? el?._idx ?? "?"}`);
}

/**
 * 107-08 (spec V guid, BK-67): pins the GlobalId each element has in the IFC today onto the element (lazy: called at the first
 * export or when its data sheet is opened). The value is exactly bauteilGuid() of the same source, so the export is byte-identical
 * before and after; from then on the GUID survives a project copy or a change of the id scheme. Elements that already carry a
 * 22-character guid keep it.
 * @template T
 * @param {T[]} liste element list (customWalls, customColumns, customSlabs, customRoofs, customZones)
 * @param {string|number|null|undefined} projektId
 * @param {string} quelle the source name the IFC export uses for this list ("customWalls" …)
 * @param {((el: T) => boolean)|null} [nur] only elements this test accepts (default: all)
 * @returns {T[]} the same array when nothing had to change, else a new one
 */
export function guidsAnheften(liste, projektId, quelle, nur = null) {
  if (!Array.isArray(liste)) return liste;
  let geaendert = false;
  const neu = liste.map((el) => {
    const e = /** @type {any} */ (el);
    if (!e || (typeof e.guid === "string" && e.guid.length === 22) || (nur && !nur(el))) return el;
    geaendert = true;
    return /** @type {T} */ ({ ...e, guid: bauteilGuid(projektId, quelle, e) });
  });
  return geaendert ? neu : liste;
}

/** Area of a polygon in the x/z plane (m², shoelace). */
function flaeche(points) {
  const p = Array.isArray(points) ? points : [];
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += (Number(p[i].x) || 0) * (Number(q.z) || 0) - (Number(q.x) || 0) * (Number(p[i].z) || 0); }
  return Math.abs(a) / 2;
}
/** Length of a polyline (m). */
function laenge(points) {
  const p = Array.isArray(points) ? points : [];
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot((p[i].x ?? 0) - (p[i - 1].x ?? 0), (p[i].z ?? 0) - (p[i - 1].z ?? 0));
  return l;
}
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Quantity of an element in the unit of its type, from its geometry. Walls: length × height
 * (gross, openings not deducted — the AVA deducts them per VOB/C); polygons: area; lines and
 * beams: length; everything else: 1 piece.
 * @param {BauteilTyp} typ
 * @param {any} el
 * @param {{storeyHeight?: number, geschosse?: import("./hoehen.js").Geschosse}} ctx storeyHeight in m (default 3); geschosse (107-02) the
 *   storey source (one height or the storey table) for walls whose top edge is linked to a storey (`oberkante_bezug: "geschoss"`)
 * @returns {{wert: number, einheit: string}}
 */
export function mengeVon(typ, el, ctx = {}) {
  // 107-02: a wall linked to the storey has no fixed height — it is derived (hoehen.js), like in 3D, plan and IFC
  const h = oberkanteFolgtGeschoss(el)
    ? wandHoehe(el, ctx.geschosse ?? ctx.storeyHeight)
    : Number(el?.height ?? el?.hoehe_m ?? (Array.isArray(ctx.geschosse) ? geschosshoehe(el?.level || 0, ctx.geschosse) : ctx.storeyHeight) ?? 3) || 3;
  if (typ.einheit === "m2" && el?.a && el?.b) return { wert: r2(Math.hypot(el.b.x - el.a.x, el.b.z - el.a.z) * h), einheit: "m2" };
  if (typ.einheit === "m2") return { wert: r2(Number(el?.flaeche_m2) || flaeche(el?.points || el?.polygon)), einheit: "m2" };
  if (typ.einheit === "m" && el?.a && el?.b) return { wert: r2(Math.hypot(el.b.x - el.a.x, el.b.z - el.a.z)), einheit: "m" };
  if (typ.einheit === "m") return { wert: r2(laenge(el?.points)), einheit: "m" };
  if (typ.einheit === "m3") return { wert: r2(Number(el?.volumen_m3) || 0), einheit: "m3" };
  return { wert: 1, einheit: "Stk" };
}

/**
 * @typedef {object} Steckbrief
 * @property {string} typ                 type key (BAUTEIL_TYPEN)
 * @property {string} label
 * @property {string} bereich
 * @property {{klasse: string, typ: string}} ifc
 * @property {string} guid
 * @property {string|null} status         bestand|neubau|abbruch|null (null = ohne Status)
 * @property {{name: string, quelle: 'composite'|'klasse'|'dicke', schichten: Array<{name: string, material: string|null, dicke_m: number, status: string|null, statusGeerbt: boolean, funktion: "kern"|"bekleidung"|"sonstig", funktionAbgeleitet: boolean, funktionAnnahme: boolean, prioritaet: number, prioritaetAbgeleitet: boolean}>, dicke_m: number, funktionAbgeleitet: boolean, funktionAnnahme: boolean, prioritaetAbgeleitet: boolean, kern: {aussen_m: number, kern_m: number, abgeleitet: boolean}|null}|null} aufbau
 *   107-03: per layer function and priority with their origin (abgeleitet = proposal, never stored), `kern` = the core split of the build-up in m (null = no core layer)
 * @property {string|null} material       short material text
 * @property {{lb: string, name: string, folge: number}|null} gewerk  STLB-Bau LB with site order
 * @property {string|null} gewerkGrob     coarse AVA trade
 * @property {string|null} kg             DIN 276 cost group
 * @property {{wert: number, einheit: string}} menge
 * @property {string|null} bauabschnitt
 * @property {boolean} tragend
 * @property {string|null} feuerwiderstand fire resistance class stored on the element (F30, F90, EI 90 ...; "ohne" = none), null = not set (106-03, additive)
 * @property {string|null} statik_vermerk  note on shoring / structure stored on the element, null = none (106-03, additive)
 * @property {Kennwerte} kennwerte        107-08: fire resistance, R'w (dB), U-value (W/(m²·K)) with their origin
 * @property {'automatisch'|'nutzer'|null} typQuelle 107-08: origin of a type stored on a Massing body (D-BK-09), null = none stated
 * @property {{wert: number, quelle: 'gesetzt'|'offen'}} verschneidungsgruppe 107-09: intersection group with its origin (offen = default 1)
 * @property {{quelle: 'solid'|'analytisch', menge_m3: number, warnung: any, jeSchicht?: Array<{name: string, material?: string|null, menge_m3: number}>}|null} verschneidung 107-09: result of the intersection
 *   (ctx.verschneidung), null when the caller passes none
 * @property {{quelle: 'solid'|'analytisch'|'offen', menge_m3: number|null, warnung: any, jeSchicht?: Array<{name: string, material?: string|null, menge_m3: number|null}>}} [abschraegung] 107-10 review:
 *   volume of a wall cut under a roof (solid relation, bauteil/seo.js) — only present when the caller passes ctx.abschraegung
 * @property {Record<string, 'gesetzt'|'abgeleitet'|'offen'>} quelle  origin per field
 * @property {string[]} offen             fields nobody has decided yet (shown as hints)
 * @property {string[]} annahmen          assumptions behind derived values
 */

/**
 * The data-sheet fields an editor may store on an element (100-02): KG (1–3 digits), trade LB, construction
 * section — exactly what `steckbriefFelder` lets the user edit. Layer hardeners (TGA network, structure) keep
 * them through this one function; an element without them yields {} so stored layers stay byte-identical.
 * @param {any} el element with optional kg / gewerk_lb / bauabschnitt
 * @returns {{kg?: string, gewerk_lb?: string, bauabschnitt?: string}}
 */
export function steckbriefFelderAus(el) {
  /** @type {{kg?: string, gewerk_lb?: string, bauabschnitt?: string}} */
  const aus = {};
  if (!el || typeof el !== "object") return aus;
  // 1–3 digits like the input field: the editor saves every keystroke ("4" → "42" → "422"); a
  // three-digit-only rule dropped the first digit and the field jumped back to the derived KG.
  if (el.kg != null && /^\d{1,3}$/.test(String(el.kg))) aus.kg = String(el.kg);
  if (typeof el.gewerk_lb === "string" && /^\d{3}$/.test(el.gewerk_lb)) aus.gewerk_lb = el.gewerk_lb;
  // not trimmed: editors save on every keystroke, a trim would eat the space typed between two words
  if (typeof el.bauabschnitt === "string" && el.bauabschnitt.trim()) aus.bauabschnitt = el.bauabschnitt.slice(0, 40);
  return aus;
}

/**
 * The data sheet of one element.
 * @param {any} el element (drawn, workshop, network, penetration …)
 * @param {string} typKey key of BAUTEIL_TYPEN; `el.bauteil_typ` overrides it
 * @param {{projektId?: string|number|null, quelle?: string, storeyHeight?: number, geschosse?: import("./hoehen.js").Geschosse, typAbgeleitet?: boolean, netzGewerk?: string, kern?: {aussen_m: number, kern_m: number}|null, verschneidung?: {quelle: 'solid'|'analytisch', menge_m3: number, warnung: any, jeSchicht?: Array<{name: string, material?: string|null, menge_m3: number}>}|null, abschraegung?: {quelle: 'solid'|'analytisch'|'offen', menge_m3: number|null, warnung: any, jeSchicht?: Array<{name: string, material?: string|null, menge_m3: number|null}>}|null}} [ctx]
 *   quelle: source name for the GUID; typAbgeleitet: the type itself is an assumption;
 *   netzGewerk: trade of the penetrating line (penetration, fire stop) for the KG;
 *   kern: core split of the wall build-up in m (default: derived from the build-up, 107-03; null = no core known);
 *   verschneidung (107-09): quantity (m³) and source of the intersected solid with the warning of its volume comparison; review 107-09:
 *   `jeSchicht` = volume per layer in m³ (same source), passed through unchanged.
 *   abschraegung (107-10 review, truth "Mengen aus dem Solid"): quantity (m³, null = open) and source of a wall cut under a roof, per layer,
 *   with the warning of its comparison; the key appears only when passed (every other data sheet stays as it was).
 * @returns {Steckbrief}
 */
export function steckbrief(el, typKey, ctx = {}) {
  const key = el?.bauteil_typ && BAUTEIL_TYPEN[el.bauteil_typ] ? el.bauteil_typ : typKey;
  const typ = BAUTEIL_TYPEN[key];
  if (!typ) throw new Error(`Unbekannter Bauteiltyp: ${key}`);
  /** @type {Record<string, 'gesetzt'|'abgeleitet'|'offen'>} */
  const quelle = {};
  const annahmen = [];
  const wahl = (feld, gesetzt, abgeleitet) => {
    if (gesetzt != null && gesetzt !== "") { quelle[feld] = "gesetzt"; return gesetzt; }
    if (abgeleitet != null && abgeleitet !== "") { quelle[feld] = "abgeleitet"; return abgeleitet; }
    quelle[feld] = "offen";
    return null;
  };

  // 107-08 (D-BK-09): a type the box automatic set is stored, but still an assumption — its origin comes from the stored
  // `bauteil_typ_quelle`, so the mark "abgeleitet (Annahme)" survives saving and reloading
  const automatisch = el?.bauteil_typ_quelle === "automatisch" && !!el?.bauteil_typ && !!BAUTEIL_TYPEN[el.bauteil_typ];
  quelle.typ = automatisch ? "abgeleitet" : el?.bauteil_typ && BAUTEIL_TYPEN[el.bauteil_typ] ? "gesetzt" : ctx.typAbgeleitet ? "abgeleitet" : "gesetzt";
  if (automatisch) annahmen.push(`Bauteiltyp „${typ.label}“ ${TYP_ABGELEITET_TEXT} — aus den Proportionen des Körpers gesetzt, bitte bestätigen`);
  else if (quelle.typ === "abgeleitet") annahmen.push(`Bauteiltyp „${typ.label}“ aus Aufbau/Dicke abgeleitet`);
  if (typ.annahme) annahmen.push(typ.annahme);

  const ifcKlasse = wahl("ifc", el?.ifc_klasse, typ.ifc);
  const ifcTyp = el?.ifc_klasse ? (el?.ifc_typ || "NOTDEFINED") : typ.ifcTyp;
  // D-BW-03: no default status — unknown stays null ("ohne Status").
  const status = normalizeStatus(el?.status);
  quelle.status = status ? "gesetzt" : "offen";

  const istWand = typ.ifc === "IfcWall";
  // 107-03 task 5: a slab with a `composite` (project build-up) has a build-up too; 114-02: so has a slab with `katalog_typ` (catalogue
  // type, resolved by aufbauVon first); other non-walls still have none
  const aufbau = istWand || el?.composite || el?.katalog_typ ? aufbauVon(el) : null;
  // `null` states "no core" on purpose (wandGeometrie does the same); a thickness-only wall has no core for the reference lines (kernVon)
  const kernSplit = ctx.kern !== undefined ? ctx.kern : aufbau && aufbau.quelle !== "dicke" ? kernLage(aufbau.schichten) : null;
  // 107-01 (D-BK-01, D-BW-03): a core reference line ("coreOutside" …) without a known core layer is drawn like "center"
  // (bauteil/referenz.js); the data sheet says so instead of showing it as decided. Only walls with such a value get the
  // field, so every other data sheet (and the IFC "Herkunft" text) stays byte-identical.
  if (istWand && kernFehlt(el?.refLine, aufbau?.dicke_m || wandDicke_m(el), kernSplit)) {
    quelle.refLine = "abgeleitet";
    annahmen.push(KERN_ANNAHME[el.refLine]);
  } else if (istWand && KERN_REF_LINIEN.includes(el?.refLine) && /** @type {any} */ (kernSplit)?.abgeleitet) {
    // 107-03: a core exists but only as a proposal from the material (nothing stated in the build-up or on the element)
    quelle.refLine = "abgeleitet";
    annahmen.push(KERN_VORSCHLAG[el.refLine]);
  }
  // 107-03 (D-BW-03): the layer function of a layered wall is a proposal until the build-up or the element states it; the data sheet says so
  // (no `quelle` key: it would change the IFC "Herkunft" text of every wall, golden of 107-01). Single-layer walls need no hint.
  if (aufbau && aufbau.schichten.length > 1 && aufbau.funktionAbgeleitet) annahmen.push("Funktion der Schichten aus dem Material abgeleitet — bitte bestätigen");
  // 107-03 review: a build-up may state a function that is itself an [ASSUMED] value (timber: core = insulation between the studs); it is
  // stated, not derived, but still unconfirmed — the sheet says so (again no `quelle` key, same reason as above)
  if (aufbau && aufbau.funktionAnnahme) annahmen.push("Funktion einzelner Schichten des Aufbaus ist eine Annahme — bitte bestätigen");
  const material = wahl("material", el?.material, aufbau && aufbau.quelle !== "keine" && aufbau.quelle !== "dicke" ? aufbau.name : null);

  const kgNetz = ctx.netzGewerk ? KG_NETZ[ctx.netzGewerk] : null;
  const kg = wahl("kg", el?.kg, typ.kg ?? kgNetz);
  const lbCode = wahl("gewerk", el?.gewerk_lb, typ.lb ?? (key === "hausanschluss" || key === "rohrformteil" ? { heizung: "041", trinkwasser: "042", abwasser: "044" }[ctx.netzGewerk ?? ""] : null));
  const gewerk = lbEintrag(lbCode);
  const bauabschnitt = wahl("bauabschnitt", el?.bauabschnitt, null);
  // 107-08: a GUID pinned lazily (guidsSichern / BIM studio) holds exactly the derived value — it stays "abgeleitet", so pinning never
  // changes the IFC text; it counts as "gesetzt" once it differs from the derivation (project copy, imported or hand-set GUID)
  const gespeichert = typeof el?.guid === "string" && el.guid.length === 22;
  quelle.guid = gespeichert && el.guid !== stabileGuid(`${ctx.projektId ?? "-"}|${ctx.quelle || key}|${el?.id ?? el?._idx ?? "?"}`) ? "gesetzt" : "abgeleitet";

  const offen = Object.entries(quelle).filter(([, v]) => v === "offen").map(([k]) => k);
  return {
    typ: key,
    label: typ.label,
    bereich: typ.bereich,
    ifc: { klasse: /** @type {string} */ (ifcKlasse), typ: ifcTyp },
    guid: bauteilGuid(ctx.projektId, ctx.quelle || key, el),
    status,
    // 97-05: each layer carries its own status (schicht_status[index]) or inherits the element's.
    aufbau: aufbau && aufbau.quelle !== "keine" ? { name: aufbau.name, quelle: aufbau.quelle, dicke_m: aufbau.dicke_m, funktionAbgeleitet: aufbau.funktionAbgeleitet, funktionAnnahme: aufbau.funktionAnnahme, prioritaetAbgeleitet: aufbau.prioritaetAbgeleitet, kern: kernLage(aufbau.schichten),
      schichten: aufbau.schichten.map((l, i) => ({ ...l, status: normalizeStatus(el?.schicht_status?.[i]) ?? status, statusGeerbt: normalizeStatus(el?.schicht_status?.[i]) == null })) } : null,
    material,
    gewerk,
    gewerkGrob: typeof el?.gewerk === "string" && el.gewerk ? el.gewerk : typ.gewerkGrob ?? null,
    kg,
    menge: mengeVon(typ, el, ctx),
    bauabschnitt,
    tragend: el?.tragend ?? typ.tragend ?? false,
    feuerwiderstand: typeof el?.feuerwiderstand === "string" && el.feuerwiderstand.trim() ? el.feuerwiderstand : null,
    statik_vermerk: typeof el?.statik_vermerk === "string" && el.statik_vermerk.trim() ? el.statik_vermerk : null,
    kennwerte: kennwerteVon(el, aufbau),
    typQuelle: el?.bauteil_typ_quelle === "automatisch" || el?.bauteil_typ_quelle === "nutzer" ? el.bauteil_typ_quelle : null,
    verschneidungsgruppe: { wert: verschneidungsgruppe(el), quelle: el?.verschneidungsgruppe != null && verschneidungsgruppe(el) === Number(el.verschneidungsgruppe) ? "gesetzt" : "offen" },
    verschneidung: ctx.verschneidung || null,
    ...(ctx.abschraegung ? { abschraegung: ctx.abschraegung } : {}),
    quelle,
    offen,
    annahmen,
  };
}
