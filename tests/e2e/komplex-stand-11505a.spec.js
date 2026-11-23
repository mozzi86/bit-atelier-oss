// Headless proof 115-05a (A-4, K6): the design record (BuildingComplex) of an older tab overwrites no newer field of another
// writer. The tab writes only the fields that changed, on its strict base (`?stand`); a refused write (409) is merged per
// field three ways, the site/location fields as ONE unit. Own neutral project per test (API), cleaned up in `finally`.
//   1. another writer changes energy_systems, this tab types a parking count by hand → both stay; every browser PUT carries
//      only kennzahlen_hand (no updated_date / created_date / id) and no answer says "replaced a newer version"
//   2. another writer moves the parcel, this tab turns the north angle → ONE card "Grundstück und Lage", nothing mixed;
//      "Fassung des anderen Geräts übernehmen" writes nothing
//   3. review R-11505a-01: a project WITHOUT a design record, "Standort übernehmen", then at once "Entwurf speichern" (inside the
//      1.5-s autosave window) → exactly ONE record (before, the old autosave timer still wrote its plan with id null: a second POST)
//   4. the same while the FIRST create is still on its way (POST delayed 3 s): "Entwurf speichern" plans with id null and waits in
//      the queue → it updates the record that create made, never a second create
import { test, expect } from "@playwright/test";
// 115-05c (D-115-12): the site group is a draft until "Speichern" (the other fields keep their autosave)
import { speichernUndWarten } from "./fixtures/entwurf.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const MPP = 0.05;
/** Canvas px of a point given in metres (parcel coordinates like massing-kennzahlen-108-12). @param {number} xm @param {number} ym */
const px = (xm, ym) => ({ x: 300 + xm / MPP, y: 150 + ym / MPP });
/** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
const rechteck = (x0, y0, x1, y1) => [px(x0, y0), px(x1, y0), px(x1, y1), px(x0, y1)];
const PARZELLE = { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: MPP, points: rechteck(0, 0, 30, 25) };
const ENERGIE_A = [{ id: "es-a", name: "Wärmepumpe", type: "heat_pump" }];
const ENERGIE_B = [{ id: "es-b", name: "Fernwärme", type: "district_heating" }];

/**
 * Console errors and warnings except the known offline / WebGL noise and the deliberate 409 of the strict save (the browser logs a
 * refused request as "Failed to load resource … 409"; the refusal is the protection under test, pattern bild-106-06).
 * @param {import("@playwright/test").Page} page
 */
