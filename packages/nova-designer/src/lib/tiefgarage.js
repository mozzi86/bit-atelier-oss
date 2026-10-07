// Tiefgaragen-Planner (Phase 62) — the garage part of the one basement storey on
// level -1, next to the Kellerabteile of 61-06. Pure functions, deterministic,
// node-testable. Imports only the shared bbox rule (keller.js), the ·WT marker
// (tesselierung.js) and the above-ground parking demand (landscape.js).
//
// In:  footprintM (centred metres), storeyHeight (m), weAnzahl (units), optionen
//      (guide values, all overridable), optional columns for collision checks.
// Out: zones for the shared store (level -1, " ·WT" marker, raumart "verkehr"),
//      the parking proof (Stellplatz-Nachweis incl. barrier-free quota and GEIG),
//      checks (pass | warn | offen — never fail), the AVA hand-over quantities.
//
// Concept character: rule layout for the feasibility stage, NOT a permit set.
// Every guide value is [ASSUMED] with its source (GaStellV Bayern / M-GarVO / EAR 05
// / GEIG) and differs per Bundesland — hence the Landesrecht note in the checks.
//
// Geometry v1 (62-RESEARCH §2): the garage occupies the head end u ∈ [0, laenge]
// of the footprint bbox (u = longer side, v = shorter). Per module across v:
//   [ stalls side A (5.00) — the ramp sits in front, u ∈ [0, rampeL] ]
//   [ ---------------- Fahrgasse (6.00 at 90°) ------------------- ]
//   [ stalls side B (5.00) — barrier-free stalls first            ]
// Module depth 16.00 m two-sided, 11.00 m one-sided when D < 16. Unused depth
// beyond the modules is reported as a hint, never silently filled.

import { footprintBBox } from "@designer/lib/keller";
import { WT_MARKER } from "@designer/lib/tesselierung";
import {
  DEFAULT_BARRIEREFREI_MIN, DEFAULT_BARRIEREFREI_PCT, DEFAULT_KFZ_SCHLUESSEL,
  erfBarrierefrei, erfKfzStellplaetze,
} from "@designer/lib/landscape";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r2 = (v) => Math.round(v * 100) / 100;

// --- Guide values ([ASSUMED], overridable via optionen) --------------------------
/** Regular stall width, m. [ASSUMED] GaStellV Bayern §4 / EAR 05: 2,50 m. */
export const TG_STPL_B = 2.5;
/** Regular stall length, m. [ASSUMED] GaStellV §4: 5,00 m. */
export const TG_STPL_L = 5.0;
/** Width surcharge when a stall is bounded by a wall or column on one side, m. [ASSUMED] EAR: +0,10 (one side), +0,25 (both sides). */
export const TG_ZUSCHLAG_WAND = 0.1;
/** Barrier-free stall width, m. [ASSUMED] GaStellV / DIN 18040-1: 3,50 m. */
export const TG_BF_B = 3.5;
/** Longitudinal (parallel) stall, m × m. [ASSUMED] EAR: 2,00 × 6,00 (some tables 2,30 × 5,70). */
export const TG_LAENGS_B = 2.0;
export const TG_LAENGS_L = 6.0;
/** Fahrgasse widths per arrangement, m. [ASSUMED] GaStellV §4 table: 90° 6,00 · 45° 3,50 · längs 3,00; two-way traffic never below 5,50. */
export const TG_FAHRGASSE = Object.freeze({ senkrecht: 6.0, schraeg45: 3.5, laengs: 3.0, gegenverkehrMin: 5.5, einbahn90: 5.5 });
/** Ramp slope cap, fraction. [ASSUMED] GaStellV §2: 15 %. */
export const TG_RAMPE_NEIGUNG_MAX = 0.15;
/** Ramp width single / double lane, m. [ASSUMED] GaStellV/EAR: ≥ 2,75 single, ≥ 5,00 double. */
export const TG_RAMPE_B_EINSPURIG = 2.75;
export const TG_RAMPE_B_ZWEISPURIG = 5.0;
/** Clear height, m. [ASSUMED] GaStellV §2: ≥ 2,00 m everywhere incl. under beams/ducts. */
export const TG_LICHTE_HOEHE_MIN = 2.0;
/** Beam/duct reserve below the slab, m. [ASSUMED] typical Unterzug + TGA route 0,40 m. */
export const TG_UNTERZUG_RESERVE = 0.4;
/** Garage classes by Nutzfläche, m². [ASSUMED] GaStellV §1: Klein ≤ 100, Mittel ≤ 1.000, Groß > 1.000. */
export const TG_KLASSEN = Object.freeze({ kleinMax: 100, mittelMax: 1000 });
/** Fire compartment cap below ground, m². [ASSUMED] GaStellV §5: 2.500 m² unterirdisch (5.000 oberirdisch). */
export const TG_BRANDABSCHNITT_UNTERIRDISCH = 2500;
/** Escape route length, m. [ASSUMED] GaStellV §12: ≤ 30 m to an exit/stair. */
export const TG_RETTUNGSWEG_MAX = 30;
/** GEIG thresholds (stalls). [ASSUMED] GEIG §6 residential new build > 5: every stall gets Leitungsinfrastruktur; §7 non-residential > 6: every 3rd + ≥ 1 charging point. */
export const GEIG_WOHN_SCHWELLE = 5;
export const GEIG_NICHTWOHN_SCHWELLE = 6;

