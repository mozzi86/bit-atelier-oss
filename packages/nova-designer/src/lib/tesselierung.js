// Tesselierung (Phase 61, Wohnungs-Werkstatt) — deterministisches Regel-Grundriss-
// Konzept: Erschließungs-Skelett (6 Typologien) + 1D-Flex-Solver + WE-Band-Zonen
// + ±-Knautschzonen + Escher-v1-Varianten (gespiegelt, L-verschränkt, Verzahnungs-
// raum). Reine Funktionen, keine Date/Random, node-testbar (self-contained —
// einzige Ausnahme seit 75-13: die relativen Imports der import-freien Libs
// ./rettungsweg.js (Sichtgraph für die Lauflänge) und ./accessibility.js
// (Aufzugspflicht-Konstanten)) — Muster von apartments.js (Phase 21) und
// schallschutzPlan.js.
//
// KONZEPT-Charakter: Regel-Grundriss, kein geprüfter Bauantrag. Richtwerte teils
// [ASSUMED] (je Konstante kommentiert). Nicht-rechteckige Footprints werden in v1
// über ihre Bounding-Box angenähert (dokumentierte Vereinfachung, BBox-Näherung v1).
//
// Escher-Tiefe v1 (Entscheidung D-P61-05, Nutzerentscheidung): GESPIEGELTE/
// GEDREHTE Varianten, VERSCHRÄNKTE L-Paare und EIN Verzahnungsraum je Grenze
// (baubar, achsparallel, flächenneutral). Frei gezackte/künstlerische Konturen
// sind NICHT GEWÜNSCHT und werden nicht gebaut — Ziel ist lückenlose Füllung.
//
// Koordinatensystem: zentrierte Meter wie footprintM (Ursprung = Footprint-
// Mittelpunkt); Zonen passen 1:1 in useBuildingProgram().zones.

import { rettungsweg as lauflinie, punktInPolygon } from "./rettungsweg.js";
// 75-13: ONE source for the lift duty numbers (import-free module, as rettungsweg.js).
import { aufzugPflicht, AUFZUG_GESCHOSS_GRENZE, AUFZUG_OKF_GRENZE } from "./accessibility.js";

// Zahlen-Härtung (apartments.js-Muster): nie NaN/Infinity weiterreichen.
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// Härtende Division: nie durch <0.1 teilen.
const safeDiv = (a, b) => num(a) / Math.max(0.1, num(b));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Polygonfläche (Shoelace, inline — self-contained; Analogon polygonAreaM aus
// useBuildingProgram, hier ohne Import, damit die Lib node-testbar bleibt).
function polyArea(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += num(p.x) * num(q.z) - num(q.x) * num(p.z);
  }
  return Math.abs(a / 2);
}

// Marker-Suffix für Werkstatt-Zonen — strikt getrennt vom Schnellmodus-Marker
// GEN_MARKER " ·W" (apartments.js), damit „Entfernen" nie die falschen Zonen
// löscht (Marker-Kollisions-Pitfall, Analogon zu ME-03 in apartments.js).
export const WT_MARKER = " ·WT";

// Erkennt von der Wohnungs-Werkstatt generierte Zonen — NUR das strikte Suffix.
// Bewusst KEIN includes(): Namen wie „Trakt·WTest" sind keine Werkstatt-Zonen.
export function istWerkstattZone(zone) {
  const n = typeof zone?.name === "string" ? zone.name : "";
  return n.endsWith(WT_MARKER);
}

// Erschließungs-Typologien als Katalog (Plan 61-03: alle sechs).
// Richtmaße [ASSUMED A5] — etablierte Architektur-Richtwerte, kein Norm-Anspruch.
export const ERSCHLIESSUNG = {
  mittelflur: { label: "Mittelflur", flurbreite: 1.8 }, // [ASSUMED A5]
  // Laubengang: einseitig außen, Fluchtweg + Fensterreinigung. [ASSUMED A5]
  laubengang: { label: "Laubengang", flurbreite: 1.35 },
  // Spänner/Punkthaus: zentraler Kern ~2,5×5 m, 2–4 WE je Geschoss, kein
  // durchgehender Flur. [ASSUMED A5]
  spaenner: { label: "Punkthaus/Spänner", kern: { w: 2.5, d: 5 }, maxWe: 4 },
  // Reihenhaus: vertikale Hausscheiben über alle Geschosse, eigener Eingang je
  // Einheit, kein gemeinsamer Erschließungsraum. [ASSUMED A5]
  reihenhaus: { label: "Reihenhaus", weUeberGeschosse: true },
  // MFH = Mittelflur-Alias mit Kern-Zone (Treppenhaus) am Flur. [ASSUMED A5]
  mfh: { label: "Mehrfamilienhaus", flurbreite: 1.8, kern: { w: 2.5, d: 5 } },
  // EFH: eine Einheit = ganzer Footprint über alle Geschosse, kein Skelett.
  efh: { label: "Einfamilienhaus", weUeberGeschosse: true },
};

// --- Architekturregeln (Plan 75-07, Blatt 06) — additiv, jede Regel optional ----
//
// Default = heutiges Verhalten: ohne `regeln` in tesseliere/raumSlicing ändert
// sich kein Ergebnis (Phase 61 bleibt grün). Konflikte werden HINWEISE, keine
// stillen Verschiebungen. Alle Richtwerte [ASSUMED] (Bürowissen, kein Norm-
// Anspruch), als exportierte Konstanten überschreibbar.

/**
 * Optional rule switches for tesseliere/raumSlicing (75-07). All default to off.
 * @typedef {object} Regeln
 * @property {boolean} [mindestbreiten]      enforce MINDESTBREITEN, report shortfalls
 * @property {Record<string, number>} [mindestbreitenWerte] override table, m
 * @property {boolean} [himmelsrichtung]     orientation per unit + preference hints
 * @property {boolean} [phi]                 golden-ratio target + hints
 * @property {boolean} [wandstaerken]        emit `waende` (display only)
 * @property {Record<string, number>} [wandstaerkenWerte] override thicknesses, m
 * @property {boolean} [rettungsweg]         escape-route length per unit + hints
 * @property {number}  [rettungswegMax]      override RETTUNGSWEG_MAX, m
 * @property {boolean} [wohnungsgrundriss]   75-14: enable every WOHNUNGS_REGELN default
 * @property {boolean} [diele]               75-14: hall + corridor strip + doors per room
 * @property {number}  [raumMin_m2]          75-14: minimum area of an aufenthalt room, m² (0 = off)
 * @property {number}  [seitenverhaeltnisMax] 75-14: aspect-ratio warn threshold (0 = off)
 * @property {number}  [seitenverhaeltnisFail] 75-14: aspect-ratio fail threshold
 * @property {number}  [schrankwand_m]       75-14: free wardrobe wall per bedroom, m (0 = off)
 * @property {number}  [schlafenMinBreite_m] 75-14: minimum width bedroom/child room, m (0 = off)
 * @property {1|2}     [fensterMax]          75-13: window cap per room (read by autoOpenings.fensterJeRaum, default 1)
 * @property {Record<string, 1|2>} [fensterMaxJeRaum] 75-13: per-room cap, key "<typKey>|<raum>"
 * @property {Record<string, boolean>} [balkon] 75-13: balcony per room, key "<typKey>|<raum>" → balcony zone in front of the room's facade
 * @property {boolean} [treppenraum]         75-13: name the core "Treppenraum", lift switch + extension (MFH/Spänner)
 * @property {boolean} [aufzug]              75-13: lift shaft beside the stair (default: aufzugPflicht of storeys/OKF)
 * @property {number}  [treppenraumErweiterung_m] 75-13: stair-enclosure extension along the corridor, m PER SIDE (0–6)
 */

/**
 * Door record stored on a room zone (75-14). Edge `wand` runs points[wand] → points[wand+1];
 * `u_m` is measured from the edge start to the jamb; `aufschlag` "links" = hinge at u_m,
 * "rechts" = hinge at u_m + breite_m; the leaf always swings INTO the room; `nach` names
 * the zone the door opens from (hall/corridor), null = apartment entrance.
 * @typedef {object} Tuer
 * @property {number} wand
 * @property {number} u_m
 * @property {number} breite_m
 * @property {"links"|"rechts"} aufschlag
 * @property {string|null} nach
 * @property {"zimmer"|"bad"|"wohnung"|"treppenraum"|"T30-RS"} [typ] 75-13: "treppenraum" = stair door from the corridor, "T30-RS" = fire door at an extension end
 */

/** Goldener Schnitt — Wert inline (self-contained; @core/lib/proportion.js hat dieselbe Zahl). */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Mindestbreiten je Raumart in m [ASSUMED, Register Nr. 65 / Blatt 06]:
 * Wohnen 3,60 · Schlafen/Kind 2,80 (Namensregel auf art aufenthalt) · Küche 2,80 ·
 * Bad 2,20 · Abstell 2,30 · Flur 1,20.
 */
export const MINDESTBREITEN = { aufenthalt: 3.6, schlafen: 2.8, kueche: 2.8, sanitaer: 2.2, abstell: 2.3, flur: 1.2 };

/** Wandstärken NUR als Darstellung (D-P75-06): Außen 36,5 · tragend 24 · leicht 11,5 cm. */
export const WANDSTAERKEN = { aussen: 0.365, tragend: 0.24, leicht: 0.115 };

/**
 * Lauflänge vom tiefsten Punkt einer Nutzungseinheit bis zum notwendigen
 * Treppenraum: höchstens 35 m — CITED MBO §35 Abs. 2 (Muster; Länder weichen ab).
 * fire.js führt denselben Wert als DEFAULT_MAX_FLUCHTWEG (Stichmaß); hier inline,
 * damit die Lib import-frei bleibt.
 */
export const RETTUNGSWEG_MAX = 35;

// --- 75-13: necessary stair enclosure, lift, balcony (user brief 04.10.2026) ---
//
// "immer nur ein fenster pro raum maximal 2 .. balkon toggle auf außenliegenden
// räumen .. ein notwendiges treppenhaus mit toggle des aufzugs .. mehrfamilien-
// häuser größer als 3 geschosse brauchen einen aufzug .. das notwendige treppen-
// haus darf nicht weiter weg als 35 m vom tiefsten raum .. sonst den sicheren
// treppenraum vergrößern mit brandschutzwand und brandschutztür".

/**
 * Core dimensions in metres. treppe 2,5 × 5 [ASSUMED A5, as ERSCHLIESSUNG]; with
 * lift the core is 6 × 3 in total (HANDOFF §11 Auflage 11): stair 3,5 + shaft
 * 2,5 along the corridor [ASSUMED split — cabin 1,10 × 1,40 (DIN EN 81-70 Typ 2,
 * accessibility.js KABINE_*) plus shaft walls and door landing]. The extension
 * grows the enclosure along the corridor by up to 6 m PER SIDE [ASSUMED range].
 */
export const TREPPENRAUM = { treppe: { w: 2.5, d: 5 }, mitAufzug: { gesamt: 6, tiefe: 3, treppe: 3.5, aufzug: 2.5 }, erweiterungMax_m: 6, restTiefeMin_m: 2 };

/**
 * Lift duty thresholds — re-exported from accessibility.js (AUFZUG_GESCHOSS_GRENZE 3,
 * AUFZUG_OKF_GRENZE 13 m). "> 3 storeys" is the OFFICE rule (D-P75-13-A, stricter
 * than the code); the building codes say OKF > 13 m (MBO §39 Abs. 4 [CITED, not
 * re-checked]) resp. building height > 13 m (BayBO Art. 37 Abs. 4 with Art. 2
 * Abs. 3 Satz 2 — checked against gesetze-bayern.de on 06.10.2026, text valid
 * from 01.05.2026). The "more than five storeys" wording of the HANDOFF §12 is
 * outdated: it does not appear in the current BayBO.
 */
export const AUFZUG_SCHWELLEN = { geschosse: AUFZUG_GESCHOSS_GRENZE, okf_m: AUFZUG_OKF_GRENZE };

/**
 * Balcony rule in metres: depth 1,5 (D-P75-13-B), 0,5 clear to both room
 * partitions (never over a partition, 75-11 rule 12), minimum width 1,0
 * [ASSUMED]. Distance-area exemption BayBO Art. 6 Abs. 6 Satz 1 Nr. 2 [CITED,
 * checked against gesetze-bayern.de on 06.10.2026 — the HANDOFF's "Abs. 8" is the
 * old numbering, the current Art. 6 ends at Abs. 7]: balconies stay out of
 * consideration up to 1,5 m projection and ≤ 1/3 of the wall width (the statute
 * also asks ≥ 2 m to the opposite boundary — not checked here, no boundary in the lib).
 */
export const BALKON = { tiefe_m: 1.5, rand_m: 0.5, minBreite_m: 1.0, abstandsflaecheTiefeMax_m: 1.5, abstandsflaecheAnteilMax: 1 / 3, anrechnung: 0.25 };

/**
 * Resolve the 75-13 core rules. Without `regeln.treppenraum` everything is off and
 * the skeleton stays the Phase-61 "Kern" (byte-identical default).
 * @param {Regeln|null|undefined} rg
 * @param {number} nGeschosse storeys above ground
 * @param {number} okf_m finished-floor level of the top storey, m
 * @returns {{ aktiv: boolean, aufzug: boolean, aufzugPflicht: boolean, erweiterung_m: number }}
 */
export function kernRegeln(rg, nGeschosse, okf_m) {
  const r = rg && typeof rg === "object" ? rg : {};
  const aktiv = r.treppenraum === true;
  const pflicht = aufzugPflicht(nGeschosse, okf_m);
  const aufzug = aktiv && (r.aufzug === undefined ? pflicht : r.aufzug === true);
  const erweiterung_m = aktiv ? clamp(num(r.treppenraumErweiterung_m), 0, TREPPENRAUM.erweiterungMax_m) : 0;
  return { aktiv, aufzug, aufzugPflicht: pflicht, erweiterung_m };
}

// --- 75-14: livable apartment layout (hall, doors, no corridor rooms, minimums) ---
//
// User brief 04.10.2026: "… man sieht keine türen und man sieht keine diele .. die
// räume zuu lang wie ein schlauch .. aufenthaltsräume dürfen die 10 quadratmeter
// nicht unterschreiten .. eine seite muss mindestens einen 3 meter schrank
// beherbergen können .. der flur nicht zu allen zimmern führt". The slicing APPLIES
// what geometry allows (hall + corridor strip + doors + minimum widths + merging
// undersized rooms); what it cannot force (aspect ratio on a short facade) is
// reported by raumQualitaet.js with the quantitative cause.

/**
 * Raw door opening widths in metres — CITED DIN 18100 (Wandöffnungs-Richtmaße):
 * 0,885 m rooms, 0,985 m bath/WC and apartment entrance (plan 75-14 values; the
 * furniture catalogue's tuer_885/tuer_1010 follow D-P75-09-A and stay untouched).
 */
export const TUERBREITEN = { zimmer: 0.885, bad: 0.985, wohnung: 0.985 };

/** Distance jamb → adjacent wall in metres [ASSUMED 0,15 — plaster + frame]. */
export const TUER_ANSCHLAG_ABSTAND = 0.15;

/**
 * Hall behind the apartment door [ASSUMED 3–6 m², ≥ 1,20 m wide]: target 4 m²; the
 * apartment corridor strip uses MINDESTBREITEN.flur (1,20 m).
 */
export const DIELE_MASSE = { minBreite: 1.2, flaeche: 4, minFlaeche: 3, maxFlaeche: 6 };

/**
 * Office defaults of the 75-14 rules — all [ASSUMED] (no building-code value exists;
 * DIN 18011 is withdrawn): aufenthalt ≥ 10 m², aspect ratio warn ≥ 1 : 1,8 / fail
 * ≥ 1 : 2,5 (D-P75-14-B), wardrobe wall 3,00 m, bedroom/child room ≥ 2,40 m wide
 * (D-P75-14-A), hall on (diele).
 */
export const WOHNUNGS_REGELN = { raumMin_m2: 10, seitenverhaeltnisMax: 1.8, seitenverhaeltnisFail: 2.5, schrankwand_m: 3.0, schlafenMinBreite_m: 2.4, diele: true };

/**
 * Resolve the effective 75-14 values from a Regeln object. `wohnungsgrundriss: true`
 * (the one workshop switch) enables every default; explicit keys override single
 * values (0/false = off). Without any of them everything is off → byte-identical.
 * @param {Regeln|null|undefined} rg
 * @returns {{aktiv:boolean, diele:boolean, raumMin_m2:number, seitenverhaeltnisMax:number, seitenverhaeltnisFail:number, schrankwand_m:number, schlafenMinBreite_m:number}}
 */
export function wohnungsRegeln(rg) {
  const r = rg && typeof rg === "object" ? rg : {};
  const alle = r.wohnungsgrundriss === true;
  const wert = (k) => (r[k] !== undefined ? Math.max(0, num(r[k])) : alle ? WOHNUNGS_REGELN[k] : 0);
  const diele = r.diele !== undefined ? r.diele === true : alle;
  const out = {
    diele,
    raumMin_m2: wert("raumMin_m2"),
    seitenverhaeltnisMax: wert("seitenverhaeltnisMax"),
    seitenverhaeltnisFail: r.seitenverhaeltnisFail !== undefined ? Math.max(0, num(r.seitenverhaeltnisFail)) : (wert("seitenverhaeltnisMax") > 0 ? WOHNUNGS_REGELN.seitenverhaeltnisFail : 0),
    schrankwand_m: wert("schrankwand_m"),
    schlafenMinBreite_m: wert("schlafenMinBreite_m"),
    aktiv: false,
  };
  out.aktiv = out.diele || out.raumMin_m2 > 0 || out.seitenverhaeltnisMax > 0 || out.schrankwand_m > 0 || out.schlafenMinBreite_m > 0;
  return out;
}

/** Raum-Präferenz je Himmelsrichtung [ASSUMED]: Wohnen Süd/West, Schlafen Ost/Nord. */
export const RAUM_PRAEFERENZ = {
  wohnen: { muster: /wohn|ess|aufenthalt/i, gut: ["S", "SO", "SW", "W"], schlecht: ["N", "NO", "NW"] },
  schlafen: { muster: /schlaf|kind|zimmer/i, gut: ["O", "NO", "N", "SO"], schlecht: ["S", "SW", "W"] },
};

