// Headless proof 108-08 on the neutral test house "Review EFH 108" (fixtures/efh108.js: 11.40 × 10.20 m, KG/EG/DG, gable roof 45°,
// here with a knee wall 0.75 m at the DG). The design record (BuildingComplex) is a page.route stub (like gelaende-103): a parcel of
// ~30.5 × 25.3 m, the footprint area of the site planning at x 9.0–20.4 m / y 7.5–17.7 m and a building envelope (Baufeld).
//
// 1. Finding 12: opening the designer and switching tabs (Gebäudemodell → Massing-Studio → Baufeld-Planung → Gebäudemodell) leaves
//    storeys, untergeschosse and geschosse (incl. kniestock_m) of the record unchanged — no fallback value is ever written.
// 2. D-EFH-09: the massing body starts inside the parcel at the position of the site planning ("außerhalb des Baufelds" = 0 m²);
//    moved by dragging it keeps its position after a reload (programme field footprintLageM).
// 3. 108-08 review: the massing undo stays saved - arrow key on a corner, Ctrl+Z, Ctrl+Y and a dragged move + undo each end with the
//    record of the screen (Ctrl+Z to the opened state restores footprintM and footprintLageM exactly).
// 4. 108-08 review: without a footprint area the body starts at the first block of the site planning, without both at the parcel centre.
// Screenshots go to .planning/phases/108-efh-satteldach/tmp-e2e/108-08/. Own project, reset before every test.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ERLAUBT_OFFLINE, nurLocalhost, punkte } from "./fixtures/massing.js";
import { EFH_PROJEKT, EFH_SOLL, efhZuruecksetzen } from "./fixtures/efh108.js";

const ORDNER = path.join(".planning", "phases", "108-efh-satteldach", "tmp-e2e", "108-08");
const URL_BIM = `/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=bim`;
const URL_STUDIO = `/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=studio`;

/** Storey table with a knee wall 0.75 m at the DG (the storey sequence of the target picture: KG high basement, EG, DG). */
const GESCHOSSE_KNIESTOCK = [
  { level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.6, kniestock_m: 0.75 },
];

// Design record in canvas px, 20 px per metre (m_per_px 0.05). Parcel 30.5 × 25.3 m from px (300, 150); the footprint area of the
// site planning lies at site metres x 9.0–20.4, y 7.5–17.7 (the house 11.40 × 10.20 m); the envelope x 3.0–27.5, y 3.0–22.3.
const MPP = 0.05;
const px = (/** @type {number} */ xm, /** @type {number} */ ym) => ({ x: 300 + xm / MPP, y: 150 + ym / MPP });
const rechteck = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => [px(x0, y0), px(x1, y0), px(x1, y1), px(x0, y1)];
const KOMPLEX = {
  id: "komplex-108-08",
  name: "EFH 108",
  location: { lat: 49.45, lng: 11.08, address: "Musterstraße 1" },
  site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: MPP, points: rechteck(0, 0, 30.5, 25.3) },
  site_area: 30.5 * 25.3,
  designated_areas: [
    { id: "fp-1", type: "footprint", points: rechteck(9.0, 7.5, 20.4, 17.7) },
    { id: "bf-1", type: "baufeld", points: rechteck(3.0, 3.0, 27.5, 22.3) },
  ],
  buildings: [],
};

/** Console errors and warnings except the known offline / WebGL noise. @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/**
 * Answers the design record from the stub (GET) and swallows every autosave.
 * @param {import("@playwright/test").Page} page @param {() => any} [komplex] the record to answer (default KOMPLEX)
 */
async function komplexStub(page, komplex = () => KOMPLEX) {
  await page.route(/\/api\/entities\/BuildingComplex(\?|\/|$)/, (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: [komplex()] });
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* no body */ }
    return route.fulfill({ json: { ...body, id: KOMPLEX.id } });
  });
}

/** Every write of a programme field to the BimModel record (for the report when the record changes). @param {import("@playwright/test").Page} page */
function schreibProtokoll(page) {
  /** @type {any[]} */
  const schreibvorgaenge = [];
  page.on("request", (r) => {
    if (!/\/api\/entities\/BimModel/.test(r.url()) || !["PUT", "PATCH", "POST"].includes(r.method())) return;
    try {
      const d = JSON.parse(r.postData() || "{}");
      const felder = ["storeys", "untergeschosse", "geschosse", "footprintM", "footprintLageM"].filter((k) => k in d);
      if (felder.length) schreibvorgaenge.push(Object.fromEntries(felder.map((k) => [k, d[k]])));
    } catch { /* not JSON */ }
  });
  return schreibvorgaenge;
}

