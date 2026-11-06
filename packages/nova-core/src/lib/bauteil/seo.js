// 107-10 (Spec I.2 / II.5, BK-05, BK-47…51, BK-77; D-BK-08, D-BK-08a, D-BK-08b, D-BK-15): Solid Element Operations — the stored
// relations of solidrelationen_layer (seoRelationen.js) resolved into derived solids through the CSG core of 107-14.
//
// What it does:
//  - Wall under roof (operation `abzug_nach_oben`, operator = a roof of dachGeometrie.js): every LAYER solid of the wall (wandSolid,
//    openings already cut through all layers) minus one cutting body per roof face: the prism over the roof frame (widened by
//    DACH_RAND_M) whose lower face lies in the face's plane and whose top lies above everything. Because the surface of every roof
//    form of the library is the minimum of its face planes, "above the roof" is the union of the half-spaces above the single
//    planes — subtracting all of them leaves the wall below the roof: gable, eaves bevel, an inclined top through every layer.
//  - Analytic reference (D-BK-08b): the exact volume of the same body by plane geometry — per layer the integral of the clamped roof
//    height over the layer's plan rectangle, split with the convex half-plane primitives of formGeometrie.js (inKonvex) into the
//    regions where one plane is the lowest, each region exact by area × height at its centroid (the height is linear there), holes
//    of the openings subtracted the same way. This covers the gable wall (profile area in the wall plane × thickness), the eaves
//    wall (length × thickness × roof height at the centroid of the section) and every case in between, also a roof plane below the
//    wall bottom (contributes 0). With more than one roof on one wall there is no reference: the quantity stays OPEN (not guessed).
//  - Body against body (BK-05, operations abzug / schnitt / vereinigung): two prisms (Massing bodies, free bodies) through the core;
//    reference = area of the overlap (convex operator or convex target, inKonvex) × the overlap of the height ranges.
//  - Group 0 never intersects (D-BK-15): no boolean runs, the volume is the single volume, the warning says so.
//  - Every result goes through the comparison of 107-14 (volumenAbgleich: threshold there): above it the warning sits on the component,
//    the quantity is the analytic one, and the caller shows today's construction instead of the solid.
//
// Nothing is written back (VI.3): neither a, b, profile nor height of a target change. The cache (D-BK-08a) comes in through ctx
// (the BIM studio passes useCsgCache); key target GUID + relation ids, hash over the inputs of target AND operators, so moving an
// operator discards the entry (BK-51 live recompute without an incremental graph — the studio calls this in the same effect that
// rebuilds the 3D view; no second recompute mechanism).
// Curved roofs are open: the roof library only knows plane faces (dachBerechnen answers "form-offen", the caller reports it).
//
// Review 107-10: plan (seoPlanFlaechen, horizontal cut at the cut height) and section (seoSchnittFlaechen) come from the same solid, in
// the formats of 107-09, so screen plan, PDF/DXF plan and section draw the bevelled wall; body against body uses the cache like the wall;
// the keys "<guid>|seo:<ids>" are cleaned by the studio for this derivation only (istSeoCacheSchluessel, cacheBereinigen `bereich`).
//
// In: a model of components by GUID, the relation layer, ctx {kern?, cache?, geschosse?, abbruch?}. Out: Map target GUID → result
// {status, ok, geometrie (local), platzierung, volumen, menge_m3, quelle, warnung, hinweise, cache}. Asynchronous (lazy core).

import * as THREE from "three";
import { csgLaden } from "../csg/laden.js";
import { wandSolid, wandBasis } from "../csg/bauteil.js";
import { profilKoerper } from "../csg/koerper.js";
import { geometrieJeGruppe, geometrienZusammenfuegen, dreieckAnzahl } from "../csg/dreiecke.js";
import { istWasserdicht } from "../csg/wasserdicht.js";
import { volumen_m3, volumenJeGruppe, volumenAbgleich, analytischWand } from "../csg/volumen.js";
import { weltNachLokal, vertikalschnitt, horizontalschnitt } from "../csg/schnitt.js";
import { basisHash } from "../csg/basisHash.js";
import { cacheSchluessel } from "../csg/cache.js";
import { inKonvex } from "../formGeometrie.js";
import { koeffizienten, konvexHalbebenen, dachImRahmen, analytischWandUnterDach, flaeche_m2, DACH_RAND_M } from "./seoAnalytik.js";
import { relationenVon, relationWirkt, SEO_OPERATIONEN } from "./seoRelationen.js";

