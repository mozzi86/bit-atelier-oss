// 107-11 — rooms: proposal from walls (the one detection), measuring rule and net area, DIN 277 with basements, WoFlV sloping areas
// from the roof geometry, IFC room boundaries. Every expected value is calculated by hand in the comment next to it; the library
// result is never its own reference.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  raumErkennen, raumBeiKlick, raeumeAusWaenden, zoneAusVorschlag, vorschlagVorhanden, meldungText, nettoFlaeche_m2, raeumeMitNetto,
  din277Flaechen, din277Gruppe, din277Bereich, grenzWaende, messregelVon, MELDUNG_KEIN_RAUM, DIN277_ZU_NUTZUNG,
} from "@core/lib/bauteil/raeume.js";
import { DIN277_ZU_NUTZUNG as DIN277_ALT } from "@designer/lib/bestandsProgramm";
import { zerlegeInDreiecke, flaeche } from "@core/lib/formGeometrie.js";
import { dachBerechnen } from "@core/lib/bauteil/dachGeometrie.js";
import { dachschraegenAnteile, dachschraegenJeRaum, dachgeschossDach, KNIESTOCK_STANDARD_M } from "@designer/lib/dachschraegenAnteile";
import { woflvFlaeche } from "@designer/lib/wohnungsTypen";
import { werkstattRaeume, werkstattBauteile } from "@core/lib/werkstattBauteile";
import { createBuildingModel } from "@core/lib/buildingModel.js";
import { ebenenListe } from "@core/lib/bauteil/ebenen.js";
import { exportIFC } from "@designer/lib/ifcExport";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";

const nahe = (/** @type {number} */ ist, /** @type {number} */ soll, /** @type {number} */ tol, /** @type {string} */ was) =>
  assert.ok(Math.abs(ist - soll) <= tol, `${was}: ${ist} statt ${soll} (±${tol})`);
const R = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** wall record, thickness 0.2 m, centre reference line */
const W = (/** @type {number} */ ax, /** @type {number} */ az, /** @type {number} */ bx, /** @type {number} */ bz, extra = {}) =>
  ({ a: { x: ax, z: az }, b: { x: bx, z: bz }, level: 0, thickness: 0.2, ...extra });
/** closed rectangle of walls x0…x1 × z0…z1 on the axes */
const rechteckWaende = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1, extra = {}) =>
  [W(x0, z0, x1, z0, extra), W(x1, z0, x1, z1, extra), W(x1, z1, x0, z1, extra), W(x0, z1, x0, z0, extra)];

// ------------------------------------------------------------------------------------------------------------------------------
// The click detection as it stood in BitBimStudio.jsx until 107-11 (verbatim copy, the reference of the move)
// ------------------------------------------------------------------------------------------------------------------------------
function raySegTAlt(o, d, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z;
  const det = ex * d.z - d.x * ez;
  if (Math.abs(det) < 1e-9) return Infinity;
  const wx = a.x - o.x, wz = a.z - o.z;
  const t = (-wx * ez + ex * wz) / det;
  const s = (d.x * wz - d.z * wx) / det;
  return (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) ? t : Infinity;
}
function polyAreaXZAlt(pts) {
  return Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
}
function detectRoomAlt(p, segments, maxR = 80) {
  const N = 120, raw = []; let openHits = 0;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const d = { x: Math.cos(ang), z: Math.sin(ang) };
    let best = maxR;
    for (const [a, b] of segments) { const t = raySegTAlt(p, d, a, b); if (t < best) best = t; }
    if (best >= maxR - 1e-3) openHits++;
    const pull = Math.min(0.12, best * 0.04);
    raw.push({ x: p.x + d.x * (best - pull), z: p.z + d.z * (best - pull) });
  }
  if (openHits > N * 0.12) return null;
  let pts = raw.filter((q, i) => { const r = raw[(i + 1) % raw.length]; return Math.hypot(q.x - r.x, q.z - r.z) > 0.08; });
  const keep = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 0.05) keep.push({ x: Math.round(b.x / 0.05) * 0.05, z: Math.round(b.z / 0.05) * 0.05 });
  }
  return keep.length >= 3 ? keep : null;
}
/** the old click branch: polygon, or the old hint */
const klickAlt = (/** @type {any} */ p, /** @type {any} */ segs) => {
  const poly = detectRoomAlt(p, segs);
  return poly && polyAreaXZAlt(poly) > 0.5 ? { punkte: poly, meldung: null } : { punkte: null, meldung: "Kein geschlossener Raum erkannt — in eine von Wänden umschlossene Fläche klicken." };
};
const segsVon = (/** @type {any[]} */ waende) => waende.map((w) => [w.a, w.b]);

