// 106-05: the app side of the speech service in src/lib/harnessClient.js with a fake fetch and a fake WebSocket:
// sprechBereitschaft (what the speech field may do: harness there, recognition, provider local, "Nur lokale KI", viewer tools) and
// agentFrage (one task to the harness agent in the speech profile; an approval request is ALWAYS answered "nein", decision D-IM-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sprechBereitschaft, agentFrage, SPRECH_OHNE_HARNESS, HARNESS_URL } from '../../src/lib/harnessClient.js';

/** Replaces globalThis.fetch for one test; `antworten` maps a URL part to a JSON body (or an Error to throw). */
function fetchFake(antworten) {
  const alt = globalThis.fetch;
  /** @type {string[]} */
  const aufrufe = [];
  globalThis.fetch = /** @type {any} */ (async (url) => {
    aufrufe.push(String(url));
    for (const [teil, body] of Object.entries(antworten)) {
      if (String(url).includes(teil)) {
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, json: async () => body };
      }
    }
    throw new TypeError('Failed to fetch');
  });
  return { aufrufe, zurueck: () => { globalThis.fetch = alt; } };
}

/** A WebSocket stand-in: records what the client sends; the test drives the service's events with `ereignis()`. */
function wsFake() {
  const alt = globalThis.WebSocket;
  /** @type {any[]} */
  const offen = [];
  class FakeWs {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      /** @type {any[]} */
      this.gesendet = [];
      this.zu = false;
      /** @type {any} */ this.onmessage = null;
      /** @type {any} */ this.onclose = null;
      /** @type {any} */ this.onerror = null;
      offen.push(this);
    }
    /** @param {string} s */
    send(s) { this.gesendet.push(JSON.parse(s)); }
    close() { if (this.zu) return; this.zu = true; this.onclose?.({}); }
    /** @param {any} ev */
    ereignis(ev) { this.onmessage?.({ data: JSON.stringify(ev) }); }
  }
  globalThis.WebSocket = /** @type {any} */ (FakeWs);
  return { offen, zurueck: () => { globalThis.WebSocket = alt; } };
}

test('sprechBereitschaft: harness not reachable -> harness false with the sentence of the plan, never throws', async () => {
  const f = fetchFake({ '/api/llm/einstellungen': { nur_lokal: true } });
  try {
    const b = await sprechBereitschaft();
    assert.equal(b.harness, false);
    assert.equal(b.stt, false);
    assert.equal(b.mcp, false);
    assert.equal(b.nurLokalApp, true);
    assert.equal(b.hinweis, SPRECH_OHNE_HARNESS);
    assert.equal(SPRECH_OHNE_HARNESS, 'Spracheingabe braucht den KI-Harness (Einstellungen › KI)');
  } finally { f.zurueck(); }
});

test('sprechBereitschaft: a running harness with recognition, a local provider and the viewer tools', async () => {
  const f = fetchFake({
    '/api/llm/einstellungen': { nur_lokal: false },
    [`${HARNESS_URL}/status`]: { provider: 'lokal-test', provider_lokal: true, nur_lokal: false,
      stt: { verfuegbar: true, bereit: true }, mcp: { aktiv: true, verbunden: false, werkzeuge: [], hinweis: '' } },
  });
  try {
    const b = await sprechBereitschaft();
    assert.deepEqual(b, { harness: true, stt: true, sttBereit: true, hinweis: '', sttHinweis: '', mcpHinweis: '', provider: 'lokal-test', providerLokal: true,
      nurLokalApp: false, nurLokalHarness: false, mcp: true,
      // 106-06 (additive): image ability, model and target host of the harness - unknown in this older status answer
      bilder: false, modell: null, providerZiel: null });
  } finally { f.zurueck(); }
});

test('sprechBereitschaft: recognition off and MCP switched off are said in words; the app route missing is not "Nur lokal"', async () => {
  const f = fetchFake({
    [`${HARNESS_URL}/status`]: { provider: 'cloud', provider_lokal: false, nur_lokal: true,
      stt: { verfuegbar: false, hinweis: 'stt.enabled: false' }, mcp: { aktiv: false, hinweis: 'aus' } },
  });
  try {
    const b = await sprechBereitschaft();
    assert.equal(b.harness, true);
    assert.equal(b.stt, false);
    assert.equal(b.hinweis, 'Spracheingabe nicht verfügbar: stt.enabled: false');
    // review 106-05: two causes, two fields - a typed free sentence must name the MCP cause, not the microphone one
    assert.equal(b.sttHinweis, 'Spracheingabe nicht verfügbar: stt.enabled: false');
    assert.equal(b.mcpHinweis, 'aus');
    assert.equal(b.mcp, false);
    assert.equal(b.providerLokal, false);
    assert.equal(b.nurLokalApp, false);
    assert.equal(b.nurLokalHarness, true);
  } finally { f.zurueck(); }
});

