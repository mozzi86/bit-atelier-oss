// Unit-Tests für packages/nova-designer/src/lib/tgaNetz.js (Phase 41, NETZ-01…04).
//
// Kulisse: zwei Räume im EG (Wohnen 10 × 8 m = 80 m², Küche 10 × 8 m), ein Heizungsnetz
// Erzeuger E → Schacht S (EG–2. OG) → Verteiler V → Auslass A1 (in Wohnen) und im 1. OG
// S → Auslass A2. Erwartungswerte per Handrechnung aus hvac.js-Formeln:
//   Heizlast 50 W/m² · 80 m² / 1000 = 4,0 kW · Lüftung 0,5 1/h · 80 · 3 = 120 m³/h ·
//   Trinkwasser 80/75 · 2,5 P · 125 l = 333,33 l/d · Elektro 30 VA/m² · 80 · 0,6 / 1000 = 1,44 kW.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GEWERKE_TGA, GEWERK_KEYS, KNOTEN_ARTEN, ART_KEYS, NETZ_DEFAULT, FANG_RADIUS_M, DU_JE_AUSLASS,
  netzHardened, kantenLaenge, knotenImLevel, kantenImLevel, naechsterKnoten,
  neuerKnoten, neueKante, verschiebeKnoten, aendereKnoten, aendereKante, loescheKnoten, loescheKante,
  strangVon, erreichtQuelle, zonenZuordnung, strangKennwerte, netzChecks, netzMengen, strangschema,
} from "@designer/lib/tgaNetz";

const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const ZONEN = [
  { level: 0, name: "Wohnen", points: rect(0, 0, 10, 8) },
  { level: 0, name: "Küche", points: rect(10, 0, 20, 8) },
];

function netzBauen(gewerk = "heizung", dn = 25) {
  const E = { id: "n_1", gewerk, art: "erzeuger", level: 0, x: -2, z: -2 };
  const S = { id: "n_2", gewerk, art: "schacht", level: 0, levelBis: 2, x: 5, z: -1, name: "Schacht A" };
  const V = { id: "n_3", gewerk, art: "verteiler", level: 0, x: 5, z: 1 };
  const A1 = { id: "n_4", gewerk, art: "auslass", level: 0, x: 5, z: 4 };
  const A2 = { id: "n_5", gewerk, art: "auslass", level: 1, x: 5, z: 4 };
  return {
    version: 1,
    knoten: [E, S, V, A1, A2],
    kanten: [
      { id: "k_1", gewerk, level: 0, dn, von: "n_1", nach: "n_2", points: [{ x: -2, z: -2 }, { x: 5, z: -1 }] }, // √50 = 7,0711
      { id: "k_2", gewerk, level: 0, dn, von: "n_2", nach: "n_3", points: [{ x: 5, z: -1 }, { x: 5, z: 1 }] },   // 2
      { id: "k_3", gewerk, level: 0, dn, von: "n_3", nach: "n_4", points: [{ x: 5, z: 1 }, { x: 5, z: 4 }] },    // 3
      { id: "k_4", gewerk, level: 1, dn, von: "n_2", nach: "n_5", points: [{ x: 5, z: -1 }, { x: 5, z: 4 }] },   // 5
    ],
  };
}

describe("tgaNetz — Katalog", () => {
  it("fünf Gewerke mit Farbe, Medium, DN-Default in der DN-Liste; fünf Knoten-Arten", () => {
    assert.deepEqual(GEWERK_KEYS, ["heizung", "lueftung", "trinkwasser", "abwasser", "elektro"]);
    for (const g of Object.values(GEWERKE_TGA)) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(g.farbe), g.label);
      assert.ok(g.dnListe.includes(g.dnDefault), `${g.label}: Default ${g.dnDefault} nicht in Liste`);
      assert.ok(g.medium && g.einheit);
    }
    assert.deepEqual(ART_KEYS, ["erzeuger", "verteiler", "schacht", "auslass", "anschluss"]);
    assert.equal(KNOTEN_ARTEN.auslass.strang, false);
    assert.ok(KNOTEN_ARTEN.erzeuger.quelle && KNOTEN_ARTEN.anschluss.quelle && !KNOTEN_ARTEN.schacht.quelle);
    assert.deepEqual(NETZ_DEFAULT, { version: 1, knoten: [], kanten: [] });
    assert.equal(FANG_RADIUS_M, 0.4);
    assert.equal(DU_JE_AUSLASS, 1);
  });
});