describe("107-11 Task 1 — Klick-Erkennung verschoben (Vergleich Alt/Neu)", () => {
  const grundrisse = {
    rechteck: { segs: segsVon(rechteckWaende(0, 0, 6, 4)), klicks: [{ x: 3, z: 2 }, { x: 0.5, z: 0.5 }, { x: 5.7, z: 3.6 }] },
    lForm: { segs: segsVon([W(0, 0, 6, 0), W(6, 0, 6, 3), W(6, 3, 3, 3), W(3, 3, 3, 6), W(3, 6, 0, 6), W(0, 6, 0, 0)]), klicks: [{ x: 1, z: 1 }, { x: 1.5, z: 5 }, { x: 5, z: 2 }] },
    zweiRaeume: { segs: segsVon([...rechteckWaende(0, 0, 8, 5), W(4, 0, 4, 5)]), klicks: [{ x: 2, z: 2 }, { x: 6, z: 3 }] },
    offen: { segs: segsVon([W(0, 0, 6, 0), W(6, 0, 6, 4), W(6, 4, 0, 4)]), klicks: [{ x: 3, z: 2 }] },
    aussen: { segs: segsVon(rechteckWaende(0, 0, 6, 4)), klicks: [{ x: 20, z: 20 }] },
  };
  for (const [name, g] of Object.entries(grundrisse)) {
    it(`${name}: gleiche Polygone und gleiche Meldung wie vorher`, () => {
      for (const k of g.klicks) {
        assert.deepEqual(raumErkennen(k, g.segs), detectRoomAlt(k, g.segs), `raumErkennen ${JSON.stringify(k)}`);
        assert.deepEqual(raumBeiKlick(k, g.segs), klickAlt(k, g.segs), `Klick ${JSON.stringify(k)}`);
      }
    });
  }
  it("offener Raum: die alte Meldung unverändert", () => {
    assert.equal(raumBeiKlick({ x: 3, z: 2 }, grundrisse.offen.segs).meldung, MELDUNG_KEIN_RAUM);
    assert.equal(MELDUNG_KEIN_RAUM, "Kein geschlossener Raum erkannt — in eine von Wänden umschlossene Fläche klicken.");
  });
});

describe("107-11 Task 1 — Raumvorschlag aus Wänden (planarer Graph, minimale Zyklen)", () => {
  it("Rechteck 6 × 4 m, Wände 0,20 m auf der Achse: ein Raum, innen 5,80 × 3,80 = 22,04 m², an der Achse 24 m²", () => {
    const r = raeumeAusWaenden(rechteckWaende(0, 0, 6, 4), 0);
    assert.equal(r.raeume.length, 1);
    assert.deepEqual(r.meldungen, []);
    assert.equal(r.raeume[0].flaeche_m2, 22.04);
    assert.equal(r.raeume[0].flaeche_referenzlinie_m2, 24);
    assert.deepEqual(r.raeume[0].waende, ["w0", "w1", "w2", "w3"]);
    assert.equal(r.raeume[0].quelle, "abgeleitet");
    nahe(flaeche(r.raeume[0].punkte), 22.04, 1e-9, "Polygonfläche");
  });
  it("Trennwand bei x = 3: zwei Räume je 2,80 × 3,80 = 10,64 m²", () => {
    const r = raeumeAusWaenden([...rechteckWaende(0, 0, 6, 4), W(3, 0, 3, 4)], 0);
    assert.deepEqual(r.raeume.map((x) => x.flaeche_m2), [10.64, 10.64]);
  });
  it("L-Form (6 × 3 plus 3 × 3, an der Achse 27 m²): innen 5,80 × 2,80 + 2,80 × 3,00 = 24,64 m², sechs Ecken", () => {
    const r = raeumeAusWaenden([W(0, 0, 6, 0), W(6, 0, 6, 3), W(6, 3, 3, 3), W(3, 3, 3, 6), W(3, 6, 0, 6), W(0, 6, 0, 0)], 0);
    assert.equal(r.raeume.length, 1);
    assert.equal(r.raeume[0].flaeche_referenzlinie_m2, 27);
    assert.equal(r.raeume[0].flaeche_m2, 24.64);
    assert.equal(r.raeume[0].punkte.length, 6);
  });
  it("offene Kette: kein Raum, beide Enden benannt („Kette nicht geschlossen bei …“)", () => {
    const r = raeumeAusWaenden([W(0, 0, 6, 0), W(6, 0, 6, 4), W(6, 4, 0, 4)], 0);
    assert.equal(r.raeume.length, 0);
    assert.deepEqual(r.meldungen.map((m) => m.code), ["kette-offen", "kette-offen"]);
    assert.deepEqual(r.meldungen.map((m) => m.punkt), [{ x: 0, z: 0 }, { x: 0, z: 4 }]);
    assert.equal(meldungText(r.meldungen[0]), "Kette nicht geschlossen bei (0.00; 0.00)");
  });
  it("Spalt von 1,00 m in der Wandlinie: eine Meldung „Spalt“ mit Breite statt zweier offener Enden", () => {
    const r = raeumeAusWaenden([W(0, 0, 6, 0), W(6, 0, 6, 4), W(6, 4, 0, 4), W(0, 4, 0, 1)], 0);
    assert.equal(r.raeume.length, 0);
    assert.equal(r.meldungen.length, 1);
    assert.equal(r.meldungen[0].code, "spalt");
    assert.equal(r.meldungen[0].breite_m, 1);
    assert.equal(meldungText(r.meldungen[0]), "Spalt 1.00 m zwischen (0.00; 0.00) und (0.00; 1.00)");
  });
  it("Wand an die Fläche der Nachbarwand gezeichnet (T-Stoß, Ende 0,10 m vor der Achse): wird angeschlossen", () => {
    const r = raeumeAusWaenden([...rechteckWaende(0, 0, 6, 4), W(3, 0.1, 3, 3.9)], 0);
    assert.deepEqual(r.raeume.map((x) => x.flaeche_m2), [10.64, 10.64]);
  });
  it("nicht raumbegrenzende Trennwand teilt den Raum nicht", () => {
    const r = raeumeAusWaenden([...rechteckWaende(0, 0, 6, 4), W(3, 0, 3, 4, { raumbegrenzend: false })], 0);
    assert.deepEqual(r.raeume.map((x) => x.flaeche_m2), [22.04]);
  });
  it("Untergeschoss: negative Level, UG-Wände gehören nur zu ihrem Geschoss", () => {
    const ug = rechteckWaende(0, 0, 5, 5, { level: -1 });
    assert.equal(raeumeAusWaenden(ug, -1).raeume[0].flaeche_m2, 4.8 * 4.8);
    assert.equal(raeumeAusWaenden(ug, 0).raeume.length, 0);
  });
  it("Referenzlinie innen/außen: Innenpolygon an der Körperfläche (Körper außerhalb → Innenpolygon = Achspolygon)", () => {
    // refLine "inside" puts the body on the −n side of a→b; for a counter-clockwise rectangle that is outside → room = 6 × 4
    const r = raeumeAusWaenden(rechteckWaende(0, 0, 6, 4, { refLine: "inside" }), 0);
    assert.equal(r.raeume[0].flaeche_m2, 24);
    // "outside" puts the body into the room: 5,60 × 3,60 = 20,16 m²
    assert.equal(raeumeAusWaenden(rechteckWaende(0, 0, 6, 4, { refLine: "outside" }), 0).raeume[0].flaeche_m2, 20.16);
  });
  it("Vorschlag → customZones-Satz (Messregel), vorhandene Zone wird erkannt", () => {
    const v = raeumeAusWaenden(rechteckWaende(0, 0, 6, 4), 0).raeume[0];
    const z = zoneAusVorschlag(v);
    assert.deepEqual(z, { points: v.punkte, level: 0 });
    assert.equal("messregel" in z, false, "Standard innenkante wird nicht gespeichert");
    assert.deepEqual(zoneAusVorschlag(v, { messregel: "referenzlinie" }).points, v.punkte_referenzlinie);
    assert.equal(vorschlagVorhanden(v, []), false);
    assert.equal(vorschlagVorhanden(v, [{ ...z, name: "Raum 1" }]), true);
    assert.equal(vorschlagVorhanden(v, [{ ...z, level: 1 }]), false);
  });
});

