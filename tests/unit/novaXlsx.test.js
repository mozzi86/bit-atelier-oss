// novaXlsx — Verhalten des eigenen XLSX-Schreibers an den Rändern (Phase 33 / W5).
//
// Die Parität gegen die goldene Referenzdatei prüft Gate G14. Hier geht es um
// das, was eine Realdatei nicht enthält: verbotene Blattnamen, Zeichen, die XML
// brechen, Zellwerte, die kein Wert sind — und um die Frage, ob der
// Feature-Freeze noch hält.

import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import {
  BLATTNAME_MAX, FAEHIGKEITEN, ZIP_ZEITSTEMPEL, argb, blattRef, blattname,
  createWorkbook, esc, escAttr, spalte, writeWorkbook,
} from "@ava/lib/novaXlsx.js";
import { leseArbeitsmappe, zellformel, zellwert } from "@ava/lib/xlsxRead.js";

const mappe = (aufbau) => {
  const wb = createWorkbook();
  aufbau(wb);
  return leseArbeitsmappe(writeWorkbook(wb));
};

test("Feature-Freeze: genau 12 Fähigkeiten", () => {
  assert.equal(FAEHIGKEITEN.length, 12);
  assert.equal(Object.isFrozen(FAEHIGKEITEN), true);
  // Jede 13. Fähigkeit braucht einen neuen Roundtrip-Nachweis (T-33-06).
  assert.ok(FAEHIGKEITEN.includes("dxf_cfRules_expression_stopIfTrue"));
  assert.ok(FAEHIGKEITEN.includes("definedNames"));
});

test("Zip-Container: die OOXML-Pflichtteile sind da", () => {
  const wb = createWorkbook();
  wb.addSheet("A").setze(1, 1, 1);
  const dateien = Object.keys(unzipSync(writeWorkbook(wb)));
  for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml",
    "xl/worksheets/sheet1.xml"]) {
    assert.ok(dateien.includes(p), `${p} fehlt`);
  }
});

test("Zeitstempel ist FEST — zweimal bauen ergibt dieselben Bytes", () => {
  const bau = () => {
    const wb = createWorkbook();
    wb.addSheet("A").setze(1, 1, "x");
    return writeWorkbook(wb);
  };
  assert.deepEqual([...bau()], [...bau()]);
  assert.equal(ZIP_ZEITSTEMPEL, Date.UTC(1980, 0, 1));
});

test("Zelltypen: Zahl, Text, Boolean, Formel — und null schreibt NICHTS", () => {
  const wb = mappe((w) => {
    const ws = w.addSheet("T");
    ws.setze(1, 1, 42);
    ws.setze(1, 2, "Text");
    ws.setze(1, 3, true);
    ws.setze(1, 4, "=A1*2");
    ws.setze(1, 5, null);
    ws.setze(1, 6, 0);
  });
  const ws = wb.blaetter[0];
  assert.equal(zellwert(ws, "A1"), 42);
  assert.equal(zellwert(ws, "B1"), "Text");
  assert.equal(zellwert(ws, "C1"), true);
  assert.equal(zellformel(ws, "D1"), "=A1*2");
  assert.equal(zellwert(ws, "E1"), null);
  // Eine echte 0 ist eine Zahl und bleibt eine — nur `null` bleibt leer.
  assert.equal(zellwert(ws, "F1"), 0);
});

