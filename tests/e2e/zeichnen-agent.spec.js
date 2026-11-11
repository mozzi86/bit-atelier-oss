// Click paths of the drawing agent: numeric wall, opening, slab, zone, copy storey,
// delete, undo/redo from a toolbar button, Esc on the wall tool, per-storey counts,
// massing corners, and a double-click that must not eat the footprint.
// Own project (not the shared test house). The optional harness on :8765 must not
// log a connection error.
import { test, expect } from "@playwright/test";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Zeichnen Agent";

/** @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (/WebGL|GPU stall|wasm/i.test(text)) return;
    if (/8765|ERR_CONNECTION_REFUSED/i.test(text)) { warnungen.push(text); return; }
    if (/ERR_|net::|Failed to fetch|tiles\.|openfreemap|elevation-tiles|AbortError/i.test(text)) return;
    warnungen.push(text);
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** @param {import("@playwright/test").Page} page @param {import("@playwright/test").APIRequestContext} request */
async function studio(page, request) {
  await nurLocalhost(page);
  const warnungen = wache(page);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) {
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [] } });
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
  await expect(page.getByTestId("bim-speicher")).not.toHaveAttribute("data-zustand", "loading", { timeout: 60000 });
  await page.getByTestId("bim-ansicht-grundriss").click();
  await expect(page.getByTestId("bim-masszeile")).toBeVisible();
  return warnungen;
}

