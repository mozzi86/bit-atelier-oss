// Unit tests for scripts/sicherung-pruefen.mjs (57-05): offline check of a
// pg_dump file. Fixture is an inline, shortened plain-format dump with the same
// shape pg_dump writes (COPY header, tab-separated rows, \N for NULL, "\." end).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENDMARKE, berichtZeilen, copyKopf, main, vergleiche, zaehleDump } from '../../scripts/sicherung-pruefen.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';

/** Builds a dump text; `ohneEnde` drops the completion marker like an aborted run. */
function dump({ records = [], objekte = [], ohneEnde = false } = {}) {
  const zeilen = [
    '--',
    '-- PostgreSQL database dump',
    '--',
    'SET statement_timeout = 0;',
    'COPY public.orgs (id, name, created_date) FROM stdin;',
    `${ORG}\tBüro Muster\t2026-09-20 10:00:00+00`,
    '\\.',
    'COPY public.org_members (user_id, org_id, role) FROM stdin;',
    `22222222-2222-4222-8222-222222222222\t${ORG}\tadmin`,
    '\\.',
    'COPY public.records (id, entity, org_id, data, created_date, updated_date, created_by) FROM stdin;',
    ...records.map(([id, entity]) => `${id}\t${entity}\t${ORG}\t{"name": "a\\tb"}\t2026-09-20\t2026-09-20\t\\N`),
    '\\.',
    'COPY storage.objects (id, bucket_id, name, owner) FROM stdin;',
    ...objekte.map(([id, bucket]) => `${id}\t${bucket}\t${ORG}/${id}.json\t\\N`),
    '\\.',
  ];
  if (!ohneEnde) zeilen.push('--', ENDMARKE, '--');
  return zeilen;
}

describe('copyKopf', () => {
  it('reads table and columns, strips identifier quotes', () => {
    assert.deepEqual(copyKopf('COPY public."records" (id, "entity") FROM stdin;'), {
      tabelle: 'public.records',
      spalten: ['id', 'entity'],
    });
  });
  it('returns null for any other line', () => {
    assert.equal(copyKopf('SET search_path = public;'), null);
    assert.equal(copyKopf('-- COPY public.records (id) FROM stdin;'), null);
  });
});

describe('zaehleDump', () => {
  it('counts records per entity, objects per bucket and every table', async () => {
    const z = await zaehleDump(dump({
      records: [['p1', 'Project'], ['p2', 'Project'], ['t1', 'Tender']],
      objekte: [['b1', 'blobs']],
    }));
    assert.equal(z.vollstaendig, true);
    assert.deepEqual(z.records, { Project: 2, Tender: 1 });
    assert.deepEqual(z.objekte, { blobs: 1 });
    assert.equal(z.tabellen['public.records'], 3);
    assert.equal(z.tabellen['public.orgs'], 1);
    assert.equal(z.tabellen['public.org_members'], 1);
  });

  it('an escaped tab inside jsonb does not shift the entity column', async () => {
    const z = await zaehleDump(dump({ records: [['x', 'Document']] }));
    assert.deepEqual(z.records, { Document: 1 });
  });

  it('an empty table is present with 0, not missing', async () => {
    const z = await zaehleDump(dump());
    assert.equal(z.tabellen['public.records'], 0);
    assert.equal(z.tabellen['storage.objects'], 0);
  });

  it('a dump without the completion marker is incomplete', async () => {
    const z = await zaehleDump(dump({ records: [['p1', 'Project']], ohneEnde: true }));
    assert.equal(z.vollstaendig, false);
  });

  it('handles CRLF line endings (dump copied through Windows tools)', async () => {
    const z = await zaehleDump(dump({ records: [['p1', 'Project']] }).map((l) => `${l}\r`));
    assert.equal(z.vollstaendig, true);
    assert.deepEqual(z.records, { Project: 1 });
  });
});

describe('vergleiche', () => {
  it('equal dumps → no difference', async () => {
    const a = await zaehleDump(dump({ records: [['p1', 'Project']] }));
    const b = await zaehleDump(dump({ records: [['p1', 'Project']] }));
    assert.deepEqual(vergleiche(a, b), []);
  });
  it('a lost entity and a lost bucket entry are both named', async () => {
    const a = await zaehleDump(dump({ records: [['p1', 'Project'], ['t1', 'Tender']], objekte: [['b1', 'blobs']] }));
    const b = await zaehleDump(dump({ records: [['p1', 'Project']] }));
    const abw = vergleiche(a, b);
    assert.ok(abw.some((d) => d.bereich === 'records' && d.schluessel === 'Tender' && d.a === 1 && d.b === 0));
    assert.ok(abw.some((d) => d.bereich === 'objekte' && d.schluessel === 'blobs'));
  });
});

describe('berichtZeilen', () => {
  it('always says that the files themselves are not in the dump', async () => {
    const z = await zaehleDump(dump({ records: [['p1', 'Project']] }));
    const text = berichtZeilen('x.sql', z).join('\n');
    assert.match(text, /Vollständig\s+: ja/);
    assert.match(text, /Dateien selbst sind in KEINEM Datenbankabzug enthalten/);
  });
});

describe('main (CLI)', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-pruefen-'));
  const schreibe = (name, zeilen) => {
    const p = path.join(ordner, name);
    fs.writeFileSync(p, zeilen.join('\n'), 'utf8');
    return p;
  };
  // Silence the report during tests; the return code is what is asserted.
  const still = async (fn) => {
    const log = console.log; const err = console.error;
    console.log = () => {}; console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = err; }
  };

  it('complete dump → 0, aborted dump → 1', async () => {
    const gut = schreibe('gut.sql', dump({ records: [['p1', 'Project']] }));
    const kaputt = schreibe('kaputt.sql', dump({ records: [['p1', 'Project']], ohneEnde: true }));
    assert.equal(await still(() => main([gut])), 0);
    assert.equal(await still(() => main([kaputt])), 1);
  });

  it('--vergleich: equal → 0, different → 1', async () => {
    const a = schreibe('a.sql', dump({ records: [['p1', 'Project'], ['t1', 'Tender']] }));
    const b = schreibe('b.sql', dump({ records: [['p1', 'Project'], ['t1', 'Tender']] }));
    const c = schreibe('c.sql', dump({ records: [['p1', 'Project']] }));
    assert.equal(await still(() => main([a, '--vergleich', b])), 0);
    assert.equal(await still(() => main([a, '--vergleich', c])), 1);
  });

  it('missing argument or missing file → 1 / plain-text error', async () => {
    assert.equal(await still(() => main([])), 1);
    await assert.rejects(() => main([path.join(ordner, 'gibtsnicht.sql')]), /Datei nicht gefunden/);
  });
});
