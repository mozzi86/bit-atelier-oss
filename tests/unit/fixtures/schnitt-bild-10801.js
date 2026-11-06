// 108-01 review: the flat-roof cases of the screen section (BimPlan2D mode "schnitt") whose SVG must stay byte-identical to the state
// before 108-01 (golden schnitt-bild-10801-vorher.json, made with BimPlan2D.jsx of fa945693 by
// .planning/phases/108-efh-satteldach/tmp-e2e/golden-schnitt-bild-10801.mjs). Invented values, no real project.
//
// In:  createBuildingModel (passed in, so the golden script can hand over the module loaded by vite). Out: SCHNITT_FAELLE(cb) →
//      { name: props of BimPlan2D without `dach` / `achse` }.

/** Footprint 11.40 × 10.20 m centred on the vertex mean (the neutral house of phase 108). */
const EFH = [{ x: -5.7, z: -5.1 }, { x: 5.7, z: -5.1 }, { x: 5.7, z: 5.1 }, { x: -5.7, z: 5.1 }];
const EFH_GESCHOSSE = [{ level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.6 }];

/**
 * @param {(input: Record<string, any>) => any} createBuildingModel
 * @returns {Record<string, Record<string, any>>} props per case
 */
export function SCHNITT_FAELLE(createBuildingModel) {
  const efh = (/** @type {Record<string, any>} */ anders) => createBuildingModel({
    footprintM: EFH.map((p) => ({ ...p })), storeys: 2, storeyHeight: 2.9, geschosse: EFH_GESCHOSSE, untergeschosse: 1, ...anders });
  const block = createBuildingModel({ footprintM: [{ x: -8, z: -6 }, { x: 8, z: -6 }, { x: 8, z: 6 }, { x: -8, z: 6 }], storeys: 4, storeyHeight: 3.1,
    parapet: { enabled: true, height: 1.1 } });
  return {
    "Block 4 Geschosse mit Attika": { model: block, mode: "schnitt", storeyHeight: 3.1, height: 520 },
    "Block ohne Attika/Maße/Beschriftung": { model: block, mode: "schnitt", storeyHeight: 3.1, height: 700, layerVis: { attika: false, dimensions: false, labels: false } },
    "EFH mit KG ohne Attika": { model: efh({ parapet: { enabled: false, height: 1 } }), mode: "schnitt", storeyHeight: 2.9, height: 520 },
    "EFH mit KG und Attika": { model: efh({ parapet: { enabled: true, height: 1 } }), mode: "schnitt", storeyHeight: 2.9, height: 520 },
  };
}
