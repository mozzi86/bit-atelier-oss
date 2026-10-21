// 104-05: object snap core — endpoint, midpoint, intersection, perpendicular, nearest, priority, grid, ortho, polar,
// polar + grid, spatial index = brute force (seeded PRNG), robustness (zero-length, NaN, excluded sources),
// regression against the 98-02 modeller snap, command parser and settings normalisation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FANG_STANDARD, fangIndex, fangPunkt, segmenteAusRingen, segmenteNahe, naechsterAufSegment, schnittPunkt, lotFuss,
  zeichenWinkel, fangEinstellungenNormalisieren,
} from "@core/lib/objektfang.js";
import { fangBefehlLesen, fangKontextEintraege, fangSchalter, fangBefehleRegistrieren } from "@core/lib/fangEinstellungen.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";

const nah = (/** @type {any} */ p, /** @type {number} */ x, /** @type {number} */ y, eps = 1e-9) => {
  assert.ok(p, "Punkt erwartet");
  assert.ok(Math.abs(p.x - x) < eps && Math.abs(p.y - y) < eps, `(${p.x}, ${p.y}) ≠ (${x}, ${y})`);
};

// 10 × 6 m rectangle at the origin (y down) and a diagonal pair crossing at (5, 3).
const RECHTECK = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
const idxRechteck = fangIndex(segmenteAusRingen([{ punkte: RECHTECK, quelle: "k1" }]));
const OHNE_RASTER = { raster: false, polar: false };

test("1 Endpunkt: Ecke innerhalb der Toleranz, außerhalb nicht", () => {
  const r = fangPunkt({ x: 9.8, y: 0.2 }, idxRechteck, { toleranz_m: 0.4, modi: OHNE_RASTER });
  assert.equal(r?.art, "endpunkt");
  nah(r?.punkt, 10, 0);
  assert.equal(r?.quelle, "k1");
  const weit = fangPunkt({ x: 9.4, y: 0.5 }, idxRechteck, { toleranz_m: 0.4, modi: OHNE_RASTER });
  assert.equal(weit?.art, "frei");
});

test("2 Mitte: Kantenmitte", () => {
  const r = fangPunkt({ x: 5.2, y: 0.1 }, idxRechteck, { toleranz_m: 0.4, modi: OHNE_RASTER });
  assert.equal(r?.art, "mitte");
  nah(r?.punkt, 5, 0);
});

test("3 Schnitt: Diagonalen kreuzen sich in der Mitte", () => {
  const idx = fangIndex(segmenteAusRingen([{ punkte: [{ x: 0, y: 0 }, { x: 10, y: 6 }], geschlossen: false }, { punkte: [{ x: 10, y: 0 }, { x: 0, y: 6 }], geschlossen: false }]));
  const r = fangPunkt({ x: 5.1, y: 3.2 }, idx, { toleranz_m: 0.4, modi: OHNE_RASTER });
  assert.equal(r?.art, "schnitt");
  nah(r?.punkt, 5, 3);
  nah(schnittPunkt({ x: 0, y: 0 }, { x: 10, y: 6 }, { x: 10, y: 0 }, { x: 0, y: 6 }), 5, 3);
  assert.equal(schnittPunkt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null, "parallel");
  assert.equal(schnittPunkt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 }), null, "außerhalb");
});

