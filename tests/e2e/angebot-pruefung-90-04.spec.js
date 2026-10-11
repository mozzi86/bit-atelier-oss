// Headless-Nachweis 90-04 (Angebotsprüfung im Preisspiegel): eigene kleine Vergabe im Review-Testhaus
// (3 LV-Positionen, 2 Bieter-Kontakte) per API. Bieter B kommt per API mit eigenen Gesamtbeträgen je
// Position (einer mit Zahlendreher 10 088 statt 10 880). Bieter A wird über „Angebot erfassen“ getippt,
// mit einem LEEREN EP-Feld und einem „0“ → das gespeicherte Bid hat für das leere Feld KEINE Zeile (Befund
// aus 90-03 behoben), der Preisspiegel zeigt „1 ohne Preis“. Prüfdialog B: 1 Befund (GP ≠ Menge × EP),
// Prüfvermerk speichern → steht am Bid, Kopf zeigt „geprüft“; Prüfdialog A: 2 Befunde (kein Preis,
// 0,00 €); Angebots-PDF stempeln → Download mit gleicher Seitenzahl. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const API = "/api/entities";
const FIRMA_A = "E2E Handbau 9004 GmbH";
const FIRMA_B = "E2E Importbau 9004 GmbH";

test.describe("90-04 Angebotsprüfung", () => {
  test.setTimeout(180000);

  test("leeres EP bleibt leer, Rechenfehler gefunden, Prüfvermerk gespeichert und gestempelt", async ({ page, request }) => {
    const angelegt = [];
    const neu = async (entity, data) => { const r = await request.post(`${API}/${entity}`, { data }); expect(r.ok(), `${entity} anlegen`).toBe(true); const j = await r.json(); angelegt.push([entity, j.id]); return j; };
    try {
      const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
      expect(projekt, "Review Testhaus vorhanden").toBeTruthy();
      const lv = [];
      for (const [oz, title, quantity, unit, ep] of [["01.01.0010", "Oberboden abtragen", 120, "m²", 5], ["01.01.0020", "Baugrube ausheben", 850, "m³", 14], ["01.01.0030", "Verfüllen", 300, "m³", 9]]) {
        lv.push(await neu("LVPosition", { project_id: projekt.id, oz, title, description: title, quantity, unit, unit_price: ep, trade: "E2E 90-04 Erdarbeiten" }));
      }
      const kA = await neu("Contact", { name: "E2E A", company: FIRMA_A, category: "contractor" });
      const kB = await neu("Contact", { name: "E2E B", company: FIRMA_B, category: "contractor" });
      const tender = await neu("Tender", { project_id: projekt.id, name: "E2E 90-04 Erdarbeiten", status: "published", position_ids: lv.map((p) => p.id), invited_contact_ids: [kA.id] });
      const bidB = await neu("Bid", {
        tender_id: tender.id, project_id: projekt.id, contact_id: kB.id, bidder_name: FIRMA_B, status: "submitted", submitted_date: new Date().toISOString(),
        angebotssumme_bieter: 13790,
        line_items: [
          { position_id: lv[0].id, unit_price: 4.5, total_price: 540 },
          { position_id: lv[1].id, unit_price: 12.8, total_price: 10088 },
          { position_id: lv[2].id, unit_price: 7.9, total_price: 2370 },
        ],
      });

      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=tender`);
      const karte = page.locator("div").filter({ hasText: "E2E 90-04 Erdarbeiten" }).filter({ has: page.getByRole("button", { name: "Preisspiegel" }) }).last();
      await karte.getByRole("button", { name: "Preisspiegel" }).click();

      // --- Bieter A von Hand: Position 2 leer, Position 3 als echte 0 ---
      await page.getByRole("button", { name: "Angebot erfassen" }).click();
      const ep = page.getByPlaceholder("EP");
      await ep.nth(0).fill("5");
      await ep.nth(2).fill("0");
      await page.getByRole("button", { name: "Angebot speichern" }).click();
      const kopfA = page.locator("th").filter({ hasText: FIRMA_A });
      await expect(kopfA).toBeVisible({ timeout: 20000 });
      const bids = await (await request.get(`${API}/Bid?tender_id=${encodeURIComponent(tender.id)}`)).json();
      const bidA = bids.find((b) => b.bidder_name === FIRMA_A);
      angelegt.push(["Bid", bidA.id]);
      expect(bidA.line_items.map((l) => [l.position_id, l.unit_price])).toEqual([[lv[0].id, 5], [lv[2].id, 0]]);
      expect(bidA.note).toMatch(/1 Position\(en\) ohne Preis/);
      await expect(page.getByTestId("pv-unvollstaendig")).toContainText("1");
      await expect(kopfA.getByTestId("pv-pruefen")).toHaveAttribute("data-befunde", "2");

      // --- Bieter B prüfen: Zahlendreher gefunden, Prüfvermerk speichern ---
      const kopfB = page.locator("th").filter({ hasText: FIRMA_B });
      await expect(kopfB.getByTestId("pv-pruefen")).toHaveAttribute("data-status", "keine");
      await kopfB.getByTestId("pv-pruefen").click();
      const zus = page.getByTestId("ap-zusammenfassung");
      await expect(zus).toHaveAttribute("data-befunde", "1");
      await expect(zus).toHaveAttribute("data-summe", String(540 + 10880 + 2370));
      await expect(page.getByTestId("ap-zeile")).toHaveCount(1);
      await expect(page.getByTestId("ap-zeile").first()).toHaveAttribute("data-codes", "rechenfehler");
      await page.getByTestId("ap-pruefer").fill("E2E Prüfer");

      // Stamp the bidder's offer PDF (two pages) → download keeps the page count.
      const quelle = await PDFDocument.create();
      quelle.addPage([595.28, 841.89]); quelle.addPage([595.28, 841.89]);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("ap-pdf").setInputFiles({ name: "angebot-b.pdf", mimeType: "application/pdf", buffer: Buffer.from(await quelle.save()) }),
      ]);
      expect(download.suggestedFilename()).toBe("angebot-b_geprueft.pdf");
      const gestempelt = await PDFDocument.load(fs.readFileSync(await download.path()));
      expect(gestempelt.getPageCount()).toBe(2);

      await page.getByTestId("ap-speichern").click();
      await expect(kopfB.getByTestId("pv-pruefen")).toHaveAttribute("data-status", "aktuell", { timeout: 20000 });
      const b2 = await (await request.get(`${API}/Bid/${bidB.id}`)).json();
      expect(b2.pruefung.pruefer).toBe("E2E Prüfer");
      expect(b2.pruefung.befunde).toBe(1);
      expect(b2.pruefung.summe_geprueft).toBe(13790);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      for (const [entity, id] of angelegt.reverse()) await request.delete(`${API}/${entity}/${id}`);
    }
  });
});
