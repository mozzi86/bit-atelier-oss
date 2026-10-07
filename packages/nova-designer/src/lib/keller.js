// Basement compartment planning (Phase 61-06, TESS-09) — the one basement
// storey on level -1, generated from the SAME tessellation as the storeys:
// one compartment per unit (weListe from tesseliere), corridors, the mandatory
// rooms Technik/Fahrrad/Wasch. Pure functions, deterministic, node-testable;
// the only import is the 1D flex solver verteileBand (reuse, no second solver).
//
// In:  footprintM (centred metres, bbox approximation as in tesselierung.js),
//      weListe from tesseliere, optionen (guide values, all overridable).
// Out: zones for the shared store (level -1, " ·WT" marker), the assignment
//      list compartment <-> unit, the AVA hand-over quantity list, checks.
//
// Concept character as tesselierung.js: rule layout, not a checked permit set.
// Guide values are [ASSUMED] and commented per constant — minimum sizes of
// storage rooms differ per LBO/funding programme, hence user-overridable.
//
// Level contract (D-P61-09): every zone carries level: -1. createBuildingModel
// knows no basement storeys — the plan renders level 0 as hull orientation and
// the overlay draws the level -1 zones itself; the 3D extrusion computes
// elev = level * storeyHeight, i.e. below ±0. Phase 62 (Tiefgarage) continues
// in the SAME basement: this module is the one storey -1.
//
// AVA hand-over (D-P61-10): kellerMengen returns the quantity list (pieces, m²,
// lfm). The deep integration into nova-ausschreibung (LV positions from basement
// zones) is NOT part of this phase — computeBimQuantities reads no zones and
// @designer must not write into @ava. Documented follow-up task.

import { verteileBand, WT_MARKER } from "@designer/lib/tesselierung";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r2 = (v) => Math.round(v * 100) / 100;

// --- Guide values ([ASSUMED], overridable via optionen) --------------------------
/** Compartment minimum area, m². [ASSUMED] Common guide value for storage rooms per unit (DIN 18011 old / funding rules name 4–6 m²), not uniform nationwide. */
export const KELLER_ABTEIL_MIN_M2 = 4;
/** Compartment target area, m². [ASSUMED] */
export const KELLER_ABTEIL_ZIEL_M2 = 6;
/** Compartment maximum area, m². [ASSUMED] */
export const KELLER_ABTEIL_MAX_M2 = 10;
/** Compartment depth cap, m. [ASSUMED] Usual compartment depth 2.5–3.5 m; deeper footprints get several corridor rows instead of sliver compartments. */
export const KELLER_ABTEIL_TIEFE_MAX = 3.0;
/** Corridor width, m. [ASSUMED] Basement corridor guide value (furniture transport, no escape-route claim). */
export const KELLER_GANG_B = 1.1;
/** Technikraum per MFH, m². [ASSUMED] ~10–15 m², default 12. */
export const KELLER_TECHNIK_M2 = 12;
/** Fahrradraum per unit, m². [ASSUMED] Parking-space bylaw guide: 1 bike per unit plus manoeuvring area. */
export const KELLER_FAHRRAD_JE_WE_M2 = 1.5;
/** Waschraum, m² (optional, off by default). [ASSUMED] */
export const KELLER_WASCH_M2 = 8;
// Minimum depth of the mandatory-room strip across the corridor axis, m (usability). [ASSUMED]
const PFLICHT_MIN_TIEFE = 2.0;

/** Default options of the basement layout (persisted in werkstatt_layer.keller.optionen). */
export const KELLER_DEFAULT_OPTIONEN = Object.freeze({
  abteilMin_m2: KELLER_ABTEIL_MIN_M2,
  abteilZiel_m2: KELLER_ABTEIL_ZIEL_M2,
  abteilMax_m2: KELLER_ABTEIL_MAX_M2,
  abteilTiefeMax_m: KELLER_ABTEIL_TIEFE_MAX,
  gang_b: KELLER_GANG_B,
  technik: true,
  technik_m2: KELLER_TECHNIK_M2,
  fahrrad: true,
  fahrradJeWe_m2: KELLER_FAHRRAD_JE_WE_M2,
  wasch: false,
  wasch_m2: KELLER_WASCH_M2,
});

