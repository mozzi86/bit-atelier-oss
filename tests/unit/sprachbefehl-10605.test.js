// 106-05: the command grammar for spoken and typed German sentences (packages/nova-core/src/lib/zeigen/sprachbefehl.js).
// Proof: 30+ example sentences -> the expected command and parameters, number words and units, directions relative to the view, the words
// "dieses/diese/dort" = the selection, refusals instead of guesses (no selection, wrong kind of element, missing unit / direction / factor),
// and every sentence of the help table is understood by the grammar and names the command it claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sprachbefehl, SATZ_HILFE, normalisieren, wortZahl, zahlLesen, laengeLesen, zerlege } from "@core/lib/zeigen/sprachbefehl.js";
import { eigenschaftFeld } from "@core/lib/zeigen/aenderungen.js";
import { KEINE_AUSWAHL_TEXT } from "@core/lib/zeigen/auswahlKontext.js";

const wandAuswahl = { anzahl: 1, bauteile: [{ guid: "WAND0000000000000000AA", klasse: "IfcWall", name: "Wand 1" }] };
/** View: screen right = +x, into the screen = -z (like a camera looking north in the plan). */
const ansicht = { rechts: { x: 1, z: 0 }, vorn: { x: 0, z: -1 } };
const K = { auswahl: wandAuswahl, ansicht, zeigepunkt: { x: 3.25, z: -4 } };
const OHNE = { auswahl: { anzahl: 0, bauteile: [] }, ansicht, zeigepunkt: null };

/** [sentence, command, params] */
const FAELLE = [
  // --- move: units, number words, directions
  ["Verschiebe dieses 50 Zentimeter nach links", "transformieren", { verschiebung_m: [-0.5, 0, 0] }],
  ["verschiebe diese Wand um fünfzig Zentimeter nach rechts", "transformieren", { verschiebung_m: [0.5, 0, 0] }],
  ["verschiebe dieses 0,5 m nach links", "transformieren", { verschiebung_m: [-0.5, 0, 0] }],
  ["schieb das um einen halben Meter nach hinten", "transformieren", { verschiebung_m: [0, 0, -0.5] }],
  ["verschiebe dort 2 Meter nach vorne", "transformieren", { verschiebung_m: [0, 0, 2] }],
  ["verschiebe um zwei Meter fünfzig nach oben", "transformieren", { verschiebung_m: [0, 2.5, 0] }],
  ["verschiebe dieses 30 mm nach unten", "transformieren", { verschiebung_m: [0, -0.03, 0] }],
  ["verschiebe dieses um zwei Komma fünf Meter nach rechts", "transformieren", { verschiebung_m: [2.5, 0, 0] }],
  ["verschiebe dieses um einundzwanzig Zentimeter nach links", "transformieren", { verschiebung_m: [-0.21, 0, 0] }],
  ["bitte verschiebe dieses mal 10 cm nach rechts", "transformieren", { verschiebung_m: [0.1, 0, 0] }],
  ["verschiebe dieses 50 Zentimeter nach links und 20 Zentimeter nach oben", "transformieren", { verschiebung_m: [-0.5, 0.2, 0] }],
  ["kannst du dieses bitte 20 cm nach unten verschieben", "transformieren", { verschiebung_m: [0, -0.2, 0] }],
  ["verschiebe dieses nach links um 1 m", "transformieren", { verschiebung_m: [-1, 0, 0] }],
  // --- rotate, scale
  ["drehe dieses um 90 Grad nach links", "transformieren", { drehung_grad: 90 }],
  ["drehe diese Wand um neunzig Grad nach rechts", "transformieren", { drehung_grad: -90 }],
  ["drehe dieses um 45° im Uhrzeigersinn", "transformieren", { drehung_grad: -45 }],
  ["drehe dieses um 30 Grad gegen den Uhrzeigersinn", "transformieren", { drehung_grad: 30 }],
  ["skaliere dieses um Faktor 2", "transformieren", { faktor: 2 }],
  ["skaliere dieses auf 120 Prozent", "transformieren", { faktor: 1.2 }],
  ["verdopple dieses", "transformieren", { faktor: 2 }],
  ["mach dieses doppelt so groß", "transformieren", { faktor: 2 }],
  ["verkleinere dieses um 10 Prozent", "transformieren", { faktor: 0.9 }],
  // --- properties
  ["setze Brandschutz auf F90", "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" }],
  ["setze den Brandschutz dieser Wand auf F neunzig", "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" }],
  ["setze den Feuerwiderstand auf F 30", "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F30" }],
  ["Brandschutz auf F90 setzen", "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" }],
  ["setze die Kostengruppe auf 341", "eigenschaft-setzen", { name: "kg", wert: "341" }],
  ["setze die Kostengruppe auf dreihundert einundvierzig", "eigenschaft-setzen", { name: "kg", wert: "341" }],
  ["setze den Status auf Abbruch", "eigenschaft-setzen", { name: "status", wert: "Abbruch" }],
  ["markiere dieses als Neubau", "eigenschaft-setzen", { name: "status", wert: "Neubau" }],
  ["setze das Material auf Beton", "eigenschaft-setzen", { name: "material", wert: "Beton" }],
  ["mach dieses tragend", "eigenschaft-setzen", { name: "tragend", wert: "ja" }],
  ["mach dieses nicht tragend", "eigenschaft-setzen", { name: "tragend", wert: "nein" }],
  // --- split
  ["teile hier", "teilen", { punkt: { x: 3.25, z: -4 } }],
  ["teile die Wand in der Mitte", "teilen", { anteil: 0.5 }],
  ["halbiere diese Wand", "teilen", { anteil: 0.5 }],
  ["teile bei 30 Prozent", "teilen", { anteil: 0.3 }],
  // --- answers and reading
  ["ja", "bestaetigen", {}],
  ["Ja, bitte.", "bestaetigen", {}],
  ["übernehmen", "bestaetigen", {}],
  ["nein", "verwerfen", {}],
  ["Abbrechen", "verwerfen", {}],
  ["was ist das", "auswahl-lesen", {}],
  ["lies die Auswahl", "auswahl-lesen", {}],
  ["zeige die Auswahl", "ansicht-auf-auswahl", {}],
  ["hebe die Auswahl auf", "auswahl-aufheben", {}],
  ["Auswahl aufheben", "auswahl-aufheben", {}],
  ["prüfe den Vorschlag", "pruefen", {}],
  ["zeige die Vorschläge", "vorschlaege", {}],
];

