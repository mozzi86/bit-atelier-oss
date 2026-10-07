// Client for TypeSafe judgments (Phase 76-03) — the browser-side twin of
// InvokeLLM in Core.js: same building block (apiFetch to the local route),
// different contract (state + typed questions → probabilities, see
// packages/nova-core/server/typesafe.js).
//
// The key never reaches this module: the server route adds it.

import { apiFetch } from '../api/bitApi.js';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || '/api';

/**
 * Ask TypeSafe. Throws an Error carrying the server's plain-text `error`
 * (503 without key, 400 invalid, 502 upstream) — callers show it as is.
 * @param {{ state: unknown, questions: Record<string, object> }} params
 * @returns {Promise<{ model: string, answers: Record<string, object>, usage?: object }>}
 */
export async function urteile({ state, questions } = {}) {
  const res = await apiFetch(`${API_BASE}/integrations/typesafe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, questions }),
  });
  if (!res.ok) {
    let text = '';
    try {
      text = (await res.json())?.error || '';
    } catch {
      /* body was not JSON — fall through to the status text */
    }
    throw new Error(text || `TypeSafe HTTP ${res.status}`);
  }
  return res.json();
}
