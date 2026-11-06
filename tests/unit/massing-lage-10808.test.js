// 108-08 (D-EFH-09): start position of the massing body and its stored position (@core/lib/massing/lage.js).
// Neutral data: an EFH parcel 30 × 25 m (20 px per metre), a house 11.40 × 10.20 m, an L-shape; no real project behind them.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  siteAusParzelle, pxZuSite, siteZuPx, baukoerperLageSite, startLageSite, lageAusPoly, lageGeaendert, lageBezug, ERSATZFELD_M,
  massingSchreibPatch, echoSchluessel, echoMerken, echoPruefen,
} from "@core/lib/massing/lage.js";

const MPP = 0.05; // m per canvas px
/** site metres → canvas px of the test parcel (corner at px 300/150) @param {number} x @param {number} y */
const px = (x, y) => ({ x: 300 + x / MPP, y: 150 + y / MPP });
const rechteckPx = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => [px(x0, y0), px(x1, y0), px(x1, y1), px(x0, y1)];
const PARZELLE = { m_per_px: MPP, points: rechteckPx(0, 0, 30, 25) };

/** the studio's shape rules (MassingStudio fromStore / toStore), reproduced to prove the round trip */
const toStore = (/** @type {{x:number,y:number}[]} */ pts) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map((p) => ({ x: +(p.x - cx).toFixed(2), z: +(p.y - cy).toFixed(2) }));
};
const fromStore = (/** @type {{x:number,z:number}[]} */ fp, /** @type {{x:number,y:number}} */ c) => fp.map((p) => ({ x: +(c.x + p.x).toFixed(2), y: +(c.y + p.z).toFixed(2) }));

describe("108-08 Lage-Regel: Zeichenfeld und Umrechnung", () => {
  it("Parzelle 30 × 25 m: Feld = Bbox, Bezug = Eckpunkt-Mittelwert in der Feldmitte", () => {
    const f = siteAusParzelle(PARZELLE);
    assert.equal(f.hatParzelle, true);
    assert.ok(Math.abs(f.w - 30) < 1e-9 && Math.abs(f.d - 25) < 1e-9);
    assert.deepEqual(lageBezug(f), { x: 15, y: 12.5 });
    assert.deepEqual(pxZuSite(PARZELLE.points, f), [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 25 }, { x: 0, y: 25 }]);
    assert.deepEqual(siteZuPx(pxZuSite(PARZELLE.points, f), f), PARZELLE.points);
  });
  it("ohne Parzelle: Ersatzfeld 70 × 50 m, Bezug (35, 25) wie bisher", () => {
    const f = siteAusParzelle(null);
    assert.equal(f.hatParzelle, false);
    assert.deepEqual({ w: f.w, d: f.d }, { w: ERSATZFELD_M.w, d: ERSATZFELD_M.d });
    assert.deepEqual(lageBezug(f), { x: 35, y: 25 });
  });
  it("kleine Parzelle: Feld mindestens 20 m", () => {
    const f = siteAusParzelle({ m_per_px: MPP, points: rechteckPx(0, 0, 12, 8) });
    assert.equal(f.w, 20);
    assert.equal(f.d, 20);
  });
});

