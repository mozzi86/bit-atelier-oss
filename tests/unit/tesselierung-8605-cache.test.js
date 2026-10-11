// 86-05a: the bar-decomposition cache of tesselierung.js — `riegelMinFlaeche_m2` as a parameter,
// a cache key that carries every input (a changed minimum must never return a stale
// decomposition), an LRU bound instead of clear(), and zerlegungFuer() = what tesseliere() uses.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  tesseliere, riegelZerlegung, zerlegungFuer, zerlegungCacheLeeren, zerlegungCacheGroesse, ZERLEGUNG_CACHE_MAX, FORM_RIEGEL,
} from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { FOOTPRINTS } from "../e2e/fixtures/footprints.js";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const L = FOOTPRINTS.L.footprintM;
const FUENFECK = FOOTPRINTS.fuenfeck.footprintM;
/** Comparable part of a decomposition (without the `form` object). */
const kern = (z) => JSON.stringify({ riegel: z.riegel, basis: z.basis, abstand_m: z.abstand_m });

describe("86-05a — Zerlegungs-Cache", () => {
  it("Cache liefert dieselbe Wahl wie ohne Cache (L, Mittelflur)", () => {
    zerlegungCacheLeeren();
    const frisch = riegelZerlegung(L, "mittelflur", { geschosse: 4, geschosshoehe_m: 3 });
    const ausCache = riegelZerlegung(L, "mittelflur", { geschosse: 4, geschosshoehe_m: 3 });
    zerlegungCacheLeeren();
    const nochmal = riegelZerlegung(L, "mittelflur", { geschosse: 4, geschosshoehe_m: 3 });
    assert.equal(kern(ausCache), kern(frisch));
    assert.equal(kern(nochmal), kern(frisch));
    assert.equal(frisch.riegel.length, 2);
  });

  it("andere Mindestfläche → anderer Schlüssel: Ergebnisse wechseln sich nicht gegenseitig aus", () => {
    zerlegungCacheLeeren();
    const o = (m) => ({ geschosse: 4, geschosshoehe_m: 3, riegelMinFlaeche_m2: m });
    const a120 = riegelZerlegung(FUENFECK, "mittelflur", o(120));
    const a600 = riegelZerlegung(FUENFECK, "mittelflur", o(600));
    assert.notEqual(kern(a600), kern(a120), "600 m² Mindestfläche ändert die Zerlegung des Fünfecks");
    // Interleaved hits must return the result of the SAME parameter, not the last one computed.
    assert.equal(kern(riegelZerlegung(FUENFECK, "mittelflur", o(120))), kern(a120));
    assert.equal(kern(riegelZerlegung(FUENFECK, "mittelflur", o(600))), kern(a600));
    zerlegungCacheLeeren();
    assert.equal(kern(riegelZerlegung(FUENFECK, "mittelflur", o(600))), kern(a600));
    assert.ok(a600.riegel.length < a120.riegel.length);
  });

  it("Default bleibt 120 m²: ohne Parameter = mit 120 = mit 0/ungültig", () => {
    zerlegungCacheLeeren();
    const ohne = riegelZerlegung(FUENFECK, "mfh", { geschosse: 4, geschosshoehe_m: 3 });
    assert.equal(FORM_RIEGEL.minFlaeche_m2, 120);
    assert.equal(kern(riegelZerlegung(FUENFECK, "mfh", { geschosse: 4, geschosshoehe_m: 3, riegelMinFlaeche_m2: 120 })), kern(ohne));
    assert.equal(kern(riegelZerlegung(FUENFECK, "mfh", { geschosse: 4, geschosshoehe_m: 3, riegelMinFlaeche_m2: 0 })), kern(ohne));
    assert.equal(kern(riegelZerlegung(FUENFECK, "mfh", { geschosse: 4, geschosshoehe_m: 3, riegelMinFlaeche_m2: "x" })), kern(ohne));
  });

  it("LRU: nie mehr als ZERLEGUNG_CACHE_MAX Einträge, der jüngste bleibt", () => {
    zerlegungCacheLeeren();
    for (let m = 120; m < 120 + ZERLEGUNG_CACHE_MAX + 10; m += 1) riegelZerlegung(L, "mittelflur", { geschosse: 4, geschosshoehe_m: 3, riegelMinFlaeche_m2: m });
    assert.equal(zerlegungCacheGroesse(), ZERLEGUNG_CACHE_MAX);
    const letzter = 120 + ZERLEGUNG_CACHE_MAX + 9;
    const vorher = zerlegungCacheGroesse();
    riegelZerlegung(L, "mittelflur", { geschosse: 4, geschosshoehe_m: 3, riegelMinFlaeche_m2: letzter });
    assert.equal(zerlegungCacheGroesse(), vorher, "Treffer legt keinen neuen Eintrag an");
    zerlegungCacheLeeren();
    assert.equal(zerlegungCacheGroesse(), 0);
  });

  it("zerlegungFuer = Zerlegung, die tesseliere benutzt (Riegelzahl und Rechtecke)", () => {
    zerlegungCacheLeeren();
    for (const [fp, typ, m] of [[L, "mittelflur", undefined], [FUENFECK, "mittelflur", 120], [FUENFECK, "mittelflur", 600]]) {
      const opts = { footprintM: fp, storeys: 4, typ, einheiten: STD, raumzonen: true, okf_m: 9, riegelMinFlaeche_m2: m };
      const z = zerlegungFuer(opts);
      const r = tesseliere(opts);
      assert.equal(r.form.riegel ? r.form.riegel.length : 1, z.riegel.length, `${typ} ${m}`);
    }
    assert.equal(zerlegungFuer({ footprintM: null, typ: "mfh" }), null);
    // Axis-parallel rectangle: tesseliere skips the fit entirely (formEinpassung → null), so does zerlegungFuer.
    assert.equal(zerlegungFuer({ footprintM: FOOTPRINTS.rechteck_70x16.footprintM, typ: "mfh" }), null);
    // Rotated rectangle: fitted, one bar.
    const gedreht = FOOTPRINTS.rechteck_70x16.footprintM.map((p) => ({ x: p.x * Math.cos(0.4) - p.z * Math.sin(0.4), z: p.x * Math.sin(0.4) + p.z * Math.cos(0.4) }));
    assert.equal(zerlegungFuer({ footprintM: gedreht, typ: "mfh" }).riegel.length, 1);
  });

  it("tesseliere mit riegelMinFlaeche_m2: Fünfeck 600 m² → weniger Riegel als Default, Rechteck unberührt", () => {
    const basis = { storeys: 4, einheiten: STD, raumzonen: true };
    const a = tesseliere({ ...basis, footprintM: FUENFECK, typ: "mittelflur" });
    const b = tesseliere({ ...basis, footprintM: FUENFECK, typ: "mittelflur", riegelMinFlaeche_m2: 600 });
    assert.ok((b.form.riegel?.length ?? 1) < a.form.riegel.length);
    const r1 = tesseliere({ ...basis, footprintM: FOOTPRINTS.rechteck_70x16.footprintM, typ: "mittelflur" });
    const r2 = tesseliere({ ...basis, footprintM: FOOTPRINTS.rechteck_70x16.footprintM, typ: "mittelflur", riegelMinFlaeche_m2: 600 });
    assert.equal(JSON.stringify(r2), JSON.stringify(r1));
  });
});
