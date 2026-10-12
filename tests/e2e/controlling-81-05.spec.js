// Phase 81 (81-05): project controlling against the Express dev stack on the
// project "Review Testhaus". Replaces the planned headless proof
// n-81-05-controlling.mjs (no demo build since 83-02). Self-contained instead of
// the sample proj-1/proj-2: the Express seed writes no cost rates (personnel
// class, server/personal.json), so the sample lights stay grey there until a rate
// exists. The spec therefore
//  - creates a Fixture-B contract on the test house (LPH 1–8, zone III), sets the
//    test house's HoaiPlan to [100,100,100,100,60,20,0,0,0] with a three-month
//    history (the original plan is restored afterwards), and books as the owner:
//    LPH 5 390 h (V 64,8 % at F 60 % → amber), LPH 6 40 h (V 16,6 % at F 20 % →
//    green), 10 h of LPH 5 only "eingereicht";
//  - enters the owner's manual cost rate 115,00 (valid from the first history month)
//    in the tab "Kostensätze";
//  - checks overview, project tab, office-rate switch, "approved only", month
//    tab, the Designer save path (one history entry per month), the chip in
//    "Aktives Projekt" (absent before the contract, "Controlling: Achtung" after),
//    English, 375 px and the dark theme, console clean;
//  - removes everything it created in `finally`.
// Not executed when written (11./12.10.2026: port 3001 busy) — runs at the merge.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";
import { plusMonate } from "../../packages/nova-core/src/lib/kalender/datum.js";

const API = "/api/entities";
const PAPI = "/api/personal";

/** Today on the test machine, 'YYYY-MM-DD' (local calendar day like the app). */
function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

/** Commissioned LPH 1–8 of the Objektplanung (percentages of § 34 HOAI). */
const LPH = [2, 7, 15, 3, 25, 10, 4, 32, 2].map((prozent, i) => ({ prozent, beauftragt: i < 8 }));

