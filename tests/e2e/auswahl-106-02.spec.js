// Headless proof 106-02: the selection as context, driven only through the command register
// (window.__bitBefehle, like steuerung-104-04) in the IFC viewer and in the BIM studio.
// "modell" lists GUIDs; "auswahl-guid" selects one of them and the selection panel shows it;
// "auswahl-lesen" returns GUID / class / name / storey / data sheet / screen position; "ansicht-auf-auswahl"
// frames the element (its screen position moves to the middle of the canvas); "auswahl-aufheben" clears;
// a command that needs a selection without one is refused with the German plain text; an unknown GUID
// is refused, never guessed. Nothing here reads an image: ground truth is the GUID.
// Review fixes: commands in the SAME tick see each other's selection (no render between them), a multi
// selection stays the set that was selected, and the commands also answer through the HTTP control channel
// (POST /api/steuerung, 104-04) of both viewers.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";

// dev / E2E server: data folder = server/ (BIT_DATA_DIR unset), like steuerung-104-04
const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");

const KEINE_AUSWAHL = "Keine Auswahl — erst ein Bauteil zeigen oder mit auswahl-guid wählen";

/** Console watch: only known headless WebGL messages are tolerated, everything else fails the test. */
function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** One command through the register's JSON line; returns the parsed answer {id, ok, result|error}. */
const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);

/**
 * One command through the HTTP control channel; answered by the viewer that is open (its bridge polls the server).
 * 504 (not-run / may-have-run) is retried: the last long poll of a tab closed by the previous test lives on in the dev proxy
 * for up to 10 s and takes a request without answering it (see steuerung-104-04). Safe here: every command sent
 * through it is idempotent (read, select by GUID, clear).
 */
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

/** Several commands in ONE synchronous page.evaluate: same tick, no React render between them. Returns the answers in order. */
const kette = (page, schritte) => page.evaluate(
  (s) => s.map(([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p || {} } })))),
  schritte,
);

/**
 * 106-06 (D-IM-02): an image through the control channel goes to an agent - a target outside this computer - so the server lets it pass only
 * for a project the person consented for. Checks the refusal first, then gives the consent from the app page itself (as the button "mit Bild"
 * does: same origin, session token) for the viewer's project.
 * @param {import("@playwright/test").Page} page @param {import("@playwright/test").APIRequestContext} request
 * @returns {Promise<string>} the project id (withdraw with DELETE /api/llm/bild-zustimmung)
 */
async function bildZustimmen(page, request) {
  const pid = (await befehl(page, "ansicht-bild", { breite: 64 })).result?.projekt_id;
  expect(pid, "the viewer names its open project with the image").toBeTruthy();
  await request.delete(`/api/llm/bild-zustimmung?projekt_id=${encodeURIComponent(pid)}`);
  const ohne = await ueberKanal(request, `ohne-${Date.now()}`, "ansicht-bild", { breite: 64 });
  expect(ohne.json, "without consent the control channel holds the image back").toMatchObject({ ok: false, error: expect.stringMatching(/Bild der Ansicht abgelehnt/) });
  const status = await page.evaluate(async (p) => {
    const { token } = await (await fetch("/api/sitzung")).json();
    return (await fetch("/api/llm/bild-zustimmung", { method: "POST", headers: { "content-type": "application/json", "x-bit-session": token }, body: JSON.stringify({ projekt_id: p }) })).status;
  }, pid);
  expect(status, "the person's consent from the app page").toBe(200);
  return pid;
}

/** The canvas size and the screen position must put the element near the middle after framing. */
async function inDerMitte(page, canvas, guid) {
  const box = await canvas.boundingBox();
  await expect.poll(async () => {
    const k = (await befehl(page, "auswahl-lesen")).result;
    const b = k.bauteile.find((x) => x.guid === guid)?.bildschirm;
    if (!b || !b.imBild) return 99;
    return Math.max(Math.abs(b.x - box.width / 2) / box.width, Math.abs(b.y - box.height / 2) / box.height);
  }, { timeout: 15000, message: "nach 'ansicht-auf-auswahl' liegt das Bauteil in der Bildmitte" }).toBeLessThan(0.15);
}