test.describe("Zeichen-Agent: Klickwege", () => {
  test.setTimeout(180000);

  test("Doppelklick mit dem Pfeil lässt den Grundriss vollständig", async ({ page, request }) => {
    const warnungen = await studio(page, request);
    const huelle = page.locator("[data-huellwand]").first();
    await expect(huelle).toBeVisible();
    const vorher = await page.evaluate(() => window.bitApi.grundriss().length);
    expect(vorher).toBeGreaterThanOrEqual(3);
    await huelle.dblclick({ force: true });
    expect(await page.evaluate(() => window.bitApi.grundriss().length)).toBe(vorher);
    expect(warnungen.filter((w) => /8765|ERR_CONNECTION_REFUSED/i.test(w)), warnungen.join(" | ")).toEqual([]);
  });

  test("Wand per Maß, Rückgängig und Wiederholen von einem Knopf aus, Esc nur die angefangene Wand", async ({ page, request }) => {
    await studio(page, request);
    await page.getByTestId("bim-werkzeug-wall").click();
    await page.getByTestId("wand-laenge").fill("6");
    await page.getByTestId("wand-winkel").fill("0");
    await page.getByTestId("wand-dicke").fill("0.24");
    await page.getByTestId("wand-setzen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    await expect(page.getByTestId("wand-dicke-feld")).toHaveValue("0.24");
    await page.getByTestId("wand-dicke-feld").fill("36");
    await page.getByTestId("wand-dicke-feld").press("Enter");
    await expect(page.getByTestId("wand-dicke-feld")).toHaveValue("0.6");
    await page.getByTestId("bim-plan").click({ position: { x: 24, y: 24 }, force: true });
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("wand-dicke-feld")).toHaveValue("0.24");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    await page.getByTestId("bim-werkzeug-column").click();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "0");
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+Shift+Z");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");

    await page.getByTestId("bim-werkzeug-wall").click();
    await expect(page.getByTestId("bim-werkzeug-wall")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("bim-plan").click({ position: { x: 140, y: 100 }, force: true });
    await expect(page.getByTestId("bim-entwurf")).toHaveAttribute("data-punkte", "1");
    // Focus sits on the page (main) after the canvas click, not on the tool button.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bim-entwurf")).toHaveAttribute("data-punkte", "0");
    await expect(page.getByTestId("bim-werkzeug-wall")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bim-werkzeug-arrow")).toHaveAttribute("aria-pressed", "true");
  });

  test("Zähler gelten für das Geschoss, Geschoss kopieren, Öffnung, Decke, Raum, Löschen", async ({ page, request }) => {
    await studio(page, request);
    await page.getByTestId("bim-werkzeug-wall").click();
    await page.getByTestId("wand-setzen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    await page.getByTestId("geschoss-kopieren-ausfuehren").click();
    await page.getByTestId("bim-geschoss").selectOption("1");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-geschoss", "1");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    await page.getByTestId("bim-geschoss").selectOption("0");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");

    await page.getByTestId("bim-werkzeug-window").click();
    await page.getByTestId("oeffnung-wand").selectOption({ index: 1 });
    await page.getByTestId("oeffnung-versatz").fill("2");
    await page.getByTestId("oeffnung-breite").fill("1.2");
    await page.getByTestId("oeffnung-hoehe").fill("1.4");
    await page.getByTestId("oeffnung-bruestung").fill("0.9");
    await page.getByTestId("oeffnung-setzen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-fenster", "1");
    await expect(page.getByTestId("oeffnung-width")).toHaveValue("1.2");
    await expect(page.getByTestId("oeffnung-u")).toHaveValue("2");

    await page.getByTestId("bim-werkzeug-slab").click();
    await page.getByTestId("decke-setzen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-decken", "1");
    await page.getByTestId("bim-werkzeug-zone").click();
    await page.getByTestId("zone-name").fill("Wohnen");
    await page.getByTestId("zone-setzen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-raeume", "1");

    await page.getByTestId("bim-geschosse").selectOption("3");
    await expect(page.getByTestId("bim-geschoss").locator("option")).toHaveCount(3);

    await page.getByTestId("bim-loeschen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-raeume", "0");

    await page.getByTestId("bim-werkzeug-oeffnung").click();
    await expect(page.getByTestId("oeffnung-setzen")).toBeVisible();
    await page.getByTestId("bim-ansicht-3d").click();
    await expect(page.getByTestId("bim-geschoss")).toBeVisible();
    await expect(page.getByTestId("geschoss-kopieren")).toBeVisible();
    await expect(page.getByTestId("wand-setzen")).toHaveCount(0);

    const api = await page.evaluate(async () => {
      const wand = await window.bitApi.wandRichtung({ start: { x: 1, z: 1 }, laenge_m: 4, winkel_grad: 90, level: 0, thickness_m: 0.24 });
      const nachWand = window.bitApi.zaehlen(0);
      const tuer = await window.bitApi.oeffnung({ wandId: wand.element.id, kind: "door", versatz_m: 1.2 });
      const nachTuer = window.bitApi.zaehlen(0);
      return {
        hatModell: Object.prototype.hasOwnProperty.call(wand, "modell"),
        id: wand.element && wand.element.id,
        idx: wand.element && wand.element._idx,
        nachWand, tuerOk: tuer.ok, nachTuer,
      };
    });
    expect(api.hatModell).toBe(false);
    expect(api.id).toBeTruthy();
    expect(api.idx).toBe(api.id);
    expect(api.nachWand.waende).toBeGreaterThanOrEqual(1);
    expect(api.tuerOk).toBe(true);
    expect(api.nachTuer.tueren).toBeGreaterThanOrEqual(1);
    expect(api.nachTuer.oeffnungen).toBe(0);
  });

  test("Massing: Ecke per Zahl, Strg+Z stellt sie zurück", async ({ page, request }) => {
    await nurLocalhost(page);
    const vorhanden = await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json();
    if (!Array.isArray(vorhanden) || !vorhanden.length) {
      const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [] } });
    }
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("ms-ecken")).toBeVisible({ timeout: 60000 });
    const vorher = await page.getByTestId("ms-ecke-x-0").inputValue();
    const neu = String(Math.round((Number(vorher) + 1.25) * 100) / 100);
    await page.getByTestId("ms-ecke-x-0").fill(neu);
    await page.getByTestId("ms-ecken-uebernehmen").click();
    await expect(page.getByTestId("ms-ecke-x-0")).toHaveValue(neu);
    await page.getByRole("button", { name: "Verkleinern" }).click();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("ms-ecke-x-0")).toHaveValue(vorher);
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("ms-ecke-x-0")).toHaveValue(neu);
  });

  test("Zeiten: Rückgängig, Löschen und der Massing-Reiter", async ({ page, request }) => {
    await studio(page, request);
    await page.getByTestId("bim-werkzeug-wall").click();
    await page.getByTestId("wand-setzen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    const undoStart = Date.now();
    await page.getByTestId("bim-undo").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "0");
    const undoMs = Date.now() - undoStart;
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "1");
    const loeschStart = Date.now();
    await page.getByTestId("bim-loeschen").click();
    await expect(page.getByTestId("bim-zaehler")).toHaveAttribute("data-waende", "0");
    const loeschMs = Date.now() - loeschStart;
    const tabStart = Date.now();
    await page.getByRole("tab", { name: "Massing-Studio" }).click();
    await expect(page.getByTestId("mm-leiste")).toBeVisible();
    const tabMs = Date.now() - tabStart;
    console.log(`ZEIT undo=${undoMs} loeschen=${loeschMs} massing=${tabMs}`);
    expect(undoMs).toBeLessThan(8000);
    expect(loeschMs).toBeLessThan(8000);
    expect(tabMs).toBeLessThan(8000);
  });
});
