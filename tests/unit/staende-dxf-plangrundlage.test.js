// Unit tests Stände core, step 1: DXF reader for plan bases (staende/dxfPlangrundlage.js).
// Small inline DXF strings, artificial values, hand-computed expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dxfPlangrundlage, mtextKlartext, bulgePunkte, planBbox, bboxFlaeche, meldungText, PLAN_MELDUNGEN, BLOECKE_MAX_TIEFE } from "@core/lib/staende/dxfPlangrundlage.js";

/** DXF text from sections: header pairs, layer table entries, blocks, entities (flat code/value lists). */
function dxf({ header = /** @type {Array<string|number>} */ ([]), layer = /** @type {Array<string|number>} */ ([]), bloecke = /** @type {Array<string|number>} */ ([]), ents = /** @type {Array<string|number>} */ ([]) } = {}) {
  const z = [
    "0", "SECTION", "2", "HEADER", ...header, "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", ...layer, "0", "ENDTAB", "0", "ENDSEC",
    "0", "SECTION", "2", "BLOCKS", ...bloecke, "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF",
  ];
  return z.map(String).join("\r\n") + "\r\n";
}
const insunits = (/** @type {number} */ n) => ["9", "$INSUNITS", "70", n];
const layerEintrag = (/** @type {string} */ name, /** @type {number} */ farbe, flags = 0) => ["0", "LAYER", "2", name, "70", flags, "62", farbe];
const linie = (/** @type {string} */ eb, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2, /** @type {number[]} */ extra = []) => ["0", "LINE", "8", eb, ...extra, "10", x1, "20", y1, "11", x2, "21", y2];
const block = (/** @type {string} */ name, /** @type {number} */ bx, /** @type {number} */ by, /** @type {Array<string|number>} */ inhalt) => ["0", "BLOCK", "8", "0", "2", name, "70", 0, "10", bx, "20", by, ...inhalt, "0", "ENDBLK", "8", "0"];
const insert = (/** @type {string} */ name, /** @type {string} */ eb, /** @type {number} */ x, /** @type {number} */ y, { sx = 1, sy = 1, rot = 0, farbe = /** @type {number|null} */ (null) } = {}) =>
  ["0", "INSERT", "8", eb, ...(farbe != null ? ["62", farbe] : []), "2", name, "10", x, "20", y, "41", sx, "42", sy, "50", rot];
const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const nahPkt = (/** @type {{x:number,y:number}} */ p, /** @type {number} */ x, /** @type {number} */ y, eps = 1e-9) => { nah(p.x, x, eps); nah(p.y, y, eps); };

