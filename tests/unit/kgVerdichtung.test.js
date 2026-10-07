// KgRegel-Verdichtung und LLM-Vorschlag — Modulverhalten (Phase 33 / W7).
//
// Den Reproduktionsgrad auf den 497 echten Kurztexten prüft Gate G18. Hier geht es
// um die Mechanik: Determinismus, die offene Liste, und die Regel, an der nicht
// gerüttelt wird — **ein LLM-Vorschlag ist ein Vorschlag** (A7 / T-33-23).

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LEITWORTE, TYPESAFE_BLOCK, TYPESAFE_SCHWELLEN, TYPESAFE_UNBEKANNT, kgOptionen, llmAuftrag, ordneZu,
  pruefeReproduktion, typesafeAuftrag, verdichte, vorschlaegeAus, vorschlaegeAusTypesafe,
} from "@ava/lib/kgVerdichtung.js";

const DIN = [
  { fassung: "2018", code: "341", name: "Tragende Innenwände" },
  { fassung: "2018", code: "342", name: "Nichttragende Innenwände" },
  { fassung: "2018", code: "344", name: "Innenwandöffnungen" },
  { fassung: "2018", code: "391", name: "Baustelleneinrichtung" },
];

const zuordnungen = [
  { gewerk_nr: "004", oz: "1", kurztext: "Baustelleneinrichtung Rohbau", kg2018: "391", kg2008: "391" },
  { gewerk_nr: "004", oz: "2", kurztext: "Baustelleneinrichtung Winter", kg2018: "391", kg2008: "391" },
  { gewerk_nr: "004", oz: "3", kurztext: "Baustelleneinrichtung Kran", kg2018: "391", kg2008: "391" },
  { gewerk_nr: "004", oz: "4", kurztext: "Wanddurchbruch Stahlbeton", kg2018: "344", kg2008: "344" },
  { gewerk_nr: "004", oz: "5", kurztext: "Wanddurchbruch Mauerwerk", kg2018: "344", kg2008: "344" },
  { gewerk_nr: "007", oz: "1", kurztext: "Trennwand Gipskarton 150mm", kg2018: "342", kg2008: "342" },
  { gewerk_nr: "007", oz: "2", kurztext: "Trennwand Gipskarton 125mm", kg2018: "342", kg2008: "342" },
  { gewerk_nr: "007", oz: "3", kurztext: "Tragende Innenwand Stahlbeton", kg2018: "341", kg2008: "341" },
];

test("verdichte: ein Regelfall je Gewerk plus Leitwortregeln für die Abweichler", () => {
  const { regeln, kennzahlen } = verdichte(zuordnungen);
  assert.equal(kennzahlen.gewerke, 2);
  assert.equal(kennzahlen.fallbackregeln, 2, "ein Regelfall je Gewerk");
  assert.ok(kennzahlen.leitwortregeln >= 2);
  assert.equal(kennzahlen.regeln, regeln.length);
  assert.equal(kennzahlen.zuordnungen, 8);
  assert.equal(kennzahlen.max_leitworte, MAX_LEITWORTE);

  // Die Mehrheits-KG je Gewerk wird zum Regelfall.
  const fb004 = regeln.find((r) => r.gewerk_nr === "004" && r.fallback);
  assert.equal(fb004.kg2018, "391", "3 × 391 gegen 2 × 344");
  assert.equal(fb004.prio, 900, "der Regelfall greift zuletzt");
  assert.equal(fb004.muster, null);
  const fb007 = regeln.find((r) => r.gewerk_nr === "007" && r.fallback);
  assert.equal(fb007.kg2018, "342");
});

test("verdichte: jede Regel ist büroweit, hat Konfidenz, Muster und Herkunft", () => {
  const { regeln } = verdichte(zuordnungen);
  for (const r of regeln) {
    assert.equal(r.scope, "buero");
    assert.equal(r.projekt_override_id, null);
    assert.ok(["hoch", "mittel", "niedrig"].includes(r.confidence));
    assert.ok(r.herkunft);
    assert.ok(r.name);
    assert.ok(r.kg2018);
    if (r.leitwort) {
      assert.equal(r.feld, "kurztext");
      assert.equal(r.muster.op, "glob");
      assert.match(r.muster.value, /^\*.*\*$/);
      assert.ok(r.treffer_zaehler > 0);
    }
  }
  // Ein Leitwort ohne Fehltreffer ist „hoch".
  const sauber = regeln.filter((r) => r.leitwort && r.fehltreffer === 0);
  assert.ok(sauber.length > 0);
  for (const r of sauber) assert.equal(r.confidence, "hoch");
});

