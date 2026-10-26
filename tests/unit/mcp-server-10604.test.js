// mcp-server-10604.test.js — the model tools of plan 106-04 in tools/mcp-server.mjs, as a real child process against a
// FAKE BIT-Atelier API (same harness idea as mcpServer.test.js, own copy: this fake answers the control channel
// like a viewer's command register does). Covers:
//  - tools/list per flag (none / --schreiben; the removed --bestaetigen-erlaubt changes nothing) against the TABLE in
//    docs/KI-ANBINDUNG.md: the doc and the code are checked against each other, in the same order,
//  - every example call of the doc is valid against the tool's input schema,
//  - eigenschaft_setzen without a selection: the German "Keine Auswahl" text passes through, nothing else happens,
//  - no tool confirms: there is no vorschlag_bestaetigen, and "bestaetigen" over zeichenflaeche_ausfuehren is refused, D-IM-04,
//  - ansicht_bild answers an MCP image block that the 50,000-character limit does not cut, and is refused with "Nur lokale KI",
//  - a long answer of the viewer (more than 50,000 characters) stays valid JSON: the longest list loses entries, with a note,
//  - the doc says what the code does (no callable aliases, Massing studio runs at once, cloud note for the image),
//  - 106-06: ansicht_bild asks the app's store (GET /llm/bild-freigabe) for the viewer's project before an image leaves: NDA, consent,
//    no project and an app without the route are refusals in words.

import { describe, it, after } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KEINE_AUSWAHL_TEXT } from '@core/lib/zeigen/auswahlKontext.js';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKRIPT = path.join(WURZEL, 'tools', 'mcp-server.mjs');
const DOKU = fs.readFileSync(path.join(WURZEL, 'docs', 'KI-ANBINDUNG.md'), 'utf8').replace(/\r\n/g, '\n');

const DATEN = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-10604-'));
fs.writeFileSync(path.join(DATEN, 'steuerung.token'), 'geheim\n');

/** The smallest valid PNG (1 x 1 px) as base64 - starts with the PNG signature "iVBORw0KGgo". */
const PNG_KLEIN = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** A "large" image: far beyond MAX_ZEICHEN (50,000) characters; the padding is only length, the server never decodes it. */
const PNG_GROSS = PNG_KLEIN + 'A'.repeat(300_000);

/**
 * Fake API with a fake control channel: the answers are the ones a viewer's register gives
 * (ok / error text / result), keyed by the register command id.
 */
