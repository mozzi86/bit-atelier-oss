// Room-quality checks for the apartment layout (Plan 75-14 Tasks 3+4, MSB-19…21).
// User brief 04.10.2026: "die räume zuu lang wie ein schlauch .. aufenthaltsräume
// dürfen die 10 quadratmeter nicht unterschreiten .. eine seite muss mindestens
// einen 3 meter schrank beherbergen können nicht auf der tür seite und nicht auf
// der fenster seite".
//
// In:  room zones as tesselierung.js emits them in raumzonen mode ({ points (clear
//      metres), name, art, we, flaeche_m2, tueren?, fensterwand? }), the resolved
//      75-14 rule values (tesselierung.wohnungsRegeln) and, per apartment, the
//      reachability result of wohnungsErschliessung.
// Out: pure findings [{ stufe: "ok"|"warn"|"fail", regel, raum, text, wert }] — the
//      workshop list, the focus badge and the unit tests read the same records.
//
// Why warn vs fail (liability): aspect ratio and wardrobe wall are office standards
// (no building-code value, DIN 18011 withdrawn) → warn at the office threshold, fail
// only at the "unusable" threshold 1 : 2,5 (D-P75-14-B); a room without access
// (erschliessung) or a bathroom entered from a living room is a planning error → fail.
// Pure module: no React, no store; imports only the rule constants (allowed direction).

import { wohnungsRegeln, MINDESTBREITEN, TUER_ECKABSTAND_SCHRANK_M } from "@designer/lib/tesselierung";
import { TUER_BREITE_B, TUER_BREITE_R } from "@designer/lib/accessibility";
import { tuerGeometrie, erreichbarkeit, kantenVon, flurEnden, istFlurZone } from "@designer/lib/wohnungsErschliessung";

export { wohnungsRegeln };

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fmt = (v) => (Math.round(num(v) * 100) / 100).toFixed(2).replace(".", ",");

/** Wardrobe depth 0,60 m (Blatt 07 :186, same as moebel.js schrank_*) + movement area
 *  0,90 m standard / 1,20 m B / 1,50 m R (DIN 18040-2) in front of it. */
export const SCHRANK_TIEFE_M = 0.6;
export const SCHRANK_BEWEGUNG_M = { standard: 0.9, B: 1.2, R: 1.5 };
/** Corner allowance per wall end in metres [ASSUMED 0,10 — skirting/reveal]. */
export const ECKE_ABZUG_M = 0.1;

/** Rooms the bedroom rules apply to (name rule, like tesselierung MINDESTBREITEN.schlafen). */
export const istSchlafraum = (zone) => zone?.art === "aufenthalt" && /schlaf|kind/i.test(String(zone?.name || ""));
/** Living rooms in the sense of the 10 m² rule (plan: Wohnen, Schlafen, Kind, Arbeiten). */
export const istAufenthalt = (zone) => zone?.art === "aufenthalt";

/** Axis-parallel bbox of a zone in metres. */
export function bboxVon(zone) {
  const pts = Array.isArray(zone?.points) ? zone.points : [];
  if (pts.length < 3) return null;
  const xs = pts.map((p) => num(p.x)), zs = pts.map((p) => num(p.z));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0 };
}

/**
 * 86-01: width/depth of a zone in its OWN frame (direction of its longest edge), metres — a
 * room of a turned footprint is measured like the same room unturned (the axis-parallel
 * bbox of a turned 3 × 5 m room is ≈ 4,7 × 5,8 m and would fake aspect ratio and widths).
 * Axis-parallel zones return bboxVon unchanged (same numbers and texts as before).
 * @param {object} zone
 * @returns {{w:number, d:number}|null}
 */
export function masseVon(zone) {
  const bb = bboxVon(zone);
  if (!bb) return null;
  const pts = zone.points;
  let best = 0, winkel = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z));
    if (l > best + 1e-9) { best = l; winkel = Math.atan2(num(b.z) - num(a.z), num(b.x) - num(a.x)); }
  }
  if (Math.abs(Math.sin(2 * winkel)) < 1e-6) return bb;
  const c = Math.cos(winkel), s = Math.sin(winkel);
  const xs = pts.map((p) => c * num(p.x) + s * num(p.z)), zs = pts.map((p) => -s * num(p.x) + c * num(p.z));
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
}

