// Phase 69-08: pure core of the IDS editor (idsEditorKern.js).
//
// The plan's Task-2 unit requirement ("Writer-Ausgabe einer Enumeration und
// eines Wertes, String-Assertions") is proven HERE against the specs the editor
// builds — the writer itself has its own suite (idsWriter.test.js, 71-01).
// Also covered: evaluateIds takes editor specs directly (no DOM detour), where
// the cardinality lands (property facet vs. specification), form validation,
// the JSON-safe storage form (RegExp patterns survive a reload), merging an
// upload (repeated names inside the file kept with a suffix), the IDS-conformant
// download (entity names UPPERCASE — review follow-up 69-08 —, partOf left out,
// no author, writer warnings translatable), and an English entry for every
// validation text (they reach t() through a variable, which the i18n guard
// test cannot see). The XML parse-back round trip needs a DOMParser Node does
// not have (repo pattern, idsWriter.test.js header) — it is proven headless
// in the browser: tmp-verify-69-08.mjs downloads the .ids, re-uploads it into
// the editor AND loads it through the page's IDS file picker.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  baueSpec, vorschlaegeAusModell, parseAufzaehlung, leereEingabe, pruefeEingabe,
  specAusEingabe, automatischerName, psetVorschlaege, propertyVorschlaege,
  regelZusammenfassung, specFuerSpeicher, specsFuerLauf, layerAusSpeicher,
  fuegeSpecsZusammen, schreibbareSpecs, leeresLayer, idsKlassenName, enumerationsWert,
  writerWarnungTeilen, WRITER_WARNUNGEN,
} from '@ifc/lib/idsEditorKern.js';
import { evaluateIds, xsdMusterZuRegExp } from '@ifc/lib/ids.js';
import { schreibeIds } from '@ifc/lib/idsWriter.js';

// The plan's showcase case: Pset_WallCommon.FireRating on the north wall of
// the sample project (must-have 2). Two walls, one WITHOUT FireRating.
const ELEMENTE = [
  {
    globalId: '0NorthWall000000000000', ifcType: 'IfcWall', name: 'Nordwand',
    psets: { Pset_WallCommon: { IsExternal: true } }, // FireRating missing → violation
  },
  {
    globalId: '0SouthWall0000000000', ifcType: 'IfcWall', name: 'Südwand',
    psets: { Pset_WallCommon: { IsExternal: true, FireRating: 'REI30' } },
  },
  {
    globalId: '0Slab0000000000000000', ifcType: 'IfcSlab', name: 'Decke',
    psets: { Pset_SlabCommon: { } },
  },
];

/**
 * Form state with overrides.
 * @param {Partial<ReturnType<typeof leereEingabe>>} teil
 */
const eingabe = (teil) => ({ ...leereEingabe(), ...teil });

