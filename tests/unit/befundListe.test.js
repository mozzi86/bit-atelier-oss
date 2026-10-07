// Unit tests of the findings list export (66-14, register no. 124): the pure table
// model (befundListe.js), its CSV and XLSX serialisation through @core/lib/tabellenExport
// and the file name. No model file and no WASM — findings and elements are built by hand.
//
// What is pinned: column order with the running number FIRST and taken from the report
// numbering (position in the clash list + 1, as ModelCheck `befundNr` counts it), the FULL
// list beyond the 60 rows of the print report, IDS violations as unnumbered rows, empty
// cells instead of "undefined", the CSV rules (BOM, ";", CRLF, decimal comma, formula
// guard, quoting) and the XLSX (sheet, header bold and frozen, filter, widths, same
// values as the CSV).
//
// In:  packages/nova-ifc-viewer/src/lib/befundListe.js, @core/lib/tabellenExport.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import {
  ART_IDS, BEFUNDLISTE_SPALTEN, befundTabelle, befundlisteDateiname, zaehleBefundzeilen,
} from "@ifc/lib/befundListe.js";
import { grundlageText } from "@ifc/lib/clashRegeln.js";
import { tabelleAlsCsv, tabellenAlsXlsx } from "@core/lib/tabellenExport.js";
import { parseCsv } from "@/lib/accounting/csv.js";
import { leseArbeitsmappe, zellwert } from "@ava/lib/xlsxRead.js";

const KIND_LABELS = {
  hard: "Kollision", clearance: "Abstand", duplicate: "Duplikat",
  enthalten: "nicht größer als (AABB-Näherung)", ohne_partner: "ohne Gegenstück",
};

/** 22-character GlobalIds of the wall and the beam of finding `i`. */
const WAND = (i) => `WAND${String(i).padStart(18, "0")}`;
const BALK = (i) => `BALK${String(i).padStart(18, "0")}`;

/** A clash finding in the shape clash.js produces; `i` makes GUIDs unique. */
const befund = (i, extra = {}) => ({
  aId: i * 2, bId: i * 2 + 1, aGuid: WAND(i), bGuid: BALK(i),
  aType: "IfcWall", bType: "IfcBeam", kind: "hard", overlapVol: 0.123456, center: { x: 1, y: 2, z: 3 }, ...extra,
});

// The elements of finding 1 (wall on the ground floor, beam on the first floor).
const ELEMENTE = [
  { expressId: 2, globalId: WAND(1), ifcType: "IfcWall", storey: "Erdgeschoss" },
  { expressId: 3, globalId: BALK(1), ifcType: "IfcBeam", storey: "Obergeschoss" },
];

const zeilenDerCsv = (tabelle) => parseCsv(tabelleAlsCsv(tabelle));
const spalteVon = (key) => BEFUNDLISTE_SPALTEN.findIndex((s) => s.key === key);

test("Spalten: laufende Nummer zuerst, dann die Reihenfolge des Registers, Status/Quittung/Kostenklasse als Leerspalten", () => {
  const labels = BEFUNDLISTE_SPALTEN.map((s) => s.label);
  assert.equal(labels[0], "Nr.");
  const reihenfolge = ["Nr.", "Art", "Schwere", "Fachmodell", "Geschoss", "GlobalId A", "GlobalId B", "Regel", "Grundlage", "Status", "Quittung", "Kostenklasse"];
  assert.deepEqual(labels.slice(0, reihenfolge.length), reihenfolge);
  // The three placeholder columns exist as header only — no row ever fills them.
  const modell = befundTabelle({ clashes: [befund(1)], ids: [{ spec: { name: "S" }, bestanden: false, verletzungen: [{ globalId: "X" }] }] });
  for (const key of ["status", "quittung", "kostenklasse"]) {
    assert.ok(modell.zeilen.every((z) => z[key] === undefined || z[key] === null), `${key} bleibt leer`);
  }
  // A fresh, mutable copy per call — the shared constant must not be changed through a model.
  assert.notEqual(modell.spalten, BEFUNDLISTE_SPALTEN);
  assert.deepEqual(modell.spalten.map((s) => s.key), BEFUNDLISTE_SPALTEN.map((s) => s.key));
});

