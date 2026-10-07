// GAEB X83 (DA83/3.3) — Verhalten von Builder und Leser an den Rändern
// (Phase 33 / W5).
//
// Die Parität gegen die 15 echten X83 prüft Gate G15. Hier geht es um die Fälle,
// die im Realdatensatz nicht vorkommen: fehlende Mengen, Sonderzeichen,
// kollidierende IDs, kaputtes XML, XXE — also darum, dass weder eine erfundene
// Menge noch eine stille Textzerstörung durchgeht.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CTLG, DA83_NS, EINHEIT_MAP, buildX83, buildX83Dateien, einheit, q3, spans,
} from "@ava/lib/gaebX83.js";
import { MAX_TIEFE, menge, normalisiereEinheit, pruefeWohlgeformt, readX83 } from "@ava/lib/gaebXmlRead.js";

const pos = (o = {}) => ({
  oz: "01010010",
  titel: ["Abbrucharbeiten", "Baustelleneinrichtung"],
  titel_oz: ["01", "0101"],
  kurztext: "Baustelleneinrichtung",
  menge_final: 1,
  einheit: "Psch",
  ...o,
});
const bau = (positionen, extra = {}) =>
  buildX83({ positionen, gewerk_nr: "001", lv_name: "Testlos", kg: {}, meta: { datum: "2026-01-01", zeit: "00:00:00" }, ...extra });

test("Grundgerüst: Namespace, Version, DP 83, OZ-Grammatik 2+2+4", () => {
  const xml = bau([pos()]);
  assert.ok(xml.includes(`<GAEB xmlns="${DA83_NS}">`));
  assert.match(xml, /<Version>3\.3<\/Version>/);
  assert.match(xml, /<VersDate>2021-05<\/VersDate>/);
  assert.match(xml, /<DP>83<\/DP>/);
  assert.match(xml, /<OutlCompl>AllTxt<\/OutlCompl>/);
  assert.equal((xml.match(/<BoQBkdn>/g) || []).length, 3);
  assert.match(xml, /<LblBoQBkdn>Bereich<\/LblBoQBkdn><Length>2<\/Length>/);
  assert.match(xml, /<LblBoQBkdn>Abschnitt<\/LblBoQBkdn><Length>2<\/Length>/);
  assert.match(xml, /<LblBoQBkdn>Position<\/LblBoQBkdn><Length>4<\/Length>/);
});

test("beide Ctlg-Deklarationen stehen ZEICHENGLEICH drin", () => {
  const xml = bau([pos()]);
  assert.equal(CTLG.DIN276_2008.typ, "cost group DIN 276-1 2008-12");
  assert.equal(CTLG.DIN276_2018.typ, "cost group DIN 276 2018-12");
  for (const c of [CTLG.DIN276_2008, CTLG.DIN276_2018]) {
    assert.ok(xml.includes(`<CtlgID>${c.id}</CtlgID><CtlgType>${c.typ}</CtlgType><CtlgName>${c.name}</CtlgName>`));
  }
});