/**
 * Aspect ratio check (MSB-19). warn from seitenverhaeltnisMax (1 : 1,8), fail from
 * seitenverhaeltnisFail (1 : 2,5). Uses the bbox — L-shaped rooms are judged by their
 * envelope (documented simplification).
 * @param {object} raum zone
 * @param {ReturnType<typeof wohnungsRegeln>} wr
 * @returns {{stufe:"ok"|"warn"|"fail", regel:"seitenverhaeltnis", raum:string, text:string, wert:number}|null} null when the rule is off / not a living room
 */
export function seitenverhaeltnis(raum, wr) {
  if (!wr?.seitenverhaeltnisMax || !istAufenthalt(raum)) return null;
  const bb = masseVon(raum); // 86-01: own frame (turned footprints)
  if (!bb || bb.w < 0.05 || bb.d < 0.05) return null;
  const v = Math.max(bb.w, bb.d) / Math.min(bb.w, bb.d);
  const stufe = v >= wr.seitenverhaeltnisFail && wr.seitenverhaeltnisFail > 0 ? "fail" : v > wr.seitenverhaeltnisMax + 1e-9 ? "warn" : "ok";
  // Facade length the room would need at the warn threshold with its area — the
  // quantitative fix the user can act on (widen the unit, change the type).
  const flaeche = num(raum.flaeche_m2, bb.w * bb.d);
  const noetigeBreite = Math.sqrt(flaeche / wr.seitenverhaeltnisMax);
  const text = stufe === "ok"
    ? `${fmt(bb.w)} × ${fmt(bb.d)} m (1 : ${fmt(v)})`
    : `${fmt(bb.w)} × ${fmt(bb.d)} m (1 : ${fmt(v)}) — Schlauch, zulässig ≤ 1 : ${fmt(wr.seitenverhaeltnisMax)}; bei ${fmt(flaeche)} m² braucht der Raum ≥ ${fmt(noetigeBreite)} m Fassade`;
  return { stufe, regel: "seitenverhaeltnis", raum: String(raum.name), text, wert: Math.round(v * 100) / 100 };
}

/**
 * Minimum area check (MSB-20, office rule raumMin_m2 = 10 m² [ASSUMED]). fail below —
 * the slicing already downgrades such rooms to storage, so a hit here means a
 * foreign/legacy zone list.
 * @param {object} raum
 * @param {ReturnType<typeof wohnungsRegeln>} wr
 */
export function mindestflaeche(raum, wr) {
  if (!wr?.raumMin_m2 || !istAufenthalt(raum)) return null;
  const bb = bboxVon(raum);
  const f = num(raum.flaeche_m2, bb ? bb.w * bb.d : 0);
  const ok = f >= wr.raumMin_m2 - 1e-6;
  return {
    stufe: ok ? "ok" : "fail", regel: "raumMin", raum: String(raum.name), wert: Math.round(f * 100) / 100,
    text: ok ? `${fmt(f)} m²` : `${fmt(f)} m² < ${fmt(wr.raumMin_m2)} m² Aufenthaltsraum-Minimum [ASSUMED Büro-Vorgabe] — zusammenlegen oder als Abstellraum ausweisen`,
  };
}

/**
 * Minimum width check for bedroom/child room (D-P75-14-A 2,40 m) — the shorter bbox side.
 * @param {object} raum
 * @param {ReturnType<typeof wohnungsRegeln>} wr
 */
export function mindestbreite(raum, wr) {
  if (!wr?.schlafenMinBreite_m || !istSchlafraum(raum)) return null;
  const bb = masseVon(raum); // 86-01: own frame (turned footprints)
  if (!bb) return null;
  const b = Math.min(bb.w, bb.d);
  const ok = b >= wr.schlafenMinBreite_m - 1e-6;
  return {
    stufe: ok ? "ok" : "fail", regel: "mindestbreite", raum: String(raum.name), wert: Math.round(b * 100) / 100,
    text: ok ? `${fmt(b)} m breit` : `${fmt(b)} m breit < ${fmt(wr.schlafenMinBreite_m)} m Mindestbreite Schlafen/Kind (D-P75-14-A) — Bett + Schrank + Gang passen nicht nebeneinander`,
  };
}

