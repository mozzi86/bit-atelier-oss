// 107-10 review fixes — one frame for slope and faces (D-BK-25), plan outlines from the bevelled-wall solid, the shared mesh cache
// cleaned per derivation, the body-against-body cache, the bevel quantity in the data sheet, the visible basement state, the switch
// "Gebäudedach ins IFC". Every expected value is calculated by hand (comment next to it).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csgLaden } from "@core/lib/csg/laden.js";
import { dachBerechnen, dachVonDachelement } from "@core/lib/bauteil/dachGeometrie.js";
import { dachRahmen } from "@core/lib/bauteil/dachRahmen.js";
import { dachNeigung_grad, dachFirsthoehe_m, dachLauf_m, dachHalbspannweite_m, firsthoeheAusNeigung } from "@core/lib/bauteil/hoehen.js";
import { wandUnterDach, koerperOperation, seoPlanFlaechen, istSeoCacheSchluessel } from "@core/lib/bauteil/seo.js";
import { cacheBereinigen } from "@core/lib/csg/cache.js";
import { steckbrief } from "@core/lib/bauteil/steckbrief.js";
import { STUDIO_WERTE, FALSCH_WIE_FEHLT } from "@core/lib/abgleich/modellAbgleich.js";
import { ugStatusText } from "@designer/lib/ugStatus.js";

// 107-18: the backend is a WebAssembly library — csgLaden() instantiates it before the first boolean
const kern = await csgLaden();

const nahe = (/** @type {number} */ ist, /** @type {number} */ soll, /** @type {number} */ tol, /** @type {string} */ was) =>
  assert.ok(Math.abs(ist - soll) <= tol, `${was}: ${ist} statt ${soll} (±${tol})`);
const rechteck = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const gedreht = (/** @type {Array<{x: number, z: number}>} */ p, /** @type {number} */ a) =>
  p.map((q) => ({ x: q.x * Math.cos(a) - q.z * Math.sin(a), z: q.x * Math.sin(a) + q.z * Math.cos(a) }));
/** slopes of the plane roof faces of a drawn roof, built exactly as the studio and the IFC export do (dachVonDachelement → dachBerechnen) */
const flaechenNeigungen = (/** @type {any} */ rf) => {
  const { dach, anstieg_m } = dachVonDachelement(rf);
  const d = /** @type {any} */ (dachBerechnen(rf.points, dach, { anstieg_m }));
  return d.flaechen.filter((/** @type {any} */ f) => f.art === "dachflaeche").map((/** @type {any} */ f) => f.neigung_grad);
};
const flaeche = (/** @type {Array<{x: number, z: number}>} */ r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.z - q.x * p.z; }, 0)) / 2;

describe("107-10 Review — Neigung und Dachflächen aus demselben Rahmen (D-BK-25)", () => {
  const R = rechteck(0, 0, 10, 6);
  it("First quer, Sattel 45°: Lauf = halbe LÄNGERE Seite 5 m, Firsthöhe 5 m, Flächen 45° = Inspektor/Datenblatt 45° (vorher 30,96°)", () => {
    const rf = { points: R, form: "sattel", neigung_grad: 45, firstrichtung: "quer" };
    nahe(dachLauf_m(rf), 5, 1e-12, "Lauf");
    nahe(dachFirsthoehe_m(rf), 5, 1e-9, "Firsthöhe 5 · tan 45°");
    nahe(dachNeigung_grad(rf), 45, 1e-9, "Inspektor");
    for (const g of flaechenNeigungen(rf)) nahe(g, 45, 1e-6, "Fläche");
  });
  it("First quer, Pult 30°: Lauf = ganze längere Seite 10 m, Anstieg 10 · tan 30° = 5,7735 m, Fläche 30° (vorher 19,11°)", () => {
    const rf = { points: R, form: "pult", neigung_grad: 30, firstrichtung: "quer" };
    nahe(dachFirsthoehe_m(rf), 10 * Math.tan(Math.PI / 6), 1e-9, "Anstieg");
    for (const g of flaechenNeigungen(rf)) nahe(g, 30, 1e-6, "Fläche");
    nahe(dachNeigung_grad(rf), 30, 1e-9, "Inspektor");
  });
  it("gedrehtes Rechteck 10 × 6 um 45°: Lauf = echte Halbbreite 3 m (BBox-Halbspannweite wäre 5,657 m), Flächen = Datenblatt", () => {
    const P = gedreht(R, Math.PI / 4);
    assert.equal(/** @type {any} */ (dachRahmen(P)).quelle, "rechteck");
    nahe(dachHalbspannweite_m(P), 8 * Math.SQRT2 / 2, 1e-9, "BBox-Halbspannweite (10 + 6)/√2 / 2");
    nahe(dachLauf_m({ points: P }), 3, 1e-9, "Lauf im Rechteckrahmen");
    for (const rf of [{ points: P, form: "sattel", neigung_grad: 45 }, { points: P, neigung_grad: 30 }, { points: P, firsthoehe_m: 3 }]) {
      const soll = dachNeigung_grad(rf);
      for (const g of flaechenNeigungen(rf)) nahe(g, soll, 1e-6, `Fläche gegen Datenblatt (${JSON.stringify(rf).slice(0, 40)})`);
    }
    // stored rise 3 m over the run 3 m: 45° (the face and the data sheet agree; before the review the sheet said atan(3 / 5,657) = 27,9°)
    nahe(dachNeigung_grad({ points: P, firsthoehe_m: 3 }), 45, 1e-9, "Neigung aus Firsthöhe");
  });
  it("achsparalleles Dach ohne form/firstrichtung: Lauf unverändert = halbe kürzere BBox-Seite (alte Projekte gleich)", () => {
    nahe(dachLauf_m({ points: R }), dachHalbspannweite_m(R), 0, "Lauf");
    nahe(dachLauf_m({ points: R }), 3, 0, "3 m");
    nahe(firsthoeheAusNeigung(R, 45), 3, 1e-9, "Firsthöhe aus 45°");
    // L-shaped outline: bounding box 8 × 6 → run 3 m, as before
    nahe(dachLauf_m({ points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }, { x: 4, z: 6 }, { x: 0, z: 6 }] }), 3, 0, "L-Umriss");
  });
});

