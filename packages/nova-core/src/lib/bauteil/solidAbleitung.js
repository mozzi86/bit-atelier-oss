// 107-09 (D-BK-07, D-BK-08, D-BK-08a, D-BK-08b, D-BK-15): the 3D solids of the intersected walls and slabs of a model, built on the
// CSG core of 107-14, and the plan cut / section derived from them.
//
// What it does: every band of verschneidung.js (one layer of one wall after the priority-based connection) becomes a prism of its
// extended layer (`max`) between the wall's lower and upper edge; the higher-ranked layers of other walls it meets are SUBTRACTED
// (booleschMit through kern.boolesch: watertight check of both inputs first), the openings of its wall are subtracted from every
// layer. The rule is the one of the 2D bands, so the solid volume can be checked against them: per layer and per wall the solid
// volume is compared with bandVolumen_m3 (volumenAbgleich of 107-14, threshold there). A wall whose comparison fails (deviation,
// open input, load error of the chunk) gets {quelle: "analytisch", warnung} and NO geometry — a component never comes from a solid
// that failed the comparison. Groups (D-BK-15): a pair with group 0 or different groups has no subtraction at all (the bands carry
// no `abzuege` for it), so no boolean runs and the volume is the sum of the single volumes.
// A slab with a build-up (107-03 task 5) loses the core solids of the walls with an equal or higher priority (D-BK-07 standard case:
// concrete slab 850 against a concrete core 850), same group only; the other way round (review 107-09), wall layers with a LOWER
// priority than the slab lose the slab (mitDeckenAbzuegen: masonry 650 under concrete 850), so no cell is counted twice.
// Freshness (review 107-09): every result carries an input signature (all inputs plus the placement); aktuelleSolids() and
// aktuelleDecken() keep only the entries that still belong to today's bands, so a drawer never shows a stale solid at an old place.
//
// Frames: every wall is computed around the middle of its bands (local coordinates, the accuracy finding of 107-14); the result is
// placed by `platzierung` (translation only, no rotation). Cache (D-BK-08a): key bauteilGuid + "pbc" / "decke-pbc", hash over every
// input of the solid in local coordinates — the extended layers, the subtracted regions of the NEIGHBOURS with their heights, the
// openings — so a change of a neighbour at a joint discards the entry. The cache functions come in through ctx (the BIM studio passes
// the hook useCsgCache of @designer); this module never imports @designer. A cached mesh is checked again against today's hand rule.
//
// Asynchronous (the CSG chunk is loaded lazily); the synchronous drawers (plan, section, IFC) only read finished results and fall
// back to the bands for every component without one. The IFC export does not use this module (D-BK-08b: extruded bands).
//
// In: bands (verschneidung.js), wall entries, slab records, ctx {csg?, cache?, geschosse?, abbruch?}. Out: Maps of results, plan and
// section outlines in m. No React, no I/O besides the cache functions handed in.

import { csgLaden } from "../csg/laden.js";
import { profilKoerper } from "../csg/koerper.js";
import { geometrienZusammenfuegen, dreieckAnzahl } from "../csg/dreiecke.js";
import { istWasserdicht } from "../csg/wasserdicht.js";
import { volumenJeGruppe, volumenAbgleich } from "../csg/volumen.js";
import { horizontalschnittWelt, vertikalschnittWelt } from "../csg/schnitt.js";
import { basisHash } from "../csg/basisHash.js";
import { platteSolid } from "../csg/bauteil.js";
import { aufbauVon } from "./aufbauten.js";
import { deckenLage } from "./hoehen.js";
import { verschneidungsgruppe } from "./steckbrief.js";
import { flaeche, inKonvex } from "../formGeometrie.js";
import { baender, bandVolumen_m3, restVolumen_m3, halbebenenVon, modellBaender, verschneidungsWaende, umrisse, schnittFlaeche_m2 } from "./verschneidung.js";
import { ShapeUtils, Vector2 } from "three";

export { baender, modellBaender, verschneidungsWaende };

/**
 * Overhang in m of a subtracted body beyond the bottom or top of the body it is cut from, when both share that height. [ASSUMED]
 * 2 cm like the opening body of 107-14: it keeps the faces from being coplanar (a known weak spot of mesh booleans) and removes
 * nothing that exists (the part above or below is outside the body anyway).
 */
export const UEBERSTAND_M = 0.02;

/**
 * @typedef {import("./verschneidung.js").Band} Band
 * @typedef {import("./verschneidung.js").Region} Region
 * @typedef {import("../csg/volumen.js").VolumenWarnung} VolumenWarnung
 * @typedef {{x: number, z: number}} P
 * @typedef {object} SolidEintrag  the derived solid of one component
 * @property {string} schluessel       component key ("env:…", "cw:…", "decke:<_idx>")
 * @property {import("three").BufferGeometry|null} geometrie  local geometry, groups per layer index; null when the comparison failed
 * @property {{ursprung: {x: number, y: number, z: number}, drehung_y: number}} platzierung
 * @property {"solid"|"analytisch"} quelle
 * @property {VolumenWarnung|null} warnung
 * @property {{solid_m3: number|null, analytisch_m3: number, jeSchicht: Array<{index: number, material: string|null, solid_m3: number|null, analytisch_m3: number}>}} volumen
 * @property {number} menge_m3        the quantity to use (solid when it agrees, else analytic), m³
 * @property {{schluessel: string, hash: string}} cache  cache key and hash of today's inputs
 * @property {boolean} ausCache
 * @property {string} eingabe          signature of every input INCLUDING the placement (aktuelleSolids / aktuelleDecken: is the entry
 *   still the one of today's bands?)
 * @typedef {object} SolidKontext
 * @property {any} [csg]      a loaded kern module (kern.js) — tests pass one with a spy; default csgLaden()
 * @property {{lesen?: (s: string, h: string) => Promise<import("three").BufferGeometry|null>, schreiben?: (s: string, h: string, g: import("three").BufferGeometry, meta?: any) => Promise<boolean>}|null} [cache]
 * @property {() => boolean} [abbruch] true = stop (the base changed meanwhile)
 * @property {import("./hoehen.js").Geschosse} [geschosse]
 */

