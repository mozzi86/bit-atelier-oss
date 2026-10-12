// Phase 81 (81-04): from the fee offer to the instalment invoice against the
// Express dev stack on the project "Review Testhaus". The spec builds its own
// offer through the wizard (KG 300 900.000 + KG 400 400.000, zone III, LPH 1–8,
// new build → 140.999,05 € net), marks it as sent and accepts it → architect's
// contract AV-… with the offer's flat fields and payment term; "Annehmen" is
// gone afterwards. On the contract: a fee amendment of 8.000 € flat is offered
// and commissioned (contract total + 8.400,00 with 5 % incidental costs), set to
// 50 % done, and "Abschlagsrechnung stellen" opens 79's invoice form with the
// read-only amendment line (lp null). The order confirmation PDF carries number,
// amount and payment term and is filed as a document; the link "Projektzuordnung
// pflegen" leads to the staff tab. Replaces the planned headless proof
// n-81-04-auftrag.mjs (no demo build since 83-02). No invoice is issued (an
// issued invoice is GoBD-final and could not be cleaned up). Cleans up offers,
// contracts, amendments and documents of this spec in finally.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";

const API = "/api/entities";
const BAUHERR = "E2E Bauherrschaft 8104";

/** @param {import("@playwright/test").APIRequestContext} request @param {string} e */
const liste = async (request, e) => { const r = await (await request.get(`${API}/${e}`)).json(); return Array.isArray(r) ? r : []; };

/**
 * Deletes everything this spec created, marked by the client name.
 * @param {import("@playwright/test").APIRequestContext} request
 */
