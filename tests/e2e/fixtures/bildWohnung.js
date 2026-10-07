// The apartment from the user's focus-view screenshot (04.10.2026, Plan 75-14 objective):
// back row at the corridor "Küche 8 · Bad 5 · Flur 6", front row at the facade
// "Wohnen/Essen 39, Schlafen 21 (2,19 × 9,55 m), Kind 2/Büro 14 (1,51 × 9,55 m)".
// Unit 7,75 m wide × 12,00 m deep (band depth of a 26 m footprint with a 1,8 m
// Mittelflur ≈ 12,1 m), facade at z = 12, corridor at z = 0. Pure data, shared by
// the unit tests (tests/unit/…) and the Playwright spec (massing-75-14).

/** Room programme of the screenshot unit (target areas as read from the picture). */
export const BILD_PROGRAMM = [
  { raum: "Wohnen/Essen", art: "aufenthalt", min_m2: 30, max_m2: 42, flaeche_m2: 39, fensterpflicht: true },
  { raum: "Schlafen", art: "aufenthalt", min_m2: 13, max_m2: 22, flaeche_m2: 21, fensterpflicht: true },
  { raum: "Kind 2/Büro", art: "aufenthalt", min_m2: 9, max_m2: 14, flaeche_m2: 14, fensterpflicht: true },
  { raum: "Küche", art: "kueche", min_m2: 6, max_m2: 10, flaeche_m2: 8, fensterpflicht: false },
  { raum: "Bad", art: "sanitaer", min_m2: 4, max_m2: 7, flaeche_m2: 5, fensterpflicht: false },
  { raum: "Flur", art: "flur", min_m2: 4, max_m2: 7, flaeche_m2: 6, fensterpflicht: false },
];

/** Band rectangle in the raumSlicing lauf system (x along the band, z across). */
export const BILD_BAND = {
  rechteck: { x0: 0, x1: 7.75, z0: 0, z1: 12 }, fassadeBei: 12, achse: "x", level: 0, we: "WE 0-1",
};

/** Footprint bbox the unit sits in (facade = z 12 edge) for window-wall detection. */
export const BILD_BBOX = { minX: 0, maxX: 7.75, minZ: -1.8, maxZ: 12 };

// Hand-written zones of the SCREENSHOT state (no doors, no hall): back row depth
// 19 m² / 7,75 m = 2,45 m, front row 9,55 m. Widths = area / depth.
const R = (name, art, x0, x1, z0, z1, extra = {}) => ({
  points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
  level: 0, name: `${name} (WE 0-1) ·WT`, we: "WE 0-1", raumart: art === "flur" ? "flur" : "wohnen", art,
  fensterpflicht: art === "aufenthalt", flaeche_m2: (x1 - x0) * (z1 - z0), ...extra,
});
export const BILD_ZONEN_VORHER = [
  R("Küche", "kueche", 0, 3.26, 0, 2.45),
  R("Bad", "sanitaer", 3.26, 5.3, 0, 2.45),
  R("Flur", "flur", 5.3, 7.75, 0, 2.45),
  R("Wohnen/Essen", "aufenthalt", 0, 4.05, 2.45, 12),
  R("Schlafen", "aufenthalt", 4.05, 6.24, 2.45, 12),
  R("Kind 2/Büro", "aufenthalt", 6.24, 7.75, 2.45, 12),
];