describe("tgaNetz — Härtung", () => {
  it("netzHardened wirft Unbrauchbares weg, normalisiert Rest, löst tote Verknüpfungen", () => {
    const n = netzHardened({
      knoten: [
        { id: "n_1", gewerk: "heizung", art: "erzeuger", level: 0.4, x: 1, z: 2 },
        { id: "n_2", gewerk: "gas", art: "erzeuger", level: 0, x: 1, z: 2 },          // Gewerk unbekannt
        { id: "n_3", gewerk: "heizung", art: "pumpe", level: 0, x: 1, z: 2 },         // Art unbekannt
        { id: "n_4", gewerk: "heizung", art: "schacht", level: 2, levelBis: 0, x: 0, z: 0 }, // levelBis < level
        { id: 5, gewerk: "heizung", art: "auslass", level: 0, x: 1, z: 2 },           // id keine Zeichenkette
        { id: "n_6", gewerk: "heizung", art: "auslass", level: 0, x: "a", z: 2 },     // Koordinate kaputt
      ],
      kanten: [
        { id: "k_1", gewerk: "heizung", level: 0, dn: -5, von: "n_1", nach: "n_99", points: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: "x" }] },
        { id: "k_2", gewerk: "heizung", level: 0, dn: 25, von: "n_1", nach: "n_4", points: [{ x: 0, z: 0 }] }, // < 2 Punkte
        { id: "k_3", gewerk: "wasser", level: 0, dn: 25, points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] },        // Gewerk unbekannt
      ],
    });
    assert.deepEqual(n.knoten.map((k) => k.id), ["n_1", "n_4"]);
    assert.equal(n.knoten[0].level, 0);
    assert.equal(n.knoten[1].levelBis, 2, "levelBis wird auf level angehoben");
    assert.equal(n.kanten.length, 1);
    assert.deepEqual(n.kanten[0], { id: "k_1", gewerk: "heizung", level: 0, dn: null, von: "n_1", nach: null, points: [{ x: 0, z: 0 }, { x: 1, z: 1 }], gefaelle_pct: null }); // gefaelle_pct additiv seit Phase 63
    assert.deepEqual(netzHardened(null), NETZ_DEFAULT);
    assert.deepEqual(netzHardened("quatsch"), NETZ_DEFAULT);
  });
});