/**
 * Window-wall edge indices of a zone: `fensterwand` from the slicing, else every edge
 * lying on the footprint bbox (both endpoints within tol of one bbox side).
 * @param {object} raum
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}|null} [bbox] footprint bbox (metres)
 * @param {number} [tol] metres [ASSUMED 0,05]
 * @returns {Set<number>}
 */
export function fensterKanten(raum, bbox = null, tol = 0.05) {
  const out = new Set();
  if (Number.isInteger(raum?.fensterwand)) out.add(raum.fensterwand);
  if (!bbox) return out;
  for (const k of kantenVon(raum)) {
    const anSeite = (v, s) => Math.abs(v - s) < tol;
    if ((anSeite(k.a.x, bbox.minX) && anSeite(k.b.x, bbox.minX)) || (anSeite(k.a.x, bbox.maxX) && anSeite(k.b.x, bbox.maxX))
      || (anSeite(k.a.z, bbox.minZ) && anSeite(k.b.z, bbox.minZ)) || (anSeite(k.a.z, bbox.maxZ) && anSeite(k.b.z, bbox.maxZ))) out.add(k.i);
  }
  return out;
}

/**
 * Wardrobe wall (MSB-21, Task 4): longest wall that is neither a door wall (tueren[].wand)
 * nor a window wall, minus ECKE_ABZUG_M per end; ≥ schrankwand_m → ok, else warn with
 * the actual longest free wall. The wardrobe (3,00 × 0,60 m on that wall — centred, or
 * since 84-11 slid along the wall in 12,5-cm steps) plus its movement area must not be
 * hit by a door swing at ANY position → warn "Türaufschlag".
 * Non-rectangular rooms are judged on their edges as well (no bbox needed).
 * @param {object} raum zone with tueren/fensterwand
 * @param {{bbox?: object|null, stufe?: string}|null} ctx footprint bbox + movement level
 * @param {ReturnType<typeof wohnungsRegeln>} wr resolved rules
 * @returns {{stufe:"ok"|"warn", regel:"schrankwand", raum:string, text:string, wert:number, wand?:number, rect?:{x0:number,z0:number,x1:number,z1:number}}|null}
 */
