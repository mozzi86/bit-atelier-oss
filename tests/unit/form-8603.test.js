// Unit tests for 86-03 (bar network): several bars fill a non-rectangular footprint, every bar
// is a house of its own, the results are merged with unique unit numbers per storey; inputs
// (level switch, door swing, arrangement) reach the right unit in bar k; the spacing rule
// holds; rectangles and rotated rectangles stay as before (one bar).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { groesstesRechteck, punktImPolygon, schwerpunkt, inLokal, flaeche } from "@designer/lib/formGeometrie";
import {
  tesseliere, riegelZerlegung, riegelAbstand, riegelAbstandVerletzt, stufeSchluessel, FORM_RIEGEL,
} from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
// Pentagon of the user's screenshot (13,5 px/m), centred — same shape as form-8601.test.js.
const FUENFECK = (() => {
  const px = [[596, 688], [736, 204], [1099, 104], [1433, 261], [1268, 550]];
  const p = px.map(([x, y]) => ({ x: x / 13.5, z: -y / 13.5 }));
  const c = schwerpunkt(p);
  return p.map((q) => ({ x: q.x - c.x, z: q.z - c.z }));
})();
const L_FORM = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const L_LANG = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 72 }, { x: 0, z: 72 }]; // long wing: bar 2 = 32 m, several types per band
const U_FORM = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 44, z: 40 }, { x: 44, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const opts = (fp, typ = "mittelflur", extra = {}) => ({ footprintM: fp, storeys: 4, typ, einheiten: STD, raumzonen: true, ...extra });

/** Share of room area outside the footprint (0,5 m grid sampling), 0…1. */
const anteilAussen = (r, fp) => {
  let alle = 0, aussen = 0;
  for (const z of r.zonen.filter((q) => q.we && q.art)) {
    const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
    for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) {
      for (let y = Math.min(...zs) + 0.25; y < Math.max(...zs); y += 0.5) {
        if (!punktImPolygon(z.points, x, y)) continue;
        alle += 1; if (!punktImPolygon(fp, x, y)) aussen += 1;
      }
    }
  }
  return alle ? aussen / alle : 0;
};
/** Bars of a result as axis-parallel rectangles in the decomposition's common frame. */
const riegelImRahmen = (fp, typ) => {
  const z = riegelZerlegung(fp, typ, { geschosse: 4, geschosshoehe_m: 3 });
  const r = tesseliere(opts(fp, typ));
  return {
    abstand: z.abstand_m,
    rechtecke: r.form.riegel.map((q) => {
      const lok = q.rechteck.map((p) => inLokal(p, z.basis));
      const xs = lok.map((p) => p.x), zs = lok.map((p) => p.z);
      return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    }),
  };
};

describe("86-03 — Geometrie: Ausschluss im größten Rechteck", () => {
  const Q = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }];
  it("ein Ausschluss unten → Rechteck darüber, anstoßend", () => {
    const r = groesstesRechteck(Q, { tiefeMin: 4, tiefeMax: 10, ausschluss: [{ x0: 0, x1: 20, z0: 0, z1: 10 }] });
    assert.ok(r);
    assert.ok(r.z0 >= 10 - 1e-9, `z0 ${r.z0}`);
    assert.ok(Math.abs(r.flaeche - 200) < 1e-6, `Fläche ${r.flaeche}`);
  });
  it("ein Ausschluss oben → Rechteck endet genau darunter", () => {
    const r = groesstesRechteck(Q, { tiefeMin: 4, tiefeMax: 13, ausschluss: [{ x0: 0, x1: 20, z0: 13, z1: 20 }] });
    assert.ok(r && Math.abs(r.z1 - 13) < 1e-9 && Math.abs(r.z0) < 1e-9, JSON.stringify(r));
  });
  it("seitlicher Ausschluss halbiert den Streifen", () => {
    const r = groesstesRechteck(Q, { tiefeMin: 20, tiefeMax: 20, ausschluss: [{ x0: 8, x1: 12, z0: 0, z1: 20 }] });
    assert.ok(r && Math.abs(r.x1 - r.x0 - 8) < 1e-9, JSON.stringify(r));
  });
  it("laengerAlsTief verwirft Rechtecke, die tiefer als lang sind", () => {
    const S = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 30 }, { x: 0, z: 30 }];
    assert.equal(groesstesRechteck(S, { tiefeMin: 11, tiefeMax: 17, laengerAlsTief: true }), null);
    assert.ok(groesstesRechteck(S, { tiefeMin: 11, tiefeMax: 17 }));
  });
});

