// kiVorlagen.js — AI provider presets and the endpoint URL rule (Plan 83-03,
// "KI für alle"). ONE source for both sides:
//   - packages/nova-core/server/llm.js builds the request URL with endpunktUrl()
//   - src/components/ai/LlmConnections.jsx offers KI_VORLAGEN in the form and
//     shows the resulting endpoint before the user saves
//
// Why a rule instead of a fixed suffix: llm.js used to append `/v1/chat/completions`
// to every OpenAI-compatible base URL. That is right for `https://api.openai.com`
// but wrong for every provider that documents its base WITH a version segment —
// Gemini `…/v1beta/openai`, OpenRouter `…/api/v1`, DashScope `…/compatible-mode/v1`,
// LM Studio `…/v1` — which became `…/v1/v1/chat/completions` (404). Old stored
// connections without a version segment keep their old URL.
//
// Pure and loadable under plain node (no import.meta.env, no browser API).
// In:  provider type + base URL. Out: the full endpoint URL; preset tables.

/**
 * A path segment that already names an API version: v1, v2, v4, v1beta, v1alpha …
 * Matches a whole segment only (`/v1beta/`), never a part of a host or word.
 */
const VERSIONS_SEGMENT = /^v\d+[a-z0-9]*$/i;

/**
 * Hosts whose OpenAI-compatible endpoint sits directly under the root, without /v1.
 * [CITED] DeepSeek: base_url https://api.deepseek.com, POST /chat/completions —
 * https://api-docs.deepseek.com/ and https://api-docs.deepseek.com/api/create-chat-completion
 * (checked 07.10.2026; the docs no longer mention a /v1 form).
 */
const HOSTS_OHNE_V1 = ['api.deepseek.com'];

/**
 * @param {string|undefined|null} basis base URL as typed by the user
 * @returns {string} trimmed, without trailing slashes
 */
function normiert(basis) {
  return String(basis ?? '').trim().replace(/\/+$/, '');
}

/**
 * @param {string} basis normalised base URL
 * @returns {{ host: string, segmente: string[] }} host (lower case) and path segments
 */
function zerlegt(basis) {
  try {
    const url = new URL(basis);
    return { host: url.hostname.toLowerCase(), segmente: url.pathname.split('/').filter(Boolean) };
  } catch {
    return { host: '', segmente: basis.split('/').filter(Boolean) };
  }
}

/**
 * Full URL of an OpenAI-compatible Chat Completions endpoint.
 * - base already ends with /chat/completions → unchanged (user pasted the endpoint)
 * - base contains a version segment (/v1, /v1beta, /api/v1, /compatible-mode/v1 …)
 *   or ends with /openai, or the host is listed in HOSTS_OHNE_V1 → + /chat/completions
 * - otherwise → + /v1/chat/completions (the pre-83-03 behaviour, keeps stored
 *   connections like https://api.openai.com working)
 * @param {string} basisUrl base URL
 * @returns {string} endpoint URL, '' for an empty base
 */
export function chatCompletionsUrl(basisUrl) {
  const basis = normiert(basisUrl);
  if (!basis) return '';
  if (/\/chat\/completions$/i.test(basis)) return basis;
  const { host, segmente } = zerlegt(basis);
  const letztes = (segmente[segmente.length - 1] || '').toLowerCase();
  const ohneV1 = segmente.some((s) => VERSIONS_SEGMENT.test(s)) || letztes === 'openai' || HOSTS_OHNE_V1.includes(host);
  return ohneV1 ? `${basis}/chat/completions` : `${basis}/v1/chat/completions`;
}

/**
 * Full URL of the Anthropic Messages endpoint. Accepts the base with or without /v1.
 * [CITED] POST https://api.anthropic.com/v1/messages — https://platform.claude.com/docs/en/api/messages
 * @param {string} basisUrl base URL, e.g. https://api.anthropic.com
 * @returns {string} endpoint URL, '' for an empty base
 */
export function anthropicMessagesUrl(basisUrl) {
  const basis = normiert(basisUrl);
  if (!basis) return '';
  if (/\/v1\/messages$/i.test(basis)) return basis;
  return /\/v1$/i.test(basis) ? `${basis}/messages` : `${basis}/v1/messages`;
}

/**
 * Full URL of Ollama's native chat endpoint. A base typed with /v1 (Ollama's
 * OpenAI-compatible path) or /api is reduced to the server root first.
 * [CITED] POST http://localhost:11434/api/chat — https://docs.ollama.com/api/chat
 * @param {string} basisUrl base URL, e.g. http://127.0.0.1:11434
 * @returns {string} endpoint URL, '' for an empty base
 */
export function ollamaChatUrl(basisUrl) {
  const basis = normiert(basisUrl).replace(/\/(v1|api)$/i, '');
  if (!basis) return '';
  return `${basis}/api/chat`;
}

