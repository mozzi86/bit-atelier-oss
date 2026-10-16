// Headless-Nachweis 93-03 (Büro-Modus, Hebel 158).
//
// 1. Echter Server: der Test startet server/index.js selbst — Zufallsport, eigener Temp-Datenordner (die
//    Seed-Daten bleiben unberührt), Update-Prüfung aus — und beendet ihn am Ende wieder. Der Büro-Rechner
//    spricht über 127.0.0.1, ein ZWEITER Browser-Kontext über die private LAN-Adresse dieses Rechners (dann
//    ist seine Quelladresse nicht Loopback): vor dem Einschalten kein Listener; danach ungekoppelt 401;
//    Kopplung mit dem Code vom Host (httpOnly-Cookie, SameSite=Strict); Projektdaten lesen/schreiben;
//    Hinweis bei veraltetem Stand; Host-Routen 403; fremde Origin 403; Widerruf; Drossel 429; Ausschalten
//    schließt den Listener. Ohne private IPv4 wird dieser Teil übersprungen. Liegt ein Build in dist/,
//    startet der Server im App-Modus (`--app`) und das Tablet koppelt sich über die echte Koppelseite und
//    sieht danach „Gerät: Tablet Baustelle“ in der Kopfzeile; ohne Build koppelt es per fetch.
// 2. Oberfläche gegen den Dev-Stack mit page.route: Karte in System & Info (Bestätigung, URLs, Code,
//    Geräteliste, Widerruf), Kopfzeilen-Kennung am Host; Koppelseite und „Gerät: …“ auf dem Gerät.
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { lanAdressen } from "../../server/bueroModus.js";
import { ERLAUBT_OFFLINE } from "./fixtures/massing.js";

/** @returns {Promise<number>} a free TCP port on loopback */
function freierPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = /** @type {any} */ (s.address()).port; s.close(() => resolve(p)); });
  });
}

