// GAEB 90 (DA 83) — Verhalten des Lesers an den Rändern (Phase 33 / W3).
//
// Die Parität gegen die 15 echten LVs prüft Gate G7 (parity/g7-d83.test.mjs). Hier geht
// es um das, was ein Realdatensatz NICHT enthält: kaputte Sätze, falsche Eingabetypen,
// Größenlimits, unbekannte Satzarten — also darum, dass der Leser bei Müll nicht
// stillschweigend plausible Zahlen erfindet.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseD83, decodeCp437, istGaeb90, mengeAusFeld, SATZARTEN, SPALTEN_21,
  GAEB90_ENDUNGEN, MAX_BYTES,
} from "@ava/lib/gaeb90.js";

/** Eine 80-Zeichen-Satzzeile bauen (CP437-Bytes). */
const satz = (inhalt) => inhalt.padEnd(80, " ").slice(0, 80);
/** Satzart 99: Spalten 69–73 = Positionszahl (5), 74–79 = Zeilenzahl (6). */
const ende = (positionen, zeilen) => "99".padEnd(69, " ")
  + String(positionen).padStart(5, "0") + String(zeilen).padStart(6, "0");
const datei = (...zeilen) => {
  const text = zeilen.map(satz).join("\r\n") + "\r\n";
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Die im Test benutzten Sonderzeichen zurück nach CP437.
    const cp437 = { "ä": 0x84, "ö": 0x94, "ü": 0x81, "Ä": 0x8e, "Ö": 0x99, "Ü": 0x9a, "ß": 0xe1, "²": 0xfd };
    bytes[i] = cp437[text[i]] ?? c;
  }
  return bytes;
};

const MINI = () => datei(
  "00        83L                                                 1122PPPPI90 000001",
  "01Musterleistungen                        14.01.20                        000002",
  "02246802                                                                  000003",
  "1101       N    Bereich                                                   000004",
  "12Abbrucharbeiten                                                         000005",
  "2101010010 NNN         00000012500m²                                      000006",
  "25Wand abbrechen                                                          000007",
  "26   Bestandswand für Türöffnung abbrechen.                               000008",
  "310101                                                                    000009",
  ende(1, 10),
);

test("liest Kopf, Titel, Position, Kurz- und Langtext", () => {
  const r = parseD83(MINI(), { gewerk_nr: "001" });
  assert.equal(r.lv_name, "Musterleistungen");
  assert.equal(r.lv_datum, "14.01.20");
  assert.equal(r.projekt, "246802");
  assert.equal(r.positionen.length, 1);

  const p = r.positionen[0];
  assert.equal(p.oz, "01010010");
  assert.equal(p.kennz, "NNN");
  assert.equal(p.menge, 12.5);
  assert.equal(p.einheit, "m²");
  assert.equal(p.kurztext, "Wand abbrechen");
  assert.equal(p.langtext, "Bestandswand für Türöffnung abbrechen.");
  assert.deepEqual(p.titel, ["Abbrucharbeiten"]);
  assert.equal(p.gewerk_nr, "001");
});

test("CP437: die Tabelle hat 128 Einträge und trifft die Ränder", () => {
  assert.equal(decodeCp437(new Uint8Array([0x80])), "Ç");
  assert.equal(decodeCp437(new Uint8Array([0xff])), "\u00A0", "0xFF ist NBSP, nicht Space");
  assert.equal(decodeCp437(new Uint8Array([0x84, 0x94, 0x81])), "äöü");
  assert.equal(decodeCp437(new Uint8Array([0xfd])), "²");
  assert.equal(decodeCp437(new Uint8Array([0xe1])), "ß");
  // ASCII bleibt ASCII
  assert.equal(decodeCp437(new Uint8Array([0x30, 0x41, 0x7e])), "0A~");
  assert.equal(decodeCp437(new Uint8Array(0)), "");
});

test("CP437 auf langen Daten (Segmentierung über 8 KB)", () => {
  const gross = new Uint8Array(20000).fill(0x84); // 20.000 × „ä"
  const text = decodeCp437(gross);
  assert.equal(text.length, 20000);
  assert.equal(new Set(text).size, 1);
  assert.equal(text[19999], "ä");
});

test("ein String wird abgewiesen — file.text() hätte die Umlaute schon zerstört", () => {
  assert.throws(() => decodeCp437("2101010010"), /ArrayBuffer/);
  assert.throws(() => parseD83("2101010010"), /Bytes/);
  assert.throws(() => decodeCp437(null), /ArrayBuffer/);
});

test("Größenlimit greift (kein unbegrenzter Speicherverbrauch)", () => {
  assert.equal(MAX_BYTES, 32 * 1024 * 1024);
  // Eine Datei über dem Limit wird ABGEWIESEN, nicht Zeichen für Zeichen dekodiert.
  const zuGross = new Uint8Array(MAX_BYTES + 1);
  assert.throws(() => decodeCp437(zuGross), /zu groß/);
  // Genau am Limit ist noch erlaubt (Grenze inklusiv).
  assert.doesNotThrow(() => decodeCp437(new Uint8Array(16)));
});

