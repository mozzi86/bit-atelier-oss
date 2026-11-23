// 115-04 (D-115-13): the floor plan view turned in 90° steps (display only) and the own sheet orientation of PDF / DXF.
// Proves
//  - the pure math of @core/lib/plan/planDrehung.js: normalising, the quarter-turn buttons, the round trip model → screen → model
//    for all four rotations (points and the frame transform of BimPlan2D), the box of a turned drawing, the text angle rule
//    ("readable from below or from the right"), the north arrow angle, the two view fields of ansicht_layer (old blob → 0 / null);
//  - the dimension chains (masskette.js): without a rotation the chain is the one before 115-04, in a turned drawing every number
//    reads from below or from the right and sits above its line as seen;
//  - the output (planGrafik → PDF / DXF): sheet orientation 0 is byte-identical to no orientation, 90° swaps the box of the
//    drawing, texts stay upright, hatches keep 45° on the sheet, the north arrow points where north lies, the input records are
//    untouched, and the section has no orientation;
//  - the screen plan (BimPlan2D, rendered server-side through helpers/jsxRender.mjs): rotation 0 gives the same markup as no
//    rotation, a turned plan carries ONE group with the frame transform, upright labels, readable dimension numbers and a turned
//    north arrow; the section is not turned.
//  - the arrow-key nudge of BitBimStudio (review finding N-01): on a turned floor plan the selection moves the way the pressed
//    arrow points ON THE SCREEN; 3D, section and 0° keep the model axes.
// Neutral test data: the invented house of fixtures/efh-108.js. No browser — pointer events (getScreenCTM) are checked through the
// same frame functions the component uses.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLAN_DREHUNGEN, normiereDrehung, drehungWeiter, drehePunkt, drehePunktZurueck, dreheBBox, drehRahmen,
  textWinkelLesbar, textWinkelImRahmen, textWinkelGesehen, nordpfeilWinkel, nordRichtung, ansichtDrehung, blattDrehungWirksam,
} from "@core/lib/plan/planDrehung.js";
import { ANSICHT_LEER, ansichtLayerNormalisieren } from "@core/lib/plan/ansichtszustand.js";
import { brilleVon } from "@core/lib/plan/brillen.js";
import { ketteGeometrie, kettenPaar, normiereWinkel } from "@designer/lib/masskette";
import { planGrafik, schnittGrafik, vektorPlanPdf } from "@designer/lib/vektorPlan";
import { grundrissDxfDaten, dxfDatei } from "@designer/lib/dxfPlaene";
import { jsxUmgebung } from "./helpers/jsxRender.mjs";
import { efhModell, EFH_108 } from "./fixtures/efh-108.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
/** Rooms of the test house (invented): two rectangles on the ground floor, m. */
const RAEUME = [
  { level: 0, name: "Wohnen", _idx: 1, points: [{ x: -0.4, z: -5 }, { x: 5.6, z: -5 }, { x: 5.6, z: 0.5 }, { x: -0.4, z: 0.5 }] },
  { level: 0, name: "Diele", _idx: 2, points: [{ x: -5.6, z: -5 }, { x: -0.6, z: -5 }, { x: -0.6, z: 5 }, { x: -5.6, z: 5 }] },
];
const planEingabe = (/** @type {Record<string, any>} */ mehr = {}) => ({ model: efhModell(), level: 0, customWalls: EFH_108.customWalls, customZones: RAEUME, envOpenings: EFH_108.envOpenings, massstab: 100, ...mehr });

