// Unit-Tests für packages/nova-designer/src/lib/bauteilAufbau.js (Phase 44).
//
// Handgerechnete Referenzen (Wand, horizontaler Wärmestrom, Rsi 0,13 / Rse 0,04):
// - Stahlbeton 24 cm: R = 0,24/2,3 = 0,1043 → RT = 0,2743 → U ≈ 3,645
// - cavity: Luftschicht ist BELÜFTET (luftbel) → wirksam nur Gipsputz 1,5 +
//   KS 17,5 + MW035 12 cm, Rse → Rsi:
//   RT = 0,13 + 0,0294 + 0,1768 + 3,4286 + 0,13 = 3,8948 → U ≈ 0,2568
// - timber: wirksam nur GK 1,8 + OSB 1,8 + MW035 20 cm (Hinterlüftung schneidet ab,
//   Rse → Rsi): RT = 0,13 + 0,072 + 0,1385 + 5,7143 + 0,13 = 6,1848 → U ≈ 0,1617
// - Magnus: pSat(20) ≈ 2333 Pa · pSat(0) = 611,2 Pa · pSat(−10) ≈ 260 Pa (Eis)
// - Taupunkt 20 °C / 50 % ≈ 9,3 °C
//
// Diese Tests dokumentieren Richtwerte. Kein DIN-4108-3-/ISO-6946-Nachweis.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MATERIAL_KATALOG, materialById, luftschichtR,
  DEFAULT_RSI, DEFAULT_RSE, U_REFERENZ_AUSSENWAND,
  schichtR, schichtSd, wirksameSchichten, uWert,
  temperaturVerlauf, pSat, taupunkt, taupunktAusLuft,
  glaser, bauphysikChecks, aufbauFromComposite,
} from "@designer/lib/bauteilAufbau";
import { WALL_COMPOSITES, compositeById } from "@core/lib/buildingModel";