async function aufraeumen(request) {
  const vertraege = (await liste(request, "Honorarvertrag")).filter((v) => v.bauherr_name === BAUHERR);
  const ids = new Set(vertraege.map((v) => v.id));
  for (const n of await liste(request, "Honorarnachtrag")) if (ids.has(n.honorarvertrag_id)) await request.delete(`${API}/Honorarnachtrag/${n.id}`);
  for (const r of await liste(request, "Ausgangsrechnung")) if (ids.has(r.honorarvertrag_id) && r.status === "entwurf") await request.delete(`${API}/Ausgangsrechnung/${r.id}`);
  for (const v of vertraege) {
    if (v.bestaetigung_dokument_id) await request.delete(`${API}/Document/${v.bestaetigung_dokument_id}`);
    await request.delete(`${API}/Honorarvertrag/${v.id}`);
  }
  for (const a of await liste(request, "Honorarangebot")) {
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

/** Confirms the open confirmation dialog (useBestaetigung). */
const bestaetigen = (page) => page.getByTestId("bestaetigung-ok").click();

test("Angebot annehmen → Architektenvertrag, Honorarnachtrag, Abschlag mit Nachtragszeile, Auftragsbestätigung", async ({ page, request }) => {
  test.setTimeout(300000);
  await aufraeumen(request);
  try {
    await nurLocalhost(page);
    const konsole = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) konsole.push(m.text()); });
    page.on("pageerror", (e) => konsole.push(`pageerror ${e}`));

    // 1. Offer through the wizard, then "sent".
    await page.goto(`/Fees?tab=offers&projekt=${encodeURIComponent(PROJEKT_NAME)}`);
    await page.getByRole("button", { name: "Neues Honorarangebot" }).first().click();
    const assistent = page.getByTestId("angebot-assistent");
    await expect(assistent).toBeVisible();
    await page.locator("#as-projekt").selectOption({ label: PROJEKT_NAME });
    await page.locator("#as-bauherr").fill(BAUHERR);
    await assistent.getByRole("button", { name: "Weiter" }).click();
    await page.locator("#as-kg300").fill("900.000");
    await page.locator("#as-kg400").fill("400.000");
    await page.locator("#as-kg400").blur();
    await assistent.getByRole("button", { name: "Weiter" }).click();
    await page.locator("#as-zone").selectOption("III");
    await assistent.getByRole("button", { name: "Weiter" }).click();
    await assistent.getByRole("button", { name: "LPH 1–8" }).click();
    await assistent.getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("angebot-netto")).toHaveText(/140\.999,05/);
    await assistent.getByRole("button", { name: "Entwurf anlegen" }).click();
    await expect.poll(async () => (await liste(request, "Honorarangebot")).filter((a) => a.bauherr_name === BAUHERR).length, { timeout: 15000 }).toBe(1);
    const [angebot] = (await liste(request, "Honorarangebot")).filter((a) => a.bauherr_name === BAUHERR);
    const zeile = page.locator(`[data-testid="angebot-zeile"][data-nummer="${angebot.nummer}"]`);
    await zeile.getByRole("button", { name: "Als versendet markieren" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Als versendet markieren" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Honorarangebot/${angebot.id}`)).json()).status, { timeout: 20000 }).toBe("versendet");

    // 2. Accept → contract with the offer's flat fields; no second acceptance.
    await zeile.getByRole("button", { name: "Annehmen" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(angebot.nummer);
    await bestaetigen(page);
    await expect.poll(async () => (await liste(request, "Honorarvertrag")).filter((v) => v.bauherr_name === BAUHERR).length, { timeout: 20000 }).toBe(1);
    const [vertrag] = (await liste(request, "Honorarvertrag")).filter((v) => v.bauherr_name === BAUHERR);
    expect(vertrag.nummer).toMatch(/^AV-\d{4}-\d{3}$/);
    expect([vertrag.angebot_id, vertrag.status, vertrag.kg300_euro, vertrag.kg400_euro, vertrag.honorarzone, vertrag.zahlungsziel_tage])
      .toEqual([angebot.id, "beauftragt", 900000, 400000, "III", angebot.zahlungsziel_tage]);
    expect(vertrag.verguetung_snapshot?.summen?.netto).toBe(140999.05);
    await expect.poll(async () => (await (await request.get(`${API}/Honorarangebot/${angebot.id}`)).json()).status, { timeout: 15000 }).toBe("angenommen");
    await expect(zeile.getByRole("button", { name: "Annehmen" })).toHaveCount(0);

    // 3. Contracts tab: row and contract account.
    await page.getByRole("tab", { name: "Architektenverträge" }).click();
    const vZeile = page.locator(`[data-testid="vertrag-zeile"][data-nummer="${vertrag.nummer}"]`);
    await expect(vZeile).toContainText("140.999,05");
    await vZeile.getByRole("button", { name: vertrag.nummer }).click();
    await expect(page.getByTestId("vertragskonto")).toContainText("140.999,05");

    // 4. Fee amendment: 8.000 € flat → offered → commissioned → 50 % done.
    await page.getByRole("tab", { name: "Honorarnachträge" }).click();
    const block = page.getByTestId("nachtrag-vertrag").filter({ hasText: vertrag.nummer });
    await block.getByRole("button", { name: "Neuer Honorarnachtrag" }).click();
    const dialog = page.getByTestId("nachtrag-dialog");
    await dialog.locator("#hn-titel").fill("E2E Variantenuntersuchung");
    await dialog.locator("#hn-betrag").fill("8.000");
    await dialog.locator("#hn-betrag").blur();
    await expect(page.getByTestId("nachtrag-betrag")).toContainText("8.000,00");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    const nZeile = block.getByTestId("nachtrag-zeile").filter({ hasText: "E2E Variantenuntersuchung" });
    await expect(nZeile).toContainText("8.000,00");
    await nZeile.getByRole("button", { name: "Anbieten" }).click();
    await bestaetigen(page);
    await nZeile.getByRole("button", { name: "Beauftragen" }).click();
    await bestaetigen(page);
    await expect(block.getByTestId("nachtrag-vertragssumme")).toContainText("149.399,05");
    const erbracht = nZeile.getByLabel("erbracht (%)");
    await erbracht.fill("50");
    await erbracht.blur();
    await expect.poll(async () => (await liste(request, "Honorarnachtrag")).find((n) => n.honorarvertrag_id === vertrag.id)?.erbracht_prozent, { timeout: 15000 }).toBe(50);

    // 5. Instalment: 79's invoice form with the read-only amendment line (not LP 1).
    await page.getByRole("tab", { name: "Architektenverträge" }).click();
    await vZeile.getByRole("button", { name: vertrag.nummer }).click();
    await expect(page.getByTestId("vertragskonto")).toContainText("149.399,05");
    await expect(page.getByTestId("abschlag-titel")).toContainText(`zum Architektenvertrag ${vertrag.nummer}`);
    await page.getByTestId("abschlag-stellen").click();
    await expect(page.getByTestId("rf-nachtrag-position")).toContainText("Honorarnachtrag 1");
    await page.getByRole("button", { name: "Abbrechen" }).last().click();

    // 6. Order confirmation PDF, filed; link to the staff tab.
    await page.getByRole("button", { name: "Vertragsdaten" }).click();
    const zusatz = page.getByTestId("vertrag-zusatz");
    await expect(zusatz).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), zusatz.getByRole("button", { name: "Auftragsbestätigung erzeugen" }).click()]);
    const text = await pdfText(await download.path());
    expect(text).toContain(vertrag.nummer);
    expect(text).toContain("140.999,05");
    expect(text).toContain(`Zahlungsziel ${vertrag.zahlungsziel_tage} Tage`);
    await expect.poll(async () => (await (await request.get(`${API}/Honorarvertrag/${vertrag.id}`)).json()).bestaetigung_dokument_id, { timeout: 20000 }).toBeTruthy();
    const mitBeleg = await (await request.get(`${API}/Honorarvertrag/${vertrag.id}`)).json();
    const dok = await (await request.get(`${API}/Document/${mitBeleg.bestaetigung_dokument_id}`)).json();
    expect(dok.type).toBe("Auftragsbestätigung");
    expect(dok.bereich).toBe("buero");
    await zusatz.getByRole("link", { name: "Projektzuordnung pflegen" }).click();
    await expect(page).toHaveURL(/\/People\?tab=staff/);

    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen(request);
  }
});
