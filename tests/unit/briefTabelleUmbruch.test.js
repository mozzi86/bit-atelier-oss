// User finding 15.11.2026 (fee offer PDF): a long text in the first column of the amount table ran across the amount column.
// briefLayout() wraps a cell of a left-aligned column to its width; rows that fit stay untouched (stored proofs keep their hash).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { briefLayout, ZEICHENBREITE_10PT_MM } from "@core/lib/brief/briefLayout.js";
import { BETRAGS_SPALTEN } from "@core/lib/brief/vorlagen.js";
import { erzeugeBriefPdf } from "@core/lib/brief/briefPdf.js";

const LANG = "Besondere Leistung: Freianlagenplanung pauschal: Höhenplanung, Hangabfangung, Entwässerung mit Zisterne/Versickerung, Stellplätze und Zufahrt";
const tabelle = (zeilen) => ({ kopf: ["Leistung", "Anteil", "Betrag"], zeilen, spalten: BETRAGS_SPALTEN });
const basis = { absender: ["Büro"], empfaenger: ["Bauherr"], datum: "15.11.2026", betreff: "Honorarangebot", absaetze: ["Text"] };

describe("Brief: Tabellenzellen umbrechen", () => {
  it("kurze Zeilen bleiben genau, wie sie waren", () => {
    const zeilen = [["LPH 3 Entwurfsplanung", "15 %", "9.345,26 €"], ["Honorar netto", "", "17.025,03 €"]];
    assert.deepEqual(briefLayout({ ...basis, tabelle: tabelle(zeilen) }).seiten[0].tabelle.zeilen, zeilen);
  });

  it("eine lange erste Zelle wird auf die Spaltenbreite umbrochen, der Betrag bleibt in der ersten Zeile", () => {
    const m = briefLayout({ ...basis, tabelle: tabelle([["LPH 3", "15 %", "9.345,26 €"], [LANG, "", "5.000,00 €"], ["Nebenkosten 5 %", "", "810,72 €"]]) });
    const z = m.seiten[0].tabelle.zeilen;
    const zeichen = Math.floor((BETRAGS_SPALTEN[0].breite_mm - 3) / ZEICHENBREITE_10PT_MM);
    assert.ok(z.length > 3, "Fortsetzungszeilen fehlen");
    assert.deepEqual(z[0], ["LPH 3", "15 %", "9.345,26 €"]);
    assert.equal(z[1][2], "5.000,00 €");
    for (const zeile of z) assert.ok(zeile[0].length <= zeichen, `zu lang: ${zeile[0]}`);
    const fortsetzung = z.slice(2, -1);
    assert.ok(fortsetzung.every((zeile) => zeile[1] === "" && zeile[2] === ""));
    assert.equal(z.slice(1, -1).map((zeile) => zeile[0]).join(" "), LANG);
    assert.deepEqual(z[z.length - 1], ["Nebenkosten 5 %", "", "810,72 €"]);
  });

  it("Tabelle ohne Spalten (Stand 79) bleibt unberührt", () => {
    const t = { kopf: [], zeilen: [[LANG, "5.000,00 €"]] };
    assert.deepEqual(briefLayout({ ...basis, tabelle: t }).seiten[0].tabelle.zeilen, [[LANG, "5.000,00 €"]]);
  });

  it("das PDF lässt sich mit umbrochener Tabelle erzeugen", async () => {
    const pdf = await erzeugeBriefPdf(briefLayout({ ...basis, tabelle: tabelle([[LANG, "", "5.000,00 €"]]) }));
    assert.ok(pdf.length > 1000);
  });
});