const near = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg || ""}: ${actual} weicht von ${expected} um mehr als ${tol} ab`,
  );

describe("MATERIAL_KATALOG", () => {
  it("hat ~20 Baustoffe und eindeutige Ids", () => {
    assert.ok(MATERIAL_KATALOG.length >= 20, `nur ${MATERIAL_KATALOG.length} Materialien`);
    const ids = MATERIAL_KATALOG.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, "doppelte Material-Ids");
  });

  it("jedes Material ist rechenfähig (λ, Luftschicht oder sd-Bahn)", () => {
    for (const m of MATERIAL_KATALOG) {
      assert.ok(m.lambda > 0 || m.luft, `${m.id}: weder λ noch luft`);
      assert.ok(m.color && m.hatch, `${m.id}: Darstellung fehlt`);
    }
  });

  it("schicht-Zuordnungen zeigen nur auf bekannte SCHICHTEN-Buckets", () => {
    const buckets = ["Stahlbeton", "Klinker", "Dämmung", "Kalksandstein", "Gipskarton", "Holz", "Putz"];
    for (const m of MATERIAL_KATALOG) {
      if (m.schicht != null) assert.ok(buckets.includes(m.schicht), `${m.id}: unbekannter Bucket ${m.schicht}`);
    }
  });

  it("materialById findet und fällt sauber auf null zurück", () => {
    assert.equal(materialById("beton").name, "Stahlbeton");
    assert.equal(materialById("gibtsnicht"), null);
  });
});

describe("Luftschicht & Schichtgrößen", () => {
  it("ruhende Luftschicht nach Dicke", () => {
    assert.equal(luftschichtR(50), 0.18);
    assert.equal(luftschichtR(25), 0.18);
    assert.equal(luftschichtR(15), 0.17);
    assert.equal(luftschichtR(10), 0.15);
    assert.equal(luftschichtR(7), 0.13);
    assert.equal(luftschichtR(5), 0.11);
    assert.equal(luftschichtR(0), 0);
  });

  it("schichtR: d/λ bzw. Luft-Tabelle, unbekannt → 0", () => {
    near(schichtR({ material: "beton", d: 240 }), 0.1043, 0.001, "Stahlbeton 24");
    near(schichtR({ material: "mw035", d: 120 }), 3.4286, 0.001, "MW035 12");
    assert.equal(schichtR({ material: "luft", d: 50 }), 0.18);
    assert.equal(schichtR({ material: "nix", d: 100 }), 0);
  });

  it("schichtSd: μ·d bzw. fixes sd der Bahnen", () => {
    near(schichtSd({ material: "beton", d: 240 }), 24, 0.01, "Beton sd");
    near(schichtSd({ material: "mw035", d: 120 }), 0.12, 0.001, "MW sd");
    assert.equal(schichtSd({ material: "dampfbremse", d: 1 }), 20);
    assert.equal(schichtSd({ material: "bitumenbahn", d: 2 }), 300);
  });
});

describe("uWert", () => {
  it("Stahlbeton 24 cm ungedämmt: U ≈ 3,645", () => {
    const u = uWert([{ material: "beton", d: 240 }]);
    near(u.U, 3.645, 0.01, "U single24");
    assert.equal(u.belueftet, false);
  });

  it("cavity: belüftete Luftschicht schneidet Klinker ab, U ≈ 0,257", () => {
    const { layers } = aufbauFromComposite(compositeById("cavity"));
    const u = uWert(layers);
    near(u.U, 0.2568, 0.002, "U cavity");
    assert.equal(u.belueftet, true);
    assert.equal(u.abgeschnitten.length, 2); // Luftschicht + Klinker
  });

  it("timber: Hinterlüftung schneidet ab, Rse → Rsi, U ≈ 0,162", () => {
    const { layers } = aufbauFromComposite(compositeById("timber"));
    const u = uWert(layers);
    near(u.U, 0.1617, 0.002, "U timber");
    assert.equal(u.belueftet, true);
    assert.equal(u.rseEff, DEFAULT_RSI);
    // Fassade + Luftschicht liegen außerhalb → identisches U, wenn man nur die
    // Innen-Schichten mit Rse = Rsi rechnet (genau das tut der Belüftungs-Zweig).
    const innen = layers.slice(0, 3); // GK, OSB, MW (innen→außen)
    near(uWert(innen, { rse: DEFAULT_RSI }).U, u.U, 1e-9, "äußere Schichten zählen nicht");
    assert.equal(u.abgeschnitten.length, 2);
  });

  it("leere Liste: nur Übergangswiderstände", () => {
    const u = uWert([]);
    near(u.RT, DEFAULT_RSI + DEFAULT_RSE, 1e-9, "RT leer");
  });
});

describe("temperaturVerlauf", () => {
  it("fällt monoton von θ_si auf θ_se = θe (20/−5)", () => {
    const { layers } = aufbauFromComposite(compositeById("cavity"));
    const t = temperaturVerlauf(layers, { thetaI: 20, thetaE: -5 });
    near(t.thetaSe, -5, 1e-6, "θ_se = θe");
    for (let i = 1; i < t.punkte.length; i++) {
      assert.ok(t.punkte[i].theta <= t.punkte[i - 1].theta + 1e-9, `nicht monoton bei ${i}`);
    }
    // θ_si = θi − q·Rsi
    near(t.punkte[0].theta, 20 - t.q * DEFAULT_RSI, 1e-9, "θ_si");
  });
});

describe("Magnus / Taupunkt", () => {
  it("pSat-Stützwerte (Wasser/Eis)", () => {
    near(pSat(20), 2333, 15, "pSat 20");
    near(pSat(0), 611.2, 0.1, "pSat 0");
    near(pSat(-10), 260, 5, "pSat −10 (Eis)");
  });

  it("Taupunkt 20 °C / 50 % ≈ 9,3 °C und invers konsistent", () => {
    near(taupunktAusLuft(20, 50), 9.3, 0.3, "Taupunkt");
    near(taupunkt(pSat(15)), 15, 0.01, "invers");
  });
});

describe("glaser", () => {
  it("ungedämmter Stahlbeton bei −10 °C: Tauwasser-Warnung", () => {
    const g = glaser([{ material: "beton", d: 240 }], { thetaI: 20, phiI: 50, thetaE: -10, phiE: 80 });
    assert.equal(g.tauwasser, true);
    assert.ok(g.zonen.length >= 1);
  });

  it("timber-Gefach (OSB als Dampfbremse): kein Tauwasser", () => {
    const { layers } = aufbauFromComposite(compositeById("timber"));
    const g = glaser(layers, { thetaI: 20, phiI: 50, thetaE: -10, phiE: 80 });
    assert.equal(g.tauwasser, false);
  });

  it("cavity: kein Tauwasser bei Normklima 20/50 innen, −5/80 außen", () => {
    const { layers } = aufbauFromComposite(compositeById("cavity"));
    const g = glaser(layers, { thetaI: 20, phiI: 50, thetaE: -5, phiE: 80 });
    assert.equal(g.tauwasser, false);
    near(g.pI, 0.5 * pSat(20), 0.1, "p_i");
    near(g.pE, 0.8 * pSat(-5), 0.1, "p_e");
  });

  it("cavity mit RUHENDER Luftschicht: Klinker-sd staut → Tauwasser-Warnung", () => {
    // Gegenprobe: dieselbe Wand ohne Belüftung (luft statt luftbel) — die
    // Vorsatzschale (sd 10 m) wirkt als äußere Dampfbremse. Genau deshalb ist
    // die Serien-cavity als belüftet modelliert.
    const layers = [
      { material: "gipsputz", d: 15 }, { material: "ks", d: 175 },
      { material: "mw035", d: 120 }, { material: "luft", d: 50 },
      { material: "klinker", d: 100 },
    ];
    const g = glaser(layers, { thetaI: 20, phiI: 50, thetaE: -5, phiE: 80 });
    assert.equal(g.tauwasser, true);
  });

  it("Punkte tragen alles fürs Diagramm (x, θ, p, p_sat, Taupunkt)", () => {
    const { layers } = aufbauFromComposite(compositeById("cavity"));
    const g = glaser(layers, {});
    assert.ok(g.punkte.length > layers.length, "Zwischenpunkte fehlen");
    for (const p of g.punkte) {
      for (const k of ["xMm", "sd", "theta", "psat", "p", "taupunkt"]) {
        assert.equal(typeof p[k], "number", `${k} fehlt`);
      }
    }
    // Tauwasser genau dort, wo p > p_sat ⇔ Taupunkt über θ
    for (const p of g.punkte) {
      if (p.p - p.psat > 0.5) assert.ok(p.taupunkt >= p.theta, "Taupunkt-Äquivalenz");
    }
  });

  it("f_Rsi: gedämmter Aufbau klar über 0,7 · Betonwand darunter", () => {
    const { layers } = aufbauFromComposite(compositeById("cavity"));
    assert.ok(glaser(layers, {}).fRsi > 0.9);
    assert.ok(glaser([{ material: "beton", d: 240 }], {}).fRsi < 0.7);
  });
});

describe("bauphysikChecks", () => {
  it("ohne Schichten: alles offen", () => {
    const c = bauphysikChecks({ hatSchichten: false });
    assert.equal(c.ampel, "offen");
    assert.ok(c.items.every((i) => i.status === "offen"));
  });

  it("guter Aufbau: pass — schlechter: warn, nie fail", () => {
    const gut = bauphysikChecks({ U: 0.24, tauwasser: false, fRsi: 0.95, hatSchichten: true });
    assert.equal(gut.ampel, "pass");
    const schlecht = bauphysikChecks({ U: 3.6, tauwasser: true, fRsi: 0.5, hatSchichten: true });
    assert.equal(schlecht.ampel, "warn");
    assert.ok(![...gut.items, ...schlecht.items].some((i) => i.status === "fail"), "fail ist tabu");
  });

  it("U-Referenz ist der GEG-Außenwand-Richtwert 0,28", () => {
    assert.equal(U_REFERENZ_AUSSENWAND, 0.28);
  });
});

describe("aufbauFromComposite (Brücke zu WALL_COMPOSITES)", () => {
  it("alle Serien-Composites sind vollständig gemappt", () => {
    for (const c of WALL_COMPOSITES) {
      const { layers, unbekannt } = aufbauFromComposite(c);
      assert.equal(unbekannt.length, 0, `${c.id}: unbekannte Skins ${unbekannt}`);
      assert.equal(layers.length, c.skins.length, `${c.id}: Schichtzahl`);
      assert.ok(Number.isFinite(c.rw) && c.rw > 0, `${c.id}: R'w fehlt`);
    }
  });

  it("dreht außen→innen zu innen→außen", () => {
    const { layers } = aufbauFromComposite(compositeById("cavity"));
    assert.equal(layers[0].material, "gipsputz", "innen zuerst");
    assert.equal(layers[layers.length - 1].material, "klinker", "außen zuletzt");
  });

  it("unbekannte Skins landen im unbekannt-Report", () => {
    const { layers, unbekannt } = aufbauFromComposite({ skins: [{ name: "Asbest", thickness: 10 }] });
    assert.deepEqual(unbekannt, ["Asbest"]);
    assert.equal(layers[0].material, null);
  });

  it("wirksameSchichten ohne Belüftung: identisch", () => {
    const layers = [
      { material: "gipsputz", d: 15 }, { material: "hlz", d: 365 },
      { material: "kalkzementputz", d: 20 },
    ];
    const w = wirksameSchichten(layers);
    assert.equal(w.belueftet, false);
    assert.equal(w.layers.length, layers.length);
  });
});