/** @param {P[][]} polys @returns {{x: number, z: number}} middle of the bounding box (m) */
function mitte(polys) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of polys.flat()) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return Number.isFinite(x0) ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2 } : { x: 0, z: 0 };
}

/**
 * Bottom and top in the local frame of a subtracted region (overhang where it shares the body's bottom or top, see UEBERSTAND_M).
 * @param {Region} r @param {number} U lower edge of the body (world, m) @param {number} H body height (m)
 * @returns {[number, number]|null} null when the region misses the body vertically
 */
function lokalHoehe(r, U, H) {
  let y0 = r.unten_m - U, y1 = r.oben_m - U;
  if (!(Math.min(y1, H) > Math.max(y0, 0) + 1e-9)) return null;
  if (Math.abs(y0) < 1e-6) y0 = -UEBERSTAND_M;
  if (Math.abs(y1 - H) < 1e-6) y1 = H + UEBERSTAND_M;
  return [y0, y1];
}

/**
 * Distance in m by which a subtracted outline is pushed beyond a face of the body it shares. [ASSUMED] 1 cm, the idea of the opening
 * overhang of 107-14: a face of the subtracted body lying exactly in a face of the body (the outer face of a thin plaster or air layer
 * against the far face of the other wall) left an open result after several booleans (probe 26.10.: 2 of 4 cavity hull walls "csg-offen",
 * eingabe "ergebnis"). Outside the body nothing is removed, so the volume is unchanged.
 */
export const DRUECKEN_M = 0.01;

/**
 * The outlines to subtract from one convex body piece: every region is cut to the piece (R ∩ P, convex), its edges lying on the piece's
 * boundary are pushed DRUECKEN_M outward, and the pushed pieces of the same height interval are merged where they touch (two layers of
 * the other wall side by side would otherwise leave two coplanar faces inside the body). Same removed volume as the regions themselves.
 * @param {P[]} P convex body piece (world, m)
 * @param {Array<{plan: P[], y: [number, number]}>} regionen convex regions (world) with their local height interval
 * @returns {Array<{ring: P[], y: [number, number]}>} world rings (may be concave after merging) with their height interval
 */