describe("tgaNetz — Geometrie und Editor-Helfer", () => {
  it("kantenLaenge, knotenImLevel (Schacht spannt Geschosse), kantenImLevel", () => {
    const n = netzBauen();
    assert.ok(Math.abs(kantenLaenge(n.kanten[0].points) - Math.sqrt(50)) < 1e-9);
    assert.equal(kantenLaenge([]), 0);
    assert.deepEqual(knotenImLevel(n, 0).map((k) => k.id), ["n_1", "n_2", "n_3", "n_4"]);
    assert.deepEqual(knotenImLevel(n, 1).map((k) => k.id), ["n_2", "n_5"]);
    assert.deepEqual(knotenImLevel(n, 2).map((k) => k.id), ["n_2"]);
    assert.deepEqual(knotenImLevel(n, 3), []);
    assert.deepEqual(kantenImLevel(n, 1).map((e) => e.id), ["k_4"]);
  });

  it("naechsterKnoten fängt innerhalb 0,4 m, auch den Schacht im 1. OG; sonst null", () => {
    const n = netzBauen();
    assert.equal(naechsterKnoten(n, 0, { x: 5.2, z: -1.1 }).id, "n_2");
    assert.equal(naechsterKnoten(n, 1, { x: 5.2, z: -1.1 }).id, "n_2");
    assert.equal(naechsterKnoten(n, 0, { x: 5.2, z: 4.3 }).id, "n_4");
    assert.equal(naechsterKnoten(n, 0, { x: 8, z: 8 }), null);
    assert.equal(naechsterKnoten(n, 0, null), null);
    assert.equal(naechsterKnoten(n, 0, { x: 5.9, z: 4 }, 1.0).id, "n_4", "größerer Fangradius");
  });

  it("neuerKnoten / neueKante vergeben fortlaufende Ids und rasten Endpunkte auf die Knoten", () => {
    const r1 = neuerKnoten(NETZ_DEFAULT, { gewerk: "lueftung", art: "schacht", level: 0, levelBis: 3, x: 1, z: 1, name: "L1" });
    assert.equal(r1.knoten.id, "n_1");
    assert.equal(r1.knoten.levelBis, 3);
    const r2 = neuerKnoten(r1.netz, { gewerk: "lueftung", art: "auslass", level: 2, x: 4, z: 4 });
    assert.equal(r2.knoten.id, "n_2");
    assert.equal(r2.knoten.levelBis, 2, "nur Schächte spannen Geschosse");
    const r3 = neueKante(r2.netz, { gewerk: "lueftung", level: 2, dn: 160, von: "n_1", nach: "n_2", points: [{ x: 1.3, z: 0.8 }, { x: 2, z: 2 }, { x: 3.9, z: 4.2 }] });
    assert.equal(r3.kante.id, "k_1");
    assert.deepEqual(r3.kante.points[0], { x: 1, z: 1 });
    assert.deepEqual(r3.kante.points[2], { x: 4, z: 4 });
    assert.equal(r3.kante.points.length, 3);
    const r4 = neueKante(r3.netz, { gewerk: "lueftung", level: 2, von: "n_9", nach: null, points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] });
    assert.equal(r4.kante.id, "k_2");
    assert.equal(r4.kante.von, null, "unbekannte Knoten-Id wird null");
    assert.equal(r4.kante.dn, null);
    const r5 = neueKante(r4.netz, { gewerk: "lueftung", level: 2, points: [{ x: 0, z: 0 }] });
    assert.equal(r5.kante, null, "eine Leitung braucht zwei Punkte");
    assert.equal(r5.netz.kanten.length, 2);
  });

  it("verschiebeKnoten zieht die Endpunkte der angehängten Kanten mit", () => {
    const n = verschiebeKnoten(netzBauen(), "n_4", { x: 6, z: 5 });
    assert.deepEqual(n.knoten.find((k) => k.id === "n_4"), { id: "n_4", gewerk: "heizung", art: "auslass", level: 0, x: 6, z: 5, name: "", levelBis: 0 });
    assert.deepEqual(n.kanten.find((e) => e.id === "k_3").points, [{ x: 5, z: 1 }, { x: 6, z: 5 }]);
    assert.deepEqual(n.kanten.find((e) => e.id === "k_2").points, [{ x: 5, z: -1 }, { x: 5, z: 1 }], "fremde Kante unverändert");
    const s = verschiebeKnoten(netzBauen(), "n_2", { x: 7, z: -1 });
    assert.deepEqual(s.kanten.find((e) => e.id === "k_1").points[1], { x: 7, z: -1 });
    assert.deepEqual(s.kanten.find((e) => e.id === "k_4").points[0], { x: 7, z: -1 }, "Schacht-Kante im 1. OG folgt");
  });

  it("aendereKnoten / aendereKante patchen Attribute, Id bleibt; loescheKnoten lässt Kanten offen; loescheKante entfernt", () => {
    const a = aendereKnoten(netzBauen(), "n_2", { name: "Schacht B", levelBis: 1 });
    assert.equal(a.knoten.find((k) => k.id === "n_2").name, "Schacht B");
    assert.equal(a.knoten.find((k) => k.id === "n_2").levelBis, 1);
    const b = aendereKante(netzBauen(), "k_1", { dn: 32 });
    assert.equal(b.kanten.find((e) => e.id === "k_1").dn, 32);
    const c = loescheKnoten(netzBauen(), "n_3");
    assert.equal(c.knoten.length, 4);
    assert.equal(c.kanten.length, 4, "Kanten bleiben");
    assert.equal(c.kanten.find((e) => e.id === "k_2").nach, null);
    assert.equal(c.kanten.find((e) => e.id === "k_3").von, null);
    const d = loescheKante(netzBauen(), "k_3");
    assert.deepEqual(d.kanten.map((e) => e.id), ["k_1", "k_2", "k_4"]);
  });
});

