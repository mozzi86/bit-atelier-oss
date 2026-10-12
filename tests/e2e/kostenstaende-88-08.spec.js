// Headless-Nachweis 88-08 (Kostenstände DIN 276 + Baukostenobergrenze): am Review Testhaus wird eine
// Kostenschätzung 900 000 € per API erfasst, dann in der Kostenkontrolle die Obergrenze 1 000 000 €
// gesetzt (→ Schätzung grün, 90 %), die Kostenberechnung mit 980 000 € erfasst (gelb, Δ +80 000 €) und die
// Kostenfeststellung mit 1 050 000 € (rot, aktueller Stand rot). Erfasste Stände schlagen Live-Werte, deshalb
// hängt der Test nicht vom LV des Testhauses ab. Aufräumen: Stände löschen, Obergrenze zurücksetzen.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";

test("88-08 Kostenstände: Obergrenze, Erfassen, Ampel", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const obergrenzeVorher = projekt.baukostenobergrenze ?? null;
  const aufraeumen = async () => {
    const alt = await (await request.get(`${API}/KostenStand?project_id=${projekt.id}`)).json();
    for (const x of Array.isArray(alt) ? alt : []) await request.delete(`${API}/KostenStand/${x.id}`);
  };
  await aufraeumen();
  try {
    expect((await request.post(`${API}/KostenStand`, { data: { project_id: projekt.id, stufe: "kostenschaetzung", betrag: 900000, datum: "2026-01-10", quelle: "erfasst" } })).ok()).toBe(true);

    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/AVA?projekt=${encodeURIComponent("Review Testhaus")}&tab=control`);
    const zeile = (stufe) => page.locator(`[data-testid=ks-zeile][data-stufe="${stufe}"]`);
    await expect(zeile("kostenschaetzung")).toHaveAttribute("data-betrag", "900000", { timeout: 30000 });
    await expect(zeile("kostenschaetzung")).toHaveAttribute("data-herkunft", "erfasst");

    await page.getByTestId("ks-obergrenze").fill("1000000");
    await page.getByTestId("ks-obergrenze-speichern").click();
    await expect(zeile("kostenschaetzung")).toHaveAttribute("data-ampel", "gruen");
    await expect.poll(async () => (await (await request.get(`${API}/Project/${projekt.id}`)).json()).baukostenobergrenze).toBe(1000000);

    const erfasse = async (stufe, betrag) => {
      await zeile(stufe).getByTestId("ks-erfassen").click();
      await page.getByTestId("ks-betrag").fill(String(betrag));
      await page.getByTestId("ks-datum").fill("2026-06-01");
      await page.getByTestId("ks-speichern").click();
      await expect(zeile(stufe)).toHaveAttribute("data-betrag", String(betrag));
      await expect(zeile(stufe)).toHaveAttribute("data-herkunft", "erfasst");
    };
    await erfasse("kostenberechnung", 980000);
    await expect(zeile("kostenberechnung")).toHaveAttribute("data-ampel", "gelb");
    await expect(zeile("kostenberechnung")).toContainText("80.000");
    await erfasse("kostenfeststellung", 1050000);
    await expect(zeile("kostenfeststellung")).toHaveAttribute("data-ampel", "rot");
    await expect(page.getByTestId("ks-aktuell")).toHaveAttribute("data-ampel", "rot");
    await expect(page.getByTestId("ks-aktuell")).toContainText("105,0 %");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
    await request.put(`${API}/Project/${projekt.id}`, { data: { baukostenobergrenze: obergrenzeVorher } });
  }
});
