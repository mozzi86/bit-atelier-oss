// Grundriss (Footprint) aus IFC-Geometrie ableiten.
//
// Warum es das gibt (26.08.2026): `BimModel.footprintM` speist über
// `useBuildingProgram` sämtliche Kennzahlen der Fachreiter (BGF, GRZ/GFZ, Höhe,
// Brandschutz-Richtwerte …). Beim Referenzprojekt stand dort ein prozedurales 40×26-m-Rechteck,
// während das echte Gebäude als IFC daneben lag — die Reiter rechneten auf einem
// Klötzchen. Der BimSnapshot half nicht: er trägt Sachdaten, aber KEINE Koordinaten.
// Die einzige Quelle für die echte Kubatur ist die IFC-Geometrie.
//
// Verfahren — bewusst Raster statt konvexer Hülle:
//   1. Dreiecke der tragenden Bauteile auf die XZ-Ebene projizieren (Y ist oben),
//   2. in ein Belegungsraster füllen,
//   3. die größte zusammenhängende Fläche umranden,
//   4. den Umriss vereinfachen und auf den Schwerpunkt zentrieren.
// Eine konvexe Hülle würde L-Formen, Innenhöfe und Rücksprünge glattbügeln und die
// Fläche zu groß ausweisen — bei einem Bestandsumbau ist genau das der Fehler.

// Deckenplatten sind der eigentliche Träger der Grundfläche.
//
// Gemessen am Referenzprojekt (tools/grundriss-diagnose.mjs, 26.08.2026): IfcSlab allein ergibt im
// EG 5.103 m² über 180 Platten. Wände allein liefern nur 522 m² — sie sind im Grundriss
// dünne, fragmentierte Linien und umschließen keine Fläche. Die Decke ist die Platte,
// auf der man steht; sie ist die richtige Quelle.
export const DECKEN_KLASSEN = new Set(["IfcSlab"]);

// Rückfall, wenn ein Modell keine Decken führt: die Hülle plus alles Raumbildende.
// IfcSpace/IfcOpeningElement gehören NICHT dazu (Räume liegen innen, Öffnungen sind
// Löcher); Möblierung und Proxys ebenso wenig.
export const UMRISS_KLASSEN = new Set([
  "IfcWall", "IfcWallStandardCase", "IfcSlab", "IfcColumn", "IfcCurtainWall", "IfcRoof",
]);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Belegungsraster aus projizierten Dreiecken.
 * @returns {{grid: Uint8Array, nx: number, nz: number, minX: number, minZ: number, zelle: number}}
 */
export function rasterAusDreiecken(dreiecke, zelle = 0.5) {
  if (!dreiecke?.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of dreiecke) {
    for (const [x, z] of t) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxZ - minZ <= 0) return null;
  // Ein Rand von einer Zelle, damit die Umrandung nie am Feldrand klebt.
  const nx = Math.ceil((maxX - minX) / zelle) + 3;
  const nz = Math.ceil((maxZ - minZ) / zelle) + 3;
  if (nx * nz > 4_000_000) return null; // Schutz vor absurd großen Modellen
  const grid = new Uint8Array(nx * nz);
  const x0 = minX - zelle, z0 = minZ - zelle;

  for (const [a, b, c] of dreiecke) {
    // Bounding-Box des Dreiecks im Raster, dann Punkt-in-Dreieck je Zellmitte.
    const tx0 = clamp(Math.floor((Math.min(a[0], b[0], c[0]) - x0) / zelle), 0, nx - 1);
    const tx1 = clamp(Math.ceil((Math.max(a[0], b[0], c[0]) - x0) / zelle), 0, nx - 1);
    const tz0 = clamp(Math.floor((Math.min(a[1], b[1], c[1]) - z0) / zelle), 0, nz - 1);
    const tz1 = clamp(Math.ceil((Math.max(a[1], b[1], c[1]) - z0) / zelle), 0, nz - 1);
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    for (let iz = tz0; iz <= tz1; iz++) {
      for (let ix = tx0; ix <= tx1; ix++) {
        if (grid[iz * nx + ix]) continue;
        const px = x0 + (ix + 0.5) * zelle, pz = z0 + (iz + 0.5) * zelle;
        if (Math.abs(d) < 1e-12) {
          // Entartetes Dreieck (Linie): nur Zellen auf der Strecke belegen.
          const nah = Math.min(
            Math.hypot(px - a[0], pz - a[1]), Math.hypot(px - b[0], pz - b[1]), Math.hypot(px - c[0], pz - c[1]),
          );
          if (nah <= zelle) grid[iz * nx + ix] = 1;
          continue;
        }
        const w1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[1])) / d;
        const w2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[1])) / d;
        const w3 = 1 - w1 - w2;
        if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) grid[iz * nx + ix] = 1;
      }
    }
  }
  return { grid, nx, nz, minX: x0, minZ: z0, zelle };
}