test("Controlling: Übersicht, Projekt, Bürosatz, nur freigegebene, Monat, Designer-Verlauf, Chip, EN/375 px/dunkel", async ({ page, request }) => {
  test.setTimeout(240000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`)).json())[0];
  expect(projekt, "Testhaus fehlt").toBeTruthy();
  const tag = heute();
  const monat = tag.slice(0, 7);
  const vormonat = /** @type {string} */ (plusMonate(`${monat}-01`, -1)).slice(0, 7);
  const vorvormonat = /** @type {string} */ (plusMonate(`${monat}-01`, -2)).slice(0, 7);
  const planVorher = (await (await request.get(`${API}/HoaiPlan?project_id=${encodeURIComponent(projekt.id)}`)).json())[0] || null;
  const saetzeVorher = new Set(((await (await request.get(`${PAPI}/Kostensatz`)).json()) || []).map((s) => s.id));
  /** @type {Array<[string, string]>} */
  const angelegt = [];
  const anlegen = async (entitaet, obj) => {
    const r = await (await request.post(`${API}/${entitaet}`, { data: obj })).json();
    angelegt.push([entitaet, r.id]);
    return r;
  };
  const zeitbuchung = (lph, stunden, status, datum) => anlegen("Zeitbuchung", {
    mitarbeiter_id: "inhaber", project_id: projekt.id, lph, leistung: "grund", datum, monat: datum.slice(0, 7), kw: "", minuten: stunden * 60, status, quelle: "manuell", notiz: "e2e-81-05",
  });

  try {
    await nurLocalhost(page);
    const konsole = konsoleSammeln(page);

    // Chip absent while the test house has no contract of its own.
    const hatteVertrag = ((await (await request.get(`${API}/Honorarvertrag?project_id=${encodeURIComponent(projekt.id)}`)).json()) || []).length > 0;
    if (!hatteVertrag) {
      await page.goto(`/Dashboard?projekt=${encodeURIComponent(PROJEKT_NAME)}`);
      await expect(page.getByTestId("aktives-projekt")).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(1500);
      await expect(page.getByTestId("controlling-chip")).toHaveCount(0);
    }

    // Data: Fixture-B contract, progress with history, bookings.
    await anlegen("Honorarvertrag", {
      project_id: projekt.id, nummer: "AV-E2E-8105", status: "beauftragt", vertragsdatum: tag, leistungsbild: "gebaeude",
      kg300_euro: 2399716, kg400_euro: 281000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: LPH,
      umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
    });
    const verlauf = [
      { monat: vorvormonat, progress: [100, 100, 100, 100, 25, 0, 0, 0, 0] },
      { monat: vormonat, progress: [100, 100, 100, 100, 40, 10, 0, 0, 0] },
      { monat, progress: [100, 100, 100, 100, 60, 20, 0, 0, 0] },
    ];
    if (planVorher) await request.put(`${API}/HoaiPlan/${planVorher.id}`, { data: { progress: verlauf[2].progress, verlauf } });
    else await anlegen("HoaiPlan", { project_id: projekt.id, progress: verlauf[2].progress, verlauf });
    await zeitbuchung(5, 390, "freigegeben", `${vormonat}-15`);
    await zeitbuchung(6, 40, "freigegeben", `${monat}-01`);
    await zeitbuchung(5, 10, "eingereicht", `${monat}-01`);

    // Cost rates tab: the owner's manual rate 115,00 (personnel class, through the adapter).
    await page.goto("/Controlling?tab=rates");
    const reiter = page.getByTestId("kostensatz-reiter");
    await expect(reiter).toBeVisible({ timeout: 20000 });
    await expect(reiter).toContainText("Aus Gehältern abgeleitet — nur mit Personal-Zugang sichtbar.");
    const inhaberin = reiter.locator('[data-testid="kostensatz-person"]').first();
    // Valid from before the bookings (the controlling reads the rate valid on each booking day).
    await inhaberin.getByTestId("kostensatz-ab").fill(`${vorvormonat}-01`);
    await inhaberin.getByTestId("kostensatz-manuell").fill("115");
    await inhaberin.getByRole("button", { name: "Manuell" }).click();
    await expect(inhaberin.getByTestId("kostensatz-aktuell")).toContainText("115,00");
    // An employee with salary shows the calculation with the single employer-share rule.
    const rechnung = reiter.getByTestId("kostensatz-rechnung").first();
    if (await rechnung.count()) await expect(rechnung).toContainText("Faktor 1,21 (AG-Anteil 21 %)");
    await reiter.getByTestId("kostensatz-regelwerke").click();
    await expect(page).toHaveURL(/\/Settings\?tab=rules$/);

    // Overview: the test house row is amber.
    await page.goto("/Controlling");
    const zeile = page.locator(`[data-testid="portfolio-zeile"][data-projekt="${projekt.id}"]`);
    await expect(zeile).toBeVisible({ timeout: 20000 });
    await expect(zeile).toContainText("Achtung");

    // Project tab: LPH 5 amber with 400 h × 115 = 46.000,00 €, LPH 6 green, LPH 1–4 "ohne Zeiten".
    await zeile.getByRole("button", { name: PROJEKT_NAME }).click();
    await expect(page).toHaveURL(/tab=project/);
    const lph5 = page.locator('[data-testid="lph-zeile"][data-lph="5"]');
    await expect(lph5).toHaveAttribute("data-ampel", "gelb");
    await expect(lph5.getByTestId("lph-kosten")).toHaveText(/46\.000,00/);
    await expect(page.locator('[data-testid="lph-zeile"][data-lph="6"]')).toHaveAttribute("data-ampel", "gruen");
    for (const nr of [1, 2, 3, 4]) await expect(page.locator(`[data-testid="lph-zeile"][data-lph="${nr}"]`)).toHaveAttribute("data-ampel", "ohne_zeiten");
    await expect(page.getByTestId("stunden-je-person")).toContainText("Inhaber/in");
    await expect(page.getByTestId("stunden-je-person")).not.toContainText("€");

    // "Approved only": the 10 submitted hours drop out → 390 h × 115 = 44.850,00 €.
    await page.getByTestId("nur-freigegeben").check();
    await expect(lph5.getByTestId("lph-kosten")).toHaveText(/44\.850,00/);
    await page.getByTestId("nur-freigegeben").uncheck();

    // Office rate: label "kalkuliert mit Bürosatz … €/h".
    await page.getByTestId("satz-buero").click();
    await expect(page.getByTestId("satz-hinweis")).toContainText(/kalkuliert mit Bürosatz .+\/h/);
    await page.getByTestId("satz-persoenlich").click();

    // Month tab: three months from the history, table present.
    await page.getByRole("tab", { name: "Monat" }).click();
    await expect(page.getByTestId("monats-tabelle")).toBeVisible();
    for (const m of [vorvormonat, vormonat, monat]) await expect(page.locator(`[data-testid="monats-zeile"][data-monat="${m}"]`)).toBeVisible();

    // Designer tab "Planer": saving keeps one entry for this month, count unchanged.
    await page.goto(`/ComplexDesigner?tab=planner&projekt=${encodeURIComponent(PROJEKT_NAME)}`);
    const speichern = page.getByRole("button", { name: "Speichern", exact: true });
    await expect(speichern).toBeEnabled({ timeout: 30000 });
    await speichern.click();
    await expect.poll(async () => {
      const plan = (await (await request.get(`${API}/HoaiPlan?project_id=${encodeURIComponent(projekt.id)}`)).json())[0];
      return (plan?.verlauf || []).map((v) => v.monat);
    }, { timeout: 15000 }).toEqual([vorvormonat, vormonat, monat]);

    // Chip in "Aktives Projekt".
    await page.goto(`/Dashboard?projekt=${encodeURIComponent(PROJEKT_NAME)}`);
    await expect(page.getByTestId("controlling-chip")).toHaveText(/Controlling: Achtung/, { timeout: 20000 });
    await page.getByTestId("controlling-chip").click();
    await expect(page).toHaveURL(/\/Controlling\?tab=project/);

    // English sample, then 375 px in the dark theme without horizontal scrolling.
    await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* storage blocked */ } });
    await page.goto("/Controlling");
    await expect(page.locator(`[data-testid="portfolio-zeile"][data-projekt="${projekt.id}"]`)).toContainText("attention", { timeout: 20000 });
    const text = await page.locator("main").innerText();
    for (const de of ["Kosten bisher", "Deckungsbeitrag", "nur freigegebene Buchungen", "Reststunden"]) expect(text, `deutscher Rest „${de}“`).not.toContain(de);

    await page.addInitScript(() => { try { localStorage.setItem("lang", "de"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
    await page.setViewportSize({ width: 375, height: 800 });
    for (const route of ["/Controlling", "/Controlling?tab=project", "/Controlling?tab=month", "/Controlling?tab=rates"]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
      expect(breite.scroll, `${route}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
    }
    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    for (const [entitaet, id] of angelegt.reverse()) await request.delete(`${API}/${entitaet}/${id}`);
    if (planVorher) await request.put(`${API}/HoaiPlan/${planVorher.id}`, { data: { progress: planVorher.progress, verlauf: planVorher.verlauf ?? [] } });
    for (const s of ((await (await request.get(`${PAPI}/Kostensatz`)).json()) || [])) if (!saetzeVorher.has(s.id)) await request.delete(`${PAPI}/Kostensatz/${s.id}`);
  }
});
