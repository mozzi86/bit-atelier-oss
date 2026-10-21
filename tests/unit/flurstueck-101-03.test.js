// Unit tests 101-03: own DXF reader (dxfLesen.js), ETRS89/UTM conversion (utmEtrs89.js),
// polygon union of touching parcels (polygonVereinigung.js) and the parcel import from DXF
// with union into one plot boundary (flurstueckImport.js). Hand-computed expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dxfPaare, dxfLesen, linienVerketten, meldungText, DXF_MELDUNGEN } from "@core/lib/plan/dxfLesen.js";
import { vonUtm, nachUtm } from "@core/lib/utmEtrs89.js";
import { vereinigePolygone } from "@core/lib/polygonVereinigung.js";

/** Minimal DXF text from entity lines (code, value, code, value …), CRLF. */
const dxf = (/** @type {Array<string|number>} */ ents, header = []) =>
  ["0", "SECTION", "2", "HEADER", ...header.map(String), "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...ents.map(String), "0", "ENDSEC", "0", "EOF"].join("\r\n") + "\r\n";

const lw = (/** @type {string} */ ebene, /** @type {Array<[number, number]>} */ pts, geschlossen = true) =>
  ["0", "LWPOLYLINE", "8", ebene, "90", pts.length, "70", geschlossen ? 1 : 0, ...pts.flatMap(([x, y]) => ["10", x, "20", y])];

const flaeche = (/** @type {Array<{x:number,y:number}>} */ p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2);

describe("dxfLesen — minimal ASCII DXF reader", () => {
  it("Paare: CRLF/LF, Code getrimmt, leere Datei und Binär-DXF als Fehler", () => {
    const { paare, fehler } = dxfPaare("  0\nSECTION\r\n  2\r\nENTITIES\n");
    assert.equal(fehler, null);
    assert.deepEqual(paare, [{ code: 0, wert: "SECTION" }, { code: 2, wert: "ENTITIES" }]);
    assert.equal(dxfPaare("").fehler, "leer");
    assert.equal(dxfPaare("AutoCAD Binary DXF\r\n\u001a").fehler, "binaer");
    assert.equal(dxfPaare("kein dxf\nnur text").fehler, "keinDxf");
  });

  it("Paare: Abbruch mitten in der Datei wird mit Zeile gemeldet, nicht verschwiegen", () => {
    const p = dxfPaare("0\nSECTION\n2\nENTITIES\nXX\noops\n0\nLINE\n");
    assert.equal(p.fehler, null);
    assert.equal(p.abbruchZeile, 5);
    assert.equal(p.paare.length, 2);
    assert.equal(dxfPaare("0\nEOF\n").abbruchZeile, null);
    const t = dxf([...lw("A", [[0, 0], [1, 0], [1, 1]]), "XX", "oops", ...lw("A", [[2, 0], [3, 0], [3, 1]])]);
    const r = dxfLesen(t);
    assert.equal(r.fehler, null);
    assert.equal(r.polylinien.length, 1);
    assert.equal(r.warnungen.length, 1);
    assert.equal(r.warnungen[0].text, DXF_MELDUNGEN.abgebrochen);
    assert.match(meldungText(r.warnungen[0]), /ab Zeile \d+ nicht lesbar/);
  });

  it("LWPOLYLINE geschlossen (Flag 1) und offen; Ebenenliste mit Anzahl; $INSUNITS", () => {
    const t = dxf([...lw("FLURSTUECK", [[0, 0], [10, 0], [10, 20], [0, 20]]), ...lw("WEG", [[0, 0], [5, 5]], false)], ["9", "$INSUNITS", "70", 6]);
    const r = dxfLesen(t);
    assert.equal(r.fehler, null);
    assert.equal(r.einheit, 6);
    assert.equal(r.polylinien.length, 2);
    assert.deepEqual(r.polylinien[0], { ebene: "FLURSTUECK", punkte: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }], geschlossen: true, quelle: "LWPOLYLINE" });
    assert.equal(r.polylinien[1].geschlossen, false);
    assert.deepEqual(r.ebenen, [{ name: "FLURSTUECK", anzahl: 1 }, { name: "WEG", anzahl: 1 }]);
  });

  it("Ebenen-Filter (Groß/klein egal): nur gewählte Ebenen, Liste bleibt vollständig", () => {
    const t = dxf([...lw("Flurstueck", [[0, 0], [1, 0], [1, 1]]), ...lw("GEBAEUDE", [[0, 0], [2, 0], [2, 2]])]);
    const r = dxfLesen(t, { ebenen: ["FLURSTUECK"] });
    assert.equal(r.polylinien.length, 1);
    assert.equal(r.polylinien[0].ebene, "Flurstueck");
    assert.equal(r.ebenen.length, 2);
  });

  it("POLYLINE + VERTEX + SEQEND (R12), Endpunkt = Startpunkt gilt als geschlossen", () => {
    const v = (/** @type {number} */ x, /** @type {number} */ y) => ["0", "VERTEX", "8", "A", "10", x, "20", y, "30", 0];
    const t = dxf(["0", "POLYLINE", "8", "A", "66", 1, "70", 0, ...v(0, 0), ...v(4, 0), ...v(4, 3), ...v(0, 0), "0", "SEQEND", "8", "A"]);
    const r = dxfLesen(t);
    assert.equal(r.polylinien.length, 1);
    assert.equal(r.polylinien[0].geschlossen, true);
    assert.equal(r.polylinien[0].punkte.length, 3);
    assert.equal(r.polylinien[0].quelle, "POLYLINE");
  });

  it("LINE-Segmente in beliebiger Richtung werden je Ebene zu einem Ring verkettet", () => {
    const l = (/** @type {number[]} */ [x1, y1, x2, y2]) => ["0", "LINE", "8", "L", "10", x1, "20", y1, "11", x2, "21", y2];
    const t = dxf([...l([0, 0, 10, 0]), ...l([10, 10, 10, 0]), ...l([10, 10, 0, 10]), ...l([0, 0, 0, 10])]);
    const r = dxfLesen(t);
    assert.equal(r.polylinien.length, 1);
    assert.equal(r.polylinien[0].geschlossen, true);
    assert.equal(flaeche(r.polylinien[0].punkte), 100);
    // Open chain stays open.
    assert.equal(linienVerketten([[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 1, y: 0 }, { x: 2, y: 1 }]], 1e-6)[0].geschlossen, false);
  });

  it("Bögen, INSERT und unbekannte Objekte werden gemeldet, nicht verschwiegen; TEXT mit Ausrichtung", () => {
    const t = dxf([
      "0", "LWPOLYLINE", "8", "A", "90", 3, "70", 1, "10", 0, "20", 0, "42", 0.5, "10", 5, "20", 0, "10", 5, "20", 5,
      "0", "INSERT", "8", "A", "2", "BLOCK1", "10", 0, "20", 0,
      "0", "CIRCLE", "8", "A", "10", 0, "20", 0, "40", 1,
      "0", "TEXT", "8", "NUMMERN", "10", 0, "20", 0, "40", 1, "1", "123/4", "72", 4, "11", 3, "21", 2,
    ]);
    const r = dxfLesen(t);
    const texte = r.warnungen.map((m) => meldungText(m));
    assert.ok(texte.some((s) => s.includes("1 Bogensegment")), texte.join("|"));
    assert.ok(texte.some((s) => s.includes("INSERT")));
    assert.ok(texte.some((s) => s.includes("CIRCLE")));
    assert.deepEqual(r.texte, [{ ebene: "NUMMERN", x: 3, y: 2, text: "123/4" }]);
  });

  it("kein ENTITIES-Abschnitt / kaputte Datei → Fehlermeldung, kein Wurf", () => {
    const r = dxfLesen("0\r\nSECTION\r\n2\r\nHEADER\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n");
    assert.equal(r.fehler?.text, DXF_MELDUNGEN.keineEntities);
    assert.equal(dxfLesen("{\"type\":\"FeatureCollection\"}").fehler?.text, DXF_MELDUNGEN.keinDxf);
  });

  it("meldungText übersetzt die Vorlage und füllt Platzhalter", () => {
    assert.equal(meldungText({ text: "A {n} B", werte: { n: 3 } }, (s) => s.replace("A", "X")), "X 3 B");
  });
});

