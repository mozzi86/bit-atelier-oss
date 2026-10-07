// Referenzpreis-Kaskade — Modulverhalten (Phase 33 / W7, Plan 33-04).
//
// Die Reproduktion der 130 Schichten auf den Realdaten prüft Gate G18. Hier geht
// es um jede der sechs Kaskadenstufen EINZELN und um ihre Grenzwerte
// (0,75 / 0,55 / 0,4 / 3,0 / 1 %) — genau dort, wo eine Position von „übernommen"
// nach „zur Sichtung" oder „verworfen" kippt.

import test from "node:test";
import assert from "node:assert/strict";
import {
  AUSGANG, VERFAHREN, ernte, pruefePaar, schwellenAus, vergleichsEinheit,
} from "@ava/lib/referenzPreise.js";

// Der Katalog als DATEN — genau die Form, die `catalog-seed.js` liefert.
const KATALOG = [
  {
    name: "Referenzpreis aus Fremdprojekt (Kurztext-Match)",
    von: "referenz_projekt",
    einheit_muss_gleich: true,
    min_similarity: 0.75,
    review_von: 0.55,
    ratio_min: 0.4,
    ratio_max: 3.0,
    verwerfen_wenn_nahe_basis: 0.01,
    verfahren: "Ratcliff/Obershelp",
  },
];
const EINHEITEN = [
  { code: "m", vergleich: "m" },
  { code: "lfm", vergleich: "m" },
  { code: "m2", vergleich: "m2" },
  { code: "m²", vergleich: "m2" },
  { code: "St", vergleich: "st" },
  { code: "Stk", vergleich: "st" },
];

const S = schwellenAus(KATALOG);
const TEXT = "Bauzaun H 2m aufstellen räumen";
const pos = (o = {}) => ({ oz: "0001", kurztext: TEXT, einheit: "m", ...o });
const fremd = (o = {}) => ({ oz: "0001", kurz: TEXT, me: "m", ep: 200, ...o });

test("Stufe 0: ohne Katalogzeile wird NICHT geraten", () => {
  const leer = schwellenAus([]);
  assert.equal(leer.fehlt, true);
  assert.match(leer.grund, /PreisUebernahmeRegel/);
  // Und es wird nichts übernommen.
  assert.equal(pruefePaar(pos(), fremd(), 100, leer, EINHEITEN).ausgang, AUSGANG.KEIN_MATCH);
  // Auch eine Zeile ohne Schwellen zählt nicht.
  assert.equal(schwellenAus([{ von: "referenz_projekt" }]).fehlt, true);
});

test("Stufe 0: die Schwellen kommen ALLE aus dem Katalog", () => {
  assert.equal(S.fehlt, false);
  assert.equal(S.min_similarity, 0.75);
  assert.equal(S.review_von, 0.55);
  assert.equal(S.ratio_min, 0.4);
  assert.equal(S.ratio_max, 3.0);
  assert.equal(S.verwerfen_wenn_nahe_basis, 0.01);
  assert.equal(S.einheit_muss_gleich, true);
  // Eine geänderte Katalogzeile ändert das Verhalten — ohne Codeänderung.
  const streng = schwellenAus([{ ...KATALOG[0], min_similarity: 0.99 }]);
  const r = pruefePaar(pos(), fremd({ kurz: "Bauzaun H 2m aufstellen" }), 100, streng, EINHEITEN);
  assert.equal(r.ausgang, AUSGANG.REVIEW, "mit strengerer Schwelle nur noch Sichtung");
  assert.equal(VERFAHREN.length > 20, true);
});

test("Stufe 1: ohne Einheitspreis ⇒ eigener Ausgang, NIE eine 0", () => {
  for (const ep of [null, undefined, "", 0]) {
    const r = pruefePaar(pos(), fremd({ ep }), 100, S, EINHEITEN);
    assert.equal(r.ausgang, AUSGANG.OHNE_PREIS, `ep = ${JSON.stringify(ep)}`);
    assert.equal(r.ep, null);
  }
});

test("Stufe 2: Einheit muss KANONISCH gleich sein — Stk == St, m² == m2, lfm == m", () => {
  assert.equal(vergleichsEinheit("Stk", EINHEITEN), "st");
  assert.equal(vergleichsEinheit("St", EINHEITEN), "st");
  assert.equal(vergleichsEinheit("lfm", EINHEITEN), "m");
  assert.equal(vergleichsEinheit("m²", EINHEITEN), "m2");
  // Unbekannter Code: kleingeschrieben, aber NICHT „gleich".
  assert.equal(vergleichsEinheit("QM", EINHEITEN), "qm");
  assert.equal(vergleichsEinheit(null, EINHEITEN), "");

  assert.equal(pruefePaar(pos({ einheit: "lfm" }), fremd({ me: "m" }), 100, S, EINHEITEN).ausgang, AUSGANG.UEBERNAHME);
  assert.equal(pruefePaar(pos({ einheit: "Stk" }), fremd({ me: "St" }), 100, S, EINHEITEN).ausgang, AUSGANG.UEBERNAHME);
  const ungleich = pruefePaar(pos({ einheit: "m2" }), fremd({ me: "m" }), 100, S, EINHEITEN);
  assert.equal(ungleich.ausgang, AUSGANG.EINHEIT_UNGLEICH);
  assert.equal(ungleich.sim, null, "es wird nicht einmal verglichen");
  // Abschaltbar über den Katalog — dann wird nicht mehr geprüft.
  const ohne = schwellenAus([{ ...KATALOG[0], einheit_muss_gleich: false }]);
  assert.equal(pruefePaar(pos({ einheit: "m2" }), fremd({ me: "m" }), 100, ohne, EINHEITEN).ausgang, AUSGANG.UEBERNAHME);
});

