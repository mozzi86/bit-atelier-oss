// TGA network model and logic (Phase 41, NETZ-01…04) — the ONE pipe/duct/cable network of the
// app. The Haustechnik tab draws it; Phase 63 (Abwasser: Grundleitungen, Kanalanschluss,
// Gefälle) extends the same records additively instead of adding a second line model
// (REIHENFOLGE-BEREINIGT Block C: "63 darf nicht vor 41").
//
// In:  netz_layer = { version, knoten: [{ id, gewerk, art, level, x, z, name?, levelBis? }],
//                     kanten: [{ id, gewerk, level, dn, von, nach, points: [{x,z}, …] }] }
//      x/z in metres (plan coordinates of BimPlan2D), level = storey (0 = EG), dn in mm
//      (Elektro: conductor cross-section in mm² — same field, unit per Gewerk),
//      store zones [{ points:[{x,z}], level, name }], concept inputs of the Haustechnik panel.
// Out: hardened network, graph queries (strand of a node, path to a source), zone assignment
//      and demands per strand (formulas from hvac.js), checks (pass | warn | offen — never fail,
//      the app's honesty rule), quantities as AVA hand-over, Strangschema layout data.
// Pure functions, no React — unit-tested under Node.

import {
  heizlastKW, lueftungVolumenstrom, trinkwasserBedarf, elektroAnschlusswert,
  DEFAULT_LUFTWECHSEL, DEFAULT_VA_M2, DEFAULT_PERSONEN_JE_WE, DEFAULT_TRINKWASSER_LPD, DEFAULT_GZF,
} from "@designer/lib/hvac";
import { punktImPolygon } from "@designer/lib/moebel";
import { polygonAreaM } from "@core/lib/useBuildingProgram";

// ---- Katalog ------------------------------------------------------------------------------

/**
 * TGA trades of the network. Colours follow drawing habit (red heating, blue air, green
 * potable water, brown waste water, violet electric). dn defaults/lists are [ASSUMED]
 * concept sizes for a residential building — the planner overrides per line.
 * einheit: unit of `dn` for this trade.
 */
export const GEWERKE_TGA = {
  heizung: { label: "Heizung", medium: "Heizwasser", farbe: "#dc2626", dnDefault: 25, dnListe: [15, 20, 25, 32, 40, 50], einheit: "mm" },
  lueftung: { label: "Lüftung", medium: "Luft", farbe: "#2563eb", dnDefault: 160, dnListe: [100, 125, 160, 200, 250, 315], einheit: "mm" },
  trinkwasser: { label: "Trinkwasser", medium: "Kalt-/Warmwasser", farbe: "#16a34a", dnDefault: 20, dnListe: [15, 20, 25, 32], einheit: "mm" },
  abwasser: { label: "Abwasser", medium: "Schmutzwasser", farbe: "#92400e", dnDefault: 100, dnListe: [50, 70, 100, 125, 150, 200], einheit: "mm" }, // 200 added in Phase 63 (Grundleitungen)
  elektro: { label: "Elektro", medium: "Strom", farbe: "#7c3aed", dnDefault: 2.5, dnListe: [1.5, 2.5, 4, 6, 10, 16], einheit: "mm²" },
};
/** Trade keys in catalogue order. */
export const GEWERK_KEYS = Object.keys(GEWERKE_TGA);

/**
 * Node kinds. `strang: true` marks the nodes that head a strand (the target of strangVon);
 * `quelle: true` marks sources a consumer must be able to reach.
 */
export const KNOTEN_ARTEN = {
  erzeuger: { label: "Erzeuger / Zentrale", symbol: "quadrat", strang: true, quelle: true },
  verteiler: { label: "Verteiler", symbol: "raute", strang: true, quelle: false },
  schacht: { label: "Schacht / Steigstrang", symbol: "kreis-gross", strang: true, quelle: false },
  auslass: { label: "Auslass / Verbraucher", symbol: "kreis", strang: false, quelle: false },
  anschluss: { label: "Hausanschluss / Übergabe", symbol: "dreieck", strang: true, quelle: true },
};
/** Node kind keys in catalogue order. */
export const ART_KEYS = Object.keys(KNOTEN_ARTEN);

