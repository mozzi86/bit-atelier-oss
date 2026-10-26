// Headless proof 106-05: speech at the model, in the BIM studio and the IFC viewer.
// The microphone is the test browser's fake audio device fed with a given WAV file (written below), the speech recognition is a stand-in
// for the harness's POST /stt (it checks that a real webm recording arrived and answers a fixed transcript), the harness agent is a
// stand-in for its WebSocket /ws/chat?profil=sprechen that does what the real harness does through the app's MCP server: it calls
// eigenschaft-setzen over the control channel (= an agent) and reports the tool call.
// What is proved: hold the button -> the heard sentence appears as text -> a known sentence becomes a PROPOSAL (preview card, origin
// "Spracheingabe") without a language model -> nothing changes until the person says "ja" -> the executed step carries origin "sprache";
// a typed sentence takes the same road (origin "text"); a free sentence goes to the agent with the selection's GUID and comes back as a
// proposal, never as a change; a provider outside this computer needs a click first ("Nicht senden" sends nothing); without the harness
// the button says so in words.
// Review 106-05: a spoken "ja" first stands on the screen with what it would apply and an "Abbrechen" button (BESTAETIGUNG_FRIST_MS) before it
// runs; a spoken "okay" is refused; "nach links" is checked against the camera's right vector; the GUID selected when the sentence was said
// travels with the task (`ziel`) and stays the target when the selection changes during the agent's turn.
// D-IM-07: a SPOKEN free sentence sends the page's marker (`satz_marke`) with the task; the agent's proposal then shows "Spracheingabe + Agent"
// in the card and in the history, the main origin stays "agent", the agent still cannot confirm, and after the turn the marker adds nothing.
// Not proved here (no device): the real microphone permission prompt and the real faster-whisper model - see 106-05-SUMMARY.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";

const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");
const HARNESS = "http://127.0.0.1:8765";
const OHNE_HARNESS = "Spracheingabe braucht den KI-Harness (Einstellungen › KI)";
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const GA = guid("SprechenWandA10605");
const GB = guid("SprechenWandB10605");

