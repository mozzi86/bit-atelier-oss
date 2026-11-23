// Section dimensions (115-02, finding W-1115-05) — WHAT is dimensioned in the building section and WHERE every line and text
// goes, as pure data. One source for the screen section (BimPlan2D `Schnitt`) and the printed section (vektorPlan
// `schnittGrafik`, PDF/DXF primitives), so the two cannot drift apart.
//
// Drafting rules (DIN 406-11 for building drawings, DIN 1356-1 level marks, office practice — skill bit-zeichnung):
//  - Right of the building: up to three vertical dimension chains at growing distance, from the inside out
//      detail  (knee wall, parapet — single pieces),
//      storeys (storey levels up to the top of the top storey),
//      overall (lowest level — ±0,00 — highest point).
//    45° slashes, extension lines, the number ABOVE the line and parallel to it (reads from the right, -90°).
//  - A piece too short for its number: the number moves beside the chain (horizontal, short leader). Two such numbers that
//    would touch: the upper one is pushed up (oblique leader, at most MAX_VERSATZ text heights) — unless that takes the place
//    of the next number: then it is left out and counted (`ausgelassen`); the slashes and the outer chains stay (same rule as
//    masskette.js zoomed out). So a run of equally short storeys shows every second or third number, each at its own height.
//  - Names ("Kniestock") are their own text beside the chain, never part of the number.
//  - Left of the building: ONE column of level marks (triangle with its tip on the level, value with sign). Two marks too close:
//    the lower one hangs below its level (triangle from below); a mark with no free place is left out and counted. Marks of
//    rank 0 (±0,00, lowest level, roof marks) are placed first, then the other storeys from the bottom up. Bands another text
//    of the drawing uses (`gesperrt`) stay free.
//
// Units: heights in metres (model), everything on the sheet in DRAWING UNITS — screen px or paper mm; `jeM` converts
// (screen: px per m; paper: 1000 / scale denominator, skill rule ZEICH-02). All distances are multiples of the font height
// `schrift`, so 9 px on screen and 2,5 mm on paper give the same picture.
//
// In:  storey levels, eaves / knee wall / parapet / roof line (m), jeM, font height, number format, texts of the marks.
// Out: schnittMassInhalt() → chains and marks (m); schnittMassLayout() → lines and texts as points {dx, h_m, dy};
//      rahmenVon() → the box of a text (for margins and the overlap test); koteText() → level value with sign.
//      No React, no DOM, no model import.
import { formatMeter } from "./masskette.js";

/** Heights closer than this are one level (m) — the tolerance of masskette.js. */
const TOL_M = 0.01;
/** Approximate glyph width per character as a fraction of the font height (Helvetica average, as vektorPlan / masskette). */
export const ZEICHEN_BREITE = 0.55;

// All of the following are multiples of the font height. [ASSUMED office practice, skill bit-zeichnung/bemassung-symbole.md:
// first chain ≈ 10 mm from the element, every further one 7–8 mm; with 2,5 mm text 3 × = 7,5 mm.]
/** First chain line from the building edge. */
const KETTE_ERSTE = 3;
/** Next chain line from the previous chain line (no numbers beside the previous chain). */
const KETTE_WEITER = 3;
/** Next chain line from the end of the numbers beside the previous chain (room for its own number above the line). */
const KETTE_NACH_TEXT = 2;
/** Extension lines start this far off the building edge … */
const HILF_ABSTAND = 0.5;
/** … and overshoot the chain line by this much. */
const HILF_UEBERSTAND = 0.6;
/** Half length of the 45° slash, measured along each axis. */
const STRICH_HALB = 0.45;
/** Gap between a line and the baseline of the text above it. */
const TEXT_ABSTAND = 0.35;
/** Padding a number needs on each side to count as "fits between its slashes". */
const TEXT_RAND = 0.2;
/** Length of the leader from the chain line to a number beside it. */
const HINWEIS = 1;
/** Gap between a number beside the chain and the name after it. */
const NAME_ABSTAND = 0.6;
/** Smallest clear gap between two text boxes. */
const LUFT = 0.15;
/** A number beside the chain may be pushed up by at most this much before it is left out. */
const MAX_VERSATZ = 2;
/** Level marks: tip of the triangle from the building edge; half width and height of the triangle (DIN 1356-1 proportions as 100-01). */
const KOTE_SPITZE = 3, KOTE_HALB = 0.64, KOTE_HOCH = 0.96;
/** Level marks: gap between the triangle and the text. */
const KOTE_TEXT = 0.4;
/** Text box around a baseline: this much below it (descenders) and above it (cap height + air). */
const UNTER = 0.2, UEBER = 0.8;