describe("107-11 Task 2 — Messregel und Netto-Fläche", () => {
  const raum = { points: R(0, 0, 4, 3), level: 0 }; // 12 m²
  it("Stütze 0,40 m und überlappender Aufzug (1 × 1 m im Raum): 12 − 0,16 − 1,00 = 10,84 m²", () => {
    const aufzug = { points: R(3, 2, 5, 4), level: 0, raumart: "aufzug" };
    assert.equal(nettoFlaeche_m2(raum, { stuetzen: [{ x: 2, z: 1.5, level: 0, size: 0.4 }], zonen: [raum, aufzug] }), 10.84);
  });
  it("Stütze im Schacht wird nur einmal abgezogen; Stütze anderes Geschoss zählt nicht", () => {
    const schacht = { points: R(0, 0, 1, 1), level: 0, raumart: "treppenraum" };
    // shaft 1 m² inside the room, column 0.4 × 0.4 fully inside the shaft → 12 − 1 = 11
    assert.equal(nettoFlaeche_m2(raum, { stuetzen: [{ x: 0.5, z: 0.5, level: 0, size: 0.4 }, { x: 2, z: 2, level: 1, size: 0.4 }], zonen: [raum, schacht] }), 11);
    // the shaft zone itself keeps its area (12 → shaft 1 m²)
    assert.equal(nettoFlaeche_m2(schacht, { zonen: [raum, schacht] }), 1);
  });
  it("konkaver Schacht (L, 3 m²) wird über Dreiecke exakt abgezogen", () => {
    const L = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 2 }, { x: 0, z: 2 }];
    assert.equal(zerlegeInDreiecke(L).reduce((s, t) => s + flaeche(t), 0), 3);
    assert.equal(nettoFlaeche_m2(raum, { zonen: [raum, { points: L, level: 0, raumart: "aufzug" }] }), 9);
  });
  it("Messregel „referenzlinie“: Raum auf den Achsen minus Wandkörper = Innenmaß (6 × 4, Wände 0,20 → 22,04 m²)", () => {
    const waende = rechteckWaende(0, 0, 6, 4);
    const z = { points: R(0, 0, 6, 4), level: 0, messregel: "referenzlinie" };
    assert.equal(messregelVon(z), "referenzlinie");
    assert.equal(nettoFlaeche_m2(z, { waende }), 22.04);
    assert.equal(nettoFlaeche_m2({ ...z, messregel: undefined }, { waende }), 24, "innenkante: Polygon ist der lichte Raum");
  });
  it("Werkstatt-Räume: werkstattRaeume bleibt unverändert, raeumeMitNetto ergänzt flaeche_netto_m2", () => {
    const zonen = [{ points: R(0, 0, 4, 3), level: 0, name: "Wohnen ·WT", we: "1" }, { points: R(3, 2, 5, 4), level: 0, name: "Aufzug ·WT", raumart: "aufzug" }];
    const roh = werkstattRaeume(zonen);
    assert.equal("flaeche_netto_m2" in roh[0], false);
    const netto = raeumeMitNetto(roh);
    assert.equal(netto[0].flaeche_m2, 12);
    assert.equal(netto[0].flaeche_netto_m2, 11);
    assert.equal(netto[1].flaeche_netto_m2, 4);
  });
});

