// 110-01/-02: client portal ("Bauherr") — the contract between migration 0016
// and the pure client module @core/lib/bauherrProjektion.js. The SQL itself is
// proven by supabase/tests/110-01_bauherr.sql (to run on a throwaway project);
// here: both whitelists are the same, nothing forbidden is on them, the
// mapping reads no internal field, and the checks match the trigger.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BAUHERR_ARTEN, BAUHERR_EIGENE, BAUHERR_FELDER, BAUHERR_LESEN, BAUHERR_QUELLEN, VERBOTEN,
  bauherrDateiname, bereinigen, freigabeZeile, freigebbar, fuerBauherrSichtbar, kgVerdichten, kostenAusLv, letzteEntscheidungen,
  portalAufbereiten, projektionAus, rueckmeldungPruefen,
} from '@core/lib/bauherrProjektion';
import { BAUHERR_VORSCHAU_ID, ermittleZugriff } from '@core/lib/zugriffErmitteln.js';
import { FREIGABE_DATEI_ENTITAETEN, freigabePfad, mitgliedschaftFuerExterne } from '../../supabase/functions/_shared/zugriffRegeln.js';
import { SOLL } from '../../scripts/grants-pruefen.mjs';

const WURZEL = path.resolve(import.meta.dirname, '..', '..');
const SQL = fs.readFileSync(path.join(WURZEL, 'supabase/migrations/0016_bauherr.sql'), 'utf8');
const RUECK = fs.readFileSync(path.join(WURZEL, 'supabase/rueckweg/0016_down.sql'), 'utf8');

/**
 * `when 'X' then array['a','b']` lines of one SQL function body.
 * @param {string} funktion
 * @returns {Record<string, string[]>}
 */
function whenListen(funktion) {
  const start = SQL.indexOf(`create function public.${funktion}(`);
  assert.ok(start >= 0, `${funktion} fehlt in 0016`);
  const ende = SQL.indexOf('$$;', start);
  const koerper = SQL.slice(start, ende);
  /** @type {Record<string, string[]>} */
  const aus = {};
  for (const m of koerper.matchAll(/when '([A-Za-z.]+)'\s+then array\[([^\]]*)\]/g)) {
    aus[m[1]] = [...m[2].matchAll(/'([a-z_A-Z]+)'/g)].map((x) => x[1]);
  }
  return aus;
}

