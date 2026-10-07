// Solve-Runner: führt einen Sketch durch den planegcs-Solver.
//
// PURE bezüglich Imports — der GcsWrapper kommt per Dependency-Injection:
// im Browser aus solver.js (WASM via Vite ?url), in Node-Tests direkt aus
// "@salusoft89/planegcs" (der Emscripten-Build läuft auch unter Node).

import { ALGORITHM, SOLVE_STATUS, buildSolverInput, applySolution, solverIdToModelId } from "./sketchModel.js";

/**
 * @param {import('@salusoft89/planegcs').GcsWrapper} wrapper langlebige Instanz (clear_data() pro Lauf)
 * @param {import('./sketchModel.js').Sketch} sketch wird bei Erfolg IN PLACE aktualisiert
 * @param {{extraConstraints?: object[], algorithm?: number}} [opts]
 * @returns {{status:number,statusName:string,dof:number,conflicting:string[],redundant:string[],partiallyRedundant:string[],applied:boolean}}
 */
export function runSolve(wrapper, sketch, { extraConstraints = [], algorithm = ALGORITHM.DogLeg } = {}) {
  wrapper.clear_data();
  wrapper.push_primitives_and_params(buildSolverInput(sketch, extraConstraints));
  const status = wrapper.solve(algorithm);
  const statusName = SOLVE_STATUS[status] ?? "failed";

  const backToModel = (ids) => [...new Set(ids.map(solverIdToModelId))];
  const conflicting = backToModel(wrapper.get_gcs_conflicting_constraints());
  const redundant = backToModel(wrapper.get_gcs_redundant_constraints());
  const partiallyRedundant = backToModel(wrapper.get_gcs_partially_redundant_constraints());

  // Nur konvergierte Lösungen übernehmen — bei Failed bleibt die letzte
  // gültige Geometrie stehen (sonst "explodiert" der Sketch sichtbar).
  const applied = statusName === "success" || statusName === "converged";
  if (applied) {
    wrapper.apply_solution();
    applySolution(sketch, wrapper.sketch_index);
  }

  return { status, statusName, dof: wrapper.gcs.dof(), conflicting, redundant, partiallyRedundant, applied };
}