describe("107-11 Task 3 — DIN 277", () => {
  it("DIN277_ZU_NUTZUNG liegt in @core, bestandsProgramm re-exportiert dieselbe Tabelle", () => {
    assert.equal(DIN277_ALT, DIN277_ZU_NUTZUNG);
    assert.equal(DIN277_ZU_NUTZUNG["01"].use, "gemeinschaft");
  });
  it("Gruppe: gesetzt vor abgeleitet; Flur/Treppe/Aufzug → 09, Technik → 08, Büro → 02, sonst 01", () => {
    assert.deepEqual(din277Gruppe({ din277_gruppe: "05", raumart: "flur" }), { gruppe: "05", quelle: "gesetzt" });
    assert.equal(din277Gruppe({ raumart: "treppenraum" }).gruppe, "09");
    assert.equal(din277Gruppe({ use: "technik" }).gruppe, "08");
    assert.equal(din277Gruppe({ use: "buero" }).gruppe, "02");
    assert.equal(din277Gruppe({ use: "wohnen" }).gruppe, "01");
    assert.equal(din277Gruppe({}).gruppe, "01");
    assert.deepEqual(["01", "07", "08", "09"].map(din277Bereich), ["nuf", "nuf", "tf", "vf"]);
  });
  it("6 × 4 m, Hüllwände 0,20 m auf dem Footprint, Flur 2 × 3: BGF 24, KGF 1,96, NGF 22,04, VF 6, TF 0, NUF 16,04", () => {
    // KGF = the inner halves of the walls inside the footprint: 24 − 5.8 × 3.8 = 1.96
    const d = din277Flaechen({
      zonen: [{ points: R(0, 0, 4, 3), level: 0 }, { points: R(4, 0, 6, 3), level: 0, raumart: "flur" }],
      waende: rechteckWaende(0, 0, 6, 4), footprint: R(0, 0, 6, 4), storeys: 1,
    });
    const g = d.geschosse[0];
    assert.deepEqual({ bgf: g.bgf, kgf: g.kgf, ngf: g.ngf, vf: g.vf, tf: g.tf, nuf: g.nuf }, { bgf: 24, kgf: 1.96, ngf: 22.04, vf: 6, tf: 0, nuf: 16.04 });
    nahe(g.kgf + g.ngf, g.bgf, 1e-9, "BGF = KGF + NGF");
    nahe(g.nuf + g.vf + g.tf, g.ngf, 1e-9, "NGF = NUF + VF + TF");
  });
  it("Stütze 0,40 m und Technikraum: KGF + 0,16, TF aus der Zone", () => {
    const d = din277Flaechen({
      zonen: [{ points: R(1, 1, 3, 3), level: 0, use: "technik" }], stuetzen: [{ x: 5, z: 2, level: 0, size: 0.4 }],
      waende: rechteckWaende(0, 0, 6, 4), footprint: R(0, 0, 6, 4), storeys: 1,
    });
    const g = d.geschosse[0];
    assert.equal(g.kgf, 2.12); // 1.96 + 0.16
    assert.equal(g.tf, 4);
    assert.equal(g.nuf, 24 - 2.12 - 4);
  });
  it("Untergeschoss als eigene Zeile, Summen oberirdisch / unterirdisch / gesamt (D-BK-20)", () => {
    const fp = R(-5, -4, 5, 4); // 80 m²
    const model = createBuildingModel({ footprintM: fp, storeys: 2, storeyHeight: 3, untergeschosse: 1 });
    const ebenen = ebenenListe(model);
    assert.deepEqual(ebenen.map((e) => e.level), [-1, 0, 1]);
    const d = din277Flaechen({ zonen: [{ points: R(-4, -3, 0, 0), level: -1, raumart: "technik" }], waende: model.walls, footprint: fp, ebenen });
    assert.deepEqual(d.geschosse.map((g) => g.level), [-1, 0, 1]);
    for (const g of d.geschosse) {
      assert.equal(g.bgf, 80, `BGF Level ${g.level} = Footprint`);
      nahe(g.kgf + g.ngf, g.bgf, 1e-9, `BGF = KGF + NGF (${g.level})`);
      nahe(g.nuf + g.vf + g.tf, g.ngf, 1e-9, `NGF = NUF + VF + TF (${g.level})`);
    }
    // basement hull walls 0.24 m (single24), centred on the footprint: KGF = 80 − 9.76 × 7.76 = 4.2624
    assert.equal(d.geschosse[0].kgf, 4.262);
    assert.equal(d.geschosse[0].tf, 12);
    assert.equal(d.unterirdisch.bgf, 80);
    assert.equal(d.oberirdisch.bgf, 160);
    assert.equal(d.gesamt.bgf, 240);
    nahe(d.gesamt.ngf, d.oberirdisch.ngf + d.unterirdisch.ngf, 1e-9, "Summe gesamt");
    nahe(d.gesamt.kgf + d.gesamt.ngf, d.gesamt.bgf, 1e-9, "Summenidentität");
  });
  it("ohne Untergeschoss: mit ebenenListe dasselbe Ergebnis wie mit storeys (wie bisher)", () => {
    const fp = R(0, 0, 10, 8);
    const model = createBuildingModel({ footprintM: fp, storeys: 3 });
    const e = { zonen: [{ points: R(1, 1, 3, 3), level: 1 }], waende: model.walls, footprint: fp };
    assert.deepEqual(din277Flaechen({ ...e, ebenen: ebenenListe(model) }).gesamt, din277Flaechen({ ...e, storeys: 3 }).gesamt);
    assert.equal(din277Flaechen({ ...e, storeys: 3 }).unterirdisch.bgf, 0);
  });
  it("Werkstatt-Rohbau (D-BW-02): BGF = lichte Fläche + Wände, NGF = lichte Fläche", () => {
    // two clear zones 4 × 3 side by side (24 m²) in a 8 × 3 footprint; the shell grows by the walls
    const zonen = [{ points: R(0, 0, 4, 3), level: 0, name: "A ·WT", we: "1" }, { points: R(4, 0, 8, 3), level: 0, name: "B ·WT", we: "2" }];
    const rohbau = werkstattBauteile(zonen).rohbau;
    const d = din277Flaechen({ zonen, footprint: R(0, 0, 8, 3), storeys: 1, rohbau });
    const g = d.geschosse[0];
    nahe(g.bgf, rohbau[0].rohbau_m2, 1e-3, "BGF = Rohbau");
    nahe(g.ngf, 24, 1e-3, "NGF = lichte Zonen");
    nahe(g.kgf, rohbau[0].aussenwand_m2 + rohbau[0].innenwand_m2, 1e-3, "KGF = Wände der Werkstatt");
  });
  it("Zonen über den Wänden (VF > NGF): NUF 0, Identitäten bleiben, Meldung", () => {
    const d = din277Flaechen({ zonen: [{ points: R(0, 0, 6, 4), level: 0, raumart: "flur" }], waende: rechteckWaende(0, 0, 6, 4), footprint: R(0, 0, 6, 4), storeys: 1 });
    const g = d.geschosse[0];
    assert.equal(g.nuf, 0);
    assert.equal(g.vf, 24);
    nahe(g.kgf + g.ngf, g.bgf, 1e-9, "BGF = KGF + NGF");
    assert.equal(d.meldungen[0].code, "zonen-ueber-ngf");
  });
});

