// The ONE build-up table for walls (phase 97-02a, concept .planning/phases/97-brillen/97-KONZEPT.md §1a).
// Before, three tables described the same walls independently: WALL_COMPOSITES (buildingModel,
// layered build-ups of the designer), WAND_KLASSEN (workshop wall classes with KG/trade/material
// text) and WANDSTAERKEN (tesselierung, display thicknesses copied by hand from WAND_KLASSEN).
// All three now come from here; buildingModel, werkstattBauteile and tesselierung re-export.
// WANDDICKEN (massordnung) stays where it is: it is the octametric grid of nominal masonry
// thicknesses, not a build-up.
//
// Layers run outside → inside. `material` is a MATERIAL_KATALOG id (designer bauteilAufbau),
// `thickness` in mm (legacy unit of WALL_COMPOSITES), `schicht` the AVA layer vocabulary
// (bimClassification SCHICHTEN) — only where the AVA filter used it before, so the AVA output
// stays byte-identical.
//
// 107-03 (spec II.3 a-c): a layer may carry a FUNCTION (`funktion`: "kern" | "bekleidung" | "sonstig") and an intersection
// PRIORITY (`prioritaet`: integer 0-999). The three fixed build-ups carry the function EXPLICITLY (the material category
// alone misses the core: "cavity" starts with clinker, category "Massiv", "timber" with "Fassade Holz", category "Holz" — both
// are outer layers). Layers without a stated function get a PROPOSAL (funktionVorschlag), marked as derived (D-BW-03: nothing
// assumed looks decided). A wall element may override both per layer: `schicht_funktion` and `schicht_prioritaet`
// ({ "<layer index>": value }, index outside → inside, same pattern as `schicht_status` of 97-05). The priority has no effect
// yet — the intersection that uses it comes in 107-09; until then it is data and an IFC attribute.
// The core feeds the core reference lines (referenz.js refVersatz_m: coreOutside / coreInside / coreCenter, kernLage()).
//
// Project build-ups (107-03 task 5, D-BK-22): the fachlayer `aufbauten_layer` ({aufbauten: {[id]: {name, skins[]}}}) holds
// build-ups of the project. The Studio hands it to setzeProjektAufbauten(); aufbauById() asks that registry FIRST, then the
// constants (a project id equal to a constant id shadows the constant for this project). Skins stay in mm, aufbauVon() in m.
//
// In: element records ({composite?, klasse?, thickness?, dicke_m?, schicht_funktion?, schicht_prioritaet?}).
// Out: WALL_COMPOSITES, WAND_KLASSEN, WANDSTAERKEN, aufbauVon(), funktionVorschlag(), prioritaetVorschlag(), kernLage(),
//      aufbauById(), aufbautenListe(), setzeProjektAufbauten(), gibProjektAufbautenFrei(), overridesNachEntfernen(). No I/O (the registry is one module-level map, set by the caller).
import { materialById } from "./materialien.js";

/** Layer functions (107-03, D-BK-06; German vocabulary, the spec's Core/Finish/Other). */
export const FUNKTIONEN = Object.freeze(["kern", "bekleidung", "sonstig"]);

/** Highest intersection priority (spec 0-999, D-BK-07). */
export const MAX_PRIORITAET = 999;

/**
 * One layer of a build-up (outside → inside).
 * @typedef {object} Skin
 * @property {string} name
 * @property {string} material   MATERIAL_KATALOG id
 * @property {number} thickness  thickness in mm
 * @property {string} color      display colour (hex)
 * @property {string} hatch      hatch pattern
 * @property {string} [schicht]  AVA layer bucket
 * @property {"kern"|"bekleidung"|"sonstig"} [funktion]  layer function stated explicitly (107-03); absent = proposal
 * @property {number} [prioritaet]  intersection priority 0-999 stated explicitly (107-03); absent = proposal
 * @property {boolean} [funktionAnnahme]  true where the stated function is itself an [ASSUMED] value the user still has to confirm (107-03 review)
 */

/**
 * Layered wall build-ups of the designer. rw = R'w in dB, [ASSUMED] guide value (phase 39).
 * @type {Array<{id: string, name: string, rw?: number, skins: Skin[]}>}
 */