/** The stored record of the test house. @param {import("@playwright/test").APIRequestContext} request @param {string} projektId */
async function datensatz(request, projektId) {
  const r = await request.get(`/api/entities/BimModel?project_id=${encodeURIComponent(projektId)}`);
  return (await r.json())[0];
}

/**
 * bbox of the massing body in site metres, read back from the SVG (float noise below 1 cm rounded away).
 * @param {import("@playwright/test").Page} page @returns {Promise<{x0:number,x1:number,y0:number,y1:number}>}
 */
async function bboxSite(page) {
  const p = await punkte(page);
  const xs = (p?.pts || []).map((q) => q.x), ys = (p?.pts || []).map((q) => q.y);
  const r = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return { x0: r(Math.min(...xs)), x1: r(Math.max(...xs)), y0: r(Math.min(...ys)), y1: r(Math.max(...ys)) };
}

/** Clicks a designer tab by its label. @param {import("@playwright/test").Page} page @param {string} name */
async function reiter(page, name) {
  const tab = page.getByRole("tab", { name: new RegExp(name) }).first();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test.describe("108-08 Massing-Lage und Geschosszahl", () => {
  test.setTimeout(300000);
  test.beforeAll(() => { fs.mkdirSync(ORDNER, { recursive: true }); });

  test("Punkt 12: Reiterwechsel ändert Geschosszahl, Untergeschosse und Kniestock nicht", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request, { geschosse: GESCHOSSE_KNIESTOCK });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    const schreib = schreibProtokoll(page);

    await page.goto(URL_BIM);
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 90000 });
    for (const name of ["Massing-Studio", "Baufeld-Planung", "Gebäudemodell", "Massing-Studio", "Gebäudemodell"]) {
      await reiter(page, name);
      await page.waitForTimeout(800);
    }
    // the write-back of the programme fields is debounced (1.5 s, three attempts)
    await page.waitForTimeout(4000);
    const m = await datensatz(request, projekt.id);
    const ist = { storeys: m.storeys, untergeschosse: m.untergeschosse, geschosse: m.geschosse };
    const soll = { storeys: EFH_SOLL.storeys, untergeschosse: EFH_SOLL.untergeschosse, geschosse: GESCHOSSE_KNIESTOCK };
    expect(ist, `Datensatz geändert; Schreibvorgänge: ${JSON.stringify(schreib)}`).toEqual(soll);
    // no write of the programme storeys at all (nobody changed them)
    expect(schreib.filter((s) => "storeys" in s || "untergeschosse" in s || "geschosse" in s), JSON.stringify(schreib)).toEqual([]);

    // a fresh deep link straight into the massing studio (mounted before the record is loaded)
    await page.goto(URL_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(4000);
    const m2 = await datensatz(request, projekt.id);
    expect({ storeys: m2.storeys, untergeschosse: m2.untergeschosse, geschosse: m2.geschosse }, JSON.stringify(schreib)).toEqual(soll);
    await page.screenshot({ path: path.join(ORDNER, "punkt12-studio.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Punkt 12: Rückgängig im Gebäudemodell setzt die Geschosszahl eines anderen Geräts nicht zurück", async ({ page, request }) => {
    // the state before the other device: 1 storey, no basement, no storey table (the "storeys 1" of the finding)
    const { projekt, modell } = await efhZuruecksetzen(request, { storeys: 1, untergeschosse: 0, geschosse: null });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    await page.goto(URL_BIM);
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("1", { timeout: 90000 });
    await page.waitForTimeout(2000);
    // a local step in the studio: the automatic entrance on (the house has its own door, so it starts off; one undo step)
    await expect(page.getByTestId("eingang-auto")).not.toBeChecked();
    await page.getByTestId("eingang-auto").setChecked(true);
    await page.waitForTimeout(3000);
    // another device (an agent, a second window) sets the storey sequence KG / EG / DG with knee wall
    const fremd = { storeys: 2, untergeschosse: 1, geschosse: GESCHOSSE_KNIESTOCK };
    const r = await request.put(`/api/entities/BimModel/${modell.id}`, { data: fremd });
    expect(r.ok()).toBeTruthy();
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 20000 });
    await expect(page.getByTestId("untergeschosse")).toHaveValue("1");
    // undo of the local step: the entrance is off again, the storeys of the other device stay
    await page.getByTestId("bim-undo").click({ timeout: 10000 });
    await expect(page.getByTestId("eingang-auto")).not.toBeChecked();
    await page.waitForTimeout(4000);
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2");
    const m = await datensatz(request, projekt.id);
    expect({ storeys: m.storeys, untergeschosse: m.untergeschosse, geschosse: m.geschosse }).toEqual(fremd);
    await page.screenshot({ path: path.join(ORDNER, "punkt12-rueckgaengig.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Review: Massing-Undo und -Redo werden gespeichert (Pfeiltaste, Ziehen)", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request, { geschosse: GESCHOSSE_KNIESTOCK });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    const vorher = await datensatz(request, projekt.id);
    const lageVorher = vorher.footprintLageM ?? null;

    await page.goto(URL_STUDIO);
    const flaeche = page.locator('polygon[data-griff="flaeche"]');
    await expect(flaeche).toBeVisible({ timeout: 90000 });
    const START = JSON.stringify({ x0: 9, x1: 20.4, y0: 7.5, y1: 17.7 });
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 30000 }).toBe(START);
    await page.waitForTimeout(2000);
    /** footprintM + footprintLageM of the record @returns {Promise<string>} */
    const form = async () => { const m = await datensatz(request, projekt.id); return JSON.stringify([m.footprintM, m.footprintLageM ?? null]); };
    const AUSGANG = JSON.stringify([EFH_SOLL.footprintM, lageVorher]);
    expect(await form()).toBe(AUSGANG);

    // 1. the first step after opening: an arrow key on a corner (1 m west) - saved
    await page.locator('[data-griff="ecke"]').nth(0).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(form, { timeout: 15000 }).not.toBe(AUSGANG);
    await page.waitForTimeout(2000); // the write-back is debounced: the record must have settled
    const nachSchritt = await form();
    const bboxSchritt = JSON.stringify(await bboxSite(page));
    expect(bboxSchritt).not.toBe(START);
    // 2. Ctrl+Z back to the opened state: screen AND record are the starting state (shape and position, null for an old record)
    await page.keyboard.press("Control+z");
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 10000 }).toBe(START);
    await expect.poll(form, { timeout: 15000 }).toBe(AUSGANG);
    // 3. Ctrl+Y: the step again, saved
    await page.keyboard.press("Control+y");
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 10000 }).toBe(bboxSchritt);
    await expect.poll(form, { timeout: 15000 }).toBe(nachSchritt);
    await page.keyboard.press("Control+z");
    await expect.poll(form, { timeout: 15000 }).toBe(AUSGANG);

    // 4. a dragged move (about 3 m east, 2 m south) and its undo
    const p0 = await punkte(page);
    const box = await flaeche.boundingBox();
    if (!box || !p0) throw new Error("Baukörper nicht gefunden");
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 3 * p0.pxPerM, cy + 2 * p0.pxPerM, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await datensatz(request, projekt.id)).footprintLageM ?? null), { timeout: 15000 }).not.toBe(JSON.stringify(lageVorher));
    expect((await datensatz(request, projekt.id)).footprintM).toEqual(EFH_SOLL.footprintM);
    await page.locator("[data-undo]").click();
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 10000 }).toBe(START);
    await expect.poll(form, { timeout: 15000 }).toBe(AUSGANG);

    // 5. the reload shows the undone state (the record is the truth, not the screen)
    await page.reload();
    await expect(flaeche).toBeVisible({ timeout: 90000 });
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 30000 }).toBe(START);
    await page.screenshot({ path: path.join(ORDNER, "undo-gespeichert.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Review: Startlage aus dem ersten Block, sonst Parzellenmitte", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request, { geschosse: GESCHOSSE_KNIESTOCK });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const ohneFlaeche = KOMPLEX.designated_areas.filter((a) => a.type !== "footprint");
    // one block of the site planning in canvas px: 11.40 x 10.20 m with its top-left corner at site metres (5, 4) -> centre (10.7, 9.1)
    const ecke = px(5, 4);
    let komplex = { ...KOMPLEX, designated_areas: ohneFlaeche, buildings: [{ id: "block-1", name: "Block 1", x: ecke.x, y: ecke.y, width: 11.4 / MPP, height: 10.2 / MPP }] };
    await komplexStub(page, () => komplex);
    const warnungen = wache(page);
    const schreib = schreibProtokoll(page);

    await page.goto(URL_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 30000 }).toBe(JSON.stringify({ x0: 5, x1: 16.4, y0: 4, y1: 14.2 }));
    await page.screenshot({ path: path.join(ORDNER, "lage-block.png") });

    // neither a footprint area nor a block: the parcel centre (15.25, 12.65)
    komplex = { ...KOMPLEX, designated_areas: ohneFlaeche, buildings: [] };
    await page.reload();
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });
    await expect.poll(async () => JSON.stringify(await bboxSite(page)), { timeout: 30000 }).toBe(JSON.stringify({ x0: 9.55, x1: 20.95, y0: 7.55, y1: 17.75 }));
    await page.screenshot({ path: path.join(ORDNER, "lage-parzellenmitte.png") });
    // an automatic placement writes nothing
    await page.waitForTimeout(3000);
    expect(schreib, JSON.stringify(schreib)).toEqual([]);
    expect((await datensatz(request, projekt.id)).footprintM).toEqual(EFH_SOLL.footprintM);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("D-EFH-09: Baukörper startet in der Parzelle an der Lage der Baufeld-Planung, Lage bleibt nach Neuladen", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request, { geschosse: GESCHOSSE_KNIESTOCK });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    let komplex = KOMPLEX;
    await komplexStub(page, () => komplex);
    const warnungen = wache(page);
    const schreib = schreibProtokoll(page);

    await page.goto(URL_STUDIO);
    const flaeche = page.locator('polygon[data-griff="flaeche"]');
    await expect(flaeche).toBeVisible({ timeout: 90000 });
    // the body sits on the footprint area of the site planning: x 9.0–20.4 m, y 7.5–17.7 m (never again at (35, 25))
    /** bbox of the body in site metres @returns {Promise<{x0:number,x1:number,y0:number,y1:number}>} */
    const bbox = async () => {
      const p = await punkte(page);
      const xs = (p?.pts || []).map((q) => q.x), ys = (p?.pts || []).map((q) => q.y);
      const r = (/** @type {number} */ v) => Math.round(v * 100) / 100; // read back from SVG coordinates: float noise below 1 cm
      return { x0: r(Math.min(...xs)), x1: r(Math.max(...xs)), y0: r(Math.min(...ys)), y1: r(Math.max(...ys)) };
    };
    await expect.poll(async () => JSON.stringify(await bbox()), { timeout: 30000 }).toBe(JSON.stringify({ x0: 9, x1: 20.4, y0: 7.5, y1: 17.7 }));
    const start = await bbox();
    expect(start.x0 >= 0 && start.x1 <= 30.5 && start.y0 >= 0 && start.y1 <= 25.3, JSON.stringify(start)).toBeTruthy();
    const kpi = page.getByTestId("ms-kpi-ausserhalb");
    await expect(kpi).toContainText("außerhalb des Baufelds");
    await expect(kpi).toContainText("0 m²");
    await expect(kpi).toContainText("innerhalb des Baufelds");
    await page.screenshot({ path: path.join(ORDNER, "lage-start.png") });
    // opening wrote nothing into the record
    await page.waitForTimeout(3000);
    expect(schreib, JSON.stringify(schreib)).toEqual([]);

    // move the body (drag the area) — about 3 m east and 2 m south
    const p0 = await punkte(page);
    const box = await flaeche.boundingBox();
    if (!box || !p0) throw new Error("Baukörper nicht gefunden");
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 3 * p0.pxPerM, cy + 2 * p0.pxPerM, { steps: 8 });
    await page.mouse.up();
    const verschoben = await bbox();
    expect(Math.abs(verschoben.x0 - start.x0) > 1, JSON.stringify(verschoben)).toBeTruthy();
    // the write-back (1.5 s) stores the position; storeys, basements and the table stay
    await expect.poll(async () => (await datensatz(request, projekt.id)).footprintLageM, { timeout: 15000 }).toBeTruthy();
    const m = await datensatz(request, projekt.id);
    expect({ storeys: m.storeys, untergeschosse: m.untergeschosse, geschosse: m.geschosse }).toEqual({ storeys: 2, untergeschosse: 1, geschosse: GESCHOSSE_KNIESTOCK });
    expect(m.footprintM).toEqual(EFH_SOLL.footprintM); // a pure move keeps the shape
    expect(m.footprintLageM.x).toBeCloseTo((verschoben.x0 + verschoben.x1) / 2 - 30.5 / 2, 1);
    expect(m.footprintLageM.z).toBeCloseTo((verschoben.y0 + verschoben.y1) / 2 - 25.3 / 2, 1);

    // reload: the body comes back where it was moved to (not to the area of the site planning)
    await page.reload();
    await expect(flaeche).toBeVisible({ timeout: 90000 });
    await expect.poll(async () => JSON.stringify(await bbox()), { timeout: 30000 }).toBe(JSON.stringify(verschoben));
    await page.screenshot({ path: path.join(ORDNER, "lage-nach-neuladen.png") });

    // without a drawn envelope the key figure is checked against the parcel
    komplex = { ...KOMPLEX, designated_areas: KOMPLEX.designated_areas.filter((a) => a.type !== "baufeld") };
    await page.reload();
    await expect(flaeche).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("ms-kpi-ausserhalb")).toHaveCount(0);
    const kpiP = page.getByTestId("ms-kpi-ausserhalb-parzelle");
    await expect(kpiP).toContainText("außerhalb der Parzelle");
    await expect(kpiP).toContainText("0 m²");
    await expect(kpiP).toContainText("innerhalb der Parzelle");
    await page.screenshot({ path: path.join(ORDNER, "lage-ohne-baufeld.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
