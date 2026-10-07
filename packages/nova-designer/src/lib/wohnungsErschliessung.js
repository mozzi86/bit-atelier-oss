// Apartment access graph + door geometry (Plan 75-14, MSB-17/MSB-18, requirement
// MS-07/MSB-14). User brief (04.10.2026): "man kommt in die wohnung rein man sieht
// keine türen und man sieht keine diele … die zimmer nicht zugänglich weil der flur
// nicht zu allen zimmern führt". Decision D-P75-14-C: NO walk-through rooms, ever —
// every room is reached from the hall (Diele) or the apartment corridor; an open
// kitchen counts as part of the living room, not as a walk-through.
//
// In:  room zones of ONE apartment as tesselierung.js emits them in raumzonen mode
//      ({ points:[{x,z}] (clear metres), level, name, we, art, raumart, tueren? }).
//      Door data lives ON the zone: tueren[] = { wand, u_m, breite_m, aufschlag, nach }
//      — wand = edge index of the zone polygon (edge i runs points[i] → points[i+1]),
//      u_m = metres from the edge start to the hinge-side jamb, breite_m = raw opening
//      width, aufschlag "links"|"rechts" = hinge at the u_m end | at the u_m+breite end,
//      nach = name of the zone the door opens FROM (hall / corridor), null = apartment
//      entrance door (opens from the building corridor).
// Out: reachability sets, graph (nodes/edges) for the UI, door geometry in metres for
//      drawing (leaf, 90° arc) and for the wardrobe-wall swing check (raumQualitaet).
//
// Pure module: no React, no store. tesselierung.js stays import-free, so this module
// imports the door constants FROM it (allowed direction) and never the other way.

import { TUERBREITEN, TUER_ANSCHLAG_ABSTAND } from "@designer/lib/tesselierung";

export { TUERBREITEN, TUER_ANSCHLAG_ABSTAND };

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Minimum shared wall length (m) for the LEGACY adjacency fallback — zones without any
 * `tueren` field (tesselation run without the 75-14 rule). A room door needs its raw
 * opening (0,885 m, DIN 18100) plus a jamb distance on each side (2 × 0,15 m) = 1,185 m;
 * a shorter shared wall cannot take a door, so the room counts as unreachable.
 * Only used to approximate reachability of legacy results.
 */
export const ADJAZENZ_MIN_M = TUERBREITEN.zimmer + 2 * TUER_ANSCHLAG_ABSTAND;

/**
 * Minimum shared edge (m) between kitchen and living room for the "open kitchen" reading
 * (D-P75-14-C: an open kitchen is part of the living room, not a walk-through).
 * [ASSUMED] 1.0 m — below that the two rooms only touch at a corner.
 */
export const OFFENE_KUECHE_MIN_M = 1.0;

/** Is this zone part of the apartment's own circulation (hall, corridor)? */
export function istFlurZone(z) {
  return !!z && (z.art === "flur" || z.raumart === "flur");
}

/** Short classification helpers (name-based like wohnMoebel.raumTypFuer — the presets
 *  file all living rooms under art "aufenthalt"). */
const istWohnraum = (z) => z?.art === "aufenthalt" && /wohn|ess/i.test(String(z?.name || ""));
const istKueche = (z) => z?.art === "kueche";
const istSanitaer = (z) => z?.art === "sanitaer";

/**
 * Edges of a zone polygon, closed ring.
 * @param {{points?: Array<{x:number,z:number}>}} zone
 * @returns {Array<{i:number, a:{x:number,z:number}, b:{x:number,z:number}, laenge:number}>}
 */
export function kantenVon(zone) {
  const pts = Array.isArray(zone?.points) ? zone.points : [];
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    const laenge = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z));
    if (laenge < 1e-9) continue;
    out.push({ i, a: { x: num(a.x), z: num(a.z) }, b: { x: num(b.x), z: num(b.z) }, laenge });
  }
  return out;
}

/**
 * Signed polygon area (shoelace) — sign tells the ring orientation, used to find the
 * inward normal of an edge without assuming a point order.
 */
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += num(p.x) * num(q.z) - num(q.x) * num(p.z);
  }
  return a / 2;
}

