// Unit tests for 73-13 (BEST-15): the deviation note turns only fail/warn rows into the fourth state,
// needs a reason, leaves pass and "nicht_geprueft" alone, and counts open applications.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mitAbweichungen, vermerkHardened, ABWEICHUNG } from "@designer/lib/abweichung";
import { STATUS_STYLE, UNCHECKED } from "@designer/lib/compliance";

const ITEMS = [
  { key: "treppe", status: "fail", detail: "Steigung 19 cm > 17,5 cm" },
  { key: "hoehe", status: "warn", detail: "lichte Höhe 2,30 m" },
  { key: "uwert", status: "pass" },
  { key: "fluchtweg", status: UNCHECKED },
];

describe("73-13 Abweichung / Bestandsschutz", () => {
  it("note needs a reason; unknown art/state fall back", () => {
    assert.equal(vermerkHardened({ art: "bestandsschutz" }), null);
    assert.deepEqual(vermerkHardened({ art: "x", antrag_status: "y", begruendung: " Bestandstreppe 1910 " }), { art: "abweichung", begruendung: "Bestandstreppe 1910", kompensation: "", antrag_status: "offen", datum: "" });
  });

  it("overlays fail/warn only, keeps the previous status, counts open applications", () => {
    const r = mitAbweichungen(ITEMS, {
      treppe: { art: "bestandsschutz", begruendung: "Bestandstreppe, keine Nutzungsänderung", antrag_status: "genehmigt" },
      hoehe: { art: "abweichung", begruendung: "Dachgeschoss Bestand", kompensation: "keine Aufenthaltsräume", antrag_status: "beantragt" },
      uwert: { begruendung: "wird ignoriert" },
      fluchtweg: { begruendung: "wird ignoriert" },
    });
    assert.deepEqual(r.items.map((x) => x.status), [ABWEICHUNG, ABWEICHUNG, "pass", UNCHECKED]);
    assert.equal(r.items[0].statusVorher, "fail");
    assert.equal(r.anzahl, 2);
    assert.equal(r.offen, 1);
    assert.equal(mitAbweichungen(ITEMS, null).anzahl, 0);
  });

  it("fourth state has its own style; UNCHECKED keeps its meaning", () => {
    assert.equal(STATUS_STYLE.abweichung.label, "Abweichung");
    assert.equal(STATUS_STYLE[UNCHECKED].label, "nicht geprüft");
  });
});