export function abzugsRinge(P, regionen) {
  const hpP = halbebenenVon(P);
  const aufRand = (/** @type {{nx: number, nz: number, c: number}} */ h) => hpP.some((q) => Math.abs(q.nx - h.nx) < 1e-9 && Math.abs(q.nz - h.nz) < 1e-9 && Math.abs(q.c - h.c) < 1e-7);
  /** @type {Map<string, {y: [number, number], ringe: P[][]}>} */
  const gruppen = new Map();
  for (const r of regionen) {
    for (const t of inKonvex(r.plan, hpP).filter((x) => flaeche(x) > 1e-9)) {
      const hp = halbebenenVon(t).map((h) => (aufRand(h) ? { ...h, c: h.c + DRUECKEN_M } : h));
      const xs = t.map((q) => q.x), zs = t.map((q) => q.z);
      const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
      const ring = inKonvex([{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], hp)[0];
      if (!ring) continue;
      const k = `${r.y[0].toFixed(6)}|${r.y[1].toFixed(6)}`;
      if (!gruppen.has(k)) gruppen.set(k, { y: r.y, ringe: [] });
      /** @type {{ringe: P[][]}} */ (gruppen.get(k)).ringe.push(ring);
    }
  }
  return [...gruppen.values()].flatMap((g) => umrisse(g.ringe).map((ring) => ({ ring, y: g.y })));
}

/**
 * Prism of a body with outlines subtracted. The mesh boolean of the library depends on the ORDER of the operations (probe 26.10.,
 * cavity hull: subtracted one after the other, the fourth cut of a 50 mm air layer left 4 open edges; all at once in one body, the
 * 15 mm plaster layer did). Every result is checked anyway (watertight here, the volume comparison by the caller, D-BK-08b), so a
 * failed attempt is simply discarded and the next one tried: (1) prisms that are apart from each other (boxes not touching, margin
 * 1 mm) bundled into one body per boolean, (2) one boolean per outline in the given order, (3) the same in reverse order. Only when
 * all three fail is the component left to the hand rule (warning).
 * @param {any} kern loaded kern module
 * @param {P[]} ring local outline of the body (m)
 * @param {number} H height (m)
 * @param {Array<{ring: P[], y: [number, number]}>} regionen local outlines with their height interval (abzugsRinge)
 * @param {number} mi material index (layer)
 * @returns {{ok: true, geometrie: import("three").BufferGeometry|null}|{ok: false, warnung: VolumenWarnung}}
 */
function prismaMinus(kern, ring, H, regionen, mi) {
  if (!regionen.length) return { ok: true, geometrie: profilKoerper({ ring, y0_m: 0, y1_m: H, materialIndex: mi }) };
  const versuche = [buendeln(regionen), regionen.map((r) => [r]), [...regionen].reverse().map((r) => [r])];
  /** @type {VolumenWarnung|null} */
  let letzte = null;
  for (const v of versuche) {
    const r = einVersuch(kern, ring, H, v, mi);
    if (r.ok) return r;
    letzte = /** @type {any} */ (r).warnung;
  }
  return { ok: false, warnung: /** @type {VolumenWarnung} */ (letzte) };
}

/**
 * Groups outlines whose prisms are apart from each other (attempt 1 of prismaMinus).
 * @param {Array<{ring: P[], y: [number, number]}>} regionen
 * @returns {Array<Array<{ring: P[], y: [number, number]}>>}
 */
function buendeln(regionen) {
  /** @type {Array<Array<{r: {ring: P[], y: [number, number]}, box: number[]}>>} */
  const gruppen = [];
  for (const r of regionen) {
    const xs = r.ring.map((q) => q.x), zs = r.ring.map((q) => q.z);
    const box = [Math.min(...xs) - 1e-3, Math.max(...xs) + 1e-3, r.y[0] - 1e-3, r.y[1] + 1e-3, Math.min(...zs) - 1e-3, Math.max(...zs) + 1e-3];
    const frei = (/** @type {number[]} */ q) => q[1] < box[0] || box[1] < q[0] || q[3] < box[2] || box[3] < q[2] || q[5] < box[4] || box[5] < q[4];
    const ziel = gruppen.find((g) => g.every((x) => frei(x.box)));
    if (ziel) ziel.push({ r, box }); else gruppen.push([{ r, box }]);
  }
  return gruppen.map((g) => g.map((x) => x.r));
}

/**
 * One attempt: the body minus every group of outlines (one boolean per group), the result checked watertight.
 * @param {any} kern @param {P[]} ring @param {number} H @param {Array<Array<{ring: P[], y: [number, number]}>>} gruppen @param {number} mi
 * @returns {{ok: true, geometrie: import("three").BufferGeometry|null}|{ok: false, warnung: VolumenWarnung}}
 */
function einVersuch(kern, ring, H, gruppen, mi) {
  let k = profilKoerper({ ring, y0_m: 0, y1_m: H, materialIndex: mi });
  for (const g of gruppen) {
    const teile = g.map((r) => profilKoerper({ ring: r.ring, y0_m: r.y[0], y1_m: r.y[1], materialIndex: mi }));
    const b = teile.length === 1 ? teile[0] : geometrienZusammenfuegen(teile);
    if (teile.length > 1) for (const t of teile) t.dispose();
    const e = kern.boolesch(k, b, "subtract");
    b.dispose();
    k.dispose();
    if (!e.ok) return { ok: false, warnung: e.grund === "fehler" ? { code: "csg-fehler", text: e.text || "" } : { code: "csg-offen", eingabe: e.eingabe || "a" } };
    if (!e.dreiecke) return { ok: true, geometrie: null }; // nothing of the body remains
    k = e.geometrie;
  }
  if (!istWasserdicht(k).ok) {
    k.dispose();
    return { ok: false, warnung: { code: "csg-offen", eingabe: "ergebnis" } };
  }
  return { ok: true, geometrie: k };
}

/**
 * Bands grouped by wall key (input order kept).
 * @param {Band[]} bandListe
 * @returns {Map<string, Band[]>}
 */
function jeWandGruppieren(bandListe) {
  /** @type {Map<string, Band[]>} */
  const jeWand = new Map();
  for (const b of bandListe || []) {
    if (!jeWand.has(b.schluessel)) jeWand.set(b.schluessel, []);
    /** @type {Band[]} */ (jeWand.get(b.schluessel)).push(b);
  }
  return jeWand;
}

/**
 * Frame, height and hashes of the solid of ONE wall — the one preparation of wandSolids() and aktuelleSolids(), so a result and the
 * check of its freshness can never disagree.
 * @param {Band[]} liste bands of one wall
 */
function wandVorbereitung(liste) {
  const U = liste[0].unterkante_m, H = liste[0].oberkante_m - U;
  const m = mitte(liste.flatMap((b) => b.max));
  const lok = (/** @type {P[]} */ poly) => poly.map((p) => ({ x: p.x - m.x, z: p.z - m.z }));
  const platzierung = { ursprung: { x: m.x, y: U, z: m.z }, drehung_y: 0 };
  const regionenVon = (/** @type {Band} */ b) => [...b.abzuege, ...b.oeffnungen]
    .map((r) => ({ ring: lok(r.polygon), plan: r.polygon, y: lokalHoehe(r, U, H) }))
    .filter((r) => r.y);
  const basis = { h: H, schichten: liste.map((b) => ({ s: b.schicht, m: b.material, max: b.max.map(lok), r: regionenVon(b).map((r) => ({ p: r.ring, y: r.y })) })) };
  const hash = basisHash(basis);
  // the cache hash is translation-free (a moved wall of the same shape reuses its mesh); the input signature adds the placement
  return { U, H, lok, platzierung, regionenVon, hash, eingabe: basisHash({ hash, u: platzierung.ursprung }) };
}

/**
 * The solids that still belong to today's bands (review 107-09): a derivation runs asynchronously, so while it runs the studio still
 * holds the result of the previous bands; an entry whose input signature (hash of every input plus the placement) differs from today's
 * bands is left out, and the drawers fall back to the bands for that wall instead of drawing the old solid at the old place.
 * @param {Band[]} bandListe today's bands (every storey)
 * @param {Map<string, SolidEintrag>|null|undefined} solids the last finished result
 * @returns {Map<string, SolidEintrag>}
 */
export function aktuelleSolids(bandListe, solids) {
  /** @type {Map<string, SolidEintrag>} */
  const out = new Map();
  if (!solids?.size) return out;
  for (const [k, liste] of jeWandGruppieren(bandListe)) {
    const s = solids.get(k);
    if (s && s.eingabe === wandVorbereitung(liste).eingabe) out.set(k, s);
  }
  return out;
}

/**
 * Solids of the intersected walls (see file head).
 * @param {Band[]} bandListe bands of one or several storeys (verschneidung.js)
 * @param {Map<string, string>|null} guids wall key → element GUID (cache key); missing = the key itself
 * @param {SolidKontext} [ctx]
 * @returns {Promise<Map<string, SolidEintrag>>}
 */
export async function wandSolids(bandListe, guids, ctx = {}) {
  /** @type {Map<string, SolidEintrag>} */
  const out = new Map();
  for (const [schluessel, liste] of jeWandGruppieren(bandListe)) {
    if (ctx.abbruch?.()) break;
    const { H, lok, platzierung, regionenVon, hash, eingabe } = wandVorbereitung(liste);
    const jeSchicht = liste.map((b) => ({ index: b.schicht, material: b.material, solid_m3: /** @type {number|null} */ (null), analytisch_m3: bandVolumen_m3(b) }));
    const analytisch_m3 = jeSchicht.reduce((s, x) => s + x.analytisch_m3, 0);
    const cache = { schluessel: `${guids?.get(schluessel) || schluessel}|pbc`, hash };
    /** @type {import("three").BufferGeometry|null} */
    let geo = null;
    /** @type {VolumenWarnung|null} */
    let warnung = null;
    let ausCache = false;
    if (ctx.cache?.lesen) {
      try { geo = await ctx.cache.lesen(cache.schluessel, cache.hash); } catch { geo = null; }
      ausCache = !!geo;
    }
    if (!geo) {
      let kern = ctx.csg || null;
      if (!kern) {
        try { kern = await csgLaden(); } catch (e) { warnung = { code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e), analytisch_m3 }; }
      }
      if (kern && !(H > 0)) warnung = { code: "csg-ungueltig", art: "wand", analytisch_m3 };
      else if (kern) {
        /** @type {import("three").BufferGeometry[]} */
        const teile = [];
        outer: for (const b of liste) {
          const reg = /** @type {Array<{ring: P[], plan: P[], y: [number, number]}>} */ (regionenVon(b));
          for (const poly of b.max) {
            const abzug = abzugsRinge(poly, reg).map((x) => ({ ring: lok(x.ring), y: x.y }));
            const r = prismaMinus(kern, lok(poly), H, abzug, b.schicht);
            if (!r.ok) { warnung = { .../** @type {any} */ (r).warnung, analytisch_m3 }; break outer; }
            if (r.geometrie) teile.push(r.geometrie);
          }
        }
        if (!warnung && teile.length) {
          geo = geometrienZusammenfuegen(teile);
          for (const t of teile) if (t !== geo) t.dispose();
        } else for (const t of teile) t.dispose();
      }
    }
    let solid_m3 = /** @type {number|null} */ (null);
    let ok = false;
    if (geo) {
      const vg = volumenJeGruppe(geo);
      solid_m3 = Object.values(vg).reduce((s, x) => s + x, 0);
      for (const s of jeSchicht) s.solid_m3 = vg[s.index] ?? 0;
      const gesamt = volumenAbgleich({ solid_m3, analytisch_m3 });
      // a layer that deviates is a warning even when the total agrees (two errors may cancel out, 107-14)
      const schlecht = gesamt.ok ? jeSchicht.map((s) => volumenAbgleich({ solid_m3: s.solid_m3, analytisch_m3: s.analytisch_m3 })).find((x) => !x.ok) : gesamt;
      ok = !schlecht;
      if (!ok) warnung = /** @type {VolumenWarnung} */ (schlecht?.warnung || gesamt.warnung);
    } else if (!warnung) {
      // nothing was built and nothing failed: the bands have no area (fully covered by higher layers) — only valid when the hand rule is 0 too
      ok = Math.abs(analytisch_m3) <= 1e-4;
      solid_m3 = 0;
      if (!ok) warnung = { code: "csg-abweichung", solid_m3: 0, analytisch_m3, abweichung_rel: 1 };
    }
    if (ok && geo && !ausCache && ctx.cache?.schreiben) {
      const g = geo;
      void Promise.resolve(ctx.cache.schreiben(cache.schluessel, cache.hash, g, { volumen_m3: solid_m3, quelle: "solid" })).catch((e) => console.warn(`[verschneidung] cache entry ${cache.schluessel} not written (${e?.message || e})`));
    }
    if (!ok && geo) { geo.dispose(); geo = null; }
    out.set(schluessel, {
      schluessel, geometrie: ok ? geo : null, platzierung, quelle: ok ? "solid" : "analytisch", warnung: ok ? null : warnung,
      volumen: { solid_m3, analytisch_m3, jeSchicht }, menge_m3: ok && solid_m3 != null ? solid_m3 : analytisch_m3, cache, ausCache, eingabe,
    });
  }
  return out;
}