describe("utmEtrs89 — ETRS89/UTM ↔ geographisch (GRS80)", () => {
  it("Zentralmeridian: E = 500 000 m liegt auf 9° (Zone 32); Äquator bei N = 0", () => {
    const p = vonUtm(500000, 0, 32);
    assert.ok(Math.abs(p.lat) < 1e-9 && Math.abs(p.lng - 9) < 1e-9);
  });

  it("45° auf dem Zentralmeridian: N = 0,9996 × Meridianbogen 4 984 944,38 m (GRS80)", () => {
    // Meridian arc to 45° on GRS80 ≈ 4 984 944.38 m (textbook value); ×k0 → 4 982 950.40 m.
    const p = vonUtm(500000, 4982950.40, 32);
    assert.ok(Math.abs(p.lat - 45) < 1e-5, `lat ${p.lat}`);
    const q = nachUtm(45, 9, 32);
    assert.ok(Math.abs(q.nord - 4982950.40) < 0.5, `nord ${q.nord}`);
  });

  it("Hin und zurück (Nürnberg, 3° neben dem Zentralmeridian) stimmt auf < 1 mm", () => {
    const u = nachUtm(49.4521, 11.0767, 32);
    const g = vonUtm(u.ost, u.nord, 32);
    assert.ok(Math.abs(g.lat - 49.4521) < 1e-8 && Math.abs(g.lng - 11.0767) < 1e-8);
    // Plausibility: Nuremberg lies near E 650 km, N 5 480 km in zone 32.
    assert.ok(u.ost > 640000 && u.ost < 660000, `ost ${u.ost}`);
    assert.ok(u.nord > 5470000 && u.nord < 5490000, `nord ${u.nord}`);
  });
});

