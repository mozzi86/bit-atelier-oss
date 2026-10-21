// Headless-Nachweis 101-04: in der Baufeld-Planung spannt Ziehen im Baukörper-Werkzeug einen Baukörper auf (eigene Größe
// statt 20 × 15 m), die Beschriftung lautet „3 Geschosse · … m² BGF“, Links-Ziehen verschiebt die Karte nicht mehr,
// gedrücktes Mausrad verschiebt sie. Eigenes Projekt, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Aufziehen 10104";

test("101-04 Baukörper aufziehen, Beschriftung Geschosse/BGF, Karte schwenkt nur mit dem Mausrad", async ({ page, request }) => {
  test.setTimeout(150000);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: { project_id: id, name: NAME,
    location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" },
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25,
      points: [{ x: 340, y: 340 }, { x: 460, y: 340 }, { x: 460, y: 440 }, { x: 340, y: 440 }] } } })).json()).id;
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    const ecke = plan.locator('[data-testid="sd-parcel-ecke"]').first();
    await ecke.waitFor({ timeout: 60000 });
    const canvas = plan.locator("canvas.maplibregl-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const k = /** @type {any} */ (await canvas.boundingBox());
    // Below the 760 px work-surface height the page scrolls: stay inside the visible part of the map.
    const cx = k.x + k.width / 2, cy = Math.min(k.y + k.height / 2, (page.viewportSize()?.height ?? 720) - 120);
    const vorher = /** @type {any} */ (await ecke.boundingBox());

    // Left drag inside the parcel: pulls a building open, the map stays where it is.
    await page.mouse.move(cx - 60, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 10 });
    await expect(page.getByTestId("sd-aufziehen")).toBeVisible();
    await expect(page.getByTestId("sd-aufziehen")).toContainText(" m");
    await page.mouse.up();
    await expect(page.getByTestId("sd-aufziehen")).toBeHidden();
    const nachLinks = /** @type {any} */ (await ecke.boundingBox());
    expect(Math.abs(nachLinks.x - vorher.x) + Math.abs(nachLinks.y - vorher.y)).toBeLessThan(2);
    await expect.poll(async () => {
      const b = (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).buildings?.[0];
      return b ? `${b.floors}|${b.width !== 16 && b.width > 2}|${b.height !== 12 && b.height > 2}` : "keiner";
    }, { timeout: 20000 }).toBe("3|true|true");
    await expect(plan.getByText(/3 Geschosse/).first()).toBeVisible();
    await expect(plan.getByText(/m² BGF/).first()).toBeVisible();

    // Pressed wheel + drag pans the map.
    await page.mouse.move(cx + 100, cy + 60);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cx + 40, cy + 20, { steps: 8 }); // 60 px left, 40 px up
    await page.mouse.up({ button: "middle" });
    const nachRad = /** @type {any} */ (await ecke.boundingBox());
    expect(nachLinks.x - nachRad.x).toBeGreaterThan(40);
    expect(nachLinks.y - nachRad.y).toBeGreaterThan(25);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