describe("108-08 Lage-Regel: Quellen-Reihenfolge der Startlage", () => {
  const flaeche = rechteckPx(9.0, 7.5, 20.4, 17.7); // the house 11.40 × 10.20 m of the site planning
  const block = { id: "b1", x: px(2, 3).x, y: px(2, 3).y, width: 10 / MPP, height: 8 / MPP }; // 10 × 8 m at (2…12, 3…11)

  it("EFH-Parzelle ohne Lage und ohne Baufeld-Planung → Parzellenmitte (15; 12,5)", () => {
    assert.deepEqual(startLageSite({ parcel: PARZELLE }), { x: 15, y: 12.5, quelle: "parzelle" });
  });
  it("footprint-Fläche → ihr Eckpunkt-Mittelwert (14,7; 12,6)", () => {
    const l = startLageSite({ parcel: PARZELLE, footprintFlaechePx: flaeche, buildings: [block] });
    assert.equal(l.quelle, "footprint");
    assert.ok(Math.abs(l.x - 14.7) < 1e-9 && Math.abs(l.y - 12.6) < 1e-9, JSON.stringify(l));
  });
  it("ohne footprint-Fläche: erster Block aus buildings[] (px → Meter), Mitte (7; 7)", () => {
    const l = startLageSite({ parcel: PARZELLE, buildings: [block] });
    assert.deepEqual(l, { x: 7, y: 7, quelle: "block" });
  });
  it("Block mit Meter-Spiegel mitte_m (Leinwand-Meter) gewinnt vor der px-Bbox", () => {
    const gedreht = { ...block, mitte_m: { x: px(8, 9).x * MPP, y: px(8, 9).y * MPP } };
    assert.deepEqual(startLageSite({ parcel: PARZELLE, buildings: [gedreht] }), { x: 8, y: 9, quelle: "block" });
  });
  it("gespeicherte Lage gewinnt vor allem anderen", () => {
    const l = startLageSite({ parcel: PARZELLE, footprintLageM: { x: -3, z: 2.5 }, footprintFlaechePx: flaeche, buildings: [block] });
    assert.deepEqual(l, { x: 12, y: 15, quelle: "gespeichert" });
  });
  it("ohne Parzelle: (35, 25) wie heute — auch mit footprint-Fläche oder Block", () => {
    assert.deepEqual(baukoerperLageSite({ footprintFlaechePx: flaeche, buildings: [block] }), { x: 35, y: 25, quelle: "ersatzfeld" });
    assert.deepEqual(startLageSite({ footprintLageM: { x: 1, z: -2 } }), { x: 36, y: 23, quelle: "gespeichert" });
  });
  it("die Startlage aus der footprint-Fläche legt den Körper genau auf die Fläche (footprintToMeters-Zentrierung)", () => {
    // footprintToMeters centres on the vertex mean; fromStore puts that origin on the start position
    const cx = flaeche.reduce((s, p) => s + p.x, 0) / 4, cy = flaeche.reduce((s, p) => s + p.y, 0) / 4;
    const fp = flaeche.map((p) => ({ x: (p.x - cx) * MPP, z: (p.y - cy) * MPP }));
    const koerper = fromStore(fp, startLageSite({ parcel: PARZELLE, footprintFlaechePx: flaeche }));
    assert.deepEqual(koerper, [{ x: 9, y: 7.5 }, { x: 20.4, y: 7.5 }, { x: 20.4, y: 17.7 }, { x: 9, y: 17.7 }]);
    // inside the parcel 0…30 × 0…25
    assert.ok(koerper.every((p) => p.x >= 0 && p.x <= 30 && p.y >= 0 && p.y <= 25));
  });
});

describe("108-08 Lage-Regel: gespeicherte Lage hin und zurück", () => {
  /** poly → (toStore, lageAusPoly) → (startLageSite, fromStore) must give poly back @param {{x:number,y:number}[]} poly @param {any} parcel */
  const rundreise = (poly, parcel) => fromStore(toStore(poly), startLageSite({ footprintLageM: lageAusPoly(poly, parcel), parcel }));

  it("Rechteck auf der EFH-Parzelle", () => {
    const poly = [{ x: 9, y: 7.5 }, { x: 20.4, y: 7.5 }, { x: 20.4, y: 17.7 }, { x: 9, y: 17.7 }];
    assert.deepEqual(lageAusPoly(poly, PARZELLE), { x: -0.3, z: 0.1 });
    assert.deepEqual(rundreise(poly, PARZELLE), poly);
  });
  it("L-Form (Bbox-Mitte ≠ Eckpunkt-Mittelwert)", () => {
    const poly = [{ x: 4, y: 3 }, { x: 16, y: 3 }, { x: 16, y: 9 }, { x: 10, y: 9 }, { x: 10, y: 15 }, { x: 4, y: 15 }];
    assert.deepEqual(rundreise(poly, PARZELLE), poly);
  });
  it("ohne Parzelle: Bezug (35, 25)", () => {
    const poly = [{ x: 30, y: 20 }, { x: 44, y: 20 }, { x: 44, y: 30 }, { x: 30, y: 30 }];
    assert.deepEqual(lageAusPoly(poly, null), { x: 2, z: 0 });
    assert.deepEqual(rundreise(poly, null), poly);
  });
  it("lageGeaendert: Toleranz 1 cm, null gegen Wert", () => {
    assert.equal(lageGeaendert({ x: 1, z: 1 }, { x: 1.005, z: 0.995 }), false);
    assert.equal(lageGeaendert({ x: 1, z: 1 }, { x: 1.02, z: 1 }), true);
    assert.equal(lageGeaendert({ x: 0, z: 0 }, null), true);
    assert.equal(lageGeaendert(null, null), false);
  });
  it("ohne Polygon keine Lage", () => {
    assert.equal(lageAusPoly([], PARZELLE), null);
  });
});