export const WALL_COMPOSITES = [
  { id: "single24", name: "Stahlbeton 24 cm", rw: 57, skins: [
    { name: "Stahlbeton", material: "beton", thickness: 240, color: "#9aa6b2", hatch: "concrete", schicht: "Stahlbeton", funktion: "kern" },
  ] },
  { id: "cavity", name: "Klinker + Dämmung + KS (39 cm)", rw: 55, skins: [
    { name: "Klinker", material: "klinker", thickness: 100, color: "#b45309", hatch: "brick", schicht: "Klinker", funktion: "bekleidung" },
    // The cavity is ventilated (DIN 1053 pattern) — physically the section ends here (luftbel, phase 44).
    { name: "Luftschicht", material: "luftbel", thickness: 50, color: "#f1f5f9", hatch: "none", funktion: "sonstig" },
    { name: "Dämmung", material: "mw035", thickness: 120, color: "#fde68a", hatch: "insul", schicht: "Dämmung", funktion: "sonstig" },
    // The core of the cavity wall is the calcium silicate masonry behind the insulation (spec II.3a; D-BK-06).
    { name: "Kalksandstein", material: "ks", thickness: 175, color: "#94a3b8", hatch: "block", schicht: "Kalksandstein", funktion: "kern" },
    { name: "Innenputz", material: "gipsputz", thickness: 15, color: "#e2e8f0", hatch: "none", funktion: "bekleidung" },
  ] },
  { id: "timber", name: "Holzrahmen (30 cm)", rw: 44, skins: [
    { name: "Fassade Holz", material: "holz", thickness: 24, color: "#92400e", hatch: "wood", schicht: "Holz", funktion: "bekleidung" },
    { name: "Hinterlüftung", material: "luftbel", thickness: 40, color: "#f1f5f9", hatch: "none", funktion: "sonstig" },
    // [ASSUMED] core of the timber frame = the 200 mm insulation between the studs: the table shows the stud layer only as insulation
    // (the studs themselves are not a layer), and the structure of the wall is exactly that bay. The user confirms or corrects it
    // (D-BK-06). Way to a proven value: a build-up that models the studs as their own layer (then that layer is the core).
    // `funktionAnnahme` makes data sheet, inspector and IFC say "Annahme" instead of showing the function as decided (D-BW-03).
    { name: "Dämmung", material: "mw035", thickness: 200, color: "#fde68a", hatch: "insul", schicht: "Dämmung", funktion: "kern", funktionAnnahme: true },
    // [ASSUMED] OSB = stiffening layer, not the core ("sonstig"); the user may mark it as core per element (schicht_funktion).
    { name: "OSB", material: "osb", thickness: 18, color: "#d6b38a", hatch: "wood", funktion: "sonstig", funktionAnnahme: true },
    { name: "GK-Beplankung", material: "gk", thickness: 18, color: "#e2e8f0", hatch: "none", funktion: "bekleidung" },
  ] },
];

/**
 * Wall classes of the workshop [ASSUMED rule build-ups]: thickness m, KG DIN 276, trade, material
 * text, load-bearing, and the layers the thickness consists of (plaster finishes are named in
 * the text and not counted, as before).
 */
export const WAND_KLASSEN = Object.freeze({
  aussen: Object.freeze({ dicke_m: 0.365, kg: "331", gewerk: "Rohbau", material: "Mauerwerk 36,5 cm (Außenwand, Hülle)", tragend: true,
    skins: Object.freeze([Object.freeze({ name: "Mauerwerk (Hochlochziegel)", material: "hlz", thickness: 365 })]) }),
  tragend: Object.freeze({ dicke_m: 0.24, kg: "341", gewerk: "Rohbau", material: "Kalksandstein 24 cm, beidseitig Putz", tragend: true,
    skins: Object.freeze([Object.freeze({ name: "Kalksandstein", material: "ks", thickness: 240 })]) }),
  leicht: Object.freeze({ dicke_m: 0.115, kg: "342", gewerk: "Rohbau", material: "Kalksandstein 11,5 cm, beidseitig Putz", tragend: false,
    skins: Object.freeze([Object.freeze({ name: "Kalksandstein", material: "ks", thickness: 115 })]) }),
});

/** Display thicknesses per workshop class (D-P75-06), derived — never a second number. */
export const WANDSTAERKEN = Object.freeze(Object.fromEntries(Object.entries(WAND_KLASSEN).map(([k, v]) => [k, v.dicke_m])));

