// Headless-Nachweis 73-02 (Registry, zweite Lesart; BEST-16): derselbe Reiter „Gebäudemodell“ braucht im
// Neubau (Review-Testhaus) den „Baukörper“ und läuft als Live-Modell, im Bestandsprojekt die „Bauaufnahme“
// — ohne Modellstand „Offen“ mit Hinweis, mit Modellstand „Gemessen“ samt Herkunftszeile. Der Standort-Reiter
// liest in beiden Bauarten gleich. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Bestand Lesart 7302";

test("73-02 PanelHeader: Neubau vs. Bestand, Offen → Gemessen mit Herkunft", async ({ page, request }) => {
  test.setTimeout(150000);
  let projektId = null, snapId = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    // maplibre's "Unable to perform style diff" while the site map is still loading is harmless (same filter as massing-75-06).
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/style diff|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ComplexDesigner?projekt=Review%20Testhaus&tab=bim`);
    const stand = page.getByTestId("panel-stand");
    await expect(stand).toHaveAttribute("data-stand", "modell", { timeout: 30000 });
    await expect(page.getByText("Baukörper", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("panel-herkunft")).toHaveCount(0);

    projektId = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await expect(stand).toHaveAttribute("data-stand", "offen", { timeout: 30000 });
    await expect(page.getByText("Bauaufnahme", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("panel-herkunft")).toContainText("Noch keine Bauaufnahme");

    snapId = (await (await request.post(`${API}/BimSnapshot`, { data: { project_id: projektId, name: "Aufmaß E2E", anzahl: 12, geschosse: ["EG", "OG"] } })).json()).id;
    await page.reload();
    await expect(stand).toHaveAttribute("data-stand", "gemessen", { timeout: 30000 });
    await expect(stand).toHaveText("Gemessen");
    await expect(page.getByTestId("panel-herkunft")).toContainText("Bauaufnahme: Aufmaß E2E · 2 Geschosse · 12 Bauteile");

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=site`);
    await expect(stand).toHaveAttribute("data-stand", "modell", { timeout: 30000 });
    await expect(page.getByTestId("panel-herkunft")).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (snapId) await request.delete(`${API}/BimSnapshot/${snapId}`);
    if (projektId) await request.delete(`${API}/Project/${projektId}`);
  }
});
