// Undo/redo of the building model: one step per completed change, one step per drag.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leereHistorie, vorAenderung, zieheStart, zieheEnde, schrittZurueck, schrittVor } from "@designer/lib/bimHistorie";
// 115-05a (A-6): namespace import, so the older cases above still run where the new export is missing
import * as bimHistorie from "@designer/lib/bimHistorie";

const A = { walls: ["a"] };
const B = { walls: ["a", "b"] };
const C = { walls: ["a", "b", "c"] };

describe("bimHistorie", () => {
  it("zwei abgeschlossene Änderungen sind zwei Schritte, Strg+Z und Strg+Y holen sie zurück", () => {
    let h = leereHistorie();
    h = vorAenderung(h, A);
    h = vorAenderung(h, B);
    assert.equal(h.stack.past.length, 2);
    const u1 = schrittZurueck(h, C);
    assert.deepEqual(u1.snapshot, B);
    const u2 = schrittZurueck(u1.historie, B);
    assert.deepEqual(u2.snapshot, A);
    const w = schrittVor(u2.historie, A);
    assert.deepEqual(w.snapshot, B);
    assert.equal(schrittZurueck(leereHistorie(), A), null);
  });

  it("ein Ziehen ist ein Schritt, auch wenn die Maus mehrmals schreibt", () => {
    let h = vorAenderung(leereHistorie(), A);
    h = zieheStart(h);
    h = vorAenderung(h, B);
    h = vorAenderung(h, { walls: ["moved-1"] });
    h = vorAenderung(h, { walls: ["moved-2"] });
    assert.equal(h.stack.past.length, 2, "der Stand vor dem Ziehen plus der eine Zug");
    h = zieheEnde(h);
    h = vorAenderung(h, { walls: ["moved-2"] });
    assert.equal(h.stack.past.length, 3);
    const u = schrittZurueck(h, { walls: ["danach"] });
    assert.deepEqual(u.snapshot, { walls: ["moved-2"] });
  });

  it("Laden und der Änderungsschritt schreiben keine Historie", () => {
    const h = vorAenderung(vorAenderung(leereHistorie(), A), B, { still: true });
    assert.equal(h.stack.past.length, 1);
    assert.deepEqual(h.stack.past[0], A);
  });

  it("ein Ziehen ohne Bewegung erzeugt keinen Schritt", () => {
    const h = zieheEnde(zieheStart(leereHistorie()));
    assert.equal(h.stack.past.length, 0);
    assert.equal(h.ziehe, false);
  });
});

// 115-05a (A-6): undo snapshots follow a foreign change the studio took over - first the renumbering of local new elements
// (umbenanntJeListe), then three ways per field against the old base. Strg+Z then takes back only the own step.
describe("historieElementeUmbasieren (115-05a)", () => {
  const w = (/** @type {number} */ i, /** @type {Record<string, any>} */ extra = {}) => ({ _idx: i, a: { x: i, z: 0 }, b: { x: i + 4, z: 0 }, height: 3, ...extra });
  const FELDER = ["customWalls", "customWindows", "customStairs"];
  /** @param {any[]} past @param {any[]} [future] */
  const historie = (past, future = []) => ({ stack: { past, future }, ziehe: false, gemerkt: false });

  it("applies the renumbering first: the local new wall 5 → 7 in the snapshot, its window follows (wallIdx)", () => {
    const basis = { customWalls: [w(1)], customWindows: [] };
    const fremd = { customWalls: [w(1)], customWindows: [{ _idx: 5, wallIdx: 1, kind: "door", u: 0.5 }] };
    const s = { customWalls: [w(1), w(5)], customWindows: [{ _idx: 6, wallIdx: 5, kind: "window", u: 0.3 }], storeys: 2 };
    const r = bimHistorie.historieElementeUmbasieren(historie([s]), { basis, fremd, umbenanntJeListe: { customWalls: [[5, 7]] }, felder: FELDER });
    const neu = r.stack.past[0];
    assert.deepEqual(neu.customWalls.map((/** @type {any} */ x) => x._idx), [1, 7]);
    assert.deepEqual(neu.customWalls[1], { ...w(5), _idx: 7 });
    assert.deepEqual(neu.customWindows, [{ _idx: 6, wallIdx: 7, kind: "window", u: 0.3 }, fremd.customWindows[0]], "own window on the renumbered wall, foreign door 5 stays");
    assert.equal(neu.storeys, 2, "other keys of the snapshot are untouched");
  });

  it("foreign new elements stay in past AND future, foreign deleted untouched ones go, own changes win", () => {
    const basis = { customWalls: [w(1), w(2)] };
    const fremd = { customWalls: [w(1), w(9)] }; // the other device deleted wall 2 and drew wall 9
    const vorher = { customWalls: [w(1, { height: 4 }), w(2)] }; // my own step had changed wall 1
    const nachher = { customWalls: [w(1), w(2)] };
    const r = bimHistorie.historieElementeUmbasieren(historie([vorher], [nachher]), { basis, fremd, umbenanntJeListe: {}, felder: FELDER });
    assert.deepEqual(r.stack.past[0].customWalls, [w(1, { height: 4 }), w(9)]);
    assert.deepEqual(r.stack.future[0].customWalls, [w(1), w(9)]);
    assert.equal(r.ziehe, false);
  });

  it("returns the same object when nothing changes (snapshot equal to the foreign state, or no snapshot carries a field)", () => {
    const basis = { customWalls: [w(1)] };
    const fremd = { customWalls: [w(1), w(2)] };
    const h = historie([{ customWalls: [w(1), w(2)] }, { storeys: 3 }]);
    assert.equal(bimHistorie.historieElementeUmbasieren(h, { basis, fremd, umbenanntJeListe: {}, felder: FELDER }), h);
    const leer = leereHistorie();
    assert.equal(bimHistorie.historieElementeUmbasieren(leer, { basis, fremd, umbenanntJeListe: {}, felder: FELDER }), leer);
  });
});

