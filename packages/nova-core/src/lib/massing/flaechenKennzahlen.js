// 108-12 (finding 15b/15c of the 108-11 review): area and storey-height key figures of the massing studio.
//
// 15c: the BGF tile counted the storeys above ground only (footprint × storeys), the basement was missing. BGF after DIN 277 is the sum of
// the gross floor areas of ALL storeys, basements included (DIN 277:2021, 4.1 "Brutto-Grundfläche"). The floor area that the GFZ is
// computed with is a different figure: BauNVO § 20 Abs. 3 counts the outer dimensions of the FULL storeys (Vollgeschosse) only. Both are
// computed here, side by side, so the studio can label them separately.
// 15b: the panel "Baukörper" showed one storey height (`storeyHeight`) next to a storey table with other heights. geschossHoehenUebersicht
// lists the heights per storey from the same table the body is computed with (bauteil/hoehen.js), so display and computation agree.
//
// 108-12 review: (a) a storey table whose rows all have the same height but differ from `storeyHeight` (left after per-storey edits in the
// BIM studio, patchGeschosshoehe does not touch storeyHeight) made the slider show the stale storeyHeight while the building model used
// the table - reglerGeschosshoehe / koerperHoehe_m read the table whenever there is one. (b) The GF of the GFZ leaves out the top
// storey when the full-storey check from the roof geometry (bauteil/vollgeschoss.js) says it is no full storey (`obersterVoll`).
//
// In:  footprint area in m², number of storeys above ground and of basements; the programme store (storeys, storeyHeight, geschosse).
// Out: plain numbers and rows; pure, no React, node-testable.

import { geschosseAus, geschosshoehe, kniestockAus, elevationOf } from "../bauteil/hoehen.js";
import { geschossName, untergeschosseAnzahl } from "../bauteil/ebenen.js";

/**
 * @typedef {object} FlaechenKennzahlen
 * @property {number} bgf_m2                  BGF after DIN 277: footprint × (storeys above ground + basements), m²
 * @property {number} oberirdisch_m2          gross floor area of the storeys above ground: footprint × storeys, m² (base of the NUF and of
 *                                            the commercial parking estimate, = programMetrics.bgf)
 * @property {number} gfzFlaeche_m2           floor area for the GFZ after BauNVO § 20 Abs. 3: footprint × full storeys, m²
 * @property {number} vollgeschosse           storeys counted in gfzFlaeche_m2 (integer ≥ 0)
 * @property {"dach"|"annahme"} vollgeschossQuelle "dach" = the top storey was decided by the roof geometry, "annahme" = [ASSUMED] all full
 * @property {number} untergeschossFlaeche_m2 part of the BGF below ±0.00 (basements), m²
 * @property {number} geschosse               storeys above ground counted (integer ≥ 0)
 * @property {number} untergeschosse          basements counted (integer 0 … 3)
 */

/**
 * BGF (DIN 277, all storeys) and the GFZ floor area (BauNVO § 20, full storeys) of a massing body with one footprint on every storey.
 * [ASSUMED] every storey above ground is a full storey (Vollgeschoss) and no basement is one: whether an attic storey or a basement that
 * sticks out of the terrain counts is a rule of the state building code (bauteil/vollgeschoss.js checks the attic, the 1.40-m terrain rule
 * needs the terrain of plan 108-10); the studio says so next to the figure. Way to a proven value: the full-storey check per storey once
 * the terrain is in the model. The basement outline is the footprint (createBuildingModel builds basements on the same outline).
 * Without basements both figures are footprint × storeys — exactly the old BGF tile (old projects unchanged).
 * 108-12 review: `obersterVoll` = result of the full-storey check of the top storey from the roof geometry (vollgeschossAusDach, only
 * for an attic storey with a knee wall under a pitched roof): false leaves the top storey out of the GF; true or null keeps the
 * assumption above. The check itself carries [ASSUMED] limits (2/3, 2.30 m; the 1.40-m terrain rule is not checked).
 * @param {{grundflaeche_m2: number, geschosse: number, untergeschosse?: unknown, obersterVoll?: boolean|null}} q grundflaeche_m2:
 *   footprint area in m²; geschosse: storeys above ground; untergeschosse: programme field (0 … 3, anything else counts as 0);
 *   obersterVoll: full-storey result of the top storey (null/absent = not decided)
 * @returns {FlaechenKennzahlen}
 */
export function flaechenKennzahlen({ grundflaeche_m2, geschosse, untergeschosse = 0, obersterVoll = null }) {
  const a = Number.isFinite(Number(grundflaeche_m2)) ? Math.max(0, Number(grundflaeche_m2)) : 0;
  const n = Number.isFinite(Number(geschosse)) ? Math.max(0, Math.round(Number(geschosse))) : 0;
  const u = untergeschosseAnzahl(untergeschosse);
  const voll = obersterVoll === false && n > 0 ? n - 1 : n;
  return {
    bgf_m2: a * (n + u), oberirdisch_m2: a * n, gfzFlaeche_m2: a * voll, untergeschossFlaeche_m2: a * u, geschosse: n, untergeschosse: u,
    vollgeschosse: voll, vollgeschossQuelle: obersterVoll === true || obersterVoll === false ? "dach" : "annahme",
  };
}

