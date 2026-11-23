// 115-05c (D-115-12): which stored fields are DRAFT fields - changed on the page, written only with "Speichern" - and which
// are derived. Everything else keeps its autosave with the stand protection of 115-05a/b (views, caches, layers of other
// editors, the BuildingComplex fields outside the site group; see 115-05-PLAN §8).
//
// In:  the field lists of the merge modules. Out: ENTWURF_FELDER, ABGELEITET.

import { IDX_LISTEN } from "../abgleich/idxListen.js";
import { STUDIO_WERTE } from "../abgleich/modellAbgleich.js";
import { KOMPLEX_LAGE_GRUPPE, KOMPLEX_ABGELEITET } from "../abgleich/komplexAbgleich.js";

/**
 * Program fields of the BimModel (owned by useBimModelSync; repeated here so this module stays free of React — the unit test
 * modellEntwurf-11505c compares it with useBimModelSync's PROGRAMM_FELDER).
 * @type {ReadonlyArray<string>}
 */
export const PROGRAMM_ENTWURF_FELDER = Object.freeze(["footprintM", "footprintQuelle", "achseM", "storeys", "storeyHeight", "geschosse",
  "untergeschosse", "unit", "footprintLageM"]);

/**
 * Draft fields per record. bim (BimModel): the ten element lists, the envelope values of the studio, the program fields, the
 * attribute layer and the solid relations (the component operations point at GUIDs of draft elements, fachlayerSchema.js — in the
 * draft they never outlive a discarded element). komplex (BuildingComplex): the site/location group (one unit, 115-05a) and the
 * cost estimate (derived from the draft, so the costs of an unsaved draft are never stored).
 * 115-05c as built: the studio reports the ten lists, the envelope values and the attribute layer, the program hook
 * (useBimModelSync) the program fields, useFachlayer({entwurf: true}) the solid relations, the designer the site group; the massing
 * takeover changes the lists through entwurfStand.bimListenAendern (115-05c-SUMMARY).
 * @type {Readonly<{bim: ReadonlyArray<string>, komplex: ReadonlyArray<string>}>}
 */
export const ENTWURF_FELDER = Object.freeze({
  bim: Object.freeze([...IDX_LISTEN, ...Object.keys(STUDIO_WERTE), ...PROGRAMM_ENTWURF_FELDER, "bauteil_attribute_layer", "solidrelationen_layer"]),
  komplex: Object.freeze([...KOMPLEX_LAGE_GRUPPE, "cost_estimate"]),
});

/**
 * Derived values: never make a draft "dirty", never an undo step, recomputed after a rebase, never shown as a conflict
 * (the stored value counts when both sides changed them - komplexAbgleich.js).
 * @type {ReadonlyArray<string>}
 */
export const ABGELEITET = KOMPLEX_ABGELEITET;