describe("115-04 planDrehung: Rechnung", () => {
  it("normiereDrehung: nur 0/90/180/270; alte Datensätze ohne Feld lesen 0", () => {
    assert.deepEqual([...PLAN_DREHUNGEN], [0, 90, 180, 270]);
    for (const [ein, aus] of /** @type {Array<[any, number]>} */ ([[0, 0], [90, 90], [180, 180], [270, 270], [360, 0], [450, 90], [-90, 270], [-180, 180], [91, 90], [44, 0], [46, 90], ["180", 180],
      [undefined, 0], [null, 0], ["", 0], ["quer", 0], [NaN, 0], [Infinity, 0], [true, 0]])) assert.equal(normiereDrehung(ein), aus, String(ein));
  });

  it("drehungWeiter: links = +90, rechts = −90, vier Schritte führen zurück", () => {
    assert.equal(drehungWeiter(0, "links"), 90);
    assert.equal(drehungWeiter(270, "links"), 0);
    assert.equal(drehungWeiter(0, "rechts"), 270);
    assert.equal(drehungWeiter(90, "rechts"), 0);
    let d = 0;
    for (let i = 0; i < 4; i += 1) d = drehungWeiter(d, "links");
    assert.equal(d, 0);
  });

  it("90° links: was links (Westen) lag, liegt unten; rechts oben wird links oben", () => {
    // frame x right, z down: west = −x, north = −z
    assert.deepEqual(drehePunkt({ x: -5, z: 0 }, 90), { x: 0, z: 5 }); // west → bottom (the user's street side)
    assert.deepEqual(drehePunkt({ x: 0, z: -3 }, 90), { x: -3, z: 0 }); // north → left
    assert.deepEqual(drehePunkt({ x: 2, z: 1 }, 180), { x: -2, z: -1 });
    assert.deepEqual(drehePunkt({ x: 2, z: 1 }, 270), { x: -1, z: 2 });
    assert.deepEqual(drehePunkt({ x: 2, z: 1 }, 0), { x: 2, z: 1 });
    // about a centre
    assert.deepEqual(drehePunkt({ x: 3, z: 1 }, 90, { x: 1, z: 1 }), { x: 1, z: -1 });
  });

  it("Rundreise Modell → gedreht → Modell für alle vier Drehungen; um den Ursprung exakt (keine Winkelfunktionen)", () => {
    const punkte = [{ x: 0, z: 0 }, { x: 5.7, z: -5.1 }, { x: -0.5, z: 0.6 }, { x: 12.345, z: -7.25 }, { x: -3, z: 9 }];
    for (const d of PLAN_DREHUNGEN) for (const p of punkte) {
      assert.deepEqual(drehePunktZurueck(drehePunkt(p, d), d), p, `${d}° um den Ursprung`);
      assert.ok(!Object.is(drehePunkt(p, d).x, -0) && !Object.is(drehePunkt(p, d).z, -0), "keine negative Null");
      // about another centre the subtraction and addition of the centre round in the last bit
      const z = { x: 1.5, z: -2 }, q = drehePunktZurueck(drehePunkt(p, d, z), d, z);
      nah(q.x, p.x, 1e-12); nah(q.z, p.z, 1e-12);
      // lengths are kept
      nah(Math.hypot(drehePunkt(p, d).x, drehePunkt(p, d).z), Math.hypot(p.x, p.z), 1e-12);
    }
  });

  it("drehRahmen: gedrehter Rahmen beginnt wieder bei 0/0, 90°/270° tauschen Breite und Höhe; hin ∘ zurück = Identität", () => {
    const B = 620, H = 340;
    for (const d of PLAN_DREHUNGEN) {
      const r = drehRahmen(d, B, H);
      assert.equal(r.grad, d);
      assert.deepEqual([r.breite, r.hoehe], d === 90 || d === 270 ? [H, B] : [B, H]);
      // the four corners land on the corners of the turned frame
      const ecken = [[0, 0], [B, 0], [B, H], [0, H]].map(([x, y]) => r.hin(x, y));
      assert.equal(Math.min(...ecken.map((e) => e.x)), 0); assert.equal(Math.min(...ecken.map((e) => e.y)), 0);
      assert.equal(Math.max(...ecken.map((e) => e.x)), r.breite); assert.equal(Math.max(...ecken.map((e) => e.y)), r.hoehe);
      for (const [x, y] of [[0, 0], [10, 20], [B, H], [333.25, 17.5]]) {
        const s = r.hin(x, y);
        assert.deepEqual(r.zurueck(s.x, s.y), { x, y }, `${d}°`);
        const v = r.vektorHin(x, y);
        assert.deepEqual(r.vektorZurueck(v.x, v.y), { x, y });
      }
    }
    assert.equal(drehRahmen(0, B, H).transform, undefined, "ohne Drehung kein transform-Attribut");
    assert.equal(drehRahmen(90, B, H).transform, `matrix(0 -1 1 0 0 ${B})`);
    assert.equal(drehRahmen(180, B, H).transform, `matrix(-1 0 0 -1 ${B} ${H})`);
    assert.equal(drehRahmen(270, B, H).transform, `matrix(0 1 -1 0 ${H} 0)`);
    // the matrix is the same mapping as `hin` (x' = a·x + c·y + e, y' = b·x + d·y + f)
    for (const d of [90, 180, 270]) {
      const r = drehRahmen(d, B, H);
      const [a, b, c, dd, e, f] = /** @type {string} */ (r.transform).slice(7, -1).split(" ").map(Number);
      assert.deepEqual({ x: a * 100 + c * 40 + e, y: b * 100 + dd * 40 + f }, r.hin(100, 40));
    }
    // 90° left: the left edge of the drawing is the bottom edge of the turned frame
    assert.deepEqual(drehRahmen(90, B, H).hin(0, 170), { x: 170, y: B });
    // a swipe to the right as seen is, in the model frame of a plan turned 90° left, a move towards −y (up): only the group knows
    assert.deepEqual(drehRahmen(90, B, H).vektorZurueck(1, 0), { x: 0, y: 1 });
    assert.deepEqual(drehRahmen(90, B, H).vektorZurueck(0, -3), { x: 3, y: 0 });
  });

  it("dreheBBox: 0 unverändert, 90°/270° tauschen Breite und Höhe, 180° behält sie", () => {
    const bb = { x0: -5.7, z0: -5.1, x1: 5.7, z1: 5.1 };
    assert.deepEqual(dreheBBox(bb, 0), bb);
    const groesse = (/** @type {typeof bb} */ b) => [b.x1 - b.x0, b.z1 - b.z0];
    for (const d of [90, 270]) { const [w, h] = groesse(dreheBBox(bb, d)); nah(w, 10.2); nah(h, 11.4); }
    { const [w, h] = groesse(dreheBBox(bb, 180)); nah(w, 11.4); nah(h, 10.2); }
    assert.deepEqual(dreheBBox({ x0: 1, z0: 2, x1: 4, z1: 3 }, 90), { x0: 2, z0: -4, x1: 3, z1: -1 });
  });

  it("Textwinkel: lesbar von unten oder von rechts ([−90, 90)), in jedem gedrehten Plan", () => {
    assert.equal(textWinkelLesbar(0), 0);
    assert.equal(textWinkelLesbar(90), -90, "senkrecht liest von unten nach oben (von rechts lesbar)");
    assert.equal(textWinkelLesbar(-90), -90);
    assert.equal(textWinkelLesbar(180), 0);
    assert.equal(textWinkelLesbar(135), -45);
    assert.equal(textWinkelLesbar(-135), 45);
    assert.ok(!Object.is(textWinkelLesbar(-0), -0));
    // same rule as the dimension chains
    for (const w of [-270, -180, -135, -90, -45, 0, 30, 89.9999999, 90, 135, 180, 270]) assert.equal(textWinkelLesbar(w), normiereWinkel(w), String(w));
    for (const d of PLAN_DREHUNGEN) for (const w of [-180, -135, -90, -45, 0, 30, 45, 90, 135, 180]) {
      const lokal = textWinkelImRahmen(w, d);
      const gesehen = textWinkelGesehen(lokal, d);
      assert.ok(gesehen >= -90 && gesehen < 90, `${w}° im um ${d}° gedrehten Plan → gesehen ${gesehen}°`);
      // still parallel to the line (the line is seen at w − d)
      nah((((gesehen - (w - d)) % 180) + 180) % 180, 0);
    }
    assert.equal(textWinkelImRahmen(0, 0), 0);
    assert.equal(textWinkelImRahmen(0, 90), 0, "waagrechte Linie steht im 90°-Plan senkrecht: Zahl liest von unten nach oben (lokal 0)");
    assert.equal(textWinkelImRahmen(90, 90), 90, "senkrechte Linie liegt im 90°-Plan waagrecht: Zahl steht waagrecht (lokal 90)");
    assert.equal(textWinkelImRahmen(0, 180), 180, "180°: die Zahl wird zurückgedreht, nie kopfüber");
  });

  it("Nordpfeil dreht mit dem Plan: 0 oben, 90° links, 180° unten, 270° rechts", () => {
    assert.deepEqual(PLAN_DREHUNGEN.map(nordpfeilWinkel), [0, -90, 180, 90]);
    assert.deepEqual(PLAN_DREHUNGEN.map(nordRichtung), [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]);
    // the arrow direction is the turned model north (−z)
    for (const d of PLAN_DREHUNGEN) { const n = drehePunkt({ x: 0, z: -1 }, d); assert.deepEqual(nordRichtung(d), { x: n.x, y: n.z }); }
  });

  it("Ansichtsfelder in ansicht_layer: additiv, alter Blob = 0 / null, Blatt folgt dem Bildschirm bis es gewählt ist", () => {
    for (const alt of [undefined, null, {}, ANSICHT_LEER, { ausschnitte: [], ebenen: [] }]) {
      assert.deepEqual(ansichtDrehung(alt), { plan: 0, blatt: null });
      assert.equal(blattDrehungWirksam(ansichtDrehung(alt)), 0, "alter Datensatz druckt wie bisher");
    }
    assert.deepEqual(ansichtDrehung({ plan_drehung: 90 }), { plan: 90, blatt: null });
    assert.equal(blattDrehungWirksam(ansichtDrehung({ plan_drehung: 90 })), 90, "Startwert = Drehung am Bildschirm");
    assert.deepEqual(ansichtDrehung({ plan_drehung: 90, blatt_drehung: 0 }), { plan: 90, blatt: 0 });
    assert.equal(blattDrehungWirksam(ansichtDrehung({ plan_drehung: 90, blatt_drehung: 0 })), 0, "eigene Blattausrichtung, getrennt gespeichert");
    assert.equal(blattDrehungWirksam(ansichtDrehung({ plan_drehung: 0, blatt_drehung: 270 })), 270);
    assert.deepEqual(ansichtDrehung({ plan_drehung: "schief", blatt_drehung: "" }), { plan: 0, blatt: null });
    // the normaliser of the saved views is untouched by the new fields (they are read by ansichtDrehung only)
    assert.deepEqual(ansichtLayerNormalisieren({ plan_drehung: 90, blatt_drehung: 180 }), ansichtLayerNormalisieren(undefined));
  });
});

