// Regel-Öffnungen der Gebäudehülle: automatische Fenster (je ~3,5 m eines) und
// die Eingangstür im Erdgeschoss.
//
// EINE Quelle für 3D, Grundriss/Maßketten und IFC-Export. Vorher rechnete jede
// Darstellung die Regel selbst und der Export ließ sie komplett weg — Modell und
// Export widersprachen sich sichtbar (KD-16). Ergebnisformat je Öffnung:
//   { level, edge, kind: "window" | "door", u, width, height, sill }
// u = Abstand entlang der Wand von a nach b (Meter).
//
// 75-11 (MSB-13): ZWEI Fensterwege in dieser Datei — autoEnvOpenings (je
// ~3,5 m, unverändert für BIM-Studio/Raumklima/Schallschutz/raumOeffnungen/
// IFC) und fensterJeRaum (je Raum im eigenen Fassadenabschnitt, Schalter
// „Fenster je Raum" in der Werkstatt). Der alte Weg bleibt byte-gleich.
import { fassadenAbschnitte } from "@designer/lib/raumFassade";

// Standard-Regel für Auto-Fenster (Achsabstand, Größe, Brüstung).
export const AUTO_WINDOW = { spacing: 3.5, width: 1.4, height: 1.4, sill: 0.9 };
// Vorgabewerte der Eingangstür (uRel = relative Position auf der Wand, 0…1;
// edge = Hüllwand-Kante im EG, null = erste Kante). Konfigurierbar über das
// Gebäudemodell (KD-19) — vorher waren 1,20 x 2,10 m mittig fest verdrahtet.
export const ENTRANCE_DEFAULT = { width: 1.2, height: 2.1, uRel: 0.5, edge: null, enabled: true };

export const wallLength = (w) => (w ? Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) : 0);

// Auto-Fenster einer Wand: gleichmäßig verteilt, je ~spacing Meter eines.
export function autoWindowUVs(w, cfg = AUTO_WINDOW) {
  const c = { ...AUTO_WINDOW, ...(cfg || {}) };
  const len = wallLength(w);
  const count = Math.max(0, Math.floor(len / c.spacing));
  const out = [];
  for (let k = 0; k < count; k++) {
    out.push({ u: ((k + 0.5) / count) * len, width: c.width, height: c.height, sill: c.sill, kind: "window" });
  }
  return out;
}

// Wand, auf der die Eingangstür sitzt: gewählte EG-Kante, sonst die erste.
export function entranceWall(walls, edge = null) {
  const eg = (walls || []).filter((w) => w.level === 0);
  if (edge != null) return eg.find((w) => w.edge === edge) || eg[0] || null;
  return eg[0] || null;
}

// Eingangstür als Öffnung (oder null, wenn abgeschaltet / keine EG-Wand da).
export function entranceOpening(walls, cfg = ENTRANCE_DEFAULT) {
  const c = { ...ENTRANCE_DEFAULT, ...(cfg || {}) };
  if (c.enabled === false) return null;
  const w = entranceWall(walls, c.edge);
  if (!w) return null;
  const len = wallLength(w) || 1;
  const uRel = Math.min(Math.max(c.uRel ?? 0.5, 0), 1);
  return { level: w.level, edge: w.edge, kind: "door", u: len * uRel, width: c.width, height: c.height, sill: 0 };
}

// Überlappen sich zwei Öffnungen auf derselben Wand (Intervall entlang u)?
const ueberlappt = (a, b) =>
  a.u - a.width / 2 < b.u + b.width / 2 + 0.05 && b.u - b.width / 2 < a.u + a.width / 2 + 0.05;

/**
 * Alle Regel-Öffnungen der Hüllwände.
 * @param {Array<object>} walls   Hüllwände des Modells ([{a,b,level,edge,...}])
 * @param {{ window?: object, entrance?: object }} [cfg] window = AUTO_WINDOW-Teil,
 *                entrance = ENTRANCE_DEFAULT-Teil. (JSDoc-Typ ausgeschrieben: die frühere
 *                Kurzform „{ window?: …}" las tsc als Typ `Window` — Fehler bei jedem Aufrufer.)
 * @param {Array<object>} [placed]  benutzerplatzierte Öffnungen [{level,edge,u,width}] — Auto-Fenster
 *                an derselben Stelle werden weggelassen (sonst überlappende Löcher
 *                im 3D und doppelt abgezogene Mengen im IFC).
 */
