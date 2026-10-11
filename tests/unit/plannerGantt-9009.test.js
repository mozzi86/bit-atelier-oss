// Unit tests for plan 90-09 (plannerImport.js + ganttPdf.js): a Planner-style export (sheet
// "Projektaufgaben", head data rows 1–7, headers in row 9, tasks from row 10, dates as Excel serials and as
// "dd.mm.yyyy" text, progress as share) is generated here with the in-house XLSX writer and read back —
// header found by text, levels from the outline number, branches, branch/exclude filter, ScheduleTask
// records, re-import plan (manual tasks kept), refusal without a task header, and the large-format PDF.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { createWorkbook, writeWorkbook } from "@core/lib/novaXlsx";
import { plannerLesen, datumIso, hauptzweige, filtern, alsScheduleTasks, ersetzenPlan } from "@/lib/planung/plannerImport";
import { ganttPdf, ganttLayout, FORMATE } from "@/lib/planung/ganttPdf";

const serie = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

function plannerXlsx({ kopfText = true } = {}) {
  const wb = createWorkbook();
  const ws = wb.addSheet("Projektaufgaben");
  ws.zeile(1, ["Projektname", "Testhaus"]);
  ws.zeile(2, ["Projektbesitzer", "Planung"]);
  if (kopfText) ws.zeile(9, ["Aufgaben-ID", "Gliederungsnummer", "Name", "Dauer", "Anfangstermin", "Endtermin", "Bucket", "Zugewiesen", "Priorität", "% erledigt"]);
  const z = [
    ["1", "1", "LPH 5 Ausführungsplanung", "40 T", serie("2026-01-05"), serie("2026-02-27"), "Planung", "", "", 1],
    ["2", "1.1", "Werkpläne Rohbau", "20 T", serie("2026-01-05"), serie("2026-01-30"), "Planung", "", "", 1],
    ["3", "2", "Bauzeit", "120 T", "02.03.2026", "28.08.2026", "Bau", "", "", 0.25],
    ["4", "2.1", "Rohbau", "60 T", "02.03.2026", "29.05.2026", "Rohbau", "", "", 0.5],
    ["5", "2.1.1", "Bodenplatte", "10 T", "02.03.2026", "13.03.2026", "Rohbau", "", "", 1],
    ["6", "2.2", "Dach", "20 T", "01.06.2026", "26.06.2026", "Dach", "", "", 0],
    ["7", "2.3", "Ohne Termin", "", "", "", "Bau", "", "", 0],
  ];
  z.forEach((r, i) => ws.zeile(10 + i, r));
  return writeWorkbook(wb);
}

describe("plannerLesen", () => {
  it("finds header row 9 by text, reads levels, dates (serial and text), progress; skips rows without date", () => {
    const r = plannerLesen(plannerXlsx());
    assert.equal(r.blatt, "Projektaufgaben");
    assert.equal(r.kopfZeile, 9);
    assert.deepEqual(r.spalten, { gliederung: "B", name: "C", start: "E", ende: "F", bucket: "G", fortschritt: "J" });
    assert.equal(r.vorgaenge.length, 6);
    assert.deepEqual(r.vorgaenge.map((v) => v.ebene), [0, 1, 0, 1, 2, 1]);
    assert.equal(r.vorgaenge[0].start, "2026-01-05");
    assert.equal(r.vorgaenge[2].ende, "2026-08-28");
    assert.equal(r.vorgaenge[2].fortschritt, 25);
    assert.match(r.warnungen[0], /Ohne Termin.*übersprungen/);
  });

  it("dates: serial, German, ISO, US; invalid → null", () => {
    assert.equal(datumIso(46027), "2026-01-05");
    assert.equal(datumIso("31.12.26"), "2026-12-31");
    assert.equal(datumIso("2026-03-02T00:00:00"), "2026-03-02");
    assert.equal(datumIso("3/2/2026"), "2026-03-02");
    assert.equal(datumIso("31.02.2026"), null);
    assert.equal(datumIso("bald"), null);
  });

  it("refuses a workbook without a task header (no guessing)", () => {
    const wb = createWorkbook(); wb.addSheet("Tabelle1").zeile(1, ["a", "b"]);
    assert.throws(() => plannerLesen(writeWorkbook(wb)), /Keine Aufgabentabelle gefunden/);
  });
});

describe("Zweige, Filter, Import", () => {
  it("branches with sub-task count; branch and exclusion filter take sub-trees", () => {
    const v = plannerLesen(plannerXlsx()).vorgaenge;
    assert.deepEqual(hauptzweige(v).map((z) => [z.gliederung, z.anzahl, z.erledigt]), [["1", 2, true], ["2", 4, false]]);
    assert.deepEqual(filtern(v, { zweig: "2" }).map((x) => x.gliederung), ["2", "2.1", "2.1.1", "2.2"]);
    assert.deepEqual(filtern(v, { zweig: "2", ausschliessen: "2.1, Dach" }).map((x) => x.gliederung), ["2"]);
  });

  it("ScheduleTask records and the re-import plan keep manual tasks", () => {
    const v = plannerLesen(plannerXlsx()).vorgaenge;
    const recs = alsScheduleTasks(filtern(v, { zweig: "1" }), { projektId: "p1", datei: "plan.xlsx" });
    assert.deepEqual(recs[1], { project_id: "p1", name: "1.1 Werkpläne Rohbau", start_date: "2026-01-05", end_date: "2026-01-30", progress: 100, trade: "Planung", quelle: "planner", planner_gliederung: "1.1", planner_ebene: 1, planner_datei: "plan.xlsx" });
    assert.deepEqual(ersetzenPlan([{ id: "a", quelle: "planner" }, { id: "b" }, { id: "c", quelle: "planner" }]), { loeschen: ["a", "c"], behalten: 1 });
  });
});

describe("ganttPdf", () => {
  it("one landscape page in the chosen format; layout fits all rows", async () => {
    const tasks = alsScheduleTasks(plannerLesen(plannerXlsx()).vorgaenge, { projektId: "p1", datei: "x" });
    const L = ganttLayout(tasks, "A3");
    assert.ok(L.plotY + tasks.length * L.zeileH <= L.h);
    assert.equal(new Date(L.von).toISOString().slice(0, 10), "2026-01-01");
    const { bytes, dateiname, bericht } = await ganttPdf(tasks, { name: "Testhaus" }, { format: "A0", jetzt: new Date("2026-03-10T00:00:00Z") });
    assert.equal(dateiname, "Testhaus_Gantt_A0.pdf");
    assert.equal(bericht.zeilen, 6);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    const { width, height } = doc.getPage(0).getSize();
    assert.ok(Math.abs(width / 72 * 25.4 - FORMATE.A0[0]) < 1 && Math.abs(height / 72 * 25.4 - FORMATE.A0[1]) < 1);
    // 200 tasks still fit on one A3 page (row height shrinks, min 1.2 mm).
    const viele = Array.from({ length: 200 }, (_, i) => ({ name: `V${i}`, start_date: "2026-01-01", end_date: "2026-02-01", progress: 0 }));
    const g = await ganttPdf(viele, null, { format: "A3" });
    assert.equal((await PDFDocument.load(g.bytes)).getPageCount(), 1);
    assert.ok(g.bericht.zeileH_mm >= 1.2);
  });
});
