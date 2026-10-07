// Textähnlichkeit — Modulverhalten (Phase 33 / W7, Plan 33-04).
//
// Die difflib-Parität auf 3.000 echten Paaren prüft Gate G17. Hier geht es um die
// Ränder: leere Eingaben, Umlaute und das scharfe s, HTML-Entities, die
// Rundungsregel und die Grenze, an der die Parität bricht.

import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOJUNK_GRENZE, NORMALISIERUNG, autojunkWarnung, bestesMatch, jaccard,
  matchingBlocks, normalisiere, ratio, ratioRoh, runde, zeichenverluste,
} from "@core/lib/textMatch.js";

test("Normalisierung: Umlaute werden korrekt zu a/o/u", () => {
  assert.equal(normalisiere("Wände"), "wande");
  assert.equal(normalisiere("Öl"), "ol");
  assert.equal(normalisiere("Übergang"), "ubergang");
  assert.equal(normalisiere("ÄÖÜ äöü"), "aou aou");
});

test("Normalisierung: „ß“ verschwindet ERSATZLOS — der reproduzierte Pipeline-Mangel", () => {
  // Fachlich richtig wäre „ss". Reproduziert wird der Mangel, weil sonst alle
  // eingefrorenen sim-Werte abweichen und die Parität unprüfbar wird.
  assert.equal(normalisiere("Straße"), "strae");
  assert.equal(normalisiere("Fußboden"), "fuboden");
  assert.equal(normalisiere("Größe"), "groe");
  // Und er ist MESSBAR, nicht nur behauptet.
  assert.deepEqual(zeichenverluste("Straße"), ["ß"]);
  assert.deepEqual(zeichenverluste("Fußboden Größe"), ["ß", "ß"]);
  assert.deepEqual(zeichenverluste("Wände Öl Übergang"), []);
  assert.deepEqual(zeichenverluste(""), []);
  assert.deepEqual(zeichenverluste(null), []);
  // Der Mangel steht in der mitgelieferten Beschreibung.
  assert.match(NORMALISIERUNG, /ß/);
  assert.match(NORMALISIERUNG, /ss/);
});

test("Normalisierung: Tags, Entities, Interpunktion, Mehrfach-Leerzeichen", () => {
  assert.equal(normalisiere("<b>Tür</b>"), "tur");
  assert.equal(normalisiere("Tür &amp; Fenster"), "tur fenster");
  assert.equal(normalisiere("&lt;nicht&gt;"), "nicht");
  // Ein Nicht-ASCII-Zeichen wird ERSATZLOS gelöscht, nicht durch ein Leerzeichen
  // ersetzt — „A–B" wird zu „ab". In Python nachgemessen; dieselbe Klasse von
  // Verlust wie beim ß.
  assert.equal(normalisiere("A&#8211;B"), "ab");
  assert.equal(normalisiere("1,5m   ×   2"), "1 5m 2");
  assert.equal(normalisiere("   trimmen   "), "trimmen");
  assert.equal(normalisiere("m²"), "m2", "NFKD zerlegt die Hochzahl");
});

test("Normalisierung: leere und fehlende Eingaben ergeben den Leerstring", () => {
  assert.equal(normalisiere(""), "");
  assert.equal(normalisiere(null), "");
  assert.equal(normalisiere(undefined), "");
  assert.equal(normalisiere("!!!"), "");
  assert.equal(normalisiere(42), "42");
});

test("ratio: bekannte Paare, exakt wie difflib", () => {
  assert.equal(ratio("gleich", "gleich"), 1);
  assert.equal(ratioRoh("abcd", "abcd"), 1);
  // 2·M/T mit M=3 (abc), T=4+3 ⇒ 6/7
  assert.equal(ratioRoh("abcd", "abc"), 6 / 7);
  // Vollständig verschieden.
  assert.equal(ratioRoh("abc", "xyz"), 0);
  // Klassisches difflib-Beispiel.
  assert.equal(ratioRoh("abcde", "fabcdf"), (2 * 4) / 11);
});

test("ratio: leere Folgen verhalten sich wie in Python", () => {
  assert.equal(ratioRoh("", ""), 1, "zwei leere Folgen sind gleich");
  assert.equal(ratioRoh("a", ""), 0);
  assert.equal(ratioRoh("", "a"), 0);
  // Über `ratio` (mit Normalisierung) ebenfalls: „!!!" normalisiert zu "".
  assert.equal(ratio("!!!", "???"), 1);
  assert.equal(ratio(null, null), 1);
});

test("ratio: die Normalisierung wirkt VOR dem Vergleich", () => {
  assert.equal(ratio("Wände", "wande"), 1);
  assert.equal(ratio("<b>Tür</b>", "Tür"), 1);
  assert.equal(ratio("Tür,  1.5m", "tur 1 5m"), 1);
});