test('agentFrage: speech profile, the task as the one user message, text and tools collected, approval answered NO', async () => {
  const w = wsFake();
  try {
    /** @type {any[]} */
    const gesehen = [];
    const p = agentFrage('Sprachbefehl: „mach die Wand dicker“', { onEvent: (ev) => gesehen.push(ev.type) });
    const ws = w.offen[0];
    assert.match(ws.url, /\/ws\/chat\?profil=sprechen$/);
    ws.ereignis({ type: 'hello', session: 's1' });
    assert.deepEqual(ws.gesendet[0], { type: 'user', text: 'Sprachbefehl: „mach die Wand dicker“' });
    ws.ereignis({ type: 'tool_call', name: 'eigenschaft_setzen', args: {} });
    ws.ereignis({ type: 'approval', id: 'a1', befehl: 'x', erklaerung: 'y' });
    assert.deepEqual(ws.gesendet[1], { type: 'approval_reply', id: 'a1', ja: false }, 'a program never says yes for the person');
    ws.ereignis({ type: 'text_delta', text: 'Vorschlag: ' });
    ws.ereignis({ type: 'text_delta', text: 'Dicke 36 cm.' });
    ws.ereignis({ type: 'done', stop_reason: 'end_turn' });
    const r = await p;
    assert.deepEqual(r, { text: 'Vorschlag: Dicke 36 cm.', werkzeuge: ['eigenschaft_setzen'], vorschlaege: 0, fehler: null });
    assert.equal(ws.zu, true, 'the socket is closed after the turn');
    assert.deepEqual(gesehen, ['hello', 'tool_call', 'approval', 'text_delta', 'text_delta', 'done']);
  } finally { w.zurueck(); }
});

test('agentFrage: an error event, a closed socket and a timeout resolve with a German sentence, never reject', async () => {
  const w = wsFake();
  try {
    const p1 = agentFrage('a');
    w.offen[0].ereignis({ type: 'error', message: 'Keine Verbindung zu den Modell-Werkzeugen der App' });
    assert.equal((await p1).fehler, 'Keine Verbindung zu den Modell-Werkzeugen der App');

    const p2 = agentFrage('b');
    w.offen[1].close();
    assert.match(String((await p2).fehler), /Verbindung zum KI-Harness wurde beendet/);

    const p3 = agentFrage('c', { timeoutMs: 20 });
    assert.match(String((await p3).fehler), /nicht innerhalb von/);

    const p4 = agentFrage('d');
    w.offen[3].ereignis({ type: 'done', stop_reason: 'error' });
    assert.equal((await p4).fehler, 'Der KI-Harness hat mit einem Fehler beendet');
  } finally { w.zurueck(); }
});

test('agentFrage (review 106-05): the GUIDs held at the sentence go with the task; proposals are counted from tool results without error', async () => {
  const w = wsFake();
  try {
    const p = agentFrage('Satz', { ziel: ['G1ABCDEFGHIJKLMNOPQRS$'] });
    const ws = w.offen[0];
    ws.ereignis({ type: 'hello', session: 's1' });
    assert.deepEqual(ws.gesendet[0], { type: 'user', text: 'Satz', ziel: ['G1ABCDEFGHIJKLMNOPQRS$'] });
    ws.ereignis({ type: 'tool_call', name: 'eigenschaft_setzen', args: {} });
    ws.ereignis({ type: 'tool_result', id: 'c1', name: 'eigenschaft_setzen', result: '{"error": "Keine Auswahl"}' });
    ws.ereignis({ type: 'tool_call', name: 'transformieren', args: {} });
    ws.ereignis({ type: 'tool_result', id: 'c2', name: 'transformieren', result: '{"vorschlag": {"id": "v1"}}' });
    ws.ereignis({ type: 'tool_result', id: 'c3', name: 'auswahl_abfragen', result: '{"anzahl": 1}' });
    ws.ereignis({ type: 'done', stop_reason: 'end_turn' });
    const r = await p;
    assert.equal(r.vorschlaege, 1, 'only the change tool without error counts');
    assert.deepEqual(r.werkzeuge, ['eigenschaft_setzen', 'transformieren']);
  } finally { w.zurueck(); }
});
