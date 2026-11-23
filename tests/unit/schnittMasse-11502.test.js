// 115-02 (finding W-1115-05): dimension texts of the building section without overlap, decimal comma everywhere.
//  - one layout (schnittMasse.js) feeds the screen section (BimPlan2D mode "schnitt", rendered server-side through vite) and the
//    PDF/DXF primitives (vektorPlan.schnittGrafik): for a single-family house with basement, two storeys, gable roof and knee wall,
//    the house of the finding (storey 2,41 m, knee wall 0,75 m), buildings with thin slabs / short pieces and many storeys NO two
//    text boxes overlap — on screen every <text> of the section (marks, chains, ground label, scale bar), on the sheet every text
//    element at 1:50 … 1:500;
//  - German number format: no decimal point in any dimension text of section and floor plan; level marks with sign
//    ("±0,00", "+2,75", "−2,60");
//  - the rules of the layout: number beside the chain with a leader when its piece is too short, the name "Kniestock" as its own
//    text, close level marks above / below their level, numbers and marks left out (and counted) only where nothing fits.
// Text boxes are estimated as everywhere in the plan code: width = characters × 0,55 × font height; height = font height (0,8 above
// the baseline, 0,2 below). Invented models, no real project.
//
// In:  schnittMasse.js, vektorPlan.js, dxfPlaene.js, BimPlan2D.jsx, useBuildingProgram.fmtLen. Out: assertions only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createBuildingModel } from "@core/lib/buildingModel";
import { globalesDach } from "@core/lib/bauteil/dachGeometrie.js";
import { fmtLen } from "@core/lib/useBuildingProgram";
import { schnittGrafik, vektorPlanPdf, koteText, winAnsi } from "@designer/lib/vektorPlan";
import { grundrissDxfDaten } from "@designer/lib/dxfPlaene";
import { schnittMassInhalt, schnittMassLayout, rahmenVon, koteText as koteTextQuelle } from "@designer/lib/schnittMasse";
import { jsxUmgebung } from "./helpers/jsxRender.mjs";
import { EFH_108, efhModell, efhModellMitKniestock } from "./fixtures/efh-108.js";

const RECHTECK = (/** @type {number} */ b, /** @type {number} */ t) => [{ x: -b / 2, z: -t / 2 }, { x: b / 2, z: -t / 2 }, { x: b / 2, z: t / 2 }, { x: -b / 2, z: t / 2 }];
const OHNE_ATTIKA = { parapet: { enabled: false, height: 0 } };

/**
 * The section cases: model, roof form of the studio (null = flat) and section axis.
 * @type {Record<string, {model: any, storeyHeight: number, dachform: [string, number]|null, achse: "x"|"z"}>}
 */