test("verdichte ist DETERMINISTISCH — dieselben Daten, dieselben Regeln", () => {
  const a = verdichte(zuordnungen);
  const b = verdichte([...zuordnungen].reverse());
  assert.equal(a.kennzahlen.regeln, b.kennzahlen.regeln);
  assert.deepEqual(
    a.regeln.map((r) => `${r.gewerk_nr}|${r.leitwort}|${r.kg2018}`).sort(),
    b.regeln.map((r) => `${r.gewerk_nr}|${r.leitwort}|${r.kg2018}`).sort(),
  );
});

test("`max_leitworte` ist ein PARAMETER: weniger Regeln kosten Reproduktionsgrad", () => {
  const wenig = verdichte(zuordnungen, { max_leitworte: 1 });
  const viel = verdichte(zuordnungen, { max_leitworte: 6 });
  assert.ok(viel.kennzahlen.regeln >= wenig.kennzahlen.regeln);
  const rWenig = pruefeReproduktion(zuordnungen, wenig.regeln);
  const rViel = pruefeReproduktion(zuordnungen, viel.regeln);
  assert.ok(rViel.quote >= rWenig.quote);
});

test("ordneZu: Leitwort schlägt Regelfall, und der Regelfall ist „niedrig“", () => {
  const { regeln } = verdichte(zuordnungen);
  const treffer = ordneZu({ gewerk_nr: "004", kurztext: "Wanddurchbruch Stahlbeton" }, regeln);
  assert.equal(treffer.kg2018, "344");
  assert.ok(treffer.regel.leitwort);

  // Etwas, das kein Leitwort trifft ⇒ Regelfall, mit ausdrücklich niedriger Konfidenz.
  const fallback = ordneZu({ gewerk_nr: "004", kurztext: "Etwas völlig anderes hier" }, regeln);
  assert.equal(fallback.kg2018, "391");
  assert.equal(fallback.regel.fallback, true);
  assert.equal(fallback.confidence, "niedrig", "die Mehrheit des Gewerks ist keine Aussage über DIESE Position");

  // Unbekanntes Gewerk ⇒ KEIN Vorschlag statt eines geratenen.
  const fremd = ordneZu({ gewerk_nr: "999", kurztext: "Wanddurchbruch" }, regeln);
  assert.equal(fremd.kg2018, null);
  assert.equal(fremd.confidence, "kein Vorschlag");
  assert.equal(fremd.regel, null);
});

test("pruefeReproduktion: die offene Liste ist Teil des Ergebnisses", () => {
  const { regeln } = verdichte(zuordnungen);
  const r = pruefeReproduktion(zuordnungen, regeln);
  assert.equal(r.gesamt, 8);
  assert.equal(r.getroffen + r.offen.length, 8);
  assert.ok(r.quote > 0 && r.quote <= 100);
  assert.match(r.hinweis, /offene Liste ist Teil des Ergebnisses/);
  for (const o of r.offen) {
    assert.ok(o.kurztext);
    assert.ok(o.grund);
    assert.notEqual(o.kg_soll, o.kg_regel);
  }
  // Ohne Regeln ist NICHTS reproduziert — und die Liste ist vollständig.
  const ohne = pruefeReproduktion(zuordnungen, []);
  assert.equal(ohne.getroffen, 0);
  assert.equal(ohne.offen.length, 8);
  assert.equal(ohne.quote, 0);
  // Leere Eingabe: keine erfundene Quote.
  const leer = pruefeReproduktion([], regeln);
  assert.equal(leer.gesamt, 0);
  assert.equal(leer.quote, null);
});

test("Zuordnungen ohne Kostengruppe werden übersprungen, nicht geraten", () => {
  const mitLuecke = [...zuordnungen, { gewerk_nr: "004", oz: "9", kurztext: "ohne KG", kg2018: null }];
  const { kennzahlen } = verdichte(mitLuecke);
  assert.equal(kennzahlen.zuordnungen, 8, "die Zeile ohne KG fließt nicht in die Verdichtung ein");
  const r = pruefeReproduktion(mitLuecke, verdichte(mitLuecke).regeln);
  assert.equal(r.gesamt, 8);
});

