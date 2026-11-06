// Headless proof 106-08: the model in VR through WebXR - with a WebXR STAND-IN (fixtures/xrAttrappe.js), not with a headset.
// What is proved in a real browser, through three's real WebXRManager and the app's real code:
// - without a WebXR device there is no "In VR ansehen" button (no dead button); a refused start is said in words;
// - the session starts (reference space local-floor), the desktop loop pauses, the session renders;
// - the controller ray goes into the same pick core as the mouse: the hovered element is the desktop hover record, the trigger selects it
//   (same GUID in the selection panel);
// - holding the grip = holding the speech button of 106-05 (fake microphone + stand-in recognition): the heard sentence becomes a PROPOSAL
//   that stands on the floating panel, nothing changes; the controller ray on "Übernehmen" + trigger confirms it - origin "sprache",
//   confirmed by "hand" (D-IM-04); the panel switches to the table model and ends the session; the desktop camera comes back.
// - BIM studio: table model, the controller ray on a drawn wall hovers and selects exactly that wall's GUID.
// Not proved (D-IM-03 / D-AW-04): a real headset, its tracking, its browser, real hand tracking - "nicht am Gerät abgenommen".
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { xrAttrappe } from "./fixtures/xrAttrappe.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";

const HARNESS = "http://127.0.0.1:8765";
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };

/** 1.5 s of a 440 Hz tone, 16 kHz mono 16-bit PCM: what the fake microphone plays into a recording (as in sprechen-106-05). */
function wavSchreiben() {
  const rate = 16000;
  const n = Math.round(rate * 1.5);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  const datei = path.join(os.tmpdir(), "bit-vr-10608.wav");
  fs.writeFileSync(datei, buf);
  return datei;
}
const WAV = wavSchreiben();

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`] } });

/** Console watch: only the known headless WebGL messages and the absent harness are tolerated. */
function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm|8765/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** The harness stand-in (as in sprechen-106-05): /status says speech is ready, /stt answers the queued transcripts. */
async function harnessFake(page) {
  const h = { saetze: /** @type {string[]} */ ([]), uploads: 0 };
  const status = { provider: "lokal", provider_lokal: true, nur_lokal: false, stt: { verfuegbar: true, bereit: true }, mcp: { aktiv: true, verbunden: false, werkzeuge: [], hinweis: "" } };
  await page.route(`${HARNESS}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/status") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(status) });
    if (url.pathname === "/stt" && route.request().method() === "POST") {
      h.uploads += 1;
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ text: h.saetze.shift() ?? "", dauer_s: 0.1, modell: "attrappe" }) });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  return h;
}

const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);
/** window.__bitZeigen[hook][fn](...args) */
const haken = (page, hook, fn, ...args) => page.evaluate(([h, f, a]) => /** @type {any} */ (window).__bitZeigen?.[h]?.[f]?.(...a) ?? null, [hook, fn, args]);
/** window.__xrAttrappe[fn](...args) */
const xr = (page, fn, ...args) => page.evaluate(([f, a]) => /** @type {any} */ (window).__xrAttrappe[f](...a), [fn, args]);
/** Waits until the session ran a few more frames (the stand-in counts them). */
async function frames(page, n = 3) {
  const start = await page.evaluate(() => /** @type {any} */ (window).__xrAttrappe.zustand.frames);
  await page.waitForFunction((s) => /** @type {any} */ (window).__xrAttrappe.zustand.frames >= s, start + n, { timeout: 10000 });
}
/** Points controller 0 at a panel button (from 0.4 m in front of it) and waits until the ray lies on it. */
async function aufKnopf(page, hook, id) {
  const ziel = await haken(page, hook, "knopfMitteReferenz", id);
  expect(ziel, `Knopf ${id} auf der Tafel`).not.toBeNull();
  await xr(page, "zeigen", 0, [ziel[0] + 0.12, ziel[1] + 0.05, ziel[2] + 0.4], ziel);
  await expect.poll(async () => (await haken(page, hook, "letzte"))?.ergebnisse?.[0]?.knopf ?? null).toBe(id);
}
/** Trigger press and release, a few frames each (the session reads edges per frame). */
async function abzug(page) {
  await xr(page, "druecken", 0, 0, true);
  await frames(page);
  await xr(page, "druecken", 0, 0, false);
  await frames(page);
}

