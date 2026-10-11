// Unit tests for plan 84-09 (packages/nova-designer/src/lib/tesselierung.js): the
// building corridor of Mittelflur/MFH never ends at the outer wall — a gable unit over
// the full building depth closes each corridor end, its entrance door sits on the
// corridor end; check "Gebäudeflur an Außenwand" (warn) when the building is too short.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  tesseliere, effektiveRegeln, gebaeudeflurAussenwand, tesselierungsChecks, erschliessungsSkelett, KOPFWOHNUNG,
} from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { flurEnden } from "@designer/lib/wohnungsErschliessung";
import { tuerGeometrie } from "@designer/lib/wohnungsErschliessung";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const ausdehnung = (zonen) => {
  const ps = zonen.flatMap((z) => z.points);
  return { x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)), z0: Math.min(...ps.map((p) => p.z)), z1: Math.max(...ps.map((p) => p.z)) };
};
const flaeche = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.z - q.x * p.z; }, 0)) / 2;

describe("84-09 — Kopfwohnung: Gebäudeflur endet nie an der Außenwand", () => {
  it("effektiveRegeln: kopfwohnung nur für Mittelflur/MFH im Raumzonen-Modus", () => {
    assert.equal(effektiveRegeln({}, { typ: "mittelflur", raumzonen: true }).kopfwohnung, true);
    assert.equal(effektiveRegeln({}, { typ: "mfh", raumzonen: true }).kopfwohnung, true);
    assert.equal(effektiveRegeln({ kopfwohnung: false }, { typ: "mfh", raumzonen: true }).kopfwohnung, true, "kein Schalter — gespeichertes false wird ignoriert");
    assert.equal(effektiveRegeln({}, { typ: "mittelflur", raumzonen: false }).kopfwohnung, undefined, "Band-Modus bleibt Phase 61");
    for (const typ of ["spaenner", "laubengang", "reihenhaus", "efh"]) {
      assert.equal(effektiveRegeln({}, { typ, raumzonen: true }).kopfwohnung, undefined, typ);
    }
  });

  for (const [titel, w, d, typ, n, E] of [
    ["Mittelflur 40 × 16 (Flur entlang x)", 40, 16, "mittelflur", 2, STD],
    ["Mittelflur 16 × 40 (Flur entlang z)", 16, 40, "mittelflur", 1, REF],
    ["MFH 70 × 16, 4 Geschosse (Treppenraum + Aufzug + Halle)", 70, 16, "mfh", 4, REF],
  ]) {
    it(`${titel}: Kopfwohnung je Flurende über die volle Gebäudetiefe, Eingang am Flurende`, () => {
      const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ, einheiten: E, raumzonen: true });
      const bb = { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
      assert.deepEqual(gebaeudeflurAussenwand(r.zonen, rect(w, d)), [], "kein Gebäudeflur an der Außenwand");
      const kopf = r.weListe.filter((x) => x.kopf);
      assert.equal(kopf.length, 2 * n, "zwei Kopfwohnungen je Geschoss");
      const entlangX = w >= d;
      for (const k of kopf) {
        const zonen = r.zonen.filter((z) => z.we === k.we && z.level === k.level && z.raumart !== "balkon");
        const a = ausdehnung(zonen);
        // Full building depth across the corridor, at one gable.
        if (entlangX) {
          assert.ok(Math.abs(a.z0 - bb.minZ) < 1e-6 && Math.abs(a.z1 - bb.maxZ) < 1e-6, `${k.we} über die volle Tiefe`);
          assert.ok(Math.abs(a.x0 - bb.minX) < 1e-6 || Math.abs(a.x1 - bb.maxX) < 1e-6, `${k.we} am Giebel`);
        } else {
          assert.ok(Math.abs(a.x0 - bb.minX) < 1e-6 && Math.abs(a.x1 - bb.maxX) < 1e-6, `${k.we} über die volle Tiefe`);
          assert.ok(Math.abs(a.z0 - bb.minZ) < 1e-6 || Math.abs(a.z1 - bb.maxZ) < 1e-6, `${k.we} am Giebel`);
        }
        const tiefe = entlangX ? a.x1 - a.x0 : a.z1 - a.z0;
        assert.ok(tiefe >= KOPFWOHNUNG.minTiefe_m - 1e-6 && tiefe <= KOPFWOHNUNG.maxTiefe_m + 1e-6, `Kopftiefe ${tiefe}`);
        // Entrance door: on the unit's inner edge, centred on the corridor axis, touching a corridor zone.
        const diele = zonen.find((z) => (z.tueren || []).some((t) => t.nach === null));
        assert.ok(diele, `${k.we} hat eine Wohnungstür`);
        const t = diele.tueren.find((q) => q.nach === null);
        const g = tuerGeometrie(diele, t);
        const mitte = { x: (g.scharnier.x + g.geschlossen.x) / 2, z: (g.scharnier.z + g.geschlossen.z) / 2 };
        const innen = entlangX ? (Math.abs(a.x0 - bb.minX) < 1e-6 ? a.x1 : a.x0) : (Math.abs(a.z0 - bb.minZ) < 1e-6 ? a.z1 : a.z0);
        assert.ok(Math.abs((entlangX ? mitte.x : mitte.z) - innen) < 1e-6, `${k.we}: Tür in der Innenkante`);
        assert.ok(Math.abs(entlangX ? mitte.z : mitte.x) < 0.5, `${k.we}: Tür auf der Flurachse`);
        const flur = r.zonen.filter((z) => z.we === undefined && z.raumart === "flur" && z.level === k.level && !z.eingang);
        const amFlur = flur.some((f) => { const e = ausdehnung([f]); return entlangX ? Math.abs(e.x0 - innen) < 1e-6 || Math.abs(e.x1 - innen) < 1e-6 : Math.abs(e.z0 - innen) < 1e-6 || Math.abs(e.z1 - innen) < 1e-6; });
        assert.ok(amFlur, `${k.we}: der Gebäudeflur endet an dieser Wohnungstür`);
        // Both ends of the T-shaped hall end on a door (84-06 inside the gable unit).
        const enden = flurEnden(r.zonen.filter((z) => z.level === k.level), { we: k.we });
        assert.ok(enden.length >= 2 && enden.every((e) => e.ok), `${k.we}: Flurenden ${JSON.stringify(enden)}`);
      }
      // Area balance: Σ zones (without balconies) + gaps = footprint × storeys. MFH is
      // skipped: the strip behind the stair enclosure belongs to no band (pre-existing
      // since 75-13, identical before/after 84-09 — BEFUNDE in 84-09-SUMMARY).
      if (typ === "mfh") return;
      const summe = r.zonen.filter((z) => z.raumart !== "balkon").reduce((s, z) => s + flaeche(z.points), 0);
      const luecken = r.rest_m2 - (r.restNachfrage_m2 || 0);
      assert.ok(Math.abs(summe + luecken - w * d * n) <= 0.05, `Bilanz ${summe} + ${luecken} ≠ ${w * d * n}`);
      assert.equal(r.hinweise.filter((h) => /84-09/.test(h)).length, 0);
    });
  }

  it("MFH: Treppenraum, Aufzug und Eingangshalle bleiben; Halle bleibt an der Fassade (kein Gebäudeflur-Warn)", () => {
    const r = tesseliere({ footprintM: rect(70, 16), storeys: 4, typ: "mfh", einheiten: STD, raumzonen: true });
    assert.equal(r.zonen.filter((z) => z.raumart === "treppenraum").length, 4);
    assert.equal(r.zonen.filter((z) => z.raumart === "aufzug").length, 4);
    assert.equal(r.zonen.filter((z) => z.eingang).length, 1);
    const c = tesselierungsChecks({ weListe: r.weListe, zonen: r.zonen, footprintM: rect(70, 16) }).find((x) => x.key === "gebaeudeflur");
    assert.equal(c.status, "pass");
  });

  it("zu kurzes Gebäude (MFH 20 × 14): keine Kopfwohnung, Hinweis + warn „Gebäudeflur an Außenwand“", () => {
    const r = tesseliere({ footprintM: rect(20, 14), storeys: 2, typ: "mfh", einheiten: STD, raumzonen: true });
    assert.equal(r.weListe.filter((x) => x.kopf).length, 0);
    assert.ok(r.hinweise.some((h) => /Kopfwohnung \[84-09\].*zu kurz.*Außenwand/.test(h)), "Hinweis mit Grund");
    const treffer = gebaeudeflurAussenwand(r.zonen, rect(20, 14));
    assert.equal(treffer.length, 2, "ein durchgehendes Flurstück je Geschoss, an beiden Giebeln");
    assert.ok(treffer.every((t) => Math.abs(t.laenge_m - 3.6) < 1e-6), "2 × 1,80 m Flurbreite an der Fassade");
    const c = tesselierungsChecks({ weListe: r.weListe, zonen: r.zonen, footprintM: rect(20, 14) }).find((x) => x.key === "gebaeudeflur");
    assert.equal(c.status, "warn", "warn, nicht fail (Energie, kein Bauordnungsverstoß)");
    assert.match(c.detail, /Wärme/);
  });

  it("Laubengang und Spänner: kein Gebäudeflur-Warn (Laubengang ist außen, Spänner hat keinen Flur)", () => {
    for (const typ of ["laubengang", "spaenner"]) {
      const r = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ, einheiten: STD, raumzonen: true });
      assert.deepEqual(gebaeudeflurAussenwand(r.zonen, rect(40, 16)), [], typ);
      assert.equal(r.weListe.filter((x) => x.kopf).length, 0, typ);
    }
  });

  it("Band-Modus und Skelett ohne kopfTiefe_m bleiben Phase 61 (Flur über die volle Länge)", () => {
    const s = erschliessungsSkelett({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur" });
    assert.equal(s.baender.length, 2);
    assert.ok(s.baender.every((b) => Math.abs(b.laenge - 40) < 1e-9));
    const r = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", einheiten: STD });
    assert.equal(r.weListe.filter((x) => x.kopf).length, 0);
    assert.equal(gebaeudeflurAussenwand(r.zonen, rect(40, 16)).length, 1, "Band-Modus: Flur an beiden Giebeln (ein Flurstück)");
  });

  it("Skelett mit kopfTiefe_m: Flur und Seitenbänder zwischen den Kopfbändern, Kopfbänder zuletzt", () => {
    const s = erschliessungsSkelett({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", kopfTiefe_m: 7 });
    assert.deepEqual(s.baender.map((b) => b.seite), ["sued", "nord", "kopf0", "kopf1"]);
    const f = ausdehnung(s.flure);
    assert.equal(f.x0, -13); assert.equal(f.x1, 13);
    const k0 = s.baender[2];
    assert.equal(k0.achse, "z"); assert.equal(k0.tiefe, 7); assert.equal(k0.laenge, 16); assert.equal(k0.zKante, -20); assert.equal(k0.eingangMitte, 0);
    assert.deepEqual(s.kopf, { tiefe_m: 7, grund: null });
  });

  it("Kopfwohnung wählt den größten Typ, eine manuelle Bandreihenfolge gewinnt", () => {
    const r = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true });
    const groesster = STD.reduce((m, e) => (e.flaeche_m2 > m.flaeche_m2 ? e : m), STD[0]);
    assert.ok(r.weListe.filter((x) => x.kopf).every((k) => k.typKey === groesster.key));
    // Gable bands are the last band indices (2, 3) of the storey.
    const kleinster = STD.reduce((m, e) => (e.flaeche_m2 < m.flaeche_m2 ? e : m), STD[0]);
    const r2 = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true, anordnung: { "L0-B2": [kleinster.key] } });
    const k = r2.weListe.filter((x) => x.kopf);
    assert.equal(k.find((x) => x.band === 2).typKey, kleinster.key);
    assert.equal(k.find((x) => x.band === 3).typKey, groesster.key);
  });
});
