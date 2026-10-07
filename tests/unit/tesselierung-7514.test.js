// Unit tests for the 75-14 part of packages/nova-designer/src/lib/tesselierung.js:
// default regression against the checked-in snapshot (generated BEFORE the change,
// tests/unit/fixtures/tesselierung-default-7514.json), the hall/door slicing of the
// screenshot apartment and the door-swing overrides.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  tesseliere, raumSlicing, wohnungsRegeln, DIELE_MASSE, TUERBREITEN, MINDESTBREITEN,
} from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { BILD_PROGRAMM, BILD_BAND } from "./fixtures/bildWohnung.js";

const SNAP = JSON.parse(fs.readFileSync(new URL("./fixtures/tesselierung-default-7514.json", import.meta.url), "utf8"));
const FP40 = [{ x: -20, z: -13 }, { x: 20, z: -13 }, { x: 20, z: 13 }, { x: -20, z: 13 }];
const FP30 = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const r2 = (v) => Math.round(v * 100) / 100;
const bbox = (z) => { const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z); return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }; };

describe("tesselierung.js — 75-14 Default byte-gleich (Snapshot vor der Änderung)", () => {
  const faelle = {
    "fp40-mittelflur-2g-ref": { footprintM: FP40, storeys: 2, typ: "mittelflur", einheiten: REF, raumzonen: true },
    "fp40-spaenner-1g-ref": { footprintM: FP40, storeys: 1, typ: "spaenner", einheiten: REF, raumzonen: true },
    "fp40-laubengang-1g-std": { footprintM: FP40, storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true },
    "fp30-mfh-2g-std": { footprintM: FP30, storeys: 2, typ: "mfh", einheiten: STD, raumzonen: true },
    "fp30-mittelflur-1g-std-regeln75-07": { footprintM: FP30, storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true, regeln: { mindestbreiten: true, phi: true, wandstaerken: true, rettungsweg: true, himmelsrichtung: true } },
  };
  // 75-13 Task 1 replaced the Manhattan value of the EXISTING rule regeln.rettungsweg by
  // the walked line (rettungsweg_m / _innen_m / _flur_m / _pfad / _naeherung,
  // rettungswegWarnungen). The snapshot file stays the 2206d15 original; the one case
  // that switches the rule on is compared WITHOUT those fields — zones, borders,
  // hints and every other unit field must stay byte-identical.
  const ohneRettungsweg = (r) => JSON.stringify({
    ...r,
    rettungswegWarnungen: undefined,
    weListe: r.weListe.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => !k.startsWith("rettungsweg")))),
  });
  for (const [name, opts] of Object.entries(faelle)) {
    const rettungsweg = opts.regeln?.rettungsweg === true;
    it(`${name}: JSON identisch zum Snapshot${rettungsweg ? " (ohne die rettungsweg_*-Felder, 75-13)" : ""}`, () => {
      assert.ok(SNAP[name], "Snapshot-Fall vorhanden");
      const neu = tesseliere(opts);
      if (rettungsweg) {
        assert.equal(ohneRettungsweg(neu), ohneRettungsweg(SNAP[name]));
        assert.ok(SNAP[name].weListe.every((w) => !("rettungsweg_pfad" in w)), "Snapshot trägt noch den Manhattan-Wert");
        assert.ok(neu.weListe.every((w) => Array.isArray(w.rettungsweg_pfad) && w.rettungsweg_pfad.length >= 2), "neu: Lauflinie mit Pfad");
      } else {
        assert.equal(JSON.stringify(neu), JSON.stringify(SNAP[name]));
      }
    });
  }
  it("regeln {} und tuerAufschlaege {} ändern nichts; ohne Regel trägt keine Zone tueren/fensterwand", () => {
    const a = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: REF, raumzonen: true });
    const b = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: REF, raumzonen: true, regeln: {}, tuerAufschlaege: {} });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.ok(a.zonen.every((z) => !("tueren" in z) && !("fensterwand" in z)));
  });
});