describe("115-04 Maßketten im gedrehten Plan", () => {
  const waagrecht = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 10, z: 0 }];
  const senkrecht = [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 0, z: 10 }];
  const schraeg = [{ x: 0, z: 0 }, { x: 3, z: 3 }, { x: 8, z: 8 }];

  it("ohne Drehung unverändert (Drehung 0 = kein Parameter)", () => {
    for (const punkte of [waagrecht, senkrecht, schraeg]) for (const seite of /** @type {Array<1|-1>} */ ([1, -1])) {
      assert.deepEqual(ketteGeometrie({ punkte, seite, pxJeM: 40, drehung: 0 }), ketteGeometrie({ punkte, seite, pxJeM: 40 }));
      assert.deepEqual(kettenPaar({ punkte, seite, pxJeM: 40, drehung: 0 }), kettenPaar({ punkte, seite, pxJeM: 40 }));
    }
  });

  it("jede Zahl liest von unten oder von rechts und steht über ihrer Linie, wie man sie sieht", () => {
    for (const d of PLAN_DREHUNGEN) for (const punkte of [waagrecht, senkrecht, schraeg]) for (const seite of /** @type {Array<1|-1>} */ ([1, -1])) {
      const { teil, gesamt } = kettenPaar({ punkte, seite, pxJeM: 40, drehung: d });
      for (const k of [teil, /** @type {NonNullable<typeof gesamt>} */ (gesamt)]) {
        assert.ok(k.texte.length > 0);
        for (const t of k.texte) {
          const gesehen = textWinkelGesehen(t.winkel, d);
          assert.ok(gesehen >= -90 && gesehen < 90, `${d}°: Zahl unter ${gesehen}°`);
          if (t.aussen) continue;
          // offset line → text anchor, as seen: it points to the reader's "above" of the text (text-up = reading direction turned
          // 90° towards the top: for a seen angle w that is (sin w, −cos w))
          const mitteLinie = { x: (k.linie.a.x + k.linie.b.x) / 2, z: (k.linie.a.z + k.linie.b.z) / 2 };
          // project the anchor onto the line normal: take the vector from the nearest line point (same station) — the anchor minus its foot
          const dx = k.richtung.x, dz = k.richtung.z;
          const u = (t.x - mitteLinie.x) * dx + (t.z - mitteLinie.z) * dz;
          const fuss = { x: mitteLinie.x + dx * u, z: mitteLinie.z + dz * u };
          const v = drehePunkt({ x: t.x - fuss.x, z: t.z - fuss.z }, d); // as seen
          const rad = (gesehen * Math.PI) / 180;
          const oben = { x: Math.sin(rad), z: -Math.cos(rad) };
          assert.ok(v.x * oben.x + v.z * oben.z > 0, `${d}°: Zahl steht über der Linie`);
        }
      }
    }
  });
});