/**
 * The endpoint a connection talks to, per connection type.
 * @param {string} provider connection type: 'anthropic' | 'openai' | 'ollama' | 'custom'
 * @param {string} basisUrl base URL (already resolved to the type's default if it was empty)
 * @returns {string} endpoint URL, '' for an empty base
 */
export function endpunktUrl(provider, basisUrl) {
  if (provider === 'anthropic') return anthropicMessagesUrl(basisUrl);
  if (provider === 'ollama') return ollamaChatUrl(basisUrl);
  // 'openai' and 'custom' (and anything unknown) speak OpenAI Chat Completions.
  return chatCompletionsUrl(basisUrl);
}

/**
 * Connection types — the transport the server uses. Labels are i18n keys (t()).
 * @type {Array<{ v: string, label: string }>}
 */
export const KI_TYPEN = [
  { v: "anthropic", label: "Anthropic" },
  { v: "openai", label: "OpenAI-kompatibel" },
  { v: "ollama", label: "Ollama (lokal)" },
  { v: "custom", label: "Eigener Endpunkt" },
];

/**
 * Provider presets for the connection form: a preset fills type + base URL; the
 * model name stays free text (beispielModell is only the placeholder).
 * Labels are i18n keys (t()). Base URLs are [CITED] from the provider's own
 * documentation, checked 07.10.2026 (source in `quelle`). The example model IDs
 * are [ASSUMED] placeholders — model line-ups change monthly; the provider's
 * model list is the truth.
 * Local servers use 127.0.0.1 instead of the documented "localhost": Node's
 * fetch may resolve localhost to ::1 first, while LM Studio/Ollama listen on IPv4.
 * @type {Array<{ id: string, label: string, provider: string, baseUrl: string,
 *   beispielModell: string, lokal: boolean, quelle: string }>}
 */
export const KI_VORLAGEN = [
  { id: "anthropic", label: "Anthropic", provider: "anthropic", baseUrl: "https://api.anthropic.com", beispielModell: "claude-sonnet-5-5", lokal: false, quelle: "https://platform.claude.com/docs/en/api/overview" },
  { id: "openai", label: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", beispielModell: "gpt-4o-mini", lokal: false, quelle: "https://developers.openai.com/api/reference" },
  { id: "gemini", label: "Google Gemini", provider: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", beispielModell: "gemini-3.8-flash", lokal: false, quelle: "https://ai.google.dev/gemini-api/docs/openai" },
  { id: "mistral", label: "Mistral", provider: "openai", baseUrl: "https://api.mistral.ai/v1", beispielModell: "mistral-large-latest", lokal: false, quelle: "https://docs.mistral.ai/api/" },
  { id: "openrouter", label: "OpenRouter", provider: "openai", baseUrl: "https://openrouter.ai/api/v1", beispielModell: "openai/gpt-4o-mini", lokal: false, quelle: "https://openrouter.ai/docs/quickstart" },
  { id: "groq", label: "Groq", provider: "openai", baseUrl: "https://api.groq.com/openai/v1", beispielModell: "llama-3.3-70b-versatile", lokal: false, quelle: "https://console.groq.com/docs/openai" },
  { id: "deepseek", label: "DeepSeek", provider: "openai", baseUrl: "https://api.deepseek.com", beispielModell: "deepseek-v4-pro", lokal: false, quelle: "https://api-docs.deepseek.com/" },
  // Alibaba Model Studio international (Singapore). The docs now recommend a
  // per-workspace domain https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1;
  // dashscope-intl stays available ("migration recommended") —
  // https://www.alibabacloud.com/help/en/model-studio/base-url
  { id: "qwen", label: "Qwen (DashScope)", provider: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", beispielModell: "qwen3.8-max", lokal: false, quelle: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope" },
  { id: "lmstudio", label: "LM Studio (lokal)", provider: "openai", baseUrl: "http://127.0.0.1:1234/v1", beispielModell: "openai/gpt-oss-20b", lokal: true, quelle: "https://lmstudio.ai/docs/app/api/endpoints/openai" },
  { id: "ollama", label: "Ollama (lokal)", provider: "ollama", baseUrl: "http://127.0.0.1:11434", beispielModell: "llama3.2", lokal: true, quelle: "https://docs.ollama.com/api/chat" },
  { id: "custom", label: "Eigener Endpunkt", provider: "custom", baseUrl: "", beispielModell: "mein-modell", lokal: false, quelle: "" },
];

/**
 * The preset a stored connection corresponds to (same type and same base URL,
 * trailing slashes ignored); a custom connection maps to the "custom" preset.
 * @param {string} provider connection type
 * @param {string} basisUrl stored base URL
 * @returns {string} preset id, '' when no preset matches
 */
export function vorlageFuer(provider, basisUrl) {
  const basis = normiert(basisUrl).toLowerCase();
  const treffer = KI_VORLAGEN.find((v) => v.provider === provider && normiert(v.baseUrl).toLowerCase() === basis);
  if (treffer) return treffer.id;
  return provider === 'custom' ? 'custom' : '';
}
