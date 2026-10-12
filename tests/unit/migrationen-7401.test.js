// 74-01: static checks of the SQL migrations 0006-0011 — the rules that can be
// checked WITHOUT a database. They do not prove the SQL runs (that is
// supabase/tests/74-01_zugriff.sql on a throwaway project); they catch the
// classes of mistakes the plan names as having happened in drafts:
//   - a function without its revoke (Postgres default EXECUTE for PUBLIC,
//     PostgREST publishes every public function as RPC),
//   - a SECURITY DEFINER function without a pinned search_path,
//   - a new table without RLS + revoke (default privileges of 0005 open it),
//   - pgcrypto digest() (lives in schema `extensions` on Supabase),
//   - a migration without a rollback, a policy for anon,
//   - protokoll_schreiben callable by clients.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WURZEL = path.resolve(import.meta.dirname, '..', '..');
const MIG = path.join(WURZEL, 'supabase', 'migrations');
const NUMMERN = ['0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014'];

/** Migration text without SQL line comments. */
function lies(nummer) {
  const datei = fs.readdirSync(MIG).find((f) => f.startsWith(`${nummer}_`));
  assert.ok(datei, `Migration ${nummer} fehlt`);
  return fs.readFileSync(path.join(MIG, datei), 'utf8').replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '');
}

/** Every `create function public.name(args)` with its body up to the closing `$$;`. */
function funktionen(sql) {
  return [...sql.matchAll(/create function public\.([a-z_]+)\(([^)]*)\)([\s\S]*?)\$\$;/g)]
    .map((m) => ({ name: m[1], kopf: m[3].split('$$')[0] }));
}

