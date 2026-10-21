// Unit tests 104-06: DXF R12 writer (dxfR12.js) and the plan adapters (dxfPlaene.js) — site
// plan and floor plan. The file is checked with a small pair parser of its own (independent of
// the app's reader) plus the app's reader for the round trip. Hand-computed expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dxfR12, dxfZahl, dxfEbenenName, dxfBytes, linientypenFuer, stiftFarbe } from "@core/lib/plan/dxfR12.js";
import { dxfLesen } from "@core/lib/plan/dxfLesen.js";
import { lageplanDxfDaten, grundrissDxfDaten, dxfDatei, dxfDateiname, BEZUG_KENNUNG } from "@designer/lib/dxfPlaene";
import { planGrafik } from "@designer/lib/vektorPlan";

/** Independent pair parser: [code, value] per two lines; asserts CRLF and an even line count. */
function paare(/** @type {string} */ text) {
  assert.ok(text.endsWith("\r\n"), "file ends with CRLF");
  assert.ok(!/[^\r]\n/.test(text), "only CRLF line ends");
  const z = text.slice(0, -2).split("\r\n");
  assert.equal(z.length % 2, 0, "even line count");
  /** @type {Array<[number, string]>} */
  const p = [];
  for (let i = 0; i < z.length; i += 2) { assert.match(z[i], /^-?\d+$/, `group code in line ${i + 1}`); p.push([Number(z[i]), z[i + 1]]); }
  return p;
}
/** Entities (type + groups) of the ENTITIES section. */
function entities(/** @type {Array<[number, string]>} */ p) {
  const start = p.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && p[i - 1][1] === "SECTION");
  /** @type {Array<{typ: string, g: Array<[number, string]>}>} */
  const out = [];
  for (let i = start + 1; i < p.length; i++) {
    const [c, v] = p[i];
    if (c === 0) { if (v === "ENDSEC") break; out.push({ typ: v, g: [] }); } else out[out.length - 1].g.push([c, v]);
  }
  return out;
}
const wert = (/** @type {Array<[number, string]>} */ g, /** @type {number} */ c) => g.find(([k]) => k === c)?.[1];