describe('idsEditorKern — baueSpec', () => {
  it('Pflicht-Regel: entity + property ohne Wert; evaluateIds findet die Wand ohne FireRating', () => {
    const spec = baueSpec({
      name: 'Feuerwiderstand dokumentiert',
      klasse: 'IfcWall',
      pset: 'Pset_WallCommon',
      property: 'FireRating',
      wertArt: 'pflicht',
    });
    assert.equal(spec.eigen, true);
    assert.equal(spec.kardinalitaet, 'required');
    assert.equal(spec.applicability[0].typ, 'entity');
    assert.deepEqual(spec.applicability[0].name, { art: 'simple', wert: 'IFCWALL' }, 'IDS 1.0: entity UPPERCASE');
    assert.equal(spec.requirements[0].value, null, 'Pflicht = Existenzprüfung (value null)');
    assert.equal(spec.requirements[0].cardinality, 'required');

    const [r] = evaluateIds([spec], ELEMENTE);
    assert.equal(r.bestanden, false);
    assert.equal(r.anwendbar, 2, 'zwei Wände anwendbar, die Decke nicht');
    assert.equal(r.verletzungen.length, 1);
    assert.equal(r.verletzungen[0].globalId, '0NorthWall000000000000', 'Nordwand verletzt (Mapping-Fix 71-01: GlobalId dabei)');
  });

  it('Wert-Regel: FireRating = REI30 → Südwand besteht, Nordwand verletzt', () => {
    const spec = baueSpec({
      name: 'Feuerwiderstand REI30', klasse: 'IfcWall',
      pset: 'Pset_WallCommon', property: 'FireRating',
      wertArt: 'wert', wert: 'REI30',
    });
    assert.deepEqual(spec.requirements[0].value, { art: 'simple', wert: 'REI30' });
    const [r] = evaluateIds([spec], ELEMENTE);
    assert.equal(r.bestanden, false);
    assert.equal(r.verletzungen.length, 1);
    assert.equal(r.verletzungen[0].globalId, '0NorthWall000000000000');
  });

  it('Aufzählungs-Regel: FireRating ∈ {REI30, REI60} → Writer schreibt xs:enumeration, der Wert landet als simpleValue', () => {
    const spec = baueSpec({
      name: 'Feuerwiderstand Klasse', klasse: 'IfcWall',
      pset: 'Pset_WallCommon', property: 'FireRating',
      wertArt: 'aufzaehlung', aufzaehlung: ['REI30', 'REI60'],
    });
    assert.equal(spec.requirements[0].value.art, 'restriction');
    assert.deepEqual(spec.requirements[0].value.enumeration, ['REI30', 'REI60']);

    // Writer string assertions (plan Task 2): the enumeration lands as
    // xs:restriction + xs:enumeration, the simple value as simpleValue.
    const { xml } = schreibeIds([spec], { title: 'T' });
    assert.ok(xml.includes('<xs:restriction base="xs:string">'), xml);
    assert.ok(xml.includes('<xs:enumeration value="REI30" />'), xml);
    assert.ok(xml.includes('<xs:enumeration value="REI60" />'));
    assert.ok(xml.includes('<baseName><simpleValue>FireRating</simpleValue></baseName>'));
    assert.ok(xml.includes('name="Feuerwiderstand Klasse"'));

    const simpleSpec = baueSpec({
      name: 'Wert', klasse: 'IfcWall', pset: 'Pset_WallCommon',
      property: 'FireRating', wertArt: 'wert', wert: 'REI30',
    });
    const { xml: xml2 } = schreibeIds([simpleSpec], { title: 'T' });
    assert.ok(xml2.includes('<value><simpleValue>REI30</simpleValue></value>'));
    assert.equal(xml2.includes('enumeration'), false);
  });

  it('Kardinalität mit Eigenschaft sitzt an der property-Facette: prohibited → die Wand MIT FireRating verletzt, die Spec bleibt required', () => {
    const spec = baueSpec({
      name: 'Kein FireRating', klasse: 'IfcWall', pset: 'Pset_WallCommon',
      property: 'FireRating', kardinalitaet: 'prohibited', wertArt: 'pflicht',
    });
    assert.equal(spec.kardinalitaet, 'required', 'Spec required — sonst hieße prohibited „keine Wand erlaubt“ (WIP-Fehler)');
    assert.equal(spec.requirements[0].cardinality, 'prohibited');
    const [r] = evaluateIds([spec], ELEMENTE);
    assert.equal(r.anwendbar, 2);
    assert.deepEqual(r.verletzungen.map((v) => v.globalId), ['0SouthWall0000000000']);

    const { xml } = schreibeIds([spec], { title: 'T' });
    assert.ok(xml.includes('<property cardinality="prohibited">'), xml);
    assert.ok(xml.includes('<applicability minOccurs="1" maxOccurs="unbounded">'));
  });

  it('optional mit Wert: nur geprüft, wo die Eigenschaft vorhanden ist', () => {
    const elemente = [
      ...ELEMENTE,
      { globalId: '0WestWall000000000000', ifcType: 'IfcWall', name: 'Westwand', psets: { Pset_WallCommon: { FireRating: 'F90' } } },
    ];
    const spec = baueSpec({
      name: 'REI30 wo angegeben', klasse: 'IfcWall', pset: 'Pset_WallCommon',
      property: 'FireRating', kardinalitaet: 'optional', wertArt: 'wert', wert: 'REI30',
    });
    const [r] = evaluateIds([spec], elemente);
    assert.deepEqual(r.verletzungen.map((v) => v.globalId), ['0WestWall000000000000'], 'Nordwand (ohne FireRating) ist ok, Westwand (F90) nicht');
  });

  it('prohibited ohne Eigenschaft landet auf der Spec (Verbotsprüfung der Klasse)', () => {
    const spec = baueSpec({ name: 'Kein X', klasse: 'IfcSlab', kardinalitaet: 'prohibited', wertArt: 'pflicht' });
    assert.equal(spec.kardinalitaet, 'prohibited');
    const [r] = evaluateIds([spec], ELEMENTE);
    assert.equal(r.bestanden, false, 'die Decke existiert → Verbot verletzt');
    assert.equal(r.verletzungen.length, 1);
  });

  it('Klasse ohne Pset/Property → reine Existenz-Regel (applicability only)', () => {
    const spec = baueSpec({ name: 'Es gibt Wände', klasse: 'IfcWall', wertArt: 'pflicht' });
    assert.deepEqual(spec.requirements, []);
    const [r] = evaluateIds([spec], ELEMENTE);
    assert.equal(r.bestanden, true, 'Wände vorhanden → required erfüllt');
    assert.equal(r.anwendbar, 2);
  });

  it('Klasse, die das Modell nicht enthält, fällt auf (Tippfehler wird sichtbar statt still bestanden)', () => {
    const spec = baueSpec({ name: 'Tippfehler', klasse: 'IfcWal', pset: 'Pset_WallCommon', property: 'FireRating', wertArt: 'pflicht' });
    const [r] = evaluateIds([spec], ELEMENTE);
    assert.equal(r.bestanden, false);
    assert.equal(r.verletzungen[0].erwartet, 'mind. 1 anwendbares Element');
  });
});

