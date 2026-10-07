// Phase 71-01: idsWriter.js — IDS-1.0-XML aus Spec-Objekten, DOM-frei.
//
// Roundtrip-Beweis OHNE DOMParser (den Node nicht hat): die Spec-Objekte des
// Writers laufen DIREKT durch evaluateIds (ids.js) gegen handgebaute Elemente —
// dieselbe Objektform, die parseIdsXml erzeugt. Zusätzlich String-Assertions
// auf dem XML: die Elemente/Attribute, die ids.js beim Lesen erwartet
// (cardinality, dataType, minOccurs/maxOccurs, ifcVersion als xs:list,
// xs:restriction unter XS-Namespace).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { schreibeIds, xmlEscape } from '@ifc/lib/idsWriter.js';
import { evaluateIds } from '@ifc/lib/ids.js';

/** Handgebaute Elemente in der evaluateIds-Form (ids.js:9-12). */
const wandMitPrj = {
  globalId: '0WALL000000000000001',
  ifcType: 'IfcWallStandardCase',
  name: 'Wand mit PRJ',
  attributes: {},
  psets: { PRJ: { Material: 'STB', DIN276_Nummer: '342' } },
  classification: null,
  material: ['Beton'],
};
const wandOhnePrj = {
  globalId: '0WALL000000000000002',
  ifcType: 'IfcWallStandardCase',
  name: 'Wand ohne PRJ',
  attributes: {},
  psets: { Pset_WallCommon: { IsExternal: true } },
  classification: null,
  material: [],
};
const decke = {
  globalId: '0SLAB000000000000001',
  ifcType: 'IfcSlab',
  name: 'Decke',
  attributes: {},
  psets: { PRJ: { Material: 'STB' } },
  classification: null,
  material: [],
};

/** Minimale Spec: jede IFCWALL(STANDARDCASE) braucht PRJ.Material. */
function beispielSpecs() {
  return [{
    name: 'Wände tragen Material',
    identifier: 'LOI-Wand-LPH5',
    ifcVersions: ['IFC2X3', 'IFC4'],
    kardinalitaet: 'required',
    applicability: [{
      typ: 'entity',
      name: { art: 'restriction', base: 'xs:string', enumeration: ['IFCWALL', 'IFCWALLSTANDARDCASE'] },
      predefinedType: null,
    }],
    requirements: [{
      typ: 'property',
      propertySet: { art: 'simple', wert: 'PRJ' },
      baseName: { art: 'simple', wert: 'Material' },
      value: null,
      dataType: 'IFCLABEL',
      cardinality: 'required',
    }],
  }];
}

