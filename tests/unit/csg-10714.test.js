// 107-14 — CSG core: one three instance under node:test, watertight check, booleans, volume comparison, plane cut, hash.
// Every expected value is calculated by hand (comment next to it); the library result is never its own reference.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  istWasserdicht, volumen_m3, volumenJeGruppe, analytischWand, analytischPlatte, volumenAbgleich,
  horizontalschnitt, vertikalschnitt, basisHash, kanonisch, CSG_VERSION, dreieckAnzahl, geometrieBereinigen,
  quaderKoerper, oeffnungKoerper, wandSolid, wandBasis, platteSolid, csgLaden, csgWarnungText, booleschMit,
  ABWEICHUNG_SCHWELLE_REL, ABWEICHUNG_BODEN_M3,
} from "@core/lib/csg/index.js";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";

const nah = (/** @type {number} */ ist, /** @type {number} */ soll, eps = 1e-6, text = "") =>
  assert.ok(Math.abs(ist - soll) <= eps, `${text} ist ${ist}, soll ${soll} (±${eps})`);
const box = (/** @type {number[]} */ [x0, x1, y0, y1, z0, z1], mi = 0) => quaderKoerper({ x0_m: x0, x1_m: x1, y0_m: y0, y1_m: y1, z0_m: z0, z1_m: z1, materialIndex: mi });
/** a non-indexed copy of a geometry with some triangles removed or flipped */
function veraendert(/** @type {THREE.BufferGeometry} */ geo, { weg = [], gedreht = [] } = /** @type {{weg?: number[], gedreht?: number[]}} */ ({})) {
  const s = geometrieBereinigen(geo);
  const p = /** @type {Float32Array} */ (s.getAttribute("position").array);
  const out = [];
  for (let t = 0; t < p.length / 9; t += 1) {
    if (weg.includes(t)) continue;
    const e = [0, 1, 2].map((k) => [p[t * 9 + k * 3], p[t * 9 + k * 3 + 1], p[t * 9 + k * 3 + 2]]);
    out.push(...(gedreht.includes(t) ? [e[0], e[2], e[1]] : e).flat());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 3));
  g.computeVertexNormals();
  return g;
}

const kern = await csgLaden();

describe("107-14 — eine three-Instanz unter node:test (Wächter, Task 2; seit 107-18 Backend manifold-3d)", () => {
  it("manifold-3d wird als ES-Modul geladen, Ergebnis ist BufferGeometry derselben three-Instanz, keine Warnung", async () => {
    // 107-18: the library is an ES module with an exports map (no redirect in the alias hook); it does not import three at
    // all — the three geometry is built by kern.js from the test's own three
    assert.match(import.meta.resolve("manifold-3d").replace(/\\/g, "/"), /manifold-3d\/manifold\.js$/);
    const warnungen = [];
    const warn = console.warn;
    console.warn = (...a) => { warnungen.push(a.join(" ")); };
    /** @type {string[]} */
    const prozess = [];
    const hoerer = (/** @type {Error} */ w) => prozess.push(`${w.name}: ${w.message}`);
    process.on("warning", hoerer);
    try {
      const r = kern.boolesch(new THREE.BoxGeometry(1, 1, 1), new THREE.BoxGeometry(0.5, 2, 0.5), "subtract");
      assert.equal(r.ok, true);
      assert.ok(/** @type {any} */ (r).geometrie instanceof THREE.BufferGeometry, "result geometry of the test's three");
      nah(/** @type {any} */ (r).volumen_m3, 1 - 0.25, 1e-6); // 1 m³ minus the 0.5 × 1 × 0.5 m column through it
      await new Promise((r2) => setTimeout(r2, 0));
    } finally {
      console.warn = warn;
      process.off("warning", hoerer);
    }
    assert.equal(warnungen.filter((w) => /Multiple instances/i.test(w)).length, 0, warnungen.join("\n"));
    assert.equal(prozess.filter((w) => /THREE_CJS|require\("three"\)/.test(w)).length, 0, prozess.join("\n"));
  });
});

