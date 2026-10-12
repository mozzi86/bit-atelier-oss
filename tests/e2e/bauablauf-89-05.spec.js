// Headless-Nachweis 89-05 (Bauablauf-Kette): am Review Testhaus werden per API ein Modellstand mit zwei
// Bauteilen (G1 Wand, G2 Decke), eine LV-Position E2E.0010 → G1 und der Vorgang „Bodenplatte“ (LB 013,
// VE E2E, 01.–10.03.2026, Bauteil G1) angelegt. Im Bauzeitenplan wird über das Formular der Vorgang
// „Decke“ (LB 013, VE E2E, Vorgänger Bodenplatte EA, Start 05.03. → Terminverletzung, Bauteil G2, Position
// E2E.0010) angelegt. Erwartet: Befund „termin“, VE E2E mit „Vergabe spätestens“ 18.01.2026, Deckung 1 von
// 2 Bauteilen vollständig, CSV; nach Bearbeiten (Start 11.03.) ist der Terminbefund weg.
// Feste Daten, kein Rechenergebnis des Gebäudeprogramms. Aufräumen im finally und beim Start.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";
const M = "E2E8905";

test("89-05 Bauablauf-Kette: Vorgänger, Vergabeeinheit, Deckungsreport, Bearbeiten", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const pid = projekt.id;
  const aufraeumen = async () => {
    for (const x of (await (await request.get(`${API}/ScheduleTask?project_id=${pid}`)).json()).filter((r) => String(r.name).startsWith(M))) await request.delete(`${API}/ScheduleTask/${x.id}`);
    for (const x of (await (await request.get(`${API}/BimSnapshot?project_id=${pid}`)).json()).filter((r) => r.name === M)) await request.delete(`${API}/BimSnapshot/${x.id}`);
    for (const x of (await (await request.get(`${API}/LVPosition?project_id=${pid}`)).json()).filter((r) => r.oz === "E2E.0010")) await request.delete(`${API}/LVPosition/${x.id}`);
  };
  await aufraeumen();
  try {
    const snaps = await (await request.get(`${API}/BimSnapshot?project_id=${pid}`)).json();
    expect(snaps.length, "Testhaus ohne fremden Modellstand (Deckung liest den neuesten)").toBe(0);
    await request.post(`${API}/BimSnapshot`, { data: { project_id: pid, name: M, created_date: "2099-01-01T00:00:00Z",
      elemente: [{ guid: `${M}-G1`, name: "Wand E2E" }, { guid: `${M}-G2`, name: "Decke E2E" }] } });
    await request.post(`${API}/LVPosition`, { data: { project_id: pid, oz: "E2E.0010", title: "Ortbeton Wand", quantity: 1, unit: "m3", bim_element_ids: [`${M}-G1`], trade: "Rohbau" } });
    await request.post(`${API}/ScheduleTask`, { data: { project_id: pid, name: `${M} Bodenplatte`, trade: "Rohbau", gewerk_lb: "013", vergabeeinheit: "VE E2E",
      bauteil_guids: [`${M}-G1`], start_date: "2026-03-01T07:00:00Z", end_date: "2026-03-10T17:00:00Z", progress: 0 } });

    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/SiteControl?projekt=${encodeURIComponent("Review Testhaus")}`);
    await page.getByRole("tab", { name: "Bauzeitenplan" }).click();
    await expect(page.getByTestId("bk-karte")).toBeVisible({ timeout: 30000 });

    await page.getByRole("button", { name: "Aufgabe planen" }).click();
    await page.getByTestId("ts-name").fill(`${M} Decke`);
    await page.getByTestId("ts-start").fill("2026-03-05");
    await page.getByTestId("ts-ende").fill("2026-03-20");
    await page.getByTestId("ts-gewerk").selectOption("013");
    await page.getByTestId("ts-ve").fill("VE E2E");
    await page.locator(`[data-testid=ts-vorgaenger][data-name="${M} Bodenplatte"] input[type=checkbox]`).check();
    await page.getByTestId("ts-guids").fill(`${M}-G2`);
    await page.locator('[data-testid=ts-position][data-oz="E2E.0010"] input').check();
    await page.getByTestId("ts-speichern").click();

    const befund = page.locator(`[data-testid=bk-befund][data-code="termin"][data-task="${M} Decke"]`);
    await expect(befund).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid=bk-ve][data-ve="VE E2E"]')).toHaveAttribute("data-vergabe", "2026-01-18");
    const deckung = page.getByTestId("bk-deckung");
    await expect(deckung).toHaveAttribute("data-gesamt", "2");
    await expect(deckung).toHaveAttribute("data-voll", "1");
    await expect(page.locator(`[data-testid=bk-luecke][data-guid="${M}-G2"]`)).toContainText("ohne Position");

    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bk-csv").click()]);
    const text = fs.readFileSync(await csv.path(), "utf8");
    expect(text).toContain(`${M}-G1;Wand E2E;013 Betonarbeiten;E2E.0010;`);
    expect(text).toContain(`${M}-G2;Decke E2E;013 Betonarbeiten;;${M} Decke;nein`);

    const rec = (await (await request.get(`${API}/ScheduleTask?project_id=${pid}`)).json()).find((r) => r.name === `${M} Decke`);
    expect(rec.vorgaenger).toEqual([{ id: expect.any(String), art: "EA", abstand_tage: 0 }]);
    expect(rec.bauabschnitt).toBe("");
    expect(rec.trade).toBe("Betonarbeiten");

    await page.locator(`[data-testid=gantt-task][data-name="${M} Decke"]`).click();
    await expect(page.getByTestId("ts-name")).toHaveValue(`${M} Decke`);
    await page.getByTestId("ts-start").fill("2026-03-11");
    await page.getByTestId("ts-speichern").click();
    await expect(befund).toHaveCount(0, { timeout: 15000 });
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