/**
 * @typedef {object} GeschossHoeheZeile
 * @property {number} level           storey level (−U … storeys − 1)
 * @property {string} name            name of the table row, else the fixed name ("EG", "1. OG", "1. UG")
 * @property {boolean} ausTabelle     the name comes from the table row (else the caller may translate it, ebenen.geschossLabel)
 * @property {number} hoehe_m         storey height in m (structural, as the body is computed)
 * @property {number|null} kniestock_m knee wall of the top storey in m, null for every other storey or without one
 */

/**
 * Storey heights of the programme per storey, basements first (15b). `ungleich` = the heights differ (then one slider value cannot
 * describe the building); `jeGeschoss` = the panel should list the rows (heights differ or the top storey has a knee wall).
 * Without a table every row has `storeyHeight` and both flags are false (old projects: the panel stays as before).
 * 108-12 review: `tabelle` = a storey table exists (then the table, not storeyHeight, is the height of the building); `einheitlich_m` =
 * the one height of all listed rows (null when they differ) - the value the slider must show; `abweichend` = the table is uniform but
 * its height is not `storeyHeight` (stale number after per-storey edits; the slider then shows the table height).
 * @param {{storeys?: unknown, storeyHeight?: unknown, geschosse?: unknown, untergeschosse?: unknown}|null|undefined} programm programme store
 * @param {number} [storeys] storeys above ground to list (default programm.storeys; the studio passes its live slider value)
 * @returns {{zeilen: GeschossHoeheZeile[], ungleich: boolean, jeGeschoss: boolean, tabelle: boolean, einheitlich_m: number|null, abweichend: boolean}}
 */
export function geschossHoehenUebersicht(programm, storeys) {
  const n = Math.max(1, Math.round(Number(storeys ?? programm?.storeys) || 1));
  const u = untergeschosseAnzahl(programm?.untergeschosse);
  const sh = Number(programm?.storeyHeight);
  const tabelle = geschosseAus({ geschosse: programm?.geschosse, storeyHeight: Number.isFinite(sh) ? sh : undefined });
  const kniestock = kniestockAus(tabelle, n);
  /** @type {GeschossHoeheZeile[]} */
  const zeilen = [];
  for (let level = -u; level < n; level += 1) {
    const zeile = Array.isArray(tabelle) ? tabelle.find((g) => g.level === level) : null;
    zeilen.push({
      level,
      name: zeile?.name || geschossName(level),
      ausTabelle: Boolean(zeile?.name),
      hoehe_m: geschosshoehe(level, tabelle),
      kniestock_m: level === n - 1 && kniestock != null && kniestock > 0 ? kniestock : null,
    });
  }
  const ungleich = zeilen.some((z) => Math.abs(z.hoehe_m - zeilen[0].hoehe_m) > 1e-6);
  const istTabelle = Array.isArray(tabelle);
  const einheitlich_m = ungleich ? null : zeilen[0].hoehe_m;
  const abweichend = istTabelle && einheitlich_m != null && Number.isFinite(sh) && Math.abs(einheitlich_m - sh) > 1e-6;
  return { zeilen, ungleich, jeGeschoss: ungleich || zeilen.some((z) => z.kniestock_m != null), tabelle: istTabelle, einheitlich_m, abweichend };
}

/**
 * 108-12 review: the value the storey-height slider shows, m. With a storey table whose listed rows share one height: that height (also
 * when `storeyHeight` says otherwise); otherwise `storeyHeight` as before (differing rows: the slider is locked, see the studio).
 * @param {{storeys?: unknown, storeyHeight?: unknown, geschosse?: unknown, untergeschosse?: unknown}|null|undefined} programm programme store
 * @param {number} [storeys] storeys above ground (the live slider value)
 * @returns {number} m; NaN when neither a table nor a valid storeyHeight exists (the caller keeps its value)
 */
export function reglerGeschosshoehe(programm, storeys) {
  const u = geschossHoehenUebersicht(programm, storeys);
  if (u.tabelle && u.einheitlich_m != null) return u.einheitlich_m;
  const sh = Number(programm?.storeyHeight);
  return sh > 0 ? sh : NaN;
}

/**
 * 108-12 review: height of the massing box (top of the top storey above ±0.00), m. With a storey table always the sum of its heights
 * (elevationOf, the same rule as programMetrics.height and the building model), so the studio never computes storeys × a stale
 * storeyHeight next to a table; without a table storeys × the slider value, exactly the old arithmetic.
 * @param {{storeyHeight?: unknown, geschosse?: unknown}|null|undefined} programm programme store
 * @param {number} storeys storeys above ground (integer ≥ 1)
 * @param {number} reglerHoehe_m storey height of the slider in m (used without a table)
 * @returns {number} m
 */
export function koerperHoehe_m(programm, storeys, reglerHoehe_m) {
  const sh = Number(programm?.storeyHeight);
  const tabelle = geschosseAus({ geschosse: programm?.geschosse, storeyHeight: Number.isFinite(sh) ? sh : undefined });
  return Array.isArray(tabelle) ? elevationOf(storeys, tabelle) : storeys * reglerHoehe_m;
}