describe("107-11 Task 4 — WoFlV aus der Dachgeometrie", () => {
  it("Pultdach, Firsthöhe 2,5 m über 4 m, Raum 4 × 4: < 1 m = 4 × 1,6 = 6,4 m², 1–2 m = 4 × 1,6 = 6,4 m²", () => {
    // h(s) = 2.5 · s / 4 over the run s: h < 1 ⇔ s < 1.6; 1 ≤ h < 2 ⇔ 1.6 ≤ s < 3.2
    const dach = dachBerechnen(R(0, 0, 4, 4), { form: "pult" }, { traufhoehe_m: 0, anstieg_m: 2.5 });
    assert.ok(dach.ok);
    const a = dachschraegenAnteile(R(0, 0, 4, 4), dach);
    assert.deepEqual(a, { unter1m_m2: 6.4, zwischen1und2m_m2: 6.4, flaeche_m2: 16 });
  });
  it("Satteldach 45°, Traufe 1,0 m über dem Boden, 8 × 6: kein Bereich unter 1 m, 1–2 m = zwei Streifen 8 × 1 = 16 m²", () => {
    const dach = dachgeschossDach({ footprint: R(0, 0, 8, 6), dachform: "sattel", dachneigung: 45, kniestock_m: 1 });
    assert.ok(dach);
    const a = dachschraegenAnteile(R(0, 0, 8, 6), dach);
    assert.equal(a.unter1m_m2, 0);
    assert.equal(a.zwischen1und2m_m2, 16);
  });
  it("Flachdach / kein Dach: keine Teilflächen; Kniestock-Standard 1,0 m [ASSUMED]", () => {
    assert.equal(dachgeschossDach({ footprint: R(0, 0, 8, 6), dachform: "flach", dachneigung: 30 }), null);
    assert.deepEqual(dachschraegenAnteile(R(0, 0, 4, 4), null), { unter1m_m2: 0, zwischen1und2m_m2: 0, flaeche_m2: 16 });
    assert.equal(KNIESTOCK_STANDARD_M, 1);
  });
  it("woflvFlaeche: geometrische und von Hand eingegebene Teilflächen liefern bei gleichen Werten dasselbe", () => {
    const dach = dachBerechnen(R(0, 0, 4, 4), { form: "pult" }, { traufhoehe_m: 0, anstieg_m: 2.5 });
    const geo = dachschraegenJeRaum([{ name: "Zimmer", flaeche_m2: 16, points: R(0, 0, 4, 4) }], dach);
    const hand = [{ name: "Zimmer", flaeche_m2: 16, dachschraege: { unter1m_m2: 6.4, zwischen1und2m_m2: 6.4 } }];
    const a = woflvFlaeche({ raeume: geo }), b = woflvFlaeche({ raeume: hand });
    assert.deepEqual(a, b);
    nahe(a.wohnflaeche_m2, 6.4 * 0 + 6.4 * 0.5 + 3.2, 1e-9, "WoFlV § 4: 0 % + 50 % + 100 %");
  });
});

