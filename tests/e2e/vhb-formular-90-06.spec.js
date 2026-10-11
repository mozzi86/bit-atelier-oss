// Headless-Nachweis 90-06 (VHB-Formular als Entwurf): eigene Vergabe im Review-Testhaus mit einem Bieter
// per API. Ein ausfüllbares Test-Formular „4420_Abnahme.pdf“ wird hier mit pdf-lib erzeugt (die App liefert
// keine Formblätter). Hochladen → Formular 4420 erkannt, Standardfelder belegt, Vergabe-Nr. fehlt als Lücke,
// Kreuzfeld bleibt offen; Download ist gesperrt bis Stand + Prüfer + Bestätigung; danach PDF mit
// eingetragenem Projekt und Bieter, Felder noch ausfüllbar; Eintrag in `tender.vhb_formulare`.
// Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const API = "/api/entities";

async function testformular() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  let y = 780;
  for (const n of ["ag_massnahme_bez_1", "ag_leistung_bez", "ag_vergabe_nr", "ag_comm_empfaenger_nam", "ag_201"]) {
    form.createTextField(n).addToPage(page, { x: 50, y, width: 300, height: 18 }); y -= 24;
  }
  form.createCheckBox("ag_115").addToPage(page, { x: 50, y, width: 12, height: 12 });
  return Buffer.from(await doc.save());
}

test.describe("90-06 VHB-Formular", () => {
  test.setTimeout(150000);

  test("Standardfelder, Lücken, Pflicht-Prüfschritt, Entwurf ausfüllbar, Protokoll an der Vergabe", async ({ page, request }) => {
    const angelegt = [];
    const neu = async (entity, data) => { const r = await request.post(`${API}/${entity}`, { data }); expect(r.ok(), `${entity} anlegen`).toBe(true); const j = await r.json(); angelegt.push([entity, j.id]); return j; };
    try {
      const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
      const lv = await neu("LVPosition", { project_id: projekt.id, oz: "01.0010", title: "Beton", quantity: 10, unit: "m³", unit_price: 100, trade: "E2E 90-06 Rohbau" });
      const k = await neu("Contact", { name: "E2E Bau 9006", company: "E2E Bau 9006 GmbH", category: "contractor" });
      const tender = await neu("Tender", { project_id: projekt.id, name: "E2E 90-06 Rohbau", trade: "E2E 90-06 Rohbau", status: "published", position_ids: [lv.id], invited_contact_ids: [k.id] });
      await neu("Bid", { tender_id: tender.id, project_id: projekt.id, contact_id: k.id, bidder_name: "E2E Bau 9006 GmbH", status: "submitted", line_items: [{ position_id: lv.id, unit_price: 95 }] });

      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=tender`);
      const karte = page.locator("div").filter({ hasText: "E2E 90-06 Rohbau" }).filter({ has: page.getByRole("button", { name: "Preisspiegel" }) }).last();
      await karte.getByRole("button", { name: "Preisspiegel" }).click();
      await page.getByTestId("pv-vhb").click();
      await page.getByTestId("vf-datei").setInputFiles({ name: "4420_Abnahme.pdf", mimeType: "application/pdf", buffer: await testformular() });

      await expect(page.getByTestId("vf-formular")).toHaveAttribute("data-nummer", "4420");
      const bel = page.getByTestId("vf-belegung");
      await expect(bel).toHaveAttribute("data-luecken", "1");
      await expect(bel).toHaveAttribute("data-offen", "2");
      const knopf = page.getByTestId("vf-herunterladen");
      await expect(knopf).toBeDisabled();
      await page.getByTestId("vf-stand").fill("VHB Bund 2017, Stand 2024");
      await page.getByTestId("vf-pruefer").fill("E2E Prüfer");
      await expect(knopf).toBeDisabled();
      await page.getByTestId("vf-bestaetigt").check();
      await expect(knopf).toBeEnabled();

      const [dl] = await Promise.all([page.waitForEvent("download"), knopf.click()]);
      expect(dl.suggestedFilename()).toBe("4420_Abnahme_Entwurf.pdf");
      const doc = await PDFDocument.load(fs.readFileSync(await dl.path()));
      const form = doc.getForm();
      expect(form.getFields().length).toBe(6);
      expect(form.getTextField("ag_massnahme_bez_1").getText()).toBe("Review Testhaus");
      expect(form.getTextField("ag_comm_empfaenger_nam").getText()).toBe("E2E Bau 9006 GmbH");
      expect(form.getTextField("ag_vergabe_nr").getText()).toBe("[BITTE ERGÄNZEN]");

      await expect(page.getByTestId("vf-protokoll")).toHaveAttribute("data-anzahl", "1", { timeout: 20000 });
      const tn = await (await request.get(`${API}/Tender/${tender.id}`)).json();
      expect(tn.vhb_formulare[0]).toMatchObject({ nummer: "4420", stand: "VHB Bund 2017, Stand 2024", pruefer: "E2E Prüfer", entwurf: true });
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      for (const [entity, id] of angelegt.reverse()) await request.delete(`${API}/${entity}/${id}`);
    }
  });
});
