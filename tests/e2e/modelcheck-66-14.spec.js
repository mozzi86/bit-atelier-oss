// Headless proof 66-14 (register no. 124): the findings list of the check suite as CSV
// and Excel.
//
// Flow: open the check suite with the sample project (?beispiel=1 loads model + IDS and
// starts the run by itself), open all finding groups, click "Befundliste (CSV)" and catch
// the download. Checks: UTF-8 BOM, German header, first column = the report numbers shown
// in the finding list (same set), first data row is "1", rows = findings shown + IDS
// violators shown, no placeholder words, file name with date. Then the Excel download: a
// ZIP with the sheet "Befundliste", frozen header, filter, one row per finding. The export
// triggers no network request to a foreign host. Second test: a run without any finding
// leaves both buttons disabled with the hint in plain text.
//
// Rules (lessons 75-05…75-14): --workers=1 · everything but localhost is blocked ·
// three.js/WebGL page errors are ignored.
//
// Run: npx playwright test tests/e2e/modelcheck-66-14.spec.js --workers=1

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { ERLAUBT_OFFLINE } from "./fixtures/massing.js";

const MUSTERPROJEKT = path.join(import.meta.dirname, "../../public/beispiel/musterprojekt.ifc");

/**
 * Block every host but localhost, collect unexpected console problems and page errors,
 * and remember requests to foreign hosts that were attempted (they fail by design).
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{warnungen: string[], fremd: string[]}>}
 */
async function wacheAuf(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
  });
  const warnungen = [];
  const fremd = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!/^(blob|data):/.test(u) && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname)) fremd.push(u);
  });
  return { warnungen, fremd };
}

/**
 * Click a button and catch the download it triggers.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} knopf
 * @returns {Promise<{name: string, bytes: Buffer}>}
 */
async function lade(page, knopf) {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), knopf.click()]);
  const ziel = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(ziel);
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(ziel) };
}

