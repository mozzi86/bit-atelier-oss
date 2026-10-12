// Phase 82 (82-03): deadlines and appointments against the Express dev stack.
// Replaces the planned headless proof n-82-03-termine.mjs (no demo build since
// 83-02). The Express sample is relative to the seeding day, the reference-day
// numbers are proven by unit tests (termineAnsicht/seedBuero82); this spec uses
// its own records relative to today on a placeholder project:
//  - an overdue deadline stands under "Überfällig", a past appointment is gone,
//    a deadline in two days is listed; "Erledigt" persists over a reload
//    (one Terminquittung with the stable id);
//  - "Abnahme erfassen": saving needs the rule set (no default); VOB/B, system
//    requiring maintenance without contract → end = acceptance + 2 years;
//    "Öffnen" at the warranty end lands on ?tab=warranty;
//  - .ics export: VEVENTs, no line over 75 octets, no absence;
//  - month view: the holidays of the shown month are hatched;
//  - English heading, 375 px dark without horizontal scroll, console clean.
// Own records are deleted in `finally` and — after a crashed run — at the start.
import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { feiertage, KALENDER_STANDARD } from "../../packages/nova-core/src/lib/kalender/feiertage.js";

const API = "/api/entities";
const PROJEKT = "E2E Fristen 82-03";

/** @returns {string} today 'YYYY-MM-DD' (local calendar day like the app) */
function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** @param {string} tag @param {number} n @returns {string} */
function plus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