describe("dxfPlangrundlage — Einheiten und Grundobjekte", () => {
  it("$INSUNITS 4 (mm) → Meter; LINE als Linienzug mit 2 Punkten; Bbox", () => {
    const r = dxfPlangrundlage(dxf({ header: insunits(4), ents: linie("Test-Ebene", 0, 0, 2000, 1000) }));
    assert.equal(r.fehler, null);
    assert.deepEqual(r.einheit, { code: 4, meterJeEinheit: 0.001, angenommen: false });
    assert.equal(r.linienzuege.length, 1);
    nahPkt(r.linienzuege[0].punkte[1], 2, 1);
    assert.deepEqual(r.bbox, { minX: 0, minY: 0, maxX: 2, maxY: 1 });
    assert.equal(bboxFlaeche(r.bbox), 2);
    assert.deepEqual(r.warnungen, []);
  });

  it("ohne $INSUNITS: Meter angenommen mit Warnung; übergebener Faktor gilt; Dateieinheit gewinnt", () => {
    const ohne = dxfPlangrundlage(dxf({ ents: linie("A", 0, 0, 1, 0) }));
    assert.equal(ohne.einheit.angenommen, true);
    assert.equal(ohne.einheit.meterJeEinheit, 1);
    assert.equal(meldungText(ohne.warnungen[0]), "DXF ohne Einheit ($INSUNITS) — Meter angenommen, bitte prüfen.");
    const cm = dxfPlangrundlage(dxf({ ents: linie("A", 0, 0, 100, 0) }), { meterJeEinheit: 0.01 });
    nahPkt(cm.linienzuege[0].punkte[1], 1, 0);
    const mitDatei = dxfPlangrundlage(dxf({ header: insunits(6), ents: linie("A", 0, 0, 100, 0) }), { meterJeEinheit: 0.01 });
    nahPkt(mitDatei.linienzuege[0].punkte[1], 100, 0);
  });

  it("Farbe: BYLAYER über die LAYER-Tabelle, eigene ACI-Farbe, ausgeschaltete Ebene (negative Farbe)", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      layer: [...layerEintrag("Rot", 1), ...layerEintrag("Aus", -3), ...layerEintrag("Frost", 5, 1)],
      ents: [...linie("Rot", 0, 0, 1, 0), ...linie("Rot", 0, 0, 1, 0, [62, 4]), ...linie("Aus", 0, 0, 1, 0), ...linie("Neu", 0, 0, 1, 0, [62, 256])],
    }));
    assert.deepEqual(r.linienzuege.map((l) => l.farbe), [1, 4, 3, 7]);
    const eb = Object.fromEntries(r.ebenen.map((e) => [e.name, e]));
    assert.deepEqual(eb.Aus, { name: "Aus", farbe: 3, aus: true, gefroren: false, anzahl: 1 });
    assert.equal(eb.Frost.gefroren, true);
    assert.equal(eb.Frost.anzahl, 0); // in the table, unused — still listed
    assert.equal(eb.Rot.anzahl, 2);
    assert.equal(eb.Neu.farbe, 7); // layer not in the table
  });

  it("ARC bleibt Bogen (Grad → Radiant, gegen den Uhrzeigersinn), CIRCLE als Vollkreis; Bbox mit Bogen-Extremen", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: ["0", "ARC", "8", "B", "10", 0, "20", 0, "40", 2, "50", 0, "51", 90, "0", "CIRCLE", "8", "B", "10", 10, "20", 0, "40", 1],
    }));
    assert.equal(r.boegen.length, 2);
    const [b, k] = r.boegen;
    nah(b.start, 0); nah(b.ende, Math.PI / 2); nah(b.r, 2); assert.equal(b.kreis, false);
    assert.equal(k.kreis, true); nah(k.ende - k.start, 2 * Math.PI);
    const bb = /** @type {NonNullable<typeof r.bbox>} */ (r.bbox);
    nah(bb.minX, 0); nah(bb.minY, -1); nah(bb.maxX, 11); nah(bb.maxY, 2);
  });

  it("ARC über 0° hinweg (350° → 10°): Länge 20°, ende > start", () => {
    const r = dxfPlangrundlage(dxf({ header: insunits(6), ents: ["0", "ARC", "8", "B", "10", 0, "20", 0, "40", 1, "50", 350, "51", 10] }));
    const b = r.boegen[0];
    nah(b.ende - b.start, (20 * Math.PI) / 180);
    nah(b.start, (350 * Math.PI) / 180);
  });

  it("LWPOLYLINE mit Bulge 1 (Halbkreis) wird zu Punkten aufgelöst, alle auf dem Kreis", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: ["0", "LWPOLYLINE", "8", "P", "90", 2, "70", 0, "10", 0, "20", 0, "42", 1, "10", 2, "20", 0],
    }));
    const p = r.linienzuege[0].punkte;
    nahPkt(p[0], 0, 0); nahPkt(p[p.length - 1], 2, 0);
    assert.ok(p.length >= 37, `${p.length} Punkte`); // 180° / 5° = 36 steps
    for (const q of p) nah(Math.hypot(q.x - 1, q.y), 1, 1e-9);
    // bulge > 0 = counter-clockwise from (0,0) to (2,0): the arc runs below the chord
    assert.ok(p[18].y < -0.99);
  });

  it("geschlossene LWPOLYLINE: Schlusspunkt nicht doppelt, Bulge am letzten Punkt gilt für die Schlusskante", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: ["0", "LWPOLYLINE", "8", "P", "90", 3, "70", 1, "10", 0, "20", 0, "10", 4, "20", 0, "10", 4, "20", 3],
    }));
    assert.equal(r.linienzuege[0].geschlossen, true);
    assert.equal(r.linienzuege[0].punkte.length, 3);
    const mitBogen = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: ["0", "LWPOLYLINE", "8", "P", "90", 2, "70", 1, "10", 0, "20", 0, "10", 2, "20", 0, "42", 1],
    }));
    const p = mitBogen.linienzuege[0].punkte;
    assert.ok(p.length > 30);
    // closing edge (2,0) → (0,0), counter-clockwise about (1,0): last point before (0,0) at 175°
    nahPkt(p[p.length - 1], 1 - Math.cos(Math.PI / 36), Math.sin(Math.PI / 36), 1e-9);
  });

  it("POLYLINE mit VERTEX/SEQEND inkl. Bulge; Polygonnetz wird gezählt", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: [
        "0", "POLYLINE", "8", "P", "66", 1, "70", 0,
        "0", "VERTEX", "8", "P", "10", 0, "20", 0, "42", -1,
        "0", "VERTEX", "8", "P", "10", 2, "20", 0,
        "0", "SEQEND", "8", "P",
        "0", "POLYLINE", "8", "P", "70", 16, "0", "VERTEX", "8", "P", "10", 0, "20", 0, "0", "SEQEND",
      ],
    }));
    assert.equal(r.linienzuege.length, 1);
    assert.ok(r.linienzuege[0].punkte[18].y > 0.99); // bulge −1 = clockwise: arc above the chord
    assert.deepEqual(r.ignoriert, { "POLYLINE-NETZ": 1 });
  });

  it("Extrusion (0,0,−1): gespiegelter Kreisbogen landet bei −x", () => {
    const r = dxfPlangrundlage(dxf({ header: insunits(6), ents: ["0", "ARC", "8", "B", "10", 5, "20", 0, "40", 1, "50", 0, "51", 90, "210", 0, "220", 0, "230", -1] }));
    const b = r.boegen[0];
    nah(b.mx, -5); nah(b.my, 0);
    // OCS 0..90° mirrored in x → world 90..180°
    nah(b.start, Math.PI / 2); nah(b.ende, Math.PI);
  });
});

