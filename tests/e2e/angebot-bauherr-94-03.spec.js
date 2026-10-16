// 94-03 (B-ABN-04/05): offer wizard step 1 — client from the address book
// (name + address filled, contact id kept), "Weiter" without a project is
// stopped right in step 1, and a project can be created inside the wizard.
// Creates its own contact and project, deletes both in `finally`.
import { test, expect } from "@playwright/test";

const API = "/api/entities";
const FIRMA = "E2E Bauherrin 9403 GmbH";
const PROJEKT = "E2E Projekt 94-03";

/** Removes leftovers of this spec (a timeout never reaches `finally`). */
async function aufraeumen(request) {
  for (const k of await (await request.get(`${API}/Contact`)).json()) if (k.company === FIRMA) await request.delete(`${API}/Contact/${k.id}`);
  for (const p of await (await request.get(`${API}/Project`)).json()) if (p.name === PROJEKT) await request.delete(`${API}/Project/${p.id}`);
}

test("Angebot: Bauherr aus dem Adressbuch, Projekt im Assistenten anlegen (94-03)", async ({ page, request }) => {
  await aufraeumen(request);
  try {
    await request.post(`${API}/Contact`, { data: { name: "Erika Muster", company: FIRMA, role: "Bauherr", email: "", address: "Hauptstraße 1", zip: "90402", city: "Musterstadt" } });

    await page.goto("/Fees?tab=offers");
    await page.getByRole("button", { name: "Neues Honorarangebot" }).first().click();
    const dialog = page.getByTestId("angebot-assistent");
    await expect(dialog).toBeVisible();

    // No project → stopped in step 1 with a message, not at the very end.
    await page.locator("#as-projekt").selectOption("");
    await dialog.getByRole("button", { name: "Weiter" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Bitte ein Projekt wählen");
    await expect(page.locator("#as-projekt")).toBeVisible();

    // Client from the address book; clients are listed first.
    const kontakt = page.locator("#as-kontakt");
    const option = kontakt.locator("option", { hasText: FIRMA });
    await expect(option).toHaveCount(1);
    await kontakt.selectOption({ label: await option.textContent() });
    await expect(page.locator("#as-bauherr")).toHaveValue(FIRMA);
    await expect(page.locator("#as-anschrift")).toHaveValue("Hauptstraße 1, 90402 Musterstadt");

    // Project created inside the wizard and selected.
    await page.getByTestId("as-neues-projekt").click();
    await page.locator("#as-projekt-name").fill(PROJEKT);
    await page.getByTestId("as-projekt-anlegen").click();
    await expect(page.locator("#as-projekt option:checked")).toHaveText(PROJEKT);
    await expect(dialog.getByRole("alert")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Weiter" }).click();
    await expect(page.locator("#as-leistungsbild")).toBeVisible();
    const p = (await (await request.get(`${API}/Project`)).json()).find((x) => x.name === PROJEKT);
    expect(p?.client).toBe(FIRMA);
  } finally {
    await aufraeumen(request);
  }
});