describe('0016 ↔ bauherrProjektion — eine Whitelist', () => {
  it('bauherr_felder() und BAUHERR_FELDER sind Schlüssel für Schlüssel gleich', () => {
    const sql = whenListen('bauherr_felder');
    assert.deepEqual(Object.keys(sql).sort(), Object.keys(BAUHERR_FELDER).sort());
    for (const [art, felder] of Object.entries(BAUHERR_FELDER)) assert.deepEqual(sql[art], [...felder], art);
  });
  it('bauherr_quellen() und BAUHERR_QUELLEN sind gleich', () => {
    const sql = whenListen('bauherr_quellen');
    assert.deepEqual(Object.keys(sql).sort(), Object.keys(BAUHERR_QUELLEN).sort());
    for (const [art, q] of Object.entries(BAUHERR_QUELLEN)) assert.deepEqual(sql[art], [...q], art);
  });
  it('jede Portal-Art hat eine Katalogzeile mit Zielrolle bauherr; schreibbar genau die eigenen', () => {
    const zeilen = [...SQL.matchAll(/\('(Bauherr[A-Za-z]+)',\s*'projekt',\s*(true|false),\s*(true|false),\s*'[^']*',\s*'([a-z]+)',\s*(true|false)\)/g)];
    const katalog = Object.fromEntries(zeilen.map((m) => [m[1], { sichtbar: m[2] === 'true', modell: m[3] === 'true', ziel: m[4], schreibbar: m[5] === 'true' }]));
    assert.deepEqual(Object.keys(katalog).sort(), [...BAUHERR_LESEN].sort());
    for (const [e, k] of Object.entries(katalog)) {
      assert.equal(k.ziel, 'bauherr', e);
      assert.equal(k.sichtbar, true, e);
      assert.equal(k.modell, false, e);
      assert.equal(k.schreibbar, BAUHERR_EIGENE.includes(e), e);
    }
  });
  it('kein Whitelist-Schlüssel ist ein verbotenes Feld (Honorar, Notiz, Annahme, EP, Herkunft …)', () => {
    for (const [art, felder] of Object.entries(BAUHERR_FELDER)) {
      for (const f of felder) for (const v of VERBOTEN) assert.equal(v.test(f), false, `${art}.${f} trifft ${v}`);
    }
  });
});

describe('0016 — Policies, Rückweg, Grants', () => {
  it('Lesen: Externe sehen Projektionen nur als Zielgruppe; intern unverändert', () => {
    const sel = SQL.slice(SQL.indexOf('create policy records_select'), SQL.indexOf('create policy records_insert'));
    assert.match(sel, /public\.ist_zielgruppe\(org_id, projekt_id, entity\)/);
    assert.match(sel, /public\.submission_offen\(org_id, vergabe_id\)/, 'interner Zweig wie 0011');
  });
  it('Ändern: Bauherren-Zeilen sind für Externe unveränderlich, Löschen bleibt intern', () => {
    const upd = SQL.slice(SQL.indexOf('create policy records_update'), SQL.indexOf('-- records_delete'));
    assert.equal((upd.match(/public\.entity_zielrolle\(entity\) is null/g) || []).length, 2, 'using und with check');
    assert.doesNotMatch(SQL, /create policy records_delete/);
  });
  it('Schreiben: eine schreibbare Art braucht eine benannte Zielrolle und keinen Vergabebezug', () => {
    const ins = SQL.slice(SQL.indexOf('create policy records_insert'), SQL.indexOf('create policy records_update'));
    assert.match(ins, /entity_extern_schreibbar\(entity\)\s+and public\.entity_zielrolle\(entity\) is not null/);
    assert.match(ins, /vergabe_id is null/);
  });
  it('der Rückweg entfernt jede neue Funktion, den Trigger und stellt ist_extern ohne bauherr her', () => {
    const neu = [...SQL.matchAll(/^create function public\.([a-z_]+)\(([^)]*)\)/gm)].map((m) => m[1]);
    assert.ok(neu.length >= 10, `nur ${neu.length} Funktionen gefunden`);
    for (const f of neu) assert.match(RUECK, new RegExp(`drop function if exists public\\.${f}\\(`), f);
    assert.match(RUECK, /drop trigger if exists records_bauherr/);
    assert.match(RUECK, /role in \('bidder', 'investor', 'gast'\)\s+from public\.org_members/);
  });
  it('jede neue Client-Funktion steht in der SOLL-Liste von grants-pruefen.mjs', () => {
    const granted = [...SQL.matchAll(/grant execute on function public\.([a-z_]+)\(([^)]*)\) to authenticated/g)].map((m) => m[1]);
    const soll = SOLL.filter((s) => s.startsWith('authenticated|function|')).map((s) => s.split('|')[2].split('(')[0]);
    for (const f of granted) assert.ok(soll.includes(f), `${f} fehlt in SOLL`);
    assert.ok(!granted.includes('records_bauherr'), 'Triggerfunktion ist kein RPC');
  });
});

describe('bereinigen — dieselbe Regel wie bauherr_bereinigen()', () => {
  it('nur Whitelist-Schlüssel; Objekte oben verworfen; Listen nur aus Objekten mit Skalaren', () => {
    const roh = {
      project_id: 'P1', titel: 'Kosten', notes: 'intern!', summe_netto: 100, hinweis: { geheim: 1 },
      gruppen: [{ kg: '300', betrag_netto: 80, unit_price: 9, bezeichnung: { x: 1 } }, 'text', ['a'], null],
    };
    assert.deepEqual(bereinigen('BauherrKosten', roh), {
      project_id: 'P1', titel: 'Kosten', summe_netto: 100, gruppen: [{ kg: '300', betrag_netto: 80 }],
    });
  });
  it('unbekannte Art → leer; kein Objekt → leer; Liste ohne Array → []', () => {
    assert.deepEqual(bereinigen('Project', { name: 'x' }), {});
    assert.deepEqual(bereinigen('BauherrPlan', null), {});
    assert.deepEqual(bereinigen('BauherrKosten', { gruppen: 'x' }), { gruppen: [] });
  });
});

