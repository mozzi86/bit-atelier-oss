// Residential bar along a drawn path (phase 98-09, user video 17.10.2026: draw a path, get a
// double-loaded bar with a coloured unit mix, stacked into storeys — the way TestFit / Archistar
// present a feasibility study). Pure geometry + counting, no DOM.
//
// Layout per straight path segment: corridor in the middle (flur m wide), units on both sides
// (tiefe m deep, "mittelflur") or on one side ("einhueftig"). Inner path corners get one corner
// unit per outer side; segments are trimmed there so units never overlap. Units are cut from the
// segment length with the widths of the mix; which type comes next is the type with the largest
// shortfall against its target share (so a 40/30/20/10 mix stays close to it along any length).
//
// [ASSUMED] defaults for German residential bars: unit depth 7.0 m, corridor 1.6 m (barrier-free
// ≥ 1.50 m, DIN 18040-2), widths 1-Zi 4.5 m, 2-Zi 6.0 m, 3-Zi 7.5 m, 4-Zi 9.0 m; remainder
// < 3 m is added to the previous unit.
//
// In: path (site metres), parameters. Out: { flur: polygons, einheiten: [{profil, typ, seite}],
//     kennzahlen }.

/** Unit types with default width (m) and colour (hex, plan + 3D). */
export const WOHNUNGSTYPEN = Object.freeze({
  "1-Zi": { breite: 4.5, farbe: "#22d3ee" },
  "2-Zi": { breite: 6.0, farbe: "#facc15" },
  "3-Zi": { breite: 7.5, farbe: "#ec4899" },
  "4-Zi": { breite: 9.0, farbe: "#6366f1" },
  "Ecke": { breite: 0, farbe: "#a855f7" },
});

/** Mix presets (target shares per type). */
export const MIX_VORLAGEN = Object.freeze({
  ausgewogen: { "1-Zi": 0.2, "2-Zi": 0.35, "3-Zi": 0.3, "4-Zi": 0.15 },
  klein: { "1-Zi": 0.45, "2-Zi": 0.4, "3-Zi": 0.15, "4-Zi": 0 },
  familie: { "1-Zi": 0.05, "2-Zi": 0.25, "3-Zi": 0.4, "4-Zi": 0.3 },
});

export const RIEGEL_STANDARD = Object.freeze({ tiefe: 7, flur: 1.6, geschosse: 5, geschossHoehe: 3, art: "mittelflur", mix: "ausgewogen" });

const r3 = (v) => Math.round(v * 1000) / 1000;
const add = (p, v, s = 1) => ({ x: r3(p.x + v.x * s), y: r3(p.y + v.y * s) });

/** Area of a polygon (m²). */
export function flaeche(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return Math.abs(a) / 2;
}

/**
 * Next type: the largest shortfall against the target share; ties → the narrower type.
 * @param {Record<string, number>} ziel shares
 * @param {Record<string, number>} zaehler counts so far
 */
function naechsterTyp(ziel, zaehler) {
  const summe = Object.values(zaehler).reduce((a, b) => a + b, 0) + 1;
  let best = null, bestDef = -Infinity;
  for (const [typ, anteil] of Object.entries(ziel)) {
    if (!(anteil > 0)) continue;
    const def = anteil * summe - (zaehler[typ] || 0);
    if (def > bestDef + 1e-9) { best = typ; bestDef = def; }
  }
  return best || "2-Zi";
}

/**
 * The bar along a path.
 * @param {Array<{x: number, y: number}>} pfad ≥ 2 points, site metres
 * @param {{tiefe?: number, flur?: number, geschosse?: number, geschossHoehe?: number, art?: 'mittelflur'|'einhueftig', mix?: string|Record<string, number>}} [opt]
 * @returns {{flur: Array<Array<{x:number,y:number}>>, einheiten: Array<{profil: Array<{x:number,y:number}>, typ: string, seite: number}>, kennzahlen: {jeTyp: Record<string, number>, wohnungen: number, wohnflaecheGeschoss: number, bgf: number, geschosse: number}}}
 */
