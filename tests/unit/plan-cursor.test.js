// Unit tests for the plan cursors (Phase 75-01, MS-01).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FADENKREUZ_CURSOR, ECKE_CURSOR, PLUS_CURSOR, kantenCursor, normiereKantenWinkel, kantenCacheGroesse, cursorCss,
} from "@core/lib/planCursor";

describe("planCursor — Hotspot und Fallback", () => {
  it("jeder feste Cursor trägt den Hotspot 10 10 und endet auf ein CSS-Schlüsselwort", () => {
    for (const c of [FADENKREUZ_CURSOR, ECKE_CURSOR, PLUS_CURSOR]) {
      assert.match(c, /^url\("data:image\/svg\+xml,/);
      assert.match(c, /"\) 10 10, (crosshair|copy)$/);
    }
  });

  it("cursorCss kodiert das SVG URL-sicher (keine rohen < oder #)", () => {
    const css = cursorCss('<svg fill="#fff"></svg>', 3, 4, "move");
    assert.ok(!css.includes("<svg"));
    assert.ok(!css.includes("#fff"));
    assert.match(css, /\) 3 4, move$/);
  });
});

describe("planCursor — kantenCursor", () => {
  it("normiert Winkel auf 0–180 (200° ≙ 20°, −30° ≙ 150°)", () => {
    assert.equal(normiereKantenWinkel(200), 20);
    assert.equal(normiereKantenWinkel(-30), 150);
    assert.equal(kantenCursor(200), kantenCursor(20));
  });

  it("liefert höchstens acht verschiedene Varianten über 0…179°", () => {
    const set = new Set();
    for (let w = 0; w < 180; w += 5) set.add(kantenCursor(w));
    assert.equal(set.size, 8);
    assert.equal(kantenCacheGroesse(), 8);
  });

  it("Fallback folgt der Normalen: waagerechte Kante → ns-resize, senkrechte → ew-resize", () => {
    assert.match(kantenCursor(0), /, ns-resize$/);
    assert.match(kantenCursor(90), /, ew-resize$/);
  });
});