test.describe("66-14 Befundliste als CSV und Excel", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });
  test.describe.configure({ timeout: 180000 });

  test("Musterprojekt: CSV und Excel enthalten alle Befunde mit den Nummern der Befundliste", async ({ page }) => {
    const { warnungen, fremd } = await wacheAuf(page);
    await page.goto("/ModelCheck?beispiel=1");

    const csvKnopf = page.getByTestId("befundliste-csv");
    const xlsxKnopf = page.getByTestId("befundliste-xlsx");
    await expect(csvKnopf).toBeVisible({ timeout: 120000 });
    await expect(csvKnopf).toBeEnabled();
    await expect(xlsxKnopf).toBeEnabled();
    await expect(page.getByTestId("befundliste-leer")).toHaveCount(0);

    // What the page shows: open every finding group, read the numbers; count the IDS violators.
    const gruppen = page.locator("button:has(svg.lucide-chevron-right)");
    for (let i = await gruppen.count(); i > 0; i -= 1) await gruppen.first().click().catch(() => {});
    const nummernUi = (await page.locator("[data-befund-nr]").allTextContents()).map(Number).sort((a, b) => a - b);
    const idsZeilen = await page.locator('[data-testid="ids-ergebnis"] tr[data-globalid], [data-testid="ids-ergebnis-eigen"] tr[data-globalid]').count();
    expect(nummernUi.length, "das Musterprojekt hat Kollisions-Befunde").toBeGreaterThan(0);
    test.info().annotations.push({ type: "Befunde", description: `${nummernUi.length} Kollisions-Befunde + ${idsZeilen} IDS-Zeilen in der Anzeige` });

    // --- CSV ----------------------------------------------------------------------
    const fremdVorher = fremd.length;
    const csv = await lade(page, csvKnopf);
    expect(csv.name).toMatch(/^\S+_\d{4}-\d{2}-\d{2}_befundliste\.csv$/);
    expect([...csv.bytes.subarray(0, 3)], "UTF-8-BOM").toEqual([0xef, 0xbb, 0xbf]);
    const text = csv.bytes.toString("utf8").slice(1);
    expect(text.endsWith("\r\n"), "Zeilenende CRLF").toBe(true);
    expect(/[^\r]\n/.test(text), "kein einzelnes LF").toBe(false);
    const zeilen = text.split("\r\n").slice(0, -1);
    const kopf = zeilen[0].split(";");
    expect(kopf.slice(0, 5)).toEqual(["Nr.", "Art", "Schwere", "Fachmodell", "Geschoss"]);
    expect(kopf).toContain("GlobalId A");
    expect(kopf).toContain("Kostenklasse");
    expect(zeilen.length - 1, "eine Zeile je Befund").toBe(nummernUi.length + idsZeilen);
    expect(zeilen[1].split(";")[0], "erste Datenzeile trägt die Nr. 1").toBe("1");
    const nummernCsv = zeilen.slice(1).map((z) => z.split(";")[0]).filter(Boolean).map(Number).sort((a, b) => a - b);
    expect(nummernCsv, "dieselben Nummern wie die Befundliste auf der Seite").toEqual(nummernUi);
    expect(text).not.toMatch(/undefined|NaN|\[object|null/);
    test.info().annotations.push({ type: "CSV", description: `${csv.name}: ${zeilen.length - 1} Zeilen, ${csv.bytes.length} B` });

    // --- Excel --------------------------------------------------------------------
    const xlsx = await lade(page, xlsxKnopf);
    expect(xlsx.name).toMatch(/^\S+_\d{4}-\d{2}-\d{2}_befundliste\.xlsx$/);
    expect(xlsx.bytes.subarray(0, 2).toString(), "ZIP-Container").toBe("PK");
    const dateien = unzipSync(new Uint8Array(xlsx.bytes));
    expect(strFromU8(dateien["xl/workbook.xml"])).toContain('name="Befundliste"');
    const blatt = strFromU8(dateien["xl/worksheets/sheet1.xml"]);
    expect(blatt, "Kopfzeile fixiert").toContain('state="frozen"');
    expect(blatt, "Filter über alle Zeilen").toMatch(new RegExp(`<autoFilter ref="A1:[A-Z]+${zeilen.length}"`));
    expect((blatt.match(/<row /g) || []).length, "Kopf + eine Zeile je Befund").toBe(zeilen.length);
    expect(strFromU8(dateien["xl/styles.xml"]), "Kopf fett").toContain("<b/>");
    test.info().annotations.push({ type: "XLSX", description: `${xlsx.name}: ${zeilen.length - 1} Zeilen, ${xlsx.bytes.length} B` });

    // Purely local: no attempt to reach a foreign host while exporting.
    expect(fremd.slice(fremdVorher), "keine Netzanfrage beim Export").toEqual([]);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("leerer Befundstand: beide Knöpfe deaktiviert, Hinweis im Klartext", async ({ page }) => {
    const { warnungen } = await wacheAuf(page);
    // The dev stack keeps the "own IDS rules" of the project in the BimModel record
    // (pruefung_layer, 69-08) — a rule left there by an earlier session would make the run
    // find an IDS violator and the list non-empty. This test needs a clean slate, so the
    // BimModel lookup answers "no record". A write would be refused with 409, which shows
    // up as a console error below — the test must not touch the stored project data.
    await page.route("**/api/entities/BimModel*", (route) => (route.request().method() === "GET"
      ? route.fulfill({ json: [] })
      : route.fulfill({ status: 409, json: { error: "write blocked by test" } })));
    await page.goto("/ModelCheck");
    await page.locator('input[type="file"][accept=".ifc"]').first().setInputFiles(MUSTERPROJEKT);
    const start = page.getByRole("button", { name: "Prüfung starten" });
    await expect(start).toBeEnabled({ timeout: 120000 });

    // No rule, no duplicate check, no IDS file → a run without any finding.
    for (const box of await page.locator('input[type="checkbox"].accent-emerald-600').all()) await box.uncheck();
    await start.click();

    const hinweis = page.getByTestId("befundliste-leer");
    await expect(hinweis).toBeVisible({ timeout: 60000 });
    await expect(hinweis).toHaveText("Keine Befunde — es gibt nichts zu exportieren.");
    await expect(page.getByTestId("befundliste-csv")).toBeDisabled();
    await expect(page.getByTestId("befundliste-xlsx")).toBeDisabled();
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
