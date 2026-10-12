// 74-01 Task 14: client role logic (@core/lib/rollen.js) and the bidder portal
// logic (@ava/lib/bieterPortal.js). Pure functions — the database rules they
// mirror are proven in supabase/tests/74-01_zugriff.sql (to run on dev2).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ROLLEN_EXTERN, ROLLEN_INTERN, istExterneRolle, istInterneRolle, mitgliedschaftAuswerten, rolleNormalisieren,
} from '@core/lib/rollen';
import { fristStatus, gebotAusPreisen, portalVergaben, preisLesen, vergabeVon } from '@ava/lib/bieterPortal';

const WURZEL = path.resolve(import.meta.dirname, '..', '..');

describe('rollen — Vokabular', () => {
  it('Stufe-1-Wörter werden wie in Migration 0006 übersetzt', () => {
    assert.equal(rolleNormalisieren('admin'), 'owner');
    assert.equal(rolleNormalisieren('mitglied'), 'planner');
  });
  it('unbekannt, leer, kein String → gast (fail-shut)', () => {
    for (const r of ['viewer', '', '  ', null, undefined, 42, 'Owner', 'bidder ']) {
      assert.equal(rolleNormalisieren(r), r === 'bidder ' ? 'bidder' : 'gast', String(r));
    }
  });
  it('die beiden Mengen sind disjunkt und decken alles ab', () => {
    assert.deepEqual(ROLLEN_INTERN.filter((r) => ROLLEN_EXTERN.includes(r)), []);
    for (const r of ROLLEN_INTERN) assert.equal(istInterneRolle(r), true, r);
    for (const r of ROLLEN_EXTERN) assert.equal(istExterneRolle(r), true, r);
    assert.equal(istExterneRolle(undefined), true, 'fehlende Rolle ist extern');
  });
  it('die Rollenliste deckt sich mit dem Check der Migration 0006', () => {
    const sql = fs.readFileSync(path.join(WURZEL, 'supabase/migrations/0006_rollen.sql'), 'utf8');
    const m = /org_members_rolle_check\s+check \(role in \(([^)]*)\)\)/.exec(sql);
    assert.ok(m, 'Check in 0006 nicht gefunden');
    const ausSql = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
    assert.deepEqual(ausSql, [...ROLLEN_INTERN, ...ROLLEN_EXTERN].sort());
  });
});

describe('rollen — Rechte aus der Mitgliedschaft', () => {
  it('altes Schema (ohne Flag-Spalten): Büro-Rechte wie nach dem Backfill, nie Portal, keine Zugriffstrennungs-Bedienung', () => {
    const admin = mitgliedschaftAuswerten({ role: 'admin', org_id: 'o', user_id: 'u' });
    assert.equal(admin.extern, false);
    assert.equal(admin.zugriffstrennung, false);
    assert.equal(mitgliedschaftAuswerten({ role: 'mitglied' }).extern, false);
    assert.equal(admin.rolle, 'owner');
    assert.equal(admin.intern, true);
    assert.deepEqual(admin.rechte, { can_edit_model: true, can_export_ifc: true, can_view_audit_reports: true, can_submit_bid: false });
    const mitglied = mitgliedschaftAuswerten({ role: 'mitglied' });
    assert.equal(mitglied.rechte.can_view_audit_reports, false);
    assert.equal(mitglied.stufe, 'enterprise');
  });
  it('neues Schema: Flags wie gespeichert, nur echtes true zählt', () => {
    const b = mitgliedschaftAuswerten({
      role: 'bidder', stufe: 'free', can_edit_model: false, can_export_ifc: 'true', can_view_audit_reports: null, can_submit_bid: true,
    });
    assert.equal(b.intern, false);
    assert.equal(b.extern, true);
    assert.equal(b.zugriffstrennung, true);
    assert.deepEqual(b.rechte, { can_edit_model: false, can_export_ifc: false, can_view_audit_reports: false, can_submit_bid: true });
  });
  it('keine Mitgliedschaft → gast ohne Rechte, aber NICHT extern (kein Portal)', () => {
    const g = mitgliedschaftAuswerten(null);
    assert.equal(g.rolle, 'gast');
    assert.equal(g.intern, false);
    assert.equal(g.extern, false);
    assert.equal(g.mitglied, false);
    assert.equal(g.zugriffstrennung, false);
    assert.ok(Object.values(g.rechte).every((v) => v === false));
  });
});