test.describe("106-08 VR: das Modell im Headset (WebXR-Attrappe), Strahl vom Controller, Sprechen, Bestätigen", () => {
  test.setTimeout(300000);

  test("ohne WebXR-Gerät: kein Knopf, Grund nur im Testhaken", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = wache(page);
    await page.addInitScript(xrAttrappe, { geraet: false });
    await page.goto("/IfcViewer?beispiel=1");
    await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
    await expect.poll(async () => (await haken(page, "ifcXr", "verfuegbarkeit"))?.grund ?? null).toBe("VR nicht verfügbar: kein VR-Gerät gefunden");
    await expect(page.getByTestId("xr-knopf")).toHaveCount(0);
    await expect(page.getByTestId("xr-start")).toHaveCount(0);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("IFC-Viewer: verweigerter Start im Klartext; Strahl -> Hover -> Auswahl; Griff = Sprechen -> Vorschlag auf der Tafel -> Übernehmen per Strahl; Tisch; Ende", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    const h = await harnessFake(page);
    await page.addInitScript(xrAttrappe, {});
    await page.goto("/IfcViewer?beispiel=1");
    await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 30000 });
    await expect(page.getByTestId("xr-start")).toBeVisible();
    const kameraVorher = await haken(page, "ifc", "kamera");

    // 1. refused by the browser: said in words, no session
    await page.evaluate(() => { /** @type {any} */ (window).__xrAttrappe.zustand.erlaubt = false; });
    await page.getByTestId("xr-start").click();
    await expect(page.getByTestId("xr-fehler")).toContainText("VR konnte nicht starten: der Browser hat die Sitzung nicht erlaubt");
    expect(await haken(page, "ifcXr", "laeuft")).toBe(false);

    // 2. allowed: the session runs, local-floor, 1:1
    await page.evaluate(() => { /** @type {any} */ (window).__xrAttrappe.zustand.erlaubt = true; });
    await page.getByTestId("xr-start").click();
    await expect(page.getByTestId("xr-laeuft")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("xr-fehler")).toHaveCount(0);
    expect(await haken(page, "ifcXr", "referenzraum")).toBe("local-floor");
    expect((await haken(page, "ifcXr", "rig")).massstab).toBe(1);
    await frames(page, 5);
    // review 106-08: while the headset presents, no image of the view goes anywhere - the agent's tool (ansicht-bild) is refused in words
    const bild = await befehl(page, "ansicht-bild");
    expect(bild.ok).toBe(false);
    expect(String(bild.error)).toContain("solange die VR-Brille das Modell zeigt");
    // review 106-08: the panel is drawn over the model and its highlights (no depth test, last in the transparent pass)
    expect(await haken(page, "ifcXr", "tafelDarstellung")).toMatchObject({ depthTest: false, transparent: true, renderOrder: 2000 });

    // 3. the controller ray: sweep from the hand until the ray rests on a wall; hover = the desktop hover record, the same pick core
    expect(await xr(page, "verbinden", 0)).toBe(true);
    let wand = null;
    suche: for (const hoehe of [1.4, 1.0, 2.2, 0.6]) {
      for (const seite of [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45]) {
        await xr(page, "zeigen", 0, [0, 1.4, -0.2], [seite * 3, hoehe, -3.2]);
        await frames(page, 2);
        const hv = await haken(page, "ifc", "hover");
        if (hv && /IfcWall/.test(hv.typ)) { wand = hv; break suche; }
      }
    }
    expect(wand, "der Strahl findet eine Wand des Musterprojekts").not.toBeNull();
    const letzte = await haken(page, "ifcXr", "letzte");
    expect(letzte.hoverGuid).toBe(wand.guid);
    expect(letzte.ergebnisse[0]).toMatchObject({ ziel: "bauteil", guid: wand.guid });
    expect(await haken(page, "ifc", "markiert", "fokus")).toBeGreaterThan(0);
    await expect.poll(async () => (await haken(page, "ifcXr", "tafel"))?.zeilen?.[0]?.text ?? "").toContain(wand.typ);
    // trigger = click: the selection panel shows the GUID from the ray
    await abzug(page);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(wand.guid);
    expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].guid).toBe(wand.guid);

    // 4. speech: hold the grip -> the speech button of 106-05 records; the sentence becomes a proposal on the panel; nothing changes
    h.saetze.push("setze Brandschutz auf F180");
    await xr(page, "druecken", 0, 1, true);
    await expect(page.getByTestId("sprech-knopf")).toHaveAttribute("data-zustand", "aufnahme", { timeout: 10000 });
    await expect.poll(async () => JSON.stringify((await haken(page, "ifcXr", "tafel"))?.zeilen ?? [])).toContain("Aufnahme");
    await page.waitForTimeout(1200);
    await xr(page, "druecken", 0, 1, false);
    await expect(page.getByTestId("sprech-gehoert")).toContainText("setze Brandschutz auf F180", { timeout: 15000 });
    expect(h.uploads).toBe(1);
    await expect.poll(async () => JSON.stringify((await haken(page, "ifcXr", "tafel"))?.zeilen ?? []), { timeout: 15000 }).toContain("F180");
    const tafel = await haken(page, "ifcXr", "tafel");
    expect(tafel.zeilen.some((z) => z.text.includes("Herkunft: Spracheingabe"))).toBe(true);
    expect(tafel.knoepfe.find((k) => k.id === "uebernehmen")?.aktiv).toBe(true);
    expect((await befehl(page, "vorschlaege")).result.verlauf.length, "nothing executed before the person confirms").toBe(0);

    // 5. the person confirms: ray on "Übernehmen" + trigger
    await aufKnopf(page, "ifcXr", "uebernehmen");
    expect((await befehl(page, "vorschlaege")).result.verlauf.length, "pointing at the button changes nothing").toBe(0);
    await abzug(page);
    await expect.poll(async () => (await befehl(page, "vorschlaege")).result.verlauf.length).toBe(1);
    const schritt = (await befehl(page, "vorschlaege")).result.verlauf.at(-1);
    expect(schritt).toMatchObject({ art: "eigenschaft", herkunft: "sprache", bestaetigt_durch: "hand", zurueckgenommen: null });
    await expect.poll(async () => JSON.stringify((await haken(page, "ifcXr", "tafel"))?.zeilen ?? [])).toContain("Übernommen");
    // clean up the journal entry again (a person at the window)
    expect((await befehl(page, "rueckgaengig", { vorschlag_id: schritt.vorschlag_id })).ok).toBe(true);

    // 6. the panel switches to the table model: the person becomes a giant, the model 1 m wide
    await aufKnopf(page, "ifcXr", "massstab");
    await abzug(page);
    await expect.poll(async () => await haken(page, "ifcXr", "modus")).toBe("tisch");
    expect((await haken(page, "ifcXr", "rig")).massstab).toBeGreaterThan(5);
    // review 106-08: at the table scale the panel floats higher (above the usual table model) and is still drawn over everything
    expect(await haken(page, "ifcXr", "tafelDarstellung")).toMatchObject({ depthTest: false, renderOrder: 2000, ort: [-0.32, 1.48, -0.75] });

    // 7. "VR beenden" on the panel: the session ends, the desktop camera comes back, the button is there again
    await aufKnopf(page, "ifcXr", "beenden");
    await abzug(page).catch(() => {}); // the frames stop with the session
    await expect(page.getByTestId("xr-start")).toBeVisible({ timeout: 10000 });
    expect(await haken(page, "ifcXr", "laeuft")).toBe(false);
    const kameraNachher = await haken(page, "ifc", "kamera");
    expect(Math.abs(kameraNachher.abstand - kameraVorher.abstand)).toBeLessThan(0.05);
    expect(Math.abs(kameraNachher.azimutRad - kameraVorher.azimutRad)).toBeLessThan(0.05);
    // review 106-08: three wrote the headset's field of view into the camera every XR frame - the desktop gets its own back
    expect(kameraVorher.fovGrad).toBe(50);
    expect(kameraNachher.fovGrad, "the desktop field of view, not the headset's").toBe(kameraVorher.fovGrad);
    expect(kameraNachher.zoom).toBe(kameraVorher.zoom);
    // and images of the view are possible again
    expect((await befehl(page, "ansicht-bild", { breite: 200 })).ok).toBe(true);
    expect(await page.evaluate(() => /** @type {any} */ (window).__xrAttrappe.zustand.sitzung)).toBeNull();
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("BIM-Studio: Tischmodell, Strahl auf die gezeichnete Wand -> genau deren GUID, Abzug wählt sie; VR beenden am Bildschirm", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E VR 10608";
    let id = null;
    try {
      await nurLocalhost(page);
      await page.route(`${HARNESS}/**`, (route) => route.fulfill({ status: 404, headers: CORS, body: "{}" }));
      const warnungen = wache(page);
      await page.addInitScript(xrAttrappe, {});
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        // beside the default hull, so the drawn wall is not hidden behind it (as in zeigen-106-01 / tablet-106-07)
        customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, status: "neubau" }],
      } });
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.getByTestId("xr-start")).toBeVisible({ timeout: 30000 });
      await page.getByTestId("xr-modus-tisch").click();
      await page.getByTestId("xr-start").click();
      await expect(page.getByTestId("xr-laeuft")).toBeVisible({ timeout: 15000 });
      expect(await haken(page, "bimXr", "modus")).toBe("tisch");
      const rig = await haken(page, "bimXr", "rig");
      expect(rig.massstab).toBeGreaterThan(5);
      await frames(page, 5);
      await xr(page, "verbinden", 0);
      // aim from the hand at the middle of the drawn wall (world 20 / 1.5 / -16, plan x/z) converted into the reference space
      const ziel = await haken(page, "bimXr", "weltZuReferenz", [20, 1.5, -16]);
      await xr(page, "zeigen", 0, [0.1, 1.3, -0.15], ziel);
      await expect.poll(async () => (await haken(page, "bimXr", "letzte"))?.hoverGuid ?? null, { timeout: 10000 }).not.toBeNull();
      const hover = await haken(page, "bim", "hover");
      const letzte = await haken(page, "bimXr", "letzte");
      expect(letzte.hoverGuid).toBe(hover.guid);
      await abzug(page);
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result?.bauteile?.[0]?.guid ?? null).toBe(hover.guid);
      expect(hover, "the ray hit the drawn wall (kind wall, id 1), not the hull or the context").toMatchObject({ quelle: "bim", kind: "wall", id: 1 });
      expect(hover.guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
      // ending from the screen (a second person at the desk)
      await page.getByTestId("xr-beenden").click();
      await expect(page.getByTestId("xr-start")).toBeVisible({ timeout: 10000 });
      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      if (id) await request.delete(`/api/entities/Project/${id}`);
    }
  });
});