test("Stufe 3: die 1-%-Verwerfung — Grenzwerte in beide Richtungen", () => {
  // |ep/basis − 1| < 1 % ⇒ verworfen (der Index bleibt die bessere Aussage).
  assert.equal(pruefePaar(pos(), fremd({ ep: 100 }), 100, S, EINHEITEN).ausgang, AUSGANG.NAHE_BASIS);
  assert.equal(pruefePaar(pos(), fremd({ ep: 100.99 }), 100, S, EINHEITEN).ausgang, AUSGANG.NAHE_BASIS);
  assert.equal(pruefePaar(pos(), fremd({ ep: 99.01 }), 100, S, EINHEITEN).ausgang, AUSGANG.NAHE_BASIS);
  // Genau AUF der Schwelle greift die Verwerfung NICHT mehr (strikt kleiner).
  assert.equal(pruefePaar(pos(), fremd({ ep: 101 }), 100, S, EINHEITEN).ausgang, AUSGANG.UEBERNAHME);
  assert.equal(pruefePaar(pos(), fremd({ ep: 99 }), 100, S, EINHEITEN).ausgang, AUSGANG.UEBERNAHME);
  // Ohne Basis gibt es nichts zu verwerfen — und kein `ratio`.
  const ohneBasis = pruefePaar(pos(), fremd({ ep: 200 }), null, S, EINHEITEN);
  assert.equal(ohneBasis.ausgang, AUSGANG.UEBERNAHME);
  assert.equal(ohneBasis.ratio, null);
  // Basis 0 ist keine Basis (keine Division durch 0).
  assert.equal(pruefePaar(pos(), fremd({ ep: 200 }), 0, S, EINHEITEN).ratio, null);
});

test("Stufe 4: das ratio-Fenster [0,4; 3,0] — Grenzwerte", () => {
  const aus = (ep) => pruefePaar(pos(), fremd({ ep }), 100, S, EINHEITEN);
  assert.equal(aus(300).ausgang, AUSGANG.UEBERNAHME, "ratio 3,0 ist DRIN");
  assert.equal(aus(40).ausgang, AUSGANG.UEBERNAHME, "ratio 0,4 ist DRIN");
  // Draußen: bei hoher Ähnlichkeit ⇒ Sichtung (nicht Übernahme, nicht verschwiegen).
  assert.equal(aus(300.01).ausgang, AUSGANG.REVIEW);
  assert.equal(aus(39.99).ausgang, AUSGANG.REVIEW);
  assert.equal(aus(10000).ausgang, AUSGANG.REVIEW);
  // `ratio` bleibt UNGERUNDET im Prüfergebnis (gerundet wird erst an der Schicht) —
  // 300,01/100 ist als Double 3.0000999999999998, nicht 3.0001.
  assert.ok(Math.abs(aus(300.01).ratio - 3.0001) < 1e-12);
});

test("Stufe 5+6: die Ähnlichkeitsschwellen 0,75 und 0,55", () => {
  // Identischer Text ⇒ sim 1 ⇒ Übernahme.
  assert.equal(pruefePaar(pos(), fremd(), 100, S, EINHEITEN).ausgang, AUSGANG.UEBERNAHME);
  // Völlig fremder Text ⇒ unter 0,55 ⇒ kein Match (KEINE Sichtung).
  const fremdText = pruefePaar(pos(), fremd({ kurz: "Estrich schleifen versiegeln" }), 100, S, EINHEITEN);
  assert.equal(fremdText.ausgang, AUSGANG.KEIN_MATCH);
  assert.ok(fremdText.sim < S.review_von);
  assert.match(fremdText.grund, /unter der Sichtungsschwelle/);

  // Ein Text im Sichtungsband: konstruiert über die Schwellen des Katalogs.
  const kandidaten = [
    "Bauzaun H 2m aufstellen",
    "Bauzaun aufstellen",
    "Bauzaun H 2m",
    "Zaun H 2m aufstellen räumen provisorisch",
  ];
  const bandTreffer = kandidaten
    .map((kurz) => pruefePaar(pos(), fremd({ kurz }), 100, S, EINHEITEN))
    .filter((r) => r.ausgang === AUSGANG.REVIEW);
  assert.ok(bandTreffer.length > 0, "mindestens ein Fall muss ins Sichtungsband fallen");
  for (const r of bandTreffer) {
    assert.ok(r.sim >= S.review_von && r.sim < S.min_similarity, `sim ${r.sim}`);
    assert.match(r.grund, /^sim=/);
  }
});

