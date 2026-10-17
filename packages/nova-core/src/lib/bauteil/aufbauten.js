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
// In: nothing. Out: WALL_COMPOSITES, WAND_KLASSEN, WANDSTAERKEN, aufbauVon(). No I/O.

/**
 * Layered wall build-ups of the designer. rw = R'w in dB, [ASSUMED] guide value (phase 39).
 * @type {Array<{id: string, name: string, rw: number, skins: Array<{name: string, material: string, thickness: number, color: string, hatch: string, schicht?: string}>}>}
 */
export const WALL_COMPOSITES = [
  { id: "single24", name: "Stahlbeton 24 cm", rw: 57, skins: [
    { name: "Stahlbeton", material: "beton", thickness: 240, color: "#9aa6b2", hatch: "concrete", schicht: "Stahlbeton" },
  ] },
  { id: "cavity", name: "Klinker + Dämmung + KS (39 cm)", rw: 55, skins: [
    { name: "Klinker", material: "klinker", thickness: 100, color: "#b45309", hatch: "brick", schicht: "Klinker" },
    // The cavity is ventilated (DIN 1053 pattern) — physically the section ends here (luftbel, phase 44).
    { name: "Luftschicht", material: "luftbel", thickness: 50, color: "#f1f5f9", hatch: "none" },
    { name: "Dämmung", material: "mw035", thickness: 120, color: "#fde68a", hatch: "insul", schicht: "Dämmung" },
    { name: "Kalksandstein", material: "ks", thickness: 175, color: "#94a3b8", hatch: "block", schicht: "Kalksandstein" },
    { name: "Innenputz", material: "gipsputz", thickness: 15, color: "#e2e8f0", hatch: "none" },
  ] },
  { id: "timber", name: "Holzrahmen (30 cm)", rw: 44, skins: [
    { name: "Fassade Holz", material: "holz", thickness: 24, color: "#92400e", hatch: "wood", schicht: "Holz" },
    { name: "Hinterlüftung", material: "luftbel", thickness: 40, color: "#f1f5f9", hatch: "none" },
    { name: "Dämmung", material: "mw035", thickness: 200, color: "#fde68a", hatch: "insul", schicht: "Dämmung" },
    { name: "OSB", material: "osb", thickness: 18, color: "#d6b38a", hatch: "wood" },
    { name: "GK-Beplankung", material: "gk", thickness: 18, color: "#e2e8f0", hatch: "none" },
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

/**
 * Build-up of a wall element as layers in metres, outside → inside.
 * Looks at `composite` (designer build-up) first, then `klasse` (workshop), then a single
 * `thickness`/`dicke_m` layer without material (the data sheet shows it as "Material offen").
 * @param {{composite?: string, klasse?: string, thickness?: number, dicke_m?: number}} el
 * @returns {{quelle: 'composite'|'klasse'|'dicke'|'keine', name: string, schichten: Array<{name: string, material: string|null, dicke_m: number}>, dicke_m: number}}
 */
export function aufbauVon(el) {
  const c = el?.composite ? WALL_COMPOSITES.find((x) => x.id === el.composite) : null;
  const k = !c && el?.klasse ? WAND_KLASSEN[el.klasse] : null;
  const skins = c?.skins || k?.skins || null;
  if (skins) {
    const schichten = skins.map((s) => ({ name: s.name, material: s.material, dicke_m: s.thickness / 1000 }));
    return { quelle: c ? "composite" : "klasse", name: c ? c.name : k.material, schichten, dicke_m: Math.round(schichten.reduce((a, s) => a + s.dicke_m, 0) * 1000) / 1000 };
  }
  const d = Number(el?.thickness ?? el?.dicke_m);
  if (Number.isFinite(d) && d > 0) return { quelle: "dicke", name: `${Math.round(d * 1000) / 10} cm, Material offen`, schichten: [{ name: "Kern", material: null, dicke_m: d }], dicke_m: d };
  return { quelle: "keine", name: "kein Aufbau", schichten: [], dicke_m: 0 };
}
