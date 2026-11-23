// Headless proof 115-05b part 2 (A-5): the focus check. The change stream is BLOCKED in every test (route abort before the page
// loads), so only the check can bring another stored state in. Own neutral projects per test (API), cleaned up in `finally`.
//   1. another writer replaces walls 1,2 + doors 3,4 by walls 3,4 + doors 5,6 → nothing arrives without a trigger; window `focus`
//      → the clean studio takes the stored state over, and the browser writes no element list; a second write then
//      `visibilitychange` (visible) → taken over as well
//   2. the BimModel is replaced by another record (other id: delete + create, like an import) → `focus` → banner "Modell wurde
//      ersetzt — neu laden"; a wall drawn afterwards is NOT written (the save rests until reload)
//   3. the design record: another writer changes energy_systems → `focus` → this tab's next autosave builds on the new stand: no
//      409, both values stored (before: the first PUT went out on the old stand and was refused)
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
/** 22-character IFC GlobalId stand-in. @param {string} s */
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen"];
/** A wall of 6 m along x (metres) with its stored GUID. @param {number} i @param {number} x @param {number} z */
const wand = (i, x, z) => ({ a: { x, z }, b: { x: x + 6, z }, level: 0, height: 3, thickness: 0.3, _idx: i, guid: guid(`Waechter11505bW${i}x${x}`), status: "neubau" });
/** A door in the middle of a wall. @param {number} i @param {any} w */
const tuer = (i, w) => ({ wallIdx: w._idx, u: 3, typeId: "single", kind: "door", _idx: i, wirt_guid: w.guid });

const ALT_WAENDE = [wand(1, 0, 0), wand(2, 0, 8)];
const ALT_TUEREN = [tuer(3, ALT_WAENDE[0]), tuer(4, ALT_WAENDE[1])];
const NEU_WAENDE = [wand(3, 20, 0), wand(4, 20, 8)];
const NEU_TUEREN = [tuer(5, NEU_WAENDE[0]), tuer(6, NEU_WAENDE[1])];
/** The blocked stream (the browser logs the aborted request) - expected in every test of this file. */
const STROM_BLOCKIERT = /\/api\/aenderungen|EventSource|ERR_FAILED/;

/**
 * Console errors and warnings except the known offline / WebGL noise and the blocked stream. @param {import("@playwright/test").Page} page
 * @param {RegExp|null} [auch] further allowed messages for one test
 */
function wache(page, auch = null) {
  /** @type {string[]} */ const warnungen = [];
  page.on("console", (m) => {
    const t = m.text();
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(t) && !/GPU stall|WebGL|wasm/i.test(t) && !STROM_BLOCKIERT.test(t) && !(auch && auch.test(t))) warnungen.push(t);
  });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Every browser write on one entity with its body and answer status. @param {import("@playwright/test").Page} page @param {string} entity */
