// Headless proof 72-21 (register no. 134): long lists draw only their visible rows,
// filter on the data, and print in full.
//
// Test 1 — check suite: the sample model plus 13 copies of its first wall is uploaded
// (14 identical walls → 91 duplicate pairs in the group "IfcWall × IfcWall"). The open
// group draws fewer rows than it holds, scrolling to the end draws the last row, the
// filter on one copy's GlobalId leaves its 13 pairs, print media draws every row, and
// the off-screen PDF report holds all findings (no 60-row cut any more).
// Test 2 — AVA: 300 positions in one trade (created through the local API, deleted in
// finally and before the run) — windowed table, filter "Nr. 287" → one row, print → 300.
//
// Rules (lessons 75-05…75-14): --workers=1 · everything but localhost is blocked ·
// three.js/WebGL page errors are ignored.
//
// Run: PORT=5195 API_PORT=3025 API_ORIGINS=http://localhost:5195 npx playwright test tests/e2e/listen-fenster-72-21.spec.js --reporter=line

import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import { test, expect } from "./fixtures/base.js";

const API = `http://localhost:${Number(process.env.API_PORT) || 3001}/api/`;
const MUSTERPROJEKT = path.join(import.meta.dirname, "../../public/beispiel/musterprojekt.ifc");
const PROJEKT = "Review Testhaus";
const GEWERK = "Fenstertest 72-21";
const MARKE = "(72-21 Test)";
const KOPIEN = 13;

/** IFC GlobalId alphabet (base64 variant of IFC, 22 characters per id). */
const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/**
 * Deterministic 22-character GlobalId for copy `n`.
 * @param {number} n
 * @returns {string}
 */
function guid(n) {
  let s = "";
  let x = 7221 * 1000 + n;
  for (let i = 0; i < 22; i += 1) { s += IFC64[(x + i * 17) % 64]; x = Math.floor(x / 3) + 11; }
  return s;
}

/**
 * The sample model plus KOPIEN copies of its first wall (same placement and body),
 * contained in the first storey. Copies are identical boxes → duplicate findings.
 * @returns {{text: string, guids: string[]}}
 */
function modellMitKopien() {
  const ifc = fs.readFileSync(MUSTERPROJEKT, "utf8");
  const wand = /^#(\d+)=IFCWALL\('([^']+)',(.*)$/m.exec(ifc);
  const geschoss = /^#(\d+)=IFCBUILDINGSTOREY\(/m.exec(ifc);
  if (!wand || !geschoss) throw new Error("Musterprojekt ohne IFCWALL/IFCBUILDINGSTOREY");
  const guids = [];
  const zeilen = [];
  for (let k = 1; k <= KOPIEN; k += 1) {
    const g = guid(k);
    guids.push(g);
    zeilen.push(`#${90000 + k}=IFCWALL('${g}',${wand[3]}`);
  }
  const ids = zeilen.map((_, k) => `#${90001 + k}`).join(",");
  zeilen.push(`#90999=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(99)}',#5,$,$,(${ids}),#${geschoss[1]});`);
  const ende = ifc.lastIndexOf("ENDSEC;");
  return { text: `${ifc.slice(0, ende)}${zeilen.join("\n")}\n${ifc.slice(ende)}`, guids };
}

/** @param {import("@playwright/test").Page} page */
async function nurLokal(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
  });
}

/**
 * Rows drawn in a windowed table (spacer rows excluded).
 * @param {import("@playwright/test").Locator} tabelle
 */
const gezeichnet = (tabelle) => tabelle.locator("tbody > tr:not([data-fenster-abstand])").count();