const FAELLE = {
  "EFH mit Keller, 2 Geschosse, Satteldach 45°, Kniestock 1,00 (B-B)": { model: efhModellMitKniestock(1, OHNE_ATTIKA), storeyHeight: 2.9, dachform: ["sattel", 45], achse: "z" },
  "EFH mit Keller, Satteldach, Kniestock und Attika an (A-A)": { model: efhModellMitKniestock(1), storeyHeight: 2.9, dachform: ["sattel", 45], achse: "x" },
  "EFH mit Keller, Satteldach ohne Kniestock (B-B)": { model: efhModell(OHNE_ATTIKA), storeyHeight: 2.9, dachform: ["sattel", 45], achse: "z" },
  "Befund W-1115-05: Geschosshöhe 2,41, Kniestock 0,75, Sattel 45°": {
    model: createBuildingModel({ footprintM: RECHTECK(10, 8), storeys: 2, storeyHeight: 2.41, dachform: "sattel", dachneigung: 45, ...OHNE_ATTIKA,
      geschosse: [{ level: 0, name: "EG", hoehe_m: 2.41 }, { level: 1, name: "DG", hoehe_m: 2.41, kniestock_m: 0.75 }] }),
    storeyHeight: 2.41, dachform: ["sattel", 45], achse: "z",
  },
  "dünne Decken, Kniestock 0,25, Satteldach 30°": {
    model: createBuildingModel({ footprintM: RECHTECK(9, 7), storeys: 2, storeyHeight: 2.5, deckenDicke: 0.12, dachform: "sattel", dachneigung: 30, ...OHNE_ATTIKA,
      geschosse: [{ level: 0, name: "EG", hoehe_m: 2.5 }, { level: 1, name: "DG", hoehe_m: 2.3, kniestock_m: 0.25 }] }),
    storeyHeight: 2.5, dachform: ["sattel", 30], achse: "z",
  },
  "kurze Stücke: Technikgeschoss 0,80, Attika 0,30, Flachdach, Keller": {
    model: createBuildingModel({ footprintM: RECHTECK(14, 10), storeys: 3, storeyHeight: 2.75, untergeschosse: 1, parapet: { enabled: true, height: 0.3 },
      geschosse: [{ level: -1, name: "UG", hoehe_m: 2.4 }, { level: 0, name: "EG", hoehe_m: 2.75 }, { level: 1, name: "1. OG", hoehe_m: 2.75 }, { level: 2, name: "Technik", hoehe_m: 0.8 }] }),
    storeyHeight: 2.75, dachform: null, achse: "x",
  },
  "12 Geschosse, 2 Untergeschosse, Attika 1,00": {
    model: createBuildingModel({ footprintM: RECHTECK(24, 14), storeys: 12, storeyHeight: 3, untergeschosse: 2, parapet: { enabled: true, height: 1 } }),
    storeyHeight: 3, dachform: null, achse: "x",
  },
  "40 Geschosse, 3 Untergeschosse, Attika 0,50": {
    model: createBuildingModel({ footprintM: RECHTECK(30, 30), storeys: 40, storeyHeight: 2.8, untergeschosse: 3, parapet: { enabled: true, height: 0.5 } }),
    storeyHeight: 2.8, dachform: null, achse: "x",
  },
};
const dachVon = (/** @type {{model: any, dachform: [string, number]|null}} */ f) => (f.dachform ? globalesDach(f.model, f.dachform[0], f.dachform[1]) : null);

/** @typedef {{x0: number, x1: number, y0: number, y1: number, text: string}} Rahmen */
/** Pairs of boxes that overlap (touching is no overlap). */
function ueberlappungen(/** @type {Rahmen[]} */ r) {
  /** @type {string[]} */
  const paare = [];
  for (let i = 0; i < r.length; i += 1) for (let j = i + 1; j < r.length; j += 1) {
    const a = r[i], b = r[j];
    if (a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9) paare.push(`„${a.text}“ × „${b.text}“`);
  }
  return paare;
}

/** Text boxes of a section graphic in metres (x, z down): anchor = middle of the glyph height (vektorPlanPdf), k = m per paper mm. */
function rahmenDerGrafik(/** @type {any} */ g, /** @type {number} */ massstab) {
  const k = massstab / 1000;
  return g.elemente.filter((/** @type {any} */ e) => e.art === "text").map((/** @type {any} */ e) => {
    const h = e.groesse_mm * k, w = String(e.text).length * 0.55 * h;
    if (e.drehung_grad) { const xb = e.x + h / 3; return { x0: xb - 0.8 * h, x1: xb + 0.2 * h, y0: e.z - w / 2, y1: e.z + w / 2, text: e.text }; }
    const zb = e.z + h / 3, x0 = e.ausrichtung === "rechts" ? e.x - w : e.ausrichtung === "links" ? e.x : e.x - w / 2;
    return { x0, x1: x0 + w, y0: zb - 0.8 * h, y1: zb + 0.2 * h, text: e.text };
  });
}

