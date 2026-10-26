// Headless proof 106-06: an image of the view as context (decision D-IM-02), in the BIM studio, plus the NDA checkbox of the project form
// that 106-05 left without an e2e.
// The harness is a stand-in (GET /status, WebSocket /ws/chat?profil=sprechen) like in sprechen-106-05; the app server, its store and the
// control channel are real. What is proved:
//  - project form: the person sets and clears the NDA marker; it is stored on the project,
//  - "mit Bild" says where the image would go (provider and host, "verlässt diesen Rechner"); the first image of a project to a model
//    outside this computer asks ONCE for the project; "Nicht senden" sends nothing; the consent is stored on the project, then the image
//    (a real PNG of the 3D view, at most 1280 px edge) goes with the task, together with the GUID of the selection and the project id;
//    the consent can be withdrawn in the field,
//  - a program (= an agent) cannot give the consent: neither through the route nor through a generic write,
//  - the MCP road: ansicht-bild over the control channel names the project; with the NDA marker it refuses, the button shows "nie" and
//    the store answers "nda" for every target.
//  - D-IM-07 (assumption): a turn with an image sends the page's sentence marker; an agent proposal in it shows "Agent + Bildkontext".
// Not proved here (no device): a real vision model - see 106-06-SUMMARY.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");
const HARNESS = "http://127.0.0.1:8765";
const guid = (s) => s.padEnd(22, "x").slice(0, 22);
const GA = guid("BildWandA10606");
const NDA_TEXT = "NDA-Projekt: es geht nie ein Bild der Ansicht an ein Sprachmodell";

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

/** One command through the HTTP control channel = what the app's MCP server does for an agent. 504 is retried (see auswahl-106-02). */
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

