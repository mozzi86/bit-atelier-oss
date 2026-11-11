// Unit tests Stände core, step 4: base proposal and revision index (staende/basisUndRevision.js).
// Artificial ids ("s1" …), series "test reihe", hand-written expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { basisVorschlag, naechsterRevisionsIndex, abgabeVermerk, abgeben, BASIS_MIN_FLAECHENANTEIL } from "@core/lib/staende/basisUndRevision.js";
import { naechsterIndex } from "@/lib/werkplanung/plaene.js";

const bbox = (/** @type {number} */ b, /** @type {number} */ h) => ({ minX: 0, minY: 0, maxX: b, maxY: h });
const aus = /** @type {{art: 'auto'}} */ ({ art: "auto" });
const offen = /** @type {{art: 'offen'}} */ ({ art: "offen" });

describe("basisVorschlag", () => {
  it("Grundriss vorhanden: neuester Stand der Referenzreihe, auch wenn andere Reihen neuer sind", () => {
    const r = basisVorschlag({
      referenzReihe: "test reihe",
      staende: [
        { id: "s1", reihe: "test reihe", datum: "2026-01-05", ausrichtung: offen },
        { id: "s2", reihe: "test reihe", datum: "2026-02-10", ausrichtung: offen },
        { id: "s3", reihe: "test reihe", datum: null },
        { id: "s4", reihe: "andere reihe", datum: "2026-05-01", ausrichtung: aus, bbox: bbox(10, 10) },
      ],
    });
    assert.deepEqual(r, { standId: "s2", grund: "referenzreihe" });
  });

  it("Referenzreihe nur undatiert: deren undatierter Stand", () => {
    assert.equal(basisVorschlag({ referenzReihe: "test reihe", staende: [{ id: "s3", reihe: "test reihe", datum: null }] }).standId, "s3");
  });

  it("ohne Grundriss: neuester datierter, ausgerichteter Stand mit ≥ 50 % der Referenzfläche", () => {
    const r = basisVorschlag({
      referenzFlaeche: 100,
      staende: [
        { id: "klein", reihe: "a", datum: "2026-06-01", ausrichtung: aus, bbox: bbox(7, 7) },   // 49 m² < 50
        { id: "offen", reihe: "b", datum: "2026-05-01", ausrichtung: offen, bbox: bbox(10, 10) }, // not aligned
        { id: "gut", reihe: "c", datum: "2026-04-01", ausrichtung: aus, bbox: bbox(5, 10) },     // exactly 50 m²
        { id: "alt", reihe: "d", datum: "2026-01-01", ausrichtung: aus, bbox: bbox(10, 10) },
        { id: "undatiert", reihe: "e", datum: null, ausrichtung: aus, bbox: bbox(10, 10) },
      ],
    });
    assert.deepEqual(r, { standId: "gut", grund: "flaeche" });
    assert.equal(BASIS_MIN_FLAECHENANTEIL, 0.5);
  });

  it("undatierte nur, wenn kein datierter passt; nichts passt → null", () => {
    const st = [
      { id: "undatiert", reihe: "e", datum: null, ausrichtung: aus, bbox: bbox(10, 10) },
      { id: "offen", reihe: "b", datum: "2026-05-01", ausrichtung: offen, bbox: bbox(10, 10) },
    ];
    assert.equal(basisVorschlag({ referenzFlaeche: 100, staende: st }).standId, "undatiert");
    assert.deepEqual(basisVorschlag({ referenzFlaeche: 100, staende: [st[1]] }), { standId: null, grund: "keiner" });
    assert.deepEqual(basisVorschlag({ staende: /** @type {any} */ (null) }), { standId: null, grund: "keiner" });
  });

  it("unbekannte Referenzfläche: Flächenprüfung entfällt; fehlende Referenzreihe fällt auf Regel 2", () => {
    const st = [{ id: "s1", reihe: "a", datum: "2026-01-01", ausrichtung: aus, bbox: bbox(1, 1) }];
    assert.equal(basisVorschlag({ staende: st }).standId, "s1");
    assert.equal(basisVorschlag({ referenzReihe: "gibt es nicht", staende: st }).grund, "flaeche");
  });
});

