// Headless proof 108-12 (finding 15a-c of the 108-11 review) on the neutral test house "Review EFH 108" (fixtures/efh108.js:
// 11.40 × 10.20 m = 116.28 m²), storeys KG 2.75 / EG 2.90 / DG 2.90 + knee wall 0.75, gable roof 42°.
// The design record (BuildingComplex) is a page.route stub with the use of the site planning: unit mix 1 × EFH, parking key 2, 2 spaces
// planned (double carport); the autosave is captured, nothing is written to a real design record.
//
// 1. EFH in a project WITHOUT a type (108-12 review: the unit mix leads into the residential branch): the key figures show 1 dwelling and
//    2 parking spaces from the site planning (no "~" estimate), BGF ≈ 349 m² after DIN 277 with the basement (116 m²); the GFZ subtitle
//    names the full-storey area — 108-12 review: the attic at 42° / knee wall 0.75 fails the 2/3 rule of the roof geometry (about 66 %),
//    so GF = EG only, 116 m²; the panel "Baukörper" lists the heights per storey and the storey-height slider is locked ("je Geschoss")
//    until "Alle Geschosse gleich setzen" (then it shows its number); a dwelling count typed in by hand wins, drives the parking
//    requirement and lands in the autosave as `kennzahlen_hand`; a decimal is marked and not saved; emptying returns to the automatic value.
// 2. Flat roof without basement and without unit mix (project type "Wohnen"): everything as before — BGF = footprint × storeys without
//    subtitle, no per-storey list, slider free, dwellings as "~" estimate.
// 3. 108-12 review: flat roof with a uniform storey table 2.90/2.90 but a stale storeyHeight 3.0 (per-storey edits): slider 2.9, height 5.8 m.
// 4. 108-12 review: flat roof with differing storeys EG 2.90 / OG 3.20: height 6.1 m (sum of the table), list, slider locked.
// The project type is set per test and restored in `finally` (no API round trips in a hook: Playwright's 30-s hook timeout).
// Screenshots go to .planning/phases/108-efh-satteldach/tmp-e2e/108-12/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

const ORDNER = path.join(".planning", "phases", "108-efh-satteldach", "tmp-e2e", "108-12");
const URL_STUDIO = `/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=studio`;
const API = "/api/entities";

const GESCHOSSE = [
  { level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.9, kniestock_m: 0.75 },
];

const MPP = 0.05;
const px = (/** @type {number} */ xm, /** @type {number} */ ym) => ({ x: 300 + xm / MPP, y: 150 + ym / MPP });
const rechteck = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => [px(x0, y0), px(x1, y0), px(x1, y1), px(x0, y1)];
const KOMPLEX_BASIS = {
  id: "komplex-108-12",
  name: "EFH 108",
  location: { lat: 49.45, lng: 11.08, address: "Musterstraße 1" },
  site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: MPP, points: rechteck(0, 0, 30.5, 25.3) },
  site_area: 30.5 * 25.3,
  designated_areas: [{ id: "fp-1", type: "footprint", points: rechteck(9.0, 7.5, 20.4, 17.7) }],
  buildings: [],
};
/** The use of the site planning: one single-family house, parking key 2, double carport. */
const NUTZUNG_EFH = {
  unit_types: [{ id: "ut-efh", name: "EFH", area: 180, count: 1 }],
  parking: { total_spaces: 2, parking_key: 2, barrier_free_spaces: 0, ev_charging_stations: 0 },
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
 * Answers the design record from the stub and records every autosave body.
 * @param {import("@playwright/test").Page} page @param {Record<string, any>} komplex @returns {any[]} the captured save bodies
 */
function komplexStub(page, komplex) {
  /** @type {any[]} */
  const gespeichert = [];
  page.route(/\/api\/entities\/BuildingComplex(\?|\/|$)/, (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: [komplex] });
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* no body */ }
    gespeichert.push(body);
    return route.fulfill({ json: { ...body, id: komplex.id } });
  });
  return gespeichert;
}

/** The "Geschosshöhe" slider and its value text. @param {import("@playwright/test").Page} page */
function reglerGeschosshoehe(page) {
  const zeile = page.locator('div:has(> div > span:text-is("Geschosshöhe"))').first();
  return { regler: zeile.locator('> input[type="range"]'), wert: zeile.locator("> div > span").nth(1) };
}

/**
 * Sets the project type for one test and restores the old value afterwards (also when the test fails).
 * @param {import("@playwright/test").APIRequestContext} request @param {{id: string, type?: any}} projekt @param {string|null} typ
 * @param {() => Promise<void>} fn
 */