/**
 * Erschließungs-Empfehlung aus der Gebäudetiefe [ASSUMED, Blatt 06]:
 * ≤ 13 m Zwei-/Punkthaus (spaenner, reihenhaus) · 13–17 m Mittelflur/MFH ·
 * > 17 m Mittelflur oder Laubengang nur mit Lichthof/Atrium.
 * @param {number} tiefeM kürzere Seite der Footprint-BBox, m
 * @returns {{ stufe: "flach"|"mittel"|"tief", typen: string[], text: string, lichthof: boolean }}
 */
export function empfehleErschliessung(tiefeM) {
  const t = num(tiefeM);
  if (t <= 13) {
    return { stufe: "flach", typen: ["spaenner", "reihenhaus"], lichthof: false,
      text: `Tiefe ${t.toFixed(1).replace(".", ",")} m ≤ 13 m — Zwei-/Punkthaus oder Reihenhaus (durchgesteckte Wohnungen)` };
  }
  if (t <= 17) {
    return { stufe: "mittel", typen: ["mittelflur", "mfh"], lichthof: false,
      text: `Tiefe ${t.toFixed(1).replace(".", ",")} m — Drei-/Mittelflur (Bandtiefe ≈ ${((t - 1.8) / 2).toFixed(1).replace(".", ",")} m je Seite)` };
  }
  return { stufe: "tief", typen: ["mittelflur", "laubengang"], lichthof: true,
    text: `Tiefe ${t.toFixed(1).replace(".", ",")} m > 17 m — Mittelflur oder Laubengang nur mit Lichthof/Atrium; Bandtiefe ${((t - 1.8) / 2).toFixed(1).replace(".", ",")} m macht Räume schlauchig` };
}

const ORIENT_SEKTOREN = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
/**
 * Himmelsrichtung der Fassade eines Bands (Formel wie raumklima.azimutFromNormal:
 * Plan-„oben" (−z) ist Norden, nordwinkel dreht im Uhrzeigersinn).
 * @param {BandMeta} band
 * @param {number} [nordwinkel]
 * @returns {{ azimut: number, label: string }}
 */
export function orientierungFuerBand(band, nordwinkel = 0) {
  const b = band || {};
  let nx = 0, nz = 0;
  if (b.achse === "z") nx = Math.abs(num(b.zKante) - num(b.x0)) < 1e-9 ? -1 : 1;
  else nz = Math.abs(num(b.zKante) - num(b.z0)) < 1e-9 ? -1 : 1;
  const planWinkel = (Math.atan2(nx, -nz) * 180) / Math.PI;
  const azimut = ((planWinkel + num(nordwinkel)) % 360 + 360) % 360;
  return { azimut, label: ORIENT_SEKTOREN[Math.round(azimut / 45) % 8] };
}

/**
 * Wandsegmente NUR zur Darstellung (D-P75-06): Zonenkanten werden klassifiziert —
 * auf der Footprint-BBox = aussen, zwischen verschiedenen WEs oder WE↔Flur/Kern =
 * tragend, innerhalb einer WE = leicht. Zonen bleiben lichte Maße.
 * @param {Array<object>} zonen
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bb
 * @param {Record<string, number>} [staerken] thicknesses per class, m (default WANDSTAERKEN)
 * @returns {Array<{ a:{x:number,z:number}, b:{x:number,z:number}, level:number, klasse:"aussen"|"tragend"|"leicht", staerke:number }>}
 */