test("Nr. ist die Berichtsnummer: Position in der Befundliste + 1, dieselbe Zählung wie ModelCheck befundNr", () => {
  const clashes = [befund(1), befund(2, { kind: "duplicate" }), befund(3, { kind: "clearance" })];
  // ModelCheck.jsx: new Map(clashes.map((c, i) => [c, i + 1]))
  const befundNr = new Map(clashes.map((c, i) => [c, i + 1]));
  const tabelle = befundTabelle({ clashes, elemente: ELEMENTE });
  assert.deepEqual(tabelle.zeilen.map((z) => z.nr), [1, 2, 3]);
  tabelle.zeilen.forEach((z, i) => assert.equal(z.nr, befundNr.get(clashes[i])));
  // The CSV carries the number as the first cell of each data row.
  const csv = zeilenDerCsv(tabelle);
  assert.deepEqual(csv.slice(1).map((r) => r[0]), ["1", "2", "3"]);
});

test("Nr. kommt aus der Nummernquelle der Seite (nummern), nicht aus einer eigenen Zählung", () => {
  const clashes = [befund(1), befund(2), befund(3)];
  // A map that numbers differently — the file must follow it, not count on its own.
  const nummern = new Map([[clashes[0], 41], [clashes[1], 7]]);
  const z = befundTabelle({ clashes, nummern }).zeilen;
  assert.deepEqual(z.map((r) => r.nr), [41, 7, 3], "bekannte Befunde folgen der Map, ein unbekannter fällt auf Position + 1");
  assert.deepEqual(befundTabelle({ clashes, nummern: null }).zeilen.map((r) => r.nr), [1, 2, 3]);
});

test("volle Liste: 130 Befunde ergeben 130 Zeilen, Nr. 61 und 130 sind da (kein Abschneiden bei 60)", () => {
  const clashes = Array.from({ length: 130 }, (_, i) => befund(i + 1));
  const tabelle = befundTabelle({ clashes });
  assert.equal(tabelle.zeilen.length, 130);
  assert.equal(tabelle.zeilen[60].nr, 61);
  assert.equal(tabelle.zeilen[129].nr, 130);
  const csv = zeilenDerCsv(tabelle);
  assert.equal(csv.length, 131, "Kopf + 130 Zeilen");
  assert.equal(csv[130][0], "130");
  assert.equal(zaehleBefundzeilen(clashes, []), 130);
});

test("IDS: eine Zeile je verletztes Bauteil ohne Nr., bestandene Spezifikationen fehlen, Zähler stimmt", () => {
  const ids = [
    { spec: { name: "Brandschutz", beschreibung: "Pflichtmerkmal", hinweise: "DIN 4102" }, eigen: true, bestanden: false,
      verletzungen: [
        { globalId: WAND(1), elementName: "Nordwand", facette: "property", erwartet: "FireRating", gefunden: "nicht vorhanden" },
        { globalId: BALK(1), elementName: null, facette: "property", erwartet: "FireRating", gefunden: "F30" },
      ] },
    { spec: { name: "Material" }, bestanden: true, verletzungen: [] },
    { spec: { name: "Leer" }, bestanden: false, verletzungen: [] },
  ];
  const clashes = [befund(1)];
  const tabelle = befundTabelle({ clashes, ids, elemente: ELEMENTE, modellNamen: { A: "haus.ifc" } });
  // 1 clash + 2 violations + 1 defensive row for the failed spec without a listed element
  assert.equal(tabelle.zeilen.length, 4);
  assert.equal(zaehleBefundzeilen(clashes, ids), 4, "der Zähler der Knöpfe stimmt mit der Tabelle überein");
  const [, a, b, leer] = tabelle.zeilen;
  assert.equal(a.nr, null, "IDS-Zeilen tragen keine Berichtsnummer");
  assert.equal(a.art, ART_IDS);
  assert.equal(a.regel, "Brandschutz (eigene Regel)");
  assert.equal(a.grundlage, "Pflichtmerkmal / DIN 4102");
  assert.equal(a.globalIdA, WAND(1));
  assert.equal(a.geschoss, "Erdgeschoss");
  assert.equal(a.bauteilA, "IfcWall");
  assert.equal(a.fachmodell, "haus.ifc");
  assert.equal(a.hinweis, "Nordwand — Facette property: erwartet FireRating, gefunden nicht vorhanden");
  assert.equal(b.hinweis, "Facette property: erwartet FireRating, gefunden F30");
  assert.equal(leer.hinweis, "Spezifikation nicht bestanden");
  assert.equal(leer.globalIdA, null);
});

