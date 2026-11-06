// Headless proof 106-10: the review workplace "Modellfreigabe".
// Three changes in the BIM studio (speech, an agent over the control channel, a typed move), each confirmed by the person; all three stand
// in the change log with origin, sentence, before/after and check. A program (the test's own HTTP client, like an agent with write access)
// cannot release (403). On the page: two are released as a batch (name and time noted), one is undone - the stored model goes back. The
// jump link selects the element in the studio. The command library: default templates, a value outside the list is refused in the test field.
// Own project with three drawn walls (pattern of aendern-106-03); the step records are removed again as the person (session token).
// Review 106-10: the name of the release is the active office person (a chosen "Nutzer & Rechte" record, set per device like "Ansicht als");
// the command library is office-wide and may hold the office's own templates - the test never deletes a template it did not create
// (its own carry the marker MARKE in the description; the default set is only tried when the library is empty).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const GA = guid("FreigabeWandA10610");
const GB = guid("FreigabeWandB10610");
const GC = guid("FreigabeWandC10610");
const NAME = "E2E Freigabe 10610";
const MARKE = "E2E 10610 Testvorlage";
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

/** Headers of a request of the app's own page (Fetch Metadata + Origin + session token) - only for the clean-up. */
async function alsPerson(request, baseURL) {
  const token = (await (await request.get("/api/sitzung")).json()).token;
  return { origin: baseURL, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "x-bit-session": token };
}

