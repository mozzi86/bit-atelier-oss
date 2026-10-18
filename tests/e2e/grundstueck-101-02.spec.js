// Headless-Nachweis 101-02: die Grundstücksgrenze in der Baufeld-Planung ist editierbar — eine Ecke ziehen speichert
// das Grundstück als „gezeichnet“ (assumed false), die Fläche ändert sich; in Bayern ist die amtliche Flurstücksebene
// eingeschaltet (Schalter). Eigenes Projekt mit geschätztem Startquadrat, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Grundstueck 10102";

test("101-02 Grundstücksgrenze ziehen: Ecke verschieben → gezeichnet, Fläche neu; Flurstücke Bayern an", async ({ page, request }) => {
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
    const ecke = plan.locator('[data-testid="sd-parcel-ecke"]').first();
    await ecke.waitFor({ timeout: 60000 });
    await expect(plan.locator('[data-testid="sd-parcel-ecke"]')).toHaveCount(4);
    const b = /** @type {any} */ (await ecke.boundingBox());
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 40, b.y + b.height / 2 - 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const r = await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json();
      const p0 = r.site_parcel?.points?.[0];
      return `${r.site_parcel?.assumed}|${r.site_parcel?.source}|${p0 && (p0.x !== 360 || p0.y !== 360)}`;
    }, { timeout: 20000 }).toBe("false|gezeichnet|true");
    await expect(page.getByText(/\(gezeichnet\)/).first()).toBeVisible();
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
