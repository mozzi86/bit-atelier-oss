// Phase 81 (81-02): time tracking against the Express dev stack on the project
// "Review Testhaus" — a row via "Zeile hinzufügen", "2,5" + Enter books a draft
// of 150 min, an off-grid value is refused, the week is submitted and approved
// (proof on the booking, no AuditLog), the device timer books 15 min after
// seven minutes, the working-day frame warns (§ 3/§ 4 ArbZG), the CSV export has
// the BOM and 79's file name, the staff link goes to /People?tab=staff.
// Replaces the planned headless proof n-81-02-zeiterfassung.mjs (no demo build
// since 83-02). Own bookings of the test house in the current week are deleted
// before and after (finally).
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";
import { isoWoche, wochenTage } from "../../packages/nova-core/src/lib/kalender/datum.js";
import { sollMinuten } from "../../packages/nova-core/src/lib/kalender/arbeitstage.js";

const API = "/api/entities";

/** Today on the test machine, 'YYYY-MM-DD' (local calendar day like the app). */
function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Deletes the time bookings of the test house project in the current week.
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string} projektId
 * @param {string[]} tage the seven days of the week
 */
async function aufraeumen(request, projektId, tage) {
  const buchungen = await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(projektId)}`)).json();
  for (const b of Array.isArray(buchungen) ? buchungen : []) if (tage.includes(b.datum)) await request.delete(`${API}/Zeitbuchung/${b.id}`);
}

test("Woche: Zeile, 2,5 + Enter, Raster-Fehler, Einreichen, Freigabe ohne AuditLog", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`)).json())[0];
  expect(projekt, "Testhaus fehlt").toBeTruthy();
  const w = /** @type {{jahr: number, woche: number}} */ (isoWoche(heute()));
  const tage = wochenTage(w.jahr, w.woche);
  await aufraeumen(request, projekt.id, tage);
  const auditVorher = (await (await request.get(`${API}/AuditLog`)).json()).length;
  try {
    await nurLocalhost(page);
    const konsole = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) konsole.push(m.text()); });
    page.on("pageerror", (e) => konsole.push(`pageerror ${e}`));

    await page.goto(`/TimeTracking?projekt=${encodeURIComponent(PROJEKT_NAME)}`);
    const person = page.getByTestId("zeit-person");
    await expect(person).toBeVisible({ timeout: 20000 });
    const personId = await person.inputValue();

    // Soll of the week: contract or daily target 480 min on Mo–Fr (Bavarian holidays 0).
    if (personId === "inhaber") {
      const soll = sollMinuten(tage[0], tage[6], { tagessollMinuten: 480 });
      await expect(page.getByTestId("zeit-soll")).toHaveText(String(soll / 60).replace(".", ","));
    }

    await page.getByRole("button", { name: "Zeile hinzufügen" }).click();
    await page.locator("#zeile-projekt").selectOption({ label: PROJEKT_NAME });
    await page.getByRole("button", { name: "Hinzufügen" }).click();
    const zelle = page.locator('[data-zelle="0-0"]');
    await zelle.fill("2,5");
    await zelle.press("Enter");
    await expect.poll(async () => {
      const liste = await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(projekt.id)}`)).json();
      return liste.filter((b) => b.datum === tage[0] && b.mitarbeiter_id === personId).map((b) => [b.minuten, b.status, b.quelle, b.kw]);
    }, { timeout: 15000 }).toEqual([[150, "entwurf", "manuell", `${w.jahr}-W${String(w.woche).padStart(2, "0")}`]]);

    // Off the 15-minute grid: error, nothing saved.
    const dienstag = page.locator('[data-zelle="0-1"]');
    await dienstag.fill("0,1");
    await dienstag.press("Enter");
    await expect(page.getByText("Nur Vielfache von 15 min")).toBeVisible();
    const nachFehler = await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(projekt.id)}`)).json();
    expect(nachFehler.filter((b) => b.datum === tage[1]).length).toBe(0);

    // Submit the week (confirmation dialog).
    await page.getByRole("button", { name: "Woche einreichen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Einreichen" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(projekt.id)}`)).json())
      .filter((b) => b.datum === tage[0])[0]?.status, { timeout: 15000 }).toBe("eingereicht");
    await expect(page.locator('[data-zelle="0-0"]')).toHaveAttribute("readonly", "");

    // Approval: rejecting needs a reason; approve with confirmation.
    await page.getByRole("tab", { name: "Freigabe" }).click();
    const woche = page.getByTestId("zeit-freigabe-woche").first();
    await expect(woche).toBeVisible();
    await woche.getByRole("button", { name: "Ablehnen" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Ablehnen" })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
    await woche.getByRole("button", { name: "Woche freigeben" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Freigeben" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(projekt.id)}`)).json())
      .filter((b) => b.datum === tage[0]).map((b) => [b.status, b.freigegeben_von]), { timeout: 15000 }).toEqual([["freigegeben", personId]]);
    expect((await (await request.get(`${API}/AuditLog`)).json()).length, "kein AuditLog (80-Invariante)").toBe(auditVorher);

    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen(request, projekt.id, tage);
  }
});