describe("vereinigePolygone — Flurstücke zu einer Grenze", () => {
  const Q = (/** @type {number} */ x, /** @type {number} */ y, w = 10, h = 10) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

  it("ein Polygon kommt unverändert zurück", () => {
    const r = vereinigePolygone([Q(0, 0)]);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.polygon, Q(0, 0));
  });

  it("zwei Quadrate mit gemeinsamer Kante → Rechteck 20 × 10 mit 4 Ecken", () => {
    const r = vereinigePolygone([Q(0, 0), Q(10, 0)]);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.polygon.length, 4); assert.equal(r.flaeche, 200); }
  });

  it("T-Stoß: kleines Quadrat an halber Kante eines großen → L-Form, Fläche = Summe", () => {
    const r = vereinigePolygone([Q(0, 0, 20, 20), Q(20, 5, 10, 10)]);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.flaeche, 500); assert.equal(r.polygon.length, 8); }
  });

  it("drei Flurstücke im L, Orientierung gemischt, geschlossene Ringe", () => {
    const a = Q(0, 0); const b = Q(10, 0).reverse(); const c = [...Q(0, 10), { x: 0, y: 10 }];
    const r = vereinigePolygone([a, b, c]);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.flaeche, 300); assert.equal(r.polygon.length, 6); }
  });

  it("Rundungsfuge unter der Toleranz wird gefangen (0,004 Abstand, Toleranz 0,01)", () => {
    const r = vereinigePolygone([Q(0, 0), Q(10.004, 0)], { toleranz: 0.01 });
    assert.equal(r.ok, true);
  });

  it("Lücke: getrennte Flurstücke → ehrlich „luecke“ mit Abstand, keine Hülle", () => {
    const r = vereinigePolygone([Q(0, 0), Q(12, 0)]);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.grund, "luecke"); assert.equal(r.teile, 2); assert.ok(Math.abs(Number(r.abstand) - 2) < 1e-9); }
  });

  it("Überlappung: Kanten kreuzen sich → „ueberlappung“", () => {
    const r = vereinigePolygone([Q(0, 0), Q(5, 5)]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.grund, "ueberlappung");
  });

  it("Überlappung: Flurstück liegt ganz in einem anderen / doppelt importiert", () => {
    const r1 = vereinigePolygone([Q(0, 0, 20, 20), Q(5, 5, 2, 2)]);
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.grund, "ueberlappung");
    const r2 = vereinigePolygone([Q(0, 0), Q(0, 0)]);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.grund, "ueberlappung");
  });

  it("nur Eckberührung → „punktberuehrung“; Ring um ein Loch → „loch“", () => {
    const r = vereinigePolygone([Q(0, 0), Q(10, 10)]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.grund, "punktberuehrung");
    // Four 30×10 / 10×10 strips around a 10×10 courtyard.
    const ring = [Q(0, 0, 30, 10), Q(0, 20, 30, 10), Q(0, 10, 10, 10), Q(20, 10, 10, 10)];
    const r2 = vereinigePolygone(ring);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.grund, "loch");
  });

  it("ungültige Eingabe (2 Punkte, NaN) und leere Liste", () => {
    assert.equal(vereinigePolygone([]).ok, false);
    const r = vereinigePolygone([Q(0, 0), [{ x: 0, y: 0 }, { x: 1, y: 1 }]]);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.grund, "ungueltig"); assert.equal(r.index, 1); }
    assert.equal(vereinigePolygone([[{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]]).ok, false);
  });
});
