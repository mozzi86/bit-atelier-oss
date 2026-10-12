// 72-07 project file + 72-20 work focus against the Express dev stack:
//  1. /Dashboard?rolle=bauleitung → five focus entries on top in the focus order,
//     "Alle Module" closed; the focus is remembered without the parameter;
//  2. focus "Alle Module" → today's sidebar (no focus list, no drawer);
//  3. "Ansicht als" employee + focus "Büro" → no accounting entry in the focus either;
//  4. project select: after switching projects the group "Zuletzt geöffnet" shows the
//     last project first;
//  5. a check run and a document of the Review Testhaus appear in the project file
//     on the overview and in the dialog on /Projects; no person name in the lines.
// Everything the spec creates is deleted in `finally`; owner view and focus are reset.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";

/** @param {import("@playwright/test").Page} page */
const fokusHrefs = async (page) => page.getByTestId("fokus-gruppe").locator("a").evaluateAll((as) => as.map((a) => new URL(/** @type {HTMLAnchorElement} */ (a).href).pathname));

test("72-07/72-20 Arbeitsfokus, Zuletzt-Liste, Projektakte", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const jetzt = new Date().toISOString();
  const lauf = await (await request.post(`${API}/PruefLauf`, { data: { project_id: projekt.id, datum: jetzt, modell: "E2E-Chronik-Modell.ifc", regelsatz: "e2e", anzahl: 3, befunde: [] } })).json();
  const dok = await (await request.post(`${API}/Document`, { data: { project_id: projekt.id, name: "E2E-Chronik-Bericht.pdf", type: "Bericht", bereich: "projekt", created_date: jetzt } })).json();
  const warnungen = [];
  try {
    await nurLocalhost(page);
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    // 1. focus from the link
    await page.goto("/Dashboard?rolle=bauleitung");
    await expect(page.getByTestId("fokus-wahl")).toHaveValue("bauleitung", { timeout: 20000 });
    expect(await fokusHrefs(page)).toEqual(["/Dashboard", "/Werkplanung", "/BimViewer", "/Reports", "/Deadlines"]);
    await expect(page.getByTestId("alle-module")).not.toHaveAttribute("open", "");
    await page.goto("/Dashboard");
    await expect(page.getByTestId("fokus-wahl")).toHaveValue("bauleitung", { timeout: 20000 });
    await page.getByTestId("alle-module").locator("summary").click();
    await expect(page.getByTestId("alle-module").getByRole("link", { name: "Angebot & Auftrag", exact: true })).toBeVisible();

    // 2. all modules = today's sidebar
    await page.getByTestId("fokus-wahl").selectOption("alle");
    await expect(page.getByTestId("fokus-gruppe")).toHaveCount(0);
    await expect(page.getByTestId("alle-module")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Projekte", exact: true })).toBeVisible();

    // 3. focus does not open what the role may not see
    await page.getByTestId("fokus-wahl").selectOption("buero");
    expect(await fokusHrefs(page)).toContain("/Accounting");
    await page.getByTestId("ansicht-als").selectOption("nu-3");
    await expect(page.getByTestId("rollen-chip")).toHaveText("Mitarbeiter/in", { timeout: 20000 });
    const mitarbeiter = await fokusHrefs(page);
    expect(mitarbeiter).not.toContain("/Accounting");
    expect(mitarbeiter).toContain("/Deadlines");
    await page.getByTestId("ansicht-als").selectOption("nu-1");
    await expect(page.getByTestId("rollen-chip")).toHaveText("Inhaber/in", { timeout: 20000 });
    await page.getByTestId("fokus-wahl").selectOption("alle");

    // 4. recent projects
    await page.evaluate(() => localStorage.removeItem("bit-atelier-zuletzt-projekte"));
    await page.goto(`/Dashboard?projekt=${encodeURIComponent("Wohnpark am See")}`);
    await expect(page.getByRole("combobox", { name: "Aktuelles Projekt" })).toContainText("Wohnpark am See", { timeout: 20000 });
    await page.goto(`/Dashboard?projekt=${encodeURIComponent("Review Testhaus")}`);
    await expect(page.getByRole("combobox", { name: "Aktuelles Projekt" })).toContainText("Review Testhaus", { timeout: 20000 });
    await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
    const zuletzt = page.getByTestId("zuletzt-gruppe");
    // the project active before the test may follow, never precede
    await expect(zuletzt.getByRole("option").nth(0)).toHaveText("Review Testhaus");
    await expect(zuletzt.getByRole("option").nth(1)).toHaveText("Wohnpark am See");
    await page.keyboard.press("Escape");

    // 5. project file on the overview and on /Projects
    const chronik = page.getByTestId("aktives-projekt").getByTestId("chronik");
    await expect(chronik.locator("[data-testid=chronik-zeile][data-art=prueflauf]", { hasText: "E2E-Chronik-Modell.ifc" })).toContainText("3", { timeout: 20000 });
    await expect(chronik.locator("[data-testid=chronik-zeile][data-art=dokument]", { hasText: "E2E-Chronik-Bericht.pdf" })).toHaveCount(1);
    await page.goto("/Projects");
    await page.getByRole("button", { name: "Projektakte: Review Testhaus" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-testid=chronik-zeile]", { hasText: "E2E-Chronik-Bericht.pdf" })).toHaveCount(1, { timeout: 20000 });
    await page.keyboard.press("Escape");
    expect(warnungen).toEqual([]);
  } finally {
    await request.delete(`${API}/PruefLauf/${lauf.id}`);
    await request.delete(`${API}/Document/${dok.id}`);
  }
});
