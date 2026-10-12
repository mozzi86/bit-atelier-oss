// 88-04 permits against the Express dev stack (Review Testhaus):
//  1. tab "Genehmigungen" → new simplified procedure, status "Eingereicht" with
//     today's date → completeness check deadline today + 3 weeks (Art. 65 BayBO);
//  2. the same deadline stands in /Deadlines (term source "genehmigung");
//  3. condition "vor Baubeginn" with deadline → fulfilled only with a proof;
//  4. exemption without justification → hint "Begründung fehlt";
//  5. English, 375 px without horizontal scroll, console clean.
// Everything the spec creates is deleted in `finally`.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const AZ = "E2E-B-88-04";

/** Today in Berlin + n days, 'YYYY-MM-DD'. @param {number} n */
const tagPlus = (n) => {
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const d = new Date(`${heute}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("88-04 Genehmigungen: Fristen im Reiter und in Fristen & Termine, Auflage mit Nachweis, Befreiung ohne Begründung", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const g = await (await request.get(`${API}/Genehmigung?project_id=${projekt.id}`)).json();
    const eigene = (Array.isArray(g) ? g : []).filter((x) => String(x.aktenzeichen || "").startsWith("E2E-"));
    const a = await (await request.get(`${API}/Auflage?project_id=${projekt.id}`)).json();
    for (const x of (Array.isArray(a) ? a : []).filter((x) => eigene.some((e) => e.id === x.genehmigung_id) || String(x.text || "").includes("E2E"))) await request.delete(`${API}/Auflage/${x.id}`);
    for (const x of eigene) await request.delete(`${API}/Genehmigung/${x.id}`);
  };
  await aufraeumen();
  const warnungen = [];
  try {
    await nurLocalhost(page);
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=genehmigungen`);
    await page.getByTestId("gn-neu").click({ timeout: 30000 });
    await page.getByTestId("gn-form-art").selectOption("vereinfacht");
    await page.getByTestId("gn-form-aktenzeichen").fill(AZ);
    await page.getByTestId("gn-form-behoerde").fill("Bauaufsicht Beispielstadt");
    await page.getByTestId("gn-speichern").click();
    const verfahren = page.locator("[data-testid=gn-verfahren][data-art=vereinfacht]", { hasText: AZ });
    await expect(verfahren).toHaveAttribute("data-status", "vorbereitung", { timeout: 15000 });

    await verfahren.getByTestId("gn-status-eingereicht").click();
    await expect(page.getByTestId("gn-status-datum")).toHaveValue(tagPlus(0));
    await page.getByTestId("gn-status-ok").click();
    await expect(verfahren).toHaveAttribute("data-status", "eingereicht");
    const frist = verfahren.locator("[data-testid=gn-frist][data-schluessel=vollstaendigkeit]");
    await expect(frist).toHaveAttribute("data-datum", tagPlus(21));
    await expect(frist).toContainText("Art. 65 Abs. 2 BayBO");
    await expect(frist).toContainText("Richtwert");
    // forward only: no way back to "In Vorbereitung"
    await expect(verfahren.getByTestId("gn-status-vorbereitung")).toHaveCount(0);

    // condition with proof
    await verfahren.getByTestId("au-neu").click();
    await page.getByTestId("au-form-nr").fill("3");
    await page.getByTestId("au-form-text").fill("E2E Standsicherheitsnachweis vor Baubeginn vorlegen");
    await page.getByTestId("au-form-frist").fill(tagPlus(30));
    await page.getByTestId("au-speichern").click();
    const auflage = verfahren.getByTestId("au-zeile");
    await expect(auflage).toHaveAttribute("data-status", "offen", { timeout: 15000 });
    await auflage.getByTestId("au-erfuellt").click();
    await expect(page.getByTestId("au-erfuellt-ok")).toBeDisabled();
    await page.getByTestId("au-nachweis").fill("Prüfbericht Tragwerk E2E");
    await page.getByTestId("au-erfuellt-ok").click();
    await expect(auflage).toHaveAttribute("data-status", "erfuellt");
    await expect(auflage).toContainText("Prüfbericht Tragwerk E2E");

    // exemption without justification → hint
    await page.getByTestId("gn-neu").click();
    await page.getByTestId("gn-form-art").selectOption("befreiung");
    await page.getByTestId("gn-form-aktenzeichen").fill(`${AZ}-BF`);
    await page.getByTestId("gn-speichern").click();
    const befreiung = page.locator("[data-testid=gn-verfahren][data-art=befreiung]", { hasText: `${AZ}-BF` });
    await expect(befreiung.locator("[data-testid=gn-hinweis][data-art=begruendung_fehlt]")).toContainText("§ 31 Abs. 2 BauGB", { timeout: 15000 });

    // the deadline in "Fristen & Termine"
    await page.goto("/Deadlines");
    const agenda = page.getByTestId("agenda");
    const termin = agenda.locator('[data-termin^="genehmigung:"][data-termin$=":vollstaendigkeit"]', { hasText: AZ });
    await expect(termin).toHaveCount(1, { timeout: 30000 });
    await expect(termin).toContainText("Vollständigkeitsprüfung");

    // English, phone width
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=genehmigungen`);
    await page.getByRole("button", { name: "English" }).click();
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.locator("[data-testid=gn-verfahren][data-art=vereinfacht]", { hasText: AZ })).toContainText("Completeness check by the authority", { timeout: 15000 });
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(breit).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Deutsch" }).click();
    expect(warnungen).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
