// Headless proof 115-05a (D-115-50): a tab with an older state never mixes old and new elements, writes nothing before its
// own project is loaded, and a project switch loses no change of the autosave window. Own neutral projects per test (API),
// cleaned up in `finally`; the stored record is read back over the API and compared with what was put there.
//   1. stream: another writer replaces walls 1,2 + doors 3,4 by walls 3,4 + doors 5,6 → after ≥ 3 s the stored lists are
//      exactly the PUT body, the studio shows them, and the browser wrote no element list
//   2. 409 way (stream blocked): the same foreign PUT, then a new wall drawn here (its local _idx 5 meets the foreign door 5)
//      → stored doors = PUT, walls = PUT walls + exactly the one new wall with a free number, nothing old comes back
//   3. the load fails (500) → note "Modell nicht geladen", a wall drawn afterwards is NOT written
//   4. project switch inside the autosave window → the new wall is flushed into A, B stays as it was, and B's stream still
//      reaches the studio (the cache stays on B)
//   5. review K01 / R-02: Strg+Z while the studio's own autosave PUT is on its way (PUT delayed 400 ms) → stored = what the
//      studio shows after the undo (before, the undo equalled the old image, nothing was planned, the PUT's walls stayed)
//   6. review K02: project switch while A's own autosave PUT is on its way (delayed 2.5 s) and a newer wall waits in the window
//      → both walls reach A, no 409, no toast (before, the flush went out on A's stand from before that save → 409, wall lost)
//   7. review K03: this tab draws a wall and takes it back (Strg+Z), another writer's wall with the SAME number arrives (both
//      counters start at stored max + 1), Strg+Y → both walls stored, no number twice (before, the redo dropped the other wall)
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
// 115-05c (D-115-12): model changes are a draft until "Speichern" - the tests that waited for the autosave press it now
import { speichernUndWarten } from "./fixtures/entwurf.js";

const API = "/api/entities";
/** 22-character IFC GlobalId stand-in. @param {string} s */
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen"];
/** A wall of 6 m along x (metres) with its stored GUID. @param {number} i @param {number} x @param {number} z */
const wand = (i, x, z) => ({ a: { x, z }, b: { x: x + 6, z }, level: 0, height: 3, thickness: 0.3, _idx: i, guid: guid(`Standschutz11505aW${i}x${x}`), status: "neubau" });
/** A door in the middle of a wall (u in m along the wall). @param {number} i @param {any} w */
const tuer = (i, w) => ({ wallIdx: w._idx, u: 3, typeId: "single", kind: "door", _idx: i, wirt_guid: w.guid });

const ALT_WAENDE = [wand(1, 0, 0), wand(2, 0, 8)];
const ALT_TUEREN = [tuer(3, ALT_WAENDE[0]), tuer(4, ALT_WAENDE[1])];
const NEU_WAENDE = [wand(3, 20, 0), wand(4, 20, 8)];
const NEU_TUEREN = [tuer(5, NEU_WAENDE[0]), tuer(6, NEU_WAENDE[1])];
const ALT_GEOMETRIE = new Set([...ALT_WAENDE.map((w) => JSON.stringify([w.a, w.b]))]);

/**
 * Console errors and warnings except the known offline / WebGL noise. @param {import("@playwright/test").Page} page
 * @param {RegExp|null} [auch] further allowed messages for one test
 */
function wache(page, auch = null) {
  /** @type {string[]} */ const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text()) && !(auch && auch.test(m.text()))) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Every browser write on BimModel with its body and the status of its answer. @param {import("@playwright/test").Page} page */
