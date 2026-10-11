// Unit tests for plan 84-05 (packages/nova-designer/src/lib/raumQualitaet.js +
// tesselierung.js): door checks over ALL typologies — every unit has its entrance door,
// no walk-through living room, every room reachable; escape route without approximation.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, raumSlicing } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { pruefeAlle, pruefeWohnung } from "@designer/lib/raumQualitaet";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const REGELN = ["wohnungstuer", "durchgangszimmer", "erschliessung", "diele", "flurende", "bad_vom_wohnraum", "tuer"];
const FAELLE = [
  ["mittelflur", 40, 16, 2], ["mittelflur", 30, 20, 1], ["mfh", 70, 16, 4], ["mfh", 40, 14, 3],
  ["spaenner", 24, 18, 5], ["spaenner", 24, 14, 1], ["laubengang", 40, 12, 3], ["laubengang", 30, 10, 2],
  ["reihenhaus", 48, 11, 2], ["efh", 12, 10, 2],
];

describe("84-05 — Türen über alle Typologien", () => {
  for (const [mix, ALLE] of [["Standard", STD], ["Referenz", REF]]) {
    for (const [typ, w, d, n] of FAELLE) {
      it(`${mix} ${typ} ${w} × ${d} × ${n}: kein Tür-/Erschließungs-fail, Rettungsweg über Türen`, () => {
        const E = typ === "efh" ? ALLE.slice(2) : ALLE;
        const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ, einheiten: E, raumzonen: true, regeln: { rettungsweg: true } });
        const fails = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })
          .flatMap((q) => q.eintraege.filter((e) => e.stufe === "fail" && REGELN.includes(e.regel)).map((e) => `${q.we}:${e.regel}`));
        // Former known rest (85 SUMMARY): Mittelflur 30 × 20, standard mix — a bedroom door
        // missed the hall strip by ≈ 2 cm in two units; gone since 84-11 (jamb 0,125 m).
        assert.equal(fails.length, 0, fails.join(" "));
        // Houses have their own exit (escape route 0, no walk computed).
        if (typ !== "reihenhaus" && typ !== "efh") {
          assert.ok(r.weListe.every((x) => x.rettungsweg_innen_art === "tueren"), "Rettungsweg innen über Türen");
          assert.ok(r.weListe.every((x) => x.rettungsweg_naeherung !== true), "Rettungsweg außen ohne Luftlinie");
        }
      });
    }
  }

  it("Prüfregel wohnungstuer: fail ohne Eingangstür; Obergeschoss eines Hauses (Treppe, kein EG) ok", () => {
    const zonen = raumSlicing({ rechteck: { x0: 0, x1: 9, z0: 0, z1: 7.1 }, fassadeBei: 0, achse: "x", level: 0, we: "WE 0-1" }, STD[2].raumprogramm, { wohnungsgrundriss: true });
    const ohne = zonen.map((z) => ({ ...z, tueren: (z.tueren || []).filter((t) => t.nach !== null) }));
    assert.ok(pruefeWohnung(zonen, { we: "WE 0-1", regeln: { wohnungsgrundriss: true } }).eintraege.some((e) => e.regel === "wohnungstuer" && e.stufe === "ok"));
    assert.ok(pruefeWohnung(ohne, { we: "WE 0-1", regeln: { wohnungsgrundriss: true } }).eintraege.some((e) => e.regel === "wohnungstuer" && e.stufe === "fail"));
    const haus = tesseliere({ footprintM: rect(12, 10), storeys: 2, typ: "efh", einheiten: [STD[2]], raumzonen: true });
    const og = pruefeWohnung(haus.zonen.filter((z) => z.level === 1), { we: "WE 0-1", regeln: { wohnungsgrundriss: true } });
    assert.ok(!og.eintraege.some((e) => e.regel === "wohnungstuer" && e.stufe === "fail"), "OG eines Hauses: Tür im EG");
  });

  it("Prüfregel durchgangszimmer: Aufenthaltsraum nur über einen anderen Raum erreichbar → fail", () => {
    const zonen = raumSlicing({ rechteck: { x0: 0, x1: 14, z0: 0, z1: 7.1 }, fassadeBei: 0, achse: "x", level: 0, we: "WE 0-1" }, STD[2].raumprogramm, { wohnungsgrundriss: true });
    const [wohnen, schlafen] = zonen.filter((z) => z.art === "aufenthalt");
    assert.ok(wohnen && schlafen, "zwei Aufenthaltsräume");
    const umgebaut = zonen.map((z) => (z === schlafen ? { ...z, tueren: [{ ...z.tueren[0], nach: wohnen.name }] } : z));
    const q = pruefeWohnung(umgebaut, { we: "WE 0-1", regeln: { wohnungsgrundriss: true } });
    assert.ok(q.eintraege.some((e) => e.regel === "durchgangszimmer" && e.stufe === "fail" && e.raum === schlafen.name));
    assert.ok(!pruefeWohnung(zonen, { we: "WE 0-1", regeln: { wohnungsgrundriss: true } }).eintraege.some((e) => e.regel === "durchgangszimmer"));
  });

  it("flaches Band (MFH 40 × 14, 1-Zi): Nebenraumzeile gedeckelt statt Zuschnitt ohne Diele/Türen", () => {
    const r = tesseliere({ footprintM: rect(40, 14), storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true });
    assert.ok(!(r.raumWarns || []).concat(r.hinweise).some((h) => /zu gering für zwei Raumreihen/.test(h)));
    assert.ok(r.weListe.every((w) => r.zonen.some((z) => z.we === w.we && (z.tueren || []).some((t) => t.nach === null))));
  });
});