/**
 * Harden options: default missing fields, num()-safe numbers, min ≤ ziel ≤ max.
 * @param {object|null|undefined} optionen partial options (m², m, booleans)
 * @returns {{abteilMin_m2:number, abteilZiel_m2:number, abteilMax_m2:number, abteilTiefeMax_m:number, gang_b:number, technik:boolean, technik_m2:number, fahrrad:boolean, fahrradJeWe_m2:number, wasch:boolean, wasch_m2:number}}
 */
export function kellerOptionen(optionen) {
  const o = { ...KELLER_DEFAULT_OPTIONEN, ...(optionen || {}) };
  const min = Math.max(1, num(o.abteilMin_m2, KELLER_ABTEIL_MIN_M2));
  const max = Math.max(min, num(o.abteilMax_m2, KELLER_ABTEIL_MAX_M2));
  const ziel = Math.min(max, Math.max(min, num(o.abteilZiel_m2, KELLER_ABTEIL_ZIEL_M2)));
  return {
    abteilMin_m2: min, abteilZiel_m2: ziel, abteilMax_m2: max,
    abteilTiefeMax_m: Math.max(1.5, num(o.abteilTiefeMax_m, KELLER_ABTEIL_TIEFE_MAX)),
    gang_b: Math.max(0.8, num(o.gang_b, KELLER_GANG_B)),
    technik: !!o.technik, technik_m2: Math.max(0, num(o.technik_m2, KELLER_TECHNIK_M2)),
    fahrrad: !!o.fahrrad, fahrradJeWe_m2: Math.max(0, num(o.fahrradJeWe_m2, KELLER_FAHRRAD_JE_WE_M2)),
    wasch: !!o.wasch, wasch_m2: Math.max(0, num(o.wasch_m2, KELLER_WASCH_M2)),
  };
}

/**
 * Bounding box as in tesselierung.js (default 20×14 m centred = store default).
 * Exported for tiefgarage.js (Phase 62) — one bbox rule for the whole basement.
 * @param {Array<{x:number,z:number}>|null|undefined} footprintM centred metres
 * @returns {{minX:number,maxX:number,minZ:number,maxZ:number,w:number,d:number}} metres
 */
export function footprintBBox(footprintM) {
  const pts = Array.isArray(footprintM) && footprintM.length >= 3
    ? footprintM
    : [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
  const xs = pts.map((p) => num(p.x));
  const zs = pts.map((p) => num(p.z));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ };
}

/**
 * Axis-aligned bbox of a zone, metres (all basement zones are rectangles).
 * @param {{points?: Array<{x:number,z:number}>}} z
 * @returns {{x0:number,x1:number,z0:number,z1:number}|null}
 */
