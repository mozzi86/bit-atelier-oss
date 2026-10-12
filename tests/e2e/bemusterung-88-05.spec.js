// Headless-Nachweis 88-05 (Raumbuch + Bemusterung): das Raumprogramm des Review Testhauses wird per API
// auf eine feste Zeile (Büro 25 m² × 4) gesetzt. Im Komplex-Designer → Raumprogramm werden Boden und Wand
// im Raumbuch erfasst, lichte Höhe 2,40 m → Hinweis ASR A1.2 (2,5 m); „Speichern“ schreibt items[0].raumbuch.
// In Werkplanung → Bemusterung legt „2 Muster aus dem Raumbuch anlegen“ zwei Muster an; das erste wird
// vorgelegt und mit Namen freigegeben; das Freigabeprotokoll ist ein PDF und wird abgelegt.
// Aufräumen: Muster, Protokoll-Dokument, Raumprogramm auf den Ausgangszustand.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";

test("88-05 Raumbuch → Bemusterung → Freigabe → Protokoll", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const spAlt = (await (await request.get(`${API}/SpaceProgram?project_id=${projekt.id}`)).json())[0] || null;
  const aufraeumen = async () => {
    const bm = await (await request.get(`${API}/Bemusterung?project_id=${projekt.id}`)).json();
    for (const b of (Array.isArray(bm) ? bm : []).filter((x) => String(x.gegenstand || "").includes("E2E"))) await request.delete(`${API}/Bemusterung/${b.id}`);
    const docs = await (await request.get(`${API}/Document?project_id=${projekt.id}`)).json();
    for (const d of (Array.isArray(docs) ? docs : []).filter((x) => String(x.name || "").startsWith("Bemusterungsprotokoll_Review_Testhaus"))) await request.delete(`${API}/Document/${d.id}`);
  };
  await aufraeumen();
  let spId = spAlt?.id || null;
  const fest = { project_id: projekt.id, items: [{ use: "buero", area: 25, count: 4 }], footprint: 900, site_area: 3500, efficiency: 0.8 };
  if (spId) await request.put(`${API}/SpaceProgram/${spId}`, { data: fest });
  else spId = (await (await request.post(`${API}/SpaceProgram`, { data: fest })).json()).id;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent("Review Testhaus")}&tab=program`);
    await expect(page.getByTestId("rb-tabelle")).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId("rb-zeile")).toHaveCount(1, { timeout: 15000 });
    await page.getByTestId("rb-boden-0").fill("Linoleum E2E");
    await page.getByTestId("rb-wand-0").fill("Dispersion E2E");
    await page.getByTestId("rb-lichte_hoehe_m-0").fill("2.4");
    await expect(page.getByTestId("rb-hinweis-0")).toContainText("ASR A1.2");
    await page.getByTestId("sp-speichern").click();
    await expect.poll(async () => (await (await request.get(`${API}/SpaceProgram/${spId}`)).json()).items?.[0]?.raumbuch?.boden, { timeout: 15000 }).toBe("Linoleum E2E");

    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=bemusterung`);
    const vorschlag = page.getByTestId("bm-vorschlaege");
    await expect(vorschlag).toContainText("2", { timeout: 30000 });
    await vorschlag.click();
    const zeile = page.locator('[data-testid=bm-zeile][data-gegenstand="Boden: Linoleum E2E"]');
    await expect(zeile).toHaveAttribute("data-status", "offen", { timeout: 15000 });
    await expect(page.locator('[data-testid=bm-zeile][data-gegenstand="Wand: Dispersion E2E"]')).toContainText("Büro");
    await expect(vorschlag).toHaveCount(0);

    await zeile.getByTestId("bm-vorlegen").click();
    await expect(zeile).toHaveAttribute("data-status", "vorgelegt");
    await zeile.getByTestId("bm-freigeben").click();
    await page.getByTestId("bm-von").fill("Bauherr Muster");
    await page.getByTestId("bm-entscheiden").click();
    await expect(zeile).toHaveAttribute("data-status", "freigegeben");
    await expect(zeile).toContainText("Bauherr Muster");

    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bm-pdf").click()]);
    expect(pdf.suggestedFilename()).toMatch(/^Bemusterungsprotokoll_Review_Testhaus_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(fs.readFileSync(await pdf.path()).subarray(0, 4).toString("latin1")).toBe("%PDF");
    await expect(page.getByTestId("bm-meldung")).toContainText("Protokolle", { timeout: 15000 });
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
    if (spAlt) await request.put(`${API}/SpaceProgram/${spAlt.id}`, { data: { items: spAlt.items, footprint: spAlt.footprint, site_area: spAlt.site_area, efficiency: spAlt.efficiency } });
    else if (spId) await request.delete(`${API}/SpaceProgram/${spId}`);
  }
});
