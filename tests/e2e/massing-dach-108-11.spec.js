// Headless proof 108-11 on the neutral test house "Review EFH 108" (fixtures/efh108.js: 11.40 × 10.20 m), here with the storey sequence of
// the target picture: KG 2.75 m, EG 2.90 m, DG 2.90 m with a knee wall 0.75 m, gable roof 42°. The design record (BuildingComplex) is a
// page.route stub: a parcel ~30.5 × 25.3 m with the footprint area of the site planning at x 9.0–20.4 m / y 7.5–17.7 m (the body starts
// there, 108-08).
//
// 1. Gable roof: the Massing-Studio shows the main body with the roof of the building model — the key figure "Höhe" names the ridge
//    (≈ 8.5 m, eaves 3.90 m), the gross volume tile appears, the setback figure names eaves and gable side with the gable assumption; in
//    the iso a point just below the ridge hits the roof mesh of the main body ("hauptdach"), a point on the wall below the eaves hits the
//    body, a point above the ridge hits nothing of the building (measured through the real camera, hooks __planZuBildschirm /
//    __artUnter); the small 3D massing model draws the same body to scale (data-dach, eaves and ridge measured on its drawn object);
//    the storey-height slider shows the storey height of the record (2.90 m, review fix: it follows the store).
// 2. Flat roof: the same house with dachform "flach" keeps the box of before (height = storeys × 2.90 m of the record, no volume tile,
//    no roof).
// 3. Shed roof 42° (review fix): the wedge above the low eaves is closed — a side triangle (wall infill above the eaves) is hit in the
//    iso, the small 3D model carries the shed roof, the setback figure names the high side. (The roof library caps the rise of a shed
//    roof at the full width, i.e. 45° on this house, so the surcharge case runs with a gable roof.)
// 4. Gable roof 50° (review fix): the setback figure adds 1/3 of the rise on the eaves sides and says so [ASSUMED].
// Screenshots go to .planning/phases/108-efh-satteldach/tmp-e2e/108-11/. Own project, reset before every test.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

const ORDNER = path.join(".planning", "phases", "108-efh-satteldach", "tmp-e2e", "108-11");
const URL_STUDIO = `/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=studio`;

/** KG high basement, EG, DG with knee wall 0.75 m (Nachtrag 05.11. of 108-RESEARCH: no upper floor). */
const GESCHOSSE = [
  { level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.9, kniestock_m: 0.75 },
];
/** Hand calculation (see tests/unit/massing-dach-10811.test.js): eaves 2.90 + 0.25 + 0.75 = 3.90 m, ridge 3.90 + 5.10 · tan 42° m. */
const TRAUFE = 3.9;
const FIRST = TRAUFE + 5.1 * Math.tan((42 * Math.PI) / 180);

const MPP = 0.05;
const px = (/** @type {number} */ xm, /** @type {number} */ ym) => ({ x: 300 + xm / MPP, y: 150 + ym / MPP });
const rechteck = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => [px(x0, y0), px(x1, y0), px(x1, y1), px(x0, y1)];
const KOMPLEX = {
  id: "komplex-108-11",
  name: "EFH 108",
  location: { lat: 49.45, lng: 11.08, address: "Musterstraße 1" },
  site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: MPP, points: rechteck(0, 0, 30.5, 25.3) },
  site_area: 30.5 * 25.3,
  designated_areas: [{ id: "fp-1", type: "footprint", points: rechteck(9.0, 7.5, 20.4, 17.7) }],
  buildings: [],
};
/** Middle of the body in site metres (footprint area of the stub). */
const MITTE = { x: 14.7, y: 12.6 };

/** Console errors and warnings except the known offline / WebGL noise. @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Answers the design record from the stub and swallows every autosave. @param {import("@playwright/test").Page} page */
async function komplexStub(page) {
  await page.route(/\/api\/entities\/BuildingComplex(\?|\/|$)/, (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: [KOMPLEX] });
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* no body */ }
    return route.fulfill({ json: { ...body, id: KOMPLEX.id } });
  });
}

/** The "Geschosshöhe" slider of the studio. @param {import("@playwright/test").Page} page */
function reglerGeschosshoehe(page) {
  return page.locator('div:has(> div > span:text-is("Geschosshöhe")) > input[type="range"]').first();
}

/** Opens the studio in the large iso view; returns the 3D wrapper. @param {import("@playwright/test").Page} page */
async function isoOeffnen(page) {
  await page.goto(URL_STUDIO);
  await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });
  await page.locator('[data-ansicht="3d"]').first().click();
  const mv = page.getByTestId("mv-3d").first();
  await expect(mv).toBeVisible({ timeout: 20000 });
  return mv;
}

