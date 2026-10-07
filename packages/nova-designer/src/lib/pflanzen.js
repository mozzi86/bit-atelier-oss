// Plant catalogue and site suitability for the Außenanlagen-Editor (Phase 37, GARTEN-02/03/04).
//
// In:  the generic site-plan layer (lageplan.js), the site climate from useSiteClimate
//      ({ months[{tMin,…}], annualPrecip, avgTemp, offline }), the light class per position (sonnenstand.js).
// Out: PFLANZEN_KATALOG (KatalogPanel format), climate summary of the site (USDA hardiness zone, dryness),
//      suitability per plant type with reasons, checks (pass/warn/offen — never fail), quantities and the
//      green area total that feeds landscape.js.
//
// Every catalogue value is an [ASSUMED] horticultural rule of thumb (crown diameter, height, light demand,
// hardiness zone, drought tolerance) — good enough to flag an obviously wrong choice, not a planting spec.

import { layerHardened, flaechenSummen, punktInPolygon } from "@designer/lib/lageplan";

/**
 * Area kinds drawable on the site plan. `gruen` counts as unsealed for landscape.js (ψ Grün);
 * `befestigt` is sealed; `wasser` is shown only (no runoff role at concept level).
 * @type {Record<string, { id: string, name: string, farbe: string, gruen: boolean }>}
 */
export const FLAECHEN_ARTEN = {
  gruen: { id: "gruen", name: "Rasen / Wiese", farbe: "#86efac", gruen: true },
  beet: { id: "beet", name: "Pflanzfläche / Beet", farbe: "#4ade80", gruen: true },
  befestigt: { id: "befestigt", name: "Weg / Terrasse (befestigt)", farbe: "#d6d3d1", gruen: false },
  wasser: { id: "wasser", name: "Wasserfläche", farbe: "#7dd3fc", gruen: false },
};
/** Kinds that count as green (unsealed) area for landscape.js. */
export const GRUEN_ARTEN = Object.values(FLAECHEN_ARTEN).filter((a) => a.gruen).map((a) => a.id);

