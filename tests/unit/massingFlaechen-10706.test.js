// 107-06 — push/pull on every face, base variant, part rectangle → opening (auto-cut as a data rule), refusal of a partial cut
// into a volume, IFC with voids, old export byte-identical, drag projection along the face normal.
// Every expected value is a hand calculation in the comment next to it (site metres, y down, outer ring positive area).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  leererLayer, geometrie, flaechen, pushPull, gruppeBilden, eindeutigMachen, skalieren, eckeVerschieben,
  flaecheWaehlen, seiteVerschieben, teilflaecheDruecken, oeffnungenPruefen, FLAECHE_TEXT, DURCHBRUCH_TOL_M, profilGueltig,
  oeffnungWenden, FLAECHE_TREFFER_TOL_M,
} from "@core/lib/massing/massingModell.js";
import { exportIFC, WARNART_MASSING } from "@designer/lib/ifcExport";
import { zugEntlangNormale, kameraBasis } from "@designer/lib/isoKamera";
import { ifcKoerperOeffnungSzenario } from "./fixtures/ifcKoerperOeffnungModell-10706.js";
import { ifcLoecherSzenario } from "./fixtures/ifcLoecherModell-10705.js";

/** Rectangle 6 × 4 at (10, 10), 3 m high. Normalised edges: 0 north (y=10), 1 east (x=16), 2 south (y=14), 3 west (x=10). */
const box = () => ({ ...leererLayer(), naechsteId: 2, koerper: [{ id: "k1", name: "", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null }] });
/** Wall 5 × 0.30 at (0, 0), 3 m high: edge 2 = south face (y = 0.3, normal (0, 1)), opposite = edge 0. */
const wand = () => ({ ...leererLayer(), naechsteId: 2, koerper: [{ id: "w", name: "", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] });
const pr = (/** @type {any} */ l, id = "k1") => geometrie(l, l.koerper.find((/** @type {any} */ k) => k.id === id)).profil;
const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

describe("107-06 Task 1 — flaecheWaehlen: Treffer + Normale → Fläche aus flaechen()", () => {
  it("Oberseite, Unterseite und Seite werden unterschieden; die Seite trägt Kante, u und v", () => {
    const l = box(), k = l.koerper[0];
    assert.deepEqual(flaecheWaehlen(l, k, { x: 13, y: 12, z: 3 }, { x: 0, y: 0, z: 1 }), { koerperId: "k1", art: "oben", z: 3 });
    assert.deepEqual(flaecheWaehlen(l, k, { x: 13, y: 12, z: 0 }, { x: 0, y: 0, z: -1 }), { koerperId: "k1", art: "unten", z: 0 });
    // west face x = 10: edge 3 from (10,14) to (10,10); the hit (10, 12, 1.5) lies u = 2 m from (10,14), v = 1.5 m up
    const w = /** @type {any} */ (flaecheWaehlen(l, k, { x: 10, y: 12, z: 1.5 }, { x: -1, y: 0, z: 0 }));
    assert.equal(w.art, "seite");
    assert.equal(w.ring, "aussen");
    assert.equal(w.kante, 3);
    assert.deepEqual([w.normale.x, Math.abs(w.normale.y)], [-1, 0]);
    assert.equal(w.u, 2);
    assert.equal(w.v, 1.5);
    // a slightly noisy normal of the 3D mesh still finds the south face (edge 2)
    assert.equal(/** @type {any} */ (flaecheWaehlen(l, k, { x: 13, y: 14, z: 1 }, { x: 0.05, y: 0.99, z: 0.02 })).kante, 2);
  });
  it("die Kante ist der Index von flaechen() (eine Flächenquelle, kein zweites Modell)", () => {
    const l = box(), k = l.koerper[0];
    const w = /** @type {any} */ (flaecheWaehlen(l, k, { x: 16, y: 12, z: 1 }, { x: 1, y: 0, z: 0 }));
    const f = /** @type {any} */ (flaechen(l, k).find((x) => x.art === "seite" && x.kante === w.kante));
    assert.deepEqual([f.a, f.b, f.normale], [w.a, w.b, w.normale]);
  });
});

describe("107-06 Task 2 — seiteVerschieben: Einzelkörper, Gruppeninstanz, gedrehte Instanz, gespeicherte Reihenfolge", () => {
  it("Einzelkörper: Westseite um 1 m nach außen → x von 9 bis 16, Nachbarkanten rechtwinklig mitgezogen", () => {
    const l = seiteVerschieben(box(), "k1", 3, 1);
    // corners re-intersected with the perpendicular neighbours: (−1,0) and (−1,4) in the body frame, + pos (10,10)
    assert.deepEqual(pr(l), [{ x: 9, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 14 }, { x: 9, y: 14 }]);
    assert.deepEqual(l.koerper[0].profil, [{ x: -1, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: -1, y: 4 }]);
  });
  it("nach innen (d < 0) und die Gültigkeitsregel von 107-05: über die Gegenseite hinaus wird abgelehnt", () => {
    assert.deepEqual(pr(seiteVerschieben(box(), "k1", 1, -2)), [{ x: 10, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 14 }, { x: 10, y: 14 }]);
    /** @type {any} */
    let grund = null;
    const l0 = box();
    const l = seiteVerschieben(l0, "k1", 1, -7, { abgelehnt: (p) => { grund = p.grund; } });
    assert.equal(l, l0, "Layer unverändert");
    assert.equal(grund, "umgeklappt", "über die Gegenseite hinaus: umgeklappt");
  });
  it("gespeichert andersherum (negativ): die Kante des normalisierten Rings wandert, die gespeicherte Reihenfolge bleibt", () => {
    const l0 = { ...box(), koerper: [{ ...box().koerper[0], profil: [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 0 }] }] };
    const l = seiteVerschieben(l0, "k1", 1, 1); // normalised edge 1 = east (x = 6) → x = 7
    assert.deepEqual(l.koerper[0].profil, [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 0 }]);
  });
  it("Gruppeninstanz gedreht (90°): die Definition ändert sich, die Fläche wandert entlang ihrer Welt-Normalen", () => {
    let l = { ...leererLayer(), naechsteId: 3, koerper: [
      { id: "a", name: "", profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null },
      { id: "b", name: "", profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], hoehe: 3, basis: 0, pos: { x: 20, y: 0 }, drehung: 90, gruppe: null },
    ] };
    l = gruppeBilden(l, ["a", "b"], "1").layer;
    const kb = l.koerper.find((k) => k.id === "b");
    // b: local edge 1 (4,0)→(4,2), local normal (1,0); rotated 90° (x' = −y, y' = x): world normal (0, 1), start (20, 4)
    const f = /** @type {any} */ (flaechen(l, /** @type {any} */ (kb)).find((x) => x.art === "seite" && x.kante === 1));
    assert.deepEqual(f.normale, { x: 0, y: 1 });
    assert.deepEqual(f.a, { x: 20, y: 4 });
    const l2 = seiteVerschieben(l, "b", 1, 0.5);
    assert.deepEqual(l2.gruppen["1"].profil, [{ x: 0, y: 0 }, { x: 4.5, y: 0 }, { x: 4.5, y: 2 }, { x: 0, y: 2 }]);
    const f2 = /** @type {any} */ (flaechen(l2, /** @type {any} */ (l2.koerper.find((k) => k.id === "b"))).find((x) => x.art === "seite" && x.kante === 1));
    assert.deepEqual(f2.a, { x: 20, y: 4.5 }, "um 0,5 m entlang (0, 1)");
    assert.deepEqual(pr(l2, "a")[1], { x: 4.5, y: 0 }, "die andere Instanz folgt");
  });
  it("schiefe Nachbarkante: Ecke neu geschnitten (Nachbar behält seine Richtung), Hinweis „schief“", () => {
    // trapezoid (0,0) (6,0) (5,4) (0,4): south edge 2 from (5,4) to (0,4), normal (0,1); its start corner lies on the skew
    // edge (6,0)→(5,4) with direction (−1,4)/√17: s = d / sin = 1 / (4/√17) → corner (5 − 0.25, 5) = (4.75, 5)
    const l0 = { ...leererLayer(), naechsteId: 2, koerper: [{ id: "t", name: "", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] };
    /** @type {any} */
    let h = null;
    const l = seiteVerschieben(l0, "t", 2, 1, { hinweis: (x) => { h = x; } });
    assert.deepEqual(l.koerper[0].profil, [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 4.75, y: 5 }, { x: 0, y: 5 }]);
    assert.equal(h?.grund, "schief");
    assert.equal(h?.text, FLAECHE_TEXT.schief);
  });
  it("zu flache Nachbarkante (|sin| < 0,25) wird abgelehnt", () => {
    // edge 0 (0,0)→(10,0), normal (0,−1); the next edge (10,0)→(20,1) has sin = 1/√101 ≈ 0.0995 < 0.25
    const l0 = { ...leererLayer(), naechsteId: 2, koerper: [{ id: "f", name: "", profil: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 1 }, { x: 20, y: 5 }, { x: 0, y: 5 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] };
    /** @type {any} */
    let grund = null;
    assert.equal(seiteVerschieben(l0, "f", 0, 1, { abgelehnt: (p) => { grund = p.grund; } }), l0);
    assert.equal(grund, "flach");
  });
  it("parallele Nachbarkante (geteilte Kante): neue Ecke als Stufe", () => {
    // (0,0) (3,0) (6,0) (6,4) (0,4): edge 0 north half. By 1 outwards (normal (0,−1)): start corner on the west edge → (0,−1);
    // the next edge (3,0)→(6,0) is parallel → a step (3,−1)→(3,0)
    const l0 = { ...leererLayer(), naechsteId: 2, koerper: [{ id: "s", name: "", profil: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] };
    const l = seiteVerschieben(l0, "s", 0, 1);
    assert.deepEqual(l.koerper[0].profil, [{ x: 0, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
    assert.equal(profilGueltig(l.koerper[0].profil).ok, true);
  });
  it("Hofseite (Innenring) lässt sich verschieben: der Hof wird größer", () => {
    const l0 = { ...leererLayer(), naechsteId: 2, koerper: [{ id: "h", name: "", profil: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], loecher: [[{ x: 3, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 7 }, { x: 3, y: 7 }]], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] };
    const k = l0.koerper[0];
    // pick the courtyard face at x = 9 (normal points into the courtyard: (−1, 0))
    const w = /** @type {any} */ (flaecheWaehlen(l0, k, { x: 9, y: 5, z: 1 }, { x: -1, y: 0, z: 0 }));
    assert.equal(w.ring, 0);
    const l = seiteVerschieben(l0, "h", w.kante, 1, { ring: 0 }); // outwards = into the courtyard: x 9 → 8
    const g = geometrie(l, l.koerper[0]);
    assert.ok(g.loecher?.[0].some((p) => p.x === 8) && !g.loecher?.[0].some((p) => p.x === 9));
  });
});

describe("107-06 Task 2 — pushPull Basis-Variante (Unterseite)", () => {
  it("Unterseite 1 m nach unten: basis −1, hoehe 4, die Oberkante bleibt bei 3", () => {
    const l = pushPull(box(), "k1", 1, { flaeche: "unten" });
    assert.equal(l.koerper[0].basis, -1);
    assert.equal(l.koerper[0].hoehe, 4);
    const g = geometrie(l, l.koerper[0]);
    nah(g.basis + g.hoehe, 3);
  });
  it("Klemme 1 cm: −5 m auf 3 m Höhe → Höhe 0,01, basis 2,99 (Oberkante bleibt)", () => {
    const l = pushPull(box(), "k1", -5, { flaeche: "unten" });
    assert.equal(l.koerper[0].hoehe, 0.01);
    assert.equal(l.koerper[0].basis, 2.99);
  });
  it("Gruppe: Definition +1 m, ALLE Instanzen 1 m tiefer (die Fläche der Definition wandert)", () => {
    let l = { ...leererLayer(), naechsteId: 3, koerper: [
      { id: "a", name: "", profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null },
      { id: "b", name: "", profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], hoehe: 3, basis: 5, pos: { x: 9, y: 0 }, drehung: 0, gruppe: null },
    ] };
    l = gruppeBilden(l, ["a", "b"], "1").layer;
    const l2 = pushPull(l, "b", 1, { flaeche: "unten" });
    assert.equal(l2.gruppen["1"].hoehe, 4);
    assert.deepEqual(l2.koerper.map((k) => k.basis), [-1, 4]);
  });
  it("Oberseite unverändert wie bisher (ohne Option)", () => {
    const l = pushPull(box(), "k1", 2);
    assert.equal(l.koerper[0].hoehe, 5);
    assert.equal(l.koerper[0].basis, 0);
  });
});

describe("107-06 Task 4 — Auto-Cut als Datenregel (teilflaecheDruecken)", () => {
  const TEIL = { kante: 2, u: 2.5, width: 1.2, height: 1.5, sill: 0.8 };
  it("Teilrechteck bis zur Gegenfläche gedrückt → Eintrag oeffnungen, die Geometrie bleibt", () => {
    const l0 = wand();
    const r = teilflaecheDruecken(l0, "w", TEIL, -0.3);
    assert.equal(r.art, "oeffnung");
    assert.deepEqual(r.layer.koerper[0].oeffnungen, [{ kante: 2, u: 2.5, width: 1.2, height: 1.5, sill: 0.8 }]);
    assert.deepEqual(r.layer.koerper[0].profil, l0.koerper[0].profil, "kein Geometriebruch");
    assert.equal(r.layer.koerper[0].hoehe, 3);
  });
  it("Restdicke ≤ Toleranz zählt als durch (0,30 − 0,295 = 5 mm), Überstand auch; 1 cm mehr Rest nicht", () => {
    assert.equal(teilflaecheDruecken(wand(), "w", TEIL, -0.295).art, "oeffnung");
    assert.equal(teilflaecheDruecken(wand(), "w", TEIL, -0.5).art, "oeffnung");
    assert.equal(DURCHBRUCH_TOL_M, 0.01);
    /** @type {any} */
    let grund = null;
    assert.equal(teilflaecheDruecken(wand(), "w", TEIL, -0.28, { abgelehnt: (p) => { grund = p.grund; } }).art, null);
    assert.equal(grund, "csg");
  });
  it("Teil-Durchbruch im Volumen wird abgelehnt mit der Meldung des Plans (CSG-Kern 107-14)", () => {
    /** @type {any} */
    let p = null;
    const l0 = box();
    const r = teilflaecheDruecken(l0, "k1", { kante: 2, u: 3, width: 1.2, height: 1.5, sill: 0.8 }, -1, { abgelehnt: (x) => { p = x; } });
    assert.equal(r.art, null);
    assert.equal(r.layer, l0);
    assert.equal(p.grund, "csg");
    assert.match(p.text, /Teil-Durchbruch im Volumen .*CSG-Kern \(107-14, Relation „abzug“ in 107-10\)/);
  });
  it("nicht wandartig (Gegenfläche nicht parallel) → abgelehnt", () => {
    // trapezoid (0,0) (6,0) (6,1) (0,2): face (6,1)→(0,2) is skew to the opposite edge y = 0
    const l0 = { ...leererLayer(), naechsteId: 2, koerper: [{ id: "t", name: "", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 0, y: 2 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] };
    /** @type {any} */
    let grund = null;
    teilflaecheDruecken(l0, "t", { kante: 2, u: 3, width: 1, height: 1, sill: 1 }, -3, { abgelehnt: (p) => { grund = p.grund; } });
    assert.equal(grund, "nichtWandartig");
  });
  it("über die ganze Höhe: als Stufe im Profil (Nische) — durch bis zur Gegenseite würde den Körper teilen", () => {
    // full height, width 1 around u = 2.5 on the south face of the wall: a 0.1 m niche
    const r = teilflaecheDruecken(wand(), "w", { kante: 2, u: 2.5, width: 1, height: 3, sill: 0 }, -0.1);
    assert.equal(r.art, "profil");
    // edge 2 runs (5,0.3)→(0,0.3); cuts at u 2 and 3 → x 3 and 2; middle part moved 0.1 inwards (y 0.2)
    assert.deepEqual(r.layer.koerper[0].profil, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 3, y: 0.3 }, { x: 3, y: 0.2 }, { x: 2, y: 0.2 }, { x: 2, y: 0.3 }, { x: 0, y: 0.3 }]);
    /** @type {any} */
    let grund = null;
    teilflaecheDruecken(wand(), "w", { kante: 2, u: 2.5, width: 1, height: 3, sill: 0 }, -0.3, { abgelehnt: (p) => { grund = p.grund; } });
    assert.equal(grund, "teilt");
  });
  it("die ganze Fläche = Seiten-Push/Pull; nach außen über Teilhöhe = eigener Körper davor", () => {
    assert.equal(teilflaecheDruecken(wand(), "w", { kante: 2, u: 2.5, width: 5, height: 3, sill: 0 }, 0.2).art, "seite");
    const r = teilflaecheDruecken(wand(), "w", TEIL, 0.5);
    assert.equal(r.art, "anbau");
    const neu = /** @type {any} */ (r.layer.koerper.find((k) => k.id === r.id));
    assert.equal(neu.basis, 0.8);
    assert.equal(neu.hoehe, 1.5);
    // in front of the south face: x 1.9…3.1, y 0.3…0.8
    const g = geometrie(r.layer, neu);
    assert.deepEqual([Math.min(...g.profil.map((p) => p.x)), Math.max(...g.profil.map((p) => p.x)), Math.min(...g.profil.map((p) => p.y)), Math.max(...g.profil.map((p) => p.y))], [1.9, 3.1, 0.3, 0.8]);
  });
  it("Öffnung an der Gruppendefinition: alle Instanzen haben sie; gruppeBilden/eindeutigMachen nehmen sie mit", () => {
    let l = teilflaecheDruecken(wand(), "w", TEIL, -0.3).layer;
    l = { ...l, koerper: [...l.koerper, { ...l.koerper[0], id: "w2", pos: { x: 0, y: 5 } }] };
    l = gruppeBilden(l, ["w", "w2"], "1").layer;
    assert.equal(l.koerper[0].oeffnungen, undefined);
    assert.equal(l.gruppen["1"].oeffnungen?.length, 1);
    assert.equal(geometrie(l, l.koerper[1]).oeffnungen?.length, 1);
    const e = eindeutigMachen(l, "w2");
    assert.notEqual(e.layer.gruppen[/** @type {string} */ (e.nr)].oeffnungen, l.gruppen["1"].oeffnungen, "tiefe Kopie");
    assert.deepEqual(e.layer.gruppen[/** @type {string} */ (e.nr)].oeffnungen, l.gruppen["1"].oeffnungen);
  });
  it("oeffnungenPruefen: passt → Durchgang mit Tiefe und Austritt; nach einer Verkürzung passt sie nicht mehr (gemeldet, nicht gelöscht)", () => {
    const l = teilflaecheDruecken(wand(), "w", TEIL, -0.3).layer;
    const [p] = /** @type {any[]} */ (oeffnungenPruefen(l, l.koerper[0]));
    assert.equal(p.ok, true);
    assert.equal(p.durchgang.tiefe, 0.3);
    assert.equal(p.durchgang.wandartig, true);
    assert.equal(p.durchgang.austritt.kante, 0);
    nah(p.mitte, 2.5);
    // corner (5,0.3) dragged to (1,0.3) and (5,0) to (1,0): the wall is 1 m long, the 1.2 m opening no longer fits
    let k = eckeVerschieben(l, "w", 1, { x: 1, y: 0 });
    k = eckeVerschieben(k, "w", 2, { x: 1, y: 0.3 });
    const [q] = oeffnungenPruefen(k, k.koerper[0]);
    assert.equal(q.ok, false);
    assert.equal(q.grund, "passtNicht");
    assert.equal(k.koerper[0].oeffnungen?.length, 1);
  });
  it("Öffnungen folgen ihrer Kante: Seitenverschiebung der Gegenseite und Skalieren halten sie am Ort", () => {
    const l = teilflaecheDruecken(wand(), "w", TEIL, -0.3).layer;
    const l2 = seiteVerschieben(l, "w", 0, 0.1); // north face 0.1 out: wall 0.4 thick, the opening goes through the new depth
    const [p] = /** @type {any[]} */ (oeffnungenPruefen(l2, l2.koerper[0]));
    assert.equal(p.ok, true);
    nah(p.durchgang.tiefe, 0.4);
    const l3 = skalieren(l, ["w"], { x: 0, y: 0 }, 2); // wall 10 m: the middle moves with the edge (u 2.5 → 5)
    assert.equal(l3.koerper[0].oeffnungen?.[0].u, 5);
    assert.equal(l3.koerper[0].oeffnungen?.[0].width, 1.2);
  });
  it("Unterseite gezogen: die Öffnung bleibt im Raum (sill wächst mit)", () => {
    const l = teilflaecheDruecken(wand(), "w", TEIL, -0.3).layer;
    const l2 = pushPull(l, "w", 0.5, { flaeche: "unten" });
    assert.equal(l2.koerper[0].oeffnungen?.[0].sill, 1.3);
  });
});

describe("107-06 Task 4 — IFC: IfcOpeningElement + IfcRelVoidsElement am Proxy; ohne Öffnungen byte-gleich", () => {
  const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  it("eigener Golden (ifc-golden-107-koerperoeffnung.ifc) Zeichen für Zeichen; die zu große Öffnung wird gemeldet", () => {
    const { model, opts } = ifcKoerperOeffnungSzenario();
    /** @type {any[]} */
    const meldungen = [];
    const ifc = exportIFC(model, { ...opts, onWarn: (m, art, daten) => meldungen.push({ m, art, daten }) });
    const pfad = fileURLToPath(new URL("./fixtures/ifc-golden-107-koerperoeffnung.ifc", import.meta.url));
    if (!existsSync(pfad) && process.env.GOLDEN_SCHREIBEN === "1") writeFileSync(pfad, ifc);
    assert.equal(ifc, lies("ifc-golden-107-koerperoeffnung.ifc"));
    assert.deepEqual(meldungen.map((x) => [x.art, x.daten?.id, x.daten?.grund, x.daten?.oeffnung]), [[WARNART_MASSING, "k1", "passtNicht", 1]]);
    assert.match(meldungen[0].m, /Öffnung 2 in Massing-Körper Wand: Öffnung passt nicht in die Fläche — nicht exportiert/);
  });
  it("Inhalt des Golden: drei Öffnungen (Wand, zwei Gruppeninstanzen), jede mit Voids am richtigen Proxy", () => {
    const ifc = lies("ifc-golden-107-koerperoeffnung.ifc");
    const zeilen = ifc.split("\n");
    const id = (/** @type {string} */ l) => /^(#\d+)=/.exec(l)?.[1];
    const proxy = Object.fromEntries(zeilen.filter((l) => l.includes("IFCBUILDINGELEMENTPROXY(")).map((l) => [/'(k\d)',\.ELEMENT\./.exec(l)?.[1], id(l)]));
    const oeffnungen = zeilen.filter((l) => l.includes("IFCOPENINGELEMENT("));
    assert.equal(oeffnungen.length, 3);
    const voids = zeilen.filter((l) => l.includes("IFCRELVOIDSELEMENT(")).map((l) => /,(#\d+),(#\d+)\);$/.exec(l)?.slice(1));
    assert.deepEqual(voids.map((v) => v?.[0]), [proxy.k1, proxy.k2, proxy.k3]);
    assert.deepEqual(voids.map((v) => v?.[1]), oeffnungen.map(id));
    // k1: the void box is 1.2 wide, 0.3 + 0.04 deep, 1.5 high (IfcRectangleProfileDef XDim, YDim; extrusion depth)
    assert.ok(/IFCRECTANGLEPROFILEDEF\(\.AREA\.,\$,#\d+,1\.2000,0\.3400\)/.test(ifc));
    // k1: middle of the void on the south face at u 2.5, half the depth inwards: site (12.5, 10.15) − bezug (20, 20), sill 0.8
    assert.ok(ifc.includes("IFCCARTESIANPOINT((-7.5000,-9.8500,0.8000))"));
  });
  it("ohne `oeffnungen` ist der Export des Szenarios ohne das Feld identisch mit dem Export vor 107-06 (kein Zusatz, keine Verschiebung)", () => {
    const { model, opts } = ifcKoerperOeffnungSzenario();
    const ohne = JSON.parse(JSON.stringify(opts.massing));
    for (const k of ohne.koerper) delete k.oeffnungen;
    delete ohne.gruppen["1"].oeffnungen;
    const ifc = exportIFC(model, { ...opts, massing: ohne });
    assert.equal(ifc.includes("IFCOPENINGELEMENT"), false);
    assert.equal(ifc.includes("IFCRELVOIDSELEMENT"), false);
    // and the golden of 107-05 (bodies without openings) is still byte-identical
    const s = ifcLoecherSzenario();
    assert.equal(exportIFC(s.model, s.opts), lies("ifc-golden-107-loecher.ifc"));
  });
});

describe("107-06 Task 3 — Drag-Betrag entlang der Flächennormalen (isoKamera.zugEntlangNormale)", () => {
  const kam = { yaw: 45, pitch: 30, pxJeM: 10 };
  it("Oberseite: wie bisher −dy / (pxJeM · cos pitch)", () => {
    nah(zugEntlangNormale(0, -50, { x: 0, y: 1, z: 0 }, kam), 50 / (10 * Math.cos(Math.PI / 6)), 1e-9);
    nah(zugEntlangNormale(37, -50, { x: 0, y: 1, z: 0 }, kam), 50 / (10 * Math.cos(Math.PI / 6)), 1e-9);
  });
  it("Seite: ein Zug genau entlang der Bildschirmprojektion der Normalen um d m ergibt d; quer dazu 0", () => {
    const n = { x: -1, y: 0, z: 0 }; // west face, scene axes
    const b = kameraBasis({ yaw: 45, pitch: 30 });
    const sx = (n.x * b.rechts.x + n.z * b.rechts.z) * 10, sy = -(n.x * b.hoch.x + n.z * b.hoch.z) * 10;
    nah(zugEntlangNormale(sx * 2, sy * 2, n, kam), 2, 1e-9);
    nah(zugEntlangNormale(-sy, sx, n, kam), 0, 1e-9);
  });
});

describe("107-06 Review — Laibungstreffer, Überlappung, gespeicherte Kantenreihenfolge, keine stille Verschiebung", () => {
  const TEIL = { kante: 2, u: 2.5, width: 1.2, height: 1.5, sill: 0.8 };
  /** Wall 5 × 0.30 with one opening: edge 2 runs (5,0.3)→(0,0.3), u 2.5 → hole x 1.9…3.1, z 0.8…2.3. */
  const mitOeffnung = () => teilflaecheDruecken(wand(), "w", TEIL, -0.3).layer;
  const fang = () => { /** @type {any[]} */ const l = []; return { l, cb: (/** @type {any} */ p) => { l.push(p.grund); } }; };

  it("ein Treffer auf Laibung, Brüstung oder Sturz liegt auf keiner Körperfläche → null (nicht Stirnseite, nicht Oberseite)", () => {
    const l = mitOeffnung(), k = l.koerper[0];
    assert.equal(FLAECHE_TREFFER_TOL_M, 0.01);
    // reveal at x = 3.1 (material east of it, normal −x): the west end face x = 0 is 3.1 m away
    assert.equal(flaecheWaehlen(l, k, { x: 3.1, y: 0.15, z: 1.5 }, { x: -1, y: 0, z: 0 }), null);
    // reveal at x = 1.9 (normal +x): the east end face x = 5 is 3.1 m away
    assert.equal(flaecheWaehlen(l, k, { x: 1.9, y: 0.15, z: 1.5 }, { x: 1, y: 0, z: 0 }), null);
    // sill z = 0.8 (normal up) is not the top z = 3; lintel z = 2.3 (normal down) is not the bottom z = 0
    assert.equal(flaecheWaehlen(l, k, { x: 2.5, y: 0.15, z: 0.8 }, { x: 0, y: 0, z: 1 }), null);
    assert.equal(flaecheWaehlen(l, k, { x: 2.5, y: 0.15, z: 2.3 }, { x: 0, y: 0, z: -1 }), null);
    // the real faces still pick: end face x = 5 and the top
    assert.equal(/** @type {any} */ (flaecheWaehlen(l, k, { x: 5, y: 0.15, z: 1.5 }, { x: 1, y: 0, z: 0 })).kante, 1);
    assert.equal(/** @type {any} */ (flaecheWaehlen(l, k, { x: 2.5, y: 0.15, z: 3 }, { x: 0, y: 0, z: 1 })).art, "oben");
  });

  it("überlappende Öffnung (gleiche Seite oder von der Rückseite durch dasselbe Loch) wird abgelehnt; daneben geht", () => {
    const l = mitOeffnung();
    const f = fang();
    // u 2.8: hole 2.2…3.4 overlaps 1.9…3.1 on edge 2
    const r1 = teilflaecheDruecken(l, "w", { ...TEIL, u: 2.8 }, -0.3, { abgelehnt: f.cb });
    assert.equal(r1.art, null);
    assert.equal(r1.layer, l);
    // from the back (edge 0 runs (0,0)→(5,0)): u 2.5 → x 1.9…3.1, exits through the existing hole on edge 2
    const r2 = teilflaecheDruecken(l, "w", { ...TEIL, kante: 0 }, -0.3, { abgelehnt: f.cb });
    assert.equal(r2.art, null);
    assert.deepEqual(f.l, ["ueberlappt", "ueberlappt"]);
    assert.equal(FLAECHE_TEXT.ueberlappt, "Öffnung überschneidet eine vorhandene Öffnung");
    // u 4.2: hole 3.6…4.8 is free (edge clearance 5 cm to the end at 5) → a second opening
    const r3 = teilflaecheDruecken(l, "w", { ...TEIL, u: 4.2 }, -0.3);
    assert.equal(r3.art, "oeffnung");
    assert.equal(r3.layer.koerper[0].oeffnungen?.length, 2);
  });

  it("oeffnungenPruefen meldet eine überlappende Bestandsöffnung als nicht ok (3D und IFC lassen sie aus), die erste bleibt", () => {
    const l = mitOeffnung();
    const k = { ...l.koerper[0], oeffnungen: [...(l.koerper[0].oeffnungen || []), { kante: 2, u: 2.8, width: 1.2, height: 1.5, sill: 0.8 }, { kante: 0, u: 2.5, width: 1.2, height: 1.5, sill: 0.8 }] };
    const l2 = { ...l, koerper: [k] };
    const p = oeffnungenPruefen(l2, k);
    assert.deepEqual(p.map((x) => [x.ok, x.grund]), [[true, null], [false, "ueberlappt"], [false, "ueberlappt"]]);
    // the IFC writes one void only (the other two are reported)
    const s = ifcKoerperOeffnungSzenario();
    const ifc = exportIFC(s.model, { ...s.opts, massing: l2 });
    assert.equal((ifc.match(/IFCOPENINGELEMENT\(/g) || []).length, 1);
  });

  it("kante/u liegen in der GESPEICHERTEN Reihenfolge: andersherum gespeicherte Wand, Lesen übersetzt, Seitenschub hält die Öffnung am Ort", () => {
    // stored in the other sense: (0,0) (0,0.3) (5,0.3) (5,0) — normalised it is the wall of wand(), edge 2 = stored edge 1 backwards
    const l0 = { ...leererLayer(), naechsteId: 2, koerper: [{ id: "w", name: "", profil: [{ x: 0, y: 0 }, { x: 0, y: 0.3 }, { x: 5, y: 0.3 }, { x: 5, y: 0 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] };
    const l = teilflaecheDruecken(l0, "w", { ...TEIL, u: 2 }, -0.3).layer; // normalised u 2 on (5,0.3)→(0,0.3) = x 3
    // stored: edge 1 (0,0.3)→(5,0.3), u from (0,0.3) = 3 → the same x 3
    assert.deepEqual(l.koerper[0].oeffnungen, [{ kante: 1, u: 3, width: 1.2, height: 1.5, sill: 0.8 }]);
    assert.deepEqual(geometrie(l, l.koerper[0]).oeffnungen, [{ kante: 2, u: 2, width: 1.2, height: 1.5, sill: 0.8 }]);
    const [p] = /** @type {any[]} */ (oeffnungenPruefen(l, l.koerper[0]));
    assert.equal(p.ok, true);
    nah(p.mitte, 2);
    // east face (normalised edge 1, x = 5) 1 m out: the opening keeps x 3 → stored edge 1 now 6 m long, u still 3
    const l2 = seiteVerschieben(l, "w", 1, 1);
    assert.deepEqual(l2.koerper[0].oeffnungen, [{ kante: 1, u: 3, width: 1.2, height: 1.5, sill: 0.8 }]);
    // the mapping is its own inverse
    const o = { kante: 1, u: 3, width: 1, height: 1, sill: 0 };
    assert.deepEqual(oeffnungWenden(oeffnungWenden(o, l0.koerper[0].profil), geometrie(l0, l0.koerper[0]).profil), o);
  });

  it("verkürzte Kante: die Öffnung wird gemeldet (passtNicht) statt still in die Kante geschoben; Hinweis beim Schub", () => {
    const l = mitOeffnung();
    /** @type {any[]} */
    const h = [];
    // east face 3 m in: edge 2 now (2,0.3)→(0,0.3), the opening (stored u 2.5 − 3 = −0.5) lies outside
    const l2 = seiteVerschieben(l, "w", 1, -3, { hinweis: (x) => h.push(x.grund) });
    assert.equal(l2.koerper[0].oeffnungen?.[0].u, -0.5);
    const [p] = oeffnungenPruefen(l2, l2.koerper[0]);
    assert.deepEqual([p.ok, p.grund], [false, "passtNicht"]);
    assert.deepEqual(h, ["oeffnungRaus"]);
  });

  it("eine Stufe, deren Schnitt durch eine Öffnung liefe, wird abgelehnt; daneben bleibt die Öffnung gültig", () => {
    const l = mitOeffnung();
    const f = fang();
    // full height around u 3 (cuts at u 2.5 and 3.5): 2.5 lies inside the hole 1.9…3.1
    assert.equal(teilflaecheDruecken(l, "w", { kante: 2, u: 3, width: 1, height: 3, sill: 0 }, 0.5, { abgelehnt: f.cb }).art, null);
    assert.deepEqual(f.l, ["oeffnungImWeg"]);
    // cuts at 4.2 / 4.8 are clear of 3.1 + 5 cm → step, the opening stays where it was (x 1.9…3.1) and valid
    const r = teilflaecheDruecken(l, "w", { kante: 2, u: 4.5, width: 0.6, height: 3, sill: 0 }, 0.5);
    assert.equal(r.art, "profil");
    const [p] = /** @type {any[]} */ (oeffnungenPruefen(r.layer, r.layer.koerper[0]));
    assert.equal(p.ok, true);
    nah(p.a.x + ((p.b.x - p.a.x) / p.laenge) * p.mitte, 2.5);
  });

  it("nach der Stufe trifft die neue Wahl an der verschobenen Teilmitte das verschobene Stück (nicht den alten Index)", () => {
    // finding: wall, part {edge 2, u 4.5, width 0.6, full height}, +0.5 → (0,0) (5,0) (5,0.3) (0.8,0.3) (0.8,0.8) (0.2,0.8) (0.2,0.3) (0,0.3)
    const r = teilflaecheDruecken(wand(), "w", { kante: 2, u: 4.5, width: 0.6, height: 3, sill: 0 }, 0.5);
    assert.deepEqual(r.layer.koerper[0].profil, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0.8, y: 0.3 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.2, y: 0.3 }, { x: 0, y: 0.3 }]);
    // the modeller picks again at the old part middle (x 0.5) moved by 0.5 along the normal (0, 1)
    const w = /** @type {any} */ (flaecheWaehlen(r.layer, r.layer.koerper[0], { x: 0.5, y: 0.8, z: 1.5 }, { x: 0, y: 1, z: 0 }));
    assert.equal(w.kante, 4);
    assert.deepEqual([w.a, w.b], [{ x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }]);
    // a second push of that face moves the step, not the rest of the old edge
    const l3 = seiteVerschieben(r.layer, "w", w.kante, 0.5);
    assert.deepEqual((l3.koerper[0].profil || []).filter((q) => q.y === 1.3), [{ x: 0.8, y: 1.3 }, { x: 0.2, y: 1.3 }]);
  });

  it("Unterseite über die Brüstung hochgeschoben wird abgelehnt (keine negative Brüstung); darunter geht", () => {
    const l = mitOeffnung();
    const f = fang();
    assert.equal(pushPull(l, "w", -1.5, { flaeche: "unten", abgelehnt: f.cb }), l);
    assert.deepEqual(f.l, ["oeffnungImWeg"]);
    const l2 = pushPull(l, "w", -0.5, { flaeche: "unten" });
    assert.equal(l2.koerper[0].oeffnungen?.[0].sill, 0.3);
    assert.equal(l2.koerper[0].basis, 0.5);
  });

  it("an den Rand gesetzte Teilfläche: gespeichertes u = Lage in 3D und IFC (Randabstand 5 cm), kein stiller Versatz beim Export", () => {
    // u 0.6, width 1.2 at the edge start: the export rule keeps the middle at 0.6 + 0.05
    const r = teilflaecheDruecken(wand(), "w", { ...TEIL, u: 0.6 }, -0.3);
    assert.equal(r.art, "oeffnung");
    assert.equal(r.layer.koerper[0].oeffnungen?.[0].u, 0.65);
    const [p] = /** @type {any[]} */ (oeffnungenPruefen(r.layer, r.layer.koerper[0]));
    assert.equal(p.ok, true);
    assert.equal(p.mitte, 0.65);
  });
});
