// Grundriss-Bedienung Teil 1, Punkt 1: a wall deleted in the studio takes its doors and windows with it (the rule of the drawing
// agent, zeichnenModell.elementLoeschen), and ONE undo step brings both back (the studio's setters share one bimHistorie step).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { oeffnungenOhneWaende, leeresZeichenmodell, wandAnlegen, oeffnungAnlegen, elementLoeschen } from "@designer/lib/zeichnenModell.js";
import { leereHistorie, vorAenderung, schrittZurueck } from "@designer/lib/bimHistorie";

// neutral test geometry: two walls along x, one opening on each
const WAENDE = [{ _idx: 1, a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0 }, { _idx: 2, a: { x: 0, z: 4 }, b: { x: 6, z: 4 }, level: 0 }];
const OEFFNUNGEN = [{ _idx: 10, wallIdx: 1, u: 2, kind: "door" }, { _idx: 11, wallIdx: 2, u: 3, kind: "window" }];

describe("Wand löschen nimmt Öffnungen mit", () => {
  it("nur die Öffnungen der gelöschten Wand gehen, die anderen bleiben unverändert", () => {
    const rest = oeffnungenOhneWaende(OEFFNUNGEN, [1]);
    assert.deepEqual(rest.map((o) => o._idx), [11]);
    assert.equal(rest[0], OEFFNUNGEN[1], "der verbleibende Satz ist derselbe Gegenstand");
    assert.deepEqual(oeffnungenOhneWaende(OEFFNUNGEN, new Set([1, 2])), []);
  });

  it("ohne betroffene Öffnung kommt dieselbe Liste zurück (kein unnötiger Schritt)", () => {
    assert.equal(oeffnungenOhneWaende(OEFFNUNGEN, [99]), OEFFNUNGEN);
    assert.equal(oeffnungenOhneWaende(OEFFNUNGEN, []), OEFFNUNGEN);
    assert.deepEqual(oeffnungenOhneWaende(null, [1]), []);
  });

  it("der Zeichen-Agent nutzt dieselbe Regel", () => {
    const w = wandAnlegen(leeresZeichenmodell(), { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0 });
    const o = oeffnungAnlegen(w.modell, { wandId: 1, kind: "door", versatz_m: 2 });
    const weg = elementLoeschen(o.modell, { art: "wall", id: 1 });
    assert.equal(weg.modell.customWindows.length, 0);
  });

  it("ein Rückgängig-Schritt stellt Wand und Öffnung zusammen wieder her", () => {
    // the studio: two setters in one handler, each calls merken() with the snapshot from BEFORE the change → one step
    const vorher = { customWalls: WAENDE, customWindows: OEFFNUNGEN };
    let h = leereHistorie();
    h = vorAenderung(h, vorher); // setCustomWalls
    h = vorAenderung(h, vorher); // setCustomWindows (same render, same snapshot)
    assert.equal(h.stack.past.length, 1, "ein Schritt");
    const nachher = { customWalls: WAENDE.filter((w) => w._idx !== 1), customWindows: oeffnungenOhneWaende(OEFFNUNGEN, [1]) };
    const r = schrittZurueck(h, nachher);
    assert.deepEqual(r.snapshot.customWalls.map((w) => w._idx), [1, 2]);
    assert.deepEqual(r.snapshot.customWindows.map((o) => o._idx), [10, 11]);
  });
});
