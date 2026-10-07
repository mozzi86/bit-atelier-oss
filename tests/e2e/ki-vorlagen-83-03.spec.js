// Headless proof 83-03: AI connection presets in Settings › KI-Verbindungen.
//
// Choosing a preset fills connection type and base URL, and the hint under the base
// URL shows exactly the endpoint the server will call (same rule as llm.js). The
// model field stays free text with an example placeholder. Nothing is saved or
// tested — the form must not contact any host, and the dev database stays untouched.
//
// Rules (lessons 75-05…75-14): --workers=1 · everything but localhost is blocked.
//
// Run: npx playwright test tests/e2e/ki-vorlagen-83-03.spec.js --workers=1

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE } from "./fixtures/massing.js";

const LOKAL = ["localhost", "127.0.0.1", "[::1]"];

test.describe("83-03 KI-Vorlagen", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  test("Vorlage setzt Typ und Basis-URL, der Hinweis zeigt den echten Endpunkt", async ({ page }) => {
    const fremd = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (/^(blob|data):/.test(url) || LOKAL.includes(new URL(url).hostname)) return route.continue();
      fremd.push(url);
      return route.abort();
    });
    const warnungen = [];
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
    });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    const schreibend = [];
    page.on("request", (r) => { if (r.url().includes("/api/llm/") && r.method() !== "GET") schreibend.push(`${r.method()} ${r.url()}`); });

    await page.goto("/Settings?tab=ai");
    const vorlage = page.getByTestId("ki-vorlage");
    await expect(vorlage).toBeVisible();

    // The eleven presets in the commissioned order.
    const optionen = await vorlage.locator("option").allTextContents();
    expect(optionen.slice(1)).toEqual([
      "Anthropic", "OpenAI", "Google Gemini", "Mistral", "OpenRouter", "Groq", "DeepSeek",
      "Qwen (DashScope)", "LM Studio (lokal)", "Ollama (lokal)", "Eigener Endpunkt",
    ]);

    const ziel = page.getByTestId("ki-ziel-url");
    const basis = page.getByPlaceholder(/api\.anthropic\.com|api\.openai\.com|127\.0\.0\.1|mein-server/);

    // Default: Anthropic.
    await expect(ziel).toContainText("https://api.anthropic.com/v1/messages");

    const faelle = [
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"],
      ["openrouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/chat/completions"],
      ["deepseek", "https://api.deepseek.com", "https://api.deepseek.com/chat/completions"],
      ["qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"],
      ["lmstudio", "http://127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1/chat/completions"],
      ["ollama", "http://127.0.0.1:11434", "http://127.0.0.1:11434/api/chat"],
    ];
    for (const [id, url, endpunkt] of faelle) {
      await vorlage.selectOption(id);
      await expect(basis).toHaveValue(url);
      await expect(ziel).toContainText(endpunkt);
    }
    // Local preset: no key needed, the hint says so.
    await expect(page.getByPlaceholder("Für lokale Server nicht erforderlich")).toBeVisible();
    // Model stays free text, with the preset's example as placeholder.
    await expect(page.getByPlaceholder("z. B. llama3.2")).toBeVisible();

    // Typing a base URL by hand drops the preset, the rule still applies.
    await vorlage.selectOption("custom");
    await basis.fill("https://gateway.example/v4");
    await expect(ziel).toContainText("https://gateway.example/v4/chat/completions");

    expect(schreibend, "nothing saved or tested").toEqual([]);
    expect(fremd, "keine Netzanfrage nach außen").toEqual([]);
    expect(warnungen, "Konsole ohne Fehler").toEqual([]);
  });
});
