// Headless-Nachweis 88-07 (SiGe nach D-RE-04, nur Formulare/Hinweise): am Review Testhaus wird ein
// Vorgang mit Gewerk „E2E8807 Rohbau“ per API angelegt. Im Reiter „SiGe“ der Werkplanung: 40 Arbeitstage,
// 25 Beschäftigte, 3 Arbeitgeber → Hinweise Vorankündigung, „SiGeKo bestellen“, SiGe-Plan; Haftungs-
// ausschluss sichtbar; Anhang II Nr. 1 nennt das Rohbau-Gewerk als typisch; Speichern legt den Datensatz
// SiGe an; die Vorankündigung ist ein PDF-Entwurf. Aufräumen im finally und beim Start.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";
const GEWERK = "E2E8807 Rohbau";

test("88-07 SiGe: Pflicht-Hinweise, Gefährdungsmatrix, Vorankündigung", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    for (const x of await (await request.get(`${API}/SiGe?project_id=${projekt.id}`)).json()) await request.delete(`${API}/SiGe/${x.id}`);
    for (const x of (await (await request.get(`${API}/ScheduleTask?project_id=${projekt.id}`)).json()).filter((r) => r.trade === GEWERK)) await request.delete(`${API}/ScheduleTask/${x.id}`);
    for (const d of (await (await request.get(`${API}/Document?project_id=${projekt.id}`)).json()).filter((x) => String(x.name || "").startsWith("Vorankuendigung_Review_Testhaus"))) await request.delete(`${API}/Document/${d.id}`);
  };
  await aufraeumen();
  try {
    await request.post(`${API}/ScheduleTask`, { data: { project_id: projekt.id, name: "E2E8807 Wände", trade: GEWERK, start_date: "2026-11-02T00:00:00Z", end_date: "2026-12-18T00:00:00Z", progress: 0 } });
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=sige`);
    await expect(page.getByTestId("sg-karte")).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid=sg-hinweis][data-code="haftung"]')).toBeVisible();
    await expect(page.locator('[data-testid=sg-matrix-zeile][data-nr="1"]')).toHaveAttribute("data-typisch", new RegExp(GEWERK));

    await page.getByTestId("sg-arbeitstage").fill("40");
    await page.getByTestId("sg-max_beschaeftigte").fill("25");
    await page.getByTestId("sg-arbeitgeber_anzahl").fill("3");
    await page.getByTestId("sg-ort").fill("Musterstraße 1, Musterstadt");
    for (const code of ["vorankuendigung", "sigeko", "sige_plan"]) {
      await expect(page.locator(`[data-testid=sg-hinweis][data-code="${code}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid=sg-hinweis][data-code="sigeko"]')).toContainText("SiGeKo bestellen");
    await page.getByTestId("sg-z-1").selectOption("ja");

    await page.getByTestId("sg-speichern").click();
    await expect(page.getByTestId("sg-gespeichert")).toBeVisible({ timeout: 15000 });
    const rec = (await (await request.get(`${API}/SiGe?project_id=${projekt.id}`)).json())[0];
    expect(String(rec.arbeitgeber_anzahl)).toBe("3");
    expect(rec.gefaehrdungen["1"].zutreffend).toBe(true);

    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sg-pdf").click()]);
    expect(pdf.suggestedFilename()).toBe("Vorankuendigung_Review_Testhaus_Entwurf.pdf");
    expect(fs.readFileSync(await pdf.path()).subarray(0, 4).toString("latin1")).toBe("%PDF");
    await expect(page.getByTestId("sg-meldung")).toContainText("Felder offen", { timeout: 15000 });
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
