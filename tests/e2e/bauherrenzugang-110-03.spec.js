// Phase 110-03: office page /Bauherrenzugang against the Express dev stack
// (local data path = preview only). Proves on a neutral test project:
//   - the page is in the menu group "Übersicht", h1 = menu name;
//   - rows that never go to the client cannot be ticked (office document,
//     draft invoice) and say why;
//   - a plan in draft can only go out WITH a decision request;
//   - the preview shows exactly the ticked rows, through the whitelist: plan
//     number, issued invoice, project overview — never the project's internal
//     notes or the office document's name;
//   - 110-05: the building model is a candidate and goes out with the release;
//     its 3D file is written by the BIM studio from its own scene (one truth),
//     after which "Ansicht als Bauherr" opens it as a 3D view;
//   - console clean, 375 px without horizontal scroll.
// Data: own Project + rows, created at the start (leftovers of an aborted run
// removed first) and removed in finally. Touches no Testhaus.
import { test, expect, request } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = `http://localhost:${Number(process.env.API_PORT) || 3001}/api/`;
const MARKE = "T110-Musterhaus";
const INTERN = "INTERNE-NOTIZ-110";

const BAUHERR_ARTEN = ["BauherrProjekt", "BauherrTermin", "BauherrPlan", "BauherrModell", "BauherrKosten", "BauherrDokument",
  "BauherrBemusterung", "BauherrFoto", "BauherrRechnung", "BauherrBeteiligter", "BauherrAntwort", "BauherrRueckmeldung", "BauherrUpload"];

/** Rows of the test project (by marker or by its project id), projects last. @param {import("@playwright/test").APIRequestContext} api */
async function resteLoeschen(api) {
  const projekte = await (await api.get("entities/Project")).json();
  const ids = new Set((Array.isArray(projekte) ? projekte : []).filter((p) => JSON.stringify(p).includes(MARKE)).map((p) => p.id));
  for (const e of ["Plan", "Document", "Ausgangsrechnung", "KostenStand", "BimModel", ...BAUHERR_ARTEN, "Project"]) {
    const alle = await (await api.get(`entities/${e}`)).json();
    for (const r of Array.isArray(alle) ? alle : []) {
      if (!(JSON.stringify(r).includes(MARKE) || ids.has(r.project_id))) continue;
      // 110-05: the local copy of the client's 3D file (blob id of bauherrModellAbgleich.lokaleModellBlobId)
      if (e === "BimModel") await api.delete(`blobs/bauherr-${String(r.id).replace(/[^A-Za-z0-9_-]/g, "-")}-modell-glb`);
      await api.delete(`entities/${e}/${r.id}`);
    }
  }
}

/** @param {import("@playwright/test").APIRequestContext} api @param {string} e @param {object} data */
async function anlegen(api, e, data) {
  const res = await api.post(`entities/${e}`, { data });
  expect(res.ok(), `${e} anlegen`).toBeTruthy();
  return (await res.json()).id;
}