export { DACH_RAND_M, konvexHalbebenen, volumenUnterDach_m3, dachImRahmen, analytischWandUnterDach, wandProfilUnterDach } from "./seoAnalytik.js";
export { SEO_OPERATIONEN, SOLIDRELATIONEN_LEER, relationenVon, relationAnlegen, relationAktivSetzen, aktiveRelationenFuer, relationWirkt, istSeoCacheSchluessel } from "./seoRelationen.js";

/** Height in m by which the top of a cutting body lies above the highest point of the wall and the roof planes in the frame (no coplanar top). */
export const OBEN_UEBERSTAND_M = 1.0;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {{x: number, y: number, z: number}} Pkt3
 * @typedef {import("../csg/volumen.js").VolumenWarnung | {code: "seo-gruppe-0"|"seo-ohne-referenz"|"seo-nicht-unterstuetzt", analytisch_m3?: number|null}} SeoWarnung
 * @typedef {object} SeoErgebnis
 * @property {string} ziel_guid
 * @property {string[]} relationen      ids of the relations that act (in order)
 * @property {"solid"|"analytisch"|"offen"|"gruppe-0"|"nicht-unterstuetzt"|"fehlt"} status
 * @property {boolean} ok               a solid exists AND agrees with the analytic reference
 * @property {import("three").BufferGeometry|null} geometrie  local geometry (groups per layer) — drawn only when ok
 * @property {{ursprung: Pkt3, drehung_y: number}} platzierung
 * @property {{solid_m3: number|null, analytisch_m3: number|null, jeSchicht: Array<{index: number, solid_m3: number|null, analytisch_m3: number|null}>}} volumen
 * @property {number|null} menge_m3     quantity to use (solid when it agrees, analytic otherwise, null = open)
 * @property {"solid"|"analytisch"|"offen"} quelle
 * @property {SeoWarnung|null} warnung
 * @property {string[]} hinweise        codes of relations that do not act ("gruppe-0", "operator-fehlt", "nicht-unterstuetzt")
 * @property {{schluessel: string, hash: string}|null} cache
 */

// ---------------------------------------------------------------------------------------------------------------------------
// cutting bodies

/**
 * Closed convex prism over a plan polygon: lower face in a plane (height per corner), upper face flat at yOben. Outward normals,
 * one group with the given material index (the layer it cuts, so the cut faces stay in that layer's group, like the opening body of
 * 107-14).
 * @param {PktXZ[]} box convex plan polygon (m)
 * @param {(p: PktXZ) => number} unten height of the lower face at a corner (m)
 * @param {number} yOben height of the flat top (m)
 * @param {number} materialIndex
 * @returns {THREE.BufferGeometry}
 */