// ---- Layer function and priority (107-03) ------------------------------------------------------

/**
 * Intersection priority proposal per material category (spec II.3c, 0-999: the higher priority wins where two layers meet).
 * [ASSUMED] guide values by material family, not a norm: reinforced concrete 850 (own entry below), masonry 650, timber 620,
 * dry-wall boards (incl. OSB) 450, insulation 320, plaster / air / membranes 150. The order only says "structure beats finish
 * beats air"; the exact numbers are free. Way to a proven value: an intersection priority table of the construction types supplied by the
 * user; until then the proposal is marked "abgeleitet" everywhere.
 */
const PRIORITAET_KATEGORIE = Object.freeze({ Massiv: 650, Holz: 620, Platte: 450, "Dämmung": 320, Putz: 150, Luft: 150, Bahn: 150 });
/** [ASSUMED] reinforced concrete beats every other material (850); see PRIORITAET_KATEGORIE. */
const PRIORITAET_BETON = 850;
/** [ASSUMED] priority of a layer whose material is unknown (thickness-only wall, material not in the catalogue): the middle of the range. */
const PRIORITAET_UNBEKANNT = 500;

/**
 * Priority PROPOSAL of a layer from its material (never stored, always "abgeleitet").
 * @param {string|null|undefined} materialId MATERIAL_KATALOG id; unknown or missing material gives 500
 * @returns {number} priority 0-999
 */
export function prioritaetVorschlag(materialId) {
  if (materialId === "beton") return PRIORITAET_BETON;
  const kat = materialById(materialId)?.kategorie;
  return (kat && PRIORITAET_KATEGORIE[kat]) || PRIORITAET_UNBEKANNT;
}

/** @param {unknown} v @returns {v is "kern"|"bekleidung"|"sonstig"} */
const istFunktion = (v) => typeof v === "string" && FUNKTIONEN.includes(v);
/** @param {unknown} v @returns {v is number} integer 0-999 */
const istPrioritaet = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= MAX_PRIORITAET;
/** @param {{dicke_m?: number, thickness?: number}} s layer, thickness in m (dicke_m) or mm (thickness) @returns {number} thickness in m */
const dickeM = (s) => (Number.isFinite(s?.dicke_m) ? /** @type {number} */ (s.dicke_m) : (Number(s?.thickness) || 0) / 1000);

/**
 * Function of every layer: a stated function stays, the rest is PROPOSED (D-BK-06).
 * Proposal rule: the core is the thickest layer of the material category "Massiv" or "Holz" that is not the OUTERMOST layer of a
 * multi-layer build-up (clinker or timber cladding is never the core, whatever its category says); the other Massiv/Holz layers,
 * plaster and boards are "bekleidung"; insulation, membranes and air are "sonstig"; a single layer of unknown material is the core
 * (the "Kern" layer of a thickness-only wall). Without a candidate there is no core (the core reference lines then act as "center").
 * A layer already stated as "kern" blocks the proposal of another core. Ties go to the outer layer.
 * @param {Array<{material?: string|null, dicke_m?: number, thickness?: number, funktion?: string|null}>} schichten layers outside → inside;
 *   thickness in m (dicke_m) or mm (thickness); `funktion` = the stated function, if any
 * @returns {Array<{funktion: "kern"|"bekleidung"|"sonstig", abgeleitet: boolean}>} one entry per layer; abgeleitet = true where the function is a proposal
 */
export function funktionVorschlag(schichten) {
  const n = schichten.length;
  const gesetzt = schichten.map((s) => (istFunktion(s?.funktion) ? s.funktion : null));
  const hatKern = gesetzt.includes("kern");
  let kern = -1;
  if (!hatKern) {
    let best = -1;
    schichten.forEach((s, i) => {
      if (gesetzt[i]) return;
      const kat = materialById(s?.material)?.kategorie;
      if (kat !== "Massiv" && kat !== "Holz") return;
      if (n > 1 && i === 0) return; // the outermost layer of a multi-layer build-up is a cladding, not the core
      const d = dickeM(s);
      if (d > best) { best = d; kern = i; }
    });
    // a single layer of unknown material (thickness-only wall): the whole wall body is the core
    if (kern < 0 && n === 1 && !gesetzt[0] && !materialById(schichten[0]?.material)) kern = 0;
  }
  return schichten.map((s, i) => {
    if (gesetzt[i]) return { funktion: /** @type {"kern"|"bekleidung"|"sonstig"} */ (gesetzt[i]), abgeleitet: false };
    if (i === kern) return { funktion: "kern", abgeleitet: true };
    const kat = materialById(s?.material)?.kategorie;
    return { funktion: kat === "Massiv" || kat === "Holz" || kat === "Putz" || kat === "Platte" ? "bekleidung" : "sonstig", abgeleitet: true };
  });
}

