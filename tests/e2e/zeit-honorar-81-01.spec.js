// Phase 81 (81-01): the shell of time, fees and controlling against the Express dev
// stack — menu group "Zeit & Honorar" right before "Büro" (E-02), h1 = menu name,
// German route aliases keep ?tab (E-01), tab aliases are normalised without a
// history entry, the rule book "Zeit, Honorar & Controlling" in Einstellungen ›
// Regelwerke (E-16), English menu texts, 375 px without horizontal scroll, console
// clean. Replaces the planned headless proof n-81-01-huelle.mjs (the demo build it
// ran on was removed in 83-02). Touches no data — nothing to clean up.
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

test("Menügruppe „Zeit & Honorar“ vor „Büro“, Seiten mit h1 = Menüname, Routen-Aliase", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);

  await page.goto("/TimeTracking");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  // innerText follows CSS: the group labels are `uppercase` — compare whole lines, case-insensitive.
  const zeilen = (await nav.innerText()).split(/\r?\n/).map((z) => z.trim().toLowerCase());
  const zeit = zeilen.indexOf("zeit & honorar");
  // lastIndexOf: since 72-20 the focus select at the top of the sidebar also offers an option "Büro".
  const buero = zeilen.lastIndexOf("büro");
  expect(zeit, "Gruppe Zeit & Honorar sichtbar").toBeGreaterThan(-1);
  expect(zeit).toBeLessThan(buero);
  for (const titel of ["Zeiterfassung", "Angebot & Auftrag", "Projektcontrolling"]) await expect(nav.getByRole("link", { name: titel })).toBeVisible();

  await expect(page.locator("h1")).toHaveText(/Zeiterfassung/);
  await expect(page.getByText("Projektzeiten und Tagesrahmen — Hinweise ersetzen keine Rechtsprüfung")).toBeVisible();

  // Tab aliases: ?tab=freigabe → ?tab=approval without a new history entry; unknown → week.
  await page.goto("/TimeTracking?tab=freigabe");
  await expect(page).toHaveURL(/\/TimeTracking\?tab=approval$/);
  await page.goto("/TimeTracking?tab=xyz");
  await expect(page).toHaveURL(/\/TimeTracking\?tab=week$/);
  const laengeVorher = await page.evaluate(() => history.length);
  await page.getByRole("tab", { name: "Tagesansicht" }).click();
  await expect(page).toHaveURL(/\?tab=day$/);
  expect(await page.evaluate(() => history.length)).toBe(laengeVorher + 1);

  // German route aliases keep the query (UmleitungMitSuche, E-01).
  await page.goto("/Zeiterfassung?tab=freigabe");
  await expect(page).toHaveURL(/\/TimeTracking\?tab=approval$/);
  await page.goto("/Honorar");
  await expect(page).toHaveURL(/\/Fees$/);
  await expect(page.locator("h1")).toHaveText(/Angebot & Auftrag/);
  await page.goto("/Auftrag?tab=vertraege");
  await expect(page).toHaveURL(/\/Fees\?tab=contracts$/);
  await page.goto("/Projektcontrolling");
  await expect(page).toHaveURL(/\/Controlling$/);
  await expect(page.locator("h1")).toHaveText(/Projektcontrolling/);
  for (const reiter of ["Übersicht", "Projekt", "Monat", "Kostensätze"]) await expect(page.getByRole("tab", { name: reiter })).toBeVisible();

  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});

test("Regelwerke zeigen die Gruppe „Zeit, Honorar & Controlling“ mit den E-16-Werten", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.goto("/Settings?tab=rules");
  const gruppe = page.getByTestId("regelwerk-tabelle-zeit_honorar");
  await expect(gruppe).toBeVisible({ timeout: 20000 });
  await expect(gruppe.locator('tr[data-regel="zeit_honorar.gemeinkosten"]')).toContainText("80");
  await expect(gruppe.locator('tr[data-regel="zeit_honorar.tagessoll"]')).toContainText("480");
  await expect(gruppe.locator('tr[data-regel="zeit_honorar.ag_anteil"]')).toContainText("21");
  await expect(gruppe.locator('tr[data-regel^="zeit_honorar.nebenkosten"]')).toHaveCount(0);
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});

test("Englisch: Menü und h1; 375 px ohne horizontales Scrollen; dunkles Thema", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* storage blocked */ } });
  await page.goto("/Fees");
  const nav = page.getByRole("navigation");
  for (const titel of ["Time & fees", "Time tracking", "Offers & contracts", "Project controlling"]) await expect(nav.getByText(titel, { exact: true }).first()).toBeVisible();
  await expect(page.locator("h1")).toHaveText(/Offers & contracts/);

  await page.addInitScript(() => { try { localStorage.setItem("lang", "de"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  for (const route of ["/TimeTracking", "/Fees", "/Controlling"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
    expect(breite.scroll, `${route}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
  }
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});