export function prismaUnterEbene(box, unten, yOben, materialIndex = 0) {
  const b = box.map((p) => [p.x, unten(p), p.z]), t = box.map((p) => [p.x, yOben, p.z]);
  /** @type {number[]} */
  const pos = [];
  const tri = (/** @type {number[]} */ a, /** @type {number[]} */ c, /** @type {number[]} */ e) => pos.push(...a, ...c, ...e);
  const n = box.length;
  for (let i = 1; i + 1 < n; i += 1) tri(t[0], t[i], t[i + 1]); // top (t0, t1, … tn)
  for (let i = 1; i + 1 < n; i += 1) tri(b[n - 1], b[n - 1 - i], b[n - 2 - i]); // bottom reversed (bn-1 … b0)
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    tri(b[i], b[j], t[j]);
    tri(b[i], t[j], t[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (volumen_m3(g) < 0) {
    // the polygon ran the other way: flip every triangle
    const a = /** @type {Float32Array} */ (g.getAttribute("position").array);
    for (let k = 0; k < a.length; k += 9) for (let c = 0; c < 3; c += 1) { const x = a[k + 3 + c]; a[k + 3 + c] = a[k + 6 + c]; a[k + 6 + c] = x; }
  }
  g.addGroup(0, pos.length / 3, materialIndex);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------
// wall under roof

/**
 * Hash basis of a roof as an operator (frame, rise, eaves, planes): what the cut depends on.
 * @param {import("./dachGeometrie.js").DachErgebnis} d
 */
function dachBasis(d) {
  return { form: d.form, rahmen: d.rahmen, traufhoehe_m: d.traufhoehe_m, anstieg_m: d.anstieg_m, flaechen: d.flaechen.map((f) => f.punkte3d) };
}

/**
 * A wall cut against the faces of one or more roofs (operation abzug_nach_oben), see file head.
 * @param {any} wand wall record (a, b in m, composite/thickness, refLine, level, height …)
 * @param {any[]} oeffnungen opening records of this wall (u, width/height/sill …)
 * @param {Array<import("./dachGeometrie.js").DachErgebnis>} daecher roofs in world coordinates (m)
 * @param {{kern?: any, geschosse?: any, anker?: any, cache?: any, guid?: string, art?: string}} [ctx] cache with guid and art: key "<guid>|<art>"
 * @returns {Promise<Omit<SeoErgebnis, "ziel_guid"|"relationen"|"hinweise">>}
 */
export async function wandUnterDach(wand, oeffnungen, daecher, ctx = {}) {
  const basis = wandBasis(wand, oeffnungen, ctx);
  const D = basis.schichten.reduce((s, x) => s + x.dicke_m, 0);
  const L = basis.laenge_m, H = basis.hoehe_m;
  const dx = (basis.b.x - basis.a.x) / (L || 1), dz = (basis.b.z - basis.a.z) / (L || 1);
  // the same placement wandSolid computes (local frame of the wall)
  const pl = { ursprung: { x: basis.a.x - dz * basis.versatz_m, y: basis.unterkante_m, z: basis.a.z + dx * basis.versatz_m }, drehung_y: -Math.atan2(dz, dx) };
  const lok = daecher.map((d) => dachImRahmen(d, pl));
  const ana = lok.length === 1 ? analytischWandUnterDach(basis, lok[0]) : null;
  const cache = ctx.guid ? { schluessel: cacheSchluessel(ctx.guid, ctx.art || "seo"), hash: basisHash({ wand: basis, daecher: daecher.map(dachBasis), rand_m: DACH_RAND_M }) } : null;
  /** @param {SeoWarnung|null} warnung @returns {Omit<SeoErgebnis, "ziel_guid"|"relationen"|"hinweise">} */
  const ohneSolid = (warnung) => ({
    status: ana ? "analytisch" : "offen", ok: false, geometrie: null, platzierung: pl,
    volumen: { solid_m3: null, analytisch_m3: ana ? ana.gesamt_m3 : null, jeSchicht: basis.schichten.map((_, i) => ({ index: i, solid_m3: null, analytisch_m3: ana ? ana.jeSchicht_m3[i] : null })) },
    menge_m3: ana ? ana.gesamt_m3 : null, quelle: ana ? "analytisch" : "offen", warnung, cache,
  });
  /**
   * Result of a finished geometry: comparison per layer and in total.
   * @param {THREE.BufferGeometry} geometrie
   */
  const auswerten = (geometrie) => {
    const jeGruppe = volumenJeGruppe(geometrie);
    const solid_m3 = Object.values(jeGruppe).reduce((s, x) => s + x, 0);
    if (!ana) {
      return { status: /** @type {"offen"} */ ("offen"), ok: false, geometrie, platzierung: pl,
        volumen: { solid_m3, analytisch_m3: null, jeSchicht: basis.schichten.map((_, i) => ({ index: i, solid_m3: jeGruppe[i] ?? 0, analytisch_m3: null })) },
        menge_m3: null, quelle: /** @type {"offen"} */ ("offen"), warnung: /** @type {SeoWarnung} */ ({ code: "seo-ohne-referenz", analytisch_m3: null }), cache };
    }
    const abgleich = volumenAbgleich({ solid_m3, analytisch_m3: ana.gesamt_m3 });
    const jeSchicht = basis.schichten.map((_, i) => ({ index: i, solid_m3: jeGruppe[i] ?? 0, analytisch_m3: ana.jeSchicht_m3[i] }));
    // a layer that deviates is a warning even when the total agrees (two errors may cancel out)
    const schlecht = abgleich.ok ? jeSchicht.map((s) => volumenAbgleich({ solid_m3: s.solid_m3, analytisch_m3: s.analytisch_m3 })).find((x) => !x.ok) : abgleich;
    const ok = !schlecht;
    return { status: ok ? /** @type {"solid"} */ ("solid") : /** @type {"analytisch"} */ ("analytisch"), ok, geometrie, platzierung: pl,
      volumen: { solid_m3, analytisch_m3: ana.gesamt_m3, jeSchicht },
      menge_m3: ok ? solid_m3 : ana.gesamt_m3, quelle: ok ? /** @type {"solid"} */ ("solid") : /** @type {"analytisch"} */ ("analytisch"),
      warnung: ok ? null : /** @type {SeoWarnung} */ (schlecht?.warnung || abgleich.warnung), cache };
  };
  // a cached mesh is checked again against today's hand rule (never trusted as such)
  if (cache && ctx.cache?.lesen) {
    let geo = null;
    try { geo = await ctx.cache.lesen(cache.schluessel, cache.hash); } catch (e) { console.warn(`[seo] cache entry ${cache.schluessel} not read (${/** @type {any} */ (e)?.message || e})`); }
    if (geo) {
      const r = auswerten(geo);
      if (r.ok) return r;
      geo.dispose();
    }
  }
  let kern;
  try {
    kern = ctx.kern || (await csgLaden());
  } catch (e) {
    return ohneSolid({ code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e), analytisch_m3: ana ? ana.gesamt_m3 : undefined });
  }
  const sol = await wandSolid(wand, oeffnungen, { geschosse: ctx.geschosse, anker: ctx.anker, kern });
  if (!sol.geometrie) return ohneSolid(sol.warnung);
  const teile = geometrieJeGruppe(sol.geometrie);
  sol.geometrie.dispose();
  /** @type {THREE.BufferGeometry[]} */
  const fertig = [];
  /** @type {SeoWarnung|null} */
  let fehler = null;
  for (const [mi, g0] of teile) {
    let k = g0;
    for (const d of lok) {
      for (const e of d.ebenen) {
        if (fehler || dreieckAnzahl(k) === 0) break;
        const kf = koeffizienten(e);
        const hoehe = (/** @type {PktXZ} */ p) => kf.A * p.x + kf.B * p.z + kf.C;
        // no cut when the plane lies above the whole wall (its minimum over the wall rectangle is at a corner)
        const ecken = [{ x: 0, z: -D / 2 }, { x: L, z: -D / 2 }, { x: L, z: D / 2 }, { x: 0, z: D / 2 }];
        if (Math.min(...ecken.map(hoehe)) >= H - 1e-9) continue;
        const oben = Math.max(H, ...d.box.map(hoehe)) + OBEN_UEBERSTAND_M;
        const op = prismaUnterEbene(d.box, hoehe, oben, mi);
        const r = kern.boolesch(k, op, "subtract");
        op.dispose();
        if (!r.ok) {
          fehler = r.grund === "fehler" ? { code: "csg-fehler", text: r.text || "", analytisch_m3: ana ? ana.gesamt_m3 : undefined } : { code: "csg-offen", eingabe: r.eingabe || "a", analytisch_m3: ana ? ana.gesamt_m3 : undefined };
          break;
        }
        k.dispose();
        k = r.geometrie;
      }
    }
    if (!fehler && dreieckAnzahl(k) > 0 && !istWasserdicht(k).ok) fehler = { code: "csg-offen", eingabe: "ergebnis", analytisch_m3: ana ? ana.gesamt_m3 : undefined };
    if (dreieckAnzahl(k) > 0) fertig.push(k);
    else k.dispose();
    if (fehler) break;
  }
  if (fehler || !fertig.length) {
    for (const t of fertig) t.dispose();
    return ohneSolid(fehler || { code: "csg-ungueltig", art: "wand", analytisch_m3: ana ? ana.gesamt_m3 : undefined });
  }
  const geometrie = geometrienZusammenfuegen(fertig);
  for (const t of fertig) if (t !== geometrie) t.dispose();
  const r = auswerten(geometrie);
  if (r.ok && cache && ctx.cache?.schreiben) {
    const g = geometrie.clone();
    void Promise.resolve(ctx.cache.schreiben(cache.schluessel, cache.hash, g, { volumen_m3: r.volumen.solid_m3, quelle: "solid" }))
      .catch((e) => console.warn(`[seo] cache entry ${cache.schluessel} not written (${e?.message || e})`));
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------------
// body against body

/**
 * @typedef {{profil: PktXZ[], y0_m: number, y1_m: number, loecher?: PktXZ[][]}} Koerper  prism in world coordinates (m)
 */

/** @param {PktXZ[]} p @returns {boolean} convex (no reflex corner) */
function istKonvex(p) {
  let vz = 0;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const k = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(k) < 1e-12) continue;
    if (vz === 0) vz = Math.sign(k);
    else if (Math.sign(k) !== vz) return false;
  }
  return true;
}

/**
 * Analytic volumes of two prisms: each alone and their overlap (area of the plan overlap × overlap of the height ranges). The plan
 * overlap needs one of both outlines convex (inKonvex); otherwise, or with inner rings, there is no reference (null).
 * @param {Koerper} z target
 * @param {Koerper} o operator
 * @returns {{ziel_m3: number, operator_m3: number, ueberlappung_m3: number}|null}
 */
export function analytischKoerper(z, o) {
  const vz = flaeche_m2(z.profil) * (z.y1_m - z.y0_m), vo = flaeche_m2(o.profil) * (o.y1_m - o.y0_m);
  if ((z.loecher && z.loecher.length) || (o.loecher && o.loecher.length)) return null;
  const dh = Math.max(0, Math.min(z.y1_m, o.y1_m) - Math.max(z.y0_m, o.y0_m));
  let teile;
  if (istKonvex(o.profil)) teile = inKonvex(z.profil, konvexHalbebenen(o.profil));
  else if (istKonvex(z.profil)) teile = inKonvex(o.profil, konvexHalbebenen(z.profil));
  else return null;
  const a = teile.reduce((s, t) => s + flaeche_m2(t), 0);
  return { ziel_m3: vz, operator_m3: vo, ueberlappung_m3: a * dh };
}

/**
 * Boolean of two prisms (Massing bodies, free bodies; BK-05 partial penetration = `abzug` with an operator body). Computed in a local
 * frame around the middle of the target's bounding box (accuracy, 107-14), placed by translation.
 * @param {Koerper} ziel
 * @param {Koerper} operator
 * @param {import("./seoRelationen.js").SeoOperation} operation abzug / schnitt / vereinigung (the two directed ones are not defined for bodies)
 * @param {{kern?: any, cache?: any, guid?: string, art?: string}} [ctx] cache with guid and art: key "<guid>|<art>" (review 107-10: like
 *   wandUnterDach — hash over target, operator and operation; a cached mesh is checked against today's hand rule before it is used)
 * @returns {Promise<Omit<SeoErgebnis, "ziel_guid"|"relationen"|"hinweise">>}
 */
export async function koerperOperation(ziel, operator, operation, ctx = {}) {
  const xs = ziel.profil.map((p) => p.x), zs = ziel.profil.map((p) => p.z);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, mz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const pl = { ursprung: { x: mx, y: 0, z: mz }, drehung_y: 0 };
  const ana = analytischKoerper(ziel, operator);
  const ref = ana ? (operation === "schnitt" ? ana.ueberlappung_m3 : operation === "vereinigung" ? ana.ziel_m3 + ana.operator_m3 - ana.ueberlappung_m3 : ana.ziel_m3 - ana.ueberlappung_m3) : null;
  const cache = ctx.guid ? { schluessel: cacheSchluessel(ctx.guid, ctx.art || "seo"), hash: basisHash({ ziel, operator, operation }) } : null;
  const leer = (/** @type {SeoWarnung|null} */ warnung) => ({
    status: /** @type {"analytisch"|"offen"} */ (ref != null ? "analytisch" : "offen"), ok: false, geometrie: null, platzierung: pl,
    volumen: { solid_m3: null, analytisch_m3: ref, jeSchicht: [{ index: 0, solid_m3: null, analytisch_m3: ref }] },
    menge_m3: ref, quelle: /** @type {"analytisch"|"offen"} */ (ref != null ? "analytisch" : "offen"), warnung, cache,
  });
  const op = SEO_OPERATIONEN[operation];
  if (!op || operation === "abzug_nach_oben" || operation === "abzug_nach_unten") return leer({ code: "seo-nicht-unterstuetzt", analytisch_m3: ref });
  // a cached mesh is used only when it still agrees with today's hand rule (never trusted as such, D-BK-08a)
  if (cache && ref != null && ctx.cache?.lesen) {
    let geo = null;
    try { geo = await ctx.cache.lesen(cache.schluessel, cache.hash); } catch (e) { console.warn(`[seo] cache entry ${cache.schluessel} not read (${/** @type {any} */ (e)?.message || e})`); }
    if (geo) {
      const solid_m3 = volumen_m3(geo);
      const abg = volumenAbgleich({ solid_m3, analytisch_m3: ref });
      if (abg.ok) {
        return { status: "solid", ok: true, geometrie: geo, platzierung: pl, volumen: { solid_m3, analytisch_m3: ref, jeSchicht: [{ index: 0, solid_m3, analytisch_m3: ref }] },
          menge_m3: abg.menge_m3, quelle: abg.quelle, warnung: null, cache };
      }
      geo.dispose();
    }
  }
  let kern;
  try { kern = ctx.kern || (await csgLaden()); } catch (e) { return leer({ code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e) }); }
  const lokal = (/** @type {PktXZ[]} */ r) => r.map((p) => ({ x: p.x - mx, z: p.z - mz }));
  const a = profilKoerper({ ring: lokal(ziel.profil), loecher: (ziel.loecher || []).map(lokal), y0_m: ziel.y0_m, y1_m: ziel.y1_m });
  const b = profilKoerper({ ring: lokal(operator.profil), loecher: (operator.loecher || []).map(lokal), y0_m: operator.y0_m, y1_m: operator.y1_m });
  const r = kern.boolesch(a, b, /** @type {"subtract"|"intersect"|"union"} */ (op));
  a.dispose(); b.dispose();
  if (!r.ok) return leer(r.grund === "fehler" ? { code: "csg-fehler", text: r.text || "" } : { code: "csg-offen", eingabe: r.eingabe || "a" });
  if (dreieckAnzahl(r.geometrie) > 0 && !istWasserdicht(r.geometrie).ok) { r.geometrie.dispose(); return leer({ code: "csg-offen", eingabe: "ergebnis" }); }
  const solid_m3 = volumen_m3(r.geometrie);
  if (ref == null) {
    return { status: "offen", ok: false, geometrie: r.geometrie, platzierung: pl, volumen: { solid_m3, analytisch_m3: null, jeSchicht: [{ index: 0, solid_m3, analytisch_m3: null }] },
      menge_m3: null, quelle: "offen", warnung: { code: "seo-ohne-referenz", analytisch_m3: null }, cache };
  }
  const abg = volumenAbgleich({ solid_m3, analytisch_m3: ref });
  if (abg.ok && cache && ctx.cache?.schreiben) {
    const g = r.geometrie.clone();
    void Promise.resolve(ctx.cache.schreiben(cache.schluessel, cache.hash, g, { volumen_m3: solid_m3, quelle: "solid" }))
      .catch((e) => console.warn(`[seo] cache entry ${cache.schluessel} not written (${e?.message || e})`));
  }
  return { status: abg.ok ? "solid" : "analytisch", ok: abg.ok, geometrie: r.geometrie, platzierung: pl,
    volumen: { solid_m3, analytisch_m3: ref, jeSchicht: [{ index: 0, solid_m3, analytisch_m3: ref }] },
    menge_m3: abg.menge_m3, quelle: abg.quelle, warnung: abg.warnung, cache };
}

// ---------------------------------------------------------------------------------------------------------------------------
// resolution of the stored relations

/**
 * @typedef {{art: "wand", element: any, wand: any, oeffnungen?: any[]}
 *   | {art: "dach", element: any, dach: import("./dachGeometrie.js").DachErgebnis|import("./dachGeometrie.js").DachFehler}
 *   | {art: "koerper", element: any, koerper: Koerper}} SeoBauteil
 */

/**
 * Resolves the active relations of the layer into derived solids — the async successor of a pure derivation like massingGeometrie
 * (see file head). One result per TARGET: all its acting relations are applied together (a wall under several roofs is one solid).
 * Supported: wall ← roof (`abzug_nach_oben`), body ← body (`abzug`, `schnitt`, `vereinigung`, one relation per target). Everything
 * else stays stored and is reported as "nicht-unterstuetzt" (open), never guessed.
 * @param {{bauteile: Map<string, SeoBauteil>}} modell components by GUID (persisted GUIDs of 107-08)
 * @param {any} relationenLayer solidrelationen_layer
 * @param {{kern?: any, cache?: any, geschosse?: any, abbruch?: () => boolean}} [ctx]
 * @returns {Promise<Map<string, SeoErgebnis>>}
 */
export async function aufgeloesteGeometrie(modell, relationenLayer, ctx = {}) {
  /** @type {Map<string, SeoErgebnis>} */
  const out = new Map();
  /** @type {Map<string, import("./seoRelationen.js").SeoRelation[]>} */
  const jeZiel = new Map();
  for (const r of relationenVon(relationenLayer)) {
    if (!r.aktiv) continue;
    if (!jeZiel.has(r.ziel_guid)) jeZiel.set(r.ziel_guid, []);
    /** @type {any[]} */ (jeZiel.get(r.ziel_guid)).push(r);
  }
  for (const [guid, rels] of jeZiel) {
    if (ctx.abbruch?.()) break;
    const ziel = modell.bauteile.get(guid);
    /** @type {string[]} */
    const hinweise = [];
    const leer = (/** @type {SeoErgebnis["status"]} */ status, /** @type {SeoWarnung|null} */ warnung, /** @type {number|null} */ menge = null) => /** @type {SeoErgebnis} */ ({
      ziel_guid: guid, relationen: [], status, ok: false, geometrie: null, platzierung: { ursprung: { x: 0, y: 0, z: 0 }, drehung_y: 0 },
      volumen: { solid_m3: null, analytisch_m3: menge, jeSchicht: [] }, menge_m3: menge, quelle: menge != null ? "analytisch" : "offen", warnung, hinweise, cache: null });
    if (!ziel) { out.set(guid, leer("fehlt", null)); continue; }
    /** @type {Array<{r: import("./seoRelationen.js").SeoRelation, op: SeoBauteil}>} */
    const wirkend = [];
    for (const r of rels) {
      const op = modell.bauteile.get(r.operator_guid);
      if (!op) { hinweise.push("operator-fehlt"); continue; }
      if (!relationWirkt(ziel.element, op.element).wirkt) { hinweise.push("gruppe-0"); continue; }
      wirkend.push({ r, op });
    }
    // group 0 (or nothing left that acts): no boolean at all, the single volume, the stored relation keeps its place
    if (!wirkend.length) {
      const einzel = ziel.art === "wand"
        ? (() => { const b = wandBasis(ziel.wand, ziel.oeffnungen || [], ctx); return analytischWand({ laenge_m: b.laenge_m, hoehe_m: b.hoehe_m, schichten_m: b.schichten.map((s) => s.dicke_m), oeffnungen: b.oeffnungen }).gesamt_m3; })()
        : ziel.art === "koerper" ? flaeche_m2(ziel.koerper.profil) * (ziel.koerper.y1_m - ziel.koerper.y0_m) : null;
      out.set(guid, leer(hinweise.includes("gruppe-0") ? "gruppe-0" : "fehlt", hinweise.includes("gruppe-0") ? { code: "seo-gruppe-0", analytisch_m3: einzel } : null, einzel));
      continue;
    }
    if (ziel.art === "wand" && wirkend.every((w) => w.op.art === "dach" && w.r.operation === "abzug_nach_oben")) {
      const daecher = wirkend.map((w) => /** @type {any} */ (w.op).dach);
      if (daecher.some((d) => !d?.ok)) { out.set(guid, { ...leer("offen", { code: "seo-nicht-unterstuetzt", analytisch_m3: null }), hinweise: [...hinweise, "dach-form-offen"], relationen: wirkend.map((w) => w.r.id) }); continue; }
      const r = await wandUnterDach(ziel.wand, ziel.oeffnungen || [], daecher, { ...ctx, guid, art: `seo:${wirkend.map((w) => w.r.id).join("+")}` });
      out.set(guid, { ziel_guid: guid, relationen: wirkend.map((w) => w.r.id), hinweise, ...r });
      continue;
    }
    if (ziel.art === "koerper" && wirkend.length === 1 && wirkend[0].op.art === "koerper") {
      const w = wirkend[0];
      const r = await koerperOperation(ziel.koerper, /** @type {any} */ (w.op).koerper, /** @type {any} */ (w.r.operation), { ...ctx, guid, art: `seo:${w.r.id}` });
      out.set(guid, { ziel_guid: guid, relationen: [w.r.id], hinweise, ...r });
      continue;
    }
    out.set(guid, { ...leer("nicht-unterstuetzt", { code: "seo-nicht-unterstuetzt", analytisch_m3: null }), relationen: wirkend.map((w) => w.r.id), hinweise: [...hinweise, "nicht-unterstuetzt"] });
  }
  return out;
}

/**
 * Section outlines of resolved solids (only those whose comparison passed) along a world section line, in section coordinates
 * {x along the line (world x for a line along x, as the BIM studio's section), h = world height} — the format of BimPlan2D's
 * `schnittFlaechen` (107-09), so the section shows the same edge as the 3D view.
 * @param {Map<string, {geometrie: import("three").BufferGeometry|null, ok: boolean, platzierung: {ursprung: Pkt3, drehung_y: number}}>} ergebnisse key → result
 * @param {{a: PktXZ, b: PktXZ}} linie section line in world x/z (m)
 * @returns {Array<{schluessel: string, schicht: number, quelle: "solid", ringe: Array<Array<{x: number, h: number}>>}>}
 */
export function seoSchnittFlaechen(ergebnisse, linie) {
  const out = [];
  const dx = linie.b.x - linie.a.x, dz = linie.b.z - linie.a.z, l = Math.hypot(dx, dz) || 1;
  for (const [schluessel, e] of ergebnisse) {
    if (!e?.ok || !e.geometrie) continue;
    const pl = e.platzierung;
    const a = weltNachLokal({ x: linie.a.x, y: 0, z: linie.a.z }, pl), b = weltNachLokal({ x: linie.b.x, y: 0, z: linie.b.z }, pl);
    const cut = vertikalschnitt(e.geometrie, { a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } });
    if (cut.offen.length) continue;
    const c = Math.cos(pl.drehung_y), s = Math.sin(pl.drehung_y);
    /** @type {Map<number, Array<Array<{x: number, h: number}>>>} */
    const je = new Map();
    for (const lp of cut.schleifen) {
      const ring = lp.punkte.map((p) => {
        // local → world (rotation about +y by drehung_y, then the origin), then the position along the line
        const wx = p.x * c + p.z * s + pl.ursprung.x, wz = -p.x * s + p.z * c + pl.ursprung.z;
        return { x: linie.a.x + (((wx - linie.a.x) * dx + (wz - linie.a.z) * dz) / l) * (dx / l), h: p.y + pl.ursprung.y };
      });
      if (!je.has(lp.gruppe)) je.set(lp.gruppe, []);
      /** @type {any[]} */ (je.get(lp.gruppe)).push(ring);
    }
    for (const [schicht, ringe] of je) out.push({ schluessel, schicht, quelle: /** @type {"solid"} */ ("solid"), ringe });
  }
  return out;
}