/** The harness stand-in: a provider OUTSIDE this computer whose model reads images. Records every task with its fields. */
async function harnessFake(page) {
  const h = {
    status: { provider: "fern", provider_lokal: false, provider_ziel: "api.example.com", model: "bild-modell", bilder: true, nur_lokal: false,
      stt: { verfuegbar: true, bereit: true }, mcp: { aktiv: true, verbunden: false, werkzeuge: [], hinweis: "" } },
    /** @type {any[]} */ nachrichten: [],
    /** D-IM-07: optional agent turn (tool calls over the control channel) before the answer. @type {null | ((msg: any) => Promise<void>)} */ agent: null,
  };
  await page.route(`${HARNESS}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/status") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(h.status) });
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  await page.routeWebSocket(/:8765\/ws\/chat/, (ws) => {
    ws.send(JSON.stringify({ type: "hello", session: "attrappe" }));
    ws.onMessage(async (m) => {
      const msg = JSON.parse(String(m));
      if (msg.type !== "user") return;
      h.nachrichten.push(msg);
      if (h.agent) await h.agent(msg);
      ws.send(JSON.stringify({ type: "text_delta", text: "Links der Wand steht eine Stütze." }));
      ws.send(JSON.stringify({ type: "done", stop_reason: "end_turn" }));
    });
  });
  return h;
}

/** Types one sentence into the speech field's line and sends it with Enter. */
async function tippen(page, satz) {
  const feld = page.getByTestId("sprech-eingabe");
  await feld.fill(satz);
  await feld.press("Enter");
}

/** Width and height of a base64 PNG from its IHDR chunk. */
function pngMasse(b64) {
  const b = Buffer.from(b64, "base64");
  expect(b.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
  return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) };
}

test.describe("106-06 Bild als Kontext: mit Bild nur nach Zustimmung je Projekt, NDA nie", () => {
  test.setTimeout(300000);

  test("Projektformular: die Person setzt und löscht den NDA-Merker", async ({ page, request }) => {
    const NAME = "E2E NDA Formular 10606";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, client: "Bauherr Probe", location: "Musterstadt", type: "residential", build_kind: "neubau", status: "concept" } })).json()).id;
      const nda = async () => (await (await request.get(`/api/entities/Project/${id}`)).json()).nda === true;
      expect(await nda()).toBe(false);

      await page.goto("/Projects");
      await page.getByRole("button", { name: `Bearbeiten: ${NAME}` }).click();
      const kaestchen = page.getByTestId("projekt-nda");
      await expect(kaestchen).not.toBeChecked();
      await expect(page.getByText("Vertraulich (NDA): nie Bilder der Ansicht an ein Sprachmodell senden")).toBeVisible();
      await kaestchen.check();
      await page.getByRole("button", { name: "Projekt aktualisieren" }).click();
      await expect.poll(nda, { timeout: 15000 }).toBe(true);

      // the person clears it again (a program could not: a generic write may only switch the marker on)
      await page.getByRole("button", { name: `Bearbeiten: ${NAME}` }).click();
      await expect(page.getByTestId("projekt-nda")).toBeChecked();
      await page.getByTestId("projekt-nda").uncheck();
      await page.getByRole("button", { name: "Projekt aktualisieren" }).click();
      await expect.poll(nda, { timeout: 15000 }).toBe(false);
      const programm = await request.put(`/api/entities/Project/${id}`, { data: { nda: true } });
      expect(programm.ok()).toBe(true);
      expect(await nda(), "a program may make a project stricter").toBe(true);
      const looser = await request.put(`/api/entities/Project/${id}`, { data: { nda: false } });
      expect(looser.headers()["x-bit-feld-geschuetzt"], "the program is told which field was not taken").toBe("nda");
      expect(await nda(), "… but never looser").toBe(true);

      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      if (id) await request.delete(`/api/entities/Project/${id}`);
    }
  });

  test("BIM-Studio: mit Bild -> Ziel in Worten -> einmal je Projekt zustimmen -> Bild + GUID gehen mit; Agent kann nicht zustimmen; NDA nie", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Bild 10606";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      const h = await harnessFake(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau" }],
      } });
      const projekt = async () => (await request.get(`/api/entities/Project/${id}`)).json();

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await expect.poll(async () => (await befehl(page, "modell")).result.bauteile.some((b) => b.guid === GA), { timeout: 30000 }).toBe(true);
      expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);

      // ---- the button: off by default; on, it says where the image would go
      const knopf = page.getByTestId("sprech-bild");
      await expect(knopf).toHaveAttribute("aria-pressed", "false");
      await knopf.click();
      await expect(knopf).toHaveAttribute("aria-pressed", "true");
      const ziel = page.getByTestId("sprech-bild-ziel");
      await expect(ziel).toHaveAttribute("data-ziel", "extern");
      await expect(ziel).toContainText("an „fern“ — außerhalb dieses Rechners (api.example.com)");
      await expect(ziel).toContainText("verlässt diesen Rechner");
      await expect(ziel).toContainText("↗"); // form, not only colour
      await expect(ziel).toContainText("noch keine Zustimmung für dieses Projekt");

      // ---- first image of the project: one question for the project; "Nicht senden" sends nothing
      await tippen(page, "was steht links neben dieser wand");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "bild-zustimmung");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-stufe", "frage");
      await expect(page.getByTestId("sprech-antwort")).toContainText("einmal je Projekt Ihre Zustimmung");
      await page.getByTestId("sprech-bild-zustimmung-nein").click();
      await expect(page.getByTestId("sprech-bild-zustimmung")).toHaveCount(0);
      expect(h.nachrichten, "nothing left the computer").toEqual([]);
      expect((await projekt()).bild_freigabe ?? null).toBeNull();

      // ---- a program (= an agent) cannot consent for the person: neither the route nor a generic write
      expect((await request.post("/api/llm/bild-zustimmung", { data: { projekt_id: id } })).status()).toBe(403);
      await request.put(`/api/entities/Project/${id}`, { data: { bild_freigabe: { am: "2026-10-25T00:00:00.000Z" } } });
      expect((await projekt()).bild_freigabe ?? null, "a generic write cannot set the consent").toBeNull();
      // and the MCP road is refused by the store as long as there is no consent
      const vorher = await (await request.get(`/api/llm/bild-freigabe?projekt_id=${id}&ziel=extern`)).json();
      expect(vorher.grund).toBe("zustimmung");
      // review fix: the control channel itself checks every image (the generic command road included) - without consent no PNG leaves
      const ohneZustimmung = await ueberKanal(request, "agent-bild-0", "ansicht-bild", { breite: 320 });
      expect(ohneZustimmung.json.ok).toBe(false);
      expect(ohneZustimmung.json.error).toContain("Bild der Ansicht abgelehnt");
      expect(JSON.stringify(ohneZustimmung.json)).not.toContain("iVBORw0KGgo");

      // ---- the person agrees once for the project; the per-sentence question of 106-05 still follows (review fix: it names everything that
      // leaves - sentence, selection, image, open proposals); then the waiting sentence goes WITH the image, the GUID and the project
      await tippen(page, "was steht links neben dieser wand");
      await expect(page.getByTestId("sprech-bild-zustimmung")).toBeVisible();
      await page.getByTestId("sprech-bild-zustimmung-ja").click();
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "modell-freigabe", { timeout: 30000 });
      await expect(page.getByTestId("sprech-antwort")).toContainText("ein Bild der Ansicht");
      await expect(page.getByTestId("sprech-antwort")).toContainText("offene Vorschläge");
      await expect.poll(async () => typeof (await projekt()).bild_freigabe?.am).toBe("string");
      expect(h.nachrichten, "the consent alone sends nothing").toEqual([]);
      await page.getByTestId("sprech-cloud-ok").click();
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "modell", { timeout: 30000 });
      await expect(page.getByTestId("sprech-antwort")).toContainText("Links der Wand steht eine Stütze.");
      await expect(page.getByTestId("sprech-antwort")).toContainText("mit Bild der Ansicht");
      expect(h.nachrichten.length).toBe(1);
      const n = h.nachrichten[0];
      expect(n.projekt_id).toBe(id);
      expect(n.ziel, "the target stays the GUID of the selection, never the image").toEqual([GA]);
      expect(n.bilder.length).toBe(1);
      const masse = pngMasse(n.bilder[0].png_base64);
      expect(masse.breite).toBeGreaterThan(64);
      expect(Math.max(masse.breite, masse.hoehe), "at most 1280 px edge").toBeLessThanOrEqual(1280);
      expect(n.text).toContain("Bild der aktuellen Ansicht");
      // D-IM-07 (assumption): a turn with an image carries the page's sentence marker, never inside the model's text
      expect(n.satz_marke).toMatch(/^sm-[0-9a-f]{32}$/);
      expect(n.text).not.toContain(n.satz_marke);
      const gespeichert = (await projekt()).bild_freigabe;
      expect(typeof gespeichert?.am).toBe("string");
      expect(gespeichert.durch).toBe("person");
      await expect(ziel).toContainText("Zustimmung für dieses Projekt erteilt");

      // ---- second image of the project: no consent question any more; the cloud question per sentence (106-05) names the image.
      // D-IM-07 (assumption): the agent proposes in this turn (as the harness bridge does, with the page's marker) -> origin "Agent + Bildkontext"
      // (typed sentence, image along)
      h.agent = async (msg) => {
        const r = await ueberKanal(request, "agent-bild-4", "eigenschaft-setzen", { guid: msg.ziel[0], name: "feuerwiderstand", wert: "F60", satz_marke: msg.satz_marke });
        expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
        expect(r.json.result.herkunft_quellen).toEqual(["agent", "bild"]);
      };
      await tippen(page, "und was ist rechts davon");
      await expect(page.getByTestId("sprech-antwort")).toHaveAttribute("data-art", "modell-freigabe");
      await expect(page.getByTestId("sprech-antwort")).toContainText("ein Bild der Ansicht");
      await page.getByTestId("sprech-cloud-ok").click();
      await expect.poll(() => h.nachrichten.length, { timeout: 30000 }).toBe(2);
      expect(h.nachrichten[1].bilder.length).toBe(1);
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Agent + Bildkontext", { timeout: 15000 });
      await expect(page.getByTestId("aenderung-herkunft")).toHaveAttribute("data-quellen", "agent bild");
      h.agent = null;
      await tippen(page, "nein");
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);

      // ---- MCP road: the viewer names its project with the image; the store allows it now
      const kanal = await ueberKanal(request, "agent-bild-1", "ansicht-bild", { breite: 320 });
      expect(kanal.json.ok).toBe(true);
      expect(kanal.json.result.projekt_id).toBe(id);
      expect((await (await request.get(`/api/llm/bild-freigabe?projekt_id=${id}&ziel=extern`)).json()).ok).toBe(true);

      // ---- the person withdraws the consent in the field
      await page.getByTestId("sprech-bild-zuruecknehmen").click();
      await expect(page.getByTestId("sprech-antwort")).toContainText("zurückgenommen");
      await expect.poll(async () => (await projekt()).bild_freigabe ?? null).toBeNull();
      await expect(ziel).toContainText("noch keine Zustimmung für dieses Projekt");
      const nachWiderruf = await ueberKanal(request, "agent-bild-3", "ansicht-bild", { breite: 320 });
      expect(nachWiderruf.json.ok, "after the withdrawal the control channel holds the image back again").toBe(false);

      // ---- "mit Bild" off: a free sentence goes without an image (as in 106-05)
      await knopf.click();
      await expect(knopf).toHaveAttribute("aria-pressed", "false");
      await tippen(page, "und was ist rechts davon");
      await page.getByTestId("sprech-cloud-ok").click();
      await expect.poll(() => h.nachrichten.length, { timeout: 30000 }).toBe(3);
      expect(h.nachrichten[2].bilder, "no image without the button").toBeUndefined();

      // ---- NDA marker: the button says "nie", the viewer refuses the image on the control channel, the store says nda for every target
      await request.put(`/api/entities/Project/${id}`, { data: { nda: true } });
      await page.reload();
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await expect(page.getByTestId("sprech-bild")).toBeDisabled();
      await expect(page.getByTestId("sprech-bild")).toHaveAttribute("data-ziel", "nie");
      await expect(page.getByTestId("sprech-bild")).toContainText("nie (NDA)");
      const nda = await ueberKanal(request, "agent-bild-2", "ansicht-bild", {});
      expect(nda.json.ok).toBe(false);
      expect(nda.json.error).toContain(NDA_TEXT);
      for (const z of ["extern", "lokal"]) expect((await (await request.get(`/api/llm/bild-freigabe?projekt_id=${id}&ziel=${z}`)).json()).grund).toBe("nda");
      // console clean up to here; the deliberate 409 below logs "Failed to load resource" by design, so it comes after this check
      expect(warnungen, warnungen.join("\n")).toEqual([]);
      // from the app page itself (Origin, Fetch Metadata, session token) - so the NDA branch answers, not the "no program" branch
      const ndaZustimmung = await page.evaluate(async (pid) => {
        const { token } = await (await fetch("/api/sitzung")).json();
        const r = await fetch("/api/llm/bild-zustimmung", { method: "POST", headers: { "content-type": "application/json", "x-bit-session": token }, body: JSON.stringify({ projekt_id: pid }) });
        return { status: r.status, text: (await r.json()).error };
      }, id);
      expect(ndaZustimmung.status, "no consent possible for an NDA project").toBe(409);
      expect(ndaZustimmung.text).toContain("NDA-Projekt");
      expect(warnungen.filter((w) => !/status of 409/.test(w)), "nothing but the deliberate 409").toEqual([]);
    } finally {
      if (id) await request.delete(`/api/entities/Project/${id}`);
    }
  });
});
