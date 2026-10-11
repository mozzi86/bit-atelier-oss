// Headless-Nachweis 90-09 (Planner-Excel → vorhandener Bauzeitenplan): eine Planner-artige XLSX wird hier
// mit dem App-eigenen XLSX-Schreiber erzeugt (Blatt „Projektaufgaben“, Kopfzeile 9). Im Review-Testhaus
// existiert eine eigene Aufgabe (per API). Import im Reiter „Bauzeitenplan“: 4 Vorgänge erkannt, Zweig „2“
// + Ausschluss „Dach“ → 2 übernommen; erneuter Import ersetzt nur die Planner-Vorgänge, die eigene Aufgabe
// bleibt; Gantt als PDF A3 quer (1 Seite). Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { createWorkbook, writeWorkbook } from "../../packages/nova-core/src/lib/novaXlsx.js";

const API = "/api/entities";

function plannerXlsx() {
  const wb = createWorkbook();
  const ws = wb.addSheet("Projektaufgaben");
  ws.zeile(1, ["Projektname", "E2E 9009"]);
  ws.zeile(9, ["Aufgaben-ID", "Gliederungsnummer", "Name", "Dauer", "Anfangstermin", "Endtermin", "Bucket", "", "", "% erledigt"]);
  [["1", "1", "E2E9009 Planung", "", "05.01.2026", "27.02.2026", "Planung", "", "", 1],
    ["2", "2", "E2E9009 Bauzeit", "", "02.03.2026", "28.08.2026", "Bau", "", "", 0.25],
    ["3", "2.1", "E2E9009 Rohbau", "", "02.03.2026", "29.05.2026", "Rohbau", "", "", 0.5],
    ["4", "2.2", "Dach", "", "01.06.2026", "26.06.2026", "Dach", "", "", 0]].forEach((r, i) => ws.zeile(10 + i, r));
  return Buffer.from(writeWorkbook(wb));
}

test.describe("90-09 Planner-Excel → Bauzeitenplan", () => {
  test.setTimeout(150000);

  test("Import mit Zweig/Ausschluss, Re-Import ersetzt nur Planner-Vorgänge, PDF A3 quer", async ({ page, request }) => {
    const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
    const eigen = await (await request.post(`${API}/ScheduleTask`, { data: { project_id: projekt.id, name: "E2E9009 eigene Aufgabe", start_date: "2026-03-01", end_date: "2026-03-05", progress: 0 } })).json();
    const aufraeumen = async () => {
      const alle = await (await request.get(`${API}/ScheduleTask?project_id=${projekt.id}`)).json();
      for (const t of alle.filter((x) => x.quelle === "planner" && x.planner_datei === "e2e9009.xlsx")) await request.delete(`${API}/ScheduleTask/${t.id}`);
    };
    try {
      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/SiteControl?projekt=${encodeURIComponent("Review Testhaus")}`);
      await page.getByRole("tab", { name: "Bauzeitenplan" }).click();

      for (const runde of [1, 2]) {
        await page.getByTestId("pg-import").click();
        await page.getByTestId("pg-datei").setInputFiles({ name: "e2e9009.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: plannerXlsx() });
        await expect(page.getByTestId("pg-info")).toHaveAttribute("data-vorgaenge", "4");
        await page.getByTestId("pg-zweig").selectOption("2");
        await page.getByTestId("pg-ausschluss").fill("Dach");
        await expect(page.getByTestId("pg-vorschau")).toHaveAttribute("data-anzahl", "2");
        await page.getByTestId("pg-uebernehmen").click();
        await expect(page.getByRole("status").filter({ hasText: "Vorgänge importiert" })).toBeVisible({ timeout: 20000 });
        const alle = await (await request.get(`${API}/ScheduleTask?project_id=${projekt.id}`)).json();
        const meine = alle.filter((x) => x.planner_datei === "e2e9009.xlsx");
        expect(meine.map((x) => x.name).sort(), `Runde ${runde}`).toEqual(["2 E2E9009 Bauzeit", "2.1 E2E9009 Rohbau"]);
        expect(alle.some((x) => x.id === eigen.id), "eigene Aufgabe bleibt").toBe(true);
      }
      await expect(page.getByText("2.1 E2E9009 Rohbau")).toBeVisible();

      await page.getByTestId("pg-format").selectOption("A3");
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("pg-pdf").click()]);
      expect(dl.suggestedFilename()).toBe("Review_Testhaus_Gantt_A3.pdf");
      const doc = await PDFDocument.load(fs.readFileSync(await dl.path()));
      expect(doc.getPageCount()).toBe(1);
      const { width, height } = doc.getPage(0).getSize();
      expect(width).toBeGreaterThan(height);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen();
      await request.delete(`${API}/ScheduleTask/${eigen.id}`);
    }
  });
});
