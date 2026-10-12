// Phase 93 (93-01, lever 156): XRechnung download of an issued outgoing invoice
// against the Express dev stack.
//  - creates an issued invoice on the test house (recipient with Leitweg-ID and address),
//  - first with EMPTY office data (accounting settings + letterhead blanked): the button
//    offers no file but lists the missing pieces with their rule IDs (BR-DE-23 IBAN, …),
//  - then with placeholder office data: the download is a UBL Invoice with the
//    XRechnung 3.0 CustomizationID, the Leitweg-ID as BT-10 and the amounts,
//  - English labels, console clean,
//  - restores both Setting rows and removes the invoice in `finally`.
// All data are placeholders (test IBAN of tools/sperrliste.mjs, fake VAT ID).
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";

const API = "/api/entities";
const LEITWEG = "04011000-1234512345-06";

/**
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string} key Setting key
 * @returns {Promise<any|null>} first row of the key
 */
async function settingZeile(request, key) {
  const zeilen = await (await request.get(`${API}/Setting?key=${encodeURIComponent(key)}`)).json();
  return Array.isArray(zeilen) && zeilen[0] ? zeilen[0] : null;
}

test("XRechnung: Pflichtangaben fehlen → Regelliste; vollständig → UBL-Datei mit Leitweg-ID", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`)).json())[0];
  expect(projekt, "Testhaus fehlt").toBeTruthy();

  const buchVorher = await settingZeile(request, "buchhaltung");
  const kopfVorher = await settingZeile(request, "briefkopf");
  /** @type {Array<[string, string]>} rows created by this test */
  const angelegt = [];
  const setzeSetting = async (vorher, key, wert) => {
    if (vorher) {
      await request.put(`${API}/Setting/${vorher.id}`, { data: { value: wert } });
    } else {
      const neu = await (await request.post(`${API}/Setting`, { data: { key, value: wert } })).json();
      angelegt.push(["Setting", neu.id]);
      return neu;
    }
    return vorher;
  };

  const rechnung = await (await request.post(`${API}/Ausgangsrechnung`, { data: {
    project_id: projekt.id, project_name: projekt.name, nummer: "E2E-93-01", art: "abschlag", status: "gestellt",
    lp_pos: [{ lp: 2, stand: 100, netto: 4000 }, { lp: 3, stand: 50, netto: 6000 }],
    netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900,
    rechnungsdatum: "2026-10-01", faellig_am: "2026-10-15", zahlungsziel_tage: 14,
    empfaenger: { name: "Stadt Musterstadt, Hochbauamt", anschrift: "Rathausplatz 2, 90403 Musterstadt", ust_idnr: "", art: "oeffentlich", leitweg_id: LEITWEG },
    zahlungen: [], mahnungen: [],
  } })).json();
  angelegt.push(["Ausgangsrechnung", rechnung.id]);

  try {
    await nurLocalhost(page);
    const konsole = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) konsole.push(m.text()); });
    page.on("pageerror", (e) => konsole.push(`pageerror ${e}`));

    // 1. Office data blanked: no file, the missing pieces with rule IDs.
    const buchZeile = await setzeSetting(buchVorher, "buchhaltung", { ...(buchVorher?.value || {}), buero: { name: "", steuernr: "", ust_idnr: "", iban: "" } });
    const kopfZeile = await setzeSetting(kopfVorher, "briefkopf", { ...(kopfVorher?.value || {}), office: "", address: "", contact: "" });
    await page.goto(`/Accounting?tab=invoices&projekt=${encodeURIComponent(projekt.id)}`);
    const knopf = page.getByTestId(`xrechnung-${rechnung.id}`);
    await expect(knopf).toBeVisible({ timeout: 30000 });
    await knopf.click();
    const fehler = page.getByTestId(`xrechnung-fehler-${rechnung.id}`);
    await expect(fehler).toBeVisible();
    await expect(fehler).toContainText("BR-DE-23");
    await expect(fehler).toContainText("BR-DE-7");
    await expect(fehler).toContainText("BR-06");
    await expect(fehler).not.toContainText("BR-DE-15");

    // 2. Placeholder office data: the download.
    await request.put(`${API}/Setting/${buchZeile.id}`, { data: { value: { ...(buchVorher?.value || {}), buero: { name: "Beispiel Architekturbüro", steuernr: "", ust_idnr: "DE123456789", iban: "DE02120300000000202051" } } } });
    await request.put(`${API}/Setting/${kopfZeile.id}`, { data: { value: { ...(kopfVorher?.value || {}), office: "Beispiel Architekturbüro", address: "Musterstraße 1\n90402 Musterstadt", contact: "Tel. 0911 000000 · info@example.de" } } });
    await page.reload();
    await expect(knopf).toBeVisible({ timeout: 30000 });
    const [download] = await Promise.all([page.waitForEvent("download"), knopf.click()]);
    expect(download.suggestedFilename()).toBe("XRechnung-E2E-93-01.xml");
    const xml = fs.readFileSync(/** @type {string} */ (await download.path()), "utf8");
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>");
    expect(xml).toContain(`<cbc:BuyerReference>${LEITWEG}</cbc:BuyerReference>`);
    expect(xml).toContain("<cbc:InvoiceTypeCode>326</cbc:InvoiceTypeCode>");
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">11900.00</cbc:PayableAmount>');
    expect(xml).toContain("<cbc:PostalZone>90402</cbc:PostalZone>");
    await expect(fehler).toHaveCount(0);

    // 3. Read view carries the same button; English label.
    await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* storage blocked */ } });
    await page.reload();
    await expect(knopf).toBeVisible({ timeout: 30000 });
    await expect(knopf).toHaveAttribute("title", "Electronic invoice under EN 16931 for public clients");

    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    if (buchVorher) await request.put(`${API}/Setting/${buchVorher.id}`, { data: { value: buchVorher.value } });
    if (kopfVorher) await request.put(`${API}/Setting/${kopfVorher.id}`, { data: { value: kopfVorher.value } });
    for (const [entitaet, id] of angelegt) await request.delete(`${API}/${entitaet}/${id}`);
  }
});