test("fehlende Felder: leere Zelle statt undefined/null/NaN in CSV und XLSX", () => {
  const tabelle = befundTabelle({ clashes: [{}, { kind: "hard", center: null, overlapVol: NaN, abweichungMm: "x" }, null], ids: [null, { bestanden: false }] });
  assert.equal(tabelle.zeilen.length, 4, "3 Befunde (auch {} und null) + 1 defensive IDS-Zeile; ein null-Eintrag in ids zählt nicht");
  assert.equal(zaehleBefundzeilen([{}, {}, null], [null, { bestanden: false }]), 4);
  const csv = tabelleAlsCsv(tabelle);
  assert.ok(!/undefined|NaN|null|\[object/.test(csv), "kein Platzhalterwort in der Datei");
  const mappe = leseArbeitsmappe(tabellenAlsXlsx([tabelle]));
  const blatt = mappe.blaetter[0];
  assert.equal(zellwert(blatt, "B2"), null, "Art ohne kind bleibt leer");
  assert.equal(zellwert(blatt, "O3"), null, "NaN-Überlappung bleibt leer");
  assert.equal(zellwert(blatt, "P3"), null, "Text als Abweichung bleibt leer");
});

test("CSV: BOM, Semikolon, CRLF, Dezimalkomma; Nr. und Zahlen sind Zahlen, kein Apostroph", () => {
  const tabelle = befundTabelle({ clashes: [befund(1, { overlapVol: 0.123456, abweichungMm: 12.34, toleranzMm: 5 })], elemente: ELEMENTE });
  const csv = tabelleAlsCsv(tabelle);
  assert.ok(csv.startsWith("﻿Nr.;Art;Schwere;"), "BOM + Kopf");
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(csv), "jeder Zeilenumbruch ist CRLF");
  const zeile = csv.split("\r\n")[1].split(";");
  assert.equal(zeile.length, BEFUNDLISTE_SPALTEN.length);
  assert.equal(zeile[0], "1");
  assert.equal(zeile[spalteVon("ueberlappung")], "0,123", "Dezimalkomma, drei Stellen wie die Tabelle am Bildschirm");
  assert.equal(zeile[spalteVon("abweichung")], "12,3");
  assert.equal(zeile[spalteVon("toleranz")], "5");
});

test("CSV: Formel-Schutz für = + - @, Quoting für Semikolon und Anführungszeichen, Rücklesen ergibt dieselbe Spaltenzahl", () => {
  const clashes = [
    befund(1, { regel: { id: "=SUMME(A1)", name: "+49 Test", hinweis: null, grundlage: { dokument: "@Ordner", text: "- Abschnitt; mit \"Zitat\"" } } }),
    befund(2, { aType: "-IfcWall", bType: "@Beam" }),
  ];
  const tabelle = befundTabelle({ clashes });
  const csv = tabelleAlsCsv(tabelle);
  assert.ok(csv.includes("'=SUMME(A1) +49 Test"), "Regel mit = geschützt");
  assert.ok(csv.includes("'-IfcWall;'@Beam"), "Bauteilklassen mit - und @ geschützt");
  assert.ok(csv.includes("\"'@Ordner — - Abschnitt; mit \"\"Zitat\"\"\""), "Grundlage gequotet, innere Anführungszeichen verdoppelt, Anfang geschützt");
  const zeilen = parseCsv(csv);
  assert.equal(zeilen.length, 3);
  for (const z of zeilen) assert.equal(z.length, BEFUNDLISTE_SPALTEN.length, "kein Semikolon bricht eine Zeile");
  assert.equal(zeilen[1][0], "1", "die Nummer bleibt eine Zahl ohne Apostroph");
});

test("Art, Schwere: Etiketten der Seite, Rang aus der Befundkarte, unbekannte Art bleibt ohne Schwere", () => {
  const clashes = [
    befund(1, { kind: "hard" }), befund(2, { kind: "duplicate" }), befund(3, { kind: "clearance" }),
    befund(4, { kind: "enthalten" }), befund(5, { kind: "ohne_partner", bId: null, bGuid: "" }), befund(6, { kind: "unbekannt" }),
  ];
  const z = befundTabelle({ clashes, artLabels: KIND_LABELS }).zeilen;
  assert.deepEqual(z.map((r) => r.schwere), ["hoch", "mittel", "niedrig", "mittel", "mittel", null]);
  assert.equal(z[3].art, "nicht größer als (AABB-Näherung)", "Etikett der Seite (Näherung steht im Text)");
  assert.equal(z[5].art, "unbekannt", "unbekannte Art: rohe Bezeichnung statt leerer Zelle");
  // Without labels from the page the clashRegeln table answers.
  assert.equal(befundTabelle({ clashes: [befund(1)] }).zeilen[0].art, "Kollision");
});