describe("86-03 — Abstandsregel", () => {
  it("2 × max(3 m; 0,4 H)", () => {
    assert.equal(riegelAbstand(1, 3), 6);
    assert.ok(Math.abs(riegelAbstand(4, 3) - 9.6) < 1e-9);
  });
  it("Längsseite gegen Längsseite braucht den Abstand, Giebel darf anstoßen", () => {
    const a = { x0: 0, x1: 40, z0: 0, z1: 15 };
    assert.equal(riegelAbstandVerletzt(a, { x0: 0, x1: 40, z0: 20, z1: 35 }, 9.6), true, "5 m zwischen Längsseiten");
    assert.equal(riegelAbstandVerletzt(a, { x0: 0, x1: 40, z0: 24.6, z1: 39.6 }, 9.6), false, "9,6 m");
    assert.equal(riegelAbstandVerletzt(a, { x0: 0, x1: 15, z0: 15, z1: 40 }, 9.6), false, "L-Ecke: Giebel an Längsseite");
    assert.equal(riegelAbstandVerletzt(a, { x0: 40, x1: 80, z0: 0, z1: 15 }, 9.6), false, "Giebel an Giebel");
    assert.equal(riegelAbstandVerletzt(a, { x0: 30, x1: 70, z0: 10, z1: 25 }, 9.6), true, "Überlappung");
  });
});