export function zonenBBox(z) {
  const pts = Array.isArray(z?.points) ? z.points : [];
  if (pts.length < 3) return null;
  const xs = pts.map((p) => num(p.x)), zs = pts.map((p) => num(p.z));
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/**
 * Bbox area of a rectangular zone, m².
 * @param {{points?: Array<{x:number,z:number}>}} z
 * @returns {number}
 */
export function zonenFlaeche(z) {
  const b = zonenBBox(z);
  return b ? (b.x1 - b.x0) * (b.z1 - b.z0) : 0;
}

/**
 * Two axis-aligned rectangles share an edge when they touch on one side
 * (distance < eps) and the overlapping segment is longer than eps.
 * @param {object} a zone
 * @param {object} b zone
 * @param {number} [eps] tolerance, m
 * @returns {boolean}
 */
export function teiltKante(a, b, eps = 1e-6) {
  const A = zonenBBox(a), B = zonenBBox(b);
  if (!A || !B) return false;
  const ueberlappZ = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
  const ueberlappX = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
  const beruehrtX = Math.abs(A.x1 - B.x0) < eps || Math.abs(B.x1 - A.x0) < eps;
  const beruehrtZ = Math.abs(A.z1 - B.z0) < eps || Math.abs(B.z1 - A.z0) < eps;
  return (beruehrtX && ueberlappZ > eps) || (beruehrtZ && ueberlappX > eps);
}

/**
 * Deduplicate the units of a weListe (Reihenhaus/EFH: one unit over several
 * storeys = ONE compartment). Order = first occurrence; weListe is sorted by
 * level/band, so K numbers follow the storey numbering.
 * @param {Array<{we?: string}>|null|undefined} weListe
 * @returns {string[]} unit ids
 */
export function eindeutigeWEs(weListe) {
  const seen = new Set();
  const out = [];
  for (const w of Array.isArray(weListe) ? weListe : []) {
    const we = typeof w?.we === "string" ? w.we : "";
    if (!we || seen.has(we)) continue;
    seen.add(we);
    out.push(we);
  }
  return out;
}

const abteilNr = (i) => `K-${String(i + 1).padStart(2, "0")}`;

/**
 * Basement storey layout on level -1.
 *
 * Layout v1 (D-P61-09): running axis u = longer footprint side, depth v = shorter.
 *   [ mandatory strip | compartments side A ]
 *   [  Technik /      | ---- corridor ----  ]   ← one row; deep footprints get
 *   [  Fahrrad / Wasch| compartments side B ]     several rows (depth cap)
 * Rows = floor(D / (2·Tmax + gang)) ≥ 1, compartment depth T = (D/rows − gang)/2.
 * Compartments per band via verteileBand (min/target/max = m² ÷ T). Over-
 * occupation places fewer compartments than units — never below the minimum
 * size, never overlapping (Pitfall 3 of tesselierung.js).
 *
 * Phase 62: `uStart` (m, default 0) reserves u ∈ [0, uStart] for the Tiefgarage — the
 * mandatory strip and the corridor rows start behind it. Default 0 = 61-06 behaviour.
 *
 * @param {{ footprintM?: Array<{x:number,z:number}>|null, weListe?: Array<{we:string}>, optionen?: object, uStart?: number }} opts
 * @returns {{ zonen: Array<object>, zuordnung: Array<{we:string, abteil:string|null, flaeche_m2:number, status:string}>, mengen: object, optionen: object, hinweise: string[], reihen: number, uStart: number }}
 */
export function kellerLayout(opts) {
  const { footprintM = null, weListe = [], optionen, uStart: uStartRoh = 0 } = opts || {};
  const o = kellerOptionen(optionen);
  const bb = footprintBBox(footprintM);
  const wes = eindeutigeWEs(weListe);
  const hinweise = [];

  // Local coordinates: u along the longer side, v across. The garage (Phase 62)
  // may occupy the head end; the cellar then lives in u ∈ [uStart, L].
  const laengsX = bb.w >= bb.d;
  const LGesamt = laengsX ? bb.w : bb.d;
  const uStart = Math.min(LGesamt, Math.max(0, num(uStartRoh)));
  const L = LGesamt;
  const D = laengsX ? bb.d : bb.w;
  if (uStart > 0) hinweise.push(`Tiefgarage belegt die ersten ${r2(uStart)} m — Keller beginnt dahinter.`);
  const rect = (u0, u1, v0, v1) => (laengsX
    ? [{ x: bb.minX + u0, z: bb.minZ + v0 }, { x: bb.minX + u1, z: bb.minZ + v0 },
      { x: bb.minX + u1, z: bb.minZ + v1 }, { x: bb.minX + u0, z: bb.minZ + v1 }]
    : [{ x: bb.minX + v0, z: bb.minZ + u0 }, { x: bb.minX + v1, z: bb.minZ + u0 },
      { x: bb.minX + v1, z: bb.minZ + u1 }, { x: bb.minX + v0, z: bb.minZ + u1 }]);

  const zonen = [];
  const mk = (points, name, extra) => ({ points, level: -1, name: `${name}${WT_MARKER}`, ...extra });

  // --- Mandatory strip at the head end, u ∈ [0, pfL] --------------------------------
  // Technikraum is a noise source ("laut" in schallschutzPlan); the others are
  // plain storage ("keller", neither protected nor a source).
  const pflicht = [];
  if (o.technik && o.technik_m2 > 0) pflicht.push({ key: "technik", name: "Technikraum", m2: o.technik_m2, raumart: "laut" });
  if (o.fahrrad && o.fahrradJeWe_m2 > 0 && wes.length) {
    pflicht.push({ key: "fahrrad", name: "Fahrradraum", m2: o.fahrradJeWe_m2 * wes.length, raumart: "keller" });
  }
  if (o.wasch && o.wasch_m2 > 0) pflicht.push({ key: "wasch", name: "Waschraum", m2: o.wasch_m2, raumart: "keller" });
  const pflichtSumme = pflicht.reduce((s, p) => s + p.m2, 0);
  // Strip depth = Σ m² ÷ footprint depth, at least PFLICHT_MIN_TIEFE, never more
  // than the footprint offers. Rooms are stacked across (v) proportional to area.
  let pfL = uStart;
  if (pflicht.length && D > 0) {
    pfL = Math.min(L, uStart + Math.max(PFLICHT_MIN_TIEFE, pflichtSumme / D));
    let v = 0;
    pflicht.forEach((p, i) => {
      const anteil = p.m2 / pflichtSumme;
      const v1 = i === pflicht.length - 1 ? D : v + anteil * D;
      zonen.push(mk(rect(uStart, pfL, v, v1), p.name, { raumart: p.raumart, keller: p.key }));
      v = v1;
    });
    if ((pfL - uStart) * D > pflichtSumme + 1e-6) {
      hinweise.push(`Pflichtflächen auf ${r2((pfL - uStart) * D)} m² aufgerundet (Mindesttiefe ${PFLICHT_MIN_TIEFE} m).`);
    }
  }

  // --- Corridor rows + compartments in the rest u ∈ [pfL, L] --------------------------
  const gb = Math.min(o.gang_b, D);
  const restL = Math.max(0, L - pfL);
  const reihen = Math.max(1, Math.floor(D / (2 * o.abteilTiefeMax_m + gb)));
  const reihenD = D / reihen;
  const T = Math.max(0, (reihenD - gb) / 2); // compartment depth per side, m
  const gaenge = [];
  const abteile = []; // { we, abteil, points, flaeche_m2 }
  let zwischenwaende_lfm = 0;
  let fronten_lfm = 0;

  if (restL > 1e-6 && T > 0.05 && wes.length) {
    // Bands: per row side A (low v), side B (high v); units are dealt out evenly
    // in weListe order, band by band.
    const baender = [];
    for (let r = 0; r < reihen; r++) {
      const v0 = r * reihenD;
      const vMitte = v0 + reihenD / 2;
      gaenge.push(mk(rect(pfL, L, vMitte - gb / 2, vMitte + gb / 2),
        reihen > 1 ? `Kellergang ${r + 1}` : "Kellergang", { raumart: "flur", keller: "gang" }));
      baender.push({ v0: vMitte - gb / 2 - T, v1: vMitte - gb / 2 });
      baender.push({ v0: vMitte + gb / 2, v1: vMitte + gb / 2 + T });
    }
    const jeBand = Math.ceil(wes.length / baender.length);
    const platziertJeWe = new Map();
    baender.forEach((band, bi) => {
      const bandWes = wes.slice(bi * jeBand, (bi + 1) * jeBand);
      if (!bandWes.length) return;
      const kandidaten = bandWes.map((we) => ({
        id: we, ziel: o.abteilZiel_m2 / T, min: o.abteilMin_m2 / T, max: o.abteilMax_m2 / T,
      }));
      const lauf = verteileBand(restL, kandidaten);
      let cursor = pfL;
      let nBand = 0;
      for (let i = 0; i < lauf.items.length; i++) {
        const breite = num(lauf.items[i].breite);
        if (breite <= 1e-6) continue;
        // Over-occupation: this and all following units of the band stay without
        // a compartment (never overlapping, never below the minimum size).
        if (cursor + breite > L + 1e-6) break;
        platziertJeWe.set(bandWes[i], { points: rect(cursor, cursor + breite, band.v0, band.v1), flaeche_m2: breite * T });
        cursor += breite;
        nBand += 1;
        fronten_lfm += breite;
      }
      if (nBand > 1) zwischenwaende_lfm += (nBand - 1) * T;
    });
    // K numbers in weListe order, only for placed units (consecutive).
    let k = 0;
    for (const we of wes) {
      const p = platziertJeWe.get(we);
      if (!p) continue;
      abteile.push({ we, abteil: abteilNr(k++), points: p.points, flaeche_m2: p.flaeche_m2 });
    }
  } else if (wes.length) {
    hinweise.push("Kein Platz für Abteile — Footprint zu klein oder Pflichtflächen füllen das Geschoss.");
  }

  zonen.push(...gaenge);
  for (const a of abteile) {
    // Identifier identical in plan label and assignment list: "K-01 (WE 0-1)".
    zonen.push(mk(a.points, `${a.abteil} (${a.we})`, { we: a.we, raumart: "keller", keller: "abteil", abteil: a.abteil }));
  }

  const zuordnung = wes.map((we) => {
    const a = abteile.find((x) => x.we === we);
    if (!a) return { we, abteil: null, flaeche_m2: 0, status: "warn" };
    return { we, abteil: a.abteil, flaeche_m2: r2(a.flaeche_m2), status: a.flaeche_m2 + 1e-6 >= o.abteilMin_m2 ? "pass" : "warn" };
  });

  const mengen = kellerMengen({ zonen, abteile, zwischenwaende_lfm, fronten_lfm });
  return { zonen, zuordnung, mengen, optionen: o, hinweise, reihen, uStart };
}

/**
 * AVA hand-over quantity list (D-P61-10). From a kellerLayout result or from its
 * zones alone (fallback: areas from the zone bboxes, wall lengths then 0).
 *   abteile_stk / abteile_m2       compartments, pieces / m²
 *   trennwaende_lfm                partition walls between neighbouring compartments (depth per wall), lfm
 *   abteilfronten_lfm              fronts to the corridor (mesh wall + door) = Σ compartment widths, lfm
 *   verkehr_m2                     corridor area, m²
 *   technik_m2 / fahrrad_m2 / wasch_m2   mandatory rooms as drawn, m²
 *   gesamt_m2                      Σ of all basement zones, m²
 * The deep LV integration (nova-ausschreibung) is open — see module header.
 * @param {{zonen?: Array<object>, abteile?: Array<object>, zwischenwaende_lfm?: number, fronten_lfm?: number}} input
 * @returns {{abteile_stk:number, abteile_m2:number, trennwaende_lfm:number, abteilfronten_lfm:number, verkehr_m2:number, technik_m2:number, fahrrad_m2:number, wasch_m2:number, gesamt_m2:number}}
 */
export function kellerMengen(input) {
  const zonen = Array.isArray(input?.zonen) ? input.zonen : [];
  const abteile = Array.isArray(input?.abteile) ? input.abteile : zonen.filter((z) => z.keller === "abteil");
  const flaecheVon = (key) => r2(zonen.filter((z) => z.keller === key).reduce((s, z) => s + zonenFlaeche(z), 0));
  const abteile_m2 = r2(abteile.reduce((s, a) => s + num(a.flaeche_m2, zonenFlaeche(a)), 0));
  return {
    abteile_stk: abteile.length,
    abteile_m2,
    trennwaende_lfm: r2(num(input?.zwischenwaende_lfm)),
    abteilfronten_lfm: r2(num(input?.fronten_lfm)),
    verkehr_m2: flaecheVon("gang"),
    technik_m2: flaecheVon("technik"),
    fahrrad_m2: flaecheVon("fahrrad"),
    wasch_m2: flaecheVon("wasch"),
    gesamt_m2: r2(zonen.reduce((s, z) => s + zonenFlaeche(z), 0)),
  };
}

/**
 * Checks — pass/warn/offen only, never fail: this is a concept layout with
 * [ASSUMED] guide values, so a shortfall is a hint to the planner, not a
 * verdict (same liability stance as tesselierungsChecks).
 * @param {{ zonen?: Array<object>, zuordnung?: Array<object>, optionen?: object }} input kellerLayout result
 * @returns {Array<{key:string, label:string, status:string, detail:string}>} status is one of "pass" | "warn" | "offen"
 */
export function kellerChecks(input) {
  const zonen = Array.isArray(input?.zonen) ? input.zonen : [];
  const zuordnung = Array.isArray(input?.zuordnung) ? input.zuordnung : [];
  const o = kellerOptionen(input?.optionen);
  const checks = [];

  const ohne = zuordnung.filter((z) => !z.abteil);
  checks.push(zuordnung.length === 0
    ? { key: "abteil_je_we", label: "Ein Abteil je WE", status: "offen", detail: "Keine WEs — Tesselierung anwenden." }
    : ohne.length
      ? { key: "abteil_je_we", label: "Ein Abteil je WE", status: "warn", detail: `${ohne.length} WE ohne Abteil (${ohne.map((z) => z.we).join(", ")}) — Footprint zu klein oder Mindestgröße senken.` }
      : { key: "abteil_je_we", label: "Ein Abteil je WE", status: "pass", detail: `${zuordnung.length} WE, ${zuordnung.length} Abteile.` });

  const abteile = zonen.filter((z) => z.keller === "abteil");
  const zuKlein = abteile.filter((z) => zonenFlaeche(z) + 1e-6 < o.abteilMin_m2);
  checks.push(abteile.length === 0
    ? { key: "mindestgroesse", label: `Mindestgröße ${o.abteilMin_m2} m²`, status: "offen", detail: "Keine Abteile." }
    : zuKlein.length
      ? { key: "mindestgroesse", label: `Mindestgröße ${o.abteilMin_m2} m²`, status: "warn", detail: `${zuKlein.length} Abteil(e) unter Mindestgröße.` }
      : { key: "mindestgroesse", label: `Mindestgröße ${o.abteilMin_m2} m²`, status: "pass", detail: `Alle ${abteile.length} Abteile ≥ ${o.abteilMin_m2} m² [ASSUMED-Richtwert].` });

  const gaenge = zonen.filter((z) => z.keller === "gang");
  const ohneGang = abteile.filter((a) => !gaenge.some((g) => teiltKante(a, g)));
  checks.push(abteile.length === 0
    ? { key: "gang_anbindung", label: "Gang-Anbindung", status: "offen", detail: "Keine Abteile." }
    : ohneGang.length
      ? { key: "gang_anbindung", label: "Gang-Anbindung", status: "warn", detail: `${ohneGang.length} Abteil(e) ohne Kante zum Gang.` }
      : { key: "gang_anbindung", label: "Gang-Anbindung", status: "pass", detail: `Alle Abteile liegen an einem Gang (${o.gang_b} m, ${gaenge.length} Gang/Gänge).` });

  const fehlt = [];
  if (o.technik && !zonen.some((z) => z.keller === "technik")) fehlt.push("Technik");
  if (o.fahrrad && !zonen.some((z) => z.keller === "fahrrad")) fehlt.push("Fahrrad");
  if (o.wasch && !zonen.some((z) => z.keller === "wasch")) fehlt.push("Wasch");
  const aktiv = [o.technik && "Technik", o.fahrrad && "Fahrrad", o.wasch && "Wasch"].filter(Boolean);
  checks.push(!aktiv.length
    ? { key: "pflichtflaechen", label: "Pflichtflächen", status: "offen", detail: "Keine Pflichtfläche aktiviert." }
    : fehlt.length
      ? { key: "pflichtflaechen", label: "Pflichtflächen", status: "warn", detail: `Fehlt: ${fehlt.join(", ")}.` }
      : { key: "pflichtflaechen", label: "Pflichtflächen", status: "pass", detail: `${aktiv.join(", ")} vorhanden [ASSUMED-Richtwerte].` });

  return checks;
}
