// Unit tests for the feedback links (Plan 83-02, packages/nova-core/src/lib/feedback.js)
// and the project facts behind them (projektInfo.js): mailto and GitHub URLs carry
// exactly the text and — only when wanted — the technical block; nothing else.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  befundText, erkenneUmgebung, feedbackBetreff, feedbackIssueUrl, feedbackMailto, issueTitel,
  mailtoLink, MAX_ISSUE_TEXT, MAX_MAILTO_TEXT, technischeZeilen,
} from '@core/lib/feedback';
import { APP_VERSION, FEEDBACK_EMAIL, ISSUES_URL, REPO_URL } from '@core/lib/projektInfo';
import { ANBIETER } from '@core/lib/anbieter';

/** @param {string} href @returns {{an: string, betreff: string, text: string}} */
function mailto(href) {
  const [kopf, abfrage] = href.split('?');
  const p = new URLSearchParams(abfrage);
  return { an: kopf.replace('mailto:', ''), betreff: p.get('subject'), text: p.get('body') };
}

describe('projektInfo', () => {
  it('Repo, Issues und Feedback-Adresse', () => {
    assert.equal(REPO_URL, 'https://github.com/mozzi86/bit-atelier-oss');
    assert.equal(ISSUES_URL, `${REPO_URL}/issues`);
    assert.equal(FEEDBACK_EMAIL, ANBIETER.email, 'Feedback geht an die App-Mail aus dem Impressum');
  });

  it('APP_VERSION fällt unter node auf "dev" (kein Vite-define)', () => {
    assert.equal(APP_VERSION, 'dev');
  });
});

describe('feedback — mailto', () => {
  it('Betreff „BIT-Atelier Feedback (Version)“, Text und Technik-Block im Körper', () => {
    const technik = technischeZeilen({ version: '1.2.3', seite: '/AVA', browser: 'Firefox', betriebssystem: 'Linux' });
    const m = mailto(feedbackMailto({ text: '  Hallo & Grüße \n', technik, version: '1.2.3' }));
    assert.equal(m.an, FEEDBACK_EMAIL);
    assert.equal(m.betreff, 'BIT-Atelier Feedback (1.2.3)');
    assert.equal(m.text, 'Hallo & Grüße\n\n---\nVersion: 1.2.3\nSeite: /AVA\nBrowser: Firefox\nBetriebssystem: Linux');
  });

  it('ohne Häkchen (technik = null) nur der Text', () => {
    assert.equal(mailto(feedbackMailto({ text: 'Nur das', version: '1' })).text, 'Nur das');
  });

  it('Text wird sichtbar auf MAX_MAILTO_TEXT Zeichen gekürzt', () => {
    const m = mailto(mailtoLink('a@b.de', 'x', ['y'.repeat(MAX_MAILTO_TEXT + 500)]));
    assert.equal(m.text.length, MAX_MAILTO_TEXT);
  });

  it('feedbackBetreff nimmt standardmäßig APP_VERSION', () => {
    assert.equal(feedbackBetreff(), `BIT-Atelier Feedback (${APP_VERSION})`);
  });
});

describe('feedback — GitHub', () => {
  it('neue Meldung im Repo, Titel = erste Zeile, Körper = Text + Technik', () => {
    const url = new URL(feedbackIssueUrl({ text: 'Fehler beim Export\nDetails', technik: ['Version: 9'], version: '9' }));
    assert.equal(`${url.origin}${url.pathname}`, `${ISSUES_URL}/new`);
    assert.equal(url.searchParams.get('title'), 'Fehler beim Export');
    assert.equal(url.searchParams.get('body'), 'Fehler beim Export\nDetails\n\n---\nVersion: 9');
  });

  it('leerer Text → Titel ist der Betreff; langer Titel wird mit … gekürzt', () => {
    assert.equal(issueTitel('', '2.0'), 'BIT-Atelier Feedback (2.0)');
    const lang = issueTitel('x'.repeat(200));
    assert.equal(lang.length, 80);
    assert.ok(lang.endsWith('…'));
  });

  it('Körper wird auf MAX_ISSUE_TEXT gekürzt', () => {
    const url = new URL(feedbackIssueUrl({ text: 'z'.repeat(MAX_ISSUE_TEXT * 2) }));
    assert.equal(url.searchParams.get('body').length, MAX_ISSUE_TEXT);
  });
});

describe('feedback — Umgebung aus dem User-Agent (grob, ohne Versionen)', () => {
  const FAELLE = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0', 'Edge', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Chrome', 'Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox', 'Linux'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari', 'macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari', 'iOS'],
    ['Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', 'Chrome', 'Android'],
  ];
  for (const [ua, browser, betriebssystem] of FAELLE) {
    it(`${browser} auf ${betriebssystem}`, () => {
      assert.deepEqual(erkenneUmgebung(ua), { browser, betriebssystem });
    });
  }

  it('unbekannt → Gedankenstrich, nie undefined', () => {
    assert.deepEqual(erkenneUmgebung(''), { browser: '—', betriebssystem: '—' });
    assert.deepEqual(erkenneUmgebung(undefined), { browser: '—', betriebssystem: '—' });
  });
});

describe('feedback — „Befund besprechen“', () => {
  it('Kennzahlen des Laufs, Musterprojekt-Hinweis, Paket nur wenn geladen', () => {
    const text = befundText({ modell: 'm.ifc', quelle: 'beispiel', bauteile: 9, geschosse: 2, kollisionen: 3, duplikate: 1, idsFehler: 4 });
    assert.match(text, /^Ich möchte ein Ergebnis der Prüf-Suite besprechen\./);
    assert.match(text, /Modell: m\.ifc \(Musterprojekt\)/);
    assert.match(text, /Bauteile mit Geometrie: 9/);
    assert.match(text, /Geschosse: 2/);
    assert.match(text, /Harte Kollisionen: 3/);
    assert.match(text, /Doppelmodellierungen: 1/);
    assert.match(text, /IDS-Verstöße: 4/);
    assert.equal(/Befund-Paket/.test(text), false);
    assert.match(befundText({ paketName: 'P_2026-10-06_befunde.zip' }), /Befund-Paket „P_2026-10-06_befunde\.zip“ liegt im Download-Ordner/);
  });

  it('übersetzt über die mitgegebene t-Funktion', () => {
    const t = (k) => (k === 'Modell' ? 'Model' : k);
    assert.match(befundText({ modell: 'x.ifc' }, t), /Model: x\.ifc/);
  });

  it('ohne Kennzahlen kein Absturz, keine undefined-Texte', () => {
    assert.equal(/undefined|null/.test(befundText(undefined)), false);
  });
});