describe("115-04 Planausgabe: eigene Blattausrichtung (PDF / DXF)", () => {
  it("Blattausrichtung 0 ist byte-gleich zur Ausgabe ohne Blattausrichtung (Grafik, DXF-Text)", () => {
    for (const mehr of [{}, { brille: brilleVon("bauantrag"), sw: true, customWalls: EFH_108.customWalls.map((w) => ({ ...w, status: "neubau" })) },
      { ansicht: { strukturdarstellung: "gesamt", optionen: null, regeln: null } }, { kiMarken: { guids: ["x"], projektId: 1 } }]) {
      const ohne = planGrafik(planEingabe(mehr)), null0 = planGrafik(planEingabe({ ...mehr, blattDrehung: 0 }));
      assert.equal(JSON.stringify(null0), JSON.stringify(ohne));
      assert.ok(!("blattDrehung" in null0), "kein zusätzliches Feld");
      assert.ok(!null0.elemente.some((e) => e.ebene === "nordpfeil"), "kein Nordpfeil ohne Drehung (Blatt wie bisher)");
      const opt = { massstab: 100, geschoss: "EG", projekt: "Testhaus", modellstand: null };
      assert.equal(dxfDatei(grundrissDxfDaten(null0, opt)).text, dxfDatei(grundrissDxfDaten(ohne, opt)).text);
    }
    // a value that is no rotation behaves like 0
    assert.equal(JSON.stringify(planGrafik(planEingabe({ blattDrehung: /** @type {any} */ ("quer") }))), JSON.stringify(planGrafik(planEingabe())));
  });

  it("90°: die Zeichnung ist um den Modellursprung gedreht, ihre Box getauscht; Texte bleiben aufrecht am gedrehten Ort", () => {
    const g0 = planGrafik(planEingabe()), g90 = planGrafik(planEingabe({ blattDrehung: 90 }));
    assert.equal(g90.blattDrehung, 90);
    const zeichnung = (/** @type {any} */ g) => g.elemente.filter((/** @type {any} */ e) => e.ebene !== "nordpfeil");
    assert.equal(zeichnung(g90).length, g0.elemente.length, "dieselben Elemente, nur gedreht");
    const box = (/** @type {any[]} */ el) => {
      const pts = el.flatMap((e) => (e.art === "poly" ? e.pts : [{ x: e.x, z: e.z }]));
      return { x0: Math.min(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), x1: Math.max(...pts.map((p) => p.x)), z1: Math.max(...pts.map((p) => p.z)) };
    };
    const b0 = box(g0.elemente), b90 = box(zeichnung(g90));
    nah(b90.x1 - b90.x0, b0.z1 - b0.z0); nah(b90.z1 - b90.z0, b0.x1 - b0.x0);
    assert.deepEqual(b90, dreheBBox(b0, 90));
    zeichnung(g90).forEach((/** @type {any} */ e, /** @type {number} */ i) => {
      const alt = /** @type {any} */ (g0.elemente[i]);
      assert.equal(e.art, alt.art); assert.equal(e.ebene, alt.ebene);
      if (e.art === "poly") assert.deepEqual(e.pts, alt.pts.map((/** @type {any} */ p) => drehePunkt(p, 90)));
      else {
        assert.deepEqual({ x: e.x, z: e.z }, drehePunkt({ x: alt.x, z: alt.z }, 90));
        assert.equal(e.text, alt.text);
        assert.ok(!e.drehung_grad, "Text aufrecht (kein Drehwinkel)");
        assert.equal(e.ausrichtung, alt.ausrichtung);
      }
    });
    assert.equal(g90.elemente.filter((e) => e.art === "text" && e.ebene === "raum_text").length, 2, "beide Raumtexte da");
    // all four orientations: turned back, the drawing is the unturned one
    for (const d of [180, 270]) {
      const g = planGrafik(planEingabe({ blattDrehung: d }));
      zeichnung(g).forEach((/** @type {any} */ e, /** @type {number} */ i) => {
        const alt = /** @type {any} */ (g0.elemente[i]);
        if (e.art === "poly") assert.deepEqual(e.pts.map((/** @type {any} */ p) => drehePunktZurueck(p, d)), alt.pts.map((/** @type {any} */ p) => ({ x: p.x, z: p.z })));
      });
    }
  });

  it("Nordpfeil auf dem gedrehten Blatt: eigene Ebene, zeigt nach Norden des Modells, Buchstabe aufrecht, Box umfasst ihn", () => {
    for (const d of [90, 180, 270]) {
      const g = planGrafik(planEingabe({ blattDrehung: d }));
      const pfeil = /** @type {any} */ (g.elemente.find((e) => e.ebene === "nordpfeil" && e.art === "poly"));
      const text = /** @type {any} */ (g.elemente.find((e) => e.ebene === "nordpfeil" && e.art === "text"));
      assert.ok(pfeil && text);
      assert.equal(text.text, "N"); assert.ok(!text.drehung_grad);
      assert.equal(pfeil.fill, null, "Umriss, keine Füllung (sonst SOLID im DXF)");
      // tip (first point) minus notch (third point) = north as seen on the sheet
      const n = nordRichtung(d), v = { x: pfeil.pts[0].x - pfeil.pts[2].x, z: pfeil.pts[0].z - pfeil.pts[2].z }, l = Math.hypot(v.x, v.z);
      nah(v.x / l, n.x); nah(v.z / l, n.y);
      nah(l, 0.78 * 8 * 0.1, 1e-9); // 78 % of 8 mm on paper at 1:100 → m
      const bb = /** @type {NonNullable<typeof g.bbox>} */ (g.bbox);
      for (const p of [...pfeil.pts, { x: text.x, z: text.z }]) assert.ok(p.x >= bb.x0 && p.x <= bb.x1 && p.z >= bb.z0 && p.z <= bb.z1);
      // the arrow stands clear of the drawing (right of it)
      const zeichnungX1 = Math.max(...g.elemente.filter((e) => e.ebene !== "nordpfeil").flatMap((e) => (e.art === "poly" ? e.pts.map((p) => p.x) : [e.x])));
      assert.ok(Math.min(...pfeil.pts.map((/** @type {any} */ p) => p.x)) > zeichnungX1);
    }
  });

  it("Schraffur bleibt auf dem gedrehten Blatt unter 45° (x − z konstant), Eingabedaten bleiben unberührt", () => {
    const waende = EFH_108.customWalls.map((w) => ({ ...w, status: "neubau" }));
    const vorher = JSON.stringify(waende), raeumeVorher = JSON.stringify(RAEUME);
    for (const d of PLAN_DREHUNGEN) {
      const g = planGrafik(planEingabe({ brille: brilleVon("bauantrag"), sw: true, customWalls: waende, blattDrehung: d }));
      const striche = g.elemente.filter((e) => e.ebene === "schraffur");
      assert.ok(striche.length > 5, `${d}°: Schraffur vorhanden`);
      for (const s of /** @type {any[]} */ (striche)) nah((s.pts[1].x - s.pts[0].x) - (s.pts[1].z - s.pts[0].z), 0, 1e-9);
    }
    assert.equal(JSON.stringify(waende), vorher);
    assert.equal(JSON.stringify(RAEUME), raeumeVorher);
  });

  it("KI-Marken: Rahmen achsparallel auf dem Blatt, das Fragezeichen rechts der oberen rechten Ecke", () => {
    const leer = planGrafik(planEingabe({ blattDrehung: 90 }));
    assert.deepEqual(leer.markiert, []);
    // a slab outline gets a mark through its derived GUID: use the GUID planGrafik reports for a mark-all run
    const decke = [{ level: 0, _idx: 7, points: [{ x: -2, z: -1 }, { x: 3, z: -1 }, { x: 3, z: 2 }, { x: -2, z: 2 }] }];
    const guidVon = async () => (await import("@core/lib/bauteil/steckbrief.js")).bauteilGuid(1, "customSlabs", decke[0]);
    return guidVon().then((guid) => {
      const g = planGrafik(planEingabe({ customSlabs: decke, kiMarken: { guids: [guid], projektId: 1 }, blattDrehung: 90 }));
      assert.deepEqual(g.markiert, [guid]);
      const rahmen = /** @type {any} */ (g.elemente.find((e) => e.ebene === "ki_vermerk" && e.art === "poly"));
      const frage = /** @type {any} */ (g.elemente.find((e) => e.ebene === "ki_vermerk" && e.art === "text"));
      const gedreht = decke[0].points.map((p) => drehePunkt(p, 90));
      const k = 100 / 1000;
      nah(rahmen.pts[0].x, Math.min(...gedreht.map((p) => p.x)) - 1.5 * k); nah(rahmen.pts[0].z, Math.min(...gedreht.map((p) => p.z)) - 1.5 * k);
      nah(rahmen.pts[2].x, Math.max(...gedreht.map((p) => p.x)) + 1.5 * k); nah(rahmen.pts[2].z, Math.max(...gedreht.map((p) => p.z)) + 1.5 * k);
      nah(frage.x, rahmen.pts[1].x + 0.8 * k); nah(frage.z, rahmen.pts[1].z + 1.2 * k);
    });
  });

  it("DXF: gedrehtes Blatt nennt die Drehung im Kommentar, der Nordpfeil liegt auf A_NORDPFEIL und wird keine Poché-Fläche", () => {
    const opt = { massstab: 100, geschoss: "EG", projekt: "Testhaus", modellstand: null };
    const d0 = grundrissDxfDaten(planGrafik(planEingabe()), opt), d90 = grundrissDxfDaten(planGrafik(planEingabe({ blattDrehung: 90 })), opt);
    assert.ok(!d0.kommentar.some((z) => z.startsWith("Blattausrichtung")));
    assert.ok(d90.kommentar.some((z) => z.startsWith("Blattausrichtung: Zeichnung um 90 Grad gegen den Uhrzeigersinn")));
    assert.ok(d90.kommentar.every((z) => /^[\x20-\x7e]*$/.test(z)), "Kommentarzeilen ASCII");
    assert.ok(!d0.ebenen.some((e) => e.name === "A_NORDPFEIL"));
    assert.ok(d90.ebenen.some((e) => e.name === "A_NORDPFEIL"));
    const flaechen = (/** @type {any} */ d) => d.elemente.filter((/** @type {any} */ e) => e.art === "flaeche").length;
    assert.equal(flaechen(d90), flaechen(d0), "keine zusätzliche SOLID-Fläche");
    const n = /** @type {any} */ (d90.elemente.find((e) => e.ebene === "A_NORDPFEIL" && e.art === "text"));
    assert.equal(n.text, "N"); assert.ok(!n.drehung_grad);
    assert.equal(dxfDatei(d90).uebersprungen, 0);
  });

  it("PDF: das gedrehte Blatt wird erstellt (Hochformat-Zeichnung passt aufs Blatt)", async () => {
    const kopf = { massstab: 100, projekt: "Testhaus", planinhalt: "Grundriss EG", datum: "15.11.2026" };
    const a = await vektorPlanPdf(planGrafik(planEingabe()), kopf), b = await vektorPlanPdf(planGrafik(planEingabe({ blattDrehung: 90 })), kopf);
    assert.equal(a.format, "A3"); assert.equal(b.format, "A3");
    assert.ok(b.bytes.length > 1000);
  });

  it("der Schnitt kennt keine Blattausrichtung", () => {
    const e = { model: efhModell(), storeyHeight: 2.9, massstab: 100 };
    assert.equal(JSON.stringify(schnittGrafik(/** @type {any} */ ({ ...e, blattDrehung: 90 }))), JSON.stringify(schnittGrafik(e)));
  });
});