describe('idsEditorKern — Writer-Ausgabe (String-Assertions, Plan Task 2)', () => {
  it('schreibeIds akzeptiert Editor-Specs unverändert — XML trägt Facetten korrekt', () => {
    const spec = baueSpec({
      name: 'Feuerwiderstand dokumentiert', klasse: 'IfcWall',
      pset: 'Pset_WallCommon', property: 'FireRating', wertArt: 'pflicht',
    });
    // Same info as IdsEditor passes: title only. ids.xsd allows only an e-mail
    // as author and orders version BEFORE author — title + version is valid.
    const { xml, warnungen } = schreibeIds([spec], { title: 'Eigene Prüfregeln' });
    assert.equal(xml.includes('<author>'), false);
    assert.match(xml, /<info>\s*<title>Eigene Prüfregeln<\/title>\s*<version>1\.0<\/version>\s*<\/info>/);
    assert.ok(xml.includes('<entity>'));
    // IDS 1.0 UserManual + test case "entities must be specified as uppercase
    // strings": IfcTester does not match "IfcWall" (review 69-08, blocking).
    assert.ok(xml.includes('<name><simpleValue>IFCWALL</simpleValue></name>'), xml);
    assert.equal(xml.includes('<simpleValue>IfcWall</simpleValue>'), false);
    assert.ok(xml.includes('<propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet>'));
    assert.ok(xml.includes('<baseName><simpleValue>FireRating</simpleValue></baseName>'));
    assert.ok(xml.includes('<property>'), 'required-Facette ohne cardinality-Attribut');
    assert.ok(xml.includes('minOccurs="1" maxOccurs="unbounded"'), 'required-Kardinalität der Spec');
    assert.equal(xml.includes('eigen'), false, 'die Editor-Marke gehört nicht in die Datei');
    assert.deepEqual(warnungen, []);
  });

  it('automatische Namen passieren die Namensprüfung des Writers ohne Warnung', () => {
    const faelle = [
      eingabe({ klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating' }),
      eingabe({ klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating', wertArt: 'wert', wert: 'REI30' }),
      eingabe({ klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating', wertArt: 'aufzaehlung', aufzaehlung: 'REI30; REI60', kardinalitaet: 'optional' }),
      eingabe({ klasse: 'IfcSlab', kardinalitaet: 'prohibited' }),
    ];
    const specs = faelle.map((e) => specAusEingabe(e).spec);
    const { warnungen } = schreibeIds(specs, { title: 'T' });
    assert.deepEqual(warnungen, []);
  });
});

describe('idsEditorKern — Validierung (pruefeEingabe / specAusEingabe)', () => {
  const felder = (e, namen) => pruefeEingabe(e, namen).map((f) => f.feld);

  it('leeres Formular: die Klasse fehlt', () => {
    assert.deepEqual(felder(leereEingabe()), ['klasse']);
  });

  it('Klasse muss ein IFC-Typ sein (Groß-/Kleinschreibung egal)', () => {
    assert.deepEqual(felder(eingabe({ klasse: 'Wand' })), ['klasse']);
    assert.deepEqual(felder(eingabe({ klasse: 'IFCWALL' })), []);
    assert.deepEqual(felder(eingabe({ klasse: '  IfcWall  ' })), []);
  });

  it('jede Schreibweise der Klasse landet groß in der Entity-Facette und trifft weiter die web-ifc-Klasse IfcWall', () => {
    for (const k of ['IfcWall', 'ifcwall', ' IFCWALL ', 'IfcWALL']) {
      const { spec } = specAusEingabe(eingabe({ klasse: k, pset: 'Pset_WallCommon', property: 'FireRating' }));
      assert.deepEqual(spec.applicability[0].name, { art: 'simple', wert: 'IFCWALL' }, k);
      const [r] = evaluateIds([spec], ELEMENTE);
      assert.equal(r.anwendbar, 2, `${k}: beide Wände (ifcType „IfcWall“) anwendbar`);
    }
    assert.equal(idsKlassenName(' IfcDuctSegment '), 'IFCDUCTSEGMENT');
    assert.equal(idsKlassenName(null), '');
  });

  it('Property-Set und Eigenschaft nur zusammen', () => {
    assert.deepEqual(felder(eingabe({ klasse: 'IfcWall', pset: 'Pset_WallCommon' })), ['property']);
    assert.deepEqual(felder(eingabe({ klasse: 'IfcWall', property: 'FireRating' })), ['pset']);
  });

  it('Wert und Aufzählung brauchen eine Eigenschaft und einen Inhalt', () => {
    assert.deepEqual(felder(eingabe({ klasse: 'IfcWall', wertArt: 'wert', wert: 'REI30' })), ['pset']);
    const mitProp = { klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating' };
    assert.deepEqual(felder(eingabe({ ...mitProp, wertArt: 'wert', wert: '   ' })), ['wert'], 'leerer Wert wäre still eine Existenzprüfung (WIP-Fehler)');
    assert.deepEqual(felder(eingabe({ ...mitProp, wertArt: 'aufzaehlung', aufzaehlung: 'REI30' })), ['aufzaehlung']);
    assert.deepEqual(felder(eingabe({ ...mitProp, wertArt: 'aufzaehlung', aufzaehlung: 'REI30; REI30' })), ['aufzaehlung'], 'Dubletten zählen einmal');
    assert.deepEqual(felder(eingabe({ ...mitProp, wertArt: 'aufzaehlung', aufzaehlung: 'REI30; REI60' })), []);
  });

  it('„optional“ ohne zu prüfenden Wert wird abgelehnt (kann nie verletzt werden)', () => {
    assert.deepEqual(felder(eingabe({ klasse: 'IfcWall', kardinalitaet: 'optional' })), ['kardinalitaet']);
    const mitProp = { klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating', kardinalitaet: 'optional' };
    assert.deepEqual(felder(eingabe(mitProp)), ['kardinalitaet']);
    assert.deepEqual(felder(eingabe({ ...mitProp, wertArt: 'wert', wert: 'REI30' })), []);
    assert.deepEqual(felder(eingabe({ klasse: 'IfcWall', kardinalitaet: 'prohibited' })), []);
    // Proof that the rejected rule really is a no-op in evaluateIds.
    const noop = baueSpec({ name: 'n', klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating', kardinalitaet: 'optional', wertArt: 'pflicht' });
    assert.equal(evaluateIds([noop], ELEMENTE)[0].bestanden, true);
  });

  it('Namensdubletten (auch automatisch gebildete, ohne Groß-/Kleinschreibung) werden abgelehnt', () => {
    const e = eingabe({ klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating' });
    assert.deepEqual(felder(e, ['IFCWALL PSET_WALLCOMMON.FIRERATING']), ['name']);
    assert.deepEqual(felder({ ...e, name: 'Brandschutz' }, ['brandschutz ']), ['name']);
    assert.deepEqual(felder({ ...e, name: 'Brandschutz 2' }, ['Brandschutz']), []);
  });

  it('mehrere Fehler auf einmal, in Feldreihenfolge (die Komponente fokussiert den ersten)', () => {
    assert.deepEqual(felder(eingabe({ klasse: 'Wand', property: 'FireRating', wertArt: 'wert' })), ['klasse', 'pset', 'wert']);
  });

  it('specAusEingabe: gültig → Spec mit getrimmten Werten und automatischem Namen; ungültig → keine Spec', () => {
    const { spec, fehler } = specAusEingabe(eingabe({
      klasse: ' IfcWall ', pset: ' Pset_WallCommon ', property: ' FireRating ',
      wertArt: 'aufzaehlung', aufzaehlung: 'REI30; REI60 ;REI90',
    }));
    assert.deepEqual(fehler, []);
    assert.equal(spec.name, 'IfcWall Pset_WallCommon.FireRating (REI30/REI60/REI90)', 'der Name zeigt die Klasse wie getippt');
    assert.deepEqual(spec.applicability[0].name, { art: 'simple', wert: 'IFCWALL' }, 'die Facette trägt sie groß');
    assert.deepEqual(spec.requirements[0].propertySet, { art: 'simple', wert: 'Pset_WallCommon' }, 'Pset bleibt case-sensitiv');
    assert.deepEqual(spec.requirements[0].baseName, { art: 'simple', wert: 'FireRating' }, 'Property bleibt case-sensitiv');
    assert.deepEqual(spec.requirements[0].value.enumeration, ['REI30', 'REI60', 'REI90']);

    const falsch = specAusEingabe(eingabe({ klasse: '' }));
    assert.equal(falsch.spec, null);
    assert.equal(falsch.fehler.length, 1);
  });

  it('automatischerName deckt Klasse, Wert, Liste und Kardinalität ab', () => {
    assert.equal(automatischerName(eingabe({ klasse: 'IfcSlab', kardinalitaet: 'prohibited' })), 'IfcSlab (prohibited)');
    assert.equal(automatischerName(eingabe({ klasse: 'IfcWall', pset: 'P', property: 'X', wertArt: 'wert', wert: 'A' })), 'IfcWall P.X (A)');
    assert.equal(automatischerName(eingabe({ klasse: 'IfcWall', pset: 'P', property: 'X', kardinalitaet: 'optional' })), 'IfcWall P.X [optional]');
  });

  it('jeder Validierungstext hat einen englischen Eintrag in DICT.en', () => {
    const quelle = fs.readFileSync(new URL('../../packages/nova-core/src/lib/i18n.jsx', import.meta.url), 'utf8');
    const faelle = [
      leereEingabe(),
      eingabe({ klasse: 'Wand' }),
      eingabe({ klasse: 'IfcWall', pset: 'P' }),
      eingabe({ klasse: 'IfcWall', property: 'X' }),
      eingabe({ klasse: 'IfcWall', wertArt: 'wert' }),
      eingabe({ klasse: 'IfcWall', pset: 'P', property: 'X', wertArt: 'wert' }),
      eingabe({ klasse: 'IfcWall', pset: 'P', property: 'X', wertArt: 'aufzaehlung' }),
      eingabe({ klasse: 'IfcWall', kardinalitaet: 'optional' }),
    ];
    const texte = new Set(faelle.flatMap((e) => pruefeEingabe(e).map((f) => f.text)));
    for (const t of pruefeEingabe(eingabe({ klasse: 'IfcWall', name: 'N' }), ['N'])) texte.add(t.text);
    assert.equal(texte.size, 9, 'alle neun Meldungen erzeugt');
    const fehlt = [...texte].filter((t) => !quelle.includes(`${JSON.stringify(t)}:`));
    assert.deepEqual(fehlt, []);
  });
});

describe('idsEditorKern — Vorschläge aus dem Modell', () => {
  it('Klassen sortiert, Psets/Properties je Klasse(+Pset), Klasse in beliebiger Schreibweise', () => {
    const v = vorschlaegeAusModell(ELEMENTE);
    assert.deepEqual(v.klassen, ['IfcSlab', 'IfcWall']);
    assert.deepEqual(psetVorschlaege(v, 'IfcWall'), ['Pset_WallCommon']);
    assert.deepEqual(psetVorschlaege(v, 'IFCWALL'), ['Pset_WallCommon']);
    assert.deepEqual(propertyVorschlaege(v, 'ifcwall', 'Pset_WallCommon'), ['FireRating', 'IsExternal']);
  });

  it('unbekannte oder leere Klasse bietet alle Psets des Modells; unbekanntes Pset keine Properties', () => {
    const v = vorschlaegeAusModell(ELEMENTE);
    assert.deepEqual(psetVorschlaege(v, ''), ['Pset_SlabCommon', 'Pset_WallCommon']);
    assert.deepEqual(psetVorschlaege(v, 'IfcDoor'), ['Pset_SlabCommon', 'Pset_WallCommon']);
    assert.deepEqual(propertyVorschlaege(v, 'IfcWall', 'Pset_Gibtsnicht'), []);
  });

  it('Elemente ohne ifcType/psets werden übersprungen; leere Eingabe → leere Listen', () => {
    const v = vorschlaegeAusModell([{ name: 'x' }, null, { ifcType: 'IfcDoor' }]);
    assert.deepEqual(v.klassen, ['IfcDoor']);
    assert.deepEqual(vorschlaegeAusModell([]).klassen, []);
    assert.deepEqual(vorschlaegeAusModell(null).klassen, []);
  });
});

describe('idsEditorKern — parseAufzaehlung', () => {
  it('Semikolon trennt; ohne Semikolon trennt das Komma; Leerraum und Leeres fallen weg', () => {
    assert.deepEqual(parseAufzaehlung('REI30; REI60;REI90'), ['REI30', 'REI60', 'REI90']);
    assert.deepEqual(parseAufzaehlung('A, B ,, C'), ['A', 'B', 'C']);
    assert.deepEqual(parseAufzaehlung(''), []);
    assert.deepEqual(parseAufzaehlung(null), []);
  });

  it('deutsche Dezimalzahlen bleiben ganz, sobald ein Semikolon trennt; Dubletten einmal', () => {
    assert.deepEqual(parseAufzaehlung('0,24; 0,30; 0,24'), ['0,24', '0,30']);
  });
});

describe('idsEditorKern — Zusammenfassung für die Regelliste', () => {
  it('Eigenschaft, Wert, Liste, Klasse allein', () => {
    const e = { klasse: 'IfcWall', pset: 'Pset_WallCommon', property: 'FireRating' };
    assert.deepEqual(regelZusammenfassung(specAusEingabe(eingabe(e)).spec), {
      klasse: 'IFCWALL', pset: 'Pset_WallCommon', property: 'FireRating', erwartung: 'vorhanden',
      werte: [], kardinalitaet: 'required', weitere: 0,
    });
    const liste = regelZusammenfassung(specAusEingabe(eingabe({ ...e, wertArt: 'aufzaehlung', aufzaehlung: 'A; B', kardinalitaet: 'optional' })).spec);
    assert.equal(liste.erwartung, 'liste');
    assert.deepEqual(liste.werte, ['A', 'B']);
    assert.equal(liste.kardinalitaet, 'optional', 'Kardinalität der Facette, nicht der Spec');
    const klasse = regelZusammenfassung(specAusEingabe(eingabe({ klasse: 'IfcSlab', kardinalitaet: 'prohibited' })).spec);
    assert.equal(klasse.property, null);
    assert.equal(klasse.kardinalitaet, 'prohibited');
  });

  it('hochgeladene Spec mit Muster und weiteren Facetten', () => {
    const spec = {
      name: 'U', applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCDOOR' } }],
      requirements: [
        { typ: 'property', propertySet: { art: 'simple', wert: 'P' }, baseName: { art: 'simple', wert: 'X' },
          value: { art: 'restriction', patternQuelle: 'F\\d+', pattern: null, enumeration: null }, cardinality: 'required' },
        { typ: 'material', value: null, cardinality: 'required' },
      ],
    };
    const z = regelZusammenfassung(spec);
    assert.equal(z.erwartung, 'muster');
    assert.deepEqual(z.werte, ['F\\d+']);
    assert.equal(z.weitere, 1);
  });
});

describe('idsEditorKern — Speicherform (pruefung_layer)', () => {
  /** A spec as parseIdsXml delivers it: pattern restriction WITH compiled RegExp. */
  const musterSpec = () => ({
    name: 'Feuerwiderstand F-Klasse', identifier: null, beschreibung: null, hinweise: null,
    ifcVersions: ['IFC4'], kardinalitaet: 'required',
    applicability: [{ typ: 'entity', name: { art: 'simple', wert: 'IFCWALL' }, predefinedType: null }],
    requirements: [{
      typ: 'property', dataType: null, cardinality: 'required',
      propertySet: { art: 'simple', wert: 'Pset_WallCommon' },
      baseName: { art: 'simple', wert: 'FireRating' },
      value: {
        art: 'restriction', base: 'xs:string', pattern: /^(?:F\d+)$/, patternQuelle: 'F\\d+',
        patternFehler: null, enumeration: null, bounds: null, length: null,
      },
    }],
  });
  const elemente = [
    { globalId: 'A', ifcType: 'IfcWall', name: 'a', psets: { Pset_WallCommon: { FireRating: 'F90' } } },
    { globalId: 'B', ifcType: 'IfcWall', name: 'b', psets: { Pset_WallCommon: { FireRating: 'REI30' } } },
  ];

  it('ohne Speicherform zerstört JSON das Muster — evaluateIds stürzt nach dem Reload ab (der verhinderte Fehler)', () => {
    const roh = JSON.parse(JSON.stringify([musterSpec()]));
    assert.deepEqual(roh[0].requirements[0].value.pattern, {}, 'RegExp wird in JSON zu {}');
    assert.throws(() => evaluateIds(roh, elemente), TypeError);
  });

  it('specFuerSpeicher → JSON → specsFuerLauf: das Muster wirkt wieder (B verletzt, A besteht)', () => {
    const gespeichert = specFuerSpeicher(musterSpec());
    assert.equal(gespeichert.requirements[0].value.pattern, null);
    assert.equal(gespeichert.requirements[0].value.patternQuelle, 'F\\d+');
    assert.equal(gespeichert.eigen, true);
    const nachReload = JSON.parse(JSON.stringify(layerAusSpeicher({ eigene_specs: [gespeichert] })));
    const [r] = evaluateIds(specsFuerLauf(nachReload.eigene_specs), elemente);
    assert.deepEqual(r.verletzungen.map((v) => v.globalId), ['B']);
  });

  it('ein in JS unübersetzbares XSD-Muster wird zur Begründung, nicht zum Absturz', () => {
    assert.equal(xsdMusterZuRegExp('[a-z').pattern, null);
    assert.match(xsdMusterZuRegExp('[a-z').patternFehler, /nicht in JS-RegExp uebersetzbar/);
    const spec = specFuerSpeicher(musterSpec());
    spec.requirements[0].value.patternQuelle = '[a-z';
    const [lauf] = specsFuerLauf([spec]);
    assert.ok(lauf.requirements[0].value.patternFehler);
    const [r] = evaluateIds([lauf], elemente);
    assert.equal(r.verletzungen.length, 2, 'nicht erfüllbar statt stillem Bestehen');
  });

  it('layerAusSpeicher: null → leer; namenlose Einträge fallen weg; fremde Schlüssel bleiben; alles eigen', () => {
    assert.deepEqual(layerAusSpeicher(null), leeresLayer());
    assert.deepEqual(layerAusSpeicher({ eigene_specs: 'kaputt' }), leeresLayer());
    const l = layerAusSpeicher({ version: 2, eigene_specs: [{ name: '' }, null, { name: 'X' }] });
    assert.equal(l.version, 2);
    assert.equal(l.eigene_specs.length, 1);
    assert.deepEqual(
      { name: l.eigene_specs[0].name, eigen: l.eigene_specs[0].eigen, kard: l.eigene_specs[0].kardinalitaet, app: l.eigene_specs[0].applicability },
      { name: 'X', eigen: true, kard: 'required', app: [] },
    );
  });
});

describe('idsEditorKern — Upload zusammenführen und Download vorbereiten', () => {
  it('gleichnamige Regeln werden ersetzt (ohne Groß-/Kleinschreibung), neue angehängt, nichts geht verloren', () => {
    const alt = [{ name: 'A', v: 1 }, { name: 'B', v: 1 }];
    const { specs, ersetzt, hinzu } = fuegeSpecsZusammen(alt, [{ name: 'b', v: 2 }, { name: 'C', v: 2 }]);
    assert.deepEqual(specs.map((s) => `${s.name}${s.v}`), ['A1', 'b2', 'C2']);
    assert.equal(ersetzt, 1);
    assert.equal(hinzu, 1);
    assert.deepEqual(alt.map((s) => s.name), ['A', 'B'], 'Eingabe unverändert');
  });

  it('gleichnamige Specs INNERHALB der Datei bleiben alle erhalten (Suffix), „ersetzt“ zählt nur vorhandene Regeln', () => {
    // Review 69-08: 2 in, 1 kept, ersetzt=1 — IDS verlangt keine eindeutigen Namen.
    const zwei = fuegeSpecsZusammen([], [{ name: 'X', v: 1 }, { name: 'X', v: 2 }]);
    assert.deepEqual(zwei.specs.map((s) => `${s.name}=${s.v}`), ['X=1', 'X (2)=2']);
    assert.deepEqual({ ersetzt: zwei.ersetzt, hinzu: zwei.hinzu, umbenannt: zwei.umbenannt }, { ersetzt: 0, hinzu: 2, umbenannt: ['X (2)'] });

    // The suffix skips names the file itself uses; only B replaces an existing rule.
    const datei = [{ name: 'A', v: 1 }, { name: 'a ', v: 2 }, { name: 'A (2)', v: 3 }, { name: 'B', v: 4 }];
    const erst = fuegeSpecsZusammen([{ name: 'B', v: 0 }, { name: 'Hand', v: 0 }], datei);
    assert.deepEqual(erst.specs.map((s) => `${s.name}=${s.v}`), ['B=4', 'Hand=0', 'A=1', 'a (3)=2', 'A (2)=3']);
    assert.deepEqual({ ersetzt: erst.ersetzt, hinzu: erst.hinzu, umbenannt: erst.umbenannt }, { ersetzt: 1, hinzu: 3, umbenannt: ['a (3)'] });
    assert.equal(datei[1].name, 'a ', 'Eingabe unverändert');

    // Stable suffix: the same file again replaces all of them, no copies.
    const zweit = fuegeSpecsZusammen(erst.specs, datei);
    assert.deepEqual(zweit.specs.map((s) => s.name), erst.specs.map((s) => s.name));
    assert.deepEqual({ ersetzt: zweit.ersetzt, hinzu: zweit.hinzu }, { ersetzt: 4, hinzu: 0 });
  });

  it('Download schreibt Entity-Namen groß — auch alt gespeicherte oder fremd hochgeladene Regeln; Muster bleiben unangetastet', () => {
    const alt = baueSpec({ name: 'Alt', klasse: 'IfcWall', wertArt: 'pflicht' });
    alt.applicability = [{ typ: 'entity', name: { art: 'simple', wert: 'IfcWall' }, predefinedType: null }]; // storage form before the fix
    const liste = { name: 'Liste', ifcVersions: ['IFC4'], requirements: [],
      applicability: [{ typ: 'entity', name: enumerationsWert(['IfcWall', 'IfcSlab']), predefinedType: null }] };
    const muster = { name: 'Muster', ifcVersions: ['IFC4'], requirements: [],
      applicability: [{ typ: 'entity', predefinedType: null, name: {
        art: 'restriction', base: 'xs:string', enumeration: null, pattern: null, patternQuelle: 'Ifc\\w+', bounds: null, length: null,
      } }] };
    const { specs } = schreibbareSpecs([alt, liste, muster]);
    const { xml } = schreibeIds(specs, { title: 'T' });
    assert.ok(xml.includes('<name><simpleValue>IFCWALL</simpleValue></name>'), xml);
    assert.ok(xml.includes('<xs:enumeration value="IFCWALL" />') && xml.includes('<xs:enumeration value="IFCSLAB" />'));
    assert.ok(xml.includes('<xs:pattern value="Ifc\\w+" />'), 'Muster unverändert (\\w groß wäre \\W)');
    assert.equal(xml.includes('IfcWall'), false);
    assert.equal(alt.applicability[0].name.wert, 'IfcWall', 'Eingabe unverändert');
  });

  it('Writer-Warnungen: der feste Leittext wird zum i18n-Schlüssel (mit EN-Eintrag), der Rest bleibt', () => {
    const spec = baueSpec({ name: 'Brandschutz?', klasse: 'IfcWall', wertArt: 'pflicht' });
    const { warnungen } = schreibeIds([spec], { title: 'T' });
    const teile = warnungen.map(writerWarnungTeilen);
    assert.deepEqual(teile, [{ schluessel: WRITER_WARNUNGEN[0], rest: '„Brandschutz?“' }]);
    assert.deepEqual(writerWarnungTeilen('etwas anderes'), { schluessel: null, rest: 'etwas anderes' });
    const quelle = fs.readFileSync(new URL('../../packages/nova-core/src/lib/i18n.jsx', import.meta.url), 'utf8');
    assert.deepEqual(WRITER_WARNUNGEN.filter((k) => !quelle.includes(`${JSON.stringify(k)}:`)), []);
  });

  it('partOf fällt aus dem Download heraus und wird benannt — der Writer wirft sonst', () => {
    const spec = {
      ...baueSpec({ name: 'Mit partOf', klasse: 'IfcWall', pset: 'P', property: 'X', wertArt: 'pflicht' }),
    };
    spec.requirements = [...spec.requirements, { typ: 'partOf', entity: { name: { art: 'simple', wert: 'IFCBUILDINGSTOREY' } }, relation: null, cardinality: 'required' }];
    assert.throws(() => schreibeIds([spec], { title: 'T' }), /partOf/);
    const ohne = baueSpec({ name: 'Ohne', klasse: 'IfcSlab', wertArt: 'pflicht' });
    const { specs, ohnePartOf } = schreibbareSpecs([spec, ohne]);
    assert.deepEqual(ohnePartOf, ['Mit partOf']);
    assert.equal(specs[0].requirements.length, 1);
    assert.equal(spec.requirements.length, 2, 'Eingabe unverändert (die Regel bleibt für den Lauf vollständig)');
    const { xml } = schreibeIds(specs, { title: 'T' });
    assert.ok(xml.includes('name="Mit partOf"') && xml.includes('name="Ohne"'));
  });
});
