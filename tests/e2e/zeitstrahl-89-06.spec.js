// Headless-Nachweis 89-06 (D-BW-04): der 4D-Reiter der Baustelle zeigt zum gewählten Datum die Matrix
// Bauabschnitt × Gewerk (nicht begonnen / läuft / fertig), die Gewerke auf der Baustelle und exportiert
// den Stand als CSV und PDF. Drei Vorgänge werden per API am Testhaus angelegt und im finally gelöscht.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";
const MARKE = "E2E8906";

test("89-06 Zeitstrahl Bauabschnitt × Gewerk mit Export", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const alt = await (await request.get(`${API}/ScheduleTask?project_id=${projekt.id}`)).json();
  for (const x of alt.filter((r) => String(r.name).startsWith(MARKE))) await request.delete(`${API}/ScheduleTask/${x.id}`);
  const ids = [];
  const anlegen = async (name, trade, area, start, end) => {
    ids.push((await (await request.post(`${API}/ScheduleTask`, { data: { project_id: projekt.id, name: `${MARKE} ${name}`, trade, area, start_date: start, end_date: end, progress: 0 } })).json()).id);
  };
  try {
    await anlegen("Bodenplatte", "Rohbau", "BA 1", "2026-03-01T00:00:00Z", "2026-03-11T00:00:00Z");
    await anlegen("Wände", "Rohbau", "BA 2", "2026-03-11T00:00:00Z", "2026-03-21T00:00:00Z");
    await anlegen("Fenster", "Fassade", "BA 1", "2026-03-15T00:00:00Z", "2026-03-25T00:00:00Z");
    // Other tasks of the house (other specs) may widen the range — this test only reads its own cells.

    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/SiteControl?projekt=${encodeURIComponent("Review Testhaus")}`);
    await page.getByRole("tab", { name: "4D/5D" }).click();
    await expect(page.getByTestId("zs-matrix")).toBeVisible({ timeout: 30000 });

    await page.getByTestId("zs-regler").fill(String(Date.parse("2026-03-16T00:00:00Z")));
    await expect(page.getByTestId("zs-datum")).toHaveText("16.03.2026");
    const zelle = (ab, gw) => page.locator(`[data-testid=zs-zelle][data-abschnitt="${ab}"][data-gewerk="${gw}"]`);
    await expect(zelle("BA 1", "Rohbau")).toHaveAttribute("data-zustand", "fertig");
    await expect(zelle("BA 2", "Rohbau")).toHaveAttribute("data-zustand", "laeuft");
    await expect(zelle("BA 1", "Fassade")).toHaveAttribute("data-zustand", "laeuft");
    await expect(page.getByTestId("zs-aktiv")).toContainText("Fassade");

    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("zs-csv").click()]);
    expect(csv.suggestedFilename()).toMatch(/Review_Testhaus_Bauzustand_2026-03-16\.csv$/);
    const text = fs.readFileSync(await csv.path(), "utf8");
    expect(text).toContain("2026-03-16;BA 1;Rohbau;fertig;100;0;1");
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("zs-pdf").click()]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    expect(fs.readFileSync(await pdf.path()).subarray(0, 4).toString()).toBe("%PDF");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const id of ids) await request.delete(`${API}/ScheduleTask/${id}`);
  }
});
