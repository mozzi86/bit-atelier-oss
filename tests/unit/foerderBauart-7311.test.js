// Unit tests for 73-11 (BEST-13): energy targets per kind of work (stored foreign value stays visible),
// programmes per kind of work, and the order check "application before project start".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { energieZieleFuer, ENERGY_TARGET_LABELS, labelFor } from "@core/lib/labels";
import { PROGRAMM_KATALOG, programmPasstZurBauart, antragReihenfolge, fundingChecks } from "@designer/lib/funding";

describe("73-11 Zielwerte und Förderung je Bauart", () => {
  it("energy targets follow the kind of work; a foreign stored value stays", () => {
    assert.ok(energieZieleFuer("bestand", null).werte.includes("eh_denkmal"));
    assert.ok(!energieZieleFuer("bestand", null).werte.includes("plus_energy"));
    const f = energieZieleFuer("bestand", "plus_energy");
    assert.equal(f.fremd, "plus_energy");
    assert.ok(f.werte.includes("plus_energy"));
    assert.equal(labelFor(ENERGY_TARGET_LABELS, "eh_70_ee"), "Effizienzhaus 70 EE");
  });

  it("every programme carries a kind of work; KFN only new build, BEG EM only existing", () => {
    for (const p of Object.values(PROGRAMM_KATALOG)) assert.ok(["neubau", "bestand", "beide"].includes(p.bauart));
    assert.equal(programmPasstZurBauart("kfw_kfn", "bestand"), false);
    assert.equal(programmPasstZurBauart("beg_em", "neubau"), false);
    assert.equal(programmPasstZurBauart("kfw_beg_wg", "bestand"), true);
    assert.equal(programmPasstZurBauart("unbekannt", "bestand"), true);
    assert.equal(fundingChecks([], {}, "2026-10-11").items.length, 3, "the three existing checks stay");
  });

  it("order: before start = pass, after = warn, start passed without application = warn, unknown start = offen", () => {
    const A = [
      { id: "a", titel: "BEG EM Fenster", programm_key: "beg_em", status: "eingereicht", eingereicht_am: "2026-03-01" },
      { id: "b", titel: "BEG WG", programm_key: "kfw_beg_wg", status: "eingereicht", eingereicht_am: "2026-05-02" },
      { id: "c", titel: "Heizung", programm_key: "bafa_heizung", status: "geplant" },
      { id: "k", titel: "Kunst", programm_key: "kunst_am_bau", status: "geplant" },
    ];
    const r = antragReihenfolge(A, { vorhabenbeginn: "2026-06-01", ersterZuschlag: "2026-04-15T09:00:00Z" }, "2026-10-11");
    assert.deepEqual(r.map((x) => [x.id, x.status]), [["a", "pass"], ["b", "warn"], ["c", "warn"]]);
    assert.match(r[1].detail, /erster Zuschlag 15\.4\.2026/);
    const zukunft = antragReihenfolge([A[2]], { vorhabenbeginn: "2027-01-10" }, "2026-10-11");
    assert.equal(zukunft[0].status, "offen");
    assert.equal(antragReihenfolge([A[0]], {}, "2026-10-11")[0].status, "offen");
  });
});
