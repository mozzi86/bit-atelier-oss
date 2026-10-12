// Headless proof 71-06 (ROHB-06): attribute editor in the IFC viewer. The sample model is opened with
// ?sel=<GlobalId of "Aussenwand Sued">, FireRating and LoadBearing are changed, both changes land as
// IfcAenderung entities of the project (old + new value), the journal download has the harness format
// (bit-ifc-journal), and undo removes the newest entry. The IFC file itself is never written.
// Does not touch the review test house → plain @playwright/test. Cleanup in finally.
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Attribut-Editor 7106";
const GUID = "nYqxeK5NUBtew1kQBTaHzk"; // public/beispiel/musterprojekt.ifc, IfcWall "Aussenwand Sued"

test("71-06 Attribut-Editor schreibt ein Änderungsjournal, das IFC bleibt unberührt", async ({ page, request }) => {
  test.setTimeout(240000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|wasm/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;

    await page.goto(`/IfcViewer?projekt=${encodeURIComponent(NAME)}&beispiel=1&sel=${GUID}`);
    await page.getByTestId("ae-oeffnen").click({ timeout: 120000 });
    await page.getByTestId("ae-pset").selectOption("Pset_WallCommon");

    const fire = page.locator('[data-testid="ae-zeile"][data-eigenschaft="FireRating"]');
    await expect(fire).toContainText("F90");
    await fire.getByTestId("ae-bearbeiten").click();
    await fire.getByTestId("ae-eingabe").fill("F120");
    await fire.getByTestId("ae-uebernehmen").click();
    await expect(fire).toHaveAttribute("data-geaendert", "1");
    await expect(fire).toContainText("F90"); // "vorher: F90"

    const tragend = page.locator('[data-testid="ae-zeile"][data-eigenschaft="LoadBearing"]');
    await tragend.getByTestId("ae-bearbeiten").click();
    await tragend.getByTestId("ae-eingabe").fill("nein");
    await tragend.getByTestId("ae-eingabe").press("Enter");
    await expect(tragend).toHaveAttribute("data-geaendert", "1");
    await expect(page.getByTestId("ae-anzahl")).toHaveAttribute("data-anzahl", "2");

    const eintraege = await (await request.get(`${API}/IfcAenderung?project_id=${id}`)).json();
    const fr = eintraege.find((e) => e.eigenschaft === "FireRating");
    expect(fr).toMatchObject({ guid: GUID, pset: "Pset_WallCommon", alt: "F90", wert: "F120" });
    expect(fr.modell).toMatch(/musterprojekt\.ifc$/);
    expect(eintraege.find((e) => e.eigenschaft === "LoadBearing")).toMatchObject({ alt: true, wert: false });

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ae-json").click()]);
    expect(download.suggestedFilename()).toBe("musterprojekt.journal.json");
    const journal = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    expect(journal.format).toBe("bit-ifc-journal");
    expect(journal.version).toBe(1);
    expect(journal.eintraege).toHaveLength(2);
    expect(journal.eintraege.find((e) => e.eigenschaft === "FireRating")).toMatchObject({ guid: GUID, alt: "F90", wert: "F120" });

    await fire.getByTestId("ae-zurueck").click();
    await expect(fire).toHaveAttribute("data-geaendert", "0");
    await expect(page.getByTestId("ae-anzahl")).toHaveAttribute("data-anzahl", "1");
    expect((await (await request.get(`${API}/IfcAenderung?project_id=${id}`)).json())).toHaveLength(1);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const e of await (await request.get(`${API}/IfcAenderung?project_id=${id}`)).json()) await request.delete(`${API}/IfcAenderung/${e.id}`);
      await request.delete(`${API}/Project/${id}`);
    }
  }
});