export function waendeAus(zonen, bb, staerken = WANDSTAERKEN) {
  const r = (v) => Math.round(num(v) * 100) / 100;
  const key = (p, q) => {
    const a = `${r(p.x)},${r(p.z)}`, b = `${r(q.x)},${r(q.z)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const amRand = (p, q) => {
    const seiten = [
      Math.abs(r(p.x) - r(bb.minX)) < 0.011 && Math.abs(r(q.x) - r(bb.minX)) < 0.011,
      Math.abs(r(p.x) - r(bb.maxX)) < 0.011 && Math.abs(r(q.x) - r(bb.maxX)) < 0.011,
      Math.abs(r(p.z) - r(bb.minZ)) < 0.011 && Math.abs(r(q.z) - r(bb.minZ)) < 0.011,
      Math.abs(r(p.z) - r(bb.maxZ)) < 0.011 && Math.abs(r(q.z) - r(bb.maxZ)) < 0.011,
    ];
    return seiten.some(Boolean);
  };
  const kanten = new Map(); // level|key → { a, b, level, wes: Set }
  for (const z of Array.isArray(zonen) ? zonen : []) {
    const pts = Array.isArray(z?.points) ? z.points : [];
    if (pts.length < 3) continue;
    const lvl = Math.round(num(z.level));
    const weId = z.we === undefined || z.we === null ? "__flur__" : String(z.we);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (r(p.x) === r(q.x) && r(p.z) === r(q.z)) continue;
      const k = `${lvl}|${key(p, q)}`;
      const e = kanten.get(k) || { a: { x: r(p.x), z: r(p.z) }, b: { x: r(q.x), z: r(q.z) }, level: lvl, wes: new Set() };
      e.wes.add(weId);
      kanten.set(k, e);
    }
  }
  const out = [];
  for (const e of kanten.values()) {
    let klasse = /** @type {"aussen"|"tragend"|"leicht"} */ ("leicht");
    if (amRand(e.a, e.b)) klasse = "aussen";
    else if (e.wes.size > 1) klasse = "tragend";
    out.push({ a: e.a, b: e.b, level: e.level, klasse, staerke: num(staerken?.[klasse], WANDSTAERKEN[klasse]) });
  }
  return out;
}

// Bounding-Box eines footprintM-Polygons [{x,z}] — Geometrie bewusst inline
// (self-contained, wie apartments.js). Fallback: Default-Footprint 20×14 m
// zentriert (wie Store-Default).
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

// 1D-Flex-Solver (TESS-03-Kern): verteilt `verfuegbar` (Band-/Fassadenlänge, m)
// auf Kandidaten [{ id, ziel, min, max }] nach dem CSS-Flexbox-Prinzip: je Runde
// wird der Rest GLEICHMÄSSIG auf die noch flexiblen Kandidaten verteilt, bei
// min/max geklemmt; eingefrorene Kandidaten scheiden aus, der verbleibende Rest
// wird in der nächsten Runde auf die übrigen umverteilt. Hartes Iterationslimit
// (8 Runden, for statt while — Endlosschleifen-Schutz, T-61-01).
//
// Eintritts-Normalisierung: min ≤ ziel ≤ max (clampen, nicht werfen); alle
// Eingaben num()-gehärtet (ziel: "abc" → 0 → auf min geklemmt, bricht nie).
//
// Rückgabe { items: [{ id, breite, fixiert }], rest } — rest ist der SIGNIERTE
// Längenrest: > 0 = ungenutzter Rest (alle an max), < 0 = Überbelegung
// (Σ min > verfuegbar). Breiten sind nie < min, nie negativ; Überbelegung
// terminiert mit rest statt überlappender Geometrie zu erzeugen (Pitfall 3).
export function verteileBand(verfuegbar, kandidaten) {
  const ks = (Array.isArray(kandidaten) ? kandidaten : []).map((k) => {
    const min = Math.max(0, num(k?.min));
    const max = Math.max(min, num(k?.max, min));
    const ziel = Math.min(max, Math.max(min, num(k?.ziel, min)));
    return { id: k?.id, ziel, min, max, breite: ziel, fixiert: false };
  });
  let rest = Math.max(0, num(verfuegbar)) - ks.reduce((s, k) => s + k.ziel, 0);
  for (let runde = 0; runde < 8 && Math.abs(rest) > 1e-6; runde++) {
    const flex = ks.filter((k) => !k.fixiert);
    if (!flex.length) break;
    const anteil = rest / flex.length;
    let verbraucht = 0;
    for (const k of flex) {
      const neu = Math.max(k.min, Math.min(k.max, k.breite + anteil));
      verbraucht += neu - k.breite;
      k.breite = neu;
      if (neu <= k.min + 1e-9 || neu >= k.max - 1e-9) k.fixiert = true;
    }
    rest -= verbraucht;
  }
  return { items: ks.map(({ id, breite, fixiert }) => ({ id, breite, fixiert })), rest };
}

// --- Skelett-Generatoren je Typologie (Plan 61-03, alle [ASSUMED A5]) --------
// Einheitliche Rückgabe: { flure, kerne, baender, weUeberGeschosse }.
/**
 * Ein Erschliessungsband: der Streifen, in dem die Wohnungen einer Seite eines
 * Geschosses nebeneinander aufgereiht werden.
 *
 * @typedef {object} BandMeta
 * @property {number} [level]  storey index, 0 = ground floor
 * @property {string} [seite]  side key ("sued", "nord", "west", "ost", ...)
 * @property {"x"|"z"} [achse] running axis of the band
 * @property {number} [x0] band extent, metres
 * @property {number} [x1] band extent, metres
 * @property {number} [z0] band extent, metres
 * @property {number} [z1] band extent, metres
 * @property {number} [tiefe]  depth across the running axis, metres
 * @property {number} [zKante] facade edge on the cross axis, metres
 * @property {number} [laenge] length along the running axis, metres
 * @property {string} [erschliessungsseite] edge the corridor sits on
 * @property {boolean} [zweiFassaden] both cross edges are facades (Spänner quadrants, 75-07)
 */

// Band-Shape: { level, seite, achse, x0, x1, z0, z1, tiefe, zKante, laenge,
// erschliessungsseite } — zKante = Fassadenkante, erschliessungsseite = Kante,
// an der der WE-Eingang liegt (für den Wohnungseingang-Check in 61-02/04/05).

/** @returns {BandMeta} */
function bandRechteck(level, seite, achse, x0, x1, z0, z1, zKante, erschliessungsseite) {
  const tiefe = achse === "x" ? z1 - z0 : x1 - x0;
  const laenge = achse === "x" ? x1 - x0 : z1 - z0;
  return { level, seite, achse, x0, x1, z0, z1, tiefe, zKante, laenge, erschliessungsseite };
}

function skelettMittelflur(bb, n, cfg, { mitKern = false } = {}) {
  const entlangX = bb.w >= bb.d;
  const quer = entlangX ? bb.d : bb.w;
  const flurB = Math.max(0, Math.min(num(cfg.flurbreite, 1.8), quer - 0.5));
  const mitteX = (bb.minX + bb.maxX) / 2;
  const mitteZ = (bb.minZ + bb.maxZ) / 2;
  const tiefe = Math.max(0, (quer - flurB) / 2);
  const flure = [];
  const kerne = [];
  const baender = [];
  const kernW = num(cfg.kern?.w, 0);
  const kernD = num(cfg.kern?.d, 0);
  for (let level = 0; level < n; level++) {
    const zSued = mitteZ - flurB / 2, zNord = mitteZ + flurB / 2;
    const xWest = mitteX - flurB / 2, xOst = mitteX + flurB / 2;
    if (entlangX) {
      if (mitKern && kernW > 0) {
        // MFH: Kern (Treppenhaus) als mittleres Flur-Segment; Flur links/rechts.
        const kw = Math.min(kernW, (bb.maxX - bb.minX) / 3);
        kerne.push({
          points: [
            { x: mitteX - kw / 2, z: zSued }, { x: mitteX + kw / 2, z: zSued },
            { x: mitteX + kw / 2, z: zNord }, { x: mitteX - kw / 2, z: zNord },
          ],
          level, name: `Kern ${level} ·WT`, we: undefined, raumart: "flur",
        });
        if (mitteX - kw / 2 > bb.minX) flure.push({
          points: [
            { x: bb.minX, z: zSued }, { x: mitteX - kw / 2, z: zSued },
            { x: mitteX - kw / 2, z: zNord }, { x: bb.minX, z: zNord },
          ],
          level, name: `Flur ${level} W ·WT`, we: undefined, raumart: "flur",
        });
        if (bb.maxX > mitteX + kw / 2) flure.push({
          points: [
            { x: mitteX + kw / 2, z: zSued }, { x: bb.maxX, z: zSued },
            { x: bb.maxX, z: zNord }, { x: mitteX + kw / 2, z: zNord },
          ],
          level, name: `Flur ${level} O ·WT`, we: undefined, raumart: "flur",
        });
      } else {
        flure.push({
          points: [
            { x: bb.minX, z: zSued }, { x: bb.maxX, z: zSued },
            { x: bb.maxX, z: zNord }, { x: bb.minX, z: zNord },
          ],
          level, name: `Flur ${level} ·WT`, we: undefined, raumart: "flur",
        });
      }
      if (tiefe > 0.05) {
        baender.push(bandRechteck(level, "sued", "x", bb.minX, bb.maxX, bb.minZ, zSued, bb.minZ, "nord"));
        baender.push(bandRechteck(level, "nord", "x", bb.minX, bb.maxX, zNord, bb.maxZ, bb.maxZ, "sued"));
      }
    } else {
      if (mitKern && kernD > 0) {
        const kd = Math.min(kernD, (bb.maxZ - bb.minZ) / 3);
        kerne.push({
          points: [
            { x: xWest, z: mitteZ - kd / 2 }, { x: xOst, z: mitteZ - kd / 2 },
            { x: xOst, z: mitteZ + kd / 2 }, { x: xWest, z: mitteZ + kd / 2 },
          ],
          level, name: `Kern ${level} ·WT`, we: undefined, raumart: "flur",
        });
        if (mitteZ - kd / 2 > bb.minZ) flure.push({
          points: [
            { x: xWest, z: bb.minZ }, { x: xOst, z: bb.minZ },
            { x: xOst, z: mitteZ - kd / 2 }, { x: xWest, z: mitteZ - kd / 2 },
          ],
          level, name: `Flur ${level} S ·WT`, we: undefined, raumart: "flur",
        });
        if (bb.maxZ > mitteZ + kd / 2) flure.push({
          points: [
            { x: xWest, z: mitteZ + kd / 2 }, { x: xOst, z: mitteZ + kd / 2 },
            { x: xOst, z: bb.maxZ }, { x: xWest, z: bb.maxZ },
          ],
          level, name: `Flur ${level} N ·WT`, we: undefined, raumart: "flur",
        });
      } else {
        flure.push({
          points: [
            { x: xWest, z: bb.minZ }, { x: xOst, z: bb.minZ },
            { x: xOst, z: bb.maxZ }, { x: xWest, z: bb.maxZ },
          ],
          level, name: `Flur ${level} ·WT`, we: undefined, raumart: "flur",
        });
      }
      if (tiefe > 0.05) {
        baender.push(bandRechteck(level, "west", "z", bb.minX, xWest, bb.minZ, bb.maxZ, bb.minX, "ost"));
        baender.push(bandRechteck(level, "ost", "z", xOst, bb.maxX, bb.minZ, bb.maxZ, bb.maxX, "west"));
      }
    }
  }
  return { flure, kerne, baender, weUeberGeschosse: false };
}

// --- 75-13: MFH with a NECESSARY stair enclosure (regeln.treppenraum) -----------
//
// Lauf system: a = along the corridor, b = across. The core hangs on the min-b
// side of the corridor ("sued"/"west" [ASSUMED — the bbox has no inner corner;
// the long side is the longest facade]) and splits that band into two bands left
// and right of it; the corridor runs through. Stair door = middle of the core's
// corridor edge. With a lift the shaft sits beside the stair (6 × 3 total). The
// extension takes E m of corridor on EACH side into the enclosure: the corridor
// becomes W/O pieces, the enclosure gets a fire door (T30-RS) at both ends and
// the escape-route measurement ends there (MBO §35 Abs. 4–6 — walls fire-
// resistant, no use inside the enclosure; the hint says so).
function skelettMfhTreppenraum(bb, n, cfg, kern) {
  const entlangX = bb.w >= bb.d;
  const quer = entlangX ? bb.d : bb.w;
  const laengs = entlangX ? bb.w : bb.d;
  const flurB = Math.max(0, Math.min(num(cfg.flurbreite, 1.8), quer - 0.5));
  const a0 = entlangX ? bb.minX : bb.minZ, a1 = entlangX ? bb.maxX : bb.maxZ;
  const b0 = entlangX ? bb.minZ : bb.minX, b1 = entlangX ? bb.maxZ : bb.maxX;
  const mitteA = (a0 + a1) / 2, mitteB = (b0 + b1) / 2;
  const bS = mitteB - flurB / 2, bN = mitteB + flurB / 2;
  const tiefe = Math.max(0, (quer - flurB) / 2);
  const pt = (a, b) => (entlangX ? { x: a, z: b } : { x: b, z: a });
  const rect = (ra0, ra1, rb0, rb1) => [pt(ra0, rb0), pt(ra1, rb0), pt(ra1, rb1), pt(ra0, rb1)];
  const mitAufzug = !!kern.aufzug;
  const kLaenge = Math.min(mitAufzug ? TREPPENRAUM.mitAufzug.gesamt : TREPPENRAUM.treppe.w, laengs / 3);
  // Core depth into the band, leaving TREPPENRAUM.restTiefeMin_m of band behind it.
  const kTiefe = Math.max(0.5, Math.min(mitAufzug ? TREPPENRAUM.mitAufzug.tiefe : TREPPENRAUM.treppe.d, tiefe - TREPPENRAUM.restTiefeMin_m));
  const trLaenge = mitAufzug ? kLaenge * (TREPPENRAUM.mitAufzug.treppe / TREPPENRAUM.mitAufzug.gesamt) : kLaenge;
  const kA0 = mitteA - kLaenge / 2, kA1 = mitteA + kLaenge / 2, trA1 = kA0 + trLaenge;
  const kB0 = bS - kTiefe;
  const E = clamp(num(kern.erweiterung_m), 0, TREPPENRAUM.erweiterungMax_m);
  const eA0 = Math.max(a0, kA0 - E), eA1 = Math.min(a1, kA1 + E);
  const dedupe = (pts) => pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.z - q.z) > 1e-9; });
  const tuerB = TUERBREITEN.wohnung;
  const flure = [], kerne = [], baender = [], ziele = [];
  const seiteS = entlangX ? "sued" : "west", seiteN = entlangX ? "nord" : "ost";
  const band = (seite, ra0, ra1, rb0, rb1, zK, ers) => (entlangX
    ? bandRechteck(0, seite, "x", ra0, ra1, rb0, rb1, zK, ers)
    : bandRechteck(0, seite, "z", rb0, rb1, ra0, ra1, zK, ers));
  for (let level = 0; level < n; level++) {
    /** @type {any} */
    let treppenraum;
    if (E > 1e-9) {
      treppenraum = {
        points: dedupe([pt(eA0, bN), pt(eA0, bS), pt(kA0, bS), pt(kA0, kB0), pt(trA1, kB0), pt(trA1, bS), pt(eA1, bS), pt(eA1, bN)]),
        level, name: `Treppenraum ${level} ·WT`, we: undefined, raumart: "treppenraum",
        // Fire doors at both extension ends (edge 0 = west end, last edge = east end).
        tueren: /** @type {Tuer[]} */ ([]), brandwaende: /** @type {number[]} */ ([]),
      };
      const nPts = treppenraum.points.length;
      const kanteW = 0, kanteO = nPts - 2; // pt(eA1,bS)→pt(eA1,bN)
      const uM = Math.max(0, (flurB - tuerB) / 2);
      treppenraum.tueren.push({ wand: kanteW, u_m: uM, breite_m: tuerB, aufschlag: "links", nach: null, typ: "T30-RS" });
      treppenraum.tueren.push({ wand: kanteO, u_m: uM, breite_m: tuerB, aufschlag: "links", nach: null, typ: "T30-RS" });
      treppenraum.brandwaende.push(kanteW, kanteO);
      // Escape-route targets: just outside the two fire doors, in the corridor.
      ziele.push({ level, ...pt(eA0 - 0.05, mitteB) }, { level, ...pt(eA1 + 0.05, mitteB) });
      if (eA0 > a0 + 1e-9) flure.push({ points: rect(a0, eA0, bS, bN), level, name: `Flur ${level} ${entlangX ? "W" : "S"} ·WT`, we: undefined, raumart: "flur" });
      if (a1 > eA1 + 1e-9) flure.push({ points: rect(eA1, a1, bS, bN), level, name: `Flur ${level} ${entlangX ? "O" : "N"} ·WT`, we: undefined, raumart: "flur" });
    } else {
      treppenraum = {
        points: rect(kA0, trA1, kB0, bS), level, name: `Treppenraum ${level} ·WT`, we: undefined, raumart: "treppenraum",
        // Stair door from the corridor, centred in the corridor edge (edge 2: pt(trA1,bS)→pt(kA0,bS)).
        tueren: /** @type {Tuer[]} */ ([{ wand: 2, u_m: Math.max(0, (trLaenge - tuerB) / 2), breite_m: tuerB, aufschlag: "links", nach: null, typ: "treppenraum" }]),
      };
      ziele.push({ level, ...pt((kA0 + trA1) / 2, bS + 0.05) });
      flure.push({ points: rect(a0, a1, bS, bN), level, name: `Flur ${level} ·WT`, we: undefined, raumart: "flur" });
    }
    kerne.push(treppenraum);
    if (mitAufzug) kerne.push({ points: rect(trA1, kA1, kB0, bS), level, name: `Aufzug ${level} ·WT`, we: undefined, raumart: "aufzug" });
    if (tiefe > 0.05) {
      if (kA0 > a0 + 0.05) baender.push({ ...band(seiteS, a0, kA0, b0, bS, b0, seiteN), level });
      if (a1 > kA1 + 0.05) baender.push({ ...band(seiteS, kA1, a1, b0, bS, b0, seiteN), level });
      baender.push({ ...band(seiteN, a0, a1, bN, b1, b1, seiteS), level });
    }
  }
  return { flure, kerne, baender, weUeberGeschosse: false, ziele };
}

function skelettLaubengang(bb, n, cfg) {
  // Einseitig außen: Gang an der MIN-Kante der längeren Achse, dahinter EIN
  // Band pro Geschoss (Fassade gegenüber). [ASSUMED A5]
  const entlangX = bb.w >= bb.d;
  const quer = entlangX ? bb.d : bb.w;
  const gangB = Math.max(0, Math.min(num(cfg.flurbreite, 1.35), quer - 0.5));
  const flure = [];
  const baender = [];
  for (let level = 0; level < n; level++) {
    if (entlangX) {
      flure.push({
        points: [
          { x: bb.minX, z: bb.minZ }, { x: bb.maxX, z: bb.minZ },
          { x: bb.maxX, z: bb.minZ + gangB }, { x: bb.minX, z: bb.minZ + gangB },
        ],
        level, name: `Laubengang ${level} ·WT`, we: undefined, raumart: "flur",
      });
      if (quer - gangB > 0.05) {
        baender.push(bandRechteck(level, "nord", "x", bb.minX, bb.maxX, bb.minZ + gangB, bb.maxZ, bb.maxZ, "sued"));
      }
    } else {
      flure.push({
        points: [
          { x: bb.minX, z: bb.minZ }, { x: bb.minX + gangB, z: bb.minZ },
          { x: bb.minX + gangB, z: bb.maxZ }, { x: bb.minX, z: bb.maxZ },
        ],
        level, name: `Laubengang ${level} ·WT`, we: undefined, raumart: "flur",
      });
      if (quer - gangB > 0.05) {
        baender.push(bandRechteck(level, "ost", "z", bb.minX + gangB, bb.maxX, bb.minZ, bb.maxZ, bb.maxX, "west"));
      }
    }
  }
  return { flure, kerne: [], baender, weUeberGeschosse: false };
}

function skelettSpaenner(bb, n, cfg, kern = null) {
  // Zentraler Kern, vier Quadranten-Bänder füllen die BBox lückenlos (Kern
  // ausgespart). 2–4 WE je Geschoss ohne durchgehenden Flur. [ASSUMED A5]
  // 75-13 (regeln.treppenraum): the core is the necessary stair enclosure; with a
  // lift it measures 6 × 3 along the longer bbox axis, shaft beside the stair.
  const mitTreppenraum = !!kern?.aktiv;
  const mitAufzug = mitTreppenraum && !!kern.aufzug;
  const entlangX = bb.w >= bb.d;
  let kw = num(cfg.kern?.w, 2.5), kd = num(cfg.kern?.d, 5);
  if (mitAufzug) {
    kw = entlangX ? TREPPENRAUM.mitAufzug.gesamt : TREPPENRAUM.mitAufzug.tiefe;
    kd = entlangX ? TREPPENRAUM.mitAufzug.tiefe : TREPPENRAUM.mitAufzug.gesamt;
  }
  const cw = Math.max(0.5, Math.min(kw, bb.w - 1));
  const cd = Math.max(0.5, Math.min(kd, bb.d - 1));
  const mitteX = (bb.minX + bb.maxX) / 2;
  const mitteZ = (bb.minZ + bb.maxZ) / 2;
  const flure = [];
  const kerne = [];
  const baender = [];
  const ziele = [];
  for (let level = 0; level < n; level++) {
    const x0 = mitteX - cw / 2, x1 = mitteX + cw / 2, z0 = mitteZ - cd / 2, z1 = mitteZ + cd / 2;
    if (mitTreppenraum) {
      // Stair part first along the long axis, shaft behind it.
      const anteil = mitAufzug ? TREPPENRAUM.mitAufzug.treppe / TREPPENRAUM.mitAufzug.gesamt : 1;
      const tx1 = entlangX ? x0 + (x1 - x0) * anteil : x1;
      const tz1 = entlangX ? z1 : z0 + (z1 - z0) * anteil;
      kerne.push({
        points: [{ x: x0, z: z0 }, { x: tx1, z: z0 }, { x: tx1, z: tz1 }, { x: x0, z: tz1 }],
        level, name: `Treppenraum ${level} ·WT`, we: undefined, raumart: "treppenraum",
      });
      if (mitAufzug) {
        kerne.push({
          points: entlangX
            ? [{ x: tx1, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: tx1, z: z1 }]
            : [{ x: x0, z: tz1 }, { x: x1, z: tz1 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
          level, name: `Aufzug ${level} ·WT`, we: undefined, raumart: "aufzug",
        });
      }
      // Stair doors: every landing side of the STAIR part (midpoints just outside).
      // The side that touches the lift shaft is no door — a target there would sit
      // inside the shaft obstacle.
      ziele.push({ level, x: (x0 + tx1) / 2, z: z0 - 0.05 }, { level, x: x0 - 0.05, z: (z0 + tz1) / 2 });
      if (!mitAufzug || entlangX) ziele.push({ level, x: (x0 + tx1) / 2, z: tz1 + 0.05 });
      if (!mitAufzug || !entlangX) ziele.push({ level, x: tx1 + 0.05, z: (z0 + tz1) / 2 });
    } else {
      kerne.push({
        points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
        level, name: `Kern ${level} ·WT`, we: undefined, raumart: "flur",
      });
      ziele.push(
        { level, x: mitteX, z: z0 - 0.05 }, { level, x: mitteX, z: z1 + 0.05 },
        { level, x: x0 - 0.05, z: mitteZ }, { level, x: x1 + 0.05, z: mitteZ },
      );
    }
    // Vier Quadranten um den Kern — jede WE grenzt an mindestens eine Fassade.
    // West/Ost spannen über die ganze Footprint-Tiefe: BEIDE Querkanten sind
    // Fassaden (75-07 / MSB-6) — raumSlicing legt innenliegende Räume dann in
    // den Mittelstreifen statt an die Gegenfassade.
    baender.push({ ...bandRechteck(level, "west", "x", bb.minX, mitteX - cw / 2, bb.minZ, bb.maxZ, bb.minZ, "ost"), zweiFassaden: true });
    baender.push({ ...bandRechteck(level, "ost", "x", mitteX + cw / 2, bb.maxX, bb.minZ, bb.maxZ, bb.minZ, "west"), zweiFassaden: true });
    baender.push(bandRechteck(level, "suedmitte", "x", mitteX - cw / 2, mitteX + cw / 2, bb.minZ, mitteZ - cd / 2, bb.minZ, "nord"));
    baender.push(bandRechteck(level, "nordmitte", "x", mitteX - cw / 2, mitteX + cw / 2, mitteZ + cd / 2, bb.maxZ, bb.maxZ, "sued"));
  }
  return { flure, kerne, baender, weUeberGeschosse: false, ziele };
}

function skelettReihenhaus(bb, n) {
  // Vertikale Hausscheiben über alle Geschosse, eigener Eingang je Einheit —
  // kein gemeinsamer Erschließungsraum (kein Kern, kein Flur). [ASSUMED A5]
  const baender = [];
  for (let level = 0; level < n; level++) {
    baender.push(bandRechteck(level, "gesamte", "x", bb.minX, bb.maxX, bb.minZ, bb.maxZ, bb.minZ, "sued"));
  }
  return { flure: [], kerne: [], baender, weUeberGeschosse: true };
}

// Erschließungs-Skelett je Typologie. Rückgabe { flure, kerne, baender,
// weUeberGeschosse } — Flur-/Kern-Zonen tragen raumart "flur" und KEIN we.
// BBox-Näherung v1 (nicht-rechteckige Footprints werden angenähert).
// 75-13: `kern` = kernRegeln(...) result; with kern.aktiv MFH/Spänner build the
// necessary stair enclosure (+ lift, + extension) and return `ziele` (stair-door
// points per level for the escape route). Without it (default) the result is
// byte-identical to Phase 61 except for the additional `ziele` field (door
// points of the old core / corridor ends), which tesseliere never emits.
export function erschliessungsSkelett(opts) {
  const { footprintM = null, storeys = 1, typ = "mittelflur", kern = null } = opts || {};
  const bb = footprintBBox(footprintM);
  const n = Math.max(1, Math.round(num(storeys, 1)));
  const cfg = ERSCHLIESSUNG[typ] || ERSCHLIESSUNG.mittelflur;
  switch (typ) {
    case "laubengang": return skelettLaubengang(bb, n, cfg);
    case "spaenner": return skelettSpaenner(bb, n, cfg, kern);
    case "reihenhaus": return skelettReihenhaus(bb, n);
    case "mfh": return kern?.aktiv ? skelettMfhTreppenraum(bb, n, cfg, kern) : skelettMittelflur(bb, n, cfg, { mitKern: true });
    case "efh": return { flure: [], kerne: [], baender: [], weUeberGeschosse: true };
    default: return skelettMittelflur(bb, n, cfg);
  }
}

/**
 * Escape-route targets of a skeleton WITHOUT explicit `ziele` (Phase-61 MFH core,
 * Mittelflur/Laubengang corridor): for every core the midpoints of its two
 * corridor-facing ends, else the midpoints of the two short edges of every
 * corridor zone (= "stair at the nearest corridor end" [ASSUMED, as 75-07]) — each
 * pushed 5 cm into the free corridor so the graph node is never inside a wall.
 * @param {{ flure: Array<object>, kerne: Array<object> }} skelett
 * @returns {Array<{level:number, x:number, z:number}>}
 */
export function skelettZiele(skelett) {
  const out = [];
  const kurzeKanten = (pts, nachInnen) => {
    if (!Array.isArray(pts) || pts.length !== 4) return [];
    const cx = pts.reduce((s, p) => s + num(p.x), 0) / 4, cz = pts.reduce((s, p) => s + num(p.z), 0) / 4;
    const kanten = pts.map((p, i) => {
      const q = pts[(i + 1) % 4];
      return { l: Math.hypot(num(q.x) - num(p.x), num(q.z) - num(p.z)), mx: (num(p.x) + num(q.x)) / 2, mz: (num(p.z) + num(q.z)) / 2 };
    }).sort((a, b) => a.l - b.l).slice(0, 2);
    return kanten.map((k) => {
      const dx = cx - k.mx, dz = cz - k.mz, l = Math.hypot(dx, dz) || 1;
      const s = (nachInnen ? 1 : -1) * 0.05;
      return { x: k.mx + (dx / l) * s, z: k.mz + (dz / l) * s };
    });
  };
  const kerne = Array.isArray(skelett?.kerne) ? skelett.kerne : [];
  const flure = Array.isArray(skelett?.flure) ? skelett.flure : [];
  if (kerne.length) {
    for (const k of kerne) for (const z of kurzeKanten(k.points, false)) out.push({ level: Math.round(num(k.level)), ...z });
  } else {
    for (const f of flure) for (const z of kurzeKanten(f.points, true)) out.push({ level: Math.round(num(f.level)), ...z });
  }
  return out;
}

// --- Escher-v1: L-Verschränkung ------------------------------------------------
//
// Zwei Nachbar-WEs teilen ihr Bandsegment als komplementäre L-Paare (je 6
// Punkte), die zusammen EXAKT das Rechteck [x0,x1]×tiefe füllen. A bekommt
// vorn [x0..xSplit]×tiefeVorn und hinten einen Streifen bis xBack; B das
// Komplement. Flächeninvariante: mit `flaecheA` wird xBack exakt aus der
// Solver-Fläche abgeleitet (Toleranz 0,01 m²); ohne flaecheA gilt die
// Spiegel-Regel xBack = x0 + (x1 − xSplit) (bei tiefeVorn = tiefe/2 exakt
// flächengleich — dokumentierter Default für die Referenztests).
export function verschraenkePaar(opts) {
  const {
    x0 = 0, x1 = 0, xSplit, tiefeVorn, tiefe, zKante = 0, richtung = 1, flaecheA,
  } = opts || {};
  const t = Math.max(0, num(tiefe));
  const tv = clamp(num(tiefeVorn, t / 2), 0.01, Math.max(0.01, t - 0.01));
  const xs = clamp(num(xSplit, (num(x0) + num(x1)) / 2), num(x0) + 0.01, num(x1) - 0.01);
  // Z-Koordinaten: zV0 = Fassadenkante, zV1 = innere Kante des vorderen Bands,
  // zH1 = rückwärtige Bandkante. richtung +1 wächst in +z, −1 in −z.
  const zV0 = num(zKante);
  const zV1 = richtung >= 0 ? zV0 + tv : zV0 - tv;
  const zH1 = richtung >= 0 ? zV0 + t : zV0 - t;
  // Rück-Split xBack aus der Flächeninvariante.
  const hintenTiefe = Math.abs(zH1 - zV1);
  let xBack;
  if (flaecheA !== undefined && Number.isFinite(num(flaecheA, NaN)) && hintenTiefe > 0.01) {
    xBack = num(x0) + (Math.max(0, num(flaecheA)) - (xs - num(x0)) * tv) / hintenTiefe;
  } else {
    xBack = num(x0) + (num(x1) - xs);
  }
  xBack = clamp(xBack, num(x0), num(x1));
  // L-Polygon A (6 Punkte, alle Kanten achsparallel): vorn [x0..xSplit] voll,
  // hinten [x0..xBack]. Komplement B füllt den Rest — Summe = Rechteckfläche.
  const zoneA = {
    points: [
      { x: num(x0), z: zV0 }, { x: xs, z: zV0 },
      { x: xs, z: zV1 }, { x: xBack, z: zV1 },
      { x: xBack, z: zH1 }, { x: num(x0), z: zH1 },
    ],
  };
  const zoneB = {
    points: [
      { x: xs, z: zV0 }, { x: num(x1), z: zV0 },
      { x: num(x1), z: zH1 }, { x: xBack, z: zH1 },
      { x: xBack, z: zV1 }, { x: xs, z: zV1 },
    ],
  };
  // Teil-Rechtecke (für raumSlicing, 61-04: vorn wird in Räume zerlegt, hinten
  // wird EIN Raum). Koordinaten im Paar-System (x = Band-Laufrichtung).
  const vornZ = { z0: Math.min(zV0, zV1), z1: Math.max(zV0, zV1) };
  const hintenZ = { z0: Math.min(zV1, zH1), z1: Math.max(zV1, zH1) };
  return {
    zoneA, zoneB, xBack,
    vornA: { x0: num(x0), x1: xs, ...vornZ },
    hintenA: { x0: num(x0), x1: xBack, ...hintenZ },
    vornB: { x0: xs, x1: num(x1), ...vornZ },
    hintenB: { x0: xBack, x1: num(x1), ...hintenZ },
  };
}

// --- Escher-v1: Verzahnungsraum (Versatz-Zahn über die WE-Trennwand) -----------
//
// EIN einzelner Raum einer WE ragt als funktionales Verzahnungselement orthogonal
// über die Trennwand in das Nachbar-Segment (Schaltzimmer-Prinzip): achsparallel,
// baubar, flächenneutral — die nominelle Grenzposition verschiebt sich um
// zahnFlaeche/bandTiefe zugunsten des Nachbarn, beide WE behalten ihre
// Solver-Fläche. Hinweis für 61-04: beim Raum-Slicing wird der Zahn-Bereich exakt
// dem deklarierten Verzahnungsraum zugewiesen.
//
// zoneA/zoneB: Rechteck-Zonen (A links/vor B, gemeinsame Trennwand achsparallel).
// fassadeBei: Koordinate der Fassadenkante des Bands (Zahn kommt an die
// rückwärtige Kante). achse: "x" (Trennwand senkrecht zur x-Achse, Default)
// oder "z" (Trennwand waagerecht, Band läuft entlang z) — verzahne rechnet
// intern achsenunabhängig und transformiert zurück. Degenerierte Parameter →
// Rechteck-Fallback + warn.
export function verzahne(opts) {
  const { zoneA, zoneB, grenze, raum = "", zahnTiefe_m = 2, zahnBreite_m = 3, fassadeBeiZ = 0, achse = "x" } = opts || {};
  const g = { ...(grenze || {}) };
  const A = zoneA?.points, B = zoneB?.points;
  const rechteckOk = (pts) => Array.isArray(pts) && pts.length === 4;
  if (!rechteckOk(A) || !rechteckOk(B)) {
    return { zoneA, zoneB, grenze: g, warn: "Verzahnung verworfen: keine Rechteck-Zonen" };
  }
  // Achsen-Normalisierung: intern a = Lauf-/Grenz-Koordinate, b = Quer-Koordinate.
  const swap = achse === "z";
  const lesen = (p) => (swap ? { a: num(p.z), b: num(p.x) } : { a: num(p.x), b: num(p.z) });
  const punkt = (a, b) => (swap ? { x: b, z: a } : { x: a, z: b });
  const aA = A.map(lesen), bA = B.map(lesen);
  const aA0 = Math.min(...aA.map((p) => p.a)), aA1 = Math.max(...aA.map((p) => p.a));
  const aB0 = Math.min(...aA.map((p) => p.b)), aB1 = Math.max(...aA.map((p) => p.b));
  const bA0 = Math.min(...bA.map((p) => p.a)), bA1 = Math.max(...bA.map((p) => p.a));
  const bBreite = bA1 - bA0;
  const bandTiefe = aB1 - aB0; // volle Bandtiefe (Fassade bis Rückkante)
  const zt = num(zahnTiefe_m), zb = num(zahnBreite_m);
  // Degeneration: Zahn breiter als Nachbar-WE, tiefer als das Band → Fallback.
  if (zb >= bBreite - 0.25 || zt >= bandTiefe - 0.25 || zb <= 0 || zt <= 0) {
    // N-05: hier stand `zoneA: zoneB ? zoneA : zoneA` — ein Ausdruck ohne Wirkung.
    return { zoneA, zoneB, grenze: g, warn: "Verzahnung verworfen: degenerierte Zahn-Maße (Rechteck-Fallback)" };
  }
  // Rückwärtige Kante = gegenüber der Fassade.
  const fassade = num(fassadeBeiZ);
  const hinten = Math.abs(fassade - aB0) > Math.abs(fassade - aB1) ? aB0 : aB1;
  const vorn = hinten === aB1 ? aB0 : aB1;
  // H-01 (externe Review 02.09.): Der Zahn sitzt IMMER an der Rückkante und ragt
  // von dort um zt nach vorn. Vorher waren zahnZ0/zahnZ1 fest als
  // "aufsteigend" angenommen; liegt die Fassade an der Maximalkante, ist hinten
  // die Minimalkante, und der Punktumlauf lief bis zur Rückkante, in den Zahn und
  // wieder auf denselben Punkt zurück. dedupe() entfernt nur BENACHBARTE
  // Duplikate — das nicht benachbarte blieb stehen, das Polygon überschnitt sich
  // selbst, und der Zahn wurde der falschen WE zugeschlagen (Nordband 49/73 statt
  // 61/61; Laubengang 68/92 statt 60/60, Gesamtbilanz 160 statt 120 m²).
  // zahnInnen ist die Zahnkante, die zur Fassade zeigt — richtungsunabhängig.
  const zahnInnen = hinten + (vorn > hinten ? zt : -zt);
  // Flächenneutralität: A behält seine Fläche → Basis-Breite shrinkt um
  // zahnFlaeche/bandTiefe; die nominelle Grenze verschiebt sich entsprechend.
  const zahnFlaeche = zt * zb;
  const versatz = safeDiv(zahnFlaeche, bandTiefe);
  const grenzeAlt = num(g.pos_m, aA1);
  const grenzeNeu = grenzeAlt - versatz;
  if (grenzeNeu <= aA0 + 0.1) {
    return { zoneA, zoneB, grenze: g, warn: "Verzahnung verworfen: Basis-Breite würde degenerieren (Rechteck-Fallback)" };
  }
  // A: gestuft — Rechteck bis grenzeNeu + Zahn über der Trennwand.
  // (dedupe: berührt der Zahn eine Bandkante, entfällt ein Eckpunkt.)
  const dedupe = (pts) => pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.z - q.z) > 1e-9;
  });
  // A: Basis-Rechteck aA0..grenzeNeu über die volle Bandtiefe, plus der Zahn
  // grenzeNeu..grenzeNeu+zb an der Rückkante. Sechs Punkte, ein sauberer Umlauf
  // gegen den Uhrzeigersinn im (a,b)-System — unabhängig davon, auf welcher Seite
  // die Fassade liegt.
  const neuA = {
    ...zoneA,
    points: dedupe([
      punkt(aA0, vorn),
      punkt(grenzeNeu, vorn),
      punkt(grenzeNeu, zahnInnen),
      punkt(grenzeNeu + zb, zahnInnen),
      punkt(grenzeNeu + zb, hinten),
      punkt(aA0, hinten),
    ]),
  };
  // B: Komplement — volles Rechteck grenzeNeu..bA1 minus derselbe Zahn.
  const neuB = {
    ...zoneB,
    points: dedupe([
      punkt(grenzeNeu, vorn),
      punkt(bA1, vorn),
      punkt(bA1, hinten),
      punkt(grenzeNeu + zb, hinten),
      punkt(grenzeNeu + zb, zahnInnen),
      punkt(grenzeNeu, zahnInnen),
    ]),
  };
  g.pos_m = grenzeNeu;
  g.verzahnung = { raum: String(raum), zahnTiefe_m: zt, zahnBreite_m: zb };
  // Zahn-Rechteck (für raumSlicing, 61-04: der Verzahnungsraum belegt exakt
  // diese Fläche; der Nachbar spart sie über aussparung aus). Koordinaten im
  // Lauf-System (a = Laufrichtung) — identisch mit der weBand-Konvention.
  const zahnRect = {
    x0: grenzeNeu, x1: grenzeNeu + zb,
    z0: Math.min(zahnInnen, hinten), z1: Math.max(zahnInnen, hinten),
  };
  return { zoneA: neuA, zoneB: neuB, grenze: g, zahnRect };
}

/**
 * Was an einer Grenze mit dem Verzahnungsraum passiert ist — entweder die Masse
 * des gesetzten Zahns oder der Grund, warum keiner gesetzt wurde.
 *
 * @typedef {object} VerzahnungMeta
 * @property {string} [raum] room name occupying the tooth
 * @property {number} [zahnTiefe_m] tooth depth in metres
 * @property {number} [zahnBreite_m] tooth width in metres
 * @property {string} [warn] why no tooth was produced
 */

// --- tote Zwischenräume (harte Nebenbedingung aus D-P61-05) ---------------------
//
// Meldet unbelegte Restflächen zwischen WEs: Summe Zonen < Bandfläche − 0,05 m²
// → „offen" mit Restfläche + Knautschzonen-Hinweis; Rundungsrauschen ≤ 0,05 m²
// wird nicht gemeldet (pass). Summe > Bandfläche (Überlappung) → warn.
export function toteZwischenraeume(opts) {
  const { bandFlaeche = 0, zonen = [] } = opts || {};
  const summe = (Array.isArray(zonen) ? zonen : []).reduce((s, z) => s + polyArea(z?.points), 0);
  const restFlaeche = num(bandFlaeche) - summe;
  if (restFlaeche > 0.05) {
    return {
      status: "offen",
      rest_m2: restFlaeche,
      hinweis: "tote Zwischenräume — Knautschzonen freigeben/anpassen",
    };
  }
  if (restFlaeche < -0.05) {
    return { status: "warn", rest_m2: restFlaeche, hinweis: "Überlappung zwischen Zonen" };
  }
  return { status: "pass", rest_m2: Math.max(0, restFlaeche), hinweis: "" };
}

// --- Tesselierungs-Checks (pass/warn/offen, nie fail) ----------------------------
/**
 * Bewertet ein tesseliere()-Ergebnis. Nie "fail" — die Tesselierung ist ein
 * Entwurfswerkzeug, keine Genehmigungsprüfung; ein hartes Durchfallen wäre eine
 * Aussage, die dieses Modul fachlich nicht treffen kann.
 *
 * @param {object} opts
 * @param {Array<object>} [opts.weListe] placed apartments from tesseliere()
 * @param {number} [opts.restNachfrage_m2] target area of units that did not fit,
 *   in m² — this and ONLY this is over-occupancy
 * @param {number} [opts.rest_m2] legacy fallback for callers that do not pass
 *   restNachfrage_m2 yet; carries band gaps as well and therefore over-reports
 * @param {number} [opts.angefordert] number of requested unit TYPES (the length
 *   of the einheiten catalogue), not the number of apartments — the catalogue is
 *   repeated per band and per storey
 * @param {Array<object>} [opts.zonen] zones of ONE band, for the dead-space check
 * @param {number} [opts.bandFlaeche] that band's area in m²
 * @returns {Array<{key: string, label: string, status: string, detail: string}>}
 */
export function tesselierungsChecks(opts) {
  const { weListe = [], rest_m2 = 0, restNachfrage_m2, angefordert, zonen, bandFlaeche } = opts || {};
  const liste = Array.isArray(weListe) ? weListe : [];
  const checks = [];
  const nf = (v) => (Math.round(num(v) * 10) / 10).toLocaleString("de-DE");

  // M-03 (externe Review 02.09.): der Check las rest_m2. Das ist die physikalisch
  // unbelegte Fläche (Bandlücken, leere Bänder) PLUS die Nachfrage der
  // abgewiesenen Einheiten. Eine einzige WE im Laubengang, restlos platziert,
  // meldete deshalb "208 m² nicht platzierbar" — die 61-05-UI hängt an genau
  // dieser Warnung. Überbelegung ist ausschliesslich restNachfrage_m2.
  const ueber = num(restNachfrage_m2 !== undefined ? restNachfrage_m2 : rest_m2);
  if (ueber > 0.05) {
    checks.push({
      key: "ueberbelegung", label: "Überbelegung", status: "warn",
      detail: `${nf(ueber)} m² nicht platzierbar`,
    });
  } else {
    checks.push({ key: "ueberbelegung", label: "Überbelegung", status: "pass", detail: "keine Überbelegung" });
  }

  const ohneFassade = liste.filter((w) => num(w?.fassadeLaenge_m) <= 0);
  checks.push({
    key: "fassade", label: "Fassadenanteil je WE",
    status: ohneFassade.length ? "warn" : "pass",
    detail: ohneFassade.length
      ? `${ohneFassade.length} WE ohne Fassadenkante (konstruktiv unmöglich — prüfen)`
      : "jede WE hat Fassadenanteil",
  });

  if (angefordert !== undefined) {
    // M-04 (externe Review 02.09.): verglichen wurde liste.length gegen
    // angefordert. Die einheiten-Liste ist ein TYPEN-Katalog und wird je Band und
    // je Geschoss wiederholt (so in Plan 61-01 beschrieben), weListe zählt dagegen
    // die tatsächlichen Wohnungen. 2 Typen auf 2 Geschossen im Mittelflur ergaben
    // "8 von 2 angeforderten WE platziert" — und blieben auf pass, selbst wenn
    // einer der beiden Typen überhaupt nicht untergebracht werden konnte. Jetzt
    // wird Gleiches mit Gleichem verglichen: wie viele der angeforderten Typen
    // mindestens einmal platziert sind. Die Wohnungszahl steht zusätzlich im
    // Detail, damit die 61-05-UI beide Grössen zeigen kann.
    const typen = new Set(liste.map((w) => w?.typKey).filter((k) => k !== undefined && k !== null));
    const soll = num(angefordert);
    checks.push({
      key: "anzahl", label: "WE-Anzahl",
      status: typen.size < soll ? "warn" : "pass",
      detail: `${typen.size} von ${soll} angeforderten WE-Typen platziert (${liste.length} Wohnungen)`,
    });
  }

  if (zonen !== undefined && bandFlaeche !== undefined) {
    const t = toteZwischenraeume({ bandFlaeche, zonen });
    checks.push({
      key: "zwischenraeume", label: "Tote Zwischenräume", status: t.status,
      detail: t.status === "offen" ? `${nf(t.rest_m2)} m² Restfläche — ${t.hinweis}` : (t.hinweis || "lückenlos"),
    });
  }

  return checks;
}

// --- raumSlicing (Plan 61-04, D-P61-07) -----------------------------------------
//
// Zustandslose Guillotine-Zerlegung eines WE-Bands nach dem Typ-Raumprogramm:
// jede Bandbreiten-Änderung des Solvers ändert die Raumaufteilung automatisch
// (kein zweiter Solver-Schritt, kein persistierter Raum-Zuschnitt).
//
// Eingabe weBand: { rechteck {x0,x1,z0,z1}, fassadeBei, achse, level, we,
//   variante?, nutzung?, raumartSchall?, hinten? {x0,x1,z0,z1,raum?},
//   zahn? {rect,raum} } — alternativ points statt rechteck (L-Polygone werden
//   von tesseliere vorzerlegt). raumprogramm = Typ-Raumprogramm (61-02).
//
// Regeln: fensterpflichtige Räume als Streifen an der Fassadenkante,
// innenliegende Räume als hintere Zeile an der Erschließungsseite
// (Breiten via verteileBand — Wiederverwendung, kein zweiter Verteil-
// algorithmus). Bei "gespiegelt" ist die Raumreihenfolge gespiegelt.
// Der Verzahnungsraum belegt exakt das Zahn-Rechteck (61-04-Hinweis an
// verzahne-Konsumenten); die hintere Zeile nutzt die verbleibende Tiefe.
//
// Schmales Band (Breite < Σ Raum-Minima): Räume bleiben bei min, überzählige
// Räume entfallen hinten mit warn — niemals negative Breiten.
//
// Rückgabe: Zonen-ARRAY mit zusätzlicher .warns-Property (Degradations-
// Hinweise). Namen eindeutig je Geschoss: "<Raum> (<we>) ·WT" + Zähler bei
// Duplikaten (roomKey-Kollisions-Schutz, KD-17/asr.js-Konvention).
/**
 * @param {object} weBand
 * @param {Array<object>} raumprogramm
 * @param {Regeln} [regeln] 75-07 rule switches (default: none → Phase-61 behaviour)
 */
export function raumSlicing(weBand, raumprogramm, regeln = {}) {
  const b = weBand || {};
  const rg = /** @type {Regeln} */ (regeln && typeof regeln === "object" ? regeln : {});
  // 75-14: resolved apartment-layout rules (all off → Phase-61/75-07 behaviour).
  const wr = wohnungsRegeln(rg);
  const level = Math.round(num(b.level));
  const we = String(b.we ?? "");
  const achseZ = b.achse === "z";
  const gespiegelt = b.variante === "gespiegelt" || b.gespiegelt === true;
  const warns = [];
  const zonen = [];
  const names = new Map();

  const prog = (Array.isArray(raumprogramm) ? raumprogramm : [])
    .filter((r) => r && r.raum);

  const raumartFuer = (art) => {
    if (art === "flur") return "flur";
    if (b.nutzung === "gewerbe") return b.raumartSchall === "laut" ? "laut" : (b.raumartSchall || "buero");
    return "wohnen";
  };
  const eindeutigerName = (raum) => {
    const basis = `${raum} (${we || "WE"})`;
    const n = (names.get(basis) || 0) + 1;
    names.set(basis, n);
    return n === 1 ? `${basis} ·WT` : `${raum} ${n} (${we || "WE"}) ·WT`;
  };
  const rechteckZone = (rx0, rx1, rz0, rz1, raumZeile, flaecheOverride) => {
    const pts = achseZ
      ? [{ x: rz0, z: rx0 }, { x: rz0, z: rx1 }, { x: rz1, z: rx1 }, { x: rz1, z: rx0 }]
      : [{ x: rx0, z: rz0 }, { x: rx1, z: rz0 }, { x: rx1, z: rz1 }, { x: rx0, z: rz1 }];
    return {
      points: pts,
      level,
      name: eindeutigerName(raumZeile.raum),
      we,
      raumart: raumartFuer(raumZeile.art),
      art: raumZeile.art,
      fensterpflicht: !!raumZeile.fensterpflicht,
      flaeche_m2: flaecheOverride ?? polyArea(pts),
    };
  };

  // Eingabe-Konvention: weBand-Rechtecke sind IMMER im x-Modus (x = Band-
  // Laufrichtung, z = quer), unabhängig von der realen Achse — rechteckZone
  // transformiert für achse="z" zurück in Weltkoordinaten.
  const norm = (r) => (r ? { x0: num(r.x0), x1: num(r.x1), z0: num(r.z0), z1: num(r.z1) } : null);
  const rect = norm(b.rechteck);
  const fassade = num(b.fassadeBei);
  if (!rect || !prog.length) {
    warns.push(!rect ? "kein Band-Rechteck übergeben" : "leeres Raumprogramm");
    return Object.assign(zonen, { warns });
  }

  let restProg = [...prog];

  // 1) Verzahnungsraum: belegt exakt das Zahn-Rechteck (außerhalb des Basis-
  //    Rechtecks) — Restprogramm wird danach regulär gesliced.
  if (b.zahn && b.zahn.rect) {
    const raumName = String(b.zahn.raum || "Verzahnungsraum");
    const idx = restProg.findIndex((r) => r.raum === raumName);
    const zeile = idx >= 0 ? restProg.splice(idx, 1)[0] : { raum: raumName, art: "aufenthalt", fensterpflicht: false };
    const zr = norm(b.zahn.rect);
    zonen.push(rechteckZone(zr.x0, zr.x1, zr.z0, zr.z1, zeile));
  }

  // 2) Hinterer Anteil (L-Polygone): EIN Raum = größter Aufenthaltsraum des
  //    Programms (dokumentierte v1-Vereinfachung, Plan 61-04 Vertrag).
  if (b.hinten) {
    const hr = norm(b.hinten);
    let idx = -1;
    restProg.forEach((r, i) => {
      const fl = num(r.flaeche_m2);
      if (r.art === "aufenthalt" && (idx < 0 || fl > num(restProg[idx].flaeche_m2))) idx = i;
    });
    if (idx < 0 && restProg.length) {
      restProg.forEach((r, i) => {
        if (idx < 0 || num(r.flaeche_m2) > num(restProg[idx].flaeche_m2)) idx = i;
      });
    }
    if (idx >= 0) {
      const zeile = restProg.splice(idx, 1)[0];
      zonen.push(rechteckZone(hr.x0, hr.x1, hr.z0, hr.z1, zeile));
    }
  }

  // 3) Guillotine im Basis-Rechteck.
  const W = rect.x1 - rect.x0;
  const D = rect.z1 - rect.z0;
  const facadeHinten = Math.abs(fassade - rect.z1) < Math.abs(fassade - rect.z0);

  const front = restProg.filter((r) => r.fensterpflicht);
  const back = restProg.filter((r) => !r.fensterpflicht);
  if (gespiegelt) { front.reverse(); back.reverse(); }

  const zielFlaeche = (r) => Math.max(0, num(r.flaeche_m2, num(r.min_m2)));
  // Tiefe der hinteren Zeile aus ihren Zielflächen (mind. 1,2 m, max. 60 % der
  // Bandtiefe [ASSUMED], damit Fassadenräume nicht degenerieren).
  const flaecheBack = back.reduce((s, r) => s + zielFlaeche(r), 0);
  let dB = W > 0.1 ? flaecheBack / W : 0;
  dB = clamp(dB, back.length ? 1.2 : 0, Math.max(0, D * 0.6));
  const dF = Math.max(0, D - dB);

  // Streifenbreiten: proportional zu den Zielflächen (geschlossene Füllform,
  // Rest = 0). verteileBand kommt zum Einsatz, wenn das Band zu schmal ist
  // (Min-Breiten-Klemme → überzählige Räume entfallen mit warn, nie negativ).
  const fmt1 = (v) => (Math.round(num(v) * 100) / 100).toFixed(2).replace(".", ",");
  // 75-07 regeln.mindestbreiten: Mindestbreite je Raumart [ASSUMED] fließt in die
  // Min-Klemme ein; wird sie unterschritten, entsteht ein HINWEIS mit Ursache.
  const mindest = (r) => {
    if (!rg.mindestbreiten) return 0;
    const werte = rg.mindestbreitenWerte || MINDESTBREITEN;
    // Schlafen/Kind sind Aufenthaltsräume mit kleinerer Mindestbreite (Nr. 65).
    if (r.art === "aufenthalt" && /schlaf|kind/i.test(String(r.raum || ""))) return num(werte.schlafen, werte.aufenthalt);
    return num(werte[r.art]);
  };
  const mindestHinweis = (r, breite) => {
    warns.push(`„${r.raum}" ${fmt1(breite)} m breit < ${fmt1(mindest(r))} m Mindestbreite [ASSUMED] — Bandtiefe ${fmt1(D)} m zu groß für ${fmt1(zielFlaeche(r))} m²; Vorschlag: Erschließung mit geringerer Bandtiefe oder größere Fläche`);
  };
  const breiteLoesen = (liste, tiefe, breite) => {
    if (!liste.length || tiefe <= 0.05 || breite <= 0.05) return [];
    const gesamt = liste.reduce((s, r) => s + zielFlaeche(r), 0);
    const minBreiten = liste.map((r) => Math.max(safeDiv(Math.max(0, num(r.min_m2)), tiefe), mindest(r)));
    const minSumme = minBreiten.reduce((s, v) => s + v, 0);
    if (minSumme > breite + 1e-9) {
      // Degradation: Räume bleiben bei min, Überhang entfällt (verteileBand
      // meldet den Defizit-Rest, Platzierung bricht kontrolliert ab).
      if (rg.mindestbreiten) {
        liste.forEach((r) => {
          const prop = gesamt > 0 ? (breite * zielFlaeche(r)) / gesamt : breite / liste.length;
          if (prop + 1e-6 < mindest(r)) mindestHinweis(r, prop);
        });
      }
      return verteileBand(breite, liste.map((r, i) => ({
        id: r.raum, ziel: minBreiten[i], min: minBreiten[i], max: minBreiten[i],
      }))).items;
    }
    const items = liste.map((r) => ({
      id: r.raum,
      breite: gesamt > 0 ? (breite * zielFlaeche(r)) / gesamt : breite / liste.length,
      fixiert: false,
    }));
    if (rg.mindestbreiten) {
      // Proportional verteilte Breiten gegen die Mindestbreite prüfen — bei
      // Unterschreitung auf min anheben (verteileBand klemmt die anderen), Hinweis.
      const zuSchmal = liste.filter((r, i) => items[i].breite + 1e-6 < mindest(r));
      if (zuSchmal.length) {
        const gel = verteileBand(breite, liste.map((r, i) => ({
          id: r.raum, ziel: items[i].breite, min: minBreiten[i], max: Math.max(minBreiten[i], breite),
        })));
        for (const r of zuSchmal) mindestHinweis(r, items.find((it) => it.id === r.raum)?.breite);
        return gel.items;
      }
    }
    return items;
  };
  // 75-07 regeln.phi: schlauchige Räume (Seitenverhältnis > 3 [ASSUMED]) melden.
  const phiHinweis = (raum, w, d) => {
    if (!rg.phi || w <= 0.05 || d <= 0.05) return;
    const v = Math.max(w, d) / Math.min(w, d);
    if (v > 3) warns.push(`„${raum}" ${fmt1(w)} × ${fmt1(d)} m (1 : ${fmt1(v)}) — schlauchig, φ wäre 1 : 1,62`);
  };

  // Reihe von xStart bis xEnde laufen lassen; zIntervall = [zLow, zHigh].
  const platzieren = (liste, items, xStart, xEnde, zLow, zHigh) => {
    let x = xStart;
    for (let i = 0; i < liste.length; i++) {
      const breite = Math.max(0, num(items[i]?.breite));
      if (breite <= 1e-6) continue;
      if (x + breite > xEnde + 1e-6) {
        warns.push(`„${liste[i].raum}" entfällt — Band zu schmal (Räume bleiben bei min)`);
        break;
      }
      zonen.push(rechteckZone(x, x + breite, zLow, zHigh, liste[i]));
      phiHinweis(liste[i].raum, breite, zHigh - zLow);
      x += breite;
    }
  };

  // 75-07 / MSB-6: Band mit ZWEI Fassaden (Spänner-Quadranten). Fensterpflichtige
  // Räume auf beide Fassadenzeilen verteilt, innenliegende Räume als Mittelstreifen —
  // nie ein Bad an der Gegenfassade. Aussparung/L-Anteil kommen hier nicht vor
  // (Spänner hat keine Verschränkung/Verzahnung über Bandgrenzen).
  if (b.zweiFassaden && !b.hinten && !b.zahn) {
    if (wr.diele) warns.push("Diele/Türen [75-14]: für Spänner-Quadranten (zwei Fassaden) nicht gebaut — Standardzuschnitt (Folgearbeit)");
    const dBm = clamp(W > 0.1 ? flaecheBack / W : 0, back.length ? 1.2 : 0, Math.max(0, D * 0.5));
    const dFm = Math.max(0, (D - dBm) / 2);
    const front1 = front.slice(0, Math.ceil(front.length / 2));
    const front2 = front.slice(front1.length);
    if (dFm > 0.05 && front1.length) platzieren(front1, breiteLoesen(front1, dFm, W), rect.x0, rect.x1, rect.z0, rect.z0 + dFm);
    if (dBm > 0.05 && back.length) platzieren(back, breiteLoesen(back, dBm, W), rect.x0, rect.x1, rect.z0 + dFm, rect.z0 + dFm + dBm);
    if (dFm > 0.05 && front2.length) platzieren(front2, breiteLoesen(front2, dFm, W), rect.x0, rect.x1, rect.z1 - dFm, rect.z1);
    else if (front2.length) warns.push("zweite Fassaden-Reihe entfällt — Bandtiefe zu gering");
    return Object.assign(zonen, { warns });
  }

  const aussp = norm(b.aussparung);

  // --- 75-14 regeln.diele: two room rows with an inner circulation strip --------
  //
  // Corridor side: hall (Diele, ≥ 1,20 m wide, ≈ 4 m²) + the windowless rooms
  // (kitchen, bath, storage). Between the rows: the apartment corridor strip
  // (MINDESTBREITEN.flur = 1,20 m) over the full unit width, merged with the hall
  // into ONE L-shaped zone "Diele" — every room shares a wall with it, every room
  // gets a door INTO it (D-P75-14-C: no walk-through rooms). Facade side: the
  // window rooms with minimum widths (MINDESTBREITEN table, 2,40 m bedroom/child
  // room, ≥ raumMin_m2 / depth). When the facade is too short for all window
  // rooms at their minimum widths, the SMALLEST one is merged into its neighbour
  // of the same art (3-Zi becomes 2-Zi) and the hint names the facade needed —
  // the alternative (a room under 2,40 m) is what the user rejected. Only the
  // plain rectangle band is handled here; L-pairs, teeth and two-facade quadrants
  // keep the Phase-61 slicing (hint, follow-up work).
  const flurT = MINDESTBREITEN.flur;
  if (wr.diele && (b.hinten || b.zahn || aussp)) {
    warns.push("Diele/Türen [75-14]: für L-Verschränkung/Verzahnung nicht gebaut — Standardzuschnitt (Folgearbeit)");
  }
  if (wr.diele && !b.hinten && !b.zahn && !aussp) {
    const backOhneFlur = back.filter((r) => r.art !== "flur");
    const flaecheBack2 = backOhneFlur.reduce((s, r) => s + zielFlaeche(r), 0) + DIELE_MASSE.flaeche;
    const dB2 = clamp(W > 0.1 ? flaecheBack2 / W : 0, DIELE_MASSE.minBreite, Math.max(DIELE_MASSE.minBreite, D * 0.6));
    const dF2 = D - dB2 - flurT;
    if (dF2 < 2.4) {
      warns.push(`Diele/Türen [75-14]: Bandtiefe ${fmt1(D)} m zu gering für zwei Raumreihen + Flur — Standardzuschnitt`);
    } else {
      // Minimum width of a window room: MINDESTBREITEN table (the layout rule
      // implies it — a hall without usable rooms is pointless), D-P75-14-A 2,40 m
      // for bedroom/child room, and raumMin_m2 / row depth so the area holds.
      const tabelle = (r) => (r.art === "aufenthalt" && /schlaf|kind/i.test(String(r.raum || ""))
        ? num(MINDESTBREITEN.schlafen, MINDESTBREITEN.aufenthalt) : num(MINDESTBREITEN[r.art]));
      const minFront = (r) => Math.max(
        tabelle(r),
        r.art === "aufenthalt" && /schlaf|kind/i.test(String(r.raum || "")) ? wr.schlafenMinBreite_m : 0,
        r.art === "aufenthalt" && wr.raumMin_m2 > 0 ? wr.raumMin_m2 / dF2 : 0,
        safeDiv(Math.max(0, num(r.min_m2)), dF2),
      );
      const frontL = front.map((r) => ({ ...r }));
      const summeMin = () => frontL.reduce((s, r) => s + minFront(r), 0);
      for (let runde = 0; runde < 8 && frontL.length > 1 && summeMin() > W + 1e-9; runde += 1) {
        let idx = -1;
        frontL.forEach((r, i) => { if (idx < 0 || zielFlaeche(r) < zielFlaeche(frontL[idx])) idx = i; });
        const links = idx - 1, rechts = idx + 1;
        const nIdx = links >= 0 && frontL[links].art === frontL[idx].art ? links
          : rechts < frontL.length && frontL[rechts].art === frontL[idx].art ? rechts : -1;
        if (nIdx < 0) break;
        const a = frontL[nIdx], k = frontL[idx];
        const noetig = summeMin();
        const merged = {
          ...a, raum: `${a.raum} + ${k.raum}`, flaeche_m2: zielFlaeche(a) + zielFlaeche(k),
          min_m2: num(a.min_m2) + num(k.min_m2), max_m2: num(a.max_m2, zielFlaeche(a)) + num(k.max_m2, zielFlaeche(k)),
        };
        warns.push(`„${k.raum}" mit „${a.raum}" zusammengelegt [75-14] — Fassade ${fmt1(W)} m reicht nicht für ${frontL.length} Aufenthaltsräume ab Mindestbreite (nötig ${fmt1(noetig)} m); WE verbreitern, Typ wechseln oder Bandtiefe ${fmt1(D)} m senken`);
        frontL.splice(Math.max(idx, nIdx), 1);
        frontL.splice(Math.min(idx, nIdx), 1, merged);
      }
      // Widths: proportional to target areas, clamped to the minimums (verteileBand
      // redistributes the shortfall over the flexible rooms, never negative).
      const breitenMitMin = (liste, breite, minFn) => {
        if (!liste.length || breite <= 0.05) return [];
        const gesamt = liste.reduce((s, r) => s + zielFlaeche(r), 0);
        const mins = liste.map((r) => Math.min(minFn(r), breite / liste.length));
        return verteileBand(breite, liste.map((r, i) => ({
          id: r.raum, ziel: gesamt > 0 ? (breite * zielFlaeche(r)) / gesamt : breite / liste.length, min: mins[i], max: breite,
        }))).items;
      };
      // Cross-axis levels (lauf system): cK corridor edge, cB back/strip boundary,
      // cS strip/front boundary, cF facade edge.
      const cK = facadeHinten ? rect.z0 : rect.z1;
      const cB = facadeHinten ? rect.z0 + dB2 : rect.z1 - dB2;
      const cS = facadeHinten ? cB + flurT : cB - flurT;
      const cF = facadeHinten ? rect.z1 : rect.z0;
      const dieleB = clamp(DIELE_MASSE.flaeche / dB2, DIELE_MASSE.minBreite, Math.max(DIELE_MASSE.minBreite, W / 2));
      const dieleAmEnde = gespiegelt;
      const xD0 = dieleAmEnde ? rect.x1 - dieleB : rect.x0;
      const xD1 = dieleAmEnde ? rect.x1 : rect.x0 + dieleB;
      // Hall zone: L-polygon, first edge = corridor edge (apartment door sits there).
      const dieleZeile = back.find((r) => r.art === "flur") || { raum: "Diele", art: "flur", fensterpflicht: false };
      const dielePts = dieleAmEnde
        ? [{ x: xD0, z: cK }, { x: rect.x1, z: cK }, { x: rect.x1, z: cS }, { x: rect.x0, z: cS }, { x: rect.x0, z: cB }, { x: xD0, z: cB }]
        : [{ x: xD0, z: cK }, { x: xD1, z: cK }, { x: xD1, z: cB }, { x: rect.x1, z: cB }, { x: rect.x1, z: cS }, { x: rect.x0, z: cS }];
      const weltPts = dielePts.map((p) => (achseZ ? { x: p.z, z: p.x } : { x: p.x, z: p.z }));
      const diele = {
        points: weltPts, level, name: eindeutigerName("Diele"), we, raumart: "flur", art: "flur",
        fensterpflicht: false, flaeche_m2: polyArea(weltPts),
        tueren: /** @type {Tuer[]} */ ([]),
      };
      const aufschlagFuer = (zoneName, idx) => {
        const k = `${level}|${zoneName}|${idx}`;
        const v = b.tuerAufschlaege && typeof b.tuerAufschlaege === "object" ? b.tuerAufschlaege[k] : undefined;
        return v === "rechts" ? "rechts" : "links";
      };
      // Apartment entrance: centred in the hall's corridor edge, opens into the hall.
      const bW = TUERBREITEN.wohnung;
      diele.tueren.push({ wand: 0, u_m: Math.max(0, (dieleB - bW) / 2), breite_m: bW, aufschlag: aufschlagFuer(diele.name, 0), nach: null, typ: "wohnung" });
      zonen.push(diele);
      // Rows: doors sit in the edge that faces the strip; u = 0,15 m from the edge
      // start, so the hinge stands at the wall corner and the leaf swings into the
      // room along the side wall — never towards the window (the window wall is the
      // opposite edge of the room).
      const zeile = (liste, items, xStart, zLow, zHigh, tuerKante, fensterKante) => {
        let x = xStart;
        for (let i = 0; i < liste.length; i += 1) {
          const breite = Math.max(0, num(items[i]?.breite));
          if (breite <= 1e-6) continue;
          if (x + breite > rect.x1 + 1e-6) {
            warns.push(`„${liste[i].raum}" entfällt — Band zu schmal (Räume bleiben bei min)`);
            break;
          }
          const z = /** @type {any} */ (rechteckZone(x, x + breite, zLow, zHigh, liste[i]));
          const bT = liste[i].art === "sanitaer" ? TUERBREITEN.bad : TUERBREITEN.zimmer;
          if (breite >= bT + 2 * TUER_ANSCHLAG_ABSTAND) {
            z.tueren = [{ wand: tuerKante, u_m: TUER_ANSCHLAG_ABSTAND, breite_m: bT, aufschlag: aufschlagFuer(z.name, 0), nach: diele.name, typ: liste[i].art === "sanitaer" ? "bad" : "zimmer" }];
          } else {
            z.tueren = [];
            warns.push(`„${liste[i].raum}" ${fmt1(breite)} m breit — keine Tür möglich (Öffnung ${fmt1(bT)} m + Anschläge) [75-14]`);
          }
          if (fensterKante !== null) z.fensterwand = fensterKante;
          zonen.push(z);
          phiHinweis(liste[i].raum, breite, zHigh - zLow);
          x += breite;
        }
      };
      // rechteckZone edges: 0 at z-low (x ascending), 2 at z-high (x descending).
      const frontLow = Math.min(cS, cF), frontHigh = Math.max(cS, cF);
      const backLow = Math.min(cK, cB), backHigh = Math.max(cK, cB);
      const frontTuer = facadeHinten ? 0 : 2, frontFenster = facadeHinten ? 2 : 0;
      const backTuer = facadeHinten ? 2 : 0;
      zeile(frontL, breitenMitMin(frontL, W, minFront), rect.x0, frontLow, frontHigh, frontTuer, frontFenster);
      const backStart = dieleAmEnde ? rect.x0 : xD1;
      zeile(backOhneFlur, breitenMitMin(backOhneFlur, W - dieleB, tabelle), backStart, backLow, backHigh, backTuer, null);
      // raumMin_m2: an aufenthalt room still below the minimum (only possible after a
      // dropped/clamped row) becomes storage — never a living room on paper.
      if (wr.raumMin_m2 > 0) {
        for (const z of /** @type {any[]} */ (zonen)) {
          if (z.art !== "aufenthalt" || z.we !== we || num(z.flaeche_m2) >= wr.raumMin_m2) continue;
          warns.push(`„${z.name}" ${fmt1(z.flaeche_m2)} m² < ${fmt1(wr.raumMin_m2)} m² Aufenthaltsraum-Minimum [ASSUMED Büro-Vorgabe] — als Abstellraum ausgewiesen [75-14]`);
          z.name = eindeutigerName("Abstellraum");
          z.art = "abstell";
          z.fensterpflicht = false;
          delete z.fensterwand;
        }
      }
      return Object.assign(zonen, { warns });
    }
  }

  // Front-Reihe an der Fassade, hintere Zeile an der Erschließungsseite.
  // Aussparung (Verzahnungsnachbar, 61-04): die Zahn-Fläche bleibt je
  // betroffener Zeile ausgespart (Reihe startet hinter dem Zahn) — keine
  // Überlappung, Flächeninvariante bleibt erhalten.
  const zahnUeberschneidet = (zLow, zHigh) =>
    !!aussp && aussp.z1 > zLow + 1e-9 && aussp.z0 < zHigh - 1e-9;
  const fLow = facadeHinten ? rect.z1 - dF : rect.z0;
  const fHigh = facadeHinten ? rect.z1 : rect.z0 + dF;
  const bLow = facadeHinten ? rect.z0 : rect.z1 - dB;
  const bHigh = facadeHinten ? rect.z0 + dB : rect.z1;
  let vornStart = rect.x0;
  let hintenStart = clamp(num(b.hintenVersatz, rect.x0), rect.x0, rect.x1);
  if (aussp) {
    if (zahnUeberschneidet(fLow, fHigh)) vornStart = Math.max(vornStart, aussp.x1);
    if (zahnUeberschneidet(bLow, bHigh)) hintenStart = Math.max(hintenStart, aussp.x1);
  }
  const frontBreiten = breiteLoesen(front, dF, Math.max(0, rect.x1 - vornStart));
  const backBreiten = breiteLoesen(back, dB, Math.max(0, rect.x1 - hintenStart));
  if (dF > 0.05 && front.length) platzieren(front, frontBreiten, vornStart, rect.x1, fLow, fHigh);
  else if (front.length) warns.push("Fassaden-Reihe entfällt — Bandtiefe zu gering");
  if (dB > 0.05 && back.length) platzieren(back, backBreiten, hintenStart, rect.x1, bLow, bHigh);

  return Object.assign(zonen, { warns });
}

