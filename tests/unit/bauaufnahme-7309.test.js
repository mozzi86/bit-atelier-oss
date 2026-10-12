// Unit tests for 73-09: survey layer hardening, delivery ids, and the checks (missing accuracy class and
// registration report, UTM trap by magnitude or CRS name, missing / implausible NHN height).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bauaufnahmeHardened, lieferungHinzu, bauaufnahmeChecks, BAUAUFNAHME_DEFAULT } from "@designer/lib/bauaufnahme";

const keys = (l) => bauaufnahmeChecks(l).map((c) => c.key);

describe("73-09 Bauaufnahme", () => {
  it("hardens garbage, keeps known values, numbers or null", () => {
    const l = bauaufnahmeHardened({ lieferungen: [{ verfahren: "tls", genauigkeit: "LOA30", dienstleister: "Vermessung Muster", fremd: 1 }, { verfahren: "quatsch" }], georeferenz: { nullpunkt_e: "4432100.5", okff_eg_nhn: "", drehung_grad: "12" } });
    assert.equal(l.lieferungen[0].id, "lf-1");
    assert.equal(l.lieferungen[0].verfahren, "tls");
    assert.equal("fremd" in l.lieferungen[0], false);
    assert.equal(l.lieferungen[1].verfahren, "");
    assert.deepEqual(l.georeferenz, { crs: "", nullpunkt_e: 4432100.5, nullpunkt_n: null, okff_eg_nhn: null, drehung_grad: 12 });
    assert.deepEqual(bauaufnahmeHardened(null), bauaufnahmeHardened(BAUAUFNAHME_DEFAULT));
  });

  it("new delivery gets the next free id", () => {
    const l = lieferungHinzu(lieferungHinzu(bauaufnahmeHardened({})));
    assert.deepEqual(l.lieferungen.map((x) => x.id), ["lf-1", "lf-2"]);
    const luecke = lieferungHinzu(bauaufnahmeHardened({ lieferungen: [{ id: "lf-2" }] }));
    assert.deepEqual(luecke.lieferungen.map((x) => x.id), ["lf-2", "lf-3"]);
  });

  it("checks: empty survey, missing class and report, UTM trap, NHN height", () => {
    assert.deepEqual(keys(bauaufnahmeHardened({})), ["keine_lieferung", "okff"]);
    const l = bauaufnahmeHardened({ lieferungen: [{ id: "a", verfahren: "tls" }, { id: "b", verfahren: "handaufmass", genauigkeit: "LOA20" }], georeferenz: { nullpunkt_e: 652300, okff_eg_nhn: 310.25 } });
    assert.deepEqual(keys(l), ["genauigkeit_a", "bericht_a", "utm"]);
    assert.ok(keys(bauaufnahmeHardened({ georeferenz: { crs: "EPSG:25832", okff_eg_nhn: 300 } })).includes("utm"));
    assert.ok(!keys(bauaufnahmeHardened({ georeferenz: { nullpunkt_e: 12.5, nullpunkt_n: 30, okff_eg_nhn: 300 } })).includes("utm"), "local coordinates are fine");
    assert.ok(keys(bauaufnahmeHardened({ georeferenz: { okff_eg_nhn: 9000 } })).includes("okff_unplausibel"));
  });
});
