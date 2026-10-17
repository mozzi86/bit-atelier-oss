// 98-06: sandbox terrain — soft raise/lower, smoothing, stamping a building pad, earth volumes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leeresGelaende, hoeheAn, formen, glaetten, stempeln, erdmassen, MAX_KNOTEN } from "@core/lib/massing/gelaende.js";

test("leeres Gelände: Knoten, Grenzen, zu fein → Fehler", () => {
  const g = leeresGelaende(20, 10, { zelle: 1 });
  assert.equal(g.nx * g.ny, 21 * 11);
  assert.throws(() => leeresGelaende(0, 10), /> 0/);
  assert.throws(() => leeresGelaende(1000, 1000, { zelle: 1 }), new RegExp(`höchstens ${MAX_KNOTEN}`));
});

test("Formen: Mitte um delta, weicher Rand, außerhalb des Radius unverändert; Auftrag gemessen", () => {
  const g = leeresGelaende(20, 20);
  const f = formen(g, { x: 10, y: 10 }, 5, 2);
  assert.equal(hoeheAn(f, { x: 10, y: 10 }), 2);
  assert.ok(hoeheAn(f, { x: 12, y: 10 }) > 0 && hoeheAn(f, { x: 12, y: 10 }) < 2);
  assert.equal(hoeheAn(f, { x: 16, y: 10 }), 0);
  const m = erdmassen(g, f);
  assert.equal(m.abtrag, 0);
  assert.ok(m.auftrag > 30 && m.auftrag < 90, `Auftrag ${m.auftrag}`);
  assert.ok(erdmassen(f, g).abtrag === m.auftrag, "Absenken = derselbe Abtrag");
});

test("Glätten nähert die Spitze dem Umfeld; Stempeln ebnet die Fläche und meldet Erdmengen", () => {
  const g = formen(leeresGelaende(20, 20), { x: 10, y: 10 }, 3, 3);
  const gl = glaetten(g, { x: 10, y: 10 }, 4, 1);
  assert.ok(hoeheAn(gl, { x: 10, y: 10 }) < 3);
  const s = stempeln(g, [{ x: 8, y: 8 }, { x: 12.5, y: 8 }, { x: 12.5, y: 12.5 }, { x: 8, y: 12.5 }], 0);
  assert.equal(hoeheAn(s.gelaende, { x: 10, y: 10 }), 0);
  assert.ok(s.abtrag > 0 && s.auftrag === 0);
  const auf = stempeln(leeresGelaende(10, 10), [{ x: 2, y: 2 }, { x: 4.5, y: 2 }, { x: 4.5, y: 4.5 }, { x: 2, y: 4.5 }], 1);
  assert.equal(auf.auftrag, 9, "3 × 3 Knoten à 1 m² × 1 m");
});
