// Headless-Nachweis 99-01…03 (Wohnung → Sonderwunsch → Frist) an einem eigenen Testprojekt:
// Projekt + BimModel (30 × 12 m, 2 Geschosse, Werkstatt angewendet) + zwei Vorgänge im Bauablauf
// (Bodenbelag BA 1 in 60 Tagen, Elektro BA 1 in 10 Tagen) per API.
// 99-01: „Wohnungen aus dem Modell übernehmen“ legt W-001…W-008 an, Plan zeigt 4 Wohnungen im EG;
//        W-001 wird verkauft (Käufer, Bauabschnitt BA 1). Nach einem neuen Zuschnitt (32 m) meldet der
//        Abgleich W-001 als geändert mit Warnung (verkauft), die Nummern bleiben, keine W-009.
// 99-02: Katalogoption „Parkett Eiche“ (036, 45 €/m²) im UI; Sonderwunsch daraus (30 m² → 1 350 €)
//        durchläuft Prüfung Bauleitung → angeboten → Käufer gibt frei; daraus entsteht ein freigegebenes
//        Muster der Wohnung in der Bemusterung. Ein freier Wunsch „Zusätzliche Steckdose“ braucht
//        zusätzlich die Architektur (Text hebt die Schwere). Ein freier Wunsch ohne Einstufung
//        „Wand zwischen Küche und Wohnzimmer entfernen“ zu „1.250“ € braucht die Tragwerksplanung
//        und wird mit 1 250 € gespeichert (deutscher Tausenderpunkt).
// 99-03: Frist = Gewerkbeginn − 28 Tage; Elektro ist rot (Frist vorbei), Bodenbelag gelb; nach
//        Verschieben des Bodenbelags um 14 Tage wandert die Frist mit („verschoben um 14 Tage“).
// Protokoll-PDF der Wohnung wird erzeugt. Der Reiter Bemusterung zeigt das Käufer-Muster nicht
// (nur einen Hinweis). Aufräumen im finally, Konsole sauber.
// Does not touch the Review Testhaus → plain Playwright test (tests/e2e/README.md).
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";
const NAME = "E2E Sonderwunsch 99";
const FP = [{ x: -15, z: -6 }, { x: 15, z: -6 }, { x: 15, z: 6 }, { x: -15, z: 6 }];

/** 'YYYY-MM-DD' today + n days (UTC, like the rule module). */
const tag = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
/** dd.mm.yyyy as the UI shows it. */
const de = (iso) => iso.split("-").reverse().join(".");
/** Every entity the spec writes for its project (children first). */
const ENTITAETEN = ["Sonderwunsch", "AusstattungsOption", "Wohneinheit", "Bemusterung", "ScheduleTask", "Document", "ProjectFolder", "BimModel"];

/**
 * Deletes a test project with all rows this spec writes.
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string} pid project id
 */
async function projektWeg(request, pid) {
  for (const e of ENTITAETEN) {
    const r = await (await request.get(`${API}/${e}?project_id=${pid}`)).json();
    for (const x of Array.isArray(r) ? r : []) await request.delete(`${API}/${e}/${x.id}`);
  }
  await request.delete(`${API}/Project/${pid}`);
}