function wache(page) {
  /** @type {string[]} */ const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm|status of 409/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Every browser write on BuildingComplex: method, body, status and the hint header of its answer. @param {import("@playwright/test").Page} page */
function mitschnitt(page) {
  /** @type {Array<{methode: string, url: string, body: any, status?: number, hinweis?: string|null}>} */ const schreiben = [];
  page.on("request", (r) => {
    if ((r.method() === "PUT" || r.method() === "POST") && /\/api\/entities\/BuildingComplex/.test(r.url())) {
      let body = null;
      try { body = r.postDataJSON(); } catch { /* no JSON body */ }
      schreiben.push({ methode: r.method(), url: r.url(), body });
    }
  });
  page.on("response", (r) => {
    const req = r.request();
    if ((req.method() === "PUT" || req.method() === "POST") && /\/api\/entities\/BuildingComplex/.test(r.url())) {
      const e = [...schreiben].reverse().find((s) => s.url === r.url() && s.status === undefined);
      if (e) { e.status = r.status(); e.hinweis = r.headers()["x-bit-hinweis"] ?? null; }
    }
  });
  return schreiben;
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string|null} id */
async function aufraeumen(request, id) {
  if (!id) return;
  for (const ent of ["BuildingComplex", "BimModel"]) {
    for (const r of await (await request.get(`${API}/${ent}?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/${ent}/${r.id}`).catch(() => {});
  }
  await request.delete(`${API}/Project/${id}`).catch(() => {});
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} name */
async function projektMitKomplex(request, name) {
  for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await aufraeumen(request, alt.id);
  const id = (await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  // werkstatt_layer.nordwinkel null: the project's north angle (BuildingComplex.nordwinkel) is in force and editable (nordwinkelFuer)
  await request.post(`${API}/BimModel`, { data: { project_id: id, footprintM: [{ x: -6, z: -5 }, { x: 6, z: -5 }, { x: 6, z: 5 }, { x: -6, z: 5 }], storeys: 2, storeyHeight: 3, unit: "m",
    werkstatt_layer: { nordwinkel: null } } });
  const komplex = await (await request.post(`${API}/BuildingComplex`, { data: {
    project_id: id, name, location: { lat: 49.45, lng: 11.08, address: "Teststraße 1" }, site_parcel: PARZELLE, site_area: 750, nordwinkel: 0,
    energy_systems: ENERGIE_A,
  } })).json();
  return { id, komplexId: komplex.id };
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} id */
const gespeichert = async (request, id) => (await (await request.get(`${API}/BuildingComplex?project_id=${id}`)).json())[0];

/** Opens the massing studio and waits until the design record of the project was read. @param {import("@playwright/test").Page} page @param {string} name */
async function studioOeffnen(page, name) {
  const geladen = page.waitForResponse((r) => /\/api\/entities\/BuildingComplex\?project_id=/.test(r.url()) && r.request().method() === "GET", { timeout: 90000 });
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=studio`);
  await geladen;
  await expect(page.getByTestId("ms-stpl-hand")).toBeVisible({ timeout: 90000 });
  await page.waitForTimeout(800); // the load lands in the state (setComplexData) one render after the answer
}

test.describe("115-05a BuildingComplex: Teil-Patch mit Stand und Feld-Abgleich", () => {
  test.setTimeout(240000);

  test("Alter Tab überschreibt keine neueren Felder", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Komplex 11505a";
    let p = { id: null, komplexId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      p = await projektMitKomplex(request, NAME);
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      expect(schreiben, "opening writes nothing").toEqual([]);

      // another writer changes the energy systems; this tab does not know it (BuildingComplex has no stream)
      expect((await request.put(`${API}/BuildingComplex/${p.komplexId}`, { data: { energy_systems: ENERGIE_B } })).ok()).toBe(true);
      await page.getByTestId("ms-stpl-hand").fill("3");
      await page.waitForTimeout(3000); // autosave 1.5 s (+ 409 + merge + write again)
      await expect.poll(async () => (await gespeichert(request, p.id)).kennzahlen_hand?.stellplaetze ?? null, { timeout: 15000 }).toBe(3);

      const rec = await gespeichert(request, p.id);
      expect(rec.energy_systems, "the other writer's field stays").toEqual(ENERGIE_B);
      expect(schreiben.length).toBeGreaterThan(0);
      for (const s of schreiben) {
        expect(s.methode).toBe("PUT");
        expect(Object.keys(s.body || {}).sort(), `PUT body ${JSON.stringify(s.body).slice(0, 300)}`).toEqual(["kennzahlen_hand"]);
        expect(s.hinweis ?? null, "no 'replaced a newer version' hint").toBeNull();
      }
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Lage-Gruppe: ein Konflikt, nichts gemischt", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Komplex 11505a Lage";
    let p = { id: null, komplexId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      p = await projektMitKomplex(request, NAME);
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);

      const verschoben = { ...PARZELLE, points: rechteck(2, 1, 32, 26) };
      expect((await request.put(`${API}/BuildingComplex/${p.komplexId}`, { data: { site_parcel: verschoben } })).ok()).toBe(true);
      const nord = page.getByTestId("ms-nordwinkel"); // the north angle input of the massing studio (MassingStudio.jsx, label "Nord")
      await expect(nord).toBeVisible();
      await expect(nord).toBeEnabled();
      await nord.fill("30");
      // 115-05c (adapted): the north angle is a draft field - "Speichern" writes it (before: the autosave) → 409 → merge → card
      await speichernUndWarten(page);

      // nothing mixed: the stored parcel is the other writer's, the north angle the stored one (0) while the card is open
      let rec = await gespeichert(request, p.id);
      expect(rec.site_parcel).toEqual(verschoben);
      expect(rec.nordwinkel).toBe(0);
      const karte = page.locator('[data-testid="abgleich-konflikt"][data-quelle="komplex"]');
      await expect(karte).toHaveCount(1);
      await expect(karte).toContainText("Grundstück und Lage");
      await page.screenshot({ path: test.info().outputPath("karte-lage.png"), clip: (await karte.boundingBox()) || undefined });

      await karte.getByTestId("abgleich-fremd").click();
      await expect(karte).toHaveCount(0);
      await page.waitForTimeout(3000);
      rec = await gespeichert(request, p.id);
      expect(rec.site_parcel).toEqual(verschoben);
      expect(rec.nordwinkel).toBe(0);
      await expect(nord).toHaveValue("0");
      const mitParzelle = schreiben.filter((s) => s.body && "site_parcel" in s.body);
      expect(mitParzelle, `a browser write carried site_parcel: ${JSON.stringify(mitParzelle).slice(0, 300)}`).toEqual([]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Entwurf speichern im Autosave-Fenster legt genau einen Datensatz an", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Komplex 11505a Erstanlage";
    let id = null;
    try {
      await nurLocalhost(page); // no external tiles or geocoding
      const warn = wache(page);
      for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await aufraeumen(request, alt.id);
      id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const schreiben = mitschnitt(page);
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=site`);
      const knopf = page.getByRole("button", { name: /Standort übernehmen/ });
      await expect(knopf).toBeVisible({ timeout: 90000 });
      await page.waitForTimeout(1500); // the (empty) design record was read
      await knopf.click();
      const speichern = page.getByTestId("entwurf-speichern") // 115-05c (adapted): the one "Speichern" of the draft bar replaces "Entwurf speichern";
      await expect(speichern).toBeEnabled({ timeout: 5000 });
      await speichern.click(); // well inside the 1.5-s autosave window of the location
      await page.waitForTimeout(5000); // the old timer would have fired by now
      const rows = await (await request.get(`${API}/BuildingComplex?project_id=${id}`)).json();
      const posts = schreiben.filter((s) => s.methode === "POST");
      expect(rows.length, `design records of the project (writes ${JSON.stringify(schreiben.map((s) => `${s.methode} ${s.status}`))})`).toBe(1);
      expect(posts.length, "exactly one create").toBe(1);
      expect(rows[0].location, "the location is stored").toBeTruthy();
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, id);
    }
  });

  test("Entwurf speichern, während das erste Anlegen unterwegs ist", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Komplex 11505a Erstanlage Flug";
    let id = null;
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await aufraeumen(request, alt.id);
      id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const schreiben = mitschnitt(page);
      let posts = 0;
      // the first create takes 3 s on the wire (slow disk or network)
      await page.route("**/api/entities/BuildingComplex", async (route) => {
        if (route.request().method() === "POST" && ++posts === 1) await new Promise((r) => setTimeout(r, 3000));
        return route.continue();
      });
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=site`);
      const knopf = page.getByRole("button", { name: /Standort übernehmen/ });
      await expect(knopf).toBeVisible({ timeout: 90000 });
      await page.waitForTimeout(1500);
      await knopf.click();
      await expect.poll(() => posts, { timeout: 10000 }).toBe(1); // the autosave's create is on its way
      const speichern = page.getByTestId("entwurf-speichern") // 115-05c (adapted): the one "Speichern" of the draft bar replaces "Entwurf speichern";
      await expect(speichern).toBeEnabled({ timeout: 5000 });
      await speichern.click(); // planned with id null, queued behind the create
      await expect.poll(async () => schreiben.filter((s) => s.status !== undefined).length, { timeout: 15000 }).toBeGreaterThan(0);
      await page.waitForTimeout(4000);
      const rows = await (await request.get(`${API}/BuildingComplex?project_id=${id}`)).json();
      expect(rows.length, `design records of the project (writes ${JSON.stringify(schreiben.map((s) => `${s.methode} ${s.status}`))})`).toBe(1);
      expect(schreiben.filter((s) => s.methode === "POST").length, "exactly one create").toBe(1);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await aufraeumen(request, id);
    }
  });
});
