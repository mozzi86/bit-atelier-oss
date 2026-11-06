// 107-13: fixed example model of the second IFC golden (tests/unit/fixtures/ifc-golden-107-13-ug.ifc): the default footprint with
// two storeys above ground and ONE basement, one drawn wall and one room on level −1. Literal data, no project reference.
import { createBuildingModel } from "@core/lib/buildingModel";
import { autoEnvOpenings } from "@designer/lib/autoOpenings";

/** @returns {{model: any, optionen: any}} model and exportIFC options of the golden */
export function ifcUgSzenario() {
  const model = createBuildingModel({ storeys: 2, storeyHeight: 3, untergeschosse: 1 });
  const customWalls = [{ a: { x: -4, z: -7 }, b: { x: -4, z: 7 }, level: -1, thickness: 0.24, height: 3, _idx: 1 }];
  const customZones = [{ points: [{ x: -10, z: -7 }, { x: -4, z: -7 }, { x: -4, z: 7 }, { x: -10, z: 7 }], level: -1, name: "Kellerraum", _idx: 2 }];
  const optionen = { customWalls, customZones, autoOpenings: autoEnvOpenings(model.walls, {}, []), steckbrief: { projektId: "p-golden-10713" } };
  return { model, optionen };
}
