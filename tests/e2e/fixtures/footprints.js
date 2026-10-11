// 86-05a: footprint fixtures (DATA ONLY) shared by the proposal unit tests and the
// E2E specs of 86-05b — the same L, U, pentagon and rectangle the 86-03 measurement and
// the tesseliere golden test use, centred like the Review Testhaus (origin = bbox centre),
// so a spec can write them into the test house's BimModel record (tests/e2e/fixtures/testhaus.js).
//
// In:  nothing. Out: FOOTPRINTS — { key: { name, footprintM (m), beschreibung } }.
// No imports from the app (Playwright has no alias loader); the centring helper is inline.

/** Shift a polygon so that its bbox centre is the origin. @param {Array<{x:number, z:number}>} pts m */
function zentriert(pts) {
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return pts.map((p) => ({ x: Math.round((p.x - cx) * 1000) / 1000, z: Math.round((p.z - cz) * 1000) / 1000 }));
}

/** User's pentagon from a 13,5 px/m screenshot (same corners as tesseliere-golden.test.js). */
const FUENFECK_PX = [[596, 688], [736, 204], [1099, 104], [1433, 261], [1268, 550]];

export const FOOTPRINTS = {
  rechteck_70x16: {
    name: "Rechteck 70 × 16",
    beschreibung: "Review-Testhaus: axis-parallel rectangle, one bar, no decomposition axis",
    footprintM: [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }],
  },
  L: {
    name: "L 48 × 16 + 16 × 24",
    beschreibung: "L shape: 48 m wing of 16 m depth plus a 24 m wing — two bars (86-03)",
    footprintM: zentriert([{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }]),
  },
  U: {
    name: "U 60 × 40, Schenkel 16",
    beschreibung: "U shape: 60 m base of 16 m depth, two 24 m legs — three bars (86-03)",
    footprintM: zentriert([{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 44, z: 40 }, { x: 44, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }]),
  },
  fuenfeck: {
    name: "Fünfeck",
    beschreibung: "Irregular pentagon (user screenshot) — up to four bars, slanted rests stay free (86-02)",
    footprintM: zentriert(FUENFECK_PX.map(([x, y]) => ({ x: x / 13.5, z: -y / 13.5 }))),
  },
};
