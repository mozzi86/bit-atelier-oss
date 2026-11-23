// Headless proof 115-05d (one undo history of the site data on the designer page), SVG site plan without a location:
//  - after the load the history is empty (no phantom step from loading or from derived values);
//  - dragging a block over many pointer moves is ONE step: one Strg+Z puts it back and the history is empty again;
//  - the hint names the step ("Rückgängig: Baukörper");
//  - the history outlives a change of the tab (the site plan is unmounted meanwhile): redo and undo still work;
//  - nothing is stored without "Speichern" (the site data is a draft, 115-05c).
//  - Massing-Studio: dragging a corner of the building envelope and pressing Strg+Z takes the ENVELOPE back and leaves the body alone
//    (before, the envelope's old outline went into the body's stack and Strg+Z replaced the body by it).
// Own projects, created and removed by the tests.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Undo 11505d";
const PARZELLE = [{ x: 300, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 600 }, { x: 300, y: 600 }];
// 16 × 8 px = 20 × 10 m at 1.25 m/px
const BLOECKE = [
  { id: "b1", x: 400, y: 300, width: 16, height: 8, floors: 3 },
  { id: "b2", x: 600, y: 300, width: 16, height: 8, floors: 3 },
];

test("115-05d Lageplan: Ziehen ist ein Schritt, der Verlauf überlebt den Reiterwechsel", async ({ page, request }) => {
  test.setTimeout(180000);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: { project_id: id, name: NAME,
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25, points: PARZELLE }, buildings: BLOECKE } })).json()).id;
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(String(e)));
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await page.getByTestId("sd-modus-auswahl").click();
    const svg = plan.locator("svg").first();
    await svg.scrollIntoViewIfNeeded();
    const matrix = () => svg.evaluate((el) => { const c = /** @type {SVGSVGElement} */ (el).getScreenCTM(); return { a: c.a, d: c.d, e: c.e, f: c.f }; });
    const ziehen = async (/** @type {{x: number, y: number}} */ a, /** @type {{x: number, y: number}} */ b) => {
      const m = await matrix();
      await page.mouse.move(m.e + a.x * m.a, m.f + a.y * m.d); await page.mouse.down();
      await page.mouse.move(m.e + b.x * m.a, m.f + b.y * m.d, { steps: 12 }); await page.mouse.up();
    };
    const mitteX = async (/** @type {string} */ bid) => Number(String(await plan.locator(`[data-testid="sd-block"][data-id="${bid}"]`).getAttribute("data-mitte")).split(",")[0]);
    const undo = page.getByTestId("sd-undo"), redo = page.getByTestId("sd-redo");

    // loaded: nothing to undo
    await expect.poll(() => mitteX("b1")).toBe(510);
    await page.waitForTimeout(1500); // derived values (site area) have settled
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    // one drag over 12 pointer moves, Alt = no snapping: 40 px = 50 m
    await page.keyboard.down("Alt");
    await ziehen({ x: 408, y: 304 }, { x: 448, y: 304 });
    await page.keyboard.up("Alt");
    await expect.poll(() => mitteX("b1")).toBe(560);
    await expect(undo).toBeEnabled();
    await page.keyboard.press("Control+z");
    await expect.poll(() => mitteX("b1")).toBe(510);
    await expect(undo, "the whole drag was ONE step").toBeDisabled();
    await expect(page.getByText("Rückgängig: Baukörper")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Control+y");
    await expect.poll(() => mitteX("b1")).toBe(560);

    // a second step, then leave the tab (the site plan is unmounted) and come back
    await page.keyboard.down("Alt");
    await ziehen({ x: 608, y: 304 }, { x: 608, y: 344 });
    await page.keyboard.up("Alt");
    await expect(undo).toBeEnabled();
    await page.getByRole("tab", { name: "Bauaufnahme", exact: true }).click();
    await expect(plan).toHaveCount(0, { timeout: 15000 });
    await page.getByRole("tab", { name: "Baufeld-Planung", exact: true }).click();
    await plan.waitFor({ timeout: 30000 });
    await expect.poll(() => mitteX("b1")).toBe(560);
    await expect(undo, "the history is still there").toBeEnabled();
    await undo.click();
    await undo.click();
    await expect.poll(() => mitteX("b1")).toBe(510);
    await expect(undo).toBeDisabled();
    await redo.click();
    await expect.poll(() => mitteX("b1")).toBe(560);

    // a draft until "Speichern": the stored record still has the blocks where they were
    const gespeichert = (await (await request.get(`/api/entities/BuildingComplex?project_id=${id}`)).json())[0];
    expect(gespeichert.buildings.map((/** @type {any} */ b) => b.x)).toEqual([400, 600]);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`).catch(() => {});
    await request.delete(`/api/entities/Project/${id}`).catch(() => {});
  }
});

test("115-05d Massing-Studio: Strg+Z nach dem Ziehen des Baufelds nimmt das Baufeld zurück, nicht den Baukörper", async ({ page, request }) => {
  test.setTimeout(180000);
  const NAME2 = "E2E Undo 11505d Massing";
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME2)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    for (const c of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${c.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME2, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: { project_id: id, name: NAME2,
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 0.1, points: PARZELLE },
    designated_areas: [{ id: "bf1", type: "baufeld", name: "Baufeld", points: [{ x: 400, y: 280 }, { x: 800, y: 280 }, { x: 800, y: 520 }, { x: 400, y: 520 }] }] } })).json()).id;
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading|wasm/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(String(e)); });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME2)}&tab=massing`);
    await page.getByRole("tab", { name: "Massing-Studio", exact: true }).click();
    const koerper = page.locator('polygon[data-griff="flaeche"]');
    await expect(koerper).toBeVisible({ timeout: 60000 });
    await koerper.scrollIntoViewIfNeeded();
    const punkte = (/** @type {import("@playwright/test").Locator} */ l) => l.getAttribute("points");
    const koerperVorher = await punkte(koerper);
    const undo = page.getByTestId("ms-undo");
    await page.waitForTimeout(1500);
    await expect(undo, "nothing to undo after the load").toBeDisabled();

    await page.locator('[data-ebene="baufeld"]').click();
    const baufeld = page.locator('[data-ebene-aktiv="baufeld"]');
    await expect(baufeld).toHaveCount(1);
    const baufeldVorher = await punkte(baufeld);
    const ecke = page.locator('[data-griff="ecke"]').first();
    const box = await ecke.boundingBox();
    if (!box) throw new Error("Eckgriff nicht sichtbar");
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.keyboard.down("Alt"); // no snapping
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 10 }); await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => punkte(baufeld), { timeout: 10000 }).not.toBe(baufeldVorher);
    await expect(undo).toBeEnabled();
    await page.keyboard.press("Control+z");
    await expect.poll(() => punkte(baufeld), { timeout: 10000 }).toBe(baufeldVorher);
    await expect(undo, "one drag = one step").toBeDisabled();
    // the body is what it was
    await page.locator('[data-ebene="baukoerper"]').click();
    await expect(page.locator("[data-ebene-aktiv]")).toHaveCount(0);
    expect(await punkte(koerper)).toBe(koerperVorher);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  } finally {
    for (const c of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json().catch(() => [])) await request.delete(`/api/entities/BimModel/${c.id}`).catch(() => {});
    await request.delete(`/api/entities/BuildingComplex/${bc}`).catch(() => {});
    await request.delete(`/api/entities/Project/${id}`).catch(() => {});
  }
});
