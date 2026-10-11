// Unit tests for 86-01 (footprint-true tessellation, stage 1): the geometry kernel
// (packages/nova-designer/src/lib/formGeometrie.js) and the fitting in tesseliere —
// rotated rectangles give the rotated result of the axis-parallel one, any other shape is
// tessellated inside its largest fitting rectangle with NOTHING outside the footprint, the
// remainder is reported; axis-parallel rectangles stay byte-identical (snapshots 7513/7514).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  flaeche, flaecheSigniert, bereinigen, punktImPolygon, istRechteck, istAchsRechteck, rahmen, inLokal, inWelt,
  kandidatenRichtungen, querschnitt, streifenIntervalle, groesstesRechteck, schneideHalbebene, restOhneRechteck, schwerpunkt,
} from "@designer/lib/formGeometrie";
import { tesseliere, formEinpassung, FORM_TIEFE } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { pruefeAlle, masseVon } from "@designer/lib/raumQualitaet";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const dreh = (pts, grad, dx = 0, dz = 0) => {
  const a = (grad * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map((p) => ({ x: c * p.x - s * p.z + dx, z: s * p.x + c * p.z + dz }));
};
// Pentagon of the user's screenshot (Bürocampus Nord, 13,5 px/m), centred.
const FUENFECK = (() => {
  const px = [[596, 688], [736, 204], [1099, 104], [1433, 261], [1268, 550]];
  const p = px.map(([x, y]) => ({ x: x / 13.5, z: -y / 13.5 }));
  const c = schwerpunkt(p);
  return p.map((q) => ({ x: q.x - c.x, z: q.z - c.z }));
})();
const L_FORM = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const TRAPEZ = [{ x: -30, z: -8 }, { x: 30, z: -8 }, { x: 22, z: 9 }, { x: -24, z: 9 }];

/** Share of room area outside the footprint (0,25 m grid sampling), 0…1. */
const anteilAussen = (r, fp) => {
  let alle = 0, aussen = 0;
  for (const z of r.zonen.filter((q) => q.we && q.art)) {
    const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
    for (let x = Math.min(...xs) + 0.125; x < Math.max(...xs); x += 0.25) {
      for (let y = Math.min(...zs) + 0.125; y < Math.max(...zs); y += 0.25) {
        if (!punktImPolygon(z.points, x, y)) continue;
        alle += 1; if (!punktImPolygon(fp, x, y)) aussen += 1;
      }
    }
  }
  return alle ? aussen / alle : 0;
};

describe("86-01 — Geometrie-Kern", () => {
  it("Fläche, Umlaufsinn, Schwerpunkt", () => {
    assert.equal(flaeche(rect(10, 4)), 40);
    assert.ok(flaecheSigniert(rect(10, 4)) > 0);
    assert.ok(flaecheSigniert([...rect(10, 4)].reverse()) < 0);
    const s = schwerpunkt(rect(10, 4).map((p) => ({ x: p.x + 3, z: p.z - 2 })));
    assert.ok(Math.abs(s.x - 3) < 1e-9 && Math.abs(s.z + 2) < 1e-9);
  });

  it("bereinigen entfernt Doppel- und Zwischenpunkte", () => {
    const p = bereinigen([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 0, z: 4 }]);
    assert.equal(p.length, 4);
  });

  it("istRechteck / istAchsRechteck", () => {
    assert.ok(istAchsRechteck(rect(40, 16)) && istRechteck(rect(40, 16)));
    const r = dreh(rect(40, 16), 23);
    assert.ok(istRechteck(r) && !istAchsRechteck(r));
    assert.ok(!istRechteck(TRAPEZ) && !istRechteck(L_FORM) && !istRechteck(FUENFECK));
  });

  it("Rahmen: inWelt(inLokal(p)) = p, Kante wird zur lokalen x-Achse", () => {
    const r = rahmen(0.4, { x: 3, z: -1 });
    const p = { x: 7.5, z: 2.25 };
    const q = inWelt(inLokal(p, r), r);
    assert.ok(Math.abs(q.x - p.x) < 1e-12 && Math.abs(q.z - p.z) < 1e-12);
    const g = dreh(rect(40, 16), 23);
    const k = kandidatenRichtungen(g)[0];
    assert.ok(Math.abs(k.winkel - (23 * Math.PI) / 180) < 1e-9, `Richtung ${k.winkel}`);
  });

  it("Querschnitt und Streifen-Intervalle (konkav: L-Form zerfällt in zwei Bereiche nicht, Kerbe schon)", () => {
    assert.deepEqual(querschnitt(rect(10, 4), 0), [[-5, 5]]);
    assert.deepEqual(streifenIntervalle(L_FORM, 0, 16).map(([a, b]) => [Math.round(a), Math.round(b)]), [[0, 48]]);
    assert.deepEqual(streifenIntervalle(L_FORM, 10, 30).map(([a, b]) => [Math.round(a), Math.round(b)]), [[0, 16]]);
    const U = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 8 }, { x: 10, z: 8 }, { x: 10, z: 20 }, { x: 0, z: 20 }];
    assert.equal(streifenIntervalle(U, 10, 18).length, 2, "U-Form: zwei Schenkel");
  });

  it("größtes Rechteck mit Tiefengrenzen (Trapez, L-Form)", () => {
    const t = groesstesRechteck(TRAPEZ, { tiefeMin: 8, tiefeMax: 17 });
    assert.ok(t && t.flaeche > 600, `Trapez ${t?.flaeche}`);
    for (const [x, z] of [[t.x0, t.z0], [t.x1, t.z0], [t.x1, t.z1], [t.x0, t.z1]]) {
      const innen = { x: x + Math.sign(-x || 1) * 1e-6, z: z + Math.sign(-z || 1) * 1e-6 };
      assert.ok(punktImPolygon(TRAPEZ, innen.x * 0.999, innen.z * 0.999), "Ecke im Trapez");
    }
    const l = groesstesRechteck(L_FORM, { tiefeMin: 11, tiefeMax: 17 });
    assert.equal(Math.round(l.flaeche), 48 * 16);
    assert.equal(groesstesRechteck(rect(10, 4), { tiefeMin: 8 }), null, "zu flach für die Mindesttiefe");
  });

  it("masseVon: gedrehter Raum wird in seinem eigenen Rahmen gemessen, achsparallel = bboxVon", () => {
    const raum = { points: dreh([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 3 }, { x: 0, z: 3 }], 23) };
    const m = masseVon(raum);
    assert.ok(Math.abs(m.w - 5) < 1e-9 && Math.abs(m.d - 3) < 1e-9, `${m.w} × ${m.d}`);
    const achs = masseVon({ points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 5 }, { x: 0, z: 5 }] });
    assert.deepEqual([achs.w, achs.d], [3, 5]);
  });

  it("Halbebene und Rest ohne Rechteck: Flächenbilanz geht auf", () => {
    assert.equal(flaeche(schneideHalbebene(rect(10, 4), 1, 0, 0)), 20);
    const r = groesstesRechteck(TRAPEZ, { tiefeMin: 8, tiefeMax: 17 });
    const rest = restOhneRechteck(TRAPEZ, r);
    const summe = rest.reduce((s, t) => s + flaeche(t), 0) + r.flaeche;
    assert.ok(Math.abs(summe - flaeche(TRAPEZ)) < 1e-6, `${summe} vs ${flaeche(TRAPEZ)}`);
  });
});

