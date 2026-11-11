// Alignment ("Ausrichtung") of a plan state onto a reference state: the files of different
// offices/dates rarely share an origin, so every state carries a 2D similarity transform that
// maps its own coordinates onto the reference. Three ways to get it:
//   auto     — over texts both states contain exactly once (room names, axis labels …)
//   manuell  — two pass points, or nudging with arrow steps
//   offen    — not aligned yet (identity, shown as "not aligned")
//
// Transform convention: p' = massstab · R(drehung) · p + (dx, dy); drehung in radians
// (counter-clockwise), dx/dy in metres, massstab dimensionless. y points north (DXF).
//
// In:  points/texts in metres (from dxfPlangrundlage.js). Out: plain objects. No I/O.

/**
 * @typedef {{dx: number, dy: number, drehung: number, massstab: number}} Transform
 * @typedef {'auto'|'manuell'|'offen'} AusrichtungsArt
 * @typedef {{art: AusrichtungsArt, transform: Transform}} Ausrichtung
 * @typedef {{x: number, y: number}} Punkt metres
 */

/** Identity transform. @type {Readonly<Transform>} */
export const TRANSFORM_EINS = Object.freeze({ dx: 0, dy: 0, drehung: 0, massstab: 1 });

/** Vote radius of the text alignment, metres (two shifts count as the same within 5 cm). */
export const AUTO_TOLERANZ_M = 0.05;
/** Minimum common texts for an automatic alignment. */
export const AUTO_MIN_TEXTE = 3;
/** "sicher" needs at least this many matching texts … */
export const AUTO_SICHER_TREFFER = 3;
/** … and at least this share of the common texts. */
export const AUTO_SICHER_ANTEIL = 0.25;
/** Longest text that still counts as an anchor, characters. */
export const AUTO_MAX_ZEICHEN = 60;

/** Message for too few common texts (German UI text). */
export const MELDUNG_ZU_WENIGE_TEXTE = "Zu wenige gemeinsame Texte – bitte mit zwei Passpunkten ausrichten.";
/** Message for unusable pass points (German UI text). */
export const MELDUNG_PASSPUNKTE = "Passpunkte ungültig – die zwei Punkte eines Stands dürfen nicht zusammenfallen.";

/**
 * Not aligned yet.
 * @returns {Ausrichtung}
 */
export function ausrichtungOffen() {
  return { art: "offen", transform: { ...TRANSFORM_EINS } };
}

/**
 * Applies a transform to a point.
 * @param {Transform} t
 * @param {Punkt} p metres
 * @returns {Punkt} metres
 */
export function transformAnwenden(t, p) {
  const c = Math.cos(t.drehung) * t.massstab, s = Math.sin(t.drehung) * t.massstab;
  return { x: c * p.x - s * p.y + t.dx, y: s * p.x + c * p.y + t.dy };
}

/**
 * Inverse transform (maps reference coordinates back into the state).
 * @param {Transform} t massstab ≠ 0
 * @returns {Transform}
 */
export function transformUmkehren(t) {
  const m = 1 / t.massstab, c = Math.cos(-t.drehung) * m, s = Math.sin(-t.drehung) * m;
  return { dx: -(c * t.dx - s * t.dy), dy: -(s * t.dx + c * t.dy), drehung: -t.drehung, massstab: m };
}

/**
 * Chain: first `a`, then `b` (result(p) = b(a(p))).
 * @param {Transform} a
 * @param {Transform} b
 * @returns {Transform}
 */
export function transformVerketten(a, b) {
  const d = transformAnwenden({ ...b, dx: 0, dy: 0 }, { x: a.dx, y: a.dy });
  return { dx: d.x + b.dx, dy: d.y + b.dy, drehung: a.drehung + b.drehung, massstab: a.massstab * b.massstab };
}

/**
 * Normalised text for matching: lower case, whitespace unified, trimmed. null = not usable as an
 * anchor (empty, longer than AUTO_MAX_ZEICHEN, or a short pure number — dimension values and
 * level marks repeat everywhere and would vote for random shifts [ASSUMED: "short" = up to 4
 * characters, e.g. "12", "2,51", "+3.0"]).
 * @param {string} text
 * @returns {string|null}
 */
