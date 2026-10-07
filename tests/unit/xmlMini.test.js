// xmlMini.test.js — Phase 71-04 Task 1: der XML-Leser in @core.
// Beweislast: (a) 1:1-Verschiebung — dieselben Verhaltensweisen wie vorher in
// xlsxRead.js (Entity-Auflösung, DOCTYPE-Ablehnung, Tiefen-/Längengrenze,
// Textsammeln, Namensräume via lokal()), (b) neu xmlBaum für kleine Dokumente.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { xmlBaum, xmlDurchlaufen, xmlEntschaerfen, kind, kinder, kindText } from '@core/lib/xmlMini';

test('xmlEntschaerfen: fünf Standardentitäten + numerisch dezimal/hex', () => {
  assert.equal(xmlEntschaerfen('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'');
  assert.equal(xmlEntschaerfen('&#228;&#xE4;'), 'ää');
  // Unbekannte bleiben literal.
  assert.equal(xmlEntschaerfen('&nbsp;'), '&nbsp;');
  assert.equal(xmlEntschaerfen(null), '');
});

test('xmlDurchlaufen: Tags, Attribute, Text, self-closing, Namensräume', () => {
  const xml = '<root a="1"><kind x=\'y\'>Text &amp; mehr</kind><leer /><ns:kind2>z</ns:kind2></root>';
  const events = [];
  xmlDurchlaufen(xml, (t) => events.push(t));

  assert.equal(events[0].name, 'root');
  assert.deepEqual(events[0].attrs, { a: '1' });
  assert.equal(events[1].attrs.x, 'y');
  const kindEnde = events.find((e) => e.ende && e.name === 'kind');
  assert.equal(kindEnde.text, 'Text & mehr');
  const leer = events.find((e) => e.name === 'leer');
  assert.equal(leer.selbstschliessend, true);
  // lokal() schneidet Präfixe ab: ns:kind2 -> kind2.
  const k2 = events.find((e) => e.ende && e.name === 'kind2');
  assert.equal(k2.text, 'z');
  assert.equal(k2.voll, 'ns:kind2');
});

test('xmlDurchlaufen: Kommentare und PI werden übersprungen', () => {
  const events = [];
  xmlDurchlaufen('<?xml version="1.0"?><!-- hi <fake> --><a>b</a>', (t) => events.push(t));
  assert.equal(events.length, 2); // Start + Ende von <a>
  assert.equal(events[0].name, 'a');
  assert.equal(events[1].text, 'b');
});

test('xmlDurchlaufen: DOCTYPE wird abgelehnt (XXE-Schutz)', () => {
  assert.throws(
    () => xmlDurchlaufen('<!DOCTYPE foo SYSTEM "x.dtd"><foo/>', () => {}),
    /DOCTYPE/i,
  );
});

test('xmlDurchlaufen: Tiefen- und Längengrenze mit Klartext', () => {
  assert.throws(() => xmlDurchlaufen('<a><a><a></a></a></a>', () => {}, { maxTiefe: 2 }), /zu tief/);
  assert.throws(() => xmlDurchlaufen('<a>xxxxx</a>', () => {}, { maxLaenge: 4 }), /zu groß/);
});

test('xmlBaum: verschachtelte Objekte mit kinder/text/attrs', () => {
  const baum = xmlBaum(
    '<Markup><Topic Guid="g-1"><Title>Hallo &amp; Tschüss</Title><Labels>L1</Labels><Labels>L2</Labels></Topic><Comment Guid="c-1"><Date>2026</Date></Comment></Markup>',
  );
  assert.equal(baum.name, 'Markup');
  const topic = kind(baum, 'Topic');
  assert.equal(topic.attrs.Guid, 'g-1');
  assert.equal(kindText(topic, 'Title'), 'Hallo & Tschüss');
  assert.deepEqual(kinder(topic, 'Labels').map((l) => l.text), ['L1', 'L2']);
  assert.equal(kind(baum, 'Comment').attrs.Guid, 'c-1');
  assert.equal(kind(baum, 'GibtEsNicht'), null);
});

test('xmlBaum: self-closing wird kinderloser Knoten, leeres XML -> null', () => {
  const baum = xmlBaum('<Version VersionId="2.1" />');
  assert.equal(baum.attrs.VersionId, '2.1');
  assert.deepEqual(baum.kinder, []);
  assert.equal(xmlBaum(''), null);
});