export function autoEnvOpenings(walls, cfg = {}, placed = []) {
  const out = [];
  const door = entranceOpening(walls, cfg.entrance);
  const belegt = (w, o) => [...placed, ...(door ? [door] : [])]
    .some((p) => p.level === w.level && p.edge === w.edge && ueberlappt(p, o));
  (walls || []).forEach((w) => {
    autoWindowUVs(w, cfg.window).forEach((o) => {
      if (belegt(w, o)) return;
      out.push({ level: w.level, edge: w.edge, kind: "window", u: o.u, width: o.width, height: o.height, sill: o.sill });
    });
  });
  if (door) out.push(door);
  return out;
}

// ---- 75-11 Task 2 (MSB-13): windows per room, from the room's OWN facade ----

/**
 * Rule values for fensterJeRaum. breite/hoehe/sill derive from AUTO_WINDOW
 * (ONE source); maxAchsAbstand = AUTO_WINDOW.spacing so wide rooms still get
 * several windows.
 * 75-13 adds the cap and daylight values: fensterMax (1|2 windows per room),
 * maxBreite (m, widest single window), eckSeiteMin (m, both facades of a corner
 * room), belichtungAnteil (window area / floor area, MBO §47 Abs. 2).
 * @type {{breite:number, hoehe:number, sill:number, randAbstand:number, minBreite:number, maxAchsAbstand:number, fensterMax:number, maxBreite:number, eckSeiteMin:number, belichtungAnteil:number}}
 */
export const FENSTER_JE_RAUM = {
  breite: AUTO_WINDOW.width,     // 1.4 m rule width (from AUTO_WINDOW)
  hoehe: AUTO_WINDOW.height,     // 1.4 m rule height
  sill: AUTO_WINDOW.sill,        // 0.9 m sill height
  // [ASSUMED] 0.50 m clear distance from window edge to the room partition
  // (user requirement 21.09., HANDOFF-MASSING §10 MSB-13). Provable path:
  // clear dimension to the partition per execution planning (Ausführungsplanung).
  randAbstand: 0.5,
  // [ASSUMED] 0.60 m minimum width — narrower is no habitable-room window.
  minBreite: 0.6,
  maxAchsAbstand: AUTO_WINDOW.spacing, // 3.5 m axis distance for several windows
  // 75-13: cap per room (user brief 04.10.2026 "immer nur ein fenster pro raum
  // maximal 2"): default 1, corner room 2, user may set 1|2. A window may grow
  // to maxBreite before a second one is added for daylight.
  fensterMax: 1,
  maxBreite: 2.4,              // [ASSUMED] widest single window before a second one
  eckSeiteMin: 2.0,            // [ASSUMED] both facades ≥ 2 m → corner room, one window each
  belichtungAnteil: 1 / 8,     // CITED MBO §47 Abs. 2: window area ≥ 1/8 of the floor area
};

/**
 * Windows per windowed room IN THE ROOM'S OWN facade segment — never across a
 * partition (MSB-13, user decision 21.09.2026), CAPPED per room (75-13 Task 2,
 * MSB-22): default ONE window, centred on the room's longest facade segment;
 * a corner room (two segments ≥ eckSeiteMin) gets one per facade; the user may
 * set the cap to 1 or 2 globally (cfg.fensterMax) or per room
 * (cfg.fensterMaxJeRaum[zoneName]). Daylight 1/8 (CITED MBO §47 Abs. 2) is
 * checked here only to SIZE the opening: too little glass → the window widens
 * up to maxBreite, only then a second window is added (with `hinweis` on the
 * entry); belichtungJeWE still judges the result downstream.
 *
 * Drop-in shape of autoEnvOpenings ({ level, edge, kind, u, width, height,
 * sill }) PLUS `raum` (zone name) per window so the assignment stays
 * traceable, optional `hinweis`, and the entrance door appended exactly like
 * autoEnvOpenings.
 *
 * Placement per segment: usable length L = (u1−u0) − 2·randAbstand; n = 1
 * window, or n = 2 only when the cap is 2 and the segment is ≥ 2·maxAchsAbstand
 * long (a shorter segment keeps ONE window — a second one only comes from the
 * daylight rule below); width w = min(breite, max(minBreite, L/n)), widened up to
 * maxBreite for daylight; centres u = u0 + randAbstand + (L/n)·(k+0.5) — for
 * n = 1 exactly the segment centre. w < breite → the room also lands in
 * raeumeOhneRegelfenster (it gets light, just not the rule size).
 *
 * @param {Array<{points?: Array<{x:number,z:number}>, level?: number, name?: string, fensterpflicht?: boolean, flaeche_m2?: number}>} zonen
 *   room zones WITH fensterpflicht — must come from ergebnis.zonen, NOT
 *   plan.zones (usePlanModel drops the field, see its :60-65)
 * @param {Array<{a:{x:number,z:number}, b:{x:number,z:number}, level?: number, edge?: number}>} walls
 *   envelope walls of the model (metres)
 * @param {{entrance?: object, fensterMax?: number, fensterMaxJeRaum?: Record<string, number>}} [cfg]
 *   entrance config like autoEnvOpenings; fensterMax 1|2 (default FENSTER_JE_RAUM.fensterMax);
 *   fensterMaxJeRaum per zone NAME
 * @param {Array<object>} [placed] user-placed openings suppressing auto
 *   windows at the same spot (ueberlappt, as before)
 * @returns {Array<{level:number, edge:number, kind:"window"|"door", u:number, width:number, height:number, sill:number, raum?:string, hinweis?:string}>}
 *   openings in metres along the wall (u), window size in metres
 */
