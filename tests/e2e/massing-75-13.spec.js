// Headless-Nachweis 75-13 (MS-07, MSB-13/MSB-22): Fenster-Deckel, Balkon-Schalter,
// notwendiger Treppenraum + Aufzug-Schalter + Erweiterungs-Schieber, Rettungsweg als
// Lauflinie mit rotem Pfad im Massing.
//
// Zwei Tests:
//   1. "Fenster-Deckel und Balkon" — Werkstatt (Typologie Mittelflur): Regel „Fenster je Raum"
//      an → Deckel-Auswahl 1|2, kein Raum mit mehr als zwei Fenstern, Deckel 2 setzt nie
//      weniger Fenster; Balkon-Schalter nur an außenliegenden Räumen der Raumliste, Schalter
//      an → Balkon-Geometrie im Geschossplan (`wt-balkon`) + WoFlV aus der Geometrie, Schalter
//      aus → nichts; Fokus 1:50: Balkon-Schalter am aktiven Außenraum, Balkon als Schraffur.
//   2. "Treppenraum, Aufzug, Erweiterung, Rettungsweg" — Typologie MFH auf 70 × 16 m: Regel
//      „Rettungsweg" an → warn-Karten (> 35 m) mit Vorschlag; Treppenraum-Regel an → Panel
//      `wt-treppenraum`, Aufzug-Schalter (Kern 6 × 3 ↔ 2,5 × 5), Erweiterung 6 m → Brandwände
//      `wt-brandwand`, warn verschwindet; Massing: Zonen „Treppenraum"/„Aufzug" grau benannt,
//      „Rettungsweg zeigen" zeichnet je WE der Ebene 0 einen roten Pfad.
//
// Regeln (Lehren 75-05/07/09/11/14): --workers=1 · Viewport 1280 × 1800 · Chips/Umschalter per
// dispatchEvent · SVG-Elemente über count()/Attribute, nie toBeVisible · Werkstatt-Regeln nur
// über schalteRegel (useFachlayer-Ladesperre) · three.js-WebGL-pageerror ignorieren · am Ende
// alle 75-13-Schalter zurück und Typologie Mittelflur (die Schicht liegt in server/db.json).

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, resetRechteck, schalteRegel, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const PROJEKT = "projekt=Review%20Testhaus";
const SEITE_STUDIO = `/ComplexDesigner?${PROJEKT}&tab=studio`;
const SEITE_WERKSTATT = `/ComplexDesigner?${PROJEKT}&tab=werkstatt`;
const BILDER = path.resolve(process.cwd(), ".planning/phases/75-massing-studio-werkzeug-massstab-architektur/tmp-e2e");

/** Console/pageerror watcher + offline guard; returns the warnings array (empty = clean). */
async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => {
    const stack = e.stack || String(e);
    if (/WebGL|THREE|getUniforms/i.test(stack)) return; // three.js headless
    warnungen.push(`pageerror ${stack.split("\n").slice(0, 3).join(" | ")}`);
  });
  return warnungen;
}

/**
 * Footprint → rectangle, then the workshop tab with the tessellation applied.
 * The review house has no stored geometry, so a footprint other than the 30 × 20 m
 * default lives in the store only: switch tabs INSIDE the app (a reload resets it).
 */
async function werkstattBereit(page, ziel) {
  await page.goto(SEITE_STUDIO);
  await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
  await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();
  await resetRechteck(page, ziel);
  if (ziel) {
    await page.getByRole("button", { name: "3 · Gebäude" }).first().click();
    const tab = page.getByRole("tab", { name: /Wohnungs-Werkstatt/ }).first();
    await tab.dispatchEvent("mousedown"); // Radix tabs switch on mousedown
    await tab.click();
  } else {
    await page.goto(SEITE_WERKSTATT);
  }
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1200);
  // Known start: all rules this spec touches OFF (the layer persists between runs).
  for (const k of ["fensterJeRaum", "treppenraum", "rettungsweg", "wohnungsgrundriss"]) await schalteRegel(page, k, false);
  await setzeTypologie(page, "Mittelflur");
  const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
  await expect(anwenden).toBeVisible({ timeout: 15000 });
  const entfernen = page.getByRole("button", { name: /entfernen/i }).first();
  if ((await anwenden.isDisabled()) && (await entfernen.count())) { await entfernen.click(); await page.waitForTimeout(800); }
  for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) { await anwenden.click(); await page.waitForTimeout(1200); }
  await page.waitForTimeout(1600);
  expect(await page.getByTestId("wt-we").count(), "WE-Zonen vorhanden").toBeGreaterThan(0);
}