export function schrankwand(raum, ctx, wr) {
  if (!wr?.schrankwand_m || !istSchlafraum(raum)) return null;
  const tuerWaende = new Set((Array.isArray(raum.tueren) ? raum.tueren : []).map((t) => num(t?.wand, -1)));
  const fenster = fensterKanten(raum, ctx?.bbox || null);
  const kandidaten = kantenVon(raum)
    .filter((k) => !tuerWaende.has(k.i) && !fenster.has(k.i))
    .map((k) => ({ ...k, frei: k.laenge - 2 * ECKE_ABZUG_M }))
    // 86-01: equal walls (within 1 µm) keep edge order — a turned room must not pick the
    // opposite wall because of floating-point noise.
    .sort((a, b) => (Math.abs(b.frei - a.frei) > 1e-6 ? b.frei - a.frei : a.i - b.i));
  const beste = kandidaten[0];
  const laengste = kantenVon(raum).map((k) => k.laenge - 2 * ECKE_ABZUG_M).sort((a, b) => b - a)[0] || 0;
  if (!beste || beste.frei < wr.schrankwand_m - 1e-6) {
    const frei = beste ? beste.frei : 0;
    return {
      stufe: "warn", regel: "schrankwand", raum: String(raum.name), wert: Math.round(frei * 100) / 100,
      text: beste
        ? `längste freie Wand ${fmt(frei)} m < ${fmt(wr.schrankwand_m)} m Schrankwand (ohne Tür- und Fensterwand; längste Wand überhaupt ${fmt(laengste)} m)`
        : `keine freie Wand — jede Wand trägt Tür oder Fenster (längste ${fmt(laengste)} m)`,
    };
  }
  // Wardrobe rect centred on the free wall, depth into the room (inward normal) +
  // movement area; checked against every door swing of the room (axis-parallel bbox
  // of the swing — conservative).
  const tiefe = SCHRANK_TIEFE_M + (SCHRANK_BEWEGUNG_M[ctx?.stufe] || SCHRANK_BEWEGUNG_M.standard);
  const dx = (beste.b.x - beste.a.x) / beste.laenge, dz = (beste.b.z - beste.a.z) / beste.laenge;
  // Inward normal via the room centroid (works for every ring orientation).
  const pts = raum.points;
  const cx = pts.reduce((s, p) => s + num(p.x), 0) / pts.length, cz = pts.reduce((s, p) => s + num(p.z), 0) / pts.length;
  let nx = -dz, nz = dx;
  if ((cx - beste.a.x) * nx + (cz - beste.a.z) * nz < 0) { nx = -nx; nz = -nz; }
  // 86-01: a wall that is not axis-parallel (turned footprint) is tested in the wall's own
  // frame (u along the wall, v along the normal) — world AABBs of a turned wardrobe and a
  // turned door swing are inflated and fake a collision. Axis-parallel walls: as before.
  const gedreht = Math.abs(dx) > 1e-9 && Math.abs(dz) > 1e-9;
  const lok = (p) => ({ x: p.x * dx + p.z * dz, z: -p.x * dz + p.z * dx });
  const huelle = (liste) => ({
    x0: Math.min(...liste.map((p) => p.x)), x1: Math.max(...liste.map((p) => p.x)),
    z0: Math.min(...liste.map((p) => p.z)), z1: Math.max(...liste.map((p) => p.z)),
  });
  /** Wardrobe rect (world AABB + test AABB) for an offset u0 along the free wall, m. */
  const rectBei = (u0) => {
    const p0 = { x: beste.a.x + dx * u0, z: beste.a.z + dz * u0 };
    const p1 = { x: p0.x + dx * wr.schrankwand_m, z: p0.z + dz * wr.schrankwand_m };
    const p2 = { x: p1.x + nx * tiefe, z: p1.z + nz * tiefe };
    const p3 = { x: p0.x + nx * tiefe, z: p0.z + nz * tiefe };
    const rect = {
      x0: Math.min(p0.x, p1.x, p2.x, p3.x), x1: Math.max(p0.x, p1.x, p2.x, p3.x),
      z0: Math.min(p0.z, p1.z, p2.z, p3.z), z1: Math.max(p0.z, p1.z, p2.z, p3.z),
    };
    return { rect, pruefRect: gedreht ? huelle([p0, p1, p2, p3].map(lok)) : rect };
  };
  const schwenke = (Array.isArray(raum.tueren) ? raum.tueren : [])
    .map((t) => tuerGeometrie(raum, t))
    .filter(Boolean)
    .map((g) => (gedreht ? huelle([g.scharnier, g.geschlossen, g.offen].map(lok)) : g.aabb));
  const trifft = (pr) => schwenke.some((ab) => ab.x0 < pr.x1 - 1e-6 && ab.x1 > pr.x0 + 1e-6 && ab.z0 < pr.z1 - 1e-6 && ab.z1 > pr.z0 + 1e-6);
  // 84-11: the wardrobe may SLIDE along the free wall (12,5-cm raster) to get out of a door
  // swing — centred first (unchanged result wherever the centred position passed), then
  // alternating towards both wall ends within the corner allowance. Only when no position
  // is free of every swing the warning stays. Before, only the centred position was tested,
  // which flagged every narrow bedroom once the door moved 0,875 m from the corner.
  const mitte = (beste.laenge - wr.schrankwand_m) / 2;
  const uMin = ECKE_ABZUG_M, uMax = beste.laenge - ECKE_ABZUG_M - wr.schrankwand_m;
  const lagen = [mitte];
  for (let k = 1; mitte - k * 0.125 >= uMin - 1e-9 || mitte + k * 0.125 <= uMax + 1e-9; k += 1) {
    if (mitte - k * 0.125 >= uMin - 1e-9) lagen.push(mitte - k * 0.125);
    if (mitte + k * 0.125 <= uMax + 1e-9) lagen.push(mitte + k * 0.125);
  }
  for (const u0 of lagen) {
    const { rect, pruefRect } = rectBei(u0);
    if (trifft(pruefRect)) continue;
    return {
      stufe: "ok", regel: "schrankwand", raum: String(raum.name), wert: Math.round(beste.frei * 100) / 100, wand: beste.i, rect,
      text: `Schrankwand ${fmt(beste.frei)} m frei (Wand ${beste.i}), ${fmt(tiefe)} m Bewegungsfläche davor`,
    };
  }
  return {
    stufe: "warn", regel: "schrankwand", raum: String(raum.name), wert: Math.round(beste.frei * 100) / 100, wand: beste.i, rect: rectBei(mitte).rect,
    text: `Schrankwand ${fmt(beste.frei)} m frei, aber der Türaufschlag trifft Schrank/Bewegungsfläche (${fmt(tiefe)} m davor) an jeder Stelle der Wand — Anschlag wechseln oder Tür versetzen`,
  };
}