export function fensterJeRaum(zonen, walls, cfg = {}, placed = []) {
  /** @type {Array<{level:number, edge:number, kind:"window"|"door", u:number, width:number, height:number, sill:number, raum?:string, hinweis?:string}>} */
  const out = [];
  const R = FENSTER_JE_RAUM;
  const door = entranceOpening(walls, cfg.entrance);
  const belegt = (level, edge, o) => [...placed, ...(door ? [door] : [])]
    .some((p) => p.level === level && p.edge === edge && ueberlappt(p, o));
  const capGlobal = Number(cfg.fensterMax) === 2 ? 2 : R.fensterMax;
  const liste = Array.isArray(zonen) ? zonen : [];
  for (const zone of liste) {
    if (zone?.fensterpflicht !== true) continue; // Küche/Bad/Abstell/Flur: no auto window
    const abschnitte = fassadenAbschnitte(zone, walls); // longest first
    if (!abschnitte.length) continue; // room reported by raeumeOhneRegelfenster
    const name = String(zone?.name || "");
    const jeRaum = cfg.fensterMaxJeRaum && Number(cfg.fensterMaxJeRaum[name]);
    const eck = abschnitte.length >= 2 && abschnitte[1].laengeM >= R.eckSeiteMin;
    // Effective cap: per-room setting > corner rule (2 even at default 1) > global.
    const cap = jeRaum === 1 || jeRaum === 2 ? jeRaum : (eck ? 2 : capGlobal);
    /** @type {Array<{abs: object, u: number, width: number, nutzbar: number, n: number}>} */
    const fenster = [];
    const platziere = (abs, n) => {
      const spanne = abs.u1 - abs.u0;
      const nutzbar = spanne - 2 * R.randAbstand;
      // Narrow segment (nutzbar < minBreite): ONE window of minBreite centred in
      // the segment — "narrowed, never below 0.60 m"; the room lands in
      // raeumeOhneRegelfenster. minLaenge 0.9 m (raumFassade) keeps it inside.
      if (nutzbar < R.minBreite) {
        if (R.minBreite > spanne) return;
        fenster.push({ abs, u: (abs.u0 + abs.u1) / 2, width: R.minBreite, nutzbar: R.minBreite, n: 1 });
        return;
      }
      const w = Math.min(R.breite, Math.max(R.minBreite, nutzbar / n));
      for (let k = 0; k < n; k += 1) fenster.push({ abs, u: abs.u0 + R.randAbstand + (nutzbar / n) * (k + 0.5), width: w, nutzbar, n });
    };
    if (cap === 2 && eck) {
      platziere(abschnitte[0], 1);
      platziere(abschnitte[1], 1);
    } else {
      // Two windows on one segment only when it is long enough for two axes.
      const n = cap === 2 ? Math.min(2, Math.max(1, Math.floor(abschnitte[0].laengeM / R.maxAchsAbstand))) : 1;
      platziere(abschnitte[0], n);
    }
    // Daylight 1/8: widen before adding — the user asked for ONE window.
    const flaeche = Number.isFinite(Number(zone?.flaeche_m2)) ? Number(zone.flaeche_m2) : polyFlaeche(zone?.points);
    const bedarf = flaeche * R.belichtungAnteil; // m² glass
    const glas = () => fenster.reduce((s, f) => s + f.width * R.hoehe, 0);
    let hinweis = null;
    if (fenster.length && glas() < bedarf - 1e-9) {
      const fehlt = bedarf - glas();
      const zuwachsJe = fehlt / R.hoehe / fenster.length;
      for (const f of fenster) f.width = Math.min(Math.max(f.width, f.width + zuwachsJe), Math.min(R.maxBreite, f.nutzbar / f.n));
      if (glas() < bedarf - 1e-9 && fenster.length < 2) {
        // Second window: on the longest segment if two fit, else on the next segment.
        const a0 = abschnitte[0];
        const nutzbar0 = a0.u1 - a0.u0 - 2 * R.randAbstand;
        if (nutzbar0 >= 2 * R.minBreite + 0.2) {
          fenster.length = 0;
          platziere(a0, 2);
          for (const f of fenster) f.width = Math.min(R.maxBreite, f.nutzbar / 2, Math.max(f.width, bedarf / R.hoehe / 2));
        } else if (abschnitte[1]) {
          platziere(abschnitte[1], 1);
        }
        hinweis = `Belichtung 1/8 (MBO §47): ${flaeche.toFixed(1).replace(".", ",")} m² brauchen ${bedarf.toFixed(2).replace(".", ",")} m² Fenster — zweites Fenster gesetzt`;
      }
      if (glas() < bedarf - 1e-9 && !hinweis) {
        hinweis = `Belichtung 1/8 (MBO §47): ${flaeche.toFixed(1).replace(".", ",")} m² brauchen ${bedarf.toFixed(2).replace(".", ",")} m² Fenster — Fassade ${abschnitte[0].laengeM.toFixed(2).replace(".", ",")} m reicht nicht`;
      }
    }
    for (const f of fenster) {
      const o = { u: f.u, width: f.width };
      if (belegt(f.abs.level, f.abs.edge, o)) continue; // user-placed wins (as today)
      out.push({
        level: f.abs.level, edge: f.abs.edge, kind: "window",
        u: f.u, width: f.width, height: R.hoehe, sill: R.sill, raum: name,
        ...(hinweis ? { hinweis } : {}),
      });
    }
  }
  // entranceOpening widens kind to string; the drop-in shape needs the
  // "window"|"door" union — cast at the push, not by loosening the array type.
  if (door) out.push(/** @type {typeof out[number]} */ (door));
  return out;
}

