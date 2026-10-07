// Local replacement for Base44's "@core/integrations/Core".
// InvokeLLM mirrors Base44's contract: returns a string normally, or a parsed
// object when `response_json_schema` is supplied. Hits the local LLM proxy.

import { apiFetch } from '../api/bitApi.js';

// `?.` wie in bitApi (57-02 review #2): dieses Modul wird unter node von
// Unit-Tests importiert — dort ist import.meta.env undefined.
const API_BASE = import.meta.env?.VITE_API_BASE_URL || '/api';

/**
 * Calls the configured language model through the app's own proxy route.
 * The pre-computed sample answers of the online demo were removed with the
 * demo (83-02): without a server the call fails with a plain-text error.
 * @param {object} [params] prompt, response_json_schema, add_context_from_internet …
 * @returns {Promise<string|object>} model answer (object when a schema was given)
 */
export async function InvokeLLM(params = {}) {
  // 57-04 Task 5: apiFetch statt roh fetch — im Cloud-Modus geht der Aufruf
  // an die Edge Function `llm` (aktion: 'invoke'), express/lokal unverändert
  // (dieselbe URL wie vorher).
  const res = await apiFetch(`${API_BASE}/integrations/invoke-llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`InvokeLLM failed: ${res.status}`);
  }
  const data = await res.json();
  // The proxy returns the raw string/object directly.
  return data;
}

// Placeholders for other Base44 Core integrations, in case future code imports
// them. They throw clearly rather than failing silently.
export async function UploadFile() {
  throw new Error('UploadFile is not implemented in the local backend.');
}
export async function SendEmail() {
  throw new Error('SendEmail is not implemented in the local backend.');
}
export async function GenerateImage() {
  throw new Error('GenerateImage is not implemented in the local backend.');
}