describe("107-14 — Wasserdichtprüfung und Volumen (Task 3, 8)", () => {
  it("Wand 4,0 × 2,5 × 0,30 m: 3,0 m³, 12 Dreiecke, wasserdicht, Volumen positiv", () => {
    const g = box([0, 4, 0, 2.5, -0.15, 0.15]);
    const b = istWasserdicht(g);
    assert.equal(b.ok, true);
    assert.equal(b.dreiecke, 12); // 6 faces × 2
    nah(volumen_m3(g), 3.0); // 4 · 2.5 · 0.3
    assert.ok(volumen_m3(g) > 0);
  });
  it("eine Dreiecksfläche entfernt → nicht wasserdicht; boolesch läuft nicht", () => {
    const g = veraendert(box([0, 4, 0, 2.5, -0.15, 0.15]), { weg: [0] });
    const b = istWasserdicht(g);
    assert.equal(b.ok, false);
    assert.equal(b.offeneKanten, 3); // the three edges of the missing triangle
    let gerufen = false;
    const spion = { ...kern.csgBackend, subtract: () => { gerufen = true; return box([0, 1, 0, 1, 0, 1]); } };
    const r = booleschMit(spion, g, box([1, 2, 0.5, 1.5, -0.2, 0.2]), "subtract");
    assert.equal(r.ok, false);
    assert.equal(/** @type {any} */ (r).grund, "offen");
    assert.equal(/** @type {any} */ (r).eingabe, "a");
    assert.equal(gerufen, false, "no operation on an open input");
    const r2 = kern.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15]), g, "subtract");
    assert.equal(r2.ok, false);
    assert.equal(/** @type {any} */ (r2).eingabe, "b");
  });
  it("ein Dreieck gedreht → falschOrientiert; ganzer Körper gedreht → innenNachAussen", () => {
    const g = veraendert(box([0, 4, 0, 2.5, -0.15, 0.15]), { gedreht: [5] });
    const b = istWasserdicht(g);
    assert.equal(b.ok, false);
    assert.equal(b.falschOrientiert, 3);
    const alle = veraendert(box([0, 1, 0, 1, 0, 1]), { gedreht: [...Array(12).keys()] });
    const b2 = istWasserdicht(alle);
    assert.equal(b2.innenNachAussen, true);
    assert.equal(b2.ok, false);
    nah(b2.volumen_m3, -1);
  });
  it("zwei Dreiecke an einer dritten Kante → nichtMannigfaltig", () => {
    const g = veraendert(box([0, 1, 0, 1, 0, 1]));
    const p = /** @type {Float32Array} */ (g.getAttribute("position").array);
    // a fin: one extra triangle on the first edge of triangle 0
    const fin = [p[0], p[1], p[2], p[3], p[4], p[5], 5, 5, 5];
    const n = new THREE.BufferGeometry();
    n.setAttribute("position", new THREE.BufferAttribute(new Float32Array([...p, ...fin]), 3));
    assert.ok(istWasserdicht(n).nichtMannigfaltig >= 1);
  });
});