test.describe("106-10 Modellfreigabe: Protokoll, Freigabe mit Name und Zeit, Rücknahme, Befehlsbibliothek", () => {
  test.setTimeout(300000);

  test("drei Änderungen → zwei freigeben, eine zurücknehmen; ein Programm kann nicht freigeben", async ({ page, request, baseURL }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    let id = null;
    let personNeu = null;
    /** @type {Set<string>} templates this test created (only these are removed) */
    const eigeneVorlagen = new Set();
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        customWalls: [
          { a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau" },
          { a: { x: 14, z: -22 }, b: { x: 26, z: -22 }, level: 0, height: 3, thickness: 0.3, _idx: 2, guid: GB, status: "neubau" },
          { a: { x: 14, z: -28 }, b: { x: 26, z: -28 }, level: 0, height: 3, thickness: 0.3, _idx: 3, guid: GC, status: "neubau" },
        ],
      } });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const schritte = async () => (await (await request.get(`/api/entities/AenderungsSchritt?project_id=${id}`)).json());

      // the person who confirms and releases: an active office owner, else one created for the test (removed in finally)
      let person = (await (await request.get("/api/entities/Nutzer")).json()).find((n) => n.aktiv !== false && n.rolle === "inhaber" && String(n.name || "").trim());
      if (!person) {
        person = personNeu = await (await request.post("/api/entities/Nutzer", { data: { name: "E2E Prüferin 10610", kuerzel: "EP", email: "", aktiv: true, rolle: "inhaber" } })).json();
      }
      await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* without storage the owner is active anyway */ } }, [ANSICHT_ALS, String(person.id)]);

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await expect.poll(async () => (await befehl(page, "modell")).result.bauteile.some((b) => b.guid === GA), { timeout: 30000 }).toBe(true);

      // ---- 1. spoken (declared "sprache"), confirmed with the button
      const e1 = await befehl(page, "eigenschaft-setzen", { guid: GA, name: "feuerwiderstand", wert: "F90", herkunft: "sprache", befehl_text: "setze brandschutz auf F90" });
      expect(e1.ok, JSON.stringify(e1)).toBe(true);
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      // ---- 2. an agent proposes over the control channel; it cannot confirm, the person does
      const e2 = await ueberKanal(request, 9101, "eigenschaft-setzen", { guid: GB, name: "kg", wert: "341" });
      expect(e2.json.ok, JSON.stringify(e2.json)).toBe(true);
      expect((await ueberKanal(request, 9102, "bestaetigen", { vorschlag_id: e2.json.result.id })).json.ok, "an agent cannot confirm").toBe(false);
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(1, { timeout: 15000 });
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      // ---- 3. spoken move by 0.5 m, confirmed by a typed "bestaetigen"
      const e3 = await befehl(page, "transformieren", { guid: GC, verschiebung_m: [0.5, 0, 0], herkunft: "sprache", befehl_text: "schieb die wand einen halben meter nach rechts" });
      expect(e3.ok, JSON.stringify(e3)).toBe(true);
      expect((await befehl(page, "bestaetigen", { vorschlag_id: e3.result.id, durch: "tastatur" })).ok).toBe(true);
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w.guid === GC)?.a.x, { timeout: 20000 }).toBe(14.5);
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w.guid === GA)?.feuerwiderstand, { timeout: 20000 }).toBe("F90");
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w.guid === GB)?.kg, { timeout: 20000 }).toBe("341");

      // ---- the change log holds all three with origin, sentence, check, author, time
      await expect.poll(async () => (await schritte()).length, { timeout: 20000 }).toBe(3);
      const log = await schritte();
      const s1 = log.find((s) => s.vorschlag_id === e1.result.id), s2 = log.find((s) => s.vorschlag_id === e2.json.result.id), s3 = log.find((s) => s.vorschlag_id === e3.result.id);
      expect(s1).toMatchObject({ herkunft: "sprache", herkunft_quellen: ["sprache"], bestaetigt_durch: "hand", befehl_text: "setze brandschutz auf F90", freigabe: null, zurueckgenommen: null });
      expect(s1.nachher.wert).toBe("F90");
      expect(s1.autor, "the author is the office person, not the local sign-in stand-in").toBe(String(person.name).trim());
      expect(s1.pruefung?.stufe).toBeTruthy();
      expect(s2).toMatchObject({ herkunft: "agent", bestaetigt_durch: "hand" });
      expect(s3).toMatchObject({ art: "transformieren", herkunft: "sprache", bestaetigt_durch: "tastatur" });

      // ---- D-IM-04: a program (an agent with write access) cannot release - the server refuses
      const versuch = await request.put(`/api/entities/AenderungsSchritt/${s2.id}`, { data: { freigabe: { status: "freigegeben", durch: "Agent", zeit: new Date().toISOString() } } });
      expect(versuch.status()).toBe(403);
      expect((await schritte()).find((s) => s.id === s2.id).freigabe).toBeNull();

      // ---- the workplace
      await page.goto(`/Modellfreigabe?projekt=${encodeURIComponent(NAME)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Modellfreigabe" })).toBeVisible({ timeout: 30000 });
      const zeilen = page.getByTestId("freigabe-zeile");
      await expect(zeilen).toHaveCount(3, { timeout: 20000 });
      await expect(zeilen.filter({ has: page.locator('[data-status="ungeprueft"]') })).toHaveCount(3);
      const z1 = zeilen.filter({ hasText: "F90" }), z2 = zeilen.filter({ hasText: "341" }), z3 = zeilen.filter({ hasText: "0,5 m" });
      await expect(z1.getByTestId("freigabe-herkunft")).toContainText("Spracheingabe");
      await expect(z2.getByTestId("freigabe-herkunft")).toContainText("Agent");
      await expect(z1).toContainText("Vorher");
      await expect(z1).toContainText("F90");
      await expect(z1.getByTestId("freigabe-pruefung")).toBeVisible();
      await expect(z1.getByTestId("freigabe-sprung")).toHaveAttribute("href", `/ComplexDesigner?tab=bim&auswahl=${GA}`);

      // two as a batch: the question lists both sentences, nothing is written before "Bestätigen"
      await z1.getByTestId("freigabe-waehlen").check();
      await z2.getByTestId("freigabe-waehlen").check();
      await page.getByTestId("freigabe-sammel-freigeben").click();
      const frage = page.getByTestId("freigabe-frage");
      await expect(frage).toHaveAttribute("data-art", "freigeben");
      await expect(frage.getByTestId("freigabe-frage-satz")).toHaveCount(2);
      expect((await schritte()).every((s) => s.freigabe === null), "nothing released before the confirmation").toBe(true);
      await page.getByTestId("freigabe-bestaetigen").click();
      await expect(page.getByTestId("freigabe-meldung")).toHaveAttribute("data-stufe", "ok");
      await expect(page.getByTestId("freigabe-meldung")).toContainText("2 freigegeben");
      // the default filter "Ungeprüft" leaves the move
      await expect(zeilen).toHaveCount(1);
      await expect(zeilen.first()).toContainText("0,5 m");
      const nachFreigabe = await schritte();
      for (const s of nachFreigabe.filter((x) => x.id === s1.id || x.id === s2.id)) {
        expect(s.freigabe).toMatchObject({ status: "freigegeben" });
        expect(s.freigabe.durch).toBe(String(person.name).trim());
        expect(Number.isNaN(Date.parse(s.freigabe.zeit))).toBe(false);
      }

      // the third is undone: question with its sentence, then the stored model goes back
      await zeilen.first().getByTestId("freigabe-einzeln-zuruecknehmen").click();
      await expect(page.getByTestId("freigabe-frage")).toHaveAttribute("data-art", "zuruecknehmen");
      await expect(page.getByTestId("freigabe-frage-satz")).toContainText("0,5 m");
      expect((await gespeichert()).customWalls.find((w) => w.guid === GC).a.x, "nothing undone before the confirmation").toBe(14.5);
      await page.getByTestId("freigabe-bestaetigen").click();
      await expect(page.getByTestId("freigabe-meldung")).toContainText("1 zurückgenommen");
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w.guid === GC).a.x, { timeout: 20000 }).toBe(14);
      expect((await gespeichert()).customWalls.find((w) => w.guid === GA).feuerwiderstand, "released steps stay").toBe("F90");
      await expect(page.getByTestId("freigabe-leer")).toBeVisible();
      expect((await schritte()).find((s) => s.id === s3.id).zurueckgenommen).toMatchObject({ ort: "freigabe" });

      // filters: released ones with name and time, undone one marked
      await page.getByTestId("freigabe-filter-status").selectOption("freigegeben");
      await expect(zeilen).toHaveCount(2);
      await expect(page.getByTestId("freigabe-vermerk").first()).toContainText("Freigegeben durch");
      await page.getByTestId("freigabe-filter-status").selectOption("zurueckgenommen");
      await expect(zeilen).toHaveCount(1);
      await expect(zeilen.first().getByTestId("freigabe-status")).toHaveText(/Zurückgenommen/);

      // ---- command library: default templates, a value outside the list is refused, an allowed one understood
      await page.getByTestId("freigabe-reiter-bibliothek").click();
      await expect(page.getByTestId("bibliothek")).toBeVisible();
      const vorlagen = page.getByTestId("bibliothek-vorlage");
      const vorlagenIds = async () => new Set((await (await request.get("/api/entities/Befehlsvorlage")).json()).map((v) => String(v.id)));
      const vorher = await vorlagenIds();
      await expect(vorlagen).toHaveCount(vorher.size);
      if (!vorher.size) {
        // the default set is offered only for an empty library: create it, remember exactly these ids
        await page.getByTestId("bibliothek-standard").click();
        await expect(vorlagen).toHaveCount(3);
        for (const v of await vorlagenIds()) if (!vorher.has(v)) eigeneVorlagen.add(v);
        expect(eigeneVorlagen.size).toBe(3);
      }
      // an own template through the form (marker in the description), whatever the office already has
      await page.getByTestId("bibliothek-satz").fill("Prüfvorlage E2E {eigenschaft} auf {wert}");
      await page.getByTestId("bibliothek-eigenschaft").selectOption("feuerwiderstand");
      await page.getByTestId("bibliothek-werte").fill("F30, F90");
      await page.getByLabel("Beschreibung").fill(MARKE);
      await page.getByTestId("bibliothek-speichern").click();
      const eigene = vorlagen.filter({ hasText: MARKE });
      await expect(eigene).toHaveCount(1);
      for (const v of await (await request.get("/api/entities/Befehlsvorlage")).json()) if (v.beschreibung === MARKE) eigeneVorlagen.add(String(v.id));
      await page.getByTestId("bibliothek-probe").fill("Prüfvorlage E2E Brandschutz auf F45");
      await expect(page.getByTestId("bibliothek-probe-ergebnis")).toHaveAttribute("data-art", "abgelehnt");
      await expect(page.getByTestId("bibliothek-probe-ergebnis")).toContainText("erlaubt: F30");
      await page.getByTestId("bibliothek-probe").fill("Prüfvorlage E2E Brandschutz auf F90");
      await expect(page.getByTestId("bibliothek-probe-ergebnis")).toHaveAttribute("data-art", "befehl");
      await expect(page.getByTestId("bibliothek-probe-ergebnis")).toContainText("Büro-Vorlage");
      // deleting asks first (the template's sentence in words); "Bestätigen" deletes only this one
      const anzahl = await vorlagen.count();
      await eigene.getByTestId("bibliothek-loeschen").click();
      await expect(eigene.getByTestId("bibliothek-loeschen-frage")).toContainText("Prüfvorlage E2E");
      expect((await vorlagenIds()).size, "nothing deleted before the confirmation").toBe(anzahl);
      await eigene.getByTestId("bibliothek-loeschen-bestaetigen").click();
      await expect(vorlagen).toHaveCount(anzahl - 1);
      await expect(eigene).toHaveCount(0);
      for (const v of vorher) expect((await vorlagenIds()).has(v), "foreign templates stay").toBe(true);

      // ---- jump to the element: the studio selects it through the selection command
      await page.getByTestId("freigabe-reiter-aenderungen").click();
      await page.getByTestId("freigabe-filter-status").selectOption("freigegeben");
      await zeilen.filter({ hasText: "F90" }).getByTestId("freigabe-sprung").click();
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result?.bauteile?.[0]?.guid ?? null, { timeout: 30000 }).toBe(GA);

      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      // only what this test created: its templates (as the person), its office person, its project with steps and model
      if (eigeneVorlagen.size) {
        const kopf = await alsPerson(request, baseURL);
        for (const v of eigeneVorlagen) await request.delete(`/api/entities/Befehlsvorlage/${v}`, { headers: kopf });
      }
      if (personNeu?.id) await request.delete(`/api/entities/Nutzer/${personNeu.id}`);
      if (id != null) {
        const kopf = await alsPerson(request, baseURL);
        for (const s of await (await request.get(`/api/entities/AenderungsSchritt?project_id=${id}`)).json()) await request.delete(`/api/entities/AenderungsSchritt/${s.id}`, { headers: kopf });
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
