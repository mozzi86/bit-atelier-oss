// Headless proof 106-09: the sync between devices. Two browser contexts on this machine stand for two devices (desktop
// and tablet; the real tablet / headset is NOT tested here - D-AW-04, "nicht am Gerät abgenommen").
//   1. BIM studio: a change confirmed on A appears on B without reload, with its origin; B's open proposal on the same
//      wall becomes "Veraltet" and blocked; B writes nothing back (no echo).
//   2. BIM studio: both change the same wall at the same time → a conflict card with both versions, nothing is
//      overwritten; "Meine Fassung behalten" writes it, and the other device follows live.
//   3. IFC viewer: a journal entry confirmed on A reaches B (note, origin) and B's proposal on that property is stale.
// The stream is per project: a third context on another project gets nothing.
//   4. (review 106-09) Four tabs of ONE browser share one stream: exactly one tab holds the connection (leader), the
//      others hear it; every tab's API calls still answer at once (no exhausted connection pool), every tab gets the
//      change, and when the leader tab closes another tab takes over and the next change still arrives.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const GA = guid("AbgleichWandA10609");
const GB = guid("AbgleichWandB10609");

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
const abgleich = (page) => page.evaluate(() => /** @type {any} */ (window).__bitAbgleich?.stand() ?? null);
const wandVon = async (page, idx) => (await page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell())).customWalls.find((w) => w._idx === idx);

/** A second "device": its own browser context (own storage, own tab id), same server. */
async function zweitesGeraet(browser, baseURL) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await nurLocalhost(page);
  return { ctx, page };
}

async function studioOeffnen(page, name) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle) && !!(/** @type {any} */ (window).__bitZeigen?.bimAenderung), null, { timeout: 60000 });
  await expect.poll(async () => (await befehl(page, "modell")).result?.bauteile?.some((b) => b.guid === GA), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await abgleich(page))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
}

async function projektMitWaenden(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id,
    customWalls: [
      { a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau" },
      { a: { x: 14, z: -22 }, b: { x: 26, z: -22 }, level: 0, height: 3, thickness: 0.3, _idx: 2, guid: GB, status: "neubau" },
    ],
  } });
  return id;
}