/** Größte zusammenhängende Belegung (4er-Nachbarschaft) — Nebengebäude fallen weg. */
export function groessteFlaeche({ grid, nx, nz }) {
  const marke = new Int32Array(grid.length).fill(-1);
  let bestId = -1, bestN = 0, id = 0;
  const stapel = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || marke[i] >= 0) continue;
    let n = 0;
    stapel.length = 0;
    stapel.push(i);
    marke[i] = id;
    while (stapel.length) {
      const k = stapel.pop();
      n++;
      const x = k % nx, z = (k - x) / nx;
      if (x > 0 && grid[k - 1] && marke[k - 1] < 0) { marke[k - 1] = id; stapel.push(k - 1); }
      if (x < nx - 1 && grid[k + 1] && marke[k + 1] < 0) { marke[k + 1] = id; stapel.push(k + 1); }
      if (z > 0 && grid[k - nx] && marke[k - nx] < 0) { marke[k - nx] = id; stapel.push(k - nx); }
      if (z < nz - 1 && grid[k + nx] && marke[k + nx] < 0) { marke[k + nx] = id; stapel.push(k + nx); }
    }
    if (n > bestN) { bestN = n; bestId = id; }
    id++;
  }
  if (bestId < 0) return null;
  const nur = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) if (marke[i] === bestId) nur[i] = 1;
  return { grid: nur, zellen: bestN };
}

/**
 * Umriss der Belegung als Polygon in Metern.
 *
 * Verfahren: Randkanten sammeln und verketten — NICHT „Wand verfolgen". Ein
 * Wall-Follower taugt für Linien; auf einer VOLLFLÄCHE wandert er durch das Innere
 * (erster Lauf: 18.360 Randpunkte und 71.196 m² für ein 1.040-m²-Rechteck).
 * Hier trägt stattdessen jede belegte Zelle genau die Kanten bei, die an eine leere
 * Zelle grenzen; die Kanten werden im Uhrzeigersinn orientiert und zu Schleifen
 * verkettet. Die längste Schleife ist der äußere Rand — Innenhöfe bilden eigene,
 * kürzere Schleifen und entfallen (footprintM kennt keine Löcher, siehe Hinweis
 * in `grundrissAusModell`).
 */
export function umriss({ grid, nx, nz, minX, minZ, zelle }) {
  const belegt = (x, z) => x >= 0 && z >= 0 && x < nx && z < nz && grid[z * nx + x] === 1;
  const schluessel = (x, z) => `${x},${z}`;
  // Kanten auf dem ECKEN-Gitter, im Uhrzeigersinn um jede belegte Zelle.
  const kanten = new Map(); // Startecke -> Endecke
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      if (!belegt(x, z)) continue;
      if (!belegt(x, z - 1)) kanten.set(schluessel(x, z), [x + 1, z]);             // oben:  →
      if (!belegt(x + 1, z)) kanten.set(schluessel(x + 1, z), [x + 1, z + 1]);     // rechts: ↓
      if (!belegt(x, z + 1)) kanten.set(schluessel(x + 1, z + 1), [x, z + 1]);     // unten:  ←
      if (!belegt(x - 1, z)) kanten.set(schluessel(x, z + 1), [x, z]);             // links:  ↑
    }
  }
  if (!kanten.size) return [];

  // Zu Schleifen verketten; die längste ist der äußere Rand.
  const offen = new Map(kanten);
  let beste = [];
  while (offen.size) {
    const [startK] = offen.keys();
    const schleife = [];
    let k = startK;
    while (offen.has(k)) {
      const [nx2, nz2] = offen.get(k);
      offen.delete(k);
      const [px, pz] = k.split(",").map(Number);
      schleife.push([px, pz]);
      k = schluessel(nx2, nz2);
    }
    if (schleife.length > beste.length) beste = schleife;
  }

  // Eckenkoordinaten → Meter (die Ecke (0,0) liegt auf der linken oberen Zellkante).
  return beste.map(([x, z]) => ({ x: minX + x * zelle, z: minZ + z * zelle }));
}