export function riegelLayout(pfad, opt = {}) {
  const o = { ...RIEGEL_STANDARD, ...opt };
  if (!Array.isArray(pfad) || pfad.length < 2) throw new Error("Pfad braucht mindestens 2 Punkte");
  if (!(o.tiefe > 0 && o.flur >= 0)) throw new Error("Tiefe muss > 0 sein");
  const ziel = typeof o.mix === "string" ? MIX_VORLAGEN[o.mix] || MIX_VORLAGEN.ausgewogen : o.mix;
  const seiten = o.art === "einhueftig" ? [1] : [1, -1];
  const halb = o.flur / 2, aussen = halb + o.tiefe;
  /** @type {Array<{profil: any[], typ: string, seite: number}>} */
  const einheiten = [];
  const flur = [];
  /** @type {Record<string, number>} */
  const zaehler = {};
  const n = pfad.length;
  for (let i = 0; i < n - 1; i++) {
    const a = pfad[i], b = pfad[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, nrm = { x: -d.y, y: d.x };
    // Trim at inner joints: the corner square (aussen × aussen) belongs to the joint.
    const anfang = i > 0 ? aussen : 0, ende = i < n - 2 ? aussen : 0;
    const nutz = len - anfang - ende;
    if (nutz > 0.01 && o.flur > 0) {
      const p0 = add(a, d, anfang), p1 = add(a, d, len - ende);
      flur.push([add(p0, nrm, halb), add(p1, nrm, halb), add(p1, nrm, -halb), add(p0, nrm, -halb)]);
    }
    for (const s of seiten) {
      let t = anfang;
      while (nutz - (t - anfang) > 0.01) {
        const typ = naechsterTyp(ziel, zaehler);
        let w = WOHNUNGSTYPEN[typ].breite;
        const rest = len - ende - t;
        if (rest - w < 3) w = rest; // remainder < 3 m joins this unit [ASSUMED]
        const q0 = add(a, d, t), q1 = add(a, d, t + w);
        einheiten.push({ typ, seite: s, profil: [add(q0, nrm, s * halb), add(q1, nrm, s * halb), add(q1, nrm, s * aussen), add(q0, nrm, s * aussen)] });
        zaehler[typ] = (zaehler[typ] || 0) + 1;
        t += w;
      }
    }
    // Corridor through the joint: this segment's corridor runs on to the far edge of the next
    // corridor (+halb), the next segment's corridor starts at −halb — the corner square is walkable.
    if (i < n - 2 && o.flur > 0) {
      const c = pfad[i + 1];
      const q0 = add(c, d, -aussen), q1 = add(c, d, halb);
      flur.push([add(q0, nrm, halb), add(q1, nrm, halb), add(q1, nrm, -halb), add(q0, nrm, -halb)]);
    }
    if (i > 0 && o.flur > 0) {
      const q0 = add(a, d, -halb), q1 = add(a, d, aussen);
      flur.push([add(q0, nrm, halb), add(q1, nrm, halb), add(q1, nrm, -halb), add(q0, nrm, -halb)]);
    }
    // Corner unit at the joint after this segment (on every side the bar has).
    if (i < n - 2) {
      const c = pfad[i + 1];
      for (const s of seiten) {
        const e = { x: c.x, y: c.y };
        einheiten.push({ typ: "Ecke", seite: s, profil: [add(add(e, d, -aussen), nrm, s * halb), add(add(e, d, 0), nrm, s * halb), add(add(e, d, 0), nrm, s * aussen), add(add(e, d, -aussen), nrm, s * aussen)] });
        zaehler.Ecke = (zaehler.Ecke || 0) + 1;
      }
    }
  }
  const wohnflaecheGeschoss = einheiten.reduce((s, e) => s + flaeche(e.profil), 0);
  const flurFl = flur.reduce((s, f) => s + flaeche(f), 0);
  const jeTyp = Object.fromEntries(Object.entries(zaehler).map(([k, v]) => [k, v * o.geschosse]));
  return {
    flur, einheiten,
    kennzahlen: { jeTyp, wohnungen: einheiten.length * o.geschosse, wohnflaecheGeschoss: r3(wohnflaecheGeschoss), bgf: r3((wohnflaecheGeschoss + flurFl) * o.geschosse), geschosse: o.geschosse },
  };
}
