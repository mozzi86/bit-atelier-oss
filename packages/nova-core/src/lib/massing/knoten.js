// Parametric node graph for the Massing Studio (phase 98-07, user brief 17.10.2026: "Grasshopper-
// like connectors for parametric design patterns"). Nodes have typed inputs and outputs; wires
// connect an output to an input; the graph is evaluated in topological order (Kahn) and yields
// bodies (profile + height) that the studio shows as a preview and can "bake" into the massing
// layer. Pure functions, no DOM.
//
// Value types: zahl (number), liste (numbers), profil (polygon, site metres), profile (polygons),
// koerper (bodies {profil, hoehe}). A list input accepts a single number too (broadcast).
//
// In: graph {knoten: [{id, typ, x, y, werte}], kanten: [{von, aus, nach, ein}]}.
// Out: { werte: Map nodeId → outputs, fehler: Map nodeId → text, koerper: [{profil, hoehe}] }.

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const zahl = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const alsListe = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const verschiebeProfil = (p, dx, dy) => p.map((q) => ({ x: r6(q.x + dx), y: r6(q.y + dy) }));
const mitte = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });

/**
 * @typedef {{name: string, typ: string, standard?: any}} Port
 * @typedef {{label: string, ein: Port[], aus: Port[], felder?: Array<{name: string, standard: number, min?: number, max?: number, schritt?: number}>, rechne: (e: Record<string, any>) => Record<string, any>}} KnotenTyp
 */

