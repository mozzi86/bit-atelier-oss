// kiVorlagen.test.js — the endpoint URL rule and the provider presets of plan 83-03
// (packages/nova-core/src/lib/kiVorlagen.js), plus the wiring in llm.js: the server
// must call exactly the URL the rule builds, for every preset the form offers.
//
// Provider base URLs: checked against each provider's own documentation on
// 07.10.2026 (sources in KI_VORLAGEN[].quelle).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatCompletionsUrl, anthropicMessagesUrl, ollamaChatUrl, endpunktUrl,
  KI_VORLAGEN, KI_TYPEN, vorlageFuer,
} from '../../packages/nova-core/src/lib/kiVorlagen.js';
import {
  callConnection, anthropicModell, openaiModell,
  STANDARD_ANTHROPIC_MODELL, STANDARD_OPENAI_MODELL,
  endpunktUrl as endpunktUrlAusLlm,
} from '../../packages/nova-core/server/llm.js';

describe('endpunktUrl — one URL per provider', () => {
  const faelle = [
    ['Anthropic', 'anthropic', 'https://api.anthropic.com', 'https://api.anthropic.com/v1/messages'],
    ['Anthropic mit /v1', 'anthropic', 'https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages'],
    ['OpenAI ohne /v1 (alte gespeicherte Verbindung)', 'openai', 'https://api.openai.com', 'https://api.openai.com/v1/chat/completions'],
    ['OpenAI mit /v1', 'openai', 'https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
    ['Gemini', 'openai', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['Gemini mit Schrägstrich (so dokumentiert)', 'openai', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['OpenRouter', 'openai', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/chat/completions'],
    ['Mistral', 'openai', 'https://api.mistral.ai/v1', 'https://api.mistral.ai/v1/chat/completions'],
    ['Groq', 'openai', 'https://api.groq.com/openai/v1', 'https://api.groq.com/openai/v1/chat/completions'],
    ['DeepSeek (dokumentiert ohne /v1)', 'openai', 'https://api.deepseek.com', 'https://api.deepseek.com/chat/completions'],
    ['Qwen / DashScope', 'openai', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['LM Studio', 'openai', 'http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1/chat/completions'],
    ['LM Studio ohne /v1', 'custom', 'http://127.0.0.1:1234', 'http://127.0.0.1:1234/v1/chat/completions'],
    ['Ollama nativ', 'ollama', 'http://127.0.0.1:11434', 'http://127.0.0.1:11434/api/chat'],
    ['Ollama nativ, Basis mit /v1 eingetippt', 'ollama', 'http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/api/chat'],
    ['Ollama OpenAI-kompatibel als eigener Endpunkt', 'custom', 'http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1/chat/completions'],
    ['Endpunkt komplett eingefügt', 'custom', 'https://gateway.example/llm/chat/completions', 'https://gateway.example/llm/chat/completions'],
    ['Pfad endet auf /openai', 'custom', 'https://gateway.example/proxy/openai', 'https://gateway.example/proxy/openai/chat/completions'],
  ];
  for (const [name, provider, basis, erwartet] of faelle) {
    it(name, () => assert.equal(endpunktUrl(provider, basis), erwartet));
  }

  it('leere Basis → leerer String (llm.js meldet dann "Keine Basis-URL")', () => {
    assert.equal(endpunktUrl('openai', ''), '');
    assert.equal(chatCompletionsUrl('  '), '');
    assert.equal(anthropicMessagesUrl(''), '');
    assert.equal(ollamaChatUrl(''), '');
  });

  it('"v1" als Teil eines Wortes zählt nicht als Versionssegment', () => {
    assert.equal(chatCompletionsUrl('https://v1proxy.example/llm'), 'https://v1proxy.example/llm/v1/chat/completions');
  });

  it('llm.js re-exportiert dieselbe Funktion (eine Regel)', () => {
    assert.equal(endpunktUrlAusLlm, endpunktUrl);
  });
});

describe('KI_VORLAGEN — the presets the form offers', () => {
  it('genau die beauftragten elf Vorlagen in dieser Reihenfolge', () => {
    assert.deepEqual(KI_VORLAGEN.map((v) => v.label), [
      'Anthropic', 'OpenAI', 'Google Gemini', 'Mistral', 'OpenRouter', 'Groq', 'DeepSeek',
      'Qwen (DashScope)', 'LM Studio (lokal)', 'Ollama (lokal)', 'Eigener Endpunkt',
    ]);
  });

  it('jede Vorlage nutzt einen bekannten Verbindungstyp und hat ein Beispielmodell', () => {
    const typen = KI_TYPEN.map((t) => t.v);
    for (const v of KI_VORLAGEN) {
      assert.ok(typen.includes(v.provider), `${v.id}: Typ ${v.provider} unbekannt`);
      assert.ok(v.beispielModell, `${v.id}: Beispielmodell fehlt`);
    }
  });

  it('Cloud-Vorlagen: https und eine Quelle; lokale Vorlagen: 127.0.0.1', () => {
    for (const v of KI_VORLAGEN.filter((x) => x.baseUrl)) {
      if (v.lokal) assert.match(v.baseUrl, /^http:\/\/127\.0\.0\.1:/, v.id);
      else {
        assert.match(v.baseUrl, /^https:\/\//, v.id);
        assert.match(v.quelle, /^https:\/\//, `${v.id}: Quelle fehlt`);
      }
    }
  });

  it('vorlageFuer erkennt gespeicherte Verbindungen wieder', () => {
    assert.equal(vorlageFuer('openai', 'https://openrouter.ai/api/v1/'), 'openrouter');
    assert.equal(vorlageFuer('anthropic', 'https://api.anthropic.com'), 'anthropic');
    assert.equal(vorlageFuer('ollama', 'http://127.0.0.1:11434'), 'ollama');
    assert.equal(vorlageFuer('custom', 'https://irgendwas.example'), 'custom');
    assert.equal(vorlageFuer('openai', 'https://api.openai.com'), '', 'alte URL ohne /v1 → keine Vorlage, Werte bleiben');
  });
});

describe('llm.js — calls the URL of the rule, models from the environment', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  /** Replaces fetch, records the call and answers like the provider would. */
  function fetchAufzeichnen(antwort) {
    const aufrufe = [];
    globalThis.fetch = async (url, init) => {
      aufrufe.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(antwort), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return aufrufe;
  }

  for (const v of KI_VORLAGEN.filter((x) => x.baseUrl)) {
    it(`Vorlage ${v.id} → ${endpunktUrl(v.provider, v.baseUrl)}`, async () => {
      const antwort = v.provider === 'anthropic'
        ? { content: [{ type: 'text', text: 'OK' }] }
        : v.provider === 'ollama' ? { message: { content: 'OK' } } : { choices: [{ message: { content: 'OK' } }] };
      const aufrufe = fetchAufzeichnen(antwort);
      const text = await callConnection({ provider: v.provider, base_url: v.baseUrl, model: v.beispielModell, api_key: v.lokal ? '' : 'sk-test-123456' }, { prompt: 'Hallo' });
      assert.equal(text, 'OK');
      assert.equal(aufrufe.length, 1);
      assert.equal(aufrufe[0].url, endpunktUrl(v.provider, v.baseUrl));
      assert.equal(aufrufe[0].body.model, v.beispielModell);
    });
  }

  it('Anthropic-Verbindung ohne Modell → Standard claude-sonnet-5-5', async () => {
    const aufrufe = fetchAufzeichnen({ content: [{ type: 'text', text: 'OK' }] });
    await callConnection({ provider: 'anthropic', base_url: '', api_key: 'sk-test-123456' }, { prompt: 'x' });
    assert.equal(aufrufe[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(aufrufe[0].body.model, 'claude-sonnet-5-5');
    assert.equal(STANDARD_ANTHROPIC_MODELL, 'claude-sonnet-5-5');
  });

  it('ANTHROPIC_MODEL / OPENAI_MODEL vor LLM_MODEL vor der Vorgabe', () => {
    assert.equal(anthropicModell({}), 'claude-sonnet-5-5');
    assert.equal(anthropicModell({ LLM_MODEL: 'alt' }), 'alt');
    assert.equal(anthropicModell({ LLM_MODEL: 'alt', ANTHROPIC_MODEL: 'claude-opus-5-5' }), 'claude-opus-5-5');
    assert.equal(openaiModell({}), STANDARD_OPENAI_MODELL);
    assert.equal(openaiModell({ OPENAI_MODEL: 'gpt-x', LLM_MODEL: 'alt' }), 'gpt-x');
  });
});