/**
 * Solids of the walls of ONE storey (task 2 of the plan): bands of the storey, then wandSolids().
 * @param {any[]} waende wall records or VerschneidungsWand entries (draw order)
 * @param {number} geschoss storey level
 * @param {SolidKontext & {aufbauVon?: (el: any) => any}} [ctx]
 * @returns {Promise<Map<string, SolidEintrag>>}
 */
export async function geschossSolids(waende, geschoss, ctx = {}) {
  const r = baender(waende, geschoss, ctx.aufbauVon, { geschosse: ctx.geschosse });
  /** @type {Map<string, string>} */
  const guids = new Map();
  for (const e of waende || []) if (e?.schluessel && e?.guid) guids.set(e.schluessel, e.guid);
  return wandSolids(r.baender, guids, ctx);
}

/**
 * Core regions of the walls (the cleaned pieces of every layer with the function "kern"), for the slab cut.
 * @param {Band[]} bandListe
 * @returns {Array<Region & {prioritaet: number, gruppe: number}>}
 */
export function wandKerne(bandListe) {
  return (bandListe || []).filter((b) => b.funktion === "kern" && b.gruppe !== 0)
    .flatMap((b) => b.teile.map((t) => ({ polygon: t, unten_m: b.unterkante_m, oben_m: b.oberkante_m, schluessel: b.schluessel, schicht: b.schicht, prioritaet: b.prioritaet, gruppe: b.gruppe })));
}