describe("dxfR12 — writer", () => {
  const datei = dxfR12({
    ebenen: [{ name: "Grundstück", farbe: 7 }, { name: "Aus", farbe: 3, aus: true, gesperrt: true }],
    linientypen: linientypenFuer(100),
    kommentar: ["Test"],
    elemente: [
      { art: "linie", ebene: "Grundstück", a: { x: 0, y: 0 }, b: { x: 10, y: 5 } },
      { art: "polylinie", ebene: "Grundstück", punkte: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], geschlossen: true },
      { art: "text", ebene: "Text", x: 2, y: 1, text: "Fläche 12 m²", hoehe: 0.25 },
      { art: "flaeche", ebene: "Poche", punkte: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { art: "linie", ebene: "X", a: { x: NaN, y: 0 }, b: { x: 1, y: 1 } },
      { art: "polylinie", ebene: "X", punkte: [{ x: 0, y: 0 }] },
    ],
  });
  const p = paare(datei.text);

  it("Kopf/Ende: 999-Kommentar, Abschnitte, EOF; CRLF und gerade Zeilenzahl", () => {
    assert.deepEqual(p[0], [999, "Test"]);
    assert.deepEqual(p[p.length - 1], [0, "EOF"]);
    const abschnitte = p.filter(([c], i) => c === 2 && p[i - 1][1] === "SECTION").map(([, v]) => v);
    assert.deepEqual(abschnitte, ["HEADER", "TABLES", "ENTITIES"]);
    assert.equal(datei.uebersprungen, 2);
  });

  it("HEADER: $ACADVER AC1009, $DWGCODEPAGE ANSI_1252, $INSUNITS 6, $EXTMIN/$EXTMAX", () => {
    const nach = (/** @type {string} */ v) => p[p.findIndex(([c, x]) => c === 9 && x === v) + 1];
    assert.deepEqual(nach("$ACADVER"), [1, "AC1009"]);
    assert.deepEqual(nach("$DWGCODEPAGE"), [3, "ANSI_1252"]);
    assert.deepEqual(nach("$INSUNITS"), [70, "6"]);
    assert.deepEqual(nach("$EXTMAX"), [10, "10"]);
    assert.deepEqual(nach("$EXTMIN"), [10, "0"]);
  });

  it("LAYER-Tabelle: „0“ immer, Namen R12-tauglich, aus = negative Farbe, gesperrt = Flag 4; Linientypen", () => {
    const layer = [];
    for (let i = 0; i < p.length; i++) if (p[i][0] === 0 && p[i][1] === "LAYER") layer.push({ name: p[i + 1][1], flags: p[i + 2][1], farbe: p[i + 3][1], lt: p[i + 4][1] });
    assert.deepEqual(layer.map((l) => l.name), ["0", "GRUNDSTUECK", "AUS", "TEXT", "POCHE"]); // "X" only had skipped elements
    assert.deepEqual(layer.find((l) => l.name === "AUS"), { name: "AUS", flags: "4", farbe: "-3", lt: "CONTINUOUS" });
    const lts = p.filter(([c], i) => c === 2 && p[i - 1][1] === "LTYPE").map(([, v]) => v);
    assert.deepEqual(lts, ["CONTINUOUS", "STRICH", "STRICHPUNKT", "PUNKT"]);
  });

  it("LINE mit 10/20/11/21; POLYLINE + VERTEX + SEQEND, nie LWPOLYLINE; geschlossen = 70 1", () => {
    const e = entities(p);
    assert.deepEqual(e.map((x) => x.typ), ["LINE", "POLYLINE", "VERTEX", "VERTEX", "VERTEX", "SEQEND", "TEXT", "SOLID"]);
    assert.equal(wert(e[0].g, 11), "10"); assert.equal(wert(e[0].g, 21), "5");
    assert.equal(wert(e[1].g, 66), "1"); assert.equal(wert(e[1].g, 70), "1");
    assert.equal(wert(e[3].g, 10), "4");
    assert.ok(!datei.text.includes("LWPOLYLINE"));
  });

  it("TEXT mittig (72 4 + Ausrichtpunkt 11/21), SOLID in R12-Eckreihenfolge p0 p1 p3 p2", () => {
    const e = entities(p);
    const text = e.find((x) => x.typ === "TEXT");
    assert.equal(wert(text?.g || [], 72), "4");
    assert.equal(wert(text?.g || [], 11), "2"); assert.equal(wert(text?.g || [], 21), "1");
    assert.equal(wert(text?.g || [], 1), "Fläche 12 m²");
    const solid = /** @type {any} */ (e.find((x) => x.typ === "SOLID")).g;
    assert.deepEqual([wert(solid, 12), wert(solid, 22), wert(solid, 13), wert(solid, 23)], ["0", "1", "1", "1"]);
  });

  it("dxfZahl: Festkomma, kein Exponent, höchstens 6 Nachkommastellen, -0 → 0, NaN wirft", () => {
    assert.equal(dxfZahl(1.5), "1.5");
    assert.equal(dxfZahl(1e-7), "0");
    assert.equal(dxfZahl(-0.0000001), "0");
    assert.equal(dxfZahl(1234567.1234567), "1234567.123457");
    assert.throws(() => dxfZahl(2e21), RangeError); // toFixed would switch to an exponent
    assert.throws(() => dxfZahl(NaN), RangeError);
  });

  it("dxfEbenenName: Umlaute, Großschrift, Sonderzeichen, Länge ≤ 31, leer → 0", () => {
    assert.equal(dxfEbenenName("Grundstück"), "GRUNDSTUECK");
    assert.equal(dxfEbenenName("Außen wand/neu"), "AUSSEN_WAND_NEU");
    assert.equal(dxfEbenenName("x".repeat(40)).length, 31);
    assert.equal(dxfEbenenName(""), "0");
  });

  it("dxfBytes: Windows-1252 (m² → 0xB2, ä → 0xE4, € → 0x80), nicht abbildbar → „?“", () => {
    assert.deepEqual([...dxfBytes("m²ä€→")], [0x6d, 0xb2, 0xe4, 0x80, 0x3f]);
  });

  it("Linientypen skalieren mit dem Maßstab; Stiftfarbe je Linienbreite", () => {
    assert.deepEqual(linientypenFuer(100)[0].muster.map((v) => Math.round(v * 1000) / 1000), [0.6, -0.2]);
    assert.deepEqual(linientypenFuer(500)[0].muster.map((v) => Math.round(v * 1000) / 1000), [3, -1]);
    assert.deepEqual([0.7, 0.5, 0.35, 0.25, 0.18, 0.13].map(stiftFarbe), [6, 7, 4, 3, 8, 9]);
  });

  it("eigener Linientyp je Element nur, wenn in der LTYPE-Tabelle", () => {
    const t = dxfR12({ linientypen: linientypenFuer(100), elemente: [
      { art: "linie", ebene: "A", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, linientyp: "Strich" },
      { art: "linie", ebene: "A", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, linientyp: "GIBTSNICHT" },
    ] }).text;
    const e = entities(paare(t));
    assert.equal(wert(e[0].g, 6), "STRICH");
    assert.equal(wert(e[1].g, 6), undefined);
  });
});

