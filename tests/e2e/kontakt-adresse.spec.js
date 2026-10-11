// Headless-Nachweis Kontakt-Anschrift (11.10.2026): im Adressbuch „Neuer Kontakt“ mit Straße, PLZ und Ort
// anlegen → gespeichert als address/zip/city, die Kontaktkarte zeigt die Anschrift; Bearbeiten zeigt die
// Werte wieder. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Adresse 1110";

test("Kontaktformular speichert und zeigt die Anschrift", async ({ page, request }) => {
  test.setTimeout(120000);
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
    await page.getByRole("button", { name: "Neuer Kontakt" }).click();
    await page.locator("#name").fill(NAME);
    await page.locator("#email").fill("adresse1110@example.com");
    await page.locator("#company").fill("E2E Adressbau GmbH");
    await page.locator("#address").fill("Bauweg 5");
    await page.locator("#zip").fill("12345");
    await page.locator("#city").fill("Musterstadt");
    await page.getByRole("button", { name: "Kontakt speichern" }).click();

    await expect.poll(async () => (await (await request.get(`${API}/Contact?name=${encodeURIComponent(NAME)}`)).json())[0]?.city, { timeout: 15000 }).toBe("Musterstadt");
    const c = (await (await request.get(`${API}/Contact?name=${encodeURIComponent(NAME)}`)).json())[0];
    expect([c.address, c.zip, c.city]).toEqual(["Bauweg 5", "12345", "Musterstadt"]);
    await expect(page.getByTestId("kontakt-adresse").filter({ hasText: "Bauweg 5, 12345 Musterstadt" })).toBeVisible();
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    const reste = await (await request.get(`${API}/Contact?name=${encodeURIComponent(NAME)}`)).json();
    for (const c of reste) await request.delete(`${API}/Contact/${c.id}`);
  }
});