describe("Review-Härtungen (Folge zu 9c0c349)", () => {
  it("negative Dicke: R = 0, sd = 0 — Schicht wirkt wie nicht vorhanden", () => {
    assert.equal(schichtR({ material: "mw035", d: -100 }), 0);
    assert.equal(schichtSd({ material: "eps032", d: -50 }), 0);
    const mitNegativ = [{ material: "gipsputz", d: 15 }, { material: "mw035", d: -100 }, { material: "ks", d: 175 }];
    const ohne = [{ material: "gipsputz", d: 15 }, { material: "ks", d: 175 }];
    near(uWert(mitNegativ).U, uWert(ohne).U, 1e-9, "U wie ohne die Schicht");
    // x läuft nie rückwärts (Diagramm-/Zonen-Koordinaten bleiben monoton)
    const tv = temperaturVerlauf(mitNegativ, {});
    for (let i = 1; i < tv.punkte.length; i++) {
      assert.ok(tv.punkte[i].xMm >= tv.punkte[i - 1].xMm, "xMm monoton");
    }
    const g = glaser(mitNegativ, { thetaI: 20, phiI: 50, thetaE: -5, phiE: 80 });
    for (let i = 1; i < g.punkte.length; i++) {
      assert.ok(g.punkte[i].sd >= g.punkte[i - 1].sd, "sd monoton");
    }
  });

  it("aufbauFromComposite klemmt negative Skin-Dicken auf 0", () => {
    const { layers } = aufbauFromComposite({ skins: [{ name: "X", material: "mw035", thickness: -80 }] });
    assert.equal(layers[0].d, 0);
  });

  it("glaser ohne Diffusionskennwerte (sd gesamt = 0): keine Scheinzone, glaserOffen", () => {
    // Ausschließlich katalogfremde Schichten — vorher lieferte der p=pI-Fallback
    // eine Artefakt-Tauwasserzone über den gesamten Querschnitt.
    const g = glaser([{ material: null, d: 175, name: "A" }, { material: null, d: 160, name: "B" }],
      { thetaI: 20, phiI: 50, thetaE: -5, phiE: 80 });
    assert.equal(g.glaserOffen, true);
    assert.equal(g.tauwasser, false);
    assert.deepEqual(g.zonen, []);
    // Gegenprobe: bekannter Aufbau bleibt auswertbar
    assert.equal(glaser([{ material: "beton", d: 240 }], {}).glaserOffen, false);
  });

  it("bauphysikChecks mit glaserOffen: Tauwasser-Check ist offen, nie pass", () => {
    const c = bauphysikChecks({ U: 5.9, tauwasser: false, fRsi: 0.5, hatSchichten: true, hatUnbekannte: true, glaserOffen: true });
    const tw = c.items.find((i) => i.key === "tauwasser");
    assert.equal(tw.status, "offen");
    assert.equal(c.ampel, "warn");
  });
});