describe("tgaNetz — Graph", () => {
  it("strangVon: Auslass → nächster Strangkopf; Kopf ist sich selbst; lose Knoten → null", () => {
    const n = netzBauen();
    assert.equal(strangVon(n, "n_4").id, "n_3", "A1 hängt am Verteiler, nicht am Schacht");
    assert.equal(strangVon(n, "n_5").id, "n_2", "A2 direkt am Schacht");
    assert.equal(strangVon(n, "n_1").id, "n_1");
    assert.equal(strangVon(n, "gibtsnicht"), null);
    const lose = loescheKante(n, "k_3");
    assert.equal(strangVon(lose, "n_4"), null);
  });

  it("erreichtQuelle: alle Auslässe erreichen den Erzeuger; nach Trennung nicht mehr", () => {
    const n = netzBauen();
    assert.equal(erreichtQuelle(n, "n_4"), true);
    assert.equal(erreichtQuelle(n, "n_5"), true);
    const getrennt = loescheKante(n, "k_1");
    assert.equal(erreichtQuelle(getrennt, "n_4"), false);
    assert.equal(erreichtQuelle(getrennt, "n_1"), true, "die Quelle selbst");
  });
});

describe("tgaNetz — Zonen und Bedarfe (NETZ-04)", () => {
  it("zonenZuordnung: Wohnen über A1 am Verteiler, Küche unversorgt; ohne Kanten im Level nichts", () => {
    const { zuordnung, unversorgt } = zonenZuordnung(netzBauen(), ZONEN);
    assert.deepEqual(zuordnung, [{ zoneIndex: 0, gewerk: "heizung", strangId: "n_3", auslassId: "n_4" }]);
    assert.deepEqual(unversorgt, [{ zoneIndex: 1, gewerk: "heizung" }]);
    const og = zonenZuordnung(netzBauen(), [{ level: 3, name: "Dach", points: rect(0, 0, 10, 8) }]);
    assert.deepEqual(og, { zuordnung: [], unversorgt: [] }, "Level ohne Leitungen wird nicht bewertet");
    assert.deepEqual(zonenZuordnung(NETZ_DEFAULT, ZONEN), { zuordnung: [], unversorgt: [] });
  });

  it("strangKennwerte Heizung: 80 m² · 50 W/m² = 4,0 kW am Verteiler-Strang", () => {
    const k = strangKennwerte(netzBauen(), ZONEN, { qHeizlast: 50 });
    assert.equal(k.length, 1);
    assert.deepEqual(k[0], { strangId: "n_3", gewerk: "heizung", name: "Verteiler n_3", raeume: 1, flaeche_m2: 80, auslaesse: 1, kennwert: 4, einheit: "kW", assumed: true });
  });

  it("strangKennwerte je Gewerk: Lüftung 120 m³/h, Trinkwasser 333,33 l/d, Elektro 1,44 kW, Abwasser 1 DU", () => {
    const luft = strangKennwerte(netzBauen("lueftung", 160), ZONEN, { storeyHeight: 3, luftwechsel: 0.5 })[0];
    assert.deepEqual([luft.kennwert, luft.einheit], [120, "m³/h"]);
    const tw = strangKennwerte(netzBauen("trinkwasser", 20), ZONEN)[0];
    assert.deepEqual([tw.kennwert, tw.einheit], [333.33, "l/d"]);
    const el = strangKennwerte(netzBauen("elektro", 2.5), ZONEN, { vaM2: 30 })[0];
    assert.deepEqual([el.kennwert, el.einheit], [1.44, "kW"]);
    const ab = strangKennwerte(netzBauen("abwasser", 100), ZONEN)[0];
    assert.deepEqual([ab.kennwert, ab.einheit], [1, "DU"]);
  });

  it("Auslass ohne Strang landet in der Gruppe „ohne Strang“", () => {
    const n = loescheKante(netzBauen(), "k_3");
    const k = strangKennwerte(n, ZONEN);
    assert.equal(k.length, 1);
    assert.equal(k[0].strangId, null);
    assert.equal(k[0].name, "ohne Strang");
  });
});

