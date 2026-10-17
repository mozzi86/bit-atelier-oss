// Headless-Nachweis 95-03: im Massing-Studio lässt sich unter 100 % herauszoomen (über das Grundstück
// hinaus); Leertaste halten + Ziehen verschiebt den Plan — auch während das Linien-Werkzeug läuft,
// ohne Werkzeug oder angefangene Linie zu verlieren; kurz Leertaste = Auswahl-Werkzeug.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

test("95-03 Zoom unter 100 %, Leertaste + Ziehen verschiebt", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
  await page.goto(`/ComplexDesigner?projekt=Review%20Testhaus&tab=studio`);
  const zoom = page.getByTitle("Zoom-Stufe");
  await expect(zoom).toHaveText("100%", { timeout: 60000 });
  const plan = page.locator("svg").filter({ has: page.getByTestId("mm-ebene") }).first();
  await plan.scrollIntoViewIfNeeded();
  const b = /** @type {any} */ (await plan.boundingBox());
  const mitte = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(mitte.x, mitte.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 120);
  await expect.poll(async () => Number((await zoom.innerText()).replace("%", ""))).toBeLessThan(100);

  // Line tool active with one point; space + drag pans, tool and draft survive.
  await page.getByTestId("mm-linie").click();
  await plan.scrollIntoViewIfNeeded();
  const b2 = /** @type {any} */ (await plan.boundingBox());
  await page.mouse.click(b2.x + b2.width * 0.4, b2.y + b2.height * 0.5);
  await expect(page.getByTestId("mm-entwurf")).toHaveCount(1);
  const vorher = await plan.getAttribute("viewBox");
  await page.mouse.move(b2.x + b2.width * 0.5, b2.y + b2.height * 0.5);
  await page.keyboard.down(" ");
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width * 0.5 + 80, b2.y + b2.height * 0.5 + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  await expect.poll(async () => plan.getAttribute("viewBox")).not.toBe(vorher);
  await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "linie");
  await expect(page.getByTestId("mm-entwurf")).toHaveCount(1);

  // A short space press (no drag) selects the selection tool, like SketchUp.
  await page.keyboard.press(" ");
  await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "auswahl");
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
});
