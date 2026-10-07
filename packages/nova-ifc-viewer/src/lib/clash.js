// clash.js — Geometrische Kollisionspruefung (Clash Detection) fuer BIT-Atelier.
//
// Self-contained, pure ESM, KEINE Imports — node-smoke-testbar per dynamic import
// (Muster Phase 25). Alle Laengen in METERN; gerechnet wird intern in float64
// (JS-number), Eingabe-Dreiecke duerfen Float32Array sein.
//
// Kopplungsvertrag an extractGeometry (ifcImport.js, Task 1) — Elementform:
//   el = {
//     expressId: number,
//     globalId:  string,
//     ifcType:   string,          // "IFCWALL" (web-ifc) ODER "IfcWall" (parseIfcFile)
//     storey?:   string,
//     tris:      Float32Array,    // length % 9 === 0; je Dreieck 3 Welt-Vertices x,y,z
//     aabb?:     { min:[x,y,z], max:[x,y,z] },
//   }
// Fehlt aabb, rechnet clash.js aabbOf(tris). JEDER Typvergleich wird via
// String(t).toUpperCase() normalisiert (web-ifc liefert UPPERCASE, parseIfcFile CamelCase).

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

// Numerische Toleranz des Dreieckstests: dimensionslos auf u/v/t,
// RELATIV skaliert auf der Determinante (det hat Einheit Laenge^3).
export const EPS = 1e-9;

// [ANNAHME] Duplikat-Heuristik: 5 mm Toleranz je AABB-Grenze gilt als
// "praktisch deckungsgleich" fuer Doppel-Modellierungen.
export const DUP_AABB_DELTA = 0.005;

// [ANNAHME] Duplikat-Heuristik: max. 1 % Unterschied im AABB-Volumen.
export const DUP_VOL_DELTA = 0.01;