export function textSchluessel(text) {
  const s = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s || s.length > AUTO_MAX_ZEICHEN) return null;
  if (s.length <= 4 && /^[+\-±]?[\d.,]+$/.test(s)) return null;
  return s;
}

/** Texts that occur exactly once, by key. */
function einmalige(/** @type {Array<{text: string, x: number, y: number}>} */ texte) {
  /** @type {Map<string, {x: number, y: number}|null>} */
  const m = new Map();
  for (const t of Array.isArray(texte) ? texte : []) {
    const k = textSchluessel(t?.text);
    if (!k || !Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    m.set(k, m.has(k) ? null : { x: t.x, y: t.y });
  }
  return m;
}

/**
 * @typedef {{ok: true, art: 'auto', transform: Transform, gemeinsam: number, treffer: number, sicher: boolean}
 *   | {ok: false, art: 'offen', transform: Transform, gemeinsam: number, treffer: 0, sicher: false, fehler: string}} AutoErgebnis
 *   gemeinsam = texts unique in both states; treffer = votes of the winning shift
 */

/**
 * Automatic alignment over common texts (translation only: drehung 0, massstab 1).
 * Every common text pair gives a shift (reference − state); each shift gets one vote from every
 * shift within `toleranz` (itself included); the shift with most votes wins (ties: the first
 * in key order), the result is the mean of the shifts near it. "sicher" = at least
 * AUTO_SICHER_TREFFER votes AND at least AUTO_SICHER_ANTEIL of the common texts.
 * @param {Array<{text: string, x: number, y: number}>} texteStand texts of the state to align, metres
 * @param {Array<{text: string, x: number, y: number}>} texteReferenz texts of the reference state, metres
 * @param {{toleranz?: number}} [opt] toleranz metres (default AUTO_TOLERANZ_M)
 * @returns {AutoErgebnis}
 */
export function autoAusrichtung(texteStand, texteReferenz, { toleranz = AUTO_TOLERANZ_M } = {}) {
  const a = einmalige(texteStand), b = einmalige(texteReferenz);
  /** @type {Punkt[]} */
  const versch = [];
  for (const k of [...a.keys()].sort()) {
    const p = a.get(k), q = b.get(k);
    if (p && q) versch.push({ x: q.x - p.x, y: q.y - p.y });
  }
  const gemeinsam = versch.length;
  if (gemeinsam < AUTO_MIN_TEXTE) return { ok: false, art: "offen", transform: { ...TRANSFORM_EINS }, gemeinsam, treffer: 0, sicher: false, fehler: MELDUNG_ZU_WENIGE_TEXTE };
  const t2 = toleranz * toleranz;
  let beste = -1, stimmen = -1;
  for (let i = 0; i < gemeinsam; i++) {
    let n = 0;
    for (let j = 0; j < gemeinsam; j++) {
      const dx = versch[j].x - versch[i].x, dy = versch[j].y - versch[i].y;
      if (dx * dx + dy * dy <= t2) n++;
    }
    if (n > stimmen) { stimmen = n; beste = i; }
  }
  let sx = 0, sy = 0;
  for (const v of versch) {
    const dx = v.x - versch[beste].x, dy = v.y - versch[beste].y;
    if (dx * dx + dy * dy <= t2) { sx += v.x; sy += v.y; }
  }
  const sicher = stimmen >= AUTO_SICHER_TREFFER && stimmen >= AUTO_SICHER_ANTEIL * gemeinsam;
  return { ok: true, art: "auto", transform: { dx: sx / stimmen, dy: sy / stimmen, drehung: 0, massstab: 1 }, gemeinsam, treffer: stimmen, sicher };
}

/**
 * Alignment from two pass point pairs (von = point in the state, nach = same point in the
 * reference). Rotation = angle difference of the two connecting lines; scale = length ratio
 * when `freierMassstab`, else 1; the shift then maps the MIDPOINT of the two `von` points onto
 * the midpoint of the `nach` points (with a fixed scale 1 the residual error is split evenly
 * between both points instead of being all on the second one).
 * @param {[{von: Punkt, nach: Punkt}, {von: Punkt, nach: Punkt}]} paare metres
 * @param {{freierMassstab?: boolean}} [opt]
 * @returns {{ok: true, art: 'manuell', transform: Transform} | {ok: false, art: 'offen', transform: Transform, fehler: string}}
 */
export function passpunktAusrichtung(paare, { freierMassstab = false } = {}) {
  const [p1, p2] = Array.isArray(paare) ? paare : [];
  const ok = (/** @type {Punkt|undefined} */ p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!p1 || !p2 || ![p1.von, p1.nach, p2.von, p2.nach].every(ok)) return { ok: false, art: "offen", transform: { ...TRANSFORM_EINS }, fehler: MELDUNG_PASSPUNKTE };
  const vx = p2.von.x - p1.von.x, vy = p2.von.y - p1.von.y;
  const nx = p2.nach.x - p1.nach.x, ny = p2.nach.y - p1.nach.y;
  const lv = Math.hypot(vx, vy), ln = Math.hypot(nx, ny);
  if (lv < 1e-9 || ln < 1e-9) return { ok: false, art: "offen", transform: { ...TRANSFORM_EINS }, fehler: MELDUNG_PASSPUNKTE };
  let drehung = Math.atan2(ny, nx) - Math.atan2(vy, vx);
  drehung = Math.atan2(Math.sin(drehung), Math.cos(drehung)); // into (−π, π]
  const massstab = freierMassstab ? ln / lv : 1;
  const mv = { x: (p1.von.x + p2.von.x) / 2, y: (p1.von.y + p2.von.y) / 2 };
  const mn = { x: (p1.nach.x + p2.nach.x) / 2, y: (p1.nach.y + p2.nach.y) / 2 };
  const r = transformAnwenden({ dx: 0, dy: 0, drehung, massstab }, mv);
  return { ok: true, art: "manuell", transform: { dx: mn.x - r.x, dy: mn.y - r.y, drehung, massstab } };
}

/**
 * Nudge step for the current zoom: fine when zoomed in. Thresholds [ASSUMED from the plan
 * editor behaviour described for this feature]: > 40 px/m → 1 cm, > 8 px/m → 10 cm, else 1 m.
 * @param {number} pxJeMeter screen pixels per metre
 * @returns {number} step in metres
 */
export function nachschiebSchritt(pxJeMeter) {
  if (pxJeMeter > 40) return 0.01;
  if (pxJeMeter > 8) return 0.1;
  return 1;
}

/** Nudge directions → unit shift (y north). @type {Readonly<Record<'links'|'rechts'|'oben'|'unten', Readonly<Punkt>>>} */
export const RICHTUNGEN = Object.freeze({
  links: Object.freeze({ x: -1, y: 0 }),
  rechts: Object.freeze({ x: 1, y: 0 }),
  oben: Object.freeze({ x: 0, y: 1 }),
  unten: Object.freeze({ x: 0, y: -1 }),
});

/**
 * Moves an alignment one nudge step in a direction (in reference coordinates); the art becomes
 * 'manuell' — a hand correction is no longer the automatic result.
 * @param {Ausrichtung|null|undefined} ausrichtung current alignment (null = not aligned)
 * @param {'links'|'rechts'|'oben'|'unten'} richtung
 * @param {number} pxJeMeter screen pixels per metre (chooses the step)
 * @returns {Ausrichtung}
 */
export function nachschieben(ausrichtung, richtung, pxJeMeter) {
  const t = ausrichtung?.transform || TRANSFORM_EINS;
  const r = RICHTUNGEN[richtung];
  if (!r) return { art: ausrichtung?.art || "offen", transform: { ...t } };
  const s = nachschiebSchritt(pxJeMeter);
  // Round to 0.1 mm so repeated nudges do not pile up floating point noise.
  const rund = (/** @type {number} */ v) => Math.round(v * 1e4) / 1e4;
  return { art: "manuell", transform: { ...t, dx: rund(t.dx + r.x * s), dy: rund(t.dy + r.y * s) } };
}