test.describe("93-03 Büro-Modus — echter Server im Büro-Netz", () => {
  test.setTimeout(120000);
  const ip = lanAdressen()[0];
  test.skip(!ip, "keine private IPv4-Adresse auf diesem Rechner");

  /** @type {import('node:child_process').ChildProcess|null} */
  let kind = null;
  let ordner = "";
  let port = 0;
  let log = "";
  const appModus = fs.existsSync(path.join(process.cwd(), "dist", "index.html"));

  test.beforeAll(async () => {
    port = await freierPort();
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), "bit-buero-e2e-"));
    kind = spawn(process.execPath, ["server/index.js", ...(appModus ? ["--app"] : [])], {
      cwd: process.cwd(),
      env: { ...process.env, API_PORT: String(port), BIT_DATA_DIR: ordner, BIT_KEIN_UPDATECHECK: "1", API_HOST: "", PERSONAL_LAN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    kind.stdout?.on("data", (d) => { log += d; });
    kind.stderr?.on("data", (d) => { log += d; });
    const bis = Date.now() + 30000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > bis) throw new Error(`Server nicht gestartet:\n${log}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  test.afterAll(async () => {
    if (kind && kind.exitCode === null) {
      const ende = new Promise((r) => kind?.once("exit", r));
      kind.kill();
      await ende;
    }
    if (ordner) fs.rmSync(ordner, { recursive: true, force: true });
  });

  test("Kopplung, Rechte, Widerruf, Drossel, Ausschalten", async ({ browser, playwright }) => {
    const hostUrl = `http://127.0.0.1:${port}`;
    const lanUrl = `http://${ip}:${port}`;
    // 96-04: a browser-like client (Origin) writes with the session token, like the app's fetch wrapper.
    const tokenKontext = await playwright.request.newContext({ baseURL: hostUrl });
    const { token } = await (await tokenKontext.get("/api/sitzung")).json();
    await tokenKontext.dispose();
    const host = await playwright.request.newContext({ baseURL: hostUrl, extraHTTPHeaders: { Origin: hostUrl, "X-Bit-Session": token } });
    const geraet = await browser.newContext({ baseURL: lanUrl });
    let seite = await geraet.newPage();
    /** fetch inside the device page (real browser: cookie jar, Origin header) */
    const holen = (pfad, init = {}) => seite.evaluate(async ([p, i]) => {
      try {
        // 96-04: writes carry the session header, as the app's fetch wrapper adds it on a paired device.
        if (i?.method && i.method !== "GET") {
          const s = await fetch("/api/sitzung").then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
          if (s.token) i = { ...i, headers: { ...(i.headers || {}), "X-Bit-Session": s.token } };
        }
        const r = await fetch(p, i);
        return { status: r.status, hinweis: r.headers.get("X-Bit-Hinweis"), json: await r.json().catch(() => null) };
      } catch (e) { return { status: 0, fehler: String(e) }; }
    }, [pfad, init]);
    const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    try {
      // off by default: nothing listens on the LAN address
      expect((await (await host.get("/api/buero/status")).json()).aktiv).toBe(false);
      await expect(seite.goto(`${lanUrl}/api/buero/ich`)).rejects.toThrow();

      // switch on from the host — needs the app's Origin
      const ohneOrigin = await playwright.request.newContext({ baseURL: hostUrl });
      expect((await ohneOrigin.post("/api/buero/aktivieren", { data: { aktiv: true } })).status()).toBe(403);
      await ohneOrigin.dispose();
      const an = await (await host.post("/api/buero/aktivieren", { data: { aktiv: true } })).json();
      expect(an.aktiv).toBe(true);
      expect(an.urls).toContain(`${lanUrl}/`);

      // unpaired device: who am I yes, data no (fresh tab — the refused navigation left an error page behind)
      await seite.close();
      seite = await geraet.newPage();
      await seite.goto(`${lanUrl}/api/buero/ich`);
      expect((await holen("/api/buero/ich")).json).toEqual({ lokal: false, aktiv: true, geraet: null });
      const ungekoppelt = await holen("/api/entities/Project");
      expect(ungekoppelt.status).toBe(401);
      expect(ungekoppelt.json.koppeln).toBe(true);

      // pairing with the code from the host
      const { code } = await (await host.post("/api/buero/code", { data: { name: "Tablet Baustelle" } })).json();
      expect(code).toMatch(/^\d{6}$/);
      expect((await holen("/api/buero/koppeln", json({ code: code === "000000" ? "111111" : "000000" }))).status).toBe(401);
      if (appModus) {
        // the real app shell from the LAN address: pairing page, then the app with the device marker
        await seite.goto(`${lanUrl}/`);
        await expect(seite.getByTestId("buero-koppeln")).toBeVisible({ timeout: 30000 });
        await seite.getByTestId("buero-code").fill(code);
        await seite.getByTestId("buero-koppeln-knopf").click();
        await expect(seite.getByTestId("buero-kennung")).toHaveAttribute("aria-label", "Gerät: Tablet Baustelle", { timeout: 30000 });
      } else {
        const gekoppelt = await holen("/api/buero/koppeln", json({ code }));
        expect(gekoppelt.status).toBe(200);
        expect(gekoppelt.json.token).toBeUndefined();
      }
      const keks = (await geraet.cookies()).find((c) => c.name === "bit_geraet");
      expect(keks?.httpOnly).toBe(true);
      expect(keks?.sameSite).toBe("Strict");

      // the device works with project data and says who it is
      expect((await holen("/api/auth/me")).json.full_name).toBe("Gerät: Tablet Baustelle");
      expect((await holen("/api/entities/Project")).status).toBe(200);
      const neu = await holen("/api/entities/E2eBueroNotiz", json({ text: "vom Tablet" }));
      expect(neu.status).toBe(201);

      // last write wins, with a note when the device wrote on an outdated copy
      await new Promise((r) => setTimeout(r, 15));
      expect((await host.put(`/api/entities/E2eBueroNotiz/${neu.json.id}`, { data: { text: "am Büro-Rechner" } })).status()).toBe(200);
      const alt = await holen(`/api/entities/E2eBueroNotiz/${neu.json.id}`, json({ text: "Tablet, alter Stand", updated_date: neu.json.updated_date }, "PUT"));
      expect(alt.status).toBe(200);
      expect(alt.hinweis).toBe("zwischenzeitlich-geaendert");
      expect(alt.json.text).toBe("Tablet, alter Stand");

      // host-only routes stay closed to the device
      for (const p of ["/api/system/datenordner", "/api/buero/status", "/api/buero/geraete", "/api/update", "/api/personal/Mitarbeiter", "/api/llm/connections"]) {
        expect((await holen(p)).status, p).toBe(403);
      }
      expect((await holen("/api/buero/aktivieren", json({ aktiv: false }))).status).toBe(403);

      // CSRF: the device cookie with a foreign Origin is refused
      const fremd = await geraet.request.post(`${lanUrl}/api/entities/E2eBueroNotiz`, { data: { text: "fremd" }, headers: { Origin: "http://evil.example" } });
      expect(fremd.status()).toBe(403);

      // revoke on the host → the device is out at once
      const liste = await (await host.get("/api/buero/geraete")).json();
      expect(liste.map((g) => g.name)).toEqual(["Tablet Baustelle"]);
      expect((await host.delete(`/api/buero/geraete/${liste[0].id}`)).status()).toBe(200);
      expect((await holen("/api/entities/Project")).status).toBe(401);

      // pairing attempts are rate-limited per address
      let gedrosselt = false;
      for (let i = 0; i < 12 && !gedrosselt; i += 1) gedrosselt = (await holen("/api/buero/koppeln", json({ code: "999999" }))).status === 429;
      expect(gedrosselt).toBe(true);

      // switch off → the LAN listener is gone
      expect((await (await host.post("/api/buero/aktivieren", { data: { aktiv: false } })).json()).aktiv).toBe(false);
      expect((await holen("/api/buero/ich")).status).toBe(0);
      // the host still works as before
      expect((await host.get("/api/entities/Project")).status()).toBe(200);
    } finally {
      await geraet.close();
      await host.dispose();
    }
  });
});