/** @type {Readonly<Record<string, KnotenTyp>>} */
export const KNOTEN_TYPEN = Object.freeze({
  zahl: { label: "Zahl", ein: [], aus: [{ name: "wert", typ: "zahl" }], felder: [{ name: "wert", standard: 10 }],
    rechne: (e) => ({ wert: zahl(e.wert) }) },
  regler: { label: "Regler", ein: [], aus: [{ name: "wert", typ: "zahl" }], felder: [{ name: "wert", standard: 5, min: 0, max: 50, schritt: 0.5 }],
    rechne: (e) => ({ wert: zahl(e.wert) }) },
  rechteck: { label: "Rechteck", ein: [{ name: "breite", typ: "zahl", standard: 12 }, { name: "tiefe", typ: "zahl", standard: 10 }, { name: "x", typ: "zahl", standard: 0 }, { name: "y", typ: "zahl", standard: 0 }],
    aus: [{ name: "profil", typ: "profil" }],
    rechne: (e) => {
      const b = zahl(e.breite, 12), t = zahl(e.tiefe, 10), x = zahl(e.x), y = zahl(e.y);
      if (!(b > 0 && t > 0)) throw new Error("Breite und Tiefe müssen > 0 sein");
      return { profil: [{ x, y }, { x: x + b, y }, { x: x + b, y: y + t }, { x, y: y + t }] };
    } },
  vieleck: { label: "Vieleck", ein: [{ name: "radius", typ: "zahl", standard: 6 }, { name: "ecken", typ: "zahl", standard: 6 }, { name: "x", typ: "zahl", standard: 0 }, { name: "y", typ: "zahl", standard: 0 }],
    aus: [{ name: "profil", typ: "profil" }],
    rechne: (e) => {
      const rad = zahl(e.radius, 6), n = Math.max(3, Math.min(64, Math.round(zahl(e.ecken, 6))));
      if (!(rad > 0)) throw new Error("Radius muss > 0 sein");
      return { profil: Array.from({ length: n }, (_, i) => ({ x: r6(zahl(e.x) + rad * Math.cos((2 * Math.PI * i) / n)), y: r6(zahl(e.y) + rad * Math.sin((2 * Math.PI * i) / n)) })) };
    } },
  reihe: { label: "Reihe", ein: [{ name: "profil", typ: "profil" }, { name: "anzahl", typ: "zahl", standard: 4 }, { name: "dx", typ: "zahl", standard: 15 }, { name: "dy", typ: "zahl", standard: 0 }],
    aus: [{ name: "profile", typ: "profile" }],
    rechne: (e) => {
      if (!Array.isArray(e.profil)) throw new Error("Profil fehlt");
      const n = Math.max(1, Math.min(200, Math.round(zahl(e.anzahl, 4))));
      return { profile: Array.from({ length: n }, (_, i) => verschiebeProfil(e.profil, i * zahl(e.dx, 15), i * zahl(e.dy))) };
    } },
  raster: { label: "Raster", ein: [{ name: "profil", typ: "profil" }, { name: "nx", typ: "zahl", standard: 3 }, { name: "ny", typ: "zahl", standard: 3 }, { name: "dx", typ: "zahl", standard: 15 }, { name: "dy", typ: "zahl", standard: 15 }],
    aus: [{ name: "profile", typ: "profile" }],
    rechne: (e) => {
      if (!Array.isArray(e.profil)) throw new Error("Profil fehlt");
      const nx = Math.max(1, Math.min(50, Math.round(zahl(e.nx, 3)))), ny = Math.max(1, Math.min(50, Math.round(zahl(e.ny, 3))));
      const out = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push(verschiebeProfil(e.profil, i * zahl(e.dx, 15), j * zahl(e.dy, 15)));
      return { profile: out };
    } },
  hoehenreihe: { label: "Höhenreihe", ein: [{ name: "start", typ: "zahl", standard: 6 }, { name: "schritt", typ: "zahl", standard: 3 }, { name: "anzahl", typ: "zahl", standard: 4 }],
    aus: [{ name: "liste", typ: "liste" }],
    rechne: (e) => ({ liste: Array.from({ length: Math.max(1, Math.min(500, Math.round(zahl(e.anzahl, 4)))) }, (_, i) => r6(zahl(e.start, 6) + i * zahl(e.schritt, 3))) }) },
  attraktor: { label: "Attraktor", ein: [{ name: "profile", typ: "profile" }, { name: "x", typ: "zahl", standard: 0 }, { name: "y", typ: "zahl", standard: 0 }, { name: "hmin", typ: "zahl", standard: 6 }, { name: "hmax", typ: "zahl", standard: 30 }, { name: "radius", typ: "zahl", standard: 40 }],
    aus: [{ name: "liste", typ: "liste" }],
    // Height falls linearly from hmax at the attractor point to hmin at `radius` m and beyond.
    rechne: (e) => {
      const ps = alsListe(e.profile);
      const rad = Math.max(0.01, zahl(e.radius, 40)), hmin = zahl(e.hmin, 6), hmax = zahl(e.hmax, 30);
      return { liste: ps.map((p) => { const m = mitte(p); const d = Math.hypot(m.x - zahl(e.x), m.y - zahl(e.y)); return r6(hmax - (hmax - hmin) * Math.min(1, d / rad)); }) };
    } },
  drehen: { label: "Drehen", ein: [{ name: "profile", typ: "profile" }, { name: "winkel", typ: "liste", standard: 0 }],
    aus: [{ name: "profile", typ: "profile" }],
    rechne: (e) => {
      const ws = alsListe(e.winkel);
      return { profile: alsListe(e.profile).map((p, i) => {
        const w = (zahl(ws.length ? ws[Math.min(i, ws.length - 1)] : 0) * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w), m = mitte(p);
        return p.map((q) => ({ x: r6(m.x + (q.x - m.x) * c - (q.y - m.y) * s), y: r6(m.y + (q.x - m.x) * s + (q.y - m.y) * c) }));
      }) };
    } },
  extrudieren: { label: "Extrudieren", ein: [{ name: "profile", typ: "profile" }, { name: "hoehe", typ: "liste", standard: 9 }],
    aus: [{ name: "koerper", typ: "koerper" }],
    // A list of heights is matched index by index; the last height repeats (Grasshopper "longest list").
    rechne: (e) => {
      const ps = Array.isArray(e.profile) && Array.isArray(e.profile[0]) ? e.profile : Array.isArray(e.profile) ? [e.profile] : [];
      if (!ps.length) throw new Error("Profile fehlen");
      const hs = alsListe(e.hoehe ?? 9);
      return { koerper: ps.map((p, i) => ({ profil: p, hoehe: Math.max(0.01, zahl(hs[Math.min(i, hs.length - 1)], 9)) })) };
    } },
});

/** Ports that accept a value of `typ` (profil fits profile; zahl fits liste). */
export function passt(aus, ein) {
  return aus === ein || (aus === "profil" && ein === "profile") || (aus === "zahl" && ein === "liste");
}