/**
 * Douglas-Peucker auf {x,z}-Punkten.
 *
 * INDEX-basiert, nicht wert-basiert: Ein gerasterter Rand enthält denselben Punkt
 * mehrfach. Ein Rekonstruieren der Reihenfolge über `indexOf` trifft dann den falschen
 * Treffer, das Polygon verdreht sich und die Fläche explodiert (beim ersten Lauf:
 * 21.004 m² statt 400 m² für ein L). Deshalb wird eine Behalten-Maske geführt.
 */
export function vereinfachen(punkte, toleranz = 0.8) {
  if (!punkte || punkte.length < 3) return punkte || [];
  const abstand = (p, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.z - a.z);
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  };
  const behalten = new Uint8Array(punkte.length);
  behalten[0] = 1;
  behalten[punkte.length - 1] = 1;
  // Iterativ statt rekursiv — ein Rand kann Zehntausende Punkte haben.
  const stapel = [[0, punkte.length - 1]];
  while (stapel.length) {
    const [first, last] = stapel.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = abstand(punkte[i], punkte[first], punkte[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > toleranz && idx > 0) {
      behalten[idx] = 1;
      stapel.push([first, idx], [idx, last]);
    }
  }
  return punkte.filter((_, i) => behalten[i]);
}

/** Fläche eines {x,z}-Polygons (Shoelace, m²). */
export const polygonFlaeche = (pts) => (!pts || pts.length < 3 ? 0
  : Math.abs(pts.reduce((a, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return a + (p.x * q.z - q.x * p.z);
  }, 0) / 2));

/** Auf den Flächenschwerpunkt zentrieren — `footprintM` erwartet ein zentriertes Polygon. */
export function zentrieren(pts) {
  if (!pts?.length) return [];
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
  return pts.map((p) => ({ x: Math.round((p.x - cx) * 100) / 100, z: Math.round((p.z - cz) * 100) / 100 }));
}

/**
 * Geschosse aus dem Modell ableiten.
 *
 * `IfcBuildingStorey` allein genügt nicht: Modelle führen oft Geschosse, in denen kein
 * einziges Bauteil liegt (am Referenzprojekt „−2.UG" mit 0 Bauteilen mit Geometrie). Für Kennzahlen
 * wie die BGF zählt nur, was auch gebaut ist — deshalb wird beides geliefert und der
 * Aufrufer bekommt die belegten als maßgebliche Zahl.
 *
 * @returns {{alle: Array<string>, belegt: Array<string>, anzahl: number,
 *            leer: Array<string>}}
 */
export function geschosseAusModell(modell) {
  const alle = [...new Set([...(modell?.storeys || [])].filter(Boolean))];
  const mitGeometrie = new Set((modell?.merged?.ranges || []).map((r) => r.eid));
  const belegtSet = new Set();
  for (const e of modell?.elements || []) {
    const g = e.geschoss || e.storey;
    if (!g) continue;
    // Ohne Range-Tabelle (nur Semantik) zählt jedes Bauteil, sonst nur Bauteile mit Geometrie.
    if (!mitGeometrie.size || mitGeometrie.has(e.expressId)) belegtSet.add(g);
  }
  const belegt = [...belegtSet];
  const reihenfolge = alle.length ? alle : belegt;
  const sortiert = reihenfolge.filter((g) => belegt.includes(g));
  return {
    alle: alle.length ? alle : belegt,
    belegt: sortiert.length ? sortiert : belegt,
    anzahl: (sortiert.length ? sortiert : belegt).length,
    leer: (alle.length ? alle : []).filter((g) => !belegt.includes(g)),
  };
}