test("30+ Beispielsätze werden in den erwarteten Befehl mit Parametern übersetzt", () => {
  assert.ok(FAELLE.length >= 30);
  for (const [satz, befehl, params] of FAELLE) {
    const r = sprachbefehl(satz, K);
    assert.ok(r && r.art === "befehl", `${satz} -> ${JSON.stringify(r)}`);
    assert.equal(r.befehl, befehl, satz);
    assert.deepEqual(r.params, params, satz);
    assert.ok(r.verstanden && r.verstanden.length > 2, `${satz}: Satz in Worten`);
  }
});

test("rückgängig ist keine direkte Ausführung: die Grammatik meldet nur \"zurueck\" (die Rückfrage macht der Ablauf)", () => {
  for (const s of ["mach das rückgängig", "rückgängig", "nimm das zurück", "letzten Schritt zurücknehmen"]) assert.deepEqual(sprachbefehl(s, K), { art: "zurueck" }, s);
});

test("ein \"ja\" innerhalb eines längeren Satzes bestätigt nie; Rauschen und Fremdes sind unbekannt (null)", () => {
  for (const s of ["ja das passt aber nicht", "ja ich glaube schon", "nein danke ich schaue noch mal", "wie wird das Wetter morgen", "Untertitel der Amara.org-Community", "", "   ", "hmm", "okay dann verschieben wir das später"]) {
    assert.equal(sprachbefehl(s, K), null, s);
  }
});

test("\"dieses\" ohne Auswahl: abgelehnt mit dem Text des Kerns, nie geraten", () => {
  for (const s of ["verschiebe dieses 50 cm nach links", "drehe diese Wand um 90 Grad", "skaliere dieses um Faktor 2", "setze Brandschutz auf F90", "teile in der Mitte", "mach dieses tragend"]) {
    assert.deepEqual(sprachbefehl(s, OHNE), { art: "abgelehnt", grund: KEINE_AUSWAHL_TEXT }, s);
  }
  // reading and selecting words do not need a selection
  assert.equal(sprachbefehl("was ist das", OHNE)?.befehl, "auswahl-lesen");
  assert.equal(sprachbefehl("ja", OHNE)?.befehl, "bestaetigen");
});