/** The given audio file: 1.5 s of a 440 Hz tone, 16 kHz mono 16-bit PCM (what the fake device plays into the recording). */
function wavSchreiben() {
  const rate = 16000;
  const n = Math.round(rate * 1.5);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  const datei = path.join(os.tmpdir(), "bit-sprechen-10605.wav");
  fs.writeFileSync(datei, buf);
  return datei;
}
const WAV = wavSchreiben();

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`] } });

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm|8765/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** One command through the register's JSON line (a person at the window). */
const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);

/** One command through the HTTP control channel = what the harness's MCP server does for the agent. 504 is retried (see auswahl-106-02). */
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

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };

/**
 * The harness stand-in. `h.da` false = not running (connection refused); `h.status` is what GET /status answers; `h.saetze` the transcripts
 * POST /stt answers in turn; `h.agent(text, ws)` plays the agent's turn. Records the uploads and the agent tasks.
 */
async function harnessFake(page) {
  const h = {
    da: true,
    status: { provider: "lokal", provider_lokal: true, nur_lokal: false, stt: { verfuegbar: true, bereit: true }, mcp: { aktiv: true, verbunden: false, werkzeuge: [], hinweis: "" } },
    /** @type {string[]} */ saetze: [],
    /** @type {{bytes: number, webm: boolean}[]} */ uploads: [],
    /** @type {string[]} */ auftraege: [],
    /** @type {string[]} */ freigaben: [],
    /** @type {null | ((text: string, ws: any, msg: any) => Promise<void>)} */ agent: null,
    /** @type {any[]} */ ziele: [],
  };
  await page.route(`${HARNESS}/**`, async (route) => {
    if (!h.da) return route.abort("connectionrefused");
    const url = new URL(route.request().url());
    if (url.pathname === "/status") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(h.status) });
    if (url.pathname === "/stt" && route.request().method() === "POST") {
      const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
      h.uploads.push({ bytes: body.length, webm: /audio\/webm/.test(body.toString("latin1")) });
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ text: h.saetze.shift() ?? "", dauer_s: 0.1, modell: "attrappe" }) });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  await page.routeWebSocket(/:8765\/ws\/chat/, (ws) => {
    ws.send(JSON.stringify({ type: "hello", session: "attrappe" }));
    ws.onMessage(async (m) => {
      const msg = JSON.parse(String(m));
      if (msg.type === "approval_reply") { h.freigaben.push(msg.ja ? "ja" : "nein"); return; }
      if (msg.type !== "user") return;
      h.auftraege.push(msg.text);
      h.ziele.push(msg.ziel);
      if (h.agent) await h.agent(msg.text, ws, msg);
      ws.send(JSON.stringify({ type: "done", stop_reason: "end_turn" }));
    });
  });
  return h;
}

/** Holds the speech button for `ms` like a person (pointer down, wait, pointer up). */
async function sprechen(page, ms = 1200) {
  const knopf = page.getByTestId("sprech-knopf");
  const box = await knopf.boundingBox();
  if (!box) throw new Error("sprech-knopf nicht sichtbar");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(knopf).toHaveAttribute("data-zustand", "aufnahme", { timeout: 10000 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Types one sentence into the speech field's line and sends it with Enter. */
async function tippen(page, satz) {
  const feld = page.getByTestId("sprech-eingabe");
  await feld.fill(satz);
  await feld.press("Enter");
}

test.describe("106-05 Sprache am Modell: Drücken und Sprechen, erst Grammatik, dann Modell", () => {
  test.setTimeout(300000);

  test("BIM-Studio: gesprochener Satz -> Text -> Vorschlag -> „ja“; getippt; freier Satz -> Agent -> Vorschlag; Cloud fragt; ohne Harness Klartext", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Sprechen 10605";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      const h = await harnessFake(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        customWalls: [
          { a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau", kg: "341" },
          { a: { x: 14, z: -22 }, b: { x: 26, z: -22 }, level: 0, height: 3, thickness: 0.3, _idx: 2, guid: GB, status: "neubau" },
        ],
      } });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const feuer = async () => (await befehl(page, "auswahl-lesen")).result.bauteile[0]?.steckbrief?.feuerwiderstand ?? null;

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await expect.poll(async () => (await befehl(page, "modell")).result.bauteile.some((b) => b.guid === GA), { timeout: 30000 }).toBe(true);
      await expect(page.getByTestId("sprech-feld")).toBeVisible();

      // --- help: the table of the sentences the grammar knows ---
      await page.getByTestId("sprech-hilfe-knopf").click();
      await expect(page.getByTestId("sprech-hilfe")).toContainText("Setze Brandschutz auf F90");
      await expect(page.getByTestId("sprech-hilfe")).toContainText("Verschiebe dieses 50 Zentimeter nach links");
      await page.getByTestId("sprech-hilfe-knopf").click();

      // --- "dieses" without a selection: refused in words, nothing proposed ---
      await tippen(page, "setze Brandschutz auf F90");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-ok", "nein");
      await expect(page.getByTestId("sprech-antwort")).toContainText("Keine Auswahl");
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);

      // ============================================================ 1. spoken: hold, the heard text first, then the proposal
      expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);
      h.saetze.push("Setze Brandschutz auf F90.");
      await sprechen(page);
      await expect(page.getByTestId("sprech-gehoert")).toContainText("Setze Brandschutz auf F90");
      expect(h.uploads.length).toBe(1);
      expect(h.uploads[0].webm, "the recording is sent as webm").toBe(true);
      expect(h.uploads[0].bytes, "a real recording, not an empty blob").toBeGreaterThan(1000);
      await expect(page.getByTestId("aenderung-vorschau")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("aenderung-satz")).toContainText("F90");
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Spracheingabe");
      await expect(page.getByTestId("sprech-antwort")).toContainText("Verstanden");
      expect(h.auftraege, "a known sentence never reaches the language model").toEqual([]);
      expect(await feuer(), "without the person's yes nothing changes").toBeNull();
      // a spoken "okay" is not a confirmation (only typed): refused in words, nothing applied
      h.saetze.push("Okay.");
      await sprechen(page);
      await expect(page.getByTestId("sprech-antwort")).toContainText("deutlich „ja“ oder „übernehmen“");
      expect(await feuer()).toBeNull();
      // a spoken "ja" first stands on the screen with what it would apply; "Abbrechen" keeps the proposal waiting
      h.saetze.push("Ja.");
      await sprechen(page);
      await expect(page.getByTestId("sprech-gehoert")).toContainText("Ja.");
      await expect(page.getByTestId("sprech-bestaetigung")).toContainText("F90");
      expect(await feuer(), "shown first, not applied yet").toBeNull();
      await page.getByTestId("sprech-bestaetigung-abbrechen").click();
      await expect(page.getByTestId("sprech-bestaetigung")).toHaveCount(0);
      await expect(page.getByTestId("sprech-antwort")).toContainText("Nicht übernommen");
      await page.waitForTimeout(2000); // longer than the delay: the cancelled "ja" never runs
      expect(await feuer()).toBeNull();
      await expect(page.getByTestId("aenderung-vorschau")).toBeVisible();
      // "ja" spoken by the person is the confirmation - after the delay
      h.saetze.push("Ja.");
      await sprechen(page);
      await expect(page.getByTestId("sprech-bestaetigung")).toBeVisible();
      await expect(page.getByTestId("sprech-antwort")).toContainText("Übernommen");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-stufe", "ok");
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      await expect.poll(feuer).toBe("F90");
      await expect(page.getByTestId("aenderung-schritt").first()).toHaveAttribute("data-herkunft", "sprache");
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 1).feuerwiderstand, { timeout: 20000 }).toBe("F90");

      // ============================================================ 2. typed: the same road, origin "text"; "nein" discards
      const vorX = (await gespeichert()).customWalls.find((w) => w._idx === 1).a.x;
      await tippen(page, "verschiebe dieses 50 cm nach links");
      // "links" is relative to the view: the camera looks at the model obliquely, so the 0,5 m split into x and z
      const satzVerschieben = await page.getByTestId("aenderung-satz").innerText();
      const m = satzVerschieben.match(/um (-?[\d,]+) m in x und (-?[\d,]+) m in z verschieben/);
      expect(m, satzVerschieben).toBeTruthy();
      const zahl = (s) => Number(s.replace(",", "."));
      expect(Math.hypot(zahl(m[1]), zahl(m[2]))).toBeCloseTo(0.5, 2);
      // the direction too: "links" = -0.5 m along the camera's screen-right vector in the plan
      const rechts = await page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.ansicht().rechts);
      expect(zahl(m[1])).toBeCloseTo(-0.5 * rechts.x, 1);
      expect(zahl(m[2])).toBeCloseTo(-0.5 * rechts.z, 1);
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Textbefehl");
      await tippen(page, "nein");
      await expect(page.getByTestId("sprech-antwort")).toContainText("Verworfen");
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      expect((await gespeichert()).customWalls.find((w) => w._idx === 1).a.x).toBe(vorX);

      // ============================================================ 3. free sentence -> agent (local provider) -> a proposal, never a change
      expect((await befehl(page, "auswahl-guid", { guid: GB })).ok).toBe(true);
      h.agent = async (text, ws, msg) => {
        // the person points at another element while the model is still thinking: the proposal must stay on the GUID of the sentence
        expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);
        // what the real harness does: the model calls eigenschaft_setzen without a guid; the bridge puts the GUID held at the sentence (`ziel`)
        // into the call -> the app's MCP server -> control channel
        const ziel = Array.isArray(msg.ziel) && msg.ziel.length === 1 ? msg.ziel[0] : null;
        const r = await ueberKanal(request, "agent-1", "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F30", ...(ziel ? { guid: ziel } : {}) });
        ws.send(JSON.stringify({ type: "tool_call", id: "t1", name: "eigenschaft_setzen", args: { name: "feuerwiderstand", wert: "F30" } }));
        // the harness's real event form: {name, result}; an error is {"error": ...}
        ws.send(JSON.stringify({ type: "tool_result", id: "t1", name: "eigenschaft_setzen", result: JSON.stringify(r.json?.ok === true ? r.json.result : { error: r.json?.error ?? "?" }) }));
        // an approval request is answered "nein" by the app, never "ja"
        ws.send(JSON.stringify({ type: "approval", id: "f1", befehl: "x", erklaerung: "y" }));
        ws.send(JSON.stringify({ type: "text_delta", text: "Vorgeschlagen: Feuerwiderstand F30 für die gewählte Wand." }));
        expect(text).toContain(GB);
      };
      await tippen(page, "die wand da braucht etwas mehr feuerschutz bitte");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "modell", { timeout: 30000 });
      await expect(page.getByTestId("sprech-antwort")).toContainText("Vorgeschlagen: Feuerwiderstand F30");
      await expect(page.getByTestId("sprech-antwort")).toContainText("eigenschaft_setzen");
      expect(h.auftraege.length).toBe(1);
      expect(h.auftraege[0]).toContain("die wand da braucht etwas mehr feuerschutz bitte");
      expect(h.auftraege[0]).toContain(`GUID ${GB}`);
      expect(h.ziele[0], "the GUID selected at the sentence travels with the task").toEqual([GB]);
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-stufe", "ok"); // a proposal came back
      await expect.poll(() => h.freigaben).toEqual(["nein"]);
      await expect(page.getByTestId("aenderung-vorschau")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("aenderung-satz")).toContainText("F30");
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Agent");
      const offenAgent = (await befehl(page, "vorschlaege")).result.offen;
      expect(offenAgent.length).toBe(1);
      expect(offenAgent[0].ziel.guid, "the selection changed during the turn, the target did not").toBe(GB);
      expect((await befehl(page, "auswahl-guid", { guid: GB })).ok).toBe(true);
      expect(await feuer(), "the agent's answer is a proposal, nothing changed").toBeNull();
      // the agent cannot confirm its own proposal over the control channel (D-IM-04), not even through the text input
      const vorschlagId = (await befehl(page, "vorschlaege")).result.offen[0].id;
      expect((await ueberKanal(request, "agent-2", "bestaetigen", { vorschlag_id: vorschlagId })).json.ok).toBe(false);
      expect((await ueberKanal(request, "agent-3", "eingabe", { text: "ja" })).json.ok).toBe(false);
      expect(await feuer()).toBeNull();
      // the person discards it
      await tippen(page, "nein");
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);

      // ============================================================ 3b. D-IM-07: a SPOKEN free sentence -> agent -> origin "Spracheingabe + Agent"
      let marke = "";
      h.agent = async (text, ws, msg) => {
        marke = msg.satz_marke;
        // what the real harness bridge does: the app's sentence marker goes into the change tool's call (never into the model's task)
        expect(typeof msg.satz_marke, "a spoken sentence sends the page's marker with the task").toBe("string");
        expect(text).not.toContain(msg.satz_marke);
        const ziel = Array.isArray(msg.ziel) && msg.ziel.length === 1 ? msg.ziel[0] : null;
        const r = await ueberKanal(request, "agent-4", "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F60", ...(ziel ? { guid: ziel } : {}), satz_marke: msg.satz_marke });
        ws.send(JSON.stringify({ type: "tool_call", id: "t2", name: "eigenschaft_setzen", args: { name: "feuerwiderstand", wert: "F60" } }));
        ws.send(JSON.stringify({ type: "tool_result", id: "t2", name: "eigenschaft_setzen", result: JSON.stringify(r.json?.ok === true ? r.json.result : { error: r.json?.error ?? "?" }) }));
        ws.send(JSON.stringify({ type: "text_delta", text: "Vorgeschlagen: Feuerwiderstand F60." }));
      };
      h.saetze.push("die wand da braucht etwas mehr feuerschutz bitte");
      await sprechen(page);
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "modell", { timeout: 30000 });
      expect(h.auftraege.length).toBe(2);
      await expect(page.getByTestId("aenderung-vorschau")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("aenderung-satz")).toContainText("F60");
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Spracheingabe + Agent");
      await expect(page.getByTestId("aenderung-herkunft")).toHaveAttribute("data-quellen", "sprache agent");
      const offenSprache = (await befehl(page, "vorschlaege")).result.offen;
      expect(offenSprache[0].herkunft, "the main origin stays agent (old readers)").toBe("agent");
      expect(offenSprache[0].herkunft_quellen).toEqual(["sprache", "agent"]);
      // the marker does not open the lock: the agent still cannot confirm (D-IM-04)
      expect((await ueberKanal(request, "agent-5", "bestaetigen", { vorschlag_id: offenSprache[0].id, satz_marke: marke })).json.ok).toBe(false);
      // the turn is over: the same marker no longer adds "sprache" (withdrawn); a marker the page never issued adds nothing either
      const spaet = await ueberKanal(request, "agent-6", "eigenschaft-setzen", { guid: GB, name: "kg", wert: "341", satz_marke: marke });
      expect(spaet.json?.result?.herkunft_quellen).toEqual(["agent"]);
      await befehl(page, "verwerfen", { vorschlag_id: spaet.json.result.id });
      const fremd = await ueberKanal(request, "agent-7", "eigenschaft-setzen", { guid: GB, name: "kg", wert: "341", satz_marke: "sm-" + "0".repeat(32) });
      expect(fremd.json?.result?.herkunft_quellen).toEqual(["agent"]);
      await befehl(page, "verwerfen", { vorschlag_id: fremd.json.result.id });
      // the person confirms: the history row names both origins
      await tippen(page, "ja");
      await expect(page.getByTestId("aenderung-schritt").first()).toHaveAttribute("data-quellen", "sprache agent", { timeout: 15000 });
      await expect(page.getByTestId("aenderung-schritt").first()).toContainText("Spracheingabe + Agent");
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);

      // ============================================================ 4. provider outside this computer: ask first, "Nicht senden" sends nothing
      h.status = { ...h.status, provider: "fern", provider_lokal: false };
      await tippen(page, "die wand da braucht etwas mehr feuerschutz bitte");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "modell-freigabe");
      await expect(page.getByTestId("sprech-antwort")).toContainText("außerhalb dieses Rechners");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-stufe", "frage"); // an open decision: dotted, "?", not "✓"
      await page.getByTestId("sprech-cloud-nein").click();
      await expect(page.getByTestId("sprech-cloud-ok")).toHaveCount(0);
      expect(h.auftraege.length, "nothing was sent").toBe(2);

      // ============================================================ 5. without the harness: the button says so in words
      const hochgeladen = h.uploads.length;
      expect(hochgeladen, "five spoken sentences so far (Setze …, Okay, Ja (cancelled), Ja, the free sentence of 3b)").toBe(5);
      h.da = false;
      await page.getByTestId("sprech-knopf").click();
      await expect(page.getByTestId("sprech-antwort")).toContainText(OHNE_HARNESS);
      await expect(page.getByTestId("sprech-knopf")).toHaveAttribute("data-zustand", "aus");
      expect(h.uploads.length, "no recording without the harness").toBe(hochgeladen);

      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      if (id) await request.delete(`/api/entities/Project/${id}`);
    }
  });

  test("IFC-Viewer: gesprochener Satz wird Vorschlag am IFC-Bauteil, erst „ja“ übernimmt", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    const h = await harnessFake(page);
    await page.goto("/IfcViewer?beispiel=1");
    await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 30000 });
    await expect(page.getByTestId("sprech-feld")).toBeVisible();
    const wand = (await befehl(page, "modell", { klasse: "IfcWall" })).result.bauteile[0];
    expect((await befehl(page, "auswahl-guid", { guid: wand.guid })).ok).toBe(true);

    // F180: a value the sample file does not hold (an equal value would be "Keine Änderung"); the step is undone at the end
    h.saetze.push("setze Brandschutz auf F180");
    await sprechen(page);
    await expect(page.getByTestId("sprech-gehoert")).toContainText("setze Brandschutz auf F180");
    await expect(page.getByTestId("aenderung-vorschau")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("aenderung-satz")).toContainText("F180");
    await expect(page.getByTestId("aenderung-satz")).toContainText("Feuerwiderstand"); // the German label of FireRating
    await expect(page.getByTestId("aenderung-herkunft")).toContainText("Spracheingabe");
    expect((await befehl(page, "vorschlaege")).result.verlauf.length, "nothing executed yet").toBe(0);
    h.saetze.push("ja");
    await sprechen(page);
    await expect(page.getByTestId("sprech-bestaetigung")).toContainText("F180"); // shown first
    await expect(page.getByTestId("sprech-antwort")).toContainText("Übernommen");
    await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
    const verlauf = (await befehl(page, "vorschlaege")).result.verlauf;
    expect(verlauf.at(-1)).toMatchObject({ art: "eigenschaft", herkunft: "sprache", zurueckgenommen: null });
    // "rückgängig" is asked back first; only the spoken "ja" runs it (and removes the journal entry again)
    h.saetze.push("mach das rückgängig");
    await sprechen(page);
    await expect(page.getByTestId("sprech-rueckfrage")).toBeVisible();
    expect((await befehl(page, "vorschlaege")).result.verlauf.at(-1).zurueckgenommen, "asking back runs nothing").toBeNull();
    h.saetze.push("ja");
    await sprechen(page);
    await expect(page.getByTestId("sprech-bestaetigung")).toContainText("Schritt zurücknehmen");
    await expect(page.getByTestId("sprech-rueckfrage")).toHaveCount(0);
    await expect.poll(async () => (await befehl(page, "vorschlaege")).result.verlauf.at(-1).zurueckgenommen).not.toBeNull();
    expect(h.auftraege).toEqual([]);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