// Catalogue entries: krone_m crown diameter (m), hoehe_m mature height (m), licht acceptable light classes,
// zone_min coldest USDA zone tolerated, trockenheit drought tolerance, klimaresilienz expected robustness
// under a +2 K scenario, heimisch native to Central Europe. All [ASSUMED] nursery rules of thumb.
export const PFLANZEN_KATALOG = [
  {
    gruppe: "Bäume",
    typen: [
      { id: "stieleiche", name: "Stieleiche", krone_m: 15, hoehe_m: 25, licht: ["sonnig", "halbschattig"], zone_min: 5, trockenheit: "mittel", klimaresilienz: "hoch", heimisch: true },
      { id: "feldahorn", name: "Feldahorn", krone_m: 8, hoehe_m: 12, licht: ["sonnig", "halbschattig"], zone_min: 5, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: true },
      { id: "hainbuche", name: "Hainbuche", krone_m: 10, hoehe_m: 18, licht: ["sonnig", "halbschattig", "schattig"], zone_min: 5, trockenheit: "mittel", klimaresilienz: "mittel", heimisch: true },
      { id: "rotbuche", name: "Rotbuche", krone_m: 15, hoehe_m: 25, licht: ["halbschattig", "schattig"], zone_min: 5, trockenheit: "gering", klimaresilienz: "gering", heimisch: true },
      { id: "winterlinde", name: "Winterlinde", krone_m: 12, hoehe_m: 20, licht: ["sonnig", "halbschattig"], zone_min: 4, trockenheit: "mittel", klimaresilienz: "mittel", heimisch: true },
      { id: "vogelkirsche", name: "Vogelkirsche", krone_m: 8, hoehe_m: 15, licht: ["sonnig"], zone_min: 5, trockenheit: "mittel", klimaresilienz: "mittel", heimisch: true },
      { id: "zerreiche", name: "Zerreiche (Klimabaum)", krone_m: 12, hoehe_m: 20, licht: ["sonnig"], zone_min: 6, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: false },
      { id: "amberbaum", name: "Amberbaum", krone_m: 8, hoehe_m: 15, licht: ["sonnig"], zone_min: 6, trockenheit: "mittel", klimaresilienz: "hoch", heimisch: false },
      { id: "olivenbaum", name: "Olivenbaum", krone_m: 5, hoehe_m: 6, licht: ["sonnig"], zone_min: 9, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: false },
    ],
  },
  {
    gruppe: "Sträucher",
    typen: [
      { id: "hasel", name: "Hasel", krone_m: 4, hoehe_m: 5, licht: ["sonnig", "halbschattig"], zone_min: 5, trockenheit: "mittel", klimaresilienz: "mittel", heimisch: true },
      { id: "kornelkirsche", name: "Kornelkirsche", krone_m: 3, hoehe_m: 4, licht: ["sonnig", "halbschattig"], zone_min: 5, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: true },
      { id: "felsenbirne", name: "Felsenbirne", krone_m: 3, hoehe_m: 4, licht: ["sonnig", "halbschattig"], zone_min: 4, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: false },
      { id: "hortensie", name: "Bauernhortensie", krone_m: 1.5, hoehe_m: 1.5, licht: ["halbschattig", "schattig"], zone_min: 6, trockenheit: "gering", klimaresilienz: "gering", heimisch: false },
      { id: "eibe", name: "Eibe", krone_m: 3, hoehe_m: 6, licht: ["sonnig", "halbschattig", "schattig"], zone_min: 6, trockenheit: "mittel", klimaresilienz: "mittel", heimisch: true },
    ],
  },
  {
    gruppe: "Stauden",
    typen: [
      { id: "lavendel", name: "Lavendel", krone_m: 0.5, hoehe_m: 0.5, licht: ["sonnig"], zone_min: 6, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: false },
      { id: "funkie", name: "Funkie (Hosta)", krone_m: 0.6, hoehe_m: 0.5, licht: ["schattig", "halbschattig"], zone_min: 4, trockenheit: "gering", klimaresilienz: "gering", heimisch: false },
      { id: "fetthenne", name: "Fetthenne", krone_m: 0.4, hoehe_m: 0.5, licht: ["sonnig"], zone_min: 4, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: true },
      { id: "farn", name: "Wurmfarn", krone_m: 0.8, hoehe_m: 0.8, licht: ["schattig"], zone_min: 4, trockenheit: "gering", klimaresilienz: "mittel", heimisch: true },
    ],
  },
  {
    gruppe: "Gräser",
    typen: [
      { id: "chinaschilf", name: "Chinaschilf", krone_m: 1.2, hoehe_m: 2, licht: ["sonnig"], zone_min: 5, trockenheit: "mittel", klimaresilienz: "hoch", heimisch: false },
      { id: "blauschwingel", name: "Blauschwingel", krone_m: 0.3, hoehe_m: 0.3, licht: ["sonnig"], zone_min: 4, trockenheit: "hoch", klimaresilienz: "hoch", heimisch: false },
      { id: "waldschmiele", name: "Waldschmiele", krone_m: 0.5, hoehe_m: 0.6, licht: ["halbschattig", "schattig"], zone_min: 4, trockenheit: "mittel", klimaresilienz: "mittel", heimisch: true },
    ],
  },
];

/** Flat lookup id → catalogue type. */
export const PFLANZEN_TYPEN = Object.fromEntries(PFLANZEN_KATALOG.flatMap((g) => g.typen.map((t) => [t.id, { ...t, gruppe: g.gruppe }])));

/** Annual precipitation below this counts as a dry site ([ASSUMED] 600 mm — Central European steppe-like sites). */
export const TROCKEN_MM = 600;
/** [ASSUMED] the yearly extreme minimum lies ~8 K below the mean daily minimum of the coldest month. */
export const EXTREM_ABZUG_K = 8;
/** [ASSUMED] warming scenario used for the resilience hint (+2 K by mid-century). */
export const KLIMAWANDEL_K = 2;
/** Clearance between crown edge and façade ([ASSUMED] 1 m — maintenance and root space). */
export const FASSADEN_ABSTAND_M = 1.0;

/**
 * USDA hardiness zone from the extreme minimum temperature (°C). Zone boundaries per USDA 2012 map:
 * 4: −34.4…−28.9 · 5: −28.9…−23.3 · 6: −23.3…−17.8 · 7: −17.8…−12.2 · 8: −12.2…−6.7 · 9: −6.7…−1.1 · 10: −1.1…4.4.
 * @param {number} tExtrem °C
 * @returns {number} zone 3–10
 */
export function winterhaertezone(tExtrem) {
  const t = Number(tExtrem);
  if (!Number.isFinite(t)) return 6;
  if (t < -34.4) return 3;
  if (t < -28.9) return 4;
  if (t < -23.3) return 5;
  if (t < -17.8) return 6;
  if (t < -12.2) return 7;
  if (t < -6.7) return 8;
  if (t < -1.1) return 9;
  return 10;
}

