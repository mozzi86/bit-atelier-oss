// Unit tests for scale / level of detail (Phase 75-05, MS-05).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoMassstab, lodFuer, roemisch, weGruppen, labelKollision, weLabelText } from "@designer/lib/massstab";

const R = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

describe("massstab — Auto-Wahl an den Grenzen (Blatt 01)", () => {
  it("149 m → 200, 150 m → 500, 400 m → 500, 401 m → 1000; Screenshot 55×60 → 200", () => {
    assert.equal(autoMassstab(149), 200);
    assert.equal(autoMassstab(150), 500);
    assert.equal(autoMassstab(400), 500);
    assert.equal(autoMassstab(401), 1000);
    assert.equal(autoMassstab(Math.hypot(55, 60)), 200);
    assert.equal(autoMassstab(NaN), 200);
  });
  it("LOD-Tabelle", () => {
    assert.deepEqual(lodFuer(500), { zonen: false, weLabel: false, raumnamen: false, balkenM: 50 });
    assert.deepEqual(lodFuer(200), { zonen: true, weLabel: true, raumnamen: false, balkenM: 20 });
    assert.deepEqual(lodFuer(50), { zonen: true, weLabel: true, raumnamen: true, balkenM: 5 });
    assert.equal(lodFuer(1000).balkenM, 100);
  });
  it("roemisch", () => {
    assert.equal(roemisch(5), "V"); assert.equal(roemisch(4), "IV"); assert.equal(roemisch(9), "IX"); assert.equal(roemisch(12), "XII");
  });
});

describe("massstab — weGruppen", () => {
  const zones = [
    { name: "Wohnen (1) ·WT", we: "1", points: R(0, 0, 5, 4) },
    { name: "Schlafen (1) ·WT", we: "1", points: R(5, 0, 8, 4) },
    { name: "Bad (1) ·WT", we: "1", points: R(8, 0, 10, 4) },
    { name: "Wohnen (2) ·WT", we: "2", points: R(0, 4, 6, 8) },
    { name: "Flur 0 ·WT", raumart: "flur", points: R(0, 8, 10, 9.5) },
    { name: "3-Zi 0-1 ·W", points: R(20, 0, 28, 6) },
  ];
  it("2 WT-WEs + 1 ·W-Zone + Flur unter null; Flächen summiert, Mitte flächengewichtet", () => {
    const g = weGruppen(zones);
    assert.deepEqual([...g.keys()].sort(), [null, "1", "2", "3-Zi 0-1"].sort());
    const we1 = g.get("1");
    assert.equal(we1.zonen.length, 3);
    assert.equal(we1.flaecheM2, 40);
    assert.equal(we1.typ, "wt");
    assert.ok(Math.abs(we1.mitte.x - 5) < 1e-9 && Math.abs(we1.mitte.z - 2) < 1e-9);
    assert.equal(g.get("3-Zi 0-1").typ, "w");
    assert.equal(g.get(null).zonen.length, 1);
  });
  it("Labeltext", () => {
    const g = weGruppen(zones);
    const t = (s) => s;
    assert.equal(weLabelText(g.get("1"), t), "WE 1 · 3 Räume · 40 m²");
    assert.equal(weLabelText(g.get("3-Zi 0-1"), t), "3-Zi 0-1 · 48 m²");
  });
});

describe("massstab — labelKollision", () => {
  it("drei Rechtecke, zwei überlappen → zwei sichtbar (Reihenfolge = Priorität)", () => {
    const r = [
      { x0: 0, y0: 0, x1: 100, y1: 14 },
      { x0: 50, y0: 5, x1: 150, y1: 19 }, // overlaps the first
      { x0: 200, y0: 0, x1: 300, y1: 14 },
    ];
    assert.deepEqual(labelKollision(r), [0, 2]);
  });
  it("Berührung zählt nicht als Überlappung", () => {
    assert.deepEqual(labelKollision([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 }]), [0, 1]);
  });
});

describe("massstab — weLabelZeilen (zweizeilig fuer den Plan)", () => {
  it("WT-Gruppe: [WE n, m²]; ·W-Gruppe: [Name, m²]", async () => {
    const { weGruppen: gr, weLabelZeilen } = await import("@designer/lib/massstab");
    const R = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
    const g = gr([{ name: "Wohnen (1) ·WT", we: "1", points: R(0, 0, 5, 4) }, { name: "3-Zi 0-1 ·W", points: R(20, 0, 28, 6) }]);
    const t = (s) => s;
    assert.deepEqual(weLabelZeilen(g.get("1"), t), ["WE 1", "20 m²"]);
    assert.deepEqual(weLabelZeilen(g.get("3-Zi 0-1"), t), ["3-Zi 0-1", "48 m²"]);
  });
});

describe("massstab — kurzRaumname (75-11 Task 4, MSB-12)", () => {
  it("nimmt den ·WT-Marker und das (WE …)-Suffix ab", async () => {
    const { kurzRaumname } = await import("@designer/lib/massstab");
    assert.equal(kurzRaumname("Wohnen/Essen (WE 0-3) ·WT"), "Wohnen/Essen");
    assert.equal(kurzRaumname("Schlafen 2 (WE 0-1) ·WT"), "Schlafen 2");
    assert.equal(kurzRaumname("Bad ·WT"), "Bad");
  });
  it("·W-Schnellmodus ebenso, Name ohne Marker bleibt unveraendert", async () => {
    const { kurzRaumname } = await import("@designer/lib/massstab");
    assert.equal(kurzRaumname("3-Zi 0-1 ·W"), "3-Zi 0-1");
    assert.equal(kurzRaumname("Treppenhaus"), "Treppenhaus");
  });
  it("leerer Rest ergibt NIE ein leeres Label (Originalname zurueck)", async () => {
    const { kurzRaumname } = await import("@designer/lib/massstab");
    assert.equal(kurzRaumname("(WE 0-1) ·WT"), "(WE 0-1) ·WT");
    assert.equal(kurzRaumname(""), "");
  });
});