describe("tgaNetz — Checks (nie fail) und Mengen", () => {
  const erlaubt = (items) => items.every((i) => ["pass", "warn", "offen"].includes(i.status));

  it("leeres Netz: alles offen", () => {
    const items = netzChecks(NETZ_DEFAULT, ZONEN);
    assert.ok(erlaubt(items));
    assert.ok(items.every((i) => i.status === "offen"), JSON.stringify(items.map((i) => [i.key, i.status])));
  });

  it("Beispielnetz: verknüpft pass, Quelle pass, Küche unversorgt warn, Schacht pass, DN pass", () => {
    const items = netzChecks(netzBauen(), ZONEN);
    assert.ok(erlaubt(items));
    const st = Object.fromEntries(items.map((i) => [i.key, i.status]));
    assert.deepEqual(st, { netz: "pass", offene_kanten: "pass", auslaesse_versorgt: "pass", zonen_versorgt: "warn", schaechte: "pass", dn: "pass" });
    assert.match(items.find((i) => i.key === "zonen_versorgt").detail, /Heizung/);
  });

  it("offene Kante und fehlende DN werden gemeldet; ohne Räume ist zonen_versorgt offen", () => {
    const n = aendereKante(loescheKnoten(netzBauen(), "n_1"), "k_2", { dn: null });
    const st = Object.fromEntries(netzChecks(n, ZONEN).map((i) => [i.key, i.status]));
    assert.equal(st.offene_kanten, "warn");
    assert.equal(st.auslaesse_versorgt, "warn", "ohne Erzeuger erreicht kein Auslass eine Quelle");
    assert.equal(st.dn, "offen");
    assert.equal(Object.fromEntries(netzChecks(netzBauen(), []).map((i) => [i.key, i.status])).zonen_versorgt, "offen");
    assert.ok(!JSON.stringify(netzChecks(n, ZONEN)).includes('"fail"'));
  });

  it("netzMengen: 17,07 lfm Heizung DN 25, Knoten je Art, 3 Strangköpfe, 4 Kanten", () => {
    const m = netzMengen(netzBauen());
    assert.deepEqual(m.lfm, [{ gewerk: "heizung", dn: 25, lfm: 17.07 }]);
    assert.deepEqual(m.knoten, [
      { gewerk: "heizung", art: "erzeuger", stk: 1 }, { gewerk: "heizung", art: "verteiler", stk: 1 },
      { gewerk: "heizung", art: "schacht", stk: 1 }, { gewerk: "heizung", art: "auslass", stk: 2 },
    ]);
    assert.equal(m.straenge_stk, 3);
    assert.equal(m.kanten_stk, 4);
    const ohne = netzMengen(aendereKante(netzBauen(), "k_4", { dn: null }));
    assert.deepEqual(ohne.lfm, [{ gewerk: "heizung", dn: null, lfm: 5 }, { gewerk: "heizung", dn: 25, lfm: 12.07 }]);
  });
});

describe("tgaNetz — Strangschema (NETZ-02)", () => {
  it("Spalten = Strangköpfe, Schacht belegt EG–2. OG, Zellen zählen Kanten und Auslässe", () => {
    const s = strangschema(netzBauen(), 3);
    assert.deepEqual(s.zeilen, [0, 1, 2]);
    assert.deepEqual(s.spalten.map((c) => [c.strangId, c.levelVon, c.levelBis]), [["n_1", 0, 0], ["n_2", 0, 2], ["n_3", 0, 0]]);
    assert.equal(s.spalten[1].name, "Schacht A");
    const schacht = s.zellen.filter((z) => z.strangId === "n_2");
    assert.deepEqual(schacht, [
      { strangId: "n_2", level: 0, kanten: 2, auslaesse: 0 },
      { strangId: "n_2", level: 1, kanten: 1, auslaesse: 1 },
      { strangId: "n_2", level: 2, kanten: 0, auslaesse: 0 },
    ]);
    assert.deepEqual(s.zellen.filter((z) => z.strangId === "n_3"), [{ strangId: "n_3", level: 0, kanten: 2, auslaesse: 1 }]);
  });

  it("Schacht über die Geschosszahl hinaus wird gekappt; leeres Netz → keine Spalten", () => {
    const s = strangschema(netzBauen(), 2);
    assert.deepEqual(s.zellen.filter((z) => z.strangId === "n_2").map((z) => z.level), [0, 1]);
    assert.deepEqual(strangschema(NETZ_DEFAULT, 4), { spalten: [], zeilen: [0, 1, 2, 3], zellen: [] });
  });
});