const LOC = { lat: 49.4521, lng: 11.0767 };
const PARZELLE = [{ x: 560, y: 360 }, { x: 640.5, y: 362.25 }, { x: 650, y: 430 }, { x: 600, y: 455.75 }, { x: 555, y: 420 }];

describe("lageplanDxfDaten — Lageplan", () => {
  it("Spiegelung: Ursprung = Standort (600/400), y nach Norden; Maßstab m_per_px; Bezugs-Kommentar", () => {
    const d = lageplanDxfDaten({ location: LOC, site_parcel: { assumed: false, m_per_px: 2, points: PARZELLE } });
    const g = d.elemente.find((e) => e.art === "polylinie" && e.ebene === "GRUNDSTUECK");
    assert.ok(g && g.art === "polylinie");
    if (g?.art === "polylinie") assert.deepEqual(g.punkte[0], { x: -80, y: 80 });
    assert.ok(d.kommentar.some((k) => k === `${BEZUG_KENNUNG} 49.4521000 11.0767000`));
    assert.equal(d.leer, false);
  });

  it("geschätztes Grundstück (assumed) wird nicht gezeichnet; ohne Standort kein Bezug", () => {
    const d = lageplanDxfDaten({ site_parcel: { assumed: true, m_per_px: 1.25, points: PARZELLE } });
    assert.equal(d.elemente.length, 0);
    assert.equal(d.leer, true);
    assert.ok(!d.kommentar.some((k) => k.startsWith(BEZUG_KENNUNG)));
  });

  it("Baukörper gedreht (Ecken in m), Baufeld/Footprint auf eigenen Ebenen, Riegel mit Flur und WE", () => {
    const d = lageplanDxfDaten({
      location: LOC,
      site_parcel: { assumed: false, m_per_px: 1, points: PARZELLE },
      designated_areas: [{ id: "a", type: "baufeld", points: [{ x: 570, y: 370 }, { x: 630, y: 370 }, { x: 630, y: 420 }] }, { id: "b", type: "footprint", points: [{ x: 580, y: 380 }, { x: 590, y: 380 }, { x: 590, y: 390 }] }],
      buildings: [{ id: "h", x: 590, y: 390, width: 20, height: 10, floors: 3, drehung_grad: 90 }],
      riegel: [{ id: "r", punkte: [{ x: 560, y: 440 }, { x: 640, y: 440 }], opt: { geschosse: 3 } }],
    });
    const ebenen = new Set(d.elemente.map((e) => e.ebene));
    for (const n of ["GRUNDSTUECK", "BAUFELD", "BAUKOERPER", "BESCHRIFTUNG", "RIEGEL_FLUR", "RIEGEL_WE"]) assert.ok(ebenen.has(n), n);
    const haus = d.elemente.filter((e) => e.art === "polylinie" && e.ebene === "BAUKOERPER").pop();
    // 20 × 10 m around the centre (600/395 canvas → 0/5 m north), turned by 90°: 10 wide, 20 deep.
    if (haus?.art === "polylinie") {
      const xs = haus.punkte.map((q) => q.x), ys = haus.punkte.map((q) => q.y);
      assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 10) < 1e-9);
      assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 20) < 1e-9);
      assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 5) < 1e-9);
    } else assert.fail("building outline missing");
    const text = d.elemente.find((e) => e.art === "text" && e.text.startsWith("Baukörper 1"));
    assert.ok(text && text.art === "text" && text.text.endsWith("3 G"));
  });

  it("Datei: liest sich mit dem eigenen Leser wieder ein (Ebenen, $INSUNITS, Bezug)", () => {
    const { text, bytes } = dxfDatei(lageplanDxfDaten({ location: LOC, site_parcel: { assumed: false, m_per_px: 1.25, points: PARZELLE } }));
    assert.equal(bytes.length, text.length); // one byte per character (Windows-1252)
    const r = dxfLesen(text);
    assert.equal(r.fehler, null);
    assert.equal(r.einheit, 6);
    assert.equal(r.polylinien.filter((p) => p.ebene === "GRUNDSTUECK" && p.geschlossen).length, 1);
    assert.ok(r.kommentare.some((k) => k.startsWith(BEZUG_KENNUNG)));
    // A byte order mark in front (editors saving as "UTF-8 with BOM") does not break the reader.
    assert.equal(dxfLesen(String.fromCharCode(0xfeff) + text).fehler, null);
  });

  it("Dateiname: Sonderzeichen ersetzt, leer → Projekt", () => {
    assert.equal(dxfDateiname("Haus am See", "Grundriss EG"), "Haus_am_See_Grundriss_EG.dxf");
    assert.equal(dxfDateiname("", "Lageplan"), "Projekt_Lageplan.dxf");
  });
});

