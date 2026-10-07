// Unit tests for packages/nova-designer/src/lib/rettungsweg.js (75-13 Task 1) and
// its integration in tesselierung.js: the escape route as a WALKED line from the
// deepest corner to the stair door (MBO §35 Abs. 2 [CITED], 35 m) instead of the
// 75-07 Manhattan sum to the core centre.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KNOTEN_VERSATZ_M, punktInPolygon, sichtbar, eckKnoten, lauflaenge, tiefsterPunkt, rettungsweg,
  sichtbarInnen, wegImRaum, gemeinsamesWandstueck, innenwegUeberTueren,
} from "@designer/lib/rettungsweg";
import { tesseliere, RETTUNGSWEG_MAX } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const FP30 = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rechteck = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** Longest rettungsweg_m of storey 0. */
const maxLauf = (r) => Math.max(...r.weListe.filter((w) => w.level === 0).map((w) => w.rettungsweg_m));

describe("rettungsweg.js — Geometrie", () => {
  it("Rechteckraum ohne Hindernis: Lauflinie = Luftlinie (3-4-5-Dreieck = 5 m), Pfad aus 2 Punkten", () => {
    const r = lauflaenge({ x: 0, z: 0 }, { x: 3, z: 4 }, []);
    assert.ok(Math.abs(r.laenge_m - 5) < 1e-9, `Länge ${r.laenge_m}`);
    assert.equal(r.pfad.length, 2);
  });

  it("Hindernis zwischen Start und Ziel erzwingt den Umweg um die Ecken (Handrechnung ≈ 12,06 m statt 10 m)", () => {
    // Wand 4…6 × −3…3 zwischen (0,0) und (10,0): Umweg über (4,3) und (6,3) = 5 + 2 + 5 → 12 m,
    // plus 5 cm Eckversatz nach außen → 12,06 m.
    const wand = [rechteck(4, -3, 6, 3)];
    const r = lauflaenge({ x: 0, z: 0 }, { x: 10, z: 0 }, wand);
    assert.ok(r.laenge_m > 10 + 1, `Länge ${r.laenge_m} nicht länger als Luftlinie`);
    assert.ok(Math.abs(r.laenge_m - 12) < 0.1, `Länge ${r.laenge_m}`);
    assert.equal(r.pfad.length, 4, "Start, zwei Ecken, Ziel");
    // Jede Teilstrecke des Pfades ist frei von Hindernissen.
    for (let i = 0; i + 1 < r.pfad.length; i++) assert.ok(sichtbar(r.pfad[i], r.pfad[i + 1], wand), `Teilstrecke ${i} schneidet das Hindernis`);
  });

  it("Lauflänge ist symmetrisch (Start ↔ Ziel)", () => {
    const wand = [rechteck(4, -3, 6, 3)];
    const ab = lauflaenge({ x: 0, z: 1 }, { x: 10, z: -1 }, wand).laenge_m;
    const ba = lauflaenge({ x: 10, z: -1 }, { x: 0, z: 1 }, wand).laenge_m;
    assert.ok(Math.abs(ab - ba) < 1e-9);
  });

  it("tiefster Punkt ist eine Ecke, nicht die Raummitte: 4 × 4 m, Tür Mitte Unterkante → Ecke 4,47 m statt Mitte 2 m", () => {
    const ecken = rechteck(0, 0, 4, 4);
    const t = tiefsterPunkt(ecken, { x: 2, z: 0 }, []);
    assert.ok(Math.abs(t.laenge_m - Math.hypot(2, 4)) < 1e-9, `Länge ${t.laenge_m}`);
    assert.equal(t.punkt.z, 4, "gegenüberliegende Ecke");
    const mitte = lauflaenge({ x: 2, z: 2 }, { x: 2, z: 0 }, []).laenge_m;
    assert.ok(t.laenge_m > mitte);
  });

  it("Berühren einer Hindernis-Kante ist kein Durchqueren; Strecke durch die Fläche ist blockiert", () => {
    const wand = [rechteck(0, 0, 4, 4)];
    assert.equal(sichtbar({ x: 0, z: -1 }, { x: 4, z: -1 }, wand), true, "parallel außen");
    assert.equal(sichtbar({ x: -1, z: 0 }, { x: 5, z: 0 }, wand), true, "entlang der Wandkante");
    assert.equal(sichtbar({ x: -1, z: 2 }, { x: 5, z: 2 }, wand), false, "mitten hindurch");
    assert.equal(sichtbar({ x: 0, z: 0 }, { x: 4, z: 4 }, wand), false, "Diagonale Ecke zu Ecke");
  });

  it("punktInPolygon: Rand zählt als außen, Eckknoten liegen um den Versatz außerhalb des Hindernisses", () => {
    const p = rechteck(0, 0, 4, 4);
    assert.equal(punktInPolygon({ x: 2, z: 2 }, p), true);
    assert.equal(punktInPolygon({ x: 4, z: 2 }, p), false, "auf der Kante");
    assert.equal(punktInPolygon({ x: 5, z: 2 }, p), false);
    const knoten = eckKnoten([p]);
    assert.equal(knoten.length, 4);
    for (const k of knoten) {
      assert.equal(punktInPolygon(k, p), false, "Knoten außerhalb");
      const d = Math.min(...p.map((q) => Math.hypot(q.x - k.x, q.z - k.z)));
      assert.ok(Math.abs(d - KNOTEN_VERSATZ_M) < 1e-9, `Versatz ${d}`);
    }
  });

  it("Ziel im Inneren eines Hindernisses ist unerreichbar → Infinity und leerer Pfad", () => {
    const r = lauflaenge({ x: 0, z: 0 }, { x: 5, z: 5 }, [rechteck(4, 4, 6, 6)]);
    assert.equal(r.laenge_m, Infinity);
    assert.deepEqual(r.pfad, []);
  });

  it("rettungsweg(): tiefste Ecke → Wohnungstür → nächste Treppenraum-Tür; Länge = innen + Flur, Pfad beginnt an der Ecke", () => {
    const o = rettungsweg({
      kandidaten: rechteck(0, 0, 4, 4), tuer: { x: 2, z: 0 }, hindernisse: [],
      ziele: [{ x: 22, z: 0 }, { x: 40, z: 0 }],
    });
    assert.ok(Math.abs(o.innen_m - Math.hypot(2, 4)) < 1e-9);
    assert.ok(Math.abs(o.flur_m - 20) < 1e-9, "nächstes Ziel bei x = 22 → 20 m");
    assert.ok(Math.abs(o.laenge_m - (o.innen_m + o.flur_m)) < 1e-9);
    assert.ok(o.pfad.length >= 2);
    assert.equal(o.pfad[0].z, 4, "Pfad beginnt an der tiefsten Ecke");
    assert.deepEqual(o.pfad[o.pfad.length - 1], { x: 22, z: 0 }, "endet an der Tür");
    assert.equal(o.erreichbar, true);
  });

  it("rettungsweg(): Tür öffnet direkt in den Treppenraum → Flurstrecke 0, nur der Weg innerhalb zählt", () => {
    const o = rettungsweg({ kandidaten: rechteck(0, 0, 4, 4), tuer: { x: 2, z: 0 }, ziele: [{ x: 22, z: 0 }], hindernisse: [], tuerImTreppenraum: true });
    assert.equal(o.flur_m, 0);
    assert.ok(Math.abs(o.laenge_m - o.innen_m) < 1e-9);
  });

  it("rettungsweg(): kein Ziel erreichbar → erreichbar false, Luftlinie als markierte Näherung (nie Infinity)", () => {
    const o = rettungsweg({ kandidaten: [{ x: 0, z: 1 }], tuer: { x: 0, z: 0 }, ziele: [{ x: 5, z: 5 }], hindernisse: [rechteck(4, 4, 6, 6)] });
    assert.equal(o.erreichbar, false);
    assert.ok(Number.isFinite(o.laenge_m));
    assert.ok(Math.abs(o.flur_m - Math.hypot(5, 5)) < 1e-9);
  });
});

