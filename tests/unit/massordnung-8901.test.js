// Unit tests for 89-01 (BW-03): octametric order, DIN 4172 derived sizes, DIN 18100 door series (0.985 is
// honestly not part of it), KS formats / wall thicknesses, drywall grid, and that the workshop reads its
// door widths and raster from massordnung.js (bath/entrance door 1.01 since D-BW-06, goldens re-frozen).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OKTAMETER, aufOktameter, istOktametrisch, nennmasse, tuerFuerLichteBreite, istDin18100Tuer,
  naechsteWanddicke, aufTrockenbauRaster, KS_FORMATE, WANDDICKEN, TUER_WERKSTATT,
} from "@designer/lib/massordnung";
import { TUERBREITEN, TUERBREITEN_R, MAUERWERK_RASTER_M, TUER_ECKABSTAND_SCHRANK_M } from "@designer/lib/tesselierung";

describe("89-01 Maßordnung", () => {
  it("octametre 12.5 cm and the DIN 4172 sizes", () => {
    assert.equal(OKTAMETER, 0.125);
    assert.equal(aufOktameter(0.93), 0.875);
    assert.equal(aufOktameter(2.44), 2.5);
    assert.equal(istOktametrisch(3.625), true);
    assert.equal(istOktametrisch(3.6), false);
    assert.deepEqual(nennmasse(1.0), { baurichtmass: 1, aussenmass: 0.99, oeffnungsmass: 1.01, vorsprung: 1 });
  });

  it("DIN 18100 doors: 0.885 and 1.01 are in the series, 0.985 is not", () => {
    assert.equal(istDin18100Tuer(0.885), true);
    assert.equal(istDin18100Tuer(1.01), true);
    assert.equal(istDin18100Tuer(0.985), false);
    assert.deepEqual(tuerFuerLichteBreite(0.9), { baurichtmass: 1, rohbau: 1.01, licht: 0.985 });
    assert.deepEqual(tuerFuerLichteBreite(0.8), { baurichtmass: 0.875, rohbau: 0.885, licht: 0.86 });
    assert.equal(tuerFuerLichteBreite(2), null);
  });

  it("KS formats, wall thicknesses, drywall grid", () => {
    assert.equal(KS_FORMATE["2DF"].h, 0.113);
    assert.deepEqual(WANDDICKEN, [0.115, 0.175, 0.24, 0.3, 0.365]);
    assert.equal(naechsteWanddicke(0.2), 0.175);
    assert.equal(naechsteWanddicke(0.36), 0.365);
    assert.equal(aufTrockenbauRaster(2.6), 2.5);
  });

  it("workshop reads from the dimensional order with unchanged values", () => {
    assert.deepEqual(TUERBREITEN, { zimmer: 0.885, bad: 1.01, wohnung: 1.01 });
    assert.deepEqual(TUERBREITEN_R, { zimmer: 1.01, bad: 1.01, wohnung: 1.01 });
    assert.deepEqual(TUERBREITEN, { ...TUER_WERKSTATT.standard });
    assert.equal(MAUERWERK_RASTER_M, OKTAMETER);
    assert.equal(TUER_ECKABSTAND_SCHRANK_M, 0.875);
  });
});