test.describe("93-03 Büro-Modus — Oberfläche", () => {
  test.setTimeout(120000);

  test("Host: einschalten mit Bestätigung, URL, Code, Gerät widerrufen, Kennung in der Kopfzeile", async ({ page }) => {
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("dialog", (d) => d.accept());
    const zustand = { aktiv: false, geraete: /** @type {any[]} */ ([]) };
    const status = () => ({
      aktiv: zustand.aktiv, port: 3001, appModus: true, adressen: zustand.aktiv ? ["192.168.0.20"] : [],
      urls: zustand.aktiv ? ["http://192.168.0.20:3001/"] : [], fehler: [], geraete: zustand.geraete, offenerCode: null,
    });
    await page.route("**/api/buero/ich", (r) => r.fulfill({ json: { lokal: true, aktiv: zustand.aktiv, appModus: true } }));
    await page.route("**/api/buero/status", (r) => r.fulfill({ json: status() }));
    await page.route("**/api/buero/aktivieren", (r) => { zustand.aktiv = JSON.parse(r.request().postData() || "{}").aktiv === true; return r.fulfill({ json: status() }); });
    await page.route("**/api/buero/code", (r) => {
      zustand.geraete = [{ id: "g1", name: "Tablet Baustelle", erstellt: "2026-10-12T19:00:00.000Z", laeuftAb: "2026-11-11T19:00:00.000Z", zuletzt: null }];
      return r.fulfill({ json: { code: "482913", name: "Tablet Baustelle", laeuftAb: new Date(Date.now() + 600000).toISOString() } });
    });
    await page.route("**/api/buero/geraete/*", (r) => { zustand.geraete = []; return r.fulfill({ json: { ok: true } }); });

    await page.goto("/Settings?tab=system");
    const karte = page.getByTestId("buero-karte");
    await expect(karte).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("buero-zustand")).toHaveAttribute("data-aktiv", "nein");
    await expect(page.getByTestId("buero-kennung")).toHaveCount(0);
    await expect(page.getByTestId("buero-einschalten")).toBeDisabled();
    await page.getByTestId("buero-verstanden").check();
    await page.getByTestId("buero-einschalten").click();
    await expect(page.getByTestId("buero-zustand")).toHaveAttribute("data-aktiv", "ja");
    await expect(page.getByTestId("buero-urls")).toContainText("http://192.168.0.20:3001/");
    await expect(page.getByTestId("buero-kennung")).toHaveAttribute("data-art", "host");

    await page.getByTestId("buero-geraetename").fill("Tablet Baustelle");
    await page.getByTestId("buero-code-erzeugen").click();
    await expect(page.getByTestId("buero-code-anzeige")).toContainText("482913");
    await expect(page.getByTestId("buero-geraete")).toContainText("Tablet Baustelle");
    await page.getByTestId("buero-widerrufen").click();
    await expect(page.getByTestId("buero-geraete")).toHaveCount(0);

    await page.getByTestId("buero-ausschalten").click();
    await expect(page.getByTestId("buero-zustand")).toHaveAttribute("data-aktiv", "nein");
    await expect(page.getByTestId("buero-kennung")).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("Gerät: Koppelseite statt App, danach „Gerät: Tablet Baustelle“ in der Kopfzeile", async ({ page }) => {
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/401/.test(m.text())) warnungen.push(m.text()); });
    let gekoppelt = false;
    const geraet = { id: "g1", name: "Tablet Baustelle", erstellt: "2026-10-12T19:00:00.000Z", laeuftAb: "2026-11-11T19:00:00.000Z", zuletzt: null };
    await page.route("**/api/buero/ich", (r) => r.fulfill({ json: { lokal: false, aktiv: true, geraet: gekoppelt ? geraet : null } }));
    await page.route("**/api/buero/koppeln", (r) => {
      const { code } = JSON.parse(r.request().postData() || "{}");
      if (code !== "482913") return r.fulfill({ status: 401, json: { error: "Code falsch oder abgelaufen." } });
      gekoppelt = true;
      return r.fulfill({ json: { geraet } });
    });

    await page.goto("/");
    await expect(page.getByTestId("buero-koppeln")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("buero-code").fill("111 111");
    await expect(page.getByTestId("buero-code")).toHaveValue("111111");
    await page.getByTestId("buero-koppeln-knopf").click();
    await expect(page.getByTestId("buero-koppeln-fehler")).toContainText("Code falsch");
    await page.getByTestId("buero-code").fill("482913");
    await page.getByTestId("buero-koppeln-knopf").click();
    const kennung = page.getByTestId("buero-kennung");
    await expect(kennung).toHaveAttribute("data-art", "geraet", { timeout: 20000 });
    await expect(kennung).toHaveAttribute("aria-label", "Gerät: Tablet Baustelle");

    await page.goto("/Settings?tab=system");
    await expect(page.getByTestId("buero-zustand")).toContainText("Tablet Baustelle", { timeout: 20000 });
    await expect(page.getByTestId("buero-abmelden")).toBeVisible();
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
