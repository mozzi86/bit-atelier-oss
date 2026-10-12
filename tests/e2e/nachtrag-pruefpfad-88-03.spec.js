// Headless-Nachweis 88-03 (Nachtrags-Prüfpfad VOB/B § 2 Abs. 5/6): ein Nachtrag „Zusätzliche Leistung“
// mit festen Beträgen (gefordert 12 000 €, geprüft 10 500 €, ohne Ankündigung) wird per API am Review
// Testhaus angelegt. Finance zeigt die drei Beträge und Prüfhinweise; im Formular steht die Warnung
// § 2 Abs. 6 und verschwindet nach „angekündigt vor Ausführung“ + Urkalkulation. Genehmigen setzt
// freigegeben = geprüft und cost_impact = 10 500 €; die Kostenkontrolle zeigt die drei Summen und die
// Kürzung 1 500 €. Aufräumen im finally und beim Start (Reste eines abgebrochenen Laufs).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const MARKE = "E2E8803";

test("88-03 Nachtrag: Prüfpfad, Genehmigung, Kostenkontrolle", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const alle = await (await request.get(`${API}/ChangeOrder`)).json();
  for (const x of alle.filter((r) => String(r.title || "").startsWith(MARKE))) await request.delete(`${API}/ChangeOrder/${x.id}`);
  const vorhanden = alle.filter((r) => r.project_id === projekt.id && !String(r.title || "").startsWith(MARKE) && r.betrag_gefordert != null);
  expect(vorhanden.length, "Testhaus hat keine fremden Nachträge mit Prüfpfad").toBe(0);

  const titel = `${MARKE} Zusätzliche Kernbohrungen`;
  const r = await request.post(`${API}/ChangeOrder`, { data: {
    project_id: projekt.id, project_name: projekt.name, title: titel, status: "pending",
    submission_date: "2026-03-05T00:00:00.000Z", art: "zusatzleistung", angekuendigt_am: null,
    ankuendigung_vor_ausfuehrung: null, betrag_gefordert: 12000, betrag_geprueft: 10500,
    betrag_freigegeben: null, urkalkulation_ref: "", cost_impact: 10500,
  } });
  expect(r.ok()).toBe(true);
  const co = await r.json();
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    await page.goto(`/Finance?projekt=${encodeURIComponent("Review Testhaus")}`);
    const zeile = page.locator(`tr[data-nachtrag="${co.id}"]`);
    await expect(zeile.getByTestId("nachtrag-betraege")).toContainText("12.000,00", { timeout: 30000 });
    await expect(zeile.getByTestId("nachtrag-betraege")).toContainText("10.500,00");
    await expect(zeile.getByTestId("nachtrag-betraege")).toContainText("Prüfhinweise");

    // Form: § 2 Abs. 6 warning, then the announcement before execution clears it.
    await zeile.getByRole("button", { name: `Nachtrag „${titel}“ bearbeiten` }).click();
    const hinweise = page.getByTestId("nachtrag-hinweise");
    await expect(hinweise.locator('[data-stufe="warn"]')).toContainText("§ 2 Abs. 6 Nr. 1 S. 2");
    await expect(page.locator("#nachtrag-kosten")).toHaveValue("10500");
    await page.locator("#nachtrag-angekuendigt").fill("2026-03-02");
    await page.locator("#nachtrag-vor-ausfuehrung").selectOption("ja");
    await page.locator("#nachtrag-urkalkulation").fill("Urkalkulation Pos. 02.0010");
    await expect(hinweise).toHaveCount(0);
    await page.getByRole("button", { name: "Nachtrag speichern" }).click();
    await expect(zeile.getByTestId("nachtrag-betraege")).not.toContainText("Prüfhinweise", { timeout: 15000 });

    // Approve → released = checked, cost_impact follows.
    await zeile.getByRole("button", { name: `Nachtrag „${titel}“ genehmigen` }).click();
    await expect.poll(async () => (await (await request.get(`${API}/ChangeOrder/${co.id}`)).json()).status, { timeout: 15000 }).toBe("approved");
    const gespeichert = await (await request.get(`${API}/ChangeOrder/${co.id}`)).json();
    expect(gespeichert.betrag_freigegeben).toBe(10500);
    expect(gespeichert.cost_impact).toBe(10500);
    expect(gespeichert.angekuendigt_am).toBe("2026-03-02");
    expect(gespeichert.ankuendigung_vor_ausfuehrung).toBe(true);

    // Cost control: the three sums and the reduction.
    await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=control`);
    const karte = page.getByTestId("cc-nachtrag-pruefpfad");
    await expect(karte).toBeVisible({ timeout: 30000 });
    await expect(karte.getByTestId("cc-np-gefordert")).toContainText("12.000");
    await expect(karte.getByTestId("cc-np-geprueft")).toContainText("10.500");
    await expect(karte.getByTestId("cc-np-freigegeben")).toContainText("10.500");
    await expect(karte.getByTestId("cc-np-kuerzung")).toContainText("1.500");
    await expect(karte.locator(`[data-testid=cc-np-zeile][data-nachtrag="${co.id}"]`)).toContainText("keine");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await request.delete(`${API}/ChangeOrder/${co.id}`);
  }
});
