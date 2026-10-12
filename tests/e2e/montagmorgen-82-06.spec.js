// Phase 82 (82-06): Monday morning against the Express dev stack. Replaces the
// planned headless proof n-82-06-montagmorgen.mjs (no demo build since 83-02);
// the Express sample is relative to the seeding day, so the spec compares the
// card and the badge with what /Deadlines shows instead of fixed numbers:
//  1. owner on /Dashboard: card "Meine Woche" with due, this week, absences/requests
//     blocks; no kind of absence in the card;
//  2. menu badge = overdue + today on /Deadlines = the card's "Fällig";
//  3. view as employee: badge again equals the page; no accounting, personnel or
//     fee offer in the card;
//  4. English and 375 px dark without horizontal scroll on the overview.
// The sole-owner path (no user records) is proven by meineWoche.test.js (solo).
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

/** @param {import("@playwright/test").Page} page */
function konsoleSammeln(page) {
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  return meldungen;
}

/** Overdue + today as the agenda shows them. @param {import("@playwright/test").Page} page */
async function faelligAufSeite(page) {
  await page.goto("/Deadlines");
  await expect(page.getByTestId("agenda")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Termine werden geladen …")).toHaveCount(0, { timeout: 20000 });
  const n = async (/** @type {string} */ g) => Number(await page.getByTestId(`agenda-gruppe-${g}`).getAttribute("data-anzahl"));
  return (await n("ueberfaellig")) + (await n("heute"));
}

/** Badge number (0 without badge). @param {import("@playwright/test").Page} page */
async function badge(page) {
  const b = page.getByTestId("faellig-badge");
  return (await b.count()) ? Number(await b.first().innerText()) : 0;
}

test("Montagmorgen: Karte Meine Woche, Zähler = Seite, Rollen", async ({ page, request }) => {
  test.setTimeout(180000);
  // The Express sample has no persons: link nu-3 to a sample person with proj-1/proj-2 (undone in finally).
  const PERSON = "e2e-8206-person";
  await request.post("/api/personal/Mitarbeiter", { data: { id: PERSON, vorname: "E2E", nachname: "Beispiel", personalnummer: "E2E-6", art: "angestellt", status: "aktiv", eintritt: "2020-01-01",
    projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Mitarbeit", anteil_prozent: 50, von: null, bis: null }, { project_id: "proj-2", funktion: "Mitarbeit", anteil_prozent: 50, von: null, bis: null }] } });
  await request.put("/api/entities/Nutzer/nu-3", { data: { mitarbeiter_id: PERSON } });
  try {
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);

  await page.goto("/Dashboard");
  const karte = page.getByTestId("meine-woche");
  await expect(karte.getByTestId("mw-faellig")).toBeVisible({ timeout: 20000 });
  await expect(karte.getByTestId("mw-woche")).toBeVisible();
  await expect(karte.getByTestId("mw-abwesend")).toBeVisible();
  await expect(karte.getByTestId("mw-antraege")).toBeVisible();
  await expect(karte).toContainText("keine Mail, kein Push");
  await expect(karte).not.toContainText(/\b(krank|urlaub|fortbildung)\b/i);
  const kartenFaellig = Number(await karte.getByTestId("mw-faellig").locator("p").nth(1).innerText());
  const seite = await faelligAufSeite(page);
  expect(kartenFaellig).toBe(seite);
  await expect.poll(() => badge(page), { timeout: 20000 }).toBe(seite);

  // View as employee.
  await page.getByTestId("ansicht-als").selectOption("nu-3");
  const seiteMa = await faelligAufSeite(page);
  await expect.poll(() => badge(page), { timeout: 20000 }).toBe(seiteMa);
  await page.goto("/Dashboard");
  await expect(karte.getByTestId("mw-faellig")).toBeVisible({ timeout: 20000 });
  await expect(karte).not.toContainText(/HA-20\d\d|Umsatzsteuer|Resturlaub/);
  await page.getByTestId("ansicht-als").selectOption("nu-1");
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    await request.put("/api/entities/Nutzer/nu-3", { data: { mitarbeiter_id: null } });
    await request.delete(`/api/personal/Mitarbeiter/${PERSON}`);
  }
});

test("Englisch, 375 px dunkel: Karte „My week“ ohne horizontales Scrollen", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/Dashboard");
  await expect(page.getByTestId("meine-woche").getByRole("heading", { name: "My week" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("meine-woche")).not.toContainText(/Meine Woche|Diese Woche|Überfällig/);
  const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
  expect(breite.scroll).toBeLessThanOrEqual(breite.sicht + 1);
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});
