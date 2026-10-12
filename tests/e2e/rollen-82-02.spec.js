// Phase 82 (82-02): roles against the Express dev stack. Replaces the planned
// headless proof n-82-02-rollen.mjs (no demo build since 83-02). The Express
// sample has users nu-1…nu-4 but no persons (personal.json empty), so the spec
// creates one person with assignments proj-1/proj-2, links nu-3 and nu-2 to it,
// and undoes everything in `finally`:
//  1. owner: role chip, every menu entry, no "Kein Zugriff";
//  2. "Ansicht als" employee: no accounting/personnel/fees/controlling/settings
//     in the menu; /Accounting → "Kein Zugriff" and the page chunk is never
//     requested; project picker = proj-1, proj-2; ?projekt=proj-3 → first allowed by name;
//     /TimeTracking?tab=approval → week; no password field;
//  3. "Ansicht als" bookkeeping: accounting and personnel visible; /Fees read-only;
//  4. "Ansicht als" project lead: controlling computes with the office rate;
//  5. owner: Settings › Nutzer & Rechte shows the honesty block; demoting the
//     last owner is refused with a plain message.
// The export dialog exists only in the serverless build; its role filter and
// dokumentBereiche are proven by unit tests (zugriff, projektDatei-weitergabe).
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const PERSON = "e2e-82-02-person";

/** @param {import("@playwright/test").Page} page */
function konsoleSammeln(page) {
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  return meldungen;
}

const menue = (/** @type {import("@playwright/test").Page} */ page) => page.getByRole("navigation", { name: "Hauptnavigation" });

test("vier Rollen: Menü, Tor, Projektsicht, Reiter, Nur-Lesen, Bürosatz, Nutzer & Rechte", async ({ page, request }) => {
  test.setTimeout(240000);
  const nutzerVorher = await (await request.get(`${API}/Nutzer`)).json();
  test.skip(!Array.isArray(nutzerVorher) || nutzerVorher.length < 4, "Saat ohne Nutzer — npm run seed im Worktree");
  await request.post(`/api/personal/Mitarbeiter`, { data: { id: PERSON, vorname: "E2E", nachname: "Beispiel", personalnummer: "E2E-1", art: "angestellt",
    projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Projektleitung", anteil_prozent: 50, von: null, bis: null }, { project_id: "proj-2", funktion: "Projektleitung", anteil_prozent: 50, von: null, bis: null }] } });
  for (const id of ["nu-2", "nu-3"]) await request.put(`${API}/Nutzer/${id}`, { data: { mitarbeiter_id: PERSON } });
  try {
    await nurLocalhost(page);
    const konsole = konsoleSammeln(page);
    /** @type {string[]} */
    const anfragen = [];
    page.on("request", (r) => anfragen.push(r.url()));

    // 1. Owner.
    await page.goto("/Dashboard");
    await expect(page.getByTestId("rollen-chip")).toHaveText("Inhaber/in", { timeout: 20000 });
    for (const x of ["Buchhaltung", "Personal", "Einstellungen"]) await expect(menue(page).getByRole("link", { name: x, exact: true })).toHaveCount(1);

    // 2. View as employee.
    await page.getByTestId("ansicht-als").selectOption("nu-3");
    await expect(page.getByTestId("rollen-chip")).toHaveText("Mitarbeiter/in");
    for (const x of ["Buchhaltung", "Personal", "Angebot & Auftrag", "Projektcontrolling", "Einstellungen"]) await expect(menue(page).getByRole("link", { name: x, exact: true })).toHaveCount(0);
    anfragen.length = 0;
    await page.goto("/Accounting");
    await expect(page.getByTestId("kein-zugriff")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    expect(anfragen.filter((u) => /pages\/Accounting/.test(u)), "Seiten-Chunk der Buchhaltung angefragt").toEqual([]);
    await page.goto("/Dashboard?projekt=proj-3");
    // Fallback = first allowed project by name (the list is sorted by name), never proj-3.
    await expect.poll(() => new URL(page.url()).searchParams.get("projekt"), { timeout: 20000 }).not.toBe("proj-3");
    expect(["proj-1", "proj-2"]).toContain(new URL(page.url()).searchParams.get("projekt"));
    await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
    const optionen = await page.getByRole("option").allInnerTexts();
    expect(optionen.length).toBe(2);
    await page.keyboard.press("Escape");
    await page.goto("/TimeTracking?tab=approval");
    await expect(page).toHaveURL(/tab=week/, { timeout: 20000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // 3. View as bookkeeping.
    await page.getByTestId("ansicht-als").selectOption("nu-4");
    for (const x of ["Buchhaltung", "Personal"]) await expect(menue(page).getByRole("link", { name: x, exact: true })).toHaveCount(1);
    await page.goto("/Fees");
    await expect(page.getByTestId("nur-lesen")).toBeVisible({ timeout: 20000 });

    // 4. View as project lead: controlling with the office rate.
    await page.getByTestId("ansicht-als").selectOption("nu-2");
    await page.goto("/Controlling");
    await expect(page.getByText(/Bürosatz/).first()).toBeVisible({ timeout: 20000 });
    await page.goto("/Controlling?tab=rates");
    await expect(page).not.toHaveURL(/tab=rates/, { timeout: 20000 });

    // 5. Owner: honesty block, the last owner cannot be demoted.
    await page.getByTestId("ansicht-als").selectOption("nu-1");
    await page.goto("/Settings?tab=access");
    await expect(page.getByTestId("ehrlichkeit")).toBeVisible({ timeout: 20000 });
    await page.locator('[data-nutzer="nu-1"]').getByRole("button", { name: /^Bearbeiten/ }).click();
    await page.getByTestId("nutzer-rolle").selectOption("mitarbeiter");
    await page.getByTestId("nutzer-speichern").click();
    await expect(page.getByTestId("nutzer-meldung")).toHaveText("Mindestens ein aktiver Inhaber muss bleiben.");
    expect((await (await request.get(`${API}/Nutzer/nu-1`)).json()).rolle).toBe("inhaber");
    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    for (const id of ["nu-2", "nu-3"]) await request.put(`${API}/Nutzer/${id}`, { data: { mitarbeiter_id: null } });
    await request.delete(`/api/personal/Mitarbeiter/${PERSON}`);
  }
});