/**
 * Minimum wall piece corner → hinge for a wardrobe behind the opened leaf, m [ASSUMED
 * 0,60 — a wardrobe at least as wide as it is deep (SCHRANK_TIEFE_M); target is
 * TUER_ECKABSTAND_SCHRANK_M 0,875 m, the solver's own value since 84-11].
 */
export const SCHRANK_HINTER_TUER_MIN_M = SCHRANK_TIEFE_M;

/**
 * 84-11 (NF-66a, user 10.10.2026: "die Tür muss 90 cm weg von der Ecke"): wardrobe behind
 * the door leaf. For every door that swings INTO a living room the wall piece between the
 * hinge and the room corner on the hinge side ("links" = edge start, "rechts" = edge end)
 * is measured; the shortest one is reported. WARN, not fail: office standard (Neufert
 * NF-66/NF-73), no building-code value. Bath/store doors swing out (84-08) → skipped.
 * @param {object} raum zone with tueren
 * @param {ReturnType<typeof wohnungsRegeln>} wr resolved rules (only with `diele` — doors exist then)
 * @returns {{stufe:"ok"|"warn", regel:"schrank_hinter_tuer", raum:string, text:string, wert:number, wand:number}|null}
 */
export function schrankHinterTuer(raum, wr) {
  if (!wr?.diele || !istAufenthalt(raum)) return null;
  const tueren = (Array.isArray(raum.tueren) ? raum.tueren : []).filter((t) => t && !t.nachAussen);
  if (!tueren.length) return null;
  const kanten = kantenVon(raum);
  let kuerzeste = null;
  for (const t of tueren) {
    const k = kanten.find((e) => e.i === num(t.wand, -1));
    if (!k) continue;
    const b = Math.max(0, num(t.breite_m));
    const u0 = Math.max(0, Math.min(k.laenge - b, num(t.u_m)));
    const frei = t.aufschlag === "rechts" ? k.laenge - (u0 + b) : u0;
    // Wall piece on the OTHER side of the door — what a swapped hinge would get.
    const andere = k.laenge - b - frei;
    if (!kuerzeste || frei < kuerzeste.frei) kuerzeste = { frei, andere, wand: k.i };
  }
  if (!kuerzeste) return null;
  const wert = Math.round(kuerzeste.frei * 1000) / 1000;
  if (kuerzeste.frei < SCHRANK_HINTER_TUER_MIN_M - 1e-6) {
    const rat = kuerzeste.andere >= SCHRANK_HINTER_TUER_MIN_M - 1e-6
      ? `Anschlag wechseln (dann ${fmt(kuerzeste.andere)} m) oder Tür versetzen`
      : "Tür versetzen (die Wand ist auf beiden Seiten zu kurz)";
    return {
      stufe: "warn", regel: "schrank_hinter_tuer", raum: String(raum.name), wert, wand: kuerzeste.wand,
      text: `Türband ${fmt(kuerzeste.frei)} m von der Raumecke — kein Schrank hinter dem Türflügel (mind. ${fmt(SCHRANK_HINTER_TUER_MIN_M)} m, Ziel ${fmt(TUER_ECKABSTAND_SCHRANK_M)} m im Mauerwerksraster, NF-66a) — ${rat}`,
    };
  }
  return {
    stufe: "ok", regel: "schrank_hinter_tuer", raum: String(raum.name), wert, wand: kuerzeste.wand,
    text: `Schrank hinter dem Türflügel: ${fmt(kuerzeste.frei)} m Wand bis zur Ecke (Ziel ${fmt(TUER_ECKABSTAND_SCHRANK_M)} m)`,
  };
}

