// Unit tests for 73-08 (BEST-10/11): four pots from the seeded survey state (hand sums), the unknown pot is
// not spread, plain-text distribution, and the "mostly assumed" share per filter position.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bestandsToepfe, vermutetAnteil } from "@ava/lib/bestandsMengen";
import { bimSnapshots } from "../../packages/nova-core/server/seed-data.js";

const W = bimSnapshots[0].elemente.filter((e) => e.ifc_klasse === "IfcWall");
const topf = (t, k) => t.find((x) => x.key === k);

describe("73-08 Mengentöpfe", () => {
  it("hand sums of the seed walls (m²): Rückbau 36+300, Bestand 120+110+90+64, Neu 48, Unbekannt 22", () => {
    const t = bestandsToepfe(W, "area");
    assert.deepEqual(t.map((x) => x.key), ["rueckbau", "bestand", "neu", "unbekannt"]);
    assert.equal(topf(t, "rueckbau").menge, 336);
    assert.deepEqual([topf(t, "rueckbau").verteilung.gemessen, topf(t, "rueckbau").verteilung.angenommen], [36, 300]);
    assert.equal(topf(t, "bestand").menge, 384);
    assert.equal(topf(t, "neu").menge, 48);
    assert.equal(topf(t, "unbekannt").menge, 22, "unknown is shown, not spread");
    assert.equal(t.reduce((s, x) => s + x.menge, 0), 790, "nothing lost or double-counted");
  });

  it("plain-text distribution per pot", () => {
    const t = bestandsToepfe(W, "area");
    assert.equal(topf(t, "rueckbau").text, "Rückbau: von 336 m² sind 36 m² gemessen, 300 m² angenommen");
    assert.equal(topf(t, "unbekannt").text, "Unbekannt: von 22 m² sind 22 m² ohne Erfassungsgrad");
    assert.equal(bestandsToepfe([], "area")[0].text, "Kein Rückbau-Anteil.");
  });

  it("position mostly from assumed elements → Bedarfsposition; unknown Erfassung is not 'assumed'", () => {
    const abbruch = { was: {}, zustand: { status: ["abbruch"] } };
    const r = vermutetAnteil(abbruch, W, "area");
    assert.equal(r.menge, 336); assert.equal(r.angenommen, 300);
    assert.equal(r.vorschlag, "Bedarfsposition");
    const neu = vermutetAnteil({ was: {}, zustand: { status: ["neubau"] } }, W, "area");
    assert.equal(neu.vorschlag, null);
    assert.equal(vermutetAnteil({ was: { kg: ["999"] } }, W).anteil, null);
  });
});
