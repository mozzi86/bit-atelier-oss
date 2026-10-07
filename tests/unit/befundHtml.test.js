// Phase 69-14 Task 1: befundHtml — standalone HTML summary. Escaping, empty
// findings (honest sentence), numbers in the output, no external resources
// except the footer link.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { befundHtml, esc } from '@ifc/lib/befundHtml.js';
import { REPO_URL } from '@core/lib/projektInfo';

const CLASH = [
  {
    kind: 'hard', aType: 'IfcWall', bType: 'IfcBeam',
    aGuid: '0YvctVUK80kugbV<5J$8vP', bGuid: '2XQ$n4SM1BVQ==',
    overlapVol: 0.0123, center: { x: 1.5, y: 2.5, z: 3.5 },
  },
  { kind: 'duplicate', aType: 'IfcDoor', bType: 'IfcDoor', aGuid: 'dup-1', bGuid: 'dup-2', overlapVol: 0, center: null },
];
const IDS = [
  { spec: { name: 'Wand-Dicke 175' }, bestanden: false, verletzungen: [{ globalId: 'g1', elementName: 'Wand EG-1', facet: 'thickness', erwartet: '175', gefunden: '115' }] },
  { spec: { name: 'OK-Spec' }, bestanden: true, verletzungen: [] },
];

describe('befundHtml', () => {
  it('liefert ein vollständiges HTML-Dokument ohne externe Ressourcen (außer Fußzeilen-Link)', () => {
    const html = befundHtml({ projekt: 'P', datum: '2026-09-25', befunde: { clash: CLASH, ids: IDS } });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>$/);
    // No <script>, no external stylesheets/images/fonts — inline CSS only.
    assert.equal(/<script/i.test(html), false);
    assert.equal(/<link/i.test(html), false);
    assert.equal(/src=/i.test(html), false);
    // Exactly one href: the footer link to the open-source project (83-02).
    const hrefs = html.match(/href="[^"]*"/g) || [];
    assert.equal(hrefs.length, 1);
    assert.ok(hrefs[0].includes(REPO_URL.replace('https://', '')));
    assert.equal(/demo/i.test(html), false, 'kein Verweis auf die entfernte Demo');
  });

  it('escaped Benutzereingaben und Modellnamen (&<>"\')', () => {
    const html = befundHtml({
      projekt: '<script>alert("x")</script> & Co',
      modell: 'A&B <Modell>.ifc',
      befunde: { clash: [{ kind: 'hard', aType: 'Ifc<Wand>', bType: 'Ifc"Träger"', aGuid: "g'1", bGuid: 'g2', overlapVol: 1, center: null }], ids: [] },
    });
    assert.equal(html.includes('<script>alert'), false);
    assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)'));
    assert.ok(html.includes('A&amp;B'));
    assert.ok(html.includes('Ifc&lt;Wand&gt;'));
    assert.ok(html.includes('Ifc&quot;Träger&quot;'));
    assert.ok(html.includes('g&#39;1'));
  });

  it('esc() deckt alle fünf XML-Zeichen ab', () => {
    assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });

  it('Kennzahlen stehen als Text im Dokument', () => {
    const html = befundHtml({
      projekt: 'Bürocampus', kennzahlen: { bauteile: 4211, kollisionen: 3, duplikate: 1, idsFehler: 2 },
      befunde: { clash: [], ids: [] },
    });
    assert.ok(html.includes('4211'));
    assert.ok(html.includes('>3<'));
    assert.ok(html.includes('Bürocampus'));
  });

  it('leere Befundliste → ehrlicher Satz, keine leeren Listen', () => {
    const html = befundHtml({ projekt: 'P', kennzahlen: { kollisionen: 0 }, befunde: { clash: [], ids: [] } });
    assert.ok(html.includes('Keine Befunde in diesem Lauf'));
    assert.equal(html.includes('<ol>'), false);
  });

  it('listet Clash-Befunde mit GlobalIds und IDS-Verstöße (nur nicht bestandene)', () => {
    const html = befundHtml({ befunde: { clash: CLASH, ids: IDS } });
    assert.ok(html.includes('0YvctVUK80kugbV&lt;5J$8vP') || html.includes('0YvctVUK80kugbV<5J$8vP'.replace(/</g, '&lt;')));
    assert.ok(html.includes('Kollision'));
    assert.ok(html.includes('Duplikat'));
    assert.ok(html.includes('Wand-Dicke 175'));
    assert.ok(!html.includes('OK-Spec'), 'bestandene Spezifikationen stehen nicht in der Verstöße-Liste');
    assert.ok(html.includes('erwartet 175, gefunden 115'));
    assert.ok(html.includes('(1.50 / 2.50 / 3.50 m)'));
  });

  it('Fußzeile trägt Projektadresse UND den Lauf-Bezug (unaufdringlich am Ende)', () => {
    const html = befundHtml({ projekt: 'P', fussnote: 'Zusatztext', befunde: { clash: [], ids: [] } });
    assert.ok(html.includes('BIT-Atelier'));
    assert.ok(html.includes('läuft im Browser'));
    assert.ok(html.includes(REPO_URL));
    assert.ok(html.includes('Zusatztext'));
    // The footer is the LAST block before </body>.
    assert.ok(html.indexOf('<footer>') > html.indexOf('Keine Befunde'));
  });

  it('kürzt lange Listen auf 200 je Art mit Hinweis', () => {
    const viele = Array.from({ length: 250 }, (_, i) => ({ kind: 'hard', aType: `T${i}`, bType: 'X', aGuid: `g${i}`, bGuid: 'h', overlapVol: 0, center: null }));
    const html = befundHtml({ befunde: { clash: viele, ids: [] } });
    assert.ok(html.includes('Liste gekürzt'));
    assert.ok(html.includes('erste 200'));
    assert.ok(!html.includes('T249'));
    assert.ok(html.includes('T199'));
    assert.ok(html.includes('(250)'), 'die Gesamtzahl bleibt ehrlich in der Überschrift');
  });
});
