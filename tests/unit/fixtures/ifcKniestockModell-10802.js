// 108-02: fixed example model of the IFC golden with a knee wall (tests/unit/fixtures/ifc-golden-108-02-kniestock.ifc): the neutral test
// house of phase 108 (fixtures/efh-108.js, 11.40 × 10.20 m, KG/EG/DG, gable roof 45°) with a knee wall of 1.00 m on the DG, its two
// interior walls and the entrance door, the global roof written (option dachGlobal) and the data sheet option on (stable GlobalIds).
// Invented values, no project reference.
import { autoEnvOpenings } from "@designer/lib/autoOpenings";
import { efhModellMitKniestock, efhGeschosseMitKniestock, EFH_108 } from "./efh-108.js";

/** @returns {{model: any, optionen: any}} model and exportIFC options of the golden */
export function ifcKniestockSzenario() {
  const model = efhModellMitKniestock();
  const envOpenings = EFH_108.envOpenings.map((o, i) => ({ ...o, _idx: i + 1 }));
  const optionen = {
    customWalls: EFH_108.customWalls.map((w) => ({ ...w })), envOpenings,
    autoOpenings: autoEnvOpenings(model.walls, {}, envOpenings),
    storeyHeight: EFH_108.storeyHeight, geschosse: efhGeschosseMitKniestock(),
    dachGlobal: { form: EFH_108.dachform, neigung_grad: EFH_108.dachneigung },
    steckbrief: { projektId: "p-golden-10802" },
  };
  return { model, optionen };
}