describe('freigebbar — was nie hinausgeht', () => {
  it('Büro-Dokumente, nicht gestellte Rechnungen, unfreigegebene Pläne ohne Entscheidung', () => {
    for (const bereich of ['buero', 'personal', 'buchhaltung', 'schriftverkehr']) {
      assert.equal(freigebbar('BauherrDokument', 'Document', { bereich }).ok, false, bereich);
    }
    assert.equal(freigebbar('BauherrDokument', 'Document', {}).ok, true, 'ohne bereich = projekt');
    assert.equal(freigebbar('BauherrRechnung', 'Ausgangsrechnung', { status: 'entwurf' }).ok, false);
    assert.equal(freigebbar('BauherrRechnung', 'Ausgangsrechnung', { status: 'gestellt' }).ok, true);
    assert.equal(freigebbar('BauherrPlan', 'Plan', { status: 'vorabzug' }).ok, false);
    assert.equal(freigebbar('BauherrPlan', 'Plan', { status: 'vorabzug' }, { entscheidung: true }).ok, true);
    assert.equal(freigebbar('BauherrPlan', 'Plan', { status: 'freigegeben' }).ok, true);
    assert.equal(freigebbar('BauherrPlan', 'Contact', {}).ok, false, 'falsche Quelle');
  });
});

