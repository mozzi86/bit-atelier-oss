// Plan rotation in 90° steps (plan 115-04, D-115-13): the pure math behind "Plan drehen" of the floor plan and the sheet
// orientation ("Blattausrichtung") of the PDF / DXF output. The rotation is a property of the VIEW — the model (footprint, walls,
// north reference of the site) is never changed; a pointer position is turned back into the model frame before anything reads it.
//
// Conventions (one place, used by screen and sheet):
//  - A rotation is given in degrees COUNTER-CLOCKWISE AS SEEN on the screen / sheet: 0 | 90 | 180 | 270. "90" turns the drawing a
//    quarter turn to the left — what was on the left (west of an unrotated plan) lies at the bottom afterwards.
//  - Plan frames have x to the right and the second axis DOWN (screen y, model z of the floor plan; skill bit-zeichnung). In such
//    a frame a turn by 90° to the left maps (x, y) → (y, −x).
//  - Angles of texts and symbols follow SVG: degrees CLOCKWISE as seen (rotate(θ)), y down.
//  - Texts stay readable (DIN 406-11 / ZEICH-06): labels stay horizontal, numbers along a line read from below or from the right.
//  - North: the unrotated plan has north at the top (−z), the convention of the plan's north arrow [ASSUMED like the arrow before
//    115-04; the geographic north of the site is model truth and is not read here].
//
// In:  rotation (degrees), points / boxes / frame sizes in the caller's unit (metres or viewBox units), text angles (degrees).
// Out: rotated points and boxes, the frame transform model frame ↔ turned frame (with its inverse), text and north-arrow angles.
// Pure: no DOM, no React, no I/O; node-testable (tests/unit/planDrehung-11504.test.js).

/** The four allowed rotations, degrees counter-clockwise as seen. */
export const PLAN_DREHUNGEN = Object.freeze(/** @type {const} */ ([0, 90, 180, 270]));

/** @typedef {0|90|180|270} PlanDrehung rotation in degrees, counter-clockwise as seen */

/**
 * Any stored or typed value as one of the four rotations: rounded to the nearest quarter turn, wrapped into 0…270; a value that is
 * no finite number (missing field of an old record, null, text) gives 0 — old records behave as before.
 * @param {unknown} wert degrees
 * @returns {PlanDrehung}
 */
export function normiereDrehung(wert) {
  if (wert === null || wert === undefined || wert === "" || typeof wert === "boolean") return 0;
  const n = Number(wert);
  if (!Number.isFinite(n)) return 0;
  const k = ((Math.round(n / 90) % 4) + 4) % 4;
  return /** @type {PlanDrehung} */ (k * 90);
}

/**
 * The rotation after one more quarter turn.
 * @param {unknown} grad current rotation, degrees
 * @param {"links"|"rechts"} richtung "links" = counter-clockwise (+90), "rechts" = clockwise (−90)
 * @returns {PlanDrehung}
 */
export function drehungWeiter(grad, richtung) {
  return normiereDrehung(normiereDrehung(grad) + (richtung === "rechts" ? -90 : 90));
}

/**
 * Turns a vector of a plan frame (second axis down). Exact for the four rotations (no trigonometry, no negative zero).
 * @param {number} x @param {number} y vector in the caller's unit
 * @param {PlanDrehung} d rotation, already normalised
 * @returns {[number, number]}
 */
function vektor(x, y, d) {
  if (d === 90) return [y, 0 - x];
  if (d === 180) return [0 - x, 0 - y];
  if (d === 270) return [0 - y, x];
  return [x, y];
}

/**
 * A plan point turned about a centre. Frame: x right, z down (floor plan metres, planGrafik primitives).
 * @param {{x: number, z: number}} p point, caller's unit (m)
 * @param {unknown} grad rotation, degrees counter-clockwise as seen
 * @param {{x: number, z: number}} [zentrum] centre of the rotation, same unit (default: the origin)
 * @returns {{x: number, z: number}}
 */
export function drehePunkt(p, grad, zentrum = { x: 0, z: 0 }) {
  const d = normiereDrehung(grad);
  if (d === 0) return { x: p.x, z: p.z };
  const [x, z] = vektor(p.x - zentrum.x, p.z - zentrum.z, d);
  return { x: x + zentrum.x, z: z + zentrum.z };
}

/**
 * Inverse of drehePunkt: the point of the turned drawing back in the model frame.
 * @param {{x: number, z: number}} p point of the turned drawing, caller's unit (m)
 * @param {unknown} grad rotation the drawing was turned by, degrees counter-clockwise as seen
 * @param {{x: number, z: number}} [zentrum] centre of the rotation, same unit (default: the origin)
 * @returns {{x: number, z: number}}
 */