/** Default options (persisted in werkstatt_layer.tiefgarage.optionen). */
export const TG_DEFAULT_OPTIONEN = Object.freeze({
  laenge_m: null,            // garage length along u; null = whole footprint length
  anordnung: "senkrecht",    // senkrecht (90°) | laengs
  gegenverkehr: true,        // two-way Fahrgasse (else one-way with arrow overlay)
  rampeNeigung: 0.15,        // fraction
  rampeZweispurig: false,
  barrierefreiAnzahl: null,  // null = from the proof (erfBarrierefrei)
  kfzSchluessel: DEFAULT_KFZ_SCHLUESSEL,
  oberirdisch_stk: 0,        // above-ground stalls counted towards the proof (landscape tab)
  nutzungWohnen: true,       // GEIG branch
  lueftungMaschinell: false, // user statement for the Großgarage check
  unterzugReserve_m: TG_UNTERZUG_RESERVE,
});

/**
 * Hardens partial options (types, ranges) into a complete option object.
 * @param {object|null|undefined} optionen
 * @returns {object} complete options (m, fractions, counts, booleans)
 */
export function tiefgarageOptionen(optionen) {
  const o = { ...TG_DEFAULT_OPTIONEN, ...(optionen || {}) };
  return {
    laenge_m: o.laenge_m == null || o.laenge_m === "" ? null : Math.max(0, num(o.laenge_m)),
    anordnung: o.anordnung === "laengs" ? "laengs" : "senkrecht",
    gegenverkehr: o.gegenverkehr !== false,
    rampeNeigung: Math.min(0.5, Math.max(0.02, num(o.rampeNeigung, TG_RAMPE_NEIGUNG_MAX))),
    rampeZweispurig: !!o.rampeZweispurig,
    barrierefreiAnzahl: o.barrierefreiAnzahl == null || o.barrierefreiAnzahl === "" ? null : Math.max(0, Math.round(num(o.barrierefreiAnzahl))),
    kfzSchluessel: Math.max(0, num(o.kfzSchluessel, DEFAULT_KFZ_SCHLUESSEL)),
    oberirdisch_stk: Math.max(0, Math.round(num(o.oberirdisch_stk))),
    nutzungWohnen: o.nutzungWohnen !== false,
    lueftungMaschinell: !!o.lueftungMaschinell,
    unterzugReserve_m: Math.max(0, num(o.unterzugReserve_m, TG_UNTERZUG_RESERVE)),
  };
}

/**
 * Ramp length for one storey, m. length = height ÷ slope (3,0 m ÷ 0,15 = 20 m).
 * @param {number} hoehe_m storey height to bridge, m
 * @param {number} neigung fraction (0.15 = 15 %)
 * @returns {number} m
 */
export function rampeLaenge(hoehe_m, neigung = TG_RAMPE_NEIGUNG_MAX) {
  const n = Math.max(0.02, num(neigung, TG_RAMPE_NEIGUNG_MAX));
  return r2(Math.max(0, num(hoehe_m)) / n);
}

