// 94-04: the two small acceptance findings.
//  - B-ABN-03: a contact without e-mail can be saved (client/authority without a known address).
//  - B-ABN-09: "Termin anlegen" starts on the active project (?projekt=).
// Creates one contact and deletes it; the appointment dialog is cancelled, nothing is saved.
import { test, expect } from "@playwright/test";
import { PROJEKT_NAME } from "./fixtures/testhaus.js";

const API = "/api/entities";
const NAME = "E2E Behörde 94-04";

async function aufraeumen(request) {
  for (const k of await (await request.get(`${API}/Contact`)).json()) if (k.name === NAME) await request.delete(`${API}/Contact/${k.id}`);
}

test("Kontakt ohne E-Mail speichern (B-ABN-03)", async ({ page, request }) => {
  await aufraeumen(request);
  try {
    await page.goto("/AddressBook");
    await page.getByRole("button", { name: "Neuer Kontakt" }).first().click();
    await page.locator("#name").fill(NAME);
    await expect(page.locator("#email")).not.toHaveAttribute("required", "");
    await page.getByRole("button", { name: "Kontakt speichern" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/Contact`)).json()).filter((k) => k.name === NAME).length).toBe(1);
  } finally {
    await aufraeumen(request);
  }
});

test("Termin anlegen belegt das aktive Projekt vor (B-ABN-09)", async ({ page, request }) => {
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`)).json())[0];
  expect(projekt, "Testhaus fehlt").toBeTruthy();
  await page.goto(`/Deadlines?projekt=${encodeURIComponent(projekt.id)}`);
  await page.getByRole("button", { name: "Termin anlegen" }).first().click();
  // The project select is the one offering "ohne Projekt" (its wrapping label also reads the options).
  const auswahl = page.locator("select", { has: page.locator("option", { hasText: "ohne Projekt" }) });
  await expect(auswahl).toHaveValue(projekt.id);
});