/**
 * Level value with sign, German decimal comma, two decimals (DIN 1356-1): 0 → "±0,00", 2.75 → "+2,75", -2.6 → "−2,60"
 * (U+2212 minus; the PDF writer maps it to WinAnsi, vektorPlan.winAnsi).
 * @param {number} m level in metres relative to ±0,00
 * @returns {string}
 */
export function koteText(m) {
  const r = Math.round(m * 100) / 100;
  if (r === 0) return "±0,00";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(2).replace(".", ",")}`;
}

/**
 * @typedef {{von_m: number, bis_m: number, name?: string}} MassStueck  one dimensioned piece (heights in m); name = key of a label
 * @typedef {{art: "detail"|"geschosse"|"gesamt", stuecke: MassStueck[]}} MassKette
 * @typedef {{h_m: number, art: "geschoss"|"dach"|"traufe"|"first"|"attika", name?: string, level?: number, rang: 0|1}} Kote
 *   h_m: level in m; name: storey name (art "geschoss"); rang 0 = placed first (±0,00, lowest level, roof marks)
 * @typedef {{dx: number, h_m: number, dy: number}} MassPunkt  dx: drawing units from the building edge OUTWARDS (right chains:
 *   to the right; level marks: to the left); h_m: height in m; dy: drawing units upwards from that height
 */

/** Sorted heights without near-duplicates (m). */
function eindeutig(/** @type {number[]} */ hoehen) {
  const s = hoehen.filter((h) => Number.isFinite(h)).sort((a, b) => a - b);
  return s.filter((h, i) => i === 0 || h - s[i - 1] > TOL_M);
}

/** Consecutive pieces of a list of heights. */
function stueckeAus(/** @type {number[]} */ hoehen) {
  /** @type {MassStueck[]} */
  const st = [];
  for (let i = 1; i < hoehen.length; i += 1) st.push({ von_m: hoehen[i - 1], bis_m: hoehen[i] });
  return st;
}

/**
 * What the section dimensions: the chains right of the building and the level marks left of it. Pure content, no placement.
 * @param {object} e
 * @param {Array<{level?: number, elevation: number, name?: string}>} [e.storeys] storeys of the model (elevation in m)
 * @param {number} e.totalH_m top of the top storey (model.totalHeight, m)
 * @param {number} e.wandOben_m top of the cut hull walls = eaves (globaleTraufhoehe_m, m); equals totalH_m without a knee wall
 * @param {number|null} [e.kniestock_m] knee wall in m (top of the structural slab to the eaves), null = none
 * @param {number} [e.attika_m] parapet height in m above wandOben_m, 0 = none (or its layer is hidden)
 * @param {{traufe_m: number, first_m: number}|null} [e.dachLinie] cut line of the global roof form (dachSchnittLinie), null = flat
 * @returns {{ketten: MassKette[], koten: Kote[]}} chains from the inside out (empty ones left out); marks in drawing order
 *   (storeys as in the model, then roof, then parapet)
 */
export function schnittMassInhalt({ storeys = [], totalH_m, wandOben_m, kniestock_m = null, attika_m = 0, dachLinie = null }) {
  const geschosse = (Array.isArray(storeys) ? storeys : []).filter((s) => Number.isFinite(s?.elevation));
  const total = Number(totalH_m) || 0, wand = Number.isFinite(wandOben_m) ? Number(wandOben_m) : total;
  const knie = kniestock_m != null && Number(kniestock_m) > TOL_M ? Number(kniestock_m) : 0;
  const attika = Number(attika_m) > TOL_M ? Number(attika_m) : 0;

  // detail: single pieces at the top of the wall
  /** @type {MassStueck[]} */
  const detail = [];
  if (knie) detail.push({ von_m: wand - knie, bis_m: wand, name: "kniestock" });
  if (attika) detail.push({ von_m: wand, bis_m: wand + attika });

  // storeys: every storey level and the top of the top storey (with a knee wall that is the collar-beam level, not the eaves)
  const ebenen = eindeutig([...(geschosse.length ? geschosse.map((s) => s.elevation) : [0]), total]);
  const geschossStuecke = stueckeAus(ebenen);

  // overall: below and above ±0,00, up to the highest point of the section (ridge, parapet or roof level)
  const oben = Math.max(total, wand + attika, dachLinie ? Number(dachLinie.first_m) || 0 : 0);
  const gesamt = eindeutig([ebenen[0], 0, oben]);
  const gleich = gesamt.length === ebenen.length && gesamt.every((h, i) => Math.abs(h - ebenen[i]) <= TOL_M);

  /** @type {MassKette[]} */
  const ketten = [];
  if (detail.length) ketten.push({ art: "detail", stuecke: detail });
  if (geschossStuecke.length) ketten.push({ art: "geschosse", stuecke: geschossStuecke });
  if (!gleich && gesamt.length >= 2) ketten.push({ art: "gesamt", stuecke: stueckeAus(gesamt) }); // never the same chain twice

  const tiefste = geschosse.length ? Math.min(...geschosse.map((s) => s.elevation)) : 0;
  /** @type {Kote[]} */
  const koten = geschosse.map((s) => ({
    h_m: s.elevation, art: /** @type {"geschoss"} */ ("geschoss"), name: s.name || "", level: s.level,
    rang: /** @type {0|1} */ (Math.abs(s.elevation) <= TOL_M || s.elevation === tiefste ? 0 : 1),
  }));
  if (dachLinie) {
    // a pitched roof has eaves and ridge ("OK Dach" at the eaves height was wrong for it, 108-01)
    koten.push({ h_m: dachLinie.traufe_m, art: "traufe", rang: 0 });
    koten.push({ h_m: dachLinie.first_m, art: "first", rang: 0 });
  } else koten.push({ h_m: total, art: "dach", rang: 0 });
  if (attika) koten.push({ h_m: wand + attika, art: "attika", rang: 0 });
  return { ketten, koten };
}

/**
 * @typedef {{art: "mass"|"hilf"|"strich"|"hinweis", a: MassPunkt, b: MassPunkt}} MassLinie  mass = dimension line, hilf =
 *   extension line, strich = 45° slash, hinweis = leader to a number beside the chain
 * @typedef {{art: "zahl"|"name", text: string, p: MassPunkt, winkel: 0|-90, breite: number, kette: number, name?: string}} MassText
 *   p: point on the BASELINE — winkel -90 (reads bottom-to-top, glyphs towards the building): the middle of the text;
 *   winkel 0: the end of the text nearest to the building (the text runs outwards from there); breite: estimated text width
 *   in drawing units; kette: index of its chain; name: key of the label (art "name")
 * @typedef {Kote & {text: string, lage: "oben"|"unten", spitze: MassPunkt, dreieck: MassPunkt[], linie: {a: MassPunkt, b: MassPunkt},
 *   p: MassPunkt, breite: number}} KoteLage  lage: text and triangle above ("oben") or below the level; spitze: tip of the
 *   triangle; linie: reference line from the tip to the building edge; p / breite: as MassText with winkel 0
 */

/**
 * Box of a text in drawing units: x outwards from the building edge, y upwards from ±0,00.
 * @param {{text: string, p: MassPunkt, winkel?: number, breite: number}} t text of schnittMassLayout
 * @param {number} jeM drawing units per metre
 * @param {number} schrift font height in drawing units
 * @returns {{x0: number, x1: number, y0: number, y1: number}}
 */
export function rahmenVon(t, jeM, schrift) {
  const y = t.p.h_m * jeM + t.p.dy;
  if (t.winkel === -90) return { x0: t.p.dx - UEBER * schrift, x1: t.p.dx + UNTER * schrift, y0: y - t.breite / 2, y1: y + t.breite / 2 };
  return { x0: t.p.dx, x1: t.p.dx + t.breite, y0: y - UNTER * schrift, y1: y + UEBER * schrift };
}

/**
 * Placement of the section dimensions: chains right of the building, level marks left of it (rules in the file header).
 * Deterministic: the same input gives the same output, nothing depends on the order of the calls.
 * @param {object} e
 * @param {MassKette[]} e.ketten chains from the inside out (schnittMassInhalt)
 * @param {Array<Kote & {text: string}>} e.koten level marks with their finished text (the caller composes value and name)
 * @param {number} e.jeM drawing units per metre (screen px per m, paper mm per m = 1000 / scale)
 * @param {number} e.schrift font height in drawing units (screen 9 px, paper 2,5 mm)
 * @param {(m: number) => string} [e.format] number of a piece (default: metres, two decimals, comma, no unit — masskette.formatMeter)
 * @param {Record<string, string>} [e.namen] label per name key, e.g. {kniestock: "Kniestock"}; a missing key shows no label
 * @param {Array<{h_m: number, von: number, bis: number}>} [e.gesperrt] vertical bands of the mark column that another text of the
 *   drawing already uses (e.g. the ground label under ±0,00): height in m, von … bis in drawing units upwards from it
 * @returns {{
 *   rechts: {linien: MassLinie[], texte: MassText[], breite: number, ausgelassen: number},
 *   links: {koten: KoteLage[], breite: number, ausgelassen: number},
 * }} breite: how far the chains / marks reach beyond their building edge (drawing units) — the margin the drawing needs;
 *   ausgelassen: numbers / marks left out because no free place was left
 */
export function schnittMassLayout({ ketten, koten, jeM, schrift, format = formatMeter, namen = {}, gesperrt = [] }) {
  const s = schrift, je = Math.max(Number(jeM) || 0, 1e-9);
  const breiteVon = (/** @type {string} */ text) => String(text).length * ZEICHEN_BREITE * s;
  const P = (/** @type {number} */ dx, /** @type {number} */ h_m, dy = 0) => ({ dx, h_m, dy });
  /** @type {MassLinie[]} */
  const linien = [];
  /** @type {MassText[]} */
  const texte = [];
  let ausgelassen = 0;

  const liste = (Array.isArray(ketten) ? ketten : []).map((k) => [...k.stuecke].filter((st) => st.bis_m - st.von_m > TOL_M).sort((a, b) => a.von_m - b.von_m)).filter((st) => st.length);
  const grenzen = liste.map((st) => eindeutig(st.flatMap((x) => [x.von_m, x.bis_m])));
  /** @type {number[]} */
  const kettenDx = [];
  let dx = KETTE_ERSTE * s, rand = 0;
  liste.forEach((stuecke, i) => {
    kettenDx.push(dx);
    // extension lines of the chains further out run through this chain's zone at these heights (drawing units)
    const durch = eindeutig(grenzen.slice(i + 1).flat()).map((h) => h * je);
    const frei = (/** @type {number} */ y0, /** @type {number} */ y1) => !durch.some((y) => y > y0 - LUFT * s && y < y1 + LUFT * s);
    // dimension line per run of joined pieces, a slash at every end of a piece
    let lauf = stuecke[0].von_m;
    stuecke.forEach((st, k) => {
      const naechstes = stuecke[k + 1];
      if (!naechstes || naechstes.von_m - st.bis_m > TOL_M) { linien.push({ art: "mass", a: P(dx, lauf), b: P(dx, st.bis_m) }); lauf = naechstes ? naechstes.von_m : lauf; }
    });
    for (const h of grenzen[i]) linien.push({ art: "strich", a: P(dx - STRICH_HALB * s, h, -STRICH_HALB * s), b: P(dx + STRICH_HALB * s, h, STRICH_HALB * s) });

    // numbers: on the line when they fit between their slashes, else in a row beside the chain; names always beside it
    /** @type {Array<{st: MassStueck, mitte: number, y0: number, zahl: string, bZahl: number, name: string, passt: boolean}>} */
    const reihen = [];
    for (const st of stuecke) {
      const mitte = (st.von_m + st.bis_m) / 2, y0 = mitte * je, laenge = (st.bis_m - st.von_m) * je;
      const zahl = format(st.bis_m - st.von_m), bZahl = breiteVon(zahl);
      const name = st.name && namen[st.name] ? namen[st.name] : "";
      const passt = bZahl + 2 * TEXT_RAND * s <= laenge && frei(y0 - bZahl / 2, y0 + bZahl / 2);
      if (passt) texte.push({ art: "zahl", text: zahl, p: P(dx - TEXT_ABSTAND * s, mitte), winkel: -90, breite: bZahl, kette: i });
      if (!passt || name) reihen.push({ st, mitte, y0, zahl, bZahl, name, passt });
    }
    // rows beside the chain: [number] [name], centred on y. A row is pushed up past the row below and past crossing extension lines.
    let letztesOben = -Infinity, textEnde = 0;
    const platz = (0.5 + LUFT) * s; // half a row plus the clear gap
    reihen.forEach((r, n) => {
      let y = Math.max(r.y0, letztesOben + platz);
      const geschoben = y > r.y0;
      for (const d of durch) if (Math.abs(d - y) < platz) y = d + platz; // durch is ascending: one pass
      // Pushed past the row below only when that does not take the place of the next number: a run of equally short storeys keeps
      // a calm rhythm (each number at its own height or none) instead of a fan of oblique leaders. A name is never given up.
      const naechste = reihen[n + 1];
      const verdraengt = geschoben && !r.name && naechste != null && naechste.y0 < y + 0.5 * s + platz;
      if (y - r.y0 > MAX_VERSATZ * s || verdraengt) { ausgelassen += 1; return; }
      letztesOben = y + 0.5 * s;
      const x0 = dx + HINWEIS * s, grund = y - r.y0 - (0.5 - UNTER) * s; // baseline so that the box is centred on y
      linien.push({ art: "hinweis", a: P(dx, r.mitte), b: P(x0 - 0.25 * s, r.mitte, y - r.y0) });
      let x = x0;
      if (!r.passt) { texte.push({ art: "zahl", text: r.zahl, p: P(x, r.mitte, grund), winkel: 0, breite: r.bZahl, kette: i }); x += r.bZahl + NAME_ABSTAND * s; }
      if (r.name) { texte.push({ art: "name", text: r.name, p: P(x, r.mitte, grund), winkel: 0, breite: breiteVon(r.name), kette: i, name: r.st.name }); x += breiteVon(r.name); }
      else x -= NAME_ABSTAND * s;
      textEnde = Math.max(textEnde, x);
    });
    rand = Math.max(rand, dx + HILF_UEBERSTAND * s, textEnde);
    dx = textEnde ? textEnde + KETTE_NACH_TEXT * s : dx + KETTE_WEITER * s;
  });
  // one extension line per level, out to the outermost chain that measures it
  /** @type {Array<{h: number, x: number}>} */
  const reichweite = [];
  for (const { h, x } of grenzen.flatMap((g, i) => g.map((h) => ({ h, x: kettenDx[i] }))).sort((a, b) => a.h - b.h)) {
    const letzte = reichweite[reichweite.length - 1];
    if (letzte && h - letzte.h <= TOL_M) letzte.x = Math.max(letzte.x, x);
    else reichweite.push({ h, x });
  }
  for (const { h, x } of reichweite) linien.push({ art: "hilf", a: P(HILF_ABSTAND * s, h), b: P(x + HILF_UEBERSTAND * s, h) });

  // ---- level marks: one column, text above its level; too close → below; no place → left out ----
  const spitze = KOTE_SPITZE * s, textX = spitze + (KOTE_HALB + KOTE_TEXT) * s;
  /** @type {Array<{y0: number, y1: number}>} */
  const belegt = (Array.isArray(gesperrt) ? gesperrt : []).map((g) => ({ y0: g.h_m * je + Math.min(g.von, g.bis), y1: g.h_m * je + Math.max(g.von, g.bis) }));
  /** @type {Map<number, KoteLage>} */
  const gesetzt = new Map();
  let kotenAus = 0;
  const marken = (Array.isArray(koten) ? koten : []).map((k, i) => ({ k, i })).filter(({ k }) => Number.isFinite(k?.h_m));
  // rank 0 first, from the top down: of two close marks (roof level / parapet) the upper one keeps its place above its level. Then the
  // other storeys from the bottom up: in a tall building every second or third storey keeps its mark, all above their levels.
  const folge = [...marken].sort((a, b) => (a.k.rang - b.k.rang) || (a.k.rang === 0 ? b.k.h_m - a.k.h_m : a.k.h_m - b.k.h_m) || (a.i - b.i));
  for (const { k, i } of folge) {
    const y = k.h_m * je, b = breiteVon(k.text);
    /** @type {Array<["oben"|"unten", number]>} baseline offset from the level */
    const lagen = [["oben", TEXT_ABSTAND * s], ["unten", -(TEXT_ABSTAND + UEBER) * s]];
    const lage = lagen.find(([, dy]) => !belegt.some((r) => y + dy - UNTER * s < r.y1 + LUFT * s && y + dy + UEBER * s > r.y0 - LUFT * s));
    if (!lage) { kotenAus += 1; continue; }
    const [wo, dy] = lage, vz = wo === "oben" ? 1 : -1;
    belegt.push({ y0: y + dy - UNTER * s, y1: y + dy + UEBER * s });
    gesetzt.set(i, {
      ...k, lage: wo, spitze: P(spitze, k.h_m),
      dreieck: [P(spitze, k.h_m), P(spitze + KOTE_HALB * s, k.h_m, vz * KOTE_HOCH * s), P(spitze - KOTE_HALB * s, k.h_m, vz * KOTE_HOCH * s)],
      linie: { a: P(spitze, k.h_m), b: P(0, k.h_m) }, p: P(textX, k.h_m, dy), breite: b,
    });
  }
  const kotenLage = marken.map(({ i }) => gesetzt.get(i)).filter((k) => k != null); // drawing order of the input
  const linksBreite = kotenLage.reduce((m, k) => Math.max(m, textX + k.breite), 0);

  return {
    rechts: { linien, texte, breite: rand, ausgelassen },
    links: { koten: /** @type {KoteLage[]} */ (kotenLage), breite: linksBreite, ausgelassen: kotenAus },
  };
}
