// Headless proof 108-09 (D-EFH-06): a model from a geometry JSON goes through the same write path as a studio save — the record
// the studio loads, GUIDs pinned like the studio pins them, one event of the change stream — and the dry run writes nothing.
// Own neutral projects per test (API), cleaned up in `finally` and at the start (leftovers of an aborted run).
//   1. dry run (no model yet, and a faulty import in modus=anwenden) → the data folder is byte for byte the same before and after,
//      no BimModel and no backup record; then anwenden → 201, exactly one stream event "angelegt" carrying the stored record,
//      walls stored with bauteilGuid(); the studio shows the imported walls, after a reload as well, and changes none of them
//   2. open studio (stream connected) + import: an outdated stand → 409, nothing changed; with the dry run's stand → the studio
//      takes the import over through the stream without mixing old and new walls and writes no element list itself; the undo
//      route puts the old walls back the same way
//   3. open studio with the stream blocked (115-05a 409 way): import, then a wall drawn in the studio → its save meets the 409,
//      merges onto the imported state: stored = imported walls + exactly the one new wall, imported doors kept, no old wall back
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
// 115-05c (D-115-12): model changes are a draft until "Speichern"
import { speichernUndWarten } from "./fixtures/entwurf.js";
import { bauteilGuid } from "../../packages/nova-core/src/lib/bauteil/steckbrief.js";
import { datenOrdner } from "../../server/datenPfad.js";

const API = "/api/entities";
const IMPORT = JSON.parse(fs.readFileSync(path.resolve("tests/unit/fixtures/efh-108-import.json"), "utf8"));
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen"];
/** 22-character IFC GlobalId stand-in. @param {string} s */
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
/** A wall of 6 m along x (metres) far away from the imported house, with its stored GUID. @param {number} i @param {number} x */
const wand = (i, x) => ({ a: { x, z: 30 }, b: { x: x + 6, z: 30 }, level: 0, height: 3, thickness: 0.3, _idx: i, guid: guid(`Modellimport10809W${i}`), status: "neubau" });
const ALT_WAENDE = [wand(1, 30), wand(2, 50)];
const ALT_GUIDS = new Set(ALT_WAENDE.map((w) => w.guid));
/** Geometry key of a wall (start, end, level). @param {any} w */
const lage = (w) => JSON.stringify([w.a, w.b, w.level]);
const IMPORT_LAGEN = IMPORT.customWalls.map(lage).sort();

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