test.describe("72-21 Gefensterte Listen", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });
  test.describe.configure({ timeout: 240000 });

  test("Prüf-Suite: 91 Doppelungen — Fenster, Filter, Druck, voller Bericht", async ({ page }) => {
    await nurLokal(page);
    const fehler = [];
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) fehler.push(String(e)); });
    const { text, guids } = modellMitKopien();

    await page.goto("/ModelCheck");
    const eingabe = page.locator('input[type="file"][accept=".ifc"]').first();
    await expect(eingabe).toBeAttached({ timeout: 60000 });
    await eingabe.setInputFiles({ name: "fenstertest-72-21.ifc", mimeType: "application/octet-stream", buffer: Buffer.from(text) });
    await expect(page.getByText(/\d+ Bauteil-Geometrien/).first()).toBeVisible({ timeout: 120000 });
    await page.getByRole("button", { name: "Prüfung starten" }).click();
    await expect(page.getByTestId("befund-filter")).toBeVisible({ timeout: 120000 });

    // Open the wall-against-wall group.
    await page.getByRole("button", { name: /IfcWall × IfcWall/ }).first().click();
    const tabelle = page.getByTestId("befund-gruppe-tabelle").first();
    await expect(tabelle).toBeVisible();
    const gesamt = Number(await tabelle.getAttribute("data-zeilen"));
    expect(gesamt, "14 gleiche Wände → mindestens 91 Paare").toBeGreaterThanOrEqual(91);
    await expect(tabelle).toHaveAttribute("data-fenster", "an");
    const oben = await gezeichnet(tabelle);
    expect(oben, "nur sichtbare Zeilen + Überhang").toBeLessThan(gesamt);
    expect(oben).toBeGreaterThan(5);
    const ersteNr = await tabelle.locator("[data-befund-nr]").first().innerText();

    // Scroll to the end: the last row is drawn, no spacer below, still a window.
    await tabelle.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(tabelle.locator("tbody > tr").last()).not.toHaveAttribute("data-fenster-abstand", "");
    await expect.poll(async () => tabelle.locator("[data-befund-nr]").first().innerText()).not.toBe(ersteNr);
    expect(await gezeichnet(tabelle)).toBeLessThan(gesamt);

    // Filter on the DATA: one copy's GlobalId → its 13 pairs with the other walls.
    await page.getByTestId("befund-filter").fill(guids[0]);
    await expect(page.getByTestId("befund-filter-stand")).toContainText(`${KOPIEN} von`);
    await expect(tabelle).toHaveAttribute("data-zeilen", String(KOPIEN));
    await expect(tabelle).toHaveAttribute("data-fenster", "aus");
    expect(await gezeichnet(tabelle)).toBe(KOPIEN);
    await page.getByTestId("befund-filter").fill("");
    await expect(tabelle).toHaveAttribute("data-zeilen", String(gesamt));

    // Print: every row drawn.
    await page.emulateMedia({ media: "print" });
    await expect(tabelle).toHaveAttribute("data-fenster", "aus");
    await expect.poll(() => gezeichnet(tabelle)).toBe(gesamt);
    await page.emulateMedia({ media: "screen" });
    await expect(tabelle).toHaveAttribute("data-fenster", "an");

    // PDF report (off-screen): all findings, no rest hint.
    const titel = await page.getByText(/^Kollisions-Befunde \(\d+\)$/).first().innerText();
    const alleBefunde = Number(/\((\d+)\)/.exec(titel)?.[1]);
    expect(alleBefunde).toBeGreaterThan(60);
    await expect(page.getByTestId("bericht-befunde").locator("tbody > tr")).toHaveCount(alleBefunde);
    await expect(page.getByTestId("bericht-rest")).toHaveCount(0);
    expect(fehler).toEqual([]);
  });

  test("AVA: 300 Positionen — Fenster, Filter, Druck", async ({ page }) => {
    const api = await request.newContext({ baseURL: API });
    const aufraeumen = async () => {
      const alle = await (await api.get("entities/LVPosition")).json();
      for (const p of Array.isArray(alle) ? alle : []) {
        if (String(p.title || "").includes(MARKE)) await api.delete(`entities/LVPosition/${p.id}`);
      }
    };
    await aufraeumen();
    try {
      const projekte = await (await api.get("entities/Project")).json();
      const projekt = projekte.find((x) => x.name === PROJEKT);
      expect(projekt, `Testprojekt ${PROJEKT} fehlt`).toBeTruthy();
      const records = Array.from({ length: 300 }, (_, i) => ({
        project_id: projekt.id, trade: GEWERK, oz: `72.21.${String(i + 1).padStart(3, "0")}`,
        title: `Fensterposition Nr. ${i + 1} ${MARKE}`, short_text: "Probezeile", unit: "St", quantity: 1, unit_price: 10,
      }));
      const res = await api.post("entities/LVPosition/bulk", { data: { records } });
      expect(res.ok(), "Bulk-Anlage").toBeTruthy();

      await nurLokal(page);
      await page.goto(`/AVA?projekt=${encodeURIComponent(PROJEKT)}`);
      const tabelle = page.locator('[data-testid="lv-gewerk-tabelle"][data-zeilen="300"]');
      await expect(tabelle).toBeVisible({ timeout: 60000 });
      await expect(tabelle).toHaveAttribute("data-fenster", "an");
      expect(await gezeichnet(tabelle)).toBeLessThan(300);

      await tabelle.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(tabelle.getByText("72.21.300", { exact: true })).toBeVisible();

      await page.getByTestId("lv-filter").fill("Nr. 287 72-21");
      await expect(page.getByTestId("lv-filter-stand")).toContainText("1 von");
      const gefiltert = page.locator('[data-testid="lv-gewerk-tabelle"][data-zeilen="1"]');
      await expect(gefiltert.getByText("72.21.287", { exact: true })).toBeVisible();
      await page.getByTestId("lv-filter").fill("");

      await page.emulateMedia({ media: "print" });
      await expect(tabelle).toHaveAttribute("data-fenster", "aus");
      await expect.poll(() => gezeichnet(tabelle)).toBe(300);
      await page.emulateMedia({ media: "screen" });
    } finally {
      await aufraeumen();
      await api.dispose();
    }
  });
});