describe("naechsterRevisionsIndex — gleiche Konvention wie werkplanung/plaene.js", () => {
  it("A…Z, dann AA; leer → A; Kleinbuchstaben werden groß", () => {
    assert.equal(naechsterRevisionsIndex(""), "A");
    assert.equal(naechsterRevisionsIndex(null), "A");
    assert.equal(naechsterRevisionsIndex("A"), "B");
    assert.equal(naechsterRevisionsIndex("z"), "AA");
    assert.equal(naechsterRevisionsIndex("AZ"), "BA");
    assert.equal(naechsterRevisionsIndex("ZZ"), "AAA");
    assert.throws(() => naechsterRevisionsIndex("A1"));
  });

  it("stimmt mit naechsterIndex() der Werkplanung überein", () => {
    for (const i of ["", "A", "M", "Z", "AZ", "ZZ", "ABZ"]) assert.equal(naechsterRevisionsIndex(i), naechsterIndex(i), i);
  });
});

describe("abgabeVermerk", () => {
  it("Anzahl je Art, häufigste zuerst, dann nach Name; doppelte IDs zählen einmal", () => {
    assert.equal(abgabeVermerk([{ id: "1", art: "Tür" }, { id: "2", art: "Wand" }, { id: "3", art: "Wand" }, { id: "3", art: "Wand" }]), "2× Wand, 1× Tür");
    assert.equal(abgabeVermerk([{ id: "1", art: "Wand" }, { id: "2", art: "Decke" }]), "1× Decke, 1× Wand");
    assert.equal(abgabeVermerk([{ id: "1" }]), "1× Änderung");
    assert.equal(abgabeVermerk([]), "");
  });
});

describe("abgeben — Index steigt nur bei Änderung", () => {
  const erste = abgeben([], { datum: "2026-01-05", von: "Test-Person", basisStandId: "s1", aenderungen: [{ id: "a1", art: "Wand" }, { id: "a2", art: "Wand" }, { id: "a3", art: "Tür" }] });

  it("erste Abgabe: Index A, Vermerk automatisch, IDs sortiert", () => {
    assert.equal(erste.neu, true);
    assert.deepEqual(erste.eintrag, { index: "A", datum: "2026-01-05", von: "Test-Person", vermerk: "2× Wand, 1× Tür", basisStandId: "s1", aenderungIds: ["a1", "a2", "a3"] });
    assert.equal(erste.verlauf.length, 1);
  });

  it("gleiche Abgabe nochmal (andere Reihenfolge der IDs): kein neuer Index", () => {
    const r = abgeben(erste.verlauf, { datum: "2026-01-06", von: "Test-Person", basisStandId: "s1", aenderungen: [{ id: "a3", art: "Tür" }, { id: "a1", art: "Wand" }, { id: "a2", art: "Wand" }] });
    assert.equal(r.neu, false);
    assert.equal(r.eintrag?.index, "A");
    assert.equal(r.verlauf.length, 1);
  });

  it("neue Änderung → B; anderer Basisstand allein → C; eigener Vermerk gilt", () => {
    const b = abgeben(erste.verlauf, { datum: "2026-02-01", von: "Test-Person", basisStandId: "s1", aenderungen: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4", art: "Fenster" }] });
    assert.equal(b.eintrag?.index, "B");
    const c = abgeben(b.verlauf, { datum: "2026-03-01", von: "Test-Person", basisStandId: "s2", aenderungen: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }], vermerk: "Neue Plangrundlage" });
    assert.equal(c.eintrag?.index, "C");
    assert.equal(c.eintrag?.vermerk, "Neue Plangrundlage");
    assert.deepEqual(c.verlauf.map((e) => e.index), ["A", "B", "C"]);
    assert.equal(erste.verlauf.length, 1); // input not mutated
  });

  it("Abgabe ohne Änderungen: erste bekommt A mit „Keine Änderungen“; Wegfall einer Änderung zählt als Änderung", () => {
    const leer = abgeben(null, { datum: "2026-01-05", von: "Test-Person", basisStandId: null, aenderungen: [] });
    assert.equal(leer.eintrag?.index, "A");
    assert.equal(leer.eintrag?.vermerk, "Keine Änderungen");
    const weniger = abgeben(erste.verlauf, { datum: "2026-01-07", von: "Test-Person", basisStandId: "s1", aenderungen: [{ id: "a1" }] });
    assert.equal(weniger.neu, true);
    assert.equal(weniger.eintrag?.index, "B");
  });
});
