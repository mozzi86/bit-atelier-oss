// Phase 81 (81-03): the additive options of the shared letter core (79-03) —
// reproducible PDF bytes (`fixiert`), page numbers, a table split across pages
// with its head repeated, real columns, and the transliteration of
// ersetzeNichtWinAnsi. Without the options everything behaves exactly like 79:
// the model is compared with a frozen copy of 79's briefLayout.js
// (tests/unit/fixtures/briefLayout79.js); 79's own suite stays
// tests/unit/buchhaltung-mahnpdf.test.js. jsPDF runs under node (its node build),
// pdfjs-dist/legacy reads the text back.
//
// In:  @core/lib/brief/{briefLayout,briefPdf,winAnsi}.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { briefLayout } from "@core/lib/brief/briefLayout.js";
import { erzeugeBriefPdf } from "@core/lib/brief/briefPdf.js";
import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";
import { briefLayout as briefLayout79 } from "./fixtures/briefLayout79.js";

const FIX = { erstelltAm: "2026-09-28T09:00:00Z", dateiId: "0123456789abcdef0123456789abcdef" };
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * Text items of a PDF with their positions in mm.
 * @param {Uint8Array} bytes
 * @returns {Promise<Array<{seite: number, text: string, x: number, y: number, ende: number}>>}
 */
async function pdfTexte(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  const aus = [];
  const mm = (pt) => Math.round((pt * 25.4) / 72 * 10) / 10;
  for (let n = 1; n <= doc.numPages; n++) {
    const seite = await doc.getPage(n);
    const inhalt = await seite.getTextContent();
    for (const item of /** @type {any[]} */ (inhalt.items)) {
      if (!item.str) continue;
      aus.push({ seite: n, text: item.str, x: mm(item.transform[4]), y: mm(item.transform[5]), ende: mm(item.transform[4] + item.width) });
    }
  }
  return aus;
}

const BEISPIELE = [
  { absender: ["Testbüro"], empfaenger: ["Kunde GmbH", "Weg 1", "00000 Ort"], datum: "27.09.2026", betreff: "Mahnung", absaetze: ["Text."] },
  { betreff: "Mahnung", absaetze: ["Ein kurzer Text."], tabelle: { zeilen: [["Offener Betrag", "100,00 €"], ["Summe", "100,00 €"]] } },
  { betreff: "Mahnung ⚠", absaetze: [Array.from({ length: 400 }, (_, i) => `Wort${i}`).join(" ")], tabelle: { kopf: ["A", "B"], zeilen: [["x", "1,00 €"]] } },
  { betreff: "Lang", absaetze: ["Kurz."], tabelle: { kopf: ["Position", "Betrag"], zeilen: Array.from({ length: 20 }, (_, i) => [`P${i}`, `${i},00 €`]) } },
];

test("ohne die neuen Optionen ist das Modell exakt das von 79-03", () => {
  for (const eingabe of BEISPIELE) assert.deepEqual(briefLayout(eingabe), briefLayout79(eingabe), eingabe.betreff);
});

test("ersetzeNichtWinAnsi mit umschrift; ohne Option wie 79", () => {
  assert.deepEqual(ersetzeNichtWinAnsi("Şahin → Łódź, Müller", { umschrift: true }), { text: "Sahin -> Lódz, Müller", ersetzt: 4, zeichen: ["Ş", "→", "Ł", "ź"] });
  assert.deepEqual(ersetzeNichtWinAnsi("Şahin → Łódź, Müller"), { text: "?ahin ? ?ód?, Müller", ersetzt: 4 });
  assert.deepEqual(ersetzeNichtWinAnsi("äöü ß € „“ – ó", { umschrift: true }), { text: "äöü ß € „“ – ó", ersetzt: 0, zeichen: [] });
  assert.equal(ersetzeNichtWinAnsi("≤ 5 ✓ ă", { umschrift: true }).text, "<= 5 x a");
  assert.equal(ersetzeNichtWinAnsi("☃", { umschrift: true }).text, "?");
});

