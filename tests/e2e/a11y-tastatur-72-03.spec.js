// Keyboard-only run through the core path (Plan 72-03, task 5).
//
// Project → Designer → check suite with the keyboard alone: Tab / Shift+Tab to move,
// Enter / Space / arrow keys to act, Ctrl+K for the command palette, Escape to leave.
// No mouse click anywhere. At every station the test asserts that the focused element
// shows a visible focus indicator (outline or ring/box-shadow on the element or on a
// focus-within container) and that one can go on and come back.
//
// Run: PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/a11y-tastatur-72-03.spec.js --reporter=line

import { test, expect } from "@playwright/test";

const NAME = `Tastaturlauf 72-03 ${Date.now().toString(36)}`;

/**
 * Presses Tab (or Shift+Tab) until `ziel` holds the focus.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} ziel
 * @param {{ max?: number, rueckwaerts?: boolean }} [opt]
 */
async function tabBis(page, ziel, { max = 120, rueckwaerts = false } = {}) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(rueckwaerts ? "Shift+Tab" : "Tab");
    if (await ziel.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false)) return i + 1;
  }
  throw new Error(`Fokus nach ${max} Tab-Schritten nicht erreicht: ${ziel}`);
}

/**
 * True when the focused element (or a focus-within container up to two levels above)
 * draws a visible indicator: a non-zero outline or a box-shadow ring.
 * @param {import("@playwright/test").Page} page
 */
async function fokusSichtbar(page) {
  return page.evaluate(() => {
    /** @param {Element|null} el */
    const sichtbar = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      return outline || (s.boxShadow && s.boxShadow !== "none");
    };
    const el = document.activeElement;
    return sichtbar(el) || sichtbar(el?.parentElement ?? null) || sichtbar(el?.parentElement?.parentElement ?? null);
  });
}

/** Opens the command palette with Ctrl+K and goes to the entry `titel`. */
async function palette(page, titel) {
  await page.keyboard.press("Control+k");
  const eingabe = page.getByTestId("befehlspalette").locator("input");
  await expect(eingabe.first()).toBeFocused();
  expect(await fokusSichtbar(page), "Befehlspalette: Fokus sichtbar").toBe(true);
  await page.keyboard.type(titel);
  await page.keyboard.press("Enter");
}