/**
 * Grundriss aus einem geparsten IFC-Modell ableiten.
 *
 * @param {{elements: Array<object>, merged: {positions: Float32Array, index: Uint32Array|Array, ranges: Array<{eid,start,count}>}}} modell
 * @param {{geschoss?: string|null, zelle?: number, toleranz?: number, klassen?: Set<string>}} [opt]
 *   `geschoss` grenzt auf ein Geschoss ein (empfohlen: das unterste oberirdische);
 *   ohne Angabe zählen alle Umriss-Bauteile.
 * @returns {{polygon: Array<{x,z}>, flaeche: number, rasterFlaeche: number,
 *            bauteile: number, geschoss: string|null, hinweis: string|null}|null}
 */
export function grundrissAusModell(modell, opt = {}) {
  const { geschoss = null, zelle = 0.5, toleranz = 0.8, klassen = null } = opt;
  const merged = modell?.merged;
  const positions = merged?.positions;
  const index = merged?.index;
  const ranges = merged?.ranges;
  if (!positions || !index || !ranges?.length) return null;

  // Decken zuerst, Hülle als Rückfall — siehe DECKEN_KLASSEN.
  const imGeschoss = (e) => !geschoss || e.geschoss === geschoss || e.storey === geschoss;
  const auswahl = (menge) => new Set(
    (modell.elements || [])
      .filter((e) => menge.has(e.ifc_klasse || e.ifcType))
      .filter(imGeschoss)
      .map((e) => e.expressId),
  );
  let passend = klassen ? auswahl(klassen) : auswahl(DECKEN_KLASSEN);
  let quelle = klassen ? "vorgegebene Klassen" : "Deckenplatten (IfcSlab)";
  if (!klassen && passend.size === 0) {
    passend = auswahl(UMRISS_KLASSEN);
    quelle = "Hülle (keine Decken im Modell)";
  }
  if (!passend.size) return null;

  const dreiecke = [];
  for (const r of ranges) {
    if (!passend.has(r.eid)) continue;
    for (let i = r.start; i < r.start + r.count; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      // Y (Index +1) ist die Höhe und entfällt bei der Projektion.
      dreiecke.push([
        [positions[a], positions[a + 2]],
        [positions[b], positions[b + 2]],
        [positions[c], positions[c + 2]],
      ]);
    }
  }
  if (!dreiecke.length) return null;

  const raster = rasterAusDreiecken(dreiecke, zelle);
  if (!raster) return null;
  const groesste = groessteFlaeche(raster);
  if (!groesste) return null;

  const rand = umriss({ ...raster, grid: groesste.grid });
  const polygon = zentrieren(vereinfachen(rand, toleranz));
  const flaeche = Math.round(polygonFlaeche(polygon) * 10) / 10;
  const rasterFlaeche = Math.round(groesste.zellen * zelle * zelle * 10) / 10;

  // Ehrlichkeitsprüfung: Weicht der vereinfachte Umriss stark von der gerasterten
  // Belegung ab, ist der Grundriss verschachtelt (Innenhof, Lichtschacht) — dann ist
  // die Polygonfläche zu groß und der Nutzer muss das wissen.
  const abweichung = rasterFlaeche > 0 ? Math.abs(flaeche - rasterFlaeche) / rasterFlaeche : 0;
  const hinweis = abweichung > 0.15
    ? `Umriss ${flaeche} m² gegen gerasterte Belegung ${rasterFlaeche} m² `
      + `(${Math.round(abweichung * 100)} % Abweichung) — vermutlich Innenhof oder Rücksprünge; `
      + "footprintM kennt keine Löcher, die Fläche ist dadurch eher zu groß."
    : null;

  return { polygon, flaeche, rasterFlaeche, bauteile: passend.size, geschoss, quelle, hinweis };
}
