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

// 97-07: demolition is KG 394 by default (was "KG 200 / LB 040"), selectable per project
// (212 / 394 / at the affected groups), trade LB 084 per DIN 18459.
import { ABBRUCH_KG, rueckbauHinweis } from "@ava/lib/bestandsMengen";
describe("97-07 Kostengruppe Abbruch", () => {
  it("Standard 394, wählbar 212 und 3xx, Unbekanntes fällt auf 394", () => {
    assert.deepEqual(ABBRUCH_KG.map((k) => k.wert), ["394", "212", "3xx"]);
    const t = (kg) => bestandsToepfe([{ status: "abbruch", mengen: { area: 10 } }], "area", { abbruchKg: kg }).find((x) => x.key === "rueckbau");
    assert.equal(t(null).kg, "394");
    assert.equal(t("212").kg, "212");
    assert.equal(t("quatsch").kg, "394");
    assert.match(t("212").hinweis, /KG 212 · LB 084 · DIN 18459/);
    assert.equal(rueckbauHinweis("3xx"), "KG 3xx · LB 084 · DIN 18459");
    assert.equal(t(null).menge, 10, "Menge unverändert");
  });
});

// 97-06 rule 2: a tender position mixing demolition with existing/new (or unknown with known).
import { statusMischung } from "@ava/lib/bestandsMengen";
describe("97-06 Regel 2 Statusmischung", () => {
  const E = [
    { status: "abbruch", kg: "341", mengen: { area: 10 } },
    { status: "neubau", kg: "341", mengen: { area: 5 } },
    { status: null, kg: "342", mengen: { area: 2 } },
    { status: "bestand", kg: "342", mengen: { area: 0 } },
  ];
  it("Abbruch + Neubau gemischt, mit Mengen je Status", () => {
    assert.deepEqual(statusMischung({ was: { kg: ["341"] } }, E), { gemischt: true, anteile: { abbruch: 10, neubau: 5 } });
  });
  it("nur ein Status: ruhig; Menge 0 zählt nicht", () => {
    assert.equal(statusMischung({ zustand: { status: ["abbruch"] } }, E).gemischt, false);
    assert.equal(statusMischung({ was: { kg: ["342"] } }, E).gemischt, false, "ohne Status allein, Bestand mit 0 m²");
  });
  it("ohne Status mit bekanntem Status gemischt", () => {
    assert.equal(statusMischung({}, [{ status: null, mengen: { area: 1 } }, { status: "neubau", mengen: { area: 1 } }]).gemischt, true);
  });
});