test("ein genanntes Bauteil muss zur Auswahl passen (Stütze gewählt, \"die Wand\" gesagt -> abgelehnt)", () => {
  const stuetze = { auswahl: { anzahl: 1, bauteile: [{ guid: "S", klasse: "IfcColumn", name: "S1" }] }, ansicht };
  const r = sprachbefehl("verschiebe die Wand 1 m nach links", stuetze);
  assert.equal(r.art, "abgelehnt");
  assert.match(r.grund, /Ausgewählt ist eine Stütze, nicht eine Wand/);
  assert.equal(sprachbefehl("verschiebe die Stütze 1 m nach links", stuetze).art, "befehl");
  assert.equal(sprachbefehl("verschiebe dieses 1 m nach links", stuetze).art, "befehl", "ohne Nomen gilt \"dieses\" = die Auswahl");
  assert.equal(sprachbefehl("drehe die Wand um 90 Grad", stuetze).art, "abgelehnt");
  const fenster = { auswahl: { anzahl: 1, bauteile: [{ guid: "F", klasse: "IfcWindow" }] }, ansicht };
  assert.equal(sprachbefehl("verschiebe das Fenster 10 cm nach links", fenster).art, "befehl");
});

test("fehlende Angaben werden benannt statt ergänzt: Einheit, Maß, Richtung, Winkel, Faktor, Wert, Ansicht, Zeigepunkt", () => {
  const grund = (s, k = K) => { const r = sprachbefehl(s, k); assert.equal(r?.art, "abgelehnt", s); return r.grund; };
  assert.match(grund("verschiebe dieses 50 nach links"), /Einheit fehlt/);
  assert.match(grund("verschiebe dieses nach links"), /Maß fehlt/);
  assert.match(grund("verschiebe dieses 50 Zentimeter"), /Richtung fehlt/);
  assert.match(grund("drehe dieses"), /Winkel fehlt/);
  assert.match(grund("skaliere dieses"), /Faktor fehlt/);
  assert.match(grund("skaliere dieses auf 0 Prozent"), /größer als 0/);
  assert.match(grund("setze Brandschutz auf"), /Wert fehlt/);
  assert.match(grund("verschiebe dieses 50 Zentimeter nach links", { auswahl: wandAuswahl, ansicht: null }), /Ansicht ist nicht bekannt/);
  assert.match(grund("teile hier", { auswahl: wandAuswahl, ansicht, zeigepunkt: null }), /braucht eine Stelle/);
  assert.match(grund("teile dieses"), /Wohin teilen/);
  assert.match(grund("verschiebe dieses 50 Zentimeter nach links und 20 Zentimeter"), /nicht eindeutig/);
  // up/down needs no view
  assert.deepEqual(sprachbefehl("verschiebe dieses 3 m nach oben", { auswahl: wandAuswahl, ansicht: null }).params, { verschiebung_m: [0, 3, 0] });
});

test("Richtungen sind relativ zur Ansicht: gedrehte Kamera dreht links/rechts/vor/zurück mit", () => {
  // camera looking east: screen right = +z (plan down), into the screen = +x
  const ost = { auswahl: wandAuswahl, ansicht: { rechts: { x: 0, z: 1 }, vorn: { x: 1, z: 0 } } };
  assert.deepEqual(sprachbefehl("verschiebe dieses 1 m nach rechts", ost).params.verschiebung_m, [0, 0, 1]);
  assert.deepEqual(sprachbefehl("verschiebe dieses 1 m nach links", ost).params.verschiebung_m, [0, 0, -1]);
  assert.deepEqual(sprachbefehl("verschiebe dieses 1 m nach hinten", ost).params.verschiebung_m, [1, 0, 0]);
  assert.deepEqual(sprachbefehl("verschiebe dieses 1 m nach vorne", ost).params.verschiebung_m, [-1, 0, 0]);
});

test("Zahlen und Einheiten deutsch: Zahlwörter, Hälften, Komma, Meter + Zentimeter", () => {
  const wz = (w) => wortZahl(normalisieren(w));
  assert.equal(wz("fünfzig"), 50); assert.equal(wz("einundzwanzig"), 21); assert.equal(wz("hundertfünfzig"), 150); assert.equal(wz("zweihundert"), 200);
  assert.equal(wz("dreihundertvierzig"), 340); assert.equal(wz("zwölf"), 12); assert.equal(wz("null"), 0); assert.equal(wz("dreitausend"), 3000);
  assert.equal(wz("hallo"), null); assert.equal(wz("constructor"), null); assert.equal(wz("hundertundhundert"), null);
  const n = (s) => zahlLesen(zerlege(s).norm, 0);
  assert.deepEqual(n("0,5"), { wert: 0.5, laenge: 1 });
  assert.deepEqual(n("einen halben"), { wert: 0.5, laenge: 2 });
  assert.deepEqual(n("zweieinhalb"), { wert: 2.5, laenge: 1 });
  assert.deepEqual(n("anderthalb"), { wert: 1.5, laenge: 1 });
  assert.deepEqual(n("zwei komma fünf"), { wert: 2.5, laenge: 3 });
  assert.deepEqual(n("null komma zwei fünf"), { wert: 0.25, laenge: 4 });
  const l = (s) => laengeLesen(zerlege(s).norm, 0);
  assert.equal(l("fünfzig Zentimeter").meter, 0.5);
  assert.equal(l("50cm").meter, 0.5);
  assert.equal(l("zwei Meter fünfzig").meter, 2.5);
  assert.equal(l("1 Meter 20").meter, 1.2);
  assert.equal(l("3 mm").meter, 0.003);
  assert.equal(l("17").meter, null, "ohne Einheit kein Meterwert");
  assert.equal(l("hallo"), null);
});