test("4 Lot: Lotfußpunkt von der Basis auf eine Kante", () => {
  const basis = { x: 3, y: -5 };
  const r = fangPunkt({ x: 3.2, y: 0.1 }, idxRechteck, { toleranz_m: 0.4, basis, modi: { ...OHNE_RASTER, mitte: false } });
  assert.equal(r?.art, "lot");
  nah(r?.punkt, 3, 0);
  assert.equal(lotFuss(basis, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  // without a base point there is no perpendicular
  assert.equal(fangPunkt({ x: 3.2, y: 0.1 }, idxRechteck, { toleranz_m: 0.4, modi: { ...OHNE_RASTER, mitte: false } })?.art, "frei");
});

test("5 Nächster: nur eingeschaltet, Punkt auf der Kante", () => {
  const roh = { x: 2.3, y: 0.3 };
  assert.equal(fangPunkt(roh, idxRechteck, { toleranz_m: 0.4, modi: OHNE_RASTER })?.art, "frei", "Standard: aus");
  const r = fangPunkt(roh, idxRechteck, { toleranz_m: 0.4, modi: { ...OHNE_RASTER, naechster: true } });
  assert.equal(r?.art, "naechster");
  nah(r?.punkt, 2.3, 0);
  nah(naechsterAufSegment({ x: -3, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 }).punkt, 0, 0);
});

test("6 Vorrang Endpunkt > Schnitt > Mitte > Lot > Nächster; Einmal-Fang", () => {
  // a 0.6 m edge: its endpoint and its midpoint are both within 0.4 m of the pointer
  const idx = fangIndex(segmenteAusRingen([{ punkte: [{ x: 0, y: 0 }, { x: 0.6, y: 0 }], geschlossen: false }]));
  assert.equal(fangPunkt({ x: 0.35, y: 0 }, idx, { toleranz_m: 0.4, modi: { ...OHNE_RASTER, naechster: true } })?.art, "endpunkt");
  assert.equal(fangPunkt({ x: 0.35, y: 0 }, idx, { toleranz_m: 0.4, modi: { ...OHNE_RASTER, endpunkt: false, naechster: true } })?.art, "mitte");
  // one-shot "mitte" wins even over the endpoint and while object snap is off
  const r = fangPunkt({ x: 0.35, y: 0 }, idx, { toleranz_m: 0.4, modi: { ...OHNE_RASTER, objektfang: false }, einmal: "mitte" });
  assert.equal(r?.art, "mitte");
  nah(r?.punkt, 0.3, 0);
  // object snap switched off: nothing but tracking / grid
  assert.equal(fangPunkt({ x: 0.05, y: 0 }, idx, { toleranz_m: 0.4, modi: { objektfang: false } })?.art, "raster");
});

test("7 Raster: 0,25 m Standard und eigenes Maß", () => {
  const r = fangPunkt({ x: 3.13, y: 7.38 }, null, {});
  assert.equal(r?.art, "raster");
  nah(r?.punkt, 3.25, 7.5);
  nah(fangPunkt({ x: 3.13, y: 7.38 }, null, { modi: { raster_m: 0.5 } })?.punkt, 3, 7.5);
  nah(fangPunkt({ x: 3.13, y: 7.38 }, null, { modi: { raster: false } })?.punkt, 3.13, 7.38);
});

test("8 Ortho: erzwungen auf die nächste Achse, unabhängig vom Winkel", () => {
  const basis = { x: 0, y: 0 };
  const r = fangPunkt({ x: 5, y: -2 }, null, { basis, modi: { ortho: true, raster: false } });
  assert.equal(r?.art, "ortho");
  nah(r?.punkt, 5, 0);
  assert.equal(r?.winkel_grad, 0);
  const s = fangPunkt({ x: 1, y: -4 }, null, { basis, modi: { ortho: true, raster: false } });
  nah(s?.punkt, 0, -4);
  assert.equal(s?.winkel_grad, 90, "nach oben = Norden = 90°");
});

test("9 Polar 15° und 45°: Zeichenwinkel (0° = Ost, gegen den Uhrzeigersinn, y nach unten)", () => {
  assert.equal(zeichenWinkel(1, -1), 45);
  assert.equal(zeichenWinkel(-1, 0), 180);
  const basis = { x: 0, y: 0 };
  // 47° → 45° (within 5°)
  const w = (47 * Math.PI) / 180;
  const r = fangPunkt({ x: 10 * Math.cos(w), y: -10 * Math.sin(w) }, null, { basis, modi: { polarSchritt_grad: 45, raster: false } });
  assert.equal(r?.art, "polar");
  assert.equal(r?.winkel_grad, 45);
  assert.ok(Math.abs(zeichenWinkel(/** @type {any} */ (r).punkt.x, /** @type {any} */ (r).punkt.y) - 45) < 1e-9);
  // 22° with 15° steps → no capture at 5° tolerance (nearest 15°/30° are 7°/8° away)
  const w2 = (22 * Math.PI) / 180;
  assert.equal(fangPunkt({ x: 10 * Math.cos(w2), y: -10 * Math.sin(w2) }, null, { basis, modi: { polarSchritt_grad: 15, raster: false } })?.art, "frei");
  const w3 = (32 * Math.PI) / 180;
  assert.equal(fangPunkt({ x: 10 * Math.cos(w3), y: -10 * Math.sin(w3) }, null, { basis, modi: { polarSchritt_grad: 15, raster: false } })?.winkel_grad, 30);
});

test("10 Polar + Raster: achsparallel absolutes Raster, schräg gerundete Länge", () => {
  const basis = { x: 0.1, y: 0 };
  const r = fangPunkt({ x: 4.37, y: 0.2 }, null, { basis });
  assert.equal(r?.art, "polar");
  nah(r?.punkt, 4.25, 0, 1e-9);
  const w = (46 * Math.PI) / 180;
  const s = fangPunkt({ x: 3.9 * Math.cos(w), y: -3.9 * Math.sin(w) }, null, { basis: { x: 0, y: 0 }, modi: { polarSchritt_grad: 45 } });
  const l = Math.hypot(/** @type {any} */ (s).punkt.x, /** @type {any} */ (s).punkt.y);
  assert.ok(Math.abs(l - 4) < 1e-9, `Länge ${l}`);
  assert.equal(s?.winkel_grad, 45);
});

test("11 Raster-Index = Brute-Force (Seed-PRNG, 400 Segmente, lange Segmente in der Extraliste)", () => {
  let seed = 12345;
  const zufall = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const segs = [];
  for (let i = 0; i < 400; i++) {
    const a = { x: zufall() * 200, y: zufall() * 200 };
    const lang = i % 50 === 0;
    const b = { x: a.x + (zufall() - 0.5) * (lang ? 400 : 12), y: a.y + (zufall() - 0.5) * (lang ? 400 : 12) };
    segs.push({ a, b, quelle: `s${i}` });
  }
  const idx = fangIndex(segs, { zelle_m: 5 });
  assert.ok(idx.lang.length > 0, "lange Segmente erwartet");
  const brute = (/** @type {{x:number,y:number}} */ p, /** @type {number} */ r) => segs.filter((s) => Math.hypot(naechsterAufSegment(p, s.a, s.b).punkt.x - p.x, naechsterAufSegment(p, s.a, s.b).punkt.y - p.y) <= r).map((s) => s.quelle).sort();
  for (let k = 0; k < 300; k++) {
    const p = { x: zufall() * 220 - 10, y: zufall() * 220 - 10 };
    const r = 0.2 + zufall() * 3;
    assert.deepEqual(segmenteNahe(idx, p, r).map((s) => s.quelle).sort(), brute(p, r), `Punkt ${k}`);
    // the snapped result equals a search over the full list (index = one cell covering everything)
    const voll = fangIndex(segs, { zelle_m: 1e6 });
    assert.deepEqual(fangPunkt(p, idx, { toleranz_m: r, modi: { naechster: true } }), fangPunkt(p, voll, { toleranz_m: r, modi: { naechster: true } }));
  }
});

test("12 Robust: Nullsegment, NaN, ausser, leerer Index", () => {
  const idx = fangIndex([{ a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, quelle: "p" }, { a: { x: NaN, y: 0 }, b: { x: 1, y: 0 } }, /** @type {any} */ (null)]);
  assert.equal(idx.segmente.length, 1, "NaN und null fallen weg");
  const r = fangPunkt({ x: 1.1, y: 1.2 }, idx, { modi: { raster: false } });
  assert.equal(r?.art, "endpunkt", "Nullsegment = Punkt");
  assert.equal(fangPunkt({ x: NaN, y: 1 }, idx), null);
  assert.equal(fangPunkt(/** @type {any} */ (null), idx), null);
  assert.equal(fangPunkt({ x: 1.1, y: 1.2 }, idx, { ausser: ["p"], modi: { raster: false } })?.art, "frei");
  assert.equal(fangPunkt({ x: 1.1, y: 1.2 }, idx, { ausser: (s) => s.quelle === "p", modi: { raster: false } })?.art, "frei");
  const alt = fangPunkt({ x: 1.1, y: 1.2 }, idx, { aus: true });
  assert.deepEqual(alt, { punkt: { x: 1.1, y: 1.2 }, art: "frei" });
  assert.equal(fangPunkt({ x: 2, y: 2 }, fangIndex([]))?.art, "raster");
  // single point ring and an open polyline
  assert.equal(segmenteAusRingen([[{ x: 0, y: 0 }]]).length, 1);
  assert.equal(segmenteAusRingen([{ punkte: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], geschlossen: false }]).length, 2);
  assert.equal(segmenteAusRingen([RECHTECK]).length, 4);
});

// The 98-02 modeller snap (MassingModellierer.jsx before 104-05), reproduced verbatim for the regression test.
const ALT_RASTER = 0.25, ALT_ACHS = 5, ALT_ECKE = 0.4;
function altFange(/** @type {{x:number,y:number}} */ roh, /** @type {Array<{x:number,y:number}>} */ ecken, /** @type {{x:number,y:number}|null} */ letzter) {
  let best = null, bestD = ALT_ECKE;
  for (const q of ecken) { const d = Math.hypot(q.x - roh.x, q.y - roh.y); if (d < bestD) { best = q; bestD = d; } }
  if (best) return { x: best.x, y: best.y };
  const rnd = (/** @type {number} */ v) => Math.round(v / ALT_RASTER) * ALT_RASTER;
  let p = { x: rnd(roh.x), y: rnd(roh.y) };
  if (letzter) {
    const w = (Math.atan2(roh.y - letzter.y, roh.x - letzter.x) * 180) / Math.PI;
    if (Math.abs(((w + 360) % 180)) < ALT_ACHS || Math.abs(((w + 360) % 180) - 180) < ALT_ACHS) p = { x: p.x, y: letzter.y };
    else if (Math.abs(((w + 360) % 180) - 90) < ALT_ACHS) p = { x: letzter.x, y: p.y };
  }
  return p;
}

test("13 Regression: Standardeinstellung = 98-02-Fang (Ecke, Raster, Achssperre), abseits von Mitte/Schnitt/Lot", () => {
  let seed = 777;
  const zufall = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const koerper = [RECHTECK, [{ x: 20, y: 4 }, { x: 28.5, y: 4 }, { x: 28.5, y: 13.25 }, { x: 20, y: 13.25 }]];
  const ecken = koerper.flat();
  const idx = fangIndex(segmenteAusRingen(koerper));
  let verglichen = 0;
  for (let k = 0; k < 4000; k++) {
    const roh = { x: zufall() * 40 - 5, y: zufall() * 25 - 5 };
    // last point on the 0.25 m grid (as the old tool produced it) or none
    const letzter = k % 3 === 0 ? null : { x: Math.round(zufall() * 120) / 4, y: Math.round(zufall() * 80) / 4 };
    const neu = fangPunkt(roh, idx, { toleranz_m: 0.4, modi: FANG_STANDARD, basis: letzter });
    // the new snap kinds (midpoint, intersection, perpendicular) are additions — skip points where they apply
    if (neu && ["mitte", "schnitt", "lot"].includes(neu.art)) continue;
    const alt = altFange(roh, ecken, letzter);
    nah(neu?.punkt, alt.x, alt.y, 1e-9);
    verglichen++;
  }
  assert.ok(verglichen > 3800, `nur ${verglichen} verglichen`);
});

test("Befehle: Parser, Register, Menü und Schalter", () => {
  assert.deepEqual(fangBefehlLesen("polar 15"), { id: "polar", wert: 15 });
  assert.deepEqual(fangBefehlLesen("raster 0,5"), { id: "raster", wert: 0.5 });
  assert.deepEqual(fangBefehlLesen("raster 50cm"), { id: "raster", wert: 0.5 });
  assert.deepEqual(fangBefehlLesen("Ortho"), { id: "ortho" });
  assert.deepEqual(fangBefehlLesen("of"), { id: "fang" });
  assert.deepEqual(fangBefehlLesen("end"), { id: "end", art: "endpunkt" });
  assert.ok("fehler" in /** @type {any} */ (fangBefehlLesen("polar 400")));
  assert.equal(fangBefehlLesen("5,40"), null);
  assert.equal(fangBefehlLesen("@3;4"), null);
  assert.equal(fangBefehlLesen("linie"), null);
  const reg = befehlsRegister();
  /** @type {string[]} */
  const meldungen = [];
  let einmal = "";
  fangBefehleRegistrieren(reg, { einmal: (a) => { einmal = a; }, melden: (t) => meldungen.push(t) });
  const vorher = reg.ausfuehren("ortho");
  assert.equal(vorher.ok, true);
  assert.equal(reg.ausfuehren("polar", { wert: 30 }).ok, true);
  assert.equal(reg.ausfuehren("polar", { wert: 0 }).ok, false);
  assert.equal(reg.ausfuehren("raster", { wert: "1m" }).ok, true);
  assert.equal(reg.ausfuehren("mit").ok, true);
  assert.equal(einmal, "mitte");
  assert.ok(meldungen.some((m) => m.startsWith("Polar an, 30")), meldungen.join(" | "));
  const t = (/** @type {string} */ s) => s;
  const menue = fangKontextEintraege(fangEinstellungenNormalisieren({ polar: true, polarSchritt_grad: 30 }), t);
  assert.equal(menue.length, 9);
  assert.equal(menue[0].gruppe, "Fang");
  assert.ok(menue.every((e) => typeof e.an === "boolean"));
  assert.equal(menue.find((e) => e.label.startsWith("Polar"))?.label, "Polar 30°");
  assert.deepEqual(fangSchalter(FANG_STANDARD, t).map((s) => [s.id, s.an]), [["objektfang", true], ["ortho", false], ["polar", true], ["raster", true]]);
});

test("Einstellungen normalisieren: Unsinn → Standard", () => {
  assert.deepEqual(fangEinstellungenNormalisieren(null), FANG_STANDARD);
  const e = fangEinstellungenNormalisieren({ ortho: "ja", raster_m: -1, polarSchritt_grad: 15, mitte: false });
  assert.equal(e.ortho, false);
  assert.equal(e.raster_m, 0.25);
  assert.equal(e.polarSchritt_grad, 15);
  assert.equal(e.mitte, false);
});

test("Lageplan: Fanggeometrie in Metern (Grundstück, Baufeld, Baukörper, Riegel, Entwurf), geschätztes Grundstück ohne Fang", async () => {
  const { lageplanFangSegmente, QUELLE_GRUNDSTUECK, QUELLE_ENTWURF } = await import("@designer/lib/lageplanFang.js");
  const parcel = { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 0, y: 60 }] };
  const daten = {
    parcel, mSite: 1.25,
    areas: [{ id: "a1", points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }] }],
    buildings: [{ id: "b1", x: 40, y: 20, width: 16, height: 8 }],
    riegel: [{ id: "r1", punkte: [{ x: 4, y: 50 }, { x: 36, y: 50 }], geschlossen: false }],
    entwurf: [{ x: 60, y: 40 }, { x: 70, y: 40 }],
  };
  const segs = lageplanFangSegmente(daten);
  const zahl = (/** @type {string} */ q) => segs.filter((s) => s.quelle === q).length;
  assert.deepEqual([zahl(QUELLE_GRUNDSTUECK), zahl("a1"), zahl("b1"), zahl("r1"), zahl(QUELLE_ENTWURF)], [4, 3, 4, 1, 1]);
  // metres: the plot corner (80, 60) canvas units = (100, 75) m
  assert.ok(segs.some((s) => s.quelle === QUELLE_GRUNDSTUECK && s.a.x === 100 && s.a.y === 75));
  // building corner (40, 20) canvas = (50, 25) m snaps as an endpoint; ignoring the building leaves the grid
  const idx = fangIndex(segs);
  const r = fangPunkt({ x: 50.3, y: 25.2 }, idx, { toleranz_m: 0.5, modi: { raster: false } });
  assert.equal(r?.art, "endpunkt");
  nah(r?.punkt, 50, 25, 1e-9);
  assert.equal(fangPunkt({ x: 50.3, y: 25.2 }, idx, { toleranz_m: 0.5, ausser: ["b1"], modi: { raster: false } })?.art, "frei");
  // an estimated plot (the generic start square) is not snapped to
  assert.equal(lageplanFangSegmente({ ...daten, parcelGeschaetzt: true }).filter((s) => s.quelle === QUELLE_GRUNDSTUECK).length, 0);
  assert.deepEqual(lageplanFangSegmente({ mSite: 1 }), []);
});