/** Empty layer (value of BimModel.netz_layer before anything is drawn). */
export const NETZ_DEFAULT = { version: 1, knoten: [], kanten: [] };

/** Snap radius (m) for "click near a node = that node". [ASSUMED] one grid step + slack. */
export const FANG_RADIUS_M = 0.4;
/** Drainage connection value per outlet (DU). [ASSUMED] DIN 1986-100 Tab. 5 lists 0.5–2.5 per fixture. */
export const DU_JE_AUSLASS = 1;
/** Floor area per dwelling for the person estimate (m²/WE), same as the panel's ngf/75. [ASSUMED] */
export const FLAECHE_JE_WE_M2 = 75;

const isPt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
const rnd2 = (v) => Math.round(v * 100) / 100;

// ---- Härtung ------------------------------------------------------------------------------

/**
 * Always returns a valid network: unknown trades/kinds dropped, edges need ≥ 2 finite points,
 * dn is a positive number or null, dangling von/nach become null, levelBis ≥ level.
 * @param {object|null|undefined} layer raw netz_layer
 * @returns {{version:number, knoten:Array<object>, kanten:Array<object>}}
 */
export function netzHardened(layer) {
  const src = layer && typeof layer === "object" ? layer : {};
  const knoten = (Array.isArray(src.knoten) ? src.knoten : [])
    .filter((k) => k && typeof k.id === "string" && GEWERKE_TGA[k.gewerk] && KNOTEN_ARTEN[k.art] && isPt(k))
    .map((k) => {
      const level = Number.isFinite(k.level) ? Math.round(k.level) : 0;
      const levelBis = k.art === "schacht" && Number.isFinite(k.levelBis) ? Math.max(level, Math.round(k.levelBis)) : level;
      return { id: k.id, gewerk: k.gewerk, art: k.art, level, x: k.x, z: k.z, name: typeof k.name === "string" ? k.name : "", levelBis };
    });
  const ids = new Set(knoten.map((k) => k.id));
  const kanten = (Array.isArray(src.kanten) ? src.kanten : [])
    .filter((e) => e && typeof e.id === "string" && GEWERKE_TGA[e.gewerk] && Array.isArray(e.points) && e.points.filter(isPt).length >= 2)
    .map((e) => ({
      id: e.id, gewerk: e.gewerk,
      level: Number.isFinite(e.level) ? Math.round(e.level) : 0,
      dn: Number.isFinite(e.dn) && e.dn > 0 ? e.dn : null,
      von: ids.has(e.von) ? e.von : null,
      nach: ids.has(e.nach) ? e.nach : null,
      points: e.points.filter(isPt).map((p) => ({ x: p.x, z: p.z })),
      // Phase 63 (additive): slope override of a sewage run in %, null = table value per DN (entwaesserung.js).
      gefaelle_pct: Number.isFinite(e.gefaelle_pct) && e.gefaelle_pct > 0 ? e.gefaelle_pct : null,
    }));
  return { version: 1, knoten, kanten };
}

// ---- Geometrie / Abfragen ------------------------------------------------------------------

/**
 * Length of a polyline in metres.
 * @param {Array<{x:number,z:number}>} points
 */
