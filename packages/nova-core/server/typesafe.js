// TypeSafe judgments (Phase 76-01): the one server path to
// POST https://api.typesafe.ai/v1/systemone.
//
// TypeSafe returns typed judgments with probabilities (choice / noul / score),
// not text. That is a different contract from invokeLLM (prompt + JSON schema),
// so it lives in its own module instead of being pressed into llm.js.
//
// Deliberately NO offline mock: a simulated probability would be exactly the
// "guessed cost group" that rule T-33-23 forbids (a guessed cost group moves
// money). Without TYPESAFE_API_KEY the route answers 503 in plain text.
//
// No SDK, no new dependency — fetch and AbortController are global in Node >= 20.
import express from 'express';

export const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
export const MODELL = 'jev-latest';
export const MAX_OPTIONEN = 255;
export const MAX_ZEICHEN = 200_000;
/** Backoff before the 2nd and 3rd attempt on HTTP 429 / 529 (ms). */
export const BACKOFF_MS = [500, 2000];

const TYPEN = new Set(['noul', 'choice', 'score']);

const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * Validate a request body before anything leaves the machine.
 * @param {unknown} body
 * @returns {{ ok: true, anfrage: object } | { ok: false, fehler: string }}
 */
export function pruefeAnfrage(body) {
  if (!istObjekt(body)) return { ok: false, fehler: 'Anfrage muss ein JSON-Objekt sein' };
  const { state, questions } = body;
  const stateOk = typeof state === 'string' ? state.length > 0 : state !== null && typeof state === 'object';
  if (!stateOk) return { ok: false, fehler: 'state fehlt (String, Objekt oder Array)' };
  if (!istObjekt(questions) || Object.keys(questions).length === 0) {
    return { ok: false, fehler: 'questions fehlt oder ist leer' };
  }
  for (const [id, q] of Object.entries(questions)) {
    if (!istObjekt(q)) return { ok: false, fehler: `Frage "${id}" ist kein Objekt` };
    if (!TYPEN.has(q.type)) {
      return { ok: false, fehler: `Frage "${id}": type muss noul, choice oder score sein (ist "${q.type}")` };
    }
    if (typeof q.instructions !== 'string' || q.instructions.trim() === '') {
      return { ok: false, fehler: `Frage "${id}": instructions fehlen` };
    }
    // The API names the answer set `criteria` for choice AND score (verified live
    // 21.09.2026: `options` answers 422 "criteria: Field required").
    if (q.type === 'choice') {
      const n = istObjekt(q.criteria) ? Object.keys(q.criteria).length : 0;
      if (n < 2) return { ok: false, fehler: `Frage "${id}": choice braucht mindestens 2 criteria` };
      if (n > MAX_OPTIONEN) return { ok: false, fehler: `Frage "${id}": choice erlaubt höchstens ${MAX_OPTIONEN} criteria (${n})` };
    }
    if (q.type === 'score') {
      const n = Array.isArray(q.criteria) ? q.criteria.length : istObjekt(q.criteria) ? Object.keys(q.criteria).length : 0;
      if (n < 2 || n > 10) return { ok: false, fehler: `Frage "${id}": score braucht 2 bis 10 criteria (${n})` };
    }
  }
  // The server decides the model — a `model` in the body is ignored on purpose.
  const anfrage = { state, model: MODELL, questions };
  const groesse = JSON.stringify(anfrage).length;
  if (groesse > MAX_ZEICHEN) {
    return { ok: false, fehler: `Anfrage zu groß (${groesse} Zeichen, max. ${MAX_ZEICHEN})` };
  }
  return { ok: true, anfrage };
}

const fehler = (status, text) => Object.assign(new Error(text), { status });

/**
 * Send one request to TypeSafe and return its answer unchanged.
 * `fetchImpl` and `schlafen` are injectable so tests run without network or waiting.
 */
export async function urteile(
  body,
  {
    apiKey = process.env.TYPESAFE_API_KEY,
    fetchImpl = fetch,
    schlafen = (ms) => new Promise((r) => setTimeout(r, ms)),
    timeoutMs = 30_000,
    log = console.log,
  } = {}
) {
  const geprueft = pruefeAnfrage(body);
  if (!geprueft.ok) throw fehler(400, geprueft.fehler);
  if (!apiKey) throw fehler(503, 'TYPESAFE_API_KEY fehlt in .env — Urteile werden nicht simuliert');

  let antwort = null;
  for (let versuch = 0; versuch <= BACKOFF_MS.length; versuch += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      antwort = await fetchImpl(TYPESAFE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(geprueft.anfrage),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const grund = e?.name === 'AbortError' ? `Zeitüberschreitung nach ${timeoutMs} ms` : (e?.message || String(e));
      throw fehler(502, `TypeSafe nicht erreichbar: ${grund}`);
    }
    clearTimeout(timer);
    if (antwort.status !== 429 && antwort.status !== 529) break;
    if (versuch < BACKOFF_MS.length) await schlafen(BACKOFF_MS[versuch]);
  }

  if (antwort.status === 429 || antwort.status === 529) {
    throw fehler(502, `TypeSafe überlastet (HTTP ${antwort.status}) — dreimal versucht`);
  }
  if (!antwort.ok) {
    const text = await antwort.text().catch(() => '');
    // The key travels in the header, never in the body — still, never echo it.
    throw fehler(502, `TypeSafe HTTP ${antwort.status}: ${text.replaceAll(apiKey, '•••').slice(0, 300)}`);
  }
  const data = await antwort.json();
  const n = Object.keys(geprueft.anfrage.questions).length;
  log(`typesafe: ${n} Fragen, ${data?.usage?.input_tokens ?? '?'} Tokens`);
  return data;
}

/** Express router factory: POST /integrations/typesafe (mounted under /api). */
export function typesafeRouter() {
  const r = express.Router();
  r.post('/integrations/typesafe', async (req, res) => {
    try {
      res.json(await urteile(req.body || {}));
    } catch (err) {
      if (!err.status || err.status >= 500) console.error('typesafe error:', err.message || err);
      res.status(err.status || 500).json({ error: err.message || 'TypeSafe-Aufruf fehlgeschlagen' });
    }
  });
  return r;
}
