// Unit-Tests für packages/nova-designer/src/lib/raumOeffnungen.js (Phase 43, MOEBEL-03).
//
// Kulisse: Default-Footprint 20 × 14 m (createBuildingModel), Kante 0 läuft von (−10,−7) nach
// (10,−7) — darauf liegen die Auto-Fenster (je ~3,5 m eines) und die Eingangstür (u = 0,5 · 20).
// Eine 6 × 4-m-Zone an dieser Kante muss die dort liegenden Öffnungen finden, eine Zone in der
// Gebäudemitte keine. Erwartungswerte aus autoOpenings.js (AUTO_WINDOW, ENTRANCE_DEFAULT) und
// buildingModel.js (Öffnungsbreiten) abgeleitet.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createBuildingModel } from "@core/lib/buildingModel";
import { autoWindowUVs } from "@designer/lib/autoOpenings";
import {
  OEFFNUNG_TOLERANZ_M,
  abstandPunktStrecke,
  abstandZuPolygonkante,
  segmentAufWand,
  oeffnungenAmRaum,
} from "@designer/lib/raumOeffnungen";

const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
const kante0 = model.walls.find((w) => w.level === 0 && w.edge === 0); // (−10,−7) → (10,−7)

// Zone bündig an Kante 0, x von −8 bis −2 (6 m), z von −7 bis −3 (4 m).
const ZONE_KANTE0 = { level: 0, name: "Wohnen", points: [{ x: -8, z: -7 }, { x: -2, z: -7 }, { x: -2, z: -3 }, { x: -8, z: -3 }] };
// Zone mitten im Haus, berührt keine Hüllwand.
const ZONE_MITTE = { level: 0, name: "Flur", points: [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }] };

describe("raumOeffnungen — Geometrie-Helfer", () => {
  it("Punkt-Strecke-Abstand: senkrecht, jenseits der Enden, entartete Strecke", () => {
    const a = { x: 0, z: 0 }, b = { x: 4, z: 0 };
    assert.equal(abstandPunktStrecke({ x: 2, z: 3 }, a, b), 3);
    assert.equal(abstandPunktStrecke({ x: -3, z: 0 }, a, b), 3);
    assert.equal(abstandPunktStrecke({ x: 7, z: 4 }, a, b), 5);
    assert.equal(abstandPunktStrecke({ x: 3, z: 4 }, a, a), 5);
  });

  it("Abstand zur nächsten Polygonkante; Infinity bei entartetem Polygon", () => {
    assert.ok(Math.abs(abstandZuPolygonkante({ x: -5, z: -7.3 }, ZONE_KANTE0.points) - 0.3) < 1e-9);
    assert.equal(abstandZuPolygonkante({ x: 0, z: 0 }, ZONE_MITTE.points), 2);
    assert.equal(abstandZuPolygonkante({ x: 0, z: 0 }, [{ x: 1, z: 1 }]), Infinity);
    assert.equal(abstandZuPolygonkante({ x: 0, z: 0 }, null), Infinity);
  });

  it("segmentAufWand: 1,0 m breit bei u = 5 auf Kante 0 → x von −5,5 bis −4,5, z = −7", () => {
    const s = segmentAufWand(kante0, 5, 1.0);
    assert.deepEqual([s.a.x, s.b.x, s.a.z, s.b.z].map((v) => Math.round(v * 1000) / 1000), [-5.5, -4.5, -7, -7]);
  });

  it("Toleranz ist 0,45 m (halbe Hüllwand + 0,30 Spiel, [ASSUMED])", () => {
    assert.equal(OEFFNUNG_TOLERANZ_M, 0.45);
  });
});