export function kantenLaenge(points) {
  let s = 0;
  for (let i = 1; i < (points || []).length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return s;
}

/** Nodes present on a storey (a schacht spans level…levelBis). */
export function knotenImLevel(netz, level) {
  return (netz?.knoten || []).filter((k) => k.level <= level && level <= (k.levelBis ?? k.level));
}

/** Edges drawn on a storey. */
export function kantenImLevel(netz, level) {
  return (netz?.kanten || []).filter((e) => e.level === level);
}

/**
 * Nearest node on the storey within maxAbstand (m), or null.
 * @param {object} netz
 * @param {number} level
 * @param {{x:number,z:number}} p metres
 * @param {number} [maxAbstand=FANG_RADIUS_M]
 */
export function naechsterKnoten(netz, level, p, maxAbstand = FANG_RADIUS_M) {
  if (!isPt(p)) return null;
  let best = null, bestD = maxAbstand;
  for (const k of knotenImLevel(netz, level)) {
    const d = Math.hypot(k.x - p.x, k.z - p.z);
    if (d <= bestD) { best = k; bestD = d; }
  }
  return best;
}

const naechsteId = (prefix, liste) => {
  let max = 0;
  for (const it of liste || []) {
    const m = /^(?:n|k)_(\d+)$/.exec(String(it.id || ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}_${max + 1}`;
};

/**
 * Add a node. Returns the new network and the node.
 * @param {object} netz
 * @param {{gewerk:string, art:string, level:number, x:number, z:number, name?:string, levelBis?:number}} attrs
 */
export function neuerKnoten(netz, attrs) {
  const base = netzHardened(netz);
  const knoten = {
    id: naechsteId("n", base.knoten), gewerk: attrs.gewerk, art: attrs.art,
    level: Math.round(attrs.level || 0), x: attrs.x, z: attrs.z, name: attrs.name || "",
    levelBis: attrs.art === "schacht" ? Math.max(Math.round(attrs.level || 0), Math.round(attrs.levelBis ?? attrs.level ?? 0)) : Math.round(attrs.level || 0),
  };
  return { netz: { ...base, knoten: [...base.knoten, knoten] }, knoten };
}

/**
 * Add an edge (polyline). Endpoints snap onto the linked nodes' positions.
 * @param {object} netz
 * @param {{gewerk:string, level:number, dn?:number|null, von?:string|null, nach?:string|null, points:Array<{x:number,z:number}>}} attrs
 */
export function neueKante(netz, attrs) {
  const base = netzHardened(netz);
  const byId = new Map(base.knoten.map((k) => [k.id, k]));
  const pts = (attrs.points || []).filter(isPt).map((p) => ({ x: p.x, z: p.z }));
  const von = byId.has(attrs.von) ? attrs.von : null;
  const nach = byId.has(attrs.nach) ? attrs.nach : null;
  if (von) pts[0] = { x: byId.get(von).x, z: byId.get(von).z };
  if (nach && pts.length) pts[pts.length - 1] = { x: byId.get(nach).x, z: byId.get(nach).z };
  if (pts.length < 2) return { netz: base, kante: null };
  const kante = {
    id: naechsteId("k", base.kanten), gewerk: attrs.gewerk, level: Math.round(attrs.level || 0),
    dn: Number.isFinite(attrs.dn) && attrs.dn > 0 ? attrs.dn : null, von, nach, points: pts,
  };
  return { netz: { ...base, kanten: [...base.kanten, kante] }, kante };
}

/**
 * Move a node; the endpoints of its edges follow (von → first point, nach → last point).
 * @param {object} netz
 * @param {string} id
 * @param {{x:number,z:number}} p metres
 */
export function verschiebeKnoten(netz, id, p) {
  const base = netzHardened(netz);
  if (!isPt(p)) return base;
  return {
    ...base,
    knoten: base.knoten.map((k) => (k.id === id ? { ...k, x: p.x, z: p.z } : k)),
    kanten: base.kanten.map((e) => {
      if (e.von !== id && e.nach !== id) return e;
      const pts = e.points.map((q) => ({ ...q }));
      if (e.von === id) pts[0] = { x: p.x, z: p.z };
      if (e.nach === id) pts[pts.length - 1] = { x: p.x, z: p.z };
      return { ...e, points: pts };
    }),
  };
}

/**
 * Patch node attributes (name, gewerk, art, levelBis) — position via verschiebeKnoten.
 */
export function aendereKnoten(netz, id, patch) {
  const base = netzHardened(netz);
  return netzHardened({ ...base, knoten: base.knoten.map((k) => (k.id === id ? { ...k, ...patch, id } : k)) });
}

/** Patch edge attributes (dn, gewerk). */
export function aendereKante(netz, id, patch) {
  const base = netzHardened(netz);
  return netzHardened({ ...base, kanten: base.kanten.map((e) => (e.id === id ? { ...e, ...patch, id } : e)) });
}

/** Remove a node; its edges stay but lose the link (open end → check "warn"). */
export function loescheKnoten(netz, id) {
  const base = netzHardened(netz);
  return {
    ...base,
    knoten: base.knoten.filter((k) => k.id !== id),
    kanten: base.kanten.map((e) => ({ ...e, von: e.von === id ? null : e.von, nach: e.nach === id ? null : e.nach })),
  };
}

/** Remove an edge. */
export function loescheKante(netz, id) {
  const base = netzHardened(netz);
  return { ...base, kanten: base.kanten.filter((e) => e.id !== id) };
}

// ---- Graph --------------------------------------------------------------------------------

function nachbarn(netz) {
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const e of netz.kanten) {
    if (e.von && e.nach) { add(e.von, e.nach); add(e.nach, e.von); }
  }
  return adj;
}

function bfs(netz, startId, stopp) {
  const byId = new Map(netz.knoten.map((k) => [k.id, k]));
  const start = byId.get(startId);
  if (!start) return null;
  if (stopp(start)) return start;
  const adj = nachbarn(netz);
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of adj.get(cur) || []) {
      if (seen.has(n)) continue;
      seen.add(n);
      const k = byId.get(n);
      if (k && stopp(k)) return k;
      queue.push(n);
    }
  }
  return null;
}

/**
 * The strand head of a node: the first node of a strand-heading kind (schacht, verteiler,
 * erzeuger, anschluss) reachable over linked edges — the node itself if it is one. null if
 * the node hangs loose.
 * @param {object} netz hardened or raw
 * @param {string} knotenId
 */
export function strangVon(netz, knotenId) {
  const n = netzHardened(netz);
  return bfs(n, knotenId, (k) => !!KNOTEN_ARTEN[k.art]?.strang);
}

/** Does the node reach a source (erzeuger or anschluss) over linked edges? */
export function erreichtQuelle(netz, knotenId) {
  const n = netzHardened(netz);
  return !!bfs(n, knotenId, (k) => !!KNOTEN_ARTEN[k.art]?.quelle);
}

// ---- Zonen-Zuordnung und Bedarfe (NETZ-04) -----------------------------------------------

const zoneOk = (z) => z && Array.isArray(z.points) && z.points.length >= 3;

/**
 * Which room is served by which strand: an outlet (auslass) inside a zone polygon (same
 * storey) assigns the zone to the outlet's strand — per trade. Zones on a storey where a
 * trade has edges but no outlet inside are "unversorgt".
 * @param {object} netz
 * @param {Array<{points:Array<{x:number,z:number}>, level?:number, name?:string}>} zones
 * @returns {{zuordnung: Array<{zoneIndex:number, gewerk:string, strangId:string|null, auslassId:string}>, unversorgt: Array<{zoneIndex:number, gewerk:string}>}}
 */
export function zonenZuordnung(netz, zones) {
  const n = netzHardened(netz);
  const zuordnung = [], unversorgt = [];
  const gewerkeJeLevel = new Map();
  for (const e of n.kanten) {
    if (!gewerkeJeLevel.has(e.level)) gewerkeJeLevel.set(e.level, new Set());
    gewerkeJeLevel.get(e.level).add(e.gewerk);
  }
  (zones || []).forEach((z, zoneIndex) => {
    if (!zoneOk(z)) return;
    const level = z.level ?? 0;
    const gewerke = gewerkeJeLevel.get(level);
    if (!gewerke) return;
    const drin = n.knoten.filter((k) => k.art === "auslass" && k.level === level && punktImPolygon(k.x, k.z, z.points));
    for (const g of gewerke) {
      const a = drin.find((k) => k.gewerk === g);
      if (a) zuordnung.push({ zoneIndex, gewerk: g, strangId: strangVon(n, a.id)?.id ?? null, auslassId: a.id });
      else unversorgt.push({ zoneIndex, gewerk: g });
    }
  });
  return { zuordnung, unversorgt };
}

/**
 * Demands per strand from the served zones — formulas from hvac.js, inputs from the
 * Haustechnik concept (all [ASSUMED] concept values, never a design calculation).
 * @param {object} netz
 * @param {Array<object>} zones
 * @param {{qHeizlast?:number, storeyHeight?:number, luftwechsel?:number, vaM2?:number, personenJeWe?:number, trinkwasserLpd?:number, gzf?:number}} [opts]
 *   qHeizlast W/m², storeyHeight m, luftwechsel 1/h, vaM2 VA/m², trinkwasserLpd l/(P·d)
 * @returns {Array<{strangId:string|null, gewerk:string, name:string, raeume:number, flaeche_m2:number, auslaesse:number, kennwert:number, einheit:string, assumed:boolean}>}
 */
export function strangKennwerte(netz, zones, opts = {}) {
  const n = netzHardened(netz);
  const {
    qHeizlast = 50, storeyHeight = 3, luftwechsel = DEFAULT_LUFTWECHSEL, vaM2 = DEFAULT_VA_M2,
    personenJeWe = DEFAULT_PERSONEN_JE_WE, trinkwasserLpd = DEFAULT_TRINKWASSER_LPD, gzf = DEFAULT_GZF,
  } = opts;
  const byId = new Map(n.knoten.map((k) => [k.id, k]));
  const { zuordnung } = zonenZuordnung(n, zones);
  const gruppen = new Map();
  for (const zu of zuordnung) {
    const key = `${zu.gewerk}|${zu.strangId ?? "-"}`;
    if (!gruppen.has(key)) gruppen.set(key, { strangId: zu.strangId, gewerk: zu.gewerk, zonen: new Set(), auslaesse: new Set(), flaeche: 0 });
    const g = gruppen.get(key);
    if (!g.zonen.has(zu.zoneIndex)) { g.zonen.add(zu.zoneIndex); g.flaeche += polygonAreaM(zones[zu.zoneIndex].points); }
    g.auslaesse.add(zu.auslassId);
  }
  const out = [];
  for (const g of gruppen.values()) {
    const kopf = g.strangId ? byId.get(g.strangId) : null;
    const name = kopf ? (kopf.name || `${KNOTEN_ARTEN[kopf.art].label} ${kopf.id}`) : "ohne Strang";
    let kennwert = 0, einheit = "";
    const A = g.flaeche;
    switch (g.gewerk) {
      case "heizung": kennwert = heizlastKW(qHeizlast, A); einheit = "kW"; break;                       // q · A / 1000
      case "lueftung": kennwert = lueftungVolumenstrom({ basis: "luftwechsel", n: luftwechsel, volumen: A * storeyHeight }); einheit = "m³/h"; break; // n · V
      case "trinkwasser": kennwert = trinkwasserBedarf((A / FLAECHE_JE_WE_M2) * personenJeWe, trinkwasserLpd); einheit = "l/d"; break; // Personen ≈ A/75 · 2,5
      case "elektro": kennwert = elektroAnschlusswert({ basis: "va-m2", vaM2, bezugsflaeche: A, gzf }); einheit = "kW"; break;   // VA/m² · A · GZF / 1000
      case "abwasser": kennwert = g.auslaesse.size * DU_JE_AUSLASS; einheit = "DU"; break;                // [ASSUMED] 1 DU je Auslass
      default: break;
    }
    out.push({ strangId: g.strangId, gewerk: g.gewerk, name, raeume: g.zonen.size, flaeche_m2: rnd2(A), auslaesse: g.auslaesse.size, kennwert: rnd2(kennwert), einheit, assumed: true });
  }
  return out.sort((a, b) => GEWERK_KEYS.indexOf(a.gewerk) - GEWERK_KEYS.indexOf(b.gewerk) || a.name.localeCompare(b.name, "de"));
}

// ---- Checks (nur pass / warn / offen) ----------------------------------------------------

/**
 * Concept checks. Never "fail": the network is a planning aid, not a proof (T-17-04 rule).
 * @param {object} netz
 * @param {Array<object>} [zones]
 * @returns {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>}
 */
export function netzChecks(netz, zones = []) {
  const n = netzHardened(netz);
  /** @type {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>} */
  const items = [];
  const leer = n.knoten.length === 0 && n.kanten.length === 0;
  items.push({ key: "netz", label: "Netz gezeichnet", status: leer ? "offen" : "pass", detail: leer ? "Noch keine Knoten oder Leitungen." : `${n.knoten.length} Knoten, ${n.kanten.length} Leitungen` });

  const offen = n.kanten.filter((e) => !e.von || !e.nach);
  items.push({ key: "offene_kanten", label: "Leitungen beidseitig verknüpft", status: n.kanten.length === 0 ? "offen" : offen.length ? "warn" : "pass",
    detail: n.kanten.length === 0 ? "Noch keine Leitungen." : offen.length ? `${offen.length} Leitung(en) mit offenem Ende — an Knoten anschließen.` : "Alle Leitungen enden an Knoten." });

  const auslaesse = n.knoten.filter((k) => k.art === "auslass");
  const lose = auslaesse.filter((k) => !erreichtQuelle(n, k.id));
  items.push({ key: "auslaesse_versorgt", label: "Auslässe an einer Quelle", status: auslaesse.length === 0 ? "offen" : lose.length ? "warn" : "pass",
    detail: auslaesse.length === 0 ? "Keine Auslässe gesetzt." : lose.length ? `${lose.length} Auslass/Auslässe ohne Weg zu Erzeuger oder Hausanschluss.` : `${auslaesse.length} Auslässe erreichen eine Quelle.` });

  const { unversorgt } = zonenZuordnung(n, zones);
  const zonenDa = (zones || []).some(zoneOk);
  items.push({ key: "zonen_versorgt", label: "Räume mit Auslass je Gewerk", status: !zonenDa || n.kanten.length === 0 ? "offen" : unversorgt.length ? "warn" : "pass",
    detail: !zonenDa ? "Keine Räume im Gebäudemodell." : n.kanten.length === 0 ? "Noch keine Leitungen." : unversorgt.length ? `${unversorgt.length} Raum/Gewerk-Paare ohne Auslass (${[...new Set(unversorgt.map((u) => GEWERKE_TGA[u.gewerk].label))].join(", ")}).` : "Jeder Raum hat je gezeichnetem Gewerk einen Auslass." });

  const schaechte = n.knoten.filter((k) => k.art === "schacht");
  const ohneKante = schaechte.filter((s) => !n.kanten.some((e) => e.von === s.id || e.nach === s.id));
  items.push({ key: "schaechte", label: "Schächte angeschlossen", status: schaechte.length === 0 ? "offen" : ohneKante.length ? "warn" : "pass",
    detail: schaechte.length === 0 ? "Kein Schacht/Steigstrang gesetzt." : ohneKante.length ? `${ohneKante.length} Schacht/Schächte ohne Leitung.` : `${schaechte.length} Schacht/Schächte mit Leitungen.` });

  const ohneDn = n.kanten.filter((e) => e.dn == null);
  items.push({ key: "dn", label: "Nennweiten gesetzt", status: n.kanten.length === 0 ? "offen" : ohneDn.length ? "offen" : "pass",
    detail: n.kanten.length === 0 ? "Noch keine Leitungen." : ohneDn.length ? `${ohneDn.length} Leitung(en) ohne Nennweite.` : "Alle Leitungen haben eine Nennweite (Richtwert)." });

  return items;
}

// ---- Mengen (AVA-Übergabe) ---------------------------------------------------------------

/**
 * Quantities: running metres per trade and dn, node counts per trade and kind, strand count.
 * @param {object} netz
 * @returns {{lfm: Array<{gewerk:string, dn:number|null, lfm:number}>, knoten: Array<{gewerk:string, art:string, stk:number}>, straenge_stk:number, kanten_stk:number}}
 */
export function netzMengen(netz) {
  const n = netzHardened(netz);
  const lfm = new Map();
  for (const e of n.kanten) {
    const key = `${e.gewerk}|${e.dn ?? "-"}`;
    lfm.set(key, (lfm.get(key) || 0) + kantenLaenge(e.points));
  }
  const kn = new Map();
  for (const k of n.knoten) {
    const key = `${k.gewerk}|${k.art}`;
    kn.set(key, (kn.get(key) || 0) + 1);
  }
  const ord = (g) => GEWERK_KEYS.indexOf(g);
  return {
    lfm: [...lfm.entries()].map(([key, m]) => { const [gewerk, dn] = key.split("|"); return { gewerk, dn: dn === "-" ? null : Number(dn), lfm: rnd2(m) }; })
      .sort((a, b) => ord(a.gewerk) - ord(b.gewerk) || (a.dn ?? 0) - (b.dn ?? 0)),
    knoten: [...kn.entries()].map(([key, stk]) => { const [gewerk, art] = key.split("|"); return { gewerk, art, stk }; })
      .sort((a, b) => ord(a.gewerk) - ord(b.gewerk) || ART_KEYS.indexOf(a.art) - ART_KEYS.indexOf(b.art)),
    straenge_stk: n.knoten.filter((k) => KNOTEN_ARTEN[k.art].strang).length,
    kanten_stk: n.kanten.length,
  };
}

// ---- Strangschema (NETZ-02) — Layout-Daten, keine Grafik -----------------------------------

/**
 * Data for the auto-generated riser diagram: one column per strand head, one row per storey,
 * per cell the incident edges and the outlets served on that storey. The SVG component only draws.
 * @param {object} netz
 * @param {number} storeys number of storeys (rows 0…storeys−1)
 * @returns {{spalten: Array<{strangId:string, gewerk:string, art:string, name:string, levelVon:number, levelBis:number}>, zeilen: number[], zellen: Array<{strangId:string, level:number, kanten:number, auslaesse:number}>}}
 */
export function strangschema(netz, storeys) {
  const n = netzHardened(netz);
  const rows = Math.max(1, Math.round(storeys || 1));
  const koepfe = n.knoten.filter((k) => KNOTEN_ARTEN[k.art].strang)
    .sort((a, b) => GEWERK_KEYS.indexOf(a.gewerk) - GEWERK_KEYS.indexOf(b.gewerk) || a.x - b.x || a.z - b.z);
  const spalten = koepfe.map((k) => ({ strangId: k.id, gewerk: k.gewerk, art: k.art, name: k.name || `${KNOTEN_ARTEN[k.art].label} ${k.id}`, levelVon: k.level, levelBis: k.levelBis ?? k.level }));
  const strangJeAuslass = new Map(n.knoten.filter((k) => k.art === "auslass").map((k) => [k.id, strangVon(n, k.id)?.id ?? null]));
  const zellen = [];
  for (const sp of spalten) {
    for (let level = sp.levelVon; level <= Math.min(sp.levelBis, rows - 1); level++) {
      const kanten = n.kanten.filter((e) => e.level === level && (e.von === sp.strangId || e.nach === sp.strangId)).length;
      const auslaesse = n.knoten.filter((k) => k.art === "auslass" && k.level === level && strangJeAuslass.get(k.id) === sp.strangId).length;
      zellen.push({ strangId: sp.strangId, level, kanten, auslaesse });
    }
  }
  return { spalten, zeilen: Array.from({ length: rows }, (_, i) => i), zellen };
}
