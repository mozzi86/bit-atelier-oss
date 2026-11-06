// Headless proof 107-13 (D-BK-20, D-P61-09 lifted): the basement is a storey of the model. In the BIM studio the basement count is set to 1
// (saved as the programme field `untergeschosse`), "1. UG" appears in the storey choice, the floor plan shows the basement hull walls,
// a wall drawn there gets level −1, the section draws the basement wall below the terrain line, the 3D hull wall of the basement lies
// between −3 and 0 m, and the IFC download holds a storey with a negative elevation. The four editors (structure, building services,
// furnishing, fire protection) offer "1. UG" from the same level list without console errors. Review 107-13: the explicit step
// "UG im Modell anlegen" of the cellar planner (Werkstatt › Kellerabteile) writes the field and switches its plan to level −1, the
// studio writes 0 when the count is set back, and the IFC holds the drawn wall in the basement, exactly one base slab (in the
// basement) and pairwise different slab GlobalIds. Own project (like bauteilkern-107-02),
// deleted at the end; the test house is not touched (its fixture still clears a left-over `untergeschosse` at the start of a run).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Bauteilkern 10713";
const ORDNER = path.join("test-results", "bauteilkern-107-13");

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}
const modellStand = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
const huellwaende3d = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.huellwaende3d());

test.describe("107-13 Keller im Grundriss: Untergeschoss als Modellgeschoss", () => {
  test.setTimeout(420000);

  test("UG anlegen → Grundriss, Wand auf −1, Schnitt, 3D, IFC; Tragwerk, TGA, Möblierung, Brandschutz wählen „1. UG“", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const RECHT = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      // a project without basement; one room on the ground floor and one already on level −1 (as the cellar planner writes them)
      await request.post("/api/entities/BimModel", { data: {
        project_id: id, storeys: 2, storeyHeight: 3,
        customZones: [{ points: RECHT(-8, -2, -5, 5), level: 0, name: "Wohnen", _idx: 1 }, { points: RECHT(2, 8, -5, 5), level: -1, name: "Kellerraum", _idx: 2 }],
      } });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      expect("untergeschosse" in (await gespeichert()), "ein Projekt ohne UG hat das Feld nicht").toBe(false);

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      // opening and saving the studio must not write the field either
      await page.waitForTimeout(2500);
      expect("untergeschosse" in (await gespeichert()), "Laden schreibt das Feld nicht").toBe(false);

      // ---- review 107-13: cellar planner without a basement shows the EG as orientation and the explicit step "UG im Modell anlegen" ----
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=werkstatt`);
      await page.getByTestId("wt-tab-keller").click({ timeout: 60000 });
      const ugKnopf = page.getByTestId("keller-ug-anlegen");
      await expect(ugKnopf).toBeVisible({ timeout: 30000 });
      await expect(page.getByText("Hülle des EG als Orientierung")).toBeVisible();
      await page.waitForTimeout(2500);
      expect("untergeschosse" in (await gespeichert()), "Öffnen der Werkstatt schreibt das Feld nicht").toBe(false);
      await ugKnopf.click();
      await expect.poll(async () => (await gespeichert()).untergeschosse, { timeout: 20000, message: "Knopf speichert das Programmfeld" }).toBe(1);
      await expect(page.getByText("Hülle des UG").first()).toBeVisible({ timeout: 15000 });
      await expect(ugKnopf).toHaveCount(0);
      await expect(page.locator('[data-huellwand="-1:0"]').first()).toBeVisible({ timeout: 15000 });
      await page.screenshot({ path: path.join(ORDNER, "keller-ug.png") });

      // ---- back in the studio: the select shows 1; setting 0 writes 0 (a stored basement is removed, not left on the server) ----
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await expect(page.getByTestId("untergeschosse")).toHaveValue("1");
      await page.getByTestId("untergeschosse").selectOption("0");
      await expect.poll(async () => (await gespeichert()).untergeschosse, { timeout: 20000, message: "0 gespeichert" }).toBe(0);

      // ---- one basement: stored as programme field, 3D hull wall of the basement between −3 and 0 m ----
      await page.getByTestId("untergeschosse").selectOption("1");
      await expect.poll(async () => (await gespeichert()).untergeschosse, { timeout: 20000, message: "Programmfeld gespeichert" }).toBe(1);
      await expect.poll(async () => Object.keys(await huellwaende3d(page)).filter((k) => k.startsWith("-1:")).length, { timeout: 20000 }).toBe(4);
      const ug3d = (await huellwaende3d(page))["-1:0"];
      expect(Math.abs(ug3d.min[1] + 3), "UG-Wand unten bei −3 m").toBeLessThan(0.01);
      expect(Math.abs(ug3d.max[1]), "UG-Wand oben bei ±0").toBeLessThan(0.01);

      // ---- floor plan of the basement: "1. UG" in the storey choice, the hull walls of level −1 ----
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      const wahl = page.getByLabel("Geschoss wählen");
      await expect(wahl.locator("option", { hasText: "1. UG" })).toHaveCount(1);
      await wahl.selectOption("-1");
      await expect(page.locator('[data-huellwand="-1:0"]').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-huellwand="0:0"]')).toHaveCount(0);

      // ---- draw a wall on level −1 ----
      await page.getByRole("button", { name: "Wand", exact: true }).click();
      const flaeche = page.locator("[data-bim-plan2d] svg").first();
      await flaeche.click({ position: { x: 380, y: 300 } });
      await flaeche.click({ position: { x: 560, y: 330 } });
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await modellStand(page)).customWalls.length, { timeout: 15000 }).toBe(1);
      expect((await modellStand(page)).customWalls[0].level, "Wand auf Level −1").toBe(-1);
      await expect.poll(async () => ((await gespeichert()).customWalls || []).map((w) => w.level), { timeout: 20000 }).toEqual([-1]);
      await page.screenshot({ path: path.join(ORDNER, "grundriss-ug.png") });

      // ---- section: basement walls below the terrain line ----
      await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
      const ugWand = page.locator('[data-schnittwand="ug0"]');
      await expect(ugWand).toBeVisible({ timeout: 15000 });
      const ugBox = await ugWand.boundingBox();
      const egBox = await page.locator('[data-schnittwand="0"]').boundingBox();
      expect(ugBox && egBox && ugBox.y >= egBox.y + egBox.height - 1, "UG-Wand liegt unter der Wand ab ±0,00").toBe(true);
      await expect(page.locator("[data-gelaende-label]")).toBeVisible();
      await expect(page.locator("svg text", { hasText: "1. UG · -3.00" })).toBeVisible();
      await page.screenshot({ path: path.join(ORDNER, "schnitt-ug.png") });

      // ---- IFC: a storey with a negative elevation, the drawn wall contained in it ----
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
      const datei = path.join(ORDNER, "ug.ifc");
      await dl.saveAs(datei);
      const ifc = fs.readFileSync(datei, "utf8");
      const ug = ifc.split("\n").find((l) => l.includes("=IFCBUILDINGSTOREY(") && l.includes("'1. UG'"));
      expect(ug, "IFC-Geschoss 1. UG").toBeTruthy();
      expect(ug.trimEnd().endsWith(",-3.0000);"), "negative Elevation").toBe(true);
      const ugRef = ug.split("=")[0];
      const rel = ifc.split("\n").find((l) => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE(") && l.trimEnd().endsWith(`),${ugRef});`));
      expect(rel, "Elemente im UG enthalten").toBeTruthy();
      const zeilenVon = (typ) => ifc.split("\n").filter((l) => l.includes(`=${typ}(`));
      const refVon = (l) => l.split("=")[0];
      const imUg = (ref) => rel.includes(`${ref},`) || rel.includes(`${ref})`);
      // the four basement hull walls and the drawn wall (level −1): the drawn wall is contained in the basement, not in the EG
      expect(zeilenVon("IFCWALL").map(refVon).filter(imUg).length, "vier UG-Hüllwände und die gezeichnete Wand im UG").toBe(5);
      const platten = zeilenVon("IFCSLAB");
      const bodenplatten = platten.filter((l) => l.includes(".BASESLAB."));
      expect(bodenplatten.length, "genau eine Bodenplatte").toBe(1);
      expect(imUg(refVon(bodenplatten[0])), "Bodenplatte im Geschoss 1. UG").toBe(true);
      const guids = platten.map((l) => l.split("(")[1].split(",")[0]);
      expect(new Set(guids).size, "alle IFCSLAB-GlobalIds paarweise verschieden").toBe(guids.length);

      // ---- the four editors offer "1. UG" from the same level list ----
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=statics`);
      await page.getByTestId("tw-level").click({ timeout: 60000 });
      await page.getByRole("option", { name: "1. UG" }).click();
      await expect(page.getByTestId("tw-level")).toContainText("1. UG");

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=haustechnik`);
      await page.getByTestId("ht-tab-netz").click({ timeout: 60000 });
      await page.getByTestId("tn-level--1").click();
      await expect(page.getByTestId("tn-level--1")).toContainText("1. UG");
      await expect(page.getByTestId("tn-level--1")).toHaveClass(/border-sky-400/);

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=interiors`);
      await page.getByTestId("ia-tab-plan").click({ timeout: 60000 });
      await page.getByTestId("mp-level--1").click();
      await expect(page.getByTestId("mp-level--1")).toContainText("1. UG");
      await expect(page.getByTestId("mp-level--1")).toHaveClass(/border-sky-400/);

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=brandschutz`);
      await page.getByTestId("bs-level").click({ timeout: 60000 });
      await page.getByRole("option", { name: "1. UG" }).click();
      await expect(page.getByTestId("bs-level")).toContainText("1. UG");
      await page.screenshot({ path: path.join(ORDNER, "brandschutz-ug.png") });

      expect(warnungen, "Konsole sauber").toEqual([]);
    } finally {
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
