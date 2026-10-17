// Headless-Nachweis 97-02a: am gezeichneten Bauteil steht der Steckbrief — IFC-Klasse, Bauteiltyp
// (als Annahme markiert, wenn abgeleitet), Kostengruppe, Gewerk mit STLB-LB, Menge, Bauabschnitt, GUID.
// Gewerk und Bauabschnitt werden am Bauteil gespeichert (optionale Felder, sonst nichts geändert);
// ein Wechsel des Bauteiltyps nimmt die Annahme weg. Eigenes Projekt, aufgeräumt im finally,
// Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Steckbrief 9702a";

test("97-02a Steckbrief am gezeichneten Bauteil", async ({ page, request }) => {
  test.setTimeout(180000);
  let id = null, modellId = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    modellId = (await (await request.post("/api/entities/BimModel", { data: {
      project_id: id,
      customWalls: [{ a: { x: -4, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, composite: "cavity", _idx: 1 }],
    } })).json()).id;

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click({ timeout: 60000 });
    await page.locator('[data-wand="1"]').first().click({ timeout: 30000, force: true });

    const sb = page.getByTestId("steckbrief");
    await expect(sb).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("sb-ifc")).toHaveText("IfcWall · STANDARD");
    await expect(page.getByTestId("sb-typ")).toHaveValue("wand-aussen");
    await expect(page.getByTestId("sb-kg")).toHaveValue("331");
    await expect(page.getByTestId("sb-gewerk")).toHaveValue("012");
    await expect(page.getByTestId("sb-menge")).toHaveText("24 m²");
    await expect(page.getByTestId("sb-hinweise")).toContainText("abgeleitet");
    // Optional proof image of the inspector (set STECKBRIEF_BILD to a path).
    if (process.env.STECKBRIEF_BILD) await sb.locator("xpath=ancestor::div[contains(@class,'absolute')][1]").screenshot({ path: process.env.STECKBRIEF_BILD });

    // Decisions are stored on the element; the derived marker for the type disappears once set.
    await page.getByTestId("sb-gewerk").selectOption("039");
    await page.getByTestId("sb-abschnitt").fill("BA 1");
    await page.getByTestId("sb-typ").selectOption("wand-innen");
    await expect(page.getByTestId("sb-ifc")).toHaveText("IfcWall · PARTITIONING");
    await expect(page.getByTestId("sb-kg")).toHaveValue("342");
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel/${modellId}`)).json());
      const w = (m.customWalls || [])[0] || {};
      return `${w.gewerk_lb}|${w.bauabschnitt}|${w.bauteil_typ}|${w.composite}`;
    }, { timeout: 20000 }).toBe("039|BA 1|wand-innen|cavity");

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (modellId) await request.delete(`/api/entities/BimModel/${modellId}`);
    if (id) await request.delete(`/api/entities/Project/${id}`);
  }
});

// 97-02a: the fire stop is its own element at the opening — form only for rated elements,
// a stop weaker than the element warns (MLAR 4.1), the stop is stored structured.
test("97-02a Brandschott am Durchbruch", async ({ page, request }) => {
  test.setTimeout(120000);
  const MARKE = "E2E9702a-Schott";
  const projekt = (await (await request.get(`/api/entities/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const alt = await (await request.get(`/api/entities/Durchbruch?project_id=${projekt.id}`)).json();
    for (const x of (Array.isArray(alt) ? alt : []).filter((d) => d.kommentar === MARKE)) await request.delete(`/api/entities/Durchbruch/${x.id}`);
  };
  await aufraeumen();
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=durchbrueche`);
    await page.getByTestId("db-neu").click({ timeout: 30000 });
    await expect(page.getByTestId("db-schott-form")).toHaveCount(0);
    await page.getByTestId("db-form-art").selectOption("kernbohrung");
    await page.getByTestId("db-form-d_mm").fill("150");
    await page.getByTestId("db-form-feuerwiderstand").selectOption("EI 90");
    await expect(page.getByTestId("db-schott-form")).toBeVisible();
    await page.getByTestId("db-form-schott_klasse").selectOption("EI 60");
    await page.getByTestId("db-form-schott_system").fill("Rohrmanschette Muster");
    await page.getByTestId("db-form-schott_zulassung_nr").fill("Z-00.0-0000");
    await page.getByTestId("db-form-kommentar").fill(MARKE);
    await page.getByTestId("db-speichern").click();

    const holen = async () => (await (await request.get(`/api/entities/Durchbruch?project_id=${projekt.id}`)).json()).find((d) => d.kommentar === MARKE);
    await expect.poll(async () => (await holen())?.brandschott?.klasse ?? null, { timeout: 15000 }).toBe("EI 60");
    const d = await holen();
    expect(d.brandschott).toMatchObject({ system: "Rohrmanschette Muster", zulassung_art: "abZ", zulassung_nr: "Z-00.0-0000" });
    const zeile = page.locator(`[data-testid=db-zeile][data-nr="${d.nr}"]`);
    await expect(zeile.locator('[data-code="schott_schwaecher"]')).toBeVisible({ timeout: 15000 });
    await expect(zeile.locator('[data-code="abschottung_fehlt"]')).toHaveCount(0);
    await expect(zeile.getByTestId("db-schott")).toContainText("EI 60");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});

// 97-02: the generated hull wall has no stored object — its status and trade go into the ONE
// attribute table (bauteil_attribute_layer, id "hull-wall") and come back after a reload.
test("97-02 Hüllwand: Status und Gewerk in der Attribut-Tabelle", async ({ page, request }) => {
  test.setTimeout(180000);
  const NAME2 = "E2E Huellwand 9702";
  let id = null, modellId = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME2, build_kind: "sanierung", status: "concept" } })).json()).id;
    modellId = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [{ a: { x: -4, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, composite: "cavity", _idx: 1, status: "bestand" }] } })).json()).id;

    const oeffnen = async () => {
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME2)}&tab=bim`);
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click({ timeout: 60000 });
      // Auto windows lie over the wall's centre — dispatch the click on the wall group itself.
      await page.locator('[data-huellwand="0:0"]').first().dispatchEvent("click", {}, { timeout: 30000 });
      await expect(page.getByTestId("steckbrief")).toBeVisible({ timeout: 15000 });
    };
    await oeffnen();
    await page.getByTestId("el-zustand").selectOption("bestand");
    await page.getByTestId("sb-gewerk").selectOption("023");
    await expect.poll(async () => {
      const m = await (await request.get(`/api/entities/BimModel/${modellId}`)).json();
      const a = m.bauteil_attribute_layer?.attribute?.["hull-wall"] || {};
      return `${a.status}|${a.gewerk_lb}|${m.bauteil_attribute_layer?.v}`;
    }, { timeout: 20000 }).toBe("bestand|023|1");

    await oeffnen();
    await expect(page.getByTestId("el-zustand")).toHaveValue("bestand");
    await expect(page.getByTestId("sb-gewerk")).toHaveValue("023");

    // 97-04b: the section shows the hull's status (grey for Bestand) instead of the plain hatch.
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await expect(page.locator('[data-schnittwand][data-status="bestand"]').first()).toHaveAttribute("fill", "#9aa3ad");
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();

    // 97-05: existing wall with new insulation — status per layer, the others inherit.
    await page.locator('[data-wand="1"]').first().dispatchEvent("click");
    await expect(page.getByTestId("sb-schicht-2")).toHaveValue("");
    await page.getByTestId("sb-schicht-2").selectOption("neubau");
    await expect.poll(async () => {
      const m = await (await request.get(`/api/entities/BimModel/${modellId}`)).json();
      return JSON.stringify(m.customWalls?.[0]?.schicht_status || null);
    }, { timeout: 20000 }).toBe('{"2":"neubau"}');
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (modellId) await request.delete(`/api/entities/BimModel/${modellId}`);
    if (id) await request.delete(`/api/entities/Project/${id}`);
  }
});