/**
 * All checks of ONE room.
 * @param {object} raum
 * @param {{bbox?: object|null, stufe?: string, regeln?: object}} [ctx] regeln = raw Regeln (resolved here)
 * @returns {Array<{stufe:string, regel:string, raum:string, text:string, wert:number}>}
 */
export function pruefe(raum, ctx = {}) {
  const wr = wohnungsRegeln(ctx?.regeln);
  return [seitenverhaeltnis(raum, wr), mindestflaeche(raum, wr), mindestbreite(raum, wr), schrankwand(raum, { bbox: ctx?.bbox, stufe: ctx?.stufe }, wr), schrankHinterTuer(raum, wr), badBewegung(raum, ctx?.stufe)].filter(Boolean);
}

/**
 * 84-08 bath movement area (DIN 18040-2 5.5.2, Tab. 4 via ByAK Leitfaden 2 S. 100–101,
 * REGELN-BARRIEREFREI.md BF-57/BF-60): 1,20 × 1,20 m in front of WC / washbasin
 * ("barrierefrei nutzbar"), 1,50 × 1,50 m for "R". Fixtures need a zone along one
 * wall — [ASSUMED 0,55 m, WC/washbasin depth] — so the room must be at least
 * 1,20 × (1,20 + 0,55) m (R: 1,50 × 2,05 m). Only the outer rectangle is checked
 * (no fixture layout yet).
 */
export const BAD_BEWEGUNG = { flaeche_m: 1.2, flaecheR_m: 1.5, objektTiefe_m: 0.55 };

/** 84-10: clear door width = raw width − 0,025 m (DIN-18100 reveal/rebate deduction: 885 → 860, as moebel.js). */
export const TUER_LICHTE_ABZUG_M = 0.025;

/**
 * @param {object} raum zone (art "sanitaer")
 * @param {string} [stufe] 84-10 level of the unit: "R" demands the 1,50 × 1,50 m movement
 *   area (a bath that only reaches 1,20 × 1,20 m is then reported); "B"/"standard"/undefined
 *   keep the 84-08 rule unchanged
 * @returns {{stufe:string, regel:string, raum:string, text:string, wert:number}|null}
 *   WARN (not fail) on purpose: whether a unit must be barrier-free depends on the
 *   BayBO quota (Art. 48) — a liability decision for the planner, not a form error.
 */
export function badBewegung(raum, stufe) {
  if (!raum || raum.art !== "sanitaer" || !Array.isArray(raum.points) || raum.points.length < 3) return null;
  const m = masseVon(raum); // 86-01: own frame (turned footprints)
  const a = m.w, b = m.d;
  const kurz = Math.min(a, b), lang = Math.max(a, b);
  const B = BAD_BEWEGUNG;
  const fmt = (v) => v.toFixed(2).replace(".", ",");
  const nutzbar = kurz >= B.flaeche_m - 1e-9 && lang >= B.flaeche_m + B.objektTiefe_m - 1e-9;
  const r = kurz >= B.flaecheR_m - 1e-9 && lang >= B.flaecheR_m + B.objektTiefe_m - 1e-9;
  const name = String(raum.name);
  if (stufe === "R") {
    // 84-10 (BF-57/60, DIN 18040-2 5.5.2): R = 1,50 × 1,50 m in front of WC / washbasin.
    return r
      ? { stufe: "ok", regel: "bad_bewegung", raum: name, wert: Math.round(kurz * 100) / 100, text: "Bewegungsfläche 1,50 × 1,50 m möglich (R)" }
      : { stufe: "warn", regel: "bad_bewegung", raum: name, wert: Math.round(kurz * 100) / 100,
        text: `${fmt(a)} × ${fmt(b)} m — für R keine Bewegungsfläche 1,50 × 1,50 m vor WC/Waschtisch (DIN 18040-2, braucht ≥ ${fmt(B.flaecheR_m)} × ${fmt(B.flaecheR_m + B.objektTiefe_m)} m)` };
  }
  if (!nutzbar) {
    return { stufe: "warn", regel: "bad_bewegung", raum: name, wert: Math.round(kurz * 100) / 100,
      text: `${fmt(a)} × ${fmt(b)} m — keine Bewegungsfläche 1,20 × 1,20 m vor WC/Waschtisch (DIN 18040-2, braucht ≥ 1,20 × 1,75 m)` };
  }
  return { stufe: "ok", regel: "bad_bewegung", raum: name, wert: Math.round(kurz * 100) / 100,
    text: r ? "Bewegungsfläche 1,50 × 1,50 m möglich (auch R)" : "Bewegungsfläche 1,20 × 1,20 m möglich (barrierefrei nutzbar, nicht R)" };
}