/**
 * Inward unit normal of edge `kante` of `zone` (metres, x/z).
 * @param {{points: Array<{x:number,z:number}>}} zone
 * @param {{a:{x:number,z:number}, b:{x:number,z:number}, laenge:number}} kante
 * @returns {{x:number,z:number}}
 */
export function innenNormale(zone, kante) {
  const dx = (kante.b.x - kante.a.x) / kante.laenge;
  const dz = (kante.b.z - kante.a.z) / kante.laenge;
  // Left normal of the edge direction; for a positive signed area (in x/z with z down
  // on the plan) the interior lies on the left, otherwise on the right.
  const links = { x: -dz, z: dx };
  return signedArea(zone.points) > 0 ? links : { x: dz, z: -dx };
}

/**
 * Longest collinear overlap between an edge of zone A and an edge of zone B — the wall
 * the two rooms share. Tolerance 2 cm [ASSUMED: tesselation rounds nothing, so the
 * zones meet exactly; the tolerance only absorbs float noise].
 * @param {{points: Array<{x:number,z:number}>}} zoneA
 * @param {{points: Array<{x:number,z:number}>}} zoneB
 * @param {number} [tol] metres
 * @returns {{kanteA:number, kanteB:number, a:{x:number,z:number}, b:{x:number,z:number}, laenge:number, uA0:number, uA1:number}|null}
 *   uA0/uA1 = overlap interval in metres along edge kanteA (from its start)
 */
export function gemeinsameKante(zoneA, zoneB, tol = 0.02) {
  let best = null;
  for (const ka of kantenVon(zoneA)) {
    const dx = (ka.b.x - ka.a.x) / ka.laenge, dz = (ka.b.z - ka.a.z) / ka.laenge;
    for (const kb of kantenVon(zoneB)) {
      // Both endpoints of kb must lie on the LINE of ka (perpendicular distance < tol).
      const dist = (p) => Math.abs((p.x - ka.a.x) * dz - (p.z - ka.a.z) * dx);
      if (dist(kb.a) >= tol || dist(kb.b) >= tol) continue;
      const u = (p) => (p.x - ka.a.x) * dx + (p.z - ka.a.z) * dz;
      const u0 = Math.max(0, Math.min(u(kb.a), u(kb.b)));
      const u1 = Math.min(ka.laenge, Math.max(u(kb.a), u(kb.b)));
      const laenge = u1 - u0;
      if (laenge <= tol) continue;
      if (!best || laenge > best.laenge) {
        best = {
          kanteA: ka.i, kanteB: kb.i, laenge, uA0: u0, uA1: u1,
          a: { x: ka.a.x + dx * u0, z: ka.a.z + dz * u0 },
          b: { x: ka.a.x + dx * u1, z: ka.a.z + dz * u1 },
        };
      }
    }
  }
  return best;
}

/**
 * Door geometry in metres from the zone edge the door sits in: hinge, closed leaf end,
 * open leaf end (90° into the room, i.e. along the inward normal), the arc as a 9-point
 * polyline (no SVG arc flags — same approach as wohnMoebel.tuerAufschlag) and the swing
 * bounding box for collision checks.
 * @param {{points: Array<{x:number,z:number}>}} zone room the door belongs to
 * @param {{wand:number, u_m:number, breite_m:number, aufschlag?:string}} tuer door record
 * @returns {{scharnier:{x:number,z:number}, geschlossen:{x:number,z:number}, offen:{x:number,z:number},
 *   bogen:Array<{x:number,z:number}>, normale:{x:number,z:number}, richtung:{x:number,z:number},
 *   aabb:{x0:number,z0:number,x1:number,z1:number}, breite:number}|null} null when the edge does not exist
 */