describe("107-14 — Boolesche mit Handrechnung (Task 4, 8)", () => {
  after(() => setzeProjektAufbauten(null));
  it("Wand minus Öffnung 1,0 × 1,2 m (Brüstung 0,9 m, mittig) = 2,64 m³", async () => {
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
    const r = await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern });
    assert.equal(r.ok, true, JSON.stringify(r.warnung));
    nah(r.volumen.solid_m3 ?? NaN, 2.64, 1e-5); // 3.0 − 1.0 · 1.2 · 0.30
    nah(r.volumen.analytisch_m3, 2.64, 1e-12);
    assert.equal(r.quelle, "solid");
    assert.equal(r.warnung, null);
    assert.ok(istWasserdicht(/** @type {any} */ (r.geometrie)).ok);
  });
  it("dreischichtig 0,115 / 0,16 / 0,025 m: Schichten 1,012 / 1,408 / 0,22 m³, Summe 2,64 m³, Gruppen bleiben", async () => {
    setzeProjektAufbauten({ aufbauten: { "p-t3": { name: "Test drei Schichten", skins: [
      { name: "A", material: "beton", thickness: 115 }, { name: "B", material: "mw035", thickness: 160 }, { name: "C", material: "gipsputz", thickness: 25 },
    ] } } });
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-t3", height: 2.5, level: 0 };
    // without opening: 10 m² · 0.115 = 1.15, · 0.16 = 1.60, · 0.025 = 0.25
    const ohne = await wandSolid(wand, [], { kern });
    const vo = volumenJeGruppe(/** @type {any} */ (ohne.geometrie));
    nah(vo[0], 1.15, 1e-5); nah(vo[1], 1.6, 1e-5); nah(vo[2], 0.25, 1e-5);
    // with opening: 4 · 2.5 − 1.2 = 8.8 m² → 1.012 / 1.408 / 0.22
    const mit = await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern });
    assert.equal(mit.ok, true, JSON.stringify(mit.warnung));
    const v = volumenJeGruppe(/** @type {any} */ (mit.geometrie));
    assert.deepEqual(Object.keys(v).map(Number).sort(), [0, 1, 2], "one group per layer");
    nah(v[0], 1.012, 1e-5); nah(v[1], 1.408, 1e-5); nah(v[2], 0.22, 1e-5);
    nah(mit.volumen.solid_m3 ?? NaN, 2.64, 1e-5);
    assert.deepEqual(mit.volumen.jeSchicht.map((s) => s.material), ["beton", "mw035", "gipsputz"]);
  });
  it("Wandecke: Vereinigung 5,8875 m³, Schnitt 0,1125 m³, A − B 2,8875 m³", () => {
    // A: x 0…4, z −0.15…0.15; B: x 3.85…4.15, z −0.15…3.85; both 2.5 m high; overlap 0.15 · 0.30 · 2.5 = 0.1125
    const A = () => box([0, 4, 0, 2.5, -0.15, 0.15]);
    const B = () => box([3.85, 4.15, 0, 2.5, -0.15, 3.85]);
    const u = kern.boolesch(A(), B(), "union");
    const s = kern.boolesch(A(), B(), "intersect");
    const d = kern.boolesch(A(), B(), "subtract");
    assert.ok(u.ok && s.ok && d.ok);
    nah(/** @type {any} */ (u).volumen_m3, 5.8875, 1e-5); // 3.0 + 3.0 − 0.1125
    nah(/** @type {any} */ (s).volumen_m3, 0.1125, 1e-5);
    nah(/** @type {any} */ (d).volumen_m3, 2.8875, 1e-5); // 3.0 − 0.1125
    for (const r of [u, s, d]) assert.ok(istWasserdicht(/** @type {any} */ (r).geometrie).ok, "results are closed (T-junctions resolved)");
  });
  it("Platte 6 × 5 × 0,25 m = 7,5 m³; mit Stützenloch 0,4 × 0,4 m = 7,46 m³", async () => {
    const ring = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }, { x: 0, z: 5 }];
    const ohne = await platteSolid(ring, 0.25, [], { kern });
    nah(ohne.volumen.solid_m3 ?? NaN, 7.5, 1e-5);
    const loch = [{ x: 2.8, z: 2.3 }, { x: 3.2, z: 2.3 }, { x: 3.2, z: 2.7 }, { x: 2.8, z: 2.7 }];
    const mit = await platteSolid(ring, 0.25, [loch], { kern });
    assert.equal(mit.ok, true, JSON.stringify(mit.warnung));
    nah(mit.volumen.solid_m3 ?? NaN, 7.46, 1e-5); // 7.5 − 0.4 · 0.4 · 0.25
    nah(analytischPlatte({ flaeche_m2: 30, dicke_m: 0.25, loecher_m2: [0.16] }), 7.46, 1e-12);
  });
  it("Öffnungskörper: Klemmung wie lochImWand, 2 cm Überstand je Seite", () => {
    const o = oeffnungKoerper({ u: 2, width: 1, height: 1.2, sill: 0.9 }, { laenge_m: 4, hoehe_m: 2.5, z0_m: -0.15, z1_m: 0.15 });
    nah(volumen_m3(/** @type {any} */ (o)), 1.0 * 1.2 * 0.34, 1e-6); // thickness 0.30 + 2 · 0.02
    // sill 0 is clamped to 2 cm above the bottom: hole height 1.2 − 0.02 = 1.18
    nah(analytischWand({ laenge_m: 4, hoehe_m: 2.5, schichten_m: [0.3], oeffnungen: [{ u: 2, width: 1, height: 1.2, sill: 0 }] }).gesamt_m3, (10 - 1.18) * 0.3, 1e-12);
  });
});

