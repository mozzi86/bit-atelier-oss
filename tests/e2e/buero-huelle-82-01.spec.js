// Phase 82 (82-01): the shell of deadlines, absences and correspondence against
// the Express dev stack — "Fristen & Termine" in "Übersicht", "Büro" = Buchhaltung
// · Personal · Abwesenheiten · Adressbuch · Schriftverkehr · Einstellungen (E-02),
// h1 = menu name, German route aliases keep ?tab (E-01), unknown ?tab falls back,
// three "Weiter mit" steps on /Deadlines, the area "Nutzer & Rechte" (visible since 82-02),
// the honesty sentence about reminders, English menu text, nowhere
// "Kein Zugriff" without a provider, 375 px without horizontal scroll, console clean.
// Replaces the planned headless proof n-82-01-huelle.mjs (no demo build since 83-02).
// Touches no data.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

/**
 * Collects console errors/warnings and page errors (offline noise excluded).
 * @param {import("@playwright/test").Page} page
 * @returns {string[]}
 */
function konsoleSammeln(page) {
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  return meldungen;
}

test("Menü, h1, Routen-Aliase, Reiter, Weiter mit, Einstellungen mit „Nutzer & Rechte“ (seit 82-02)", async ({ page }) => {
  test.setTimeout(150000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);

  await page.goto("/Deadlines");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const zeilen = (await nav.innerText()).split(/\r?\n/).map((z) => z.trim().toLowerCase()).filter(Boolean);
  const pos = (titel) => zeilen.indexOf(titel.toLowerCase());
  // "Büro" group in this order (group labels are CSS-uppercased; compare case-insensitively).
  // Since 1.4.0 "Schriftverkehr" sits in "Zeit & Schriftverkehr" (navigation by workflow stations).
  const buero = ["Buchhaltung", "Personal", "Abwesenheiten", "Adressbuch", "Einstellungen"].map(pos).filter((i) => i >= 0);
  assert82(buero.length >= 5, "Büro-Einträge sichtbar");
  for (let i = 1; i < buero.length; i++) assert82(buero[i] > buero[i - 1], "Reihenfolge in „Büro“");
  // Since 1.4.0: "Übersicht" = Projektübersicht, Projekte, Fristen & Termine; next group "Akquise & Auftrag".
  assert82(pos("Fristen & Termine") > pos("Projekte") && pos("Fristen & Termine") < pos("Akquise & Auftrag"), "„Fristen & Termine“ in „Übersicht“");

  await expect(page.locator("h1")).toHaveText(/Fristen & Termine/);
  await expect(page.getByTestId("fristen-ehrlichkeit")).toContainText("Erinnerungen erscheinen nur bei geöffneter App");
  const weiter = page.getByRole("navigation", { name: "Weiter mit" });
  await expect(weiter.getByRole("link")).toHaveCount(3);

  await page.goto("/Absences");
  await expect(page.locator("h1")).toHaveText(/Abwesenheiten/);
  await page.goto("/Correspondence");
  await expect(page.locator("h1")).toHaveText(/Schriftverkehr/);

  // Tab aliases and German routes keep the query. 15 s: under full-suite load the dev server compiles the
  // lazy page chunk first; the alias rewrite itself runs in the first effect (useTabParam).
  await page.goto("/Correspondence?tab=postbuch");
  await expect(page).toHaveURL(/\/Correspondence\?tab=register$/, { timeout: 15000 });
  await expect(page.getByRole("tab", { name: "Postbuch" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/Schriftverkehr?tab=postbuch");
  await expect(page).toHaveURL(/\/Correspondence\?tab=register$/, { timeout: 15000 });
  await page.goto("/Fristen");
  await expect(page).toHaveURL(/\/Deadlines$/);
  await page.goto("/Abwesenheiten?tab=konto");
  await expect(page).toHaveURL(/\/Absences\?tab=balance$/);
  await page.goto("/Deadlines?tab=xyz");
  await expect(page).toHaveURL(/\/Deadlines(\?tab=agenda)?$/);
  await expect(page.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true");

  // "Nutzer & Rechte" is built since 82-02 and visible for the owner.
  await page.goto("/Settings?tab=access");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Nutzer & Rechte" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/tab=access/);
  await expect(page.getByTestId("kein-zugriff")).toHaveCount(0);

  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});

test("Englisch: Menüeintrag; 375 px dunkel ohne horizontales Scrollen", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* storage blocked */ } });
  await page.goto("/Deadlines");
  const nav = page.getByRole("navigation");
  for (const titel of ["Deadlines & appointments", "Absences", "Correspondence"]) await expect(nav.getByText(titel, { exact: true }).first()).toBeVisible();
  await expect(page.locator("h1")).toHaveText(/Deadlines & appointments/);

  await page.addInitScript(() => { try { localStorage.setItem("lang", "de"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  for (const route of ["/Deadlines", "/Absences", "/Correspondence"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
    expect(breite.scroll, `${route}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
  }
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});

/**
 * Plain assertion with a message (keeps the menu checks readable).
 * @param {boolean} bedingung
 * @param {string} meldung
 */
function assert82(bedingung, meldung) {
  expect(bedingung, meldung).toBe(true);
}