/**
 * Climate summary of the site for plant suitability.
 * @param {{ months?: Array<{tMin?: number, temp?: number, precip?: number}>, annualPrecip?: number, avgTemp?: number, offline?: boolean }|null|undefined} climate useSiteClimate result
 * @returns {{ zone: number|null, tExtrem: number|null, niederschlag_mm: number, trocken: boolean, avgTemp: number|null, offline: boolean }}
 */
export function klimaAmStandort(climate) {
  const months = Array.isArray(climate?.months) ? climate.months : [];
  const offline = !climate || climate.offline === true || !months.length;
  const mins = months.map((m) => Number(m.tMin ?? m.temp)).filter(Number.isFinite);
  const tExtrem = mins.length ? Math.round((Math.min(...mins) - EXTREM_ABZUG_K) * 10) / 10 : null;
  const niederschlag = Number(climate?.annualPrecip) || months.reduce((s, m) => s + (Number(m.precip) || 0), 0);
  return {
    zone: tExtrem == null ? null : winterhaertezone(tExtrem),
    tExtrem,
    niederschlag_mm: Math.round(niederschlag),
    trocken: niederschlag > 0 && niederschlag < TROCKEN_MM,
    avgTemp: Number.isFinite(Number(climate?.avgTemp)) ? Number(climate.avgTemp) : null,
    offline,
  };
}

/**
 * Suitability of a plant type at a position.
 * @param {string|object} typ catalogue id or type object
 * @param {{ klima?: ReturnType<typeof klimaAmStandort>|null, licht?: "sonnig"|"halbschattig"|"schattig"|null }} ctx
 * @returns {{ status: "geeignet"|"bedingt"|"ungeeignet"|"offen", gruende: string[] }}
 */
export function eignung(typ, { klima = null, licht = null } = {}) {
  const t = typeof typ === "string" ? PFLANZEN_TYPEN[typ] : typ;
  if (!t) return { status: "offen", gruende: ["Unbekannter Pflanzentyp"] };
  const gruende = [];
  // Worst finding wins: geeignet < offen (unchecked) < bedingt < ungeeignet.
  const rang = { geeignet: 0, offen: 1, bedingt: 2, ungeeignet: 3 };
  let status = "geeignet";
  const setze = (s) => { if (rang[s] > rang[status]) status = s; };
  if (!klima || klima.offline || klima.zone == null) {
    setze("offen");
    gruende.push("Klimadaten offline — Winterhärte nicht geprüft");
  } else {
    if (klima.zone < t.zone_min) { setze("ungeeignet"); gruende.push(`Zu kalt: Standort Zone ${klima.zone}, Pflanze braucht ≥ Zone ${t.zone_min}`); }
    if (klima.trocken && t.trockenheit === "gering") { setze("bedingt"); gruende.push(`Trockener Standort (${klima.niederschlag_mm} mm/a) — geringe Trockenheitstoleranz`); }
    if (t.klimaresilienz === "gering") gruende.push(`Klimawandel +${KLIMAWANDEL_K} K: geringe Klimaresilienz — Alternative erwägen`);
  }
  if (licht && !t.licht.includes(licht)) {
    setze("bedingt");
    gruende.push(`Licht: Standort ${licht}, Pflanze bevorzugt ${t.licht.join("/")}`);
  }
  return { status, gruende };
}

/**
 * Concept checks — pass/warn/offen only. Planting advice is never a "fail": rules are municipal
 * (Baumschutzsatzung, Grenzabstände) and horticultural judgement remains with the landscape planner.
 * @param {object} layer aussenanlagen_layer
 * @param {{ footprint?: Array<{x:number,z:number}>, parzelleM?: Array<{x:number,z:number}>|null, klima?: object|null, lichtJeElement?: Record<string, string> }} ctx
 * @returns {Array<{ key: string, label: string, status: "pass"|"warn"|"offen", detail: string }>}
 */
