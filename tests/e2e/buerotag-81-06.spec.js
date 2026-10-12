// Phase 81 (81-06): the office-day walkthrough against the Express dev stack —
// replaces the planned headless proof n-81-06-buerotag.mjs (no demo build since
// 83-02). The steps "hours → controlling" and "offer → contract → instalment →
// rest" are proven by controlling-81-05.spec.js and architektenvertrag-81-04.spec.js
// on the test house; this spec adds what 81-06 built:
//  - deletion guard: a project with a time booking is not deleted, the dialog
//    names the reason and count and offers only "Archivieren"; cancelling keeps
//    the project; archiving hides it from the project picker and lists it under
//    "Archiviert"; "Wiederherstellen" brings it back; a project without office
//    records still reaches the old delete question;
//  - German route aliases /Zeiterfassung, /Honorar, /Projektcontrolling (E-01);
//  - English: no German text of the 81 part files on the three pages;
//  - 375 px without horizontal scrolling in the dark theme, console clean.
// The export dialog row "Zeiten & Aufträge" lives in the dialog of SERVERLOS
// builds only (Settings › Daten shows it for datenquelle 'serverlos'); it is
// proven by tests/unit/weitergabe81.test.js against the real registry and
// project-file functions.
// Own records only (two projects with a placeholder name, one booking), deleted in
// `finally` and — after a crashed run — at the start.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME_GESPERRT = "E2E Bürotag 81-06 gesperrt";
const NAME_FREI = "E2E Bürotag 81-06 frei";

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

/**
 * Deletes the spec's own projects and their bookings (also leftovers of a crashed run).
 * @param {import("@playwright/test").APIRequestContext} request
 */
async function aufraeumen(request) {
  for (const name of [NAME_GESPERRT, NAME_FREI]) {
    const projekte = await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json();
    for (const p of Array.isArray(projekte) ? projekte : []) {
      const buchungen = await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(p.id)}`)).json();
      for (const b of Array.isArray(buchungen) ? buchungen : []) await request.delete(`${API}/Zeitbuchung/${b.id}`);
      await request.delete(`${API}/Project/${p.id}`);
    }
  }
}

test("Löschschutz mit Archiv: Gründe, nur „Archivieren“, Projektwahl ohne Archiv, Wiederherstellen; ohne Büro-Daten alte Rückfrage", async ({ page, request }) => {
  test.setTimeout(180000);
  await aufraeumen(request);
  try {
    await nurLocalhost(page);
    const konsole = konsoleSammeln(page);
    const gesperrt = await (await request.post(`${API}/Project`, { data: { name: NAME_GESPERRT, status: "planning" } })).json();
    const frei = await (await request.post(`${API}/Project`, { data: { name: NAME_FREI, status: "planning" } })).json();
    await request.post(`${API}/Zeitbuchung`, { data: { mitarbeiter_id: "inhaber", project_id: gesperrt.id, lph: null, leistung: "akquise", datum: "2026-09-21", monat: "2026-09", kw: "2026-W39", minuten: 60, status: "freigegeben", quelle: "manuell", notiz: "e2e-81-06" } });

    await page.goto("/Projects");
    const suche = page.getByRole("textbox", { name: "Projekte suchen" });
    await suche.fill("E2E Bürotag 81-06");
    const loeschen = page.getByRole("button", { name: `Löschen: ${NAME_GESPERRT}` });
    await expect(loeschen).toBeVisible({ timeout: 20000 });

    // Locked: reasons with counts, no delete button; cancel keeps the project.
    await loeschen.click();
    const dialog = page.getByTestId("bestaetigung-dialog");
    await expect(dialog).toContainText("kann nicht gelöscht werden");
    await expect(dialog).toContainText("Zeitbuchungen: 1");
    await expect(dialog).toContainText("aufbewahrungspflichtig");
    await expect(dialog.getByTestId("bestaetigung-ok")).toHaveText("Archivieren");
    await dialog.getByTestId("bestaetigung-abbrechen").click();
    await expect(dialog).toHaveCount(0);
    expect((await (await request.get(`${API}/Project/${gesperrt.id}`)).json())?.id).toBe(gesperrt.id);

    // Archive: field set, gone from the grid and the project picker, listed under "Archiviert".
    await loeschen.click();
    await page.getByTestId("bestaetigung-dialog").getByTestId("bestaetigung-ok").click();
    await expect.poll(async () => (await (await request.get(`${API}/Project/${gesperrt.id}`)).json())?.archiviert_am, { timeout: 15000 }).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("button", { name: `Löschen: ${NAME_GESPERRT}` })).toHaveCount(0);
    const archiv = page.getByTestId("projekte-archiviert");
    await expect(archiv).toBeVisible();
    await archiv.locator("summary").click();
    await expect(archiv).toContainText(NAME_GESPERRT);
    await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
    await expect(page.getByRole("option", { name: NAME_FREI })).toBeVisible();
    await expect(page.getByRole("option", { name: NAME_GESPERRT })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Restore.
    await archiv.locator("li", { hasText: NAME_GESPERRT }).getByRole("button", { name: "Wiederherstellen" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Project/${gesperrt.id}`)).json())?.archiviert_am ?? null, { timeout: 15000 }).toBeNull();
    await expect(page.getByRole("button", { name: `Löschen: ${NAME_GESPERRT}` })).toBeVisible();

    // Without office records the old question comes (dismissed here — only checked).
    let frage = "";
    page.once("dialog", async (d) => { frage = d.message(); await d.dismiss(); });
    await page.getByRole("button", { name: `Löschen: ${NAME_FREI}` }).click();
    await expect.poll(() => frage).toContain("wirklich löschen");
    expect((await (await request.get(`${API}/Project/${frei.id}`)).json())?.id).toBe(frei.id);
    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen(request);
  }
});

test("Routen-Aliase, Englisch ohne deutsche 81-Texte, 375 px dunkel ohne horizontales Scrollen", async ({ page }) => {
  test.setTimeout(150000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  for (const [alias, ziel] of [["/Zeiterfassung", "/TimeTracking"], ["/Honorar", "/Fees"], ["/Projektcontrolling", "/Controlling"]]) {
    await page.goto(alias);
    await expect(page).toHaveURL(new RegExp(`${ziel}(\\?|$)`));
  }

  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* storage blocked */ } });
  const DEUTSCH = ["Zeiterfassung", "Angebot & Auftrag", "Projektcontrolling", "Honorar gegen Aufwand", "nur freigegebene Buchungen", "Kosten bisher", "Woche einreichen", "Honorarangebote"];
  for (const route of ["/TimeTracking", "/Fees", "/Controlling"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    const text = await page.locator("main").innerText();
    for (const de of DEUTSCH) expect(text, `${route}: deutscher Rest „${de}“`).not.toContain(de);
  }

  await page.addInitScript(() => { try { localStorage.setItem("lang", "de"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  for (const route of ["/TimeTracking", "/Fees", "/Controlling", "/Projects"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible({ timeout: 20000 });
    const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
    expect(breite.scroll, `${route}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
  }
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});
