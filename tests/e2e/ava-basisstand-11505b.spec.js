// Headless proof 115-05b part 2 (A-7): AVA's classification writes the element lists of its OWN copy of the model. When another
// tab or device stored a newer model since that copy was loaded, the save is refused ("Modell inzwischen geändert — neu laden")
// instead of silently putting the old elements back. Own neutral project (API), cleaned up in `finally`.
//   - the copy holds walls 1,2; another writer stores walls 3,4; a layer chip of wall 1 + "Speichern" → note, the stored walls stay
//     3,4, the browser sent no element list
//   - the copy is current: the same classification is stored (the strict save does not refuse a fresh copy)
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
/** 22-character IFC GlobalId stand-in. @param {string} s */
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
/** A wall of 6 m along x (metres). @param {number} i @param {number} x @param {number} z */
const wand = (i, x, z) => ({ a: { x, z }, b: { x: x + 6, z }, level: 0, height: 3, thickness: 0.3, _idx: i, guid: guid(`Ava11505bW${i}x${x}`), status: "neubau" });

/** @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */ const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
  return warnungen;
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string|null} id */
async function aufraeumen(request, id) {
  if (!id) return;
  for (const r of await (await request.get(`${API}/BimModel?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/BimModel/${r.id}`).catch(() => {});
  await request.delete(`${API}/Project/${id}`).catch(() => {});
}

/** @param {import("@playwright/test").Page} page @param {string} name */
async function mengenOeffnen(page, name) {
  await page.goto(`/AVA?projekt=${encodeURIComponent(name)}&tab=takeoff`);
  await expect(page.getByText("Bauteil-Klassifizierung")).toBeVisible({ timeout: 90000 });
}

/** The layer chip of one element row of the classification editor. @param {import("@playwright/test").Page} page @param {string} elId @param {string} schicht */
const chip = (page, elId, schicht) => page.locator("tr", { has: page.locator(".font-mono", { hasText: new RegExp(`^${elId}$`) }) }).getByRole("button", { name: schicht, exact: true });

test.describe("115-05b AVA: Klassifizierung auf veralteter Kopie überschreibt nichts", () => {
  test.setTimeout(240000);

  test("veraltete Kopie → Meldung, gespeicherte Wände bleiben; aktuelle Kopie → gespeichert", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E AVA Stand 11505b";
    /** @type {string|null} */ let pid = null;
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await aufraeumen(request, alt.id);
      pid = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const bm = await (await request.post(`${API}/BimModel`, { data: { project_id: pid, customWalls: [wand(1, 0, 0), wand(2, 0, 8)] } })).json();
      /** @type {any[]} */ const listenPuts = [];
      page.on("request", (r) => {
        if ((r.method() === "PUT" || r.method() === "POST") && /\/api\/entities\/BimModel/.test(r.url())) {
          try { if (r.postDataJSON()?.customWalls) listenPuts.push(r.postDataJSON()); } catch { /* no JSON body */ }
        }
      });
      await mengenOeffnen(page, NAME);
      await expect(chip(page, "wall-1", "Holz")).toBeVisible({ timeout: 30000 });

      // another tab stores walls 3,4 - this page's copy still holds 1,2
      const neu = [wand(3, 20, 0), wand(4, 20, 8)];
      expect((await request.put(`${API}/BimModel/${bm.id}`, { data: { customWalls: neu } })).ok()).toBe(true);
      await chip(page, "wall-1", "Holz").click();
      await page.getByRole("button", { name: /^Speichern \(1\)/ }).click();
      await page.waitForTimeout(2500);
      const rec = (await (await request.get(`${API}/BimModel?project_id=${pid}`)).json())[0];
      expect(rec.customWalls.map((/** @type {any} */ w) => w._idx), "the newer walls stay").toEqual([3, 4]);
      expect(rec.customWalls, "the newer walls stay unchanged").toEqual(neu);
      expect(listenPuts, `the browser sent element lists: ${JSON.stringify(listenPuts).slice(0, 300)}`).toEqual([]);
      await expect(page.getByText("Modell inzwischen geändert — neu laden")).toBeVisible({ timeout: 15000 });

      // the copy was read again: a classification of the current wall 3 is stored
      await expect(chip(page, "wall-3", "Holz")).toBeVisible({ timeout: 15000 });
      await chip(page, "wall-3", "Holz").click();
      await page.getByRole("button", { name: /^Speichern \(\d+\)/ }).click();
      await expect.poll(async () => ((await (await request.get(`${API}/BimModel?project_id=${pid}`)).json())[0].customWalls
        .find((/** @type {any} */ w) => w._idx === 3)?.schicht || []).includes("Holz"), { timeout: 15000 }).toBe(true);
      const nachher = (await (await request.get(`${API}/BimModel?project_id=${pid}`)).json())[0];
      expect(nachher.customWalls.map((/** @type {any} */ w) => w._idx)).toEqual([3, 4]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, pid);
    }
  });

  // Review 115-05b part 2 (finding 4): two saves in a row before the first one's reload() is back - the second must build on the
  // stand the first returned (before: refused as "changed meanwhile", its basisStand was the copy before the first save); a failed
  // write (500) is told to the person instead of an unhandled rejection, the draft stays.
  test("zwei schnelle Speichervorgänge → beide gespeichert, keine Fehlmeldung; Serverfehler → Meldung statt unbehandelter Ablehnung", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E AVA Doppelt 11505b";
    /** @type {string|null} */ let pid = null;
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await aufraeumen(request, alt.id);
      pid = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const bm = await (await request.post(`${API}/BimModel`, { data: { project_id: pid, customWalls: [wand(1, 0, 0), wand(2, 0, 8)] } })).json();
      // after the first save, the page's reads of the model are slow (3 s): its reload() is not back when the second save starts
      let fehler = false;
      let langsam = false;
      await page.route(`**${API}/BimModel**`, async (route) => {
        const m = route.request().method();
        if (m === "PUT" && fehler) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Testfehler" }) });
        if (m === "GET" && langsam) await new Promise((r) => setTimeout(r, 3000));
        return route.continue();
      });
      await mengenOeffnen(page, NAME);
      await expect(chip(page, "wall-1", "Holz")).toBeVisible({ timeout: 30000 });
      await chip(page, "wall-1", "Holz").click();
      const erstesPut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/BimModel/${bm.id}`), { timeout: 15000 });
      await page.getByRole("button", { name: /^Speichern \(1\)/ }).click();
      expect((await erstesPut).status()).toBe(200);
      langsam = true;
      await chip(page, "wall-2", "Holz").click();
      await page.getByRole("button", { name: /^Speichern \(\d+\)/ }).click();
      await expect.poll(async () => ((await (await request.get(`${API}/BimModel?project_id=${pid}`)).json())[0].customWalls
        .find((/** @type {any} */ w) => w._idx === 2)?.schicht || []).includes("Holz"), { timeout: 20000 }).toBe(true);
      await page.waitForTimeout(4000);
      langsam = false;
      await expect(page.getByText("Modell inzwischen geändert — neu laden"), "no false 'changed meanwhile'").toHaveCount(0);
      const rec = (await (await request.get(`${API}/BimModel?project_id=${pid}`)).json())[0];
      expect(rec.customWalls.map((/** @type {any} */ w) => w._idx)).toEqual([1, 2]);
      expect(rec.customWalls.find((/** @type {any} */ w) => w._idx === 1)?.schicht || [], "the first save is not undone by the second").toContain("Holz");

      // a failed write: the person is told, nothing unhandled
      fehler = true;
      await chip(page, "wall-2", "Putz").click();
      await page.getByRole("button", { name: /^Speichern \(\d+\)/ }).click();
      await expect(page.getByText(/Speichern fehlgeschlagen/).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole("button", { name: /^Speichern \(\d+\)/ }), "the draft stays for another attempt").toBeVisible();
      const ohne500 = warn.filter((w) => !/status of 500|Testfehler|Klassifizierung nicht gespeichert/.test(w));
      expect(ohne500, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, pid);
    }
  });
});