describe("grundrissDxfDaten — Grundriss aus planGrafik", () => {
  const grafik = planGrafik({
    model: { walls: [] }, level: 0, massstab: 100,
    customWalls: [{ a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, thickness: 0.24 }],
    customColumns: [{ x: 2, z: 3, size: 0.4, level: 0 }],
    customSlabs: [{ level: 0, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] }],
    customZones: [{ level: 0, name: "Wohnen", points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] }],
  });

  it("planGrafik trägt die Ebene je Element (rückwärtskompatibles Feld)", () => {
    assert.deepEqual([...new Set(grafik.elemente.map((e) => e.ebene))].sort(), ["decke", "raum_text", "stuetze", "wand"]);
  });

  it("Ebenen A_WAND/A_STUETZE/A_DECKE/A_RAUM_TEXT + Poché als SOLID; y = −z; Decke gestrichelt", () => {
    const d = grundrissDxfDaten(grafik, { massstab: 100, geschoss: "EG", projekt: "Test" });
    const namen = d.ebenen.map((e) => e.name).sort();
    assert.deepEqual(namen, ["A_DECKE", "A_RAUM_TEXT", "A_STUETZE", "A_WAND", "A_WAND_POCHE"]);
    assert.equal(d.ebenen.find((e) => e.name === "A_DECKE")?.linientyp, "STRICH");
    assert.equal(d.ebenen.find((e) => e.name === "A_WAND")?.farbe, 7); // 0.5 mm at 1:100
    assert.equal(d.elemente.filter((e) => e.art === "flaeche").length, 2); // wall + column
    const raum = d.elemente.find((e) => e.art === "text");
    assert.ok(raum && raum.art === "text" && raum.y === -2 && Math.abs(raum.hoehe - 0.25) < 1e-12);
    const { text } = dxfDatei(d);
    assert.ok(text.includes("\r\nSOLID\r\n") && !text.includes("LWPOLYLINE"));
  });

  it("Schnappschuss: ENTITIES einer Stütze 1:100 sind byte-gleich", () => {
    const g = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customColumns: [{ x: 1, z: 1, size: 0.4, level: 0 }] });
    const { text } = dxfDatei(grundrissDxfDaten(g, { massstab: 100 }));
    const ent = text.slice(text.indexOf("ENTITIES\r\n") + 10, text.indexOf("ENDSEC\r\n0\r\nEOF"));
    const erwartet = [
      "0", "POLYLINE", "8", "A_STUETZE", "66", "1", "10", "0", "20", "0", "30", "0", "70", "1",
      "0", "VERTEX", "8", "A_STUETZE", "10", "0.8", "20", "-0.8", "30", "0",
      "0", "VERTEX", "8", "A_STUETZE", "10", "1.2", "20", "-0.8", "30", "0",
      "0", "VERTEX", "8", "A_STUETZE", "10", "1.2", "20", "-1.2", "30", "0",
      "0", "VERTEX", "8", "A_STUETZE", "10", "0.8", "20", "-1.2", "30", "0",
      "0", "SEQEND", "8", "A_STUETZE",
      "0", "SOLID", "8", "A_WAND_POCHE", "10", "0.8", "20", "-0.8", "30", "0", "11", "1.2", "21", "-0.8", "31", "0",
      "12", "0.8", "22", "-1.2", "32", "0", "13", "1.2", "23", "-1.2", "33", "0",
      "0", "",
    ].join("\r\n");
    assert.equal(ent, erwartet);
  });
});