test("Normalisieren: Groß/Klein, Umlaute, Satzzeichen, Einheiten ohne Leerraum", () => {
  assert.equal(normalisieren("  Verschiebe DIESES, 50cm — nach links!  "), "verschiebe dieses 50 cm nach links");
  assert.equal(normalisieren("Größer, Fußboden Übernehmen"), "groesser fussboden uebernehmen");
  assert.equal(normalisieren("um 90° drehen, 20% mehr"), "um 90 grad drehen 20 prozent mehr");
  const z = zerlege("Setze F90-AB");
  assert.deepEqual(z.roh, ["Setze", "F90-AB"]);
  assert.equal(z.roh.length, z.norm.length);
});

test("GUID-Befehl: \"wähle <GUID>\" (getippt) wählt per auswahl-guid", () => {
  const r = sprachbefehl("wähle das Bauteil mit der GUID 3cUkl32yn9qRSPvBJVyWYp", K);
  assert.equal(r?.befehl, "auswahl-guid");
  assert.deepEqual(r?.params, { guid: "3cUkl32yn9qRSPvBJVyWYp" });
  // review 106-05: a GUID may end in "$" (no word boundary after it)
  assert.deepEqual(sprachbefehl("wähle 0123456789abcdefghijk$ bitte", K)?.params, { guid: "0123456789abcdefghijk$" });
  assert.deepEqual(sprachbefehl("wähle 0123456789abcdefghij_$", K)?.params, { guid: "0123456789abcdefghij_$" });
  // 23 characters are no GUID
  assert.notEqual(sprachbefehl("wähle 0123456789abcdefghijk$x", K)?.befehl, "auswahl-guid");
});

test("Review 106-05: gesprochen gilt nur ein eindeutiges „ja“, getippt auch „okay“", () => {
  assert.equal(sprachbefehl("okay", K)?.befehl, "bestaetigen");
  assert.equal(sprachbefehl("mach das", K)?.befehl, "bestaetigen");
  for (const s of ["okay", "Ok.", "mach das", "ja passt"]) assert.equal(sprachbefehl(s, { ...K, gesprochen: true })?.art, "abgelehnt", s);
  for (const s of ["Ja.", "übernehmen", "ja bitte", "bestätigen"]) assert.equal(sprachbefehl(s, { ...K, gesprochen: true })?.befehl, "bestaetigen", s);
});

test("jede Eigenschaft des Wörterbuchs löst im Kern auf (eigenschaftFeld kennt den Namen)", () => {
  for (const s of ["Brandschutz auf F30", "Feuerwiderstand auf F90", "Status auf Neubau", "Kostengruppe auf 331", "Leistungsbereich auf 012", "Bauabschnitt auf BA1", "Material auf Stahl", "Tragend auf ja", "Statikvermerk auf geprüft", "Typ auf Wand"]) {
    const r = sprachbefehl(`setze ${s}`, K);
    assert.equal(r?.befehl, "eigenschaft-setzen", s);
    assert.ok(eigenschaftFeld(r.params.name), `${s}: ${r?.params?.name}`);
  }
});

test("Hilfetabelle: jeder Beispielsatz wird verstanden und nennt den Befehl, den die Tabelle behauptet", () => {
  assert.ok(SATZ_HILFE.length >= 14);
  for (const h of SATZ_HILFE) {
    const r = sprachbefehl(h.satz, K);
    assert.ok(r, h.satz);
    if (h.befehl === "zurueck") assert.equal(r.art, "zurueck", h.satz);
    else { assert.equal(r.art, "befehl", `${h.satz}: ${JSON.stringify(r)}`); assert.equal(r.befehl, h.befehl, h.satz); }
    assert.ok(h.wirkung.length > 10);
  }
});

test("Wörter wie \"constructor\" oder \"toString\" laufen nicht in die Tabellen des Objektprototyps", () => {
  for (const s of ["constructor", "setze constructor auf toString", "verschiebe dieses constructor nach hasOwnProperty"]) {
    const r = sprachbefehl(s, K);
    assert.ok(r === null || r.art === "abgelehnt", `${s} -> ${JSON.stringify(r)}`);
  }
});