describe('idsWriter — XML-Form (String-Assertions, was ids.js liest)', () => {
  const { xml, warnungen } = schreibeIds(beispielSpecs(), {
    title: 'Rohbau PRJ', description: 'Test-IDS', author: 'BIT-Atelier', version: '1.0',
  });

  it('Namespaces wie in musterprojekt.ids + info-Block', () => {
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('xmlns="http://standards.buildingsmart.org/IDS"'));
    assert.ok(xml.includes('xmlns:xs="http://www.w3.org/2001/XMLSchema"'));
    assert.ok(xml.includes('<title>Rohbau PRJ</title>'));
    assert.ok(xml.includes('<author>BIT-Atelier</author>'));
    assert.equal(warnungen.length, 0);
  });

  it('specification mit name/identifier und ifcVersion als xs:list', () => {
    assert.ok(xml.includes('<specification name="Wände tragen Material"'));
    assert.ok(xml.includes('identifier="LOI-Wand-LPH5"'));
    // ids.js:293-295 splittet whitespace-separiert — exakte Form wichtig.
    assert.ok(xml.includes('ifcVersion="IFC2X3 IFC4"'));
  });

  it('applicability trägt minOccurs/maxOccurs (Spec-Kardinalität, ids.js:283-291)', () => {
    assert.ok(xml.includes('<applicability minOccurs="1" maxOccurs="unbounded">'));
  });

  it('entity-Facette mit xs:restriction/enumeration (XS-Namespace, ids.js:62)', () => {
    assert.ok(xml.includes('<xs:restriction base="xs:string">'));
    assert.ok(xml.includes('<xs:enumeration value="IFCWALL" />'));
    assert.ok(xml.includes('<xs:enumeration value="IFCWALLSTANDARDCASE" />'));
  });

  it('property-Facette mit dataType + simpleValue-Kindern', () => {
    assert.ok(xml.includes('<property dataType="IFCLABEL">'));
    assert.ok(xml.includes('<propertySet><simpleValue>PRJ</simpleValue></propertySet>'));
    assert.ok(xml.includes('<baseName><simpleValue>Material</simpleValue></baseName>'));
  });

  it('Escaping: & < > " \' werden ersetzt (T-71-01 XML-Injection)', () => {
    assert.equal(xmlEscape('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
    const boes = schreibeIds([{
      name: 'Spec <mit> "Injection" & \'mehr\'',
      ifcVersions: ['IFC4'],
      applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCWALL' } }],
      requirements: [],
    }]);
    assert.ok(!/<mit>/.test(boes.xml));
    assert.ok(boes.xml.includes('&lt;mit&gt;'));
  });

  it('Determinismus: gleiche Eingabe -> byte-gleiche Ausgabe (Drift-Schutz T-71-03)', () => {
    const a = schreibeIds(beispielSpecs(), { title: 'x' });
    const b = schreibeIds(beispielSpecs(), { title: 'x' });
    assert.equal(a.xml, b.xml);
  });

  it('leere Specs / Spec ohne name werfen lesbare Fehler', () => {
    assert.throws(() => schreibeIds([]), /keine Spezifikationen/);
    assert.throws(() => schreibeIds([{ ifcVersions: ['IFC4'] }]), /ohne name/);
  });

  it('partOf ist lese-only — werfen mit Begründung statt stiller Lücke', () => {
    assert.throws(
      () => schreibeIds([{
        name: 'x', ifcVersions: ['IFC4'],
        applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCWALL' } }],
        requirements: [{ typ: 'partOf', entity: null, cardinality: 'required' }],
      }]),
      /partOf ist Lese-only/,
    );
  });

  it('kardinalitaet optional/prohibited landet als minOccurs und cardinality-Attribut', () => {
    const optional = schreibeIds([{
      name: 'opt', ifcVersions: ['IFC4'], kardinalitaet: 'optional',
      applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCWALL' } }],
      requirements: [{ typ: 'property', propertySet: { art: 'simple', wert: 'PRJ' },
        baseName: { art: 'simple', wert: 'X' }, value: null, dataType: null, cardinality: 'optional' }],
    }]);
    assert.ok(optional.xml.includes('minOccurs="0" maxOccurs="unbounded"'));
    assert.ok(optional.xml.includes('cardinality="optional"'));

    const verboten = schreibeIds([{
      name: 'verboten', ifcVersions: ['IFC4'], kardinalitaet: 'prohibited',
      applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCWALL' } }],
      requirements: [],
    }]);
    assert.ok(verboten.xml.includes('minOccurs="0" maxOccurs="0"'));
  });
});

describe('idsWriter — Writer-Specs laufen direkt durch evaluateIds', () => {
  it('Wand mit PRJ.Material -> 0 Verletzungen, anwendbar = 2 Wände (nicht die Decke)', () => {
    const ergebnis = evaluateIds(beispielSpecs(), [wandMitPrj, wandOhnePrj, decke]);
    assert.equal(ergebnis.length, 1);
    assert.equal(ergebnis[0].anwendbar, 2);
    assert.equal(ergebnis[0].verletzungen.length, 1);
    // Die Verletzung nennt die GUID der Wand OHNE PRJ — genau der Wert, den der
    // ModelCheck-Mapping-Fix (Task 3) aus dem Import liefern muss.
    assert.equal(ergebnis[0].verletzungen[0].globalId, '0WALL000000000000002');
    assert.equal(ergebnis[0].verletzungen[0].facette, 'property');
  });

  it('alle Wände mit PRJ -> bestanden', () => {
    const ergebnis = evaluateIds(beispielSpecs(), [wandMitPrj, decke]);
    assert.equal(ergebnis[0].bestanden, true);
    assert.equal(ergebnis[0].verletzungen.length, 0);
  });

  it('dataType wird nur bei bekannten psetTypes geprüft (ids.js:517) — kein Fehlalarm', () => {
    const mitTyp = evaluateIds(beispielSpecs(), [{
      ...wandMitPrj, psetTypes: { PRJ: { Material: 'IFCLABEL' } },
    }]);
    assert.equal(mitTyp[0].bestanden, true);
    const falscherTyp = evaluateIds(beispielSpecs(), [{
      ...wandMitPrj, psetTypes: { PRJ: { Material: 'IFCTEXT' } },
    }]);
    // dataType greift konjunktiv: falscher Typ -> Verletzung.
    assert.equal(falscherTyp[0].verletzungen.length, 1);
  });
});
