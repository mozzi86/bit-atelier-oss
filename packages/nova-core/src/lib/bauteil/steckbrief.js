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
//   schicht_status (97-05: { "<layer index>": status }, outside → inside).
//
// In: an element object plus its type key. Out: steckbrief() data sheet, BAUTEIL_TYPEN registry,
// bauteilGuid(), typFuerWand(), typFuerNetz(). No I/O.

import { stabileGuid } from "../werkstattBauteile.js";
import { aufbauVon } from "./aufbauten.js";
import { lbEintrag } from "./gewerke.js";
import { normalizeStatus } from "../bimClassification.js";

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
 * @param {{storeyHeight?: number}} ctx storeyHeight in m (default 3)
 * @returns {{wert: number, einheit: string}}
 */
export function mengeVon(typ, el, ctx = {}) {
  const h = Number(el?.height ?? el?.hoehe_m ?? ctx.storeyHeight ?? 3) || 3;
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
 * @property {{name: string, schichten: Array<{name: string, material: string|null, dicke_m: number, status: string|null, statusGeerbt: boolean}>, dicke_m: number}|null} aufbau
 * @property {string|null} material       short material text
 * @property {{lb: string, name: string, folge: number}|null} gewerk  STLB-Bau LB with site order
 * @property {string|null} gewerkGrob     coarse AVA trade
 * @property {string|null} kg             DIN 276 cost group
 * @property {{wert: number, einheit: string}} menge
 * @property {string|null} bauabschnitt
 * @property {boolean} tragend
 * @property {Record<string, 'gesetzt'|'abgeleitet'|'offen'>} quelle  origin per field
 * @property {string[]} offen             fields nobody has decided yet (shown as hints)
 * @property {string[]} annahmen          assumptions behind derived values
 */

/**
 * The data sheet of one element.
 * @param {any} el element (drawn, workshop, network, penetration …)
 * @param {string} typKey key of BAUTEIL_TYPEN; `el.bauteil_typ` overrides it
 * @param {{projektId?: string|number|null, quelle?: string, storeyHeight?: number, typAbgeleitet?: boolean, netzGewerk?: string}} [ctx]
 *   quelle: source name for the GUID; typAbgeleitet: the type itself is an assumption;
 *   netzGewerk: trade of the penetrating line (penetration, fire stop) for the KG.
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

  quelle.typ = el?.bauteil_typ && BAUTEIL_TYPEN[el.bauteil_typ] ? "gesetzt" : ctx.typAbgeleitet ? "abgeleitet" : "gesetzt";
  if (quelle.typ === "abgeleitet") annahmen.push(`Bauteiltyp „${typ.label}“ aus Aufbau/Dicke abgeleitet`);
  if (typ.annahme) annahmen.push(typ.annahme);

  const ifcKlasse = wahl("ifc", el?.ifc_klasse, typ.ifc);
  const ifcTyp = el?.ifc_klasse ? (el?.ifc_typ || "NOTDEFINED") : typ.ifcTyp;
  // D-BW-03: no default status — unknown stays null ("ohne Status").
  const status = normalizeStatus(el?.status);
  quelle.status = status ? "gesetzt" : "offen";

  const istWand = typ.ifc === "IfcWall";
  const aufbau = istWand ? aufbauVon(el) : null;
  const material = wahl("material", el?.material, aufbau && aufbau.quelle !== "keine" && aufbau.quelle !== "dicke" ? aufbau.name : null);

  const kgNetz = ctx.netzGewerk ? KG_NETZ[ctx.netzGewerk] : null;
  const kg = wahl("kg", el?.kg, typ.kg ?? kgNetz);
  const lbCode = wahl("gewerk", el?.gewerk_lb, typ.lb ?? (key === "hausanschluss" || key === "rohrformteil" ? { heizung: "041", trinkwasser: "042", abwasser: "044" }[ctx.netzGewerk ?? ""] : null));
  const gewerk = lbEintrag(lbCode);
  const bauabschnitt = wahl("bauabschnitt", el?.bauabschnitt, null);
  quelle.guid = typeof el?.guid === "string" && el.guid.length === 22 ? "gesetzt" : "abgeleitet";

  const offen = Object.entries(quelle).filter(([, v]) => v === "offen").map(([k]) => k);
  return {
    typ: key,
    label: typ.label,
    bereich: typ.bereich,
    ifc: { klasse: /** @type {string} */ (ifcKlasse), typ: ifcTyp },
    guid: bauteilGuid(ctx.projektId, ctx.quelle || key, el),
    status,
    // 97-05: each layer carries its own status (schicht_status[index]) or inherits the element's.
    aufbau: aufbau && aufbau.quelle !== "keine" ? { name: aufbau.name, dicke_m: aufbau.dicke_m,
      schichten: aufbau.schichten.map((l, i) => ({ ...l, status: normalizeStatus(el?.schicht_status?.[i]) ?? status, statusGeerbt: normalizeStatus(el?.schicht_status?.[i]) == null })) } : null,
    material,
    gewerk,
    gewerkGrob: typeof el?.gewerk === "string" && el.gewerk ? el.gewerk : typ.gewerkGrob ?? null,
    kg,
    menge: mengeVon(typ, el, ctx),
    bauabschnitt,
    tragend: el?.tragend ?? typ.tragend ?? false,
    quelle,
    offen,
    annahmen,
  };
}