test("Item-ID ist der VOLLE OZ-Pfad — sonst kollidieren die IDs", () => {
  const p = [
    pos({ oz: "01010010" }),
    // Gleiche Positionsnummer 0010, anderer Abschnitt: mit bloßem RNoPart
    // wären beide IDs identisch und der Ziel-Import verwirft eine davon.
    pos({ oz: "01020010", titel: ["Abbrucharbeiten", "Sanitär"], titel_oz: ["01", "0102"] }),
  ];
  const xml = bau(p);
  const ids = [...xml.matchAll(/<Item[^>]*ID="([^"]+)"/g)].map((m) => m[1]);
  // I + Gewerk(3) + Bereich(2) + Abschnitt(2) + Position(4)
  assert.deepEqual(ids, ["I00101010010", "I00101020010"]);
  assert.equal(new Set(ids).size, 2, "die IDs müssen dokumentweit eindeutig sein");
  const rnos = [...xml.matchAll(/<Item[^>]*RNoPart="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rnos, ["0010", "0010"], "die RNoPart allein ist NICHT eindeutig — genau der Bug");
});

test("Qty: 3 Dezimalen, und fehlende Menge wird 1.000 statt 0.000", () => {
  assert.equal(q3(4034.5), "4034.500");
  assert.equal(q3(1), "1.000");
  assert.equal(q3("12,5"), "1.000", "ein Dezimalkomma ist keine Zahl — Fallback statt Fehlwert");
  // Die Falle: Number(null) === 0. Eine 0.000 wäre im Ziel-Import eine
  // gestrichene Position.
  assert.equal(q3(null), "1.000");
  assert.equal(q3(undefined), "1.000");
  assert.equal(q3(""), "1.000");
  assert.equal(q3(true), "1.000");
  assert.equal(q3(NaN), "1.000");
  // Eine echte 0 bleibt 0.
  assert.equal(q3(0), "0.000");
  assert.match(bau([pos({ menge_final: null })]), /<Qty>1\.000<\/Qty>/);
});

test("Einheiten-Map: nur die real vorkommenden Abweichungen, Rest unverändert", () => {
  assert.deepEqual(EINHEIT_MAP, { Psch: "psch", Stk: "St", lfm: "m", Std: "h", "m²": "m2", to: "t" });
  assert.equal(einheit("m²"), "m2");
  assert.equal(einheit("Stk"), "St");
  assert.equal(einheit("kg"), "kg");
  assert.equal(einheit(null), "");
});

test("Sonderzeichen: Umlaute bleiben, XML-Zeichen werden escapet", () => {
  const xml = bau([pos({ kurztext: 'Türen & Fenster <außen> "grün"' })]);
  assert.ok(xml.includes("Türen &amp; Fenster &lt;außen&gt; \"grün\""));
  const r = readX83(xml);
  assert.equal(r.positionen[0].short_text, 'Türen & Fenster <außen> "grün"');
});

test("spans(): Leerzeilen entfallen, leerer Text ergibt EIN leeres span", () => {
  assert.equal(spans("a\n\nb"), "<span>a</span><span>b</span>");
  assert.equal(spans(""), "<span></span>");
  assert.equal(spans(null), "<span></span>");
});

test("DetailTxt entsteht NUR bei vorhandenem Langtext", () => {
  assert.equal(bau([pos()]).includes("<DetailTxt>"), false, "ein leeres DetailTxt behauptet einen Text");
  const mit = bau([pos({ langtext: "Zeile 1\nZeile 2" })]);
  assert.equal((mit.match(/<DetailTxt>/g) || []).length, 1);
  assert.equal(readX83(mit).positionen[0].long_text, "Zeile 1\nZeile 2");
  // `long_text` als Alternativfeld (so heißt es in der LV-Entität).
  assert.ok(bau([pos({ long_text: "aus long_text" })]).includes("<DetailTxt>"));
});

test("CtlgAssign: je Fassung eine — und keine ohne Code", () => {
  const kg = { "001|01010010": { kg2018: "391", kg2008: "391" } };
  const beide = bau([pos()], { kg });
  assert.equal((beide.match(/<CtlgAssign/g) || []).length, 2);
  const nur2018 = bau([pos()], { kg: { "001|01010010": { kg2018: "391" } } });
  assert.equal((nur2018.match(/<CtlgAssign/g) || []).length, 1);
  const keine = bau([pos()], { kg: {} });
  assert.equal((keine.match(/<CtlgAssign/g) || []).length, 0, "keine erfundene Kostengruppe");
});

test("ROUNDTRIP: OZ aus der RNoPart-Kette, nicht aus Item@ID", () => {
  const xml = bau([pos({ oz: "04010010", titel_oz: ["04", "0401"] })], { gewerk_nr: "004" });
  const r = readX83(xml);
  assert.equal(r.positionen.length, 1);
  assert.equal(r.positionen[0].oz, "04010010");
  assert.notEqual(r.positionen[0].oz, r.positionen[0].item_id);
  assert.match(r.positionen[0].item_id, /^I004/);
  assert.equal(/^I/.test(r.positionen[0].oz), false, "die alte Falle: I00401010010 als OZ");
  assert.equal(r.positionen[0].trade, "Testlos", "Gewerk aus LblBoQ");
  assert.equal(r.gewerk_nr, "004");
  assert.equal(r.positionen[0].unit_price, null, "eine Angebotsaufforderung hat keinen Preis");
});

test("ROUNDTRIP: DIN 276 in BEIDEN Fassungen, getrennt geführt", () => {
  const kg = { "001|01010010": { kg2018: "353", kg2008: "352" } };
  const r = readX83(bau([pos()], { kg }));
  // 353 heißt 2018 „Deckenbeläge", 2008 „Deckenbekleidungen" — die Fassungen
  // werden NIE ineinander gemappt.
  assert.equal(r.positionen[0].din276, "353");
  assert.equal(r.positionen[0].din276_2008, "352");
});

test("ROUNDTRIP: Titelhierarchie bleibt zweistufig erhalten", () => {
  const r = readX83(bau([pos()]));
  assert.deepEqual(r.positionen[0].titel_pfad, ["Abbrucharbeiten", "Baustelleneinrichtung"]);
  assert.deepEqual(r.positionen[0].titel_oz, ["01", "01"]);
  assert.deepEqual(r.positionen[0].oz_kette, ["01", "01", "0010"]);
});

test("mehrere Positionen im selben Abschnitt behalten ihre Reihenfolge", () => {
  const p = ["0010", "0020", "0030"].map((n) => pos({ oz: `0101${n}`, kurztext: `Pos ${n}` }));
  const r = readX83(bau(p));
  assert.deepEqual(r.positionen.map((x) => x.oz), ["01010010", "01010020", "01010030"]);
  assert.equal((bau(p).match(/<BoQCtgy /g) || []).length, 2, "ein Bereich, ein Abschnitt");
});

test("buildX83Dateien: je Gewerk eine Datei mit Konventionsnamen", () => {
  const dateien = buildX83Dateien({
    positionen: [pos({ gewerk_nr: "001" }), pos({ gewerk_nr: "002", oz: "01010010" })],
    lvs: [{ gewerk_nr: "001", lv_name: "Abbruch- und Schadstoff" }, { gewerk_nr: "002", lv_name: "Garten- und Landschaft" }],
    kg: {},
    meta: { datum: "2026-07-22", zeit: "12:00:00" },
  });
  assert.equal(dateien.length, 2);
  assert.deepEqual(dateien.map((d) => d.gewerk_nr), ["001", "002"]);
  // Default project number is the neutral "LV" (phase 78 hotfix: no real
  // project number ships in the bundle); callers pass their own projektNr.
  assert.equal(dateien[0].dateiname, "LV_001_Abbruch_und_Schadstoff_KB_260722.x83");
  assert.equal(dateien[0].positionen, 1);
});

test("Wohlgeformtheit wird geprüft — mit dem eigenen Tokenizer", () => {
  assert.ok(pruefeWohlgeformt(bau([pos()])) > 20);
  assert.throws(() => pruefeWohlgeformt("<a><b></a></b>"), /nicht wohlgeformt/);
  assert.throws(() => pruefeWohlgeformt("<a>"), /nicht geschlossen/);
  assert.throws(() => pruefeWohlgeformt("kein XML"), /kein einziges Element/);
});

test("Leser-Härtung: kein DTD, keine fremden Entities, Tiefenlimit (T-33-17)", () => {
  assert.throws(() => readX83('<!DOCTYPE a SYSTEM "http://x"><a/>'), /DOCTYPE/);
  // Eine fremde Entity bleibt LITERAL stehen, statt aufgelöst zu werden.
  const r = readX83("<GAEB><Award><BoQ><BoQInfo><LblBoQ>&geheim;</LblBoQ></BoQInfo></BoQ></Award></GAEB>");
  assert.equal(r.gewerk, "&geheim;");
  // Numerische Referenzen und die 5 Standardentitäten funktionieren.
  const r2 = readX83("<GAEB><Award><BoQ><BoQInfo><LblBoQ>a&amp;b&#252;</LblBoQ></BoQInfo></BoQ></Award></GAEB>");
  assert.equal(r2.gewerk, "a&bü");
  // Tiefenbombe.
  const tief = "<a>".repeat(MAX_TIEFE + 5) + "</a>".repeat(MAX_TIEFE + 5);
  assert.throws(() => readX83(tief), /zu tief/);
});

test("menge(): tolerant, aber niemals eine erfundene 0", () => {
  assert.equal(menge("1234.56"), 1234.56);
  assert.equal(menge("1234,56"), 1234.56);
  assert.equal(menge("1.234,56"), 1234.56);
  assert.equal(menge(""), null);
  assert.equal(menge(null), null);
  assert.equal(menge("k. A."), null);
  assert.equal(menge("0"), 0, "eine belegte 0 bleibt 0");
});

test("normalisiereEinheit nutzt den Katalog, fällt sonst auf den Rohwert zurück", () => {
  const kat = [{ code: "m2", gaeb: "m2", name: "Quadratmeter" }];
  assert.equal(normalisiereEinheit("m2", kat), "m2");
  assert.equal(normalisiereEinheit("Quadratmeter", kat), "m2");
  assert.equal(normalisiereEinheit("Fass", kat), "Fass");
  assert.equal(normalisiereEinheit("", kat), "");
});

test("eine Position ohne lesbare Menge wird GEMELDET, nicht geglättet", () => {
  const r = readX83(bau([pos()]).replace("<Qty>1.000</Qty>", "<Qty>k. A.</Qty>"));
  assert.equal(r.positionen[0].quantity, null);
  assert.equal(r.warnungen.length, 1);
  assert.match(r.warnungen[0], /Menge nicht lesbar/);
});