test("ernte: Bilanz, Schichten und die Regel „nie überschreiben“", () => {
  const positionen = [
    { id: "a", gewerk_nr: "001", oz: "1", kurztext: TEXT, einheit: "m" },
    { id: "b", gewerk_nr: "001", oz: "2", kurztext: TEXT, einheit: "m2" }, // Einheit passt nicht
    { id: "c", gewerk_nr: "001", oz: "3", kurztext: TEXT, einheit: "m" },  // kein Fremdeintrag
  ];
  const e = ernte({
    positionen,
    fremd: {
      "001|1": { oz: "1", kurz: TEXT, me: "m", ep: 200 },
      "001|2": { oz: "2", kurz: TEXT, me: "m", ep: 200 },
    },
    basis: { "001|1": { ep: 100 }, "001|2": { ep: 100 } },
    uebernahmeKatalog: KATALOG,
    einheitenKatalog: EINHEITEN,
    projekt_nr: "<Referenz-ID>",
    quelle: "Testquelle",
    stand: "2025-05",
  });
  assert.equal(e.bilanz.positionen, 3);
  assert.equal(e.bilanz.uebernommen, 1);
  assert.equal(e.bilanz.einheit_ungleich, 1);
  assert.equal(e.bilanz.kein_match, 1);
  assert.equal(e.schichten.length, 1);

  const s = e.schichten[0];
  assert.equal(s.art, "referenzprojekt", "Rang 30 — unter Vertrag/Markt, über Index");
  assert.equal(s.ep, 200);
  assert.equal(s.stand, "2025-05");
  assert.equal(s.review.flag, false);
  assert.equal(s.match.similarity, 1);
  assert.equal(s.match.ratio, 2);
  assert.equal(s.herkunft.projekt_nr, "<Referenz-ID>");
  assert.equal(s.herkunft.beleg, "Testquelle");
  // Die Normalisierung reist mit — damit ein Match nachvollziehbar ist.
  assert.ok(s.match.normalisierung_eigen);
  assert.ok(s.match.normalisierung_fremd);
  // Es gibt KEIN Update-Feld: eine Übernahme ist immer eine zusätzliche Schicht.
  assert.equal("ersetzt_id" in s, false);
  assert.equal("id" in s, false, "die ID vergibt die Datenbank");

  // Zeilen sind vollständig — auch die verworfenen sind ausgewiesen.
  assert.equal(e.zeilen.length, 2, "nur Positionen MIT Fremdeintrag erzeugen eine Zeile");
  assert.ok(e.zeilen.every((z) => z.ausgang));
  assert.deepEqual(e.warnungen, []);
});

test("ernte: Sichtungsschichten tragen `review.flag` und einen Grund", () => {
  const e = ernte({
    positionen: [{ id: "a", gewerk_nr: "001", oz: "1", kurztext: TEXT, einheit: "m" }],
    fremd: { "001|1": { oz: "1", kurz: TEXT, me: "m", ep: 1000 } }, // ratio 10 ⇒ Ausreißer
    basis: { "001|1": { ep: 100 } },
    uebernahmeKatalog: KATALOG,
    einheitenKatalog: EINHEITEN,
    projekt_nr: "<Referenz-ID>",
  });
  assert.equal(e.bilanz.review, 1);
  const s = e.schichten[0];
  assert.equal(s.review.flag, true);
  assert.ok(s.review.grund);
  assert.match(s.herkunft.beleg, /SICHTUNG/);
});

test("ernte: leere Eingaben ergeben eine leere Bilanz, keine Ausnahme", () => {
  const e = ernte({ uebernahmeKatalog: KATALOG, einheitenKatalog: EINHEITEN });
  assert.equal(e.bilanz.positionen, 0);
  assert.deepEqual(e.schichten, []);
  assert.deepEqual(e.zeilen, []);
  // OHNE Katalog: Warnung UND keine Schichten.
  const ohne = ernte({
    positionen: [{ id: "a", gewerk_nr: "001", oz: "1", kurztext: TEXT, einheit: "m" }],
    fremd: { "001|1": { kurz: TEXT, me: "m", ep: 200 } },
  });
  assert.equal(ohne.warnungen.length, 1);
  assert.deepEqual(ohne.schichten, []);
});

test("ernte: eigener Schlüssel-Bildner (fremdes LV mit anderer OZ-Systematik)", () => {
  const e = ernte({
    positionen: [{ id: "x", oz: "AB-1", kurztext: TEXT, einheit: "m" }],
    fremd: { "AB-1": { kurz: TEXT, me: "m", ep: 200 } },
    basis: { "AB-1": { ep: 100 } },
    uebernahmeKatalog: KATALOG,
    einheitenKatalog: EINHEITEN,
    schluessel: (p) => p.oz,
  });
  assert.equal(e.bilanz.uebernommen, 1);
  assert.equal(e.schichten[0].position_id, "x");
});