/**
 * Priority of a slab against the walls: the highest priority of its core layers, else of all its layers (m: aufbauVon).
 * @param {any} decke slab record with `composite`
 * @returns {number|null} null without a build-up
 */
export function deckenPrioritaet(decke) {
  const auf = aufbauVon(decke);
  if (auf.quelle !== "composite" || !auf.schichten.length) return null;
  const kern = auf.schichten.filter((s) => s.funktion === "kern");
  return Math.max(...(kern.length ? kern : auf.schichten).map((s) => s.prioritaet));
}

/** @param {P[]} poly @returns {boolean} */
function istKonvex(poly) {
  let vz = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const k = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(k) < 1e-12) continue;
    if (vz && Math.sign(k) !== vz) return false;
    vz = Math.sign(k);
  }
  return true;
}

/**
 * Everything of a slab solid that needs no CSG (synchronous): priority, group, height, outline, holes, the wall cores it loses, the
 * hand rule, the cache key and the input signature. The one preparation of deckenSolid(), aktuelleDecken() and deckenKuerzungen().
 * @param {any} decke slab record (points, level, composite, oeffnungen, verschneidungsgruppe, dicke_m/bezug)
 * @param {Array<Region & {prioritaet: number, gruppe: number}>} kerne wandKerne() of every storey
 * @param {{geschosse?: import("./hoehen.js").Geschosse, guid?: string}} [ctx]
 */
function deckenVorbereitung(decke, kerne, ctx = {}) {
  const prio = deckenPrioritaet(decke);
  /** @type {P[]} */
  const profil = Array.isArray(decke?.points) ? decke.points.map((/** @type {any} */ p) => ({ x: p.x, z: p.z })) : [];
  if (prio == null || profil.length < 3) return null;
  const gruppe = verschneidungsgruppe(decke);
  const lage = deckenLage(decke, ctx.geschosse, "decke");
  const U = lage.unterkante_m, d = lage.dicke_m;
  /** @type {P[][]} */
  const loecher = (Array.isArray(decke.oeffnungen) ? decke.oeffnungen : []).map((/** @type {any} */ o) => o?.points).filter((/** @type {any} */ p) => Array.isArray(p) && p.length >= 3);
  const regionen = gruppe === 0 ? [] : (kerne || []).filter((k) => k.gruppe === gruppe && k.prioritaet >= prio && Math.min(k.oben_m, U + d) > Math.max(k.unten_m, U) + 1e-9
    && inKonvex(profil, halbebenenVon(k.polygon)).some((t) => flaeche(t) > 1e-9));
  const konvexeLoecher = loecher.filter(istKonvex).map((l) => ({ polygon: l, unten_m: U - 1, oben_m: U + d + 1 }));
  const restLoecher = loecher.filter((l) => !istKonvex(l)).reduce((s, l) => s + flaeche(l) * d, 0);
  const analytisch_m3 = restVolumen_m3([profil], U, U + d, [...regionen, ...konvexeLoecher]) - restLoecher;
  const schluessel = `decke:${decke._idx}`;
  // origin of platteSolid (107-14): middle of the bounding box of the outline, at the lower edge
  const xs = profil.map((p) => p.x), zs = profil.map((p) => p.z);
  const o = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: U, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  const lok = (/** @type {P[]} */ poly) => poly.map((q) => ({ x: q.x - o.x, z: q.z - o.z }));
  const regLokal = regionen.map((r) => ({ ring: lok(r.polygon), plan: r.polygon, y: lokalHoehe(r, U, d) })).filter((r) => r.y);
  const hash = basisHash({ p: lok(profil), l: loecher.map(lok), d, r: regLokal.map((r) => ({ p: r.ring, y: r.y })) });
  const cache = { schluessel: `${ctx.guid || schluessel}|decke-pbc`, hash };
  return { prio, gruppe, U, d, profil, loecher, regionen, regLokal, analytisch_m3, schluessel, cache, ursprung: o, eingabe: basisHash({ hash, u: o }) };
}

