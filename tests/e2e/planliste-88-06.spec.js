// Headless-Nachweis 88-06 (Planverwaltung): auf der Seite „Werkplanung & Baustelle“ wird am Review
// Testhaus ein Plan angelegt (Nummer E2E-LP5-AR-886 nach dem Plankopf-Schema), über Vorabzug → Geprüft
// mit Namen freigegeben (AuditLog-Eintrag „Plan freigegeben“), ein PDF abgelegt (Document mit Typ
// Plan-PDF, datei_ref am Plan) und der erste Änderungsindex A angelegt (Status zurück auf
// „In Arbeit“, Freigabe gelöst, AuditLog „Planindex geändert“). Aufräumen: Plan, eigene AuditLog-Einträge
// und Document im finally und beim Start.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";

const API = "/api/entities";
const NR = "E2E-LP5-AR-886";

/** Smallest valid one-page PDF (no fonts) for the upload. */
const MINI_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

test("88-06 Planliste: anlegen, freigeben, PDF, neuer Index", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const plaene = await (await request.get(`${API}/Plan?project_id=${projekt.id}`)).json();
    for (const p of (Array.isArray(plaene) ? plaene : []).filter((x) => x.projekt_kurz === "E2E")) {
      if (p.datei_ref) await request.delete(`${API}/Document/${p.datei_ref}`);
      await request.delete(`${API}/Plan/${p.id}`);
    }
    const log = await (await request.get(`${API}/AuditLog?project_id=${projekt.id}`)).json();
    for (const e of (Array.isArray(log) ? log : []).filter((x) => String(x.unit_name || "").startsWith(NR))) await request.delete(`${API}/AuditLog/${e.id}`);
    const docs = await (await request.get(`${API}/Document?project_id=${projekt.id}`)).json();
    for (const d of (Array.isArray(docs) ? docs : []).filter((x) => x.name === "e2e-8806.pdf")) await request.delete(`${API}/Document/${d.id}`);
  };
  await aufraeumen();
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}`);
    await expect(page.getByRole("heading", { level: 1, name: "Werkplanung & Baustelle" })).toBeVisible({ timeout: 30000 });

    await page.getByTestId("pl-neu").click();
    await page.getByTestId("pl-form-projekt_kurz").fill("E2E");
    await page.getByTestId("pl-form-nr").fill("886");
    await page.getByTestId("pl-form-titel").fill("Grundriss Erdgeschoss");
    await expect(page.getByTestId("pl-form-vorschau")).toContainText(NR);
    await page.getByTestId("pl-speichern").click();
    const zeile = page.locator(`[data-testid=pl-zeile][data-nummer^="${NR}"]`);
    await expect(zeile).toHaveAttribute("data-status", "in_arbeit", { timeout: 15000 });

    await zeile.getByTestId("pl-status-vorabzug").click();
    await expect(zeile).toHaveAttribute("data-status", "vorabzug");
    await zeile.getByTestId("pl-status-geprueft").click();
    await expect(zeile).toHaveAttribute("data-status", "geprueft");
    await zeile.getByTestId("pl-freigeben").click();
    await page.getByTestId("pl-freigabe-von").fill("Bauherr Muster");
    await page.getByTestId("pl-freigabe-ok").click();
    await expect(zeile).toHaveAttribute("data-status", "freigegeben");
    await expect(zeile).toContainText("Bauherr Muster");
    await expect(zeile.locator('[data-code="freigabe_ohne_datei"]')).toBeVisible();

    await zeile.getByTestId("pl-datei").setInputFiles({ name: "e2e-8806.pdf", mimeType: "application/pdf", buffer: MINI_PDF });
    await expect(zeile.locator('[data-code="freigabe_ohne_datei"]')).toHaveCount(0, { timeout: 15000 });
    const plan = (await (await request.get(`${API}/Plan?project_id=${projekt.id}`)).json()).find((x) => x.projekt_kurz === "E2E");
    expect(plan.datei_ref).toBeTruthy();
    const dok = await (await request.get(`${API}/Document/${plan.datei_ref}`)).json();
    expect(dok.type).toBe("Plan-PDF");

    await zeile.getByTestId("pl-index").click();
    await page.getByTestId("pl-index-text").fill("Türbreiten angepasst");
    await page.getByTestId("pl-index-ok").click();
    const zeileA = page.locator(`[data-testid=pl-zeile][data-nummer="${NR}-A"]`);
    await expect(zeileA).toHaveAttribute("data-status", "in_arbeit", { timeout: 15000 });
    await expect(zeileA).toHaveAttribute("data-index", "A");

    const log = await (await request.get(`${API}/AuditLog?project_id=${projekt.id}`)).json();
    const eigene = log.filter((e) => String(e.unit_name || "").startsWith(NR));
    expect(eigene.map((e) => e.action).sort()).toEqual(["Plan freigegeben", "Planindex geändert"]);
    expect(eigene.find((e) => e.action === "Plan freigegeben").actor).toBe("Bauherr Muster");
    // The released file belongs to the old index — the doc stays, the plan no longer points to it.
    await request.delete(`${API}/Document/${dok.id}`);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