/**
 * Core split of a build-up for the core reference lines (referenz.js refVersatz_m).
 * The core is the first layer with function "kern" plus the layers directly behind it that are also "kern" (a core of two layers);
 * a later, separated "kern" layer is ignored. `aussen_m` = sum of the layers outside the core, `kern_m` = core thickness.
 * @param {Array<{dicke_m: number, funktion?: string, funktionAbgeleitet?: boolean}>} schichten layers from aufbauVon(), outside → inside, thickness in m
 * @returns {{aussen_m: number, kern_m: number, abgeleitet: boolean}|null} sums in m (rounded to 1 µm against float noise); abgeleitet = a core layer
 *   is only proposed; null = no core layer (the core reference lines act as "center")
 */
export function kernLage(schichten) {
  const i0 = schichten.findIndex((s) => s.funktion === "kern");
  if (i0 < 0) return null;
  const rund = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
  let aussen = 0;
  for (let j = 0; j < i0; j++) aussen += schichten[j].dicke_m;
  let kern = 0, abgeleitet = false;
  for (let j = i0; j < schichten.length && schichten[j].funktion === "kern"; j++) { kern += schichten[j].dicke_m; abgeleitet = abgeleitet || !!schichten[j].funktionAbgeleitet; }
  return { aussen_m: rund(aussen), kern_m: rund(kern), abgeleitet };
}

// ---- Project build-ups (107-03 task 5, D-BK-22) -------------------------------------------------

/** @type {Map<string, {id: string, name: string, rw?: number, skins: Skin[]}>} build-ups of the project, set by the Studio from `aufbauten_layer` */
let projektAufbauten = new Map();
/** @type {any} the stored layer value the registry was built from (identity), so a view can release only what it set itself */
let projektAufbautenQuelle = null;

/**
 * Valid composites from the stored layer value `aufbauten_layer` ({aufbauten: {[id]: {name, skins[]}}}); an entry without a
 * usable layer is dropped. Missing colour/hatch/AVA bucket come from the material, a function or priority outside its range is
 * dropped (the layer then gets a proposal). Pure.
 * @param {any} layer stored fachlayer value (null/undefined = none)
 * @returns {Array<{id: string, name: string, rw?: number, skins: Skin[]}>} composites, skins in mm
 */
export function normalisiereProjektAufbauten(layer) {
  const roh = layer && typeof layer === "object" && layer.aufbauten && typeof layer.aufbauten === "object" ? layer.aufbauten : {};
  /** @type {Array<{id: string, name: string, rw?: number, skins: Skin[]}>} */
  const aus = [];
  for (const [id, e] of Object.entries(roh)) {
    if (!id || !e || !Array.isArray(e.skins)) continue;
    /** @type {Skin[]} */
    const skins = [];
    for (const k of e.skins) {
      const d = Number(k?.thickness);
      if (!(d > 0) || !Number.isFinite(d)) continue;
      const mat = materialById(k?.material);
      /** @type {Skin} */
      const skin = { name: typeof k.name === "string" && k.name ? k.name : mat?.name || "Schicht", material: typeof k.material === "string" ? k.material : "", thickness: d,
        color: typeof k.color === "string" ? k.color : mat?.color || "#e2e8f0", hatch: typeof k.hatch === "string" ? k.hatch : mat?.hatch || "none" };
      if (typeof k.schicht === "string") skin.schicht = k.schicht; else if (mat?.schicht) skin.schicht = mat.schicht;
      if (istFunktion(k.funktion)) { skin.funktion = k.funktion; if (k.funktionAnnahme === true) skin.funktionAnnahme = true; }
      if (istPrioritaet(k.prioritaet)) skin.prioritaet = k.prioritaet;
      skins.push(skin);
    }
    if (!skins.length) continue;
    aus.push({ id, name: typeof e.name === "string" && e.name ? e.name : id, ...(Number.isFinite(e.rw) ? { rw: e.rw } : {}), skins });
  }
  return aus;
}