/**
 * Solid of a drawn slab with a build-up, shortened by the wall cores of an equal or higher priority of the same group (task 4,
 * D-BK-07). Without a build-up or in group 0 nothing is cut (null = keep today's slab). The hand rule: (area − holes) × thickness
 * minus every core cell over its height overlap (restVolumen_m3); a non-convex hole is subtracted by its area [ASSUMED it does not
 * overlap a wall core — a hole in a slab sits beside the walls]. The cache is read first (D-BK-08a, like the walls); a cached mesh is
 * checked again against today's hand rule. Wall layers that rank BELOW the slab lose the slab instead (mitDeckenAbzuegen).
 * @param {any} decke slab record (points, level, composite, oeffnungen, verschneidungsgruppe, dicke_m/bezug)
 * @param {Array<Region & {prioritaet: number, gruppe: number}>} kerne wandKerne() of every storey
 * @param {SolidKontext & {guid?: string}} [ctx]
 * @returns {Promise<SolidEintrag|null>}
 */
export async function deckenSolid(decke, kerne, ctx = {}) {
  const v = deckenVorbereitung(decke, kerne, ctx);
  if (!v) return null;
  const { d, profil, loecher, regLokal, analytisch_m3, schluessel, cache } = v;
  const platzierung = { ursprung: v.ursprung, drehung_y: 0 };
  const jeSchicht = [{ index: 0, material: null, solid_m3: /** @type {number|null} */ (null), analytisch_m3 }];
  /** @type {VolumenWarnung|null} */
  let warnung = null;
  /** @type {import("three").BufferGeometry|null} */
  let geo = null;
  let ausCache = false;
  if (ctx.cache?.lesen) {
    try { geo = await ctx.cache.lesen(cache.schluessel, cache.hash); } catch (e) { console.warn(`[verschneidung] cache entry ${cache.schluessel} not read (${/** @type {any} */ (e)?.message || e})`); geo = null; }
    ausCache = !!geo;
  }
  if (!geo) {
    const p = await platteSolid(profil, d, loecher, { y0_m: v.U, kern: ctx.csg });
    if (!p.geometrie || !p.ok) warnung = p.warnung || { code: "csg-ungueltig", art: "platte", analytisch_m3 };
    else {
      geo = p.geometrie;
      let kern = ctx.csg || null;
      if (regLokal.length && !kern) {
        try { kern = await csgLaden(); } catch (e) { warnung = { code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e), analytisch_m3 }; }
      }
      for (const r of regLokal) {
        if (warnung || !geo) break;
        const b = profilKoerper({ ring: r.ring, y0_m: /** @type {[number, number]} */ (r.y)[0], y1_m: /** @type {[number, number]} */ (r.y)[1], materialIndex: 0 });
        const e = kern.boolesch(geo, b, "subtract");
        b.dispose();
        geo.dispose();
        geo = null;
        if (!e.ok) warnung = e.grund === "fehler" ? { code: "csg-fehler", text: e.text || "", analytisch_m3 } : { code: "csg-offen", eingabe: e.eingabe || "a", analytisch_m3 };
        else if (e.dreiecke) geo = e.geometrie;
      }
    }
  }
  let solid_m3 = /** @type {number|null} */ (null);
  let ok = false;
  if (geo && !warnung) {
    solid_m3 = Object.values(volumenJeGruppe(geo)).reduce((s, x) => s + x, 0);
    const a = volumenAbgleich({ solid_m3, analytisch_m3 });
    ok = a.ok && dreieckAnzahl(geo) > 0;
    if (!ok) warnung = a.warnung;
  }
  jeSchicht[0].solid_m3 = solid_m3;
  if (!ok && geo) { geo.dispose(); geo = null; }
  if (ok && geo && !ausCache && ctx.cache?.schreiben) {
    const g = geo;
    void Promise.resolve(ctx.cache.schreiben(cache.schluessel, cache.hash, g, { volumen_m3: solid_m3, quelle: "solid" })).catch((e) => console.warn(`[verschneidung] cache entry ${cache.schluessel} not written (${e?.message || e})`));
  }
  return {
    schluessel, geometrie: ok ? geo : null, platzierung, quelle: ok ? "solid" : "analytisch", warnung: ok ? null : warnung,
    volumen: { solid_m3, analytisch_m3, jeSchicht }, menge_m3: ok && solid_m3 != null ? solid_m3 : analytisch_m3, cache, ausCache, eingabe: v.eingabe,
  };
}

/**
 * The slab solids that still belong to today's walls and slabs (see aktuelleSolids()).
 * @param {any[]} decken drawn slab records
 * @param {Array<Region & {prioritaet: number, gruppe: number}>} kerne wandKerne() of today's bands
 * @param {Map<string, SolidEintrag>|null|undefined} solids the last finished slab results
 * @param {{geschosse?: import("./hoehen.js").Geschosse}} [opt]
 * @returns {Map<string, SolidEintrag>}
 */
export function aktuelleDecken(decken, kerne, solids, opt = {}) {
  /** @type {Map<string, SolidEintrag>} */
  const out = new Map();
  if (!solids?.size) return out;
  for (const d of decken || []) {
    const s = solids.get(`decke:${d?._idx}`);
    if (!s) continue;
    const v = deckenVorbereitung(d, kerne, opt);
    if (v && v.eingabe === s.eingabe) out.set(s.schluessel, s);
  }
  return out;
}