describe("107-14 — Bereinigung und lokale Koordinaten (Task 4, 8)", () => {
  it("Ergebnis: nicht indiziert, ganzer drawRange, Dreiecke = position.count / 3, Volumen = Handwert", () => {
    const r = /** @type {any} */ (kern.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15]), box([1.5, 2.5, 0.9, 2.1, -0.17, 0.17]), "subtract"));
    assert.equal(r.ok, true);
    assert.equal(r.geometrie.getIndex(), null);
    assert.equal(r.geometrie.getAttribute("position").count / 3, r.dreiecke);
    assert.equal(r.dreiecke, dreieckAnzahl(r.geometrie));
    nah(volumen_m3(r.geometrie), 2.64, 1e-5);
  });
  it("drawRange und Indexreste: Volumen zählt nur den Bereich, die Bereinigung kopiert nur ihn", () => {
    const g = box([0, 1, 0, 1, 0, 1]); // indexed, 36 indices = 12 triangles
    const idx = /** @type {any} */ (g.getIndex()).array;
    // rest after the range: a copy of the first 6 triangles = faces +x, −x, +y of BoxGeometry. Counted from the origin they add
    // area · distance / 3 each: +x 1 · 1 / 3, −x 1 · 0 / 3, +y 1 · 1 / 3 → 2/3 m³ too much
    const lang = new Uint16Array([...idx, ...idx.slice(0, 18)]);
    g.setIndex(new THREE.BufferAttribute(lang, 1));
    nah(volumen_m3(g), 1 + 2 / 3, 1e-6, "without a draw range the rest counts");
    g.setDrawRange(0, 36);
    nah(volumen_m3(g), 1.0, 1e-6);
    const s = geometrieBereinigen(g);
    assert.equal(s.getAttribute("position").count, 36);
    nah(volumen_m3(s), 1.0, 1e-6);
  });
  it("Wand bei x = 1 000 m: lokal gerechnet weicht das Volumen < 1e-6 m³ vom Handwert ab (Messung Welt vs. lokal)", async () => {
    const wand = { a: { x: 1000, z: 500 }, b: { x: 1004, z: 500 }, thickness: 0.3, height: 2.5, level: 0 };
    const lokal = await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern });
    const abwLokal = Math.abs((lokal.volumen.solid_m3 ?? NaN) - 2.64);
    assert.ok(abwLokal < 1e-6, `local deviation ${abwLokal}`);
    nah(lokal.platzierung.ursprung.x, 1000, 1e-12);
    // the same wall built in world coordinates (what the core avoids): measured for the register, not asserted tightly
    const welt = /** @type {any} */ (kern.boolesch(box([1000, 1004, 0, 2.5, 499.85, 500.15]), box([1001.5, 1002.5, 0.9, 2.1, 499.83, 500.17]), "subtract"));
    const abwWelt = Math.abs(volumen_m3(welt.geometrie) - 2.64);
    console.log(`[107-14 Messung] Wand 4 × 2,5 × 0,3 m mit Öffnung: Abweichung lokal ${abwLokal.toExponential(2)} m³, in Weltkoordinaten (x = 1 000 m) ${abwWelt.toExponential(2)} m³`);
    assert.ok(abwWelt < 1e-2, "world coordinates still in the right range");
  });
});

