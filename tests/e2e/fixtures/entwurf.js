// 115-05c (D-115-12): changes to the building model and to site / location are a draft until "Speichern". Specs that used to wait
// for the autosave press "Speichern" with this helper (115-05-PLAN §6.9) and wait until the save is over.
//
// In: a page with the Komplex-Designer open. Out: the final save state ("gespeichert", "teilweise", "konflikt", "fehler").
import { expect } from "@playwright/test";

/**
 * Presses "Speichern" in the draft bar and waits until the save is over.
 * @param {import("@playwright/test").Page} page
 * @param {{timeout?: number}} [o] timeout in milliseconds
 * @returns {Promise<string|null>} the final data-zustand of the bar
 */
export async function speichernUndWarten(page, { timeout = 30000 } = {}) {
  const knopf = page.getByTestId("entwurf-speichern");
  await expect(knopf).toBeEnabled({ timeout });
  // the press must not move the page under the test: the scroll position and the focus (a plan, the modeller) come back after it -
  // a person pressing "Speichern" at the top and going back to the plan does the same with the mouse
  const vorher = await page.evaluateHandle(() => ({ el: document.activeElement, x: window.scrollX, y: window.scrollY,
    // every scrollable box (the work surface of a drawing tab scrolls inside, not the window)
    boxen: [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)
      .map((e) => [e, e.scrollTop, e.scrollLeft]) }));
  await knopf.click();
  const status = page.getByTestId("entwurf-status");
  await expect(status).not.toHaveAttribute("data-zustand", "speichert", { timeout });
  await expect(status).toHaveAttribute("data-zustand", /gespeichert|teilweise|konflikt|fehler/, { timeout });
  await page.evaluate((z) => {
    window.scrollTo(z.x, z.y);
    for (const [e, top, left] of /** @type {any[]} */ (z.boxen)) if (document.contains(e)) { e.scrollTop = top; e.scrollLeft = left; }
    const el = /** @type {any} */ (z.el);
    if (el && el !== document.body && document.contains(el) && typeof el.focus === "function") el.focus({ preventScroll: true });
  }, vorher).catch(() => { /* the element is gone (the page changed): nothing to restore */ });
  return status.getAttribute("data-zustand");
}