test("llmAuftrag: der Prompt ERLAUBT „unbekannt“ ausdrücklich", () => {
  const a = llmAuftrag(["Wandfliesen 20x20", "Estrich schleifen"], DIN, "Trockenbau");
  // Ohne diesen Satz erfindet ein Sprachmodell immer eine Kostengruppe.
  assert.match(a.prompt, /"kg2018": null/);
  assert.match(a.prompt, /geratene Kostengruppe ist schädlicher/);
  assert.match(a.prompt, /DREISTELLIG/);
  assert.match(a.prompt, /Trockenbau/);
  assert.match(a.prompt, /341 Tragende Innenwände/);
  assert.match(a.prompt, /1\. Wandfliesen 20x20/);
  // Das Schema erlaubt null und verlangt eine Konfidenz.
  const item = a.response_json_schema.properties.vorschlaege.items;
  assert.deepEqual(item.properties.kg2018.type, ["string", "null"]);
  assert.deepEqual(item.properties.confidence.enum, ["hoch", "mittel", "niedrig"]);
  assert.ok(item.required.includes("confidence"));
});

test("vorschlaegeAus: jeder Vorschlag ist `angenommen: false` — nie eine Zuordnung", () => {
  const antwort = {
    vorschlaege: [
      { nr: 1, kurztext: "Wandfliesen", kg2018: "345", begruendung: "x", confidence: "hoch" },
      { nr: 2, kurztext: "Estrich", kg2018: null, begruendung: "unklar", confidence: "niedrig" },
      { nr: 3, kurztext: "Fantasie", kg2018: "999", begruendung: "erfunden", confidence: "hoch" },
    ],
  };
  const r = vorschlaegeAus(antwort, DIN, { modell: "testmodell" });
  // BEIDE nicht im Katalog stehenden Codes werden VERWORFEN — der erfundene 999
  // ebenso wie die 345, die es in DIN 276 gibt, in DIESEM Katalog aber nicht.
  // Maßstab ist der gepflegte Katalog, nicht das Allgemeinwissen des Modells.
  assert.equal(r.verworfen.length, 2);
  assert.deepEqual(r.verworfen.map((v) => v.kg2018).sort(), ["345", "999"]);
  for (const v of r.verworfen) assert.match(v.grund, /Din276Katalog/);
  assert.equal(r.vorschlaege.length, 1);
  assert.equal(r.vorschlaege[0].kg2018, null, "die einzige gültige Antwort ist das ehrliche null");

  for (const v of r.vorschlaege) {
    assert.equal(v.angenommen, false, "ein Vorschlag wirkt erst durch die Annahme");
    assert.equal(v.herkunft, "LLM-Vorschlag");
    assert.equal(v.modell, "testmodell");
    assert.ok(["hoch", "mittel", "niedrig"].includes(v.confidence));
  }
  assert.match(r.hinweis, /erst durch die Annahme/);
});

test("vorschlaegeAus: unbrauchbare Antworten kippen nicht um", () => {
  for (const antwort of [null, {}, { vorschlaege: null }, { vorschlaege: "text" }]) {
    const r = vorschlaegeAus(antwort, DIN);
    assert.deepEqual(r.vorschlaege, []);
    assert.deepEqual(r.verworfen, []);
  }
  // Eine unbekannte Konfidenz wird auf „niedrig" gesetzt, nicht übernommen.
  const r = vorschlaegeAus({ vorschlaege: [{ nr: 1, kg2018: "341", confidence: "sicher" }] }, DIN);
  assert.equal(r.vorschlaege[0].confidence, "niedrig");
});

// --- TypeSafe-Vorschlag (Phase 76-02) -----------------------------------------

// Eigene Fixture mit einer 2008-Zeile: dieselbe Nummer 591 hieß 2008 „Baustelleneinrichtung"
// und darf NICHT in die Optionen — sonst konkurrieren zwei Fassungen.
const DIN_TS = [...DIN, { fassung: "2008", code: "591", name: "Baustelleneinrichtung" }];

const antwort = (choice, probabilities) => ({ type: "choice", choice, probabilities, confidence: 0.5 });
// Verhaltenstests der Stufenlogik mit expliziten Schwellen — die ausgelieferte
// Konstante ist nach der Messung 76-04 bewusst „alles niedrig" (eigener Test unten).
const SCHWELLEN_TEST = { hoch: 0.85, mittel: 0.6, mindest: 0.5 };