describe("86-03 — Riegel-Netz in tesseliere", () => {
  it("L-Form: zwei Riegel, beide Flügel belegt, ≥ 90 %, nichts außerhalb", () => {
    for (const typ of ["mittelflur", "mfh", "spaenner"]) {
      const r = tesseliere(opts(L_FORM, typ));
      assert.equal(r.form.riegel.length, 2, typ);
      assert.ok(r.form.fuellgrad >= 0.9, `${typ}: ${r.form.fuellgrad}`);
      assert.ok(anteilAussen(r, L_FORM) < 0.002, typ);
      assert.ok(r.zonen.some((z) => z.we && z.points.every((p) => p.z > 16 - 1e-6)), `${typ}: Flügel z > 16 belegt`);
    }
  });

  it("U-Form: beide Schenkel belegt, ≥ 90 %", () => {
    const r = tesseliere(opts(U_FORM));
    assert.equal(r.form.riegel.length, 3);
    assert.ok(r.form.fuellgrad >= 0.9, String(r.form.fuellgrad));
    const imSchenkel = (x0, x1) => r.zonen.some((z) => z.we && z.points.every((p) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.z > 16 - 1e-6));
    assert.ok(imSchenkel(0, 16) && imSchenkel(44, 60), "beide Schenkel");
    assert.ok(anteilAussen(r, U_FORM) < 0.002);
  });

  it("Fünfeck: Füllgrad deutlich über 86-01 (47 %), nichts außerhalb", () => {
    for (const typ of ["mittelflur", "mfh", "laubengang", "spaenner"]) {
      const r = tesseliere(opts(FUENFECK, typ));
      assert.ok(r.form.riegel.length >= 2, typ);
      assert.ok(r.form.fuellgrad >= 0.6, `${typ}: ${r.form.fuellgrad}`);
      assert.ok(anteilAussen(r, FUENFECK) < 0.002, typ);
    }
  });

  it("Abstandsregel zwischen allen Riegeln eingehalten, Riegel in der Form", () => {
    for (const [fp, typ] of [[FUENFECK, "mittelflur"], [FUENFECK, "laubengang"], [L_FORM, "mfh"], [U_FORM, "mittelflur"]]) {
      const { abstand, rechtecke } = riegelImRahmen(fp, typ);
      for (let i = 0; i < rechtecke.length; i++) {
        for (let j = i + 1; j < rechtecke.length; j++) {
          assert.equal(riegelAbstandVerletzt(rechtecke[i], rechtecke[j], abstand), false, `${typ} Riegel ${i + 1}/${j + 1}`);
        }
      }
      assert.ok(rechtecke.length <= FORM_RIEGEL.max);
    }
  });

  it("Rest + belegt = Footprint, Restpolygone ohne Überlappung mit Riegeln", () => {
    for (const fp of [FUENFECK, L_FORM, U_FORM]) {
      const r = tesseliere(opts(fp));
      const rest = r.form.rest.reduce((s, t) => s + flaeche(t), 0);
      assert.ok(Math.abs(rest + r.form.belegt_m2 - r.form.gesamt_m2) < 0.05, `${rest} + ${r.form.belegt_m2} ≠ ${r.form.gesamt_m2}`);
    }
  });

  it("WE-IDs und Zonennamen je Geschoss eindeutig, jede Tür zeigt auf eine vorhandene Zone", () => {
    for (const [fp, typ] of [[FUENFECK, "mittelflur"], [U_FORM, "mfh"], [L_FORM, "laubengang"], [L_FORM, "reihenhaus"]]) {
      const r = tesseliere(opts(fp, typ));
      const ids = r.weListe.map((w) => `${w.level}|${w.we}`);
      assert.equal(new Set(ids).size, ids.length, `${typ}: WE doppelt`);
      const namen = new Set();
      for (const z of r.zonen) {
        const k = `${z.level}|${z.name}`;
        assert.ok(!namen.has(k), `${typ}: Name doppelt ${k}`);
        namen.add(k);
      }
      for (const z of r.zonen) for (const t of z.tueren || []) if (t.nach) assert.ok(namen.has(`${z.level}|${t.nach}`), `${typ}: ${z.name} → ${t.nach}`);
      // Every unit of the list has zones under its id, every boundary neighbour exists.
      const weMitZone = new Set(r.zonen.filter((z) => z.we).map((z) => z.we));
      for (const w of r.weListe) assert.ok(weMitZone.has(w.we), `${typ}: ${w.we} ohne Zone`);
      const weIds = new Set(r.weListe.map((w) => w.we));
      for (const g of r.grenzen) for (const n of [g.we_links, g.we_rechts]) if (n) assert.ok(weIds.has(n), `${typ}: Grenze ${g.id} → ${n}`);
      const gIds = r.grenzen.map((g) => g.id);
      assert.equal(new Set(gIds).size, gIds.length, `${typ}: Grenz-ID doppelt`);
    }
  });

  it("WE-Nummern laufen je Geschoss über die Riegel weiter (Riegel 2 beginnt nach Riegel 1)", () => {
    const r = tesseliere(opts(L_FORM));
    const n = (w) => Number(/-(\d+)$/.exec(w.we)[1]);
    const r1 = r.weListe.filter((w) => w.level === 0 && w.riegel === 1).map(n);
    const r2 = r.weListe.filter((w) => w.level === 0 && w.riegel === 2).map(n);
    assert.ok(r1.length && r2.length);
    assert.equal(Math.min(...r2), Math.max(...r1) + 1);
    assert.ok(r.weListe.filter((w) => w.riegel === 2).every((w) => w.band >= FORM_RIEGEL.bandVersatz));
  });

  it("R per Schalter trifft in Riegel 2 genau die gewählte Wohnung", () => {
    const basis = tesseliere(opts(L_FORM));
    const ziel = basis.weListe.find((w) => w.riegel === 2 && w.level === 1);
    assert.ok(ziel, "WE in Riegel 2");
    const key = stufeSchluessel(basis.weListe).get(ziel.we);
    const r = tesseliere(opts(L_FORM, "mittelflur", { stufeJeWe: { [key]: "R" } }));
    const rWe = r.weListe.filter((w) => w.stufe === "R").map((w) => w.we);
    assert.deepEqual(rWe, [ziel.we]);
    assert.equal(stufeSchluessel(r.weListe).get(ziel.we), key, "Schlüssel bleibt stabil");
  });

  it("Türaufschlag einer Zone in Riegel 2 wirkt dort (Schlüssel mit globaler WE-Nummer)", () => {
    const basis = tesseliere(opts(L_FORM));
    const we2 = new Set(basis.weListe.filter((w) => w.riegel === 2).map((w) => w.we));
    const zone = basis.zonen.find((z) => we2.has(z.we) && (z.tueren || []).some((t) => t.aufschlag === "links"));
    assert.ok(zone, "Zone mit Tür in Riegel 2");
    const idx = zone.tueren.findIndex((t) => t.aufschlag === "links");
    const r = tesseliere(opts(L_FORM, "mittelflur", { tuerAufschlaege: { [`${zone.level}|${zone.name}|${idx}`]: "rechts" } }));
    const neu = r.zonen.find((z) => z.level === zone.level && z.name === zone.name);
    assert.equal(neu.tueren[idx].aufschlag, "rechts");
    // The same key leaves bar 1 alone.
    const vorher = basis.zonen.filter((z) => !we2.has(z.we)).map((z) => (z.tueren || []).map((t) => t.aufschlag).join());
    const nachher = r.zonen.filter((z) => !we2.has(z.we)).map((z) => (z.tueren || []).map((t) => t.aufschlag).join());
    assert.deepEqual(nachher, vorher);
  });

  it("Anordnung eines Bandes in Riegel 2 (Schlüssel L<l>-B1xx) ändert nur dieses Band", () => {
    const basis = tesseliere(opts(L_LANG));
    const typenIm = (x0) => basis.weListe.filter((x) => x.level === x0.level && x.band === x0.band).map((x) => x.typKey);
    const w = basis.weListe.find((x) => x.riegel === 2 && new Set(typenIm(x)).size > 1);
    assert.ok(w, "Band in Riegel 2 mit mehreren Typen");
    const bandKey = `L${w.level}-B${w.band}`;
    const typen = typenIm(w);
    const neuOrdnung = [...new Set(typen)].reverse();
    const r = tesseliere(opts(L_LANG, "mittelflur", { anordnung: { [bandKey]: neuOrdnung } }));
    const typenNeu = r.weListe.filter((x) => x.level === w.level && x.band === w.band).map((x) => x.typKey);
    assert.equal(typenNeu[0], neuOrdnung[0]);
    const r1 = (e) => e.weListe.filter((x) => x.riegel === 1).map((x) => `${x.we}|${x.typKey}`);
    assert.deepEqual(r1(r), r1(basis), "Riegel 1 unverändert");
  });

  it("Rechteck und gedrehtes Rechteck: ein Riegel, kein form.riegel", () => {
    assert.equal(tesseliere(opts(rect(40, 16))).form, undefined);
    const g = rect(40, 16).map((p) => ({ x: Math.cos(0.4) * p.x - Math.sin(0.4) * p.z, z: Math.sin(0.4) * p.x + Math.cos(0.4) * p.z }));
    const r = tesseliere(opts(g));
    assert.equal(r.form.riegel, undefined);
    assert.equal(r.form.rechteckForm, true);
  });

  it("EFH bleibt ein Haus (keine Zerlegung)", () => {
    const r = tesseliere(opts(L_FORM, "efh", { storeys: 2, einheiten: STD.slice(0, 1) }));
    assert.equal(r.form?.riegel, undefined);
  });

  it("deterministisch: zweimal gleiches Ergebnis", () => {
    assert.deepEqual(tesseliere(opts(FUENFECK)), tesseliere(opts(FUENFECK)));
  });
});
