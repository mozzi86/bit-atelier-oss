// Headless proof 108-01 (small visible findings of the single-family house with gable roof, 108-RESEARCH §4, §5, §9) on the neutral
// test house "Review EFH 108" (fixtures/efh108.js: 11.40 × 10.20 m, KG/EG/DG, gable roof 45°, one own entrance door in the hull):
//  - 9c: the section starts as B-B (across the ridge), shows the cut roof plate (data-dachschnitt) and the marks Traufe +5.50 /
//    First +10.60 instead of "OK Dach"; A-A shows the plate along the ridge; the PDF of B-B is named "Schnitt_B-B";
//  - 9a: at 1400 × 900 no control of the studio header leaves the card; at 1400 × 1200 the floor plan is higher than the old 460 px
//    and ends inside the visible work area;
//  - 4: the automatic entrance is off (an own ground-floor door, `enabled` not stored) and no hint is shown;
//  - 9b: with every external request blocked the map shows "Karte offline".
//  Review 108-01: with the parapet switched on (the studio default) the mark "OK Attika" sits on the eaves (+6.50) below the ridge mark,
//  and a building envelope ("baufeld") without a footprint area is drawn dashed in the floor plan with the label that it has no position
//  reference (before it was not drawn at all).
// Screenshots go to .planning/phases/108-efh-satteldach/tmp-e2e/108-01/. Own project, reset before each test; the shared test house is
// not touched.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, EFH_SOLL, efhZuruecksetzen, efhKomplexSetzen } from "./fixtures/efh108.js";

const ORDNER = path.join(".planning", "phases", "108-efh-satteldach", "tmp-e2e", "108-01");

/** Console errors and warnings except the known offline / WebGL noise. @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Opens the BIM studio of the test house and waits for the 3D view. @param {import("@playwright/test").Page} page */
async function studioOeffnen(page) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 90000 });
  await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 90000 });
  // the record is loaded (the storey select shows the stored 2 storeys)
  await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 30000 });
}