// 108-08 review: undo to the opened state restores the record exactly; a foreign state equal to an earlier own value is taken over.
describe("108-08 Review: Rückkehr an den automatischen Platz und Echo-Puffer", () => {
  const FP = [{ x: -5.7, z: -5.1 }, { x: 5.7, z: -5.1 }, { x: 5.7, z: 5.1 }, { x: -5.7, z: 5.1 }];
  it("Altprojekt: am automatischen Platz bleibt footprintLageM ungeschrieben (Esc, Ziehen zurück)", () => {
    const auto = { lage: { x: -0.3, z: 0.1 }, gespeichert: null };
    assert.deepEqual(massingSchreibPatch({ footprintM: FP, footprintLageM: { x: -0.3, z: 0.1 } }, { footprintM: FP, footprintLageM: null }, { form: true }, auto), {});
  });
  it("Undo zurück an den automatischen Platz schreibt den Stand von damals (null)", () => {
    const auto = { lage: { x: -0.3, z: 0.1 }, gespeichert: null };
    const p = massingSchreibPatch({ footprintM: FP, footprintLageM: { x: -0.3, z: 0.1 } }, { footprintM: FP, footprintLageM: { x: 2.7, z: 2.1 } }, { form: true }, auto);
    assert.deepEqual(p, { footprintLageM: null });
  });
  it("gespeicherte Lage: zurück an den automatischen Platz schreibt den gespeicherten Wert", () => {
    const auto = { lage: { x: 1, z: 2 }, gespeichert: { x: 1, z: 2 } };
    const p = massingSchreibPatch({ footprintM: FP, footprintLageM: { x: 1, z: 2 } }, { footprintM: FP, footprintLageM: { x: 4, z: 2 } }, { form: true }, auto);
    assert.deepEqual(p, { footprintLageM: { x: 1, z: 2 } });
  });
  it("echte Verschiebung schreibt die neue Lage, ohne auto wie bisher", () => {
    const auto = { lage: { x: -0.3, z: 0.1 }, gespeichert: null };
    assert.deepEqual(massingSchreibPatch({ footprintM: FP, footprintLageM: { x: 2.7, z: 2.1 } }, { footprintM: FP, footprintLageM: null }, { form: true }, auto), { footprintLageM: { x: 2.7, z: 2.1 } });
    assert.deepEqual(massingSchreibPatch({ footprintM: FP, footprintLageM: { x: -0.3, z: 0.1 } }, { footprintM: FP, footprintLageM: null }, { form: true }), { footprintLageM: { x: -0.3, z: 0.1 } });
  });
  it("Echo: eigene Schreibvorgänge werden der Reihe nach verbraucht", () => {
    let puffer = echoMerken([], { footprintM: FP, footprintLageM: { x: 1, z: 0 } }, { footprintM: FP, footprintLageM: null });
    puffer = echoMerken(puffer, { footprintLageM: { x: 2, z: 0 } }, { footprintM: FP, footprintLageM: null }); // store render still lags
    assert.equal(puffer.length, 2);
    const a = echoSchluessel(FP, { x: 1, z: 0 }), b = echoSchluessel(FP, { x: 2, z: 0 });
    let r = echoPruefen(puffer, a, null);
    assert.equal(r.eigen, true);
    r = echoPruefen(r.puffer, b, a);
    assert.deepEqual(r, { eigen: true, puffer: [] });
  });
  it("Echo: A eigen → fremd B → fremd A wird übernommen", () => {
    const a = echoSchluessel(FP, { x: 1, z: 0 }), b = echoSchluessel(FP, { x: 5, z: 0 });
    let r = echoPruefen(echoMerken([], { footprintLageM: { x: 1, z: 0 } }, { footprintM: FP, footprintLageM: null }), a, null);
    assert.equal(r.eigen, true);
    r = echoPruefen(r.puffer, b, a);
    assert.equal(r.eigen, false);
    r = echoPruefen(r.puffer, a, b);
    assert.equal(r.eigen, false, "a foreign state equal to an earlier own value is no echo");
  });
  it("Echo: fremder Stand leert den Puffer; unveränderter Stand gilt als eigen nur solange Schreibvorgänge unterwegs sind", () => {
    const c = echoSchluessel(FP, { x: 9, z: 9 });
    const puffer = echoMerken([], { footprintLageM: { x: 1, z: 0 } }, { footprintM: FP, footprintLageM: null });
    assert.deepEqual(echoPruefen(puffer, c, null), { eigen: false, puffer: [] });
    assert.equal(echoPruefen(puffer, c, c).eigen, true);
    assert.equal(echoPruefen([], c, c).eigen, false);
    assert.equal(echoMerken(puffer, { achseM: [] }, {}), puffer);
  });
});
