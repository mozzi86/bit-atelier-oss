// 106-01: the state colours of zustaende.js are hex copies of the LIGHT-theme tokens of index.css.
// This test parses packages/nova-core/src/index.css and compares, so a token change that is not
// copied turns the run red (before: a comment claimed equality, nothing checked it).
// Style: node:test, German titles. HSL to sRGB: CSS Color 4 formula, rounded to 8 bit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ZEIGE_ZUSTAENDE } from "@core/lib/zeigen/zustaende.js";
import { SELECT_COLOR } from "@ifc/lib/ifcGeometry.js";

const CSS = readFileSync(new URL("../../packages/nova-core/src/index.css", import.meta.url), "utf8");

/** Value of a custom property in the FIRST block that defines it (:root = light theme). */
function token(name) {
  const m = CSS.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%`));
  assert.ok(m, `Token --${name} nicht in index.css gefunden`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** "H S% L%" to "#rrggbb". */
function hslHex([h, s, l]) {
  const sat = s / 100, lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Largest per-channel difference of two "#rrggbb" values, 0..255. */
function abstand(a, b) {
  return Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))));
}

describe("Zustandsfarben gegen die Tokens aus index.css", () => {
  // Tolerance 1/255 per channel: rounding of the HSL conversion only; a real token change is larger.
  const TOLERANZ = 1;
  for (const [zustand, tokenName] of [["fokus", "ring"], ["warnung", "warnung"], ["fehler", "fehler"]]) {
    it(`${zustand} entspricht --${tokenName} (hell)`, () => {
      const erwartet = hslHex(token(tokenName));
      assert.ok(abstand(ZEIGE_ZUSTAENDE[zustand].hex, erwartet) <= TOLERANZ, `${zustand}: Tabelle ${ZEIGE_ZUSTAENDE[zustand].hex}, Token ${erwartet}`);
    });
  }

  it("auswahl entspricht SELECT_COLOR des IFC-Viewers (kein Token vorhanden)", () => {
    ZEIGE_ZUSTAENDE.auswahl.rgb.forEach((v, i) => assert.ok(Math.abs(v - SELECT_COLOR[i]) < 0.005, `Kanal ${i}`));
  });

  it("der Dunkelmodus hat andere Werte: die 3D-Ansichten sind hell und folgen ihm bewusst nicht", () => {
    const dunkel = CSS.match(/--warnung:\s*46 97% 55%/);
    assert.ok(dunkel, "Dunkel-Token --warnung 46 97% 55% (sonst Kommentar in zustaende.js prüfen)");
  });
});
