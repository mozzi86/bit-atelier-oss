// 95-04…06: site-plan blocks in metres — backward-compatible storage, selection, move / copy /
// rotate, snapping, and the planning-law check after each move (shared with the Massing-Studio).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alsBlock, alsGebaeude, ecken, trefferBlock, rahmenAuswahl, rahmenModus, klickAuswahl,
  verschieben, kopieren, drehen, auswahlMitte, winkelFang, fangKorrektur, pruefen,
} from "@core/lib/massing/bloecke.js";
import { abstandsStreifen, konvexUeberlappen, dichte } from "@core/lib/massing/baurecht.js";

const MPP = 1.25;
const blk = (id, cx, cy, b = 20, t = 10, drehung = 0, geschosse = 3) => ({ id, cx, cy, breite: b, tiefe: t, drehung, geschosse });

test("Speicherformat bleibt rückwärtskompatibel und bekommt den Meter-Spiegel", () => {
  const alt = { id: "b1", x: 100, y: 200, width: 16, height: 8, floors: 4, name: "behalten" };
  const k = alsBlock(alt, MPP);
  assert.deepEqual([k.cx, k.cy, k.breite, k.tiefe, k.drehung, k.geschosse], [135, 255, 20, 10, 0, 4]);
  const neu = alsGebaeude(verschieben([k], ["b1"], 0.1, 0)[0], MPP, alt);
  assert.equal(neu.name, "behalten");
  assert.equal(neu.width, 16);
  assert.equal(neu.x, 100.08); // 0.1 m = 0.08 px — needs decimals
  assert.deepEqual(neu.mitte_m, { x: 135.1, y: 255 });
  assert.equal(neu.breite_m, 20);
  assert.equal(neu.drehung_grad, 0);
  // round trip
  const k2 = alsBlock(neu, MPP);
  assert.ok(Math.abs(k2.cx - 135.1) < 1e-6 && Math.abs(k2.breite - 20) < 1e-6);
});

test("Auswahl: Klick, Umschalt+Klick, Fenster vs. Kreuzen", () => {
  const b = [blk("a", 10, 10), blk("b", 50, 10)];
  assert.equal(trefferBlock(b, { x: 12, y: 12 }), "a");
  assert.equal(trefferBlock(b, { x: 30, y: 10 }), null);
  assert.deepEqual(klickAuswahl(["a"], "b", false), ["b"]);
  assert.deepEqual(klickAuswahl(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(klickAuswahl(["a", "b"], "a", true), ["b"]);
  assert.deepEqual(klickAuswahl(["a"], null, false), []);
  assert.equal(rahmenModus(10, 50), "fenster");
  assert.equal(rahmenModus(50, 10), "kreuzen");
  // frame from x=-5 to x=45 covers a completely and b partly
  assert.deepEqual(rahmenAuswahl(b, { x: -5, y: 0 }, { x: 45, y: 20 }, "fenster"), ["a"]);
  assert.deepEqual(rahmenAuswahl(b, { x: 45, y: 20 }, { x: -5, y: 0 }, "kreuzen"), ["a", "b"]);
});

test("Kopieren ×3, Drehen um die Auswahlmitte, 15°-Fang", () => {
  let n = 0;
  const { bloecke, neu } = kopieren([blk("a", 0, 0)], ["a"], 25, 0, () => `k${++n}`, 3);
  assert.equal(bloecke.length, 4);
  assert.deepEqual(bloecke.map((k) => k.cx), [0, 25, 50, 75]);
  assert.deepEqual(neu, ["k3"]);
  const m = auswahlMitte([blk("a", 0, 0), blk("b", 40, 0)], ["a", "b"]);
  assert.deepEqual(m, { x: 20, y: 0 });
  const g = drehen([blk("a", 0, 0), blk("b", 40, 0)], ["a", "b"], 90, /** @type {any} */ (m));
  assert.ok(Math.abs(g[0].cx - 20) < 1e-9 && Math.abs(g[0].cy + 20) < 1e-9);
  assert.equal(g[0].drehung, 90);
  const e = ecken(g[0]);
  const xs = e.map((p) => p.x);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 10) < 1e-9, "rotated: width along x = depth");
  assert.equal(winkelFang(22), 15);
  assert.equal(winkelFang(23), 30);
  assert.equal(drehen([blk("a", 0, 0, 20, 10, 350)], ["a"], 20, { x: 0, y: 0 })[0].drehung, 10);
});

