// Headless proof 106-07: the tablet at the model - pen and finger in the BIM studio and the IFC viewer.
// The browser runs with touch emulation (hasTouch); the pen comes as REAL pen pointer events of the browser (CDP
// Input.dispatchMouseEvent with pointerType "pen"), fingers as real touch points (page.touchscreen.tap and CDP
// Input.dispatchTouchEvent for two fingers). Proved here:
//  - a pen hovering over the model shows the focus (overlay in words, 'fokus' highlight), a pen tap selects;
//  - a finger tap selects / deselects; two fingers pinch (distance changes) and twist (azimuth changes) the view, and the
//    last finger lifting after the gesture selects nothing; one finger dragging orbits;
//  - as soon as pen or finger is used, the speech button is big (>= 60 px), round and at the outer right end of the speech
//    field in the bottom right corner of the SCREEN; a mouse click switches the layout back;
//  - a proposal is confirmed by a finger tap on "Übernehmen" (a person confirms, D-IM-04): the step says "hand".
// Review 106-07: on tablet screens (1180 x 820 landscape, 820 x 1180 portrait, 1024 x 768) the speech button and "Übernehmen" lie
// inside the visible part of the page WITHOUT scrolling; the twist turns both viewers the same way (world azimuth of the camera,
// atan2(x, z), grows for fingers turning clockwise); the first finger after the mouse switches the layout in the same press without
// re-building the speech button - its release still ends the recording (fake microphone, harness stand-in).
// Not proved here, on purpose: a real pen tablet and a real touch screen (nicht am Gerät abgenommen, D-AW-04); the control
// channel of a paired device (office mode needs a LAN address and its own server - unit test tablet-10607 covers the router);
// the rights lock of "Übernehmen" (no local role sees the viewer without modell: voll - unit test covers it); the capture radius
// beside an edge (unit test zeigerPick).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";

/** 1.5 s of a 440 Hz tone, 16 kHz mono 16-bit PCM: what the fake microphone plays into a recording (same file form as sprechen-106-05). */
function wavSchreiben() {
  const rate = 16000;
  const n = Math.round(rate * 1.5);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  const datei = path.join(os.tmpdir(), "bit-tablet-10607.wav");
  fs.writeFileSync(datei, buf);
  return datei;
}
const WAV = wavSchreiben();

