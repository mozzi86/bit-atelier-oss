// Headless proof 115-05b (E-1, E-3): a save is bound to the project and the record it was planned for; one design record per
// project. Own neutral projects per test (API), cleaned up in `finally`; the stored records are read back over the API.
//   1. E-1: the studio's autosave PUT of project A is held on the wire, another writer changes A meanwhile, the person opens
//      project B, the PUT is released (→ 409) → the retry goes to A's record on A's stored state: B stays exactly as it was,
//      A holds the new wall AND the other writer's change, no browser write goes to B's record or to an id "null"
//      (before: the 409 was merged on B's cache and the retry wrote A's walls with project_id A into B)
//   1b. R-1 (review): as 1., but the other writer changes the walls of A → the held save is refused and the person is told
//      (toast); B's studio shows no save error (before: no toast, B showed "Speicherfehler")
//   2. E-3: two tabs of a project WITHOUT a design record both take over the location; the first tab's create is held on the
//      wire until the second tab created its record → exactly ONE record (before: two)
import { test, expect } from "@playwright/test";
// 115-05c (D-115-12): model changes are a draft until "Speichern"
import { speichernUndWarten } from "./fixtures/entwurf.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen"];
/** 22-character IFC GlobalId stand-in. @param {string} s */
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
/** A wall of 6 m along x (metres) with its stored GUID. @param {number} i @param {number} x @param {number} z */
const wand = (i, x, z) => ({ a: { x, z }, b: { x: x + 6, z }, level: 0, height: 3, thickness: 0.3, _idx: i, guid: guid(`Bindung11505bW${i}x${x}`), status: "neubau" });
const WAENDE_A = [wand(1, 0, 0), wand(2, 0, 8)];
const WAENDE_B = [wand(1, 100, 0)];

/**
 * Console errors and warnings except the known offline / WebGL noise and the deliberate 409 of the strict save (the browser logs
 * a refused request as "Failed to load resource … 409"; the refusal is the mechanism under test, pattern bild-106-06).
 * @param {import("@playwright/test").Page} page
 * @param {RegExp|null} [auch] further allowed messages for one test (115-05c)
 */
function wache(page, auch = null) {
  /** @type {string[]} */ const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm|status of 409/i.test(m.text()) && !(auch && auch.test(m.text()))) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Every browser write on an entity with its body and the status of its answer. @param {import("@playwright/test").Page} page @param {string} entitaet */
