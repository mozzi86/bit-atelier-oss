// Headless proof 93-12: local AI inside the program, against a STUB server started by this test.
//
// The stub (node:http, 127.0.0.1, random port) imitates LM Studio (/v1/models, /v1/chat/completions) and
// Ollama (/api/version, /api/tags, /api/pull as NDJSON stream, /api/generate, /api/chat). The app's
// settings point Ollama and LM Studio at it for the duration of the test and are restored afterwards.
// Nothing is downloaded, no real Ollama/LM Studio is needed, and every browser request to a host other
// than localhost is aborted (the Ollama download link is only clicked into an aborted popup).
//
// Flows: detection → recommendation → "Laden" with progress → model entered into the Ollama connection →
// speed test; one-click LM Studio + model discovery + test; "Nur lokale KI" switch, badge and the
// server-side refusal of a cloud target; no local AI → download link + waiting until Ollama appears;
// harness card state.
//
// Run: npm run seed && PORT=5200 API_PORT=3030 API_ORIGINS=http://localhost:5200 npx playwright test tests/e2e/ki-lokal-93-12.spec.js --reporter=line

import { test, expect } from "@playwright/test";
import http from "node:http";
import { ERLAUBT_OFFLINE } from "./fixtures/massing.js";

const LOKAL = ["localhost", "127.0.0.1", "[::1]"];

/** Stub with the LM Studio and Ollama endpoints the app uses. */
function stubStarten() {
  const installiert = [{ name: "qwen3.5:0.8b", size: 1_400_000_000, details: { family: "qwen35", parameter_size: "0.8B" } }];
  const aufrufe = [];
  const server = http.createServer((req, res) => {
    aufrufe.push(`${req.method} ${req.url}`);
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const json = (o, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url === "/v1/models") return json({ object: "list", data: [{ id: "stub-modell-a" }, { id: "stub-modell-b" }, { id: "text-embedding-stub" }] });
      if (req.url === "/v1/chat/completions") return setTimeout(() => json({ choices: [{ message: { content: "OK" } }] }), 600);
      if (req.url === "/api/version") return json({ version: "0.0.0-stub" });
      if (req.url === "/api/tags") return json({ models: installiert });
      if (req.url === "/api/chat") return json({ message: { content: "Stub-Antwort" } });
      if (req.url === "/api/generate") return json({ response: "…", eval_count: 90, eval_duration: 5e9, load_duration: 1e9, prompt_eval_duration: 2e8 });
      if (req.url === "/api/pull") {
        const { model } = JSON.parse(body || "{}");
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const zeilen = [
          { status: "pulling manifest" },
          { status: "pulling aaaa", digest: "sha256:aaaa", total: 2_000_000_000, completed: 500_000_000 },
          { status: "pulling aaaa", digest: "sha256:aaaa", total: 2_000_000_000, completed: 1_500_000_000 },
          { status: "pulling aaaa", digest: "sha256:aaaa", total: 2_000_000_000, completed: 2_000_000_000 },
          { status: "verifying sha256 digest" },
          { status: "success" },
        ];
        let i = 0;
        const weiter = () => {
          if (i >= zeilen.length) {
            installiert.push({ name: model, size: 2_000_000_000, details: { family: "qwen35", parameter_size: "2B" } });
            return res.end();
          }
          res.write(`${JSON.stringify(zeilen[i++])}\n`);
          setTimeout(weiter, 400);
        };
        return weiter();
      }
      json({ error: "unbekannt" }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, aufrufe })));
}

/** A port nothing listens on. */
async function totPort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

test.describe.configure({ mode: "serial" });

