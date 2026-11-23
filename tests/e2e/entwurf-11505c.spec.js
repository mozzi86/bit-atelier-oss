// Headless proof 115-05c (D-115-12): changes to the building model are a DRAFT until "Speichern" - kept in this browser per person
// and project, written only by "Speichern" through the stand protection of 115-05a/b; on any conflict the person's unsaved work
// stays recoverable. Own neutral projects per test (API), cleaned up in `finally`; the stored record is read back over the API.
//   1. a drawn wall: no BimModel write with draft fields for 3 s, state "Nicht gespeichert · 1 Änderungen"; Speichern → stored,
//      local copy gone
//   2. unsaved + reload → restored from the browser (banner) → Speichern stores it
//   3. unsaved + another writer's save + reload → both walls after Speichern, nothing old, nothing twice
//   4. the same wall changed here and by another writer → conflict card, the other writer's wall stays stored, the own version
//      stays in the draft (local copy kept); "Meine Fassung" + Speichern writes it
//   5. Verwerfen → the stored state comes back, nothing written, local copy gone
//   6. project switch with unsaved changes → the dialog; "Als Entwurf behalten" → B opens, A unchanged; back to A → restored
//   7. a draft of person X is not offered to person Y on the same browser
//   8. a stored draft whose record was replaced (other id) → not continued, banner, nothing written, the draft stays
//   9. a corrupted local entry → the stored model opens, nothing written, the bar reports the unreadable entry
//  10. local store full (localStorage and IndexedDB refuse) → reported in the bar (the alarm opens the panel), never swallowed; a
//      press outside closes the panel
//  11. Strg+S inside a text field saves
//  12. two presses of "Speichern" while one save is on its way → one write
//  13. Strg+Z after "Speichern" makes the model unsaved again; the stored record keeps the wall until the next Speichern
//  14. two tabs of one browser on one project: the second is locked, "Hier übernehmen" moves the project to it
//  15. program fields (storeys) are a draft as well: nothing written before "Speichern", restored after a reload
//  16. the browser's back button with unsaved changes asks; "Abbrechen" stays, "Als Entwurf behalten" leaves, the draft stays
//  17. the bar says what is saved at once (no draft) - in the notes panel (ⓘ), not in the header line
//  18. the bar is ONE line: the header keeps its height and the bar its width from "Gespeichert" to "Nicht gespeichert" and with a
//      note (restored draft: a dot on the chip, the panel only from the chip), at 1400 px and at 1024 px; the panel lies over the
//      page, it does not push the header
//  19. programmatic navigation (command palette → navigate()) is not asked - and nothing is lost: nothing written, the draft stays
//      in the page and in the browser, back in the designer (palette again, no reload) the wall is there, "Speichern" stores it
//  20. a download (IFC export) is no leaving; an in-app link (sidebar) asks: "Abbrechen" stays on the page, "Als Entwurf behalten" follows the link, nothing written; closing
//      the tab with unsaved changes raises the browser's leave question (beforeunload); clean, it does not
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen"];
const ELEMENT = new Set(LISTEN);
/** 22-character IFC GlobalId stand-in. @param {string} s */
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
/** A wall of 6 m along x (metres). @param {number} i @param {number} x @param {number} z */
const wand = (i, x, z) => ({ a: { x, z }, b: { x: x + 6, z }, level: 0, height: 3, thickness: 0.3, _idx: i, guid: guid(`Entwurf11505cW${i}x${x}`), status: "neubau" });

/** @param {import("@playwright/test").Page} page @param {RegExp|null} [auch] */
function wache(page, auch = null) {
  /** @type {string[]} */ const w = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text()) && !(auch && auch.test(m.text()))) w.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) w.push(`pageerror ${e}`); });
  return w;
}

