// Headless proof 106-11: plans carry the model state; unreleased AI changes stand on the sheet.
// An agent proposes a change over the control channel, the person confirms it in the BIM studio. Then:
//  - the plan view shows the note "Enthält ungeprüfte KI-Änderungen" (origin "Agent") and a dashed mark on the changed wall only,
//  - the vector PDF carries the state (keywords: ungeprueft=1) and the DXF the note on layer A_KI_VERMERK,
//  - a program cannot release the step (403) - the note stays,
//  - filed in Werkplanung › Pläne, the plan shows "aktuell" + "enthält ungeprüfte KI-Änderungen"; after the person's release
//    "Vermerk überholt"; the studio then shows no note and prints without it; after a model change the plan is "veraltet".
// Review 106-11: the state line is bound to the project (projekt=…); a change of the storey table alone (geschosse) outdates a
// filed plan; a new revision index drops the state of the old sheet ("kein Modellstand").
// Own project with two drawn walls (pattern of freigabe-106-10); step records are removed as the person (session token).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");
const AUSGABE = path.join(".planning", "phases", "106-zeigen-und-sprechen", "tmp-e2e");
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const GA = guid("PlanstandWandA10611");
const GB = guid("PlanstandWandB10611");
const NAME = "E2E Planstand 10611";
const NR = "PS611-LP5-AR-611";
const ANSICHT_ALS = "bit-atelier-ansicht-als";

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** One command through the register's JSON line (a person at the window). */
const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);

/** One command through the HTTP control channel = an agent (504 retried, see auswahl-106-02). */
const ueberKanal = async (request, id, befehlId, params = {}) => {
  const token = fs.readFileSync(TOKEN_DATEI, "utf-8").trim();
  let a = { status: 0, json: /** @type {any} */ (null) };
  for (let versuch = 0; versuch < 8; versuch++) {
    const r = await request.post("/api/steuerung", { data: { id, method: "ausfuehren", params: { befehl: befehlId, params } }, headers: { "x-bit-steuerung": token } });
    a = { status: r.status(), json: await r.json() };
    if (a.status !== 504) break;
  }
  return a;
};

/** Headers of a request of the app's own page (Fetch Metadata + Origin + session token) - the person's release and the clean-up. */
async function alsPerson(request, baseURL) {
  const token = (await (await request.get("/api/sitzung")).json()).token;
  return { origin: baseURL, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "x-bit-session": token };
}

/** Downloads the current plan as PDF from the studio's folder panel; returns the bytes. */
async function pdfLaden(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Aktuellen Plan als PDF" }).click()]);
  return fs.readFileSync(await dl.path());
}