// --- tesseliere ------------------------------------------------------------------
//
// Erweiterter Rückgabe-Vertrag (61-03, rückwärtskompatibel zu 61-01):
// { zonen, weListe, grenzen, rest_m2, rest, restNachfrage_m2 }.
//   rest_m2 (= Alias rest): PHYSIKALISCH unbelegte Fläche (Lücken zwischen
//     Zonen, inkl. leerer Bänder) — Invariante: Σ alle Zonenflächen +
//     rest_m2 = BBox-Footprintfläche.
//   restNachfrage_m2: Zielflächen der Einheiten, die nicht mehr ins Band
//     passen (Überbelegungs-Nachfrage) — Basis für den „nicht platzierbar"-
//     Hinweis in der UI (61-05) und den Überbelegungs-Check.
//
// Eingabe zusätzlich: gesperrteGrenzen = [ids] (Fixierung im Zweitlauf,
// D-P61-06), einheiten-Einträge mit variante "gespiegelt", verschraenkbar: true
// (L-Paar mit dem Folge-Nachbarn), verzahnungsRaum: "<Raumname>" (Zahn an der
// Grenze zum Folge-Nachbarn; Raum muss im optionalen raumprogramm des Eintrags
// existieren, sonst warn + kein Zahn).
/**
 * Manual order of a band (61-07, rest of Phase 42): known keys first in the given
 * order, catalogue entries not named are appended in catalogue order, unknown
 * keys are ignored. Without keys the catalogue order is returned unchanged.
 * @param {Array<{key?: string}>} liste unit catalogue (einheiten)
 * @param {string[]|null|undefined} keys wanted order of `key`s
 * @returns {Array<object>} permutation of `liste`
 */