test.describe("93-12 Lokale KI und Harness im Programm", () => {
  test.use({ viewport: { width: 1400, height: 1100 } });
  /** @type {{ server: http.Server, port: number, aufrufe: string[] }} */
  let stub;
  let vorher;
  let stubBasis;

  test.beforeAll(async ({ request }) => {
    stub = await stubStarten();
    stubBasis = `http://127.0.0.1:${stub.port}`;
    vorher = await (await request.get("/api/llm/einstellungen")).json();
    const r = await request.put("/api/llm/einstellungen", { data: { ollama_url: stubBasis, lmstudio_url: `${stubBasis}/v1`, nur_lokal: false } });
    expect(r.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.put("/api/llm/einstellungen", { data: { ollama_url: vorher.ollama_url, lmstudio_url: vorher.lmstudio_url, nur_lokal: Boolean(vorher.nur_lokal) } });
    const verbindungen = await (await request.get("/api/llm/connections")).json();
    for (const c of verbindungen) {
      if (String(c.base_url || "").startsWith(stubBasis)) await request.delete(`/api/llm/connections/${c.id}`);
    }
    stub?.server.close();
  });

  /** Block foreign hosts, collect console problems. */
  async function vorbereiten(page) {
    const fremd = [];
    await page.context().route("**/*", (route) => {
      const url = route.request().url();
      if (/^(blob|data):/.test(url) || LOKAL.includes(new URL(url).hostname)) return route.continue();
      fremd.push(url);
      return route.abort();
    });
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    return { fremd, warnungen };
  }

  test("Erkennung, Empfehlung, Modell laden mit Fortschritt, Verbindung, Geschwindigkeit", async ({ page, request }) => {
    const { warnungen } = await vorbereiten(page);
    await page.goto("/Settings?tab=ai");
    await expect(page.getByTestId("lokale-ki")).toBeVisible();
    await expect(page.getByTestId("ki-erkennung-ollama")).toContainText("läuft (Version 0.0.0-stub)");
    await expect(page.getByTestId("ki-erkennung-lmstudio")).toContainText("läuft (2 Modelle geladen)");
    // Hardware of the machine running the test + a recommendation derived from it (whatever it is).
    await expect(page.getByTestId("ki-hardware")).toContainText("GB Arbeitsspeicher");
    await expect(page.getByTestId("ki-empfehlung-top")).toBeVisible();
    await expect(page.getByTestId("ki-empfehlung-top")).toContainText(/Grafikspeicher|Prozessor/);

    const katalog = page.getByTestId("ki-katalog");
    await katalog.locator("summary").click();
    await expect(katalog).toContainText("Stand 2026-10-12");
    await expect(page.getByTestId("ki-modell-qwen3.5:0.8b")).toContainText("installiert");

    // Load a model: progress from the stub's NDJSON stream, then done.
    await page.getByTestId("ki-modell-qwen3.5:2b").getByTestId("ki-laden-qwen3.5:2b").click();
    const pull = page.getByTestId("ki-pull");
    await expect(pull).toContainText("qwen3.5:2b");
    await expect(pull).toContainText(/von 2 GB/);
    await expect(page.getByTestId("ki-pull-fertig")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("qwen3.5:2b ist geladen und als Modell der Ollama-Verbindung eingetragen.")).toBeVisible();
    expect(stub.aufrufe).toContain("POST /api/pull");

    // The connection now carries the model (created by the server).
    const verbindungen = await (await request.get("/api/llm/connections")).json();
    const ollama = verbindungen.find((c) => c.provider === "ollama" && c.base_url === stubBasis);
    expect(ollama?.model).toBe("qwen3.5:2b");

    // Installed now → speed test against /api/generate (90 tokens in 5 s = 18 tokens/s).
    await expect(page.getByTestId("ki-modell-qwen3.5:2b")).toContainText("installiert");
    await page.getByTestId("ki-modell-qwen3.5:2b").getByRole("button", { name: "Geschwindigkeit messen" }).click();
    await expect(page.getByTestId("ki-benchmark")).toContainText("≈ 18 Token/s — flüssig");
    await expect(page.getByTestId("ki-benchmark")).toContainText("erste Antwort nach 1,2 s");
    expect(warnungen).toEqual([]);
  });

  test("LM Studio mit einem Klick, Modelle abrufen, Verbindung testen", async ({ page }) => {
    const { warnungen } = await vorbereiten(page);
    await page.goto("/Settings?tab=ai");
    await page.getByTestId("ki-lokal-lmstudio").click();
    await expect(page.getByTestId("ki-basis-url")).toHaveValue("http://127.0.0.1:1234/v1");
    // The one-click discovery went to the real default port: either an answer or a plain sentence.
    await expect(page.getByTestId("ki-modelle-fehler").or(page.getByTestId("ki-modell-liste"))).toBeVisible();

    await page.getByTestId("ki-basis-url").fill(`${stubBasis}/v1`);
    await page.getByTestId("ki-modelle-abrufen").click();
    const liste = page.getByTestId("ki-modell-liste");
    await expect(liste).toBeVisible();
    await expect(liste.locator("option")).toHaveText(["2 Modelle gefunden — wählen", "stub-modell-a", "stub-modell-b"]);
    await liste.selectOption("stub-modell-b");
    await expect(page.getByTestId("ki-modell")).toHaveValue("stub-modell-b");

    await page.getByTestId("ki-testen").click();
    await expect(page.getByTestId("ki-test-ergebnis")).toContainText("Verbindung erfolgreich");
    await expect(page.getByTestId("ki-test-ergebnis")).toContainText("stub-modell-b");
    expect(stub.aufrufe).toContain("POST /v1/chat/completions");
    expect(warnungen).toEqual([]);
  });

  test("Nur lokale KI: Schalter, Plakette, Cloud-Ziel serverseitig abgewiesen", async ({ page, request }) => {
    const { warnungen } = await vorbereiten(page);
    await page.goto("/Settings?tab=ai");
    await expect(page.getByTestId("nur-lokal-plakette")).toHaveCount(0);
    await expect(page.getByTestId("nur-lokal-schalter")).toBeEnabled();
    await page.getByTestId("nur-lokal-schalter").check();
    await expect(page.getByTestId("nur-lokal-plakette").first()).toBeVisible();
    expect((await (await request.get("/api/llm/einstellungen")).json()).nur_lokal).toBe(true);

    await page.getByTestId("ki-vorlage").selectOption("openai");
    await page.getByTestId("ki-modell").fill("gpt-x");
    await page.getByPlaceholder("sk-…").fill("sk-test-nicht-echt");
    await page.getByTestId("ki-testen").click();
    await expect(page.getByTestId("ki-test-ergebnis")).toContainText("Nur lokale KI ist eingeschaltet: Anfragen an api.openai.com werden nicht gesendet.");

    // The same rule on the AI route every feature uses (server-side, independent of the page).
    const direkt = await request.post("/api/llm/test", { data: { provider: "openai", base_url: "https://api.openai.com/v1", model: "g", api_key: "x" } });
    expect((await direkt.json()).gesperrt).toBe(true);

    // The KI Tool shows the badge too.
    await page.goto("/KiTool");
    await expect(page.getByTestId("nur-lokal-plakette").first()).toBeVisible();

    await page.goto("/Settings?tab=ai");
    await expect(page.getByTestId("nur-lokal-schalter")).toBeChecked();
    await page.getByTestId("nur-lokal-schalter").uncheck();
    await expect(page.getByTestId("nur-lokal-plakette")).toHaveCount(0);
    // Harness card: the state of this checkout (no harness/.venv in a fresh worktree → "nicht eingerichtet").
    await expect(page.getByTestId("harness-zustand")).toHaveText(/nicht eingerichtet|gestoppt|läuft/);
    expect(warnungen).toEqual([]);
  });

  test("Keine lokale KI: Download-Link öffnet nur die offizielle Seite, dann wird Ollama erkannt", async ({ page, request }) => {
    const { warnungen } = await vorbereiten(page);
    const tot = await totPort();
    await request.put("/api/llm/einstellungen", { data: { ollama_url: `http://127.0.0.1:${tot}`, lmstudio_url: `http://127.0.0.1:${tot}/v1` } });
    await page.goto("/Settings?tab=ai");
    await expect(page.getByTestId("ki-erkennung-ollama")).toContainText("läuft nicht");
    const link = page.getByTestId("ki-ollama-download");
    await expect(link).toHaveAttribute("href", "https://ollama.com/download");
    await expect(link).toHaveAttribute("target", "_blank");

    const popup = page.waitForEvent("popup");
    await link.click();
    await (await popup).close();
    await expect(page.getByTestId("ki-ollama-warten")).toBeVisible();

    // "Ollama installed": point the setting back at the stub — the page finds it by polling (5 s).
    await request.put("/api/llm/einstellungen", { data: { ollama_url: stubBasis, lmstudio_url: `${stubBasis}/v1` } });
    await expect(page.getByTestId("ki-erkennung-ollama")).toContainText("läuft (Version 0.0.0-stub)", { timeout: 15_000 });
    await expect(page.getByTestId("ki-ollama-warten")).toHaveCount(0);
    expect(warnungen).toEqual([]);
  });
});