test("99-01…03 Wohnungen, Sonderwunsch-Kette, Frist aus dem Bauablauf", async ({ page, request }) => {
  test.setTimeout(240000);
  let id = null;
  const liste = async (entity) => {
    const r = await (await request.get(`${API}/${entity}?project_id=${id}`)).json();
    return Array.isArray(r) ? r : [];
  };
  // Leftovers of an aborted run (a timeout does not reach finally).
  for (const p of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await projektWeg(request, p.id);
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    const modell = (await (await request.post(`${API}/BimModel`, { data: { project_id: id, footprintM: FP, storeys: 2, storeyHeight: 3, werkstatt_layer: { angewendet: true } } })).json());
    const boden = (await (await request.post(`${API}/ScheduleTask`, { data: { project_id: id, name: "Bodenbelag BA 1", gewerk_lb: "036", bauabschnitt: "BA 1", start_date: tag(60), end_date: tag(75) } })).json());
    await request.post(`${API}/ScheduleTask`, { data: { project_id: id, name: "Elektro BA 1", gewerk_lb: "053", bauabschnitt: "BA 1", start_date: tag(10), end_date: tag(40) } });

    await page.goto(`/Werkplanung?projekt=${encodeURIComponent(NAME)}&tab=sonderwuensche`);
    await expect(page.getByTestId("sw-reiter")).toBeVisible({ timeout: 45000 });

    // --- 99-01 take-over -----------------------------------------------------------------
    await page.getByTestId("sw-abgleich").click();
    await expect(page.getByTestId("sw-abgleich-panel")).toContainText("neu: 8");
    await expect(page.locator('[data-testid=sw-abgleich-zeile][data-art=neu]')).toHaveCount(8);
    await page.getByTestId("sw-abgleich-uebernehmen").click();
    await expect(page.getByTestId("sw-meldung")).toContainText("8 neu", { timeout: 15000 });
    await expect(page.getByTestId("sw-plan-wohnung")).toHaveCount(4);
    await expect(page.getByTestId("sw-geschoss-1")).toBeVisible();
    expect((await liste("Wohneinheit")).map((w) => w.nr).sort()).toEqual(["W-001", "W-002", "W-003", "W-004", "W-005", "W-006", "W-007", "W-008"]);

    await page.locator('[data-testid=sw-plan-wohnung][data-nr="W-001"]').click();
    await expect(page.getByTestId("sw-wohnung")).toHaveAttribute("data-nr", "W-001");
    await page.getByTestId("sw-w-status").selectOption("verkauft");
    await page.getByTestId("sw-w-kaeufer").fill("Käufer Muster");
    await page.getByTestId("sw-w-bauabschnitt").fill("BA 1");
    await page.getByTestId("sw-w-speichern").click();
    await expect(page.locator('[data-testid=sw-plan-wohnung][data-nr="W-001"]')).toHaveAttribute("data-status", "verkauft", { timeout: 15000 });
    const w1 = (await liste("Wohneinheit")).find((w) => w.nr === "W-001");
    expect([w1.status, w1.kaeufer, w1.bauabschnitt]).toEqual(["verkauft", "Käufer Muster", "BA 1"]);

    // --- 99-02 catalogue + request chain --------------------------------------------------
    await page.getByTestId("sw-k-neu").click();
    await page.getByTestId("sw-k-form-bezeichnung").fill("Parkett Eiche E2E");
    await page.getByTestId("sw-k-form-gewerk_lb").selectOption("036");
    await page.getByTestId("sw-k-form-preis_eur").fill("45");
    await page.getByTestId("sw-k-form-einheit").selectOption("m²");
    await page.getByTestId("sw-k-speichern").click();
    await expect(page.locator('[data-testid=sw-k-zeile][data-nr="K-001"]')).toContainText("Parkett Eiche E2E", { timeout: 15000 });

    await page.getByTestId("sw-neu").click();
    await page.getByTestId("sw-form-katalog_option_id").selectOption({ index: 1 });
    await page.getByTestId("sw-form-raum").fill("Wohnen");
    await page.getByTestId("sw-form-menge").fill("30");
    await page.getByTestId("sw-form-fabrikat").fill("Hersteller A");
    await page.getByTestId("sw-form-farbe_system").selectOption("RAL");
    await page.getByTestId("sw-form-farbe").fill("RAL 9010");
    await expect(page.getByTestId("sw-form-vorschau")).toContainText(de(tag(32)));
    await expect(page.getByTestId("sw-form-vorschau")).toContainText("Bauleitung");
    await page.getByTestId("sw-speichern").click();
    const sw1 = page.locator('[data-testid=sw-zeile][data-nr="SW-001"]');
    await expect(sw1).toHaveAttribute("data-status", "angefragt", { timeout: 15000 });
    await expect(sw1).toHaveAttribute("data-ampel", "gelb");
    await expect(sw1).toContainText("1.350,00");

    await sw1.getByTestId("sw-aktion-pruefung-bauleitung").click();
    await page.getByTestId("sw-a-von").fill("Bauleitung Muster");
    await page.getByTestId("sw-a-speichern").click();
    await expect(sw1).toHaveAttribute("data-status", "geprueft", { timeout: 15000 });
    await sw1.getByTestId("sw-aktion-angebot").click();
    await expect(page.getByTestId("sw-a-preis")).toHaveValue("1350");
    await page.getByTestId("sw-a-speichern").click();
    await expect(sw1).toHaveAttribute("data-status", "angeboten", { timeout: 15000 });
    await sw1.getByTestId("sw-aktion-freigeben").click();
    await expect(page.getByTestId("sw-a-von")).toHaveValue("Käufer Muster");
    await page.getByTestId("sw-a-speichern").click();
    await expect(sw1).toHaveAttribute("data-status", "freigegeben", { timeout: 15000 });
    await expect(page.getByTestId("sw-summe-beauftragt")).toContainText("1.350,00");
    await expect.poll(async () => (await liste("Bemusterung")).filter((b) => b.wohnung_id === w1.id && b.status === "freigegeben" && b.sonderwunsch_id).length, { timeout: 15000 }).toBe(1);

    // Free request: the text "Steckdose" raises the severity → architect needed too; deadline passed → rot.
    await page.getByTestId("sw-neu").click();
    await page.getByTestId("sw-form-beschreibung").fill("Zusätzliche Steckdose im Flur");
    await page.getByTestId("sw-form-gewerk_lb").selectOption("053");
    await page.getByTestId("sw-form-preis_eur").fill("120");
    await expect(page.getByTestId("sw-form-vorschau")).toContainText("Architektur");
    await page.getByTestId("sw-speichern").click();
    const sw2 = page.locator('[data-testid=sw-zeile][data-nr="SW-002"]');
    await expect(sw2).toHaveAttribute("data-ampel", "rot", { timeout: 15000 });
    await expect(sw2.getByTestId("sw-aktion-pruefung-architektur")).toBeVisible();
    await expect(page.locator('[data-testid=sw-plan-wohnung][data-nr="W-001"]')).toHaveAttribute("data-ampel", "rot");

    // Free request without classification (default = layout); the wall text raises it to the
    // structural engineer; German thousands dot in the price.
    await page.getByTestId("sw-neu").click();
    await expect(page.getByTestId("sw-form-schwere")).toHaveValue("");
    await page.getByTestId("sw-form-beschreibung").fill("Wand zwischen Küche und Wohnzimmer entfernen");
    await page.getByTestId("sw-form-preis_eur").fill("1.250");
    await expect(page.getByTestId("sw-form-vorschau")).toContainText("Tragwerksplanung");
    await page.getByTestId("sw-speichern").click();
    const sw3 = page.locator('[data-testid=sw-zeile][data-nr="SW-003"]');
    await expect(sw3).toContainText("1.250,00", { timeout: 15000 });
    await expect(sw3.getByTestId("sw-aktion-pruefung-statik")).toBeVisible();
    expect((await liste("Sonderwunsch")).find((s) => s.nr === "SW-003").preis_eur).toBe(1250);

    // --- 99-03 deadline matrix and a rescheduled task --------------------------------------
    const zelle = page.locator('[data-testid=sw-matrix-zelle][data-nr="W-001"][data-lb="036"]');
    await expect(zelle).toHaveAttribute("data-frist", tag(32));
    await request.put(`${API}/ScheduleTask/${boden.id}`, { data: { start_date: tag(74) } });
    await page.reload();
    await page.locator('[data-testid=sw-plan-wohnung][data-nr="W-001"]').click();
    await expect(zelle).toHaveAttribute("data-frist", tag(46), { timeout: 30000 });
    await expect(sw1).toContainText("verschoben um 14 Tage");

    // --- protocol of the apartment -------------------------------------------------------------
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sw-pdf").click()]);
    expect(pdf.suggestedFilename()).toMatch(/^Bemusterungsprotokoll_E2E_Sonderwunsch_99_W-001_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(fs.readFileSync(await pdf.path()).subarray(0, 4).toString("latin1")).toBe("%PDF");
    await expect(page.getByTestId("sw-meldung")).toContainText("Protokolle", { timeout: 15000 });

    // --- 99-01 re-cut: numbers stay, the sold apartment is reported as warning -----------------
    const breiter = [{ x: -16, z: -6 }, { x: 16, z: -6 }, { x: 16, z: 6 }, { x: -16, z: 6 }];
    await request.put(`${API}/BimModel/${modell.id}`, { data: { footprintM: breiter } });
    await page.reload();
    await expect(page.getByTestId("sw-plan-wohnung")).toHaveCount(4, { timeout: 45000 });
    await page.getByTestId("sw-abgleich").click();
    await expect(page.getByTestId("sw-abgleich-panel")).toContainText("neu: 0");
    await expect(page.locator('[data-testid=sw-abgleich-zeile][data-nr="W-001"]')).toHaveAttribute("data-stufe", "warn");
    await page.getByTestId("sw-abgleich-uebernehmen").click();
    await expect(page.getByTestId("sw-meldung")).toContainText("0 neu", { timeout: 15000 });
    const nachher = await liste("Wohneinheit");
    expect(nachher.map((w) => w.nr).sort()).toEqual(["W-001", "W-002", "W-003", "W-004", "W-005", "W-006", "W-007", "W-008"]);
    const w1neu = nachher.find((w) => w.nr === "W-001");
    expect([w1neu.status, w1neu.kaeufer]).toEqual(["verkauft", "Käufer Muster"]);
    expect(w1neu.flaeche_m2).toBeGreaterThan(w1.flaeche_m2);

    // --- sampling tab: the buyer's sample stays out of the project list and protocol ------------
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent(NAME)}&tab=bemusterung`);
    await expect(page.getByTestId("bm-kaeufer-hinweis")).toContainText("1 Muster", { timeout: 45000 });
    await expect(page.getByTestId("bm-zeile")).toHaveCount(0);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) await projektWeg(request, id);
  }
});