/**
 * Garage class by Nutzfläche (GaStellV §1, [ASSUMED] thresholds).
 * @param {number} nutzflaeche_m2
 * @returns {"klein"|"mittel"|"gross"}
 */
export function garagenklasse(nutzflaeche_m2) {
  const a = num(nutzflaeche_m2);
  if (a <= TG_KLASSEN.kleinMax) return "klein";
  if (a <= TG_KLASSEN.mittelMax) return "mittel";
  return "gross";
}

/**
 * GEIG requirement for a new building (Leitungsinfrastruktur / Ladepunkte).
 * @param {number} stellplaetze total stalls of the building
 * @param {boolean} wohnen residential building
 * @returns {{pflicht:boolean, leitungsinfrastruktur_stk:number, ladepunkte_stk:number, regel:string}}
 */
export function geigAnforderung(stellplaetze, wohnen = true) {
  const n = Math.max(0, Math.round(num(stellplaetze)));
  if (wohnen) {
    const pflicht = n > GEIG_WOHN_SCHWELLE;
    return { pflicht, leitungsinfrastruktur_stk: pflicht ? n : 0, ladepunkte_stk: 0,
      regel: `GEIG §6 Wohngebäude: > ${GEIG_WOHN_SCHWELLE} Stellplätze → jeder Stellplatz Leitungsinfrastruktur` };
  }
  const pflicht = n > GEIG_NICHTWOHN_SCHWELLE;
  return { pflicht, leitungsinfrastruktur_stk: pflicht ? Math.ceil(n / 3) : 0, ladepunkte_stk: pflicht ? 1 : 0,
    regel: `GEIG §7 Nichtwohngebäude: > ${GEIG_NICHTWOHN_SCHWELLE} Stellplätze → jeder 3. Leitungsinfrastruktur, ≥ 1 Ladepunkt` };
}

/**
 * Parking proof: demand from units (landscape.js rule) against garage + above ground.
 * @param {{weAnzahl?:number, kfzSchluessel?:number, tg_stk?:number, oberirdisch_stk?:number, bf_stk?:number, bfPct?:number, bfMin?:number}} p
 * @returns {{erforderlich:number, vorhanden:number, tg_stk:number, oberirdisch_stk:number, differenz:number, bfErforderlich:number, bfVorhanden:number, status:string}}
 */
export function stellplatzNachweis(p) {
  const we = Math.max(0, num(p?.weAnzahl));
  const erforderlich = erfKfzStellplaetze(we, num(p?.kfzSchluessel, DEFAULT_KFZ_SCHLUESSEL));
  const tg = Math.max(0, Math.round(num(p?.tg_stk)));
  const ob = Math.max(0, Math.round(num(p?.oberirdisch_stk)));
  const vorhanden = tg + ob;
  const bfErforderlich = erforderlich > 0 ? erfBarrierefrei(erforderlich, num(p?.bfPct, DEFAULT_BARRIEREFREI_PCT), num(p?.bfMin, DEFAULT_BARRIEREFREI_MIN)) : 0;
  const bfVorhanden = Math.max(0, Math.round(num(p?.bf_stk)));
  return {
    erforderlich, vorhanden, tg_stk: tg, oberirdisch_stk: ob, differenz: vorhanden - erforderlich,
    bfErforderlich, bfVorhanden,
    status: erforderlich === 0 ? "offen" : vorhanden >= erforderlich ? "pass" : "warn",
  };
}