describe("115-04 Bildschirm-Grundriss (BimPlan2D, serverseitig gerendert)", () => {
  /** @type {Awaited<ReturnType<typeof jsxUmgebung>>} */
  let u;
  /** @type {any} */
  let BimPlan2D;
  before(async () => {
    u = await jsxUmgebung();
    BimPlan2D = (await u.laden("/packages/nova-designer/src/components/BimPlan2D.jsx")).default;
  });
  after(async () => { await u.schliessen(); });

  const props = (/** @type {Record<string, any>} */ mehr = {}) => ({ model: efhModell(), mode: "grundriss", level: 0, storeyHeight: 2.9, height: 520, customZones: RAEUME,
    envOpenings: EFH_108.envOpenings, edit: { tool: "arrow", customWalls: EFH_108.customWalls, customColumns: [], customWindows: [] }, ...mehr });
  const attr = (/** @type {string} */ html, /** @type {string} */ name) => (new RegExp(`${name}="([^"]*)"`).exec(html) || [])[1];
  const viewBox = (/** @type {string} */ html) => /** @type {string} */ (attr(html, "viewBox")).split(" ").map(Number);

  it("Drehung 0 = keine Drehung: dasselbe Markup, keine Gruppe, kein Attribut", () => {
    const ohne = u.rendern(BimPlan2D, props());
    assert.equal(u.rendern(BimPlan2D, props({ drehung: 0 })), ohne);
    assert.equal(u.rendern(BimPlan2D, props({ drehung: 360 })), ohne);
    assert.ok(!ohne.includes("data-plan-drehgruppe") && !ohne.includes("data-plan-drehung") && !ohne.includes("data-nordpfeil-winkel"));
    assert.ok(!/<text[^>]*data-plan-label[^>]*transform=/.test(ohne), "Raumtexte ohne transform wie bisher");
    // north arrow as before 115-04
    assert.match(ohne, /<path d="M[\d.]+,16 L[\d.]+,30 L[\d.]+,27 L[\d.]+,30 Z" fill="#0f172a"><\/path><text x="[\d.]+" y="40" text-anchor="middle" font-size="8" class="fill-slate-500">N<\/text>/);
  });

  it("90° links: EINE Gruppe mit der Rahmen-Transformation, Blatt hochkant, Maßstab und Rückrechnung stimmen", () => {
    const h0 = u.rendern(BimPlan2D, props()), h90 = u.rendern(BimPlan2D, props({ drehung: 90 }));
    assert.equal(attr(h90, "data-plan-drehung"), "90");
    assert.equal((h90.match(/data-plan-drehgruppe/g) || []).length, 1, "genau eine Drehgruppe");
    const [, , w0, hh0] = viewBox(h0), [, , w90, hh90] = viewBox(h90);
    // model 11.40 × 10.20 m plus 4 m margin each side: unturned 19.4 × 18.2, turned 18.2 × 19.4 (units = metres × scale)
    const s0 = Number(attr(h0, "data-plan-skala")), s90 = Number(attr(h90, "data-plan-skala"));
    nah(w0, 19.4 * s0, 1e-9); nah(hh0, 18.2 * s0, 1e-9);
    nah(w90, 18.2 * s90, 1e-9); nah(hh90, 19.4 * s90, 1e-9);
    nah(s90, Math.min(620 / 18.2, 360 / 19.4), 1e-9); // fitted with width and height swapped
    const m = /<g transform="matrix\(([^)]*)\)" data-plan-drehgruppe="90">/.exec(h90);
    assert.ok(m, "Gruppe trägt die Matrix");
    assert.equal(/** @type {RegExpExecArray} */ (m)[1], `0 -1 1 0 0 ${19.4 * s90}`);
    // pointer back into the model: the west wall middle (x = −5.7, z = 0) is seen at the bottom middle of the turned sheet …
    const x0 = Number(attr(h90, "data-plan-x0")), z0 = Number(attr(h90, "data-plan-z0"));
    const r = drehRahmen(90, 19.4 * s90, 18.2 * s90);
    const gesehen = r.hin((-5.7 - x0) * s90, (0 - z0) * s90);
    nah(gesehen.x, w90 / 2, 1e-9); nah(gesehen.y, hh90 - 4 * s90, 1e-9);
    // … and a pointer there computes back to that model point (the rawMeters formula of the component)
    const lokal = r.zurueck(gesehen.x, gesehen.y);
    nah(lokal.x / s90 + x0, -5.7, 1e-9); nah(lokal.y / s90 + z0, 0, 1e-9);
    // everything drawn lies inside the group; scale bar and north arrow outside
    const innen = h90.slice(h90.indexOf("data-plan-drehgruppe"));
    assert.ok(innen.includes("data-huellwand") && innen.includes("data-wand=") && innen.includes("data-masskette") && innen.includes("data-zone="));
    assert.ok(h90.indexOf("data-nordpfeil-winkel") > h90.lastIndexOf("data-masskette"), "Nordpfeil nach der Zeichnung");
  });

  it("Texte bleiben lesbar: Raumtexte aufrecht, Maßzahlen von unten oder von rechts, in jeder Drehung", () => {
    for (const d of [90, 180, 270]) {
      const html = u.rendern(BimPlan2D, props({ drehung: d }));
      const raumtexte = [...html.matchAll(/<text data-plan-label="true" x="([^"]*)" y="([^"]*)"[^>]*?transform="rotate\(([^ ]*) ([^ ]*) ([^)]*)\)"/g)];
      assert.equal(raumtexte.length, 2, `${d}°: beide Raumtexte tragen die Rückdrehung`);
      for (const t of raumtexte) {
        assert.equal(textWinkelGesehen(Number(t[3]), d), 0, "Raumtext waagrecht");
        assert.equal(t[4], t[1]); assert.equal(t[5], t[2]); // turned about its own point
      }
      const zahlen = [...html.matchAll(/<text[^>]*data-mass="[^"]*"[^>]*>/g)].map((z) => Number((/transform="rotate\(([^ ]*) /.exec(z[0]) || [])[1] || 0));
      assert.ok(zahlen.length >= 8, `${d}°: Maßzahlen vorhanden (${zahlen.length})`);
      const winkel = new Set();
      for (const lokal of zahlen) {
        const gesehen = textWinkelGesehen(lokal, d);
        assert.ok(gesehen === 0 || gesehen === -90, `${d}°: Maßzahl unter ${gesehen}°`);
        winkel.add(gesehen);
      }
      assert.deepEqual([...winkel].sort(), [-90, 0], "waagrechte und senkrechte Ketten");
      // wall length labels of the two drawn walls
      const laengen = [...html.matchAll(/<text x="[^"]*" y="[^"]*" text-anchor="middle" font-size="[^"]*" fill="#0f766e" transform="rotate\(([^ ]*) /g)];
      assert.equal(laengen.length, 2);
      for (const l of laengen) { const g = textWinkelGesehen(Number(l[1]), d); assert.ok(g >= -90 && g < 90, `${d}°: Wandlänge unter ${g}°`); }
    }
  });

  it("Nordpfeil dreht mit, der Buchstabe N bleibt aufrecht; Symbole (Tür) liegen in der gedrehten Gruppe", () => {
    for (const [d, w] of [[90, -90], [180, 180], [270, 90]]) {
      const html = u.rendern(BimPlan2D, props({ drehung: d }));
      assert.equal(attr(html, "data-nordpfeil-winkel"), String(w));
      const m = new RegExp(`fill="#0f172a" transform="rotate\\(${w} ([\\d.]+) 26\\)"></path><text x="([\\d.-]+)" y="([\\d.-]+)" text-anchor="middle" font-size="8" class="fill-slate-500">N</text>`).exec(html);
      assert.ok(m, `${d}°: Pfeil gedreht, Buchstabe ohne transform`);
      const n = nordRichtung(d), x = Number(/** @type {RegExpExecArray} */ (m)[1]);
      nah(Number(/** @type {RegExpExecArray} */ (m)[2]), x - n.x * 11, 1e-9); nah(Number(/** @type {RegExpExecArray} */ (m)[3]), 26 - n.y * 11 + 3, 1e-9);
      const innen = html.slice(html.indexOf("data-plan-drehgruppe"), html.indexOf("data-nordpfeil-winkel"));
      assert.ok(innen.includes("data-tuer-seite"), "Türsymbol dreht mit der Geometrie");
      assert.ok(!/data-tuer-seite[^>]*transform=/.test(innen), "Symbol ohne eigene Rückdrehung");
    }
  });

  it("der Schnitt wird nicht gedreht", () => {
    const e = { model: efhModell(), mode: "schnitt", storeyHeight: 2.9, height: 520 };
    assert.equal(u.rendern(BimPlan2D, { ...e, drehung: 90 }), u.rendern(BimPlan2D, e));
  });

  it("Overlay bekommt Drehung und Rückdrehung (additiv), ohne Drehung liefert sie nichts", () => {
    /** @type {any[]} */
    const gesehen = [];
    const overlay = (/** @type {any} */ a) => { gesehen.push({ drehung: a.drehung, t: a.aufrecht(10, 20) }); return null; };
    u.rendern(BimPlan2D, props({ overlay }));
    u.rendern(BimPlan2D, props({ overlay, drehung: 270 }));
    assert.deepEqual(gesehen, [{ drehung: 0, t: undefined }, { drehung: 270, t: "rotate(270 10 20)" }]);
  });
});