describe('projektionAus — liest keine internen Felder', () => {
  it('Projekt ohne Notizen, Kosten, Herkunft, NDA', () => {
    const p = projektionAus('BauherrProjekt', 'Project', {
      id: 'P1', name: 'EFH Muster', location: { address: 'Musterweg 1', city: 'Musterstadt' }, status: 'technical_design', hoai_phase: 5,
      notes: 'intern', estimated_cost: 500000, baukostenobergrenze: 550000, aufbau_herkunft: 'x', nda: true, completion_date: '2027-09-30',
    }, { hinweis: 'Willkommen' });
    assert.deepEqual(p, {
      project_id: 'P1', name: 'EFH Muster', adresse: 'Musterweg 1, Musterstadt', status: 'Ausführungsplanung',
      phase: 'Leistungsphase 5', fertigstellung: '2027-09-30', hinweis: 'Willkommen',
    });
  });
  it('Plan: Nummer/Index/Maßstab, Entscheidung nur auf Wunsch; kein datei_ref', () => {
    const p = projektionAus('BauherrPlan', 'Plan', {
      project_id: 'P1', nr: 'A-101', titel: 'Grundriss EG', index: 'b', massstab: '1:100', status: 'vorabzug', datei_ref: 'D9',
      freigabe: { von: 'x', am: '2026-11-01' },
    }, { entscheidung: true });
    assert.deepEqual(p, {
      project_id: 'P1', titel: 'Grundriss EG', plannummer: 'A-101', index: 'b', massstab: '1:100',
      status: 'zur Freigabe', stand: '2026-11-01', entscheidung_offen: true,
    });
  });
  it('Kosten: KG verdichtet; ohne gegebenes Brutto 19 % [ASSUMED]; keine Notiz/Quelle des KostenStands', () => {
    const gruppen = kgVerdichten([{ kg: '331', betrag_netto: 100 }, { kg: '334', betrag_netto: 50.5 }, { kg: '410', betrag_netto: 20 }, { kg: 'x', betrag_netto: 1 }]);
    assert.deepEqual(gruppen, [{ kg: '300', betrag_netto: 150.5 }, { kg: '400', betrag_netto: 20 }]);
    const p = projektionAus('BauherrKosten', 'KostenStand', { project_id: 'P1', stufe: 'kostenberechnung', betrag: 170.5, datum: '2026-10-01', notiz: 'x', quelle: 'y' }, { gruppen });
    assert.equal(p?.titel, 'Kostenberechnung');
    assert.deepEqual(p?.gruppen, [
      { kg: '300', bezeichnung: 'Bauwerk – Baukonstruktionen', betrag_netto: 150.5, betrag_brutto: 179.1 },
      { kg: '400', bezeichnung: 'Bauwerk – Technische Anlagen', betrag_netto: 20, betrag_brutto: 23.8 },
    ]);
    assert.equal(p?.summe_brutto, 202.9);
    assert.equal('notiz' in /** @type {object} */ (p), false);
  });
  it('kostenAusLv: Brutto je Position mit eigenem USt-Satz (0 / "0" / 19 / fehlt)', () => {
    const lv = [
      { din276: '331', quantity: 2, unit_price: 50 }, // 100 net, 19 %
      { din276: '442', quantity: 1, unit_price: 1000, ust_satz: 0 }, // PV, 0 %
      { din276: '221', quantity: 1, unit_price: 300, ust_satz: '0' }, // public charge
      { din276: '222', quantity: 1, unit_price: 100, ust_satz: 19 }, // percent form
      { din276: '', quantity: 1, unit_price: 999 }, { din276: '410', quantity: 'x', unit_price: 5 },
    ];
    assert.deepEqual(kostenAusLv(lv), [
      { kg: '200', bezeichnung: 'Vorbereitende Maßnahmen', betrag_netto: 400, betrag_brutto: 419 },
      { kg: '300', bezeichnung: 'Bauwerk – Baukonstruktionen', betrag_netto: 100, betrag_brutto: 119 },
      { kg: '400', bezeichnung: 'Bauwerk – Technische Anlagen', betrag_netto: 1000, betrag_brutto: 1000 },
    ]);
  });
  it('Kosten: Zeilen ergeben immer die Summe — Reserve als eigene Zeile, KG 700 als Zeile oder Hinweis', () => {
    // Shape of the finding 08.11.2026: cost status incl. reserve, LV rows without it, tax-free positions, KG 700 apart.
    const gruppen = kostenAusLv([
      { din276: '331', quantity: 1, unit_price: 600 },
      { din276: '442', quantity: 1, unit_price: 100, ust_satz: 0 },
    ]);
    const ks = { project_id: 'P1', stufe: 'kostenschaetzung', betrag: 800, datum: '2026-11-08' };
    const p = /** @type {any} */ (projektionAus('BauherrKosten', 'KostenStand', ks, { gruppen }));
    assert.deepEqual(p.gruppen.map((/** @type {any} */ g) => [g.kg, g.betrag_netto, g.betrag_brutto]), [
      ['300', 600, 714], ['400', 100, 100], [undefined, 100, 119],
    ]);
    assert.equal(p.gruppen[2].bezeichnung, 'Reserve / Unvorhergesehenes');
    assert.equal(p.summe_netto, 800, 'Summe = Kostenstand inkl. Reserve');
    assert.equal(p.summe_brutto, 933, 'Brutto = Summe der Zeilen, nicht pauschal 800 × 1,19');
    assert.match(p.hinweis, /KG 700/);
    // With a structured KG 700 value: own row, own gross (fees partly VAT-free), in the total.
    const mit = /** @type {any} */ (projektionAus('BauherrKosten', 'KostenStand', { ...ks, kg700_netto: 200, kg700_brutto: 228 }, { gruppen }));
    assert.deepEqual(mit.gruppen.at(-1), { kg: '700', bezeichnung: 'Baunebenkosten', betrag_netto: 200, betrag_brutto: 228 });
    assert.equal(mit.summe_netto, 1000);
    assert.equal(mit.summe_brutto, 1161);
    assert.equal(mit.hinweis, undefined);
    // Sum of rows above the cost status: no negative reserve, a note instead.
    const drueber = /** @type {any} */ (projektionAus('BauherrKosten', 'KostenStand', { ...ks, betrag: 650 }, { gruppen }));
    assert.equal(drueber.gruppen.length, 2);
    assert.equal(drueber.summe_netto, 700);
    assert.match(drueber.hinweis, /über dem angegebenen Kostenstand/);
    // Cost status without any KG rows: one total row, still rows = total.
    const ohne = /** @type {any} */ (projektionAus('BauherrKosten', 'KostenStand', ks, { gruppen: [] }));
    assert.equal(ohne.gruppen.length, 1);
    assert.equal(ohne.summe_brutto, 952);
  });
  it('Portal sortiert KG-Zeilen, Reserve bleibt am Ende', () => {
    const d = portalAufbereiten({ BauherrKosten: [{ gruppen: [{ bezeichnung: 'Reserve / Unvorhergesehenes' }, { kg: '400' }, { kg: '300' }] }] });
    assert.deepEqual(d.abschnitte.BauherrKosten[0].gruppen.map((/** @type {any} */ g) => g.kg || g.bezeichnung), ['300', '400', 'Reserve / Unvorhergesehenes']);
  });
  it('Rechnung: bezahlt aus Zahlungen, keine Mahnungen/Zahlungsdetails', () => {
    const r = { project_id: 'P1', nummer: 'R-1', art: 'abschlag', netto: 100, brutto: 119, status: 'gestellt', rechnungsdatum: '2026-10-01', zahlungen: [{ betrag: 119, iban: 'X' }], mahnungen: [{}] };
    const p = projektionAus('BauherrRechnung', 'Ausgangsrechnung', r);
    assert.deepEqual(p, { project_id: 'P1', nummer: 'R-1', titel: 'Abschlagsrechnung', datum: '2026-10-01', betrag_netto: 100, betrag_brutto: 119, status: 'bezahlt' });
    assert.equal(projektionAus('BauherrRechnung', 'Ausgangsrechnung', { ...r, zahlungen: [] })?.status, 'offen');
  });
  it('Beteiligte: nur über Project.beteiligte aufgelöste Kontakte, ohne Bemerkung/Adresse', () => {
    const p = projektionAus('BauherrBeteiligter', 'Project', {
      id: 'P1', beteiligte: [{ contact_id: 'c1', rolle: 'objektplanung', bemerkung: 'intern' }, { contact_id: 'fehlt', rolle: 'x' }],
    }, { kontakte: [{ id: 'c1', name: 'Büro A', company: 'A GmbH', email: 'a@example.invalid', address: 'geheim' }, { id: 'c2', name: 'Mitbewerber' }], rollenLabel: () => 'Objektplanung' });
    assert.deepEqual(p, { project_id: 'P1', titel: 'Projektbeteiligte', personen: [{ name: 'Büro A', rolle: 'Objektplanung', firma: 'A GmbH', email: 'a@example.invalid' }] });
  });
  it('Bemusterung und Sonderwunsch als eine Option mit Entscheidung', () => {
    const b = projektionAus('BauherrBemusterung', 'Bemusterung', { project_id: 'P1', nr: 'B-3', gegenstand: 'Fliese Bad', raum_bezug: 'Bad OG', fabrikat: 'F', produkt: 'P', farbe: 'grau', status: 'vorgelegt' }, { entscheidung: true });
    assert.deepEqual(b?.optionen, [{ schluessel: '1', titel: 'F · P', beschreibung: 'grau' }]);
    assert.equal(b?.entscheidung_offen, true);
    const s = projektionAus('BauherrBemusterung', 'Sonderwunsch', { project_id: 'P1', beschreibung: 'Steckdose', preis_eur: 85, pruefungen: [{ x: 1 }], abgelehnt_grund: 'x' });
    assert.deepEqual(s?.optionen, [{ schluessel: '1', titel: 'Steckdose', mehrkosten_brutto: 85 }]);
    assert.equal('entscheidung_offen' in /** @type {object} */ (s), false);
  });
  it('jede Projektion besteht nur aus Whitelist-Schlüsseln (alle Arten mit einem Vollsatz)', () => {
    const voll = { id: 'P1', project_id: 'P1', notes: 'n', name: 'n', titel: 't', status: 'gestellt', beteiligte: [] };
    for (const art of BAUHERR_ARTEN) {
      for (const entity of BAUHERR_QUELLEN[art]) {
        const p = projektionAus(art, entity, voll) || {};
        for (const k of Object.keys(p)) assert.ok(BAUHERR_FELDER[art].includes(k), `${art}/${entity}: ${k}`);
      }
    }
  });
});

