// Phase 69-06: shareable check-run link. Test list from 69-RESEARCH §3 +
// plan Task 1: round-trip with all fields; stable order (two equal states ->
// identical string); GlobalId unchanged; unknown source -> null; broken
// filter -> null; empty state -> empty string; legacy ?beispiel=1 readable.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  serialisierePruefzustand,
  parsePruefzustand,
  prueflaufLink,
  QUELLEN,
} from '@ifc/lib/prueflaufLink.js';

// A realistic IFC GlobalId: base64-ish with $ and _ (22 chars).
const GUID = '0YvctVUK80kugbV$5J_8vP';

describe('serialisierePruefzustand', () => {
  it('leerer Zustand → leerer String', () => {
    assert.equal(serialisierePruefzustand({}), '');
    assert.equal(serialisierePruefzustand(), '');
    assert.equal(serialisierePruefzustand({ quelle: null, sel: '', filter: [] }), '');
  });

  it('feste Feldreihenfolge q,r,f,s,o — unabhängig von der Objektreihenfolge', () => {
    const a = serialisierePruefzustand({ quelle: 'beispiel', regelsatz: 'BAP', filter: ['x'], sel: GUID, sort: 'vol' });
    const b = serialisierePruefzustand({ sort: 'vol', sel: GUID, filter: ['x'], regelsatz: 'BAP', quelle: 'beispiel' });
    assert.equal(a, b);
    assert.match(a, /^q=beispiel&r=BAP&f=x&s=/);
  });

  it('Filter werden alphabetisch sortiert (zwei gleiche Mengen → gleicher String)', () => {
    const a = serialisierePruefzustand({ filter: ['Wand-Decke', 'Duplikat', 'Abstand'] });
    const b = serialisierePruefzustand({ filter: ['Abstand', 'Duplikat', 'Wand-Decke'] });
    assert.equal(a, b);
    assert.equal(a, 'f=Abstand%2CDuplikat%2CWand-Decke');
  });

  it('unbekannte Quelle → null (kein halber Link)', () => {
    assert.equal(serialisierePruefzustand({ quelle: 'wolke' }), null);
  });

  it('leere Quelle wird übersprungen, die übrigen Felder bleiben', () => {
    assert.equal(serialisierePruefzustand({ quelle: '', sel: GUID }), `s=${encodeURIComponent(GUID)}`);
  });

  it('GlobalId bleibt unverändert (Round-Trip durch URLSearchParams)', () => {
    const q = serialisierePruefzustand({ quelle: 'beispiel', sel: GUID });
    const zurueck = parsePruefzustand(q);
    assert.equal(zurueck.sel, GUID);
  });
});

describe('parsePruefzustand', () => {
  it('Rundlauf mit allen Feldern', () => {
    const zustand = { quelle: 'datei', regelsatz: 'Referenzprojekt_IDS_v3.xml', filter: ['Duplikat', 'Kollision'], sel: GUID, sort: 'vol-ab' };
    const q = serialisierePruefzustand(zustand);
    assert.deepEqual(parsePruefzustand(q), zustand);
  });

  it('akzeptiert Suchstring mit und ohne führendes ?', () => {
    const q = serialisierePruefzustand({ quelle: 'beispiel' });
    assert.deepEqual(parsePruefzustand(q), { quelle: 'beispiel' });
    assert.deepEqual(parsePruefzustand(`?${q}`), { quelle: 'beispiel' });
    assert.deepEqual(parsePruefzustand(new URLSearchParams(q)), { quelle: 'beispiel' });
  });

  it('?beispiel=1 (Legacy-Tieflink 65-04) bleibt lesbar', () => {
    assert.deepEqual(parsePruefzustand('beispiel=1'), { quelle: 'beispiel' });
    assert.deepEqual(parsePruefzustand('?beispiel=1&r=BAP'), { quelle: 'beispiel', regelsatz: 'BAP' });
  });

  it('unbekannte Quelle im Link → null', () => {
    assert.equal(parsePruefzustand('q=wolke'), null);
    assert.equal(parsePruefzustand('q=DATEI'), null, 'Groß/klein ist keine bekannte Quelle');
  });

  it('kaputter Filter → null; leere Suche → null', () => {
    assert.equal(parsePruefzustand('f=,,'), null);
    assert.equal(parsePruefzustand(''), null);
    assert.equal(parsePruefzustand(null), null);
    assert.equal(parsePruefzustand('nichts=da'), null);
  });

  it('QUELLEN nennt genau die zwei erlaubten Werte', () => {
    assert.deepEqual(QUELLEN, ['beispiel', 'datei']);
  });
});

describe('prueflaufLink', () => {
  it('baut die Hash-Route auf #/ModelCheck und schneidet einen alten Hash ab', () => {
    const l = prueflaufLink('http://localhost:5173/', { quelle: 'beispiel', sel: GUID });
    assert.equal(l, `http://localhost:5173/#/ModelCheck?q=beispiel&s=${encodeURIComponent(GUID)}`);
    const mitHash = prueflaufLink('http://localhost:5173/#/ModelCheck?alt=1', { quelle: 'datei' });
    assert.equal(mitHash, 'http://localhost:5173/#/ModelCheck?q=datei');
  });

  it('leerer Zustand → Link ohne Query; unbrauchbarer Zustand → null', () => {
    assert.equal(prueflaufLink('http://x/', {}), 'http://x/#/ModelCheck');
    assert.equal(prueflaufLink('http://x/', { quelle: 'unsinn' }), null);
  });
});
