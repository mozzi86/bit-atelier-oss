// TypeSafe server path (Phase 76-01): validation, missing key, pass-through,
// retry on 429/529, and the key never leaking into an error message.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKOFF_MS, MODELL, TYPESAFE_URL, pruefeAnfrage, urteile,
} from '../../packages/nova-core/server/typesafe.js';

const FRAGE = {
  type: 'choice',
  instructions: 'Kostengruppe für den Kurztext in state',
  criteria: { 391: 'Baustelleneinrichtung', 341: 'Tragende Innenwände', unbekannt: 'nicht eindeutig' },
};
const GUELTIG = { state: 'Bauzaun H 2m aufstellen', questions: { kg: FRAGE } };
const ANTWORT = {
  model: 'jev-1.13.0',
  answers: { kg: { type: 'choice', choice: '391', probabilities: { 391: 0.9, 341: 0.05, unbekannt: 0.05 }, confidence: 0.88 } },
  usage: { input_tokens: 120, output_tokens: 4 },
};

const optionen = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, null]));

/** Fetch stub returning the given statuses in order; records every call. */
function stubFetch(statusfolge, body = ANTWORT) {
  const aufrufe = [];
  return {
    aufrufe,
    fetch: async (url, init) => {
      aufrufe.push({ url, init });
      const status = statusfolge[Math.min(aufrufe.length - 1, statusfolge.length - 1)];
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (status === 401 ? 'invalid api key sk-test-geheim' : JSON.stringify(body)),
      };
    },
  };
}

test('pruefeAnfrage: fehlender state, leere questions, falscher type', () => {
  assert.equal(pruefeAnfrage({ questions: { kg: FRAGE } }).ok, false);
  assert.match(pruefeAnfrage({ questions: { kg: FRAGE } }).fehler, /state/);
  assert.match(pruefeAnfrage({ state: 'x', questions: {} }).fehler, /questions/);
  const r = pruefeAnfrage({ state: 'x', questions: { kg: { ...FRAGE, type: 'text' } } });
  assert.equal(r.ok, false);
  assert.match(r.fehler, /noul, choice oder score/);
});

test('pruefeAnfrage: choice mit 1 oder 256 criteria wird abgewiesen, 2 und 255 nicht', () => {
  const mit = (n) => pruefeAnfrage({ state: 'x', questions: { q: { ...FRAGE, criteria: optionen(n) } } });
  assert.match(mit(1).fehler, /mindestens 2/);
  assert.match(mit(256).fehler, /höchstens 255/);
  assert.equal(mit(2).ok, true);
  assert.equal(mit(255).ok, true);
});

test('pruefeAnfrage: score braucht 2–10 criteria, noul nur instructions', () => {
  const score = (n) => pruefeAnfrage({ state: 'x', questions: { s: { type: 'score', instructions: 'i', criteria: optionen(n) } } });
  assert.equal(score(1).ok, false);
  assert.equal(score(11).ok, false);
  assert.equal(score(3).ok, true);
  // score criteria may also be an ordered array (API example: ["Calm", "Frustrated", "Very angry"])
  assert.equal(pruefeAnfrage({ state: 'x', questions: { s: { type: 'score', instructions: 'i', criteria: ['ruhig', 'genervt', 'wütend'] } } }).ok, true);
  assert.equal(pruefeAnfrage({ state: { a: 1 }, questions: { n: { type: 'noul', instructions: 'Ist es dringend?' } } }).ok, true);
});

test('pruefeAnfrage: der Server bestimmt das Modell, ein model im Body wird ignoriert', () => {
  const r = pruefeAnfrage({ ...GUELTIG, model: 'foo' });
  assert.equal(r.ok, true);
  assert.equal(r.anfrage.model, MODELL);
  assert.equal(r.anfrage.model, 'jev-latest');
});

test('pruefeAnfrage: zu große Anfrage wird vor dem Netz abgewiesen', () => {
  const r = pruefeAnfrage({ state: 'x'.repeat(200_001), questions: { kg: FRAGE } });
  assert.equal(r.ok, false);
  assert.match(r.fehler, /zu groß/);
});

test('urteile: ohne Schlüssel 503 im Klartext, kein Netzaufruf', async () => {
  const s = stubFetch([200]);
  await assert.rejects(
    urteile(GUELTIG, { apiKey: '', fetchImpl: s.fetch, log: () => {} }),
    (e) => e.status === 503 && /TYPESAFE_API_KEY fehlt/.test(e.message) && /nicht simuliert/.test(e.message)
  );
  assert.equal(s.aufrufe.length, 0);
});

test('urteile: ungültige Anfrage → 400, kein Netzaufruf', async () => {
  const s = stubFetch([200]);
  await assert.rejects(
    urteile({ state: 'x', questions: {} }, { apiKey: 'k', fetchImpl: s.fetch, log: () => {} }),
    (e) => e.status === 400
  );
  assert.equal(s.aufrufe.length, 0);
});

test('urteile: Bearer-Header, model jev-latest im Body, Antwort unverändert, Log-Zeile mit Tokens', async () => {
  const s = stubFetch([200]);
  const logs = [];
  const data = await urteile(GUELTIG, { apiKey: 'test-key', fetchImpl: s.fetch, log: (z) => logs.push(z) });
  assert.deepEqual(data, ANTWORT);
  assert.equal(s.aufrufe.length, 1);
  assert.equal(s.aufrufe[0].url, TYPESAFE_URL);
  assert.equal(s.aufrufe[0].init.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(s.aufrufe[0].init.body);
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(body.questions, GUELTIG.questions);
  assert.deepEqual(logs, ['typesafe: 1 Fragen, 120 Tokens']);
});

test('urteile: 429 einmal → Backoff 500 ms → Erfolg', async () => {
  const s = stubFetch([429, 200]);
  const pausen = [];
  const data = await urteile(GUELTIG, { apiKey: 'k', fetchImpl: s.fetch, schlafen: async (ms) => pausen.push(ms), log: () => {} });
  assert.deepEqual(data, ANTWORT);
  assert.equal(s.aufrufe.length, 2);
  assert.deepEqual(pausen, [500]);
});

test('urteile: dreimal 529 → 502 Klartext, Backoff 500 + 2000', async () => {
  const s = stubFetch([529, 529, 529]);
  const pausen = [];
  await assert.rejects(
    urteile(GUELTIG, { apiKey: 'k', fetchImpl: s.fetch, schlafen: async (ms) => pausen.push(ms), log: () => {} }),
    (e) => e.status === 502 && /überlastet \(HTTP 529\)/.test(e.message) && /dreimal/.test(e.message)
  );
  assert.equal(s.aufrufe.length, 3);
  assert.deepEqual(pausen, BACKOFF_MS);
});

test('urteile: HTTP 401 → 502, der Schlüssel steht nicht in der Meldung', async () => {
  const s = stubFetch([401]);
  await assert.rejects(
    urteile(GUELTIG, { apiKey: 'sk-test-geheim', fetchImpl: s.fetch, log: () => {} }),
    (e) => e.status === 502 && /HTTP 401/.test(e.message) && !e.message.includes('sk-test-geheim')
  );
});

test('urteile: Netzfehler → 502 „nicht erreichbar"', async () => {
  const kaputt = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    urteile(GUELTIG, { apiKey: 'k', fetchImpl: kaputt, log: () => {} }),
    (e) => e.status === 502 && /nicht erreichbar/.test(e.message) && /ECONNREFUSED/.test(e.message)
  );
});