/** Browser writes on BimModel that carry draft fields (element lists). @param {import("@playwright/test").Page} page */
function entwurfsSchreiben(page) {
  /** @type {Array<{url: string, felder: string[]}>} */ const s = [];
  page.on("request", (r) => {
    if ((r.method() === "PUT" || r.method() === "POST") && /\/api\/entities\/BimModel/.test(r.url())) {
      let body = null;
      try { body = r.postDataJSON(); } catch { /* none */ }
      const felder = Object.keys(body || {}).filter((k) => ELEMENT.has(k));
      if (felder.length) s.push({ url: r.url(), felder });
    }
  });
  return s;
}

/** @param {import("@playwright/test").APIRequestContext} request @param {string} name @param {Record<string, any>} modell */
async function projektMitModell(request, name, modell) {
  for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await aufraeumen(request, alt.id);
  const id = (await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const leer = Object.fromEntries(LISTEN.map((k) => [k, []]));
  const bm = await (await request.post(`${API}/BimModel`, { data: { project_id: id, ...leer, werkstatt_layer: { nordwinkel: null }, ...modell } })).json();
  return { id, bmId: bm.id };
}
/** @param {import("@playwright/test").APIRequestContext} request @param {string|null} id */
async function aufraeumen(request, id) {
  if (!id) return;
  for (const m of await (await request.get(`${API}/BimModel?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/BimModel/${m.id}`).catch(() => {});
  for (const m of await (await request.get(`${API}/BuildingComplex?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/BuildingComplex/${m.id}`).catch(() => {});
  await request.delete(`${API}/Project/${id}`).catch(() => {});
}
/** @param {import("@playwright/test").APIRequestContext} request @param {string} id */
const gespeichert = async (request, id) => (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
/** @param {import("@playwright/test").Page} page */
const studioModell = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
/** @param {import("@playwright/test").Page} page */
const xs = async (page) => (await studioModell(page)).customWalls.map((/** @type {any} */ w) => w.a.x).sort((a, b) => a - b);
/** @param {any} rec */
const gx = (rec) => (rec?.customWalls || []).map((/** @type {any} */ w) => w.a.x).sort((a, b) => a - b);
/** the local draft entries of this browser @param {import("@playwright/test").Page} page */
const lokaleEntwuerfe = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("bit-modell-entwurf:")));
/** @param {import("@playwright/test").Page} page @param {number} x */
const zeichnen = (page, x) => page.evaluate((xx) => /** @type {any} */ (window).bitApi.wand({ a: { x: xx, z: 0 }, b: { x: xx + 6, z: 0 }, level: 0 }), x);

/** @param {import("@playwright/test").Page} page @param {string} name */
async function studioOeffnen(page, name) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung) && !!(/** @type {any} */ (window).bitApi), null, { timeout: 90000 });
  await expect(page.getByTestId("entwurf-leiste")).toBeVisible({ timeout: 30000 });
  // the model (and a draft of it) is on screen - an edit before that would be replaced by the load
  await expect(page.getByTestId("bim-speicher")).not.toHaveAttribute("data-zustand", "loading", { timeout: 30000 });
  // ... and the studio's 50 ms load guard is over: an edit inside it makes no undo step (test 13 was red 4 of 5 times without this)
  await expect(page.getByTestId("bim-speicher")).toHaveAttribute("data-bereit", "1", { timeout: 30000 });
}
/** @param {import("@playwright/test").Page} page */
const status = (page) => page.getByTestId("entwurf-status");
/** "Verwerfen" sits in the panel of the status chip (one-line bar). @param {import("@playwright/test").Page} page */
async function verwerfen(page) {
  if (!(await page.getByTestId("entwurf-hinweise").isVisible())) await status(page).click();
  await page.getByTestId("entwurf-verwerfen").click();
  await page.getByTestId("entwurf-verwerfen-ja").click();
}
/** @param {import("@playwright/test").Page} page */
async function speichern(page) {
  await page.getByTestId("entwurf-speichern").click();
  await expect(status(page)).toHaveAttribute("data-zustand", /gespeichert|teilweise|konflikt|fehler/, { timeout: 30000 });
}

test.describe("115-05c Entwurfsmodus: erst „Speichern“ übernimmt", () => {
  test.setTimeout(240000);
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    // leaving with unsaved changes asks (beforeunload); the person confirms - the draft stays in the browser
    page.on("dialog", (d) => { void d.accept(); });
  });

  test("1. Wand zeichnen → nichts geschrieben; Speichern → gespeichert, lokale Kopie weg", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Eins";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const s = entwurfsSchreiben(page);
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await expect(status(page)).toContainText("1");
      await page.waitForTimeout(3000);
      expect(s, "no write with draft fields before Speichern").toEqual([]);
      expect(gx(await gespeichert(request, p.id))).toEqual([0]);
      expect(await lokaleEntwuerfe(page), "local copy after 800 ms").toHaveLength(1);
      await speichern(page);
      await expect(status(page)).toHaveAttribute("data-zustand", "gespeichert");
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toEqual([]);
      await expect(page.getByTestId("bim-speicher")).toHaveAttribute("data-zustand", "saved");
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("2. ungespeichert + Neuladen → wiederhergestellt → Speichern", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Zwei";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      await studioOeffnen(page, NAME);
      await expect.poll(() => xs(page), { timeout: 20000 }).toEqual([0, 40]);
      // information only: the chip carries the dot, the panel (opened from the chip) says it
      await expect(page.getByTestId("entwurf-hinweis-punkt")).toBeVisible();
      await expect(page.getByTestId("entwurf-hinweise")).toHaveCount(0);
      await status(page).click();
      await expect(page.getByTestId("entwurf-wiederhergestellt")).toBeVisible();
      expect(gx(await gespeichert(request, p.id)), "the reload wrote nothing").toEqual([0]);
      await speichern(page);
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("3. ungespeichert + fremdes Speichern + Neuladen → beide Wände, nichts doppelt", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Drei";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      await page.goto("about:blank");
      // another writer adds a wall with the number the draft's wall got as well
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: { customWalls: [wand(1, 0, 0), wand(2, 80, 0)] } })).ok()).toBe(true);
      await studioOeffnen(page, NAME);
      await expect.poll(() => xs(page), { timeout: 20000 }).toEqual([0, 40, 80]);
      await speichern(page);
      const rec = await gespeichert(request, p.id);
      expect(gx(rec)).toEqual([0, 40, 80]);
      const idx = rec.customWalls.map((/** @type {any} */ w) => w._idx);
      expect(new Set(idx).size, `no number twice ${JSON.stringify(idx)}`).toBe(idx.length);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("4. dieselbe Wand hier und fremd geändert → Karte, Fremdes bleibt gespeichert, Eigenes im Entwurf", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Vier";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page, /status of 409/);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await page.route("**/api/aenderungen**", (r) => r.abort()); // no stream: the stored change is met at "Speichern"
      await studioOeffnen(page, NAME);
      // own change of wall 1 (thickness 0.5 m) - in the draft only
      const r = await page.evaluate(() => /** @type {any} */ (window).bitApi.aendern({ art: "wall", id: 1, patch: { thickness: 0.5 } }));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      expect((await request.put(`${API}/BimModel/${p.bmId}`, { data: { customWalls: [{ ...wand(1, 0, 0), thickness: 0.2 }] } })).ok()).toBe(true);
      await speichern(page);
      await expect(status(page)).toHaveAttribute("data-zustand", "konflikt");
      expect((await gespeichert(request, p.id)).customWalls[0].thickness).toBe(0.2);
      expect(await lokaleEntwuerfe(page), "the own version stays recoverable").toHaveLength(1);
      expect((await studioModell(page)).customWalls[0].thickness, "mine on screen until decided").toBe(0.5);
      // "Meine Fassung" → into the draft, "Speichern" writes it on the current stand
      await page.getByRole("button", { name: /Meine Fassung/ }).first().click();
      await speichern(page);
      await expect(status(page)).toHaveAttribute("data-zustand", "gespeichert");
      expect((await gespeichert(request, p.id)).customWalls[0].thickness).toBe(0.5);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("5. Verwerfen → gespeicherter Stand zurück, nichts geschrieben, lokale Kopie weg", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Fuenf";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const s = entwurfsSchreiben(page);
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      await verwerfen(page);
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0]);
      await expect(status(page)).toHaveAttribute("data-sauber", "1");
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toEqual([]);
      await page.waitForTimeout(1500);
      expect(s).toEqual([]);
      expect(gx(await gespeichert(request, p.id))).toEqual([0]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("6. Projektwechsel mit Ungespeichertem fragt; „Als Entwurf behalten“ → A unverändert, zurück → wiederhergestellt", async ({ page, request }) => {
    const NAME_A = "E2E Entwurf 11505c Sechs A", NAME_B = "E2E Entwurf 11505c Sechs B";
    let a = { id: null, bmId: null }, b = { id: null, bmId: null };
    try {
      const warn = wache(page);
      a = await projektMitModell(request, NAME_A, { customWalls: [wand(1, 0, 0)] });
      b = await projektMitModell(request, NAME_B, { customWalls: [wand(1, 100, 0)] });
      await studioOeffnen(page, NAME_A);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
      await page.getByRole("option", { name: NAME_B, exact: true }).click();
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible();
      expect(await xs(page), "still A until the decision").toEqual([0, 40]);
      await page.getByRole("button", { name: "Als Entwurf behalten" }).click();
      await expect.poll(() => xs(page), { timeout: 20000 }).toEqual([100]);
      expect(gx(await gespeichert(request, a.id))).toEqual([0]);
      await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
      await page.getByRole("option", { name: NAME_A, exact: true }).click();
      await expect.poll(() => xs(page), { timeout: 20000 }).toEqual([0, 40]);
      expect(gx(await gespeichert(request, a.id))).toEqual([0]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, a.id); await aufraeumen(request, b.id); }
  });

  test("7. Entwurf von Person X wird Person Y im selben Browser nicht angeboten", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Sieben";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      const [schluesselX] = await lokaleEntwuerfe(page);
      await page.route("**/api/auth/me", (r) => r.fulfill({ json: { id: "testperson-y-11505c", email: "y@example.invalid", full_name: "Testperson Y", role: "admin" } }));
      await studioOeffnen(page, NAME);
      await page.waitForTimeout(1500);
      expect(await xs(page), "Y sees the stored model only").toEqual([0]);
      await expect(status(page)).toHaveAttribute("data-sauber", "1");
      expect(await lokaleEntwuerfe(page), "X's draft stays for X").toEqual([schluesselX]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("8. Entwurf zu einem ersetzten Modell → nicht fortgesetzt, nichts geschrieben, Entwurf bleibt", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Acht";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const s = entwurfsSchreiben(page);
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      await page.goto("about:blank");
      await request.delete(`${API}/BimModel/${p.bmId}`);
      const leer = Object.fromEntries(LISTEN.map((k) => [k, []]));
      await request.post(`${API}/BimModel`, { data: { project_id: p.id, ...leer, werkstatt_layer: { nordwinkel: null }, customWalls: [wand(1, 200, 0)] } });
      await studioOeffnen(page, NAME);
      await expect(page.getByTestId("entwurf-offen")).toBeVisible({ timeout: 20000 });
      expect(await xs(page)).toEqual([200]);
      await page.waitForTimeout(1500);
      expect(s).toEqual([]);
      expect(await lokaleEntwuerfe(page)).toHaveLength(1);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("9. kaputter lokaler Eintrag → gespeichertes Modell öffnet, nichts geschrieben", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Neun";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const me = await (await request.get("/api/auth/me")).json();
      await page.addInitScript(([k]) => { try { localStorage.setItem(k, "{kaputt"); } catch { /* none */ } }, [`bit-modell-entwurf:${encodeURIComponent(me.id ?? me.email)}:${encodeURIComponent(p.id)}`]);
      const s = entwurfsSchreiben(page);
      await studioOeffnen(page, NAME);
      await expect.poll(() => xs(page), { timeout: 20000 }).toEqual([0]);
      await expect(status(page)).toHaveAttribute("data-sauber", "1");
      // reported, not swallowed (the panel opens by itself)
      await expect(page.getByTestId("entwurf-lesefehler")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("entwurf-lesefehler")).toContainText("beschädigt");
      await page.waitForTimeout(1500);
      expect(s).toEqual([]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("10. lokaler Speicher voll → in der Leiste gemeldet", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Zehn";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page, /lokale Sicherung fehlgeschlagen/);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await page.addInitScript(() => {
        const S = /** @type {any} */ (window).Storage;
        const orig = S.prototype.setItem;
        S.prototype.setItem = function (/** @type {string} */ k, /** @type {string} */ v) {
          if (String(k).startsWith("bit-modell-entwurf:")) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
          return orig.call(this, k, v);
        };
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (/** @type {string} */ n, /** @type {any} */ v) => { if (n === "bit-atelier-modellentwurf") throw new Error("IndexedDB voll"); return open(n, v); };
      });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(page.getByTestId("entwurf-sicherung")).toBeVisible({ timeout: 10000 });
      // an alarm opens the panel by itself; a press outside closes it (it never traps the page), the dot stays
      await page.locator("h1").first().click();
      await expect(page.getByTestId("entwurf-hinweise")).toHaveCount(0);
      await expect(page.getByTestId("entwurf-hinweis-punkt")).toBeVisible();
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("11. Strg+S im Textfeld speichert", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Elf";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await page.evaluate(() => { const i = document.createElement("input"); i.id = "probe-11505c"; document.body.appendChild(i); i.focus(); });
      await page.keyboard.press("Control+s");
      await expect(status(page)).toHaveAttribute("data-zustand", "gespeichert", { timeout: 20000 });
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("12. zweimal Speichern während ein Speichern unterwegs ist → ein Schreiben", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Zwoelf";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const s = entwurfsSchreiben(page);
      await page.route("**/api/entities/BimModel/**", async (r) => {
        if (r.request().method() === "PUT") await new Promise((res) => setTimeout(res, 800));
        await r.continue();
      });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await page.evaluate(() => /** @type {any} */ (document.querySelector("[data-testid=entwurf-speichern]")).click());
      await page.keyboard.press("Control+s");
      await expect(status(page)).toHaveAttribute("data-zustand", "gespeichert", { timeout: 20000 });
      expect(s.length, JSON.stringify(s)).toBe(1);
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("13. Strg+Z nach Speichern macht das Modell wieder ungespeichert", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Dreizehn";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await speichern(page);
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      // the studio's undo (the same path as Strg+Z; the key depends on where the focus is)
      expect((await page.evaluate(() => /** @type {any} */ (window).bitApi.rueckgaengig())).ok).toBe(true);
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0]);
      await expect(status(page)).toHaveAttribute("data-sauber", "0");
      await page.waitForTimeout(1500);
      expect(gx(await gespeichert(request, p.id)), "stored until the next Speichern").toEqual([0, 40]);
      await speichern(page);
      expect(gx(await gespeichert(request, p.id))).toEqual([0]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("14. zwei Tabs eines Browsers: der zweite ist gesperrt, „Hier übernehmen“ wechselt", async ({ page, request, context }) => {
    const NAME = "E2E Entwurf 11505c Vierzehn";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      const zwei = await context.newPage();
      await nurLocalhost(zwei);
      await zwei.setViewportSize({ width: 1400, height: 1000 });
      await studioOeffnen(zwei, NAME);
      await expect(zwei.getByTestId("entwurf-anderer-tab")).toBeVisible({ timeout: 20000 });
      await zwei.getByTestId("entwurf-uebernehmen").click();
      await expect(page.getByTestId("entwurf-anderer-tab")).toBeVisible({ timeout: 20000 });
      await zwei.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung), null, { timeout: 90000 });
      await expect.poll(() => xs(zwei), { timeout: 20000 }).toEqual([0, 40]);
      await expect(zwei.getByTestId("entwurf-anderer-tab")).toHaveCount(0);
      await zwei.getByTestId("entwurf-speichern").click();
      await expect(zwei.getByTestId("entwurf-status")).toHaveAttribute("data-zustand", "gespeichert", { timeout: 20000 });
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      await zwei.close();
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("15. Programmfelder (Geschosse) sind Entwurf: nichts geschrieben, nach Neuladen wieder da, Speichern schreibt", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Fuenfzehn";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)], storeys: 2, storeyHeight: 3 });
      /** @type {string[]} */ const programm = [];
      page.on("request", (r) => {
        if (r.method() !== "PUT" || !/\/api\/entities\/BimModel/.test(r.url())) return;
        try { if ("storeys" in (r.postDataJSON() || {})) programm.push(r.url()); } catch { /* none */ }
      });
      await studioOeffnen(page, NAME);
      await page.evaluate(() => /** @type {any} */ (window).bitApi.geschosseSetzen(3));
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await page.waitForTimeout(3000);
      expect(programm, "no write of the storeys before Speichern").toEqual([]);
      expect((await gespeichert(request, p.id)).storeys).toBe(2);
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      await studioOeffnen(page, NAME);
      await expect(status(page), "the storeys came back from the browser").toHaveAttribute("data-sauber", "0", { timeout: 20000 });
      expect((await gespeichert(request, p.id)).storeys, "the reload wrote nothing").toBe(2);
      await speichern(page);
      await expect(status(page)).toHaveAttribute("data-zustand", "gespeichert");
      expect((await gespeichert(request, p.id)).storeys).toBe(3);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("16. Zurück-Knopf mit Ungespeichertem fragt; Abbrechen bleibt, „Als Entwurf behalten“ geht, Entwurf bleibt", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Sechzehn";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await page.goto("/Dashboard");
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await page.waitForTimeout(500); // the guard entry of the back button is set
      await page.goBack();
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible({ timeout: 10000 });
      await page.getByTestId("entwurf-verlassen").getByRole("button", { name: "Abbrechen" }).click();
      await expect(page).toHaveURL(/ComplexDesigner/);
      expect(await xs(page), "still the designer with the draft").toEqual([0, 40]);
      await page.goBack();
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "Als Entwurf behalten" }).click();
      await expect(page).not.toHaveURL(/ComplexDesigner/, { timeout: 10000 });
      expect(gx(await gespeichert(request, p.id)), "nothing written").toEqual([0]);
      expect(await lokaleEntwuerfe(page), "the draft stays in the browser").toHaveLength(1);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("17. die Leiste sagt, was sofort gespeichert wird", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Siebzehn";
    let p = { id: null, bmId: null };
    try {
      p = await projektMitModell(request, NAME, {});
      await studioOeffnen(page, NAME);
      await expect(page.getByTestId("entwurf-sofort")).toHaveCount(0); // closed: nothing in the header line
      await status(page).click(); // the chip opens the panel
      await expect(page.getByTestId("entwurf-sofort")).toContainText("Massing-Körper");
      await expect(page.getByTestId("entwurf-sofort")).toContainText("erst mit „Speichern“");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("entwurf-sofort")).toHaveCount(0);
    } finally { await aufraeumen(request, p.id); }
  });

  test("18. die Leiste bleibt einzeilig: Kopfzeile springt nicht (gespeichert, ungespeichert, mit Hinweis; 1400 und 1024 px)", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Achtzehn";
    let p = { id: null, bmId: null };
    try {
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      /** height of the first header line, height and width of the bar, the bar's top (pixels) */
      const mass = () => page.evaluate(() => {
        const leiste = /** @type {HTMLElement} */ (document.querySelector('[data-testid="entwurf-leiste"]'));
        const zeile = /** @type {HTMLElement} */ (leiste.parentElement);
        const l = leiste.getBoundingClientRect();
        return { zeile: Math.round(zeile.getBoundingClientRect().height), hoehe: Math.round(l.height), breite: Math.round(l.width), oben: Math.round(l.top) };
      });
      for (const breite of [1400, 1024]) {
        await page.setViewportSize({ width: breite, height: 1000 });
        await studioOeffnen(page, NAME);
        await expect(status(page)).toHaveAttribute("data-sauber", "1");
        const sauber = await mass();
        expect(sauber.hoehe, `bar one line at ${breite} px`).toBeLessThanOrEqual(40);
        await zeichnen(page, 40);
        await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
        expect(await mass(), `unsaved at ${breite} px`).toEqual(sauber);
        // a note (restored after a reload): the dot on the chip; the panel (from the chip) lies over the page, the header stays
        await page.waitForTimeout(1200); // the local copy (800 ms)
        await page.reload();
        await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung), null, { timeout: 90000 });
        await expect(page.getByTestId("entwurf-hinweis-punkt")).toBeVisible({ timeout: 20000 });
        await status(page).click();
        await expect(page.getByTestId("entwurf-wiederhergestellt")).toBeVisible();
        expect(await mass(), `with a note at ${breite} px`).toEqual(sauber);
        const panel = await page.getByTestId("entwurf-hinweise").evaluate((el) => getComputedStyle(el).position);
        expect(panel).toBe("absolute");
        await page.getByTestId("entwurf-hinweise-zu").click();
        await expect(page.getByTestId("entwurf-hinweise")).toHaveCount(0);
        await verwerfen(page);
        await expect(status(page)).toHaveAttribute("data-sauber", "1", { timeout: 10000 });
        expect(await mass(), `discarded at ${breite} px`).toEqual(sauber);
      }
      expect(gx(await gespeichert(request, p.id))).toEqual([0]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("19. Wechsel über die Befehlspalette (navigate) fragt nicht — und nichts geht verloren", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Neunzehn";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const s = entwurfsSchreiben(page);
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      await expect.poll(() => lokaleEntwuerfe(page), { timeout: 5000 }).toHaveLength(1);
      /** @param {string} wort @param {RegExp} url */
      const springen = async (wort, url) => {
        await page.locator("h1").first().click(); // focus out of the drawing surface (its keys are its own)
        await page.keyboard.press("Control+k");
        const palette = page.getByTestId("befehlspalette");
        await expect(palette.locator("input")).toBeFocused();
        await page.keyboard.type(wort);
        await palette.getByTestId("palette-gruppe-Module").getByTestId("palette-eintrag").filter({ hasText: new RegExp(`^${wort}`) }).first().click();
        await expect(page).toHaveURL(url, { timeout: 20000 });
      };
      await springen("Projekte", /\/Projects/);
      await expect(page.getByTestId("entwurf-verlassen")).toHaveCount(0); // not asked (no data router, see SUMMARY)
      await page.waitForTimeout(1500);
      expect(s, "nothing written by leaving").toEqual([]);
      expect(gx(await gespeichert(request, p.id))).toEqual([0]);
      expect(await lokaleEntwuerfe(page), "the draft stays in the browser").toHaveLength(1);
      // back without a reload: the page's draft comes back on the stored model
      await springen("Komplex-Designer", /\/ComplexDesigner/);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 30000 }); // the bar knows the draft on every tab
      await page.getByRole("button", { name: "3 · Gebäude" }).click(); // the building model (the module opens on the site tab)
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung), null, { timeout: 90000 });
      await expect(page.getByTestId("bim-speicher")).toHaveAttribute("data-bereit", "1", { timeout: 30000 });
      await expect.poll(() => xs(page), { timeout: 20000 }).toEqual([0, 40]);
      await expect(status(page)).toHaveAttribute("data-sauber", "0");
      await speichern(page);
      expect(gx(await gespeichert(request, p.id))).toEqual([0, 40]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  test("20. In-App-Link fragt (Abbrechen bleibt, „Als Entwurf behalten“ geht), Schließen des Tabs fragt der Browser", async ({ page, request, context }) => {
    const NAME = "E2E Entwurf 11505c Zwanzig";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      const s = entwurfsSchreiben(page);
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await expect(status(page)).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
      // a download (IFC export of the unsaved model: a blob link clicked by code) is no leaving - no question, nothing stored
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
      expect(dl.suggestedFilename()).toMatch(/\.ifc$/);
      await expect(page.getByTestId("entwurf-verlassen")).toHaveCount(0);
      const link = page.getByRole("navigation").getByRole("link", { name: "Projekte", exact: true }).first();
      await link.click();
      await expect(page.getByTestId("entwurf-verlassen")).toBeVisible();
      await page.getByTestId("entwurf-verlassen").getByRole("button", { name: "Abbrechen" }).click();
      await expect(page).toHaveURL(/\/ComplexDesigner/);
      expect(await xs(page)).toEqual([0, 40]);
      await link.click();
      await page.getByTestId("entwurf-verlassen").getByRole("button", { name: "Als Entwurf behalten" }).click();
      await expect(page).toHaveURL(/\/Projects/, { timeout: 20000 });
      await page.waitForTimeout(1000);
      expect(s).toEqual([]);
      expect(gx(await gespeichert(request, p.id))).toEqual([0]);
      expect(await lokaleEntwuerfe(page)).toHaveLength(1);

      // beforeunload: a second page of the same browser (the first is left on another route) - unsaved → the browser asks
      const zweite = await context.newPage();
      await nurLocalhost(zweite);
      /** @type {string[]} */ const fragen = [];
      zweite.on("dialog", (d) => { fragen.push(d.type()); void d.dismiss(); });
      await page.close(); // the first tab gives the project free (K10)
      await studioOeffnen(zweite, NAME);
      await expect(status(zweite)).toHaveAttribute("data-sauber", "0", { timeout: 20000 }); // restored draft
      await zweite.locator("h1").first().click(); // a user gesture: browsers ask on leaving only after one
      await zweite.close({ runBeforeUnload: true });
      await expect.poll(() => fragen, { timeout: 5000 }).toEqual(["beforeunload"]);
      expect(zweite.isClosed(), "dismissed: the tab stays").toBe(false);
      await verwerfen(zweite);
      await expect(status(zweite)).toHaveAttribute("data-sauber", "1", { timeout: 10000 });
      await zweite.close({ runBeforeUnload: true });
      await expect.poll(() => zweite.isClosed(), { timeout: 5000 }).toBe(true);
      expect(fragen, "clean: no question").toEqual(["beforeunload"]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });

  // 115-05d (C-2): the designer unmounts the tab that is not shown; the drawing undo is put away and comes back with the tab
  test("21. Reiterwechsel: Rückgängig und Wiederholen gehen danach weiter (115-05d)", async ({ page, request }) => {
    const NAME = "E2E Entwurf 11505c Einundzwanzig";
    let p = { id: null, bmId: null };
    try {
      const warn = wache(page);
      p = await projektMitModell(request, NAME, { customWalls: [wand(1, 0, 0)] });
      await studioOeffnen(page, NAME);
      await zeichnen(page, 40);
      await zeichnen(page, 80);
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0, 40, 80]);
      const reiter = (/** @type {string} */ name) => page.getByRole("tab", { name, exact: true }).first();
      await reiter("Raumprogramm").click();
      await expect(page.getByTestId("bim-speicher")).toHaveCount(0, { timeout: 15000 }); // the studio is unmounted
      await reiter("Gebäudemodell").click();
      await expect(page.getByTestId("bim-speicher")).toHaveAttribute("data-bereit", "1", { timeout: 30000 });
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0, 40, 80]); // the draft is back
      // two steps back and one forward, across the tab switch
      expect((await page.evaluate(() => /** @type {any} */ (window).bitApi.rueckgaengig())).ok).toBe(true);
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0, 40]);
      expect((await page.evaluate(() => /** @type {any} */ (window).bitApi.rueckgaengig())).ok).toBe(true);
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0]);
      await expect(status(page)).toHaveAttribute("data-sauber", "1");
      expect((await page.evaluate(() => /** @type {any} */ (window).bitApi.wiederholen())).ok).toBe(true);
      await expect.poll(() => xs(page), { timeout: 10000 }).toEqual([0, 40]);
      expect(gx(await gespeichert(request, p.id)), "nothing stored without Speichern").toEqual([0]);
      expect(warn).toEqual([]);
    } finally { await aufraeumen(request, p.id); }
  });
});
