// Headless-Nachweis 73-04 (BEST-09): im Bestandsprojekt sagen die Aufbau-Reiter (Bauphysik, Schallschutz)
// im Kopf, worauf sie rechnen — ohne Angabe „Grundlage nicht angegeben … Regelaufbauten“; nach Wahl
// „Bauteilöffnung“ im Bauphysik-Studio steht das im Kopf (gespeichert am Projekt). Im Neubau gibt es weder
// Zeile noch Auswahl. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities/Project";
const NAME = "E2E Aufbau Herkunft 7304";

test("73-04 Grundlage des Bauteilaufbaus im Bestand", async ({ page, request }) => {
  test.setTimeout(150000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ComplexDesigner?projekt=Review%20Testhaus&tab=bauphysik`);
    await expect(page.getByTestId("panel-stand")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("panel-herkunft")).toHaveCount(0);
    await expect(page.getByTestId("aufbau-herkunft")).toHaveCount(0);

    id = (await (await request.post(API, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bauphysik`);
    await expect(page.getByTestId("panel-herkunft")).toContainText("Grundlage nicht angegeben", { timeout: 30000 });
    await page.getByTestId("aufbau-herkunft").selectOption("oeffnung");
    await expect(page.getByTestId("panel-herkunft")).toHaveText("Bauteilaufbau: Bauteilöffnung.", { timeout: 15000 });
    await expect.poll(async () => (await (await request.get(`${API}/${id}`)).json()).aufbau_herkunft).toBe("oeffnung");

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=acoustics`);
    await expect(page.getByTestId("panel-herkunft")).toHaveText("Bauteilaufbau: Bauteilöffnung.", { timeout: 30000 });
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) await request.delete(`${API}/${id}`);
  }
});