describe('Rückmeldungen des Bauherrn', () => {
  const plan = { id: 'pp1', entscheidung_offen: true };
  const bem = { id: 'bb1', entscheidung_offen: true, optionen: [{ schluessel: '1' }, { schluessel: '2' }] };
  it('wie der Trigger: Entscheidung nur auf Anfrage, Auswahl nur angebotene Option, Text begrenzt', () => {
    assert.equal(rueckmeldungPruefen({ art: 'freigabe' }, plan).ok, true);
    assert.equal(rueckmeldungPruefen({ art: 'freigabe' }, { id: 'x' }).ok, false);
    assert.equal(rueckmeldungPruefen({ art: 'freigabe' }, null).ok, false);
    assert.equal(rueckmeldungPruefen({ art: 'auswahl', option: '2' }, bem).ok, true);
    assert.equal(rueckmeldungPruefen({ art: 'auswahl', option: '9' }, bem).ok, false);
    assert.equal(rueckmeldungPruefen({ art: 'frage', text: '  ' }).ok, false);
    assert.equal(rueckmeldungPruefen({ art: 'frage', text: 'x'.repeat(4001) }).ok, false);
    assert.equal(rueckmeldungPruefen({ art: 'loeschen' }).ok, false);
  });
  it('letzte Entscheidung je Bezug gewinnt; Fragen zählen nicht', () => {
    const m = letzteEntscheidungen([
      { bezug_id: 'a', art: 'ablehnung', zeitpunkt: '2026-11-01T10:00:00Z' },
      { bezug_id: 'a', art: 'freigabe', zeitpunkt: '2026-11-02T10:00:00Z' },
      { bezug_id: 'b', art: 'frage', zeitpunkt: '2026-11-03T10:00:00Z' },
    ]);
    assert.equal(m.get('a')?.art, 'freigabe');
    assert.equal(m.has('b'), false);
  });
  it('portalAufbereiten sortiert und verwirft unbekannte Arten', () => {
    const d = portalAufbereiten({
      BauherrProjekt: [{ id: 'p', name: 'X' }],
      BauherrPlan: [{ plannummer: 'A-110' }, { plannummer: 'A-102' }],
      BauherrTermin: [{ beginn: '2026-12-01' }, { beginn: '2026-11-01' }],
      BauherrKosten: [{ gruppen: [{ kg: '400' }, { kg: '300' }] }],
      Contact: [{ name: 'darf nicht' }],
    });
    assert.equal(d.projekt?.name, 'X');
    assert.deepEqual(d.abschnitte.BauherrPlan.map((p) => p.plannummer), ['A-102', 'A-110']);
    assert.deepEqual(d.abschnitte.BauherrTermin.map((p) => p.beginn), ['2026-11-01', '2026-12-01']);
    assert.deepEqual(d.abschnitte.BauherrKosten[0].gruppen.map((g) => g.kg), ['300', '400']);
    assert.equal('Contact' in d.abschnitte, false);
  });
});