test.describe("106-11 Pläne mit Modellstand: ungeprüfte KI-Änderungen stehen auf dem Blatt", () => {
  test.setTimeout(300000);

  test("Agent-Änderung → Vermerk in Ansicht, PDF und DXF; Planliste aktuell/überholt/veraltet; Freigabe nur durch die Person", async ({ page, request, baseURL }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    let id = null;
    let personNeu = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        customWalls: [
          { a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau" },
          { a: { x: 14, z: -24 }, b: { x: 26, z: -24 }, level: 0, height: 3, thickness: 0.3, _idx: 2, guid: GB, status: "neubau" },
        ],
      } });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const schritte = async () => (await (await request.get(`/api/entities/AenderungsSchritt?project_id=${id}`)).json());

      let person = (await (await request.get("/api/entities/Nutzer")).json()).find((n) => n.aktiv !== false && n.rolle === "inhaber" && String(n.name || "").trim());
      if (!person) person = personNeu = await (await request.post("/api/entities/Nutzer", { data: { name: "E2E Prüferin 10611", kuerzel: "EP", email: "", aktiv: true, rolle: "inhaber" } })).json();
      await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* without storage the owner is active anyway */ } }, [ANSICHT_ALS, String(person.id)]);

      const studio = async () => {
        await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
        await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
        await expect.poll(async () => (await befehl(page, "modell")).result.bauteile.some((b) => b.guid === GA), { timeout: 30000 }).toBe(true);
      };
      await studio();

      // ---- an agent proposes over the control channel; it cannot confirm, the person does
      const e1 = await ueberKanal(request, 9611, "eigenschaft-setzen", { guid: GA, name: "kg", wert: "341" });
      expect(e1.json.ok, JSON.stringify(e1.json)).toBe(true);
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(1, { timeout: 15000 });
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w.guid === GA)?.kg, { timeout: 20000 }).toBe("341");
      await expect.poll(async () => (await schritte()).length, { timeout: 20000 }).toBe(1);
      const [s1] = await schritte();
      expect(s1).toMatchObject({ herkunft: "agent", freigabe: null, zurueckgenommen: null });

      // ---- the plan view: note with origin, mark on the changed wall only (dashed form)
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      const vermerk = page.getByTestId("ki-vermerk");
      await expect(vermerk).toBeVisible({ timeout: 20000 });
      await expect(vermerk).toHaveAttribute("data-anzahl", "1");
      await expect(vermerk.getByTestId("ki-vermerk-titel")).toHaveText("Enthält ungeprüfte KI-Änderungen");
      await expect(vermerk).toContainText("Herkunft: Agent");
      await expect(vermerk.getByTestId("ki-vermerk-freigabe")).toHaveAttribute("href", "/Modellfreigabe");
      await expect(page.locator(`[data-testid=ki-vermerk-marke][data-guid="${GA}"]`)).toHaveCount(1);
      await expect(page.locator(`[data-testid=ki-vermerk-marke][data-guid="${GA}"]`)).toHaveAttribute("data-form", "gestrichelt");
      await expect(page.locator(`[data-testid=ki-vermerk-marke][data-guid="${GB}"]`)).toHaveCount(0);
      await page.screenshot({ path: path.join(AUSGABE, "106-11-ansicht-vermerk.png") });

      // ---- vector PDF: state in the keywords, note on the sheet (copy kept for the visual check)
      await expect(page.getByText("✓ gespeichert")).toBeVisible({ timeout: 20000 });
      await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
      const pdf1 = await pdfLaden(page);
      fs.writeFileSync(path.join(AUSGABE, "106-11-plan-mit-vermerk.pdf"), pdf1);
      const kw1 = (await PDFDocument.load(pdf1)).getKeywords() || "";
      expect(kw1).toMatch(/BIT-ATELIER-MODELLSTAND v1 ermittelt=1 kennung=[0-9a-f]{16} zeit=\S+ aenderungen=1 ungeprueft=1 projekt=[0-9a-f]{8}/);
      await expect(page.getByText(/Mit Vermerk „enthält ungeprüfte KI-Änderungen“/)).toBeVisible();

      // ---- DXF: note and mark on A_KI_VERMERK, state line in the head
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bim-plan-dxf").click()]);
      const dxf = fs.readFileSync(await dl.path()).toString("latin1");
      expect(dxf).toContain("\r\nA_KI_VERMERK\r\n");
      expect(dxf).toContain("?  Enthält ungeprüfte KI-Änderungen");
      expect(dxf).toContain("Herkunft: Agent");
      expect(dxf).toMatch(/BIT-ATELIER-MODELLSTAND v1 ermittelt=1 kennung=[0-9a-f]{16} \S+ aenderungen=1 ungeprueft=1/);
      expect(dxf).toContain("\r\nA_PLANKOPF\r\n");

      // ---- D-IM-04: a program cannot remove the note by releasing the step
      const versuch = await request.put(`/api/entities/AenderungsSchritt/${s1.id}`, { data: { freigabe: { status: "freigegeben", durch: "Agent", zeit: new Date().toISOString() } } });
      expect(versuch.status()).toBe(403);
      expect((await schritte())[0].freigabe).toBeNull();

      // ---- plan list: file the sheet → current, note open
      await page.goto(`/Werkplanung?projekt=${encodeURIComponent(NAME)}&tab=plaene`);
      await expect(page.getByRole("heading", { level: 1, name: "Werkplanung" })).toBeVisible({ timeout: 30000 });
      await page.getByTestId("pl-neu").click();
      await page.getByTestId("pl-form-projekt_kurz").fill("PS611");
      await page.getByTestId("pl-form-nr").fill("611");
      await page.getByTestId("pl-form-titel").fill("Grundriss EG");
      await page.getByTestId("pl-speichern").click();
      const zeile = page.locator(`[data-testid=pl-zeile][data-nummer^="${NR}"]`);
      await expect(zeile).toHaveCount(1, { timeout: 15000 });
      await expect(zeile.getByTestId("pl-modellstand")).toHaveAttribute("data-status", "ohne");
      await zeile.getByTestId("pl-datei").setInputFiles({ name: "planstand-10611.pdf", mimeType: "application/pdf", buffer: pdf1 });
      const zelle = zeile.getByTestId("pl-modellstand");
      await expect(zelle).toHaveAttribute("data-status", "aktuell", { timeout: 15000 });
      await expect(zelle).toHaveAttribute("data-vermerk", "offen");
      await expect(zelle).toContainText("enthält ungeprüfte KI-Änderungen");
      const planRec = (await (await request.get(`/api/entities/Plan?project_id=${id}`)).json())[0];
      expect(planRec.modellstand).toMatchObject({ ermittelt: true, aenderungen: 1, ungeprueft: 1 });

      // ---- the person releases (as the review page would) → the note is outdated, the plan still current
      const kopf = await alsPerson(request, baseURL);
      const frei = await request.put(`/api/entities/AenderungsSchritt/${s1.id}`, { headers: kopf, data: { freigabe: { status: "freigegeben", durch: String(person.name).trim(), zeit: new Date().toISOString() } } });
      expect(frei.status()).toBe(200);
      await page.reload();
      await expect(zelle).toHaveAttribute("data-vermerk", "ueberholt", { timeout: 15000 });
      await expect(zelle).toHaveAttribute("data-status", "aktuell");
      await expect(zelle.locator('[data-code="vermerk_ueberholt"]')).toBeVisible();

      // ---- the studio: no note, no mark; the new sheet is printed without the note
      await studio();
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await expect(page.locator('[data-wand="1"]')).toHaveCount(1, { timeout: 15000 });
      await expect(page.getByTestId("ki-vermerk")).toHaveCount(0);
      await expect(page.getByTestId("ki-vermerk-marke")).toHaveCount(0);
      await expect(page.getByText("✓ gespeichert").or(page.getByText("Auto-Save"))).toBeVisible({ timeout: 20000 });
      await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
      const pdf2 = await pdfLaden(page);
      fs.writeFileSync(path.join(AUSGABE, "106-11-plan-freigegeben.pdf"), pdf2);
      expect((await PDFDocument.load(pdf2)).getKeywords() || "").toMatch(/ermittelt=1 .* aenderungen=1 ungeprueft=0/);

      // ---- the model changes after the sheet was filed → the plan list says "veraltet"
      const m = await gespeichert();
      const neu = m.customWalls.map((w) => (w.guid === GB ? { ...w, a: { ...w.a, x: 15 } } : w));
      expect((await request.put(`/api/entities/BimModel/${m.id}`, { data: { customWalls: neu } })).ok()).toBe(true);
      await page.goto(`/Werkplanung?projekt=${encodeURIComponent(NAME)}&tab=plaene`);
      await expect(zelle).toHaveAttribute("data-status", "veraltet", { timeout: 15000 });
      await expect(zelle.locator('[data-code="veraltet"]')).toBeVisible();

      // ---- review: a sheet printed now is current; changing ONLY the storey table outdates it
      await studio();
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await expect(page.getByText("✓ gespeichert").or(page.getByText("Auto-Save"))).toBeVisible({ timeout: 20000 });
      await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
      const pdf3 = await pdfLaden(page);
      expect((await PDFDocument.load(pdf3)).getKeywords() || "").toMatch(/ermittelt=1 .* ungeprueft=0 projekt=[0-9a-f]{8}/);
      await page.goto(`/Werkplanung?projekt=${encodeURIComponent(NAME)}&tab=plaene`);
      await zeile.getByTestId("pl-datei").setInputFiles({ name: "planstand-10611-neu.pdf", mimeType: "application/pdf", buffer: pdf3 });
      await expect(zelle).toHaveAttribute("data-status", "aktuell", { timeout: 15000 });
      await expect(zelle).toHaveAttribute("data-vermerk", "keiner");
      const m2 = await gespeichert();
      expect((await request.put(`/api/entities/BimModel/${m2.id}`, { data: { geschosse: [{ hoehe_m: 3.4 }, { hoehe_m: 3 }, { hoehe_m: 3 }, { hoehe_m: 3 }] } })).ok()).toBe(true);
      await page.reload();
      await expect(zelle).toHaveAttribute("data-status", "veraltet", { timeout: 15000 });

      // ---- review: a new revision index clears the file and with it the state of the old sheet
      await zeile.getByTestId("pl-index").click();
      await page.getByTestId("pl-index-text").fill("Geschosshöhe EG angepasst");
      await page.getByTestId("pl-index-ok").click();
      await expect(zelle).toHaveAttribute("data-status", "ohne", { timeout: 15000 });
      expect((await (await request.get(`/api/entities/Plan?project_id=${id}`)).json())[0].modellstand).toBeNull();

      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      if (personNeu?.id) await request.delete(`/api/entities/Nutzer/${personNeu.id}`);
      if (id != null) {
        const kopf = await alsPerson(request, baseURL);
        for (const s of await (await request.get(`/api/entities/AenderungsSchritt?project_id=${id}`)).json()) await request.delete(`/api/entities/AenderungsSchritt/${s.id}`, { headers: kopf });
        for (const p of await (await request.get(`/api/entities/Plan?project_id=${id}`)).json()) await request.delete(`/api/entities/Plan/${p.id}`);
        for (const d of await (await request.get(`/api/entities/Document?project_id=${id}`)).json()) await request.delete(`/api/entities/Document/${d.id}`);
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