test("Regel und Grundlage: ID + Name, Herkunft über grundlageText (66-07); ohne Regel leer", () => {
  const grundlage = { dokument: "BAP Rohbau", fassung: "2025", stelle: "S. 23", abschnitt: "Balken", text: "Abstand 5 cm" };
  const z = befundTabelle({
    clashes: [befund(1, { regel: { id: "R-07", name: "Wand gegen Unterzug", hinweis: null, grundlage } }), befund(2)],
  }).zeilen;
  assert.equal(z[0].regel, "R-07 Wand gegen Unterzug");
  assert.equal(z[0].grundlage, grundlageText(grundlage), "dieselbe Zeile wie BCF und Tabelle");
  assert.equal(z[0].grundlage, "BAP Rohbau (2025), S. 23 Balken — Abstand 5 cm");
  assert.equal(z[1].regel, null);
  assert.equal(z[1].grundlage, null);
});

test("Geschoss und Fachmodell: Geschoss von A, sonst B; zwei Modelle werden benannt, gleiche Modelle nur einmal", () => {
  const elemente = [
    { expressId: 1, globalId: "A1", ifcType: "IfcWall", storey: "Erdgeschoss", quelle: "A" },
    { expressId: 1, globalId: "B1", ifcType: "IfcBeam", storey: "", quelle: "B" },
    { expressId: 2, globalId: "B2", ifcType: "IfcSlab", storey: "Keller", quelle: "B" },
    { expressId: 3, globalId: "A3", ifcType: "IfcWall", storey: "Dach", quelle: "A" },
  ];
  const namen = { A: "Rohbau.ifc", B: "Architektur.ifc" };
  const z = befundTabelle({
    elemente, modellNamen: namen,
    clashes: [
      befund(1, { aGuid: "A1", bGuid: "B1", aId: 1, bId: 1 }), // A and B: both models, storey of A
      befund(2, { aGuid: "B1", bGuid: "B2", aId: 1, bId: 2 }), // both B: one model, storey of B (A has none)
      befund(3, { aGuid: "A3", bGuid: "", bId: null, kind: "ohne_partner" }), // one side only
      befund(4, { aGuid: "FREMD", bGuid: "UNBEKANNT", aId: 99, bId: 98 }), // not in the element list
    ],
  }).zeilen;
  assert.equal(z[0].fachmodell, "Rohbau.ifc / Architektur.ifc");
  assert.equal(z[0].geschoss, "Erdgeschoss");
  assert.equal(z[1].fachmodell, "Architektur.ifc");
  assert.equal(z[1].geschoss, "Keller");
  assert.equal(z[2].fachmodell, "Rohbau.ifc");
  assert.equal(z[2].geschoss, "Dach");
  assert.equal(z[3].geschoss, null, "ohne Geschoss bleibt die Zelle leer");
  assert.equal(z[3].fachmodell, null, "im Zwei-Modell-Lauf wird ein unbekanntes Bauteil nicht geraten");
  // Single run: elements carry no source and there is no model B — every side is the one model.
  const einzeln = befundTabelle({ clashes: [befund(1)], elemente: ELEMENTE, modellNamen: { A: "haus.ifc" } }).zeilen[0];
  assert.equal(einzeln.fachmodell, "haus.ifc");
  assert.equal(einzeln.geschoss, "Erdgeschoss");
});

test("GlobalId: ohne GlobalId steht die Express-ID wie in der Tabelle, eine fehlende Seite bleibt leer", () => {
  const z = befundTabelle({
    clashes: [befund(1, { aGuid: "", aId: 12 }), befund(2, { kind: "ohne_partner", bId: null, bGuid: "" })],
  }).zeilen;
  assert.equal(z[0].globalIdA, "#12");
  assert.equal(z[0].globalIdB, BALK(1));
  assert.equal(z[1].globalIdB, null);
});

test("leerer Befundstand: Kopf bleibt, keine Zeilen, Zähler 0, CSV und XLSX lassen sich erzeugen", () => {
  for (const eingabe of [undefined, {}, { clashes: [], ids: [] }, { clashes: null, ids: null }]) {
    const tabelle = befundTabelle(eingabe);
    assert.equal(tabelle.zeilen.length, 0);
    assert.equal(tabelle.spalten.length, BEFUNDLISTE_SPALTEN.length);
  }
  assert.equal(zaehleBefundzeilen(undefined, undefined), 0);
  assert.equal(zaehleBefundzeilen([], [{ bestanden: true, verletzungen: [] }]), 0);
  const tabelle = befundTabelle({});
  assert.equal(parseCsv(tabelleAlsCsv(tabelle)).length, 1, "nur die Kopfzeile");
  const blatt = leseArbeitsmappe(tabellenAlsXlsx([tabelle])).blaetter[0];
  assert.equal(zellwert(blatt, "A1"), "Nr.");
});