describe('Portal und Weiche (110-02)', () => {
  it('das Bauherrenportal fragt genau die Bauherren-Arten ab — nie Originale', () => {
    const q = fs.readFileSync(path.join(WURZEL, 'src/pages/BauherrPortal.jsx'), 'utf8');
    const arten = [...new Set([...q.matchAll(/bitApi\.entities\.([A-Za-z]+)\./g)].map((m) => m[1]))].sort();
    assert.deepEqual(arten, [...BAUHERR_LESEN].sort());
  });
  it('App.jsx leitet die Rolle bauherr auf das Bauherrenportal, andere Externe aufs Bieterportal', () => {
    const app = fs.readFileSync(path.join(WURZEL, 'src/App.jsx'), 'utf8');
    assert.match(app, /const bauherr = user\?\.role === 'bauherr';/);
    assert.match(app, /\{bauherr \? <BauherrPortal \/> : <BieterPortal \/>\}/);
    assert.ok(app.indexOf("user?.role === 'bauherr'") < app.indexOf('return <HauptApp />'), 'Weiche vor der Büro-Shell');
  });
  it('die gemeinsame Ansicht liest selbst keine Entität', () => {
    const v = fs.readFileSync(path.join(WURZEL, 'src/components/bauherr/BauherrAnsicht.jsx'), 'utf8');
    assert.doesNotMatch(v, /bitApi|entities\./);
  });
});

