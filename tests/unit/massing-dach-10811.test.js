// 108-11: main body of the Massing-Studio with the global roof of the building model (massing/hauptdach.js), setback heights per side
// and the additive per-edge option of baurecht.abstandsStreifen.
// Test house (neutral, invented): EFH 11.40 × 10.20 m (x × z), storeys 2 (EG + DG), untergeschosse 1 (KG 2.75 m), EG 2.90 m, DG 2.90 m with a
// knee wall 0.75 m, gable roof 42°, default hull slab 0.25 m standing on the storey plane.
// Hand calculation:
//   eaves = DG elevation 2.90 + slab 0.25 + knee wall 0.75 = 3.90 m (buildingModel.kniestockGeometrie, read through globaleTraufhoehe_m)
//   ridge along x (the 11.40 m side, "laengs"), span 10.20 m across z → rise = 5.10 × tan 42° = 4.5920 m → ridge 8.4920 m
//   volume: walls 116.28 m² × (3.90 + 2.75) = 773.262 m³; roof 116.28 × 4.5920 / 2 = 266.98 m³ → BRI ≈ 1 040.2 m³
//   setbacks: eaves sides (edges along x) H = 3.90 m; gable sides (edges along z) H = 3.90 + 4.592 / 3 = 5.4307 m [ASSUMED 1/3]
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hauptkoerperDach, abstandsHoehenJeKante, GIEBEL_ANRECHNUNG, GENEIGTE_HAUPTDAECHER, DACH_ZUSCHLAG, dachZuschlagAnteil } from "@core/lib/massing/hauptdach.js";
import { abstandsStreifen } from "@core/lib/massing/baurecht.js";
import { globalesDach, dachDreiecke } from "@core/lib/bauteil/dachGeometrie.js";
import { globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js";
import { geschosseAus } from "@core/lib/bauteil/hoehen.js";
import { createBuildingModel } from "@core/lib/buildingModel";
import { modellDachAus } from "@designer/lib/useModellDach.js";
import { EFH_FOOTPRINT } from "./fixtures/efh-108.js";

const nahe = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ was, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${was}: ${a} ≠ ${b}`);

/** Storey table of the 108-11 house (KG/EG/DG, knee wall on DG). */
const GESCHOSSE = [{ level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.9, kniestock_m: 0.75 }];
/** Programme + roof fields as the studio hands them to hauptkoerperDach. */
const EFH = Object.freeze({ footprintM: EFH_FOOTPRINT.map((p) => ({ ...p })), storeys: 2, storeyHeight: 2.9, geschosse: GESCHOSSE, untergeschosse: 1, dachform: "sattel", dachneigung: 42 });
/** The same footprint in site metres {x, y} (as the studio's live polygon), shifted into a 30 × 25 m field. */
const POLY_SITE = EFH_FOOTPRINT.map((p) => ({ x: p.x + 15, y: p.z + 12.5 }));

const ANSTIEG = 5.1 * Math.tan((42 * Math.PI) / 180);

describe("108-11 hauptkoerperDach: Satteldach des Gebäudemodells am Massing-Hauptkörper", () => {
  it("Traufe aus globaleTraufhoehe_m (Kniestock), First = Traufe + halbe Spannweite × tan 42°", () => {
    const hd = hauptkoerperDach(EFH);
    assert.ok(hd);
    nahe(hd.traufhoehe_m, 3.9, "Traufe");
    nahe(hd.anstieg_m, ANSTIEG, "Anstieg");
    nahe(hd.firsthoehe_m, 3.9 + ANSTIEG, "First");
    nahe(hd.firsthoehe_m, 8.492, "First ≈ 8,49 m", 1e-3);
    nahe(hd.neigung_grad, 42, "Neigung", 1e-9);
    assert.equal(hd.kniestock_m, 0.75);
    nahe(hd.fusshoehe_m, -2.75, "Fußhöhe KG");
    assert.deepEqual(hd.geschossEbenen_m, [2.9], "eine Geschossebene (DG-Boden) zwischen ±0 und Traufe");
    nahe(hd.wandObenAnteil, (3.9 - 2.9) / 2.9, "Wandanteil DG");
  });

  it("dieselbe Rechnung wie das Gebäudemodell: globalesDach(createBuildingModel(...)) liefert identische Flächen", () => {
    const model = createBuildingModel({ ...EFH, footprintM: EFH.footprintM });
    const ref = /** @type {any} */ (globalesDach(model, "sattel", 42, geschosseAus({ geschosse: GESCHOSSE, storeyHeight: 2.9 })));
    const hd = /** @type {any} */ (hauptkoerperDach(EFH));
    assert.equal(globaleTraufhoehe_m(model), hd.traufhoehe_m);
    assert.deepEqual(hd.dach.flaechen, ref.flaechen);
    assert.deepEqual(hd.dach.punkte, ref.punkte);
  });

  it("First läuft entlang der 11,40-m-Seite (x, West–Ost), Giebel an den Schmalseiten", () => {
    const hd = /** @type {any} */ (hauptkoerperDach(EFH));
    const f0 = hd.dach.punkte.find((/** @type {any} */ p) => p.id === "f0");
    const f1 = hd.dach.punkte.find((/** @type {any} */ p) => p.id === "f1");
    nahe(Math.abs(f1.x - f0.x), 11.4, "Firstlänge entlang x");
    nahe(f1.z - f0.z, 0, "First ohne z-Versatz");
    nahe(f0.y, hd.firsthoehe_m, "Firsthöhe am Punkt");
    assert.equal(hd.dach.flaechen.filter((/** @type {any} */ f) => f.art === "giebel").length, 2);
  });

  it("Dachfläche im Lageplan-Rahmen: verschobener Umriss gibt dieselben Höhen, Punkte um die Verschiebung versetzt", () => {
    const a = /** @type {any} */ (hauptkoerperDach(EFH));
    const b = /** @type {any} */ (hauptkoerperDach({ ...EFH, footprintM: POLY_SITE.map((p) => ({ x: p.x, z: p.y })) }));
    nahe(b.firsthoehe_m, a.firsthoehe_m, "First");
    const fa = a.dach.punkte.find((/** @type {any} */ p) => p.id === "f0"), fb = b.dach.punkte.find((/** @type {any} */ p) => p.id === "f0");
    nahe(fb.x - fa.x, 15, "x versetzt"); nahe(fb.z - fa.z, 12.5, "z versetzt");
  });

  it("Kubatur/BRI mit Dach: Wandkörper ab UK KG bis Traufe + Dachkeil", () => {
    const hd = /** @type {any} */ (hauptkoerperDach(EFH));
    nahe(hd.grundflaeche_m2, 116.28, "Grundfläche");
    nahe(hd.wandVolumen_m3, 116.28 * (3.9 + 2.75), "Wandkörper");
    nahe(hd.dachVolumen_m3, (116.28 * ANSTIEG) / 2, "Dachkeil");
    nahe(hd.bri_m3, 116.28 * 6.65 + (116.28 * ANSTIEG) / 2, "BRI");
    // hip roof: prismatoid with the shortened ridge (1/4 of the shorter side from each end)
    const w = /** @type {any} */ (hauptkoerperDach({ ...EFH, dachform: "walm" }));
    const r = 11.4 - 2 * 0.25 * 10.2;
    nahe(w.dachVolumen_m3, (10.2 * w.anstieg_m / 6) * (2 * 11.4 + r), "Walm");
  });

  it("ohne Kniestock: Traufe = Oberkante oberstes Geschoss (totalHeight) wie im Gebäudemodell", () => {
    const hd = /** @type {any} */ (hauptkoerperDach({ ...EFH, geschosse: GESCHOSSE.map(({ kniestock_m, ...g }) => g) }));
    nahe(hd.traufhoehe_m, 5.8, "Traufe");
    assert.equal(hd.kniestock_m, null);
    nahe(hd.wandObenAnteil, 1, "Wandanteil");
  });

  it("Hüllplatten-Bezug „oben“ verschiebt die Traufe wie im Gebäudemodell (3,65 m)", () => {
    const hd = /** @type {any} */ (hauptkoerperDach({ ...EFH, deckenBezug: "oben" }));
    nahe(hd.traufhoehe_m, 2.9 + 0.75, "Traufe bezug oben");
  });

  it("Flachdach, keine Dachform, kein Umriss: null (das Studio behält den Quader)", () => {
    assert.equal(hauptkoerperDach({ ...EFH, dachform: "flach" }), null);
    assert.equal(hauptkoerperDach({ ...EFH, dachform: null }), null);
    assert.equal(hauptkoerperDach({ ...EFH, dachform: "tonne" }), null);
    assert.equal(hauptkoerperDach({ ...EFH, footprintM: [] }), null);
    assert.deepEqual([...GENEIGTE_HAUPTDAECHER], ["sattel", "walm", "pult"]);
  });
});

describe("108-11 Abstandsflächen: Traufseite mit Traufhöhe, Giebelseite mit anrechenbarem Giebeldreieck", () => {
  const hd = hauptkoerperDach({ ...EFH, footprintM: POLY_SITE.map((p) => ({ x: p.x, z: p.y })) });

  it("Kanten entlang des Firsts = Traufe (3,90 m), quer dazu = Giebel (3,90 + 1/3 · Anstieg) [ASSUMED]", () => {
    nahe(GIEBEL_ANRECHNUNG, 1 / 3, "Anteil");
    const k = /** @type {any[]} */ (abstandsHoehenJeKante(POLY_SITE, hd));
    assert.deepEqual(k.map((e) => e.art), ["traufe", "giebel", "traufe", "giebel"]);
    nahe(k[0].hoehe_m, 3.9, "Traufseite");
    nahe(k[1].hoehe_m, 3.9 + ANSTIEG / 3, "Giebelseite");
    nahe(k[1].hoehe_m, 5.4307, "Giebelseite ≈ 5,43", 1e-3);
  });

  it("Streifentiefe je Kante (Faktor 1,0 H): Traufe 3,90 m, Giebel 5,43 m; ohne Höhen wie bisher eine Tiefe", () => {
    const k = /** @type {any[]} */ (abstandsHoehenJeKante(POLY_SITE, hd));
    const s = abstandsStreifen(POLY_SITE, 5.8, { faktor: 1, min: 3, hoehen: k.map((e) => e.hoehe_m) });
    nahe(s[0].depth, 3.9, "Traufe"); nahe(s[1].depth, 3.9 + ANSTIEG / 3, "Giebel"); nahe(s[2].depth, 3.9, "Traufe 2");
    const alt = abstandsStreifen(POLY_SITE, 5.8, { faktor: 1, min: 3 });
    assert.deepEqual(alt, abstandsStreifen(POLY_SITE, 5.8, { faktor: 1, min: 3, hoehen: null }), "ohne Option byte-gleich");
    assert.ok(alt.every((x) => x.depth === 5.8));
  });

  it("Walm: alle Seiten Traufe; Pult: hohe Seite bis zur hohen Traufe, Schmalseiten mit Dreiecksanteil", () => {
    const w = hauptkoerperDach({ ...EFH, dachform: "walm", footprintM: POLY_SITE.map((p) => ({ x: p.x, z: p.y })) });
    assert.ok(/** @type {any[]} */ (abstandsHoehenJeKante(POLY_SITE, w)).every((e) => e.art === "traufe"));
    const p = /** @type {any} */ (hauptkoerperDach({ ...EFH, dachform: "pult", footprintM: POLY_SITE.map((q) => ({ x: q.x, z: q.y })) }));
    const k = /** @type {any[]} */ (abstandsHoehenJeKante(POLY_SITE, p));
    assert.deepEqual(k.map((e) => e.art).sort(), ["giebel", "giebel", "hochseite", "traufe"]);
    nahe(k.find((e) => e.art === "hochseite").hoehe_m, p.firsthoehe_m, "Hochseite");
    nahe(k.find((e) => e.art === "giebel").hoehe_m, p.traufhoehe_m + p.anstieg_m / 3, "Pult-Giebel");
  });

  it("ohne Dach: null (eine Höhe für alle Kanten wie bisher)", () => {
    assert.equal(abstandsHoehenJeKante(POLY_SITE, null), null);
  });
});

describe("108-11 modellDachAus: Dachfelder des Datensatzes", () => {
  it("liest Dachform, Neigung und Hüllplattenfelder; fehlende Felder bleiben leer", () => {
    assert.deepEqual(modellDachAus({ dachform: "sattel", dachneigung: 42, huelle_decke_dicke_m: 0.25, huelle_decke_bezug: "unten" }),
      { dachform: "sattel", dachneigung: 42, deckenDicke: 0.25, deckenBezug: "unten" });
    assert.deepEqual(modellDachAus(null), { dachform: null, dachneigung: null, deckenDicke: undefined, deckenBezug: undefined });
    assert.equal(hauptkoerperDach({ ...EFH, ...modellDachAus(null) }), null, "ohne Datensatz kein Dach");
  });
});

describe("108-11 Review-Fixes: Pultdach geschlossen, Dachzuschlag > 45°, Rahmen-Näherung", () => {
  it("Pult: Hochwand (Traufe → hohe Traufe) und zwei Seitendreiecke schließen den Keil; Satteldach und Walm ohne Wandfüllung", () => {
    const p = /** @type {any} */ (hauptkoerperDach({ ...EFH, dachform: "pult" }));
    assert.deepEqual(p.dach.flaechen.map((/** @type {any} */ f) => f.art), ["dachflaeche"], "die Dachbibliothek liefert nur die eine Dachfläche");
    assert.deepEqual(p.wandFlaechen.map((/** @type {any} */ f) => f.id), ["pult-hochwand", "pult-seite-1", "pult-seite-2"]);
    assert.ok(p.wandFlaechen.every((/** @type {any} */ f) => f.art === "wand"));
    const ys = p.wandFlaechen.flatMap((/** @type {any} */ f) => f.punkte3d.map((/** @type {any} */ q) => q.y));
    nahe(Math.min(...ys), p.traufhoehe_m, "Wandfüllung ab Traufe");
    nahe(Math.max(...ys), p.firsthoehe_m, "bis zur hohen Traufe");
    // area of the infill: high wall = length × rise, two triangles = 2 × (width × rise / 2)
    const r = p.dach.rahmen;
    const flaeche = (/** @type {any} */ f) => {
      const d = dachDreiecke([f]); let a = 0;
      for (let i = 0; i < d.length; i += 9) {
        const ux = d[i + 3] - d[i], uy = d[i + 4] - d[i + 1], uz = d[i + 5] - d[i + 2], vx = d[i + 6] - d[i], vy = d[i + 7] - d[i + 1], vz = d[i + 8] - d[i + 2];
        a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      }
      return a;
    };
    nahe(flaeche(p.wandFlaechen[0]), 2 * r.halbL_m * p.anstieg_m, "Hochwand", 1e-6);
    nahe(flaeche(p.wandFlaechen[1]) + flaeche(p.wandFlaechen[2]), 2 * r.halbB_m * p.anstieg_m, "Seitendreiecke", 1e-6);
    assert.deepEqual(/** @type {any} */ (hauptkoerperDach(EFH)).wandFlaechen, []);
    assert.deepEqual(/** @type {any} */ (hauptkoerperDach({ ...EFH, dachform: "walm" })).wandFlaechen, []);
  });

  it("Dachzuschlag [ASSUMED]: bis 45° nichts, über 45° ein Drittel, über 70° voll (Traufseite); Giebel mindestens der Zuschlag", () => {
    assert.equal(DACH_ZUSCHLAG.length, 2);
    assert.equal(dachZuschlagAnteil(42), 0);
    assert.equal(dachZuschlagAnteil(45), 0);
    assert.equal(dachZuschlagAnteil(50), 1 / 3);
    assert.equal(dachZuschlagAnteil(75), 1);
    assert.equal(dachZuschlagAnteil(null), 0);
    const steil = /** @type {any} */ (hauptkoerperDach({ ...EFH, dachneigung: 50, footprintM: POLY_SITE.map((p) => ({ x: p.x, z: p.y })) }));
    nahe(steil.neigung_grad, 50, "Neigung");
    const k = /** @type {any[]} */ (abstandsHoehenJeKante(POLY_SITE, steil));
    nahe(k[0].hoehe_m, steil.traufhoehe_m + steil.anstieg_m / 3, "Traufseite mit 1/3 Dach");
    nahe(k[1].hoehe_m, steil.traufhoehe_m + steil.anstieg_m / 3, "Giebelseite 1/3");
    // 42°: eaves sides unchanged (the e2e values of the test house stay)
    const flach = /** @type {any[]} */ (abstandsHoehenJeKante(POLY_SITE, /** @type {any} */ (hauptkoerperDach({ ...EFH, footprintM: POLY_SITE.map((p) => ({ x: p.x, z: p.y })) }))));
    nahe(flach[0].hoehe_m, 3.9, "Traufseite 42°");
  });

  it("Rahmen-Näherung: Rechteck exakt, L-Form trägt das Dach des Rahmens (dachUeberRahmen)", () => {
    assert.equal(/** @type {any} */ (hauptkoerperDach(EFH)).dachUeberRahmen, false);
    const L = [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 5 }, { x: 5, z: 5 }, { x: 5, z: 10 }, { x: 0, z: 10 }];
    const hd = /** @type {any} */ (hauptkoerperDach({ ...EFH, footprintM: L }));
    assert.equal(hd.dachUeberRahmen, true);
    nahe(hd.grundflaeche_m2, 85, "L-Fläche");
  });
});