describe('74-01 Migrationen — statische Regeln', () => {
  it('jede Migration hat ihren Rückweg in supabase/rueckweg/', () => {
    for (const n of NUMMERN) {
      assert.ok(fs.existsSync(path.join(WURZEL, 'supabase', 'rueckweg', `${n}_down.sql`)), `${n}_down.sql fehlt`);
    }
  });

  it('keine Rückweg-Datei liegt im Migrationsordner (db push würde sie einspielen)', () => {
    const imOrdner = fs.readdirSync(MIG, { recursive: true }).map(String);
    assert.deepEqual(imOrdner.filter((f) => /down/i.test(f)), []);
  });

  it('jede neue Funktion bekommt im selben Block ihr revoke … from public', () => {
    for (const n of NUMMERN) {
      const sql = lies(n);
      for (const f of funktionen(sql)) {
        const revoke = new RegExp(`revoke all on function public\\.${f.name}\\(`);
        assert.match(sql, revoke, `${n}: ${f.name} ohne revoke`);
      }
    }
  });

  it('jede SECURITY-DEFINER-Funktion hat einen festen search_path', () => {
    for (const n of NUMMERN) {
      for (const f of funktionen(lies(n))) {
        if (/security definer/.test(f.kopf)) {
          assert.match(f.kopf, /set search_path = public/, `${n}: ${f.name} definer ohne search_path`);
        }
      }
    }
  });

  it('jede neue Tabelle: RLS an und revoke für anon/authenticated', () => {
    for (const n of NUMMERN) {
      const sql = lies(n);
      for (const [, tabelle] of sql.matchAll(/create table public\.([a-z_]+)/g)) {
        assert.match(sql, new RegExp(`alter table public\\.${tabelle}\\s+enable row level security`), `${n}: ${tabelle} ohne RLS`);
        assert.match(sql, new RegExp(`revoke all on [^;]*public\\.${tabelle}[^;]*from[^;]*authenticated`), `${n}: ${tabelle} ohne revoke`);
      }
    }
  });

  it('kein pgcrypto digest() (liegt bei Supabase im Schema extensions)', () => {
    for (const n of NUMMERN) assert.doesNotMatch(lies(n), /\bdigest\(/, n);
  });

  it('keine Policy gilt für anon', () => {
    for (const n of NUMMERN) {
      for (const [, ziel] of lies(n).matchAll(/create policy [a-z_]+ on [a-z_.]+\s+for \w+ to (\w+)/g)) {
        assert.equal(ziel, 'authenticated', n);
      }
    }
  });

  it('protokoll_schreiben ist für anon und authenticated gesperrt, nur service_role darf', () => {
    const sql = lies('0010');
    assert.match(sql, /revoke all on function public\.protokoll_schreiben\([^)]*\) from public, anon, authenticated;/);
    assert.doesNotMatch(sql, /grant execute on function public\.protokoll_schreiben\([^)]*\) to [^;]*authenticated/);
  });

  it('das Protokoll: kein Schreibrecht für Clients, Trigger gegen UPDATE/DELETE und TRUNCATE', () => {
    const sql = lies('0010');
    assert.match(sql, /revoke all on public\.zugriffsprotokoll from public, anon, authenticated, service_role;/);
    assert.match(sql, /before update or delete on public\.zugriffsprotokoll\s+for each row/);
    assert.match(sql, /before truncate on public\.zugriffsprotokoll\s+for each statement/);
  });

  it('ist_dienst liest die Sitzungsrolle, nicht current_user (Definer-Falle)', () => {
    const sql = lies('0006');
    const block = sql.slice(sql.indexOf('create function public.ist_dienst()'));
    assert.match(block, /current_setting\('role', true\)/);
    assert.doesNotMatch(block.split('$$;')[0], /current_user/);
  });

  it('0011 ersetzt genau die vier records-Policies; der Rückweg stellt 0002 wortgleich her', () => {
    const sql = lies('0011');
    for (const p of ['records_select', 'records_insert', 'records_update', 'records_delete']) {
      assert.match(sql, new RegExp(`drop policy if exists ${p} on public\\.records`));
      assert.match(sql, new RegExp(`create policy ${p} on public\\.records`));
    }
    const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    const alt = norm(fs.readFileSync(path.join(MIG, '0002_rls.sql'), 'utf8'));
    const rueck = norm(fs.readFileSync(path.join(WURZEL, 'supabase', 'rueckweg', '0011_down.sql'), 'utf8'));
    for (const p of ['records_select', 'records_insert', 'records_update', 'records_delete']) {
      const ausschnitt = (t) => {
        const i = t.indexOf(`create policy ${p} `);
        return t.slice(i, t.indexOf(';', i));
      };
      assert.equal(ausschnitt(rueck), ausschnitt(alt), `${p} im Rückweg weicht von 0002 ab`);
    }
  });

  it('0008 stempelt beim Backfill nicht alle updated_date neu', () => {
    const sql = lies('0008');
    const aus = sql.indexOf('disable trigger records_set_updated_date');
    const backfill = sql.indexOf('update public.records');
    const an = sql.indexOf('enable trigger records_set_updated_date');
    assert.ok(aus >= 0 && aus < backfill && backfill < an, 'Backfill nicht zwischen disable/enable');
  });

  it('0012: Projektionen tragen nie unit_price, long_text, bim_element_ids, invited_contact_ids, awarded_bid_id', () => {
    const sql = lies('0012');
    const bauten = [...sql.matchAll(/jsonb_build_object\(([\s\S]*?)\)\s*,\s*\n?\s*auth\.uid\(\)/g)].map((m) => m[1]);
    assert.ok(bauten.length >= 3, `nur ${bauten.length} Projektionsbauten gefunden`);
    for (const b of bauten) {
      assert.doesNotMatch(b, /unit_price|long_text|bim_element_ids|invited_contact_ids|awarded_bid_id/);
    }
    assert.match(sql, /'project_id', v_projekt/, 'Projektion muss project_id tragen (Rückfragen brauchen den Projektbezug)');
  });

  it('0013: Gebotsordner gehören auth.uid(), Externe lesen freigaben nicht direkt', () => {
    const sql = lies('0013');
    const insert = sql.slice(sql.indexOf('create policy gebote_insert'), sql.indexOf('create policy gebote_select'));
    assert.match(insert, /\(storage\.foldername\(name\)\)\[3\] = auth\.uid\(\)::text/);
    assert.match(insert, /submission_laeuft/);
    const lesen = sql.slice(sql.indexOf('create policy freigaben_select'), sql.indexOf('create policy freigaben_insert'));
    assert.doesNotMatch(lesen, /ist_extern|darf_projekt/);
  });

  it('0013-Rückweg stellt die blobs-Policies aus 0003 wortgleich her', () => {
    const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    const alt = norm(fs.readFileSync(path.join(MIG, '0003_storage_blobs.sql'), 'utf8'));
    const rueck = norm(fs.readFileSync(path.join(WURZEL, 'supabase', 'rueckweg', '0013_down.sql'), 'utf8'));
    for (const p of ['blobs_select', 'blobs_insert', 'blobs_update', 'blobs_delete']) {
      const aus = (t) => { const i = t.indexOf(`create policy ${p} `); return t.slice(i, t.indexOf(';', i)); };
      assert.equal(aus(rueck), aus(alt), p);
    }
  });

  it('0014 schließt die Default-Privilegien-Falle und bricht bei offenem Tor selbst ab', () => {
    const sql = lies('0014');
    assert.match(sql, /alter default privileges in schema public revoke insert, update, delete on tables from authenticated;/);
    assert.match(sql, /alter default privileges in schema public revoke execute on functions from public;/);
    assert.match(sql, /raise exception '0014 Selbstprüfung fehlgeschlagen/);
    // every client function of 0006-0013 is re-granted after the sweep
    const regrant = sql.slice(sql.indexOf('revoke execute on all functions'), sql.indexOf('-- 3. Tables'));
    for (const n of ['0006', '0007', '0009', '0010', '0011', '0012', '0013']) {
      for (const [, name] of lies(n).matchAll(/grant execute on function public\.([a-z_]+)\([^)]*\) to [^;]*authenticated/g)) {
        assert.match(regrant, new RegExp(`public\\.${name}\\(`), `${name} (${n}) nach dem Durchgang nicht wieder freigegeben`);
      }
    }
  });

  it('der SQL-Nachweis existiert und läuft nur in einer zurückgerollten Transaktion', () => {
    const t = fs.readFileSync(path.join(WURZEL, 'supabase', 'tests', '74-01_zugriff.sql'), 'utf8');
    assert.match(t, /^begin;$/m);
    assert.match(t, /^rollback;\s*$/m);
    assert.doesNotMatch(t, /^commit;$/m);
    assert.match(t, /\\if :\{\?wegwerf\}/, 'Schutz gegen versehentlichen Lauf fehlt');
  });
});