/**
 * Triangles of a slab outline minus its holes (earcut of three.js ShapeUtils) — convex pieces a band can lose.
 * @param {P[]} profil outline (m) @param {P[][]} loecher holes (m)
 * @returns {P[][]}
 */
function dreiecke(profil, loecher) {
  const v2 = (/** @type {P[]} */ r) => r.map((p) => new Vector2(p.x, p.z));
  const alle = [...profil, ...loecher.flat()];
  return ShapeUtils.triangulateShape(v2(profil), loecher.map(v2))
    .map((f) => f.map((i) => ({ x: alle[i].x, z: alle[i].z })))
    .filter((t) => flaeche(t) > 1e-9);
}

/**
 * Review 107-09 (plan truth "the slab no longer penetrates the wall twice in the quantities"): the other direction of the slab cut. A
 * layer of a wall whose priority is BELOW the priority of a slab of the same group (≥ 1) loses the slab where both overlap in plan and
 * in height — the usual case of a masonry wall (650) under a concrete slab (850). The slab itself keeps that part (deckenSolid only
 * subtracts wall cores of an equal or higher priority), so every cell is counted once. The slab enters a band as further `abzuege`
 * (triangles of its outline minus its holes, over its height), so the hand rule (bandVolumen_m3), the solid and the cache hash of the
 * wall follow without a rule of their own. The plan cut at the cut height is unchanged (2D bands, `teile`).
 * @param {Band[]} bandListe bands of every storey
 * @param {any[]} decken drawn slab records (only those with a build-up take part)
 * @param {{geschosse?: import("./hoehen.js").Geschosse}} [opt]
 * @returns {Band[]} the same bands, new objects where a slab was added
 */
export function mitDeckenAbzuegen(bandListe, decken, opt = {}) {
  const platten = [];
  for (const dk of decken || []) {
    const prio = deckenPrioritaet(dk);
    const gruppe = verschneidungsgruppe(dk);
    if (prio == null || gruppe === 0 || !Array.isArray(dk?.points) || dk.points.length < 3) continue;
    const lage = deckenLage(dk, opt.geschosse, "decke");
    /** @type {P[]} */
    const profil = dk.points.map((/** @type {any} */ p) => ({ x: p.x, z: p.z }));
    /** @type {P[][]} */
    const loecher = (Array.isArray(dk.oeffnungen) ? dk.oeffnungen : []).map((/** @type {any} */ o) => o?.points).filter((/** @type {any} */ p) => Array.isArray(p) && p.length >= 3)
      .map((/** @type {any[]} */ l) => l.map((p) => ({ x: p.x, z: p.z })));
    platten.push({ nr: dk._idx, prio, gruppe, u: lage.unterkante_m, o: lage.oberkante_m, teile: dreiecke(profil, loecher) });
  }
  if (!platten.length) return bandListe || [];
  return (bandListe || []).map((b) => {
    if (b.gruppe === 0) return b;
    /** @type {Region[]} */
    const extra = [];
    for (const pl of platten) {
      if (pl.gruppe !== b.gruppe || !(b.prioritaet < pl.prio)) continue;
      if (!(Math.min(pl.o, b.oberkante_m) > Math.max(pl.u, b.unterkante_m) + 1e-9)) continue;
      for (const t of pl.teile) if (b.max.some((m) => schnittFlaeche_m2(m, t) > 1e-9)) extra.push({ polygon: t, unten_m: pl.u, oben_m: pl.o, schluessel: `decke:${pl.nr}` });
    }
    return extra.length ? { ...b, abzuege: [...b.abzuege, ...extra] } : b;
  });
}

/**
 * Which drawn slabs are really cut, in either direction (review 107-09: the IFC note names only these): `kerne` = the slab loses wall
 * cores (the condition of deckenSolid), `waende` = keys of the walls that lose the slab (mitDeckenAbzuegen).
 * @param {Band[]} bandListe bands AFTER mitDeckenAbzuegen()
 * @param {any[]} decken drawn slab records
 * @param {{geschosse?: import("./hoehen.js").Geschosse}} [opt]
 * @returns {Map<number, {kerne: boolean, waende: string[]}>} key = the slab's _idx; slabs without a build-up are missing
 */
export function deckenKuerzungen(bandListe, decken, opt = {}) {
  const kerne = wandKerne(bandListe);
  /** @type {Map<number, {kerne: boolean, waende: string[]}>} */
  const out = new Map();
  for (const dk of decken || []) {
    const v = deckenVorbereitung(dk, kerne, opt);
    if (!v) continue;
    const waende = [...new Set((bandListe || []).filter((b) => b.abzuege.some((r) => r.schluessel === `decke:${dk._idx}`)).map((b) => b.schluessel))];
    out.set(dk._idx, { kerne: v.regionen.length > 0, waende });
  }
  return out;
}


/**
 * Plan outlines of the intersected walls of ONE storey (task 3): from the solid cut at the cut height where a solid exists (the gap
 * of an opening shows in the cut), else from the bands. A cut with chains that do not close falls back to the bands (never guessed), and
 * so does a solid the cut height misses (review 107-09: a parapet wall below 1.1 m or a wall with a high lower edge would otherwise
 * vanish from the plan and lose its click target — it is drawn from its bands, like without the switch).
 * @param {Band[]} bandListe bands of the storey
 * @param {Map<string, SolidEintrag>|null} solids
 * @param {number} y_welt_m cut height in world coordinates (storey elevation + cutHeight), m
 * @returns {Map<string, {quelle: "solid"|"baender", schichten: Array<{schicht: number, ringe: P[][]}>}>}
 */