export function drehePunktZurueck(p, grad, zentrum = { x: 0, z: 0 }) {
  return drehePunkt(p, (360 - normiereDrehung(grad)) % 360, zentrum);
}

/**
 * Axis-parallel box of a turned box: for 90° / 270° width and height swap.
 * @param {{x0: number, z0: number, x1: number, z1: number}} bbox box in the caller's unit (m), x0 ≤ x1, z0 ≤ z1
 * @param {unknown} grad rotation, degrees counter-clockwise as seen
 * @param {{x: number, z: number}} [zentrum] centre of the rotation (default: the origin)
 * @returns {{x0: number, z0: number, x1: number, z1: number}}
 */
export function dreheBBox(bbox, grad, zentrum = { x: 0, z: 0 }) {
  const a = drehePunkt({ x: bbox.x0, z: bbox.z0 }, grad, zentrum), b = drehePunkt({ x: bbox.x1, z: bbox.z1 }, grad, zentrum);
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
}

/**
 * The ONE transform between a drawing frame (origin top-left, x right, y down, size breite × hoehe) and the same drawing turned by
 * `grad` in a frame that again starts at 0/0 — the turned frame is hoehe × breite for 90° / 270°. BimPlan2D draws everything in the
 * model frame inside one SVG group with `transform`; pointer positions come back through `zurueck`.
 * @param {unknown} grad rotation, degrees counter-clockwise as seen
 * @param {number} breite width of the unturned frame, viewBox units
 * @param {number} hoehe height of the unturned frame, viewBox units
 * @returns {{grad: PlanDrehung, breite: number, hoehe: number, transform: string|undefined,
 *   hin: (x: number, y: number) => {x: number, y: number}, zurueck: (x: number, y: number) => {x: number, y: number},
 *   vektorHin: (dx: number, dy: number) => {x: number, y: number}, vektorZurueck: (dx: number, dy: number) => {x: number, y: number}}}
 *   breite / hoehe: size of the TURNED frame; transform: SVG `matrix(…)` of the group (undefined for 0 — no attribute, the markup
 *   stays as before); hin: unturned → turned; zurueck: turned → unturned; vektorHin / vektorZurueck: the same for directions and
 *   offsets (no shift).
 */
export function drehRahmen(grad, breite, hoehe) {
  const d = normiereDrehung(grad);
  const quer = d === 90 || d === 270;
  // shift that brings the turned frame back to 0/0: 90° (y, B − x) · 180° (B − x, H − y) · 270° (H − y, x)
  const ex = d === 180 ? breite : d === 270 ? hoehe : 0;
  const ey = d === 90 ? breite : d === 180 ? hoehe : 0;
  const zurueckD = /** @type {PlanDrehung} */ ((360 - d) % 360);
  const hin = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (d === 0) return { x, y };
    const [u, v] = vektor(x, y, d);
    return { x: u + ex, y: v + ey };
  };
  const zurueck = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (d === 0) return { x, y };
    const [u, v] = vektor(x - ex, y - ey, zurueckD);
    return { x: u, y: v };
  };
  const vektorHin = (/** @type {number} */ dx, /** @type {number} */ dy) => { const [u, v] = vektor(dx, dy, d); return { x: u, y: v }; };
  const vektorZurueck = (/** @type {number} */ dx, /** @type {number} */ dy) => { const [u, v] = vektor(dx, dy, zurueckD); return { x: u, y: v }; };
  // SVG matrix(a b c d e f): x' = a·x + c·y + e, y' = b·x + d·y + f — the columns are the images of the unit vectors
  const [a, b] = vektor(1, 0, d), [c, dd] = vektor(0, 1, d);
  return {
    grad: d, breite: quer ? hoehe : breite, hoehe: quer ? breite : hoehe,
    transform: d === 0 ? undefined : `matrix(${a} ${b} ${c} ${dd} ${ex} ${ey})`,
    hin, zurueck, vektorHin, vektorZurueck,
  };
}

/**
 * Text angle a reader can read without turning the head past the side: normalised to [−90, 90) degrees (SVG, clockwise, y down).
 * Horizontal stays 0, a vertical text gives −90 = reads bottom-to-top, i.e. from the right (DIN 406-11, skill bit-zeichnung
 * ZEICH-06). Same rule and rounding as normiereWinkel of the dimension chains (@designer/lib/masskette).
 * @param {number} winkel raw angle, degrees
 * @returns {number} angle in [−90, 90)
 */
