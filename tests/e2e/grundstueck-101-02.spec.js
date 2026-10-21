// Headless-Nachweis 101-02 (+ Nutzer 19.10. „Quadrat weg“): das geschätzte Startquadrat wird nicht gezeichnet und hat
// keine Griffe; „Grundstück zeichnen“ + vier Klicks + Schließen speichert das Grundstück als „gezeichnet“ (assumed false);
// danach ist die Grenze editierbar (Ecke ziehen). In Bayern ist die amtliche Flurstücksebene eingeschaltet (Schalter).
// Eigenes Projekt mit geschätztem Startquadrat, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Grundstueck 10102";

test("101-02 Grundstück: Schätzung unsichtbar, zeichnen → gezeichnet, dann Ecke ziehen; Flurstücke Bayern an", async ({ page, request }) => {
  test.setTimeout(150000);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: { project_id: id, name: NAME,
    location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" },
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: true, source: "geschaetzt", m_per_px: 1.25, geschaetzte_flaeche_m2: 7500,
      points: [{ x: 360, y: 360 }, { x: 440, y: 360 }, { x: 440, y: 420 }, { x: 360, y: 420 }] } } })).json()).id;
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await expect(page.getByTestId("sd-kataster")).toBeChecked();
    // estimated square: nothing drawn, no handles
    await page.getByTestId("sd-grundstueck-zeichnen").waitFor({ timeout: 60000 });
    await expect(plan.locator('[data-testid="sd-parcel-ecke"]')).toHaveCount(0);

    // draw the plot: four clicks + close
    await page.getByTestId("sd-grundstueck-zeichnen").click();
    await expect(page.getByTestId("sd-area-typ")).toHaveValue("grundstueck");
    const canvas = plan.locator("canvas.maplibregl-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const k = /** @type {any} */ (await canvas.boundingBox());
    const cx = k.x + k.width / 2, cy = Math.min(k.y + k.height / 2, (page.viewportSize()?.height ?? 720) - 140);
    for (const [dx, dy] of [[-90, -60], [90, -60], [90, 60], [-90, 60]]) { await page.mouse.click(cx + dx, cy + dy); await page.waitForTimeout(150); }
    await page.getByRole("button", { name: "Polygon schließen" }).click();
    await expect.poll(async () => {
      const r = await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json();
      return `${r.site_parcel?.assumed}|${r.site_parcel?.source}|${r.site_parcel?.points?.length}`;
    }, { timeout: 20000 }).toBe("false|gezeichnet|4");
    await expect(page.getByText(/\(gezeichnet\)/).first()).toBeVisible();

    // now editable: drag a corner
    const ecke = plan.locator('[data-testid="sd-parcel-ecke"]').first();
    await expect(plan.locator('[data-testid="sd-parcel-ecke"]')).toHaveCount(4);
    const vorher = JSON.stringify((await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).site_parcel.points);
    const b = /** @type {any} */ (await ecke.boundingBox());
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 30, b.y + b.height / 2 - 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).site_parcel.points) !== vorher, { timeout: 20000 }).toBe(true);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