function fakeApi() {
  const anfragen = [];
  /** `antwort` = what GET /api/llm/einstellungen answers; null = 404 like a server without the route. */
  const einstellungen = { antwort: /** @type {any} */ (null) };
  /** 106-06: answers of GET /api/llm/bild-freigabe per projekt_id (missing = ok); `projekt` = projekt_id the fake viewer names (null = none). */
  const freigabe = { je: /** @type {Record<string, any>} */ ({}), projekt: /** @type {string|null} */ ('P1'), ohneRoute: false };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      anfragen.push({ methode: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
      const json = (status, wert) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(wert)); };
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/system/datenordner') return json(200, { ordner: DATEN });
      if (req.method === 'GET' && url.pathname === '/api/llm/einstellungen' && einstellungen.antwort) return json(200, einstellungen.antwort);
      if (req.method === 'GET' && url.pathname === '/api/status') return json(200, { name: 'bit-atelier', version: '9.9.9', modus: 'app' });
      if (req.method === 'GET' && url.pathname === '/api/llm/bild-freigabe' && !freigabe.ohneRoute) {
        return json(200, freigabe.je[url.searchParams.get('projekt_id') ?? ''] ?? { ok: true, grund: null, text: '' });
      }
      if (req.method === 'POST' && url.pathname === '/api/steuerung') {
        if (req.headers['x-bit-steuerung'] !== 'geheim') return json(401, { ok: false, error: 'Token' });
        const a = JSON.parse(body);
        const befehl = a.params?.befehl;
        const p = a.params?.params || {};
        if (befehl === 'eigenschaft-setzen' && !p.guid) return json(200, { id: a.id, ok: false, error: KEINE_AUSWAHL_TEXT });
        if (befehl === 'ansicht-bild') {
          if (p.breite === 1) return json(200, { id: a.id, ok: false, error: 'Ein Bild gibt es nur in der 3D-Ansicht — erst auf 3D wechseln (jetzt: grundriss)' });
          if (p.breite === 2) return json(504, { id: a.id, ok: false, status: 'not-run', error: 'Keine geöffnete Zeichenfläche hat die Anfrage abgeholt — darf wiederholt werden.' });
          if (p.breite === 3) return json(200, { id: a.id, ok: true, result: { png_base64: 'kein-png', breite: 3, hoehe: 3, format: 'image/png' } });
          return json(200, { id: a.id, ok: true, result: { png_base64: p.breite === 1600 ? PNG_GROSS : PNG_KLEIN, breite: p.breite || 800, hoehe: 450, format: 'image/png', projekt_id: freigabe.projekt } });
        }
        if (befehl === 'bestaetigen') return json(200, { id: a.id, ok: false, error: 'Ein Agent kann nicht bestätigen — die Person übernimmt im Fenster (Übernehmen), per Befehlszeile oder Sprache' });
        // a long model: 400 elements with a fat profile, far over MAX_ZEICHEN (50,000) even compact
        if (befehl === 'modell' && p.klasse === 'IfcGross') {
          const bauteile = Array.from({ length: 400 }, (_, i) => ({ guid: `G${String(i).padStart(21, '0')}`, klasse: 'IfcGross', name: `Bauteil ${i}`, geschoss: 'EG', steckbrief: { label: 'x'.repeat(120) } }));
          return json(200, { id: a.id, ok: true, result: { anzahl: 400, klassen: { IfcGross: 400 }, gekuerzt: false, bauteile } });
        }
        return json(200, { id: a.id, ok: true, result: { befehl, params: p } });
      }
      return json(404, { error: 'Not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, anfragen, einstellungen, freigabe, url: `http://127.0.0.1:${server.address().port}/api`,
    /** Bodies sent to the control channel since the last call of this function. */
    steuerungen() { const r = anfragen.filter((x) => x.url === '/api/steuerung').map((x) => x.body); anfragen.length = 0; return r; },
  })));
}

/** Starts the MCP server as a child process; `rpc` returns the whole JSON-RPC response (image blocks included). */
function starteMcp(apiUrl, args = []) {
  const kind = spawn(process.execPath, [SKRIPT, ...args], { env: { ...process.env, BIT_API_URL: apiUrl }, stdio: ['pipe', 'pipe', 'pipe'] });
  const warter = new Map();
  let rest = '';
  kind.stdout.setEncoding('utf8');
  kind.stdout.on('data', (stueck) => {
    rest += stueck;
    let i;
    while ((i = rest.indexOf('\n')) >= 0) {
      const zeile = rest.slice(0, i);
      rest = rest.slice(i + 1);
      const nachricht = JSON.parse(zeile); // stdout must carry JSON only
      const w = warter.get(nachricht.id);
      if (w) { warter.delete(nachricht.id); w(nachricht); }
    }
  });
  let naechsteId = 1;
  return {
    rpc(method, params) {
      const id = naechsteId++;
      const p = new Promise((resolve) => warter.set(id, resolve));
      kind.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return p;
    },
    async liste() { return (await this.rpc('tools/list')).result.tools; },
    /** Calls a tool: { text (first text block), json, isError, content }. */
    async werkzeug(name, args = {}) {
      const r = await this.rpc('tools/call', { name, arguments: args });
      assert.ok(r.result, `tools/call ${name}: ${JSON.stringify(r.error)}`);
      const text = r.result.content.find((c) => c.type === 'text')?.text ?? '';
      let json = null;
      try { json = JSON.parse(text); } catch { /* prose */ }
      return { text, json, isError: r.result.isError === true, content: r.result.content };
    },
    ende() { return new Promise((resolve) => { kind.on('exit', resolve); kind.stdin.end(); }); },
  };
}