// roof over x ∈ [0; 6] (fall direction x), z ∈ [0; 10], ridge along z at x = 3; eaves 2.5 m, ridge rise 3 m → height 2.5 + min(x, 6 − x)
const dachGiebel = /** @type {any} */ (dachBerechnen(rechteck(0, 0, 6, 10), { form: "sattel", firsthoehe_m: 3 }, { traufhoehe_m: 2.5 }));
const dach45 = /** @type {any} */ (dachBerechnen(rechteck(0, 0, 6, 10), { form: "sattel", neigung_grad: 45 }, { traufhoehe_m: 2.5 }));
const giebelwand = { _idx: 1, a: { x: 0, z: 0.15 }, b: { x: 6, z: 0.15 }, thickness: 0.3, height: 6, level: 0 };
const traufwand = { _idx: 2, a: { x: 0.15, z: 1 }, b: { x: 0.15, z: 9 }, thickness: 0.3, height: 3, level: 0 };

describe("107-10 Review — Grundriss aus dem Solid der abgeschrägten Wand (seoPlanFlaechen)", () => {
  it("Giebelwand: Schnitt auf 1,0 m = ganze Wand 6 · 0,3 = 1,8 m²; auf 5,0 m nur x ∈ [2,5; 3,5] = 1,0 · 0,3 = 0,3 m²", async () => {
    const r = await wandUnterDach(giebelwand, [], [dachGiebel], { kern });
    assert.equal(r.ok, true);
    const unten = /** @type {any} */ (seoPlanFlaechen(new Map([["cw:1", r]]), 1.0).get("cw:1"));
    assert.equal(unten.quelle, "solid");
    nahe(unten.schichten.flatMap((/** @type {any} */ s) => s.ringe).reduce((/** @type {number} */ a, /** @type {any} */ x) => a + flaeche(x), 0), 1.8, 1e-4, "1,0 m");
    const oben = /** @type {any} */ (seoPlanFlaechen(new Map([["cw:1", r]]), 5.0).get("cw:1"));
    const ringe = oben.schichten.flatMap((/** @type {any} */ s) => s.ringe);
    nahe(ringe.reduce((/** @type {number} */ a, /** @type {any} */ x) => a + flaeche(x), 0), 0.3, 1e-4, "5,0 m");
    const xs = ringe.flat().map((/** @type {any} */ p) => p.x);
    nahe(Math.min(...xs), 2.5, 1e-4, "linke Kante"); nahe(Math.max(...xs), 3.5, 1e-4, "rechte Kante");
    // above the ridge (5.5 m) nothing is cut: no entry, the caller keeps today's drawing
    assert.equal(seoPlanFlaechen(new Map([["cw:1", r]]), 5.8).has("cw:1"), false);
  });
  it("Traufwand quer zur Fallrichtung (gedreht im Wandrahmen): Schnitt auf 2,6 m = x ∈ [0,1; 0,3] × z ∈ [1; 9] = 1,6 m², Weltlage", async () => {
    const r = await wandUnterDach(traufwand, [], [dach45], { kern });
    assert.equal(r.ok, true);
    const e = /** @type {any} */ (seoPlanFlaechen(new Map([["cw:2", r]]), 2.6).get("cw:2"));
    const ringe = e.schichten.flatMap((/** @type {any} */ s) => s.ringe);
    nahe(ringe.reduce((/** @type {number} */ a, /** @type {any} */ x) => a + flaeche(x), 0), 1.6, 1e-4, "Fläche 0,2 · 8");
    const pts = ringe.flat();
    nahe(Math.min(...pts.map((/** @type {any} */ p) => p.x)), 0.1, 1e-4, "x min (Dach 2,5 + x = 2,6)");
    nahe(Math.max(...pts.map((/** @type {any} */ p) => p.x)), 0.3, 1e-4, "x max");
    nahe(Math.min(...pts.map((/** @type {any} */ p) => p.z)), 1, 1e-4, "z min"); nahe(Math.max(...pts.map((/** @type {any} */ p) => p.z)), 9, 1e-4, "z max");
  });
});