// Rollen-Gruppen (IFC-Typen UPPERCASE). Decken IFC2x3 UND IFC4 ab:
// WALLSTANDARDCASE sowie generische FLOW*-Obertypen neben DUCT-/PIPE-Subtypen.
export const ROLLEN_GRUPPEN = {
  architektur: ["IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCROOF", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCDOOR", "IFCWINDOW", "IFCCOVERING", "IFCCURTAINWALL", "IFCPLATE", "IFCRAILING"],
  tragwerk: ["IFCBEAM", "IFCCOLUMN", "IFCMEMBER", "IFCFOOTING", "IFCPILE"],
  tga: ["IFCFLOWSEGMENT", "IFCFLOWFITTING", "IFCFLOWTERMINAL", "IFCFLOWCONTROLLER", "IFCFLOWMOVINGDEVICE", "IFCFLOWSTORAGEDEVICE", "IFCFLOWTREATMENTDEVICE", "IFCENERGYCONVERSIONDEVICE", "IFCDISTRIBUTIONELEMENT", "IFCDISTRIBUTIONFLOWELEMENT", "IFCDUCTSEGMENT", "IFCDUCTFITTING", "IFCPIPESEGMENT", "IFCPIPEFITTING", "IFCAIRTERMINAL", "IFCCABLECARRIERSEGMENT", "IFCCABLESEGMENT"],
};

// Standard-Regelkatalog fuer die Pruef-Suite (Cross-Gewerk-Paare).
export const STANDARD_REGELN = [
  { name: "TGA gegen Tragwerk", a: ROLLEN_GRUPPEN.tga, b: ROLLEN_GRUPPEN.tragwerk },
  { name: "TGA gegen Architektur", a: ROLLEN_GRUPPEN.tga, b: ROLLEN_GRUPPEN.architektur },
  { name: "Architektur gegen Tragwerk", a: ROLLEN_GRUPPEN.architektur, b: ROLLEN_GRUPPEN.tragwerk },
];

// ---------------------------------------------------------------------------
// Kleine Helfer (intern)
// ---------------------------------------------------------------------------

// Typ-Normalisierung: "IfcWall" und "IFCWALL" muessen identisch matchen.
function typUpper(t) {
  return String(t == null ? "" : t).toUpperCase();
}

// Prueft, ob ein AABB-Objekt vollstaendig und endlich ist.
function istAabb(b) {
  return !!(
    b && b.min && b.max && b.min.length === 3 && b.max.length === 3 &&
    Number.isFinite(b.min[0]) && Number.isFinite(b.min[1]) && Number.isFinite(b.min[2]) &&
    Number.isFinite(b.max[0]) && Number.isFinite(b.max[1]) && Number.isFinite(b.max[2])
  );
}

// AABB-Volumen (negative Kanten werden auf 0 geklemmt; NaN-sicher via Negation).
function aabbVolumen(b) {
  let vol = 1;
  for (let i = 0; i < 3; i++) {
    const d = b.max[i] - b.min[i];
    if (!(d > 0)) return 0;
    vol *= d;
  }
  return vol;
}

// [ANNAHME] Mikrometer-Rundung fuer AABB-Grenzen: Float32-Welt-Tris tragen
// Dezimalrauschen (~1e-8 relativ; aus 0.31 wird 0.31000000238...). Runden auf
// 1e-6 m entfernt dieses Rauschen deterministisch und liegt drei Groessen-
// ordnungen unter jeder Toleranz (>= 1 mm). Oberhalb |v| >= 1e9 m (nur bei
// kaputter Georeferenz denkbar) wird nicht gerundet (Ganzzahlgrenze von
// v*1e6 bei 2^53).
function mikroRund(v) {
  return Math.abs(v) < 1e9 ? Math.round(v * 1e6) / 1e6 : v;
}

// Mitte der Schnittbox zweier AABBs (nur sinnvoll bei Ueberlappung/Beruehrung).
function schnittboxMitte(a, b) {
  return {
    x: (Math.max(a.min[0], b.min[0]) + Math.min(a.max[0], b.max[0])) / 2,
    y: (Math.max(a.min[1], b.min[1]) + Math.min(a.max[1], b.max[1])) / 2,
    z: (Math.max(a.min[2], b.min[2]) + Math.min(a.max[2], b.max[2])) / 2,
  };
}

// Mitte zwischen den Zentren zweier AABBs (fuer clearance-Befunde ohne Ueberlappung).
function zentrenMitte(a, b) {
  return {
    x: (a.min[0] + a.max[0] + b.min[0] + b.max[0]) / 4,
    y: (a.min[1] + a.max[1] + b.min[1] + b.max[1]) / 4,
    z: (a.min[2] + a.max[2] + b.min[2] + b.max[2]) / 4,
  };
}

// ---------------------------------------------------------------------------
// 1) aabbOf — AABB ueber alle gueltigen Dreiecke
// ---------------------------------------------------------------------------

// Eine Schleife ueber die Floats; Dreiecke mit nicht-finiten Werten (NaN/Inf,
// z. B. aus web-ifc) werden KOMPLETT uebersprungen — ein einzelnes kaputtes
// Dreieck darf das Element nicht disqualifizieren. Keine gueltigen Tris -> null.
export function aabbOf(tris) {
  if (!tris || typeof tris.length !== "number") return null;
  const nTris = Math.floor(tris.length / 9);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let gefunden = false;
  for (let t = 0; t < nTris; t++) {
    const o = t * 9;
    // Finitheit aller 9 Werte pruefen (NaN-sicher: Number.isFinite).
    let ok = true;
    for (let k = 0; k < 9; k++) {
      if (!Number.isFinite(tris[o + k])) { ok = false; break; }
    }
    if (!ok) continue; // degeneriertes/kaputtes Dreieck stumm ueberspringen
    gefunden = true;
    for (let k = 0; k < 9; k += 3) {
      const x = tris[o + k], y = tris[o + k + 1], z = tris[o + k + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!gefunden) return null;
  // Float32-Dezimalrauschen der Grenzen entfernen (siehe mikroRund).
  return {
    min: [mikroRund(minX), mikroRund(minY), mikroRund(minZ)],
    max: [mikroRund(maxX), mikroRund(maxY), mikroRund(maxZ)],
  };
}

// ---------------------------------------------------------------------------
// 2) aabbOverlap — Ueberlappungstest zweier AABBs (optional mit clearance)
// ---------------------------------------------------------------------------

export function aabbOverlap(a, b, clearance = 0) {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    // Positiv formuliert und negiert -> NaN-sicher.
    if (!(a.min[i] <= b.max[i] + clearance && b.min[i] <= a.max[i] + clearance)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3) aabbDistance — euklidischer Abstand zweier AABBs (0 bei Ueberlappung/Beruehrung)
// ---------------------------------------------------------------------------

export function aabbDistance(a, b) {
  let summe = 0;
  for (let i = 0; i < 3; i++) {
    const gap = Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i]);
    summe += gap * gap;
  }
  return Math.sqrt(summe);
}

// ---------------------------------------------------------------------------
// 4) overlapVolume — Volumen der AABB-Schnittbox in m³
// ---------------------------------------------------------------------------

// Exakt fuer achsparallele Boxen; fuer beliebige Meshes eine AABB-NAEHERUNG
// (im UI/PDF als "Ueberlappung (AABB)" beschriften — kann bei schraegen/langen
// Bauteilen deutlich ueberschaetzen).
export function overlapVolume(a, b) {
  let vol = 1;
  for (let i = 0; i < 3; i++) {
    const d = Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
    if (!(d > 0)) return 0; // Π max(0, ...) — NaN-sicher via Negation
    vol *= d;
  }
  return vol;
}

// ---------------------------------------------------------------------------
// 5) triTriIntersects — Dreieck/Dreieck-Schnitttest (Moeller-Trumbore auf 6 Kanten)
// ---------------------------------------------------------------------------

// Segment p->q gegen Dreieck (a,b,c) via Moeller-Trumbore, komplett skalar
// (allokationsfrei). Rueckgabe true bei Durchstoss innerhalb der inklusiven
// Schranken.
//
// KOPLANARITAETS-/PARALLELFALL WIRD IGNORIERT: liegt die Kante (nahezu) in der
// Dreiecksebene, wird sie uebersprungen. Design-Entscheidung: koplanare
// Flaechenueberlappung = Kontakt, kein Clash; echte Volumendurchdringungen
// erzeugen immer nicht-koplanare Durchstoesse.
//
// Determinanten-Epsilon RELATIV skalieren: det hat Einheit Laenge^3 — ein
// absolutes 1e-9 wuerde kleinteilige mm-Geometrie faelschlich als "parallel"
// verwerfen. Die !(x > y)-Form ist zugleich NaN-sicher (degenerierte Dreiecke
// fallen stumm heraus).
function kanteTrifftDreieck(px, py, pz, qx, qy, qz, ax, ay, az, bx, by, bz, cx, cy, cz, eps) {
  const dx = qx - px, dy = qy - py, dz = qz - pz;          // Segmentrichtung d = q - p
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;       // e1 = v1 - v0
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;       // e2 = v2 - v0
  // h = d × e2
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;              // det = e1 · h  (Einheit Laenge^3)
  const lenD = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const lenE1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
  const lenE2 = Math.sqrt(e2x * e2x + e2y * e2y + e2z * e2z);
  if (!(Math.abs(det) > eps * (lenD * lenE1 * lenE2))) return false; // parallel/koplanar/degeneriert -> ueberspringen
  const f = 1 / det;
  const sx = px - ax, sy = py - ay, sz = pz - az;          // s = p - v0
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (!(u >= -eps)) return false;
  // qv = s × e1
  const qvx = sy * e1z - sz * e1y;
  const qvy = sz * e1x - sx * e1z;
  const qvz = sx * e1y - sy * e1x;
  const v = f * (dx * qvx + dy * qvy + dz * qvz);
  if (!(v >= -eps && u + v <= 1 + eps)) return false;
  const tPar = f * (e2x * qvx + e2y * qvy + e2z * qvz);
  // INKLUSIVE Schranken mit eps-Puffer — bewusst NICHT strikt-innen: bei
  // achsparallelen Modellen liegen Durchstoesse exakt auf Triangulierungs-
  // Diagonalen/Face-Kanten; strikte Schranken verloeren echte Clashes.
  // "Beruehrung ist kein Clash" entscheidet NICHT dieser Test, sondern der
  // Broadphase-Bagatellfilter ueber tolerance (elementsIntersect).
  return tPar >= -eps && tPar <= 1 + eps;
}

// Allokationsfreier Kern: Dreieck A (9 Floats ab offA in trisA) gegen
// Dreieck B (9 Floats ab offB in trisB). Segment-Dreieck via Moeller-Trumbore
// auf allen 6 Kanten — 3 Kanten von A gegen Dreieck B, 3 Kanten von B gegen
// Dreieck A; erster Treffer -> true. Vollstaendig fuer nicht-koplanare Paare
// (ueberlappende Schnittintervalle auf der Schnittgeraden implizieren stets
// mindestens einen Kanten-Durchstoss).
function segTriAt(trisA, offA, trisB, offB, eps) {
  const a0x = trisA[offA], a0y = trisA[offA + 1], a0z = trisA[offA + 2];
  const a1x = trisA[offA + 3], a1y = trisA[offA + 4], a1z = trisA[offA + 5];
  const a2x = trisA[offA + 6], a2y = trisA[offA + 7], a2z = trisA[offA + 8];
  const b0x = trisB[offB], b0y = trisB[offB + 1], b0z = trisB[offB + 2];
  const b1x = trisB[offB + 3], b1y = trisB[offB + 4], b1z = trisB[offB + 5];
  const b2x = trisB[offB + 6], b2y = trisB[offB + 7], b2z = trisB[offB + 8];
  // Kanten von A gegen Dreieck B
  if (kanteTrifftDreieck(a0x, a0y, a0z, a1x, a1y, a1z, b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z, eps)) return true;
  if (kanteTrifftDreieck(a1x, a1y, a1z, a2x, a2y, a2z, b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z, eps)) return true;
  if (kanteTrifftDreieck(a2x, a2y, a2z, a0x, a0y, a0z, b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z, eps)) return true;
  // Kanten von B gegen Dreieck A
  if (kanteTrifftDreieck(b0x, b0y, b0z, b1x, b1y, b1z, a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z, eps)) return true;
  if (kanteTrifftDreieck(b1x, b1y, b1z, b2x, b2y, b2z, a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z, eps)) return true;
  if (kanteTrifftDreieck(b2x, b2y, b2z, b0x, b0y, b0z, a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z, eps)) return true;
  return false;
}

// Duenner Export-Wrapper fuer Smokes: t1, t2 sind length-9 Array-likes
// (auch Float32Array.subarray).
export function triTriIntersects(t1, t2, eps = EPS) {
  return segTriAt(t1, 0, t2, 0, eps);
}

// ---------------------------------------------------------------------------
// 6) buildTriGrid — Grid-Bucketing: 2×2×2 Oktanten der Element-AABB
// ---------------------------------------------------------------------------

// [ANNAHME] 8er-Teilung am AABB-Mittelpunkt reicht als Beschleunigung: die
// Narrowphase laeuft ohnehin nur auf der Schnittbox zweier Elemente, dort
// filtern Oktanten + Tri-AABBs den Grossteil der Dreiecke heraus.
//
// Grid = {
//   mid:      [mx,my,mz]                — Teilungspunkt (AABB-Mitte),
//   cells:    Array(8)<Uint32Array>     — Dreiecks-Indizes t (Floats ab t*9),
//   triBoxes: Float64Array(nTris*6)     — je Tri: minX,minY,minZ,maxX,maxY,maxZ,
// }
// Einsortierung je Tri ueber seine Tri-AABB: Oktant x|(y<<1)|(z<<2); ein Tri
// landet in JEDER ueberlappten Zelle (kein Clipping, Mehrfachablage erlaubt).
// Aufbau O(n), deterministisch. Degenerierte/NaN-Tris: triBoxes = NaN,
// keine Zelle (fallen so aus jedem positiv formulierten Filter heraus).
export function buildTriGrid(el) {
  const tris = el && el.tris;
  const nTris = tris && typeof tris.length === "number" ? Math.floor(tris.length / 9) : 0;
  const box = el && istAabb(el.aabb) ? el.aabb : aabbOf(tris);
  const mid = box
    ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]
    : [0, 0, 0];
  const triBoxes = new Float64Array(nTris * 6);
  const zellMasken = new Uint8Array(nTris); // Bit c gesetzt = Tri liegt in Zelle c
  const anzahl = new Uint32Array(8);

  // Pass 1: Tri-AABBs + Zellmasken + Zaehlung
  for (let t = 0; t < nTris; t++) {
    const o = t * 9;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let ok = true;
    for (let k = 0; k < 9; k += 3) {
      const x = tris[o + k], y = tris[o + k + 1], z = tris[o + k + 2];
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) { ok = false; break; }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const b = t * 6;
    if (!ok) {
      // kaputtes Dreieck: NaN-Box, keine Zelle — stumm ueberspringen
      triBoxes[b] = NaN; triBoxes[b + 1] = NaN; triBoxes[b + 2] = NaN;
      triBoxes[b + 3] = NaN; triBoxes[b + 4] = NaN; triBoxes[b + 5] = NaN;
      continue;
    }
    triBoxes[b] = minX; triBoxes[b + 1] = minY; triBoxes[b + 2] = minZ;
    triBoxes[b + 3] = maxX; triBoxes[b + 4] = maxY; triBoxes[b + 5] = maxZ;
    // Halbraum-Zugehoerigkeit je Achse: untere Haelfte (<= mid) / obere (>= mid)
    const x0 = minX <= mid[0], x1 = maxX >= mid[0];
    const y0 = minY <= mid[1], y1 = maxY >= mid[1];
    const z0 = minZ <= mid[2], z1 = maxZ >= mid[2];
    let maske = 0;
    for (let c = 0; c < 8; c++) {
      const okX = (c & 1) === 0 ? x0 : x1;
      const okY = (c & 2) === 0 ? y0 : y1;
      const okZ = (c & 4) === 0 ? z0 : z1;
      if (okX && okY && okZ) { maske |= 1 << c; anzahl[c]++; }
    }
    zellMasken[t] = maske;
  }

  // Pass 2: Zellen fuellen
  const cells = new Array(8);
  for (let c = 0; c < 8; c++) cells[c] = new Uint32Array(anzahl[c]);
  const cursor = new Uint32Array(8);
  for (let t = 0; t < nTris; t++) {
    const maske = zellMasken[t];
    if (maske === 0) continue;
    for (let c = 0; c < 8; c++) {
      if (maske & (1 << c)) cells[c][cursor[c]++] = t;
    }
  }
  return { mid, cells, triBoxes };
}

// Kandidaten-Dreiecke eines Grids sammeln, deren Oktant UND Tri-AABB die
// Schnittbox S schneiden; Dedup per Uint8Array-Marker (Mehrfachablage!).
function sammleKandidaten(grid, sMin0, sMin1, sMin2, sMax0, sMax1, sMax2) {
  const triBoxes = grid.triBoxes;
  const nTris = triBoxes.length / 6;
  const marker = new Uint8Array(nTris);
  const out = [];
  const mx = grid.mid[0], my = grid.mid[1], mz = grid.mid[2];
  for (let c = 0; c < 8; c++) {
    // Oktant schneidet S? (S liegt innerhalb der Element-AABB, daher genuegt
    // der Vergleich gegen den Teilungspunkt mid)
    const okX = (c & 1) === 0 ? sMin0 <= mx : sMax0 >= mx;
    const okY = (c & 2) === 0 ? sMin1 <= my : sMax1 >= my;
    const okZ = (c & 4) === 0 ? sMin2 <= mz : sMax2 >= mz;
    if (!(okX && okY && okZ)) continue;
    const zelle = grid.cells[c];
    for (let k = 0; k < zelle.length; k++) {
      const t = zelle[k];
      if (marker[t]) continue;
      marker[t] = 1;
      const b = t * 6;
      // Tri-AABB gegen S (positiv formuliert -> NaN-sicher)
      if (
        triBoxes[b] <= sMax0 && sMin0 <= triBoxes[b + 3] &&
        triBoxes[b + 1] <= sMax1 && sMin1 <= triBoxes[b + 4] &&
        triBoxes[b + 2] <= sMax2 && sMin2 <= triBoxes[b + 5]
      ) out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7) elementsIntersect — Broadphase (AABB + Bagatellfilter) -> Narrowphase (Tri/Tri)
// ---------------------------------------------------------------------------

export function elementsIntersect(elA, elB, { tolerance = 0.001, gridA, gridB } = {}) {
  const boxA = elA && istAabb(elA.aabb) ? elA.aabb : aabbOf(elA && elA.tris);
  const boxB = elB && istAabb(elB.aabb) ? elB.aabb : aabbOf(elB && elB.tris);
  if (!boxA || !boxB) return false;

  // BROADPHASE: je Achse Ueberlappungstiefe d_i; ALLE d_i > tolerance noetig.
  // Das ist der Bagatell-/Beruehrungsfilter: flaechig beruehrende Bauteile
  // haben d = 0 auf mindestens einer Achse -> kein hard-Clash.
  let sMin0 = 0, sMin1 = 0, sMin2 = 0, sMax0 = 0, sMax1 = 0, sMax2 = 0;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(boxA.min[i], boxB.min[i]);
    const hi = Math.min(boxA.max[i], boxB.max[i]);
    if (!(hi - lo > tolerance)) return false; // NaN-sicher via Negation
    if (i === 0) { sMin0 = lo; sMax0 = hi; }
    else if (i === 1) { sMin1 = lo; sMax1 = hi; }
    else { sMin2 = lo; sMax2 = hi; }
  }

  // NARROWPHASE auf der Schnittbox S beider AABBs.
  const ga = gridA || buildTriGrid({ tris: elA.tris, aabb: boxA });
  const gb = gridB || buildTriGrid({ tris: elB.tris, aabb: boxB });
  const kandA = sammleKandidaten(ga, sMin0, sMin1, sMin2, sMax0, sMax1, sMax2);
  if (kandA.length === 0) return false;
  const kandB = sammleKandidaten(gb, sMin0, sMin1, sMin2, sMax0, sMax1, sMax2);
  if (kandB.length === 0) return false;

  const tbA = ga.triBoxes, tbB = gb.triBoxes;
  const trisA = elA.tris, trisB = elB.tris;
  for (let p = 0; p < kandA.length; p++) {
    const i = kandA[p];
    const ba = i * 6;
    const aMinX = tbA[ba], aMinY = tbA[ba + 1], aMinZ = tbA[ba + 2];
    const aMaxX = tbA[ba + 3], aMaxY = tbA[ba + 4], aMaxZ = tbA[ba + 5];
    for (let q = 0; q < kandB.length; q++) {
      const j = kandB[q];
      const bb = j * 6;
      // Tri-AABB-Kurztest, dann exakter Test; EARLY-EXIT beim ersten Treffer.
      if (
        aMinX <= tbB[bb + 3] && tbB[bb] <= aMaxX &&
        aMinY <= tbB[bb + 4] && tbB[bb + 1] <= aMaxY &&
        aMinZ <= tbB[bb + 5] && tbB[bb + 2] <= aMaxZ &&
        segTriAt(trisA, i * 9, trisB, j * 9, EPS)
      ) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Befund-Bau (intern)
// ---------------------------------------------------------------------------

/**
 * The rule as carried by a finding — one source for all finding kinds (66-07).
 * Carries the origin (`hinweis`, `grundlage` from clashRegeln.ladeRegelsatz) so
 * table, PDF and BCF can name the client document instead of just an ID.
 * @param {{id?: any, name?: string, hinweis?: string|null, grundlage?: object|null}|null} regel
 * @returns {{id: string|null, name: string, hinweis: string|null, grundlage: object|null}|null}
 */
export function regelKurz(regel) {
  if (!regel) return null;
  return {
    id: regel.id == null ? null : String(regel.id),
    name: String(regel.name || ""),
    hinweis: regel.hinweis == null ? null : String(regel.hinweis),
    grundlage: regel.grundlage && typeof regel.grundlage === "object" ? regel.grundlage : null,
  };
}

// 66-07: optional `regel` — only set for 'hard' findings of rules that carry an ID
// (BAP rule files); clearance findings stem from the UI setting and stay rule-free. STANDARD_REGELN have no ID, so the default run and
// duplicates keep exactly the object shape they had before.
function machBefund(A, B, kind, overlapVol, center, regel = null) {
  const befund = machBefundBasis(A, B, kind, overlapVol, center);
  if (regel && regel.id != null) {
    befund.regel = regelKurz(regel);
    befund.toleranzMm = Number.isFinite(regel.toleranz) ? Math.round(regel.toleranz * 1e6) / 1000 : null;
  }
  return befund;
}

function machBefundBasis(A, B, kind, overlapVol, center) {
  return {
    aId: A.el.expressId,
    bId: B.el.expressId,
    aGuid: A.el.globalId || "",
    bGuid: B.el.globalId || "",
    aType: A.el.ifcType == null ? "" : A.el.ifcType, // Original-Schreibweise
    bType: B.el.ifcType == null ? "" : B.el.ifcType,
    kind,
    overlapVol,
    center,
  };
}

// Befund der BAP-Prüfarten (71-02): trägt Regel, Quellen und die Abweichung in
// mm. Eine Seite darf null sein (kind 'ohne_partner': bei 'enthalten' fehlt B,
// bei 'gefuellt' fehlt A — R-2). Die Bestandsfelder bleiben identisch zu
// machBefund — ModelCheck/BCF-Export lesen sie unverändert (null-sicher).
function befundMitRegel(A, B, kind, regel, abweichungM, overlapVol, center) {
  return {
    aId: A ? A.el.expressId : null,
    bId: B ? B.el.expressId : null,
    aGuid: A ? A.el.globalId || "" : "",
    bGuid: B ? B.el.globalId || "" : "",
    aType: A ? (A.el.ifcType == null ? "" : A.el.ifcType) : "",
    bType: B ? (B.el.ifcType == null ? "" : B.el.ifcType) : "",
    aQuelle: A ? A.quelle : null,
    bQuelle: B ? B.quelle : null,
    kind,
    overlapVol,
    center,
    regel: regelKurz(regel),
    // µm-Rundung wie mikroRund: Float32-Rauschen soll nicht als 0.000001 mm
    // Abweichung sichtbar werden.
    abweichungMm: abweichungM == null ? null : Math.round(abweichungM * 1e6) / 1000,
    toleranzMm: regel && Number.isFinite(regel.toleranz) ? Math.round(regel.toleranz * 1e6) / 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// 7b) Containment/Deckung (71-02, BAP-Prüfarten) — AABB-Näherungen.
//     T-71-05: als Näherung beschriften; kind unterscheidet sie vom
//     Dreiecksschnitt ('hard'). Exakte Variante = Folgeaufgabe (SUMMARY).
// ---------------------------------------------------------------------------

/**
 * Enthaltensein: um wie viel überragt `klein` den Box-Rand von `gross`?
 * Größte Achsenüberschreitung in m, ≥ 0. Die Toleranz wird NICHT abgezogen —
 * sie entscheidet getrennt, ob die Abweichung ein Befund ist
 * (Abweichung > Toleranz). Plan-Beispiel: 3 mm größer bei 2 mm Toleranz →
 * Befund mit abweichung_mm ≈ 3.
 * @param {{min:number[],max:number[]}} klein
 * @param {{min:number[],max:number[]}} gross
 * @returns {number} Abweichung in m
 */
export function containmentAbweichung(klein, gross) {
  let abweichung = 0;
  for (let i = 0; i < 3; i++) {
    const unten = gross.min[i] - klein.min[i];  // klein reicht unter gross hinaus
    const oben = klein.max[i] - gross.max[i];   // klein reicht über gross hinaus
    const achse = Math.max(unten, oben, 0);
    if (achse > abweichung) abweichung = achse;
  }
  return abweichung;
}

/**
 * Deckungsgleichheit: maximale Grenzdifferenz zweier AABBs in m
 * („Position von Öffnungen sollte gleich sein", BAP-Matrix).
 * @param {{min:number[],max:number[]}} a
 * @param {{min:number[],max:number[]}} b
 * @returns {number}
 */
export function deckungAbweichung(a, b) {
  let abweichung = 0;
  for (let i = 0; i < 3; i++) {
    const achse = Math.max(Math.abs(a.min[i] - b.min[i]), Math.abs(a.max[i] - b.max[i]));
    if (achse > abweichung) abweichung = achse;
  }
  return abweichung;
}

// Gleichförmiges Gitter über Element-AABBs — Kandidatensuche für die
// Containment-/Deckungs-Regeln. Grund: der Zwei-Modell-Lauf hat 5.970 × 5.430
// Elemente (71-RESEARCH §1.4); die verschachtelte Schleife aller Paare wäre
// dort ~32 Mio. Iterationen JE Regel. Gitterzellen: 5 m [ASSUMED] —
// Bauteilmaßstab des Hochbaus; dokumentiert in der 71-02-SUMMARY.
const GRID_ZELLE = 5;

function zellBereich(box, erweiterung) {
  return [
    Math.floor((box.min[0] - erweiterung) / GRID_ZELLE), Math.floor((box.max[0] + erweiterung) / GRID_ZELLE),
    Math.floor((box.min[1] - erweiterung) / GRID_ZELLE), Math.floor((box.max[1] + erweiterung) / GRID_ZELLE),
    Math.floor((box.min[2] - erweiterung) / GRID_ZELLE), Math.floor((box.max[2] + erweiterung) / GRID_ZELLE),
  ];
}

function baueAabbGrid(indizes, arbeit) {
  const grid = new Map(); // "cx|cy|cz" -> number[] (Element-Indizes)
  for (const i of indizes) {
    const [x0, x1, y0, y1, z0, z1] = zellBereich(arbeit[i].geo.aabb, 0);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx}|${cy}|${cz}`;
          let zelle = grid.get(key);
          if (!zelle) grid.set(key, (zelle = []));
          zelle.push(i);
        }
      }
    }
  }
  return grid;
}

function gridKandidaten(grid, box, erweiterung) {
  const [x0, x1, y0, y1, z0, z1] = zellBereich(box, erweiterung);
  const gesehen = new Set();
  const out = [];
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      for (let cz = z0; cz <= z1; cz++) {
        const zelle = grid.get(`${cx}|${cy}|${cz}`);
        if (!zelle) continue;
        for (const j of zelle) {
          if (gesehen.has(j)) continue;
          gesehen.add(j);
          out.push(j);
        }
      }
    }
  }
  return out;
}

// Index-Listen fuer eine Typenliste einsammeln (normalisiert, dedupliziert,
// aufsteigend sortiert -> deterministische Kandidatenreihenfolge).
// 71-02: optionaler Quellen-Filter — regel.aQuelle/bQuelle grenzen auf
// Elemente EINES Modells ein; Elemente ohne quelle passen immer
// (rückwärtskompatibel, Ein-Modell-Läufe haben keine quelle).
function indizesFuerTypen(typIndex, typen, arbeit, quelle) {
  if (!Array.isArray(typen)) return [];
  const marker = new Set();
  const out = [];
  for (const t of typen) {
    const liste = typIndex.get(typUpper(t));
    if (!liste) continue;
    for (const i of liste) {
      if (marker.has(i)) continue;
      if (quelle != null && arbeit[i].quelle != null && arbeit[i].quelle !== quelle) continue;
      marker.add(i); out.push(i);
    }
  }
  out.sort((x, y) => x - y);
  return out;
}

// ---------------------------------------------------------------------------
// 8) clashPairsIter — Generator mit Fortschritts-Yields (Andockpunkt fuer das
//    setTimeout-Chunking in ModelCheck, Task 5); return = Endergebnis.
// ---------------------------------------------------------------------------

export function* clashPairsIter(elems, optionen = {}) {
  const {
    rules = STANDARD_REGELN,
    tolerance = 0.001,
    clearance = 0,
    duplikate = true,
    maxPairs = 20000,
  } = optionen;

  // (a) Elemente nach expressId sortieren (Determinismus!), ungueltige
  //     aussortieren, fehlende AABB via aabbOf ergaenzen.
  let ohneGeometrie = 0;
  const eingabe = Array.isArray(elems) ? elems.slice() : [];
  eingabe.sort((x, y) => {
    const ix = x && Number.isFinite(x.expressId) ? x.expressId : 0;
    const iy = y && Number.isFinite(y.expressId) ? y.expressId : 0;
    return ix - iy;
  });
  const arbeit = []; // { el, geo:{tris,aabb}, typU, quelle }
  for (const el of eingabe) {
    const tris = el && el.tris;
    const trisOk = !!(tris && typeof tris.length === "number" && tris.length >= 9 && tris.length % 9 === 0);
    const box = trisOk ? (istAabb(el.aabb) ? el.aabb : aabbOf(tris)) : null;
    if (!trisOk || !box) { ohneGeometrie++; continue; } // ohne verwertbare Tris/AABB
    // 71-02: el.quelle markiert das Herkunftsmodell (z. B. "A"|"B"); ohne das
    // Feld verhält sich alles wie bisher (Ein-Modell-Läufe).
    arbeit.push({ el, geo: { tris, aabb: box }, typU: typUpper(el.ifcType),
      quelle: el && typeof el.quelle === "string" ? el.quelle : null });
  }
  const n = arbeit.length;

  // (b) Typ-Index: Map(TYP_UPPERCASE -> Indexliste), Insertion-Order folgt der
  //     expressId-Sortierung -> deterministisch.
  const typIndex = new Map();
  for (let i = 0; i < n; i++) {
    const t = arbeit[i].typU;
    let liste = typIndex.get(t);
    if (!liste) typIndex.set(t, (liste = []));
    liste.push(i);
  }

  const clashes = [];
  const gesehen = new Set(); // Paar-Keys lo*n+hi — dedupliziert Regeln UND unterdrueckt hard nach duplicate

  // (c) DUPLIKAT-PASS — REGEL-UNABHAENGIG ueber alle Typ-Gruppen (die
  //     Cross-Gewerk-Regeln matchen gleiche Typen nie!).
  //     71-02: Duplikate NUR INNERHALB einer Quelle — dasselbe Bauteil in ARC
  //     und Rohbau ist gewollt, kein Duplikat (Plan interfaces). Strenger
  //     Vergleich: null === null (Ein-Modell-Lauf unverändert), "A" === "A".
  if (duplikate) {
    for (const [, liste] of typIndex) {
      if (liste.length < 2) continue;
      // Nach aabb.min[0] sortieren; Tie-Break Index -> deterministisch.
      const nachX = liste.slice().sort((p, q) => (arbeit[p].geo.aabb.min[0] - arbeit[q].geo.aabb.min[0]) || (p - q));
      for (let a = 0; a < nachX.length; a++) {
        const A = arbeit[nachX[a]].geo.aabb;
        for (let b = a + 1; b < nachX.length; b++) {
          if (arbeit[nachX[a]].quelle !== arbeit[nachX[b]].quelle) continue; // nur je Quelle
          const B = arbeit[nachX[b]].geo.aabb;
          // Sliding Window: solange Δmin[0] < DUP_AABB_DELTA (NaN-sicher).
          if (!(B.min[0] - A.min[0] < DUP_AABB_DELTA)) break;
          // [ANNAHME] DUPLIKAT-HEURISTIK: alle 6 AABB-Grenzen |Δ| < 5 mm UND
          // gleicher ifcType (durch Gruppenbildung gegeben) UND AABB-Volumen-
          // Differenz <= 1 % -> Doppel-Modellierung.
          let gleich = true;
          for (let k = 0; k < 3; k++) {
            if (!(Math.abs(A.min[k] - B.min[k]) < DUP_AABB_DELTA) ||
                !(Math.abs(A.max[k] - B.max[k]) < DUP_AABB_DELTA)) { gleich = false; break; }
          }
          if (!gleich) continue;
          const volA = aabbVolumen(A);
          const volB = aabbVolumen(B);
          if (!(Math.abs(volA - volB) <= DUP_VOL_DELTA * Math.max(volA, volB, 1e-12))) continue;
          const lo = Math.min(nachX[a], nachX[b]);
          const hi = Math.max(nachX[a], nachX[b]);
          const key = lo * n + hi;
          if (gesehen.has(key)) continue;
          gesehen.add(key); // unterdrueckt spaeteren hard-Befund fuers selbe Paar
          clashes.push(machBefund(arbeit[lo], arbeit[hi], "duplicate", overlapVolume(A, B), schnittboxMitte(A, B)));
        }
      }
    }
  }

  // (d) REGEL-PASS: Kandidatenpaare deterministisch einsammeln (Regeln in
  //     gegebener Reihenfolge, Indizes aufsteigend); Paar-Key min*n+max
  //     dedupliziert ueber Regeln hinweg; ab maxPairs nur noch zaehlen.
  //     71-02: Regeln dürfen `art` (schnitt|enthalten|gefuellt|deckung),
  //     `toleranz` (m, fällt auf die globale Option zurück) und `aQuelle`/
  //     `bQuelle` (Modell-Filter) tragen. Ohne diese Felder verhält sich
  //     alles exakt wie bisher (Bestandstests unverändert).
  let uebersprungen = 0;
  const paare = []; // flach: [lo0,hi0,tol0, lo1,hi1,tol1, ...] — Schnitt-Regeln
  // 66-07: the rule of each pair, index p/3 — parallel array instead of changing
  // the stride of `paare`. First rule wins per pair (the `gesehen` set dedupes).
  const paarRegel = [];
  const containRegeln = []; // {regel, tol, listeA, listeB} — enthalten/gefuellt/deckung
  for (const regel of (Array.isArray(rules) ? rules : [])) {
    if (!regel) continue;
    const tol = Number.isFinite(regel.toleranz) ? regel.toleranz : tolerance;
    const art = regel.art == null ? "schnitt" : String(regel.art);
    const listeA = indizesFuerTypen(typIndex, regel.a, arbeit, regel.aQuelle ?? null);
    if (!listeA.length) continue;
    const listeB = indizesFuerTypen(typIndex, regel.b, arbeit, regel.bQuelle ?? null);
    if (!listeB.length) continue;

    if (art === "enthalten" || art === "gefuellt" || art === "deckung") {
      containRegeln.push({ regel, tol, art, listeA, listeB });
      continue;
    }
    if (art !== "schnitt") continue; // unbekannte Art (z. B. 'koordination') —
    // Koordinationskörper prüft koordinationskoerper.js, nicht der Clash-Lauf.

    for (const i of listeA) {
      for (const j of listeB) {
        if (i === j) continue;
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const key = lo * n + hi;
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        if (paare.length >= maxPairs * 3) { uebersprungen++; continue; } // Cap: nicht pruefen, nur zaehlen
        paare.push(lo, hi, tol);
        paarRegel.push(regel);
      }
    }
  }

  // Grid-Cache pro Lauf (lazy): Index -> Grid.
  const grids = new Map();
  const gridFuer = (idx) => {
    let g = grids.get(idx);
    if (!g) { g = buildTriGrid(arbeit[idx].geo); grids.set(idx, g); }
    return g;
  };

  // (e) Schnitt-Kandidaten pruefen (Toleranz je Paar = Toleranz ihrer Regel).
  let geprueft = 0;
  const gesamtSchnitt = paare.length / 3;
  for (let p = 0; p < paare.length; p += 3) {
    const i = paare[p];
    const j = paare[p + 1];
    const tol = paare[p + 2];
    const A = arbeit[i];
    const B = arbeit[j];
    geprueft++;
    if (elementsIntersect(A.geo, B.geo, { tolerance: tol, gridA: gridFuer(i), gridB: gridFuer(j) })) {
      // 'hard' — overlapVol ist AABB-Naeherung (im UI/PDF so beschriften!)
      clashes.push(machBefund(A, B, "hard", overlapVolume(A.geo.aabb, B.geo.aabb), schnittboxMitte(A.geo.aabb, B.geo.aabb), paarRegel[p / 3]));
    } else if (clearance > 0 && aabbDistance(A.geo.aabb, B.geo.aabb) <= clearance) {
      // No rule on clearance findings: the minimum distance is a check setting from
      // the UI, not part of the BAP rule — its origin text would cite the wrong clause.
      clashes.push(machBefund(A, B, "clearance", 0, zentrenMitte(A.geo.aabb, B.geo.aabb)));
    }
    if (geprueft % 200 === 0) {
      yield { typ: "fortschritt", geprueft, gesamt: gesamtSchnitt };
    }
  }

  // (e2) CONTAINMENT/DECKUNG-PASS (71-02, BAP-Matrix) — AABB-Näherungen
  //      (T-71-05: im UI/PDF als Näherung beschriften; D-P71-04).
  //      Je a-Element wird der BESTE Partner gesucht (minimale Abweichung):
  //      ein Rohbau-Bauteil kann von MEHREREN Architektur-Bauteilen umschlossen
  //      sein — der pairwise-Vergleich gegen nur eines ergäbe Scheinbefunde.
  //      Befund nur, wenn die beste Abweichung die Toleranz ÜBERSCHREITET.
  const gridCacheB = new Map(); // Listen-Identität -> AABB-Gitter
  let gesamtContain = 0;
  // R-4 (71-02-Nacharbeit): auch dieser Pass ist durch maxPairs gedeckelt —
  // gezählt werden Element×Kandidat-Vergleiche; darüber nur noch zählen.
  let containPaare = 0;
  for (const { regel, tol, art, listeA, listeB } of containRegeln) {
    const gridB = baueAabbGrid(listeB, arbeit);
    // Iterierte Seite: 'gefuellt' prüft b ⊆ a — also wird B iteriert und A
    // liefert die Kandidaten; sonst wird A iteriert.
    const iteriert = art === "gefuellt" ? listeB : listeA;
    const kandidatenAus = art === "gefuellt"
      ? (gridCacheB.get(listeA) || (gridCacheB.set(listeA, baueAabbGrid(listeA, arbeit)), gridCacheB.get(listeA)))
      : gridB;
    const ohnePartnerArt = art === "deckung" ? null : "ohne_partner";
    for (const i of iteriert) {
      const A = arbeit[i];
      const partner = gridKandidaten(kandidatenAus, A.geo.aabb, tol).filter((j) => j !== i
        && aabbOverlap(A.geo.aabb, arbeit[j].geo.aabb, tol));
      gesamtContain++;
      if (containPaare + Math.max(1, partner.length) > maxPairs) {
        uebersprungen += Math.max(1, partner.length); // Cap: nicht pruefen, nur zaehlen
        continue;
      }
      containPaare += Math.max(1, partner.length);
      geprueft++;
      if (!partner.length) {
        // Element ohne Gegenstück in der anderen Quelle — bei enthalten/gefuellt
        // ein eigener Befund (z. B. Rohbau-Bauteil, das die Architektur nicht kennt).
        // R-2: bei 'gefuellt' ist das iterierte Element die B-Seite der Regel —
        // der Befund trägt es dann als b*, a* bleibt leer.
        if (ohnePartnerArt) {
          const ecke = { x: A.geo.aabb.min[0], y: A.geo.aabb.min[1], z: A.geo.aabb.min[2] };
          clashes.push(art === "gefuellt"
            ? befundMitRegel(null, A, ohnePartnerArt, regel, null, 0, ecke)
            : befundMitRegel(A, null, ohnePartnerArt, regel, null, 0, ecke));
        }
        continue;
      }
      let beste = Infinity;
      let besterJ = partner[0];
      for (const j of partner) {
        const B = arbeit[j];
        // 'gefuellt': b ⊆ a — die Abweichung misst das iterierte Element (b)
        // gegen den Kandidaten (a). 'enthalten': a ⊆ b. 'deckung': Grenzen gleich.
        const abweichung = art === "deckung"
          ? deckungAbweichung(A.geo.aabb, B.geo.aabb)
          : containmentAbweichung(A.geo.aabb, B.geo.aabb);
        if (abweichung < beste) { beste = abweichung; besterJ = j; }
      }
      if (beste > tol) {
        // R-2 (71-02-Nacharbeit): der Befund trägt die Seiten wie die REGEL sie
        // nennt — a* = Regelseite A, b* = Regelseite B. Bei 'gefuellt' ist das
        // iterierte Element die B-Seite, der Kandidat die A-Seite.
        const [seiteA, seiteB] = art === "gefuellt" ? [arbeit[besterJ], A] : [A, arbeit[besterJ]];
        clashes.push(befundMitRegel(seiteA, seiteB, art, regel, beste,
          overlapVolume(A.geo.aabb, arbeit[besterJ].geo.aabb),
          schnittboxMitte(A.geo.aabb, arbeit[besterJ].geo.aabb)));
      }
      if (geprueft % 200 === 0) {
        yield { typ: "fortschritt", geprueft, gesamt: gesamtSchnitt + gesamtContain };
      }
    }
  }

  // (f) Ausgabe sortieren: overlapVol absteigend, Tie-Breaks aufsteigend
  //     -> Doppellauf byte-identisch (JSON-Vergleich im Smoke). 71-02:
  //     null-sicher (ohne_partner-Befunde haben bId null) und Abweichung als
  //     weiterer Tie-Break, damit auch Containment-Läufe deterministisch sind.
  const idOder = (v) => (Number.isFinite(v) ? v : -1);
  clashes.sort((x, y) => (y.overlapVol - x.overlapVol)
    || (idOder(x.aId) - idOder(y.aId))
    || (idOder(x.bId) - idOder(y.bId))
    || ((y.abweichungMm ?? -1) - (x.abweichungMm ?? -1)));

  return { clashes, geprueft, uebersprungen, ohneGeometrie };
}

// ---------------------------------------------------------------------------
// 9) clashPairs — synchroner Drain von clashPairsIter (node-smoke-tauglich)
// ---------------------------------------------------------------------------

export function clashPairs(elems, optionen = {}) {
  const iterator = clashPairsIter(elems, optionen);
  let schritt = iterator.next();
  while (!schritt.done) schritt = iterator.next();
  return schritt.value;
}

// ---------------------------------------------------------------------------
// 10) lcg — deterministischer Seed-Zufall (32-Bit-LCG, Numerical-Recipes-Konstanten)
// ---------------------------------------------------------------------------

// Math.imul + >>>0 erzwingen exakte 32-Bit-Arithmetik in JS. Export aus
// clash.js, damit Performance-Smoke und ModelCheck-Demo dieselbe Quelle nutzen.
export function lcg(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296; // [0,1)
  };
}

// ---------------------------------------------------------------------------
// 11) boxTris — 12 Dreiecke einer achsparallelen Box (Fixture-Helfer)
// ---------------------------------------------------------------------------

// Konsistent nach aussen orientiert (CCW von aussen betrachtet, rechtshaendig).
export function boxTris(min, max) {
  const x0 = min[0], y0 = min[1], z0 = min[2];
  const x1 = max[0], y1 = max[1], z1 = max[2];
  return new Float32Array([
    // Boden (z = z0), Normale -Z
    x0, y0, z0, x0, y1, z0, x1, y1, z0,
    x0, y0, z0, x1, y1, z0, x1, y0, z0,
    // Deckel (z = z1), Normale +Z
    x0, y0, z1, x1, y0, z1, x1, y1, z1,
    x0, y0, z1, x1, y1, z1, x0, y1, z1,
    // Vorn (y = y0), Normale -Y
    x0, y0, z0, x1, y0, z0, x1, y0, z1,
    x0, y0, z0, x1, y0, z1, x0, y0, z1,
    // Hinten (y = y1), Normale +Y
    x0, y1, z0, x0, y1, z1, x1, y1, z1,
    x0, y1, z0, x1, y1, z1, x1, y1, z0,
    // Links (x = x0), Normale -X
    x0, y0, z0, x0, y0, z1, x0, y1, z1,
    x0, y0, z0, x0, y1, z1, x0, y1, z0,
    // Rechts (x = x1), Normale +X
    x1, y0, z0, x1, y1, z0, x1, y1, z1,
    x1, y0, z0, x1, y1, z1, x1, y0, z1,
  ]);
}