test("Fang: Ecke auf Ecke, Kante auf Grenze, Abstandstiefe, Ecke in Ecke", () => {
  const grenze = [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, abstaende: [3], art: "grenze" }, { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, abstaende: [3], art: "grenze" }];
  // corner at (0.2, 50): snaps onto the left boundary (x = 0)
  const k1 = fangKorrektur([{ x: 0.2, y: 50 }], grenze, 0.5);
  assert.ok(Math.abs(k1.dx + 0.2) < 1e-9 && Math.abs(k1.dy) < 1e-9);
  assert.equal(k1.ziel, "grenze");
  // corner at (3.3, 50): snaps to the setback depth 3 m
  const k2 = fangKorrektur([{ x: 3.3, y: 50 }], grenze, 0.5);
  assert.ok(Math.abs(k2.dx + 0.3) < 1e-9);
  assert.equal(k2.ziel, "abstand");
  // corner near the plot corner: vertex snap wins
  const k3 = fangKorrektur([{ x: 0.3, y: 0.2 }], grenze, 0.5);
  assert.ok(Math.abs(k3.dx + 0.3) < 1e-9 && Math.abs(k3.dy + 0.2) < 1e-9);
  // corner at (3.2, 3.4): two edges at setback depth → (3, 3)
  const k4 = fangKorrektur([{ x: 3.2, y: 3.4 }], grenze, 0.5);
  assert.ok(Math.abs(3.2 + k4.dx - 3) < 1e-9 && Math.abs(3.4 + k4.dy - 3) < 1e-9, JSON.stringify(k4));
  assert.deepEqual(fangKorrektur([{ x: 50, y: 50 }], grenze, 0.5), { dx: 0, dy: 0, ziel: null });
});

test("Prüfung: GRZ/GFZ über alle Blöcke, Grenze, Überlappung, Abstandsflächen zwischen Blöcken", () => {
  const grenze = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  // two blocks 20 × 10, 3 storeys = 9 m → T = max(3, 3.6) = 3.6; 30 m apart → ok
  let r = pruefen([blk("a", 20, 30), blk("b", 70, 30)], { grenze });
  assert.equal(r.grundflaeche, 400);
  assert.equal(r.bgf, 1200);
  assert.ok(Math.abs(r.grz - 400 / 6000) < 1e-9 && Math.abs(r.gfz - 0.2) < 1e-9);
  assert.equal(r.konflikte, 0);
  // 5 m gap < 2 T = 7.2 → strips overlap
  r = pruefen([blk("a", 20, 30), blk("b", 45, 30)], { grenze });
  assert.deepEqual(r.je.a.abstandZu, ["b"]);
  assert.equal(r.konflikte, 2);
  // overlap + strip beyond the boundary
  r = pruefen([blk("a", 20, 30), blk("b", 25, 30), blk("c", 11, 30)], { grenze });
  assert.deepEqual(r.je.a.ueberlappt, ["b", "c"]);
  assert.equal(r.je.c.grenzKonflikt, true); // west facade at x = 1, strip to −2.6
  // without a plot: not checkable, never "ok" by accident
  r = pruefen([blk("a", 20, 30)]);
  assert.equal(r.pruefbar, false);
  assert.equal(r.je.a.streifen[0].conflict, null);
});

test("baurecht: Streifen nach außen, SAT, Dichte-Schwellen", () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const s = abstandsStreifen(sq, 20, { faktor: 0.4, min: 3 });
  assert.equal(s[0].depth, 8);
  assert.ok(s[0].pts[2].y < 0, "strip of the top edge points outward (−y)");
  assert.equal(konvexUeberlappen(sq, sq.map((p) => ({ x: p.x + 10, y: p.y }))), false, "touching ≠ overlapping");
  assert.equal(konvexUeberlappen(sq, sq.map((p) => ({ x: p.x + 9.9, y: p.y }))), true);
  assert.deepEqual(dichte(500, 1500, 1000), { grz: 0.5, gfz: 1.5, grzUeber: true, gfzHoch: true });
});