/**
 * Checks of ONE apartment: access graph (fail per unreachable room + at the unit,
 * bath from living room) and the room checks. Rooms of other units are ignored.
 * @param {Array<object>} zonen zones (storey list or unit list)
 * @param {{we?: string, bbox?: object|null, stufe?: string, regeln?: object}} [ctx]
 * @returns {{ we: string, eintraege: Array<{stufe:string, regel:string, raum:string, text:string, wert?:number}>,
 *   zaehler: {ok:number, warn:number, fail:number}, erschliessung: ReturnType<typeof erreichbarkeit> }}
 */
export function pruefeWohnung(zonen, ctx = {}) {
  const we = ctx?.we;
  // 75-13: balcony zones are not rooms (no area/ratio/wardrobe rule applies).
  const liste = (Array.isArray(zonen) ? zonen : []).filter((z) => z && z.raumart !== "balkon" && (we === undefined || String(z.we ?? "") === String(we)));
  const wr = wohnungsRegeln(ctx?.regeln);
  const eintraege = [];
  const ersch = erreichbarkeit(liste, { we });
  if (wr.diele) {
    for (const f of ersch.fehler) eintraege.push({ stufe: "fail", regel: f.regel, raum: f.raum, text: f.text });
    if (ersch.unerreichbar.length) {
      eintraege.push({ stufe: "fail", regel: "erschliessung", raum: "WE", text: `${ersch.unerreichbar.length} Raum/Räume ohne Zugang von Diele/Flur`, wert: ersch.unerreichbar.length });
    } else if (!ersch.fehler.length && liste.length) {
      eintraege.push({ stufe: "ok", regel: "erschliessung", raum: "WE", text: ersch.diele ? "Diele vorhanden, jeder Raum von Diele/Flur erschlossen" : "jeder Raum von Flur erschlossen (keine Diele benannt)", wert: 0 });
    }
    if (!ersch.diele && liste.length && !ersch.fehler.some((f) => f.regel === "diele")) {
      eintraege.push({ stufe: "fail", regel: "diele", raum: "WE", text: "keine Diele hinter der Wohnungstür" });
    }
    // 84-05: every unit has its entrance door. Exception: a list holding only upper
    // floors of a house (stair present, no ground floor) — the door is downstairs.
    // FAIL, not warn: a unit without a door cannot be entered (no planning choice).
    const hatEingang = liste.some((z) => Array.isArray(z.tueren) && z.tueren.some((t) => t.nach === null || t.nach === undefined));
    const nurObergeschoss = liste.length > 0 && liste.every((z) => Number(z.level) > 0) && liste.some((z) => z.art === "treppe");
    if (liste.length && !hatEingang && !nurObergeschoss) {
      eintraege.push({ stufe: "fail", regel: "wohnungstuer", raum: "WE", text: "keine Wohnungstür — die Wohnung ist von Flur/Treppenraum/Gang nicht zu betreten" });
    } else if (hatEingang) {
      eintraege.push({ stufe: "ok", regel: "wohnungstuer", raum: "WE", text: "Wohnungstür vorhanden" });
    }
    // 84-10 (BF-34/35, DIN 18040-2 via L2 S. 84–85): clear door width ≥ 0,80 m (B) / ≥ 0,90 m
    // (R); clear = raw − 0,025 m (DIN-18100 reveal/rebate deduction, as moebel.js). WARN, not
    // fail: R/B is a planner's decision (BayBO quota), like bad_bewegung. Only when the unit
    // has a level (ctx.stufe B/R) — the default gets no new entries.
    const minLicht = ctx?.stufe === "R" ? TUER_BREITE_R : ctx?.stufe === "B" ? TUER_BREITE_B : 0;
    if (minLicht > 0) {
      const f2 = (v) => v.toFixed(3).replace(/0$/, "").replace(".", ",");
      const zuSchmal = liste.flatMap((z) => (Array.isArray(z.tueren) ? z.tueren : [])
        .filter((t) => Number(t.breite_m) - TUER_LICHTE_ABZUG_M < minLicht - 1e-9)
        .map((t) => ({ raum: String(z.name), roh: Number(t.breite_m) })));
      for (const t of zuSchmal) {
        eintraege.push({ stufe: "warn", regel: "tuer_breite", raum: t.raum, wert: t.roh,
          text: `Tür ${f2(t.roh)} m roh (lichte ${f2(t.roh - TUER_LICHTE_ABZUG_M)} m) < ${f2(minLicht)} m lichte Breite für ${ctx.stufe} (DIN 18040-2)` });
      }
      if (liste.some((z) => Array.isArray(z.tueren) && z.tueren.length) && !zuSchmal.length) {
        eintraege.push({ stufe: "ok", regel: "tuer_breite", raum: "WE", text: `alle Türen lichte ≥ ${f2(minLicht)} m (${ctx.stufe})` });
      }
    }
    // 84-05 (D-P75-14-C, Nutzer: „der flur … zu allen zimmern führt“): a living room
    // whose doors all lead into another ROOM (not hall/corridor) is a walk-through
    // room — FAIL, the layout rule excludes it.
    const flurNamen = new Set(liste.filter(istFlurZone).map((z) => String(z.name)));
    for (const z of liste) {
      if (z.art !== "aufenthalt" || !Array.isArray(z.tueren) || !z.tueren.length) continue;
      const innen = z.tueren.filter((t) => t.nach !== null && t.nach !== undefined);
      if (innen.length && !innen.some((t) => flurNamen.has(String(t.nach)))) {
        eintraege.push({ stufe: "fail", regel: "durchgangszimmer", raum: String(z.name), text: `„${z.name}“ nur über „${innen[0].nach}“ erreichbar — Tür zur Diele/zum Flur legen` });
      }
    }
    // 84-06 (Nutzerregel 07.10.2026): a corridor never ends on a partition.
    const enden = flurEnden(liste, { we });
    const blind = enden.filter((e) => !e.ok);
    for (const e of blind) eintraege.push({ stufe: "fail", regel: "flurende", raum: e.zone, text: `„${e.zone}“ endet an einer Trennwand — Ende auf Zimmertür, Abstellraum oder Bad legen` });
    if (enden.length && !blind.length) eintraege.push({ stufe: "ok", regel: "flurende", raum: "WE", text: "jedes Flurende trifft auf eine Tür oder den Eingang" });
  }
  for (const z of liste) {
    if (z.art === "flur" || z.raumart === "flur") continue;
    eintraege.push(...pruefe(z, { bbox: ctx?.bbox, stufe: ctx?.stufe, regeln: ctx?.regeln }));
  }
  const zaehler = { ok: 0, warn: 0, fail: 0 };
  for (const e of eintraege) zaehler[e.stufe] = (zaehler[e.stufe] || 0) + 1;
  return { we: String(we ?? liste[0]?.we ?? ""), eintraege, zaehler, erschliessung: ersch };
}

/**
 * Checks per apartment over a storey zone list.
 * @param {Array<object>} zonen
 * @param {{bbox?: object|null, stufe?: string, regeln?: object, stufeJeWe?: Record<string, string>}} [ctx]
 *   84-10: stufeJeWe = level per unit id ({ "WE 0-3": "R" }); it beats ctx.stufe for that unit
 * @returns {Array<ReturnType<typeof pruefeWohnung>>} ordered by first appearance of the unit
 */
export function pruefeAlle(zonen, ctx = {}) {
  const wes = [...new Set((Array.isArray(zonen) ? zonen : []).filter((z) => z?.we).map((z) => String(z.we)))];
  // 84-10: ctx.stufeJeWe = { "<we>": "standard"|"B"|"R" } — the level of each unit (switch > mix),
  // so the bath/door rules of an R unit are measured against R. Without it ctx.stufe applies to all.
  return wes.map((we) => pruefeWohnung(zonen, { ...ctx, we, stufe: ctx?.stufeJeWe?.[we] ?? ctx?.stufe }));
}

/** Re-export for callers that want the table without importing tesselierung. */
export { MINDESTBREITEN };