describe("107-11 Task 5 — IFC-Raumgrenzen", () => {
  it("ohne Option byte-gleich (Golden 107-01), Option false = ohne Option", () => {
    const { model, ohne } = ifcGoldenSzenario();
    const soll = readFileSync(fileURLToPath(new URL("./fixtures/ifc-golden-107.ifc", import.meta.url)), "utf8");
    assert.equal(exportIFC(model, { ...ohne, raumGrenzen: false }), soll);
  });
  it("mit Option: IfcRelSpaceBoundary zu den begrenzenden Wänden, Qto mit Netto-Fläche", () => {
    const fp = R(-4, -3, 4, 3);
    const model = createBuildingModel({ footprintM: fp, storeys: 1, storeyHeight: 3, wallThickness: 0.3 });
    const customWalls = [{ a: { x: 0, z: -3 }, b: { x: 0, z: 3 }, level: 0, thickness: 0.2, height: 3, _idx: 1 }];
    // the room west of the partition, drawn on the inner faces: x −3.85 … −0.1, z −2.85 … 2.85
    const customZones = [{ points: R(-3.85, -2.85, -0.1, 2.85), level: 0, name: "West", _idx: 2 }];
    const customColumns = [{ x: -2, z: 0, level: 0, size: 0.4, _idx: 3 }];
    const basis = { customWalls, customZones, customColumns, storeyHeight: 3 };
    const ohneText = exportIFC(model, basis);
    assert.equal(ohneText.includes("IFCRELSPACEBOUNDARY"), false);
    const mitText = exportIFC(model, { ...basis, raumGrenzen: true });
    const zeilen = mitText.split("\n");
    const raum = zeilen.find((l) => l.includes("=IFCSPACE(") && l.includes("'West'"));
    assert.ok(raum);
    const raumRef = raum.split("=")[0];
    const grenzen = zeilen.filter((l) => l.includes("=IFCRELSPACEBOUNDARY(") && l.includes(`,${raumRef},`));
    // west, north, south hull walls (EXTERNAL) and the partition (INTERNAL)
    assert.equal(grenzen.length, 4);
    assert.equal(grenzen.filter((l) => l.includes(".EXTERNAL.")).length, 3);
    assert.equal(grenzen.filter((l) => l.includes(".INTERNAL.")).length, 1);
    // net area: 3.75 × 5.7 = 21.375 m² minus the column 0.16 = 21.215 m²
    assert.ok(mitText.includes("'NetFloorArea',$,$,21.2150,$"), "NetFloorArea");
    assert.ok(mitText.includes("'GrossFloorArea',$,$,21.3750,$"), "GrossFloorArea");
    // everything before the new block is the old file, line for line
    const ohneZeilen = ohneText.split("\n");
    const k = zeilen.findIndex((l) => l.includes("=IFCRELSPACEBOUNDARY("));
    assert.ok(k > 0);
    assert.deepEqual(zeilen.slice(0, k), ohneZeilen.slice(0, k));
  });
  it("grenzWaende: Kante entlang der Wandfläche zählt, schräge oder entfernte Kanten nicht", () => {
    const w = [{ schluessel: "a", a: { x: 0, z: -0.1 }, b: { x: 6, z: -0.1 }, dicke_m: 0.2 }, { schluessel: "b", a: { x: 0, z: 5 }, b: { x: 6, z: 5 }, dicke_m: 0.2 }];
    assert.deepEqual(grenzWaende(R(0, 0, 4, 3), w), [{ schluessel: "a", laenge_m: 4 }]);
  });
});