export function aussenanlagenPlanChecks(layer, { footprint = [], parzelleM = null, klima = null, lichtJeElement = {} } = {}) {
  const base = layerHardened(layer);
  const items = [];
  const n = base.elemente.length;

  items.push(parzelleM
    ? { key: "parzelle", label: "Parzelle", status: "pass", detail: "Gezeichnete Parzelle begrenzt den Plan" }
    : { key: "parzelle", label: "Parzelle", status: "offen", detail: "Generische Parzelle — im Tab „Standort & Karte“ zeichnen" });

  if (klima && !klima.offline && klima.zone != null) {
    items.push({ key: "klima", label: "Klimadaten", status: "pass", detail: `Zone ${klima.zone} (T_min ≈ ${klima.tExtrem} °C), ${klima.niederschlag_mm} mm/a${klima.trocken ? " — trocken" : ""}` });
  } else {
    items.push({ key: "klima", label: "Klimadaten", status: "offen", detail: "Offline — Eignung ohne Klimadaten" });
  }

  const eign = base.elemente.map((e) => ({ e, r: eignung(e.typ, { klima, licht: lichtJeElement[e.id] || null }) }));
  const ungeeignet = eign.filter((x) => x.r.status === "ungeeignet").length;
  const bedingt = eign.filter((x) => x.r.status === "bedingt").length;
  items.push(n === 0
    ? { key: "eignung", label: "Standort-Eignung", status: "offen", detail: "Noch keine Pflanzen platziert" }
    : { key: "eignung", label: "Standort-Eignung", status: ungeeignet + bedingt > 0 ? "warn" : "pass", detail: `${n - ungeeignet - bedingt} von ${n} geeignet${bedingt ? `, ${bedingt} bedingt` : ""}${ungeeignet ? `, ${ungeeignet} ungeeignet` : ""}` });

  if (n > 0) {
    const imGebaeude = base.elemente.filter((e) => punktInPolygon(footprint, e)).length;
    const ausserhalb = parzelleM ? base.elemente.filter((e) => !punktInPolygon(parzelleM, e)).length : 0;
    // Crown edge closer than FASSADEN_ABSTAND_M to a footprint edge — approximated by the distance of
    // the stem to the polygon edges.
    const zuNah = base.elemente.filter((e) => { const t = PFLANZEN_TYPEN[e.typ]; if (!t || punktInPolygon(footprint, e)) return false; return abstandZumPolygon(e, footprint) < (t.krone_m / 2) + FASSADEN_ABSTAND_M; }).length;
    items.push({ key: "lage", label: "Lage der Pflanzen", status: imGebaeude + ausserhalb > 0 ? "warn" : "pass", detail: imGebaeude + ausserhalb > 0 ? `${imGebaeude} im Gebäude, ${ausserhalb} außerhalb der Parzelle` : "Alle auf dem Grundstück, keine im Gebäude" });
    items.push({ key: "fassade", label: "Abstand Krone – Fassade", status: zuNah > 0 ? "warn" : "pass", detail: zuNah > 0 ? `${zuNah} Pflanze(n) näher als Kronenradius + ${FASSADEN_ABSTAND_M} m an der Fassade` : `Kronenradius + ${FASSADEN_ABSTAND_M} m eingehalten` });
  }

  const gruen = gruenflaecheAusLayer(base);
  items.push(gruen > 0
    ? { key: "gruen", label: "Grünflächen", status: "pass", detail: `${gruen.toLocaleString("de-DE")} m² gezeichnet → Kennzahlen` }
    : { key: "gruen", label: "Grünflächen", status: "offen", detail: "Keine Grünfläche gezeichnet — Kennzahl bleibt Handeingabe" });
  return items;
}

// Shortest distance (m) from p to the polygon outline.
function abstandZumPolygon(p, poly) {
  const pts = Array.isArray(poly) ? poly : [];
  if (pts.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

/**
 * Quantities per plant type (for the Mengen table and a later AVA hand-over).
 * @param {object} layer
 * @returns {Array<{ typ: string, name: string, gruppe: string, anzahl: number, krone_m2: number }>} krone_m2 = summed crown area (π·r²)
 */
export function pflanzenMengen(layer) {
  const base = layerHardened(layer);
  const map = new Map();
  for (const e of base.elemente) {
    const t = PFLANZEN_TYPEN[e.typ];
    const cur = map.get(e.typ) || { typ: e.typ, name: t?.name || e.typ, gruppe: t?.gruppe || "", anzahl: 0, krone_m2: 0 };
    cur.anzahl += 1;
    cur.krone_m2 = Math.round((cur.krone_m2 + Math.PI * ((t?.krone_m || 0) / 2) ** 2) * 10) / 10;
    map.set(e.typ, cur);
  }
  return [...map.values()].sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, "de"));
}

/**
 * Green (unsealed) area drawn on the plan — feeds landscape.js `gruenflaeche` (GARTEN-04).
 * @param {object} layer
 * @returns {number} m²
 */
export function gruenflaecheAusLayer(layer) {
  const s = flaechenSummen(layer);
  return Math.round(GRUEN_ARTEN.reduce((sum, art) => sum + (s[art] || 0), 0));
}
