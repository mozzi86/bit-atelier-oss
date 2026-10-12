// Phase 81 (81-03): the fee offer letter and PDF — builder output fits 79's
// briefLayout and stays WinAnsi, the PDF of the sample offer (Fixture D) carries
// number, amounts, eight stage rows and the payment term, the address field sits
// where DIN 5008 puts it, transliteration of a client name, no PDF without an
// amount, reproducible hash with `fixiert`.
//
// In:  src/lib/honorar/angebotPdf.js, @core/lib/brief/vorlagen.js, the 81 seed.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { angebotBriefEingabe, angebotPdf, alsDataUrl, sha256Hex } from "@/lib/honorar/angebotPdf.js";
import { HONORAR_BRIEFE } from "@core/lib/brief/vorlagen.js";
import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar, SEED_ANGEBOT_OFFEN } from "@/lib/zeitHonorar/beispielDaten.js";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";

const HEUTE = "2026-09-28";
const FIX = { erstelltAm: "2026-09-28T09:00:00Z", dateiId: "00112233445566778899aabbccddeeff" };
const saat = beispielDatensaetzeZeitHonorar(HEUTE, { buchhaltung: beispielDatensaetze(HEUTE) });
const ANGEBOT = saat.Honorarangebot.find((a) => a.id === SEED_ANGEBOT_OFFEN.id);
const PROJEKT = { id: "proj-3", name: "Gemeinschaftshaus" };
const BRIEFKOPF = { office: "Architekturbüro Beispiel", address: "Musterweg 2\n00000 Musterstadt", tagline: "", contact: "" };

/**
 * All text of a PDF in reading order, one string per item.
 * @param {Uint8Array} bytes
 * @returns {Promise<Array<{text: string, x: number, y: number}>>} x/y in mm
 */
async function texte(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  const aus = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const inhalt = await (await doc.getPage(n)).getTextContent();
    for (const i of /** @type {any[]} */ (inhalt.items)) if (i.str) aus.push({ text: i.str, x: (i.transform[4] * 25.4) / 72, y: (i.transform[5] * 25.4) / 72 });
  }
  return aus;
}

test("Briefbauer: nur WinAnsi, passt in 79s briefLayout (Tabelle mit Spalten)", () => {
  const eingabe = angebotBriefEingabe(ANGEBOT, { projekt: PROJEKT, briefkopf: BRIEFKOPF, heuteIso: HEUTE });
  const alles = [eingabe.betreff, ...eingabe.absaetze, ...eingabe.tabelle.kopf, ...eingabe.tabelle.zeilen.flat(), ...eingabe.absender, ...eingabe.empfaenger];
  for (const s of alles) assert.equal(ersetzeNichtWinAnsi(s).ersetzt, 0, s);
  assert.equal(eingabe.tabelle.spalten.length, 3);
  assert.equal(HONORAR_BRIEFE.honorarangebot.version, 1);
  assert.deepEqual(eingabe.absender, ["Architekturbüro Beispiel", "Musterweg 2", "00000 Musterstadt"]);
});

test("PDF des Saat-Angebots: Nummer, Beträge, acht LPH, Zahlungsziel, Anschriftfeld; Hash reproduzierbar", async () => {
  const r = await angebotPdf(ANGEBOT, { projekt: PROJEKT, briefkopf: BRIEFKOPF, heuteIso: HEUTE, fixiert: FIX });
  const t = await texte(r.bytes);
  const alles = t.map((x) => x.text).join("\n");
  assert.match(alles, /Honorarangebot HA-2026-001/);
  assert.match(alles, /59\.395,94/, "Grundhonorar");
  assert.match(alles, /62\.365,74/, "netto");
  assert.equal(t.filter((x) => /^LPH \d /.test(x.text)).length, 8);
  assert.match(alles, /Zahlungsziel 14 Tage/);
  assert.match(alles, /Seite 1 von \d/);
  assert.doesNotMatch(alles, /vor Versand gegenlesen/, "versendetes Angebot ohne Gegenlese-Zeile");
  const empfaenger = t.find((x) => x.text === ANGEBOT.bauherr_name);
  assert.ok(empfaenger && Math.abs(empfaenger.x - 20) < 0.6 && empfaenger.y < 297 - 45 + 0.6 && empfaenger.y > 297 - 90, "im Anschriftfeld");
  const zweiter = await angebotPdf(ANGEBOT, { projekt: PROJEKT, briefkopf: BRIEFKOPF, heuteIso: HEUTE, fixiert: FIX });
  assert.equal(crypto.createHash("sha256").update(zweiter.bytes).digest("hex"), await sha256Hex(r.bytes));
  assert.match(alsDataUrl(r.bytes), /^data:application\/pdf;base64,JVBER/);
});

test("Entwurf trägt die Gegenlese-Zeile; „Şahin Bau“ wird umgeschrieben und gemeldet", async () => {
  const entwurf = { ...ANGEBOT, status: "entwurf", bauherr_name: "Şahin Bau" };
  const r = await angebotPdf(entwurf, { projekt: PROJEKT, briefkopf: BRIEFKOPF, heuteIso: HEUTE, fixiert: FIX });
  const alles = (await texte(r.bytes)).map((x) => x.text).join("\n");
  assert.match(alles, /Entwurf — Richtwerte nach HOAI 2021, vor Versand gegenlesen/);
  assert.match(alles, /Sahin Bau/);
  assert.equal(r.ersetzt, 1);
  assert.deepEqual(r.zeichen, ["Ş"]);
});

test("ohne Betrag kein PDF: Tafel fehlt (Injektion)", async () => {
  const tw = WEITERE_TAFELN.find((x) => x.leistungsbild === "tragwerksplanung");
  const e = { ...ANGEBOT, leistungsbild: "tragwerksplanung", bezugswert: 1000000, lph: [] };
  await assert.rejects(() => angebotPdf(e, { projekt: PROJEKT, heuteIso: HEUTE, optionen: { weitere: [{ ...tw, annahme: true }] } }), /Tafel fehlt/);
});
