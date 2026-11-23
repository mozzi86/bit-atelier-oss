// 115-05d (C-2 … C-4): one undo history of the site data per designer page — a gesture is one step, 99 steps, one order for
// several histories of a page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leereKomplexHistorie, aufzeichnen, gesteStart, gesteEnde, gesteAbbrechen, schrittZurueck, schrittVor, neuesterVerlauf, verlaufNummern, naechsteNr } from "@core/lib/komplexHistorie.js";
import { UNDO_MAX } from "@core/lib/undoStack";

const st = (/** @type {number} */ x) => ({ site_parcel: { points: [{ x, y: 0 }] }, buildings: [] });

test("steps come back in order, redo mirrors undo, a new change clears redo", () => {
  let h = leereKomplexHistorie();
  h = aufzeichnen(h, st(0), { label: "Grundstück" });
  h = aufzeichnen(h, st(1), { label: "Baufeld" });
  const a = schrittZurueck(h, st(2));
  assert.deepEqual([a.werte, a.label], [st(1), "Baufeld"]);
  const b = schrittZurueck(a.historie, st(1));
  assert.deepEqual([b.werte, b.label], [st(0), "Grundstück"]);
  assert.equal(schrittZurueck(b.historie, st(0)), null);
  const c = schrittVor(b.historie, st(0));
  assert.deepEqual([c.werte, c.label], [st(1), "Grundstück"], "redo of the first step, under its label");
  const d = schrittVor(c.historie, st(1));
  assert.deepEqual(d.werte, st(2));
  assert.equal(schrittVor(d.historie, st(2)), null);
  assert.equal(aufzeichnen(a.historie, st(1)).future.length, 0);
});

test("a gesture is one step: only the state of the press is stored", () => {
  let h = gesteStart(leereKomplexHistorie());
  for (let x = 0; x < 30; x += 1) h = aufzeichnen(h, st(x)); // every pointer move reports the state before it
  h = gesteEnde(h);
  assert.equal(h.past.length, 1);
  assert.deepEqual(h.past[0].werte, st(0));
  h = aufzeichnen(h, st(30));
  assert.equal(h.past.length, 2, "after the release the next change is a new step");
  assert.equal(gesteEnde(leereKomplexHistorie()).ziehe, false);
});

test("a cancelled gesture leaves no step — but only when the state really is the one of the press", () => {
  let h = aufzeichnen(leereKomplexHistorie(), st(9));
  h = gesteStart(h);
  h = aufzeichnen(h, st(0));
  h = aufzeichnen(h, st(1));
  assert.equal(gesteAbbrechen(h, st(5)), h, "state differs from the press: nothing removed");
  const weg = gesteAbbrechen(h, st(0));
  assert.deepEqual(weg.past.map((s) => s.werte), [st(9)]);
  // still the same gesture: a further move stores the press again
  assert.equal(aufzeichnen(weg, st(0)).past.length, 2);
  assert.equal(gesteAbbrechen(aufzeichnen(leereKomplexHistorie(), st(0)), st(0)).past.length, 1, "no gesture: nothing removed");
});

test("99 steps, the oldest fall out; an equal state is not stored twice", () => {
  let h = leereKomplexHistorie();
  for (let x = 0; x < 100; x += 1) h = aufzeichnen(h, st(x));
  assert.equal(UNDO_MAX, 99);
  assert.equal(h.past.length, 99);
  assert.deepEqual(h.past[0].werte, st(1));
  let n = 0;
  for (let r = schrittZurueck(h, st(100)); r; r = schrittZurueck(r.historie, r.werte)) n += 1;
  assert.equal(n, 99, "99 times undo after 100 changes");
  assert.equal(aufzeichnen(h, st(99)).past.length, 99);
});

test("one order for several histories: undo takes the newest step, redo brings them back in the order they were made", () => {
  let lage = leereKomplexHistorie(), modell = leereKomplexHistorie();
  lage = aufzeichnen(lage, "L0", { nr: naechsteNr() });
  modell = aufzeichnen(modell, "M0", { nr: naechsteNr() });
  lage = aufzeichnen(lage, "L1", { nr: naechsteNr() });
  const liste = () => [{ name: "lage", ...verlaufNummern(lage) }, { name: "modell", ...verlaufNummern(modell) }];
  /** @type {string[]} */
  const folge = [];
  for (let i = 0; i < 3; i += 1) {
    const name = neuesterVerlauf(liste());
    folge.push(String(name));
    if (name === "lage") lage = schrittZurueck(lage, "L").historie; else modell = schrittZurueck(modell, "M").historie;
  }
  assert.deepEqual(folge, ["lage", "modell", "lage"]);
  assert.equal(neuesterVerlauf(liste()), null);
  /** @type {string[]} */
  const wieder = [];
  for (let i = 0; i < 3; i += 1) {
    const name = neuesterVerlauf(liste(), "vor");
    wieder.push(String(name));
    if (name === "lage") lage = schrittVor(lage, "L").historie; else modell = schrittVor(modell, "M").historie;
  }
  assert.deepEqual(wieder, ["lage", "modell", "lage"]);
  assert.equal(neuesterVerlauf([]), null);
  assert.equal(neuesterVerlauf([{ name: "x" }]), null);
});