// N-01 (integration review of 115-04): the arrow keys nudge the selection in SCREEN directions, also on a turned floor plan.
// The key table and the body of `schieben` are read from BitBimStudio.jsx and run here with a recording nudgeSelection, so the test
// checks the code the studio runs (rendering the whole studio is not possible without a browser; the E2E plan-drehen-11504 presses
// the keys for real).
describe("115-04 Pfeiltasten im gedrehten Grundriss (N-01)", () => {
  const studio = fs.readFileSync(new URL("../../packages/nova-designer/src/components/BitBimStudio.jsx", import.meta.url), "utf8");
  /** Known truth: the direction each arrow points to on the screen, unit vector (x right, y down). */
  const GESEHEN = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  /** The key table of the studio's keyboard handler, evaluated for a step (m). @param {number} step @returns {Record<string, [number, number]>} */
  const tasten = (step) => {
    const t = studio.match(/const d = (\{ ArrowLeft: [^}]*\})\[e\.key\];/);
    assert.ok(t, "Pfeiltasten-Tabelle in BitBimStudio.jsx nicht gefunden");
    return new Function("step", `return ${t[1]};`)(step);
  };
  /**
   * Runs the body of tasteRef.schieben with a recording nudgeSelection.
   * @param {string} view "3d" | "grundriss" | "schnitt"
   * @param {number} plan screen rotation of the floor plan, degrees
   * @param {number} dx @param {number} dz offset handed in by the key handler, m
   * @returns {{x: number, z: number}} the model offset nudgeSelection receives, m
   */
  const schieben = (view, plan, dx, dz) => {
    const kopf = "\n    schieben: (/** @type {number} */ dx, /** @type {number} */ dz) => {\n";
    const start = studio.indexOf(kopf);
    assert.ok(start > 0, "schieben im Tastenobjekt nicht gefunden");
    const rumpf = studio.slice(start + kopf.length, studio.indexOf("\n    },\n", start));
    /** @type {{x: number, z: number}|null} */
    let erhalten = null;
    const nudgeSelection = (/** @type {number} */ x, /** @type {number} */ z) => { erhalten = { x, z }; return true; };
    const f = new Function("view", "planDrehungen", "drehePunktZurueck", "nudgeSelection", "dx", "dz", rumpf);
    assert.equal(f(view, { plan, blatt: null }, drehePunktZurueck, nudgeSelection, dx, dz), true, "schieben gibt das Ergebnis von nudgeSelection weiter");
    assert.ok(erhalten, "nudgeSelection nicht aufgerufen");
    return erhalten;
  };

  it("Grundriss: jede Pfeiltaste schiebt in jeder Drehung in ihre Richtung am Bildschirm", () => {
    for (const step of [0.1, 1]) for (const d of PLAN_DREHUNGEN) for (const [taste, [dx, dz]] of Object.entries(tasten(step))) {
      const m = schieben("grundriss", d, dx, dz);
      const s = drehRahmen(d, 620, 340).vektorHin(m.x, m.z); // what the turned plan shows of that model offset
      const g = GESEHEN[/** @type {keyof typeof GESEHEN} */ (taste)];
      nah(s.x, g.x * step, 1e-12); nah(s.y, g.y * step, 1e-12);
      assert.ok(!Object.is(m.x, -0) && !Object.is(m.z, -0), `${taste} ${d}°: keine negative Null`);
    }
    // the frame of the E2E (90° left: model +x up, model +z right, north = model −z left), 1 m steps
    assert.deepEqual(schieben("grundriss", 90, ...tasten(1).ArrowRight), { x: 0, z: 1 });
    assert.deepEqual(schieben("grundriss", 90, ...tasten(1).ArrowUp), { x: 1, z: 0 });
    assert.deepEqual(schieben("grundriss", 90, ...tasten(1).ArrowLeft), { x: 0, z: -1 });
    assert.deepEqual(schieben("grundriss", 90, ...tasten(1).ArrowDown), { x: -1, z: 0 });
    assert.deepEqual(schieben("grundriss", 180, ...tasten(1).ArrowRight), { x: -1, z: 0 });
    assert.deepEqual(schieben("grundriss", 270, ...tasten(1).ArrowRight), { x: 0, z: -1 });
  });

  it("0°, 3D und Schnitt: der Versatz geht unverändert in die Modellachsen (wie vor 115-04)", () => {
    for (const [view, d] of [["grundriss", 0], ["3d", 90], ["3d", 270], ["schnitt", 90], ["schnitt", 180]]) {
      for (const [taste, [dx, dz]] of Object.entries(tasten(0.1))) {
        assert.deepEqual(schieben(String(view), Number(d), dx, dz), { x: dx, z: dz }, `${taste} ${view} ${d}°`);
      }
    }
  });
});

