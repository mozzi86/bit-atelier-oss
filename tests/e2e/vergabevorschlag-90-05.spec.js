// Headless-Nachweis 90-05 (Vergabevorschlag aus dem Preisspiegel): eigene Vergabe im Review-Testhaus
// (3 LV-Positionen, Kostenanschlag 15 200 €) mit drei Angeboten per API — Beta (13 790 €, mit Prüfvermerk),
// Gamma (14 170 €), Alpha (unvollständig). Dialog „Vergabevorschlag“: Rangliste wertet 2, Vorschlag Beta,
// Alpha „nicht gewertet“; Warnung „nicht geprüft“ fehlt (Prüfvermerk aktuell); beide PDFs werden
// heruntergeladen (Vergabevorschlag mit „ENTWURF“ und Beta, Auftrags-LV mit Bruttosumme); „Vorschlag
// speichern“ legt `vergabevorschlag` am Tender ab — der Tender bleibt OHNE Zuschlag (status unverändert).
// Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";

test.describe("90-05 Vergabevorschlag", () => {
  test.setTimeout(180000);

  test("Rangliste, Begründung, zwei PDF-Entwürfe, Vorschlag am Tender ohne Zuschlag", async ({ page, request }) => {
    const angelegt = [];
    const neu = async (entity, data) => { const r = await request.post(`${API}/${entity}`, { data }); expect(r.ok(), `${entity} anlegen`).toBe(true); const j = await r.json(); angelegt.push([entity, j.id]); return j; };
    try {
      const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
      expect(projekt, "Review Testhaus vorhanden").toBeTruthy();
      const lv = [];
      for (const [oz, title, quantity, unit, ep] of [["01.01.0010", "Oberboden abtragen", 120, "m²", 5], ["01.01.0020", "Baugrube ausheben", 850, "m³", 14], ["01.01.0030", "Verfüllen", 300, "m³", 9]]) {
        lv.push(await neu("LVPosition", { project_id: projekt.id, oz, title, description: title, quantity, unit, unit_price: ep, trade: "E2E 90-05 Erdarbeiten" }));
      }
      const k = [];
      for (const n of ["Alpha", "Beta", "Gamma"]) k.push(await neu("Contact", { name: n, company: `E2E ${n} 9005 GmbH`, category: "contractor" }));
      const tender = await neu("Tender", { project_id: projekt.id, name: "E2E 90-05 Erdarbeiten", status: "published", position_ids: lv.map((p) => p.id), invited_contact_ids: k.map((c) => c.id) });
      const li = (preise) => preise.map((ep, i) => (ep === null ? null : { position_id: lv[i].id, unit_price: ep })).filter(Boolean);
      const basis = { tender_id: tender.id, project_id: projekt.id, status: "submitted", submitted_date: new Date().toISOString() };
      await neu("Bid", { ...basis, contact_id: k[0].id, bidder_name: "E2E Alpha 9005 GmbH", line_items: li([4, null, null]) });
      await neu("Bid", { ...basis, contact_id: k[1].id, bidder_name: "E2E Beta 9005 GmbH", line_items: li([4.5, 12.8, 7.9]),
        pruefung: { datum: new Date().toISOString(), pruefer: "E2E Prüfer", summe_geprueft: 13790, befunde: 0, hinweise: 0, ergebnis: "ohne_befund" } });
      await neu("Bid", { ...basis, contact_id: k[2].id, bidder_name: "E2E Gamma 9005 GmbH", line_items: li([5, 13, 8.4]) });

      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=tender`);
      const karte = page.locator("div").filter({ hasText: "E2E 90-05 Erdarbeiten" }).filter({ has: page.getByRole("button", { name: "Preisspiegel" }) }).last();
      await karte.getByRole("button", { name: "Preisspiegel" }).click();
      await page.getByTestId("pv-vergabe").click();

      const rl = page.getByTestId("vv-rangliste");
      await expect(rl).toHaveAttribute("data-gewertet", "2");
      await expect(rl).toHaveAttribute("data-vorschlag", "E2E Beta 9005 GmbH");
      await expect(rl).toHaveAttribute("data-netto", "13790");
      await expect(rl).toContainText("nicht gewertet");
      // Beta is checked, cheapest, 9 % below the estimate, two ranked offers → no open item at all.
      await expect(page.getByTestId("vv-warnungen")).toHaveCount(0);
      await expect(page.locator('[data-testid="vv-baustein"][data-id="nicht_gewertet"]')).toBeChecked();
      await page.getByTestId("vv-verfahren").selectOption("Freihändige Vergabe");

      const [dl1] = await Promise.all([page.waitForEvent("download"), page.getByTestId("vv-pdf").click()]);
      expect(dl1.suggestedFilename()).toMatch(/^Vergabevorschlag_.*Beta.*_Entwurf\.pdf$/);
      const t1 = fs.readFileSync(await dl1.path()).toString("latin1");
      for (const s of ["ENTWURF", "E2E Beta 9005 GmbH", "Freih", "13.790,00"]) expect(t1, s).toContain(s);

      const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("vv-lv-pdf").click()]);
      expect(dl2.suggestedFilename()).toMatch(/^Auftrags-LV_.*_Entwurf\.pdf$/);
      const t2 = fs.readFileSync(await dl2.path()).toString("latin1");
      for (const s of ["Auftrags-Leistungsverzeichnis", "10.880,00", "16.410,10"]) expect(t2, s).toContain(s);

      await page.getByTestId("vv-speichern").click();
      await expect(page.getByRole("status").filter({ hasText: "Vergabevorschlag gespeichert" })).toBeVisible({ timeout: 20000 });
      const tn = await (await request.get(`${API}/Tender/${tender.id}`)).json();
      expect(tn.vergabevorschlag.bieter).toBe("E2E Beta 9005 GmbH");
      expect(tn.vergabevorschlag.verfahren).toBe("Freihändige Vergabe");
      expect(tn.vergabevorschlag.netto).toBe(13790);
      expect(tn.status).toBe("published");
      expect(tn.awarded_bid_id ?? null).toBeNull();
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      const bids = await (await request.get(`${API}/Bid`)).json();
      for (const b of bids.filter((x) => String(x.bidder_name).includes("9005"))) await request.delete(`${API}/Bid/${b.id}`);
      for (const [entity, id] of angelegt.reverse()) if (entity !== "Bid") await request.delete(`${API}/${entity}/${id}`);
    }
  });
});