test("seitenzahlen und Tabellenteilung: 60 Zeilen, Kopf auf jeder Folgeseite, „Seite n von m“", () => {
  const l = briefLayout({
    betreff: "Honorarangebot", absaetze: ["Text."], seitenzahlen: true,
    tabelle: { kopf: ["LPH", "Prozent", "Betrag"], zeilen: Array.from({ length: 60 }, (_, i) => [`Zeile ${i + 1}`, "2 %", "1.234,56 €"]) },
  });
  assert.ok(l.seiten.length >= 2);
  const zeilen = l.seiten.flatMap((s) => s.tabelle?.zeilen ?? []);
  assert.equal(zeilen.length, 60, "keine Zeile verloren");
  assert.deepEqual(zeilen.map((z) => z[0]), Array.from({ length: 60 }, (_, i) => `Zeile ${i + 1}`), "Reihenfolge");
  for (const s of l.seiten.filter((x) => x.tabelle)) assert.deepEqual(s.tabelle?.kopf, ["LPH", "Prozent", "Betrag"]);
  l.seiten.forEach((s, i) => assert.equal(s.fusszeile, `Seite ${i + 1} von ${l.seiten.length}`));
  // each page within its line budget (35 on page 1, 51 on following pages at 5 mm)
  for (const s of l.seiten) {
    const hoehe = s.zeilen.length + (s.tabelle ? 1 + 1 + s.tabelle.zeilen.length : 0);
    assert.ok(hoehe <= (s.nummer === 1 ? 35 : 51), `Seite ${s.nummer}: ${hoehe} Zeilen`);
  }
});

test("erzeugeBriefPdf mit fixiert: zweimal dieselben Bytes; Text, Spalten und Fußzeile lesbar", async () => {
  const layout = briefLayout({
    absender: ["Architekturbüro Beispiel"], empfaenger: ["Bauherrschaft B", "Musterstraße 1", "00000 Musterstadt"],
    datum: "28.09.2026", betreff: "Honorarangebot HA-2026-001", absaetze: ["Sehr geehrte Damen und Herren,", "anbei unser Honorarangebot."],
    seitenzahlen: true,
    tabelle: { kopf: ["Leistungsphase", "Prozent", "Betrag"], zeilen: [["LPH 1 Grundlagenermittlung", "2 %", "1.212,16 €"], ["Summe netto", "", "62.365,74 €"]],
      spalten: [{ breite_mm: 100, ausrichtung: "links" }, { breite_mm: 20, ausrichtung: "rechts" }, { breite_mm: 45, ausrichtung: "rechts" }] },
  });
  const a = await erzeugeBriefPdf(layout, { fixiert: FIX });
  await new Promise((ok) => setTimeout(ok, 1100)); // a different second must not change the bytes
  const b = await erzeugeBriefPdf(layout, { fixiert: FIX });
  assert.equal(sha(a), sha(b));
  const texte = await pdfTexte(a);
  const finde = (s) => texte.find((x) => x.text === s);
  assert.ok(finde("Honorarangebot HA-2026-001"));
  assert.ok(finde("Seite 1 von 1"));
  // Address field DIN 5008: x 20 mm, first line at y = 297 − 45 = 252 mm from the bottom.
  const empfaenger = finde("Bauherrschaft B");
  assert.ok(empfaenger && Math.abs(empfaenger.x - 20) < 0.6, "Anschriftfeld x 20 mm");
  // Columns: label left at 25 mm, amount right-aligned ending at 25 + 100 + 20 + 45 = 190 mm.
  const label = finde("LPH 1 Grundlagenermittlung");
  assert.ok(label && Math.abs(label.x - 25) < 0.6, "Bezeichnung links");
  const betrag = finde("62.365,74 €");
  assert.ok(betrag && Math.abs(betrag.ende - 190) < 1, `Betrag rechtsbündig (${betrag?.ende})`);
});

test("ohne fixiert verhält sich erzeugeBriefPdf wie 79 (lesbares PDF, ein Seitenumbruch je Seite)", async () => {
  const layout = briefLayout(BEISPIELE[1]);
  const bytes = await erzeugeBriefPdf(layout);
  const texte = await pdfTexte(bytes);
  assert.ok(texte.some((x) => x.text.includes("Offener Betrag")));
  assert.ok(!texte.some((x) => /^Seite \d/.test(x.text)), "keine Seitenzahl ohne Option");
});