function mitschnitt(page) {
  /** @type {Array<{methode: string, url: string, body: any, status?: number}>} */ const schreiben = [];
  page.on("request", (r) => {
    if ((r.method() === "PUT" || r.method() === "POST") && /\/api\/entities\/BimModel/.test(r.url())) {
      let body = null;
      try { body = r.postDataJSON(); } catch { /* no JSON body */ }
      schreiben.push({ methode: r.method(), url: r.url(), body });
    }
  });
  page.on("response", (r) => {
    const req = r.request();
    if ((req.method() === "PUT" || req.method() === "POST") && /\/api\/entities\/BimModel/.test(r.url())) {
      const e = [...schreiben].reverse().find((x) => x.url === r.url() && x.status === undefined);
      if (e) e.status = r.status();
    }
  });
  return schreiben;
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} name @param {Record<string, any>} modell */
async function projektMitModell(request, name, modell) {
  for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await aufraeumen(request, alt.id);
  const id = (await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const leer = Object.fromEntries(LISTEN.map((k) => [k, []]));
  const bm = await (await request.post(`${API}/BimModel`, { data: { project_id: id, ...leer, ...modell } })).json();
  return { id, bmId: bm.id };
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string|null} id */
async function aufraeumen(request, id) {
  if (!id) return;
  for (const m of await (await request.get(`${API}/BimModel?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/BimModel/${m.id}`).catch(() => {});
  await request.delete(`${API}/Project/${id}`).catch(() => {});
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} id */
const gespeichert = async (request, id) => (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
/** @param {import("@playwright/test").Page} page */
const studioModell = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
/** @param {import("@playwright/test").Page} page */
const abgleich = (page) => page.evaluate(() => /** @type {any} */ (window).__bitAbgleich?.stand() ?? null);

/** @param {import("@playwright/test").Page} page @param {string} name */
async function studioOeffnen(page, name) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung) && !!(/** @type {any} */ (window).bitApi), null, { timeout: 90000 });
}

test.describe("115-05a Stand-Schutz: nie alte und neue Bauteile mischen", () => {
  test.setTimeout(240000);

  test("D-115-50: Strom — Fremdschreiben wird ohne Mischen übernommen", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Standschutz 11505a";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");

      // another writer (no client id → the stream delivers it to this tab)
      const put = { customWalls: NEU_WAENDE, customWindows: NEU_TUEREN };
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: put })).ok()).toBe(true);
      await expect.poll(async () => (await studioModell(page)).customWalls.map((w) => w._idx), { timeout: 20000 }).toEqual([3, 4]);
      await page.waitForTimeout(3000); // autosave 1.2 s + stream

      const rec = await gespeichert(request, p.id);
      expect(rec.customWindows, "stored doors = the foreign PUT").toEqual(put.customWindows);
      expect(rec.customWalls, "stored walls = the foreign PUT").toEqual(put.customWalls);
      const m = await studioModell(page);
      expect(m.customWalls.map((w) => w._idx).sort()).toEqual([3, 4]);
      expect(m.customWindows.map((o) => o._idx).sort()).toEqual([5, 6]);
      const listenSchreiben = schreiben.filter((s) => s.body && LISTEN.some((k) => k in s.body));
      expect(listenSchreiben, `the browser wrote element lists: ${JSON.stringify(listenSchreiben).slice(0, 400)}`).toEqual([]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("D-115-50: 409-Weg — Strom blockiert, eigene Bearbeitung danach", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Standschutz 11505a 409";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      await page.route("**/api/aenderungen**", (r) => r.abort()); // the change stream never connects: only the 409 tells
      // the blocked stream and the deliberate 409 of the strict save are expected here (the browser logs a refused request)
      const warn = wache(page, /\/api\/aenderungen|EventSource|status of 409/);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);

      const put = { customWalls: NEU_WAENDE, customWindows: NEU_TUEREN };
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: put })).ok()).toBe(true);
      // a new wall at a place of its own; its local _idx is 5 (the foreign door 5 has the same number in another list)
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0, thickness_m: 0.24 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      // 115-05c: "Speichern" reads the stored state first (K3) and merges it, then writes (a 409 on the way merges the same)
      await speichernUndWarten(page);
      await expect.poll(async () => (await gespeichert(request, p.id)).customWalls.length, { timeout: 20000 }).toBe(3);

      const rec = await gespeichert(request, p.id);
      expect(rec.customWindows, "stored doors = the foreign PUT").toEqual(put.customWindows);
      for (const w of put.customWalls) expect(rec.customWalls.find((x) => x._idx === w._idx), `wall ${w._idx}`).toEqual(w);
      const eigene = rec.customWalls.filter((w) => w.a.x === 40 && w.b.x === 46);
      expect(eigene.length, "exactly one new wall").toBe(1);
      expect([3, 4, 5, 6]).not.toContain(eigene[0]._idx);
      for (const k of LISTEN) {
        const idx = (rec[k] || []).map((e) => e._idx);
        expect(new Set(idx).size, `no _idx twice in ${k}`).toBe(idx.length);
      }
      expect(rec.customWalls.some((w) => ALT_GEOMETRIE.has(JSON.stringify([w.a, w.b]))), "no old wall came back").toBe(false);
      expect(rec.customWindows.some((o) => o.wirt_guid === ALT_WAENDE[0].guid || o.wirt_guid === ALT_WAENDE[1].guid), "no old door came back").toBe(false);
      // 115-05c (adapted): before, the autosave went out on the old base and the server refused it (409) - the protection was that
      // refusal. "Speichern" now takes the stored state in first (K3), so NO browser write at all (accepted or refused) may carry
      // an old element - stricter than before, where only accepted writes were checked.
      const altGeschrieben = schreiben.filter((s) => ((s.body?.customWalls || []).some((w) => ALT_GEOMETRIE.has(JSON.stringify([w.a, w.b])))
        || (s.body?.customWindows || []).some((o) => o.wirt_guid === ALT_WAENDE[0].guid || o.wirt_guid === ALT_WAENDE[1].guid)));
      expect(altGeschrieben, `a browser PUT carried old elements: ${JSON.stringify(altGeschrieben).slice(0, 400)}`).toEqual([]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Laden fehlgeschlagen: nichts wird geschrieben", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Standschutz 11505a Laden";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      // the failed load is the point of this test: its 500 and the sync's "Laden fehlgeschlagen" warning are expected
      // 115-05c: "Speichern" refused because the model never loaded is logged by the draft as well (the refusal is the point)
      const warn = wache(page, /500|Laden fehlgeschlagen|Speichern fehlgeschlagen: Modell nicht geladen/);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      let fehlgeschlagen = 0;
      const muster = new RegExp(`/api/entities/BimModel\\?project_id=${p.id}`);
      /** @param {import("@playwright/test").Route} route */
      const einmal500 = async (route) => {
        fehlgeschlagen += 1;
        await page.unroute(muster, einmal500);
        await route.fulfill({ status: 500, json: { error: "Testfehler 115-05a" } });
      };
      await page.route(muster, einmal500);
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      await expect(page.getByTestId("bim-speicher")).toHaveAttribute("data-zustand", "error", { timeout: 30000 });
      expect(fehlgeschlagen).toBe(1);
      // a person draws a moment later (the studio re-enables its autosave 50 ms after a load, successful or not)
      await page.waitForTimeout(1500);
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      await page.waitForTimeout(3000);
      // 115-05c: "Speichern" refuses as well (the model was never loaded) - the draft is kept, nothing written
      await page.getByTestId("entwurf-speichern").click();
      await expect(page.getByTestId("entwurf-status")).toHaveAttribute("data-zustand", "fehler", { timeout: 15000 });
      expect(schreiben, `browser writes: ${JSON.stringify(schreiben).slice(0, 400)}`).toEqual([]);
      const rec = await gespeichert(request, p.id);
      expect(rec.customWalls).toEqual(ALT_WAENDE);
      expect(rec.customWindows).toEqual(ALT_TUEREN);
      // the studio says why nothing is saved (persistent, not the hint line a drawing step clears)
      await expect(page.getByTestId("bim-nicht-geladen")).toBeVisible();
      await expect(page.getByTestId("bim-nicht-geladen")).toContainText("Modell nicht geladen — bitte die Seite neu laden. Bis dahin wird nichts gespeichert.");
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Projektwechsel flusht, der Strom des neuen Projekts bleibt", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME_A = "E2E Standschutz 11505a";
    const NAME_B = "E2E Standschutz 11505a B";
    let a = { id: null, bmId: null }, b = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      a = await projektMitModell(request, NAME_A, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      b = await projektMitModell(request, NAME_B, {});
      await studioOeffnen(page, NAME_A);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");

      await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      await page.getByRole("option", { name: NAME_B, exact: true }).click(); // well inside the 1.2-s autosave window
      // 115-05c (adapted): the switch asks first; "Speichern" writes the wall into A, then B opens (before: the autosave flush)
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible({ timeout: 10000 });
      await page.getByTestId("entwurf-verlassen").getByRole("button", { name: "Speichern", exact: true }).click();
      await expect.poll(async () => (await studioModell(page)).customWalls.length, { timeout: 30000 }).toBe(0);

      // A got the wall (flush), B is unchanged
      await expect.poll(async () => (await gespeichert(request, a.id)).customWalls.filter((w) => w.a.x === 40 && w.b.x === 46).length, { timeout: 15000 }).toBe(1);
      const recA = await gespeichert(request, a.id);
      for (const w of ALT_WAENDE) expect(recA.customWalls.find((x) => x._idx === w._idx), `wall ${w._idx} of A`).toEqual(w);
      expect(recA.customWindows).toEqual(ALT_TUEREN);
      expect((await gespeichert(request, b.id)).customWalls).toEqual([]);

      // B: the stream of the new project reaches the studio without reload (the cache did not move back to A)
      await expect.poll(async () => { const s = await abgleich(page); return `${s?.verbindung?.status}|${s?.verbindung?.projekt}`; }, { timeout: 30000 })
        .toBe(`verbunden|${b.id}`);
      const wandB = wand(1, 60, 0);
      expect((await request.put(`${API}/BimModel/${b.bmId}`, { data: { customWalls: [wandB] } })).ok()).toBe(true);
      await expect.poll(async () => (await studioModell(page)).customWalls, { timeout: 20000 }).toEqual([wandB]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, a.id);
      await aufraeumen(request, b.id);
    }
  });

  test("Rückgängig während das eigene Speichern unterwegs ist", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Standschutz 11505a Undo";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      await page.waitForTimeout(1500);
      let verzoegert = 0;
      // the studio's PUT takes 400 ms on the wire (slow disk, large model, busy save chain); Strg+Z comes while the first is on its way
      await page.route(`**${API}/BimModel/${p.bmId}**`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        verzoegert += 1;
        if (verzoegert === 1) await page.evaluate(() => /** @type {any} */ (window).bitApi.rueckgaengig());
        await new Promise((r) => setTimeout(r, 400));
        return route.continue();
      });
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      // 115-05c (adapted): the PUT goes out with "Speichern" (before: the autosave); after it landed, the change back is unsaved and
      // the next "Speichern" writes it (before: the autosave planned it again)
      await page.getByTestId("entwurf-speichern").click();
      await expect.poll(() => verzoegert, { timeout: 10000 }).toBeGreaterThan(0);
      expect((await studioModell(page)).customWalls.map((w) => w._idx), "the undo took the wall back").toEqual([1, 2]);
      await speichernUndWarten(page);
      await expect.poll(async () => (await gespeichert(request, p.id)).customWalls.map((w) => w._idx), { timeout: 15000 }).toEqual([1, 2]);
      await expect(page.getByTestId("bim-speicher")).toHaveAttribute("data-zustand", "saved", { timeout: 10000 });
      const rec = await gespeichert(request, p.id);
      expect(rec.customWalls, `stored walls = the studio's (writes ${JSON.stringify(schreiben.map((s) => s.body?.customWalls?.map((w) => w._idx) ?? null))})`).toEqual(ALT_WAENDE);
      expect(rec.customWindows).toEqual(ALT_TUEREN);
      expect((await studioModell(page)).customWalls.map((w) => w._idx)).toEqual([1, 2]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await aufraeumen(request, p.id);
    }
  });

  test("Projektwechsel, während das eigene Speichern von A unterwegs ist", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME_A = "E2E Standschutz 11505a Flug";
    const NAME_B = "E2E Standschutz 11505a Flug B";
    let a = { id: null, bmId: null }, b = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      a = await projektMitModell(request, NAME_A, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      b = await projektMitModell(request, NAME_B, {});
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME_A);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      await page.waitForTimeout(1500);
      let verzoegert = 0;
      await page.route(`**${API}/BimModel/${a.bmId}**`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        verzoegert += 1;
        if (verzoegert === 1) await new Promise((r) => setTimeout(r, 2500)); // only the autosave of the first wall is slow
        return route.continue();
      });
      const e1 = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(e1.ok, JSON.stringify(e1)).toBe(true);
      await page.getByTestId("entwurf-speichern").click(); // 115-05c (adapted): the save of the first wall (before: its autosave)
      await expect.poll(() => verzoegert, { timeout: 10000 }).toBe(1); // that save is on its way
      await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
      const e2 = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 60, z: 0 }, b: { x: 66, z: 0 }, level: 0 }));
      expect(e2.ok, JSON.stringify(e2)).toBe(true);
      await page.getByRole("option", { name: NAME_B, exact: true }).click(); // inside the 1.2-s window of the second wall
      // 115-05c (adapted): the switch asks; "Speichern" waits for the save on its way and writes the second wall, then B opens
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible({ timeout: 10000 });
      await page.getByTestId("entwurf-verlassen").getByRole("button", { name: "Speichern", exact: true }).click();
      await expect.poll(async () => (await studioModell(page)).customWalls.length, { timeout: 30000 }).toBe(0);

      // both walls reach A (the flush builds on the stand of the own save that landed after the switch)
      await expect.poll(async () => (await gespeichert(request, a.id)).customWalls.map((w) => w.a.x).sort((x, y) => x - y), { timeout: 15000 }).toEqual([0, 0, 40, 60]);
      await page.waitForTimeout(1000);
      const recA = await gespeichert(request, a.id);
      for (const w of ALT_WAENDE) expect(recA.customWalls.find((x) => x._idx === w._idx), `wall ${w._idx} of A`).toEqual(w);
      expect(recA.customWindows).toEqual(ALT_TUEREN);
      expect((await gespeichert(request, b.id)).customWalls).toEqual([]);
      expect(schreiben.filter((s) => s.status === 409), "no write was refused").toEqual([]);
      await expect(page.getByText("Letzte Änderung am Modell nicht gespeichert")).toHaveCount(0);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await aufraeumen(request, a.id);
      await aufraeumen(request, b.id);
    }
  });

  test("Wiederholen nach fremder Wand mit derselben Nummer", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Standschutz 11505a Redo";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: ALT_WAENDE, customWindows: ALT_TUEREN });
      await studioOeffnen(page, NAME);
      await expect.poll(async () => (await studioModell(page)).customWindows?.map((o) => o._idx), { timeout: 30000 }).toEqual([3, 4]);
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      await page.waitForTimeout(1500);
      const e1 = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0 }));
      expect(e1.ok, JSON.stringify(e1)).toBe(true);
      const eigeneIdx = (await studioModell(page)).customWalls.find((w) => w.a.x === 40)?._idx;
      expect(eigeneIdx).toBe(5);
      expect((await page.evaluate(() => /** @type {any} */ (window).bitApi.rueckgaengig())).ok).toBe(true);
      await page.waitForTimeout(2500); // the tab is clean again (nothing pending)
      // another person drew a wall at the same time; its counter also started at stored max + 1 = 5
      const fremde = wand(eigeneIdx, 80, 0);
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: { customWalls: [...ALT_WAENDE, fremde] } })).ok()).toBe(true);
      await expect.poll(async () => (await studioModell(page)).customWalls.map((w) => w.a.x), { timeout: 20000 }).toContain(80);
      await page.waitForTimeout(1500);
      expect((await page.evaluate(() => /** @type {any} */ (window).bitApi.wiederholen())).ok).toBe(true);
      await speichernUndWarten(page); // 115-05c (adapted): the redone wall is written with "Speichern" (before: the autosave)
      await expect.poll(async () => (await gespeichert(request, p.id)).customWalls.map((w) => w.a.x).sort((x, y) => x - y), { timeout: 15000 }).toEqual([0, 0, 40, 80]);
      const rec = await gespeichert(request, p.id);
      expect(rec.customWalls.find((w) => w.a.x === 80), "the other person's wall keeps its number").toEqual(fremde);
      const idx = rec.customWalls.map((w) => w._idx);
      expect(new Set(idx).size, `no number twice: ${JSON.stringify(idx)}`).toBe(idx.length);
      expect((await studioModell(page)).customWalls.map((w) => w.a.x).sort((x, y) => x - y)).toEqual([0, 0, 40, 80]);
      // the next wall drawn takes a number no snapshot and no stored element uses
      const e2 = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 100, z: 0 }, b: { x: 106, z: 0 }, level: 0 }));
      expect(e2.ok, JSON.stringify(e2)).toBe(true);
      const alle = (await studioModell(page)).customWalls.map((w) => w._idx);
      expect(new Set(alle).size, `no number twice after the next wall: ${JSON.stringify(alle)}`).toBe(alle.length);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });
});
