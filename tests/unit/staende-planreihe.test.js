// Unit tests Stände core, step 2: plan series and state from the file name (staende/planReihe.js).
// Artificial names ("Test-Reihe"), hand-written expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planDateiZerlegen, datumImNamen, dateiDatumIso, dateienGruppieren } from "@core/lib/staende/planReihe.js";

describe("datumImNamen — Datumsformen", () => {
  const fall = (/** @type {string} */ name, /** @type {string|null} */ iso, /** @type {string|null} */ format) => {
    const d = datumImNamen(name);
    assert.deepEqual(d ? [d.iso, d.format] : null, iso ? [iso, format] : null, name);
  };
  it("JJJJ-MM-TT (auch mit _ und .), JJJJMMTT, JJMMTT, TT.MM.JJJJ, TT.MM.JJ", () => {
    fall("Test-Reihe_2026-01-05", "2026-01-05", "JJJJ-MM-TT");
    fall("Test-Reihe 2026_01_05", "2026-01-05", "JJJJ-MM-TT");
    fall("Test-Reihe_20260105", "2026-01-05", "JJJJMMTT");
    fall("260105_Test-Reihe", "2026-01-05", "JJMMTT");
    fall("Test-Reihe 05.01.2026", "2026-01-05", "TT.MM.JJJJ");
    fall("Test-Reihe 5.1.26", "2026-01-05", "TT.MM.JJ");
  });
  it("keine Datumsdeutung bei ungültigen Werten oder längeren Ziffernfolgen", () => {
    fall("Test-Reihe 261332", null, null);       // month 13
    fall("Test-Reihe 2026-02-30", null, null);   // 30 February
    fall("Test-Reihe 1234567", null, null);      // 7 digits: plan number
    fall("Test-Reihe EG 2", null, null);
  });
  it("mehrere Daten derselben Form: das letzte gilt", () => {
    fall("Test-Reihe 2026-01-05 rev 2026-02-01", "2026-02-01", "JJJJ-MM-TT");
  });
});

describe("planDateiZerlegen", () => {
  it("Planreihe ohne Datum, Endung und Trennzeichen am Rand", () => {
    const z = planDateiZerlegen("Test-Reihe_2026-01-05.dxf");
    assert.equal(z.reihe, "Test-Reihe");
    assert.equal(z.schluessel, "test reihe");
    assert.deepEqual(z.datum, { iso: "2026-01-05", quelle: "name", format: "JJJJ-MM-TT", roh: "2026-01-05" });
    assert.equal(z.kopie, false);
    assert.equal(z.endung, "dxf");
  });

  it("Pfad wird abgeschnitten; Datum vorne", () => {
    const z = planDateiZerlegen("Ordner/Unterordner/260105_Test-Reihe.DXF");
    assert.equal(z.reihe, "Test-Reihe");
    assert.equal(z.endung, "dxf");
  });

  it("ohne Datum im Namen gilt das Dateidatum; ohne beides undatiert", () => {
    assert.deepEqual(planDateiZerlegen("Test-Reihe.dxf", { dateidatum: "2026-03-04T10:00:00Z" }).datum, { iso: "2026-03-04", quelle: "datei", format: null, roh: null });
    assert.equal(planDateiZerlegen("Test-Reihe.dxf").datum, null);
    // the name date wins over the file date
    assert.equal(planDateiZerlegen("Test-Reihe 2026-01-05.dxf", { dateidatum: "2026-03-04" }).datum?.iso, "2026-01-05");
  });

  it("Kopie-Zusätze: _recover, backup, .bak, (2), Kopie, Copy — gleiche Reihe", () => {
    /** @type {Array<[string, string]>} */
    const faelle = [
      ["Test-Reihe_2026-01-05_recover.dxf", "recover"],
      ["Test-Reihe_2026-01-05-backup.dxf", "backup"],
      ["Test-Reihe_2026-01-05.dxf.bak", ".bak"],
      ["Test-Reihe_2026-01-05.bak", ".bak"],
      ["Test-Reihe_2026-01-05 (2).dxf", "(2)"],
      ["Test-Reihe_2026-01-05 - Kopie.dxf", "Kopie"],
      ["Test-Reihe_2026-01-05 - Kopie (3).dxf", "Kopie (3)"],
      ["Kopie von Test-Reihe_2026-01-05.dxf", "Kopie von"],
      ["Test-Reihe_2026-01-05 copy.dxf", "copy"],
      ["Test-Reihe_2026-01-05_bak.dxf", "bak"],
    ];
    for (const [name, merkmal] of faelle) {
      const z = planDateiZerlegen(name);
      assert.equal(z.reihe, "Test-Reihe", name);
      assert.equal(z.kopie, true, name);
      assert.equal(z.kopieMerkmal, merkmal, name);
      assert.equal(z.datum?.iso, "2026-01-05", name);
    }
  });

  it("Wörter, die Kopie-Merkmale nur enthalten, sind keine Kopie; Schlüssel vereinheitlicht Trenner", () => {
    assert.equal(planDateiZerlegen("Test-Backuphalle.dxf").kopie, false);
    assert.equal(planDateiZerlegen("Test Reihe EG 2.dxf").kopie, false);
    assert.equal(planDateiZerlegen("test_reihe 2026-01-05.dxf").schluessel, planDateiZerlegen("Test-Reihe.dxf").schluessel);
  });
});