/** Axis-aligned bbox of a polygon (metres). */
function bboxOf(points) {
  const xs = points.map((p) => num(p.x));
  const zs = points.map((p) => num(p.z));
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

function ueberlappt(a, b, eps = 1e-6) {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;
}

/**
 * Garage layout on level -1 in the head end of the footprint (62-RESEARCH §2).
 *
 * @param {{ footprintM?: Array<{x:number,z:number}>|null, storeyHeight?: number, weAnzahl?: number, optionen?: object, stuetzen?: Array<{x:number,z:number,w?:number,d?:number}> }} opts
 * @returns {{ zonen: Array<object>, stellplaetze: Array<object>, rampe: object|null, fahrgassen: Array<object>, nachweis: object, geig: object, mengen: object, klasse: string, optionen: object, hinweise: string[], laenge_m: number, module: number, einseitig: boolean, rettungswegMax_m: number, lichteHoehe_m: number, konflikte: number }}
 */
export function tiefgarageLayout(opts) {
  const { footprintM = null, storeyHeight = 3.0, weAnzahl = 0, optionen, stuetzen = [] } = opts || {};
  const o = tiefgarageOptionen(optionen);
  const bb = footprintBBox(footprintM);
  const hinweise = [];

  const laengsX = bb.w >= bb.d;
  const LGesamt = laengsX ? bb.w : bb.d;
  const D = laengsX ? bb.d : bb.w;
  const laenge = o.laenge_m == null ? LGesamt : Math.min(LGesamt, o.laenge_m);
  const rect = (u0, u1, v0, v1) => (laengsX
    ? [{ x: bb.minX + u0, z: bb.minZ + v0 }, { x: bb.minX + u1, z: bb.minZ + v0 },
      { x: bb.minX + u1, z: bb.minZ + v1 }, { x: bb.minX + u0, z: bb.minZ + v1 }]
    : [{ x: bb.minX + v0, z: bb.minZ + u0 }, { x: bb.minX + v1, z: bb.minZ + u0 },
      { x: bb.minX + v1, z: bb.minZ + u1 }, { x: bb.minX + v0, z: bb.minZ + u1 }]);
  const mk = (points, name, extra) => ({ points, level: -1, name: `${name}${WT_MARKER}`, raumart: "verkehr", tg: true, ...extra });

  // Arrangement geometry.
  const senkrecht = o.anordnung === "senkrecht";
  const stplB = senkrecht ? TG_STPL_B : TG_LAENGS_L;   // extent along u per stall
  const stplT = senkrecht ? TG_STPL_L : TG_LAENGS_B;   // depth across v per stall band
  const bfB = senkrecht ? TG_BF_B : TG_LAENGS_L;
  const fg = senkrecht
    ? (o.gegenverkehr ? TG_FAHRGASSE.senkrecht : TG_FAHRGASSE.einbahn90)
    : (o.gegenverkehr ? TG_FAHRGASSE.gegenverkehrMin : TG_FAHRGASSE.laengs);
  const modulZwei = 2 * stplT + fg;
  const modulEins = stplT + fg;

  // Modules across v: as many two-sided modules as fit, else one one-sided module.
  let module = Math.floor(D / modulZwei);
  let einseitig = false;
  if (module === 0) {
    if (D >= modulEins) { module = 1; einseitig = true; } else {
      hinweise.push(`Footprint-Tiefe ${r2(D)} m reicht nicht für Stellplatz + Fahrgasse (${r2(modulEins)} m).`);
    }
  }
  const modulD = einseitig ? modulEins : modulZwei;
  const restD = D - module * modulD;
  if (module > 0 && restD > 1.0) hinweise.push(`${r2(restD)} m Tiefe bleiben ungenutzt (kein weiteres Modul möglich).`);

  // Ramp: length from storey height and slope, in band A of the first module, u from 0.
  const rampeL = rampeLaenge(storeyHeight, o.rampeNeigung);
  const rampeB = o.rampeZweispurig ? TG_RAMPE_B_ZWEISPURIG : TG_RAMPE_B_EINSPURIG;
  let rampe = null;
  const rampePasst = rampeL <= laenge + 1e-6;
  if (!rampePasst) hinweise.push(`Rampe braucht ${rampeL} m bei ${Math.round(o.rampeNeigung * 100)} % — Garagenlänge ist ${r2(laenge)} m.`);

  // Barrier-free count: explicit or from the proof (needs the demand, not the supply).
  const erfKfz = erfKfzStellplaetze(Math.max(0, num(weAnzahl)), o.kfzSchluessel);
  const bfSoll = o.barrierefreiAnzahl != null ? o.barrierefreiAnzahl : (erfKfz > 0 ? erfBarrierefrei(erfKfz) : 0);

  const zonen = [];
  const stellplaetze = [];
  const fahrgassen = [];
  const stuetzenBBox = (Array.isArray(stuetzen) ? stuetzen : []).map((s) => {
    const w = Math.max(0.2, num(s.w, 0.4)), d = Math.max(0.2, num(s.d, 0.4));
    return { x0: num(s.x) - w / 2, x1: num(s.x) + w / 2, z0: num(s.z) - d / 2, z1: num(s.z) + d / 2 };
  });
  let nr = 0;
  let bfVergeben = 0;
  let verkehr_m2 = 0;
  let konflikte = 0;

  // Fills one band u ∈ [u0, u1] with stalls; first/last stall get the wall surcharge.
  const fuelleBand = (u0, u1, v0, v1, seite, mitBf) => {
    const verfuegbar = u1 - u0;
    if (verfuegbar < stplB + TG_ZUSCHLAG_WAND) return 0;
    const breiten = [];
    let summe = TG_ZUSCHLAG_WAND * 2; // wall surcharge at both band ends
    if (mitBf) {
      while (bfVergeben < bfSoll && summe + bfB <= verfuegbar + 1e-6) { breiten.push({ b: bfB, bf: true }); summe += bfB; bfVergeben += 1; }
    }
    while (summe + stplB <= verfuegbar + 1e-6) { breiten.push({ b: stplB, bf: false }); summe += stplB; }
    let cursor = u0 + TG_ZUSCHLAG_WAND;
    let n = 0;
    for (const s of breiten) {
      nr += 1;
      const pts = rect(cursor, cursor + s.b, v0, v1);
      const box = bboxOf(pts);
      const konflikt = stuetzenBBox.some((c) => ueberlappt(c, box));
      if (konflikt) konflikte += 1;
      const id = `P-${String(nr).padStart(2, "0")}`;
      const stall = { id, seite, bf: s.bf, konflikt, breite_m: s.b, laenge_m: v1 - v0, points: pts,
        mitte: { u: cursor + s.b / 2, v: (v0 + v1) / 2 } };
      stellplaetze.push(stall);
      zonen.push(mk(pts, `${id}${s.bf ? " ♿" : ""}`, { raumart: "verkehr", stellplatz: id, bf: s.bf, konflikt }));
      cursor += s.b;
      n += 1;
    }
    return n;
  };

  for (let m = 0; m < module; m++) {
    const vBase = m * modulD;
    const vA0 = vBase, vA1 = vBase + stplT;
    const vFg0 = vA1, vFg1 = vA1 + fg;
    const vB0 = vFg1, vB1 = vFg1 + stplT;
    // Side A: the ramp takes u ∈ [0, rampeL] in the first module.
    let uA0 = 0;
    if (m === 0 && rampePasst) {
      const rpts = rect(0, rampeL, vA0, vA1);
      rampe = { points: rpts, laenge_m: rampeL, breite_m: rampeB, bandbreite_m: stplT, neigung: o.rampeNeigung,
        fuss: { u: rampeL, v: (vFg0 + vFg1) / 2 } };
      zonen.push(mk(rpts, `Rampe ${Math.round(o.rampeNeigung * 100)} %`, { rampe: true }));
      verkehr_m2 += rampeL * stplT;
      uA0 = rampeL;
    }
    if (!einseitig) fuelleBand(uA0, laenge, vA0, vA1, "A", false);
    const fgPts = rect(0, laenge, vFg0, vFg1);
    fahrgassen.push({ points: fgPts, breite_m: fg, gegenverkehr: o.gegenverkehr, richtung: laengsX ? "x" : "z" });
    zonen.push(mk(fgPts, module > 1 ? `Fahrgasse ${m + 1}` : "Fahrgasse", { fahrgasse: true, einbahn: !o.gegenverkehr }));
    verkehr_m2 += laenge * fg;
    fuelleBand(0, laenge, einseitig ? vFg1 : vB0, einseitig ? vFg1 + stplT : vB1, "B", true);
  }
  if (bfSoll > bfVergeben) hinweise.push(`${bfSoll - bfVergeben} barrierefreie Stellplätze fanden keinen Platz.`);

  // Escape route approximation: farthest stall centre → ramp foot (straight line, [ASSUMED]).
  const ausgang = rampe ? rampe.fuss : { u: 0, v: D / 2 };
  const rettungswegMax_m = stellplaetze.reduce((mx, s) => Math.max(mx, Math.hypot(s.mitte.u - ausgang.u, s.mitte.v - ausgang.v)), 0);

  const nutzflaeche_m2 = laenge * (module > 0 ? module * modulD : D);
  const klasse = garagenklasse(nutzflaeche_m2);
  const lichteHoehe_m = Math.max(0, num(storeyHeight, 3.0) - o.unterzugReserve_m);
  const nachweis = stellplatzNachweis({ weAnzahl, kfzSchluessel: o.kfzSchluessel, tg_stk: stellplaetze.length,
    oberirdisch_stk: o.oberirdisch_stk, bf_stk: bfVergeben });
  const geig = geigAnforderung(stellplaetze.length + o.oberirdisch_stk, o.nutzungWohnen);
  const mengen = tiefgarageMengen({ stellplaetze, verkehr_m2, rampe, nutzflaeche_m2, klasse });

  return { zonen, stellplaetze, rampe, fahrgassen, nachweis, geig, mengen, klasse, optionen: o, hinweise,
    laenge_m: r2(laenge), module, einseitig, rettungswegMax_m: r2(rettungswegMax_m), lichteHoehe_m: r2(lichteHoehe_m), konflikte };
}

/**
 * AVA hand-over quantities (pattern D-P61-10 — a list, not LV positions).
 * @param {{stellplaetze?:Array<object>, verkehr_m2?:number, rampe?:object|null, nutzflaeche_m2?:number, klasse?:string}} input
 * @returns {{stellplaetze_stk:number, barrierefrei_stk:number, stellplatz_m2:number, verkehr_m2:number, rampe_lfm:number, nutzflaeche_m2:number, klasse:string}}
 */
export function tiefgarageMengen(input) {
  const st = Array.isArray(input?.stellplaetze) ? input.stellplaetze : [];
  return {
    stellplaetze_stk: st.length,
    barrierefrei_stk: st.filter((s) => s.bf).length,
    stellplatz_m2: r2(st.reduce((s, x) => s + num(x.breite_m) * num(x.laenge_m), 0)),
    verkehr_m2: r2(num(input?.verkehr_m2)),
    rampe_lfm: r2(num(input?.rampe?.laenge_m)),
    nutzflaeche_m2: r2(num(input?.nutzflaeche_m2)),
    klasse: input?.klasse || garagenklasse(num(input?.nutzflaeche_m2)),
  };
}

const KLASSE_LABEL = { klein: "Kleingarage (≤ 100 m²)", mittel: "Mittelgarage (100–1.000 m²)", gross: "Großgarage (> 1.000 m²)" };

/**
 * Concept checks — pass | warn | offen, never fail (liability: guide values, Landesrecht).
 * @param {ReturnType<typeof tiefgarageLayout>} e
 * @returns {Array<{key:string,label:string,status:string,detail:string}>}
 */
export function tiefgarageChecks(e) {
  if (!e) return [];
  const o = e.optionen || tiefgarageOptionen(null);
  const out = [];
  const pct = Math.round(o.rampeNeigung * 100);
  out.push({ key: "rampe_neigung", label: "Rampenneigung",
    status: o.rampeNeigung <= TG_RAMPE_NEIGUNG_MAX + 1e-9 ? "pass" : "warn",
    detail: `${pct} % (Richtwert ≤ ${Math.round(TG_RAMPE_NEIGUNG_MAX * 100)} % GaStellV [ASSUMED]); Länge ${e.rampe ? e.rampe.laenge_m : rampeLaenge(3, o.rampeNeigung)} m${e.rampe ? "" : " — passt nicht in die Garagenlänge"}` });
  out.push({ key: "rampe_lage", label: "Rampe im Grundriss", status: e.rampe ? "pass" : "warn",
    detail: e.rampe ? `Band A, ${e.rampe.laenge_m} m lang, ${e.rampe.breite_m} m breit (${o.rampeZweispurig ? "zweispurig" : "einspurig"})` : "Garage zu kurz für die Rampe — Länge erhöhen oder Neigung anpassen" });
  out.push({ key: "lichte_hoehe", label: "Lichte Höhe", status: e.lichteHoehe_m >= TG_LICHTE_HOEHE_MIN ? "pass" : "warn",
    detail: `${e.lichteHoehe_m} m unter Unterzug-Reserve ${o.unterzugReserve_m} m (Richtwert ≥ ${TG_LICHTE_HOEHE_MIN} m)` });
  out.push({ key: "fahrgasse", label: "Fahrgasse", status: e.module > 0 ? "pass" : "warn",
    detail: e.module > 0
      ? `${e.fahrgassen[0]?.breite_m} m, ${o.gegenverkehr ? "Gegenverkehr" : "Einbahn"}, ${e.module} Modul(e)${e.einseitig ? " einseitig" : " zweiseitig"}`
      : "kein Modul möglich (Footprint zu schmal)" });
  const nutz = e.mengen?.nutzflaeche_m2 ?? 0;
  out.push({ key: "klasse", label: "Garagenklasse", status: "pass",
    detail: `${KLASSE_LABEL[e.klasse] || e.klasse}, Nutzfläche ${nutz} m² — Landesrecht prüfen (GaStellV Bayern / M-GarVO)` });
  out.push({ key: "brandabschnitt", label: "Brandabschnitt", status: nutz <= TG_BRANDABSCHNITT_UNTERIRDISCH ? "pass" : "warn",
    detail: `${nutz} m² (Richtwert ≤ ${TG_BRANDABSCHNITT_UNTERIRDISCH} m² unterirdisch [ASSUMED])` });
  out.push({ key: "lueftung", label: "Lüftung / CO",
    status: e.klasse !== "gross" ? "pass" : o.lueftungMaschinell ? "pass" : "offen",
    detail: e.klasse === "gross"
      ? (o.lueftungMaschinell ? "maschinelle Lüftung mit CO-Warnanlage angegeben" : "Großgarage geschlossen: maschinelle Lüftung + CO-Warnanlage nachweisen (GaStellV §15/16)")
      : "Klein-/Mittelgarage: natürliche Lüftung über Öffnungen möglich — im Entwurf prüfen" });
  out.push({ key: "rettungsweg", label: "Rettungsweg", status: e.rettungswegMax_m <= TG_RETTUNGSWEG_MAX ? "pass" : "warn",
    detail: `längste Luftlinie Stellplatz → Rampenfuß ${e.rettungswegMax_m} m (Richtwert ≤ ${TG_RETTUNGSWEG_MAX} m; Näherung ohne Treppenraum [ASSUMED])` });
  out.push({ key: "stuetzen", label: "Stützen", status: e.konflikte === 0 ? "pass" : "warn",
    detail: e.konflikte === 0 ? "keine Kollision mit übergebenen Stützen" : `${e.konflikte} Stellplätze kollidieren mit Stützen (rot markiert)` });
  const n = e.nachweis || {};
  out.push({ key: "nachweis", label: "Stellplatz-Nachweis", status: n.status || "offen",
    detail: n.erforderlich ? `${n.vorhanden} vorhanden (${n.tg_stk} TG + ${n.oberirdisch_stk} oberirdisch) gegen ${n.erforderlich} erforderlich (${o.kfzSchluessel} je WE [ASSUMED])` : "keine WE-Zahl — Werkstatt zuerst anwenden" });
  out.push({ key: "barrierefrei", label: "Barrierefreie Stellplätze",
    status: n.bfErforderlich === 0 ? "offen" : n.bfVorhanden >= n.bfErforderlich ? "pass" : "warn",
    detail: `${n.bfVorhanden ?? 0} von ${n.bfErforderlich ?? 0} (3,50 m breit; Quote ${DEFAULT_BARRIEREFREI_PCT} %, mind. ${DEFAULT_BARRIEREFREI_MIN} [ASSUMED])` });
  const g = e.geig || {};
  out.push({ key: "geig", label: "E-Lade-Ausstattung (GEIG)", status: g.pflicht ? "offen" : "pass",
    detail: g.pflicht ? `${g.leitungsinfrastruktur_stk} × Leitungsinfrastruktur${g.ladepunkte_stk ? `, ${g.ladepunkte_stk} Ladepunkt` : ""} — ${g.regel}` : `unter der Schwelle — ${g.regel || ""}` });
  return out;
}