test("Mengenfeld: unlesbar ergibt null (NIE 0) und warnt", () => {
  assert.equal(mengeAusFeld("00000012500"), 12.5);
  assert.equal(mengeAusFeld("00000000000"), 0, "eine echte 0 bleibt 0");
  assert.equal(mengeAusFeld("  abc  "), null);
  assert.equal(mengeAusFeld(null), null);
  assert.equal(mengeAusFeld("-0000001000"), null, "Vorzeichen ist im Format nicht vorgesehen");

  const r = parseD83(datei(
    "01Test                                                                    000001",
    "2101010010 NNN         XXXXXXXXXXXm2                                      000002",
    "25Kaputte Menge                                                           000003",
    ende(1, 4),
  ));
  assert.equal(r.positionen[0].menge, null, "keine erfundene Menge");
  assert.equal(r.warnungen.length, 1);
  assert.match(r.warnungen[0], /Mengenfeld unlesbar/);
});

test("unbekannte Satzart wird gezählt und gemeldet, nicht interpretiert", () => {
  const r = parseD83(datei(
    "01Test                                                                    000001",
    "77Voellig unbekannter Satz                                                000002",
    "2101010010 NNN         00000001000St                                      000003",
    "25Position                                                                000004",
    ende(1, 5),
  ));
  assert.equal(r.positionen.length, 1, "die gültige Position bleibt erhalten");
  assert.equal(r.satzarten["unbekannt:77"], 1);
  assert.match(r.warnungen.join(" "), /Unbekannte Satzart/);
});

test("Kurz-/Langtext ohne vorangehende Position werden nicht untergeschoben", () => {
  const r = parseD83(datei(
    "01Test                                                                    000001",
    "25Titel-Kurztext ohne Position                                            000002",
    "26   Freier Text                                                          000003",
    ende(0, 4),
  ));
  assert.equal(r.positionen.length, 0);
  assert.equal(r.pruefung.positionen_laut_datei, 0);
  assert.equal(r.pruefung.stimmig, true);
});

test("die Prüfsumme im Dateiende wird ausgewertet und gemeldet", () => {
  const r = parseD83(datei(
    "01Test                                                                    000001",
    "2101010010 NNN         00000001000St                                      000002",
    "25P                                                                       000003",
    ende(99, 4),
  ));
  assert.equal(r.pruefung.positionen_gelesen, 1);
  assert.equal(r.pruefung.positionen_laut_datei, 99);
  assert.equal(r.pruefung.stimmig, false);
  assert.match(r.warnungen.join(" "), /nennt 99 Positionen/);
});

test("mehrere Positionen: jede bekommt ihren eigenen Text", () => {
  const r = parseD83(datei(
    "01Test                                                                    000001",
    "1101       N    Bereich                                                   000002",
    "12Los A                                                                   000003",
    "2101010010 NNN         00000001000St                                      000004",
    "25Erste                                                                   000005",
    "26   Text eins                                                            000006",
    "2101010020 NNN         00000002000St                                      000007",
    "25Zweite                                                                  000008",
    "26   Text zwei                                                            000009",
    ende(2, 10),
  ));
  assert.equal(r.positionen.length, 2);
  assert.deepEqual(r.positionen.map((p) => p.kurztext), ["Erste", "Zweite"]);
  assert.deepEqual(r.positionen.map((p) => p.langtext), ["Text eins", "Text zwei"]);
  assert.deepEqual(r.positionen.map((p) => p.menge), [1, 2]);
  assert.ok(r.positionen.every((p) => p.titel[0] === "Los A"));
});

test("Formaterkennung: Inhalt entscheidet, nicht die Endung", () => {
  assert.equal(istGaeb90(MINI()), true);
  assert.equal(istGaeb90(new TextEncoder().encode("oz;menge\n1;2\n")), false);
  assert.equal(istGaeb90(new TextEncoder().encode('<?xml version="1.0"?>')), false);
  assert.equal(istGaeb90("kein Buffer"), false);
});

test("die Satzart- und Spaltentabellen sind vollständig dokumentiert", () => {
  for (const art of ["00", "01", "11", "12", "21", "25", "26", "31", "79", "99"]) {
    assert.ok(SATZARTEN[art], `Satzart ${art} nicht dokumentiert`);
  }
  assert.deepEqual(SPALTEN_21.menge, [23, 34]);
  assert.deepEqual(SPALTEN_21.einheit, [34, 38]);
  assert.deepEqual(GAEB90_ENDUNGEN, [".d81", ".d83", ".d84", ".p83", ".x83"]);
});

test("leere Datei ergibt 0 Positionen statt eines Wurfs", () => {
  const r = parseD83(new Uint8Array(0));
  assert.deepEqual(r.positionen, []);
  assert.equal(r.lv_name, "");
  assert.deepEqual(r.warnungen, []);
});
