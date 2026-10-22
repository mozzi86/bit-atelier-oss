// LO-01 (REVIEW-PANELS): inputs that used to have no effect now feed the calculations —
// snow load sk (statics), charge points (electrical connected load), fire brigade access (outdoor checks).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { schneelastDach, gebaeudelast, stuetzenVordim, SK_MINDEST_JE_ZONE } from "@designer/lib/statics";
import { ladeleistung } from "@designer/lib/hvac";
import { aussenanlagenChecks } from "@designer/lib/landscape";

describe("LO-01 Eingaben mit Rechenwirkung", () => {
  it("Schnee: 0,8 · 0,85 kN/m² · 400 m² = 272 kN, einmal auf die Gebäudelast", () => {
    assert.equal(schneelastDach({ sk: 0.85, footArea: 400 }), 272);
    assert.equal(gebaeudelast(1000, 4, 272), 4272);
    assert.equal(gebaeudelast(1000, 4), 4000, "ohne Zusatz wie bisher");
    const ohne = stuetzenVordim({ gesamtlastProGeschoss: 1000, storeys: 4, footArea: 400, einzugA: 36, fcd: 20000 });
    const mit = stuetzenVordim({ gesamtlastProGeschoss: 1000, storeys: 4, footArea: 400, einzugA: 36, fcd: 20000, zusatzKn: 272 });
    assert.ok(mit > ohne);
    assert.equal(SK_MINDEST_JE_ZONE["2"], 0.85);
  });

  it("Ladepunkte: 10 · 11 kW · 0,3 = 33 kW", () => {
    assert.ok(Math.abs(ladeleistung({ ladepunkte: 10 }) - 33) < 1e-9);
    assert.equal(ladeleistung({ ladepunkte: 0 }), 0);
  });

  it("Feuerwehr-Zufahrt: 2,8 m warnt, 3,0 m passt, nicht erforderlich passt beide Zeilen", () => {
    const zeile = (c, k) => c.items.find((i) => i.key === k);
    assert.equal(zeile(aussenanlagenChecks({ fwZufahrt: 2.8, fwBreite: 3.5 }), "feuerwehr-zufahrt").status, "warn");
    assert.equal(zeile(aussenanlagenChecks({ fwZufahrt: 3.0, fwBreite: 3.5 }), "feuerwehr-zufahrt").status, "pass");
    const nein = aussenanlagenChecks({ fwErforderlich: "nein", fwZufahrt: 0, fwBreite: 0 });
    assert.equal(zeile(nein, "feuerwehr").status, "pass");
    assert.equal(zeile(nein, "feuerwehr-zufahrt").status, "pass");
  });
});
