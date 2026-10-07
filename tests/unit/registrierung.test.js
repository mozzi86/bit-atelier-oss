// Unit tests for the registration request (Plan 83-02,
// packages/nova-core/src/lib/registrierung.js): required fields and the
// prepared mail to the access address. The page itself sends nothing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pruefeRegistrierung, registrierungMailto, REGISTRIERUNG_ROLLEN } from '@core/lib/registrierung';
import { ANBIETER } from '@core/lib/anbieter';

const GUELTIG = {
  name: 'Vorname Name', buero: 'Büro Muster', email: 'neu@buero.example', telefon: '', rolle: 'architektur', nachricht: '',
};

describe('registrierung — Pflichtfelder', () => {
  it('vollständige Angaben → keine Fehler', () => {
    assert.deepEqual(pruefeRegistrierung(GUELTIG), []);
  });

  it('jedes Pflichtfeld meldet sich im Klartext', () => {
    assert.deepEqual(pruefeRegistrierung({}), [
      'Bitte Ihren Namen angeben.',
      'Bitte Büro oder Firma angeben.',
      'Bitte eine gültige E-Mail-Adresse angeben.',
      'Bitte eine Rolle wählen.',
    ]);
    assert.deepEqual(pruefeRegistrierung({ ...GUELTIG, email: 'kein-at' }), ['Bitte eine gültige E-Mail-Adresse angeben.']);
    assert.deepEqual(pruefeRegistrierung({ ...GUELTIG, rolle: 'chef' }), ['Bitte eine Rolle wählen.']);
    assert.deepEqual(pruefeRegistrierung({ ...GUELTIG, name: '   ' }), ['Bitte Ihren Namen angeben.']);
  });

  it('die vier Rollen aus dem Auftrag', () => {
    assert.deepEqual(REGISTRIERUNG_ROLLEN.map((r) => r.label), ['Architektur', 'Fachplanung', 'Bauherr', 'Sonstiges']);
  });
});

describe('registrierung — vorbereitete E-Mail', () => {
  it('geht an die Zugangsadresse, mit Büro im Betreff und allen Angaben im Text', () => {
    const href = registrierungMailto({ ...GUELTIG, telefon: '0911 123', nachricht: 'Bitte bis Freitag' }, ANBIETER.anfrageEmail);
    assert.ok(href.startsWith(`mailto:${ANBIETER.anfrageEmail}?`));
    const p = new URLSearchParams(href.split('?')[1]);
    assert.equal(p.get('subject'), 'BIT-Atelier Zugangsanfrage – Büro Muster');
    const text = p.get('body');
    for (const zeile of ['Name: Vorname Name', 'Büro/Firma: Büro Muster', 'E-Mail: neu@buero.example', 'Telefon: 0911 123', 'Rolle: Architektur', 'Bitte bis Freitag']) {
      assert.ok(text.includes(zeile), `fehlt: ${zeile}`);
    }
  });

  it('leere optionale Felder erscheinen als Gedankenstrich', () => {
    const p = new URLSearchParams(registrierungMailto(GUELTIG, 'zugang@example.de').split('?')[1]);
    assert.match(p.get('body'), /Telefon: —/);
    assert.match(p.get('body'), /Nachricht:\n—$/);
  });

  it('Zugangsadresse ist gesetzt (sonst bricht build:cloud ab)', () => {
    assert.match(ANBIETER.anfrageEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});