function mitschnitt(page, entitaet) {
  const muster = new RegExp(`/api/entities/${entitaet}`);
  /** @type {Array<{methode: string, url: string, body: any, status?: number}>} */ const schreiben = [];
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
  for (const ent of ["BimModel", "BuildingComplex"]) {
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
const gespeichert = async (request, id) => (await (await request.get(`${API}/BimModel?project_id=${id}`)).json());
/** @param {import("@playwright/test").Page} page */
const studioModell = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
/** @param {import("@playwright/test").Page} page */
const abgleich = (page) => page.evaluate(() => /** @type {any} */ (window).__bitAbgleich?.stand() ?? null);

test.describe("115-05b Projektbindung: ein Speichern bleibt bei seinem Projekt", () => {
  test.setTimeout(240000);

  test("E-1: 409 von A nach dem Wechsel zu B schreibt nie in B", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME_A = "E2E Bindung 11505b A";
    const NAME_B = "E2E Bindung 11505b B";
    let a = { id: null, bmId: null }, b = { id: null, bmId: null };
    /** @type {() => void} */ let freigeben = () => {};
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      a = await projektMitModell(request, NAME_A, { customWalls: WAENDE_A });
      b = await projektMitModell(request, NAME_B, { customWalls: WAENDE_B });
      const vorherB = (await gespeichert(request, /** @type {any} */ (b.id)))[0];
      const schreiben = mitschnitt(page, "BimModel");
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_A)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung) && !!(/** @type {any} */ (window).bitApi), null, { timeout: 90000 });
      await expect.poll(async () => (await studioModell(page)).customWalls?.map((w) => w._idx), { timeout: 30000 }).toEqual([1, 2]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      await page.waitForTimeout(1500);
      // the studio's first PUT of A stays on the wire until released (a slow network); the server decides when it arrives
      const tor = new Promise((r) => { freigeben = () => r(undefined); });
      let gehalten = 0;
      await page.route(`**${API}/BimModel/${a.bmId}**`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        gehalten += 1;
        if (gehalten === 1) await tor;
        return route.continue();
      });
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      await page.getByTestId("entwurf-speichern").click(); // 115-05c (adapted): "Speichern" sends A's PUT (before: the autosave)
      await expect.poll(() => gehalten, { timeout: 10000 }).toBe(1); // the save of A is on its way
      // another writer (another tab) changes A meanwhile - a field the studio does not write
      expect((await request.put(`${API}/BimModel/${a.bmId}`, { data: { e2e_marke: "fremd-11505b" } })).ok()).toBe(true);
      // the person opens project B
      await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
      await page.getByRole("option", { name: NAME_B, exact: true }).click();
      // 115-05c (adapted): A is not saved yet (its save is on the wire) - the switch asks; the person keeps A as a draft
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "Als Entwurf behalten" }).click();
      await expect.poll(async () => (await studioModell(page)).customWalls?.map((w) => w.a.x), { timeout: 30000 }).toEqual([100]);
      freigeben(); // the held PUT of A reaches the server now: 409 (A changed meanwhile)
      await expect.poll(() => schreiben.filter((s) => s.status !== undefined).length, { timeout: 15000 }).toBeGreaterThan(0);
      await page.waitForTimeout(4000); // retry + B's own autosave window

      const protokoll = JSON.stringify(schreiben.map((s) => `${s.methode} ${s.url.replace(/^.*BimModel/, "")} ${s.status}`));
      const recB = await (await request.get(`${API}/BimModel/${b.bmId}`)).json();
      expect(recB.project_id, `B's record belongs to B (writes ${protokoll})`).toBe(b.id);
      expect(recB.customWalls, "B's walls are unchanged").toEqual(WAENDE_B);
      expect(recB.updated_date, `B was written (writes ${protokoll})`).toBe(vorherB.updated_date);
      expect((await gespeichert(request, /** @type {any} */ (a.id))).length, "A has one record").toBe(1);
      const fehlgeleitet = schreiben.filter((s) => !s.url.includes(`/BimModel/${a.bmId}`));
      expect(fehlgeleitet.map((s) => `${s.methode} ${s.url}`), "every browser write went to A's record").toEqual([]);
      const recA = (await gespeichert(request, /** @type {any} */ (a.id)))[0];
      expect(recA.e2e_marke, "the other writer's change stays in A").toBe("fremd-11505b");
      expect(recA.customWalls.filter((w) => w.a.x === 40 && w.b.x === 46).length, "the new wall reached A").toBe(1);
      for (const w of WAENDE_A) expect(recA.customWalls.find((x) => x._idx === w._idx), `wall ${w._idx} of A`).toEqual(w);
      expect(schreiben.some((s) => s.status === 409), "the held PUT was refused (409) - the mechanism under test").toBe(true);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      freigeben();
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await aufraeumen(request, a.id);
      await aufraeumen(request, b.id);
    }
  });

  test("R-1: abgelehntes Speichern von A nach dem Wechsel zu B wird gemeldet, B bleibt fehlerfrei", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME_A = "E2E Bindung 11505b R1 A";
    const NAME_B = "E2E Bindung 11505b R1 B";
    let a = { id: null, bmId: null }, b = { id: null, bmId: null };
    /** @type {() => void} */ let freigeben = () => {};
    try {
      await nurLocalhost(page);
      // 115-05c (adapted): the refused save is reported by the draft as well (the refusal is the point of this test)
      const warn = wache(page, /Speichern fehlgeschlagen: Modell nicht geschrieben/);
      a = await projektMitModell(request, NAME_A, { customWalls: WAENDE_A });
      b = await projektMitModell(request, NAME_B, { customWalls: WAENDE_B });
      const vorherB = (await gespeichert(request, /** @type {any} */ (b.id)))[0];
      const schreiben = mitschnitt(page, "BimModel");
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_A)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung) && !!(/** @type {any} */ (window).bitApi), null, { timeout: 90000 });
      await expect.poll(async () => (await studioModell(page)).customWalls?.map((w) => w._idx), { timeout: 30000 }).toEqual([1, 2]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      await page.waitForTimeout(1500);
      const tor = new Promise((r) => { freigeben = () => r(undefined); });
      let gehalten = 0;
      await page.route(`**${API}/BimModel/${a.bmId}**`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        gehalten += 1;
        if (gehalten === 1) await tor;
        return route.continue();
      });
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      await page.getByTestId("entwurf-speichern").click(); // 115-05c (adapted): "Speichern" sends A's PUT (before: the autosave)
      await expect.poll(() => gehalten, { timeout: 10000 }).toBe(1); // the save of A is on its way
      // another writer changes the SAME field of A meanwhile: the held save can only be refused (nothing is mixed)
      const FREMD = [...WAENDE_A, wand(3, 0, 20)];
      expect((await request.put(`${API}/BimModel/${a.bmId}`, { data: { customWalls: FREMD } })).ok()).toBe(true);
      await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
      await page.getByRole("option", { name: NAME_B, exact: true }).click();
      // 115-05c (adapted): A is not saved yet (its save is on the wire) - the switch asks; the person keeps A as a draft
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "Als Entwurf behalten" }).click();
      await expect.poll(async () => (await studioModell(page)).customWalls?.map((w) => w.a.x), { timeout: 30000 }).toEqual([100]);
      freigeben(); // the held PUT of A reaches the server now: 409
      await expect.poll(() => schreiben.filter((s) => s.status !== undefined).length, { timeout: 15000 }).toBeGreaterThan(0);

      const protokoll = () => JSON.stringify(schreiben.map((s) => `${s.methode} ${s.url.replace(/^.*BimModel/, "")} ${s.status}`));
      // the person is told that the last change (of the project left) was not saved
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Letzte Änderung am Modell nicht gespeichert" }),
        `refusal reported (writes ${protokoll()})`).toHaveCount(1, { timeout: 10000 });
      await page.waitForTimeout(2500); // B's own autosave window
      // B's studio is not put into an error state by A's refusal
      await expect(page.getByText("Speicherfehler", { exact: true }), "B shows no save error").toHaveCount(0);
      const recB = await (await request.get(`${API}/BimModel/${b.bmId}`)).json();
      expect(recB.project_id).toBe(b.id);
      expect(recB.customWalls, "B's walls are unchanged").toEqual(WAENDE_B);
      expect(recB.updated_date, `B was not written (writes ${protokoll()})`).toBe(vorherB.updated_date);
      const recA = (await gespeichert(request, /** @type {any} */ (a.id)))[0];
      expect(recA.customWalls, "A keeps the other writer's walls, nothing mixed").toEqual(FREMD);
      expect(schreiben.every((s) => s.url.includes(`/BimModel/${a.bmId}`)), `every browser write went to A's record ${protokoll()}`).toBe(true);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      freigeben();
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await aufraeumen(request, a.id);
      await aufraeumen(request, b.id);
    }
  });

  test("E-3: zwei Tabs eines Projekts ohne Entwurf legen genau einen an", async ({ page, request, browser }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Bindung 11505b Komplex";
    let id = null;
    // 115-05c (adapted): K10 locks a second tab of the SAME browser on one project; the race of two writers creating the first
    // record is kept with a second browser (another device) - the server rule E-3 is what is tested
    const zweiterKontext = await browser.newContext();
    const zweite = await zweiterKontext.newPage();
    /** @type {() => void} */ let freigeben = () => {};
    try {
      await nurLocalhost(page);
      await nurLocalhost(zweite);
      const warn = wache(page);
      const warn2 = wache(zweite);
      for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await aufraeumen(request, alt.id);
      id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const schreiben1 = mitschnitt(page, "BuildingComplex");
      const schreiben2 = mitschnitt(zweite, "BuildingComplex");
      // both tabs read "no design record" first
      for (const p of [page, zweite]) {
        await p.setViewportSize({ width: 1400, height: 1000 });
        await p.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=site`);
        await expect(p.getByRole("button", { name: /Standort übernehmen/ })).toBeVisible({ timeout: 90000 });
        await p.waitForTimeout(1500);
      }
      // the first tab's create stays on the wire until the second tab created its record
      const tor = new Promise((r) => { freigeben = () => r(undefined); });
      let posts1 = 0;
      await page.route("**/api/entities/BuildingComplex", async (route) => {
        if (route.request().method() === "POST" && ++posts1 === 1) await tor;
        return route.continue();
      });
      await page.getByRole("button", { name: /Standort übernehmen/ }).click();
      await expect.poll(() => posts1, { timeout: 10000 }).toBe(1);
      await zweite.getByRole("button", { name: /Standort übernehmen/ }).click();
      await expect.poll(() => schreiben2.filter((s) => s.methode === "POST" && s.status !== undefined).length, { timeout: 15000 }).toBe(1);
      freigeben();
      await expect.poll(() => schreiben1.filter((s) => s.status !== undefined).length, { timeout: 15000 }).toBeGreaterThan(0);
      await page.waitForTimeout(5000); // merge + write again on the record of the second tab
      // 115-05c (adapted): the location is part of the site group, a draft until "Speichern" (the autosave created the record)
      await speichernUndWarten(zweite);
      const rows = await (await request.get(`${API}/BuildingComplex?project_id=${id}`)).json();
      const protokoll = JSON.stringify([...schreiben1.map((s) => `1:${s.methode} ${s.status}`), ...schreiben2.map((s) => `2:${s.methode} ${s.status}`)]);
      expect(rows.length, `design records of the project (writes ${protokoll})`).toBe(1);
      expect(rows[0].location, "the location is stored").toBeTruthy();
      expect([...warn, ...warn2], `Konsole: ${[...warn, ...warn2].join(" | ")}`).toEqual([]);
    } finally {
      freigeben();
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await zweite.close().catch(() => {});
      await zweiterKontext.close().catch(() => {});
      await aufraeumen(request, id);
    }
  });
});