describe("dxfPlangrundlage — Texte", () => {
  it("TEXT: Position, Höhe, Drehung (Grad → Radiant), Sonderzeichen; ausgerichteter TEXT am Punkt 11/21", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(4),
      ents: [
        "0", "TEXT", "8", "T", "10", 1000, "20", 2000, "40", 250, "50", 90, "1", "Text A %%c12",
        "0", "TEXT", "8", "T", "10", 0, "20", 0, "11", 500, "21", 600, "40", 100, "72", 1, "1", "Text B",
      ],
    }));
    const [a, b] = r.texte;
    assert.equal(a.text, "Text A Ø12");
    nah(a.x, 1); nah(a.y, 2); nah(a.hoehe, 0.25); nah(a.drehung, Math.PI / 2);
    nah(b.x, 0.5); nah(b.y, 0.6);
  });

  it("MTEXT: Formatcodes werden Klartext, Richtungsvektor 11/21 bestimmt die Drehung", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: ["0", "MTEXT", "8", "T", "10", 3, "20", 4, "40", 0.5, "11", 0, "21", 1, "3", "{\\fArial|b1;Text C}\\P", "1", "\\H0.7x;Zeile 2"],
    }));
    const t = r.texte[0];
    assert.equal(t.text, "Text C\nZeile 2");
    nah(t.drehung, Math.PI / 2);
  });

  it("mtextKlartext: \\P, \\~, \\S-Stapel, \\U+, maskierte Klammern und Backslash", () => {
    assert.equal(mtextKlartext("A\\PB"), "A\nB");
    assert.equal(mtextKlartext("1\\~m"), "1 m");
    assert.equal(mtextKlartext("\\S1^2;"), "1/2");
    assert.equal(mtextKlartext("\\U+00B2"), "²");
    assert.equal(mtextKlartext("\\{x\\} \\\\ {\\C1;rot}"), "{x} \\ rot");
    assert.equal(mtextKlartext("\\LText\\l %%d"), "Text °");
    assert.equal(mtextKlartext("{\\pxqc;\\W0.8;Text D}"), "Text D");
  });

  it("leerer TEXT wird gezählt, nicht übernommen", () => {
    const r = dxfPlangrundlage(dxf({ header: insunits(6), ents: [...linie("A", 0, 0, 1, 1), "0", "TEXT", "8", "T", "10", 0, "20", 0, "1", "  "] }));
    assert.equal(r.texte.length, 0);
    assert.deepEqual(r.ignoriert, { "TEXT-LEER": 1 });
  });
});

