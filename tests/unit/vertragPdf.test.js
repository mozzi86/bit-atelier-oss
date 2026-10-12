// Phase 81 (81-04): order confirmation and fee amendment as PDF — text content
// (number, amount, stages, § 15 HOAI, payment term with source, dates, liability),
// the § 650r BGB hint for consumers, WinAnsi-only builders, reproducible hash.
//
// In:  src/lib/honorar/vertragPdf.js, @core/lib/brief/vorlagen.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { auftragsbestaetigungPdf, bestaetigungEingabe, honorarnachtragPdf, nachtragEingabe, zahlungszielMitQuelle } from "@/lib/honorar/vertragPdf.js";
import { HONORAR_BRIEFE } from "@core/lib/brief/vorlagen.js";
import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";

const FIX = { erstelltAm: "2026-09-28T09:00:00Z", dateiId: "ffeeddccbbaa99887766554433221100" };
const VERTRAG = {
  id: "hv-d", project_id: "proj-3", nummer: "AV-2026-001", angebot_id: "ha-d", status: "beauftragt", vertragsdatum: "2026-09-28",
  leistungsbild: "innenraeume", bauherr_name: "Bauherrschaft B", bauherr_anschrift: "Musterstraße 1, 00000 Musterstadt", bauherr_art: "unternehmer",
  zahlungsziel_tage: 14, zahlungsziel_vertraglich: true, kg300_euro: 480000, kg400_euro: 0, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0,
  lph: lphFuerLeistungsbild("innenraeume").map((l, i) => ({ ...l, beauftragt: i < 8 })), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
  stufen: [{ nr: 1, lph: [1, 2, 3, 4, 5, 6, 7, 8], beauftragt_am: "2026-09-28" }],
  termine: [{ titel: "LPH 5 abgeschlossen", datum: "2026-11-30", lph: 5, art: "meilenstein" }],
  haftung: { versicherer: "Beispiel Versicherung AG", deckung_personen_eur: 1500000, deckung_sach_eur: 500000, haftungsbegrenzung_text: "" },
};
const KONTEXT = { angebot: { nummer: "HA-2026-001" }, projekt: { name: "Gemeinschaftshaus" }, briefkopf: { office: "Architekturbüro Beispiel" }, heuteIso: "2026-09-28" };

async function text(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  let t = "";
  for (let n = 1; n <= doc.numPages; n++) t += (await (await doc.getPage(n)).getTextContent()).items.map((i) => /** @type {any} */ (i).str).join("\n");
  return t;
}

test("HONORAR_BRIEFE: drei Bauer mit Version", () => {
  for (const k of ["honorarangebot", "auftragsbestaetigung", "honorarnachtrag"]) assert.equal(HONORAR_BRIEFE[k].version, 1, k);
});

test("Auftragsbestätigung: Inhalt, § 15, Zahlungsziel mit Quelle, Termine, Haftung; Hash reproduzierbar", async () => {
  const r = await auftragsbestaetigungPdf(VERTRAG, { ...KONTEXT, fixiert: FIX });
  const t = await text(r.bytes);
  for (const s of ["Auftragsbestätigung", "AV-2026-001", "62.365,74", "Stufe 1: LPH 1, 2, 3, 4, 5, 6, 7, 8", "Abschlagszahlungen nach Leistungsstand (§ 15 HOAI)", "Zahlungsziel 14 Tage", "laut Architektenvertrag", "LPH 5 abgeschlossen bis 30.11.2026", "Beispiel Versicherung AG"]) {
    assert.ok(t.replace(/\n/g, " ").includes(s), s);
  }
  assert.ok(!t.includes("§ 650r"), "kein Verbraucherhinweis für Unternehmer");
  const zweiter = await auftragsbestaetigungPdf(VERTRAG, { ...KONTEXT, fixiert: FIX });
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  assert.equal(sha(r.bytes), sha(zweiter.bytes));
});

test("Verbraucher: Hinweis § 650r BGB; Zahlungsziel aus 79s Kette mit Quelle", () => {
  const v = { ...VERTRAG, bauherr_art: "verbraucher", zahlungsziel_tage: undefined };
  const e = bestaetigungEingabe(v, KONTEXT);
  assert.ok(e.absaetze.some((a) => a.includes("§ 650r BGB")));
  assert.deepEqual(zahlungszielMitQuelle(v, { einst: { zahlungsziel_tage: 21 } }), { tage: 21, quelle: "Bürostandard" });
  assert.deepEqual(zahlungszielMitQuelle(v, { einst: { zahlungsziel_je_bauherr: { "bauherr b": 30 } }, projekt: { client: "Bauherr B" } }), { tage: 30, quelle: "vereinbart je Bauherr" });
  for (const s of [e.betreff, ...e.absaetze, ...e.tabelle.zeilen.flat()]) assert.equal(ersetzeNichtWinAnsi(s).ersetzt, 0, s);
});

test("Honorarnachtrag-Brief: Nummer, Betrag, Vertragsbezug", async () => {
  const n1 = { id: "n1", nr: 1, titel: "Variantenuntersuchung Fassade", grund: "besondere_leistung", lph: 5, berechnung: { art: "pauschal", betrag_euro: 8000 }, betrag_euro: 8000, status: "angeboten" };
  const e = nachtragEingabe(n1, VERTRAG, KONTEXT);
  for (const s of [e.betreff, ...e.absaetze]) assert.equal(ersetzeNichtWinAnsi(s).ersetzt, 0, s);
  const t = await text((await honorarnachtragPdf(n1, VERTRAG, { ...KONTEXT, fixiert: FIX })).bytes);
  for (const s of ["Honorarnachtrag 1", "8.000,00", "AV-2026-001"]) assert.ok(t.includes(s), s);
});