export function tuerGeometrie(zone, tuer) {
  const kante = kantenVon(zone).find((k) => k.i === num(tuer?.wand, -1));
  if (!kante) return null;
  const b = Math.max(0.1, num(tuer.breite_m, TUERBREITEN.zimmer));
  const richtung = { x: (kante.b.x - kante.a.x) / kante.laenge, z: (kante.b.z - kante.a.z) / kante.laenge };
  const normale = innenNormale(zone, kante);
  const u0 = Math.max(0, Math.min(kante.laenge - b, num(tuer.u_m)));
  const p0 = { x: kante.a.x + richtung.x * u0, z: kante.a.z + richtung.z * u0 };
  const p1 = { x: p0.x + richtung.x * b, z: p0.z + richtung.z * b };
  const rechts = tuer.aufschlag === "rechts";
  const scharnier = rechts ? p1 : p0;
  const geschlossen = rechts ? p0 : p1;
  const offen = { x: scharnier.x + normale.x * b, z: scharnier.z + normale.z * b };
  const a0 = Math.atan2(geschlossen.z - scharnier.z, geschlossen.x - scharnier.x);
  const a1 = Math.atan2(offen.z - scharnier.z, offen.x - scharnier.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const bogen = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = a0 + (delta * i) / 8;
    bogen.push({ x: scharnier.x + Math.cos(a) * b, z: scharnier.z + Math.sin(a) * b });
  }
  const xs = [scharnier.x, geschlossen.x, offen.x], zs = [scharnier.z, geschlossen.z, offen.z];
  return {
    scharnier, geschlossen, offen, bogen, normale, richtung, breite: b,
    aabb: { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) },
  };
}

/**
 * Reachability of the rooms of ONE apartment from its hall/corridor (D-P75-14-C).
 *
 * Roots are the zones with art/raumart "flur" of this apartment (hall "Diele",
 * apartment corridor). A room is reachable when it has a door whose `nach` names a
 * reachable zone — walk-through rooms never count. Two readings are allowed on top:
 *  - open kitchen: a kitchen WITHOUT a door of its own that shares ≥ OFFENE_KUECHE_MIN_M
 *    of wall with a reachable living room is part of that room (edge type "offen");
 *  - legacy approximation: when NO zone carries a `tueren` field (tesselation without
 *    the 75-14 rule) a room counts as reachable when it shares ≥ ADJAZENZ_MIN_M of wall
 *    with a root (edge type "adjazenz", result.naeherung = true) — that is how the
 *    user's screenshot apartment yields 3 unreachable rooms, not 5.
 * A bathroom/WC whose only door opens from a non-circulation room is a fail
 * (`fehler`), reachable or not.
 *
 * @param {Array<object>} zonen zones of one apartment (other units are ignored when `we` is given)
 * @param {{we?: string, offeneKueche?: boolean}} [opts]
 * @returns {{ erreichbar: Set<string>, unerreichbar: string[], diele: boolean, naeherung: boolean,
 *   graph: { knoten: Array<{name:string, art?:string, wurzel:boolean}>, kanten: Array<{von:string, nach:string, typ:"tuer"|"offen"|"adjazenz"}> },
 *   fehler: Array<{raum:string, regel:string, text:string}> }}
 */