test.describe("72-03 Kernpfad nur mit der Tastatur", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.describe.configure({ timeout: 240000 });

  // The project this test creates is removed again — the E2E database is shared.
  test.afterAll(async ({ request }) => {
    const liste = await (await request.get("/api/entities/Project")).json().catch(() => []);
    for (const p of Array.isArray(liste) ? liste : []) {
      if (p.name === NAME) await request.delete(`/api/entities/Project/${p.id}`);
    }
  });

  test("Projekt anlegen → Designer → Prüf-Suite, ohne Mausklick", async ({ page }) => {
    const fehler = [];
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) fehler.push(String(e)); });
    page.on("console", (m) => { if (m.type() === "error" && !/WebGL|THREE|favicon|net::ERR/i.test(m.text())) fehler.push(m.text()); });

    // --- Station 1: create a project --------------------------------------------------
    await page.goto("/Projects");
    const neu = page.getByRole("button", { name: "Neues Projekt" }).first();
    // This file sorts first in a full run: the page chunk is still being transformed by the cold Vite
    // dev server (spinner after 5 s in the run of 22.10.2026), so the first view gets the cold-start time.
    await expect(neu).toBeVisible({ timeout: 60000 });
    await tabBis(page, neu);
    expect(await fokusSichtbar(page), "„Neues Projekt“: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");

    const name = page.locator("#name");
    await expect(name).toBeVisible();
    await tabBis(page, name);
    expect(await fokusSichtbar(page), "Projektname: Fokus sichtbar").toBe(true);
    await page.keyboard.type(NAME);

    // Select fields are opened with the keyboard: Enter opens, arrows move, Enter picks.
    const typ = page.getByRole("combobox", { name: "Projekttyp" });
    await tabBis(page, typ);
    expect(await fokusSichtbar(page), "Projekttyp: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(typ).toBeFocused(); // focus returns to the field after picking

    const ort = page.locator("#location");
    await tabBis(page, ort);
    await page.keyboard.type("Musterstadt");

    const vorhaben = page.getByRole("combobox", { name: "Vorhabentyp" });
    if (await vorhaben.count()) {
      const wert = (await vorhaben.innerText()).trim();
      if (!wert) {
        await tabBis(page, vorhaben);
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
      }
    }

    const speichern = page.locator('form button[type="submit"]').first();
    await tabBis(page, speichern);
    expect(await fokusSichtbar(page), "Speichern: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 15000 });

    // --- Station 2: designer, switch area and tab --------------------------------------
    await palette(page, "Komplex-Designer");
    await expect(page).toHaveURL(/ComplexDesigner/);
    const bereiche = page.getByRole("group", { name: "Arbeitsbereiche" });
    await expect(bereiche).toBeVisible({ timeout: 30000 });
    const zweiter = bereiche.getByRole("button").nth(1);
    await tabBis(page, zweiter, { max: 200 });
    expect(await fokusSichtbar(page), "Bereichsknopf: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");
    await expect(zweiter).toHaveAttribute("aria-current", "true");

    const reiter = page.getByRole("tablist").first().getByRole("tab");
    await tabBis(page, reiter.first());
    expect(await fokusSichtbar(page), "Reiter: Fokus sichtbar").toBe(true);
    if ((await reiter.count()) > 1) {
      await page.keyboard.press("ArrowRight");
      await expect(reiter.nth(1)).toBeFocused();
      await expect(reiter.nth(1)).toHaveAttribute("aria-selected", "true");
    }
    // Back: Shift+Tab returns to the area buttons.
    await tabBis(page, zweiter, { rueckwaerts: true, max: 20 });

    // --- Station 3: check suite, load the sample project, start the check ---------------
    await palette(page, "Prüf-Suite");
    await expect(page).toHaveURL(/ModelCheck/);
    const muster = page.getByTestId("beispiel-laden");
    await expect(muster).toBeVisible({ timeout: 30000 });
    await tabBis(page, muster, { max: 200 });
    expect(await fokusSichtbar(page), "Musterprojekt laden: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");
    const start = page.getByRole("button", { name: "Prüfung starten" });
    await expect(start).toBeEnabled({ timeout: 120000 });
    await tabBis(page, start, { max: 200, rueckwaerts: true });
    expect(await fokusSichtbar(page), "Prüfung starten: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Kollisions-Befunde \(\d+\)/).first()).toBeVisible({ timeout: 150000 });

    // Back to the designer with the keyboard. Alt+Left is a browser-UI shortcut that a
    // headless page never receives, so the way back is the command palette.
    await palette(page, "Komplex-Designer");
    await expect(page).toHaveURL(/ComplexDesigner/);
    await expect(page.getByRole("group", { name: "Arbeitsbereiche" })).toBeVisible({ timeout: 30000 });

    expect(fehler).toEqual([]);
  });

  test("KI-Dashboard: Agenten-Dialog hält den Fokus, Escape schließt, Fokus kehrt zurück", async ({ page }) => {
    await page.goto("/AIDashboard?tab=agents");
    const karte = page.getByTestId("agent-karte-architect_advisor");
    await expect(karte).toBeVisible({ timeout: 30000 });
    await tabBis(page, karte, { max: 200 });
    expect(await fokusSichtbar(page), "Agenten-Karte: Fokus sichtbar").toBe(true);
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Architektur-Berater" });
    await expect(dialog).toBeVisible();
    // Focus trap: twenty Tabs never leave the dialog.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(karte).toBeFocused();
  });
});
