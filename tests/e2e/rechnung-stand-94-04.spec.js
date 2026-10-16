// 94-04 (B-ABN-07): in the invoice form, "Stand (%)" computes the row amount
// through the Abschlag engine, an added row takes the next stage, and rows at
// 0,00 € are flagged. Creates its own fee contract on the test house (no
// invoice is saved — an issued one would be GoBD-final) and deletes it.
import { test, expect } from "@playwright/test";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";

const API = "/api/entities";
const BAUHERR = "E2E Bauherr 94-04";

/** @returns {Array<{nr: number, beauftragt: boolean}>} LPH 1–8 commissioned */
const lph = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((nr) => ({ nr, beauftragt: nr <= 8 }));

async function aufraeumen(request) {
  for (const v of await (await request.get(`${API}/Honorarvertrag`)).json()) if (v.bauherr_name === BAUHERR) await request.delete(`${API}/Honorarvertrag/${v.id}`);
}

test("Stand (%) rechnet den Zeilenbetrag, neue Zeile = nächste LP, 0-€-Hinweis (94-04)", async ({ page, request }) => {
  await aufraeumen(request);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`)).json())[0];
  expect(projekt, "Testhaus fehlt").toBeTruthy();
  const vertrag = await (await request.post(`${API}/Honorarvertrag`, { data: {
    project_id: projekt.id, nummer: "E2E-AV-9404", status: "beauftragt", bauherr_name: BAUHERR, leistungsbild: "gebaeude",
    kg300_euro: 900000, kg400_euro: 400000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0,
    lph: lph(), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
  } })).json();
  try {
    await page.goto(`/Accounting?tab=invoices&neu=1&vertrag=${encodeURIComponent(vertrag.id)}&projekt=${encodeURIComponent(projekt.id)}`);
    const stand = page.getByLabel("Stand (%)");
    await expect(stand.first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#rf-vertrag")).toHaveValue(vertrag.id);

    // First row to 100 % → an amount > 0.
    await page.getByLabel("LP").first().fill("1");
    await stand.first().fill("100");
    const netto = page.getByLabel("Netto").first();
    await expect(netto).not.toHaveValue(/^0,00$|^$/);
    const lp1 = await netto.inputValue();

    // Added row: next stage, 0 € until a stand is set → hint.
    await page.getByRole("button", { name: "Leistungsphase hinzufügen" }).click();
    await expect(page.getByLabel("LP").nth(1)).toHaveValue("2");
    await expect(page.getByTestId("rf-null-zeile")).toBeVisible();
    await stand.nth(1).fill("100");
    await expect(page.getByLabel("Netto").nth(1)).not.toHaveValue(/^0,00$|^$/);
    await expect(page.getByTestId("rf-null-zeile")).toHaveCount(0);
    // LP 1 keeps its amount; LP 2 (7 %) is larger than LP 1 (2 %).
    await expect(netto).toHaveValue(lp1);
    const zahl = (s) => Number(s.replace(/\./g, "").replace(",", "."));
    expect(zahl(await page.getByLabel("Netto").nth(1).inputValue())).toBeGreaterThan(zahl(lp1));
  } finally {
    await aufraeumen(request);
  }
});