test.describe("106-09 Abgleich zwischen Geräten: Änderungen in Echtzeit, Konflikt statt Überschreiben", () => {
  test.setTimeout(420000);

  test("BIM-Studio: bestätigt auf A → auf B ohne Neuladen, mit Herkunft; B's Vorschlag veraltet; kein Echo", async ({ page, request, browser, baseURL }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Abgleich 10609";
    const ANDERES = "E2E Abgleich 10609 anderes";
    let id = null, idAnders = null;
    const b = await zweitesGeraet(browser, baseURL);
    const c = await zweitesGeraet(browser, baseURL);
    try {
      await nurLocalhost(page);
      const warnA = wache(page), warnB = wache(b.page);
      id = await projektMitWaenden(request, NAME);
      idAnders = await projektMitWaenden(request, ANDERES);
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];

      await studioOeffnen(page, NAME);
      await studioOeffnen(b.page, NAME);
      await studioOeffnen(c.page, ANDERES); // a third device on ANOTHER project
      /** @type {string[]} */ const schreibenB = [];
      b.page.on("request", (r) => { if (r.method() !== "GET" && /\/api\/entities\/BimModel/.test(r.url())) schreibenB.push(r.method()); });

      // B: an open proposal on wall A (F60) - nothing changed yet
      expect((await befehl(b.page, "auswahl-guid", { guid: GA })).ok).toBe(true);
      const vorschlagB = await befehl(b.page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F60" });
      expect(vorschlagB.ok, JSON.stringify(vorschlagB)).toBe(true);
      await expect(b.page.getByTestId("aenderung-vorschau")).toHaveAttribute("data-stufe", /ok|warn|hinweis/);

      // A: spoken sentence (origin sprache) → proposal → the person taps Übernehmen (hand)
      expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);
      const vorschlagA = await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90", herkunft: "sprache", befehl_text: "feuerwiderstand f neunzig" });
      expect(vorschlagA.ok, JSON.stringify(vorschlagA)).toBe(true);
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 1).feuerwiderstand, { timeout: 20000 }).toBe("F90");

      // B: the wall follows without reload, the note says from where and how it was confirmed there
      await expect.poll(async () => (await wandVon(b.page, 1))?.feuerwiderstand, { timeout: 20000 }).toBe("F90");
      const hinweis = b.page.getByTestId("abgleich-hinweis").first();
      await expect(hinweis).toBeVisible();
      await expect(hinweis).toContainText("anderen Fenster an diesem Rechner"); // two contexts on one machine: no paired device name
      await expect(hinweis).toContainText("dort von der Person bestätigt");
      await expect(hinweis.getByTestId("abgleich-hinweis-zeile").first()).toContainText("F90");
      await expect(hinweis.getByTestId("abgleich-hinweis-zeile").first()).toHaveAttribute("data-herkunft", "sprache");
      await expect(hinweis).toContainText("Spracheingabe");
      await expect(hinweis).toContainText("per Hand bestätigt");
      // B's open proposal was checked again: stale and blocked (form: dashed line with ▲ in the note, card level "fehler")
      await expect(b.page.getByTestId("abgleich-veraltet")).toContainText("veraltet");
      await expect(b.page.getByTestId("aenderung-vorschau")).toHaveAttribute("data-stufe", "fehler");
      await expect(b.page.getByTestId("aenderung-vorschau")).toContainText("Veraltet");
      await expect(b.page.getByTestId("aenderung-uebernehmen")).toBeDisabled();
      expect((await befehl(b.page, "bestaetigen", { vorschlag_id: vorschlagB.result.id })).ok, "a stale proposal cannot be confirmed").toBe(false);
      // the sync confirmed nothing on B: B's history has no step, B's open proposal is still there (blocked)
      const vB = (await befehl(b.page, "vorschlaege")).result;
      expect(vB.verlauf).toEqual([]);
      expect(vB.offen.length).toBe(1);
      // no echo: B wrote nothing back (the studio's debounce is 1.2 s)
      await b.page.waitForTimeout(2500);
      expect(schreibenB, "B schreibt die angekommene Änderung nicht zurück").toEqual([]);
      // the other project heard nothing
      expect((await abgleich(c.page)).hinweise).toEqual([]);
      expect((await wandVon(c.page, 1)).feuerwiderstand ?? null).toBeNull();
      expect(warnA, `Konsole A: ${warnA.join(" | ")}`).toEqual([]);
      expect(warnB, `Konsole B: ${warnB.join(" | ")}`).toEqual([]);
    } finally {
      await b.ctx.close();
      await c.ctx.close();
      for (const pid of [id, idAnders]) {
        if (!pid) continue;
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${pid}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${pid}`);
      }
    }
  });

  test("BIM-Studio: dieselbe Wand gleichzeitig auf zwei Geräten → Konflikt mit beiden Fassungen, nichts überschrieben", async ({ page, request, browser, baseURL }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Abgleich Konflikt 10609";
    let id = null;
    const b = await zweitesGeraet(browser, baseURL);
    try {
      await nurLocalhost(page);
      const warnA = wache(page), warnB = wache(b.page);
      id = await projektMitWaenden(request, NAME);
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      await studioOeffnen(page, NAME);
      await studioOeffnen(b.page, NAME);
      const geraete = { A: page, B: b.page };

      // both propose on wall B, then both confirm before either change has reached the other (the studio saves 1.2 s later)
      for (const [p, wert] of [[page, "F30"], [b.page, "F120"]]) {
        expect((await befehl(p, "auswahl-guid", { guid: GB })).ok).toBe(true);
        expect((await befehl(p, "eigenschaft-setzen", { name: "feuerwiderstand", wert })).ok).toBe(true);
      }
      const [okA, okB] = await Promise.all([befehl(page, "bestaetigen", { durch: "hand" }), befehl(b.page, "bestaetigen", { durch: "hand" })]);
      expect(okA.ok && okB.ok, `${JSON.stringify(okA)} ${JSON.stringify(okB)}`).toBe(true);

      // exactly one device saved first; the other gets the conflict card - which one depends on timing
      /** @type {"A"|"B"|null} */ let mitKonflikt = null;
      await expect.poll(async () => {
        for (const k of /** @type {const} */ (["A", "B"])) if ((await abgleich(geraete[k]))?.konflikte?.length) mitKonflikt = k;
        return mitKonflikt;
      }, { timeout: 30000 }).not.toBeNull();
      const hier = geraete[/** @type {"A"|"B"} */ (mitKonflikt)];
      const dort = hier === page ? b.page : page;
      const meinWert = hier === page ? "F30" : "F120";
      const fremdWert = hier === page ? "F120" : "F30";
      const karte = hier.getByTestId("abgleich-konflikt");
      await expect(karte).toBeVisible();
      await expect(karte).toHaveAttribute("data-feld", "customWalls");
      await expect(karte).toContainText("Konflikt");
      await expect(karte).toContainText("nichts wurde überschrieben");
      await expect(karte.getByTestId("abgleich-konflikt-zeile")).toHaveCount(1);
      await expect(karte.getByTestId("abgleich-konflikt-mein")).toContainText(meinWert);
      await expect(karte.getByTestId("abgleich-konflikt-fremd")).toContainText(fremdWert);
      // nothing overwritten: the stored record holds the first device's value, the conflicting device still shows its own
      await hier.waitForTimeout(2500);
      expect((await gespeichert()).customWalls.find((w) => w._idx === 2).feuerwiderstand).toBe(fremdWert);
      expect((await wandVon(hier, 2)).feuerwiderstand).toBe(meinWert);
      expect((await wandVon(dort, 2)).feuerwiderstand).toBe(fremdWert);
      expect((await abgleich(dort)).konflikte, "only one side has to decide").toEqual([]);

      // the person keeps her version: written, and the other device follows live (as a change from here)
      await karte.getByTestId("abgleich-mein").click();
      await expect(karte).toHaveCount(0);
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 2).feuerwiderstand, { timeout: 20000 }).toBe(meinWert);
      await expect.poll(async () => (await wandVon(dort, 2))?.feuerwiderstand, { timeout: 20000 }).toBe(meinWert);
      // the other wall was not touched by any of this
      expect((await gespeichert()).customWalls.find((w) => w._idx === 1).feuerwiderstand ?? null).toBeNull();
      expect(warnA, `Konsole A: ${warnA.join(" | ")}`).toEqual([]);
      expect(warnB, `Konsole B: ${warnB.join(" | ")}`).toEqual([]);
    } finally {
      await b.ctx.close();
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });

  test("Vier Tabs eines Browsers teilen einen Strom: ein Leiter, alle Tabs bekommen die Änderung, API bleibt frei, Leiterwechsel", async ({ page, request, browser, baseURL }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Abgleich Tabs 10609";
    let id = null;
    const b = await zweitesGeraet(browser, baseURL);
    try {
      await nurLocalhost(page);
      const warnA = wache(page);
      id = await projektMitWaenden(request, NAME);
      await studioOeffnen(page, NAME);
      // four tabs of ONE browser (one context = one connection pool, like a person with several tabs)
      const tabs = [b.page];
      for (let i = 1; i < 4; i += 1) { const p = await b.ctx.newPage(); await nurLocalhost(p); tabs.push(p); }
      const warnTabs = tabs.map((p) => wache(p));
      for (const p of tabs) await studioOeffnen(p, NAME);
      const rollen = async () => Promise.all(tabs.map(async (p) => (p.isClosed() ? null : (await abgleich(p))?.verbindung?.rolle)));
      await expect.poll(async () => (await rollen()).sort().join(","), { timeout: 20000 }).toBe("folger,folger,folger,leiter");
      // every tab still gets an API answer at once - one held stream for the browser, not one per tab
      for (const p of tabs) {
        const ms = await p.evaluate(async () => { const t0 = performance.now(); await fetch("/api/entities/Project?limit=1"); return performance.now() - t0; });
        expect(ms, "API call of a tab is not stuck behind held connections").toBeLessThan(3000);
      }
      // a change confirmed on the other device reaches all four tabs
      expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);
      expect((await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" })).ok).toBe(true);
      await page.getByTestId("aenderung-uebernehmen").click();
      for (const p of tabs) await expect.poll(async () => (await wandVon(p, 1))?.feuerwiderstand, { timeout: 20000 }).toBe("F90");
      // the leader tab closes: another tab takes over, and the next change still arrives everywhere
      const leiter = tabs[(await rollen()).indexOf("leiter")];
      await leiter.close();
      const rest = tabs.filter((p) => p !== leiter);
      await expect.poll(async () => (await Promise.all(rest.map(async (p) => (await abgleich(p))?.verbindung?.rolle))).sort().join(","), { timeout: 20000 }).toBe("folger,folger,leiter");
      expect((await befehl(page, "auswahl-guid", { guid: GB })).ok).toBe(true);
      expect((await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F30" })).ok).toBe(true);
      await page.getByTestId("aenderung-uebernehmen").click();
      for (const p of rest) await expect.poll(async () => (await wandVon(p, 2))?.feuerwiderstand, { timeout: 20000 }).toBe("F30");
      expect(warnA, `Konsole A: ${warnA.join(" | ")}`).toEqual([]);
      warnTabs.forEach((w, i) => expect(w, `Konsole Tab ${i + 1}: ${w.join(" | ")}`).toEqual([]));
    } finally {
      await b.ctx.close();
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });

  test("IFC-Viewer: Journal-Eintrag auf A erscheint auf B mit Herkunft; B's Vorschlag zur selben Eigenschaft veraltet", async ({ page, request, browser, baseURL }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Abgleich IFC 10609";
    let id = null, guidWand = null;
    const b = await zweitesGeraet(browser, baseURL);
    try {
      await nurLocalhost(page);
      const warnA = wache(page), warnB = wache(b.page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      for (const p of [page, b.page]) {
        await p.goto(`/IfcViewer?beispiel=1&projekt=${encodeURIComponent(NAME)}`);
        await expect(p.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
        await p.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 30000 });
        await expect.poll(async () => (await abgleich(p))?.verbindung?.status, { timeout: 30000 }).toBe("verbunden");
      }
      const wand = (await befehl(page, "modell", { klasse: "IfcWall" })).result.bauteile.find((x) => x.name && x.geschoss);
      guidWand = wand.guid;
      // B: proposal F150 on the wall
      expect((await befehl(b.page, "auswahl-guid", { guid: guidWand })).ok).toBe(true);
      const vB = await befehl(b.page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F150" });
      expect(vB.ok, JSON.stringify(vB)).toBe(true);
      // A: proposal F120 (text) → Übernehmen
      expect((await befehl(page, "auswahl-guid", { guid: guidWand })).ok).toBe(true);
      expect((await befehl(page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F120" })).ok).toBe(true);
      await page.getByTestId("aenderung-uebernehmen").click();
      // B: the note names the entry and its origin; B's proposal now starts from an old value → stale and blocked
      const hinweis = b.page.getByTestId("abgleich-hinweis").first();
      await expect(hinweis).toBeVisible({ timeout: 20000 });
      await expect(hinweis.getByTestId("abgleich-hinweis-zeile").first()).toContainText("FireRating");
      await expect(hinweis.getByTestId("abgleich-hinweis-zeile").first()).toContainText("F120");
      await expect(hinweis.getByTestId("abgleich-hinweis-zeile").first()).toHaveAttribute("data-herkunft", "text");
      await expect(b.page.getByTestId("aenderung-vorschau")).toHaveAttribute("data-stufe", "fehler");
      await expect(b.page.getByTestId("aenderung-vorschau")).toContainText("Veraltet");
      expect((await befehl(b.page, "bestaetigen", { vorschlag_id: vB.result.id })).ok).toBe(false);
      const eintraege = (await (await request.get(`/api/entities/IfcAenderung?project_id=${id}`)).json()).filter((e) => e.guid === guidWand);
      expect(eintraege.map((e) => e.wert), "exactly A's entry, nothing from B").toEqual(["F120"]);
      expect(warnA, `Konsole A: ${warnA.join(" | ")}`).toEqual([]);
      expect(warnB, `Konsole B: ${warnB.join(" | ")}`).toEqual([]);
    } finally {
      await b.ctx.close();
      if (id) {
        for (const e of await (await request.get(`/api/entities/IfcAenderung?project_id=${id}`)).json()) await request.delete(`/api/entities/IfcAenderung/${e.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