describe('Ansicht als Bauherr (Vorschau, 110-03)', () => {
  const nutzer = [{ id: 'n1', rolle: 'inhaber', aktiv: true }, { id: 'n2', rolle: 'mitarbeiter', aktiv: true }];
  it('lokal: die Vorschau-Id gibt Rolle bauherr, jedes Büro-Modul aus', () => {
    const r = ermittleZugriff({ nutzerListe: nutzer, datenquelle: 'express', gespeicherteNutzerId: BAUHERR_VORSCHAU_ID });
    assert.equal(r.zugriff.bauherrVorschau, true);
    assert.equal(r.zugriff.rolle, 'bauherr');
    assert.ok(Object.values(r.zugriff.stufen).every((s) => s === 'aus'), 'kein Büro-Modul');
    assert.equal(r.aktiverNutzerId, BAUHERR_VORSCHAU_ID);
    assert.equal(r.kannBauherrVorschau, true);
  });
  it('lokal angeboten auch mit nur einem Nutzer; Cloud: nie (echtes Konto statt Vorschau)', () => {
    assert.equal(ermittleZugriff({ nutzerListe: [nutzer[0]], datenquelle: 'express' }).kannBauherrVorschau, true);
    const c = ermittleZugriff({ user: { email: 'a@b.de' }, serverRolle: { role: 'owner' }, nutzerListe: nutzer, datenquelle: 'supabase', gespeicherteNutzerId: BAUHERR_VORSCHAU_ID });
    assert.equal(c.kannBauherrVorschau, false);
    assert.equal(/** @type {any} */ (c.zugriff).bauherrVorschau, undefined);
    assert.equal(c.zugriff.rolle, 'inhaber');
  });
  it('die lokale Freigabezeile ist die des RPC: bereinigt, Projekt aus der Quelle, quelle_id, freigegeben', () => {
    assert.deepEqual(freigabeZeile('BauherrPlan', 'PL1', 'P1', { titel: 'A', notes: 'x', project_id: 'P9', datei: 'alt.pdf' }), {
      titel: 'A', project_id: 'P1', quelle_id: 'PL1', freigegeben: true,
    });
    assert.equal(freigabeZeile('BauherrPlan', 'PL1', 'P1', {}, 'a.pdf').datei, 'a.pdf');
  });
  it('Sichtbarkeit wie RLS: nur freigegeben und nur das eine Projekt; eigene Zeilen nur des Projekts', () => {
    const s = fuerBauherrSichtbar({
      BauherrPlan: [{ id: 'a', project_id: 'P1', freigegeben: true }, { id: 'b', project_id: 'P1', freigegeben: false }, { id: 'c', project_id: 'P2', freigegeben: true }, { id: 'd', project_id: 'P1' }],
      BauherrRueckmeldung: [{ id: 'r1', project_id: 'P1' }, { id: 'r2', project_id: 'P2' }],
      Project: [{ id: 'P1' }],
    }, 'P1');
    assert.deepEqual(s.BauherrPlan.map((r) => r.id), ['a']);
    assert.deepEqual(s.BauherrRueckmeldung.map((r) => r.id), ['r1']);
    assert.equal('Project' in s, false);
    assert.deepEqual(fuerBauherrSichtbar({ BauherrPlan: [{ project_id: 'P1', freigegeben: true }] }, null), {});
  });
  it('App.jsx zeigt die Vorschau nur lokal und vor der Büro-Shell', () => {
    const app = fs.readFileSync(path.join(WURZEL, 'src/App.jsx'), 'utf8');
    assert.match(app, /DATENQUELLE !== 'supabase' && zugriff\.bauherrVorschau === true/);
    assert.ok(app.indexOf('zugriff.bauherrVorschau') < app.indexOf('return <HauptApp />'));
    assert.match(app, /<BauherrPortal vorschau \/>/);
  });
});

describe('Dateien und Edge-Regeln', () => {
  it('Dateiname ohne Ordner, ohne Punkt vorne, kein IFC-Original', () => {
    assert.equal(bauherrDateiname('../A-101 Grundriss EG.pdf'), 'A-101_Grundriss_EG.pdf');
    assert.equal(bauherrDateiname('.versteckt'), 'versteckt');
    assert.equal(bauherrDateiname('modell.ifc'), null);
    assert.equal(bauherrDateiname(''), null);
    assert.equal(bauherrDateiname('Ä ö ü.pdf'), 'A_o_u.pdf');
  });
  it('freigabe-Function signiert jede Bauherren-Art mit Datei, Pfad im Ordner _bauherr', () => {
    for (const [art, felder] of Object.entries(BAUHERR_FELDER)) {
      if (BAUHERR_ARTEN.includes(art) && felder.includes('datei')) assert.ok(FREIGABE_DATEI_ENTITAETEN.includes(art), art);
    }
    const org = '11111111-1111-4111-8111-111111111111';
    assert.equal(freigabePfad({ org_id: org, entity: 'BauherrPlan', projekt_id: 'P1', vergabe_id: 'T1', data: { datei: 'a.pdf' } }), `${org}/P1/_bauherr/a.pdf`);
    assert.equal(freigabePfad({ org_id: org, entity: 'ModellFreigabe', projekt_id: 'P1', data: { datei: 'a.glb' } }), `${org}/P1/_allgemein/a.glb`);
  });
  it('Bauherr bekommt keine internen Rechte und gibt kein Gebot ab', () => {
    assert.deepEqual(mitgliedschaftFuerExterne('bauherr'), {
      role: 'bauherr', stufe: 'free', can_edit_model: false, can_export_ifc: false, can_view_audit_reports: false, can_submit_bid: false,
    });
  });
});
