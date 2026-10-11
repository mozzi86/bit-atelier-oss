// Headless-Nachweis 90-07 (Projektbeteiligtenliste im Adressbuch): Review-Testhaus als aktuelles Projekt,
// zwei eigene Kontakte per API (Fachplanung, Auftragnehmer). Im Panel Kontakt wählen → Rolle springt aus der
// Kategorie vor (Tragwerksplanung), hinzufügen → Zeile da und am Projekt gespeichert (`beteiligte`);
// zweiten Kontakt als „Ausführende Firma“ mit Bemerkung; Rolle der ersten Zeile auf Prüfstatik ändern;
// PDF A4 quer herunterladen (quer, Titel, Firma); Zeile entfernen. Im finally: Kontakte löschen und die
// ursprüngliche Liste des Projekts wiederherstellen. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const API = "/api/entities";

test.describe("90-07 Projektbeteiligte", () => {
  test.setTimeout(150000);

  test("hinzufügen, Rolle ändern, PDF A4 quer, entfernen — gespeichert am Projekt", async ({ page, request }) => {
    const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
    expect(projekt, "Review Testhaus vorhanden").toBeTruthy();
    const vorher = projekt.beteiligte ?? null;
    const kontakte = [];
    try {
      for (const [name, company, category] of [["E2E Statik 9007", "E2E Statikbüro 9007", "engineer"], ["E2E Rohbau 9007", "E2E Rohbau 9007 GmbH", "contractor"]]) {
        const r = await request.post(`${API}/Contact`, { data: { name, company, category, phone: "0000 9007", email: "e2e9007@example.com" } });
        kontakte.push(await r.json());
      }
      await request.put(`${API}/Project/${projekt.id}`, { data: { beteiligte: [] } });

      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
      const panel = page.getByTestId("bp-panel");
      await expect(panel).toBeVisible({ timeout: 20000 });
      await expect(panel).toHaveAttribute("data-anzahl", "0");

      await page.getByTestId("bp-kontakt").selectOption(kontakte[0].id);
      await expect(page.getByTestId("bp-rolle")).toHaveValue("tragwerk");
      await page.getByTestId("bp-hinzufuegen").click();
      await expect(panel).toHaveAttribute("data-anzahl", "1");

      await page.getByTestId("bp-kontakt").selectOption(kontakte[1].id);
      await expect(page.getByTestId("bp-rolle")).toHaveValue("ausfuehrung");
      await page.getByTestId("bp-bemerkung").fill("Rohbau");
      await page.getByTestId("bp-hinzufuegen").click();
      await expect(panel).toHaveAttribute("data-anzahl", "2");

      await page.locator('[data-testid="bp-zeile"][data-rolle="tragwerk"]').getByTestId("bp-zeile-rolle").selectOption("pruefstatik");
      await expect(page.locator('[data-testid="bp-zeile"][data-rolle="pruefstatik"]')).toHaveCount(1);
      await expect.poll(async () => (await (await request.get(`${API}/Project/${projekt.id}`)).json()).beteiligte?.map((e) => e.rolle).sort().join(","), { timeout: 10000 })
        .toBe("ausfuehrung,pruefstatik");

      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bp-pdf").click()]);
      expect(dl.suggestedFilename()).toMatch(/^Projektbeteiligte_Review_Testhaus_\d{4}-\d{2}-\d{2}\.pdf$/);
      const bytes = fs.readFileSync(await dl.path());
      const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();
      expect(width).toBeGreaterThan(height);
      const txt = bytes.toString("latin1");
      for (const s of ["Projektbeteiligtenliste", "E2E Statikb", "E2E Rohbau 9007 GmbH", "Ausf"]) expect(txt, s).toContain(s);

      await page.locator('[data-testid="bp-zeile"][data-rolle="ausfuehrung"]').getByTestId("bp-entfernen").click();
      await expect(panel).toHaveAttribute("data-anzahl", "1");
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      for (const c of kontakte) await request.delete(`${API}/Contact/${c.id}`);
      await request.put(`${API}/Project/${projekt.id}`, { data: { beteiligte: vorher ?? [] } });
    }
  });
});