/** Runs `fn(mcp, api)` against a fresh fake API and MCP server with the given flags. */
async function mitMcp(flags, fn) {
  const api = await fakeApi();
  const mcp = starteMcp(api.url, flags);
  try { return await fn(mcp, api); } finally { await mcp.ende(); api.server.close(); }
}

// --- What the doc says -----------------------------------------------------------

/** Rows of the tool table in docs/KI-ANBINDUNG.md: [{ name, recht: 'lesen' | 'schreiben' }], in doc order. */
function dokuTabelle() {
  const von = DOKU.indexOf('**Werkzeuge**');
  const bis = DOKU.indexOf('**Wie ein Agent das Modell anfasst');
  assert.ok(von >= 0 && bis > von, 'doc: tool table section not found');
  const zeilen = DOKU.slice(von, bis).split('\n').filter((z) => /^\| `[a-z_]+` \|/.test(z));
  return zeilen.map((z) => {
    const zellen = z.split('|').map((c) => c.trim());
    const name = zellen[1].replace(/`/g, '');
    const recht = zellen[zellen.length - 2];
    return { name, recht: recht.includes('--schreiben') ? 'schreiben' : 'lesen' };
  });
}

/** Example calls of the doc: [{ name, args }] from the code block under "Beispielaufrufe". */
function dokuBeispiele() {
  const von = DOKU.indexOf('**Beispielaufrufe**');
  const bis = DOKU.indexOf('**Beispiel-Dialog');
  assert.ok(von >= 0 && bis > von, 'doc: examples section not found');
  const block = DOKU.slice(von, bis).match(/```text\n([\s\S]*?)```/);
  assert.ok(block, 'doc: example code block not found');
  return block[1].split('\n').filter(Boolean).map((z) => {
    const i = z.indexOf(' ');
    return { name: z.slice(0, i), args: JSON.parse(z.slice(i + 1)) };
  });
}

const namenBis = (tabelle, stufe) => tabelle.filter((r) => ({ lesen: 0, schreiben: 1 })[r.recht] <= stufe).map((r) => r.name);

describe('106-04 — tool list against the doc table', () => {
  const tabelle = dokuTabelle();

  it('the doc table names every tool once, with the new ones', () => {
    const namen = tabelle.map((r) => r.name);
    assert.equal(new Set(namen).size, namen.length, 'no tool twice');
    for (const n of ['auswahl_abfragen', 'bauteil_waehlen', 'modell_bauteile', 'pruefen', 'ansicht_bild', 'eigenschaft_setzen', 'transformieren', 'teilen',
      'vorschlag_verwerfen', 'zeichenflaeche_befehle', 'zeichenflaeche_ausfuehren']) assert.ok(namen.includes(n), n);
    assert.ok(!namen.includes('vorschlag_bestaetigen'), 'an agent never confirms: no such tool (D-IM-04)');
  });

  const faelle = [
    { flags: [], stufe: 0, titel: 'ohne Flag: nur die Lesewerkzeuge' },
    { flags: ['--schreiben'], stufe: 1, titel: '--schreiben: dazu die Schreibwerkzeuge (ein Werkzeug zum Bestätigen gibt es nicht)' },
    { flags: ['--write'], stufe: 1, titel: '--write (Alias) wie --schreiben' },
    { flags: ['--bestaetigen-erlaubt'], stufe: 0, titel: 'das entfernte --bestaetigen-erlaubt gibt weder Schreibrecht noch ein Werkzeug' },
    { flags: ['--schreiben', '--bestaetigen-erlaubt'], stufe: 1, titel: '--schreiben --bestaetigen-erlaubt: unverändert wie --schreiben (Flag wird ignoriert)' },
    { flags: ['--write', '--allow-confirm'], stufe: 1, titel: '--write --allow-confirm (Aliase): unverändert wie --write' },
  ];
  for (const { flags, stufe, titel } of faelle) {
    it(titel, async () => {
      await mitMcp(flags, async (mcp) => {
        const liste = await mcp.liste();
        assert.deepEqual(liste.map((w) => w.name), namenBis(tabelle, stufe));
        for (const w of liste) {
          assert.equal(w.inputSchema.type, 'object', w.name);
          assert.ok(w.description.includes(' / '), `${w.name}: description DE / EN`);
        }
      });
    });
  }

  it('the English names of the concept stand in the descriptions', async () => {
    await mitMcp(['--schreiben'], async (mcp) => {
      const text = (await mcp.liste()).map((w) => w.description).join('\n');
      for (const alias of ['select_element_by_guid', 'modify_ifc_property', 'transform_geometry', 'split_element', 'render_view']) {
        assert.ok(text.includes(alias), alias);
      }
      // pruefen only re-checks open proposals: it must not promise a check of an element (validate / check_element)
      assert.ok(!/validate|check_element/.test(text), 'pruefen promises no element check');
      // the aliases are search words in the descriptions, not callable names: a call answers "unknown tool"
      const r = await mcp.rpc('tools/call', { name: 'select_element_by_guid', arguments: { guid: 'abc' } });
      assert.equal(r.error?.code, -32602);
    });
  });

  it('every example call of the doc fits the input schema of its tool', async () => {
    await mitMcp(['--schreiben'], async (mcp) => {
      const werkzeuge = new Map((await mcp.liste()).map((w) => [w.name, w]));
      const beispiele = dokuBeispiele();
      assert.deepEqual(beispiele.map((b) => b.name), tabelle.map((r) => r.name), 'one example per tool, in table order');
      for (const { name, args } of beispiele) {
        const schema = werkzeuge.get(name).inputSchema;
        for (const k of schema.required || []) assert.ok(k in args, `${name}: Pflichtfeld ${k}`);
        for (const k of Object.keys(args)) assert.ok(k in (schema.properties || {}), `${name}: unbekanntes Argument ${k}`);
      }
    });
  });

  it('annotations tell the truth: read tools read-only, proposals not destructive', async () => {
    await mitMcp(['--schreiben'], async (mcp) => {
      const w = Object.fromEntries((await mcp.liste()).map((t) => [t.name, t.annotations]));
      for (const n of ['auswahl_abfragen', 'modell_bauteile', 'vorschlaege_lesen', 'ansicht_bild']) assert.equal(w[n].readOnlyHint, true, n);
      assert.equal(w.bauteil_waehlen.readOnlyHint, false, 'it changes the UI selection');
      assert.deepEqual([w.pruefen.readOnlyHint, w.pruefen.idempotentHint], [false, true], 'pruefen refreshes the stored check of the proposals');
      for (const n of ['eigenschaft_setzen', 'transformieren', 'teilen']) assert.deepEqual([w[n].readOnlyHint, w[n].destructiveHint], [false, false], n);
    });
  });

  it('the doc says what the code does', () => {
    assert.ok(!/Alias `(?!--)/.test(DOKU) && !/\(Aliase /.test(DOKU), 'aliases are search words, not callable names');
    assert.ok(!/validate|check_element/.test(DOKU), 'pruefen has no element-check aliases');
    assert.match(DOKU, /Bestätigen kann ein Agent nie/);
    assert.match(DOKU, /Ein Agent kann nicht bestätigen/);
    assert.match(DOKU, /Massing-Studio führt Zeichen- und Bearbeitungsbefehle sofort aus/);
    assert.match(DOKU, /Cloud-Modell/);
    assert.match(DOKU, /Nur lokale KI/);
    assert.ok(!/bestaetigen-erlaubt` kann der Agent|hebt das für den Agenten auf/.test(DOKU), 'no claim that a flag lets an agent confirm');
  });
});

describe('106-04 — read tools go to the register of the open viewer', () => {
  it('auswahl_abfragen, bauteil_waehlen, modell_bauteile, vorschlaege_lesen, pruefen without any flag', async () => {
    await mitMcp([], async (mcp, api) => {
      assert.deepEqual((await mcp.werkzeug('auswahl_abfragen')).json.result, { befehl: 'auswahl-lesen', params: {} });
      assert.deepEqual((await mcp.werkzeug('bauteil_waehlen', { guid: '0xS3rfBXz1EwBvL5K3Hn2a' })).json.result, { befehl: 'auswahl-guid', params: { guid: '0xS3rfBXz1EwBvL5K3Hn2a' } });
      assert.deepEqual((await mcp.werkzeug('modell_bauteile', { klasse: 'IfcWall' })).json.result, { befehl: 'modell', params: { klasse: 'IfcWall' } });
      assert.deepEqual((await mcp.werkzeug('modell_bauteile')).json.result, { befehl: 'modell', params: {} });
      assert.deepEqual((await mcp.werkzeug('vorschlaege_lesen')).json.result, { befehl: 'vorschlaege', params: {} });
      assert.deepEqual((await mcp.werkzeug('pruefen', { guid: 'abc', id: 'a3f9c10b' })).json.result, { befehl: 'pruefen', params: { guid: 'abc', vorschlag_id: 'a3f9c10b' } });
      // every call is a control-channel request with the method "ausfuehren" - there is no second road
      assert.ok(api.steuerungen().every((b) => b.method === 'ausfuehren'));
    });
  });

  it('bad arguments are refused with a German reason before anything is sent', async () => {
    await mitMcp([], async (mcp, api) => {
      for (const [name, args] of [['bauteil_waehlen', {}], ['bauteil_waehlen', { guid: '../../etc' }], ['modell_bauteile', { klasse: 'Ifc Wall; drop' }], ['ansicht_bild', { breite: 'breit' }]]) {
        const r = await mcp.werkzeug(name, args);
        assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
      }
      assert.deepEqual(api.steuerungen(), []);
    });
  });
});

describe('106-04 — proposals: without a selection a German text, never a guess', () => {
  it('eigenschaft_setzen without selection and GUID: "Keine Auswahl" passes through, only one request, no change', async () => {
    await mitMcp(['--schreiben'], async (mcp, api) => {
      const r = await mcp.werkzeug('eigenschaft_setzen', { name: 'Feuerwiderstand', wert: 'F90' });
      assert.equal(r.isError, false, 'an answer of the app, passed through like every control-channel answer');
      assert.equal(r.json.ok, false);
      assert.equal(r.json.error, KEINE_AUSWAHL_TEXT);
      assert.match(r.json.error, /Keine Auswahl/);
      assert.deepEqual(api.steuerungen().map((b) => [b.method, b.params]), [['ausfuehren', { befehl: 'eigenschaft-setzen', params: { name: 'Feuerwiderstand', wert: 'F90' } }]]);
    });
  });

  it('eigenschaft_setzen / transformieren / teilen / vorschlag_verwerfen send exactly the register parameters', async () => {
    await mitMcp(['--schreiben'], async (mcp, api) => {
      const g = '0xS3rfBXz1EwBvL5K3Hn2a';
      assert.deepEqual((await mcp.werkzeug('eigenschaft_setzen', { guid: g, pset: 'Pset_WallCommon', name: 'FireRating', wert: 'F90' })).json.result.params,
        { guid: g, pset: 'Pset_WallCommon', name: 'FireRating', wert: 'F90' });
      assert.deepEqual((await mcp.werkzeug('transformieren', { guid: g, verschiebung_m: [0.5, 0], drehung_grad: 90, faktor: 1.1 })).json.result,
        { befehl: 'transformieren', params: { guid: g, verschiebung_m: [0.5, 0], drehung_grad: 90, faktor: 1.1 } });
      assert.deepEqual((await mcp.werkzeug('teilen', { anteil: 0.5 })).json.result, { befehl: 'teilen', params: { anteil: 0.5 } });
      assert.deepEqual((await mcp.werkzeug('teilen', { punkt: { x: 2, z: 3 } })).json.result.params, { punkt: { x: 2, z: 3 } });
      assert.deepEqual((await mcp.werkzeug('vorschlag_verwerfen', { id: 'a3f9c10b' })).json.result, { befehl: 'verwerfen', params: { vorschlag_id: 'a3f9c10b' } });
      assert.equal(api.steuerungen().length, 5);
    });
  });

  it('missing or wrong arguments never reach the app', async () => {
    await mitMcp(['--schreiben'], async (mcp, api) => {
      for (const [name, args] of [
        ['eigenschaft_setzen', { wert: 'F90' }], ['eigenschaft_setzen', { name: 'F' }], ['eigenschaft_setzen', { name: 'F', wert: { a: 1 } }],
        ['eigenschaft_setzen', { name: 'F', wert: 'x', guid: 'böse guid!' }],
        ['transformieren', {}], ['transformieren', { drehung_grad: 'viel' }], ['teilen', {}], ['teilen', { anteil: 'mitte' }],
        // Number('') / Number([]) are 0 and Number(true) is 1: such values are no numbers, nothing is guessed
        ['transformieren', { drehung_grad: '' }], ['transformieren', { faktor: true }], ['transformieren', { drehung_grad: [] }], ['teilen', { anteil: '' }],
        ['vorschlag_verwerfen', {}], ['vorschlag_verwerfen', { id: '../x' }],
      ]) {
        assert.equal((await mcp.werkzeug(name, args)).isError, true, `${name} ${JSON.stringify(args)}`);
      }
      assert.deepEqual(api.steuerungen(), []);
    });
  });

  it('without --schreiben a proposal tool is refused and the app sees nothing', async () => {
    await mitMcp([], async (mcp, api) => {
      for (const name of ['eigenschaft_setzen', 'transformieren', 'teilen', 'vorschlag_verwerfen']) {
        const r = await mcp.werkzeug(name, { name: 'x', wert: 1, id: 'a', verschiebung_m: [1, 0], anteil: 0.5 });
        assert.equal(r.isError, true, name);
        assert.match(r.text, /Schreibrecht fehlt/);
      }
      assert.deepEqual(api.steuerungen(), []);
    });
  });
});

describe('106-04 — an agent never confirms (D-IM-04)', () => {
  it('there is no confirming tool, with every flag combination; a call answers "unknown tool" and nothing reaches the app', async () => {
    for (const flags of [[], ['--schreiben'], ['--schreiben', '--bestaetigen-erlaubt']]) {
      await mitMcp(flags, async (mcp, api) => {
        assert.ok(!(await mcp.liste()).some((w) => /bestaetig/.test(w.name)), flags.join(' '));
        const r = await mcp.rpc('tools/call', { name: 'vorschlag_bestaetigen', arguments: { id: 'a3f9c10b' } });
        assert.equal(r.error?.code, -32602, flags.join(' '));
        assert.deepEqual(api.steuerungen(), []);
      });
    }
  });

  it('the generic road is shut as well: zeichenflaeche_ausfuehren with "bestaetigen", also with the old flag', async () => {
    for (const flags of [['--schreiben'], ['--schreiben', '--bestaetigen-erlaubt']]) {
      await mitMcp(flags, async (mcp, api) => {
        const r = await mcp.werkzeug('zeichenflaeche_ausfuehren', { befehl: 'bestaetigen', params: { vorschlag_id: 'a3f9c10b' } });
        assert.equal(r.isError, true, flags.join(' '));
        assert.match(r.text, /D-IM-04/);
        assert.match(r.text, /Person/);
        assert.deepEqual(api.steuerungen(), []);
      });
    }
  });

  it('the description of zeichenflaeche_ausfuehren tells that the Massing studio runs drawing commands at once (no proposal)', async () => {
    await mitMcp(['--schreiben'], async (mcp) => {
      const w = (await mcp.liste()).find((t) => t.name === 'zeichenflaeche_ausfuehren');
      assert.match(w.description, /Massing-Studio führt .* SOFORT aus/);
      assert.ok(!/liefern auch hier nur einen Vorschlag/.test(w.description));
    });
  });
});

describe('106-04 — ansicht_bild returns an image block', () => {
  it('an MCP image block (PNG) plus a short text; default call sends no width', async () => {
    await mitMcp([], async (mcp, api) => {
      const r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} });
      assert.equal(r.result.isError, undefined);
      assert.equal(r.result.content.length, 2);
      const [bild, text] = r.result.content;
      assert.deepEqual([bild.type, bild.mimeType], ['image', 'image/png']);
      assert.equal(bild.data, PNG_KLEIN);
      assert.equal(Buffer.from(bild.data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
      assert.equal(text.type, 'text');
      assert.match(text.text, /800 × 450 px/);
      assert.match(text.text, /GUID/, 'the text reminds that the GUID, not the pixels, is the ground truth');
      assert.deepEqual(api.steuerungen().map((b) => b.params), [{ befehl: 'ansicht-bild', params: {} }]);
    });
  });

  it('a large image is not cut at 50,000 characters (the text limit does not apply to it)', async () => {
    await mitMcp([], async (mcp, api) => {
      const r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: { breite: 1600 } });
      assert.equal(r.result.content[0].type, 'image');
      assert.equal(r.result.content[0].data.length, PNG_GROSS.length);
      assert.ok(PNG_GROSS.length > 50_000);
      assert.deepEqual(api.steuerungen().map((b) => b.params.params), [{ breite: 1600 }]);
    });
  });

  it('"Nur lokale KI" on: no image leaves for the client (D-IM-02), the app is not even asked; off or unknown: the image comes', async () => {
    await mitMcp([], async (mcp, api) => {
      api.einstellungen.antwort = { nur_lokal: true };
      const r = await mcp.werkzeug('ansicht_bild', {});
      assert.equal(r.isError, true);
      assert.match(r.text, /Nur lokale KI/);
      assert.match(r.text, /Cloud-Modell/);
      assert.deepEqual(api.steuerungen(), [], 'nothing was asked of the viewer');
      api.einstellungen.antwort = { nur_lokal: false };
      assert.equal((await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} })).result.content[0].type, 'image');
    });
  });

  it('a refusal in words, not-run and a non-PNG answer stay visible as text, never as an image', async () => {
    await mitMcp([], async (mcp) => {
      const nur3d = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: { breite: 1 } });
      assert.deepEqual(nur3d.result.content.map((c) => c.type), ['text']);
      assert.match(nur3d.result.content[0].text, /nur in der 3D-Ansicht/);
      const keinViewer = await mcp.werkzeug('ansicht_bild', { breite: 2 });
      assert.equal(keinViewer.json.status, 'not-run');
      const kaputt = await mcp.werkzeug('ansicht_bild', { breite: 3 });
      assert.equal(kaputt.isError, true);
      assert.match(kaputt.text, /kein PNG/);
    });
  });
});

describe('106-06 — ansicht_bild only after the project check of the app (D-IM-02)', () => {
  it('asks GET /llm/bild-freigabe for the viewer\'s project as a target outside this computer; allowed: the image comes', async () => {
    await mitMcp([], async (mcp, api) => {
      const r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} });
      assert.equal(r.result.content[0].type, 'image');
      const frage = api.anfragen.find((x) => x.url.startsWith('/api/llm/bild-freigabe'));
      assert.ok(frage, 'the store was asked');
      const q = new URL(frage.url, 'http://x').searchParams;
      assert.deepEqual([q.get('projekt_id'), q.get('ziel')], ['P1', 'extern']);
    });
  });

  it('NDA project, missing consent, no project, an app without the route: refused in words, never an image block', async () => {
    await mitMcp([], async (mcp, api) => {
      api.freigabe.je.P1 = { ok: false, grund: 'nda', text: 'NDA-Projekt: es geht nie ein Bild der Ansicht an ein Sprachmodell — nur Text und Bauteil-Kennungen' };
      let r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} });
      assert.deepEqual(r.result.content.map((c) => c.type), ['text']);
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, /NDA-Projekt/);
      assert.ok(!r.result.content[0].text.includes(PNG_KLEIN), 'the image is not in the refusal either');

      api.freigabe.je.P1 = { ok: false, grund: 'zustimmung', text: 'Das Bild der Ansicht verlässt diesen Rechner — dafür braucht es einmal je Projekt Ihre Zustimmung' };
      r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} });
      assert.deepEqual(r.result.content.map((c) => c.type), ['text']);
      assert.match(r.result.content[0].text, /einmal für dieses Projekt zu/);

      api.freigabe.projekt = null;
      r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} });
      assert.deepEqual(r.result.content.map((c) => c.type), ['text']);
      assert.match(r.result.content[0].text, /kein geöffnetes Projekt/);

      api.freigabe.projekt = 'P2';
      api.freigabe.ohneRoute = true;
      r = await mcp.rpc('tools/call', { name: 'ansicht_bild', arguments: {} });
      assert.deepEqual(r.result.content.map((c) => c.type), ['text']);
      assert.match(r.result.content[0].text, /ließ sich nicht prüfen/);
    });
  });

  it('review fix: the generic zeichenflaeche_ausfuehren does not hand out the image (no bypass of the checks), not even with "Nur lokale KI" off', async () => {
    await mitMcp(['--schreiben'], async (mcp, api) => {
      api.steuerungen();
      api.freigabe.je.P1 = { ok: false, grund: 'zustimmung', text: 'keine Zustimmung' };
      for (const params of [{}, { breite: 64 }]) {
        const r = await mcp.rpc('tools/call', { name: 'zeichenflaeche_ausfuehren', arguments: { befehl: 'ansicht-bild', params } });
        assert.equal(r.result.isError, true);
        assert.deepEqual(r.result.content.map((c) => c.type), ['text']);
        assert.match(r.result.content[0].text, /ansicht_bild/);
        assert.ok(!r.result.content[0].text.includes(PNG_KLEIN), 'no PNG as text either');
      }
      assert.deepEqual(api.steuerungen(), [], 'the request never reached the app');
    });
  });
});

describe('106-04 — a long answer of the viewer stays valid JSON', () => {
  it('modell_bauteile with 400 fat elements: compact, the list is shortened from the end, with a note that names the real parameters', async () => {
    await mitMcp([], async (mcp) => {
      const r = await mcp.werkzeug('modell_bauteile', { klasse: 'IfcGross' });
      assert.equal(r.isError, false);
      assert.ok(r.text.length <= 50_000, `${r.text.length} characters`);
      assert.ok(r.json, 'valid JSON, not cut in the middle');
      assert.equal(r.json.ok, true);
      assert.ok(r.json.result.bauteile.length >= 1 && r.json.result.bauteile.length < 400);
      assert.equal(r.json.result.bauteile[0].guid, `G${'0'.repeat(21)}`, 'the first elements stay');
      assert.equal(r.json.result.anzahl, 400, 'the count still says how many exist');
      assert.match(r.json.hinweis, /von 400 Einträgen in "bauteile"/);
      assert.match(r.json.hinweis, /klasse/);
      assert.ok(!/limit, filter oder get_record/.test(r.text), 'no hint to parameters that do not exist here');
      assert.ok(!r.text.includes('\n  '), 'compact: no indentation');
    });
  });

  it('a short answer is passed through unchanged (no note)', async () => {
    await mitMcp([], async (mcp) => {
      const r = await mcp.werkzeug('modell_bauteile', { klasse: 'IfcWall' });
      assert.equal(r.json.hinweis, undefined);
      assert.deepEqual(r.json.result, { befehl: 'modell', params: { klasse: 'IfcWall' } });
    });
  });
});

after(() => { try { fs.rmSync(DATEN, { recursive: true, force: true }); } catch { /* temp folder, leave it */ } });