function mitschnitt(page, entity) {
  /** @type {Array<{methode: string, url: string, body: any, status?: number}>} */ const schreiben = [];
  const muster = new RegExp(`/api/entities/${entity}`);
  page.on("request", (r) => {
    if ((r.method() === "PUT" || r.method() === "POST") && muster.test(r.url())) {
      let body = null;
      try { body = r.postDataJSON(); } catch { /* no JSON body */ }
      schreiben.push({ methode: r.method(), url: r.url(), body });
    }
  });
  page.on("response", (r) => {
    const req = r.request();
    if ((req.method() === "PUT" || req.method() === "POST") && muster.test(r.url())) {
      const e = [...schreiben].reverse().find((x) => x.url === r.url() && x.status === undefined);
      if (e) e.status = r.status();
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

/** @param {import("@playwright/test").APIRequestContext} request @param {string} name @param {Record<string, any>} modell */
async function projektMitModell(request, name, modell) {
  for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await aufraeumen(request, alt.id);
  const id = (await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const leer = Object.fromEntries(LISTEN.map((k) => [k, []]));
  const bm = await (await request.post(`${API}/BimModel`, { data: { project_id: id, ...leer, ...modell } })).json();
  return { id, bmId: bm.id };
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} id */
const gespeichert = async (request, id) => (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
/** @param {import("@playwright/test").Page} page */
const studioModell = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
/** @param {import("@playwright/test").Page} page */
const fokus = (page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

/** @param {import("@playwright/test").Page} page @param {string} name */
async function studioOeffnen(page, name) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung) && !!(/** @type {any} */ (window).bitApi), null, { timeout: 90000 });
}

test.describe("115-05b Fokus-Check: ohne Strom den anderen Stand bemerken", () => {
  test.setTimeout(240000);

  test("Strom blockiert: focus und visibilitychange übernehmen den gespeicherten Stand, ohne eigenes Element-Schreiben", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Fokuscheck 11505b";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      await page.route("**/api/aenderungen**", (r) => r.abort());
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      const schreiben = mitschnitt(page, "BimModel");
      await studioOeffnen(page, NAME);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);
      await page.waitForTimeout(1500); // the load settles (no autosave expected: the tab is clean)

      const put = { customWalls: NEU_WAENDE, customWindows: NEU_TUEREN };
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: put })).ok()).toBe(true);
      await page.waitForTimeout(2500);
      expect((await studioModell(page)).customWalls.map((w) => w._idx), "without a trigger nothing arrives (stream blocked)").toEqual([1, 2]);

      await fokus(page);
      await expect.poll(async () => (await studioModell(page)).customWalls.map((w) => w._idx).sort(), { timeout: 15000 }).toEqual([3, 4]);
      expect((await studioModell(page)).customWindows.map((o) => o._idx).sort()).toEqual([5, 6]);
      await page.waitForTimeout(3000); // an autosave would have gone out by now (1.2 s)

      // second foreign write, trigger: the tab becomes visible again
      const zweit = { customWalls: [wand(7, 40, 0)], customWindows: [] };
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: zweit })).ok()).toBe(true);
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect.poll(async () => (await studioModell(page)).customWalls.map((w) => w._idx), { timeout: 15000 }).toEqual([7]);
      await page.waitForTimeout(3000);

      const rec = await gespeichert(request, p.id);
      expect(rec.customWalls, "stored walls = the second foreign PUT").toEqual(zweit.customWalls);
      expect(rec.customWindows).toEqual([]);
      const listenSchreiben = schreiben.filter((s) => s.body && LISTEN.some((k) => k in s.body));
      expect(listenSchreiben, `the browser wrote element lists: ${JSON.stringify(listenSchreiben).slice(0, 400)}`).toEqual([]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Modell durch anderen Datensatz ersetzt: Hinweis, und nichts wird mehr geschrieben", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Fokuscheck 11505b ersetzt";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      await page.route("**/api/aenderungen**", (r) => r.abort());
      // the refused autosave of the replaced model is logged by the studio
      const warn = wache(page, /Modell wurde ersetzt|Model was replaced/);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      const schreiben = mitschnitt(page, "BimModel");
      await studioOeffnen(page, NAME);
      await expect.poll(async () => (await studioModell(page)).customWalls?.map((w) => w._idx), { timeout: 30000 }).toEqual([1, 2]);
      await page.waitForTimeout(1500);

      // replaced like an import: the old record goes, a new one (other id) comes
      expect((await request.delete(`${API}/BimModel/${p.bmId}`)).ok()).toBe(true);
      const ersatz = await (await request.post(`${API}/BimModel`, { data: { project_id: p.id, ...Object.fromEntries(LISTEN.map((k) => [k, []])), customWalls: [wand(9, 60, 0)] } })).json();
      expect(ersatz.id).not.toBe(p.bmId);
      await fokus(page);
      await expect(page.getByTestId("modell-ersetzt")).toBeVisible({ timeout: 15000 });

      const vorher = schreiben.length;
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 20 }, b: { x: 46, z: 20 }, level: 0, thickness_m: 0.24 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      await page.waitForTimeout(3500);
      expect(schreiben.slice(vorher), "no write on BimModel while the model is replaced").toEqual([]);
      const rec = await gespeichert(request, p.id);
      expect(rec.id).toBe(ersatz.id);
      expect(rec.customWalls.map((/** @type {any} */ w) => w._idx)).toEqual([9]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Entwurf (BuildingComplex): nach focus baut das Speichern auf dem neuen Stand — kein 409", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Fokuscheck 11505b Entwurf";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      await page.route("**/api/aenderungen**", (r) => r.abort());
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { footprintM: [{ x: -6, z: -5 }, { x: 6, z: -5 }, { x: 6, z: 5 }, { x: -6, z: 5 }], storeys: 2, storeyHeight: 3, unit: "m" });
      const komplex = await (await request.post(`${API}/BuildingComplex`, { data: {
        project_id: p.id, name: NAME, location: { lat: 0, lng: 0, address: "Testadresse" }, energy_systems: [{ id: "es-a", name: "Variante A", type: "heat_pump" }],
      } })).json();
      const schreiben = mitschnitt(page, "BuildingComplex");
      const geladen = page.waitForResponse((r) => /\/api\/entities\/BuildingComplex\?project_id=/.test(r.url()) && r.request().method() === "GET", { timeout: 90000 });
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
      await geladen;
      await expect(page.getByTestId("ms-stpl-hand")).toBeVisible({ timeout: 90000 });
      await page.waitForTimeout(800);

      const energieB = [{ id: "es-b", name: "Variante B", type: "district_heating" }];
      expect((await request.put(`${API}/BuildingComplex/${komplex.id}`, { data: { energy_systems: energieB } })).ok()).toBe(true);
      await fokus(page);
      await page.waitForTimeout(1500); // the check reads the record and moves the base
      await page.getByTestId("ms-stpl-hand").fill("4");
      await expect.poll(async () => (await (await request.get(`${API}/BuildingComplex?project_id=${p.id}`)).json())[0]?.kennzahlen_hand?.stellplaetze ?? null, { timeout: 15000 }).toBe(4);
      await page.waitForTimeout(1000);

      const rec = (await (await request.get(`${API}/BuildingComplex?project_id=${p.id}`)).json())[0];
      expect(rec.energy_systems, "the other writer's field stays").toEqual(energieB);
      expect(schreiben.map((s) => s.status), "every PUT accepted at once (the focus check moved the stand)").not.toContain(409);
      expect(schreiben.length).toBeGreaterThan(0);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });
});
