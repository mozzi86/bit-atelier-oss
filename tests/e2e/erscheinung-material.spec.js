// Click path for catalogue appearance: wall surface, frame, glass, two floor finishes.
// Own synthetic project. Assignments go through the inspector, then undo, redo and reload.
import { test, expect } from "@playwright/test";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Erscheinung Material";

/** Sets a native select the way the inspector's onChange reads it. */
async function waehle(page, testid, wert) {
  const feld = page.getByTestId(testid);
  await feld.evaluate((el, v) => {
    const setzen = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setzen.call(el, v);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, wert);
}

test.describe("Erscheinung aus dem Katalog", () => {
  test.setTimeout(180000);

  test("Wand, Rahmen, Glas und zwei Beläge: setzen, zurück, wiederholen, neu laden", async ({ page, request }) => {
    await nurLocalhost(page);
    for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) {
      await request.delete(`/api/entities/Project/${alt.id}`);
    }
    const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    await request.post("/api/entities/BimModel", { data: {
      project_id: id,
      customWalls: [{ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.24, height: 2.8, oberkante_bezug: "absolut", _idx: 1 }],
      customWindows: [{ wallIdx: 1, u: 3, kind: "window", typeId: "single", _idx: 2 }],
      customZones: [
        { points: [{ x: 0, z: 1 }, { x: 3, z: 1 }, { x: 3, z: 4 }, { x: 0, z: 4 }], level: 0, name: "Wohnen", _idx: 3 },
        { points: [{ x: 3.2, z: 1 }, { x: 6, z: 1 }, { x: 6, z: 4 }, { x: 3.2, z: 4 }], level: 0, name: "Bad", _idx: 4 },
      ],
    } });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const wand = page.locator("[data-bim-plan2d] [data-wand='1']");
    await expect(wand).toBeVisible({ timeout: 60000 });
    await wand.scrollIntoViewIfNeeded();
    const wandPunkt = await wand.evaluate((el) => {
      const linie = el.querySelector("line, path") || el;
      const r = linie.getBoundingClientRect();
      // Left of the window symbol, which sits on the middle of the wall.
      return { x: r.left + Math.min(18, r.width * 0.12), y: r.top + r.height / 2 };
    });
    await page.mouse.click(wandPunkt.x, wandPunkt.y);
    await waehle(page, "wand-erscheinung", "kalkzementputz-370");
    await expect(wand).toHaveAttribute("data-erscheinung", "kalkzementputz-370");
    await page.getByTestId("bim-undo").click({ force: true });
    await expect(wand).not.toHaveAttribute("data-erscheinung", "kalkzementputz-370");
    await expect(page.getByTestId("bim-redo")).toHaveAttribute("data-future", "1");
    await page.getByTestId("bim-undo").focus();
    await page.keyboard.press("Control+y");
    await expect(wand).toHaveAttribute("data-erscheinung", "kalkzementputz-370");

    const fenster = page.locator("[data-bim-plan2d] [data-oeffnung='2']");
    await fenster.click({ force: true, position: { x: 4, y: 4 } });
    await waehle(page, "oeffnung-rahmen", "aluminium-760");
    await waehle(page, "oeffnung-glas", "normalglas-530");
    await expect(fenster).toHaveAttribute("data-rahmen", "aluminium-760");
    await expect(fenster).toHaveAttribute("data-glas", "normalglas-530");
    await page.getByTestId("bim-undo").click({ force: true });
    await expect(fenster).not.toHaveAttribute("data-glas", "normalglas-530");
    await page.getByTestId("bim-undo").focus();
    await page.keyboard.press("Control+y");
    await expect(fenster).toHaveAttribute("data-glas", "normalglas-530");

    const wohnen = page.locator("[data-bim-plan2d] [data-zone='3']");
    const bad = page.locator("[data-bim-plan2d] [data-zone='4']");
    await wohnen.click({ force: true });
    await waehle(page, "zone-belag", "estrich-parkett-15-cm");
    await bad.click({ force: true });
    await waehle(page, "zone-belag", "estrich-fliesen-15-cm");
    await expect(wohnen).toHaveAttribute("data-belag", "estrich-parkett-15-cm");
    await expect(bad).toHaveAttribute("data-belag", "estrich-fliesen-15-cm");

    await expect.poll(async () => {
      const zeilen = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      const badZeile = (zeilen[0]?.customZones || []).find((z) => z._idx === 4);
      return badZeile?.belag || "";
    }, { timeout: 15000 }).toBe("estrich-fliesen-15-cm");
    await page.reload();
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await expect(page.locator("[data-bim-plan2d] [data-wand='1']")).toHaveAttribute("data-erscheinung", "kalkzementputz-370");
    await expect(page.locator("[data-bim-plan2d] [data-oeffnung='2']")).toHaveAttribute("data-rahmen", "aluminium-760");
    await expect(page.locator("[data-bim-plan2d] [data-oeffnung='2']")).toHaveAttribute("data-glas", "normalglas-530");
    await expect(page.locator("[data-bim-plan2d] [data-zone='3']")).toHaveAttribute("data-belag", "estrich-parkett-15-cm");
    await expect(page.locator("[data-bim-plan2d] [data-zone='4']")).toHaveAttribute("data-belag", "estrich-fliesen-15-cm");

    await page.locator("[data-bim-plan2d] [data-huellwand]").first().dispatchEvent("click");
    await expect(page.getByTestId("huelle-erscheinung")).toBeAttached({ timeout: 10000 });
    await waehle(page, "huelle-erscheinung", "vormauerziegel-540");
    await page.getByRole("button", { name: "Ansicht 3D" }).click();
    await page.getByRole("button", { name: "Render-Modus umschalten" }).click();
    await expect(page.getByTestId("render-oberflaeche")).toBeVisible();
  });
});