/** Every <text> of a rendered SVG with its attributes and its box in viewBox px. */
function svgTexte(/** @type {string} */ svg) {
  return [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map(([, attr, text]) => {
    const a = (/** @type {string} */ n) => (new RegExp(`(?:^| )${n}="([^"]*)"`).exec(attr) || [])[1];
    const x = Number(a("x")), y = Number(a("y")), fs = Number(a("font-size")), w = text.length * 0.55 * fs;
    const gedreht = /rotate\(-90 /.test(a("transform") || "");
    const anker = a("text-anchor") || "start";
    const x0 = anker === "end" ? x - w : anker === "middle" ? x - w / 2 : x;
    /** @type {Rahmen} */
    const rahmen = gedreht ? { x0: x - 0.8 * fs, x1: x + 0.2 * fs, y0: y - w / 2, y1: y + w / 2, text } : { x0, x1: x0 + w, y0: y - 0.8 * fs, y1: y + 0.2 * fs, text };
    return { text, kote: a("data-kote"), gedreht, rahmen };
  });
}

describe("115-02 Zahlformat: Dezimalkomma, Koten mit Vorzeichen", () => {
  it("fmtLen: Komma in Metern, cm/mm ohne Nachkommastelle und ohne Tausenderpunkt", () => {
    assert.equal(fmtLen(2.75), "2,75 m");
    assert.equal(fmtLen(2.75, "m", false), "2,75");
    assert.equal(fmtLen(11.4), "11,40 m");
    assert.equal(fmtLen(2.75, "cm"), "275 cm");
    assert.equal(fmtLen(12, "mm"), "12000 mm");
    assert.equal(fmtLen(0.005, "m", false), "0,01");
  });

  it("koteText: ±0,00, +2,75, −2,60 (Minuszeichen U+2212); eine Quelle für Bildschirm und Blatt", () => {
    assert.equal(koteText, koteTextQuelle, "vektorPlan reicht die Funktion von schnittMasse.js weiter");
    assert.equal(koteText(0), "±0,00");
    assert.equal(koteText(2.75), "+2,75");
    assert.equal(koteText(-2.6), "−2,60");
    assert.equal(koteText(-0.004), "±0,00");
    assert.equal(koteText(12.345), "+12,35");
    assert.equal(koteText(-2.6).codePointAt(0), 0x2212);
  });

  it("PDF: das Minuszeichen ist in WinAnsi nicht kodierbar und wird zum Halbgeviertstrich (kein „?“)", () => {
    assert.equal(winAnsi("−2,60  UG"), "–2,60  UG");
    assert.equal(winAnsi("±0,00"), "±0,00");
  });
});

describe("115-02 Schnitt als Vektorgrafik (PDF/DXF): keine Textüberlappung, Dezimalkomma", () => {
  for (const [name, f] of Object.entries(FAELLE)) {
    it(name, () => {
      for (const massstab of [50, 100, 200, 500]) {
        const g = schnittGrafik({ model: f.model, storeyHeight: f.storeyHeight, massstab, dach: dachVon(f), achse: f.achse });
        const texte = g.elemente.filter((/** @type {any} */ e) => e.art === "text");
        assert.deepEqual(ueberlappungen(rahmenDerGrafik(g, massstab)), [], `1:${massstab}`);
        for (const e of texte) assert.doesNotMatch(e.text, /\d\.\d/, `1:${massstab}: Dezimalpunkt in „${e.text}“`);
        const koten = texte.filter((/** @type {any} */ e) => e.ebene === "kote");
        assert.ok(koten.length >= 2, `1:${massstab}: Koten vorhanden`);
        for (const e of koten) assert.match(e.text, /^(±0,00|[+−]\d+,\d{2})( {2}\S.*)?$/u, `1:${massstab}: Kote „${e.text}“`);
        assert.ok(koten.some((/** @type {any} */ e) => e.text.startsWith("±0,00")), `1:${massstab}: Kote ±0,00 bleibt`);
        const zahlen = texte.filter((/** @type {any} */ e) => e.ebene === "bemassung" && e.text !== "Kniestock");
        assert.ok(zahlen.length >= 2, `1:${massstab}: Maßzahlen vorhanden`);
        for (const e of zahlen) assert.match(e.text, /^\d+,\d{2}$/, `1:${massstab}: Maßzahl „${e.text}“`);
        // every text lies inside the bbox the sheet is sized from
        const b = /** @type {{x0: number, z0: number, x1: number, z1: number}} */ (g.bbox);
        for (const r of rahmenDerGrafik(g, massstab)) assert.ok(r.x0 >= b.x0 - 0.3 * 2.5 * massstab / 1000 && r.x1 <= b.x1 + 0.3 * 2.5 * massstab / 1000, `1:${massstab}: „${r.text}“ in der bbox`);
      }
    });
  }

  it("EFH 1:100: nichts ausgelassen — Kniestock als eigener Text neben dem Maß, Geschosskette 2,75 | 2,90 | 2,60, Gesamt 2,75 | 9,25", () => {
    const f = FAELLE["EFH mit Keller, 2 Geschosse, Satteldach 45°, Kniestock 1,00 (B-B)"];
    const g = schnittGrafik({ model: f.model, storeyHeight: 2.9, massstab: 100, dach: dachVon(f), achse: "z" });
    const mass = g.elemente.filter((/** @type {any} */ e) => e.art === "text" && e.ebene === "bemassung");
    assert.deepEqual(mass.map((/** @type {any} */ e) => e.text), ["1,00", "Kniestock", "2,75", "2,90", "2,60", "2,75", "9,25", "10,20"]);
    // numbers of the vertical chains stand above the line and read from the right; the name is horizontal
    assert.deepEqual(mass.map((/** @type {any} */ e) => e.drehung_grad || 0), [-90, 0, -90, -90, -90, -90, -90, 0]);
    // three chains at growing distance from the right wall (x = 5,10 m in B-B): 3 text heights = 7,5 mm on paper = 0,75 m at 1:100
    const ketten = [...new Set(g.elemente.filter((/** @type {any} */ e) => e.ebene === "bemassung" && e.art === "poly" && e.pts.length === 2 && e.pts[0].x === e.pts[1].x && e.pts[0].x > 5.1).map((/** @type {any} */ e) => Math.round(e.pts[0].x * 1000) / 1000))];
    assert.equal(ketten.length, 3, `Kettenlagen ${ketten}`);
    assert.ok(Math.abs(ketten[0] - 5.85) < 1e-9 && ketten[1] > ketten[0] + 0.7 && Math.abs(ketten[2] - ketten[1] - 0.75) < 1e-9, `Kettenlagen ${ketten}`);
    const koten = g.elemente.filter((/** @type {any} */ e) => e.art === "text" && e.ebene === "kote").map((/** @type {any} */ e) => e.text);
    assert.deepEqual(koten, ["±0,00  EG", "+2,90  DG", "−2,75  KG", "+4,15  Traufe", "+9,25  First"]);
  });

  it("Befund W-1115-05 bei 1:200: „0,75“ steht neben der Kette (Hinweislinie), „Kniestock“ getrennt daneben", () => {
    const f = FAELLE["Befund W-1115-05: Geschosshöhe 2,41, Kniestock 0,75, Sattel 45°"];
    const g = schnittGrafik({ model: f.model, storeyHeight: 2.41, massstab: 200, dach: dachVon(f), achse: "z" });
    const mass = g.elemente.filter((/** @type {any} */ e) => e.art === "text" && e.ebene === "bemassung");
    const zahl = mass.find((/** @type {any} */ e) => e.text === "0,75"), name = mass.find((/** @type {any} */ e) => e.text === "Kniestock");
    assert.ok(zahl && name);
    assert.ok(!zahl.drehung_grad && zahl.ausrichtung === "links" && name.ausrichtung === "links", "waagerecht neben der Kette");
    assert.ok(name.x > zahl.x + 4 * 0.55 * 2.5 * 0.2, "Name beginnt hinter der Zahl");
    assert.ok(Math.abs(zahl.z - name.z) < 1e-9, "eine Zeile");
  });

  it("PDF mit gedrehten Maßzahlen und Minus-Kote wird geschrieben; die DXF-Daten tragen die Drehung (90° gegen den Uhrzeigersinn)", async () => {
    const f = FAELLE["EFH mit Keller, 2 Geschosse, Satteldach 45°, Kniestock 1,00 (B-B)"];
    const g = schnittGrafik({ model: f.model, storeyHeight: 2.9, massstab: 100, dach: dachVon(f), achse: "z" });
    const { bytes, format } = await vektorPlanPdf(g, { massstab: 100, projekt: "Testhaus", planinhalt: "Schnitt B-B", datum: "15.11.2026" });
    assert.equal(format, "A3");
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    const dxf = grundrissDxfDaten(g, { massstab: 100 });
    const gedreht = dxf.elemente.filter((/** @type {any} */ e) => e.art === "text" && e.drehung_grad);
    assert.ok(gedreht.length >= 5);
    for (const e of gedreht) assert.equal(/** @type {any} */ (e).drehung_grad, 90);
  });

  it("Ebenen: ohne „dimensions“ keine Ketten, ohne „labels“ keine Koten — die jeweils andere Seite bleibt gleich", () => {
    const f = FAELLE["EFH mit Keller, 2 Geschosse, Satteldach 45°, Kniestock 1,00 (B-B)"];
    const basis = { model: f.model, storeyHeight: 2.9, massstab: 100, dach: dachVon(f), achse: /** @type {"z"} */ ("z") };
    const alle = schnittGrafik(basis), ohneMass = schnittGrafik({ ...basis, layerVis: { dimensions: false } }), ohneKoten = schnittGrafik({ ...basis, layerVis: { labels: false } });
    const ebene = (/** @type {any} */ g, /** @type {string} */ eb) => JSON.stringify(g.elemente.filter((/** @type {any} */ e) => e.ebene === eb));
    assert.equal(ohneMass.elemente.filter((/** @type {any} */ e) => e.ebene === "bemassung").length, 0);
    assert.equal(ohneKoten.elemente.filter((/** @type {any} */ e) => e.ebene === "kote").length, 0);
    assert.equal(ebene(ohneMass, "kote"), ebene(alle, "kote"));
    assert.equal(ebene(ohneKoten, "bemassung"), ebene(alle, "bemassung"));
  });
});

describe("115-02 Regeln der Platzierung (schnittMasse.js)", () => {
  const koteMit = (/** @type {any[]} */ koten) => koten.map((k) => ({ ...k, text: `${k.name || k.art} ${koteText(k.h_m)}` }));

  it("Inhalt: Detail (Kniestock, Attika) → Geschosse → Gesamt; nie zweimal dieselbe Kette", () => {
    const efh = schnittMassInhalt({ storeys: [{ level: 0, elevation: 0, name: "EG" }, { level: 1, elevation: 2.9, name: "DG" }, { level: -1, elevation: -2.75, name: "KG" }],
      totalH_m: 5.5, wandOben_m: 4.15, kniestock_m: 1, attika_m: 0, dachLinie: { traufe_m: 4.15, first_m: 9.25 } });
    assert.deepEqual(efh.ketten.map((k) => k.art), ["detail", "geschosse", "gesamt"]);
    assert.deepEqual(efh.ketten[0].stuecke, [{ von_m: 4.15 - 1, bis_m: 4.15, name: "kniestock" }]);
    assert.deepEqual(efh.ketten[1].stuecke.map((s) => [s.von_m, s.bis_m]), [[-2.75, 0], [0, 2.9], [2.9, 5.5]]);
    assert.deepEqual(efh.ketten[2].stuecke.map((s) => [s.von_m, s.bis_m]), [[-2.75, 0], [0, 9.25]]);
    assert.deepEqual(efh.koten.map((k) => [k.art, k.h_m, k.rang]), [["geschoss", 0, 0], ["geschoss", 2.9, 1], ["geschoss", -2.75, 0], ["traufe", 4.15, 0], ["first", 9.25, 0]]);
    // one storey, flat roof, no parapet: the overall chain would repeat the storey chain → left out
    const eins = schnittMassInhalt({ storeys: [{ level: 0, elevation: 0, name: "EG" }], totalH_m: 3, wandOben_m: 3 });
    assert.deepEqual(eins.ketten.map((k) => k.art), ["geschosse"]);
    assert.deepEqual(eins.koten.map((k) => k.art), ["geschoss", "dach"]);
    // with a parapet the overall height differs from the storey → both chains and the detail piece
    const attika = schnittMassInhalt({ storeys: [{ level: 0, elevation: 0, name: "EG" }], totalH_m: 3, wandOben_m: 3, attika_m: 0.3 });
    assert.deepEqual(attika.ketten.map((k) => k.art), ["detail", "geschosse", "gesamt"]);
    assert.deepEqual(attika.ketten[2].stuecke.map((s) => [s.von_m, s.bis_m]), [[0, 3.3]]);
  });

  it("kurzes Stück: Zahl waagerecht neben der Kette mit Hinweislinie; langes Stück: Zahl gedreht über der Linie; deterministisch", () => {
    const eingabe = { ketten: [{ art: /** @type {"geschosse"} */ ("geschosse"), stuecke: [{ von_m: 0, bis_m: 3 }, { von_m: 3, bis_m: 3.2 }, { von_m: 3.2, bis_m: 6 }] }], koten: [], jeM: 20, schrift: 9 };
    const l = schnittMassLayout(eingabe);
    assert.deepEqual(l.rechts.texte.map((t) => [t.text, t.winkel]), [["3,00", -90], ["2,80", -90], ["0,20", 0]]);
    assert.equal(l.rechts.linien.filter((x) => x.art === "hinweis").length, 1);
    assert.equal(l.rechts.linien.filter((x) => x.art === "mass").length, 1, "eine durchgehende Maßlinie");
    assert.equal(l.rechts.linien.filter((x) => x.art === "strich").length, 4);
    assert.equal(l.rechts.linien.filter((x) => x.art === "hilf").length, 4);
    assert.equal(l.rechts.ausgelassen, 0);
    assert.deepEqual(ueberlappungen(l.rechts.texte.map((t) => ({ ...rahmenVon(t, 20, 9), text: t.text }))), []);
    assert.deepEqual(schnittMassLayout(eingabe), l, "gleiche Eingabe, gleiche Ausgabe");
    // the same pieces in paper millimetres at 1:100 (10 mm per m, text 2,5 mm): same decisions scaled to the font height
    const p = schnittMassLayout({ ...eingabe, jeM: 10, schrift: 2.5 });
    assert.deepEqual(p.rechts.texte.map((t) => [t.text, t.winkel]), [["3,00", -90], ["2,80", -90], ["0,20", 0]]);
    assert.ok(Math.abs(p.rechts.linien.find((x) => x.art === "mass").a.dx - 7.5) < 1e-9, "erste Kette 7,5 mm vor der Wand");
  });

  it("zwei kurze Stücke nebeneinander: die obere Zahl rückt nach oben, nichts überlappt; viele gleich kurze: Zahlen fallen gezählt weg", () => {
    const zwei = schnittMassLayout({ ketten: [{ art: "detail", stuecke: [{ von_m: 3, bis_m: 3.25 }, { von_m: 3.25, bis_m: 3.6, name: "kniestock" }] }], koten: [], jeM: 10, schrift: 9, namen: { kniestock: "Kniestock" } });
    assert.deepEqual(zwei.rechts.texte.map((t) => t.text), ["0,25", "0,35", "Kniestock"]);
    assert.ok(zwei.rechts.texte[1].p.dy > 0, "nach oben versetzt");
    assert.equal(zwei.rechts.ausgelassen, 0);
    assert.deepEqual(ueberlappungen(zwei.rechts.texte.map((t) => ({ ...rahmenVon(t, 10, 9), text: t.text }))), []);
    const viele = schnittMassLayout({ ketten: [{ art: "geschosse", stuecke: Array.from({ length: 60 }, (_, i) => ({ von_m: i * 3, bis_m: i * 3 + 3 })) }], koten: [], jeM: 2, schrift: 9 });
    assert.ok(viele.rechts.ausgelassen > 0 && viele.rechts.texte.length > 0);
    assert.equal(viele.rechts.ausgelassen + viele.rechts.texte.length, 60);
    assert.equal(viele.rechts.linien.filter((x) => x.art === "strich").length, 61, "die Schrägstriche bleiben alle");
    assert.deepEqual(ueberlappungen(viele.rechts.texte.map((t) => ({ ...rahmenVon(t, 2, 9), text: t.text }))), []);
  });

  it("eine Hilfslinie der äußeren Kette läuft durch keine Zahl der inneren", () => {
    // inner piece 2,9 … 3,2; the outer chain measures 0 … 3,05: its extension line at 3,05 m would cross the number beside the inner chain
    const l = schnittMassLayout({ ketten: [{ art: "detail", stuecke: [{ von_m: 2.9, bis_m: 3.2 }] }, { art: "gesamt", stuecke: [{ von_m: 0, bis_m: 3.05 }] }], koten: [], jeM: 10, schrift: 9 });
    const zahl = l.rechts.texte.find((t) => t.text === "0,30"), r = rahmenVon(/** @type {any} */ (zahl), 10, 9);
    assert.ok(r.y0 > 30.5 || r.y1 < 30.5, `Rahmen ${r.y0} … ${r.y1} schneidet die Hilfslinie bei 30,5`);
  });

  it("Koten: eine Flucht; zwei enge Koten → die untere hängt unter ihrer Höhe; zu viele → ausgelassen, ±0,00 und Dachkoten bleiben", () => {
    const eng = schnittMassLayout({ ketten: [], jeM: 10, schrift: 9, koten: koteMit([{ h_m: 0, art: "geschoss", name: "EG", rang: 0 }, { h_m: 6, art: "dach", rang: 0 }, { h_m: 6.3, art: "attika", rang: 0 }]) });
    assert.deepEqual(eng.links.koten.map((k) => [k.art, k.lage]), [["geschoss", "oben"], ["dach", "unten"], ["attika", "oben"]]);
    assert.equal(eng.links.ausgelassen, 0);
    assert.equal(new Set(eng.links.koten.map((k) => k.spitze.dx)).size, 1, "alle Spitzen in einer Flucht");
    assert.ok(eng.links.koten[1].dreieck[1].dy < 0 && eng.links.koten[2].dreieck[1].dy > 0, "Dreieck unter bzw. über der Höhe");
    assert.deepEqual(ueberlappungen(eng.links.koten.map((k) => ({ ...rahmenVon(k, 10, 9), text: k.text }))), []);
    const turm = schnittMassLayout({ ketten: [], jeM: 2.5, schrift: 9, koten: koteMit([
      ...Array.from({ length: 40 }, (_, i) => ({ h_m: i * 2.8, art: "geschoss", name: i ? `${i}. OG` : "EG", rang: i ? 1 : 0 })), { h_m: 112, art: "dach", rang: 0 }, { h_m: 112.5, art: "attika", rang: 0 }]) });
    assert.ok(turm.links.ausgelassen > 0);
    assert.equal(turm.links.ausgelassen + turm.links.koten.length, 42);
    for (const art of ["dach", "attika"]) assert.ok(turm.links.koten.some((k) => k.art === art), art);
    assert.ok(turm.links.koten.some((k) => k.h_m === 0), "±0,00 bleibt");
    assert.deepEqual(ueberlappungen(turm.links.koten.map((k) => ({ ...rahmenVon(k, 2.5, 9), text: k.text }))), []);
  });

  it("gesperrtes Band (Geländetext unter ±0,00): die Kote des 1. UG weicht aus oder entfällt, nie liegt sie im Band", () => {
    const koten = koteMit([{ h_m: 0, art: "geschoss", name: "EG", rang: 0 }, { h_m: -3, art: "geschoss", name: "1. UG", rang: 1 }, { h_m: -6, art: "geschoss", name: "2. UG", rang: 0 }]);
    const band = { h_m: 0, von: -12.8, bis: -3.8 };
    for (const jeM of [4, 5, 7, 10, 20]) {
      const l = schnittMassLayout({ ketten: [], koten, jeM, schrift: 9, gesperrt: [band] });
      for (const k of l.links.koten) { const r = rahmenVon(k, jeM, 9); assert.ok(r.y1 <= -12.8 + 1e-9 || r.y0 >= -3.8 - 1e-9, `${k.text} bei ${jeM} px/m: ${r.y0} … ${r.y1}`); }
      assert.equal(l.links.koten.length + l.links.ausgelassen, 3);
      assert.ok(l.links.koten.some((k) => k.h_m === 0) && l.links.koten.some((k) => k.h_m === -6), "±0,00 und tiefste Ebene bleiben");
    }
    // 20 px per m: the mark of the 1. UG fits below the band above its own level
    assert.equal(schnittMassLayout({ ketten: [], koten, jeM: 20, schrift: 9, gesperrt: [band] }).links.ausgelassen, 0);
  });
});

describe("115-02 Bildschirm (BimPlan2D, serverseitig gerendert)", () => {
  /** @type {Awaited<ReturnType<typeof jsxUmgebung>>} */
  let u;
  /** @type {any} */
  let BimPlan2D;
  before(async () => {
    u = await jsxUmgebung();
    BimPlan2D = (await u.laden("/packages/nova-designer/src/components/BimPlan2D.jsx")).default;
  });
  after(async () => { await u?.schliessen(); });
  const schnitt = (/** @type {typeof FAELLE[string]} */ f, /** @type {Record<string, any>} */ mehr = {}) =>
    u.rendern(BimPlan2D, { model: f.model, mode: "schnitt", storeyHeight: f.storeyHeight, height: 520, dach: dachVon(f), achse: f.achse, ...mehr });

  for (const [name, f] of Object.entries(FAELLE)) {
    it(`Schnitt: ${name} — kein Text auf einem anderen, alles im Bild, Dezimalkomma`, () => {
      const svg = schnitt(f);
      const texte = svgTexte(svg);
      assert.deepEqual(ueberlappungen(texte.map((t) => t.rahmen)), []);
      const [, , breite, hoehe] = (/viewBox="([^"]*)"/.exec(svg) || ["", ""])[1].split(" ").map(Number);
      for (const t of texte) {
        assert.ok(t.rahmen.x0 >= 0 && t.rahmen.x1 <= breite && t.rahmen.y0 >= 0 && t.rahmen.y1 <= hoehe, `„${t.text}“ liegt im Bild (${breite} × ${hoehe})`);
        assert.doesNotMatch(t.text, /\d\.\d/, `Dezimalpunkt in „${t.text}“`);
      }
      const koten = texte.filter((t) => ["geschoss", "dach", "traufe", "first", "attika"].includes(t.kote || ""));
      assert.ok(koten.length >= 2);
      for (const t of koten) assert.match(t.text, /(±0,00|[+−]\d+,\d{2})$/u, `Kote „${t.text}“`);
      assert.ok(koten.some((t) => t.text.endsWith("±0,00")), "Kote ±0,00 bleibt");
      const zahlen = [...(/<g [^>]*data-schnittmasse[^>]*>(.*?)<\/g>/.exec(svg) || ["", ""])[1].matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].filter((m) => !/data-kote/.test(m[1])).map((m) => m[2]);
      assert.ok(zahlen.length >= 1);
      for (const z of zahlen) assert.match(z, /^\d+,\d{2}$/, `Maßzahl „${z}“`);
    });
  }

  it("Bildschirm und Blatt messen dasselbe: gleiche Maßzahlen der Höhenketten und gleiche Kotenwerte (EFH, 1:100 gegen Bildschirm)", () => {
    const f = FAELLE["EFH mit Keller, 2 Geschosse, Satteldach 45°, Kniestock 1,00 (B-B)"];
    const texte = svgTexte(schnitt(f));
    const g = schnittGrafik({ model: f.model, storeyHeight: 2.9, massstab: 100, dach: dachVon(f), achse: "z" });
    const blatt = g.elemente.filter((/** @type {any} */ e) => e.art === "text" && e.ebene === "bemassung").map((/** @type {any} */ e) => e.text);
    const schirm = texte.filter((t) => !["geschoss", "dach", "traufe", "first", "attika"].includes(t.kote || "") && /^(\d+,\d{2}|Kniestock)$/.test(t.text)).map((t) => t.text);
    assert.deepEqual([...schirm].sort(), [...blatt].sort());
    const wert = (/** @type {string} */ s) => (/(±0,00|[+−]\d+,\d{2})/u.exec(s) || [""])[0];
    assert.deepEqual(texte.filter((t) => t.kote && t.kote !== "kniestock").map((t) => wert(t.text)).sort(),
      g.elemente.filter((/** @type {any} */ e) => e.art === "text" && e.ebene === "kote").map((/** @type {any} */ e) => wert(e.text)).sort());
    // the name of the knee wall is its own text (the finding: "Kniestock 0.75 m" lay on "2.41 m")
    assert.equal(texte.filter((t) => t.kote === "kniestock").length, 1);
    assert.equal(texte.find((t) => t.kote === "kniestock")?.text, "Kniestock");
  });

  it("Einheit cm: Maßzahlen ohne Nachkommastelle, Koten bleiben in Metern mit Komma", () => {
    const f = FAELLE["EFH mit Keller, 2 Geschosse, Satteldach 45°, Kniestock 1,00 (B-B)"];
    const texte = svgTexte(schnitt(f, { unit: "cm" }));
    for (const z of ["275", "290", "260", "925", "100", "1020"]) assert.ok(texte.some((t) => t.text === z), `Maßzahl ${z}`);
    assert.ok(texte.some((t) => t.text === "Traufe +4,15"));
    assert.deepEqual(ueberlappungen(texte.map((t) => t.rahmen)), []);
  });

  it("Grundriss: Länge der gezeichneten Wand und Maßketten mit Dezimalkomma, kein Dezimalpunkt in einem Text", () => {
    const html = u.rendern(BimPlan2D, { model: efhModell(), mode: "grundriss", level: 0, storeyHeight: 2.9, height: 520, readOnly: true, edit: { customWalls: EFH_108.customWalls } });
    const texte = [...html.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    assert.ok(texte.includes("10,20"), `Wandlänge 10,20 in ${texte.join(" | ")}`);
    assert.ok(texte.includes("11,40"), "Gesamtmaß der Hüllkante");
    for (const t of texte) assert.doesNotMatch(t, /\d\.\d/, `Dezimalpunkt in „${t}“`);
    for (const t of [...html.matchAll(/>([^<>]*\d[.,]\d[^<>]*)</g)].map((m) => m[1])) assert.doesNotMatch(t, /\d\.\d\d/, `Dezimalpunkt in „${t}“`);
  });
});