describe("dateiDatumIso", () => {
  it("String (ISO), Date, Zahl; Unsinn → null", () => {
    assert.equal(dateiDatumIso("2026-01-05"), "2026-01-05");
    assert.equal(dateiDatumIso(new Date(2026, 0, 5, 12)), "2026-01-05");
    assert.equal(dateiDatumIso(new Date(2026, 0, 5, 12).getTime()), "2026-01-05");
    assert.equal(dateiDatumIso("gestern"), null);
    assert.equal(dateiDatumIso(NaN), null);
    assert.equal(dateiDatumIso(null), null);
  });
});

describe("dateienGruppieren — Reihen → Stände → Kopien", () => {
  const ergebnis = dateienGruppieren([
    { name: "Test-Reihe_2026-01-05.dxf", quelle: 1 },
    { name: "Test-Reihe_2026-02-10.dxf", quelle: 2 },
    { name: "Test-Reihe_2026-02-10_recover.dxf", quelle: 3 },
    { name: "Test-Reihe.dxf", quelle: 4 },                                       // undated
    { name: "Test-Reihe_recover.dxf", dateidatum: "2026-05-01", quelle: 5 },   // copy, file date only
    { name: "Andere Reihe 260301.dxf", quelle: 6 },
    { name: "Andere Reihe 260301 (2).dxf", quelle: 7 },
  ]);

  it("zwei Reihen, nach Namen sortiert", () => {
    assert.deepEqual(ergebnis.map((r) => r.reihe), ["Andere Reihe", "Test-Reihe"]);
  });

  it("Stände neuester zuerst, undatierte zuletzt", () => {
    const t = ergebnis[1];
    assert.deepEqual(t.staende.map((s) => s.datum?.iso ?? null), ["2026-02-10", "2026-01-05", null]);
    assert.deepEqual(t.staende.map((s) => s.datei.quelle), [2, 1, 4]);
  });

  it("Kopien hängen am Stand; Kopie nur mit Dateidatum am neuesten Stand mit Original", () => {
    const t = ergebnis[1];
    assert.deepEqual(t.staende[0].kopien.map((k) => k.quelle).sort(), [3, 5]);
    assert.deepEqual(ergebnis[0].staende.length, 1);
    assert.deepEqual(ergebnis[0].staende[0].kopien.map((k) => k.quelle), [7]);
  });

  it("nur Kopien vorhanden: erste Kopie trägt den Stand; leere/ungültige Eingaben", () => {
    const r = dateienGruppieren([{ name: "Test-Reihe 2026-01-05 (2).dxf" }, { name: "Test-Reihe 2026-01-05 - Kopie.dxf" }]);
    assert.equal(r[0].staende.length, 1);
    assert.equal(r[0].staende[0].datei.kopie, true);
    assert.equal(r[0].staende[0].kopien.length, 1);
    assert.deepEqual(dateienGruppieren(/** @type {any} */ (null)), []);
    assert.deepEqual(dateienGruppieren(/** @type {any} */ ([null, { name: 3 }])), []);
  });

  it("undatierte Reihe mit Dateidatum: jedes Dateidatum ein eigener Stand", () => {
    const r = dateienGruppieren([{ name: "Test-Reihe.dxf", dateidatum: "2026-01-05" }, { name: "Test-Reihe.dxf", dateidatum: "2026-02-01" }]);
    assert.deepEqual(r[0].staende.map((s) => [s.datum?.iso, s.datum?.quelle]), [["2026-02-01", "datei"], ["2026-01-05", "datei"]]);
  });
});
