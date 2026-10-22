// A failed chunk import reloads the route once by itself (the card's own advice), at most once per route
// within 60 s; program errors never reload; blocked storage → no reload (no loop risk).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { automatischNeuLaden, NEULADEN_SPERRE_MS } from "@core/lib/fehlerbericht";

const speicher = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const ladefehler = new TypeError("Failed to fetch dynamically imported module: http://localhost/pages/X.jsx");

describe("automatischNeuLaden", () => {
  it("Ladefehler: einmal ja, innerhalb der Sperre nein, danach wieder ja", () => {
    const s = speicher();
    assert.equal(automatischNeuLaden({ fehler: ladefehler, pfad: "/A", jetzt: 1_000_000, speicher: s }), true);
    assert.equal(automatischNeuLaden({ fehler: ladefehler, pfad: "/A", jetzt: 1_000_000 + 5_000, speicher: s }), false);
    assert.equal(automatischNeuLaden({ fehler: ladefehler, pfad: "/B", jetzt: 1_000_000 + 5_000, speicher: s }), true, "andere Route");
    assert.equal(automatischNeuLaden({ fehler: ladefehler, pfad: "/A", jetzt: 1_000_000 + NEULADEN_SPERRE_MS + 1, speicher: s }), true);
  });
  it("Programmfehler oder fehlender Speicher: nie", () => {
    assert.equal(automatischNeuLaden({ fehler: new Error("x is undefined"), pfad: "/A", speicher: speicher() }), false);
    assert.equal(automatischNeuLaden({ fehler: ladefehler, pfad: "/A", speicher: null }), false);
    const kaputt = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
    assert.equal(automatischNeuLaden({ fehler: ladefehler, pfad: "/A", speicher: kaputt }), false);
  });
});