export function textWinkelLesbar(winkel) {
  let w = Number(winkel) || 0;
  w = Math.round(w * 1e6) / 1e6; // kill float noise before the boundary checks
  // Guard: ±Infinity is no angle (→ 0); huge values are reduced first, so the loops below run at most once. Below 1e6 degrees the
  // result is unchanged to the bit (the loops alone did the same, but looped forever on Infinity and for minutes beyond ~1e18).
  if (!Number.isFinite(w)) return 0;
  if (Math.abs(w) > 1e6) w %= 180; // exact in IEEE 754
  while (w >= 90) w -= 180;
  while (w < -90) w += 180;
  return w === 0 ? 0 : w; // no negative zero
}

/**
 * Local angle of a text that runs ALONG a line (dimension number, wall length) and is drawn INSIDE a drawing turned by `grad`:
 * the angle it must get there so that it is readable on the screen (textWinkelLesbar of what the reader sees).
 * The turned group shows a local angle θ at θ − grad, so local = lesbar(winkel − grad) + grad. For 0 it is textWinkelLesbar.
 * @param {number} winkel angle of the line in the model frame, degrees (SVG, clockwise, y down)
 * @param {unknown} grad rotation of the drawing, degrees counter-clockwise as seen
 * @returns {number} local angle, degrees (SVG, clockwise)
 */
export function textWinkelImRahmen(winkel, grad) {
  const d = normiereDrehung(grad);
  if (d === 0) return textWinkelLesbar(winkel);
  return textWinkelLesbar((Number(winkel) || 0) - d) + d;
}

/**
 * Angle the reader sees for a local text angle inside a drawing turned by `grad` (the check of textWinkelImRahmen).
 * @param {number} lokal local angle inside the turned drawing, degrees (SVG, clockwise)
 * @param {unknown} grad rotation of the drawing, degrees counter-clockwise as seen
 * @returns {number} angle as seen, degrees in (−180, 180]
 */
export function textWinkelGesehen(lokal, grad) {
  let w = (Number(lokal) || 0) - normiereDrehung(grad);
  if (!Number.isFinite(w)) return 0; // same guard as textWinkelLesbar
  if (Math.abs(w) > 1e6) w %= 360;
  while (w > 180) w -= 360;
  while (w <= -180) w += 360;
  return w === 0 ? 0 : w;
}

/**
 * Angle of the north arrow of a plan turned by `grad`: the arrow points up (0) on the unturned plan and turns with the drawing.
 * @param {unknown} grad rotation of the drawing, degrees counter-clockwise as seen
 * @returns {0|-90|180|90} SVG angle (clockwise as seen) for rotate(θ): 90° to the left → −90 (the arrow points left)
 */
export function nordpfeilWinkel(grad) {
  const d = normiereDrehung(grad);
  return d === 90 ? -90 : d === 180 ? 180 : d === 270 ? 90 : 0;
}

/**
 * Direction the north arrow points to as seen (unit vector, x right, y down).
 * @param {unknown} grad rotation of the drawing, degrees counter-clockwise as seen
 * @returns {{x: number, y: number}} 0 → (0, −1) up; 90 → (−1, 0) left; 180 → (0, 1) down; 270 → (1, 0) right
 */
export function nordRichtung(grad) {
  const [x, y] = vektor(0, -1, normiereDrehung(grad));
  return { x, y };
}

/**
 * The two rotation fields of the view state (fachlayer `ansicht_layer`, additive on version 1 — no migration): `plan_drehung` =
 * rotation of the floor plan on the SCREEN, `blatt_drehung` = sheet orientation of the PDF / DXF output. Both are view properties
 * of the project; an old blob without them gives 0 / null and behaves as before.
 * `blatt` null = never chosen: the output then starts from the screen rotation (D-115-13: own setting, the screen rotation at the
 * time of output is the start value) — see blattDrehungWirksam.
 * @param {any} layer stored `ansicht_layer` blob (may be null / an old record)
 * @returns {{plan: PlanDrehung, blatt: PlanDrehung|null}}
 */
export function ansichtDrehung(layer) {
  const l = layer && typeof layer === "object" ? layer : {};
  const b = l.blatt_drehung;
  const blattGesetzt = b !== null && b !== undefined && b !== "" && typeof b !== "boolean" && Number.isFinite(Number(b));
  return { plan: normiereDrehung(l.plan_drehung), blatt: blattGesetzt ? normiereDrehung(b) : null };
}

/**
 * The sheet orientation an output uses: the stored one, else the screen rotation.
 * @param {{plan: PlanDrehung, blatt: PlanDrehung|null}} d result of ansichtDrehung
 * @returns {PlanDrehung}
 */
export function blattDrehungWirksam(d) {
  return d?.blatt ?? normiereDrehung(d?.plan);
}
