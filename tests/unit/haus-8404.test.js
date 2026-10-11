// Unit tests for plan 84-04 (packages/nova-designer/src/lib/tesselierung.js): houses —
// Reihenhaus and EFH get rooms on every storey, a stair at the same place on every
// storey (open to the hall), the house door on the ground floor at the street side.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, hausGeschossProgramm, TREPPE_HAUS, REIHENHAUS_MIN_BREITE_M } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { pruefeWohnung, badBewegung } from "@designer/lib/raumQualitaet";
import { tuerGeometrie } from "@designer/lib/wohnungsErschliessung";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const bb = (z) => { const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z); return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; };

/** Checks shared by every house case. */
function pruefeHaus(r, n, { street, garden }) {
  for (const wl of r.weListe) {
    const treppen = [];
    for (let l = 0; l < n; l++) {
      const zl = r.zonen.filter((z) => z.we === wl.we && z.level === l);
      assert.ok(zl.some((z) => z.fensterpflicht), `${wl.we} L${l}: Raum mit Fenster`);
      const eing = zl.flatMap((z) => (z.tueren || []).filter((t) => t.nach === null).map((t) => ({ z, t })));
      if (l === 0) {
        assert.equal(eing.length, 1, `${wl.we}: genau ein Hauseingang`);
        assert.equal(eing[0].t.typ, "hauseingang");
        const g = tuerGeometrie(eing[0].z, eing[0].t);
        assert.ok(street(g.scharnier) && street(g.geschlossen), `${wl.we}: Haustür an der Straßenseite`);
        assert.ok(zl.some((z) => /Wohnen/.test(z.name) && garden(z)), `${wl.we}: Wohnen zum Garten`);
      } else {
        assert.equal(eing.length, 0, `${wl.we} L${l}: keine Eingangstür im OG`);
      }
      const t = zl.find((z) => z.art === "treppe");
      if (n > 1) { assert.ok(t, `${wl.we} L${l}: Treppe`); treppen.push(JSON.stringify(bb(t))); assert.equal(t.raumart, "flur"); }
      else assert.ok(!t, "eingeschossig ohne Treppe");
      const q = pruefeWohnung(r.zonen.filter((z) => z.level === l), { we: wl.we, regeln: { wohnungsgrundriss: true } });
      const fails = q.eintraege.filter((e) => e.stufe === "fail" && ["erschliessung", "diele", "flurende"].includes(e.regel));
      assert.deepEqual(fails.map((e) => `${e.regel}:${e.raum}`), [], `${wl.we} L${l}`);
    }
    if (n > 1) assert.equal(new Set(treppen).size, 1, `${wl.we}: Treppe auf jedem Geschoss an derselben Stelle`);
  }
  for (const b of r.zonen.filter((z) => z.art === "sanitaer")) assert.equal(badBewegung(b).stufe, "ok", b.name);
}

