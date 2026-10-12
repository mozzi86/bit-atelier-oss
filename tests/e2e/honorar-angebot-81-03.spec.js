// Phase 81 (81-03): fee offers against the Express dev stack on the project
// "Review Testhaus" — the five-step wizard (KG 300 900.000 + KG 400 400.000,
// zone III, LPH 1–8, new build → 140.999,05 € net; conversion without text form
// → 169.198,86 € with § 6 Abs. 2), all 14 service profiles without "Tafel fehlt",
// profile change to structural planning rebuilds six stages (39.204,51 €
// basic fee, H-2), the PDF carries number, amount and payment term, "mark as sent"
// files the PDF bytes under 00_Vertrag & Honorar/Angebote and freezes the
// version, a new version gets number 2; the lab calculator shows the same table
// values without a platform fee. Replaces the planned headless proof
// n-81-03-angebot.mjs (no demo build since 83-02). Cleans up its offers and
// documents in finally.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";

const API = "/api/entities";
const BAUHERR = "E2E Bauherrschaft 8103";

/**
 * Deletes the offers of this spec (marked by the client name) and their filed documents.
 * @param {import("@playwright/test").APIRequestContext} request
 */
async function aufraeumen(request) {
  const angebote = await (await request.get(`${API}/Honorarangebot`)).json();
  for (const a of Array.isArray(angebote) ? angebote : []) {
    if (a.bauherr_name !== BAUHERR) continue;
    if (a.dokument_id) await request.delete(`${API}/Document/${a.dokument_id}`);
    await request.delete(`${API}/Honorarangebot/${a.id}`);
  }
}

/** Text of a PDF file through pdfjs (legacy build, node). */
async function pdfText(pfad) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pfad)), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  let text = "";
  for (let n = 1; n <= doc.numPages; n++) text += (await (await doc.getPage(n)).getTextContent()).items.map((i) => /** @type {any} */ (i).str).join("\n");
  return text;
}