/** SHA-256 of every file below the server's data folder (relative path → hash): the byte-for-byte image of what is stored. */
function ordnerAbbild() {
  const wurzel = datenOrdner();
  /** @type {Record<string, string>} */ const abbild = {};
  /** @param {string} ordner */
  const lesen = (ordner) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) lesen(p);
      else if (e.isFile()) abbild[path.relative(wurzel, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  lesen(wurzel);
  return abbild;
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} name @param {Record<string, any>|null} modell null = no record */
async function projektAnlegen(request, name, modell) {
  for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await aufraeumen(request, alt.id);
  const id = (await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  if (!modell) return { id, bmId: null };
  const leer = Object.fromEntries(LISTEN.map((k) => [k, []]));
  const bm = await (await request.post(`${API}/BimModel`, { data: { project_id: id, ...leer, ...modell } })).json();
  return { id, bmId: bm.id };
}

/** Removes the project, its model records and the import backups. @param {import("@playwright/test").APIRequestContext} request @param {string|null} id */
async function aufraeumen(request, id) {
  if (!id) return;
  for (const e of ["BimModelImport", "BimModel"]) {
    for (const m of await (await request.get(`${API}/${e}?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/${e}/${m.id}`).catch(() => {});
  }
  await request.delete(`${API}/Project/${id}`).catch(() => {});
}

/**
 * POST /api/modell/import (or its undo) as a tool on this computer would send it.
 * @param {import("@playwright/test").APIRequestContext} request @param {string} pfad "import" | "import/zuruecknehmen"
 * @param {Record<string, string>} query @param {any} [body]
 */
async function importieren(request, pfad, query, body = undefined) {
  const r = await request.post(`/api/modell/${pfad}?${new URLSearchParams(query)}`, body === undefined ? {} : { data: body });
  return { status: r.status(), json: await r.json() };
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} id */
const gespeichert = async (request, id) => (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
/** @param {import("@playwright/test").Page} page */
const studioModell = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
/** @param {import("@playwright/test").Page} page */
const abgleich = (page) => page.evaluate(() => /** @type {any} */ (window).__bitAbgleich?.stand() ?? null);
/** Sorted geometry keys of a wall list. @param {any[]} l */
const lagen = (l) => (l || []).map(lage).sort();

/** @param {import("@playwright/test").Page} page @param {string} name */
async function studioOeffnen(page, name) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung) && !!(/** @type {any} */ (window).bitApi), null, { timeout: 90000 });
}

test.describe("108-09 Modell aus Geometrie-JSON: gleicher Schreibweg wie das Studio", () => {
  test.setTimeout(240000);

  test("Probelauf schreibt nichts; Anwenden legt das Modell an, Studio zeigt die Wände nach Neuladen", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Modellimport 10809";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      const warn = wache(page);
      p = await projektAnlegen(request, NAME, null);
      await page.waitForTimeout(1000); // the project's own write is persisted (debounce 120 ms)

      // dry run: nothing is written — compare the data folder byte for byte
      const vorher = ordnerAbbild();
      const probe = await importieren(request, "import", { projekt: p.id, modus: "pruefen" }, IMPORT);
      expect(probe.status, JSON.stringify(probe.json)).toBe(200);
      expect(probe.json).toMatchObject({ ok: true, geschrieben: false, stand: null });
      expect(probe.json.wuerde.anlegen).toBe(true);
      expect(probe.json.wuerde.nachher.customWalls).toBe(3);
      // a faulty import in modus=anwenden is refused before anything is written
      const kaputt = { ...IMPORT, customWindows: [{ ...IMPORT.customWindows[0], wallIdx: 12 }] };
      const abgelehnt = await importieren(request, "import", { projekt: p.id, modus: "anwenden" }, kaputt);
      expect(abgelehnt.status).toBe(422);
      expect(abgelehnt.json.geschrieben).toBe(false);
      expect(abgelehnt.json.fehler.map((f) => f.pfad)).toContain("customWindows[0].wallIdx");
      await page.waitForTimeout(1000); // a write would have been persisted by now
      expect(ordnerAbbild(), "the data folder after the dry run").toEqual(vorher);
      expect(await (await request.get(`${API}/BimModel?project_id=${p.id}`)).json()).toEqual([]);
      expect(await (await request.get(`${API}/BimModelImport?project_id=${p.id}`)).json()).toEqual([]);

      // the change stream of the project, read in the browser like the studio reads it
      await page.goto("/");
      await page.evaluate((pid) => new Promise((ok, fehler) => {
        const w = /** @type {any} */ (window);
        w.__importEreignisse = [];
        const q = new w.EventSource(`/api/aenderungen?projekt=${encodeURIComponent(pid)}`);
        q.addEventListener("aenderung", (e) => w.__importEreignisse.push(JSON.parse(/** @type {MessageEvent} */ (e).data)));
        q.addEventListener("bereit", () => ok(true));
        q.onerror = () => fehler(new Error("stream not open"));
        w.__importStrom = q;
      }), p.id);

      const an = await importieren(request, "import", { projekt: p.id, modus: "anwenden" }, IMPORT);
      expect(an.status, JSON.stringify(an.json)).toBe(201);
      expect(an.json.geschrieben).toBe(true);
      const rec = await gespeichert(request, p.id);
      expect(rec.id).toBe(an.json.bim_model_id);
      expect(an.json.stand).toBe(rec.updated_date);
      expect(lagen(rec.customWalls)).toEqual(IMPORT_LAGEN);
      // GUID pinning: exactly the GlobalId the studio's save pins (bauteilGuid of the project, the list and the element)
      for (const w of rec.customWalls) expect(w.guid, `wall ${w._idx}`).toBe(bauteilGuid(p.id, "customWalls", { _idx: w._idx }));
      for (const z of rec.customZones) expect(z.guid, `zone ${z._idx}`).toBe(bauteilGuid(p.id, "customZones", { _idx: z._idx }));
      expect(rec.footprintQuelle?.art).toBe("gezeichnet");
      const sicherungen = await (await request.get(`${API}/BimModelImport?project_id=${p.id}`)).json();
      expect(sicherungen.map((s) => [s.id, s.bim_model_id, s.vorher])).toEqual([[an.json.sicherung, rec.id, null]]);

      // exactly one event, like the generic route's middleware reports a create
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__importEreignisse.length), { timeout: 10000 }).toBe(1);
      await page.waitForTimeout(1000);
      const ereignisse = await page.evaluate(() => { const w = /** @type {any} */ (window); w.__importStrom.close(); return w.__importEreignisse; });
      expect(ereignisse.length, JSON.stringify(ereignisse).slice(0, 300)).toBe(1);
      expect(ereignisse[0]).toMatchObject({ projekt: p.id, entitaet: "BimModel", id: rec.id, art: "angelegt", updated_date: rec.updated_date });
      if (ereignisse[0].datensatz) expect(ereignisse[0].datensatz.customWalls).toEqual(rec.customWalls);

      // the studio shows the imported walls — and after a reload as well; it changes none of them
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      const guids = rec.customWalls.map((w) => w.guid).sort();
      await expect.poll(async () => ((await studioModell(page)).customWalls || []).map((w) => w.guid).sort(), { timeout: 30000 }).toEqual(guids);
      expect(lagen((await studioModell(page)).customWalls)).toEqual(IMPORT_LAGEN);
      await page.reload();
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung), null, { timeout: 90000 });
      await expect.poll(async () => ((await studioModell(page)).customWalls || []).map((w) => w.guid).sort(), { timeout: 30000 }).toEqual(guids);
      expect(((await studioModell(page)).customWindows || []).map((o) => o._idx).sort()).toEqual([4, 5]);
      await page.waitForTimeout(3000); // autosave window 1.2 s
      const danach = await gespeichert(request, p.id);
      expect(danach.customWalls, "the studio left the imported walls as they were").toEqual(rec.customWalls);
      expect(danach.customZones).toEqual(rec.customZones);
      const wandSchreiben = schreiben.filter((s) => s.body && "customWalls" in s.body && JSON.stringify(s.body.customWalls) !== JSON.stringify(rec.customWalls));
      expect(wandSchreiben, "the browser wrote other walls").toEqual([]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Offenes Studio: Import kommt über den Strom, veralteter Stand wird abgelehnt, Rücknahme ebenso", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Modellimport 10809 Strom";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      // the deliberate 409 answers of the API calls below are not the browser's; nothing else may be logged
      const warn = wache(page);
      p = await projektAnlegen(request, NAME, { customWalls: ALT_WAENDE });
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      await expect.poll(async () => lagen((await studioModell(page)).customWalls), { timeout: 30000 }).toEqual(lagen(ALT_WAENDE));
      await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      await page.waitForTimeout(1500);

      const probe = await importieren(request, "import", { projekt: p.id, modus: "pruefen" }, IMPORT);
      expect(probe.json.ok).toBe(true);
      expect(probe.json.wuerde.anlegen).toBe(false);
      const stand = probe.json.stand;
      expect(stand).toBe((await gespeichert(request, p.id)).updated_date);

      // no stand / an outdated stand → 409, nothing changes
      const ohne = await importieren(request, "import", { projekt: p.id, modus: "anwenden" }, IMPORT);
      expect(ohne.status).toBe(409);
      const alt = await importieren(request, "import", { projekt: p.id, modus: "anwenden", stand: "2000-01-01T00:00:00.000Z" }, IMPORT);
      expect(alt.status).toBe(409);
      expect(alt.json.konflikt).toBe(true);
      const unveraendert = await gespeichert(request, p.id);
      expect(unveraendert.customWalls).toEqual(ALT_WAENDE);
      expect(unveraendert.updated_date).toBe(stand);

      const an = await importieren(request, "import", { projekt: p.id, modus: "anwenden", stand }, IMPORT);
      expect(an.status, JSON.stringify(an.json)).toBe(200);
      const rec = await gespeichert(request, p.id);
      expect(lagen(rec.customWalls)).toEqual(IMPORT_LAGEN);
      // the open studio takes the import over through the stream: the imported walls, none of the old ones
      await expect.poll(async () => lagen((await studioModell(page)).customWalls), { timeout: 20000 }).toEqual(IMPORT_LAGEN);
      await page.waitForTimeout(3000); // autosave 1.2 s + stream
      const nach = await gespeichert(request, p.id);
      expect(nach.customWalls, "stored walls = the import").toEqual(rec.customWalls);
      expect(nach.customWindows).toEqual(rec.customWindows);
      expect(nach.customWalls.some((w) => ALT_GUIDS.has(w.guid)), "no old wall came back").toBe(false);
      const listenSchreiben = schreiben.filter((s) => s.body && LISTEN.some((k) => k in s.body));
      expect(listenSchreiben, `the browser wrote element lists: ${JSON.stringify(listenSchreiben).slice(0, 400)}`).toEqual([]);

      // the undo route (same write path): the old walls come back to the stored record and to the open studio
      const zp = await importieren(request, "import/zuruecknehmen", { projekt: p.id, id: an.json.sicherung, modus: "pruefen" });
      expect(zp.status).toBe(200);
      const zurueck = await importieren(request, "import/zuruecknehmen", { projekt: p.id, id: an.json.sicherung, modus: "anwenden", stand: zp.json.stand });
      expect(zurueck.status, JSON.stringify(zurueck.json)).toBe(200);
      expect((await gespeichert(request, p.id)).customWalls).toEqual(ALT_WAENDE);
      await expect.poll(async () => lagen((await studioModell(page)).customWalls), { timeout: 20000 }).toEqual(lagen(ALT_WAENDE));
      await page.waitForTimeout(3000);
      expect((await gespeichert(request, p.id)).customWalls).toEqual(ALT_WAENDE);
      expect(schreiben.filter((s) => s.body && LISTEN.some((k) => k in s.body)), "still no element list written by the browser").toEqual([]);
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(request, p.id);
    }
  });

  test("Offenes Studio ohne Strom: eigene Wand nach dem Import trifft den 409-Weg und mischt nicht", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Modellimport 10809 409";
    let p = { id: null, bmId: null };
    try {
      await nurLocalhost(page);
      await page.route("**/api/aenderungen**", (r) => r.abort()); // the change stream never connects: only the 409 tells
      const warn = wache(page, /\/api\/aenderungen|EventSource|status of 409/);
      p = await projektAnlegen(request, NAME, { customWalls: ALT_WAENDE });
      const schreiben = mitschnitt(page);
      await studioOeffnen(page, NAME);
      await expect.poll(async () => lagen((await studioModell(page)).customWalls), { timeout: 30000 }).toEqual(lagen(ALT_WAENDE));
      await page.waitForTimeout(1500);

      const probe = await importieren(request, "import", { projekt: p.id, modus: "pruefen" }, IMPORT);
      const an = await importieren(request, "import", { projekt: p.id, modus: "anwenden", stand: probe.json.stand }, IMPORT);
      expect(an.status, JSON.stringify(an.json)).toBe(200);
      const rec = await gespeichert(request, p.id);

      // a wall drawn in the studio that still holds the old state
      const neu = await page.evaluate(() => /** @type {any} */ (window).bitApi.wand({ a: { x: 40, z: 0 }, b: { x: 46, z: 0 }, level: 0, thickness_m: 0.24 }));
      expect(neu.ok, JSON.stringify(neu)).toBe(true);
      // 115-05c (adapted): "Speichern" reads the stored (imported) state first (K3) and merges it, then writes (before: the autosave → 409)
      await speichernUndWarten(page);
      await expect.poll(async () => (await gespeichert(request, p.id)).customWalls.length, { timeout: 20000 }).toBe(rec.customWalls.length + 1);

      const nach = await gespeichert(request, p.id);
      for (const w of rec.customWalls) expect(nach.customWalls.find((x) => x.guid === w.guid), `imported wall ${w._idx}`).toEqual(w);
      const eigene = nach.customWalls.filter((w) => w.a.x === 40 && w.b.x === 46);
      expect(eigene.length, "exactly one new wall").toBe(1);
      expect(nach.customWalls.some((w) => ALT_GUIDS.has(w.guid)), "no old wall came back").toBe(false);
      expect(nach.customWindows, "imported doors kept").toEqual(rec.customWindows);
      expect(nach.customZones, "imported rooms kept").toEqual(rec.customZones);
      for (const k of LISTEN) {
        const idx = (nach[k] || []).map((e) => e._idx);
        expect(new Set(idx).size, `no _idx twice in ${k}`).toBe(idx.length);
      }
      // 115-05c (adapted): the stored state is read before the write, so NO browser write (accepted or refused) may carry an old
      // wall - stricter than the 409 check before (only accepted writes)
      const altGeschrieben = schreiben.filter((s) => (s.body?.customWalls || []).some((w) => ALT_GUIDS.has(w.guid)));
      expect(altGeschrieben, `a browser PUT carried old walls: ${JSON.stringify(altGeschrieben).slice(0, 400)}`).toEqual([]);
      // the studio now shows the import plus its own wall
      await expect.poll(async () => lagen((await studioModell(page)).customWalls), { timeout: 20000 }).toEqual(lagen(nach.customWalls));
      expect(warn, `Konsole: ${warn.join(" | ")}`).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await aufraeumen(request, p.id);
    }
  });
});
