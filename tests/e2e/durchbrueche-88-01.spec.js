// Headless-Nachweis 88-01 (Durchbruchsplanung): im Reiter „Durchbrüche“ der Seite Werkplanung wird am
// Review Testhaus ein Durchbruch 200 × 300 mm in einer Wand mit EI 90 ohne Abschottung beantragt
// (Warnung MLAR sichtbar), Statik i. O. → Architekt gibt frei (Prüfmatrix mit Namen), „Im Modell zeigen“
// verlinkt /IfcViewer?sel=<GUID>, der BCF-Export ist ein ZIP mit Topic-Titel, Bauteil-GUID und Kamera auf
// den Durchbruch. Feste Eingaben, kein Modell nötig. Aufräumen im finally und beim Start.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";
const MARKE = "E2E8801";
const GUID = "2O2Fr$t4X7Zf8NOew3FLOH";

test("88-01 Durchbruch: beantragen, Prüfmatrix, Viewer-Link, BCF", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const alt = await (await request.get(`${API}/Durchbruch?project_id=${projekt.id}`)).json();
    for (const x of (Array.isArray(alt) ? alt : []).filter((d) => d.kommentar === MARKE)) await request.delete(`${API}/Durchbruch/${x.id}`);
  };
  await aufraeumen();
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=durchbrueche`);
    await page.getByTestId("db-neu").click({ timeout: 30000 });
    await page.getByTestId("db-form-b_mm").fill("200");
    await page.getByTestId("db-form-h_mm").fill("300");
    await page.getByTestId("db-form-x").fill("4.5");
    await page.getByTestId("db-form-y").fill("2");
    await page.getByTestId("db-form-z").fill("1.2");
    await page.getByTestId("db-form-bauteil_guid").fill(GUID);
    await page.getByTestId("db-form-bauteil_name").fill("Wand Achse B");
    await page.getByTestId("db-form-gewerk").selectOption("GL");
    await page.getByTestId("db-form-feuerwiderstand").selectOption("EI 90");
    await page.getByTestId("db-form-kommentar").fill(MARKE);
    await page.getByTestId("db-speichern").click();

    const holen = async () => (await (await request.get(`${API}/Durchbruch?project_id=${projekt.id}`)).json()).find((d) => d.kommentar === MARKE);
    await expect.poll(async () => !!(await holen()), { timeout: 15000 }).toBe(true);
    const gespeichert = await holen();
    expect(gespeichert.b).toBe(0.2);
    const zeile = page.locator(`[data-testid=db-zeile][data-nr="${gespeichert.nr}"]`);
    await expect(zeile).toHaveAttribute("data-status", "beantragt", { timeout: 15000 });
    await expect(zeile.locator('[data-code="abschottung_fehlt"]')).toBeVisible();
    await expect(zeile.getByTestId("db-viewer")).toHaveAttribute("href", /\/IfcViewer\?sel=2O2Fr%24t4X7Zf8NOew3FLOH/);

    await zeile.getByTestId("db-statik-ok").click();
    await page.getByTestId("db-pruefer").fill("Tragwerksplanung Muster");
    await page.getByTestId("db-pruef-ok").click();
    await expect(zeile).toHaveAttribute("data-status", "statik_geprueft");
    await expect(zeile.getByTestId("db-statik")).toContainText("Tragwerksplanung Muster");
    await zeile.getByTestId("db-architekt-ok").click();
    await page.getByTestId("db-pruefer").fill("Architektin Muster");
    await page.getByTestId("db-pruef-ok").click();
    await expect(zeile).toHaveAttribute("data-status", "freigegeben");

    const [bcf] = await Promise.all([page.waitForEvent("download"), zeile.getByTestId("db-bcf").click()]);
    expect(bcf.suggestedFilename()).toMatch(new RegExp(`^${gespeichert.nr}_Review_Testhaus\\.bcf$`));
    const bytes = fs.readFileSync(await bcf.path());
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const text = bytes.toString("utf8");
    expect(text).toContain(`Component IfcGuid="${GUID}"`);
    expect(text).toContain(`${gespeichert.nr} · Durchbruch 200 × 300 mm`);
    expect(text).toContain("<CameraViewPoint><X>7.5</X><Y>-1</Y><Z>4.2</Z></CameraViewPoint>");
    expect(text).toContain("TopicStatus=\"Resolved\"");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
