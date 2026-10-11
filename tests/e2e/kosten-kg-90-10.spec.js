// Headless-Nachweis 90-10 (Kostenkontrolle je KG): im Review-Testhaus zwei eigene LV-Positionen in einer
// seltenen KG (KG 380 „Baukonstruktive Einbauten“ — nicht in den Seed-Daten) und eine vergebene Vergabe per
// API. Reiter „Kostenkontrolle“: Zeile KG 380 mit Abweichung +1 000 €; Excel-Export lädt eine XLSX (ZIP);
// „Budgeterhöhung“ öffnet den Antrag mit 7 000 € vorgeschlagen und der Ursache als Lücke; PDF-Entwurf mit
// Beträgen. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";

test.describe("90-10 Kostenkontrolle je KG", () => {
  test.setTimeout(150000);

  test("KG-Zeile, Excel-Export, Antrag Budgeterhöhung als PDF-Entwurf", async ({ page, request }) => {
    const angelegt = [];
    const neu = async (entity, data) => { const r = await request.post(`${API}/${entity}`, { data }); expect(r.ok(), `${entity} anlegen`).toBe(true); const j = await r.json(); angelegt.push([entity, j.id]); return j; };
    try {
      const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
      const vorher = (await (await request.get(`${API}/LVPosition?project_id=${projekt.id}`)).json()).filter((p) => String(p.din276) === "380");
      expect(vorher.length, "KG 380 ist im Testhaus frei").toBe(0);
      const p1 = await neu("LVPosition", { project_id: projekt.id, oz: "38.0010", title: "Einbauschrank", quantity: 100, unit: "St", unit_price: 50, din276: "380", trade: "E2E 90-10 Einbauten" });
      await neu("LVPosition", { project_id: projekt.id, oz: "38.0020", title: "Theke", quantity: 10, unit: "St", unit_price: 100, din276: "380", trade: "E2E 90-10 Einbauten" });
      const k = await neu("Contact", { name: "E2E 9010", company: "E2E Einbau 9010 GmbH", category: "contractor" });
      const t = await neu("Tender", { project_id: projekt.id, name: "E2E 90-10 Einbauschrank", status: "published", position_ids: [p1.id], invited_contact_ids: [k.id] });
      const b = await neu("Bid", { tender_id: t.id, project_id: projekt.id, contact_id: k.id, bidder_name: "E2E Einbau 9010 GmbH", status: "awarded", line_items: [{ position_id: p1.id, unit_price: 60 }] });
      await request.put(`${API}/Tender/${t.id}`, { data: { status: "awarded", awarded_bid_id: b.id } });

      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=control`);
      const zeile = page.locator('[data-testid="kk-zeile"][data-kg="380"]');
      await expect(zeile).toHaveAttribute("data-abweichung", "1000", { timeout: 20000 });

      const [x] = await Promise.all([page.waitForEvent("download"), page.getByTestId("kk-xlsx").click()]);
      expect(x.suggestedFilename()).toMatch(/^Kostenkontrolle_Review_Testhaus_\d{4}-\d{2}-\d{2}\.xlsx$/);
      expect(fs.readFileSync(await x.path()).subarray(0, 2).toString("latin1")).toBe("PK");

      await zeile.getByTestId("kk-antrag").click();
      await expect(page.getByTestId("ka-budget")).toHaveValue("7000");
      await expect(page.getByTestId("ka-begruendung")).toHaveValue(/Ursache: ______/);
      await page.getByTestId("ka-deckung").fill("Reserve KG 390");
      const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ka-pdf").click()]);
      expect(pdf.suggestedFilename()).toBe("Budgeterhoehung_KG380_Review_Testhaus_Entwurf.pdf");
      const txt = fs.readFileSync(await pdf.path()).toString("latin1");
      for (const s of ["ENTWURF", "7.000,00", "Reserve KG 390"]) expect(txt, s).toContain(s);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      for (const [entity, id] of angelegt.reverse()) await request.delete(`${API}/${entity}/${id}`);
    }
  });
});