// Review 115-05a (R-11505a-K03): two counters hand out the same `_idx` - this tab's counter and another writer's (a second tab, a
// massing takeover, a "Zeigen und Sagen" proposal), both start at "stored max + 1". An own element of an undo / redo snapshot that is
// not in the stored base and meets a foreign new element with the same number (other content) gets a free number before the three
// ways, so Strg+Z / Strg+Y never drops the other writer's element (before: one key `_idx:N`, a conflict, "mine" won).
describe("historieElementeUmbasieren: numbers handed out twice (review K03)", () => {
  const w = (/** @type {number} */ i, /** @type {number} */ x) => ({ _idx: i, a: { x, z: 0 }, b: { x: x + 6, z: 0 }, level: 0 });
  const tuer = (/** @type {number} */ i, /** @type {number} */ wand) => ({ _idx: i, wallIdx: wand, u: 3, kind: "door" });
  const FELDER = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen", "entranceCfg", "huelle_erscheinung"];
  const s0 = { customWalls: [w(1, 0), w(2, 10)], customWindows: [tuer(3, 1), tuer(4, 2)] };
  const fremd = { ...s0, customWalls: [w(1, 0), w(2, 10), w(5, 80)] }; // the other writer's wall 5 (x = 80 m)

  it("Strg+Z of an own deletion keeps the other writer's wall that reuses the freed number", () => {
    let h = leereHistorie();
    h = vorAenderung(h, s0); // step 1: draw wall 5 (saved)
    h = vorAenderung(h, { ...s0, customWalls: [w(1, 0), w(2, 10), w(5, 40)] }); // step 2: delete it again (saved) - stored = s0
    const h2 = bimHistorie.historieElementeUmbasieren(h, { basis: s0, fremd, umbenanntJeListe: {}, felder: FELDER, naechsteIdx: 6 });
    const r = schrittZurueck(h2, fremd);
    const xs = r.snapshot.customWalls.map((/** @type {any} */ e) => e.a.x).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    assert.deepEqual(xs, [0, 10, 40, 80], "the own wall comes back AND the other writer's wall stays");
    const idx = r.snapshot.customWalls.map((/** @type {any} */ e) => e._idx);
    assert.equal(new Set(idx).size, idx.length, "no number twice");
    assert.equal(r.snapshot.customWalls.find((/** @type {any} */ e) => e.a.x === 80)._idx, 5, "the foreign wall keeps its number");
    assert.ok(r.snapshot.customWalls.find((/** @type {any} */ e) => e.a.x === 40)._idx >= 6, "the own wall gets a free number from naechsteIdx on");
  });

  it("Strg+Y of an own new wall after a foreign wall with the same number arrived: both stay, its door follows", () => {
    let h = leereHistorie();
    h = vorAenderung(h, s0); // draw wall 5 with a door 6 on it, then Strg+Z: they wait in the redo branch
    const z = schrittZurueck(h, { ...s0, customWalls: [...s0.customWalls, w(5, 40)], customWindows: [...s0.customWindows, tuer(6, 5)] });
    const h2 = bimHistorie.historieElementeUmbasieren(z.historie, { basis: s0, fremd, umbenanntJeListe: {}, felder: FELDER, naechsteIdx: 6 });
    const r = schrittVor(h2, fremd);
    const eigene = r.snapshot.customWalls.find((/** @type {any} */ e) => e.a.x === 40);
    assert.ok(eigene && eigene._idx !== 5, `own wall renumbered: ${JSON.stringify(r.snapshot.customWalls)}`);
    assert.ok(r.snapshot.customWalls.some((/** @type {any} */ e) => e.a.x === 80 && e._idx === 5), "the other writer's wall stays after Strg+Y");
    assert.deepEqual(r.snapshot.customWindows.find((/** @type {any} */ o) => o._idx === 6), tuer(6, eigene._idx), "the door follows its wall");
    assert.ok(bimHistorie.historieNaechsteIdx(h2) > eigene._idx, "the studio's counter is raised above the snapshot numbers");
  });

  it("the same own element gets the same new number in every snapshot; equal content or a stored number is never renumbered", () => {
    const vorher = { ...s0, customWalls: [...s0.customWalls, w(5, 40)] };
    const verschoben = { ...s0, customWalls: [...s0.customWalls, w(5, 42)] };
    const h = { stack: { past: [vorher], future: [verschoben] }, ziehe: false, gemerkt: false };
    const r = bimHistorie.historieElementeUmbasieren(h, { basis: s0, fremd, umbenanntJeListe: {}, felder: FELDER, naechsteIdx: 6 });
    const nr = (/** @type {any} */ s, /** @type {number} */ x) => s.customWalls.find((/** @type {any} */ e) => e.a.x === x)?._idx;
    assert.equal(nr(r.stack.past[0], 40), nr(r.stack.future[0], 42), "one element, one new number");
    // the foreign wall 5 equals the snapshot's wall 5: the same element on both sides, nothing to renumber
    const gleich = { stack: { past: [fremd], future: [] }, ziehe: false, gemerkt: false };
    assert.equal(bimHistorie.historieElementeUmbasieren(gleich, { basis: s0, fremd, umbenanntJeListe: {}, felder: FELDER, naechsteIdx: 6 }), gleich);
    // a number of the stored base is never renumbered (the other writer changed the stored wall 2: three ways decide)
    const fremd2 = { ...s0, customWalls: [w(1, 0), w(2, 12)] };
    const h3 = { stack: { past: [{ ...s0, customWalls: [w(1, 0), w(2, 10)] }], future: [] }, ziehe: false, gemerkt: false };
    const r3 = bimHistorie.historieElementeUmbasieren(h3, { basis: s0, fremd: fremd2, umbenanntJeListe: {}, felder: FELDER, naechsteIdx: 6 });
    assert.deepEqual(r3.stack.past[0].customWalls.map((/** @type {any} */ e) => e._idx), [1, 2]);
  });

  it("a 'new' foreign element equal to the page's own element (its save raced the event) is not foreign: the snapshot keeps its number", () => {
    // own wall 5 was drawn and moved; its save landed after the base the page knew - the event carries it as if new
    const lokal = { ...s0, customWalls: [...s0.customWalls, w(5, 80)] };
    const h = { stack: { past: [{ ...s0, customWalls: [...s0.customWalls, w(5, 40)] }], future: [] }, ziehe: false, gemerkt: false };
    const r = bimHistorie.historieElementeUmbasieren(h, { basis: s0, fremd, umbenanntJeListe: {}, felder: FELDER, lokal, naechsteIdx: 6 });
    assert.deepEqual(r.stack.past[0].customWalls.map((/** @type {any} */ e) => [e._idx, e.a.x]), [[1, 0], [2, 10], [5, 40]], "Strg+Z moves the own wall back");
  });
});
