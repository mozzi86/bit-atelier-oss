// Headless proof 261111-zs1 "Zeigen und Sagen" for creating: in the BIM studio's plan two numbered points are set with the tool
// "Punkte", the sentence „neue Trockenbauwand 12,5“ is typed into the speech field, the proposal appears (card with the sentence in
// words + dashed ghost in the plan), "Übernehmen" creates a real drawn wall (status Neubau, 12.5 cm) in the model state, and the drawing
// undo (button "Rückgängig", Strg+Z path) removes it again.
// Own project (not the shared test house) with an empty element model; deleted again in `finally`.
import { test, expect } from "@playwright/test";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Zeigen Sagen zs1";

/** @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (/WebGL|GPU stall|wasm|8765|ERR_|net::|Failed to fetch|tiles\.|openfreemap|elevation-tiles|AbortError/i.test(text)) return;
    warnungen.push(text);
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** The element arrays as the studio holds them right now (106-03 test hook). @param {import("@playwright/test").Page} page */
const modellStand = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());

test.describe("261111-zs1 Zeigen und Sagen: Wand an zwei Punkten anlegen", () => {
  test.setTimeout(180000);

  test("zwei Punkte, „neue Trockenbauwand 12,5“, Vorschlag, Übernehmen, Wand im Modell, Rückgängig", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [] } });

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await expect(page.getByTestId("bim-speicher")).not.toHaveAttribute("data-zustand", "loading", { timeout: 60000 });
      await page.getByTestId("bim-ansicht-grundriss").click();
      await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "0");
      const undoVorher = Number(await page.getByTestId("bim-undo").getAttribute("data-past"));

      // --- two numbered points with the tool "Punkte" ---
      await page.getByTestId("bim-werkzeug-punkte").click();
      const plan = page.getByTestId("bim-plan");
      const box = await plan.boundingBox();
      if (!box) throw new Error("Grundriss nicht sichtbar");
      await plan.click({ position: { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.5) }, force: true });
      await plan.click({ position: { x: Math.round(box.width * 0.6), y: Math.round(box.height * 0.5) }, force: true });
      await expect(page.getByTestId("zeige-punkt")).toHaveCount(2);
      await expect(page.locator('[data-testid="zeige-punkt"][data-nr="2"]')).toBeVisible();
      // the quick button for two points is there (the same command as the sentence)
      await expect(page.getByTestId("zeigen-schnell-wand")).toBeVisible();

      // --- the sentence makes a proposal, nothing is created yet ---
      const eingabe = page.getByTestId("sprech-eingabe");
      await eingabe.fill("neue Trockenbauwand 12,5");
      await eingabe.press("Enter");
      await expect(page.getByTestId("aenderung-satz").first()).toContainText("Neu: Trockenbauwand 12,5 cm", { timeout: 15000 });
      await expect(page.locator('[data-testid="plan-vorschau"] [data-form="gestrichelt"]')).toHaveCount(1);
      expect((await modellStand(page)).customWalls.length).toBe(0);
      await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "0");

      // --- confirm: a real drawn wall in the model state ---
      await page.getByTestId("aenderung-uebernehmen").first().click();
      await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1", { timeout: 15000 });
      const nach = await modellStand(page);
      expect(nach.customWalls.length).toBe(1);
      const w = nach.customWalls[0];
      expect(w.thickness).toBe(0.125);
      expect(w.status).toBe("neubau");
      expect(w.material).toBe("Trockenbau");
      expect(w.geaendert_durch?.herkunft).toBe("text");
      expect(Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)).toBeGreaterThan(0.5);
      await expect(page.locator('[data-testid="plan-vorschau"]')).toHaveCount(0);
      // the creation is one step of the drawing undo
      await expect.poll(async () => Number(await page.getByTestId("bim-undo").getAttribute("data-past"))).toBe(undoVorher + 1);

      // --- undo removes the wall again ---
      await page.getByTestId("bim-undo").click();
      await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "0", { timeout: 15000 });
      expect((await modellStand(page)).customWalls.length).toBe(0);

      // Esc clears the points
      await page.getByTestId("bim-plan").hover();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("zeige-punkt")).toHaveCount(0);
      expect(warnungen, warnungen.join(" | ")).toEqual([]);
    } finally {
      if (id) await request.delete(`/api/entities/Project/${id}`);
    }
  });
});