/**
 * Hand the stored project build-ups to the lookup. Idempotent; the Studio calls it on every render with the current layer value
 * (module-level state outside React, so the many pure readers — plan, PDF, IFC, steckbrief — see the same build-ups without a prop chain).
 * @param {any} layer `aufbauten_layer` value or null (null clears the registry)
 * @returns {void}
 */
export function setzeProjektAufbauten(layer) {
  projektAufbauten = new Map(normalisiereProjektAufbauten(layer).map((c) => [c.id, c]));
  projektAufbautenQuelle = layer ?? null;
}

/**
 * Empties the registry, but only when it still holds what `layer` set (a view that unmounts must not wipe the build-ups another view
 * set meanwhile; the ids "p-1", "p-2" … exist in every project, so a stale registry would resolve them against the wrong project).
 * @param {any} layer the value this view passed to setzeProjektAufbauten()
 * @returns {void}
 */
export function gibProjektAufbautenFrei(layer) {
  if (projektAufbautenQuelle === (layer ?? null)) setzeProjektAufbauten(null);
}

/**
 * Element overrides per layer index (outside → inside) after layer `index` was removed from a build-up: the key of the removed layer is
 * dropped, the keys behind it move up by one, so every override still sits on the layer it was set for.
 * Covers schicht_funktion, schicht_prioritaet (107-03) and schicht_status (97-05).
 * @param {{schicht_funktion?: Record<string, any>|null, schicht_prioritaet?: Record<string, any>|null, schicht_status?: Record<string, any>|null}} el element record
 * @param {number} index index of the removed layer (0-based, outside → inside)
 * @returns {Record<string, Record<string, any>|undefined>|null} patch for the element (an emptied map becomes undefined), null = nothing to change
 */