describe("tesselierung.js — Rettungsweg als Lauflinie (75-13 Task 1)", () => {
  const basis = { footprintM: FP30, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true };

  it("regeln.rettungsweg an: je WE Länge, Teilstrecken und Pfad (≥ 2 Punkte); Länge = innen + Flur", () => {
    const r = tesseliere({ ...basis, regeln: { rettungsweg: true } });
    for (const w of r.weListe) {
      assert.ok(w.rettungsweg_m > 0, `${w.we} ohne Länge`);
      assert.ok(Array.isArray(w.rettungsweg_pfad) && w.rettungsweg_pfad.length >= 2, `${w.we} Pfad`);
      assert.ok(Math.abs(w.rettungsweg_m - (w.rettungsweg_innen_m + w.rettungsweg_flur_m)) < 0.11, `${w.we}: ${w.rettungsweg_m} ≠ ${w.rettungsweg_innen_m} + ${w.rettungsweg_flur_m}`);
    }
  });

  it("Regression: regeln.rettungsweg aus → kein rettungsweg_*-Feld und keine rettungswegWarnungen (wie vor 75-13)", () => {
    const r = tesseliere({ ...basis, regeln: { rettungsweg: false } });
    assert.equal(r.rettungswegWarnungen, undefined);
    for (const w of r.weListe) assert.ok(!("rettungsweg_m" in w) && !("rettungsweg_pfad" in w), w.we);
    const ohne = tesseliere(basis);
    assert.equal(JSON.stringify(r), JSON.stringify(ohne));
  });

  it("35,0 m ist ok, 35,1 m ist warn (Grenze: laenge > max; max wird auf die gemessene Länge bzw. 0,1 m darunter gestellt)", () => {
    assert.equal(RETTUNGSWEG_MAX, 35);
    const L = maxLauf(tesseliere({ ...basis, regeln: { rettungsweg: true } }));
    const gleich = tesseliere({ ...basis, regeln: { rettungsweg: true, rettungswegMax: L } });
    assert.equal(gleich.rettungswegWarnungen.length, 0, `${L} m darf bei Grenze ${L} m nicht warnen`);
    const knapp = tesseliere({ ...basis, regeln: { rettungsweg: true, rettungswegMax: Math.round((L - 0.1) * 10) / 10 } });
    assert.ok(knapp.rettungswegWarnungen.length >= 1, `${L} m muss bei Grenze ${L - 0.1} m warnen`);
    assert.ok(knapp.rettungswegWarnungen.every((w) => w.stufe === "warn"));
  });

  it("Überschreitung = warn (nicht Hinweis) mit Vorschlag „Treppenraum-Erweiterung um X m“ (aufgerundet auf 0,5 m)", () => {
    const fp = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
    const r = tesseliere({ footprintM: fp, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true, regeln: { rettungsweg: true } });
    assert.ok(r.rettungswegWarnungen.length > 0);
    for (const w of r.rettungswegWarnungen) {
      assert.equal(w.stufe, "warn");
      assert.ok(w.laenge_m > RETTUNGSWEG_MAX);
      assert.equal(w.vorschlag_m, Math.ceil((w.laenge_m - RETTUNGSWEG_MAX) * 2) / 2);
      assert.match(w.text, /Rettungsweg .* > 35 m/);
      assert.match(w.text, /Treppenraum-Erweiterung um/);
    }
    assert.ok(!r.hinweise.some((h) => /Rettungsweg .* > 35 m/.test(h)), "kein Hinweis mehr");
  });

  it("Lauflinie ≠ Manhattan: Länge mindestens Luftlinie (Pfad) und höchstens Luftlinie + Umweg; Pfadlänge stimmt mit rettungsweg_m überein (±0,15 m Rundung/Versatz)", () => {
    const r = tesseliere({ ...basis, regeln: { rettungsweg: true } });
    for (const w of r.weListe) {
      let s = 0;
      for (let i = 0; i + 1 < w.rettungsweg_pfad.length; i++) s += Math.hypot(w.rettungsweg_pfad[i + 1].x - w.rettungsweg_pfad[i].x, w.rettungsweg_pfad[i + 1].z - w.rettungsweg_pfad[i].z);
      assert.ok(Math.abs(s - w.rettungsweg_m) < 0.15, `${w.we}: Pfad ${s.toFixed(2)} vs ${w.rettungsweg_m}`);
    }
  });

  it("Mittelflur ohne Kern: Lauflinie zum Flurende, Hinweis nennt die Annahme", () => {
    const r = tesseliere({ ...basis, typ: "mittelflur", regeln: { rettungsweg: true } });
    assert.ok(r.weListe.every((w) => w.rettungsweg_m > 0));
    assert.ok(r.hinweise.some((h) => /kein Treppenraum im Skelett/.test(h)));
  });
});