/** Deletes the spec's project and everything that hangs on it. @param {import("@playwright/test").APIRequestContext} request */
async function aufraeumen(request) {
  const projekte = await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT)}`)).json();
  for (const p of Array.isArray(projekte) ? projekte : []) {
    for (const e of ["Termin", "Abnahme"]) {
      const liste = await (await request.get(`${API}/${e}?project_id=${encodeURIComponent(p.id)}`)).json();
      for (const x of Array.isArray(liste) ? liste : []) await request.delete(`${API}/${e}/${x.id}`);
    }
    await request.delete(`${API}/Project/${p.id}`);
  }
  const quittungen = await (await request.get(`${API}/Terminquittung`)).json();
  for (const q of Array.isArray(quittungen) ? quittungen : []) if (String(q.termin_id).includes("e2e-82-03")) await request.delete(`${API}/Terminquittung/${q.id}`);
}

test("Agenda, Erledigt dauerhaft, Abnahme mit Pflichtregel, Gewährleistung, .ics, Monat", async ({ page, request }) => {
  test.setTimeout(180000);
  await aufraeumen(request);
  const tag = heute();
  try {
    await nurLocalhost(page);
    const konsole = konsoleSammeln(page);
    const projekt = await (await request.post(`${API}/Project`, { data: { name: PROJEKT, status: "planning" } })).json();
    await request.post(`${API}/Termin`, { data: { id: "e2e-82-03-alt", titel: "E2E alte Frist", art: "frist", datum: plus(tag, -10), project_id: projekt.id } });
    await request.post(`${API}/Termin`, { data: { id: "e2e-82-03-vorbei", titel: "E2E vergangener Termin", art: "termin", datum: plus(tag, -3), project_id: projekt.id } });
    await request.post(`${API}/Termin`, { data: { id: "e2e-82-03-bald", titel: "E2E baldige Frist", art: "frist", datum: plus(tag, 2), project_id: projekt.id } });

    await page.goto("/Deadlines");
    const agenda = page.getByTestId("agenda");
    await expect(agenda).toBeVisible({ timeout: 20000 });
    const ueberfaellig = page.getByTestId("agenda-gruppe-ueberfaellig");
    await expect(ueberfaellig.locator('[data-termin^="manuell:e2e-82-03-alt"]')).toHaveCount(1);
    await expect(agenda.locator('[data-termin^="manuell:e2e-82-03-vorbei"]')).toHaveCount(0);
    await expect(agenda.locator('[data-termin^="manuell:e2e-82-03-bald"]')).toHaveCount(1);

    // "Erledigt" → one acknowledgement with the stable id, still done after a reload.
    await ueberfaellig.locator('[data-termin^="manuell:e2e-82-03-alt"]').getByRole("button", { name: /^Erledigt/ }).click();
    await expect(ueberfaellig.locator('[data-termin^="manuell:e2e-82-03-alt"]')).toHaveCount(0, { timeout: 15000 });
    const quittungen = (await (await request.get(`${API}/Terminquittung`)).json()).filter((q) => q.termin_id === `manuell:e2e-82-03-alt:${plus(tag, -10)}`);
    expect(quittungen.length).toBe(1);
    await page.reload();
    // The agenda frame shows before the sources have loaded: wait for a record.
    await expect(page.getByTestId("agenda").locator('[data-termin^="manuell:e2e-82-03-bald"]')).toHaveCount(1, { timeout: 20000 });
    await expect(page.getByTestId("agenda-gruppe-ueberfaellig").locator('[data-termin^="manuell:e2e-82-03-alt"]')).toHaveCount(0);

    // .ics: VEVENTs, every line ≤ 75 octets, no absence.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ics-export").click()]);
    const ics = fs.readFileSync(/** @type {string} */ (await download.path()), "utf8");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBeGreaterThan(0);
    for (const z of ics.split("\r\n")) expect(Buffer.byteLength(z, "utf8"), z).toBeLessThanOrEqual(75);
    expect(ics).toMatch(/UID:manuell:e2e-82-03-bald:/);
    expect(ics).not.toMatch(/UID:abwesenheit:/);

    // Acceptance: the rule set is mandatory; VOB/B, system without maintenance contract → +2 years.
    await page.getByRole("tab", { name: "Gewährleistung" }).click();
    await page.getByTestId("abnahme-erfassen").click();
    const dialog = page.getByTestId("abnahme-dialog");
    await dialog.getByTestId("abnahme-projekt").selectOption({ label: PROJEKT });
    await dialog.getByTestId("abnahme-gewerk").fill("Aufzug");
    // Acceptance two years before "in three days": the end falls into the agenda window.
    const ende = plus(tag, 3);
    const abnahmeTag = `${Number(ende.slice(0, 4)) - 2}${ende.slice(4)}`;
    await dialog.getByTestId("abnahme-datum").fill(abnahmeTag);
    await dialog.getByTestId("abnahme-kategorie").selectOption("wartungsanlage");
    await expect(dialog.getByTestId("abnahme-speichern")).toBeDisabled();
    await dialog.locator('[data-regel="vob"]').check();
    await expect(dialog.getByTestId("abnahme-vorschau")).toContainText(ende);
    await dialog.getByTestId("abnahme-speichern").click();
    const zeile = page.locator('[data-testid="gewaehrleistung-zeile"]', { hasText: "Aufzug" });
    await expect(zeile.getByTestId("gewaehrleistung-ende")).toHaveText(ende, { timeout: 15000 });

    // "Öffnen" at the warranty end lands on the warranty tab.
    await page.getByRole("tab", { name: "Agenda" }).click();
    await page.getByTestId("projektfilter").selectOption("alle");
    const gw = page.locator('[data-testid="termin-zeile"][data-termin$=":gewaehrleistung_ende"]', { hasText: "Aufzug" });
    await expect(gw).toHaveCount(1, { timeout: 15000 });
    await gw.getByRole("button", { name: /^Öffnen/ }).click();
    await expect(page).toHaveURL(/\/Deadlines\?tab=warranty$/);
    await expect(page.getByTestId("gewaehrleistung")).toBeVisible();

    // Month: holidays of the shown month are hatched.
    await page.goto("/Deadlines?tab=month");
    await expect(page.getByTestId("monats-raster")).toBeVisible();
    const monat = tag.slice(0, 7);
    for (const f of feiertage(Number(tag.slice(0, 4)), KALENDER_STANDARD).filter((x) => x.datum.startsWith(monat))) {
      await expect(page.locator(`[data-datum="${f.datum}"]`)).toHaveAttribute("data-feiertag", "1");
    }
    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen(request);
  }
});

test("Englisch, 375 px dunkel ohne horizontales Scrollen", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  for (const tab of ["agenda", "month", "warranty"]) {
    await page.goto(`/Deadlines?tab=${tab}`);
    await expect(page.locator("h1")).toHaveText(/Deadlines & appointments/, { timeout: 20000 });
    const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
    expect(breite.scroll, `${tab}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
  }
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});
