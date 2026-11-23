// 108-10: the IFC export writes the two terrain layers as IfcGeographicElement .TERRAIN. with ObjectType "Bestand" / "Neu" on the
// site; without the option the file is byte-identical; the section graphic shows both lines and the earthworks marks.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportIFCMitKatalog } from "@designer/lib/ifcExport";
import { schnittGrafik } from "@designer/lib/vektorPlan";
import { grundrissDxfDaten } from "@designer/lib/dxfPlaene";
import { gelaendeProfil } from "@core/lib/massing/gelaendeEbenen.js";
import { ifcKombiSzenario } from "./fixtures/ifcKatalogKombi-11402.js";
import { gelaendeBeispiel } from "./fixtures/gelaendeBeispiel-10810.js";

describe("108-10 Gelände Bestand / Neu in IFC, Schnitt und DXF", () => {
  it("IFC: zwei Geländeelemente auf dem Grundstück, Erdmassen am neuen Gelände; ohne Gelände unverändert", async () => {
    const { model, opts } = ifcKombiSzenario();
    const ohne = await exportIFCMitKatalog(model, opts);
    assert.equal(await exportIFCMitKatalog(model, { ...opts, gelaende: null }), ohne);
    assert.ok(!ohne.includes("IFCGEOGRAPHICELEMENT"));
    const g = gelaendeBeispiel();
    const mit = await exportIFCMitKatalog(model, { ...opts, gelaende: g });
    const elemente = mit.split("\n").filter((z) => z.includes("=IFCGEOGRAPHICELEMENT(") || z.includes("= IFCGEOGRAPHICELEMENT("));
    assert.equal(elemente.length, 2);
    assert.ok(elemente[0].includes("'Bestand'") && elemente[0].includes(".TERRAIN."));
    assert.ok(elemente[1].includes("'Neu'") && elemente[1].includes(".TERRAIN."));
    assert.equal((mit.match(/IFCTRIANGULATEDFACESET\(/g) || []).length, 2);
    assert.ok(g.erdmassen && g.erdmassen.abtrag_m3 > 0 && g.erdmassen.auftrag_m3 > 0);
    assert.ok(mit.includes("'Abtrag_m3'") && mit.includes("'Auftrag_m3'") && mit.includes("'310'"));
    // the same input gives the same file (stable GUIDs)
    assert.equal(await exportIFCMitKatalog(model, { ...opts, gelaende: g }), mit);
  });

  it("Schnitt: Bestand gestrichelt, Neu durchgezogen, Abtrag und Auftrag markiert; ohne Profile die Linie ±0,00 wie bisher", () => {
    const { model } = ifcKombiSzenario();
    const g = gelaendeBeispiel();
    const xs = model.footprint.map((p) => p.x), von = Math.min(...xs) - 3, bis = Math.max(...xs) + 3;
    const ohne = schnittGrafik({ model, storeyHeight: 2.8 });
    assert.deepEqual(schnittGrafik({ model, storeyHeight: 2.8, gelaende: null }), ohne);
    assert.equal(ohne.elemente.filter((e) => e.ebene === "gelaende").length, 1);
    const mit = schnittGrafik({ model, storeyHeight: 2.8, gelaende: { bestand: gelaendeProfil(g.bestand, "x", von, bis), neu: gelaendeProfil(g.neu, "x", von, bis) } });
    const je = (/** @type {string} */ eb) => mit.elemente.filter((e) => e.ebene === eb);
    assert.equal(je("gelaende").length, 0);
    assert.equal(je("gelaende_bestand").length, 1);
    assert.equal(je("gelaende_bestand")[0].dash, "4 2");
    // the new ground stops at the outer faces of the building: one line left, one right; the existing one runs through dashed
    assert.equal(je("gelaende_neu").length, 2);
    assert.ok(je("gelaende_neu").every((e) => e.dash === undefined));
    assert.equal(Math.max(...je("gelaende_neu")[0].pts.map((q) => q.x)), Math.min(...xs));
    assert.equal(Math.min(...je("gelaende_neu")[1].pts.map((q) => q.x)), Math.max(...xs));
    assert.ok(je("erdbau_abtrag").length > 0 && je("erdbau_auftrag").length > 0);
    const texte = mit.elemente.filter((e) => e.art === "text").map((e) => e.text);
    assert.ok(texte.some((t) => t.startsWith("Gelände Bestand")) && texte.some((t) => t.startsWith("Gelände neu")));
    // black-and-white: hatches only, no tinted areas
    const sw = schnittGrafik({ model, storeyHeight: 2.8, sw: true, gelaende: { bestand: gelaendeProfil(g.bestand, "x", von, bis), neu: gelaendeProfil(g.neu, "x", von, bis) } });
    assert.ok(sw.elemente.filter((e) => String(e.ebene).startsWith("erdbau_")).every((e) => !e.fill));
    // DXF layers of the terrain lines
    const dxf = grundrissDxfDaten(mit, { massstab: 100 });
    const ebenen = new Set(dxf.elemente.map((e) => e.ebene));
    assert.ok(ebenen.has("A_GELAENDE_BESTAND") && ebenen.has("A_GELAENDE_NEU") && ebenen.has("A_ERDBAU_ABTRAG") && ebenen.has("A_ERDBAU_AUFTRAG"));
  });
});
