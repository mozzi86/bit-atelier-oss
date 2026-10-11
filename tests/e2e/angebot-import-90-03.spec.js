// Headless-Nachweis 90-03 (GAEB-Angebot X84 → Preisspiegel): eine eigene kleine Vergabe im Review-
// Testhaus (3 LV-Positionen, 1 Bieter-Kontakt) per API anlegen; die App-eigene X83 dieser Positionen
// so ausfüllen, wie ein Bieter es tut (DP 84, UP/IT, Bieter in Award/CTR), im Preisspiegel über
// „GAEB-Angebot importieren“ laden → Zusammenfassung 2 von 3 mit Preis, 1 ohne Preis, Summe aus
// LV-Mengen, Kontakt per Firmenname vorgewählt → „Als Angebot übernehmen“ → der Preisspiegel zeigt den
// Bieter mit seiner Summe; das gespeicherte Bid hat KEINE Zeile für die Position ohne Preis (keine 0).
// Alles Angelegte wird im finally per API gelöscht. Konsole bleibt sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";
import { buildX83 } from "../../packages/nova-ausschreibung/src/lib/gaebX83.js";

const API = "/api/entities";
const FIRMA = "E2E Musterbau 9003 GmbH";

function angebotX84() {
  const pos = [
    { oz: "01010010", titel: ["Rohbau", "Erdarbeiten"], titel_oz: ["01", "0101"], kurztext: "Oberboden abtragen", menge_final: 120, einheit: "m2" },
    { oz: "01010020", titel: ["Rohbau", "Erdarbeiten"], titel_oz: ["01", "0101"], kurztext: "Baugrube ausheben", menge_final: 850, einheit: "m3" },
    { oz: "01010030", titel: ["Rohbau", "Erdarbeiten"], titel_oz: ["01", "0101"], kurztext: "Verfüllen", menge_final: 300, einheit: "m3" },
  ];
  const preise = { "0010": [4.5, 540], "0020": [12.8, 10880] };
  let xml = buildX83({ positionen: pos, gewerk_nr: "012", lv_name: "Erdarbeiten" });
  xml = xml.replace("<DP>83</DP>", `<DP>84</DP><CTR><Address><Name1>${FIRMA}</Name1><City>Musterstadt</City></Address></CTR>`);
  xml = xml.replace(/(<Item [^>]*RNoPart="(\d{4})">\s*<Qty>[^<]*<\/Qty>\s*<QU>[^<]*<\/QU>)/g, (m, a, nr) => (preise[nr] ? `${a}<UP>${preise[nr][0]}</UP><IT>${preise[nr][1]}</IT>` : a));
  return Buffer.from(xml, "utf8");
}

test.describe("90-03 GAEB-Angebot importieren", () => {
  test.setTimeout(180000);

  test("X84 → Vorschau mit Lücken → Angebot im Preisspiegel, ohne 0 für fehlende Preise", async ({ page, request }) => {
    const angelegt = [];
    const neu = async (entity, data) => { const r = await request.post(`${API}/${entity}`, { data }); expect(r.ok(), `${entity} anlegen`).toBe(true); const j = await r.json(); angelegt.push([entity, j.id]); return j; };
    try {
      const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
      expect(projekt, "Review Testhaus vorhanden").toBeTruthy();
      const lv = [];
      for (const [oz, title, quantity, unit, ep] of [["01.01.0010", "Oberboden abtragen", 120, "m²", 5], ["01.01.0020", "Baugrube ausheben", 850, "m³", 14], ["01.01.0030", "Verfüllen", 300, "m³", 9]]) {
        lv.push(await neu("LVPosition", { project_id: projekt.id, oz, title, description: title, quantity, unit, unit_price: ep, trade: "E2E 90-03 Erdarbeiten" }));
      }
      const kontakt = await neu("Contact", { name: "E2E Ansprechpartner", company: FIRMA, category: "contractor" });
      const tender = await neu("Tender", { project_id: projekt.id, name: "E2E 90-03 Erdarbeiten", status: "published", position_ids: lv.map((p) => p.id), invited_contact_ids: [kontakt.id] });

      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=tender`);
      const karte = page.locator("div").filter({ hasText: "E2E 90-03 Erdarbeiten" }).filter({ has: page.getByRole("button", { name: "Preisspiegel" }) }).last();
      await karte.getByRole("button", { name: "Preisspiegel" }).click();
      await page.getByTestId("pv-gaeb-import").click();
      await page.getByTestId("ai-datei").setInputFiles({ name: "angebot-musterbau.x84", mimeType: "application/xml", buffer: angebotX84() });

      const zus = page.getByTestId("ai-zusammenfassung");
      await expect(zus).toHaveAttribute("data-zugeordnet", "2", { timeout: 20000 });
      await expect(zus).toHaveAttribute("data-ohne-preis", "1");
      await expect(zus).toHaveAttribute("data-unbekannt", "0");
      await expect(zus).toHaveAttribute("data-summe", String(540 + 10880));
      await expect(page.getByTestId("ai-kontakt")).toHaveValue(kontakt.id);
      await expect(page.getByTestId("ai-hinweise")).toContainText("kein Preis im Angebot");
      await page.getByTestId("ai-speichern").click();
      await expect(page.getByText(FIRMA).first()).toBeVisible({ timeout: 20000 });

      const bids = await (await request.get(`${API}/Bid?tender_id=${encodeURIComponent(tender.id)}`)).json();
      expect(bids.length).toBe(1);
      angelegt.push(["Bid", bids[0].id]);
      expect(bids[0].quelle).toBe("gaeb_x84");
      expect(bids[0].line_items.map((l) => [l.position_id, l.unit_price])).toEqual([[lv[0].id, 4.5], [lv[1].id, 12.8]]);
      expect(bids[0].note).toMatch(/1 Position\(en\) ohne Preis/);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      for (const [entity, id] of angelegt.reverse()) await request.delete(`${API}/${entity}/${id}`);
    }
  });
});