test.use({ hasTouch: true, launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`] } });

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };

/** Console watch: only the known headless WebGL messages and the absent harness (port 8765) are tolerated. */
function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm|8765/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** The harness is not running in this test: its address answers 404 (the speech field then says so in words). */
async function ohneHarness(page) {
  await page.route("http://127.0.0.1:8765/**", (route) => route.fulfill({ status: 404, headers: CORS, body: "{}" }));
}

/** Calls window.__bitZeigen[viewer][fn](...args). */
const zeigen = (page, viewer, fn, ...args) => page.evaluate(([v, f, a]) => /** @type {any} */ (window).__bitZeigen[v][f](...a), [viewer, fn, args]);
/** One command through the register (a person at the window). */
const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);

/** GUID of the (first) selected element, null without a selection. */
const auswahlGuid = async (page) => {
  const r = await befehl(page, "auswahl-lesen");
  return r.ok ? r.result?.bauteile?.[0]?.guid ?? null : null;
};

/**
 * The pen: real pen pointer events of the browser. mouseMoved without a button = hovering above the glass.
 * @param {import("@playwright/test").CDPSession} cdp
 */
const stift = (cdp) => ({
  schweben: (x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, pointerType: "pen", button: "none", buttons: 0 }),
  tippen: async (x, y) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, pointerType: "pen", button: "none", buttons: 0 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, pointerType: "pen", button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, pointerType: "pen", button: "left", buttons: 0, clickCount: 1 });
  },
});

/**
 * Two fingers around a middle: start at radius r0 / angle w0, move in `schritte` steps to r1 / w1 (px, rad), lift both.
 * @param {import("@playwright/test").CDPSession} cdp
 */
async function zweiFinger(cdp, mitte, { r0, r1, w0 = 0, w1 = 0, schritte = 8 }) {
  const punkte = (r, w) => [
    { x: mitte.x - Math.cos(w) * r, y: mitte.y - Math.sin(w) * r, id: 0 },
    { x: mitte.x + Math.cos(w) * r, y: mitte.y + Math.sin(w) * r, id: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: punkte(r0, w0) });
  for (let i = 1; i <= schritte; i++) {
    const k = i / schritte;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: punkte(r0 + (r1 - r0) * k, w0 + (w1 - w0) * k) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** One finger dragging from a to b (px). */
async function einFinger(cdp, a, b, schritte = 8) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...a, id: 0 }] });
  for (let i = 1; i <= schritte; i++) {
    const k = i / schritte;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, id: 0 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Moves the hovering pen over a grid inside the canvas until the viewer reports a matching element under it. */
async function stiftSuchen(page, s, canvas, viewer, passt = () => true) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas hat keine Groesse");
  for (let zeile = 0; zeile < 9; zeile += 1) {
    for (let spalte = 0; spalte < 13; spalte += 1) {
      const x = box.x + box.width * (0.15 + (0.7 * spalte) / 12);
      const y = box.y + box.height * (0.15 + (0.7 * zeile) / 8);
      await s.schweben(x, y);
      await page.waitForTimeout(70); // one pick per animation frame
      const hover = await zeigen(page, viewer, "hover");
      if (hover && passt(hover)) return { x, y, hover };
    }
  }
  throw new Error("Kein passendes Bauteil unter dem Stift gefunden (Gitter 13 x 9)");
}

/** Box of an element in the visible part of the page (viewport px) - null when it is outside or has no size. */
const imBild = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, b: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight, scrollY: window.scrollY };
});

/**
 * Big, round, at the outer right end of its row, in the bottom right corner of the SCREEN (review 106-07: of the visible part of the
 * page, not of the view - the view may reach below it): where the right thumb rests, without scrolling.
 */
async function knopfDaumengerecht(page) {
  await expect(page.getByTestId("sprech-feld")).toHaveAttribute("data-grob", "ja");
  const knopf = page.getByTestId("sprech-knopf");
  await expect(knopf).toHaveAttribute("data-gross", "ja");
  const k = await imBild(knopf);
  const z = await page.getByTestId("sprech-zeile").boundingBox();
  expect(k.b).toBeGreaterThanOrEqual(60);
  expect(k.h).toBeGreaterThanOrEqual(60);
  expect(z.x + z.width - (k.x + k.b), "der Knopf ist das letzte Element der Zeile (rechts außen)").toBeLessThan(4);
  expect(k.x, "ganz im Bild (links)").toBeGreaterThanOrEqual(0);
  expect(k.y, "ganz im Bild (oben)").toBeGreaterThanOrEqual(0);
  expect(k.x + k.b, "ganz im Bild (rechts)").toBeLessThanOrEqual(k.vw);
  expect(k.y + k.h, "ganz im Bild (unten), ohne Scrollen").toBeLessThanOrEqual(k.vh);
  expect(k.vw - (k.x + k.b), "rechter Bildschirmrand").toBeLessThan(40);
  expect(k.vh - (k.y + k.h), "unterer Bildschirmrand").toBeLessThan(60);
  expect(await knopf.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe("0px");
}

/** Signed difference of two angles in rad, folded into (-PI, PI]. */
const winkelDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

test.describe("106-07 Tablet: Stift-Zeiger, Antippen, Sprech-Overlay (Touch- und Stift-Emulation, nicht am Gerät abgenommen)", () => {
  test.setTimeout(300000);

  test("BIM-Studio: Stift schwebt und tippt, Finger tippt, zwei Finger zoomen und drehen, Übernehmen per Fingertipp", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Tablet 10607";
    let id = null;
    try {
      await nurLocalhost(page);
      await ohneHarness(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        // beside the default hull, so the drawn wall is not hidden behind it (as in zeigen-106-01)
        customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, status: "neubau" }],
      } });

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bim && /** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      const canvas = page.locator("canvas:visible").first();
      await expect(canvas).toBeVisible({ timeout: 60000 });
      let box = await canvas.boundingBox();
      const cdp = await page.context().newCDPSession(page);
      const s = stift(cdp);
      // a touch device (the emulation reports "(pointer: coarse)") starts in the tablet layout before any pointer was used
      const grobAmStart = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
      await expect(page.getByTestId("sprech-feld")).toHaveAttribute("data-grob", grobAmStart ? "ja" : "nein");

      // The studio turns the model until the first press: a pen tap on an empty corner stops it.
      await s.tippen(box.x + 4, box.y + 4);

      // --- Pen hover: the element in words, GUID from the ray, 'fokus' highlight ---
      const { x, y, hover } = await stiftSuchen(page, s, canvas, "bim", (h) => h.kind === "wall");
      expect(hover.guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
      expect(hover.zustand).toBe("fokus");
      expect((await zeigen(page, "bim", "zeiger")).art).toBe("pen");
      await expect(page.getByTestId("zeigen-hover")).toBeVisible();
      await expect(page.getByTestId("zeigen-hover")).toContainText("Unter dem Zeiger");
      expect(await zeigen(page, "bim", "markiert", "fokus")).toBeGreaterThan(0);

      // --- The pen is in use: tablet layout, speech button big and where the thumb is ---
      await knopfDaumengerecht(page);

      // --- Pen tap selects the hovered wall ---
      await s.tippen(x, y);
      await expect.poll(() => auswahlGuid(page)).toBe(hover.guid);
      expect((await zeigen(page, "bim", "auswahl")).aura.length).toBeGreaterThan(0);

      // --- Finger tap on the empty corner deselects, a finger tap on the wall selects again ---
      await page.touchscreen.tap(box.x + 4, box.y + 4);
      await expect.poll(() => auswahlGuid(page)).toBeNull();
      expect((await zeigen(page, "bim", "zeiger")).art).toBe("touch");
      await page.touchscreen.tap(x, y);
      await expect.poll(() => auswahlGuid(page)).toBe(hover.guid);

      // --- A proposal, confirmed by a finger tap on "Übernehmen" (finger-size button) ---
      await page.getByTestId("sprech-eingabe").fill("setze Brandschutz auf F90");
      await page.getByTestId("sprech-eingabe").press("Enter");
      const karte = page.getByTestId("aenderung-vorschau");
      await expect(karte).toHaveCount(1);
      await expect(page.getByTestId("aenderung-satz")).toContainText("F90");
      await expect(page.getByTestId("aenderung-recht")).toHaveCount(0); // the owner may change the model
      // review 106-07: on tablet screens the speech button and "Übernehmen" are reachable WITHOUT scrolling (fixed to the screen)
      for (const [b, h] of [[1024, 768], [820, 1180], [1180, 820]]) {
        await page.setViewportSize({ width: b, height: h });
        await page.evaluate(() => window.scrollTo(0, 0));
        await knopfDaumengerecht(page);
        const u = await imBild(page.getByTestId("aenderung-uebernehmen"));
        expect(u.scrollY, "nicht gescrollt").toBe(0);
        expect(u.y + u.h, `Übernehmen ohne Scrollen im Bild (${b} x ${h})`).toBeLessThanOrEqual(u.vh);
        expect(u.x + u.b, `Übernehmen im Bild (${b} x ${h})`).toBeLessThanOrEqual(u.vw);
        expect(u.x).toBeGreaterThanOrEqual(0);
        const k = await imBild(page.getByTestId("sprech-knopf"));
        expect(u.x + u.b <= k.x || u.y + u.h <= k.y, "Karte und Sprech-Knopf überdecken sich nicht").toBe(true);
      }
      const ueb = await page.getByTestId("aenderung-uebernehmen").boundingBox();
      expect(ueb.height, "Übernehmen in Fingergröße").toBeGreaterThanOrEqual(44);
      expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].steckbrief.feuerwiderstand ?? null, "vor dem Tipp nichts geändert").not.toBe("F90");
      await page.touchscreen.tap(ueb.x + ueb.width / 2, ueb.y + ueb.height / 2);
      await expect(karte).toHaveCount(0);
      const verlauf = (await befehl(page, "vorschlaege")).result.verlauf;
      expect(verlauf.at(-1).bestaetigt_durch, "die Person hat per Fingertipp übernommen").toBe("hand");
      expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].steckbrief.feuerwiderstand).toBe("F90");
      await page.setViewportSize({ width: 1400, height: 1000 });

      // --- Two fingers: spread (zoom in) and twist by 30 degrees; nothing is selected by the gesture ---
      await canvas.scrollIntoViewIfNeeded();
      box = await canvas.boundingBox(); // the page may have scrolled for the card
      const vorher = await zeigen(page, "bim", "kamera");
      const mitte = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.4 };
      await zweiFinger(cdp, mitte, { r0: 60, r1: 120, w0: 0, w1: Math.PI / 6 });
      const nachher = await zeigen(page, "bim", "kamera");
      expect(nachher.radius, "auseinander = näher heran").toBeLessThan(vorher.radius * 0.7);
      // review 106-07: the same reference as the IFC viewer - fingers clockwise = world azimuth of the camera grows by about 30 degrees
      const dAzimutBim = winkelDiff(nachher.azimutRad, vorher.azimutRad);
      expect(dAzimutBim, "gedreht um etwa +30 Grad (Weltazimut)").toBeGreaterThan(0.4);
      expect(dAzimutBim).toBeLessThan(0.65);
      const geste = (await zeigen(page, "bim", "zeiger")).geste;
      expect(geste.schritte).toBeGreaterThan(0);
      expect(geste.faktor).toBeGreaterThan(1.8);
      expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].guid, "die Geste wählt nichts").toBe(hover.guid);

      // --- One finger dragging orbits, it does not select ---
      const vorDreh = await zeigen(page, "bim", "kamera");
      await einFinger(cdp, { x: mitte.x, y: mitte.y + 120 }, { x: mitte.x + 120, y: mitte.y + 120 });
      expect(Math.abs((await zeigen(page, "bim", "kamera")).theta - vorDreh.theta)).toBeGreaterThan(0.3);
      expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].guid).toBe(hover.guid);

      // --- A mouse click switches the layout back ---
      await page.mouse.click(box.x + 6, box.y + 6);
      await expect(page.getByTestId("sprech-feld")).toHaveAttribute("data-grob", "nein");
      await expect(page.getByTestId("sprech-knopf")).toHaveAttribute("data-gross", "nein");

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });

  test("IFC-Viewer: Stift schwebt und tippt, zwei Finger zoomen und drehen ohne Auswahl, Fingertipp wählt", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    await ohneHarness(page);
    const warnungen = wache(page);

    await page.goto("/IfcViewer?beispiel=1");
    await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.ifc), null, { timeout: 30000 });
    const canvas = page.locator("canvas:visible").first();
    const box = await canvas.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const s = stift(cdp);

    // --- Pen hover and pen tap ---
    const { x, y, hover } = await stiftSuchen(page, s, canvas, "ifc");
    expect(hover.guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
    expect(hover.zustand).toBe("fokus");
    expect((await zeigen(page, "ifc", "zeiger")).art).toBe("pen");
    await expect(page.getByTestId("zeigen-hover")).toContainText("Unter dem Zeiger");
    await knopfDaumengerecht(page);
    await s.tippen(x, y);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(hover.guid, { timeout: 15000 });

    // --- Two fingers: spread and twist; the selection stays, the last finger does not select ---
    const vorher = await zeigen(page, "ifc", "kamera");
    const mitte = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45 };
    await zweiFinger(cdp, mitte, { r0: 50, r1: 110, w0: 0, w1: Math.PI / 6 });
    await page.waitForTimeout(400); // OrbitControls damping settles
    const nachher = await zeigen(page, "ifc", "kamera");
    expect(nachher.abstand, "auseinander = näher heran").toBeLessThan(vorher.abstand * 0.9);
    // review 106-07: sign and upper bound as in the BIM studio (same reference: world azimuth atan2(x, z) of the camera)
    const dAzimut = winkelDiff(nachher.azimutRad, vorher.azimutRad);
    expect(dAzimut, "gedreht um etwa +30 Grad (Weltazimut)").toBeGreaterThan(0.35);
    expect(dAzimut).toBeLessThan(0.7);
    expect((await zeigen(page, "ifc", "zeiger")).geste.schritte).toBeGreaterThan(0);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(hover.guid);

    // --- Finger tap: on empty sky nothing is selected, on an element (found again with the pen) it is ---
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await expect(page.getByTestId("ifc-auswahl-guid")).toHaveCount(0);
    expect((await zeigen(page, "ifc", "zeiger")).art).toBe("touch");
    const neu = await stiftSuchen(page, s, canvas, "ifc");
    await page.touchscreen.tap(neu.x, neu.y);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(neu.hover.guid, { timeout: 15000 });

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("Review-Fix: erster Finger nach der Maus — Layout kippt im selben Druck, der Knopf bleibt derselbe, Loslassen beendet die Aufnahme", async ({ page, request }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    const NAME = "E2E Tablet Halten 10607";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      // harness stand-in: ready, recognition on; POST /stt counts the uploads and answers a harmless known sentence
      const uploads = [];
      await page.route("http://127.0.0.1:8765/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/status") {
          return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ provider: "lokal", provider_lokal: true, nur_lokal: false, stt: { verfuegbar: true, bereit: true }, mcp: { aktiv: true, verbunden: false, werkzeuge: [], hinweis: "" } }) });
        }
        if (url.pathname === "/stt" && route.request().method() === "POST") {
          uploads.push((route.request().postDataBuffer() ?? Buffer.alloc(0)).length);
          return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ text: "Was ist das", dauer_s: 0.1, modell: "attrappe" }) });
        }
        return route.fulfill({ status: 404, headers: CORS, body: "{}" });
      });
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [] } });
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bim && /** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      const knopf = page.getByTestId("sprech-knopf");
      await expect(knopf).toBeVisible({ timeout: 60000 });

      // the mouse was used last (a click into the speech line): small button at the start of the row
      await page.getByTestId("sprech-eingabe").click();
      await expect(page.getByTestId("sprech-feld")).toHaveAttribute("data-grob", "nein");
      await expect(knopf).not.toHaveAttribute("data-zustand", "aus"); // the stand-in harness is ready
      await knopf.scrollIntoViewIfNeeded();
      await knopf.evaluate((el) => { /** @type {any} */ (el).dataset.marke = "vorher"; });
      const b = await knopf.boundingBox();
      const cdp = await page.context().newCDPSession(page);
      const punkt = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 0 };

      // first finger: the layout switches in this very press - and the recording starts
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [punkt] });
      await expect(page.getByTestId("sprech-feld")).toHaveAttribute("data-grob", "ja");
      await expect(knopf).toHaveAttribute("data-zustand", "aufnahme", { timeout: 10000 });
      expect(await knopf.evaluate((el) => /** @type {any} */ (el).dataset.marke ?? null), "derselbe Knopf, nicht neu aufgebaut").toBe("vorher");
      await page.waitForTimeout(1200);
      // the finger lifts where it went down; the button has moved to the right end - the pointer capture brings the release to it
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(knopf, "Loslassen beendet die Aufnahme").not.toHaveAttribute("data-zustand", "aufnahme", { timeout: 5000 });
      await expect.poll(() => uploads.length, { message: "genau eine Aufnahme ging an die Erkennung" }).toBe(1);
      expect(uploads[0]).toBeGreaterThan(1000);
      await expect(page.getByTestId("sprech-gehoert")).toContainText("Was ist das");
      await expect(knopf).toHaveAttribute("data-zustand", "bereit");

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
