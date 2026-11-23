// 108-10: two terrain layers (existing / new) — frames, the ±0,00 rule of the elevation model, earthworks, section profiles.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { demAlsRaster, hoeheBei, hoechsterPunktUnter, gelaendeEbenen, erdmassenZwischen, gelaendeProfil, profilFlaechen, profilAussen, rasterGueltig, ortVonSite, sandkastenAusHoehenmodell } from "@core/lib/massing/gelaendeEbenen.js";

/** 3 × 3 grid over 200 m, rows SOUTH → north: rises 10 m per 100 m towards east and 2 m per 100 m towards north. */
const HANG = [[300, 310, 320], [302, 312, 322], [304, 314, 324]];
const FP = [{ x: -5.7, z: -5.1 }, { x: 5.7, z: -5.1 }, { x: 5.7, z: 5.1 }, { x: -5.7, z: 5.1 }];
const nahe = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

describe("108-10 Gelände Bestand und Neu", () => {
  it("Höhenmodell als Raster: Norden liegt bei −z (keine Nord-Süd-Spiegelung), Osten bei +x", () => {
    const r = demAlsRaster(HANG, 200);
    assert.ok(rasterGueltig(r));
    nahe(hoeheBei(r, { x: 0, z: 0 }), 312);
    nahe(hoeheBei(r, { x: 100, z: 0 }), 322);
    nahe(hoeheBei(r, { x: 0, z: -100 }), 314); // north
    nahe(hoeheBei(r, { x: 0, z: 100 }), 310); // south
    nahe(hoeheBei(r, { x: 500, z: -500 }), 324); // outside: edge value
    assert.equal(demAlsRaster([], 200), null);
    assert.equal(demAlsRaster([[1, NaN], [1, 1]], 200), null);
    assert.equal(demAlsRaster(HANG, 0), null);
  });

  it("±0,00 = höchster Geländepunkt unter dem Umriss; nirgends unter dem Haus steht Gelände über dem Erdgeschoss", () => {
    const e = gelaendeEbenen({ demGrid: HANG, patch_m: 200, umriss: FP });
    assert.equal(e.quelleBestand, "hoehenmodell");
    nahe(e.bezugNHN_m, 312.67, 1e-9); // north-east corner: 312 + 0.57 + 0.102
    assert.equal(e.neu, null);
    for (const p of FP) assert.ok(hoeheBei(e.bestand, p) <= 1e-9);
    nahe(hoeheBei(e.bestand, { x: -5.7, z: 5.1 }), -(2 * 0.57 + 2 * 0.102), 1e-6); // downhill corner
    nahe(hoechsterPunktUnter(demAlsRaster(HANG, 200), null), 312);
    assert.equal(e.bezugQuelle, "regel");
    // the surveyed level of the ground floor wins over the rule: the house stands 1 m above the terrain at the origin
    const m = gelaendeEbenen({ demGrid: HANG, patch_m: 200, umriss: FP, okffNHN_m: 313 });
    assert.equal(m.bezugQuelle, "bauaufnahme");
    assert.equal(m.bezugNHN_m, 313);
    nahe(hoeheBei(m.bestand, { x: 0, z: 0 }), -1);
  });

  it("Aufnahme im Sandkasten gewinnt gegen das Höhenmodell; Neu = modelliertes Gelände, beide im Modellrahmen", () => {
    const flach = { nx: 3, ny: 3, zelle: 10, x0: 20, y0: 10, h: new Array(9).fill(-0.5) };
    const neu = { ...flach, h: [-0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5] };
    const e = gelaendeEbenen({ massing: { bezug: { x: 30, y: 20 }, gelaende: neu, gelaendeBestand: flach }, demGrid: HANG, umriss: FP });
    assert.equal(e.quelleBestand, "aufnahme");
    assert.equal(e.bezugNHN_m, null);
    assert.deepEqual([e.bestand.x0, e.bestand.y0], [-10, -10]);
    nahe(hoeheBei(e.neu, { x: 0, z: 0 }), 0.5); // the raised node sits on the model origin
    nahe(hoeheBei(e.bestand, { x: 0, z: 0 }), -0.5);
    assert.deepEqual(gelaendeEbenen({}), { bestand: null, neu: null, quelleBestand: null, bezugNHN_m: null });
    // a layer without bodies stores no `bezug`: the position of the body on the site places the rasters
    const ohneBezug = gelaendeEbenen({ massing: { gelaende: neu }, lageSite: { x: 30, y: 20 } });
    nahe(hoeheBei(ohneBezug.neu, { x: 0, z: 0 }), 0.5);
    // a stored `bezug` wins over the derived position
    nahe(hoeheBei(gelaendeEbenen({ massing: { bezug: { x: 30, y: 20 }, gelaende: neu }, lageSite: { x: 0, y: 0 } }).neu, { x: 0, z: 0 }), 0.5);
  });

  it("Erdmassen: Knotenflächen-Verfahren wie im Sandkasten, nur innerhalb des Bestandsrasters", () => {
    const b = { nx: 3, ny: 3, zelle: 2, x0: 0, y0: 0, h: new Array(9).fill(0) };
    const n = { ...b, h: [0, 0, 0, 0, 1, 0, -0.5, 0, 0] };
    assert.deepEqual(erdmassenZwischen(b, n), { abtrag_m3: 2, auftrag_m3: 4, flaeche_m2: 36 });
    const versetzt = { ...n, x0: 4 }; // only the first column still lies on the existing raster
    assert.deepEqual(erdmassenZwischen(b, versetzt), { abtrag_m3: 2, auftrag_m3: 0, flaeche_m2: 12 });
    assert.equal(erdmassenZwischen(b, null), null);
  });

  it("Schnittprofil A-A (z = 0 entlang x) und B-B (x = 0 entlang z), an den Rasterlinien abgetastet", () => {
    const r = gelaendeEbenen({ demGrid: HANG, patch_m: 200, umriss: null }).bestand; // ±0 at the origin
    const a = gelaendeProfil(r, "x", -10, 10);
    assert.deepEqual(a, [{ s_m: -10, h_m: -1 }, { s_m: 0, h_m: 0 }, { s_m: 10, h_m: 1 }]);
    const b = gelaendeProfil(r, "z", -10, 10);
    assert.deepEqual(b, [{ s_m: -10, h_m: 0.2 }, { s_m: 0, h_m: 0 }, { s_m: 10, h_m: -0.2 }]);
    assert.deepEqual(gelaendeProfil(null, "x", -10, 10), []);
  });

  it("Abtrag- und Auftragsflächen zwischen zwei Profilen, am Kreuzungspunkt geteilt", () => {
    const bestand = [{ s_m: 0, h_m: 0 }, { s_m: 10, h_m: 0 }];
    const neu = [{ s_m: 0, h_m: -1 }, { s_m: 10, h_m: 1 }];
    const f = profilFlaechen(bestand, neu);
    assert.deepEqual(f.map((x) => x.art), ["abtrag", "auftrag"]);
    assert.deepEqual(f[0].pts, [{ s_m: 0, h_m: 0 }, { s_m: 5, h_m: 0 }, { s_m: 5, h_m: 0 }, { s_m: 0, h_m: -1 }]);
    assert.deepEqual(profilFlaechen(bestand, bestand), []);
    // the ground stops at the outer faces of the building: two parts, each ending exactly on the face
    assert.deepEqual(profilAussen(neu, 4, 6), [[{ s_m: 0, h_m: -1 }, { s_m: 4, h_m: -0.2 }], [{ s_m: 6, h_m: 0.2 }, { s_m: 10, h_m: 1 }]]);
    assert.deepEqual(profilAussen(neu, -1, 11), []);
    assert.deepEqual(profilAussen(null, 0, 1), []);
  });

  it("Sandkasten aus dem Höhenmodell: Feld um den Projektort, ±0,00 nach Bauaufnahme oder höchstem Punkt unter dem Baukörper", () => {
    // field 40 × 30 m, parcel centre 16 px east of the project location at 1,25 m/px = 20 m east
    const feld = { w: 40, d: 30, mpp: 1.25, cx: 616, cy: 400 };
    assert.deepEqual(ortVonSite(feld, { x: 20, y: 15 }), { x: 20, z: 0 });
    assert.deepEqual(ortVonSite(feld, { x: 0, y: 0 }), { x: 0, z: -15 });
    const koerper = [{ x: 15, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 20 }, { x: 15, y: 20 }]; // 10 × 10 m around the field centre
    const r = sandkastenAusHoehenmodell({ feld, demGrid: HANG, patch_m: 200, umrissSite: koerper });
    assert.equal(r.bezugQuelle, "regel");
    assert.equal(r.gelaende.nx, 41);
    assert.equal(r.gelaende.ny, 31);
    // highest point under the body: north-east corner at location x = 25, z = −5 → 312 + 2,5 + 0,1 = 314,6
    assert.equal(r.bezugNHN_m, 314.6);
    assert.ok(Math.max(...koerper.map((p) => hoeheBei(r.gelaende, { x: p.x, z: p.y }))) <= 1e-9);
    const m = sandkastenAusHoehenmodell({ feld, demGrid: HANG, patch_m: 200, umrissSite: koerper, okffNHN_m: 315 });
    assert.equal(m.bezugQuelle, "bauaufnahme");
    assert.ok(Math.abs(hoeheBei(m.gelaende, { x: 20, z: 15 }) - (314 - 315)) < 1e-6); // field centre = location x 20, z 0 → 314
    assert.equal(sandkastenAusHoehenmodell({ feld, demGrid: [], patch_m: 200 }), null);
  });
});