test("XLSX: Blatt Befundliste, Kopf fett und fixiert, Filter über alle Zeilen, Spaltenbreiten, gleiche Werte wie die CSV", () => {
  const clashes = [
    befund(1, { overlapVol: 0.5, abweichungMm: 3.25, toleranzMm: 1, regel: { id: "R-1", name: "Regel; eins", hinweis: null, grundlage: null } }),
    befund(2, { kind: "clearance" }),
  ];
  const ids = [{ spec: { name: "Brand" }, bestanden: false, verletzungen: [{ globalId: "X1", facette: "property", erwartet: "a", gefunden: "b" }] }];
  const tabelle = befundTabelle({ clashes, ids, elemente: ELEMENTE, artLabels: KIND_LABELS, modellNamen: { A: "m.ifc" } });
  const bytes = tabellenAlsXlsx([tabelle]);
  const mappe = leseArbeitsmappe(bytes);
  assert.deepEqual(mappe.blattNamen, ["Befundliste"]);
  const blatt = mappe.blaetter[0];
  assert.equal(blatt.freeze, "A2", "Kopfzeile fixiert");
  assert.equal(blatt.autoFilter, `A1:R${tabelle.zeilen.length + 1}`, "Filter über Kopf und alle Zeilen");
  assert.equal(blatt.spaltenBreiten.A, 7);
  assert.equal(blatt.spaltenBreiten.I, 55, "Breite je Spalte aus der Spaltenliste");
  // Header bold: styles.xml has a bold font and every header cell points to a style other than 0.
  const dateien = unzipSync(bytes);
  assert.ok(strFromU8(dateien["xl/styles.xml"]).includes("<b/>"));
  assert.ok(/<c r="A1" s="[1-9]\d*"/.test(strFromU8(dateien["xl/worksheets/sheet1.xml"])), "A1 trägt den Fett-Stil");
  // XLSX and CSV say the same, cell by cell (numbers: the CSV writes the decimal comma).
  const csv = parseCsv(tabelleAlsCsv(tabelle));
  tabelle.spalten.forEach((s, j) => {
    const spalte = String.fromCharCode(65 + j);
    assert.equal(zellwert(blatt, `${spalte}1`), csv[0][j], `Kopf ${s.label}`);
    csv.slice(1).forEach((zeile, i) => {
      const wert = zellwert(blatt, `${spalte}${i + 2}`);
      const erwartet = wert === null ? "" : typeof wert === "number" ? String(wert).replace(".", ",") : wert;
      assert.equal(erwartet, zeile[j], `${s.label}, Zeile ${i + 2}`);
    });
  });
  assert.equal(zellwert(blatt, "A2"), 1);
  assert.equal(zellwert(blatt, "O2"), 0.5);
  assert.equal(zellwert(blatt, "A4"), null, "IDS-Zeile ohne Nr.");
});

test("Dateiname: Projekt, JJJJ-MM-TT, befundliste; keine Leerzeichen, kein Sonderzeichen-Chaos", () => {
  const d = new Date(2026, 9, 6, 14, 30);
  assert.equal(befundlisteDateiname({ projekt: "Bürocampus Nord", datum: d, endung: "csv" }), "Bürocampus_Nord_2026-10-06_befundliste.csv");
  assert.equal(befundlisteDateiname({ projekt: " Haus (Nord) / A:B* ", datum: d, endung: "xlsx" }), "Haus_Nord_A_B_2026-10-06_befundliste.xlsx");
  assert.equal(befundlisteDateiname({ projekt: "", modell: "Muster projekt.IFC", datum: d }), "Muster_projekt_2026-10-06_befundliste.csv", "ohne Projekt: Modellname ohne .ifc");
  assert.equal(befundlisteDateiname({ datum: d }), "befundliste_2026-10-06_befundliste.csv");
  assert.equal(befundlisteDateiname({ projekt: "§§§", datum: d }), "befundliste_2026-10-06_befundliste.csv");
  assert.ok(!befundlisteDateiname({ projekt: "x", datum: new Date("nope") }).includes("NaN"), "ungültiges Datum fällt auf heute zurück");
  assert.match(befundlisteDateiname({ projekt: "x" }), /^x_\d{4}-\d{2}-\d{2}_befundliste\.csv$/);
});