test("ratio ist NICHT symmetrisch — das ist difflib, nicht ein Fehler", () => {
  const a = "abcdefghijk";
  const b = "kjihgfedcba";
  // Ein Paar zu finden, das abweicht, genügt für die Aussage.
  const paare = [
    ["Erstellen Ausschnitt Dachgully in Trapezblech", "Voranstrich auftragen Kunstharz-Dispersion"],
    [a, b],
    ["Bauzaun H 2m aufstellen räumen", "Baustelle einrichten räumen"],
  ];
  const abweichend = paare.filter(([x, y]) => ratio(x, y) !== ratio(y, x));
  assert.ok(abweichend.length > 0, "mindestens ein Paar muss asymmetrisch sein");
});

test("matchingBlocks: Sentinel, Verschmelzung, leere Eingabe", () => {
  const b1 = matchingBlocks("abcd", "abcd");
  assert.deepEqual(b1, [[0, 0, 4], [4, 4, 0]], "aneinandergrenzende Blöcke sind verschmolzen");
  const b2 = matchingBlocks("", "");
  assert.deepEqual(b2, [[0, 0, 0]], "nur der Sentinel");
  const b3 = matchingBlocks("abc", "xyz");
  assert.deepEqual(b3, [[3, 3, 0]]);
  // Die Summe der Blöcke ist konsistent mit ratio.
  const b4 = matchingBlocks("abxcd", "abcd");
  const m = b4.reduce((s, [, , k]) => s + k, 0);
  assert.equal((2 * m) / 9, ratioRoh("abxcd", "abcd"));
});

test("Autojunk-Grenze: Warnung erst ab 200 Zeichen", () => {
  assert.equal(AUTOJUNK_GRENZE, 200);
  assert.equal(autojunkWarnung("kurz"), null);
  assert.equal(autojunkWarnung("a".repeat(199)), null);
  const w = autojunkWarnung("a".repeat(200));
  assert.ok(w);
  assert.match(w, /Autojunk/);
  assert.equal(autojunkWarnung(null), null);
});

test("runde: halb zur GERADEN Zahl (Pythons round), nicht kaufmännisch", () => {
  assert.equal(runde(1.125, 2), 1.12);
  assert.equal(runde(1.135, 2), 1.14);
  assert.equal(runde(0.125, 2), 0.12);
  assert.equal(runde(0.375, 2), 0.38);
  assert.equal(runde(0.7775, 3), 0.777);
  assert.equal(runde(2.675, 2), 2.67);
  assert.equal(runde(0.5, 0), 0);
  assert.equal(runde(1.5, 0), 2);
  assert.equal(runde(2.5, 0), 2);
  assert.equal(runde(-1.125, 2), -1.12, "Vorzeichen wird getrennt behandelt");
  assert.equal(runde(1 / 3, 3), 0.333);
  assert.equal(runde(123.456789, 4), 123.4568);
  assert.equal(runde(0, 2), 0);
  assert.equal(runde(null), null);
  assert.equal(runde(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
});

test("jaccard: Tokenmenge, reihenfolgeunabhängig, Ränder", () => {
  assert.equal(jaccard("a b c", "c b a"), 1);
  assert.equal(jaccard("a b", "b c"), 1 / 3);
  assert.equal(jaccard("a a b", "a b"), 1, "Mengen, keine Multimengen");
  assert.equal(jaccard("", ""), 0, "leer gegen leer ist KEINE Ähnlichkeit von 1");
  assert.equal(jaccard("a", ""), 0);
  assert.equal(jaccard(null, null), 0);
});

test("bestesMatch: bester Kandidat, Gleichstand geht an den ERSTEN", () => {
  const kandidaten = [
    { kurztext: "Bauzaun H 2m aufstellen räumen" },
    { kurztext: "Estrich schleifen" },
    { kurztext: "Bauzaun H 2m aufstellen räumen" }, // identischer Zweiter
  ];
  const r = bestesMatch("Bauzaun H 2m aufstellen räumen", kandidaten);
  assert.equal(r.kandidat, kandidaten[0], "bei Gleichstand gewinnt der erste");
  assert.equal(r.score, 1);
  assert.equal(r.ratio, 1);

  // Leere Kandidatenliste: kein Treffer, keine Ausnahme.
  const leer = bestesMatch("x", []);
  assert.equal(leer.kandidat, null);
  assert.equal(leer.score, 0);

  // Kandidaten ohne Text werden übersprungen.
  const luecke = bestesMatch("Bauzaun", [{ kurztext: null }, { kurztext: "Bauzaun" }]);
  assert.equal(luecke.kandidat.kurztext, "Bauzaun");

  // Eigene Score-Funktion (wie im STLB-Match).
  const eigen = bestesMatch(
    "Bauzaun H 2m",
    [{ kurztext: "H 2m Bauzaun" }, { kurztext: "Bauzaun H 2m" }],
    (k) => k.kurztext,
    (seq, jac) => 0.6 * seq + 0.4 * jac,
  );
  assert.equal(eigen.kandidat.kurztext, "Bauzaun H 2m");
});
