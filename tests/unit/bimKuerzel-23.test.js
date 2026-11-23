// Phase 23 evidence (BIM editor, cluster D): the help popover is fed from the SHORTCUTS map in BitBimStudio.jsx, the keys are
// handled by ONE capture-phase keydown listener in the same file. The map is meant to be the source for both, but the handler
// keeps its own if-chain — so this test reads both from the source and pins that every key the handler reacts to is listed in
// the popover. The browser side (popover rows, W/S/D/V, F, Strg+D) is tests/e2e/bim-editor-23.spec.js.
// In: BitBimStudio.jsx as text (node cannot import JSX here). Out: assertions on the two key sets.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const QUELLE = readFileSync(new URL("../../packages/nova-designer/src/components/BitBimStudio.jsx", import.meta.url), "utf8");

/** `keys` column of the SHORTCUTS map. */
function kuerzelTabelle() {
  const start = QUELLE.indexOf("const SHORTCUTS = [");
  assert.ok(start >= 0, "SHORTCUTS-Map nicht gefunden");
  const ende = QUELLE.indexOf("];", start);
  return [...QUELLE.slice(start, ende).matchAll(/keys: "([^"]+)"/g)].map((m) => m[1]);
}

/** Body of the BIM-D keydown handler (from `const onKey =` to the listener registration). */
function handlerText() {
  const marke = QUELLE.indexOf("// ---- BIM-D: keyboard shortcuts.");
  assert.ok(marke >= 0, "BIM-D-Handler nicht gefunden");
  const start = QUELLE.indexOf("const onKey = (e) => {", marke);
  const ende = QUELLE.indexOf('window.addEventListener("keydown", onKey, true)', start);
  assert.ok(start > 0 && ende > start, "onKey-Rumpf nicht gefunden");
  return QUELLE.slice(start, ende);
}

describe("23 Tastaturkürzel (BIM-D): Popover-Tabelle ↔ Handler", () => {
  const tabelle = kuerzelTabelle();
  const handler = handlerText();
  /** e.key literals the handler compares with, upper-cased (letters: both cases collapse to one entry). */
  const tasten = new Set([...handler.matchAll(/e\.key === "([^"]+)"/g)].map((m) => (m[1].length === 1 ? m[1].toUpperCase() : m[1])));

  it("the map has the documented 19 rows, no duplicates", () => {
    assert.equal(tabelle.length, 19); // 18 + F3 (F-23-01)
    assert.equal(new Set(tabelle).size, tabelle.length);
  });

  it("every plain letter the handler reacts to (tool keys, F) is a row of the popover", () => {
    const buchstaben = [...tasten].filter((k) => /^[A-Z]$/.test(k));
    assert.deepEqual(buchstaben.sort(), ["D", "F", "S", "V", "W"]); // D also as Strg+D
    for (const b of buchstaben) assert.ok(tabelle.includes(b), `Taste ${b} fehlt im Popover`);
  });

  it("Strg+D, undo/redo, arrows with and without Shift, Delete and Esc are rows of the popover", () => {
    assert.ok(tasten.has("Escape") && tasten.has("Delete"), "Handler kennt Esc und Entf");
    assert.match(handler, /e\.key\.startsWith\("Arrow"\)/);
    assert.match(handler, /const step = e\.shiftKey \? 1 : 0\.1; \/\/ m/); // 0,1 m, Shift 1 m — as the popover says
    for (const k of ["Strg+D", "Strg+Z", "Strg+Y", "Pfeiltasten", "Shift+Pfeil", "Entf", "Esc"]) assert.ok(tabelle.includes(k), `${k} fehlt im Popover`);
    assert.match(QUELLE, /\{ keys: "Pfeiltasten", desc: "Auswahl verschieben \(0,1 m\)" \}/);
    assert.match(QUELLE, /\{ keys: "Shift\+Pfeil", desc: "Auswahl verschieben \(1 m\)" \}/);
  });

  // FINDING F-23-01 (fixed in the belege finish): F3 starts / ends the 3D walk-through (261110-mzj) and is handled by this
  // listener, but the help popover did not list it. Red before the fix: "F3 fehlt im Popover".
  it("F3 (Durchlaufen) is handled by the listener and must be a row of the popover", () => {
    assert.ok(tasten.has("F3"), "Handler kennt F3");
    assert.ok(tabelle.includes("F3"), "F3 fehlt im Popover");
  });
});