describe("oeffnungenAmRaum — Hülle", () => {
  const ctx = { walls: model.walls, envOpenings: [], entranceCfg: null, customWalls: [], customWindows: [] };

  it("findet die Auto-Fenster der berührten Kante und die Eingangstür (u = 10 liegt im Zonenbereich?)", () => {
    const res = oeffnungenAmRaum(ZONE_KANTE0, ctx);
    // Auto-Fenster auf Kante 0 (20 m, 5 Stück bei u = 2, 6, 10, 14, 18) — die Tür bei u = 10 verdrängt das dritte.
    const us = autoWindowUVs(kante0).map((o) => o.u);
    assert.deepEqual(us, [2, 6, 10, 14, 18]);
    // Zone x ∈ [−8, −2] ⇔ u ∈ [2, 8]: Fenster bei u = 2 (x = −8) und u = 6 (x = −4) liegen an der Zonenkante.
    const fenster = res.filter((o) => o.kind === "window");
    assert.equal(fenster.length, 2, JSON.stringify(res));
    assert.ok(fenster.every((o) => o.quelle === "huelle" && Math.abs(o.a.z + 7) < 1e-9));
    // Die Eingangstür (u = 10 → x = 0) liegt 2 m neben der Zone → nicht dabei.
    assert.equal(res.filter((o) => o.kind === "door").length, 0);
  });

  it("Zone um die Eingangstür bekommt die Tür (kind door, Breite 1,2) und kein Fenster an derselben Stelle", () => {
    const zone = { level: 0, name: "Windfang", points: [{ x: -1.5, z: -7 }, { x: 1.5, z: -7 }, { x: 1.5, z: -4 }, { x: -1.5, z: -4 }] };
    const res = oeffnungenAmRaum(zone, ctx);
    const tueren = res.filter((o) => o.kind === "door");
    assert.equal(tueren.length, 1);
    assert.equal(tueren[0].width, 1.2);
    assert.equal(res.filter((o) => o.kind === "window").length, 0, "Auto-Fenster bei u = 10 muss der Tür weichen");
  });

  it("Zone ohne Hüllkontakt: keine Öffnungen", () => {
    assert.deepEqual(oeffnungenAmRaum(ZONE_MITTE, ctx), []);
  });

  it("platzierte Hüll-Öffnung (envOpenings) mit Typbreite, im richtigen Geschoss", () => {
    const res = oeffnungenAmRaum(
      { ...ZONE_KANTE0, level: 1 },
      { ...ctx, envOpenings: [{ level: 1, edge: 0, u: 4, kind: "window", typeId: "double" }, { level: 0, edge: 0, u: 4, kind: "door", typeId: "single" }] },
    );
    const platziert = res.filter((o) => Math.abs((o.a.x + o.b.x) / 2 + 6) < 1e-9);
    assert.equal(platziert.length, 1);
    assert.equal(platziert[0].width, 1.8); // WINDOW_TYPES double
    assert.equal(platziert[0].kind, "window");
    assert.equal(res.filter((o) => o.kind === "door").length, 0, "EG-Tür gehört nicht ins 1. OG");
  });

  it("entranceCfg wird respektiert (Tür aus, Tür auf anderer Kante)", () => {
    const zone = { level: 0, name: "Windfang", points: [{ x: -1.5, z: -7 }, { x: 1.5, z: -7 }, { x: 1.5, z: -4 }, { x: -1.5, z: -4 }] };
    assert.equal(oeffnungenAmRaum(zone, { ...ctx, entranceCfg: { enabled: false } }).filter((o) => o.kind === "door").length, 0);
    assert.equal(oeffnungenAmRaum(zone, { ...ctx, entranceCfg: { edge: 2 } }).filter((o) => o.kind === "door").length, 0);
  });
});

describe("oeffnungenAmRaum — Innenwände", () => {
  it("Fenster/Tür auf einer Custom-Wand über wallIdx → _idx, nur im Geschoss der Zone", () => {
    const wand = { _idx: 7, level: 0, a: { x: -2, z: -7 }, b: { x: -2, z: -3 } }; // rechte Zonenkante
    const ctx = {
      walls: [], envOpenings: [], entranceCfg: null,
      customWalls: [wand, { ...wand, _idx: 8, level: 1 }],
      customWindows: [
        { wallIdx: 7, u: 2, kind: "door", typeId: "single" },
        { wallIdx: 8, u: 2, kind: "window", typeId: "single" },
        { wallIdx: 99, u: 1, kind: "window", typeId: "single" },
      ],
    };
    const res = oeffnungenAmRaum(ZONE_KANTE0, ctx);
    assert.equal(res.length, 1, JSON.stringify(res));
    assert.equal(res[0].kind, "door");
    assert.equal(res[0].quelle, "innen");
    assert.equal(res[0].width, 1.0);
    assert.deepEqual([res[0].a.z, res[0].b.z], [-5.5, -4.5]);
  });

  it("leerer Kontext / kaputte Zone → []", () => {
    assert.deepEqual(oeffnungenAmRaum(ZONE_KANTE0), []);
    assert.deepEqual(oeffnungenAmRaum(ZONE_KANTE0, {}), []);
    assert.deepEqual(oeffnungenAmRaum(null, { walls: model.walls }), []);
    assert.deepEqual(oeffnungenAmRaum({ points: [{ x: 0, z: 0 }] }, { walls: model.walls }), []);
  });
});
