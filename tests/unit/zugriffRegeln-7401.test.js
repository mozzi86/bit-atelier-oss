// 74-01 Task 9: the pure rules of the edge functions einladung / freigabe / llm
// (supabase/functions/_shared/zugriffRegeln.js — same file Deno imports).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLLEN_EXTERN, einladungErlaubt, einladungPruefen, freigabePfad, istIfcDatei, llmAktionErlaubt,
  mitgliedschaftFuerExterne, rolleNormalisieren,
} from '../../supabase/functions/_shared/zugriffRegeln.js';
import { rolleNormalisieren as rolleClient } from '@core/lib/rollen';

const ORG = '11111111-1111-4111-8111-111111111111';

describe('zugriffRegeln — Rollen', () => {
  it('Server und Client normalisieren gleich (kein Drift)', () => {
    for (const r of ['admin', 'mitglied', 'owner', 'planner', 'leser', 'bidder', 'investor', 'gast', 'viewer', '', null, ' bidder ']) {
      assert.equal(rolleNormalisieren(r), rolleClient(r), String(r));
    }
  });
  it('Rechte einer externen Rolle stehen fest — interne nie, Gebot nur bidder/investor', () => {
    for (const r of ROLLEN_EXTERN) {
      const m = mitgliedschaftFuerExterne(r);
      assert.equal(m.can_edit_model || m.can_export_ifc || m.can_view_audit_reports, false, r);
      assert.equal(m.can_submit_bid, r !== 'gast', r);
    }
    assert.throws(() => mitgliedschaftFuerExterne('planner'), /Keine externe Rolle/);
  });
  it('ein internes Mitglied wird nie extern eingeladen', () => {
    assert.equal(einladungErlaubt(null).ok, true);
    assert.equal(einladungErlaubt({ role: 'gast' }).ok, true);
    assert.equal(einladungErlaubt({ role: 'admin' }).ok, false);
    assert.equal(einladungErlaubt({ role: 'planner' }).ok, false);
  });
  it('llm: Verbindungen und Test nur owner, Aufruf nur intern, Externe nichts (A-35)', () => {
    assert.equal(llmAktionErlaubt('connections.list', 'admin'), true);
    assert.equal(llmAktionErlaubt('connections.create', 'mitglied'), false);
    assert.equal(llmAktionErlaubt('test', 'planner'), false);
    assert.equal(llmAktionErlaubt('invoke', 'leser'), true);
    for (const a of ['invoke', 'test', 'connections.list', 'connections.create', 'defaults']) {
      assert.equal(llmAktionErlaubt(a, 'bidder'), false, a);
    }
    assert.equal(llmAktionErlaubt('unbekannt', 'owner'), false);
  });
});

describe('zugriffRegeln — Einladung prüfen', () => {
  const basis = { aktion: 'einladen', org_id: ORG, email: 'Bieter@Example.de', rolle: 'bidder', projekt_id: 'P1', vergabe_id: 'T1' };
  it('gültige Einladung, E-Mail kleingeschrieben', () => {
    const r = einladungPruefen(basis);
    assert.equal(r.ok, true);
    assert.equal(r.daten.email, 'bieter@example.de');
  });
  it('interne Rolle, fehlendes Projekt, Bieter ohne Vergabe, kaputte Ids → Klartext', () => {
    assert.match(einladungPruefen({ ...basis, rolle: 'owner' }).fehler, /bidder, investor oder gast/);
    assert.match(einladungPruefen({ ...basis, projekt_id: '' }).fehler, /projekt_id fehlt/);
    assert.match(einladungPruefen({ ...basis, vergabe_id: '' }).fehler, /vergabe_id fehlt/);
    assert.match(einladungPruefen({ ...basis, vergabe_id: '../x' }).fehler, /vergabe_id ist ungültig/);
    assert.match(einladungPruefen({ ...basis, org_id: 'abc' }).fehler, /org_id/);
    assert.match(einladungPruefen({ ...basis, gueltig_bis: 'morgen' }).fehler, /kein Datum/);
    assert.equal(einladungPruefen({ ...basis, rolle: 'investor', vergabe_id: '' }).ok, true, 'Investor ohne Vergabe');
  });
  it('Widerruf braucht nur Büro und Adresse', () => {
    assert.equal(einladungPruefen({ aktion: 'widerruf', org_id: ORG, email: 'a@b.de' }).ok, true);
    assert.match(einladungPruefen({ aktion: 'loeschen', org_id: ORG, email: 'a@b.de' }).fehler, /Unbekannte Aktion/);
  });
});

describe('zugriffRegeln — Pfad einer Freigabe (A-32)', () => {
  const zeile = { org_id: ORG, projekt_id: 'P1', vergabe_id: 'T1', data: { datei: 'ansicht.glb' } };
  it('nur aus dem Datensatz gebaut', () => {
    assert.equal(freigabePfad(zeile), `${ORG}/P1/T1/ansicht.glb`);
    assert.equal(freigabePfad({ ...zeile, vergabe_id: null, data: { datei: 'x.pdf' } }), `${ORG}/P1/_allgemein/x.pdf`);
  });
  it('kein Ausbruch über den Dateinamen oder kaputte Ids', () => {
    for (const datei of ['../nachbar.glb', 'a/b.glb', 'a\\b.glb', '.versteckt', '']) {
      assert.equal(freigabePfad({ ...zeile, data: { datei } }), null, datei);
    }
    assert.equal(freigabePfad({ ...zeile, org_id: 'kein-uuid' }), null);
    assert.equal(freigabePfad({ ...zeile, projekt_id: 'P/1' }), null);
  });
  it('IFC-Originale erkannt', () => {
    assert.equal(istIfcDatei('modell.IFC'), true);
    assert.equal(istIfcDatei('modell.ifczip'), true);
    assert.equal(istIfcDatei('ansicht.glb'), false);
  });
});