test("F-Tasten: F3/F8/F9/F10 schalten, nicht in Eingabefeldern und nicht mit Strg", async () => {
  const { fangTaste, fangEinstellungen, fangEinstellungenSetzen } = await import("@core/lib/fangEinstellungen.js");
  fangEinstellungenSetzen({ ...FANG_STANDARD });
  let verhindert = 0;
  const taste = (/** @type {string} */ key, /** @type {any} */ extra = {}) => fangTaste({ key, preventDefault: () => { verhindert++; }, ...extra });
  assert.equal(taste("F8"), "ortho");
  assert.equal(fangEinstellungen().ortho, true);
  assert.equal(fangEinstellungen().polar, false, "Ortho schaltet Polar aus");
  assert.equal(taste("F10"), "polar");
  assert.equal(fangEinstellungen().ortho, false, "Polar schaltet Ortho aus");
  assert.equal(taste("F3"), "objektfang");
  assert.equal(fangEinstellungen().objektfang, false);
  assert.equal(taste("F9"), "raster");
  assert.equal(verhindert, 4);
  assert.equal(taste("F8", { target: { tagName: "INPUT" } }), null);
  assert.equal(taste("F8", { ctrlKey: true }), null);
  assert.equal(taste("F5"), null);
  fangEinstellungenSetzen({ ...FANG_STANDARD });
});