test("Tag: Timer bucht 15 min nach 7 Minuten, Tagesrahmen warnt, Export-CSV, Link zu den Mitarbeitenden", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`)).json())[0];
  const w = /** @type {{jahr: number, woche: number}} */ (isoWoche(heute()));
  const tage = wochenTage(w.jahr, w.woche);
  await aufraeumen(request, projekt.id, tage);
  try {
    await nurLocalhost(page);
    await page.clock.install();
    await page.addInitScript(() => { try { localStorage.removeItem("bit-atelier.zeit.timer.v1"); } catch { /* blocked */ } });
    await page.goto(`/TimeTracking?tab=day&projekt=${encodeURIComponent(PROJEKT_NAME)}`);
    const timer = page.getByTestId("zeit-timer");
    await expect(timer).toBeVisible({ timeout: 20000 });
    await page.locator("#timer-projekt").selectOption({ label: PROJEKT_NAME });
    await timer.getByRole("button", { name: "Start" }).click();
    await page.clock.runFor(7 * 60_000);
    await expect(page.getByTestId("zeit-timer-laufzeit")).toHaveText(/^0:07:/);
    await timer.getByRole("button", { name: "Stopp" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Zeitbuchung?project_id=${encodeURIComponent(projekt.id)}`)).json())
      .filter((b) => b.quelle === "timer").map((b) => b.minuten), { timeout: 15000 }).toEqual([15]);

    // Working-day frame: 08:00–19:30 with 20 min break → § 3 and § 4 ArbZG, saving still possible.
    const rahmen = page.getByTestId("zeit-tagesrahmen");
    if (await rahmen.isVisible()) {
      await page.locator("#rahmen-beginn").fill("08:00");
      await page.locator("#rahmen-ende").fill("19:30");
      await page.locator("#rahmen-pause").fill("20");
      const hinweise = page.getByTestId("zeit-arbzg-hinweise");
      await expect(hinweise).toContainText("§ 3 ArbZG");
      await expect(hinweise).toContainText("§ 4 ArbZG");
      await expect(rahmen.getByRole("button", { name: "Tagesrahmen speichern" })).toBeEnabled();
    }

    // Export: CSV with BOM and 79's file name.
    await page.getByRole("tab", { name: "Export" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV exportieren" }).click()]);
    expect(download.suggestedFilename()).toBe(`buchhaltung-stunden-${heute().slice(0, 7)}.csv`);
    const pfad = await download.path();
    const bytes = await import("node:fs").then((fs) => fs.readFileSync(/** @type {string} */ (pfad)));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain("Datum;KW;Mitarbeiter:in;Kürzel;Projekt;LPH;Leistung;Stunden;Status;Notiz");

    const link = page.getByRole("link", { name: "Mitarbeitende pflegen" });
    if (await link.isVisible()) {
      await link.click();
      await expect(page).toHaveURL(/\/People\?tab=staff$/);
    }
  } finally {
    await aufraeumen(request, projekt.id, tage);
  }
});