describe("107-10 Review — gemeinsamer Zwischenspeicher (csg_cache_layer)", () => {
  const e = (/** @type {string} */ h) => ({ pruefsumme: h, ort: "datenbank", objekt_id: null, inhalt: "x", groesse_bytes: 1, dreiecke: 1, volumen_m3: 1, quelle: "solid", warnung: null, erzeugt: "2026-10-26T00:00:00Z" });
  const layer = { eintraege: { "w1|wand": e("h1"), "w2|seo:r1": e("h2"), "w3|seo:r2": e("h3") } };
  it("istSeoCacheSchluessel trennt die Schlüssel der Relationen von denen der Verschneidung", () => {
    assert.equal(istSeoCacheSchluessel("w2|seo:r1"), true);
    assert.equal(istSeoCacheSchluessel("w2|seo:r1+r3"), true);
    assert.equal(istSeoCacheSchluessel("w1|wand"), false);
  });
  it("107-09-Lauf (ohne seo-Schlüssel) löscht keinen seo-Eintrag mehr; der seo-Lauf räumt nur seine eigenen veralteten Einträge", () => {
    const v = cacheBereinigen(/** @type {any} */ (layer), new Map([["w1|wand", "h1"]]), (k) => !istSeoCacheSchluessel(k));
    assert.deepEqual(Object.keys(v.layer.eintraege).sort(), ["w1|wand", "w2|seo:r1", "w3|seo:r2"]);
    assert.equal(v.entfernt.length, 0);
    // relation r2 switched off: only w2|seo:r1 is valid today → w3|seo:r2 goes, the 107-09 entry stays
    const s = cacheBereinigen(/** @type {any} */ (layer), new Map([["w2|seo:r1", "h2"]]), istSeoCacheSchluessel);
    assert.deepEqual(Object.keys(s.layer.eintraege).sort(), ["w1|wand", "w2|seo:r1"]);
    assert.deepEqual(s.entfernt.map((x) => x.schluessel), ["w3|seo:r2"]);
    // without a scope everything outside `gueltig` goes (unchanged behaviour)
    assert.equal(cacheBereinigen(/** @type {any} */ (layer), new Map()).entfernt.length, 3);
  });
  it("Körper gegen Körper schreibt und liest den Zwischenspeicher (Schlüssel <guid>|seo:<id>), ein Treffer braucht keinen Kern", async () => {
    /** @type {Map<string, {h: string, geo: any}>} */
    const speicher = new Map();
    const cache = {
      lesen: async (/** @type {string} */ k, /** @type {string} */ h) => (speicher.get(k)?.h === h ? /** @type {any} */ (speicher.get(k)).geo.clone() : null),
      schreiben: async (/** @type {string} */ k, /** @type {string} */ h, /** @type {any} */ geo) => { speicher.set(k, { h, geo }); return true; },
    };
    // target 10 · 8 · 6 = 480 m³, operator 2 · 4 (z −1…3 → 3 inside) · 3 → overlap 2 · 3 · 3 = 18 m³, abzug = 462 m³
    const ziel = { profil: rechteck(0, 0, 10, 8), y0_m: 0, y1_m: 6 }, op = { profil: rechteck(2, -1, 4, 3), y0_m: 1, y1_m: 4 };
    const r1 = await koerperOperation(ziel, op, "abzug", { kern, cache, guid: "ZIEL", art: "seo:r1" });
    assert.equal(r1.ok, true);
    nahe(/** @type {number} */ (r1.menge_m3), 462, 1e-4, "abzug");
    assert.deepEqual(r1.cache && r1.cache.schluessel, "ZIEL|seo:r1");
    await new Promise((res) => setTimeout(res, 0));
    assert.equal(speicher.has("ZIEL|seo:r1"), true, "geschrieben");
    const ohneKern = { boolesch: () => { throw new Error("Kern darf bei einem Treffer nicht laufen"); } };
    const r2 = await koerperOperation(ziel, op, "abzug", { kern: ohneKern, cache, guid: "ZIEL", art: "seo:r1" });
    assert.equal(r2.ok, true);
    nahe(/** @type {number} */ (r2.menge_m3), 462, 1e-4, "aus dem Speicher");
    // the operator moves: other hash → no hit, computed again
    const r3 = await koerperOperation(ziel, { ...op, y1_m: 5 }, "abzug", { kern, cache, guid: "ZIEL", art: "seo:r1" });
    nahe(/** @type {number} */ (r3.menge_m3), 480 - 2 * 3 * 4, 1e-4, "neu: 480 − 24");
  });
});