describe("107-14 — Ebenenschnitt (Task 3, 8)", () => {
  it("Wand 4 × 2,5 × 0,3 bei y = 1,0 m → eine Schleife 1,2 m²; mit Öffnung zwei je 0,45 m²; bei y = 0,5 m wieder 1,2 m²", async () => {
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
    const voll = /** @type {any} */ ((await wandSolid(wand, [], { kern })).geometrie);
    const s1 = horizontalschnitt(voll, 1.0);
    assert.equal(s1.schleifen.length, 1);
    nah(s1.schleifen[0].flaeche_m2, 1.2, 1e-5); // 4 · 0.3
    assert.equal(s1.offen.length, 0);
    const mit = /** @type {any} */ ((await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern })).geometrie);
    const s2 = horizontalschnitt(mit, 1.0);
    assert.equal(s2.schleifen.length, 2);
    for (const s of s2.schleifen) nah(s.flaeche_m2, 0.45, 1e-5); // 1.5 · 0.3
    nah(s2.flaeche_m2, 0.9, 1e-5);
    assert.equal(s2.offen.length, 0);
    const s3 = horizontalschnitt(mit, 0.5);
    assert.equal(s3.schleifen.length, 1);
    nah(s3.flaeche_m2, 1.2, 1e-5);
  });
  it("Loch als Innenschleife (Orientierung): Platte mit Stützenloch, Schnitt in halber Dicke = 30 − 0,16 m²", async () => {
    const ring = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }, { x: 0, z: 5 }];
    const loch = [{ x: 2.8, z: 2.3 }, { x: 3.2, z: 2.3 }, { x: 3.2, z: 2.7 }, { x: 2.8, z: 2.7 }];
    const p = /** @type {any} */ ((await platteSolid(ring, 0.25, [loch], { kern })).geometrie);
    const s = horizontalschnitt(p, 0.125);
    assert.equal(s.schleifen.length, 2);
    assert.equal(s.schleifen.filter((x) => x.loch).length, 1);
    nah(s.schleifen.find((x) => x.loch)?.flaeche_m2 ?? NaN, 0.16, 1e-5);
    nah(s.flaeche_m2, 29.84, 1e-4);
  });
  it("Vertikalschnitt quer durch die Wand bei x = 2,0 (Öffnungsmitte): zwei Schleifen Brüstung 0,9 · 0,3 und Sturz 0,4 · 0,3", async () => {
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
    const mit = /** @type {any} */ ((await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern })).geometrie);
    const s = vertikalschnitt(mit, { a: { x: 2, z: -1 }, b: { x: 2, z: 1 } });
    assert.equal(s.schleifen.length, 2);
    nah(s.flaeche_m2, 0.9 * 0.3 + (2.5 - 2.1) * 0.3, 1e-5); // 0.27 + 0.12
  });
});

