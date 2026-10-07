// Wohnungsplaner (Phase 21) — deterministische Konzept-Layout-Funktionen im Stil
// von src/lib/statics.js: reine Funktionen, keine Date/Random, node-smoke-fähig
// (self-contained, KEINE Imports). Erzeugt Rechteck-Zonen im selben zentrierten
// Meter-Koordinatensystem wie footprintM (Ursprung = Footprint-Mittelpunkt),
// damit sie 1:1 in useBuildingProgram().zones passen (Gebäudemodell, Massing).
// KONZEPT-Raster — kein Grundriss- oder Wohnflächen-Nachweis (WoFlV).

// Zahlen-Härtung: nie NaN/Infinity weiterreichen.
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// Härtende Division: nie durch <0.1 teilen (Muster statics.js/compliance.js).
const safeDiv = (a, b) => num(a) / Math.max(0.1, num(b));

// Standard-Wohnungstypen als Startbelegung der Typenliste. [ASSUMED]
export const DEFAULT_TYPEN = [
  { key: "t2", name: "2-Zimmer", zimmer: 2, flaeche_m2: 60 },
  { key: "t3", name: "3-Zimmer", zimmer: 3, flaeche_m2: 75 },
  { key: "t4", name: "4-Zimmer", zimmer: 4, flaeche_m2: 95 },
];

// Marker-Suffix im Zonen-Namen, an dem generierte Wohnungs-Zonen erkannt werden.
// layoutApartments hängt genau dieses Suffix an (" ·W" inkl. führendem Leerzeichen).
export const GEN_MARKER = " ·W";

// Erkennt vom Wohnungsplaner generierte Zonen — NUR das strikte Suffix " ·W".
// Bewusst KEIN includes(): Nutzer-Zonen wie „Trakt·West" dürfen beim Regenerieren
// nicht als generiert erkannt und gelöscht werden (ME-03, Datenverlust).
export function istGeneriert(zone) {
  const n = typeof zone?.name === "string" ? zone.name : "";
  return n.endsWith(GEN_MARKER);
}

// Bounding-Box eines footprintM-Polygons [{x,z}] — Geometrie bewusst inline
// (self-contained). Fallback: Default-Footprint 20×14 m zentriert (wie Store).
function footprintBBox(footprintM) {
  const pts = Array.isArray(footprintM) && footprintM.length >= 3
    ? footprintM
    : [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
  const xs = pts.map((p) => num(p.x));
  const zs = pts.map((p) => num(p.z));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ };
}

// Deterministisches Rechteck-Reihen-Layout in der Footprint-BBox.
// runs = [{ typ: { name, flaeche_m2 }, countPerFloor, floorFrom, floorTo }]
// → zones = [{ points: [{x,z}×4], level, name: `${typ.name} ${level}-${lfd} ·W` }]
// Koordinaten im zentrierten Meter-System des Footprints. Wohnungstiefe
// tiefe = min(BBox-Tiefe, 12 m) [ASSUMED]; Breite = flaeche/tiefe; Reihen entlang
// der X-Achse ab BBox-Min, Zeilenumbruch bei BBox-Breiten-Überschreitung.
// Konzept-Layout — kein Overlap-Anspruch bei Überbelegung.
export function layoutApartments(footprintM, runs) {
  const bb = footprintBBox(footprintM);
  const tiefe = Math.max(1, Math.min(num(bb.d, 14), 12));
  const zones = [];
  // Platzierungs-Cursor je Geschoss (lfd. Nummer geschossweise über alle Typen).
  const cursor = new Map(); // level -> { x, z, n }
  for (const run of Array.isArray(runs) ? runs : []) {
    const typ = run?.typ || {};
    const flaeche = Math.max(1, num(typ.flaeche_m2, 1));
    const breite = Math.max(0.5, safeDiv(flaeche, tiefe));
    const count = Math.max(0, Math.round(num(run?.countPerFloor)));
    const from = Math.round(num(run?.floorFrom));
    const to = Math.round(num(run?.floorTo, from));
    const lo = Math.min(from, to), hi = Math.max(from, to);
    for (let level = lo; level <= hi; level++) {
      let cur = cursor.get(level);
      if (!cur) { cur = { x: bb.minX, z: bb.minZ, n: 0 }; cursor.set(level, cur); }
      for (let i = 0; i < count; i++) {
        // Zeilenumbruch, wenn das Rechteck rechts aus der BBox laufen würde.
        if (cur.x > bb.minX && cur.x + breite > bb.maxX + 1e-9) {
          cur.x = bb.minX;
          cur.z += tiefe;
        }
        cur.n += 1;
        const x0 = cur.x, z0 = cur.z;
        zones.push({
          points: [
            { x: x0, z: z0 },
            { x: x0 + breite, z: z0 },
            { x: x0 + breite, z: z0 + tiefe },
            { x: x0, z: z0 + tiefe },
          ],
          level,
          name: `${typ.name || "Wohnung"} ${level}-${cur.n} ·W`,
        });
        cur.x += breite;
      }
    }
  }
  return zones;
}