test.describe("108-01 Kleine Befunde am EFH mit Satteldach", () => {
  test.setTimeout(300000);
  test.beforeAll(() => { fs.mkdirSync(ORDNER, { recursive: true }); });
  test.beforeEach(async ({ request }) => { await efhZuruecksetzen(request); });

  test("Schnitt B-B mit Dachdreieck, Kopfzeile bei 1400 px, Planhöhe, Eingang aus bei EG-Tür", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    await studioOeffnen(page);

    // ---- 4: own ground-floor door, `enabled` not stored → the automatic entrance is off, no hint ----
    await expect(page.getByTestId("eingang-auto")).not.toBeChecked();
    await expect(page.getByTestId("eingang-hinweis")).toHaveCount(0);

    // ---- 9a: every control of the header lies inside the card ----
    const ausserhalb = await page.evaluate(() => {
      const rechts = document.querySelector('[data-testid="bim-kopf-rechts"]');
      const kopf = /** @type {HTMLElement} */ (rechts?.parentElement);
      const karte = /** @type {HTMLElement} */ (kopf?.parentElement);
      if (!kopf || !karte) return ["Kopfzeile nicht gefunden"];
      const k = karte.getBoundingClientRect();
      /** @type {string[]} */
      const fehler = [];
      for (const el of kopf.querySelectorAll("button, select, input, a, label")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // hidden
        if (r.left < k.left - 0.5 || r.right > k.right + 0.5) fehler.push(`${el.tagName} „${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}“ ${Math.round(r.left)}…${Math.round(r.right)} außerhalb ${Math.round(k.left)}…${Math.round(k.right)}`);
      }
      return fehler;
    });
    expect(ausserhalb, ausserhalb.join("\n")).toEqual([]);
    await page.screenshot({ path: path.join(ORDNER, "kopfzeile-1400.png") });

    // ---- 9a: the floor plan fills the free height of the work area (measured below the studio header, never below the old 520 px).
    // At 900 px the designer leaves only about 360 px below header and footer bar, so the old minimum applies there; at 1200 px the
    // plan grows beyond the old 460 px SVG and still ends inside the visible work area.
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const planSvg = page.locator("[data-bim-plan2d] svg").first();
    await expect(planSvg).toBeVisible({ timeout: 30000 });
    await page.setViewportSize({ width: 1400, height: 1200 });
    await expect.poll(async () => planSvg.evaluate((el) => el.getBoundingClientRect().height), { timeout: 15000, message: "Plan-SVG höher als die alten 460 px" }).toBeGreaterThan(460);
    const lage = await page.evaluate(() => {
      const plan = /** @type {HTMLElement} */ (document.querySelector("[data-bim-plan2d]"));
      let p = plan.parentElement;
      while (p && p !== document.body && !["auto", "scroll"].includes(getComputedStyle(p).overflowY)) p = p.parentElement;
      const unten = p && p !== document.body ? p.getBoundingClientRect().bottom : window.innerHeight;
      return { plan: plan.getBoundingClientRect().bottom, sichtbar: unten };
    });
    expect(lage.plan, `Plan endet bei ${lage.plan} px, sichtbar bis ${lage.sichtbar} px`).toBeLessThanOrEqual(lage.sichtbar + 1);
    await page.screenshot({ path: path.join(ORDNER, "grundriss-1400x1200.png") });
    await page.setViewportSize({ width: 1400, height: 900 });

    // ---- 9c: the section starts as B-B (across the ridge along the 11.40 m side) with the roof triangle ----
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await expect(page.locator('[data-testid="schnitt-achse"] [data-achse="z"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-dachschnitt="z"]')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('[data-kote="traufe"]')).toHaveText("Traufe +5.50");
    await expect(page.locator('[data-kote="first"]')).toHaveText("First +10.60");
    await expect(page.locator("svg text", { hasText: "OK Dach" })).toHaveCount(0);
    // the roof plate is a closed path of six corners (triangle below, triangle above) reaching up to the ridge
    const ecken = await page.locator('[data-dachschnitt="z"]').evaluate((el) => (el.getAttribute("d") || "").split(/[ML]/).filter((x) => x.trim()).length);
    expect(ecken).toBe(6);
    await page.screenshot({ path: path.join(ORDNER, "schnitt-bb.png") });

    // ---- A-A: along the ridge, the plate is a horizontal band at ridge height ----
    await page.locator('[data-testid="schnitt-achse"] [data-achse="x"]').click();
    await expect(page.locator('[data-dachschnitt="x"]')).toHaveCount(1);
    await expect(page.locator('[data-kote="first"]')).toHaveText("First +10.60");
    await page.screenshot({ path: path.join(ORDNER, "schnitt-aa.png") });

    // ---- the PDF of B-B names the section in the stamp and the file name ----
    await page.locator('[data-testid="schnitt-achse"] [data-achse="z"]').click();
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click(); // the plan output sits in the folder panel
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("bim-plan-pdf").click()]);
    expect(d.suggestedFilename()).toMatch(/_Schnitt_B-B_1-\d+\.pdf$/);
    await d.saveAs(path.join(ORDNER, "schnitt-bb.pdf"));

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Karte: ohne erreichbare Kacheln erscheint „Karte offline“", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await nurLocalhost(page); // every tile and style request outside localhost fails
    const warnungen = wache(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=site`);
    await expect(page.locator(".maplibregl-map").first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("karte-offline").first()).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId("karte-offline").first()).toHaveText("Karte offline — Kacheln nicht erreichbar");
    await page.screenshot({ path: path.join(ORDNER, "karte-offline.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Satteldach mit eingeschalteter Attika: „OK Attika“ steht auf der Traufe, nicht am First", async ({ page, request }) => {
    await efhZuruecksetzen(request, { parapet: { enabled: true, height: 1 } });
    await page.setViewportSize({ width: 1400, height: 900 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    await studioOeffnen(page);
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await expect(page.locator('[data-dachschnitt="z"]')).toHaveCount(1, { timeout: 15000 });
    const attika = page.locator("[data-bim-plan2d] svg text", { hasText: "OK Attika" });
    await expect(attika).toHaveText("OK Attika +6.50"); // eaves 5.50 + parapet 1.00 (the PDF section says the same)
    await expect(page.locator('[data-kote="first"]')).toHaveText("First +10.60");
    const yAttika = await attika.evaluate((el) => el.getBoundingClientRect().top);
    const yFirst = await page.locator('[data-kote="first"]').evaluate((el) => el.getBoundingClientRect().top);
    const yTraufe = await page.locator('[data-kote="traufe"]').evaluate((el) => el.getBoundingClientRect().top);
    expect(yAttika, "OK Attika liegt unter der First-Kote").toBeGreaterThan(yFirst + 20);
    expect(yAttika, "OK Attika liegt über der Traufe-Kote").toBeLessThan(yTraufe);
    await page.screenshot({ path: path.join(ORDNER, "schnitt-bb-attika.png") });
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Baufeld ohne footprint-Fläche erscheint gestrichelt im Grundriss, der Umriss bleibt", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request);
    // a building envelope 20 × 14 m (16 × 11.2 px at 1.25 m/px), no area of type footprint
    await efhKomplexSetzen(request, projekt.id, {
      site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25,
        points: [{ x: 80, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 130 }, { x: 80, y: 130 }] },
      designated_areas: [{ id: "bf-108", type: "baufeld", points: [{ x: 100, y: 100 }, { x: 116, y: 100 }, { x: 116, y: 111.2 }, { x: 100, y: 111.2 }] }],
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    await studioOeffnen(page);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const bf = page.locator("[data-baufeld-umriss]");
    await expect(bf).toHaveCount(1, { timeout: 15000 });
    await expect(bf.locator("path")).toHaveAttribute("stroke-dasharray", "6 4");
    await expect(bf.locator("text")).toHaveText("Baufeld (mittig, ohne Lagebezug)");
    await page.screenshot({ path: path.join(ORDNER, "grundriss-baufeld.png") });
    // the envelope never becomes the outline: the stored footprint stays the house after the write-back delay (1.5 s)
    await page.waitForTimeout(2500);
    const modell = (await (await request.get(`/api/entities/BimModel?project_id=${encodeURIComponent(projekt.id)}`)).json())[0];
    expect(modell.footprintM).toEqual(EFH_SOLL.footprintM);
    await efhZuruecksetzen(request); // removes the design record again
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