describe("107-14 — Volumenabgleich (Task 3, 8)", () => {
  it("Soll = analytisch → Solid, kein Warncode; 1 % verfälscht → analytisch mit Warnung", () => {
    const ok = volumenAbgleich({ solid_m3: 2.64, analytisch_m3: 2.64 });
    assert.equal(ok.quelle, "solid");
    assert.equal(ok.warnung, null);
    const falsch = volumenAbgleich({ solid_m3: 2.64 * 1.01, analytisch_m3: 2.64 });
    assert.equal(falsch.quelle, "analytisch");
    assert.equal(falsch.warnung?.code, "csg-abweichung");
    assert.equal(falsch.menge_m3, 2.64);
    nah(falsch.abweichung_rel ?? NaN, 0.01, 1e-12);
  });
  it("Schwellenrand 0,2 % beidseitig (Wert 10 m³) und absoluter Boden 0,1 l beidseitig (Wert 0,01 m³)", () => {
    assert.equal(ABWEICHUNG_SCHWELLE_REL, 0.002);
    assert.equal(ABWEICHUNG_BODEN_M3, 1e-4);
    assert.equal(volumenAbgleich({ solid_m3: 10.0199, analytisch_m3: 10 }).quelle, "solid"); // 0.199 %
    assert.equal(volumenAbgleich({ solid_m3: 10.0201, analytisch_m3: 10 }).quelle, "analytisch"); // 0.201 %
    assert.equal(volumenAbgleich({ solid_m3: 0.01009, analytisch_m3: 0.01 }).quelle, "solid"); // 0.09 l < floor, although 0.9 %
    assert.equal(volumenAbgleich({ solid_m3: 0.01011, analytisch_m3: 0.01 }).quelle, "analytisch"); // 0.11 l
    assert.equal(volumenAbgleich({ solid_m3: null, analytisch_m3: 1 }).quelle, "analytisch");
  });
  it("fehlendes Loch 0,2 × 0,2 m in 4 × 2,5 × 0,3 m Wand (0,4 %) wird erkannt", () => {
    const a = analytischWand({ laenge_m: 4, hoehe_m: 2.5, schichten_m: [0.3], oeffnungen: [{ u: 2, width: 0.2, height: 0.2, sill: 1 }] }).gesamt_m3;
    nah(a, 3 - 0.012, 1e-12);
    assert.equal(volumenAbgleich({ solid_m3: 3, analytisch_m3: a }).warnung?.code, "csg-abweichung");
  });
  it("Warntext je Code (deutsch, über tz übersetzbar)", () => {
    assert.match(csgWarnungText({ code: "csg-abweichung", abweichung_rel: 0.01 }), /weicht um 1 % von der Handrechnung ab/);
    assert.match(csgWarnungText({ code: "csg-offen", eingabe: "a" }), /Eingabekörper ist nicht geschlossen/);
    assert.match(csgWarnungText({ code: "csg-offen", eingabe: "ergebnis" }), /Ergebnis ist nicht geschlossen/);
    assert.match(csgWarnungText({ code: "csg-fehler", text: "x" }), /nicht verfügbar \(x\)/);
    assert.equal(csgWarnungText(null), "");
    assert.equal(csgWarnungText({ code: "csg-offen", eingabe: "a" }, () => "EN"), "EN");
  });
  it("offene Eingabe in wandSolid → kein Solid, Menge analytisch, Warnung csg-offen", async () => {
    const offen = { ...kern, boolesch: () => ({ ok: false, grund: "offen", eingabe: "b", bericht: null }) };
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
    const r = await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern: /** @type {any} */ (offen) });
    assert.equal(r.ok, false);
    assert.equal(r.geometrie, null);
    assert.equal(r.quelle, "analytisch");
    nah(r.menge_m3, 2.64, 1e-12);
    assert.equal(r.warnung?.code, "csg-offen");
  });
});

describe("107-14 — Basis-Hash (Task 3, 8)", () => {
  const ein = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, hoehe_m: 2.5, schichten: [{ dicke_m: 0.3, material: "beton" }] };
  it("andere Schlüsselreihenfolge → gleicher Hash; 16 Hexzeichen", () => {
    const anders = { schichten: [{ material: "beton", dicke_m: 0.3 }], hoehe_m: 2.5, b: { z: 0, x: 4 }, a: { z: 0, x: 0 } };
    assert.equal(basisHash(ein), basisHash(anders));
    assert.match(basisHash(ein), /^[0-9a-f]{16}$/);
  });
  it("Rauschen 1e-7 m auf festen Werten (2,5 m; 0,3 m) → gleicher Hash; −0 = 0", () => {
    assert.equal(basisHash(ein), basisHash({ ...ein, hoehe_m: 2.5 + 1e-7, schichten: [{ dicke_m: 0.3 - 1e-7, material: "beton" }] }));
    assert.equal(kanonisch(-0), "0");
    assert.equal(kanonisch({ b: 1, a: undefined }), '{"b":1}');
  });
  it("Änderung um 1 mm → anderer Hash; geänderte CSG_VERSION → anderer Hash", () => {
    assert.notEqual(basisHash(ein), basisHash({ ...ein, hoehe_m: 2.501 }));
    assert.notEqual(basisHash(ein), basisHash(ein, { version: `${CSG_VERSION}-neu` }));
  });
  it("wandBasis enthält alle Eingaben: Öffnung verschoben → anderer Hash", () => {
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
    const h1 = basisHash(wandBasis(wand, [{ u: 2, width: 1, height: 1.2, sill: 0.9 }]));
    const h2 = basisHash(wandBasis(wand, [{ u: 2.001, width: 1, height: 1.2, sill: 0.9 }]));
    assert.notEqual(h1, h2);
    assert.equal(h1, basisHash(wandBasis({ ...wand }, [{ u: 2, width: 1, height: 1.2, sill: 0.9 }])));
  });
});
