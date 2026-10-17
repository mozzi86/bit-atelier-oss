// Headless-Nachweis 95-01: eine gezeichnete Parzelle überlebt den Reiterwechsel — der Standort-Reiter
// zeigt das gespeicherte Grundstück als bearbeitbare Zeichnung (statt leer), „Standort übernehmen“
// behält es, und Änderungen werden ohne „Entwurf speichern“ automatisch gesichert.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Parzelle 9501";

test("95-01 Parzelle bleibt nach Reiterwechsel und Übernahme; Autosave", async ({ page, request }) => {
  test.setTimeout(150000);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const punkte = [{ x: 360, y: 360 }, { x: 440, y: 360 }, { x: 440, y: 420 }, { x: 360, y: 420 }];
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME, location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" },
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25, points: punkte },
  } })).json()).id;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    // "Style is not done loading" is MapLibre's own console warning when the map style is set while the
    // previous one still loads (re-entering the tab) — the library rebuilds the style, nothing breaks.
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=site`);
    const info = page.getByText(/Gezeichnete Parzelle:/);
    await expect(info).toBeVisible({ timeout: 60000 });
    await expect(info).toContainText("7.500 m²"); // 80 × 60 px × 1,25² m
    await expect(page.getByRole("button", { name: /Parzelle neu zeichnen/ })).toBeVisible();

    // Away and back: the parcel is still there (the component was unmounted in between).
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await page.getByTestId("mm-leiste").waitFor({ timeout: 60000 });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=site`);
    await expect(page.getByText(/Gezeichnete Parzelle:/)).toBeVisible({ timeout: 60000 });

    // Autosave: a name change reaches the record without pressing "Entwurf speichern".
    await page.locator("#pname").fill(`${NAME} geändert`);
    await page.getByRole("button", { name: /Standort übernehmen/ }).click();
    await expect.poll(async () => {
      const r = await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json();
      return `${r.name}|${r.site_parcel?.source}|${r.site_parcel?.points?.length}`;
    }, { timeout: 20000 }).toBe(`${NAME} geändert|gezeichnet|4`);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