test("kgOptionen: nur Fassung 2018, Namen als Beschreibung, unbekannt am Ende", () => {
  const o = kgOptionen(DIN_TS);
  assert.deepEqual(Object.keys(o).sort(), ["341", "342", "344", "391", TYPESAFE_UNBEKANNT].sort());
  assert.equal(o["341"], "Tragende Innenwände");
  assert.equal("591" in o, false, "2008-Code darf nicht in die Optionen");
  assert.match(o[TYPESAFE_UNBEKANNT], /eindeutig/);
  assert.deepEqual(Object.keys(kgOptionen([])), [TYPESAFE_UNBEKANNT], "ohne Katalog nur unbekannt");
});

test("typesafeAuftrag: eine Choice-Frage je Kurztext, Pfad und Gewerk in den Instructions", () => {
  const b = typesafeAuftrag(["Bauzaun", "Wanddurchbruch", "Trennwand GK"], DIN_TS, "004 Rohbau");
  assert.equal(b.length, 1);
  assert.deepEqual(Object.keys(b[0].questions), ["kg_1", "kg_2", "kg_3"]);
  assert.equal(b[0].state.gewerk, "004 Rohbau");
  assert.equal(b[0].state.positionen[2].kurztext, "Trennwand GK");
  const q = b[0].questions.kg_3;
  assert.equal(q.type, "choice");
  assert.match(q.instructions, /`positionen\[2\]\.kurztext`/);
  assert.match(q.instructions, /`gewerk`/);
  assert.match(q.instructions, /unbekannt/);
  assert.equal("591" in q.criteria, false, "API-Feld heißt criteria");
  assert.equal("options" in q, false);
});

test("typesafeAuftrag: 41 Kurztexte → 2 Blöcke, nr läuft durch, Leertexte lassen eine Lücke", () => {
  const texte = Array.from({ length: 41 }, (_, i) => `Position ${i + 1}`);
  const b = typesafeAuftrag(texte, DIN_TS, null);
  assert.equal(b.length, 2);
  assert.equal(Object.keys(b[0].questions).length, TYPESAFE_BLOCK);
  assert.deepEqual(Object.keys(b[1].questions), ["kg_41"]);
  assert.equal(b[1].state.positionen[0].nr, 41);
  assert.equal(b[1].state.gewerk, null);
  const mitLuecke = typesafeAuftrag(["a", "", null, "d"], DIN_TS);
  assert.deepEqual(Object.keys(mitLuecke[0].questions), ["kg_1", "kg_4"]);
  assert.deepEqual(typesafeAuftrag([], DIN_TS), []);
});

test("typesafeAuftrag: sprache en übersetzt die Frage, Optionsnamen bleiben deutsch", () => {
  const [b] = typesafeAuftrag(["Bauzaun"], DIN_TS, "004", { sprache: "en" });
  const q = b.questions.kg_1;
  assert.match(q.instructions, /DIN 276/);
  assert.doesNotMatch(q.instructions, /Welche/);
  assert.match(q.instructions, /`positionen\[0\]\.kurztext`/);
  assert.equal(q.criteria["341"], "Tragende Innenwände");
});

test("vorschlaegeAusTypesafe: hoch — Code, Stufe, Begründung mit Alternative", () => {
  const r = vorschlaegeAusTypesafe(
    { kg_1: antwort("391", { 391: 0.93, 344: 0.04, 341: 0.02, 342: 0.01, [TYPESAFE_UNBEKANNT]: 0 }) },
    ["Bauzaun"], DIN_TS, { modell: "jev-1.13.0", schwellen: SCHWELLEN_TEST }
  );
  assert.equal(r.vorschlaege.length, 1);
  const v = r.vorschlaege[0];
  assert.equal(v.nr, 1);
  assert.equal(v.kurztext, "Bauzaun");
  assert.equal(v.kg2018, "391");
  assert.equal(v.confidence, "hoch");
  assert.equal(v.wahrscheinlichkeit, 0.93);
  assert.equal(v.begruendung, "p = 0,93 · Alternative 344 (0,04)");
  assert.deepEqual(v.alternativen.map((a) => a.kg2018), ["344", "341"]);
  assert.equal(v.herkunft, "TypeSafe-Vorschlag");
  assert.equal(v.modell, "jev-1.13.0");
  assert.equal(v.angenommen, false);
  assert.match(r.hinweis, /erst durch die Annahme/);
  assert.match(r.hinweis, /keine Prüfung/);
});

