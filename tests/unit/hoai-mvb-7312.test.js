// Unit tests for 73-12 (HOAI-Bestandspfad): the existing building fabric to be reworked (mvb_euro)
// raises the chargeable costs of profiles with a conversion surcharge (§ 4 Abs. 3 HOAI 2021), leaves
// profiles without one and contracts without mvb unchanged, and the conversion surcharge still caps.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { honorarVertrag, mvbAnrechenbar } from "../../packages/nova-core/src/lib/hoai/honorar.js";
import { leistungsbildInfo } from "../../packages/nova-core/src/lib/hoai/leistungsbilder.js";
import { neuesAngebot, VERTRAGSFELDER } from "../../src/lib/honorar/angebot.js";

const BASIS = {
  leistungsbild: "gebaeude", honorarzone: "III", satz_position_prozent: 0, kg300_euro: 500000, kg400_euro: 0,
  sonstige_euro: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null, umbauzuschlag_prozent: 20,
  lph: Array.from({ length: 9 }, () => ({ beauftragt: true })),
};

describe("73-12 mitzuverarbeitende Bausubstanz", () => {
  it("mvb only counts for profiles with a conversion surcharge and only when positive", () => {
    assert.equal(mvbAnrechenbar({ mvb_euro: 100000 }, leistungsbildInfo("gebaeude")), 100000);
    assert.equal(mvbAnrechenbar({ mvb_euro: -5 }, leistungsbildInfo("gebaeude")), 0);
    assert.equal(mvbAnrechenbar({ mvb_euro: null }, leistungsbildInfo("gebaeude")), 0);
    assert.equal(mvbAnrechenbar({ mvb_euro: 100000 }, { umbau_max_prozent: undefined }), 0);
  });

  it("raises the fee like the same amount of extra chargeable costs; without mvb unchanged", () => {
    const ohne = honorarVertrag({ ...BASIS, mvb_euro: null });
    const mit = honorarVertrag({ ...BASIS, mvb_euro: 100000 });
    const gleich = honorarVertrag({ ...BASIS, kg300_euro: 600000, mvb_euro: null });
    assert.equal(ohne.quelle, "tafel");
    assert.ok(mit.grund > ohne.grund, "mvb raises the base fee");
    assert.equal(mit.grund, gleich.grund, "same as 100 000 € more chargeable costs");
    assert.equal(mit.umbau, Math.round(mit.grund * 0.2 * 100) / 100, "20 % surcharge on the higher base");
  });

  it("offer default: every existing-building kind suggests 20 % in zone III, new build 0; mvb basis travels to the contract", () => {
    const wert = () => undefined;
    const p = { id: "p1", name: "Musterprojekt", estimated_cost: 500000 };
    for (const k of ["umbau", "bestand", "sanierung"]) {
      assert.equal(neuesAngebot({ ...p, build_kind: k }, wert, [], { heuteIso: "2026-10-12" }).umbauzuschlag_prozent, 20, k);
    }
    assert.equal(neuesAngebot({ ...p, build_kind: "neubau" }, wert, [], { heuteIso: "2026-10-12" }).umbauzuschlag_prozent, 0);
    assert.ok(VERTRAGSFELDER.includes("mvb_grundlage"));
  });
});