describe("107-10 Review — Menge der abgeschrägten Wand im Steckbrief, Schalter Gebäudedach ins IFC", () => {
  it("steckbrief übernimmt `abschraegung` nur, wenn sie übergeben wird (alle anderen Datenblätter bleiben gleich)", () => {
    const w = { _idx: 1, a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, thickness: 0.3, height: 6, level: 0 };
    const a = { quelle: /** @type {"solid"} */ ("solid"), menge_m3: 7.2, warnung: null, jeSchicht: [{ name: "1", menge_m3: 7.2 }] };
    assert.deepEqual(steckbrief(w, "wand-aussen", { abschraegung: a }).abschraegung, a);
    assert.equal("abschraegung" in steckbrief(w, "wand-aussen", {}), false);
  });
  it("dachform_ifc ist ein Studiofeld mit Namen und zählt aus = fehlt (kein Konflikt auf alten Seiten)", () => {
    assert.equal(STUDIO_WERTE.dachform_ifc, "Gebäudedach im IFC");
    assert.equal(FALSCH_WIE_FEHLT.has("dachform_ifc"), true);
  });
});

describe("107-10 Review — sichtbarer Stand des Untergeschosses (Massing-Studio)", () => {
  const t = (/** @type {string} */ k) => k;
  // footprint 10 × 8 m (site m), basement 3 m deep → 80 · 3 = 240 m³
  const ug = { profil: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }], fusshoehe_m: -3 };
  it("ohne Basement nichts; ohne Geländeraster Grundfläche × Tiefe = 240 m³", () => {
    assert.equal(ugStatusText({ ug: null, gelaendeGueltig: false, ergebnis: null, fehler: null, t }), null);
    const s = /** @type {any} */ (ugStatusText({ ug, gelaendeGueltig: false, ergebnis: null, fehler: null, t }));
    assert.equal(s.aushub_m3, 240);
    assert.equal(s.quelle, "analytisch");
    assert.match(s.zeilen[0], /Aushub 240 m³ \(Grundfläche × Tiefe, kein Geländeraster\)/);
  });
  it("Ergebnis aus dem Solid mit erdberührten Wänden; Abweichung → sichtbare Warnung und Rastermenge", () => {
    const ok = /** @type {any} */ (ugStatusText({ ug, gelaendeGueltig: true, fehler: null, t, ergebnis: {
      aushub: { menge_m3: 240, quelle: "solid", warnung: null }, erdberuehrt: [{ menge_m3: 7.2, warnung: null }, { menge_m3: 5.76, warnung: null }] } }));
    assert.match(ok.zeilen[0], /Aushub 240 m³ \(aus dem 3D-Körper\)/);
    assert.match(ok.zeilen[1], /Erdberührte UG-Wände: 12,96 m³ \(2 Wände\)/);
    assert.deepEqual(ok.warnungen, []);
    const ab = /** @type {any} */ (ugStatusText({ ug, gelaendeGueltig: true, fehler: null, t, ergebnis: {
      aushub: { menge_m3: 276, quelle: "raster", warnung: { code: "csg-abweichung", abweichung_rel: 0.035 } }, erdberuehrt: [] } }));
    assert.match(ab.zeilen[0], /Aushub 276 m³ \(aus dem Geländeraster\)/);
    assert.match(ab.warnungen[0], /weicht um 3,5 % vom Geländeraster ab/);
  });
  it("Ladefehler des CSG-Kerns: „Geländeabzug nicht verfügbar“ und Menge aus dem Raster (ebenes Gelände h = 0: 240 m³)", () => {
    const g = { nx: 21, ny: 21, zelle: 1, x0: -5, y0: -5, h: new Array(21 * 21).fill(0) };
    const s = /** @type {any} */ (ugStatusText({ ug, gelaende: g, gelaendeGueltig: true, ergebnis: null, fehler: "chunk failed", t }));
    assert.equal(s.quelle, "raster");
    nahe(s.aushub_m3, 240, 1e-9, "stempeln");
    assert.match(s.warnungen[0], /Geländeabzug nicht verfügbar: chunk failed/);
  });
});
