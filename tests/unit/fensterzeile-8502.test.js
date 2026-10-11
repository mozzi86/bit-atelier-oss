// Unit tests for 85-02 (packages/nova-designer/src/lib/tesselierung.js): in a DEEP band the
// window-room row is cut to an aspect-ratio target instead of taking the whole rest depth
// (deep Laubengang: Schlafen 2,8 × 9 m = 1 : 3,2 = fail). The depth the row gives up goes to
// the inner zone; rows below the fail threshold are not touched; ONE hint per building.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, raumSlicing, wohnungsRegeln, FENSTERZEILE_MIN_TIEFE_M, MINDESTBREITEN } from "@designer/lib/tesselierung";
import { pruefeAlle } from "@designer/lib/raumQualitaet";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const FAIL = wohnungsRegeln({ wohnungsgrundriss: true }).seitenverhaeltnisFail;
const bbox = (z) => { const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z); return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }; };
const verhaeltnis = (z) => { const b = bbox(z); return Math.max(b.w, b.d) / Math.min(b.w, b.d); };
const seitenFails = (r) => pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })
  .flatMap((q) => q.eintraege).filter((e) => e.regel === "seitenverhaeltnis" && e.stufe === "fail");

describe("85-02 — tiefer Laubengang: keine Schlauch-Fensterräume", () => {
  for (const [name, E] of [["STD", STD], ["REF", REF]]) {
    for (const [w, d, n] of [[40, 12, 3], [60, 14, 2], [40, 16, 1]]) {
      it(`${name} Laubengang ${w} × ${d}: kein Seitenverhältnis-Fail (vorher 12–32)`, () => {
        const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ: "laubengang", einheiten: E, raumzonen: true });
        const f = seitenFails(r);
        assert.equal(f.length, 0, f.slice(0, 3).map((e) => e.text).join(" | "));
      });
    }
  }

  it("ein einziger Hinweis [85-02] je Gebäude, nicht je Wohnung — mit Zeilentiefe und Innenzone", () => {
    const r = tesseliere({ footprintM: rect(60, 14), storeys: 2, typ: "laubengang", einheiten: STD, raumzonen: true });
    const h = r.hinweise.filter((s) => /\[85-02\]/.test(s));
    assert.equal(h.length, 1, h.join(" | "));
    assert.match(h[0], /Bandtiefe 12,7 m/);
    assert.match(h[0], /Zeilentiefe/);
    assert.match(h[0], /Nebenzone/);
    assert.ok(!(r.raumWarns || []).some((s) => /85-02/.test(s)), "nicht zusätzlich je WE in raumWarns");
  });

  it("die Wohnungszahl und die Leerfläche bleiben (nur die Tiefe wird anders verteilt)", () => {
    const r = tesseliere({ footprintM: rect(60, 14), storeys: 2, typ: "laubengang", einheiten: STD, raumzonen: true });
    assert.equal(r.weListe.length, 18, "wie vor 85-02 (9 WE je Geschoss)");
    assert.ok(r.rest_m2 - (r.restNachfrage_m2 || 0) < 15, `leer ${r.rest_m2}`);
  });

  it("flache Bänder bleiben unberührt: Laubengang 30 × 10, Mittelflur 40 × 16, Spänner 24 × 18 ohne [85-02]", () => {
    const f = [
      tesseliere({ footprintM: rect(30, 10), storeys: 2, typ: "laubengang", einheiten: STD, raumzonen: true }),
      tesseliere({ footprintM: rect(40, 16), storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true }),
      tesseliere({ footprintM: rect(24, 18), storeys: 3, typ: "spaenner", einheiten: STD, raumzonen: true }),
    ];
    for (const r of f) assert.ok(!r.hinweise.some((s) => /85-02/.test(s)), r.hinweise.filter((s) => /85-02/.test(s)).join(" | "));
  });
});

describe("85-02 — raumSlicing: Fensterzeile gekappt, Tiefe geht an die Nebenzone", () => {
  const e = STD.find((t) => t.key === "st-3zi");
  // 3-room unit 9,20 m wide in a 12,65 m deep band, windows at z = D (as in the Laubengang).
  const band = (w, d) => ({ rechteck: { x0: 0, x1: w, z0: 0, z1: d }, fassadeBei: d, achse: "x", level: 0, we: "t" });
  const slice = (w, d) => raumSlicing(band(w, d), e.raumprogramm, { wohnungsgrundriss: true });

  it("tiefe Zeile wird gekappt: kein Aufenthaltsraum ≥ Fail-Schwelle, kappung meldet Zeile + Innenzone = Bandtiefe − Flur", () => {
    const z = slice(9.2, 12.65);
    assert.ok(z.kappung, "kappung gesetzt");
    for (const q of z.filter((x) => x.art === "aufenthalt")) assert.ok(verhaeltnis(q) < FAIL, `${q.name} 1 : ${verhaeltnis(q).toFixed(2)}`);
    assert.ok(z.kappung.fensterzeile_m >= FENSTERZEILE_MIN_TIEFE_M);
    assert.ok(Math.abs(z.kappung.fensterzeile_m + z.kappung.nebenzone_m + MINDESTBREITEN.flur - 12.65) < 1e-9, "Zeile + Flur + Innenzone = Bandtiefe");
  });

  it("keine Lücke: die Zonen füllen das Rechteck lückenlos (Σ Fläche = Breite × Tiefe)", () => {
    const z = slice(9.2, 12.65);
    const summe = z.reduce((s, q) => s + q.flaeche_m2, 0);
    assert.ok(Math.abs(summe - 9.2 * 12.65) < 0.01, `${summe} vs ${9.2 * 12.65}`);
  });

  it("flaches Band (Tiefe 9 m): kein kappung-Feld, Zeile füllt wie bisher", () => {
    const z = slice(9.2, 9);
    assert.equal(z.kappung, undefined);
  });

  it("Regel aus (kein seitenverhaeltnisFail): nichts wird gekappt", () => {
    const z = raumSlicing(band(9.2, 12.65), e.raumprogramm, { wohnungsgrundriss: true, seitenverhaeltnisMax: 0 });
    assert.equal(z.kappung, undefined);
  });
});