describe("84-04 — Reihenhaus / EFH: Räume, Treppe und Türen je Geschoss", () => {
  it("hausGeschossProgramm: EG Wohnen/Küche/Gäste-WC, OG Schlafräume + Bad, Treppe überall; eingeschossig unverändert", () => {
    const p = STD.find((t) => t.key === "st-3zi").raumprogramm;
    assert.deepEqual(hausGeschossProgramm(p, 0, 1), p.filter((r) => r && r.raum));
    const eg = hausGeschossProgramm(p, 0, 2).map((r) => r.raum);
    const og = hausGeschossProgramm(p, 1, 2).map((r) => r.raum);
    assert.ok(eg.includes("Wohnen/Essen") && eg.includes("Küche") && eg.includes("Gäste-WC") && eg.includes("Treppe"));
    assert.ok(og.includes("Schlafen") && og.includes("Kind/Büro") && og.includes("Bad") && og.includes("Treppe"));
    assert.ok(!og.includes("Wohnen/Essen") && !eg.includes("Schlafen"));
    // Three storeys: sleeping rooms split, the second upper floor gets a shower room.
    const og2 = hausGeschossProgramm(p, 2, 3).map((r) => r.raum);
    assert.ok(og2.includes("Duschbad") && og2.some((r) => /Kind|Schlafen/.test(r)));
    // A floor without a window room gets one.
    const eins = STD.find((t) => t.key === "st-1zi").raumprogramm;
    assert.ok(hausGeschossProgramm(eins, 1, 2).some((r) => r.raum === "Zimmer" && r.fensterpflicht));
    assert.equal(hausGeschossProgramm(p, 1, 2).find((r) => r.art === "treppe").flaeche_m2, TREPPE_HAUS.breite_m * TREPPE_HAUS.tiefe_m);
  });

  for (const [titel, w, d, n, E] of [
    ["Reihenhaus 36 × 10, 2 G., Referenz", 36, 10, 2, REF],
    ["Reihenhaus 48 × 11, 3 G., Referenz", 48, 11, 3, REF],
  ]) {
    it(`${titel}: Räume + Türen je Geschoss, Treppe deckungsgleich, Haustür zur Straße`, () => {
      const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ: "reihenhaus", einheiten: E, raumzonen: true });
      // 85 (Band füllen): the row is filled with houses ≥ REIHENHAUS_MIN_BREITE_M.
      assert.ok(r.weListe.length >= 5, String(r.weListe.length));
      pruefeHaus(r, n, { street: (p) => Math.abs(p.z + d / 2) < 0.02, garden: (z) => Math.abs(bb(z).z1 - d / 2) < 0.02 });
    });
  }

  for (const [titel, w, d, n, typKey] of [
    ["EFH 12 × 10, 2 G. (3-Zi)", 12, 10, 2, "st-3zi"],
    ["EFH 10 × 14, 3 G. (2-Zi, Lauf entlang z)", 10, 14, 3, "st-2zi"],
    ["EFH 12 × 10, 1 G. (Bungalow)", 12, 10, 1, "st-3zi"],
  ]) {
    it(`${titel}: Raumaufteilung statt einer Zone je Geschoss`, () => {
      const E = [STD.find((t) => t.key === typKey)];
      const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ: "efh", einheiten: E, raumzonen: true });
      assert.equal(r.weListe.length, 1);
      for (let l = 0; l < n; l++) assert.ok(r.zonen.filter((z) => z.level === l).length > 3, `L${l}: Räume`);
      const lx = w >= d;
      pruefeHaus(r, n, {
        street: (p) => (lx ? Math.abs(p.z + d / 2) < 0.02 : Math.abs(p.x + w / 2) < 0.02),
        garden: (z) => (lx ? Math.abs(bb(z).z1 - d / 2) < 0.02 : Math.abs(bb(z).x1 - w / 2) < 0.02),
      });
    });
  }

  it("84-05: Reihenhaus mindestens REIHENHAUS_MIN_BREITE_M breit — auch der 1-Zi-Typ bekommt Treppe, Bad und Türen", () => {
    const r = tesseliere({ footprintM: rect(36, 10), storeys: 2, typ: "reihenhaus", einheiten: STD, raumzonen: true });
    assert.ok(r.weListe.every((w) => w.fassadeLaenge_m >= REIHENHAUS_MIN_BREITE_M - 1e-9), r.weListe.map((w) => w.fassadeLaenge_m).join("/"));
    pruefeHaus(r, 2, { street: (p) => Math.abs(p.z + 5) < 0.02, garden: (z) => Math.abs(bb(z).z1 - 5) < 0.02 });
    // Band mode keeps area / depth (Phase 61).
    const band = tesseliere({ footprintM: rect(36, 10), storeys: 2, typ: "reihenhaus", einheiten: STD });
    assert.ok(band.weListe.some((w) => w.fassadeLaenge_m < REIHENHAUS_MIN_BREITE_M));
  });

  it("Band-Modus bleibt Phase 61 (eine Zone je WE und Geschoss, keine Treppe)", () => {
    const r = tesseliere({ footprintM: rect(36, 10), storeys: 2, typ: "reihenhaus", einheiten: STD });
    assert.equal(r.zonen.filter((z) => z.art === "treppe").length, 0);
    assert.equal(r.zonen.length, 6);
    const e = tesseliere({ footprintM: rect(12, 10), storeys: 2, typ: "efh", einheiten: [STD[2]] });
    assert.equal(e.zonen.length, 2);
  });
});
