// Headless-Nachweis 97-03: über dem Grundriss liegt die Brillen-Leiste. Ein Modell mit drei Wänden
// (Bestand, Neubau, ohne Status): „Eingabe“ zeigt alle, „Bestand“ blendet die Neubauwand aus —
// die Wand ohne Status bleibt sichtbar (D-BW-03); 97-04: Statusfarben grau/rot, ohne Status wie bisher; „1:50“ blendet nichts davon aus. Die Wahl bleibt
// nach dem Neuladen (je Ansicht im Browser gemerkt), das Modell ändert sich nicht. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const NAME = "E2E Brillen 9703";

test("97-03 Brillen-Leiste: Sicht je Status, ohne Status bleibt, Wahl bleibt", async ({ page, request }) => {
  test.setTimeout(180000);
  let id = null, modellId = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;
    const waende = [
      { a: { x: -4, z: -2 }, b: { x: 4, z: -2 }, level: 0, thickness: 0.24, composite: "cavity", _idx: 1, status: "bestand" },
      { a: { x: -4, z: 0 }, b: { x: 4, z: 0 }, level: 0, thickness: 0.24, _idx: 2, status: "neubau" },
      { a: { x: -4, z: 2 }, b: { x: 4, z: 2 }, level: 0, thickness: 0.24, _idx: 3 },
    ];
    modellId = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: waende } })).json()).id;

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click({ timeout: 60000 });
    await expect(page.getByTestId("brillen-leiste")).toBeVisible();
    await expect(page.getByTestId("brille-eingabe")).toHaveAttribute("aria-checked", "true");
    for (const i of [1, 2, 3]) await expect(page.locator(`[data-wand="${i}"]`)).toHaveCount(1);
    // 97-04: status colours from the ONE table (Neubau red, Bestand grey); no status keeps today's look.
    await expect(page.locator('[data-wand="2"]')).toHaveAttribute("fill", "#d6453d");
    await expect(page.locator('[data-wand="1"]')).toHaveAttribute("fill", "#9aa3ad");
    await expect(page.locator('[data-wand="3"]')).toHaveAttribute("fill", "#0f766e");
    await expect(page.locator('[data-wand="3"]')).not.toHaveAttribute("data-status", /./);
    if (process.env.BRILLEN_BILD) await page.locator("svg").filter({ has: page.locator('[data-wand="1"]') }).first().screenshot({ path: process.env.BRILLEN_BILD });

    // 97-06: in the existing-building project the wall without status (and the hull) is a hint.
    await page.getByTestId("fehlplanung").locator("button").click();
    await expect(page.locator('[data-testid=fehlplanung-befund][data-code=ohne_status]')).toContainText("ohne Umbaustatus");
    await page.getByTestId("fehlplanung").locator("button").click();

    await page.getByTestId("brille-bestand").click();
    await expect(page.locator('[data-wand="2"]')).toHaveCount(0);
    await expect(page.locator('[data-wand="1"]')).toHaveCount(1);
    await expect(page.locator('[data-wand="3"]')).toHaveCount(1, { timeout: 5000 });
    await expect(page.getByTestId("legende-neubau")).toHaveAttribute("data-sicht", "aus");

    await page.reload();
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click({ timeout: 60000 });
    await expect(page.getByTestId("brille-bestand")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-wand="2"]')).toHaveCount(0, { timeout: 15000 });

    // 97-04b: permit lens in black and white — new build hatched, existing light grey.
    await expect(page.getByTestId("brille-sw")).toHaveCount(0);
    await page.getByTestId("brille-bauantrag").click();
    await page.getByTestId("brille-sw").check();
    await expect(page.locator('[data-wand="2"]')).toHaveAttribute("data-sw", "schraffur");
    await expect(page.locator('[data-schraffur="2"] line').first()).toBeAttached();
    await expect(page.locator('[data-wand="1"]')).toHaveAttribute("fill", "#d4d4d8");
    await page.getByTestId("brille-sw").uncheck();

    await page.getByTestId("brille-ausfuehrung").click();
    for (const i of [1, 2, 3]) await expect(page.locator(`[data-wand="${i}"]`)).toHaveCount(1);
    // 97-04b: at 1:50 the layered wall shows its material hatches (DIN ISO 128-50).
    await expect(page.locator('[data-wand="1"] [data-schraffur-material="insul"]')).toHaveCount(1);
    await expect(page.locator('[data-wand="1"] [data-schraffur-material="brick"]')).toHaveCount(1);
    // 97-09: the floor plan PDF is a vector sheet at TRUE scale (A3 at 1:100 for this house),
    // the lens "1:50" differs from the chosen 1:100 → rule 7 note in the hint line.
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Aktuellen Plan als PDF" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/_1-100\.pdf$/);
    const pdf = await PDFDocument.load(fs.readFileSync(await dl.path()));
    if (process.env.BRILLEN_PDF) fs.copyFileSync(await dl.path(), process.env.BRILLEN_PDF);
    expect(Math.round(pdf.getPage(0).getSize().width / (72 / 25.4))).toBe(420);
    expect(pdf.getTitle()).toMatch(/1:100/);
    await expect(page.getByText(/ist für 1:50 gedacht/)).toBeVisible();
    await page.getByTestId("brille-eingabe").click();

    const m = await (await request.get(`/api/entities/BimModel/${modellId}`)).json();
    expect((m.customWalls || []).map((w) => w.status ?? null)).toEqual(["bestand", "neubau", null]);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (modellId) await request.delete(`/api/entities/BimModel/${modellId}`);
    if (id) await request.delete(`/api/entities/Project/${id}`);
  }
});