/** Shoelace area of a zone polygon in m² (inline — tesselierung.js keeps its own). */
function polyFlaeche(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += Number(p.x) * Number(q.z) - Number(q.x) * Number(p.z);
  }
  return Math.abs(a / 2);
}

/**
 * Windowed rooms that got NO window or only a narrowed one (below the rule
 * width). The UI shows them in the existing hint box; keeping this separate
 * keeps fensterJeRaum at the plain array return.
 * @param {Array<object>} zonen room zones (with fensterpflicht)
 * @param {Array<object>} walls envelope walls (metres)
 * @param {Array<object>} fenster result of fensterJeRaum
 * @returns {Array<{name:string, grund:string}>} one entry per affected room
 */
export function raeumeOhneRegelfenster(zonen, walls, fenster) {
  const liste = (Array.isArray(fenster) ? fenster : []).filter((f) => f?.kind === "window");
  const out = [];
  for (const zone of Array.isArray(zonen) ? zonen : []) {
    if (zone?.fensterpflicht !== true) continue;
    const name = String(zone?.name || "");
    const meine = liste.filter((f) => f.raum === name && Math.round(Number(f.level)) === Math.round(Number(zone.level) || 0));
    const abschnitte = fassadenAbschnitte(zone, walls);
    if (!abschnitte.length) {
      out.push({ name, grund: "kein Fassadenabschnitt — innenliegender Raum" });
      continue;
    }
    if (!meine.length) {
      out.push({ name, grund: "kein Fenster platziert (Abschnitt zu schmal oder belegt)" });
      continue;
    }
    // 75-13: daylight-driven second window / shortfall — the placement left a note.
    const mitHinweis = meine.find((f) => typeof f.hinweis === "string" && f.hinweis);
    if (mitHinweis) { out.push({ name, grund: mitHinweis.hinweis }); continue; }
    const schmal = meine.find((f) => Number(f.width) < FENSTER_JE_RAUM.breite - 1e-9);
    if (schmal) {
      const b = Number(schmal.width).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const abs = abschnitte[0];
      out.push({
        name,
        grund: `Fassadenabschnitt ${abs.laengeM.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m — Fenster auf ${b} m verschmälert`,
      });
    }
  }
  return out;
}