export function overridesNachEntfernen(el, index) {
  /** @type {Record<string, Record<string, any>|undefined>} */
  const patch = {};
  for (const feld of /** @type {const} */ (["schicht_funktion", "schicht_prioritaet", "schicht_status"])) {
    const alt = el?.[feld];
    if (!alt || typeof alt !== "object") continue;
    /** @type {Record<string, any>} */
    const neu = {};
    for (const [k, v] of Object.entries(alt)) {
      const j = Number(k);
      if (!Number.isInteger(j) || j === index) continue;
      neu[String(j > index ? j - 1 : j)] = v;
    }
    if (JSON.stringify(neu) !== JSON.stringify(alt)) patch[feld] = Object.keys(neu).length ? neu : undefined;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Build-up by id: the project registry first, then the constants (D-BK-22).
 * @param {string|null|undefined} id
 * @returns {{id: string, name: string, rw?: number, skins: Skin[]}|null}
 */
export function aufbauById(id) {
  if (!id) return null;
  return projektAufbauten.get(id) || WALL_COMPOSITES.find((c) => c.id === id) || null;
}

/**
 * All selectable build-ups: those of the project first, then the constants (a project entry with a constant's id replaces it).
 * @returns {Array<{id: string, name: string, rw?: number, skins: Skin[]}>}
 */
export function aufbautenListe() {
  return [...projektAufbauten.values(), ...WALL_COMPOSITES.filter((c) => !projektAufbauten.has(c.id))];
}

// ---- The build-up of an element ------------------------------------------------------------------

/**
 * @typedef {object} AufbauSchicht
 * @property {string} name
 * @property {string|null} material       MATERIAL_KATALOG id or null
 * @property {number} dicke_m             thickness in m
 * @property {"kern"|"bekleidung"|"sonstig"} funktion  layer function (stated, element override or proposal)
 * @property {boolean} funktionAbgeleitet true where the function is a proposal (107-03)
 * @property {boolean} funktionAnnahme   true where the build-up states the function but as an [ASSUMED] value to confirm (107-03 review); false after an element override
 * @property {number} prioritaet          intersection priority 0-999 (stated, element override or proposal; no effect before 107-09)
 * @property {boolean} prioritaetAbgeleitet true where the priority is a proposal
 */

/**
 * Build-up of an element as layers in metres, outside → inside.
 * Looks at `composite` (project build-up first, then the designer constants) first, then `klasse` (workshop), then a single
 * `thickness`/`dicke_m` layer without material (the data sheet shows it as "Material offen"). Walls and, since 107-03 task 5,
 * slabs (`composite` on customSlabs) use the same function — the table does not care about the element type.
 * Function and priority per layer: the element's own `schicht_funktion[i]` / `schicht_prioritaet[i]` win, then the build-up's stated
 * value, else a proposal (funktionVorschlag, prioritaetVorschlag), marked as derived.
 * @param {{composite?: string|null, klasse?: string, thickness?: number, dicke_m?: number, schicht_funktion?: Record<string, string>|null, schicht_prioritaet?: Record<string, number>|null}} el
 * @returns {{quelle: 'composite'|'klasse'|'dicke'|'keine', name: string, schichten: AufbauSchicht[], dicke_m: number, funktionAbgeleitet: boolean, prioritaetAbgeleitet: boolean, funktionAnnahme: boolean}}
 *   funktionAbgeleitet / prioritaetAbgeleitet: true when at least one layer's value is a proposal ("nur bei Vorschlag");
 *   funktionAnnahme: true when at least one layer's stated function is an [ASSUMED] value of the build-up (timber)
 */
export function aufbauVon(el) {
  const c = el?.composite ? aufbauById(el.composite) : null;
  const k = !c && el?.klasse ? WAND_KLASSEN[el.klasse] : null;
  const skins = c?.skins || k?.skins || null;
  /** @type {Array<{name: string, material: string|null, dicke_m: number, funktion?: string, prioritaet?: number, funktionAnnahme?: boolean}>} */
  let roh;
  /** @type {'composite'|'klasse'|'dicke'|'keine'} */
  let quelle;
  let name;
  if (skins) {
    roh = skins.map((s) => ({ name: s.name, material: s.material, dicke_m: s.thickness / 1000, funktion: /** @type {any} */ (s).funktion, prioritaet: /** @type {any} */ (s).prioritaet, funktionAnnahme: /** @type {any} */ (s).funktionAnnahme === true }));
    quelle = c ? "composite" : "klasse";
    name = c ? c.name : /** @type {any} */ (k).material;
  } else {
    const d = Number(el?.thickness ?? el?.dicke_m);
    if (!(Number.isFinite(d) && d > 0)) return { quelle: "keine", name: "kein Aufbau", schichten: [], dicke_m: 0, funktionAbgeleitet: false, prioritaetAbgeleitet: false, funktionAnnahme: false };
    roh = [{ name: "Kern", material: null, dicke_m: d }];
    quelle = "dicke";
    name = `${Math.round(d * 1000) / 10} cm, Material offen`;
  }
  // element override per layer index (the pattern of schicht_status, 97-05); invalid values are ignored
  const of = el?.schicht_funktion, op = el?.schicht_prioritaet;
  const gesetzt = roh.map((s, i) => {
    const f = of?.[i], p = op?.[i];
    // an element override is the user's own decision: it ends the assumption flag of the build-up's value
    return { funktion: istFunktion(f) ? f : s.funktion, prioritaet: istPrioritaet(p) ? p : s.prioritaet, annahme: !istFunktion(f) && !!s.funktionAnnahme && istFunktion(s.funktion) };
  });
  const vorschlag = funktionVorschlag(roh.map((s, i) => ({ material: s.material, dicke_m: s.dicke_m, funktion: gesetzt[i].funktion })));
  const schichten = roh.map((s, i) => {
    const prioGesetzt = istPrioritaet(gesetzt[i].prioritaet);
    return { name: s.name, material: s.material, dicke_m: s.dicke_m, funktion: vorschlag[i].funktion, funktionAbgeleitet: vorschlag[i].abgeleitet,
      prioritaet: prioGesetzt ? /** @type {number} */ (gesetzt[i].prioritaet) : prioritaetVorschlag(s.material), prioritaetAbgeleitet: !prioGesetzt,
      funktionAnnahme: gesetzt[i].annahme && !vorschlag[i].abgeleitet };
  });
  return { quelle, name, schichten, dicke_m: Math.round(schichten.reduce((a, s) => a + s.dicke_m, 0) * 1000) / 1000,
    funktionAbgeleitet: schichten.some((s) => s.funktionAbgeleitet), prioritaetAbgeleitet: schichten.some((s) => s.prioritaetAbgeleitet),
    funktionAnnahme: schichten.some((s) => s.funktionAnnahme) };
}