export function planFlaechen(bandListe, solids, y_welt_m) {
  const out = new Map();
  for (const [k, liste] of jeWandGruppieren(bandListe)) {
    const s = solids?.get(k);
    if (s?.geometrie) {
      const c = horizontalschnittWelt(s.geometrie, s.platzierung, y_welt_m);
      if (!c.offen.length && c.schleifen.length) {
        const u = s.platzierung.ursprung;
        /** @type {Map<number, P[][]>} */
        const je = new Map();
        for (const l of c.schleifen) {
          if (!je.has(l.gruppe)) je.set(l.gruppe, []);
          /** @type {P[][]} */ (je.get(l.gruppe)).push(l.punkte.map((p) => ({ x: p.x + u.x, z: p.z + u.z })));
        }
        out.set(k, { quelle: "solid", schichten: [...je.entries()].sort((p, q) => p[0] - q[0]).map(([schicht, ringe]) => ({ schicht, ringe })) });
        continue;
      }
    }
    out.set(k, { quelle: "baender", schichten: liste.map((b) => ({ schicht: b.schicht, ringe: b.umrisse })) });
  }
  return out;
}

/**
 * Section outlines of the intersected walls along a vertical section line (task 3): from the solid where one exists, else the band
 * pieces cut by the line as rectangles from the lower to the upper edge. Coordinates: x = world x along the line's x, h = height (m).
 * Only walls the line crosses appear.
 * @param {Band[]} bandListe bands of every storey
 * @param {Map<string, SolidEintrag>|null} solids
 * @param {{a: P, b: P}} linie section line in world x/z (m); the BIM studio cuts at z = 0
 * @returns {Array<{schluessel: string, schicht: number, quelle: "solid"|"baender", ringe: Array<Array<{x: number, h: number}>>}>}
 */
export function schnittFlaechen(bandListe, solids, linie) {
  const out = [];
  const dx = linie.b.x - linie.a.x, dz = linie.b.z - linie.a.z;
  const l = Math.hypot(dx, dz) || 1;
  const n = { x: -dz / l, z: dx / l };
  const c = n.x * linie.a.x + n.z * linie.a.z;
  /** @type {Set<string>} */
  const fertig = new Set();
  for (const b of bandListe || []) {
    const s = solids?.get(b.schluessel);
    if (s?.geometrie) {
      if (fertig.has(b.schluessel)) continue;
      fertig.add(b.schluessel);
      const cut = vertikalschnittWelt(s.geometrie, s.platzierung, linie);
      if (!cut.offen.length) {
        const u = s.platzierung.ursprung;
        /** @type {Map<number, Array<Array<{x: number, h: number}>>>} */
        const je = new Map();
        for (const lp of cut.schleifen) {
          if (!je.has(lp.gruppe)) je.set(lp.gruppe, []);
          /** @type {any[]} */ (je.get(lp.gruppe)).push(lp.punkte.map((p) => ({ x: p.x + u.x, h: p.y + u.y })));
        }
        for (const [schicht, ringe] of je) out.push({ schluessel: b.schluessel, schicht, quelle: /** @type {"solid"} */ ("solid"), ringe });
        continue;
      }
      // open chains: fall back to the bands of this wall
      for (const bb of (bandListe || []).filter((x) => x.schluessel === b.schluessel)) out.push(...bandSchnitt(bb, n, c, linie));
      continue;
    }
    out.push(...bandSchnitt(b, n, c, linie));
  }
  return out;
}

/**
 * Pieces of a band cut by a vertical plane, as rectangles in section coordinates.
 * @param {Band} b @param {P} n unit normal of the line @param {number} c n·p of the line @param {{a: P, b: P}} linie
 * @returns {Array<{schluessel: string, schicht: number, quelle: "baender", ringe: Array<Array<{x: number, h: number}>>}>}
 */
function bandSchnitt(b, n, c, linie) {
  const dx = linie.b.x - linie.a.x, dz = linie.b.z - linie.a.z;
  const l = Math.hypot(dx, dz) || 1;
  const ringe = [];
  for (const t of b.teile) {
    /** @type {number[]} */
    const xs = [];
    for (let i = 0; i < t.length; i += 1) {
      const p = t[i], q = t[(i + 1) % t.length];
      const vp = n.x * p.x + n.z * p.z - c, vq = n.x * q.x + n.z * q.z - c;
      if ((vp <= 0 && vq >= 0) || (vp >= 0 && vq <= 0)) {
        if (vp === vq) continue;
        const s = vp / (vp - vq);
        const x = p.x + (q.x - p.x) * s, z = p.z + (q.z - p.z) * s;
        // position along the line, measured as world x when the line runs along x (the studio's section)
        xs.push(linie.a.x + ((x - linie.a.x) * dx + (z - linie.a.z) * dz) / l * (dx / l));
      }
    }
    if (xs.length < 2) continue;
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 - x0 < 1e-9) continue;
    ringe.push([{ x: x0, h: b.unterkante_m }, { x: x1, h: b.unterkante_m }, { x: x1, h: b.oberkante_m }, { x: x0, h: b.oberkante_m }]);
  }
  return ringe.length ? [{ schluessel: b.schluessel, schicht: b.schicht, quelle: /** @type {"baender"} */ ("baender"), ringe }] : [];
}