// Gesamt-Wohnfläche (m²) aller Runs: Σ flaeche · count · Geschossanzahl.
export function wohnflaecheSumme(runs) {
  return (Array.isArray(runs) ? runs : []).reduce((sum, run) => {
    const flaeche = Math.max(0, num(run?.typ?.flaeche_m2));
    const count = Math.max(0, Math.round(num(run?.countPerFloor)));
    const from = Math.round(num(run?.floorFrom));
    const to = Math.round(num(run?.floorTo, from));
    const geschosse = Math.abs(to - from) + 1;
    return sum + flaeche * count * geschosse;
  }, 0);
}

// Anzahl erzeugter Wohneinheiten (WE) über alle Runs.
export function wohnungenAnzahl(runs) {
  return (Array.isArray(runs) ? runs : []).reduce((sum, run) => {
    const count = Math.max(0, Math.round(num(run?.countPerFloor)));
    const from = Math.round(num(run?.floorFrom));
    const to = Math.round(num(run?.floorTo, from));
    return sum + count * (Math.abs(to - from) + 1);
  }, 0);
}

// Plausibilitäts-Checks im Muster von vorbemessungChecks (statics.js).
// Bewusst NUR "pass"/"warn" (Hinweis-Charakter), NIE "fail" — Konzept-Raster,
// kein Wohnungsschlüssel-/Förder-Nachweis.
export function apartmentChecks(runs, ngf) {
  const summe = wohnflaecheSumme(runs);
  const n = Math.max(0, num(ngf));
  const aktiveTypen = (Array.isArray(runs) ? runs : [])
    .filter((r) => Math.round(num(r?.countPerFloor)) > 0).length;
  const auslastung = n > 0 ? safeDiv(summe, n) * 100 : 0;
  const nf = (v) => Math.round(v).toLocaleString("de-DE");

  const items = [
    {
      key: "belegung",
      label: "Wohnfläche vs. NGF",
      status: n > 0 && summe > n ? "warn" : "pass",
      detail: n > 0 && summe > n
        ? `Überbelegung: ${nf(summe)} m² Wohnfläche > ${nf(n)} m² NGF`
        : `${nf(summe)} m² Wohnfläche von ${nf(n)} m² NGF`,
    },
    {
      key: "typen",
      label: "Wohnungstypen definiert",
      status: aktiveTypen > 0 ? "pass" : "warn",
      detail: aktiveTypen > 0
        ? `${nf(aktiveTypen)} Typ(en) mit Anzahl > 0`
        : "kein Wohnungstyp mit Anzahl je Geschoss > 0",
    },
    {
      key: "auslastung",
      label: "NGF-Auslastung",
      status: n > 0 && summe > 0 && auslastung < 50 ? "warn" : "pass",
      detail: n > 0 && summe > 0 && auslastung < 50
        ? `Reserve: nur ${nf(auslastung)} % der NGF belegt`
        : n > 0
          ? `${nf(auslastung)} % der NGF (Richtwert)`
          : "keine NGF aus dem Gebäudemodell (kein Footprint gesetzt)",
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}