describe("dxfPlangrundlage — Blöcke (INSERT)", () => {
  const blk = block("Test-Block", 1, 1, [...linie("0", 1, 1, 2, 1), "0", "TEXT", "8", "0", "10", 1, "20", 2, "40", 1, "1", "Text E"]);

  it("Einfügepunkt, Basispunkt, Drehung 90°, Skalierung 2; Ebene 0 erbt die INSERT-Ebene", () => {
    const r = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: blk, ents: insert("Test-Block", "Moebel", 10, 20, { sx: 2, sy: 2, rot: 90 }) }));
    const l = r.linienzuege[0];
    assert.equal(l.ebene, "Moebel");
    // base (1,1) → insert (10,20); local (1,0) ·2 rotated 90° = (0,2)
    nahPkt(l.punkte[0], 10, 20); nahPkt(l.punkte[1], 10, 22);
    const t = r.texte[0];
    nahPkt(t, 8, 20); // local (0,1)·2 rotated 90° = (−2,0)
    nah(t.hoehe, 2); nah(t.drehung, Math.PI / 2);
    assert.equal(t.ebene, "Moebel");
  });

  it("BYBLOCK-Farbe kommt vom INSERT; Spiegelung (sx = −1) dreht den Bogen richtig", () => {
    const b = block("Bogen-Block", 0, 0, ["0", "ARC", "8", "0", "62", 0, "10", 1, "20", 0, "40", 1, "50", 0, "51", 90]);
    const r = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: b, ents: insert("Bogen-Block", "X", 0, 0, { sx: -1, farbe: 2 }) }));
    const g = r.boegen[0];
    assert.equal(g.farbe, 2);
    nah(g.mx, -1); nah(g.r, 1);
    // 0..90° mirrored at the y axis → 90..180°
    nah(g.start, Math.PI / 2); nah(g.ende, Math.PI);
  });

  it("ungleiche Skalierung: Kreis wird zum geschlossenen Linienzug (Ellipse)", () => {
    const b = block("Kreis-Block", 0, 0, ["0", "CIRCLE", "8", "0", "10", 0, "20", 0, "40", 1]);
    const r = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: b, ents: insert("Kreis-Block", "X", 0, 0, { sx: 2, sy: 1 }) }));
    assert.equal(r.boegen.length, 0);
    const l = r.linienzuege[0];
    assert.equal(l.geschlossen, true);
    for (const p of l.punkte) nah((p.x / 2) ** 2 + p.y ** 2, 1, 1e-9);
    assert.deepEqual(r.bbox && [r.bbox.minX, r.bbox.maxX], [-2, 2]);
  });

  it("verschachtelte Blöcke werden aufgelöst; Selbstbezug endet an der Tiefengrenze statt zu hängen", () => {
    const innen = block("Innen", 0, 0, linie("0", 0, 0, 1, 0));
    const aussen = block("Aussen", 0, 0, insert("Innen", "0", 5, 0));
    const r = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: [...innen, ...aussen], ents: insert("Aussen", "E", 100, 0) }));
    nahPkt(r.linienzuege[0].punkte[0], 105, 0);
    assert.equal(r.linienzuege[0].ebene, "E");

    const schleife = block("Schleife", 0, 0, [...linie("0", 0, 0, 1, 0), ...insert("Schleife", "0", 1, 0)]);
    const s = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: schleife, ents: insert("Schleife", "E", 0, 0) }));
    assert.equal(s.linienzuege.length, 1); // the cycle guard stops at the first repeat
    assert.deepEqual(s.ignoriert, { "INSERT-ZU-TIEF": 1 });
    assert.ok(BLOECKE_MAX_TIEFE >= 4);
  });

  it("Tiefengrenze bei echter Verschachtelung ohne Zyklus", () => {
    /** @type {Array<string|number>} */
    const bl = [];
    const n = BLOECKE_MAX_TIEFE + 2;
    for (let k = 0; k < n; k++) bl.push(...block(`B${k}`, 0, 0, k === n - 1 ? linie("0", 0, 0, 1, 0) : insert(`B${k + 1}`, "0", 0, 0)));
    const r = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: bl, ents: insert("B0", "E", 0, 0) }));
    assert.equal(r.linienzuege.length, 0);
    assert.equal(r.ignoriert["INSERT-ZU-TIEF"], 1);
  });

  it("Attribute (ATTRIB nach INSERT) werden als Text gelesen; unsichtbare nicht; unbekannter Block gezählt", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      bloecke: block("Leer", 0, 0, ["0", "ATTDEF", "8", "0", "10", 0, "20", 0, "1", "", "2", "NR"]),
      ents: [
        "0", "INSERT", "8", "E", "66", 1, "2", "Leer", "10", 0, "20", 0,
        "0", "ATTRIB", "8", "E", "10", 3, "20", 4, "40", 1, "1", "Text F", "2", "NR", "70", 0,
        "0", "ATTRIB", "8", "E", "10", 3, "20", 4, "40", 1, "1", "Text G", "2", "X", "70", 1,
        "0", "SEQEND", "8", "E",
        ...insert("Fehlt", "E", 0, 0),
      ],
    }));
    assert.deepEqual(r.texte.map((t) => t.text), ["Text F"]);
    nahPkt(r.texte[0], 3, 4);
    assert.deepEqual(r.ignoriert, { "INSERT-OHNE-BLOCK": 1 });
  });

  it("MINSERT-Raster: 2 Spalten × 2 Zeilen", () => {
    const b = block("Punkt", 0, 0, linie("0", 0, 0, 0.1, 0));
    const r = dxfPlangrundlage(dxf({ header: insunits(6), bloecke: b, ents: ["0", "INSERT", "8", "E", "2", "Punkt", "10", 0, "20", 0, "70", 2, "71", 2, "44", 5, "45", 3] }));
    assert.deepEqual(r.linienzuege.map((l) => [l.punkte[0].x, l.punkte[0].y]), [[0, 0], [5, 0], [0, 3], [5, 3]]);
  });
});