/** Radix select "Erschließung" (portal): open, pick by visible label. */
async function setzeTypologie(page, label) {
  const trigger = page.getByTestId("wt-typologie");
  if ((await trigger.textContent())?.trim() === label) return;
  await trigger.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(900);
  await expect(trigger).toHaveText(label);
}

/** Windows per room name of the shown storey. */
async function fensterJeRaum(page) {
  return page.getByTestId("wt-fenster").evaluateAll((els) => {
    const m = {};
    for (const e of els) m[e.getAttribute("data-raum")] = (m[e.getAttribute("data-raum")] || 0) + 1;
    return m;
  });
}
const summe = (m) => Object.values(m).reduce((s, n) => s + n, 0);

test.describe("75-13 Fenster-Deckel, Balkon, Treppenraum + Aufzug, Rettungsweg", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 300000 });

  test("Fenster-Deckel 1|2 und Balkon-Schalter (Werkstatt, Fokus)", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page, undefined);

    // --- Default: no balcony anywhere, no window-cap control (rule off).
    await expect(page.getByTestId("wt-balkon")).toHaveCount(0);
    await expect(page.getByTestId("wt-fenster-max")).toHaveCount(0);

    // --- Window cap: rule "Fenster je Raum" ON → control with default 1.
    await schalteRegel(page, "fensterJeRaum", true);
    const deckel = page.getByTestId("wt-fenster-max");
    await expect(deckel).toBeVisible();
    await expect(deckel).toHaveValue("1");
    await page.waitForTimeout(600);
    const eins = await fensterJeRaum(page);
    expect(summe(eins), "Fenster im Geschossplan").toBeGreaterThan(0);
    expect(Math.max(...Object.values(eins)), "kein Raum mit mehr als 2 Fenstern (Deckel 1 + Eckraum 2)").toBeLessThanOrEqual(2);
    await deckel.selectOption("2");
    await page.waitForTimeout(800);
    const zwei = await fensterJeRaum(page);
    expect(Math.max(...Object.values(zwei)), "auch bei Deckel 2 höchstens 2 je Raum").toBeLessThanOrEqual(2);
    expect(summe(zwei), "Deckel 2 setzt nie weniger Fenster als Deckel 1").toBeGreaterThanOrEqual(summe(eins));
    test.info().annotations.push({ type: "fenster-30x20", description: `Deckel 1: ${summe(eins)} Fenster · Deckel 2: ${summe(zwei)} Fenster · Räume mit 2: ${Object.values(eins).filter((n) => n === 2).length} / ${Object.values(zwei).filter((n) => n === 2).length}` });
    await deckel.selectOption("1");
    await page.waitForTimeout(500);

    // --- Per-room cap in the type editor (outer rooms only).
    const reihen = page.getByTestId("raum-aussen");
    const raeume = await reihen.evaluateAll((els) => els.map((e) => e.getAttribute("data-raum")));
    expect(raeume.length, "außenliegende Räume in der Raumliste").toBeGreaterThan(0);
    for (const r of raeume) expect(r, "Innenräume haben keine Schalter").not.toMatch(/Bad|Küche|Flur|Abstell|Kochnische|Dusch/);
    const raumFenster = reihen.first().getByTestId("raum-fenster-max");
    await raumFenster.selectOption("2");
    await page.waitForTimeout(700);
    await raumFenster.selectOption("");
    await page.waitForTimeout(500);

    // --- Balcony switch on the first outer room: geometry in the storey plan, WoFlV from the polygon.
    const balkon = reihen.first().getByTestId("raum-balkon");
    await balkon.check({ force: true });
    await expect(page.getByTestId("wt-balkon").first()).toBeAttached({ timeout: 10000 });
    const flaechen = await page.getByTestId("wt-balkon").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-m2"))));
    expect(flaechen.length).toBeGreaterThan(0);
    for (const m2 of flaechen) expect(m2, "Balkonfläche aus dem Polygon").toBeGreaterThan(0.5);
    expect(await page.locator('[data-balkon-geometrie="1"]').count(), "WoFlV-Zeile liest die Geometrie").toBeGreaterThan(0);
    test.info().annotations.push({ type: "balkon", description: `${flaechen.length} Balkone Ebene 0 · ${flaechen.map((m) => m.toFixed(2)).join(" / ")} m²` });
    await fs.promises.mkdir(BILDER, { recursive: true });
    await page.screenshot({ path: path.join(BILDER, "75-13-balkon-werkstatt.png"), fullPage: false });

    // --- Focus 1:50 of a unit of that type: switch at the active outer room, hatch + iso slab follow.
    const balkonWe = await page.getByTestId("wt-balkon").first().getAttribute("data-we");
    await page.waitForTimeout(1600); // layer save debounce before navigating
    await page.goto(`${SEITE_WERKSTATT}&we=${encodeURIComponent(balkonWe)}`);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Fokusansicht: ${balkonWe}`).first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1000);
    const keys = await page.getByTestId("fk-raum").evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
    const wohnKey = keys.find((k) => /Wohnen/.test(k)) || keys[0];
    await page.locator(`[data-testid="fk-raum"][data-key="${wohnKey}"]`).first().dispatchEvent("click");
    const schalter = page.getByTestId("fk-balkon-schalter");
    await expect(schalter).toBeVisible({ timeout: 10000 });
    expect(await schalter.getAttribute("data-an"), "Balkon an diesem Raum ist an").toBe("1");
    expect(await page.getByTestId("fk-balkon").count(), "Balkon als Schraffur im 1:50-Plan").toBeGreaterThan(0);
    // Iso: the unit's rooms PLUS the balcony slab are handed to MassingView3D (GL-agnostic: the data attribute).
    const isoZonen = Number(await page.locator("[data-iso-fokus-zonen]").first().getAttribute("data-iso-fokus-zonen"));
    expect(isoZonen, "Iso-Zonen = Räume + Balkonplatte").toBe((await page.getByTestId("fk-raum").count()) + (await page.getByTestId("fk-balkon").count()));
    await page.screenshot({ path: path.join(BILDER, "75-13-balkon-fokus.png"), fullPage: false });
    // The focus toggle writes the same layer key: off → hatch gone, on → back.
    await schalter.locator("input").setChecked(false, { force: true });
    await expect(page.getByTestId("fk-balkon")).toHaveCount(0, { timeout: 10000 });
    await schalter.locator("input").setChecked(true, { force: true });
    await expect(page.getByTestId("fk-balkon").first()).toBeAttached({ timeout: 10000 });
    test.info().annotations.push({ type: "fokus", description: `${balkonWe} · Raum ${wohnKey} · fk-balkon ${await page.getByTestId("fk-balkon").count()}` });
    await page.waitForTimeout(1800); // layer save debounce

    // --- Clean up: balcony switch off again (Werkstatt), window rule off.
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const b2 = page.getByTestId("raum-aussen").first().getByTestId("raum-balkon");
    for (let v = 0; v < 8 && (await b2.isChecked()); v += 1) { await b2.click({ force: true }); await page.waitForTimeout(500); }
    await expect(b2).not.toBeChecked();
    await expect(page.getByTestId("wt-balkon")).toHaveCount(0);
    expect(await page.locator('[data-balkon-geometrie="1"]').count(), "ohne Balkon keine Geometrie-Zeile").toBe(0);
    await schalteRegel(page, "fensterJeRaum", false);
    await page.waitForTimeout(1600);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("Treppenraum + Aufzug-Schalter + Erweiterung + Rettungsweg (70 × 16 m, MFH)", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    // The default site is 70 m wide (clampPt): the building takes the full width, x 0…70.
    await werkstattBereit(page, [{ x: 0, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 36 }, { x: 0, y: 36 }]);
    await setzeTypologie(page, "Mehrfamilienhaus");

    // --- Escape route as a walked line: > 35 m is a WARN card with a suggestion.
    await schalteRegel(page, "rettungsweg", true);
    await page.waitForTimeout(800);
    const warnKarten = page.getByTestId("wt-rettungsweg-warn");
    const warnVorher = await warnKarten.count();
    test.info().annotations.push({ type: "rettungsweg-70m-alt", description: `alter Kern (Phase 61): ${warnVorher} warn` });
    expect(warnVorher, "70 m lang: Rettungsweg über 35 m").toBeGreaterThan(0);
    expect(await warnKarten.first().getAttribute("data-stufe")).toBe("warn");
    expect(await warnKarten.first().textContent()).toMatch(/Rettungsweg .* > 35 m/);

    // --- Necessary stair enclosure: panel appears with the lift switch; extension slider 0–6 m.
    await expect(page.getByTestId("wt-treppenraum")).toHaveCount(0);
    await schalteRegel(page, "treppenraum", true);
    const panel = page.getByTestId("wt-treppenraum");
    await expect(panel).toBeVisible();
    const aufzug = page.getByTestId("wt-regel-aufzug");
    // Default = duty: office rule > 3 storeys (Review Testhaus storey count decides).
    const aufzugStart = await aufzug.isChecked();
    await aufzug.setChecked(true, { force: true });
    await page.waitForTimeout(500);
    await expect(panel).toContainText("6 × 3 m");
    await aufzug.setChecked(false, { force: true });
    await page.waitForTimeout(500);
    await expect(panel).toContainText("2,5 × 5 m");
    await expect(page.getByTestId("wt-aufzug-hinweis")).toContainText("MBO §39 Abs. 4");
    await expect(page.getByTestId("wt-aufzug-hinweis")).toContainText("BayBO Art. 37 Abs. 4");
    test.info().annotations.push({ type: "aufzug-default", description: `Review Testhaus: Aufzug standardmäßig ${aufzugStart ? "an" : "aus"}` });

    // --- Extension: slider → fire walls with T30-RS doors; the measurement ends at the new door → warn shrinks.
    expect(await page.getByTestId("wt-brandwand").count(), "ohne Erweiterung keine Brandwand").toBe(0);
    const warnOhne = await warnKarten.count();
    const regler = page.getByTestId("wt-treppenraum-erweiterung");
    await regler.fill("6");
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("wt-treppenraum-erweiterung-wert")).toContainText("6,0");
    expect(await page.getByTestId("wt-brandwand").count(), "zwei Brandwände je Geschoss-Ansicht").toBe(2);
    const warnMit = await warnKarten.count();
    expect(warnMit, "Erweiterung 6 m verkleinert die Zahl der warn-Karten").toBeLessThan(warnOhne);
    test.info().annotations.push({ type: "rettungsweg-70m", description: `Treppenraum ohne Erweiterung: ${warnOhne} warn · Erweiterung 6 m: ${warnMit} warn` });
    await page.screenshot({ path: path.join(BILDER, "75-13-treppenraum-werkstatt.png"), fullPage: false });
    // Layer is saved debounced — wait it out before leaving for the studio tab.
    await page.waitForTimeout(1800);
    await regler.fill("0");
    await page.waitForTimeout(1000);
    await aufzug.setChecked(true, { force: true });
    await page.waitForTimeout(1800);

    // --- Massing: stair + lift named in grey, escape-route paths as thin red lines (toggle).
    await page.getByRole("button", { name: /Baukörper/ }).first().click();
    const massingTab = page.getByRole("tab", { name: /Massing-Studio/ }).first();
    await massingTab.dispatchEvent("mousedown"); // Radix tabs switch on mousedown
    await massingTab.click();
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-erschliessung][data-raumart="treppenraum"]').first()).toBeAttached({ timeout: 15000 });
    expect(await page.locator('[data-erschliessung][data-raumart="aufzug"]').count(), "Aufzug als eigene Zone").toBeGreaterThan(0);
    expect(await page.locator('[data-erschliessung]').evaluateAll((els) => els.map((e) => e.textContent))).toEqual(expect.arrayContaining([expect.stringMatching(/Treppenraum/), expect.stringMatching(/Aufzug/)]));
    await expect(page.locator("[data-rettungswege]")).toHaveCount(0);
    const rw = page.getByTestId("ms-rettungsweg");
    await rw.dispatchEvent("click");
    await page.waitForTimeout(800);
    const pfade = page.locator("[data-rettungsweg]");
    expect(await pfade.count(), "ein roter Pfad je WE der Ebene 0").toBeGreaterThan(0);
    for (const l of await pfade.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-laenge"))))) expect(l).toBeGreaterThan(0);
    expect(await pfade.first().locator("path").getAttribute("stroke")).toBe("#dc2626");
    await page.screenshot({ path: path.join(BILDER, "75-13-massing-rettungsweg.png"), fullPage: false });
    await rw.dispatchEvent("click");
    await expect(page.locator("[data-rettungswege]")).toHaveCount(0);

    // --- Clean up: rules + typology back to the start state (the layer lives in server/db.json).
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1200);
    for (const k of ["treppenraum", "rettungsweg"]) await schalteRegel(page, k, false);
    await setzeTypologie(page, "Mittelflur");
    await page.waitForTimeout(1600);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