// Endless loop found by the rust-anything trial (19.11.2026): textWinkelLesbar / textWinkelGesehen / textWinkelImRahmen looped
// forever on ±Infinity and for a very long time on huge angles. Guard: non-finite → 0, huge values reduced by modulo first.
describe("115-04: Textwinkel-Schutz", () => {
it("115-04: Textwinkel hängen nicht bei Infinity oder riesigen Winkeln und bleiben im Wertebereich", async () => {
  const { textWinkelLesbar, textWinkelGesehen, textWinkelImRahmen } = await import("@core/lib/plan/planDrehung.js");
  const t0 = Date.now();
  assert.equal(textWinkelLesbar(Infinity), 0);
  assert.equal(textWinkelLesbar(-Infinity), 0);
  assert.equal(textWinkelGesehen(Infinity, 0), 0);
  assert.equal(textWinkelGesehen(-Infinity, 90), 0);
  assert.equal(textWinkelImRahmen(Infinity, 90), 90); // lesbar(Infinity − 90) = 0, plus the frame angle
  for (const w of [1e7, -1e7, 1e10, 1e18, 1e21, -1e21, 1.7e308]) {
    const a = textWinkelLesbar(w);
    assert.ok(Number.isFinite(a) && a >= -90 && a < 90, `lesbar(${w}) = ${a}`);
    const g = textWinkelGesehen(w, 90);
    assert.ok(Number.isFinite(g) && g > -180 && g <= 180, `gesehen(${w}) = ${g}`);
  }
  assert.ok(Date.now() - t0 < 1000, "must finish quickly");
});

it("115-04: Schutz gegen Endlosschleife ändert normale Winkel nicht (bitgleich zur alten Schleife)", async () => {
  const { textWinkelLesbar, textWinkelGesehen } = await import("@core/lib/plan/planDrehung.js");
  const altLesbar = (/** @type {number} */ winkel) => {
    let w = Number(winkel) || 0;
    w = Math.round(w * 1e6) / 1e6;
    while (w >= 90) w -= 180;
    while (w < -90) w += 180;
    return w === 0 ? 0 : w;
  };
  const altGesehen = (/** @type {number} */ lokal, /** @type {number} */ d) => {
    let w = (Number(lokal) || 0) - d;
    while (w > 180) w -= 360;
    while (w <= -180) w += 360;
    return w === 0 ? 0 : w;
  };
  for (let w = -100000; w <= 100000; w += 3.7) {
    assert.ok(Object.is(textWinkelLesbar(w), altLesbar(w)), `lesbar ${w}`);
    for (const d of [0, 90, 180, 270]) assert.ok(Object.is(textWinkelGesehen(w, d), altGesehen(w, d)), `gesehen ${w} ${d}`);
  }
});
});