export function erreichbarkeit(zonen, opts = {}) {
  const we = opts?.we;
  const offeneKueche = opts?.offeneKueche !== false;
  // 75-13: balcony zones belong to the unit but are outside the envelope — never a room to reach.
  const liste = (Array.isArray(zonen) ? zonen : []).filter((z) => z && Array.isArray(z.points) && z.raumart !== "balkon" && (we === undefined || String(z.we ?? "") === String(we)));
  const byName = new Map(liste.map((z) => [String(z.name), z]));
  const wurzeln = liste.filter(istFlurZone);
  const erreichbar = new Set(wurzeln.map((z) => String(z.name)));
  /** @type {Array<{von:string, nach:string, typ:"tuer"|"offen"|"adjazenz"}>} */
  const kanten = [];
  /** @type {Array<{raum:string, regel:string, text:string}>} */
  const fehler = [];
  const naeherung = !liste.some((z) => Array.isArray(z.tueren));

  // Roots connected among themselves by shared walls (a hall touching its corridor
  // strip is one circulation space even without a door between them).
  for (const a of wurzeln) for (const b of wurzeln) {
    if (a === b) continue;
    const g = gemeinsameKante(a, b);
    if (g && g.laenge >= ADJAZENZ_MIN_M) kanten.push({ von: String(a.name), nach: String(b.name), typ: "offen" });
  }

  // Door edges: room ← nach (only interior doors; the apartment entrance has nach null).
  for (const z of liste) {
    for (const t of Array.isArray(z.tueren) ? z.tueren : []) {
      if (t?.nach === null || t?.nach === undefined) continue;
      const ziel = byName.get(String(t.nach));
      if (!ziel) {
        fehler.push({ raum: String(z.name), regel: "tuer", text: `Tür führt zu unbekanntem Raum „${t.nach}"` });
        continue;
      }
      if (istSanitaer(z) && !istFlurZone(ziel)) {
        fehler.push({ raum: String(z.name), regel: "bad_vom_wohnraum", text: `Bad/WC wird von „${String(ziel.name)}" aus betreten — nur von Diele/Flur zulässig` });
      }
      kanten.push({ von: String(ziel.name), nach: String(z.name), typ: "tuer" });
    }
  }

  // Legacy adjacency (approximation) — only without any door data.
  if (naeherung) {
    for (const z of liste) {
      if (istFlurZone(z)) continue;
      for (const w of wurzeln) {
        const g = gemeinsameKante(z, w);
        if (g && g.laenge >= ADJAZENZ_MIN_M) kanten.push({ von: String(w.name), nach: String(z.name), typ: "adjazenz" });
      }
    }
  }

  // Propagate: a door edge counts only from a reachable circulation zone or — for the
  // open kitchen — from a reachable living room. Walk-through rooms never propagate
  // (D-P75-14-C), so only root→room edges spread; a fixed-point loop handles root chains.
  let geaendert = true;
  for (let runde = 0; runde < 64 && geaendert; runde += 1) {
    geaendert = false;
    for (const k of kanten) {
      if (!erreichbar.has(k.von) || erreichbar.has(k.nach)) continue;
      const von = byName.get(k.von);
      if (!istFlurZone(von)) continue; // no walk-through
      erreichbar.add(k.nach);
      geaendert = true;
    }
  }
  if (offeneKueche) {
    for (const z of liste) {
      if (!istKueche(z) || erreichbar.has(String(z.name))) continue;
      if ((Array.isArray(z.tueren) ? z.tueren : []).some((t) => t?.nach !== null && t?.nach !== undefined)) continue;
      const wohn = liste.find((w) => istWohnraum(w) && erreichbar.has(String(w.name)) && (gemeinsameKante(z, w)?.laenge || 0) >= OFFENE_KUECHE_MIN_M);
      if (wohn) {
        erreichbar.add(String(z.name));
        kanten.push({ von: String(wohn.name), nach: String(z.name), typ: "offen" });
      }
    }
  }

  const unerreichbar = liste.filter((z) => !istFlurZone(z) && !erreichbar.has(String(z.name))).map((z) => String(z.name));
  for (const name of unerreichbar) {
    fehler.push({ raum: name, regel: "erschliessung", text: `„${name}" hat keine Tür zur Diele/zum Flur — Raum nicht zugänglich (Durchgangszimmer sind ausgeschlossen, D-P75-14-C)` });
  }
  const diele = wurzeln.some((z) => /diele/i.test(String(z.name)));
  if (!wurzeln.length) fehler.push({ raum: "WE", regel: "diele", text: "Wohnung ohne Diele/Flur — kein Erschließungsraum hinter der Wohnungstür" });
  return {
    erreichbar, unerreichbar, diele, naeherung,
    graph: { knoten: liste.map((z) => ({ name: String(z.name), art: z.art, wurzel: istFlurZone(z) })), kanten },
    fehler,
  };
}

/**
 * Reachability per apartment over a mixed zone list (storey plan).
 * @param {Array<object>} zonen all zones (corridor/core zones without `we` are skipped)
 * @param {{offeneKueche?: boolean}} [opts]
 * @returns {Map<string, ReturnType<typeof erreichbarkeit>>} keyed by we
 */
export function erreichbarkeitJeWe(zonen, opts = {}) {
  const out = new Map();
  const wes = [...new Set((Array.isArray(zonen) ? zonen : []).filter((z) => z?.we).map((z) => String(z.we)))];
  for (const we of wes) out.set(we, erreichbarkeit(zonen, { ...opts, we }));
  return out;
}