describe("107-11 Task 1 — Insel (freistehende Wandgruppe im Raum)", () => {
  it("Raum 4 × 4 frei im Hüllraum 10 × 8: zwei Vorschläge, der äußere mit insel: true und Meldung", () => {
    const r = raeumeAusWaenden([...rechteckWaende(-5, -4, 5, 4), ...rechteckWaende(-3, -2, 1, 2)], 0);
    assert.deepEqual(r.raeume.map((x) => x.flaeche_m2), [9.8 * 7.8, 3.8 * 3.8].map((v) => Math.round(v * 1000) / 1000));
    assert.equal(r.raeume[0].insel, true);
    assert.equal("insel" in r.raeume[1], false);
    assert.deepEqual(r.meldungen.map((m) => m.code), ["insel"]);
    assert.match(meldungText(r.meldungen[0]), /^Raum um \(0\.00; 0\.00\) enthält freistehende Wände/);
  });
});

describe("107-11 Task 3 — KGF der gezeichneten Wände: Rechtecke + Eckfüller, oder die Bänder aus 107-09", async () => {
  const { baender } = await import("@core/lib/bauteil/verschneidung.js");
  const fp = R(-2, -2, 8, 6); // large footprint: the drawn ring lies fully inside
  it("Ring 6 × 4 m, Wände 0,20 m ohne Aufbau: KGF = 6,2 × 4,2 − 5,8 × 3,8 = 4,00 m² (Ecken je einmal)", () => {
    const waende = rechteckWaende(0, 0, 6, 4).map((w, i) => ({ schluessel: `cw:${i + 1}`, wand: { ...w, _idx: i + 1 } }));
    assert.equal(din277Flaechen({ waende, footprint: fp, storeys: 1 }).geschosse[0].kgf, 4);
  });
  it("Ring mit Aufbau single24 (0,24 m): ohne und mit den Bändern dieselbe KGF 6,24 × 4,24 − 5,76 × 3,76 = 4,80 m²", () => {
    const waende = rechteckWaende(0, 0, 6, 4, { composite: "single24", thickness: undefined }).map((w, i) => ({ schluessel: `cw:${i + 1}`, wand: { ...w, _idx: i + 1 } }));
    assert.equal(din277Flaechen({ waende, footprint: fp, storeys: 1 }).geschosse[0].kgf, 4.8);
    assert.equal(din277Flaechen({ waende, footprint: fp, storeys: 1, baender }).geschosse[0].kgf, 4.8);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// Review fixes 107-11 (26.10.2026)
// ------------------------------------------------------------------------------------------------------------------------------
describe("107-11 Review — Übernahme mit Messregel Referenzlinie wird erkannt", () => {
  it("6 × 4, Wände 0,20: nach Übernahme mit referenzlinie (24 m²) gilt der Vorschlag (innen 22,04 m²) als übernommen", () => {
    const v = raeumeAusWaenden(rechteckWaende(0, 0, 6, 4), 0).raeume[0];
    const zone = zoneAusVorschlag(v, { messregel: "referenzlinie" });
    assert.equal(flaeche(zone.points), 24);
    assert.equal(vorschlagVorhanden(v, [zone]), true);
    assert.equal(vorschlagVorhanden(v, [zoneAusVorschlag(v)]), true);
    // "Alle übernehmen" filters with exactly this function: nothing is left to take over, no duplicate zone
    assert.deepEqual([v].filter((x) => !vorschlagVorhanden(x, [zone])), []);
    // another storey does not match
    assert.equal(vorschlagVorhanden(v, [{ ...zone, level: 1 }]), false);
  });
});

describe("107-11 Review — Spalt nur zwischen Enden, deren Schließen einen Raum ergäbe", () => {
  it("freistehende Wand 1,50 m im Raum 6 × 4: kein „Spalt 1.50 m“, zwei offene Enden; der Raum bleibt", () => {
    const r = raeumeAusWaenden([...rechteckWaende(0, 0, 6, 4), W(2, 2, 3.5, 2)], 0);
    assert.equal(r.raeume.length, 1);
    assert.deepEqual(r.meldungen.map((m) => m.code), ["kette-offen", "kette-offen"]);
    assert.deepEqual(r.meldungen.map((m) => m.punkt), [{ x: 2, z: 2 }, { x: 3.5, z: 2 }]);
  });
  it("U-Form mit 1,00 m Lücke bleibt ein Spalt (Schließen ergäbe 24 m²)", () => {
    const r = raeumeAusWaenden([W(0, 0, 6, 0), W(6, 0, 6, 4), W(6, 4, 0, 4), W(0, 4, 0, 1)], 0);
    assert.deepEqual(r.meldungen.map((m) => m.code), ["spalt"]);
    assert.equal(r.meldungen[0].breite_m, 1);
  });
  it("zwei getrennte Wände in einer Linie mit 0,90 m Abstand: Spalt (verschiedene Wandgruppen)", () => {
    const r = raeumeAusWaenden([W(0, 0, 3, 0), W(3.9, 0, 6, 0)], 0);
    assert.deepEqual(r.meldungen.map((m) => m.code).sort(), ["kette-offen", "kette-offen", "spalt"]);
    assert.equal(r.meldungen.find((m) => m.code === "spalt")?.breite_m, 0.9);
  });
});

describe("107-11 Review — NUF der Kennzahlen je Geschoss (80 % nur ohne Zonen)", async () => {
  const { nufFuerKennzahlen, NUF_PAUSCHAL_ANTEIL } = await import("@designer/lib/kennzahlen");
  const fp = R(-5, -4, 5, 4); // 10 × 8 = 80 m²
  const zone = { points: R(-4.85, -3.85, 4.85, 3.85), level: 0, use: "wohnen" };
  const huelle = createBuildingModel({ footprintM: fp, storeys: 3, storeyHeight: 3 }).walls.map((w) => ({ schluessel: `env:${w.level}:${w.edge}`, wand: w }));
  it("Zone nur im EG, 3 Geschosse, Hülle 0,30 mittig: EG 9,70 × 7,70 = 74,69 m², OG je 80 × 0,8 = 64 → 202,69 (alt 240)", () => {
    assert.equal(NUF_PAUSCHAL_ANTEIL, 0.8);
    const r = nufFuerKennzahlen({ bgf: 240, zonen: [zone], footprint: fp, storeys: 3, waende: huelle });
    nahe(r.nuf, 74.69 + 128, 1e-9, "NUF");
    assert.equal(r.quelle, "gemischt");
  });
  it("ohne Hüllwände: EG KGF 0 → 80, OG je 64 → 208; nie über der BGF", () => {
    nahe(nufFuerKennzahlen({ bgf: 240, zonen: [zone], footprint: fp, storeys: 3 }).nuf, 208, 1e-9, "NUF");
    nahe(nufFuerKennzahlen({ bgf: 100, zonen: [zone], footprint: fp, storeys: 3 }).nuf, 100, 1e-9, "NUF auf BGF begrenzt");
  });
  it("Geschoss mit Werkstatt-Rohbau: Hüllwände dort nicht doppelt — KGF = 5 + 1 = 6 → NUF 74 + 2 × 64", () => {
    const rohbau = [{ level: 0, rohbau_m2: 80, aussenwand_m2: 5, innenwand_m2: 1 }];
    nahe(nufFuerKennzahlen({ bgf: 240, zonen: [zone], footprint: fp, storeys: 3, rohbau, waende: huelle }).nuf, 74 + 128, 1e-9, "NUF");
  });
  it("Zonen auf allen Geschossen: quelle din277; ohne Zonen: 80 % pauschal", () => {
    const zonen = [0, 1, 2].map((level) => ({ ...zone, level }));
    const r = nufFuerKennzahlen({ bgf: 240, zonen, footprint: fp, storeys: 3, waende: huelle });
    nahe(r.nuf, 3 * 74.69, 1e-9, "NUF");
    assert.equal(r.quelle, "din277");
    assert.deepEqual(nufFuerKennzahlen({ bgf: 240 }), { nuf: 192, quelle: "pauschal" });
  });
});

describe("107-11 Review — IFC NetFloorArea: Geschoss-Space und Werkstatt-Raum", () => {
  const fp = R(-4, -3, 4, 3);
  const model = createBuildingModel({ footprintM: fp, storeys: 1, storeyHeight: 3, wallThickness: 0.3 });
  const customWalls = [{ a: { x: 0, z: -3 }, b: { x: 0, z: 3 }, level: 0, thickness: 0.2, height: 3, _idx: 1 }];
  const customColumns = [{ x: -2, z: 0, level: 0, size: 0.4, _idx: 3 }];
  it("Geschoss-Space (Footprint 48 m²): minus Hülle innen 48 − 7,7 × 5,7, minus Trennwand 0,2 × 5,7, minus Stütze 0,16 = 42,59 m²", () => {
    const text = exportIFC(model, { customWalls, customColumns, storeyHeight: 3, raumGrenzen: true });
    assert.ok(text.includes("'GrossFloorArea',$,$,48.0000,$"), "GrossFloorArea");
    assert.ok(text.includes("'NetFloorArea',$,$,42.5900,$"), "NetFloorArea des Geschoss-Space");
  });
  it("Werkstatt-Raum 4 × 3 mit gezeichneter Stütze 0,40: NetFloorArea 12 − 0,16 = 11,84 m²", () => {
    const werkstatt = { waende: [], tueren: [], raeume: [{ guid: "0wt0raum0000000000000a", typ: "raum", level: 0, name: "Wohnen ·WT", we: "WE 1", raumart: "wohnen", flaeche_m2: 12, points: R(-3.5, -2.5, 0.5, 0.5), status: null }] };
    const text = exportIFC(model, { customColumns, storeyHeight: 3, werkstatt, raumGrenzen: true });
    assert.ok(text.includes("'GrossFloorArea',$,$,12.0000,$"), "GrossFloorArea");
    assert.ok(text.includes("'NetFloorArea',$,$,11.8400,$"), "NetFloorArea des Werkstatt-Raums");
  });
});