describe("tesselierung.js — 75-14 Diele + Türen im Zuschnitt (Bild-Wohnung)", () => {
  const ohne = () => raumSlicing(BILD_BAND, BILD_PROGRAMM);
  const mit = () => raumSlicing(BILD_BAND, BILD_PROGRAMM, { wohnungsgrundriss: true });

  it("vorher: Küche 8 · Bad 5 · Flur 6 hinten (2,45 m tief), vorn 9,55 m tief — Schlafen 2,20 m, Kind 1,47 m breit", () => {
    const z = ohne();
    assert.deepEqual(z.map((q) => q.name.replace(/ \(WE 0-1\) ·WT$/, "")), ["Wohnen/Essen", "Schlafen", "Kind 2/Büro", "Küche", "Bad", "Flur"]);
    const s = bbox(z[1]), k = bbox(z[2]);
    assert.equal(r2(s.d), 9.55);
    assert.equal(r2(s.w), 2.2);
    assert.equal(r2(k.w), 1.47);
    assert.equal(z.warns.length, 0);
    assert.ok(z.every((q) => q.tueren === undefined));
  });

  it("nachher: EINE L-förmige Diele (Flur 1,20 m über die ganze Breite + Vorraum ≥ 1,20 m, 3–6 m² Vorraum), Wohnungstür mittig in der Flurkante", () => {
    const z = mit();
    const dielen = z.filter((q) => /Diele/.test(q.name));
    assert.equal(dielen.length, 1);
    const d = dielen[0];
    assert.equal(d.points.length, 6, "L-Polygon");
    assert.equal(d.art, "flur");
    assert.equal(d.raumart, "flur");
    const b = bbox(d);
    assert.equal(r2(b.w), 7.75, "Flurstreifen über die ganze WE-Breite");
    // Hall part: 4 m² / dB (17 m² / 7,75 m = 2,19 m) = 1,83 m wide ≥ 1,20 m.
    const vorraumBreite = d.points[1].x - d.points[0].x;
    assert.ok(vorraumBreite >= DIELE_MASSE.minBreite);
    assert.ok(r2(vorraumBreite * 2.19) >= 3 && r2(vorraumBreite * 2.19) <= 6, `Vorraum ${r2(vorraumBreite * 2.19)} m²`);
    assert.equal(d.tueren.length, 1);
    assert.equal(d.tueren[0].wand, 0, "Flurkante = erste Kante");
    assert.equal(d.tueren[0].breite_m, TUERBREITEN.wohnung);
    assert.equal(r2(d.tueren[0].u_m + TUERBREITEN.wohnung / 2), r2(vorraumBreite / 2), "mittig");
    assert.equal(z.find((q) => /^Flur/.test(q.name)), undefined, "Programm-Flur geht in der Diele auf");
  });

  it("nachher: kein Aufenthaltsraum unter 2,40 m / 10 m²; Kind in Schlafen zusammengelegt mit Hinweis [75-14] inkl. nötiger Fassade", () => {
    const z = mit();
    const auf = z.filter((q) => q.art === "aufenthalt");
    assert.equal(auf.length, 2);
    for (const q of auf) {
      const b = bbox(q);
      assert.ok(Math.min(b.w, b.d) >= 2.4 - 1e-9, `${q.name} ${r2(Math.min(b.w, b.d))} m`);
      assert.ok(q.flaeche_m2 >= 10);
      assert.ok(b.w >= MINDESTBREITEN.schlafen - 1e-9);
    }
    assert.ok(auf.some((q) => /Schlafen \+ Kind 2\/Büro/.test(q.name)));
    assert.equal(z.warns.filter((w) => /\[75-14\]/.test(w)).length, 1);
    assert.match(z.warns[0], /Fassade 7,75 m reicht nicht für 3 Aufenthaltsräume/);
    assert.match(z.warns[0], /nötig 9,20 m/, "3,60 + 2,80 + 2,80");
    // Row depths: back 2,19 + strip 1,20 + front 8,61 = 12,00.
    const front = bbox(auf[0]), back = bbox(z.find((q) => /^Küche/.test(q.name)));
    assert.equal(r2(front.d + back.d + MINDESTBREITEN.flur), 12);
    // Area invariant: every square metre of the band is a zone.
    assert.equal(r2(z.reduce((s, q) => s + q.flaeche_m2, 0)), 93);
  });

  it("Türen: jede Zimmertür in der Wand zum Flurstreifen, Fensterwand getaggt, Aufschlag links, Bad 0,985", () => {
    const z = mit();
    for (const q of z.filter((x) => x.fensterpflicht)) {
      assert.equal(q.fensterwand, 2, "Fassade bei z = 12 = Kante 2");
      assert.equal(q.tueren[0].wand, 0, "Flurseite = Kante 0");
      assert.equal(q.tueren[0].aufschlag, "links");
    }
    for (const q of z.filter((x) => !x.fensterpflicht && x.art !== "flur")) {
      assert.equal(q.fensterwand, undefined);
      assert.equal(q.tueren[0].wand, 2, "Rückzeile: Flurseite = Kante 2");
    }
    assert.equal(z.find((q) => /^Bad/.test(q.name)).tueren[0].breite_m, 0.985);
    assert.equal(z.find((q) => /^Bad/.test(q.name)).tueren[0].typ, "bad");
  });

  it("gespiegelt: Diele am anderen Ende, Zuschnitt sonst gleich (Flächen identisch)", () => {
    const a = mit();
    const b = raumSlicing({ ...BILD_BAND, variante: "gespiegelt" }, BILD_PROGRAMM, { wohnungsgrundriss: true });
    const da = a.find((q) => /Diele/.test(q.name)), db = b.find((q) => /Diele/.test(q.name));
    assert.equal(r2(da.points[0].x), 0);
    assert.ok(db.points[0].x > 5, "Vorraum rechts");
    assert.equal(r2(da.flaeche_m2), r2(db.flaeche_m2));
    assert.equal(r2(a.reduce((s, q) => s + q.flaeche_m2, 0)), r2(b.reduce((s, q) => s + q.flaeche_m2, 0)));
  });

  it("tuerAufschlaege: Schlüssel level|zoneName|idx dreht genau diese Tür; Rest unverändert", () => {
    const basis = mit();
    const wohnen = basis.find((q) => /^Wohnen/.test(q.name));
    const key = `0|${wohnen.name}|0`;
    const gedreht = raumSlicing({ ...BILD_BAND, tuerAufschlaege: { [key]: "rechts", "0|Nix|0": "rechts" } }, BILD_PROGRAMM, { wohnungsgrundriss: true });
    assert.equal(gedreht.find((q) => q.name === wohnen.name).tueren[0].aufschlag, "rechts");
    assert.equal(gedreht.filter((q) => q.tueren?.[0]?.aufschlag === "rechts").length, 1);
    const ohneTueren = (l) => l.map((q) => ({ ...q, tueren: undefined }));
    assert.equal(JSON.stringify(ohneTueren(gedreht)), JSON.stringify(ohneTueren(basis)), "Geometrie unverändert");
  });

  it("zu flaches Band (< 2,40 m Fassadenreihe) und Spänner-Quadranten fallen auf den Standardzuschnitt zurück — mit Hinweis", () => {
    const flach = raumSlicing({ ...BILD_BAND, rechteck: { x0: 0, x1: 7.75, z0: 0, z1: 5 }, fassadeBei: 5 }, BILD_PROGRAMM, { wohnungsgrundriss: true });
    assert.ok(flach.warns.some((w) => /Bandtiefe 5,00 m zu gering/.test(w)), flach.warns.join(" | "));
    assert.equal(flach.filter((q) => /Diele/.test(q.name)).length, 0);
    const sp = raumSlicing({ ...BILD_BAND, zweiFassaden: true }, BILD_PROGRAMM, { wohnungsgrundriss: true });
    assert.ok(sp.warns.some((w) => /Spänner-Quadranten/.test(w)));
  });

  it("tesseliere: Hinweise [75-14] wandern nach hinweise, Diele je WE, Wohnungstür je WE; 40 × 26 m Mittelflur ehrlich (Fassade zu kurz)", () => {
    const r = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: REF, raumzonen: true, regeln: { wohnungsgrundriss: true } });
    const wes = [...new Set(r.weListe.map((w) => w.we))];
    assert.equal(r.zonen.filter((z) => /Diele/.test(z.name)).length, wes.length, "eine Diele je WE");
    assert.equal(r.zonen.filter((z) => z.tueren?.some((t) => t.nach === null)).length, wes.length, "eine Wohnungstür je WE");
    assert.ok(r.hinweise.some((h) => /\[75-14\]/.test(h)));
    assert.equal(r.raumWarns.filter((h) => /\[75-14\]/.test(h)).length, 0, "nicht doppelt in raumWarns");
    assert.ok(r.hinweise.some((h) => /zusammengelegt/.test(h) && /Bandtiefe 12,10 m/.test(h)));
    assert.equal(wohnungsRegeln({ wohnungsgrundriss: true }).aktiv, true);
  });
});
