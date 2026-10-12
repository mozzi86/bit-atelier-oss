// Unit tests for the registration request (Plan 83-02,
// packages/nova-core/src/lib/registrierung.js): required fields and the
// prepared mail to the access address. The page itself sends nothing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_MAILTEXT, pruefeRegistrierung, registrierungMailto, registrierungText, REGISTRIERUNG_ROLLEN } from '@core/lib/registrierung';
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

// 57-06 Task 3: the confirmation screen shows the request text, so nothing is
// lost when no mail program opens. Same text as in the mail, cut marked.
describe('registrierung — Wortlaut für die Bestätigung (57-06)', () => {
  it('Betreff und Text sind genau das, was in der Mail steht', () => {
    const angaben = { ...GUELTIG, nachricht: 'Rückruf bitte vormittags' };
    const { betreff, text, gekuerzt } = registrierungText(angaben);
    const p = new URLSearchParams(registrierungMailto(angaben, 'zugang@example.de').split('?')[1]);
    assert.equal(p.get('subject'), betreff);
    assert.equal(p.get('body'), text);
    assert.equal(gekuerzt, false);
  });

  it('eine überlange Nachricht wird auf MAX_MAILTEXT gekürzt und als gekürzt gemeldet', () => {
    const { text, gekuerzt } = registrierungText({ ...GUELTIG, nachricht: 'x'.repeat(MAX_MAILTEXT + 50) });
    assert.equal(text.length, MAX_MAILTEXT);
    assert.equal(gekuerzt, true);
  });
});