describe("86-01 — Form-Einpassung in tesseliere", () => {
  const opts = (fp, typ = "mittelflur", extra = {}) => ({ footprintM: fp, storeys: 2, typ, einheiten: STD, raumzonen: true, ...extra });

  it("achsparalleles Rechteck: keine Einpassung (bytegleich), kein form-Feld", () => {
    assert.equal(formEinpassung(rect(40, 16), "mittelflur"), null);
    assert.equal(tesseliere(opts(rect(40, 16))).form, undefined);
  });

  it("gedrehtes Rechteck = gedrehtes Ergebnis des achsparallelen (gleiche WE, Räume, Türen)", () => {
    const a = tesseliere(opts(rect(40, 16)));
    const g = tesseliere(opts(dreh(rect(40, 16), 23, 5, -3)));
    assert.equal(g.weListe.length, a.weListe.length);
    assert.equal(g.zonen.length, a.zonen.length);
    assert.equal(g.form.rechteckForm, true);
    assert.equal(g.form.rest_m2, 0);
    for (let i = 0; i < a.zonen.length; i += 1) {
      assert.equal(g.zonen[i].name, a.zonen[i].name);
      // doors: same edge and position (1e-9 m rounding noise from the frame turn)
      const rund = (t) => JSON.stringify(t || [], (k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v));
      assert.equal(rund(g.zonen[i].tueren), rund(a.zonen[i].tueren), "Türen (Kante + Lage) unverändert");
      const erwartet = dreh(a.zonen[i].points, 23, 5, -3);
      g.zonen[i].points.forEach((p, k) => assert.ok(Math.hypot(p.x - erwartet[k].x, p.z - erwartet[k].z) < 1e-6, `${a.zonen[i].name} Punkt ${k}`));
    }
    assert.ok(!g.hinweise.some((h) => /\[86-01\]/.test(h)), "Rechteck: kein Rest-Hinweis");
  });

  it("Prüfungen: gedrehtes Rechteck ergibt dieselben Prüfergebnisse wie das achsparallele (Seitenverhältnis, Bad, Flurenden, Türen)", () => {
    // rule + level exact, values within 1 cm (a 1,925 m bath may round to 1,92 or 1,93)
    const zusammenfassung = (r) => pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })
      .map((q) => q.eintraege.map((e) => ({ k: `${e.regel}:${e.stufe}`, w: Number(e.wert ?? 0) })).sort((x, y) => x.k.localeCompare(y.k) || x.w - y.w));
    const a = tesseliere(opts(rect(40, 16)));
    const g = tesseliere(opts(dreh(rect(40, 16), 23, 5, -3)));
    const za = zusammenfassung(a), zg = zusammenfassung(g);
    assert.equal(zg.length, za.length);
    for (let i = 0; i < za.length; i += 1) {
      assert.deepEqual(zg[i].map((e) => e.k), za[i].map((e) => e.k), `WE ${i}: Regeln/Stufen`);
      zg[i].forEach((e, k) => assert.ok(Math.abs(e.w - za[i][k].w) <= 0.011, `WE ${i} ${e.k}: ${e.w} vs ${za[i][k].w}`));
    }
  });

  it("Himmelsrichtung dreht mit: gedrehtes Rechteck mit Nordwinkel 0 = achsparallel mit Nordwinkel 23", () => {
    const a = tesseliere(opts(rect(40, 16), "mittelflur", { regeln: { himmelsrichtung: true }, nordwinkel: 23 }));
    const g = tesseliere(opts(dreh(rect(40, 16), 23), "mittelflur", { regeln: { himmelsrichtung: true }, nordwinkel: 0 }));
    assert.deepEqual(g.weListe.map((w) => w.orientierung), a.weListe.map((w) => w.orientierung));
  });

  for (const [name, fp] of [["Fünfeck (Screenshot)", FUENFECK], ["Trapez", TRAPEZ], ["L-Form", L_FORM]]) {
    for (const typ of ["mittelflur", "laubengang", "spaenner", "mfh"]) {
      it(`${name}, ${typ}: keine Raumfläche außerhalb des Footprints, Rest ausgewiesen`, () => {
        const r = tesseliere(opts(fp, typ));
        assert.ok(r.weListe.length > 0, "Wohnungen vorhanden");
        assert.ok(anteilAussen(r, fp) < 0.002, `außerhalb ${(anteilAussen(r, fp) * 100).toFixed(2)} %`);
        assert.ok(r.form && r.form.belegt_m2 > 0 && r.form.fuellgrad > 0 && r.form.fuellgrad <= 1);
        const rest = r.form.rest.reduce((s, t) => s + flaeche(t), 0);
        assert.ok(Math.abs(rest + r.form.belegt_m2 - r.form.gesamt_m2) < 0.05, "Rest + belegt = Footprint");
        // 86-03: several bars report one [86-03] summary instead (plus touch notes "stößt an").
        if (r.form.rest_m2 > 0.5) assert.equal(r.hinweise.filter((h) => /\[86-0[13]\]/.test(h) && !/stößt an/.test(h)).length, 1, "genau ein Form-Hinweis");
      });
    }
  }

  it("Fünfeck: belegte Rechtecktiefe hält die Typologie-Grenzen (FORM_TIEFE)", () => {
    for (const typ of ["mittelflur", "laubengang"]) {
      const r = tesseliere(opts(FUENFECK, typ));
      const e = r.form.rechteck;
      const seiten = [Math.hypot(e[1].x - e[0].x, e[1].z - e[0].z), Math.hypot(e[2].x - e[1].x, e[2].z - e[1].z)];
      assert.ok(Math.min(...seiten) <= FORM_TIEFE[typ][1] + 1e-6, `${typ}: Tiefe ${Math.min(...seiten)}`);
    }
  });

  it("Türen bleiben gültig (Kante existiert, Tür passt auf die Kante)", () => {
    const r = tesseliere(opts(FUENFECK));
    for (const z of r.zonen) {
      for (const t of z.tueren || []) {
        const a = z.points[t.wand], b = z.points[(t.wand + 1) % z.points.length];
        assert.ok(a && b, `${z.name}: Kante ${t.wand}`);
        assert.ok(t.u_m + t.breite_m <= Math.hypot(b.x - a.x, b.z - a.z) + 1e-6, `${z.name}: Tür passt`);
      }
    }
  });

  it("rest_m2 enthält den Form-Rest aller Geschosse (Invariante Zonen + Rest = Footprint)", () => {
    const r = tesseliere(opts(TRAPEZ, "mittelflur"));
    const zonenFlaeche = r.zonen.filter((z) => z.raumart !== "balkon").reduce((s, z) => s + flaeche(z.points), 0);
    assert.ok(Math.abs(zonenFlaeche + r.rest_m2 - 2 * flaeche(TRAPEZ)) < 0.5, `${zonenFlaeche} + ${r.rest_m2} vs ${2 * flaeche(TRAPEZ)}`);
  });

  it("zu kleine/unbrauchbare Form bricht nicht ab", () => {
    const dreieck = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 0, z: 5 }];
    assert.doesNotThrow(() => tesseliere(opts(dreieck)));
  });
});
