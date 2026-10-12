// Unit tests for the 73-08 follow-up: a contingency item (Bedarfsposition) is priced but not in the LV total
// nor in a bid's offer sum; the GAEB X83 export marks it Provis="WithoutTotal".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lvTotal, lvBedarfSumme, istBedarfsposition } from "@ava/components/avaUtils";
import { bidSumme } from "@ava/lib/angebotPruefung";
import { buildX83 } from "@ava/lib/gaebX83";

const POS = [
  { id: "a", oz: "01.01.0010", quantity: 10, unit_price: 100 },
  { id: "b", oz: "01.01.0020", quantity: 5, unit_price: 40, kennz: "Bedarfsposition" },
];

describe("Bedarfsposition", () => {
  it("recognised from our value and imported marks", () => {
    assert.equal(istBedarfsposition(POS[1]), true);
    assert.equal(istBedarfsposition({ kennz: "Eventualposition" }), true);
    assert.equal(istBedarfsposition({ kennz: "WithoutTotal" }), true);
    assert.equal(istBedarfsposition({ kennz: "N" }), false);
    assert.equal(istBedarfsposition({}), false);
  });

  it("not in the LV total nor the offer sum, shown separately", () => {
    assert.equal(lvTotal(POS), 1000);
    assert.equal(lvBedarfSumme(POS), 200);
    const bid = { line_items: [{ position_id: "a", unit_price: 90 }, { position_id: "b", unit_price: 50 }] };
    assert.equal(bidSumme(bid, POS).summe, 900);
  });

  it("X83 marks the contingency item", () => {
    const xml = buildX83({ positionen: [
      { gewerk_nr: "01", oz: "01010010", kurztext: "Normal", menge_final: 1, einheit: "St", titel: ["A", "B"], titel_oz: ["01", "01"] },
      { gewerk_nr: "01", oz: "01010020", kurztext: "Bedarf", menge_final: 1, einheit: "St", titel: ["A", "B"], titel_oz: ["01", "01"], bedarfsposition: true },
    ], gewerk_nr: "01", lv_name: "Test", kg: {}, meta: { datum: "2026-10-11" } });
    assert.equal((xml.match(/<Provis>WithoutTotal<\/Provis>/g) || []).length, 1);
  });
});