test.describe("108-11 Massing-Studio: Satteldach des Gebäudemodells", () => {
  test.setTimeout(300000);
  test.beforeAll(() => { fs.mkdirSync(ORDNER, { recursive: true }); });

  test("Satteldach: Iso mit Dach, Höhe bis First, BRI, Abstandsflächen Traufe/Giebel", async ({ page, request }) => {
    await efhZuruecksetzen(request, { geschosse: GESCHOSSE, storeyHeight: 2.9, dachneigung: 42 });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    const mv = await isoOeffnen(page);

    // the prop-driven marks (readable without WebGL): roof form, eaves and ridge of the main body
    await expect(mv).toHaveAttribute("data-hauptdach", "sattel", { timeout: 30000 });
    await expect(mv).toHaveAttribute("data-traufe-m", TRAUFE.toFixed(2));
    await expect(mv).toHaveAttribute("data-first-m", FIRST.toFixed(2));

    // key figures: height = ridge, eaves as second value; gross volume with roof; setbacks per side kind with the visible assumption
    const hoehe = page.getByTestId("ms-kpi-hoehe");
    await expect(hoehe).toContainText(`${FIRST.toFixed(1)} m`);
    await expect(hoehe).toContainText(`Traufe ${TRAUFE.toFixed(2)} m`);
    await expect(page.getByTestId("ms-kpi-bri")).toContainText("m³");
    const abstand = page.getByTestId("ms-kpi-abstand");
    await expect(abstand).toContainText(`Traufe H ${TRAUFE.toFixed(2)}`);
    await expect(abstand).toContainText(`Giebel H ${(TRAUFE + (FIRST - TRAUFE) / 3).toFixed(2)}`);
    await expect(abstand).toContainText("[ASSUMED]");
    // the storey-height slider follows the record (review fix: no 3.0 m default next to a 2.90 m body)
    await expect(reglerGeschosshoehe(page)).toHaveValue("2.9");
    // the small 3D massing model draws the same body: eaves and ridge measured on its drawn object (bounding boxes of the meshes)
    const klein = page.locator('[data-dach="sattel"]');
    await expect(klein).toHaveCount(1);
    await expect(klein).toHaveAttribute("data-traufe-m", TRAUFE.toFixed(2));
    await expect(klein).toHaveAttribute("data-first-m", FIRST.toFixed(2));

    // measurement in the 3D object through the real camera (headless Chromium has WebGL through SwiftShader — no canvas is a failure)
    const gl = (await mv.locator("canvas").count()) > 0;
    expect(gl, "Iso ohne WebGL-Canvas: die Messung im 3D-Objekt ist nicht möglich").toBe(true);
    {
      const canvas = mv.locator("canvas").first();
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      const art = async (/** @type {{x: number, y: number, z: number}} */ p) => mv.evaluate((el, q) => {
        const s = /** @type {any} */ (el).__planZuBildschirm(q);
        return /** @type {any} */ (el).__artUnter(s.sx, s.sy);
      }, p);
      // 0.3 m below the ridge in the middle of the body: the roof of the main body (the old box ended at 5.8 m)
      expect(await art({ ...MITTE, z: FIRST - 0.3 })).toBe("hauptdach");
      // on the south eaves wall, 1 m above ground: the walls of the body
      expect(await art({ x: MITTE.x, y: 17.7, z: 1 })).toBe("baukoerper");
      // 1 m above the ridge: nothing of the building (the 30° iso ray stays above the 42° faces behind the ridge)
      expect(await art({ ...MITTE, z: FIRST + 1 })).toBe("");
    }
    await page.screenshot({ path: path.join(ORDNER, "satteldach-iso.png") });
    // closer look for the visual check: zoom the iso in two wheel steps on the body, then the small storey-stack viewer
    {
      const r = /** @type {any} */ (await mv.locator("canvas").first().boundingBox());
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(500); }
      await mv.screenshot({ path: path.join(ORDNER, "satteldach-iso-nah.png") });
    }
    await klein.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await klein.screenshot({ path: path.join(ORDNER, "satteldach-massenmodell-klein.png") });
    await page.locator('[data-ansicht="2d"]').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ORDNER, "satteldach-2d-kennzahlen.png"), fullPage: true });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Flachdach: Iso und Kennzahlen wie bisher (Quader, Höhe = Geschosse × Geschosshöhe, kein BRI)", async ({ page, request }) => {
    await efhZuruecksetzen(request, { geschosse: GESCHOSSE, storeyHeight: 2.9, dachform: "flach", dachneigung: 42 });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    const mv = await isoOeffnen(page);
    // load signal: the roof fields of the record arrived (a roof would be on the body now)
    await expect(page.locator('[data-modelldach="geladen"]')).toHaveCount(1, { timeout: 30000 });
    await expect(mv).toHaveAttribute("data-hauptdach", "");
    // height = storeys × storey height of the record (2 × 2.90 m), and the slider shows that storey height (review fix)
    await expect(reglerGeschosshoehe(page)).toHaveValue("2.9");
    await expect(page.getByTestId("ms-kpi-hoehe")).toContainText("5.8 m");
    await expect(page.getByTestId("ms-kpi-hoehe")).not.toContainText("Traufe");
    await expect(page.getByTestId("ms-kpi-bri")).toHaveCount(0);
    await expect(page.getByTestId("ms-kpi-abstand")).not.toContainText("Giebel");
    await expect(page.locator('[data-dach="sattel"]')).toHaveCount(0);
    expect((await mv.locator("canvas").count()) > 0, "Iso ohne WebGL-Canvas").toBe(true);
    {
      const art = await mv.evaluate((el, q) => {
        const s = /** @type {any} */ (el).__planZuBildschirm(q);
        return /** @type {any} */ (el).__artUnter(s.sx, s.sy);
      }, { ...MITTE, z: FIRST - 0.3 });
      expect(art).not.toBe("hauptdach");
    }
    await page.screenshot({ path: path.join(ORDNER, "flachdach-iso.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Pultdach 42°: Keil geschlossen (Seitendreieck = Körper), kleines 3D mit Pult, Hochseite", async ({ page, request }) => {
    await efhZuruecksetzen(request, { geschosse: GESCHOSSE, storeyHeight: 2.9, dachform: "pult", dachneigung: 42 });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    const mv = await isoOeffnen(page);
    await expect(mv).toHaveAttribute("data-hauptdach", "pult", { timeout: 30000 });
    await expect(mv).toHaveAttribute("data-traufe-m", TRAUFE.toFixed(2));
    // shed roof: rise over the whole width 10.20 m
    const hoch = TRAUFE + 10.2 * Math.tan((42 * Math.PI) / 180);
    await expect(mv).toHaveAttribute("data-first-m", hoch.toFixed(2));
    const klein = page.locator('[data-dach="pult"]');
    await expect(klein).toHaveCount(1);
    await expect(klein).toHaveAttribute("data-first-m", hoch.toFixed(2));
    const abstand = page.getByTestId("ms-kpi-abstand");
    await expect(abstand).toContainText(`Hochseite H ${hoch.toFixed(2)}`);
    await expect(abstand).not.toContainText("Dach über 45°");

    expect((await mv.locator("canvas").count()) > 0, "Iso ohne WebGL-Canvas").toBe(true);
    await mv.locator("canvas").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const art = async (/** @type {{x: number, y: number, z: number}} */ p) => mv.evaluate((el, q) => {
      const s = /** @type {any} */ (el).__planZuBildschirm(q);
      return /** @type {any} */ (el).__artUnter(s.sx, s.sy, true);
    }, p);
    // the two side triangles of the wedge (west x 9.0, east x 20.4), in the middle of the depth a quarter of the rise above the eaves
    // (inside the triangle whichever side is high). The iso looks from a corner, so one of them faces the camera: it must be the wall
    // infill above the eaves ("wand-ueber-traufe") — without the fix the ray went through the open end onto the top face of the wall
    // body ("baukoerper") or the underside of the roof ("hauptdach"); counter-checked with the infill switched off (SUMMARY).
    const z = TRAUFE + (hoch - TRAUFE) / 4;
    const enden = [await art({ x: 9.0, y: MITTE.y, z }), await art({ x: 20.4, y: MITTE.y, z })];
    expect(enden, `Seitendreiecke: ${enden.join(", ")}`).toContain("wand-ueber-traufe");
    await page.screenshot({ path: path.join(ORDNER, "pultdach-iso.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Satteldach 50°: Traufseite mit 1/3 des Anstiegs, Annahme sichtbar", async ({ page, request }) => {
    await efhZuruecksetzen(request, { geschosse: GESCHOSSE, storeyHeight: 2.9, dachneigung: 50 });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await komplexStub(page);
    const warnungen = wache(page);
    const mv = await isoOeffnen(page);
    const anstieg = 5.1 * Math.tan((50 * Math.PI) / 180);
    await expect(mv).toHaveAttribute("data-first-m", (TRAUFE + anstieg).toFixed(2), { timeout: 30000 });
    const abstand = page.getByTestId("ms-kpi-abstand");
    await expect(abstand).toContainText(`Traufe H ${(TRAUFE + anstieg / 3).toFixed(2)}`);
    await expect(abstand).toContainText("Dach über 45°: 1/3 des Anstiegs zur Wandhöhe [ASSUMED]");
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