test("Formeln werden NICHT als Text geschrieben (das ist der ganze Zweck)", () => {
  const wb = createWorkbook();
  wb.addSheet("T").setze(1, 1, "=SUM(B1:B9)");
  const xml = strFromU8(unzipSync(writeWorkbook(wb))["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<f>SUM\(B1:B9\)<\/f>/);
  assert.equal(xml.includes('t="s"'), false, "eine Formel darf nicht in die sharedStrings wandern");
  // fullCalcOnLoad, sonst zeigen Excel/LibreOffice leere Zellen.
  const wbXml = strFromU8(unzipSync(writeWorkbook(wb))["xl/workbook.xml"]);
  assert.match(wbXml, /fullCalcOnLoad="1"/);
});

test("Formel-Escaping: <, > und & brechen das XML nicht", () => {
  const wb = mappe((w) => {
    const ws = w.addSheet("T");
    ws.setze(1, 1, '=IF(AND(A2>0.2,A2<5),"a & b","")');
    ws.setze(2, 1, 'Text mit < > & "Zitat"');
  });
  const ws = wb.blaetter[0];
  assert.equal(zellformel(ws, "A1"), '=IF(AND(A2>0.2,A2<5),"a & b","")');
  assert.equal(zellwert(ws, "A2"), 'Text mit < > & "Zitat"');
  assert.equal(esc("a<b>c&d"), "a&lt;b&gt;c&amp;d");
  assert.equal(escAttr('a"b'), "a&quot;b");
});

test("definedNames landen in der Arbeitsmappe", () => {
  const wb = mappe((w) => {
    w.addSheet("Zusammenfassung").setze(3, 5, 1.48);
    w.definedName("Preisindex", "Zusammenfassung!$E$3");
  });
  assert.equal(wb.definedNames.Preisindex, "Zusammenfassung!$E$3");
});

test("cfRules: Reihenfolge = Priorität, stopIfTrue immer gesetzt", () => {
  const wb = mappe((w) => {
    const ws = w.addSheet("T");
    ws.setze(5, 15, 0.3);
    ws.cfRegel("O5:O5", "AND(ISNUMBER(O5),ABS(O5)>0.2)", { fill: "FFC7CE" });
    ws.cfRegel("O5:O5", "AND(ISNUMBER(O5),ABS(O5)>0.1)", { fill: "FFEB9C" });
    ws.cfRegel("O5:O5", "AND(ISNUMBER(O5),ABS(O5)<=0.1)", { fill: "C6EFCE" });
  });
  const rules = wb.blaetter[0].cfRules;
  assert.equal(rules.length, 3);
  assert.deepEqual(rules.map((r) => r.prioritaet), [1, 2, 3]);
  assert.equal(rules.every((r) => r.stopIfTrue === true), true);
  assert.equal(rules.every((r) => r.typ === "expression"), true);
  // ARGB, nicht RGB: die dxf-Füllungen müssen 8 Hexstellen haben.
  assert.deepEqual(rules.map((r) => wb.dxfs[r.dxfId].fill), ["FFFFC7CE", "FFFFEB9C", "FFC6EFCE"]);
  // Das `=` vorne wird toleriert und entfernt.
  const wb2 = mappe((w) => w.addSheet("T").cfRegel("A1:A1", "=A1>1", { fill: "FFC7CE" }));
  assert.equal(wb2.blaetter[0].cfRules[0].formeln[0], "A1>1");
});

test("argb: die FF-Falle ist geschlossen", () => {
  // Ein naives replace(/^FF/,'') hätte aus FFC7CE die Farbe C7CE gemacht.
  assert.equal(argb("FFC7CE"), "FFFFC7CE");
  assert.equal(argb("C6EFCE"), "FFC6EFCE");
  assert.equal(argb("FFFFC7CE"), "FFFFC7CE");
  assert.equal(argb("#D9D9D9"), "FFD9D9D9");
  assert.throws(() => argb("rot"), /keine Farbe/);
  assert.throws(() => argb("FFF"), /keine Farbe/);
});

test("Blattnamen-Hygiene: verbotene Zeichen weg, 31 Zeichen Grenze", () => {
  // Die verbotenen Zeichen werden ENTFERNT, nicht durch Leerzeichen ersetzt —
  // genau wie in der Vorlage (`re.sub(r"[\\/?*[\]:']", "", …)`).
  assert.equal(blattname("012 Fliesen/Platten:*?[x]'"), "012 FliesenPlattenx");
  assert.equal(blattname("x".repeat(60)).length, BLATTNAME_MAX);
  assert.equal(blattname(""), "Blatt");
  assert.equal(blattname(null), "Blatt");
  // Umlaute bleiben — die sind erlaubt und fachlich nötig.
  assert.equal(blattname("IFC-Verknüpfung"), "IFC-Verknüpfung");
  // Und ein Doppelname wird abgewiesen, statt Excel die Datei zu verweigern.
  const wb = createWorkbook();
  wb.addSheet("A/B");
  assert.throws(() => wb.addSheet("A:B"), /doppelt/);
});

test("blattRef zitiert nur, wenn nötig", () => {
  assert.equal(blattRef("Zusammenfassung"), "Zusammenfassung");
  assert.equal(blattRef("KB nach Gewerk"), "'KB nach Gewerk'");
  assert.equal(blattRef("001 Abbruch"), "'001 Abbruch'");
});

test("Cross-Sheet-Formeln bleiben zeichengleich erhalten", () => {
  const f = "=SUMIF('KB nach Gewerk'!A:A,A7,'KB nach Gewerk'!M:M)";
  const h = '=HYPERLINK("#\'001 Abbruch\'!A1","öffnen")';
  const wb = mappe((w) => {
    const ws = w.addSheet("Z");
    ws.setze(7, 4, f);
    ws.setze(7, 7, h);
  });
  assert.equal(zellformel(wb.blaetter[0], "D7"), f);
  assert.equal(zellformel(wb.blaetter[0], "G7"), h);
});

test("freeze, autoFilter, Merges, Spaltenbreiten kommen an", () => {
  const wb = mappe((w) => {
    const ws = w.addSheet("T");
    ws.setze(10, 5, 1);
    ws.freeze("E5");
    ws.autoFilter("A4:S10");
    ws.merge("H3:J3");
    ws.breite(2, 46);
  });
  const ws = wb.blaetter[0];
  assert.equal(ws.freeze, "E5");
  assert.equal(ws.autoFilter, "A4:S10");
  assert.deepEqual(ws.merges, ["H3:J3"]);
  assert.equal(ws.spaltenBreiten.B, 46);
});

test("Zellpositionen werden validiert, nicht stillschweigend korrigiert", () => {
  const wb = createWorkbook();
  const ws = wb.addSheet("T");
  assert.throws(() => ws.setze(0, 1, "x"), /ungültige Zellposition/);
  assert.throws(() => ws.setze(1, 0, "x"), /ungültige Zellposition/);
  assert.throws(() => ws.setze(1.5, 1, "x"), /ungültige Zellposition/);
  assert.throws(() => writeWorkbook(createWorkbook()), /ohne Blatt/);
});

test("spalte(): Buchstaben auch jenseits von Z", () => {
  assert.equal(spalte(1), "A");
  assert.equal(spalte(19), "S");
  assert.equal(spalte(26), "Z");
  assert.equal(spalte(27), "AA");
  assert.equal(spalte(52), "AZ");
});

test("Stile werden dedupliziert (styles.xml wächst nicht mit jeder Zelle)", () => {
  const wb = createWorkbook();
  const ws = wb.addSheet("T");
  for (let r = 1; r <= 200; r += 1) ws.setze(r, 1, r, { numFmt: "#,##0.00", fill: "D9D9D9" });
  const styles = strFromU8(unzipSync(writeWorkbook(wb))["xl/styles.xml"]);
  const anzahl = Number(/<cellXfs count="(\d+)"/.exec(styles)[1]);
  assert.ok(anzahl <= 3, `${anzahl} cellXfs für einen einzigen Stil`);
});