async function mitProjektTyp(request, projekt, typ, fn) {
  const vorher = projekt.type ?? null;
  const r = await request.put(`${API}/Project/${projekt.id}`, { data: { type: typ } });
  expect(r.ok()).toBeTruthy();
  try { await fn(); } finally { await request.put(`${API}/Project/${projekt.id}`, { data: { type: vorher } }); }
}

test.describe("108-12 Massing-Kennzahlen fürs EFH", () => {
  test.setTimeout(240000);

  test.beforeAll(() => { fs.mkdirSync(ORDNER, { recursive: true }); });

  test("EFH: 1 WE, 2 Stellplätze, BGF mit Keller, Höhen je Geschoss, Wert von Hand", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request, { geschosse: GESCHOSSE, storeyHeight: 2.9, untergeschosse: 1, dachneigung: 42 });
    // 108-12 review: no project type - the unit mix of the site planning alone makes it a dwelling project
    await mitProjektTyp(request, projekt, null, async () => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const gespeichert = komplexStub(page, { ...KOMPLEX_BASIS, ...NUTZUNG_EFH });
    const warnungen = wache(page);
    await page.goto(URL_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });

    // 15a: dwellings and parking from the use of the site planning, no "~" estimate
    const we = page.getByTestId("ms-kpi-wohneinheiten");
    const stpl = page.getByTestId("ms-kpi-stellplaetze");
    await expect(we).toContainText("1", { timeout: 30000 });
    await expect(we).not.toContainText("~");
    await expect(we).toContainText("Wohnungsmix der Baufeld-Planung");
    await expect(stpl).toContainText("Schlüssel 2 je WE (Baufeld-Planung)");
    await expect(stpl).toContainText("geplant 2");
    await expect(stpl.locator("div").nth(1)).toHaveText("2");
    await expect(we.locator("div").nth(1)).toHaveText("1");

    // 15c: BGF after DIN 277 with the basement, GFZ area of the full storeys named separately
    const bgf = page.getByTestId("ms-kpi-bgf");
    await expect(bgf).toContainText("349 m²");
    await expect(bgf).toContainText("davon Untergeschoss 116 m²");
    await expect(page.getByTestId("ms-kpi-gfz")).toContainText("GF 116 m² (Vollgeschosse, BauNVO § 20; oberstes Geschoss kein Vollgeschoss nach Dachgeometrie)");
    await expect(page.getByTestId("ms-kpi-gfz")).toContainText("0.15"); // 116.28 / (30.5 × 25.3) m²

    // 15b: heights per storey, slider locked until unlocked on purpose
    await expect(page.getByTestId("ms-geschosshoehen")).toContainText("KG 2,75 · EG 2,90 · DG 2,90 + Kniestock 0,75");
    const { regler, wert } = reglerGeschosshoehe(page);
    await expect(regler).toBeDisabled();
    await expect(wert).toHaveText("je Geschoss");
    await page.screenshot({ path: path.join(ORDNER, "108-12-efh.png"), fullPage: false });
    await page.getByTestId("ms-geschosshoehe-frei").click();
    await expect(regler).toBeEnabled();
    await expect(page.getByTestId("ms-geschosshoehe-hinweis")).toContainText("Der Regler setzt alle Geschosse auf einen Wert");
    await expect(wert).toHaveText("2.9 m"); // unlocked: the number it sets, no longer "je Geschoss"

    // hand value wins, drives the parking requirement (2 × key 2) and is saved with the design record
    const weHand = page.getByTestId("ms-we-hand");
    await expect(weHand).toHaveAttribute("placeholder", "automatisch 1");
    await weHand.fill("2");
    await expect(we.locator("div").nth(1)).toHaveText("2");
    await expect(we).toContainText("von Hand eingegeben");
    await expect(stpl.locator("div").nth(1)).toHaveText("4");
    await expect.poll(() => gespeichert.some((b) => b?.kennzahlen_hand?.wohneinheiten === 2 && b.kennzahlen_hand.stellplaetze === null), { timeout: 15000 }).toBe(true);
    const stplHand = page.getByTestId("ms-stpl-hand");
    await stplHand.fill("3");
    await expect(stpl.locator("div").nth(1)).toHaveText("3");
    await expect(stpl).toContainText("von Hand eingegeben");
    // a decimal is marked and NOT saved (before it was rounded silently); leaving the field drops the draft
    await expect.poll(() => gespeichert.some((b) => b?.kennzahlen_hand?.stellplaetze === 3), { timeout: 15000 }).toBe(true);
    const gespeichertVorher = gespeichert.length;
    await stplHand.fill("1.4");
    await expect(page.getByTestId("ms-hand-ungueltig")).toBeVisible();
    await expect(stpl.locator("div").nth(1)).toHaveText("3");
    await expect(stplHand).toHaveValue("1.4");
    await page.waitForTimeout(2500); // longer than the 1.5-s autosave debounce: nothing may be saved for the invalid draft
    expect(gespeichert.slice(gespeichertVorher).every((b) => b?.kennzahlen_hand?.stellplaetze === 3)).toBe(true);
    await stplHand.blur();
    await expect(page.getByTestId("ms-hand-ungueltig")).toHaveCount(0);
    await expect(stplHand).toHaveValue("3");
    // emptying both returns to the automatic values and saves null
    await weHand.fill("");
    await stplHand.fill("");
    await expect(we.locator("div").nth(1)).toHaveText("1");
    await expect(stpl.locator("div").nth(1)).toHaveText("2");
    await expect.poll(() => gespeichert.length > 0 && gespeichert[gespeichert.length - 1]?.kennzahlen_hand === null, { timeout: 15000 }).toBe(true);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
    });
  });

  test("Flachdach ohne Keller und ohne Wohnungsmix: Kennzahlen wie bisher", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request, {
      geschosse: [{ level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "OG", hoehe_m: 2.9 }], storeyHeight: 2.9, untergeschosse: 0, dachform: "flach",
    });
    // dwellings without a unit mix exist only for a residential project (72-01 A-5)
    await mitProjektTyp(request, projekt, "residential", async () => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    komplexStub(page, { ...KOMPLEX_BASIS });
    const warnungen = wache(page);
    await page.goto(URL_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });

    const bgf = page.getByTestId("ms-kpi-bgf");
    await expect(bgf).toContainText("233 m²", { timeout: 30000 });
    await expect(bgf).not.toContainText("DIN 277");
    await expect(page.getByTestId("ms-kpi-gfz")).not.toContainText("BauNVO");
    await expect(page.getByTestId("ms-geschosshoehen")).toHaveCount(0);
    const { regler, wert } = reglerGeschosshoehe(page);
    await expect(regler).toBeEnabled();
    await expect(regler).toHaveValue("2.9");
    await expect(wert).toHaveText("2.9 m");
    await expect(page.getByTestId("ms-kpi-wohneinheiten").locator("div").nth(1)).toHaveText(/^~\d+$/);
    await expect(page.getByTestId("ms-kpi-wohneinheiten")).toContainText("[ASSUMED]");
    await expect(page.getByTestId("ms-kpi-hoehe")).toContainText("5.8 m");
    expect(warnungen, warnungen.join("\n")).toEqual([]);
    });
  });

  test("Flachdach, gleiche Tabelle 2,90/2,90 bei storeyHeight 3,0: Regler 2,9, Höhe 5,8 m", async ({ page, request }) => {
    await efhZuruecksetzen(request, {
      geschosse: [{ level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "OG", hoehe_m: 2.9 }], storeyHeight: 3, untergeschosse: 0, dachform: "flach",
    });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    komplexStub(page, { ...KOMPLEX_BASIS });
    const warnungen = wache(page);
    await page.goto(URL_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });

    const { regler, wert } = reglerGeschosshoehe(page);
    await expect(page.getByTestId("ms-kpi-hoehe")).toContainText("5.8 m", { timeout: 30000 });
    await expect(regler).toBeEnabled();
    await expect(regler).toHaveValue("2.9");
    await expect(wert).toHaveText("2.9 m");
    await expect(page.getByTestId("ms-geschosshoehen")).toHaveCount(0);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Flachdach, ungleiche Tabelle EG 2,90 / OG 3,20: Höhe 6,1 m aus der Tabelle, Regler gesperrt", async ({ page, request }) => {
    await efhZuruecksetzen(request, {
      geschosse: [{ level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "OG", hoehe_m: 3.2 }], storeyHeight: 2.9, untergeschosse: 0, dachform: "flach",
    });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    komplexStub(page, { ...KOMPLEX_BASIS });
    const warnungen = wache(page);
    await page.goto(URL_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 90000 });

    await expect(page.getByTestId("ms-kpi-hoehe")).toContainText("6.1 m", { timeout: 30000 });
    await expect(page.getByTestId("ms-geschosshoehen")).toContainText("EG 2,90 · OG 3,20");
    const { regler, wert } = reglerGeschosshoehe(page);
    await expect(regler).toBeDisabled();
    await expect(wert).toHaveText("je Geschoss");
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