describe("dxfPlangrundlage — Ignoriertes und Fehler", () => {
  it("unbekannte Objekte und Papierbereich werden gezählt und als Warnung genannt", () => {
    const r = dxfPlangrundlage(dxf({
      header: insunits(6),
      ents: [...linie("A", 0, 0, 1, 0), "0", "HATCH", "8", "A", "0", "HATCH", "8", "A", "0", "SPLINE", "8", "A", ...linie("A", 0, 0, 1, 0, [67, 1])],
    }));
    assert.equal(r.linienzuege.length, 1);
    assert.deepEqual(r.ignoriert, { HATCH: 2, SPLINE: 1, PAPIERBEREICH: 1 });
    assert.equal(meldungText(r.warnungen[r.warnungen.length - 1]), "4 Objekt(e) nicht gelesen (HATCH, PAPIERBEREICH, SPLINE).");
  });

  it("Fehler ergeben deutsche Meldungen, keinen Absturz", () => {
    assert.equal(dxfPlangrundlage("").fehler?.text, PLAN_MELDUNGEN.leer);
    assert.equal(dxfPlangrundlage(/** @type {any} */ (null)).fehler?.text, PLAN_MELDUNGEN.leer);
    assert.equal(dxfPlangrundlage("Hallo\nWelt\n").fehler?.text, PLAN_MELDUNGEN.keinDxf);
    assert.equal(dxfPlangrundlage("AutoCAD Binary DXF\r\n\u001a").fehler?.text, PLAN_MELDUNGEN.binaer);
    assert.equal(dxfPlangrundlage("0\r\nSECTION\r\n2\r\nHEADER\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n").fehler?.text, PLAN_MELDUNGEN.keineEntities);
    assert.equal(dxfPlangrundlage(dxf({ ents: ["0", "HATCH", "8", "A"] })).fehler?.text, PLAN_MELDUNGEN.nichtsLesbar);
    // garbage values: no exception, the line is counted as invalid
    const kaputt = dxfPlangrundlage(dxf({ header: insunits(6), ents: [...linie("A", 0, 0, 1, 0), "0", "LINE", "8", "A", "10", "abc", "20", 0, "11", 1, "21", 1, "0", "ARC", "8", "A", "10", 0, "20", 0, "40", -1] }));
    assert.equal(kaputt.fehler, null);
    assert.deepEqual(kaputt.ignoriert, { "LINE-UNGUELTIG": 1, "ARC-UNGUELTIG": 1 });
  });

  it("abgebrochene Datei: was davor stand, bleibt, mit Warnung", () => {
    const text = dxf({ header: insunits(6), ents: linie("A", 0, 0, 1, 0) }).replace("0\r\nEOF", "kaputt\r\nEOF");
    const r = dxfPlangrundlage(text);
    assert.equal(r.linienzuege.length, 1);
    assert.ok(r.warnungen.some((w) => w.text === PLAN_MELDUNGEN.abgebrochen));
  });

  it("Ergebnis ist serialisierbar (JSON-Rundlauf ohne Verlust)", () => {
    const r = dxfPlangrundlage(dxf({ header: insunits(6), ents: [...linie("A", 0, 0, 1, 0), "0", "CIRCLE", "8", "B", "10", 0, "20", 0, "40", 1] }));
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  });
});

describe("Hilfsfunktionen", () => {
  it("bulgePunkte: Bulge 0 = nur Endpunkt; Viertelkreis (tan 22,5°)", () => {
    assert.deepEqual(bulgePunkte({ x: 0, y: 0 }, { x: 1, y: 0 }, 0), [{ x: 1, y: 0 }]);
    const p = bulgePunkte({ x: 1, y: 0 }, { x: 0, y: 1 }, Math.tan(Math.PI / 8));
    assert.equal(p.length, 18); // 90° / 5°
    for (const q of p) nah(Math.hypot(q.x, q.y), 1, 1e-9);
  });

  it("planBbox: leer = null", () => {
    assert.equal(planBbox({}), null);
    assert.equal(bboxFlaeche(null), 0);
  });
});