/**
 * Review 107-10 (truth "Schnitt, Plan und Mengen aus diesem Solid"): floor plan outlines of resolved solids (only those whose
 * comparison passed) at a WORLD cut height, per layer, in world plan coordinates {x, z} — the format of planFlaechen of 107-09
 * (solidAbleitung.js), so BimPlan2D and the PDF/DXF plan (vektorPlan) draw the bevelled wall exactly as they draw an intersected one.
 * A solid the plane misses, or a cut with open chains, gives no entry: the caller keeps today's drawing of that wall (never a gap).
 * @param {Map<string, {geometrie: import("three").BufferGeometry|null, ok: boolean, platzierung: {ursprung: Pkt3, drehung_y: number}}>} ergebnisse key → result
 * @param {number} y_welt_m cut height in world coordinates, m (storey elevation + cut height)
 * @returns {Map<string, {quelle: "solid", schichten: Array<{schicht: number, ringe: PktXZ[][]}>}>}
 */
export function seoPlanFlaechen(ergebnisse, y_welt_m) {
  /** @type {Map<string, {quelle: "solid", schichten: Array<{schicht: number, ringe: PktXZ[][]}>}>} */
  const out = new Map();
  for (const [schluessel, e] of ergebnisse) {
    if (!e?.ok || !e.geometrie) continue;
    const pl = e.platzierung;
    const cut = horizontalschnitt(e.geometrie, y_welt_m - pl.ursprung.y);
    if (cut.offen.length || !cut.schleifen.length) continue;
    const c = Math.cos(pl.drehung_y), s = Math.sin(pl.drehung_y);
    /** @type {Map<number, PktXZ[][]>} */
    const je = new Map();
    for (const l of cut.schleifen) {
      // local → world (rotation about +y by drehung_y, then the origin) — the inverse of weltNachLokal
      const ring = l.punkte.map((p) => ({ x: p.x * c + p.z * s + pl.ursprung.x, z: -p.x * s + p.z * c + pl.ursprung.z }));
      if (!je.has(l.gruppe)) je.set(l.gruppe, []);
      /** @type {PktXZ[][]} */ (je.get(l.gruppe)).push(ring);
    }
    out.set(schluessel, { quelle: "solid", schichten: [...je.entries()].sort((p, q) => p[0] - q[0]).map(([schicht, ringe]) => ({ schicht, ringe })) });
  }
  return out;
}