export function ordneEinheiten(liste, keys) {
  const l = Array.isArray(liste) ? liste : [];
  if (!Array.isArray(keys) || !keys.length) return l;
  const byKey = new Map(l.map((e) => [String(e?.key), e]));
  const out = [];
  const used = new Set();
  for (const k of keys) {
    const e = byKey.get(String(k));
    if (e && !used.has(String(k))) { out.push(e); used.add(String(k)); }
  }
  for (const e of l) if (!used.has(String(e?.key))) out.push(e);
  return out;
}

export function tesseliere(opts) {
  const {
    footprintM = null, storeys = 1, typ = "mittelflur", einheiten = [],
    gesperrteGrenzen = [], raumzonen = false,
    // 61-07: manual arrangement. anordnung = { "L<level>-B<band>": [typKeys…] },
    // grenzenPositionen = { "<grenzId>": pos_m }. Both optional, both persisted in
    // werkstatt_layer; without them the result is byte-identical to 61-05.
    anordnung = null, grenzenPositionen = null,
    // 75-07: Architekturregeln, jede optional; nordwinkel für die Orientierung.
    regeln = null, nordwinkel = 0,
    // 75-14: per-door swing overrides { "<level>|<zoneName>|<idx>": "links"|"rechts" }
    // (persisted in werkstatt_layer, toggled in the focus view). Default none.
    tuerAufschlaege = null,
    // 75-13: finished-floor level of the top storey in m for the lift duty
    // (MBO §39 Abs. 4: OKF > 13 m). Default (storeys − 1) · 3,0 m [ASSUMED].
    okf_m = null,
  } = opts || {};
  const rg = /** @type {Regeln} */ (regeln && typeof regeln === "object" ? regeln : {});
  const bb = footprintBBox(footprintM);
  const nGeschosse = Math.max(1, Math.round(num(storeys, 1)));
  const kern = kernRegeln(rg, nGeschosse, okf_m === null ? (nGeschosse - 1) * 3 : num(okf_m));
  const liste = Array.isArray(einheiten) ? einheiten : [];
  const gesperrtSet = new Set((Array.isArray(gesperrteGrenzen) ? gesperrteGrenzen : []).map(String));
  const anordnungMap = anordnung && typeof anordnung === "object" ? anordnung : {};
  const posWunsch = grenzenPositionen && typeof grenzenPositionen === "object" ? grenzenPositionen : {};
  const hinweise = [];

  const zonen = [];
  const weListe = [];
  const grenzen = [];
  let rest_m2 = 0;           // 61-01-Semantik: Band-Lücken + nicht platzierbare Zielflächen
  let restNachfrage_m2 = 0;  // nur Überbelegungs-Nachfrage (nicht platzierbare Einheiten)

  // --- EFH: eine WE = ganzer Footprint über alle Geschosse, kein Skelett.
  if (typ === "efh") {
    const e = liste[0];
    if (liste.length > 1) {
      for (let i = 1; i < liste.length; i++) restNachfrage_m2 += Math.max(0, num(liste[i]?.flaeche_m2)) * nGeschosse;
    }
    const we = "WE 0-1";
    for (let level = 0; level < nGeschosse; level++) {
      zonen.push({
        points: [
          { x: bb.minX, z: bb.minZ }, { x: bb.maxX, z: bb.minZ },
          { x: bb.maxX, z: bb.maxZ }, { x: bb.minX, z: bb.maxZ },
        ],
        level, name: `${e?.name || "Haus"} 0-1 ·WT`, we,
      });
    }
    if (e) {
      weListe.push({
        we, typKey: e.key, level: 0, band: 0,
        fassadeLaenge_m: 2 * (bb.w + bb.d),
        flaeche_m2: bb.w * bb.d * nGeschosse,
        variante: e.variante === "gespiegelt" ? "gespiegelt" : "normal",
      });
    }
    return { zonen, weListe, grenzen, rest_m2: restNachfrage_m2, rest: restNachfrage_m2, restNachfrage_m2, hinweise };
  }

  const skelett = erschliessungsSkelett({ footprintM, storeys, typ, kern });
  zonen.push(...skelett.flure, ...skelett.kerne);
  if (kern.aktiv) {
    // Legal basis of the lift switch: office rule > 3 storeys (D-P75-13-A) vs. the
    // building codes — both named, the stricter one is the default.
    hinweise.push(`Aufzug ${kern.aufzug ? "an" : "aus"} — Pflicht nach Büro-Vorgabe ab mehr als ${AUFZUG_SCHWELLEN.geschosse} Geschossen (${nGeschosse} ${nGeschosse === 1 ? "Geschoss" : "Geschosse"}${kern.aufzugPflicht ? ": Pflicht" : ": keine Pflicht"}); Bauordnung: MBO §39 Abs. 4 ab OKF > ${AUFZUG_SCHWELLEN.okf_m} m, BayBO Art. 37 Abs. 4 ab Gebäudehöhe > ${AUFZUG_SCHWELLEN.okf_m} m (gegen gesetze-bayern.de geprüft 06.10.2026; MBO-Absatz [CITED], nicht nachgeprüft)`);
    if (kern.erweiterung_m > 0) {
      if (typ === "mfh") {
        hinweise.push(`Treppenraum-Erweiterung ${kern.erweiterung_m.toFixed(1).replace(".", ",")} m je Seite entlang des Flurs — gilt nur mit feuerbeständigen Wänden, dicht- und selbstschließenden Türen (T30-RS) und ohne Nutzung im erweiterten Teil (MBO §35 Abs. 4–6 [CITED]); der zweite Treppenraum bleibt der sauberere Weg`);
      } else {
        hinweise.push(`Treppenraum-Erweiterung ohne Flur (${typ}) nicht anwendbar — nur Mehrfamilienhaus (Mittelflur mit Kern) [ASSUMED]`);
      }
    }
    if (!skelett.kerne.length) hinweise.push(`Notwendiger Treppenraum: Typologie ${typ} hat keinen Kern — MFH oder Spänner wählen`);
  }

  const reihenfolge = { sued: 0, nord: 1, west: 0, ost: 1, gesamte: 0, westq: 0, ostq: 1, suedmitte: 2, nordmitte: 3 };
  const baender = [...skelett.baender].sort((a, b) =>
    a.level - b.level || (reihenfolge[a.seite] ?? 0) - (reihenfolge[b.seite] ?? 0));
  const bandIdxJeLevel = new Map();
  const lfdJeLevel = new Map();

  const kandidatenFuer = (tiefe, bandListe) => bandListe.map((e) => {
    const min = safeDiv(num(e?.min_m2, num(e?.flaeche_m2)), tiefe);
    const max = safeDiv(num(e?.max_m2, num(e?.flaeche_m2)), tiefe);
    let ziel = safeDiv(num(e?.flaeche_m2), tiefe);
    // 75-07 regeln.phi: WE-Rechteck breite × tiefe im goldenen Schnitt, wenn die
    // Knautschzone (min/max) das zulässt — sonst bleibt das Flächenziel.
    if (rg.phi) {
      const kand = [tiefe / PHI, tiefe * PHI].filter((v) => v >= min - 1e-9 && v <= max + 1e-9);
      if (kand.length) ziel = kand.reduce((p, q) => (Math.abs(q - ziel) < Math.abs(p - ziel) ? q : p));
    }
    return { id: e?.key, ziel, min, max };
  });

  for (const band of baender) {
    const tiefe = num(band.tiefe);
    const bandIdx = bandIdxJeLevel.get(band.level) ?? 0;
    bandIdxJeLevel.set(band.level, bandIdx + 1);
    const bandFlaeche = Math.max(0, num(band.laenge)) * tiefe;
    // 61-07: every band places the catalogue in ITS order — the user may have
    // swapped units by drag. Without an override this is the catalogue order.
    const bandKey = `L${band.level}-B${bandIdx}`;
    const liste_ = ordneEinheiten(liste, anordnungMap[bandKey]);

    if (tiefe <= 0.05 || !liste.length) {
      // Leeres/degeneriertes Band: gesamte Bandfläche bleibt unbelegt.
      rest_m2 += bandFlaeche;
      continue;
    }
    // Reihenhaus: EINE Platzierung auf Level 0 erzeugt die Zonen aller
    // Geschosse (weUeberGeschosse) — weitere Level-Bänder nicht doppeln.
    if (skelett.weUeberGeschosse && band.level > 0) continue;

    // Pass 1: frei lösen (Breiten + Zielpositionen für die Knautschzonen).
    const k1 = kandidatenFuer(tiefe, liste_);
    const lauf1 = verteileBand(band.laenge, k1);

    // Gesperrte Grenzen (D-P61-06): angrenzende Kandidaten VOR dem Zweitlauf
    // auf ihre Pass-1-Breite fixieren (min = max = Breite).
    const start = band.achse === "x" ? band.x0 : band.z0;
    const ende = band.achse === "x" ? band.x1 : band.z1;
    const grenzIds = [];
    for (let i = 1; i < lauf1.items.length; i++) {
      grenzIds.push(`L${band.level}-B${bandIdx}-G${i}`);
    }
    const fixiert = new Set();
    // 61-07: a dragged boundary is a lock at a WANTED position. The wish is
    // clamped to what both neighbours allow (min/max width = the Knautschzone),
    // so the drag can never produce an undersized or oversized unit. Widths
    // are then pinned like a plain lock; the pass-1 end of the right neighbour
    // stays where it was, so the rest of the band is untouched.
    const breiteFix = new Map(); // item index → pinned width, m
    const verschoben = new Map(); // grenzId → { wunsch, pos }
    let lauf1Cursor = start;
    const lauf1Start = lauf1.items.map((it) => { const s = lauf1Cursor; lauf1Cursor += Math.max(0, num(it.breite)); return s; });
    grenzIds.forEach((id, gi) => {
      const wunsch = posWunsch[id];
      if (!Number.isFinite(Number(wunsch))) return;
      const li = gi, ri = gi + 1;
      const leftStart = lauf1Start[li];
      const rightEnd = lauf1Start[ri] + Math.max(0, num(lauf1.items[ri].breite));
      const lo = Math.max(leftStart + k1[li].min, rightEnd - k1[ri].max);
      const hi = Math.min(leftStart + k1[li].max, rightEnd - k1[ri].min);
      if (lo > hi + 1e-9) {
        hinweise.push(`Grenze ${id}: Wunschposition nicht erfüllbar (Nachbarn lassen keinen Spielraum) — Sperre an Solver-Position.`);
        fixiert.add(li); fixiert.add(ri);
        verschoben.set(id, { wunsch: Number(wunsch), pos: null });
        return;
      }
      const pos = Math.min(hi, Math.max(lo, Number(wunsch)));
      breiteFix.set(li, pos - leftStart);
      breiteFix.set(ri, rightEnd - pos);
      verschoben.set(id, { wunsch: Number(wunsch), pos });
    });
    grenzIds.forEach((id, gi) => {
      if (!gesperrtSet.has(id)) return;
      fixiert.add(gi); fixiert.add(gi + 1);
    });
    let lauf = lauf1;
    if (fixiert.size || breiteFix.size) {
      const k2 = kandidatenFuer(tiefe, liste_).map((k, i) => {
        const b = breiteFix.has(i) ? breiteFix.get(i) : fixiert.has(i) ? lauf1.items[i].breite : null;
        return b === null ? k : { ...k, min: b, max: b, ziel: b };
      });
      lauf = verteileBand(band.laenge, k2);
    }

    // Zonen platzieren (achsparallel, lückenlos, nie überlappend).
    let cursor = start;
    let lfd = lfdJeLevel.get(band.level) ?? 0;
    const platziert = []; // { i, breite, x0, x1, zielPos }
    const zielKum = [];
    let zSum = 0;
    for (let i = 0; i < lauf.items.length; i++) {
      zSum += k1[i].ziel;
      zielKum.push(start + zSum);
    }
    for (let i = 0; i < lauf.items.length; i++) {
      const breite = Math.max(0, num(lauf.items[i].breite));
      if (breite <= 1e-6) continue;
      if (cursor + breite > ende + 1e-6) {
        // Überbelegung: diese Einheit UND alle folgenden passen nicht mehr ins
        // Band. Geometrie wird NIE überlappend (Pitfall 3).
        // M-02 (externe Review 02.09.): hier stand ein blankes `break`, das nur
        // die Zielfläche des ERSTEN abgewiesenen Eintrags zählte; alle weiteren
        // fielen still heraus. Reproduziert: 5 Einheiten à 120 m², 2 platziert →
        // restNachfrage_m2 = 120 statt 360. Die 61-05-UI zeigt diese Zahl direkt.
        for (let j = i; j < lauf.items.length; j++) {
          const offen = Math.max(0, num(liste_[j]?.flaeche_m2));
          rest_m2 += offen;
          restNachfrage_m2 += offen;
        }
        break;
      }
      lfd += 1;
      const a = cursor, b = cursor + breite;
      const weUeber = skelett.weUeberGeschosse;
      const we = weUeber ? `WE ${lfd}` : `WE ${band.level}-${lfd}`;
      const nameSuffix = weUeber ? `${lfd}` : `${band.level}-${lfd}`;
      platziert.push({ i, breite, a, b, we, nameSuffix });
      cursor = b;
    }
    // Ungenutzte Band-Länge = tote Zwischenfläche (D-P61-05) — zählt zum Rest.
    rest_m2 += Math.max(0, ende - cursor) * tiefe;
    lfdJeLevel.set(band.level, lfd);

    // Reihenhaus: dieselbe WE über alle Geschosse (Zonen je Level, gleiches we).
    const levelListe = skelett.weUeberGeschosse
      ? (band.level === 0 ? Array.from({ length: nGeschosse }, (_, l) => l) : [])
      : [band.level];

    for (const p of platziert) {
      const eintrag = liste_[p.i];
      for (const lvl of levelListe) {
        zonen.push({
          points: band.achse === "x"
            ? [{ x: p.a, z: band.z0 }, { x: p.b, z: band.z0 }, { x: p.b, z: band.z1 }, { x: p.a, z: band.z1 }]
            : [{ x: band.x0, z: p.a }, { x: band.x1, z: p.a }, { x: band.x1, z: p.b }, { x: band.x0, z: p.b }],
          level: lvl,
          name: `${eintrag?.name || "Wohnung"} ${p.nameSuffix} ·WT`,
          we: p.we,
        });
      }
      const variante = eintrag?.variante === "gespiegelt" ? "gespiegelt" : "normal";
      // 75-07: Himmelsrichtung der WE-Fassade (nur mit Regel, sonst Feld undefined —
      // Ergebnis ohne regeln bleibt byte-gleich).
      const orientierung = rg.himmelsrichtung ? orientierungFuerBand(band, nordwinkel).label : undefined;
      weListe.push({
        we: p.we, typKey: eintrag?.key, level: band.level, band: bandIdx,
        fassadeLaenge_m: p.breite, flaeche_m2: p.breite * tiefe, variante,
        ...(orientierung ? { orientierung } : {}),
        _a: p.a, _b: p.b, _eintrag: eintrag, _tiefe: tiefe, _band: band,
      });
      // 75-07 regeln.phi: WE-Rechteck außerhalb des φ-Bands (±3 %) melden — das
      // Ziel im Solver wirkt nur, wenn das Band nicht ohnehin voll gefüllt wird.
      if (rg.phi && p.breite > 0.05 && tiefe > 0.05) {
        const v = Math.max(p.breite, tiefe) / Math.min(p.breite, tiefe);
        if (Math.abs(v - PHI) > PHI * 0.03) {
          const phiBreite = tiefe >= p.breite ? tiefe / PHI : tiefe * PHI;
          hinweise.push(`${p.we}: ${(Math.round(p.breite * 100) / 100).toFixed(2).replace(".", ",")} × ${(Math.round(tiefe * 100) / 100).toFixed(2).replace(".", ",")} m (1 : ${(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")}) — φ wäre ${(Math.round(phiBreite * 100) / 100).toFixed(2).replace(".", ",")} m breit`);
        }
      }
      if (rg.himmelsrichtung && Array.isArray(eintrag?.raumprogramm) && orientierung) {
        const schlecht = [];
        for (const [, pref] of Object.entries(RAUM_PRAEFERENZ)) {
          const raeume = eintrag.raumprogramm.filter((r) => r?.fensterpflicht && pref.muster.test(String(r?.raum || "")));
          if (raeume.length && pref.schlecht.includes(orientierung)) {
            schlecht.push(`${raeume.map((r) => r.raum).join("/")} nach ${orientierung} (bevorzugt ${pref.gut.slice(0, 2).join("/")})`);
          }
        }
        if (schlecht.length) hinweise.push(`${p.we}: ${schlecht.join(" · ")} — Band tauschen oder Anordnung spiegeln`);
      }
    }

    // Knautschzonen (TESS-08): je innere Bandgrenze ±-Abweichung, Korridor,
    // sperrbar. delta = Abweichung gegenüber der Zielposition; bei gesperrten
    // Grenzen 0 gegenüber der Sperrposition (Fixierung wirkt im Zweitlauf).
    let posKum = start;
    const weJePlatz = new Map(platziert.map((p) => [p.i, p]));
    const posJeGrenze = [];
    for (let i = 0; i < lauf.items.length; i++) {
      const breite = Math.max(0, num(lauf.items[i].breite));
      if (breite <= 1e-6) continue;
      posKum += breite;
      posJeGrenze.push(posKum);
    }
    for (let gi = 1; gi < posJeGrenze.length; gi++) {
      const id = `L${band.level}-B${bandIdx}-G${gi}`;
      const pos = posJeGrenze[gi - 1];
      const zielPos = zielKum[gi - 1];
      const links = liste_[gi - 1], rechts = liste_[gi];
      const v = verschoben.get(id);
      const gesperrt = gesperrtSet.has(id) || !!v;
      grenzen.push({
        id, level: band.level, band: bandIdx,
        pos_m: pos,
        we_links: weJePlatz.get(gi - 1)?.we, we_rechts: weJePlatz.get(gi)?.we,
        delta_m: gesperrt ? 0 : pos - zielPos,
        // 61-07: dragged boundary — wish and the clamped position it landed on.
        verschoben: !!v, pos_wunsch_m: v ? v.wunsch : undefined,
        min_m: safeDiv(num(links?.min_m2, num(links?.flaeche_m2)), tiefe),
        max_m: safeDiv(num(rechts?.max_m2, num(rechts?.flaeche_m2)), tiefe),
        gesperrt,
        // Achsen-Info für die Overlay-Darstellung (61-05): die Grenze steht
        // SENKRECHT zur Lauf-Achse und spannt quer von quer0 bis quer1.
        achse: band.achse, quer0: band.achse === "x" ? band.z0 : band.x0, quer1: band.achse === "x" ? band.z1 : band.x1,
        _band: band,
        // Wird im Escher-v1-Durchgang unten gesetzt. Muss hier stehen, sonst
        // kennt tsc die Eigenschaft nicht und meldet TS2339 an jeder Zuweisung
        // (M-08 der externen Review).
        verzahnung: /** @type {?VerzahnungMeta} */ (null),
      });
    }
  }

  // --- Escher-v1: L-Verschränkung benachbarter verschraenkbarer WEs je Band ---
  // Slicing-Metadaten (nur im raumzonen-Modus): Teil-Rechtecke je WE (lauf-System).
  const lMeta = new Map();
  const zahnMeta = new Map();
  const aussparMeta = new Map();
  const weBandweise = new Map();
  for (const w of weListe) {
    const k = `${w.level}-${w.band}`;
    if (!weBandweise.has(k)) weBandweise.set(k, []);
    weBandweise.get(k).push(w);
  }
  for (const gruppe of weBandweise.values()) {
    gruppe.sort((a, b) => a._a - b._a);
    for (let i = 0; i + 1 < gruppe.length; i++) {
      const wA = gruppe[i], wB = gruppe[i + 1];
      if (!wA._eintrag?.verschraenkbar || !wB._eintrag?.verschraenkbar) continue;
      const band = grenzen.find((g) => g.level === wA.level && g.band === wA.band)?._band;
      const tiefe = wA._tiefe;
      const breiteA = wA._b - wA._a;
      const breiteB = wB._b - wB._a;
      const zKante = band ? band.zKante : 0;
      const richtung = band ? (Math.abs(zKante - band.z0) < 1e-9 ? 1 : -1) : 1;
      const s = Math.min(1.0, breiteA / 4, breiteB / 4); // Versatz [ASSUMED]
      if (s <= 0.05) continue;
      const sPaar = verschraenkePaar({
        // H-02 (externe Review 02.09.): hier stand `wA.breite`. Ein weListe-Eintrag
        // hat kein Feld `breite` — der Ausdruck war NaN, verschraenkePaar fiel über
        // num(xSplit, Mitte) still auf den Mittel-Split zurück, und der Versatz s
        // wirkte nie. Ergebnis waren Rechtecke mit zwei doppelten Eckpunkten, die
        // in der weListe trotzdem als L-vorn/L-hinten auswiesen. Die Breite steht
        // drei Zeilen höher bereits als breiteA bereit.
        x0: wA._a, x1: wB._b, xSplit: wA._a + breiteA + s,
        tiefeVorn: tiefe / 2, tiefe, zKante, richtung, flaecheA: wA.flaeche_m2,
      });
      const { zoneA, zoneB } = sPaar;
      // z-Bänder: Lauf-System (x = Laufrichtung) in Weltkoordinaten tauschen.
      if (band && band.achse === "z") {
        for (const zone of [zoneA, zoneB]) {
          zone.points = zone.points.map((p) => ({ x: p.z, z: p.x }));
        }
      }
      // Zonen in der Store-Liste ersetzen (Rechteck → L-Polygon, 6 Punkte).
      const ersetze = (zone, we) => {
        const idx = zonen.findIndex((z) => z.we === we && z.level === wA.level);
        if (idx >= 0) zonen[idx] = { ...zonen[idx], points: zone.points };
      };
      ersetze(zoneA, wA.we);
      ersetze(zoneB, wB.we);
      wA.variante = "L-vorn";
      wB.variante = "L-hinten";
      // Teil-Rechtecke (lauf-System) für das Raum-Slicing (61-04) merken.
      const lMetaKey = (we) => `${we}|${wA.level}`;
      if (raumzonen) {
        lMeta.set(lMetaKey(wA.we), { vorne: sPaar.vornA, hinten: sPaar.hintenA });
        lMeta.set(lMetaKey(wB.we), { vorne: sPaar.vornB, hinten: sPaar.hintenB });
      }
    }
  }

  // --- Escher-v1: Verzahnungsraum an der Grenze zum Folge-Nachbarn ------------
  for (const g of grenzen) {
    const wLinks = weListe.find((w) => w.we === g.we_links && w.level === g.level && w.band === g.band);
    if (!wLinks?._eintrag?.verzahnungsRaum) continue;
    const raumName = String(wLinks._eintrag.verzahnungsRaum);
    const programm = Array.isArray(wLinks._eintrag.raumprogramm) ? wLinks._eintrag.raumprogramm : [];
    const raum = programm.find((r) => r?.raum === raumName);
    if (!raum) {
      g.verzahnung = { warn: `Raum „${raumName}" nicht im Raumprogramm — kein Zahn` };
      continue;
    }
    if (g.gesperrt) {
      // Konfliktregel: Sperre gewinnt, kein Zahn (warn im Ergebnis).
      g.verzahnung = { warn: "Grenze gesperrt — Verzahnung verworfen" };
      continue;
    }
    const band = g._band;
    // Zahn-Maße [ASSUMED 3×2 m], auf Raum-Min/Max geclammt (Fläche ≥ min_m2).
    let zahnBreite = 3.0, zahnTiefe = 2.0;
    const zahnFlaeche = zahnBreite * zahnTiefe;
    const minF = num(raum.min_m2), maxF = num(raum.max_m2, minF || zahnFlaeche);
    if (minF > 0 && zahnFlaeche < minF) {
      const f = Math.sqrt(minF / zahnFlaeche);
      zahnBreite *= f; zahnTiefe *= f;
    } else if (maxF > 0 && zahnFlaeche > maxF) {
      const f = Math.sqrt(maxF / zahnFlaeche);
      zahnBreite *= f; zahnTiefe *= f;
    }
    const idxA = zonen.findIndex((z) => z.we === g.we_links && z.level === g.level);
    const idxB = zonen.findIndex((z) => z.we === g.we_rechts && z.level === g.level);
    if (idxA < 0 || idxB < 0) continue;
    const res = verzahne({
      zoneA: zonen[idxA], zoneB: zonen[idxB], grenze: g,
      raum: raumName, zahnTiefe_m: zahnTiefe, zahnBreite_m: zahnBreite,
      fassadeBeiZ: band?.zKante ?? 0,
      achse: band?.achse === "z" ? "z" : "x",
    });
    if (res.warn) {
      g.verzahnung = { warn: res.warn };
      continue;
    }
    zonen[idxA] = res.zoneA;
    zonen[idxB] = res.zoneB;
    Object.assign(g, res.grenze);
    // Slicing-Metadaten (61-04): der Verzahnungsraum belegt exakt das
    // Zahn-Rechteck; der Nachbar spart die Fläche aus (keine Überlappung).
    if (raumzonen && res.zahnRect) {
      zahnMeta.set(`${g.we_links}|${g.level}`, { rect: res.zahnRect, raum: raumName });
      aussparMeta.set(`${g.we_rechts}|${g.level}`, res.zahnRect);
    }
  }

  // --- Raum-Slicing (61-04, D-P61-07): raumzonen-Modus -------------------------
  // Statt EINER Band-Zone je WE werden echte Raum-Zonen ausgegeben (zustandslos
  // aus der aktuellen Bandbreite gesliced — jede Solver-Änderung wirkt bis in
  // die Räume). Einheiten ohne raumprogramm behalten ihre Band-Zone (Tracer-
  // Verhalten, rückwärtskompatibel).
  const raumWarns = [];
  if (raumzonen) {
    const ersatzListe = []; // { altWe, altLevel, neuZonen }
    for (const w of weListe) {
      const programm = w._eintrag?.raumprogramm;
      if (!Array.isArray(programm) || !programm.length) continue;
      const idxZone = zonen.findIndex((z) => z.we === w.we && z.level === w.level);
      if (idxZone < 0) continue;
      const band = /** @type {BandMeta} */ (w._band || {});
      const achseZ = band.achse === "z";
      const cross0 = achseZ ? band.x0 : band.z0;
      const cross1 = achseZ ? band.x1 : band.z1;
      const basis = { x0: w._a, x1: w._b, z0: cross0, z1: cross1 }; // Lauf-System
      const metaKey = `${w.we}|${w.level}`;
      const l = lMeta.get(metaKey);
      const zahn = zahnMeta.get(metaKey);
      const aussparung = aussparMeta.get(metaKey);
      const raumZonen = raumSlicing({
        rechteck: l ? l.vorne : basis,
        hinten: l ? l.hinten : null,
        zahn: zahn || null,
        aussparung: aussparung || null,
        fassadeBei: band.zKante ?? 0,
        achse: achseZ ? "z" : "x",
        level: w.level,
        we: w.we,
        variante: w.variante === "gespiegelt" ? "gespiegelt" : "normal",
        nutzung: w._eintrag?.nutzung,
        raumartSchall: w._eintrag?.raumartSchall,
        // 75-07 / MSB-6: Spänner-Quadranten haben zwei Fassaden.
        zweiFassaden: !!band.zweiFassaden,
        // 75-14: door swing overrides (only read when regeln.diele is on).
        tuerAufschlaege: tuerAufschlaege && typeof tuerAufschlaege === "object" ? tuerAufschlaege : null,
      }, programm, rg);
      if (raumZonen.warns?.length) raumWarns.push(...raumZonen.warns.map((s) => `${w.we}: ${s}`));
      ersatzListe.push({ altWe: w.we, altLevel: w.level, neuZonen: raumZonen });
    }
    // Band-Zonen durch Raum-Zonen ersetzen.
    for (const { altWe, altLevel, neuZonen } of ersatzListe) {
      const idx = zonen.findIndex((z) => z.we === altWe && z.level === altLevel);
      if (idx >= 0) {
        zonen.splice(idx, 1, ...neuZonen);
      } else {
        zonen.push(...neuZonen);
      }
    }
  }

  // --- 75-07/75-13 regeln.rettungsweg: WALKED line from the deepest point of the
  // unit to the stair door (MBO §35 Abs. 2 [CITED], 35 m). 75-13 replaced the
  // Manhattan sum to the core CENTRE by a visibility-graph path (rettungsweg.js):
  // start = the corner of a windowed room with the longest walk, via the apartment
  // door (75-14 hall door when present, else the middle of the corridor edge), to
  // the nearest stair door (middle of the core edge facing the corridor; with an
  // extension the T30-RS door at its end). Obstacles = rooms of OTHER units + core
  // + shaft of the same storey; the own unit is walked open-plan [ASSUMED, see
  // rettungsweg.js header]. Without a core (Mittelflur/Laubengang) the targets are
  // the corridor ends [ASSUMED as 75-07]. Reihenhaus/EFH: own exit → 0.
  // > max → WARN (rettungswegWarnungen, stufe "warn") with the extension needed.
  const rettungswegWarnungen = [];
  if (rg.rettungsweg) {
    const maxL = num(rg.rettungswegMax, RETTUNGSWEG_MAX);
    const zieleAlle = Array.isArray(skelett.ziele) && skelett.ziele.length ? skelett.ziele : skelettZiele(skelett);
    const kernZonen = skelett.kerne;
    const r2 = (v) => Math.round(num(v) * 100) / 100;
    const warnungen = rettungswegWarnungen;
    // Obstacles of OTHER units: ONE bounding rectangle per unit and storey instead of
    // every room polygon — the walker never enters a foreign unit, and ~4 corners per
    // unit instead of ~30 keep the visibility graph small (8 storeys: 1,4 s → see
    // 75-13 SUMMARY). Units sit inside their band, the corridor lies outside every
    // such rectangle, so the free space is unchanged [ASSUMED for L/Escher variants:
    // the bbox of an L-shaped unit only covers the notch of its neighbour].
    /** @type {Map<string, {we: string, level: number, x0: number, z0: number, x1: number, z1: number}>} */
    const einheitenRechteck = new Map();
    for (const z of zonen) {
      if (!z.we || z.raumart === "balkon" || !Array.isArray(z.points) || z.points.length < 3) continue;
      const k = `${z.level}|${z.we}`;
      const e = einheitenRechteck.get(k) || { we: z.we, level: z.level, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (const p of z.points) { e.x0 = Math.min(e.x0, num(p.x)); e.x1 = Math.max(e.x1, num(p.x)); e.z0 = Math.min(e.z0, num(p.z)); e.z1 = Math.max(e.z1, num(p.z)); }
      einheitenRechteck.set(k, e);
    }
    let ohneKernGemeldet = false;
    for (const w of weListe) {
      const band = /** @type {BandMeta} */ (w._band);
      if (!band || !Number.isFinite(w._a)) continue;
      if (skelett.weUeberGeschosse) { /** @type {any} */ (w).rettungsweg_m = 0; continue; }
      const lvl = w.level;
      const eigene = zonen.filter((z) => z.we === w.we && z.level === lvl && z.raumart !== "balkon");
      const hindernisse = [];
      for (const e of einheitenRechteck.values()) {
        if (e.level === lvl && e.we !== w.we) hindernisse.push([{ x: e.x0, z: e.z0 }, { x: e.x1, z: e.z0 }, { x: e.x1, z: e.z1 }, { x: e.x0, z: e.z1 }]);
      }
      // Core, stair enclosure and lift shaft keep their exact polygon (the extended
      // enclosure is not a rectangle).
      for (const k of kernZonen) {
        if (Math.round(num(k.level)) === lvl && Array.isArray(k.points) && k.points.length >= 3) hindernisse.push(k.points.map((p) => ({ x: num(p.x), z: num(p.z) })));
      }
      // Frame around the footprint: the walker stays INSIDE the building (no
      // shortcut around the facade) — four 1 m strips outside the bbox.
      const R = 1;
      hindernisse.push(
        [{ x: bb.minX - R, z: bb.minZ - R }, { x: bb.maxX + R, z: bb.minZ - R }, { x: bb.maxX + R, z: bb.minZ }, { x: bb.minX - R, z: bb.minZ }],
        [{ x: bb.minX - R, z: bb.maxZ }, { x: bb.maxX + R, z: bb.maxZ }, { x: bb.maxX + R, z: bb.maxZ + R }, { x: bb.minX - R, z: bb.maxZ + R }],
        [{ x: bb.minX - R, z: bb.minZ }, { x: bb.minX, z: bb.minZ }, { x: bb.minX, z: bb.maxZ }, { x: bb.minX - R, z: bb.maxZ }],
        [{ x: bb.maxX, z: bb.minZ }, { x: bb.maxX + R, z: bb.minZ }, { x: bb.maxX + R, z: bb.maxZ }, { x: bb.maxX, z: bb.maxZ }],
      );
      // Candidate corners: every corner of the unit's windowed rooms (band mode:
      // the unit polygon), each pulled 5 cm towards its zone centre so it is not ON a shared wall.
      const quellen = eigene.filter((z) => z.fensterpflicht === true);
      const kandidaten = [];
      for (const z of quellen.length ? quellen : eigene) {
        const pts = z.points.map((p) => ({ x: num(p.x), z: num(p.z) }));
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        for (const p of pts) {
          const dx = cx - p.x, dz = cz - p.z, l = Math.hypot(dx, dz) || 1;
          kandidaten.push({ x: p.x + (dx / l) * 0.05, z: p.z + (dz / l) * 0.05 });
        }
      }
      // Apartment door: the 75-14 hall door when the hall carries one, else the
      // middle of the unit's corridor edge; 5 cm into the corridor.
      const achseX = band.achse !== "z";
      const mitte = (w._a + w._b) / 2;
      const flurKante = achseX
        ? (Math.abs(num(band.zKante) - num(band.z0)) < 1e-9 ? num(band.z1) : num(band.z0))
        : (Math.abs(num(band.zKante) - num(band.x0)) < 1e-9 ? num(band.x1) : num(band.x0));
      const nachAussen = achseX
        ? (flurKante > num(band.zKante) ? { x: 0, z: 1 } : { x: 0, z: -1 })
        : (flurKante > num(band.zKante) ? { x: 1, z: 0 } : { x: -1, z: 0 });
      let tuer = achseX ? { x: mitte, z: flurKante + nachAussen.z * 0.05 } : { x: flurKante + nachAussen.x * 0.05, z: mitte };
      const diele = eigene.find((z) => Array.isArray(z.tueren) && z.tueren.some((t) => t.nach === null));
      if (diele) {
        const t = diele.tueren.find((q) => q.nach === null);
        const a = diele.points[t.wand], b = diele.points[(t.wand + 1) % diele.points.length];
        const len = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z)) || 1;
        const dx = (num(b.x) - num(a.x)) / len, dz = (num(b.z) - num(a.z)) / len;
        const m = { x: num(a.x) + dx * (num(t.u_m) + num(t.breite_m) / 2), z: num(a.z) + dz * (num(t.u_m) + num(t.breite_m) / 2) };
        // Normal pointing OUT of the hall (the side whose probe is not inside the hall polygon).
        const n1 = { x: -dz, z: dx };
        const probe = { x: m.x + n1.x * 0.05, z: m.z + n1.z * 0.05 };
        tuer = punktInPolygon(probe, diele.points) ? { x: m.x - n1.x * 0.05, z: m.z - n1.z * 0.05 } : probe;
      } else if (band.zweiFassaden || band.seite === "suedmitte" || band.seite === "nordmitte") {
        // Spänner quadrant: the door is the point of the unit rectangle nearest the core centre.
        const kz = kernZonen.filter((k) => Math.round(num(k.level)) === lvl);
        if (kz.length) {
          const kp = kz.flatMap((k) => k.points);
          const kc = { x: kp.reduce((s, p) => s + num(p.x), 0) / kp.length, z: kp.reduce((s, p) => s + num(p.z), 0) / kp.length };
          const x0 = achseX ? w._a : num(band.x0), x1 = achseX ? w._b : num(band.x1);
          const z0 = achseX ? num(band.z0) : w._a, z1 = achseX ? num(band.z1) : w._b;
          const px = clamp(kc.x, x0, x1), pz = clamp(kc.z, z0, z1);
          // Nearest edge point, pulled 5 cm INTO the unit (the core is an obstacle;
          // the stair-door target sits 5 cm outside the core on the same wall line).
          const dx = kc.x - px, dz = kc.z - pz, l = Math.hypot(dx, dz) || 1;
          tuer = { x: px - (dx / l) * 0.05, z: pz - (dz / l) * 0.05 };
        }
      }
      const ziele = zieleAlle.filter((z) => z.level === lvl).map((z) => ({ x: z.x, z: z.z }));
      if (!kernZonen.length && !ohneKernGemeldet) {
        hinweise.push(`Rettungsweg: kein Treppenraum im Skelett (${typ}) — Annahme [ASSUMED]: notwendiger Treppenraum am nächsten Flurende; für einen belastbaren Wert Typologie MFH oder Spänner (Kern) wählen`);
        ohneKernGemeldet = true;
      }
      // Door inside the stair enclosure (extension covers this unit's corridor
      // edge) → outer leg 0; the door point then moves 5 cm back INTO the unit
      // so the inner leg is still walked (the enclosure itself is an obstacle).
      const tuerImTreppenraum = kernZonen.some((k) => k.raumart === "treppenraum" && Math.round(num(k.level)) === lvl && punktInPolygon(tuer, k.points));
      if (tuerImTreppenraum) {
        tuer = achseX ? { x: tuer.x, z: flurKante - nachAussen.z * 0.05 } : { x: flurKante - nachAussen.x * 0.05, z: tuer.z };
      }
      const rw = lauflinie({ kandidaten, tuer, ziele, hindernisse, tuerImTreppenraum });
      const laenge = Math.round(rw.laenge_m * 10) / 10;
      const ww = /** @type {any} */ (w);
      ww.rettungsweg_m = laenge;
      ww.rettungsweg_innen_m = Math.round(rw.innen_m * 10) / 10;
      ww.rettungsweg_flur_m = Math.round(rw.flur_m * 10) / 10;
      ww.rettungsweg_pfad = rw.pfad.map((p) => ({ x: r2(p.x), z: r2(p.z) }));
      if (!rw.erreichbar) ww.rettungsweg_naeherung = true;
      if (laenge > maxL) {
        // Extension needed = exceedance, rounded UP to 0,5 m (plan 75-13). Conservative
        // on purpose: the real gain of an extension E is E + half the stair length
        // (the measurement moves from the stair door to the new end door), so the
        // suggestion over-shoots by at most ~1,25 m. Only MFH has a corridor to extend.
        const vorschlag = Math.ceil((laenge - maxL) * 2) / 2;
        const gesamtErw = kern.erweiterung_m + vorschlag;
        const fmt = (v) => v.toFixed(1).replace(".", ",");
        let abhilfe;
        if (typ !== "mfh") abhilfe = "Kern näher setzen oder zweiten Treppenraum vorsehen (Treppenraum-Erweiterung nur beim Mehrfamilienhaus mit Flur)";
        else if (gesamtErw > TREPPENRAUM.erweiterungMax_m + 1e-9) abhilfe = `zweiten Treppenraum vorsehen — eine Treppenraum-Erweiterung bis ${TREPPENRAUM.erweiterungMax_m} m je Seite reicht nicht`;
        else abhilfe = `Treppenraum-Erweiterung ${kern.erweiterung_m > 0 ? "um weitere" : "um"} ${fmt(vorschlag)} m je Seite${kern.aktiv ? "" : " (Schalter „Notwendiger Treppenraum“)"} oder zweiten Treppenraum vorsehen`;
        const text = `${w.we}: Rettungsweg ${fmt(laenge)} m > ${maxL} m (MBO §35 Abs. 2, Lauflänge vom tiefsten Raum bis zum notwendigen Treppenraum) — ${abhilfe}${rw.erreichbar ? "" : " [Näherung: kein Flurweg gefunden, Luftlinie]"}`;
        warnungen.push({ we: w.we, level: lvl, stufe: "warn", laenge_m: laenge, max_m: maxL, ueber_m: Math.round((laenge - maxL) * 10) / 10, vorschlag_m: vorschlag, text });
      }
    }
  }

  // --- 75-13 regeln.balkon: balcony zone in front of a room's OWN facade -------
  // Key "<typKey>|<raum>" (room name of the type's programme) → every unit of that
  // type gets the balcony at that room [ASSUMED: per type, so the type editor and
  // the focus toggle mean the same thing]. Geometry: the room's LONGEST edge on the
  // footprint bbox, BALKON.rand_m clear to both ends (never over a partition),
  // BALKON.tiefe_m outward. Distance areas: BayBO Art. 6 Abs. 6 Satz 1 Nr. 2 [CITED] —
  // exempt up to 1,5 m projection and ≤ 1/3 of the wall length → hint when the
  // balconies of one facade exceed the third. Only in raumzonen mode (rooms exist).
  const balkonMap = rg.balkon && typeof rg.balkon === "object" ? rg.balkon : null;
  if (raumzonen && balkonMap && Object.values(balkonMap).some(Boolean)) {
    const r2 = (v) => Math.round(num(v) * 100) / 100;
    const seiten = [
      { key: "minX", test: (p) => Math.abs(num(p.x) - bb.minX) < 0.011, n: { x: -1, z: 0 }, laenge: bb.d },
      { key: "maxX", test: (p) => Math.abs(num(p.x) - bb.maxX) < 0.011, n: { x: 1, z: 0 }, laenge: bb.d },
      { key: "minZ", test: (p) => Math.abs(num(p.z) - bb.minZ) < 0.011, n: { x: 0, z: -1 }, laenge: bb.w },
      { key: "maxZ", test: (p) => Math.abs(num(p.z) - bb.maxZ) < 0.011, n: { x: 0, z: 1 }, laenge: bb.w },
    ];
    const raumBasis = (name) => String(name || "").replace(/(?: \d+)? \([^)]*\) ·WT$/, "");
    const typJeWe = new Map(weListe.map((w) => [w.we, w.typKey]));
    // Facade side of the unit's band (zKante): the balcony prefers the band facade
    // over a gable wall the corner room also touches; longest edge there wins.
    const fassadenSeite = new Map(weListe.map((w) => {
      const b = /** @type {BandMeta} */ (w._band || {});
      const k = b.achse === "z"
        ? (Math.abs(num(b.zKante) - num(b.x0)) < 1e-9 ? "minX" : "maxX")
        : (Math.abs(num(b.zKante) - num(b.z0)) < 1e-9 ? "minZ" : "maxZ");
      return [w.we, k];
    }));
    const belegt = new Map(); // `${level}|${seite}` → Σ balcony widths, m
    const neue = [];
    for (const z of zonen) {
      if (!z.we || z.raumart === "balkon" || !Array.isArray(z.points) || z.points.length < 3) continue;
      const key = `${typJeWe.get(z.we)}|${raumBasis(z.name)}`;
      if (balkonMap[key] !== true) continue;
      let best = null;
      const bevorzugt = fassadenSeite.get(z.we);
      for (let i = 0; i < z.points.length; i++) {
        const p = z.points[i], q = z.points[(i + 1) % z.points.length];
        const seite = seiten.find((s) => s.test(p) && s.test(q));
        if (!seite) continue;
        const l = Math.hypot(num(q.x) - num(p.x), num(q.z) - num(p.z));
        const rang = seite.key === bevorzugt ? 1 : 0;
        if (!best || rang > best.rang || (rang === best.rang && l > best.l)) best = { p, q, l, seite, rang };
      }
      if (!best) { hinweise.push(`${z.we}: Balkon an „${raumBasis(z.name)}“ nicht möglich — Raum ohne Fassadenkante`); continue; }
      const breite = best.l - 2 * BALKON.rand_m;
      if (breite < BALKON.minBreite_m) { hinweise.push(`${z.we}: Balkon an „${raumBasis(z.name)}“ nicht möglich — Fassade ${best.l.toFixed(2).replace(".", ",")} m zu kurz (≥ ${(BALKON.minBreite_m + 2 * BALKON.rand_m).toFixed(1).replace(".", ",")} m nötig)`); continue; }
      const dx = (num(best.q.x) - num(best.p.x)) / best.l, dz = (num(best.q.z) - num(best.p.z)) / best.l;
      const a = { x: num(best.p.x) + dx * BALKON.rand_m, z: num(best.p.z) + dz * BALKON.rand_m };
      const b = { x: num(best.q.x) - dx * BALKON.rand_m, z: num(best.q.z) - dz * BALKON.rand_m };
      const n = best.seite.n;
      const pts = [a, b, { x: b.x + n.x * BALKON.tiefe_m, z: b.z + n.z * BALKON.tiefe_m }, { x: a.x + n.x * BALKON.tiefe_m, z: a.z + n.z * BALKON.tiefe_m }]
        .map((p) => ({ x: r2(p.x), z: r2(p.z) }));
      neue.push({
        points: pts, level: z.level, name: `Balkon ${raumBasis(z.name)} (${z.we}) ·WT`, we: z.we,
        raumart: "balkon", art: "balkon", fensterpflicht: false, flaeche_m2: polyArea(pts), raum: z.name, tiefe_m: BALKON.tiefe_m,
      });
      const bk = `${z.level}|${best.seite.key}`;
      belegt.set(bk, (belegt.get(bk) || 0) + breite);
      if (belegt.get(bk) > best.seite.laenge * BALKON.abstandsflaecheAnteilMax + 1e-9) {
        hinweise.push(`Geschoss ${z.level}: Balkone an einer Fassade ${belegt.get(bk).toFixed(1).replace(".", ",")} m > 1/3 der Wandlänge ${best.seite.laenge.toFixed(1).replace(".", ",")} m — Abstandsflächen-Privileg entfällt (BayBO Art. 6 Abs. 6 Satz 1 Nr. 2 [CITED]: ≤ 1,5 m vor der Wand und ≤ 1/3 der Wandbreite, ≥ 2 m zur gegenüberliegenden Grenze — Grenzabstand hier nicht geprüft)`);
      }
    }
    zonen.push(...neue);
  }

  // Interne Felder aus der weListe entfernen (keine Store-/UI-Leaks).
  for (const w of weListe) delete w._a, delete w._b, delete w._eintrag, delete w._tiefe, delete w._band;
  for (const g of grenzen) delete g._band;

  // 75-07: Mindestbreiten-/φ-Hinweise aus dem Slicing sind Konflikte, keine Warns —
  // sie gehören in `hinweise` (UI-Kasten), raumWarns bleibt für Degradationen.
  if (rg.mindestbreiten || rg.phi) {
    const idx = [];
    raumWarns.forEach((s, i) => { if (/Mindestbreite|schlauchig/.test(s)) { hinweise.push(s); idx.push(i); } });
    for (let i = idx.length - 1; i >= 0; i--) raumWarns.splice(idx[i], 1);
  }
  // 75-14: layout-rule notes (merged rooms, storage downgrade, unbuilt cases) are
  // design conflicts for the hint box, not slicing degradations.
  if (wohnungsRegeln(rg).aktiv) {
    const idx = [];
    raumWarns.forEach((s, i) => { if (/\[75-14\]/.test(s)) { hinweise.push(s); idx.push(i); } });
    for (let i = idx.length - 1; i >= 0; i--) raumWarns.splice(idx[i], 1);
  }

  const out = { zonen, weListe, grenzen, rest_m2, rest: rest_m2, restNachfrage_m2, raumWarns, hinweise };
  // 75-13: escape-route exceedances are WARN (a legal limit), not hints — own list,
  // only present while the rule is on (default output stays byte-identical).
  if (rg.rettungsweg) out.rettungswegWarnungen = rettungswegWarnungen;
  // 75-07 regeln.wandstaerken: Wandsegmente nur als Darstellung (D-P75-06).
  // 75-13: balconies are outside the envelope — no wall segments for them.
  if (rg.wandstaerken) out.waende = waendeAus(zonen.filter((z) => z.raumart !== "balkon"), bb, rg.wandstaerkenWerte || WANDSTAERKEN);
  return out;
}