describe('Bieterportal — Logik', () => {
  it('preisLesen versteht deutsche Schreibweisen und lehnt Unsinn ab', () => {
    assert.equal(preisLesen('1.234,50'), 1234.5);
    assert.equal(preisLesen('12,5'), 12.5);
    assert.equal(preisLesen('12.5'), 12.5);
    assert.equal(preisLesen(' 7 '), 7);
    assert.equal(preisLesen('1.000'), 1000, 'deutscher Tausenderpunkt ohne Komma');
    assert.equal(preisLesen('12.500.000'), 12500000);
    assert.equal(preisLesen('1.5'), 1.5);
    assert.equal(preisLesen(0), 0);
    for (const x of ['', '-3', 'abc', '1,2,3', null, undefined, -1, NaN]) assert.equal(preisLesen(x), null, String(x));
  });

  it('gebotAusPreisen: line_items in der Form des Preisspiegels, Summe in Cent gerundet', () => {
    const mengen = [
      { id: 'm1', lv_id: 'lv-1', oz: '01.01', quantity: 10 },
      { id: 'm2', lv_id: 'lv-2', oz: '01.02', quantity: '3' },
    ];
    const g = gebotAusPreisen(mengen, { m1: '12,345', m2: '1.000' });
    assert.equal(g.ok, true);
    assert.deepEqual(g.line_items, [{ position_id: 'lv-1', unit_price: 12.345 }, { position_id: 'lv-2', unit_price: 1000 }]);
    assert.equal(g.total, 3123.45);
  });

  it('ein fehlender Preis verhindert die Abgabe und wird mit OZ genannt', () => {
    const g = gebotAusPreisen([{ id: 'm1', oz: '01.01', quantity: 1 }, { id: 'm2', oz: '01.02', quantity: 1 }], { m1: '5' });
    assert.equal(g.ok, false);
    assert.deepEqual(g.fehlend, ['01.02']);
    assert.equal(gebotAusPreisen([], {}).ok, false, 'leeres LV ist kein Angebot');
  });

  it('portalVergaben ordnet Mengen und eigenes Gebot der Vergabe zu, OZ numerisch sortiert', () => {
    const e = portalVergaben(
      [{ id: 'tf1', tender_id: 'T1', frist: '2026-11-02T10:00:00Z' }, { id: 'tf2', tender_id: 'T2', frist: '2026-11-01T10:00:00Z' }],
      [{ id: 'a', tender_id: 'T1', oz: '01.10' }, { id: 'b', tender_id: 'T1', oz: '01.9' }, { id: 'c', vergabe_id: 'T2', oz: '1' }],
      [{ id: 'g1', tender_id: 'T1', total: 5 }],
    );
    assert.deepEqual(e.map((x) => vergabeVon(x.vergabe)), ['T2', 'T1'], 'nach Frist sortiert');
    assert.deepEqual(e[1].mengen.map((m) => m.oz), ['01.9', '01.10']);
    assert.equal(e[1].gebot.id, 'g1');
    assert.equal(e[0].gebot, null);
  });

  it('fristStatus', () => {
    const jetzt = new Date('2026-10-12T12:00:00Z');
    assert.equal(fristStatus('2026-10-12T12:00:01Z', jetzt), 'laeuft');
    assert.equal(fristStatus('2026-10-12T12:00:00Z', jetzt), 'abgelaufen');
    assert.equal(fristStatus(undefined, jetzt), 'unbekannt');
    assert.equal(fristStatus('kein Datum', jetzt), 'unbekannt');
  });

  it('das Portal fragt nur die vier freigegebenen Arten ab — nie Originale', () => {
    const q = fs.readFileSync(path.join(WURZEL, 'src/pages/BieterPortal.jsx'), 'utf8');
    const arten = [...new Set([...q.matchAll(/bitApi\.entities\.([A-Za-z]+)\./g)].map((m) => m[1]))].sort();
    assert.deepEqual(arten, ['BcfRueckfrage', 'Bid', 'MengenFreigabe', 'TenderFreigabe']);
  });

  it('App.jsx leitet externe Rollen im Cloud-Build auf das Portal', () => {
    const app = fs.readFileSync(path.join(WURZEL, 'src/App.jsx'), 'utf8');
    assert.match(app, /DATENQUELLE === 'supabase' && user\?\.extern === true/);
    assert.ok(app.indexOf('user?.extern === true') < app.indexOf('return <HauptApp />'), 'Weiche muss vor der Büro-Shell stehen');
  });
});