test("Honorarangebot in fünf Schritten, PDF, versendet mit Ablage, neue Fassung", async ({ page, request }) => {
  test.setTimeout(240000);
  await aufraeumen(request);
  try {
    await nurLocalhost(page);
    const konsole = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) konsole.push(m.text()); });
    page.on("pageerror", (e) => konsole.push(`pageerror ${e}`));

    await page.goto(`/Fees?tab=offers&projekt=${encodeURIComponent(PROJEKT_NAME)}`);
    await page.getByRole("button", { name: "Neues Honorarangebot" }).first().click();
    const dialog = page.getByTestId("angebot-assistent");
    await expect(dialog).toBeVisible();
    await page.locator("#as-projekt").selectOption({ label: PROJEKT_NAME });
    await page.locator("#as-bauherr").fill(BAUHERR);
    await dialog.getByRole("button", { name: "Weiter" }).click();

    // Step 2: all 14 profiles, none marked "Tafel fehlt" (79-14 built all tables).
    const optionen = await page.locator("#as-leistungsbild option").allTextContents();
    expect(optionen.length).toBe(14);
    expect(optionen.filter((o) => o.includes("Tafel fehlt"))).toEqual([]);
    console.log("KEIN_TAFEL_FEHLT");
    await page.locator("#as-kg300").fill("900.000");
    await page.locator("#as-kg400").fill("400.000");
    await page.locator("#as-kg400").blur();
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await page.locator("#as-zone").selectOption("III");
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await dialog.getByRole("button", { name: "LPH 1–8" }).click();
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("angebot-netto")).toHaveText(/140\.999,05/);
    await expect(page.getByTestId("angebot-live-summe")).toContainText("1.212.500,00");
    await dialog.getByLabel("Umbau oder Modernisierung").check();
    await expect(page.getByTestId("angebot-netto")).toHaveText(/169\.198,86/);
    await expect(page.getByTestId("angebot-live-summe")).toContainText("§ 6 Abs. 2");
    await dialog.getByLabel("Neubau", { exact: true }).check();
    await dialog.getByRole("button", { name: "Entwurf anlegen" }).click();

    await expect.poll(async () => (await (await request.get(`${API}/Honorarangebot`)).json()).filter((a) => a.bauherr_name === BAUHERR).length, { timeout: 15000 }).toBe(1);
    const [angebot] = (await (await request.get(`${API}/Honorarangebot`)).json()).filter((a) => a.bauherr_name === BAUHERR);
    expect([angebot.kg300_euro, angebot.kg400_euro, angebot.honorarzone, angebot.satz_position_prozent, angebot.status]).toEqual([900000, 400000, "III", 0, "entwurf"]);
    expect(angebot.nummer).toMatch(/^HA-\d{4}-\d{3}$/);

    // PDF of the draft.
    const zeile = page.locator(`[data-testid="angebot-zeile"][data-nummer="${angebot.nummer}"]`);
    const [download] = await Promise.all([page.waitForEvent("download"), zeile.getByRole("button", { name: "PDF" }).click()]);
    const text = await pdfText(await download.path());
    expect(text).toContain(angebot.nummer);
    expect(text).toContain("140.999,05");
    expect(text).toContain(`Zahlungsziel ${angebot.zahlungsziel_tage} Tage`);

    // Mark as sent → PDF bytes filed, version frozen.
    await zeile.getByRole("button", { name: "Als versendet markieren" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Als versendet markieren" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Honorarangebot/${angebot.id}`)).json()).status, { timeout: 20000 }).toBe("versendet");
    const versendet = await (await request.get(`${API}/Honorarangebot/${angebot.id}`)).json();
    expect(versendet.dokument_id).toBeTruthy();
    const dok = await (await request.get(`${API}/Document/${versendet.dokument_id}`)).json();
    expect(dok.type).toBe("Honorarangebot");
    expect(dok.bereich).toBe("buero");
    expect(String(dok.data)).toMatch(/^data:application\/pdf;base64,/);
    expect(dok.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(zeile.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);
    await zeile.getByRole("button", { name: "Neue Fassung" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Honorarangebot`)).json()).filter((a) => a.bauherr_name === BAUHERR).map((a) => a.fassung).sort(), { timeout: 15000 }).toEqual([1, 2]);
    await page.keyboard.press("Escape");

    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen(request);
  }
});

test("Leistungsbild-Wechsel baut sechs LPH auf (H-2); Labor-Rechner ohne Plattformgebühr; EN-Titel", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  await page.goto("/Fees?tab=calculator");
  const rechner = page.getByTestId("honorar-rechner");
  await expect(rechner).toBeVisible({ timeout: 20000 });
  await page.locator("#rechner-leistungsbild").selectOption("tragwerksplanung");
  await page.locator("#rechner-bezugswert").fill("425.000");
  await page.locator("#rechner-bezugswert").blur();
  await page.locator("#rechner-zone").selectOption("III");
  await expect(page.locator('[data-testid="lph-tabelle"] input[type="checkbox"]')).toHaveCount(6);
  await expect(page.getByTestId("honorar-aufstellung")).toContainText("39.204,51");
  await page.locator("#rechner-leistungsbild").selectOption("gebaeude");
  await expect(page.locator('[data-testid="lph-tabelle"] input[type="checkbox"]')).toHaveCount(9);

  await page.goto("/InvestmentPlatform");
  await page.getByRole("tab", { name: "HOAI-Rechner" }).click();
  await page.locator("#rechner-kg300").fill("900.000");
  await page.locator("#rechner-kg400").fill("400.000");
  await page.locator("#rechner-kg400").blur();
  await expect(page.getByTestId("rechner-tafel")).toContainText("137.025,30");
  await expect(page.getByText(/Plattformgebühr/)).toHaveCount(0);

  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* blocked */ } });
  await page.goto("/Fees");
  await expect(page.locator("h1")).toHaveText(/Offers & contracts/);
});
