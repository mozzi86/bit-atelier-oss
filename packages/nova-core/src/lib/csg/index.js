// 107-14: entry of the CSG core (D-BK-08, D-BK-08a, D-BK-08b). Callers (107-09 intersections, 107-10 roof / solid relations /
// basement) import from here. This module and everything it re-exports is free of the boolean library: the library sits only
// in kern.js, which csgLaden() loads lazily (Vite chunk `csg` plus the WebAssembly binary of manifold-3d, never on the start
// path; 107-18, D-BK-08c). The solids of components
// (wandSolid, platteSolid) load it themselves; until a result is there, the caller keeps today's construction visible (shape
// with holes, boxes) — that is also the fallback on a load error, an open input and a volume deviation.
//
// Roles (D-BK-08a): the CSG solid is the SOURCE of derived geometry — plan cut, section and quantities come from it
// (schnitt.js, volumen.js); the mesh may be stored, but only as a discardable cache keyed by a hash of the base inputs
// (cache.js, csg_cache_layer). The base geometry leads and stays parametric.
//
// Deliberate limit (D-BK-08b): the IFC export keeps writing extruded bodies plus IfcRelVoidsElement and is NOT written from
// the solid. What only the solid can do (a partial penetration, an inclined cut through a layer package, the terrain
// subtraction of the basement) shows in 3D, in the section and in the quantities, not in the IFC — there the approximation
// with an onWarn message stays. An IFC output from the solid (Brep) is not part of phase 107.
//
// Backend seam: backend.js (CsgBackend). Since 107-18 the backend is manifold-3d (D-BK-08c, it replaced three-bvh-csg without
// a change to any caller); a further backend would be a second implementation chosen in laden.js, with a decision of its own.
//
// In: — . Out: re-exports, the performance budget, the warning text of a component.

export { csgLaden } from "./laden.js";
export { OPERATIONEN, booleschMit, CsgAblehnung } from "./backend.js";
export { istWasserdicht, WASSERDICHT_TOLERANZ_M } from "./wasserdicht.js";
export { volumen_m3, volumenJeGruppe, rechteckVereinigung_m2, analytischWand, analytischPlatte, volumenAbgleich, ABWEICHUNG_SCHWELLE_REL, ABWEICHUNG_BODEN_M3 } from "./volumen.js";
export { schnittMitEbene, horizontalschnitt, vertikalschnitt, weltNachLokal, horizontalschnittWelt, vertikalschnittWelt, SCHNITT_TOLERANZ_M } from "./schnitt.js";
export { basisHash, kanonisch, CSG_VERSION } from "./basisHash.js";
export { dreieckIndizes, dreieckAnzahl, geometrieBereinigen, geometrienZusammenfuegen, geometrieJeGruppe } from "./dreiecke.js";
export { quaderKoerper, profilKoerper, oeffnungKoerper, OEFFNUNG_UEBERSTAND_M } from "./koerper.js";
export { wandSolid, wandBasis, platteSolid } from "./bauteil.js";
export { CSG_CACHE_LEER, MESH_FORMAT, cacheSchluessel, meshKodieren, meshDekodieren, cacheLesen, cacheSchreiben, cacheBereinigen, cacheAblegen, cacheEintragLaden } from "./cache.js";
export { cacheBlobsLoeschen, cacheEintragNeu, cacheLayerBereinigen } from "./cacheAblauf.js";
// 107-09: the warning text lives in its own small file OUTSIDE lib/csg/ (bauteil/csgWarnung.js), so the BIM studio can show it without
// requesting any module of the core (the 107-14 e2e guard: no /lib/csg/ request on the start path)
export { csgWarnungText } from "../bauteil/csgWarnung.js";

/**
 * Performance budget of the core, ms, for ONE component in the main thread (interactive use). [ASSUMED] planning values of
 * 24.10.2026: one boolean at ~1 000 triangles ≤ 50 ms, at ~10 000 triangles ≤ 500 ms; watertight check and volume at 10 000
 * ≤ 20 ms; cache decode at 10 000 ≤ 20 ms. The test (tests/unit/csg-leistung-10714.test.js) fails only at FOUR times the
 * budget (machines spread). Measured 26.10.2026 on the development machine (node 24, median of 5): boolean 1k 6–9 ms
 * (subtract) / 14–20 ms (union); 10k 34–68 ms (subtract, incl. ~21 ms BVH build per body) / 82–147 ms (union); watertight 10k
 * 2.3 ms (boolean result with T-junctions 9 ms); volume 10k 0.5 ms; cache decode 10k 1.8 ms; a wall with 3 layers and
 * 5 openings 21–50 ms — all below the budget (details in 107-14-SUMMARY.md). 107-18 (manifold-3d, same machine): boolean 1k
 * 4.9 ms (subtract) / 6.5 ms (union); 10k 24 ms (subtract, incl. ~11 ms conversion per body) / 51 ms (union); watertight of a
 * 10k result 6 ms; the wall with 3 layers and 5 openings 7.8 ms (details in 107-18-SUMMARY.md). Way to a proven value: the same test on the CI
 * runner and in the browser.
 */
export const CSG_BUDGET_MS = Object.freeze({
  boolesch_1k: 50,
  boolesch_10k: 500,
  wasserdicht_10k: 20,
  volumen_10k: 20,
  dekodieren_10k: 20,
});

/**
 * Factor on CSG_BUDGET_MS at which the performance test fails. [ASSUMED] 4: CI runners and older machines are 2–3 times
 * slower than the development machine (the plan's choice, task 6); the measured values lie 5–10 times below the budget, so
 * 4 × budget fails only on a real regression. Way to a proven value: the spread of the CI runs.
 */
export const CSG_BUDGET_FAKTOR = 4;