test("vorschlaegeAusTypesafe: mittel und niedrig behalten den Code, unter mindest wird er null", () => {
  const r = vorschlaegeAusTypesafe({
    kg_1: antwort("341", { 341: 0.7, 342: 0.3 }),
    kg_2: antwort("341", { 341: 0.55, 342: 0.45 }),
    kg_3: antwort("341", { 341: 0.45, 342: 0.4, 344: 0.15 }),
  }, ["a", "b", "c"], DIN_TS, { schwellen: SCHWELLEN_TEST });
  const [mittel, niedrig, unter] = r.vorschlaege;
  assert.equal(mittel.kg2018, "341");
  assert.equal(mittel.confidence, "mittel");
  assert.equal(niedrig.kg2018, "341");
  assert.equal(niedrig.confidence, "niedrig");
  assert.equal(unter.kg2018, null, "unter der Mindestschwelle: ehrliches null");
  assert.equal(unter.confidence, "niedrig");
  assert.match(unter.begruendung, /^p = 0,45/);
});

test("vorschlaegeAusTypesafe: unbekannt gewählt → null mit eigener Begründung", () => {
  const r = vorschlaegeAusTypesafe(
    { kg_1: antwort(TYPESAFE_UNBEKANNT, { [TYPESAFE_UNBEKANNT]: 0.64, 341: 0.2, 342: 0.16 }) },
    ["x"], DIN_TS
  );
  const v = r.vorschlaege[0];
  assert.equal(v.kg2018, null);
  assert.equal(v.confidence, "niedrig");
  assert.equal(v.begruendung, "unbekannt (p = 0,64)");
  assert.deepEqual(v.alternativen.map((a) => a.kg2018), ["341", "342"], "Alternativen ohne unbekannt");
});

test("vorschlaegeAusTypesafe: unbekannter Code wird verworfen, Reihenfolge nach nr, Unbrauchbares kippt nicht um", () => {
  const r = vorschlaegeAusTypesafe({
    kg_2: antwort("341", { 341: 0.9 }),
    kg_1: antwort("999", { 999: 0.9 }),
    foo: antwort("341", { 341: 0.9 }),
  }, ["a", "b"], DIN_TS);
  assert.deepEqual(r.vorschlaege.map((v) => v.nr), [2]);
  assert.equal(r.verworfen.length, 1);
  assert.equal(r.verworfen[0].kg2018, "999");
  assert.match(r.verworfen[0].grund, /Din276Katalog/);
  for (const a of [null, undefined, {}, { kg_1: null }, { kg_1: {} }]) {
    const leer = vorschlaegeAusTypesafe(a, [], DIN_TS);
    assert.ok(Array.isArray(leer.vorschlaege));
    for (const v of leer.vorschlaege) assert.equal(v.kg2018, null);
  }
});

test("vorschlaegeAusTypesafe: eigene Schwellen verschieben die Stufe", () => {
  const antworten = { kg_1: antwort("341", { 341: 0.9, 342: 0.1 }) };
  assert.equal(vorschlaegeAusTypesafe(antworten, ["a"], DIN_TS, { schwellen: SCHWELLEN_TEST }).vorschlaege[0].confidence, "hoch");
  const streng = { ...SCHWELLEN_TEST, hoch: 0.95 };
  assert.equal(vorschlaegeAusTypesafe(antworten, ["a"], DIN_TS, { schwellen: streng }).vorschlaege[0].confidence, "mittel");
});

test("TYPESAFE_SCHWELLEN (gemessen 21.09.2026): keine Stufe hoch/mittel, mindest 0,70", () => {
  assert.ok(TYPESAFE_SCHWELLEN.hoch > 1 && TYPESAFE_SCHWELLEN.mittel > 1, "hoch/mittel sind abgeschaltet — die Messung belegt sie nicht");
  assert.equal(TYPESAFE_SCHWELLEN.mindest, 0.7);
  const sicher = vorschlaegeAusTypesafe({ kg_1: antwort("341", { 341: 0.99, 342: 0.01 }) }, ["a"], DIN_TS).vorschlaege[0];
  assert.equal(sicher.kg2018, "341", "Vorschlag bleibt sichtbar …");
  assert.equal(sicher.confidence, "niedrig", "… aber nie als hoch/mittel verkauft");
  const knapp = vorschlaegeAusTypesafe({ kg_1: antwort("341", { 341: 0.65, 342: 0.35 }) }, ["a"], DIN_TS).vorschlaege[0];
  assert.equal(knapp.kg2018, null, "unter 0,70 lag die Trefferquote bei ≤ 59 % — kein Vorschlag");
});
