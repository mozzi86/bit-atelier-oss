// Headless proof 73-12 (HOAI-Bestandspfad): in an existing-building project the offer wizard starts with
// the conversion surcharge (20 %, zone III), shows the note on special services / HOAI counter-reading,
// and feeds the existing fabric to be reworked (mvb) from the saved survey model: the pot "Bestand
// mitverarbeitet" without rooms = 4 walls, 384 m²; 384 m² × 250 €/m² = 96.000 € raises the net fee.
// Nothing is saved (dialog closed); project and snapshot are removed in finally. Console clean.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { bimSnapshots } from "../../packages/nova-core/server/seed-data.js";

const API = "/api/entities";
const NAME = "E2E HOAI Bestand 7312";
const euro = (txt) => Number(String(txt).replace(/[^\d,]/g, "").replace(",", "."));

test("73-12 Umbauzuschlag + mitzuverarbeitende Bausubstanz aus dem Modell", async ({ page, request }) => {
  test.setTimeout(180000);
  const ids = { project: null, snap: null };
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    ids.project = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "umbau", status: "concept", estimated_cost: 500000 } })).json()).id;
    const { id: _seedId, project_id: _p, ...snap } = bimSnapshots[0];
    ids.snap = (await (await request.post(`${API}/BimSnapshot`, { data: { ...snap, project_id: ids.project } })).json()).id;

    await page.goto(`/Fees?tab=offers&projekt=${encodeURIComponent(NAME)}`);
    await page.getByRole("button", { name: "Neues Honorarangebot" }).first().click();
    const dialog = page.getByTestId("angebot-assistent");
    await expect(dialog).toBeVisible();
    await page.locator("#as-projekt").selectOption({ label: NAME });
    await page.locator("#as-bauherr").fill("Bauherrschaft Muster");
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await page.locator("#as-kg300").fill("500.000");
    await page.locator("#as-kg300").blur();
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await page.locator("#as-zone").selectOption("III");
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await dialog.getByRole("button", { name: "Weiter" }).click();

    await expect(dialog.getByLabel("Umbau oder Modernisierung")).toBeChecked();
    await expect(page.locator("#as-umbau")).toHaveValue("20");
    await expect(page.getByTestId("hoai-bestand-hinweis")).toContainText("Anlage 10");
    const karte = page.getByTestId("mvb-bestand");
    await expect(karte).toHaveAttribute("data-stand", "modell", { timeout: 30000 });
    await expect(karte).toContainText("384 m²");
    await expect(karte).toContainText("4 Bauteile");

    const vorher = euro(await page.getByTestId("angebot-netto").textContent());
    await page.getByTestId("mvb-satz").fill("250");
    await expect(page.getByTestId("mvb-uebernehmen")).toContainText("96.000");
    await page.getByTestId("mvb-uebernehmen").click();
    await expect(page.locator("#as-mvb")).toHaveValue(/96\.000/);
    await expect.poll(async () => euro(await page.getByTestId("angebot-netto").textContent())).toBeGreaterThan(vorher);
    console.log(`[73-12] netto ohne mvb ${vorher} €, mit mvb ${euro(await page.getByTestId("angebot-netto").textContent())} €`);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (ids.snap) await request.delete(`${API}/BimSnapshot/${ids.snap}`);
    if (ids.project) await request.delete(`${API}/Project/${ids.project}`);
  }
});
