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

import { wohnungsRegeln, MINDESTBREITEN } from "@designer/lib/tesselierung";
import { tuerGeometrie, erreichbarkeit, kantenVon } from "@designer/lib/wohnungsErschliessung";

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
 * Aspect ratio check (MSB-19). warn from seitenverhaeltnisMax (1 : 1,8), fail from
 * seitenverhaeltnisFail (1 : 2,5). Uses the bbox — L-shaped rooms are judged by their
 * envelope (documented simplification).
 * @param {object} raum zone
 * @param {ReturnType<typeof wohnungsRegeln>} wr
 * @returns {{stufe:"ok"|"warn"|"fail", regel:"seitenverhaeltnis", raum:string, text:string, wert:number}|null} null when the rule is off / not a living room
 */
export function seitenverhaeltnis(raum, wr) {
  if (!wr?.seitenverhaeltnisMax || !istAufenthalt(raum)) return null;
  const bb = bboxVon(raum);
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
  const bb = bboxVon(raum);
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
 * the actual longest free wall. The wardrobe (3,00 × 0,60 m, centred on that wall) plus
 * its movement area must not be hit by a door swing → warn "Türaufschlag".
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
    .sort((a, b) => b.frei - a.frei);
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
  const u0 = (beste.laenge - wr.schrankwand_m) / 2;
  const p0 = { x: beste.a.x + dx * u0, z: beste.a.z + dz * u0 };
  const p1 = { x: p0.x + dx * wr.schrankwand_m, z: p0.z + dz * wr.schrankwand_m };
  const p2 = { x: p1.x + nx * tiefe, z: p1.z + nz * tiefe };
  const p3 = { x: p0.x + nx * tiefe, z: p0.z + nz * tiefe };
  const rect = {
    x0: Math.min(p0.x, p1.x, p2.x, p3.x), x1: Math.max(p0.x, p1.x, p2.x, p3.x),
    z0: Math.min(p0.z, p1.z, p2.z, p3.z), z1: Math.max(p0.z, p1.z, p2.z, p3.z),
  };
  for (const t of Array.isArray(raum.tueren) ? raum.tueren : []) {
    const g = tuerGeometrie(raum, t);
    if (!g) continue;
    const trifft = g.aabb.x0 < rect.x1 - 1e-6 && g.aabb.x1 > rect.x0 + 1e-6 && g.aabb.z0 < rect.z1 - 1e-6 && g.aabb.z1 > rect.z0 + 1e-6;
    if (trifft) {
      return {
        stufe: "warn", regel: "schrankwand", raum: String(raum.name), wert: Math.round(beste.frei * 100) / 100, wand: beste.i, rect,
        text: `Schrankwand ${fmt(beste.frei)} m frei, aber der Türaufschlag trifft Schrank/Bewegungsfläche (${fmt(tiefe)} m davor) — Anschlag wechseln oder Tür versetzen`,
      };
    }
  }
  return {
    stufe: "ok", regel: "schrankwand", raum: String(raum.name), wert: Math.round(beste.frei * 100) / 100, wand: beste.i, rect,
    text: `Schrankwand ${fmt(beste.frei)} m frei (Wand ${beste.i}), ${fmt(tiefe)} m Bewegungsfläche davor`,
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
  return [seitenverhaeltnis(raum, wr), mindestflaeche(raum, wr), mindestbreite(raum, wr), schrankwand(raum, { bbox: ctx?.bbox, stufe: ctx?.stufe }, wr)].filter(Boolean);
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
 * @param {{bbox?: object|null, stufe?: string, regeln?: object}} [ctx]
 * @returns {Array<ReturnType<typeof pruefeWohnung>>} ordered by first appearance of the unit
 */
export function pruefeAlle(zonen, ctx = {}) {
  const wes = [...new Set((Array.isArray(zonen) ? zonen : []).filter((z) => z?.we).map((z) => String(z.we)))];
  return wes.map((we) => pruefeWohnung(zonen, { ...ctx, we }));
}

/** Re-export for callers that want the table without importing tesselierung. */
export { MINDESTBREITEN };