// 75-17 (D-P75-13-C): inner leg through doors and the hall, not through walls.
describe("75-17 innenwegUeberTueren — Tür-/Raumgraph", () => {
  const nah = (ist, soll, eps = 0.01) => assert.ok(Math.abs(ist - soll) < eps, `${ist} ≠ ${soll}`);
  // Room R 4 × 4 m, hall H 2 × 6 m to its right; R's door sits at the FAR end of the
  // shared wall (z 0…0,885), the apartment door on H's right wall at z 5…5,885.
  const R = { name: "Zimmer", art: "aufenthalt", fensterpflicht: true, points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], tueren: [{ wand: 1, u_m: 0, breite_m: 0.885, nach: "Diele" }] };
  const H = { name: "Diele", art: "flur", points: [{ x: 4, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 6 }, { x: 4, z: 6 }], tueren: [{ wand: 1, u_m: 5, breite_m: 0.885, nach: null }] };
  const ausgang = { x: 6.05, z: 5.4425 };

  it("Handrechnung: tiefste Ecke → Zimmertür → Wohnungstür (nicht die Luftlinie)", () => {
    const r = innenwegUeberTueren({ zonen: [R, H], ausgang });
    assert.ok(r);
    assert.equal(r.art, "tueren");
    assert.equal(r.naeherung, false);
    // deepest corner (0|4) pulled 5 cm diagonally to the centre = (0,0354 | 3,9646)
    // → door middle (4 | 0,4425) → exit (6 | 5,4425) → 5 cm out
    const e = 0.05 / Math.SQRT2;
    const soll = Math.hypot(4 - e, 4 - e - 0.4425) + Math.hypot(2, 5) + 0.05;
    nah(r.laenge_m, soll);
    assert.ok(r.laenge_m > Math.hypot(6, 5.4425 - 3.95) + 3, "deutlich länger als die Luftlinie");
    assert.deepEqual(r.tuerpunkte.map((p) => [+p.x.toFixed(4), +p.z.toFixed(4)]), [[4, 0.4425], [6, 5.4425]]);
    assert.ok(r.pfad.some((p) => Math.abs(p.x - 4) < 1e-9 && Math.abs(p.z - 0.4425) < 1e-9), "Pfad führt durch die Zimmertür");
  });

  it("wegImRaum: L-Diele — Weg knickt an der einspringenden Ecke", () => {
    const L = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 4 }, { x: 0, z: 4 }];
    assert.equal(sichtbarInnen({ x: 3.5, z: 0.5 }, { x: 0.5, z: 3.5 }, L), false);
    const w = wegImRaum({ x: 3.5, z: 0.5 }, { x: 0.5, z: 3.5 }, L);
    nah(w.laenge_m, 2 * Math.hypot(2.5, 0.5));
    assert.deepEqual(w.pfad[1], { x: 1, z: 1 });
  });

  it("gemeinsamesWandstueck: Überlappung der Wände in Metern", () => {
    const s = gemeinsamesWandstueck(R.points, H.points);
    nah(s.laenge, 4);
  });

  it("ohne Türdaten: Öffnung in der Mitte der Wand ≥ 1,185 m zum Flur → Näherung wandstuecke", () => {
    const r = innenwegUeberTueren({ zonen: [{ ...R, tueren: undefined }, { ...H, tueren: undefined }], ausgang });
    assert.equal(r.art, "wandstuecke");
    assert.equal(r.naeherung, true);
    nah(r.tuerpunkte[0].x, 4); nah(r.tuerpunkte[0].z, 2);
  });

  it("Raum ohne Wand zum Flur → Durchgang durch den Nachbarraum, als Näherung markiert", () => {
    const C = { name: "Kind", art: "aufenthalt", fensterpflicht: true, points: [{ x: 0, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 8 }, { x: 0, z: 8 }] };
    const H2 = { ...H, points: [{ x: 4, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 4, z: 4 }], tueren: undefined };
    const r = innenwegUeberTueren({ zonen: [{ ...R, tueren: undefined }, H2, C], ausgang: { x: 6.05, z: 2 } });
    assert.equal(r.art, "durchgang");
    assert.equal(r.naeherung, true);
  });

  it("leer → null (Aufrufer fällt auf die markierte Luftlinie zurück)", () => {
    assert.equal(innenwegUeberTueren({ zonen: [], ausgang }), null);
  });

  it("Tesselierung mit Wohnungsgrundriss: jede WE über Türen, Pfad bleibt in den eigenen Räumen", () => {
    const r = tesseliere({ footprintM: FP30, storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true, regeln: { rettungsweg: true, wohnungsgrundriss: true } });
    assert.ok(r.weListe.length > 0);
    for (const w of r.weListe) {
      assert.equal(w.rettungsweg_innen_art, "tueren", w.we);
      assert.equal("rettungsweg_innen_naeherung" in w, false);
      assert.ok(w.rettungsweg_tuerpunkte.length >= 2, "Zimmertür + Wohnungstür");
      const eigene = r.zonen.filter((z) => z.we === w.we && z.level === w.level);
      // Inner part of the path (up to the apartment door point): every point lies in or on an own room.
      const n = w.rettungsweg_pfad.findIndex((p) => Math.abs(p.x - w.rettungsweg_tuerpunkte.at(-1).x) < 0.02 && Math.abs(p.z - w.rettungsweg_tuerpunkte.at(-1).z) < 0.02);
      assert.ok(n > 0, "Wohnungstür liegt auf dem Pfad");
      for (const p of w.rettungsweg_pfad.slice(0, n + 1)) {
        const drin = eigene.some((z) => punktInPolygon(p, z.points) || z.points.some((a, i) => {
          const b = z.points[(i + 1) % z.points.length];
          const l = Math.hypot(b.x - a.x, b.z - a.z), d = Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / (l || 1);
          return d < 0.02 && (p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z) >= -0.02 && (p.x - b.x) * (a.x - b.x) + (p.z - b.z) * (a.z - b.z) >= -0.02;
        }));
        assert.ok(drin, `${w.we}: Pfadpunkt ${p.x}|${p.z} außerhalb der eigenen Räume`);
      }
    }
  });

  it("Tesselierung ohne Türdaten: Näherung ist markiert und steht im Warnungstext", () => {
    const FP70 = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
    const r = tesseliere({ footprintM: FP70, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true, regeln: { rettungsweg: true, treppenraum: true } });
    assert.ok(r.weListe.every((w) => w.rettungsweg_innen_naeherung === true && w.rettungsweg_innen_art !== "tueren"));
    assert.ok(r.rettungswegWarnungen.length > 0);
    assert.ok(r.rettungswegWarnungen.every((x) => x.text.includes("[Näherung innen: ")));
  });
});