/** 106-04: "ansicht-bild" answers one PNG (register and HTTP control channel); the base64 starts with the PNG signature. */
function pngPruefen(antwort, maxBreite) {
  expect(antwort.ok, JSON.stringify(antwort).slice(0, 300)).toBe(true);
  const r = antwort.result;
  expect(r.format).toBe("image/png");
  expect(Buffer.from(r.png_base64, "base64").subarray(0, 8).toString("hex"), "PNG-Kopf").toBe("89504e470d0a1a0a");
  expect(r.breite).toBeGreaterThan(0);
  expect(r.breite).toBeLessThanOrEqual(maxBreite);
  expect(r.hoehe).toBeGreaterThan(0);
  return r;
}

/**
 * Review fix 106-04: the PNG must SHOW the scene, not only be a PNG. Decoded in the browser (createImageBitmap) and drawn on a
 * canvas: the share of pixels that differ from the background (the top-left corner), the number of distinct colours (quantised to
 * 16 levels per channel, so antialiasing noise does not count) and transparency are measured. A black, empty or transparent
 * frame (WebGL buffer read after the frame was composited) fails all three.
 * @param {import("@playwright/test").Page} page
 * @param {{png_base64: string}} r  the result of "ansicht-bild".
 */
async function pngInhalt(page, r) {
  const m = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await window.createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    const farben = new Set();
    let abweichend = 0, durchsichtig = 0;
    const n = c.width * c.height;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (d[o + 3] < 255) durchsichtig++;
      farben.add(((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4));
      if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 24) abweichend++;
    }
    return { breite: c.width, hoehe: c.height, abweichendAnteil: abweichend / n, farben: farben.size, durchsichtigAnteil: durchsichtig / n };
  }, r.png_base64);
  expect(m.breite, "decoded width = announced width").toBe(r.breite);
  expect(m.hoehe, "decoded height = announced height").toBe(r.hoehe);
  expect(m.durchsichtigAnteil, `kein transparentes Bild: ${JSON.stringify(m)}`).toBe(0);
  expect(m.farben, `mehr als eine Farbe: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(4);
  expect(m.abweichendAnteil, `die Szene hebt sich vom Hintergrund ab: ${JSON.stringify(m)}`).toBeGreaterThan(0.01);
  return m;
}

/** The register answers to the same five words in both viewers. */
async function befehlsliste(page) {
  const liste = await page.evaluate(() => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten('{"id":1,"method":"befehle"}')));
  expect(liste.ok).toBe(true);
  const ids = liste.result.map((b) => b.id);
  for (const id of ["auswahl-lesen", "auswahl-guid", "auswahl-aufheben", "ansicht-auf-auswahl", "modell"]) expect(ids).toContain(id);
  expect(liste.result.find((b) => b.id === "auswahl-guid").parameter).toEqual({ guid: "text" });
}

test.describe("106-02 Auswahl als Kontext: Register und Steuerkanal", () => {
  test.setTimeout(300000);

  test("IFC-Viewer (musterprojekt.ifc): modell → auswahl-guid → lesen → ansicht → aufheben, Klartext ohne Auswahl", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    await page.goto("/IfcViewer?beispiel=1");
    await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 30000 });
    const canvas = page.locator("canvas:visible").first();
    await befehlsliste(page);

    // --- nothing selected: reading says 0, "dieses" is refused with the plain text, the camera is untouched ---
    expect((await befehl(page, "auswahl-lesen")).result).toEqual({ anzahl: 0, gekuerzt: false, ohneGuid: 0, bauteile: [] });
    const ohne = await befehl(page, "ansicht-auf-auswahl");
    expect(ohne).toMatchObject({ ok: false, error: KEINE_AUSWAHL });

    // --- modell: counts per class, storeys, elements with GUID ---
    const modell = (await befehl(page, "modell")).result;
    expect(modell.anzahl).toBeGreaterThan(0);
    expect(Object.keys(modell.klassen)).toContain("IfcWall");
    expect(modell.bauteile.length).toBeGreaterThan(0);
    expect(modell.bauteile.length).toBeLessThanOrEqual(200);
    // a long model lists only the first 200: search class by class with the optional parameter "klasse"
    const waende = (await befehl(page, "modell", { klasse: "IfcWall" })).result;
    expect(waende.bauteile.length).toBeGreaterThan(0);
    expect(waende.bauteile.every((b) => b.klasse === "IfcWall")).toBe(true);
    expect(waende.klassen).toEqual(modell.klassen);
    // a wall that really has a name and a storey, so the name/storey assertions below can not pass on two empty values
    const wand = waende.bauteile.find((x) => x.name && x.geschoss);
    expect(wand, "musterprojekt.ifc hat eine benannte Wand mit Geschoss").toBeTruthy();
    expect(wand.guid).toMatch(/^[0-9A-Za-z_$]{22}$/);

    // --- the same words over the HTTP control channel (POST /api/steuerung, answered by this viewer's bridge) ---
    const http = await ueberKanal(request, "h1", "modell", { klasse: "IfcWall" });
    expect(http.status).toBe(200);
    expect(http.json).toMatchObject({ id: "h1", ok: true });
    expect(http.json.result.bauteile.some((b) => b.guid === wand.guid)).toBe(true);
    expect((await ueberKanal(request, "h2", "auswahl-guid", { guid: wand.guid })).json).toMatchObject({ ok: true, result: { anzahl: 1 } });
    const httpLesen = (await ueberKanal(request, "h3", "auswahl-lesen")).json;
    expect(httpLesen.result.bauteile[0]).toMatchObject({ guid: wand.guid, klasse: "IfcWall", name: wand.name });
    expect((await ueberKanal(request, "h4", "auswahl-aufheben")).json.result.anzahl).toBe(0);
    await expect(page.getByTestId("ifc-auswahl-guid")).toHaveCount(0);

    // --- auswahl-guid: the panel shows exactly this GUID, the selection is drawn ---
    const gewaehlt = await befehl(page, "auswahl-guid", { guid: wand.guid });
    expect(gewaehlt.ok, JSON.stringify(gewaehlt)).toBe(true);
    expect(gewaehlt.result.anzahl).toBe(1);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(wand.guid, { timeout: 15000 });
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.ifc.auswahl()?.sichtbar ?? false)).toBe(true);

    // --- auswahl-lesen: the record of that element ---
    const k = (await befehl(page, "auswahl-lesen")).result;
    expect(k.anzahl).toBe(1);
    const b = k.bauteile[0];
    expect(b.guid).toBe(wand.guid);
    expect(b.klasse).toBe("IfcWall");
    expect(b.name).toBe(wand.name);
    expect(b.geschoss).toBe(wand.geschoss);
    expect(Object.keys(b.steckbrief)).toEqual(expect.arrayContaining(["kg", "gewerk", "material", "status", "quelle", "offen"]));
    expect(b.steckbrief.quelle.typ, "der Bauteiltyp eines importierten Elements ist eine Annahme und steht als solche da").toBe("abgeleitet");
    expect(b.steckbrief.gewerk, "Gewerk aus dem Typ: Form {lb, name}").toEqual({ lb: expect.stringMatching(/^\d{3}$/), name: expect.any(String) });
    expect(b.steckbrief.quelle.gewerk).toBe("abgeleitet");
    // what only the type default would know is not passed on as a fact of this imported element
    expect(b.steckbrief.tragend).toBeNull();
    expect(b.steckbrief.gewerkGrob).toBeNull();
    expect(b.steckbrief.quelle.tragend).toBe("offen");
    expect(b.steckbrief.offen).toEqual(expect.arrayContaining(["tragend", "gewerkGrob"]));
    expect(["gesetzt", "offen"], "Menge aus den Modell-Mengen oder offen, nie erfunden").toContain(b.steckbrief.quelle.menge);
    if (b.steckbrief.quelle.menge === "offen") expect(b.steckbrief.menge).toBeNull();
    else expect(b.steckbrief.menge.wert).toBeGreaterThan(0);
    expect(typeof b.steckbrief.label).toBe("string");
    expect(b.bildschirm).not.toBeNull();
    expect(typeof b.bildschirm.x).toBe("number");
    expect(gewaehlt.result.bauteile[0].guid).toBe(b.guid);

    // --- ansicht-auf-auswahl: the element moves to the middle of the canvas, the selection stays ---
    expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: true, result: { anzahl: 1 } });
    await inDerMitte(page, canvas, wand.guid);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(wand.guid);

    // --- commands in ONE tick see each other: no render lag, no stale "Keine Auswahl" and no selection that is already gone ---
    const andereGuid = waende.bauteile.find((x) => x.guid !== wand.guid)?.guid ?? modell.bauteile.find((x) => x.guid !== wand.guid).guid;
    const folge = await kette(page, [
      ["auswahl-guid", { guid: andereGuid }], ["auswahl-guid", { guid: wand.guid }], ["auswahl-lesen"], ["ansicht-auf-auswahl"],
      ["auswahl-aufheben"], ["ansicht-auf-auswahl"], ["auswahl-lesen"],
    ]);
    expect(folge[0].ok && folge[1].ok, JSON.stringify(folge[1])).toBe(true);
    expect(folge[2].result.bauteile.map((x) => x.guid), "im selben Tick gilt die zuletzt gewählte GUID").toEqual([wand.guid]);
    expect(folge[3]).toMatchObject({ ok: true, result: { anzahl: 1 } });
    expect(folge[4].result.anzahl).toBe(0);
    expect(folge[5], "nach dem Aufheben im selben Tick: verweigert, nicht auf die gelöschte Auswahl angewendet").toMatchObject({ ok: false, error: KEINE_AUSWAHL });
    expect(folge[6].result.anzahl).toBe(0);
    await expect(page.getByTestId("ifc-auswahl-guid")).toHaveCount(0);
    expect((await befehl(page, "auswahl-guid", { guid: wand.guid })).ok).toBe(true);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(wand.guid, { timeout: 15000 });

    // --- an unknown GUID is refused and does not change the selection ---
    const fremd = await befehl(page, "auswahl-guid", { guid: "0000000000000000000000" });
    expect(fremd).toMatchObject({ ok: false, error: "Bauteil nicht gefunden: 0000000000000000000000" });
    expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].guid).toBe(wand.guid);
    expect(await befehl(page, "auswahl-guid", {})).toMatchObject({ ok: false, error: "guid fehlt" });

    // --- a second element replaces the first (single selection) ---
    const andere = waende.bauteile.find((x) => x.guid !== wand.guid) ?? modell.bauteile.find((x) => x.guid !== wand.guid);
    expect((await befehl(page, "auswahl-guid", { guid: andere.guid })).result.bauteile[0].guid).toBe(andere.guid);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(andere.guid);
    expect((await befehl(page, "auswahl-lesen")).result.anzahl).toBe(1);

    // --- auswahl-aufheben: 0 selected, panel and blue mesh gone, "dieses" refused again ---
    expect((await befehl(page, "auswahl-aufheben")).result.anzahl).toBe(0);
    await expect(page.getByTestId("ifc-auswahl-guid")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.ifc.auswahl())).toBeNull();
    expect((await befehl(page, "auswahl-lesen")).result.anzahl).toBe(0);
    expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: false, error: KEINE_AUSWAHL });

    // --- a multi selection ("Treffer auswählen") stays the set that was selected, also after another search ---
    const anzahlJeStatus = {};
    for (const k of ["abbruch", "neubau", "bestand", "ohne"]) anzahlJeStatus[k] = Number(((await page.getByTestId(`status-anzahl-${k}`).textContent()) || "").replace(/\D/g, "")) || 0;
    const status = Object.entries(anzahlJeStatus).sort((x, y) => y[1] - x[1])[0];
    expect(status[1], `Status-Zähler: ${JSON.stringify(anzahlJeStatus)}`).toBeGreaterThan(0);
    const statusWahl = page.locator("select").filter({ hasText: "Status: alle" });
    await statusWahl.selectOption(status[0]);
    await page.getByRole("button", { name: "markieren", exact: true }).click();
    await page.getByRole("button", { name: "Treffer auswählen" }).click();
    await expect(page.getByText(/^Auswahl: .* Bauteile$/)).toBeVisible({ timeout: 15000 });
    const menge1 = (await befehl(page, "auswahl-lesen")).result;
    expect(menge1.anzahl).toBeGreaterThan(0);
    expect(menge1.bauteile.length).toBe(Math.min(menge1.anzahl, 200));
    expect(menge1.gekuerzt).toBe(menge1.anzahl > 200);
    const guids1 = menge1.bauteile.map((x) => x.guid);
    // a second search that finds nothing replaces the highlight, not the selection
    await statusWahl.selectOption("");
    await page.getByPlaceholder("KG").fill("999");
    await page.getByRole("button", { name: "markieren", exact: true }).click();
    const menge2 = (await befehl(page, "auswahl-lesen")).result;
    expect(menge2.anzahl, "Ground truth ist die ausgewählte Menge, nicht der letzte Suchtreffer").toBe(menge1.anzahl);
    expect(menge2.bauteile.map((x) => x.guid)).toEqual(guids1);
    await expect(page.getByText(/^Auswahl: .* Bauteile$/)).toBeVisible();
    expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: true, result: { anzahl: menge1.anzahl } });
    expect((await befehl(page, "auswahl-aufheben")).result.anzahl).toBe(0);
    await expect(page.getByText(/^Auswahl: .* Bauteile$/)).toHaveCount(0);

    // --- what a click cannot select, a command does not select either: a status switched off hides the element ---
    const gew = (await befehl(page, "auswahl-guid", { guid: wand.guid })).result.bauteile[0];
    const schluessel = gew.steckbrief.status ?? "ohne";
    await befehl(page, "auswahl-aufheben");
    const schalter = page.getByTestId(`status-sichtbar-${schluessel}`);
    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    const versteckt = await befehl(page, "auswahl-guid", { guid: wand.guid });
    expect(versteckt.ok).toBe(false);
    expect(versteckt.error).toMatch(/Status-Filter ausgeblendet/);
    expect((await befehl(page, "auswahl-lesen")).result.anzahl).toBe(0);
    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    expect((await befehl(page, "auswahl-guid", { guid: wand.guid })).ok).toBe(true);
    await befehl(page, "auswahl-aufheben");

    // --- 106-04: the view as one PNG, through the register and through the control channel (answer limit of its own) ---
    await pngInhalt(page, pngPruefen(await befehl(page, "ansicht-bild", { breite: 640 }), 640));
    expect(await befehl(page, "ansicht-bild", { breite: "breit" })).toMatchObject({ ok: false, error: expect.stringMatching(/breite/) });
    const bildProjekt = await bildZustimmen(page, request);
    const bildHttp = await ueberKanal(request, "i1", "ansicht-bild", { breite: 1600 });
    await request.delete(`/api/llm/bild-zustimmung?projekt_id=${encodeURIComponent(bildProjekt)}`);
    expect(bildHttp.status).toBe(200);
    await pngInhalt(page, pngPruefen(bildHttp.json, 1600));
    // review fix: the answer really was over the old 64 KB limit (the 4 MB answer limit is what lets it through, in the real server chain)
    expect(JSON.stringify(bildHttp.json).length, "die Bildantwort liegt über 64 KB").toBeGreaterThan(64 * 1024);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("BIM-Studio: dieselben Befehle mit einer gezeichneten Wand und einer Hüllwand (GUID wie im IFC-Export)", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Auswahl 10602";
    const WAND_GUID = "AuswahlWand10602abcdef"; // 22 characters: a stored GUID wins over the derived one (bauteilGuid)
    expect(WAND_GUID).toHaveLength(22);
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        // beside the default hull, like zeigen-106-01
        customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, composite: "cavity", _idx: 1, guid: WAND_GUID, status: "neubau", kg: "341" }],
      } });

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      const canvas = page.locator("canvas:visible").first();
      await expect(canvas).toBeVisible({ timeout: 60000 });
      await befehlsliste(page);

      // --- nothing selected: refused with the plain text ---
      expect((await befehl(page, "auswahl-lesen")).result).toEqual({ anzahl: 0, gekuerzt: false, ohneGuid: 0, bauteile: [] });
      expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: false, error: KEINE_AUSWAHL });

      // --- modell lists the drawn wall (loaded asynchronously) and the generated hull walls ---
      let modell = null;
      await expect.poll(async () => { modell = (await befehl(page, "modell")).result; return modell.bauteile.some((b) => b.guid === WAND_GUID); }, { timeout: 30000 }).toBe(true);
      expect(modell.klassen.IfcWall).toBeGreaterThan(1);
      expect(modell.geschosse.length).toBeGreaterThan(0);
      const huelle = modell.bauteile.find((b) => b.klasse === "IfcWall" && b.guid !== WAND_GUID);
      expect(huelle.guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
      // every element of the list has a readable name (own name or the type label, like the IFC export), also the generated ones
      expect(modell.bauteile.every((b) => typeof b.name === "string" && b.name.length > 0), JSON.stringify(modell.bauteile.filter((b) => !b.name))).toBe(true);
      // the hull slabs the export writes with a GUID are listed, but a click cannot select them: refused with the reason
      const platte = modell.bauteile.find((b) => b.klasse === "IfcSlab" && b.waehlbar === false);
      expect(platte, "Hüllplatten stehen im Modell-Ergebnis").toBeTruthy();
      expect(modell.klassen.IfcSlab).toBeGreaterThan(0);
      const platteWahl = await befehl(page, "auswahl-guid", { guid: platte.guid });
      expect(platteWahl.ok).toBe(false);
      expect(platteWahl.error).toMatch(/Bauteil nicht wählbar/);
      expect((await befehl(page, "auswahl-lesen")).result.anzahl).toBe(0);

      // --- auswahl-guid on the drawn wall: panel + record ---
      const gewaehlt = await befehl(page, "auswahl-guid", { guid: WAND_GUID });
      expect(gewaehlt.ok, JSON.stringify(gewaehlt)).toBe(true);
      await expect(page.getByText(/^Wand · Attribute/)).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result.anzahl).toBe(1);
      const b = (await befehl(page, "auswahl-lesen")).result.bauteile[0];
      expect(b.guid).toBe(WAND_GUID);
      expect(b.klasse).toBe("IfcWall");
      expect(b.geschoss).toBe("EG");
      expect(b.name).toBe("Außenwand");
      expect(b.steckbrief.label).toBe("Außenwand");
      expect(b.steckbrief.menge.wert, "Menge aus der Wandgeometrie (12 m x 3 m)").toBe(36);
      expect(b.steckbrief.status).toBe("neubau");
      expect(b.steckbrief.kg).toBe("341");
      expect(b.steckbrief.quelle.kg).toBe("gesetzt");
      expect(b.bildschirm).not.toBeNull();
      // the selection is drawn (aura) — the same state a click sets
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bim.auswahl().aura.length)).toBeGreaterThan(0);

      // --- ansicht-auf-auswahl frames the wall: its screen position goes to the middle ---
      expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: true, result: { anzahl: 1 } });
      await inDerMitte(page, canvas, WAND_GUID);

      // --- commands in ONE tick see each other (the studio's selection lives in React state, the commands read a synchronous mirror) ---
      const folge = await kette(page, [
        ["auswahl-aufheben"], ["ansicht-auf-auswahl"], ["auswahl-guid", { guid: huelle.guid }], ["auswahl-guid", { guid: WAND_GUID }],
        ["auswahl-lesen"], ["ansicht-auf-auswahl"], ["auswahl-aufheben"], ["ansicht-auf-auswahl"], ["auswahl-lesen"],
      ]);
      expect(folge[1], "aufgehoben im selben Tick: verweigert").toMatchObject({ ok: false, error: KEINE_AUSWAHL });
      expect(folge[2].ok && folge[3].ok, JSON.stringify(folge[3])).toBe(true);
      expect(folge[4].result.bauteile.map((x) => x.guid), "im selben Tick gilt die zuletzt gewählte GUID").toEqual([WAND_GUID]);
      expect(folge[5]).toMatchObject({ ok: true, result: { anzahl: 1 } });
      expect(folge[7]).toMatchObject({ ok: false, error: KEINE_AUSWAHL });
      expect(folge[8].result.anzahl).toBe(0);
      expect((await befehl(page, "auswahl-guid", { guid: WAND_GUID })).ok).toBe(true);

      // --- the same words over the HTTP control channel (answered by this studio's bridge) ---
      const http = await ueberKanal(request, "b1", "auswahl-lesen");
      expect(http.status).toBe(200);
      expect(http.json.result.bauteile[0]).toMatchObject({ guid: WAND_GUID, klasse: "IfcWall", name: "Außenwand" });
      const b2 = await ueberKanal(request, "b2", "auswahl-aufheben"); expect(b2.json.result?.anzahl, JSON.stringify(b2)).toBe(0);
      expect((await ueberKanal(request, "b3", "auswahl-guid", { guid: WAND_GUID })).json).toMatchObject({ ok: true, result: { anzahl: 1 } });

      // --- unknown GUID: refused, selection unchanged ---
      expect(await befehl(page, "auswahl-guid", { guid: "0000000000000000000000" })).toMatchObject({ ok: false, error: "Bauteil nicht gefunden: 0000000000000000000000" });
      expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].guid).toBe(WAND_GUID);

      // --- a generated hull wall is addressable by the GUID the export gives it ---
      const h = await befehl(page, "auswahl-guid", { guid: huelle.guid });
      expect(h.ok, JSON.stringify(h)).toBe(true);
      expect(h.result.bauteile[0].steckbrief.menge.wert, "Hüllwand: Menge aus der Wand des Modells, nicht 0").toBeGreaterThan(0);
      await expect(page.getByText(/^Hüllwand · Attribute/)).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result.bauteile[0]?.guid).toBe(huelle.guid);
      expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: true, result: { anzahl: 1 } });

      // --- auswahl-aufheben ---
      expect((await befehl(page, "auswahl-aufheben")).result.anzahl).toBe(0);
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result.anzahl).toBe(0);
      await expect(page.getByText(/· Attribute/)).toHaveCount(0);
      expect(await befehl(page, "ansicht-auf-auswahl")).toMatchObject({ ok: false, error: KEINE_AUSWAHL });

      // --- 106-04: the 3D view as one PNG (register and control channel) ---
      await pngInhalt(page, pngPruefen(await befehl(page, "ansicht-bild", { breite: 640 }), 640));
      await bildZustimmen(page, request);
      const bildHttp = await ueberKanal(request, "bi1", "ansicht-bild", { breite: 1600 });
      expect(bildHttp.status).toBe(200);
      await pngInhalt(page, pngPruefen(bildHttp.json, 1600));
      expect(JSON.stringify(bildHttp.json).length, "die Bildantwort liegt über 64 KB").toBeGreaterThan(64 * 1024);

      // review fix: in the plan view the canvas is hidden - the studio refuses with the reason (register and control channel), then 3D works again
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      const imPlan = await befehl(page, "ansicht-bild", { breite: 640 });
      expect(imPlan.ok).toBe(false);
      expect(imPlan.error).toMatch(/nur in der 3D-Ansicht/);
      expect(imPlan.error).toMatch(/grundriss/);
      const planHttp = await ueberKanal(request, "bi2", "ansicht-bild", { breite: 640 });
      expect(planHttp.json).toMatchObject({ ok: false, error: expect.stringMatching(/nur in der 3D-Ansicht/) });
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await expect.poll(async () => (await befehl(page, "ansicht-bild", { breite: 640 })).ok, { timeout: 15000 }).toBe(true);

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (id != null) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
