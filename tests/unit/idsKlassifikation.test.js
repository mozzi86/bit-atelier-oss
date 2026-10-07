// Phase 71-01 Task 3: die additive Klassifikations-Erweiterung in ids.js.
//
// Vorher: evaluateIds kannte nur element.classification = {system, code} als
// EINZELobjekt — ModelCheck.jsx baute es aus el.classification.{name,code},
// Felder die der Import nie liefert (71-RESEARCH §2 „Mapping-Fehler"). Der
// Import liefert klassifikation[]/classifications[] als „<code> <name>"-
// Strings (ifcImport.js:278-281, 588-589). Neu: das Array wird verstanden,
// die Objektform bleibt rückwärtskompatibel.
//
// Rein in Node testbar (evaluateIds ist pure).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateIds } from '@ifc/lib/ids.js';

/** Spec mit einer Klassifikations-Facette (System + Code, wie musterprojekt.ids-Form). */
function klassifikationsSpec(system, code) {
  return [{
    name: 'Klassifikation',
    ifcVersions: ['IFC4'],
    kardinalitaet: 'required',
    applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCWALL' } }],
    requirements: [{
      typ: 'classification',
      system: system ? { art: 'simple', wert: system } : null,
      value: code ? { art: 'simple', wert: code } : null,
      cardinality: 'required',
    }],
  }];
}

const wand = (extra) => ({
  globalId: '0WALL000000000000001',
  ifcType: 'IfcWall',
  name: 'Wand',
  psets: {},
  material: [],
  ...extra,
});

describe('ids.js — Klassifikations-Array (71-01)', () => {
  it('„<code> <name>"-Strings: Code wird matched, mind. EIN Eintrag reicht', () => {
    // mini.ifc-Fall: zwei Referenzen, „10 Wand innen" und „tragend" (kein Code).
    const el = wand({ classifications: ['10 Wand innen', 'tragend'] });
    const r = evaluateIds(klassifikationsSpec(null, '10'), [el]);
    assert.equal(r[0].bestanden, true);
    assert.equal(r[0].verletzungen.length, 0);
  });

  it('kein passender Code -> Verletzung mit Ist-Liste', () => {
    const el = wand({ classifications: ['10 Wand innen'] });
    const r = evaluateIds(klassifikationsSpec(null, '99'), [el]);
    assert.equal(r[0].verletzungen.length, 1);
    assert.match(r[0].verletzungen[0].gefunden, /10/);
  });

  it('leeres Array = kein Träger -> Verletzung (Existenzpflicht)', () => {
    const el = wand({ classifications: [] });
    const r = evaluateIds(klassifikationsSpec(null, '10'), [el]);
    assert.equal(r[0].verletzungen.length, 1);
    assert.equal(r[0].verletzungen[0].gefunden, 'nicht vorhanden');
  });

  it('Objektform {system, code} bleibt rückwärtskompatibel', () => {
    const el = wand({ classification: { system: 'BUERO', code: '10' } });
    assert.equal(evaluateIds(klassifikationsSpec('BUERO', '10'), [el])[0].bestanden, true);
    assert.equal(evaluateIds(klassifikationsSpec('BUERO', '99'), [el])[0].bestanden, false);
  });

  it('System-Facette gegen Array ohne System: kein Scheitern mangels Wissen', () => {
    // Der Import kennt das Klassifikationssystem nicht (nur „<code> <name>").
    // ids.js:517-520 macht es bei dataType vor: nur prüfen, was bekannt ist.
    // Ein reines Code-Match muss trotz System-Facette bestehen können.
    const el = wand({ classifications: ['10 Wand innen'] });
    const r = evaluateIds(klassifikationsSpec('BUERO', '10'), [el]);
    assert.equal(r[0].bestanden, true,
      'Array-Einträge ohne System dürfen an der System-Facette nicht scheitern');
  });

  it('Array gewinnt vor Objekt, wenn beide da sind', () => {
    const el = wand({
      classifications: ['10 Wand innen'],
      classification: { system: 'alt', code: '99' },
    });
    assert.equal(evaluateIds(klassifikationsSpec(null, '10'), [el])[0].bestanden, true);
  });

  it('Objekt-Form mit Eintrag als {system,code}-Objekt im Array', () => {
    const el = wand({ classifications: [{ system: 'BUERO', code: '10' }] });
    assert.equal(evaluateIds(klassifikationsSpec('BUERO', '10'), [el])[0].bestanden, true);
  });
});
