// Headless-Nachweis 101-04 Teil b: Riegel-Werkzeug der Baufeld-Planung — Pfad klicken, Startpunkt = Blockrand mit Hof,
// Enter = offener Riegel; Wohnungsmix farbig, Beschriftung, Liste mit Geschossen (BGF folgt), Löschen; auf der Karte
// wird der Riegel automatisch gespeichert (complexData.riegel). Eigene Projekte, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Riegel 10104";
const NAME_KARTE = "E2E Riegel 10104 Karte";

async function anlegen(request, name, mitStandort, punkte) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
  const id = (await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name,
    ...(mitStandort ? { location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" } } : {}),
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25, points: punkte },
  } })).json()).id;
  return { id, bc };
}

test("101-04 Riegel im SVG-Plan: Blockrand mit Hof, offener Riegel per Enter, Geschosse ändern BGF, Löschen", async ({ page, request }) => {
  test.setTimeout(150000);
  const { id, bc } = await anlegen(request, NAME, false, [{ x: 300, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 600 }, { x: 300, y: 600 }]);
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await page.getByTestId("sd-modus-riegel").click();
    await expect(page.getByTestId("sd-befehlszeile")).toContainText("Ersten Punkt des Riegels");
    const svg = plan.locator("svg").first();
    await svg.scrollIntoViewIfNeeded();
    const m = await svg.evaluate((el) => { const c = /** @type {SVGSVGElement} */ (el).getScreenCTM(); return { a: c.a, d: c.d, e: c.e, f: c.f }; });
    const klick = async (x, y) => { await page.mouse.click(m.e + x * m.a, m.f + y * m.d); await page.waitForTimeout(120); };

    // ring 80 × 60 canvas units = 100 × 75 m, closed on the start point → perimeter block
    for (const [x, y] of [[400, 300], [480, 300], [480, 360], [400, 360]]) await klick(x, y);
    await expect(page.getByTestId("sd-befehlszeile")).toContainText("Blockrand mit Hof");
    await klick(400, 300);
    const eintrag = page.getByTestId("sd-riegel-eintrag");
    await expect(eintrag).toHaveCount(1);
    await expect(eintrag.first()).toContainText("Blockrand 1");
    expect(await plan.getByTestId("sd-riegel-flaeche").count()).toBeGreaterThan(20);
    await expect(plan.getByTestId("sd-riegel-label").first()).toContainText("5 Geschosse");

    // fewer storeys → less BGF
    const bgf = async () => Number(((await eintrag.first().textContent()) || "").match(/([\d.]+) m² BGF/)?.[1].replace(/\./g, ""));
    const vorher = await bgf();
    await eintrag.first().getByTestId("sd-riegel-geschosse").fill("3");
    await expect.poll(bgf).toBeLessThan(vorher);
    await expect(page.getByTestId("sd-riegel-summe")).toBeVisible();

    // open bar: two points + Enter
    await klick(600, 450);
    await klick(760, 450);
    await page.keyboard.press("Enter");
    await expect(eintrag).toHaveCount(2);
    await expect(eintrag.nth(1)).toContainText("Riegel 2");

    await eintrag.first().getByTestId("sd-riegel-loeschen").click();
    await expect(eintrag).toHaveCount(1);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("101-04 Riegel auf der Karte: drei Punkte + Enter speichert complexData.riegel, Punkte sind ziehbar", async ({ page, request }) => {
  test.setTimeout(150000);
  const { id, bc } = await anlegen(request, NAME_KARTE, true, [{ x: 340, y: 340 }, { x: 460, y: 340 }, { x: 460, y: 440 }, { x: 340, y: 440 }]);
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_KARTE)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.locator('[data-testid="sd-parcel-ecke"]').first().waitFor({ timeout: 60000 });
    await page.getByTestId("sd-modus-riegel").click();
    const canvas = plan.locator("canvas.maplibregl-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const k = /** @type {any} */ (await canvas.boundingBox());
    const cx = k.x + k.width / 2, cy = Math.min(k.y + k.height / 2, (page.viewportSize()?.height ?? 720) - 120);
    for (const [dx, dy] of [[-80, -40], [40, -40], [40, 40]]) { await page.mouse.click(cx + dx, cy + dy); await page.waitForTimeout(150); }
    await page.keyboard.press("Enter");
    await expect.poll(async () => {
      const r = (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).riegel?.[0];
      return r ? `${r.punkte.length}|${r.geschlossen}|${r.opt?.geschosse}` : "keiner";
    }, { timeout: 20000 }).toBe("3|false|5");
    await expect(plan.locator('[data-testid="sd-riegel-punkt"]')).toHaveCount(3);
    await expect(page.getByTestId("sd-riegel-eintrag")).toHaveCount(1);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