/**
 * Evaluate the graph. Errors stay at their node (and nodes depending on it get "Eingang fehlt"),
 * never a throw — the editor shows them on the node.
 * @param {{knoten: Array<{id: string, typ: string, werte?: Record<string, number>}>, kanten: Array<{von: string, aus: string, nach: string, ein: string}>}} graph
 * @returns {{werte: Map<string, Record<string, any>>, fehler: Map<string, string>, koerper: Array<{profil: Array<{x:number,y:number}>, hoehe: number, knoten: string}>}}
 */
export function auswerten(graph) {
  const knoten = Array.isArray(graph?.knoten) ? graph.knoten : [];
  const kanten = Array.isArray(graph?.kanten) ? graph.kanten : [];
  const werte = new Map(), fehler = new Map();
  const grad = new Map(knoten.map((k) => [k.id, 0]));
  for (const k of kanten) if (grad.has(k.nach) && grad.has(k.von)) grad.set(k.nach, grad.get(k.nach) + 1);
  const warte = knoten.filter((k) => grad.get(k.id) === 0).map((k) => k.id);
  const reihenfolge = [];
  while (warte.length) {
    const id = /** @type {string} */ (warte.shift());
    reihenfolge.push(id);
    for (const k of kanten.filter((x) => x.von === id)) { grad.set(k.nach, grad.get(k.nach) - 1); if (grad.get(k.nach) === 0) warte.push(k.nach); }
  }
  for (const k of knoten) if (!reihenfolge.includes(k.id)) fehler.set(k.id, "Zyklus — Verbindung im Kreis");
  for (const id of reihenfolge) {
    const k = /** @type {any} */ (knoten.find((x) => x.id === id));
    const typ = KNOTEN_TYPEN[k.typ];
    if (!typ) { fehler.set(id, `Unbekannter Knoten: ${k.typ}`); continue; }
    const eingaben = { ...Object.fromEntries((typ.felder || []).map((f) => [f.name, k.werte?.[f.name] ?? f.standard])) };
    for (const port of typ.ein) eingaben[port.name] = k.werte?.[port.name] ?? port.standard;
    let blockiert = false;
    for (const kante of kanten.filter((x) => x.nach === id)) {
      if (fehler.has(kante.von)) { blockiert = true; continue; }
      eingaben[kante.ein] = werte.get(kante.von)?.[kante.aus];
    }
    if (blockiert) { fehler.set(id, "Eingang fehlt (Fehler davor)"); continue; }
    try { werte.set(id, typ.rechne(eingaben)); } catch (e) { fehler.set(id, String(/** @type {any} */ (e)?.message || e)); }
  }
  const koerper = [];
  for (const k of knoten) {
    if (k.typ !== "extrudieren" || fehler.has(k.id) || kanten.some((x) => x.von === k.id)) continue;
    for (const b of werte.get(k.id)?.koerper || []) koerper.push({ ...b, knoten: k.id });
  }
  return { werte, fehler, koerper };
}

/**
 * Starter graph: a rectangle repeated in a 3 × 2 grid, heights from an attractor — the classic
 * first Grasshopper exercise. Laid out to fit a 580 × 360 px editor without scrolling.
 * @param {{x: number, y: number}} mitteSite centre of the drawing area (site metres)
 */
export function beispielGraph(mitteSite) {
  return {
    knoten: [
      { id: "n1", typ: "rechteck", x: 10, y: 10, werte: { breite: 10, tiefe: 8, x: mitteSite.x - 25, y: mitteSite.y - 15 } },
      { id: "n2", typ: "raster", x: 200, y: 10, werte: { nx: 3, ny: 2, dx: 18, dy: 16 } },
      { id: "n3", typ: "attraktor", x: 10, y: 150, werte: { x: mitteSite.x - 25, y: mitteSite.y - 15, hmin: 6, hmax: 24, radius: 45 } },
      { id: "n4", typ: "extrudieren", x: 390, y: 10, werte: {} },
    ],
    kanten: [
      { von: "n1", aus: "profil", nach: "n2", ein: "profil" },
      { von: "n2", aus: "profile", nach: "n3", ein: "profile" },
      { von: "n2", aus: "profile", nach: "n4", ein: "profile" },
      { von: "n3", aus: "liste", nach: "n4", ein: "hoehe" },
    ],
  };
}