test("Bauherrenzugang: Auswahl, Sperren und Vorschau durch die Whitelist", async ({ page }) => {
  test.setTimeout(240000); // 110-05: includes one BIM studio load
  const api = await request.newContext({ baseURL: API });
  await resteLoeschen(api);
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  try {
    const pid = await anlegen(api, "Project", {
      name: MARKE, location: { address: "Musterweg 1", city: "Musterstadt" }, status: "technical_design", hoai_phase: 5,
      notes: INTERN, estimated_cost: 987654,
    });
    const tag = (/** @type {string} */ s) => `${s} ${MARKE}`;
    await anlegen(api, "Plan", { project_id: pid, nr: "A-101", titel: tag("Grundriss EG"), massstab: "1:100", status: "freigegeben", index: "a" });
    await anlegen(api, "Plan", { project_id: pid, nr: "A-201", titel: tag("Schnitt"), status: "vorabzug" });
    await anlegen(api, "Document", { project_id: pid, name: tag("Honorarvertrag.pdf"), bereich: "buero" });
    await anlegen(api, "Document", { project_id: pid, name: tag("Baugenehmigung.pdf"), type: "application/pdf" });
    await anlegen(api, "Ausgangsrechnung", { project_id: pid, nummer: "R-110-1", art: "abschlag", status: "entwurf", netto: 100, brutto: 119 });
    // 110-05: a 10 x 8 m house, two storeys, gable roof (no parapet, as a pitched-roof house has none).
    await anlegen(api, "BimModel", {
      project_id: pid, name: tag("Modell"), storeys: 2, storeyHeight: 3, dachform: "sattel", dachneigung: 35, parapet: { enabled: false, height: 0 },
      footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }],
    });
    await anlegen(api, "Ausgangsrechnung", { project_id: pid, nummer: "R-110-2", art: "abschlag", status: "gestellt", netto: 1000, brutto: 1190, rechnungsdatum: "2026-10-01", zahlungen: [] });

    await nurLocalhost(page);
    await page.addInitScript((id) => { try { localStorage.setItem("currentProjectId", id); } catch { /* storage blocked */ } }, pid);
    await page.goto("/Bauherrenzugang");
    await expect(page.locator("h1")).toHaveText("Bauherrenzugang");
    await expect(page.getByTestId("bauherr-modus")).toContainText("Vorschau");
    const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link", { name: "Bauherrenzugang" })).toBeVisible();

    // Never: office document, draft invoice — disabled with reason.
    const buero = page.getByRole("checkbox", { name: tag("Honorarvertrag.pdf") });
    await expect(buero).toBeDisabled();
    await expect(page.getByText("Büro-, Personal-, Buchhaltungs- und Schriftverkehrsdokumente gehen nie an den Bauherrn.")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "R-110-1 abschlag" })).toBeDisabled();

    // Tick: overview, released plan, draft plan (decision forced), document, issued invoice.
    await page.getByRole("checkbox", { name: MARKE, exact: true }).check();
    await page.getByRole("checkbox", { name: `A-101 ${tag("Grundriss EG")}` }).check();
    await page.getByRole("checkbox", { name: `A-201 ${tag("Schnitt")}` }).check();
    await page.getByRole("checkbox", { name: tag("Baugenehmigung.pdf") }).check();
    await page.getByRole("checkbox", { name: "R-110-2 abschlag" }).check();
    await expect(page.getByTestId("bz-modell-hinweis")).toContainText("BIM-Studio");
    await page.getByTestId("bz-art-BauherrModell").getByRole("checkbox", { name: "Gebäudemodell (3D-Ansicht)" }).check();

    const vorschau = page.getByTestId("bz-vorschau");
    await expect(vorschau.getByRole("heading", { name: MARKE })).toBeVisible();
    await expect(vorschau).toContainText("Musterweg 1, Musterstadt");
    await expect(vorschau).toContainText("Leistungsphase 5");
    await expect(vorschau.getByTestId("bauherr-zeile-BauherrPlan")).toHaveCount(2);
    await expect(vorschau).toContainText("A-101");
    await expect(vorschau).toContainText("zur Freigabe");
    await expect(vorschau.getByTestId("bauherr-entscheidung")).toHaveCount(1);
    await expect(vorschau).toContainText("R-110-2");
    await expect(vorschau).toContainText(tag("Baugenehmigung.pdf"));
    await expect(vorschau.getByTestId("bauherr-zeile-BauherrModell")).toContainText(tag("Modell"));
    // Never in the preview: internal note, estimated cost, office document, draft invoice.
    const text = await vorschau.innerText();
    for (const nie of [INTERN, "987", "Honorarvertrag", "R-110-1", "application/pdf"]) expect(text, `Vorschau enthält ${nie}`).not.toContain(nie);
    // Preview buttons are disabled.
    await expect(vorschau.getByRole("button", { name: "Freigeben" })).toBeDisabled();
    await page.screenshot({ path: ".planning/phases/110-bauherrenzugang/tmp-e2e/110-03-vorschau.png", fullPage: true });

    // The draft plan's decision box cannot be unticked while the plan is ticked.
    const entscheidungen = page.getByTestId("bz-art-BauherrPlan").getByRole("checkbox", { name: "Entscheidung anfragen" });
    await expect(entscheidungen.nth(1)).toBeChecked();
    await expect(entscheidungen.nth(1)).toBeDisabled();

    // 375 px: no horizontal scroll.
    await page.setViewportSize({ width: 375, height: 800 });
    const breit = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(breit, "horizontaler Scroll bei 375 px").toBe(false);
    await page.setViewportSize({ width: 1280, height: 720 });

    // "Ansicht als Bauherr": release locally, switch, see exactly the release, back.
    await page.getByTestId("bz-freigeben").click();
    await expect(page.getByText("6 Einträge für den Bauherrn freigegeben.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zurücknehmen" })).toHaveCount(6);
    await page.getByTestId("ansicht-als").selectOption("__bauherr__");
    const portal = page.getByTestId("bauherrportal");
    await expect(portal).toBeVisible();
    await expect(page.getByTestId("bauherr-vorschau-hinweis")).toContainText(MARKE);
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0);
    await expect(portal.getByRole("heading", { name: MARKE })).toBeVisible();
    await expect(portal.getByTestId("bauherr-zeile-BauherrPlan")).toHaveCount(2);
    await expect(portal).toContainText("R-110-2");
    const portalText = await portal.innerText();
    for (const nie of [INTERN, "987", "Honorarvertrag", "R-110-1"]) expect(portalText, `Portal enthält ${nie}`).not.toContain(nie);
    // 110-05: the model row is there, but no 3D button before the BIM studio wrote the file.
    await expect(portal.getByTestId("bauherr-zeile-BauherrModell")).toContainText(tag("Modell"));
    await expect(portal.getByTestId("bauherr-modell-oeffnen")).toHaveCount(0);
    await page.screenshot({ path: ".planning/phases/110-bauherrenzugang/tmp-e2e/110-03-ansicht-als-bauherr.png", fullPage: true });
    await page.getByTestId("bauherr-vorschau-ende").click();
    await expect(page.locator("h1")).toHaveText("Bauherrenzugang");

    // 110-05: opening the BIM studio writes the client's 3D file from the studio scene (release active, no file yet).
    await page.goto("/ComplexDesigner?tab=bim");
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 90000 });
    await expect.poll(async () => {
      const zeilen = await (await api.get(`entities/BauherrModell?project_id=${pid}`)).json();
      return (Array.isArray(zeilen) ? zeilen : []).some((z) => z.freigegeben === true && typeof z.datei === "string" && z.datei.endsWith(".glb"));
    }, { timeout: 120000, message: "Studio schreibt die 3D-Datei für den Bauherrn" }).toBe(true);
    await page.goto("/Bauherrenzugang");
    await expect(page.locator("h1")).toHaveText("Bauherrenzugang");
    await page.getByTestId("ansicht-als").selectOption("__bauherr__");
    // The model opens read-only in the preview — a canvas, loaded without error.
    await page.getByTestId("bauherrportal").getByTestId("bauherr-modell-oeffnen").click();
    const ansicht3d = page.getByTestId("bauherrportal").getByTestId("bauherr-modell3d");
    await expect(ansicht3d).toHaveAttribute("data-stand", "bereit", { timeout: 30000 });
    await expect(ansicht3d.locator("canvas")).toBeVisible();
    await page.screenshot({ path: ".planning/phases/110-bauherrenzugang/tmp-e2e/110-05-modell3d.png", fullPage: true });
    await page.getByTestId("bauherrportal").getByTestId("bauherr-modell-oeffnen").click();
    await expect(ansicht3d).toHaveCount(0);
    await page.getByTestId("bauherr-vorschau-ende").click();
    await expect(page.locator("h1")).toHaveText("Bauherrenzugang");

    // Withdraw the plan: the preview no longer shows it.
    await page.getByRole("listitem").filter({ hasText: `Pläne: ${tag("Grundriss EG")}` }).getByRole("button", { name: "Zurücknehmen" }).click();
    await expect(page.getByRole("button", { name: "Zurücknehmen" })).toHaveCount(5);
    await page.getByTestId("ansicht-als").selectOption("__bauherr__");
    await expect(page.getByTestId("bauherrportal").getByTestId("bauherr-zeile-BauherrPlan")).toHaveCount(1);
    await page.getByTestId("bauherr-vorschau-ende").click();

    expect(meldungen, `Konsole: ${meldungen.join(" | ")}`).toEqual([]);
  } finally {
    await resteLoeschen(api);
    await api.dispose();
  }
});
