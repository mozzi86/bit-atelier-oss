// Unit tests of the shared letter core's pure half (79-03 T2, D-P79-27):
// the WinAnsi/CP1252 encoder and the DIN 5008 layout model. No jsPDF here —
// briefPdf.js (the drawing) only runs in the browser (headless proof b-03).
//
// In:  packages/nova-core/src/lib/brief/{winAnsi,briefLayout,briefkopf}.js,
//      src/lib/accounting/mahnPdf.js#mahnBrief. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ersetzeNichtWinAnsi, istWinAnsi, kodiereCp1252 } from "@core/lib/brief/winAnsi.js";
import { briefLayout, DIN5008 } from "@core/lib/brief/briefLayout.js";
import { briefkopfAus, briefkopfZeilen } from "@core/lib/brief/briefkopf.js";
import { mahnBrief } from "@/lib/accounting/mahnPdf.js";
import { formatEuro } from "@/lib/accounting/geld.js";

test("kodiereCp1252: €, Leerzeichen, Gedankenstrich, deutsche Anführungszeichen, ä — Bytes wie CP1252", () => {
  const { bytes, ersetzt } = kodiereCp1252("€ – „ä“");
  assert.deepEqual([...bytes], [0x80, 0x20, 0x96, 0x20, 0x84, 0xe4, 0x93]);
  assert.equal(ersetzt, 0);
});

test("kodiereCp1252: Zeichen außerhalb WinAnsi wird zu „?“, gezählt", () => {
  const { bytes, ersetzt } = kodiereCp1252("✓");
  assert.deepEqual([...bytes], [0x3f]);
  assert.equal(ersetzt, 1);
});

test("istWinAnsi/ersetzeNichtWinAnsi: ASCII, Latin-1 und die CP1252-Sonderzeichen bleiben, Symbole werden ersetzt", () => {
  assert.ok(istWinAnsi("a"));
  assert.ok(istWinAnsi("ä"));
  assert.ok(istWinAnsi("€"));
  assert.ok(!istWinAnsi("✓"));
  assert.ok(!istWinAnsi("⚠"));
  assert.ok(!istWinAnsi("↑"));
  const r = ersetzeNichtWinAnsi("100 % ✓ fertig ⚠ Achtung ↑");
  assert.equal(r.ersetzt, 3);
  assert.equal(r.text, "100 % ? fertig ? Achtung ?");
});

test("briefLayout: DIN-5008-Marken fest (Anschriftfeld 20/45 mm, 85×45; Falzmarken 105/210; Lochmarke 148,5)", () => {
  const l = briefLayout({ absender: ["Testbüro"], empfaenger: ["Kunde GmbH"], datum: "27.09.2026", betreff: "Mahnung", absaetze: ["Text."] });
  assert.deepEqual(l.din5008.anschrift, { x: 20, y: 45, w: 85, h: 45 });
  assert.equal(l.din5008.falzmarke1_y, 105);
  assert.equal(l.din5008.falzmarke2_y, 210);
  assert.equal(l.din5008.lochmarke_y, 148.5);
  assert.equal(DIN5008.anschrift.x, 20);
});

test("briefLayout: Beträge kommen als bereits formatierter Text durch (\"1.234,56 €\")", () => {
  const betrag = formatEuro(123456); // 1.234,56 €
  const l = briefLayout({ betreff: "Mahnung", absaetze: ["Text."], tabelle: { zeilen: [["Offener Betrag", betrag]] } });
  assert.equal(l.seiten[0].tabelle.zeilen[0][1], betrag);
  assert.match(betrag, /^1\.234,56\s€$/u);
});

test("briefLayout: kein Zeichen außerhalb WinAnsi im Modell — wird zu „?“, gezählt in `ersetzt`", () => {
  const l = briefLayout({ absender: ["Büro ✓"], empfaenger: ["Kunde"], betreff: "Mahnung ⚠", absaetze: ["Text mit ↑ Pfeil."] });
  assert.ok(l.absender[0].includes("?") && !l.absender[0].includes("✓"));
  assert.ok(l.betreff.includes("?") && !l.betreff.includes("⚠"));
  assert.ok(l.seiten[0].zeilen.join(" ").includes("?"));
  assert.ok(l.ersetzt >= 3);
});

test("briefLayout: langer Fließtext bricht in mehrere Zeilen um und läuft auf eine Folgeseite über", () => {
  const langerAbsatz = Array.from({ length: 200 }, (_, i) => `Satz Nummer ${i + 1} mit ein paar Wörtern.`).join(" ");
  const l = briefLayout({ betreff: "Mahnung", absaetze: [langerAbsatz] });
  assert.ok(l.seiten.length >= 2, "der Text ist länger als eine Seite");
  assert.ok(l.seiten[0].zeilen.length > 1, "Umbruch in mehrere Zeilen");
  for (const seite of l.seiten) for (const zeile of seite.zeilen) assert.ok(zeile.length <= l.zeichenJeZeile);
});

test("briefLayout: die Beitrags-Tabelle bleibt bei der letzten Seite, solange sie dort noch passt", () => {
  const l = briefLayout({ betreff: "Mahnung", absaetze: ["Ein kurzer Text."], tabelle: { zeilen: [["Offener Betrag", "100,00 €"], ["Summe", "100,00 €"]] } });
  assert.equal(l.seiten.length, 1);
  assert.ok(l.seiten[0].tabelle);
  assert.equal(l.seiten[0].tabelle.zeilen.length, 2);
});

test("briefkopfAus/briefkopfZeilen: Standardwerte ohne gespeichertes Setting, eigene Werte übernommen", () => {
  assert.equal(briefkopfAus(null).office, "Architekturbüro");
  assert.deepEqual(briefkopfZeilen(null), ["Architekturbüro"]);
  const eigen = { office: "Testbüro", address: "Musterstraße 1\n90402 Nürnberg" };
  assert.deepEqual(briefkopfZeilen(eigen), ["Testbüro", "Musterstraße 1", "90402 Nürnberg"]);
});

test("mahnBrief: Eingabe für briefLayout aus mahnTextFelder-Feldern", () => {
  const felder = {
    absenderZeilen: ["Testbüro"], empfaengerZeilen: ["Kunde GmbH"], datum: "27.09.2026", betreff: "Mahnung",
    anrede: "Sehr geehrte Damen und Herren,", absaetze: ["Erster Satz.", "Zweiter Satz."],
    tabelle: { kopf: [], zeilen: [["Offener Betrag", "100,00 €"]] },
  };
  const eingabe = mahnBrief(felder);
  assert.deepEqual(eingabe.absender, ["Testbüro"]);
  assert.deepEqual(eingabe.absaetze, ["Sehr geehrte Damen und Herren,", "Erster Satz.", "Zweiter Satz."]);
  const l = briefLayout(eingabe);
  assert.equal(l.betreff, "Mahnung");
});
