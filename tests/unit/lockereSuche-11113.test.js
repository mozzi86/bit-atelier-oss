// Unit tests of the shared forgiving matcher (plan 111-13, S-18) and of the list filters that use it.
//
// The first block is the red-before evidence: on the code before 111-13 the settings search (src/lib/settings/suche.js,
// textMatch.normalisiere + substring) found neither "Bueroname" for "Büroname" nor a typo like "Breifkopf", and lost "ß"
// entirely. The second block is the contract of @core/lib/lockereSuche.js itself.
// Run: node --test --import ./tests/alias-register.mjs tests/unit/lockereSuche-11113.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { sucheEinstellungen } from "@/lib/settings/suche.js";
import { EINSTELLUNGS_BEREICHE } from "@/lib/settings/bereiche.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";

const einstellung = (text) =>
  sucheEinstellungen(text, { bereiche: EINSTELLUNGS_BEREICHE, regelwerke: REGELWERKE, kontext: { personalZugang: "erlaubt" } })
    .map((t) => t.bereich);

test("Einstellungssuche: ae/ue statt Umlaut findet denselben Bereich", () => {
  assert.equal(einstellung("Bueroname")[0], "office");
  assert.equal(einstellung("büroname")[0], "office");
});

test("Einstellungssuche: ein Tippfehler (Buchstabendreher) findet den Bereich trotzdem", () => {
  assert.equal(einstellung("Breifkopf")[0], "office");
});

test("Einstellungssuche: Wortreihenfolge ist egal", () => {
  // Same words, two orders — the same first hit.
  const vorwaerts = einstellung("Büro Name");
  const rueckwaerts = einstellung("Name Büro");
  assert.ok(vorwaerts.length > 0, "kein Treffer für „Büro Name“");
  assert.equal(rueckwaerts[0], vorwaerts[0]);
});

// ---------------------------------------------------------------------------
// Contract of the shared matcher
// ---------------------------------------------------------------------------

const { suchNormal, lockerBewerten, lockerPasst, lockerFiltern, suchVorbereiten } = await import("@core/lib/lockereSuche.js");

test("suchNormal: Kleinschreibung, ä/ö/ü → ae/oe/ue, ß → ss, Akzente weg, Trennzeichen zu Leerzeichen", () => {
  assert.equal(suchNormal("Straße"), "strasse");
  assert.equal(suchNormal("Prüf-Suite"), "pruef suite");
  assert.equal(suchNormal("  ÄÖÜ  café_x "), "aeoeue cafe x");
  assert.equal(suchNormal(null), "");
});

test("ß und ss sind gleich, Umlaut und ae/oe/ue auch — in beide Richtungen", () => {
  assert.ok(lockerPasst("Strasse", "Straße 1"));
  assert.ok(lockerPasst("Straße", "Strasse 1"));
  assert.ok(lockerPasst("Waende", "Wände verputzen"));
  assert.ok(lockerPasst("Wände", "Waende verputzen"));
  assert.ok(lockerPasst("FUSSBODEN", "Fußboden"));
});

test("Groß-/Kleinschreibung und Wortreihenfolge spielen keine Rolle", () => {
  assert.ok(lockerPasst("suite prüf", "Prüf-Suite"));
  assert.ok(lockerPasst("KOMPLEX designer", "Komplex-Designer"));
});

test("Trennzeichen sind egal: zusammengeschrieben findet getrennt und umgekehrt", () => {
  assert.ok(lockerPasst("pruefsuite", "Prüf-Suite"));
  assert.ok(lockerPasst("prüf suite", "Prüfsuite"));
});

test("Kleine Tippfehler: ein vertauschter, fehlender, zusätzlicher oder falscher Buchstabe", () => {
  assert.ok(lockerPasst("Protokol", "Besprechungsprotokoll"), "fehlender Buchstabe (Präfix)");
  assert.ok(lockerPasst("Protkoll", "Protokoll"), "Dreher");
  assert.ok(lockerPasst("Protokkoll", "Protokoll"), "zusätzlicher Buchstabe");
  assert.ok(lockerPasst("Protakoll", "Protokoll"), "falscher Buchstabe");
  assert.ok(lockerPasst("Wande", "Wände"), "Umlaut als einfacher Vokal getippt");
});

test("Buchstabenfolge innerhalb eines Wortes (Abkürzung) trifft", () => {
  assert.ok(lockerPasst("kmplx", "Komplex-Designer"));
});

test("Kein Treffer, wenn ein Wort der Anfrage nirgends passt", () => {
  assert.equal(lockerPasst("Dach Keller", "Dachgeschoss"), false);
  assert.equal(lockerPasst("xyz", "Prüf-Suite"), false);
  // Short words get no typo tolerance: "ab" must not find "an".
  assert.equal(lockerPasst("ab", "an"), false);
  // Two typos in a short word are too many.
  assert.equal(lockerPasst("Prtkll", "Protokoll und mehr"), true, "Buchstabenfolge darf das finden");
  assert.equal(lockerPasst("Qrotokolx", "Protokoll"), false);
});

test("Leere Anfrage passt auf alles (der Aufrufer entscheidet, ob er dann etwas zeigt)", () => {
  assert.ok(lockerPasst("", "egal"));
  assert.ok(lockerPasst("   ", "egal"));
  assert.equal(lockerBewerten("", "egal"), 1);
});

test("Rangfolge: genau > Wortanfang > Teilstring > Tippfehler > Buchstabenfolge", () => {
  const genau = lockerBewerten("Prüf-Suite", "Prüf-Suite");
  const anfang = lockerBewerten("Prüf", "Prüf-Suite starten");
  const teil = lockerBewerten("suite", "Prüfsuite");
  const tipp = lockerBewerten("Protkoll", "Protokoll");
  const folge = lockerBewerten("kmplx", "Komplex");
  assert.ok(genau > anfang, `${genau} > ${anfang}`);
  assert.ok(anfang > teil, `${anfang} > ${teil}`);
  assert.ok(teil > tipp, `${teil} > ${tipp}`);
  assert.ok(tipp > folge, `${tipp} > ${folge}`);
  assert.ok(folge > 0);
});

test("lockerFiltern: sortiert nach Güte, stabil bei Gleichstand, mit Obergrenze", () => {
  const liste = [{ t: "Zur Prüf-Suite" }, { t: "Prüf-Suite" }, { t: "Adressbuch" }, { t: "Prüfsuite Hilfe" }];
  const treffer = lockerFiltern(liste, "Prüf-Suite", (x) => x.t);
  assert.deepEqual(treffer.map((x) => x.t), ["Prüf-Suite", "Zur Prüf-Suite", "Prüfsuite Hilfe"]);
  assert.deepEqual(lockerFiltern(liste, "", (x) => x.t).map((x) => x.t), liste.map((x) => x.t), "leer = alles in Reihenfolge");
  assert.equal(lockerFiltern(liste, "suite", (x) => x.t, { max: 1 }).length, 1);
});

test("suchVorbereiten: ein vorbereiteter Text bewertet gleich wie der rohe", () => {
  const roh = "Besprechungsprotokoll Nr. 3 – Jour fixe";
  const vor = suchVorbereiten(roh);
  for (const q of ["jour", "protokol", "nr 3", "fixe jour", "besprechung"]) {
    assert.equal(lockerBewerten(q, vor), lockerBewerten(q, roh), q);
  }
});
