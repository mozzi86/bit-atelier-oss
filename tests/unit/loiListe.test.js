// Phase 71-01: loiListe.js — der LOI-CSV-Parser und die Spec-Ableitung.
// Testbasis ist ein 94-Zeilen-Auszug der echten LOI-Tabelle des
// Referenzprojekts (Blätter: Fassade aktiv, Wand aktiv, Deckenbekleidung
// inactive). Der Auszug ist Kundenmaterial und liegt seit Plan 83-01 im
// NDA-Archiv (tools/nda.mjs, Schlüssel `loiAuszug`); ohne BIT_NDA_DIR laufen
// nur die Zerlegungs-Tests mit Inline-Daten, die Auszug-Blöcke werden übersprungen.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  parseCsvSemikolon, klassenAusListe, psetNormiert, parseLoiCsv, loiZuSpezifikationen,
} from '@ifc/lib/loiListe.js';
import { NDA_FEHLT, ndaPfad, ndaWert } from '../../tools/nda.mjs';

const FIXTURE = ndaPfad('loiAuszug');
const csv = FIXTURE ? fs.readFileSync(FIXTURE, 'utf8') : null;
// Pset prefix of the client's property scheme — a project value, not code.
const P = ndaWert('loiPset');

describe('loiListe — CSV-Zerlegung', () => {
  it('BOM und CRLF werden geschluckt, Quotes mit Semikolon im Feld bleiben ganz', () => {
    const zeilen = parseCsvSemikolon('\uFEFFa;b\r\n"true;false";c\n');
    assert.deepEqual(zeilen, [['a', 'b'], ['true;false', 'c']]);
  });

  it('die drei Trenner-Varianten der Klassenliste (71-RESEARCH §5)', () => {
    assert.deepEqual(klassenAusListe('IfcMember IfcPlate'), ['IfcMember', 'IfcPlate']);
    assert.deepEqual(klassenAusListe('IfcWall; IfcWallStandardCase'), ['IfcWall', 'IfcWallStandardCase']);
    assert.deepEqual(klassenAusListe('IfcStair, IfcStairFlight'), ['IfcStair', 'IfcStairFlight']);
    // Rauschen (Leerzellen etc.) fällt weg, nur Ifc*-Namen zählen.
    assert.deepEqual(klassenAusListe('IfcDoor;;;'), ['IfcDoor']);
  });

  it('Pset-Sonderfall „RG:BaseQuantities/BG:PRJ" -> RG-Teil + mehrdeutig', () => {
    assert.deepEqual(psetNormiert('RG:BaseQuantities/BG:PRJ'),
      { pset: 'BaseQuantities', mehrdeutig: true });
    assert.deepEqual(psetNormiert('BaseQuantities/PRJ'),
      { pset: 'BaseQuantities', mehrdeutig: true });
    assert.deepEqual(psetNormiert('PRJ'), { pset: 'PRJ', mehrdeutig: false });
  });
});

describe('loiListe — parseLoiCsv am echten Auszug (NDA-Archiv)', { skip: NDA_FEHLT }, () => {
  const loi = parseLoiCsv(csv);

  it('drei Blätter, active/inactive korrekt', () => {
    assert.deepEqual(loi.blaetter.map((b) => [b.name, b.aktiv]), [
      ['Fassade', true], ['Wand', true], ['Deckenbekleidung', false],
    ]);
  });

  it('ifcTypen je Blatt aus Zeile 2', () => {
    const fassade = loi.blaetter[0];
    const wand = loi.blaetter[1];
    assert.deepEqual(fassade.ifcTypen, ['IfcMember', 'IfcPlate']);
    assert.deepEqual(wand.ifcTypen, ['IfcWall', 'IfcWallStandardCase']);
  });

  it('Merkmale: Quellen attribution — automatisch+GlobalId = attribut, SiteName = nicht_pruefbar', () => {
    const wand = loi.blaetter[1];
    const globalId = wand.merkmale.find((m) => m.variable === 'GlobalId');
    assert.equal(globalId.quelle, 'attribut');
    assert.deepEqual(globalId.lph, { 2: true, 3: true, 5: true, 8: true });

    const siteName = wand.merkmale.find((m) => m.variable === 'SiteName');
    assert.equal(siteName.quelle, 'nicht_pruefbar');
  });

  it('BaseQuantities = qto, Projekt-Pset/Pset_* = pset', () => {
    const wand = loi.blaetter[1];
    assert.equal(wand.merkmale.find((m) => m.variable === 'Length').quelle, 'qto');
    assert.equal(wand.merkmale.find((m) => m.variable === 'Material').quelle, 'pset');
    assert.equal(wand.merkmale.find((m) => m.pset === 'Pset_WallCommon').quelle, 'pset');
  });

  it('LPH-Spalten stimmen mit der Quelle überein (Wand: Feuerwiderstandsklasse ab LPH3, U-Wert nur LPH8)', () => {
    const wand = loi.blaetter[1];
    const fwk = wand.merkmale.find((m) => m.variable === 'Feuerwiderstandsklasse');
    assert.deepEqual(fwk.lph, { 2: false, 3: true, 5: true, 8: true });
    const uWert = wand.merkmale.find((m) => m.variable === 'ThermalTransmittance');
    assert.deepEqual(uWert.lph, { 2: false, 3: false, 5: false, 8: true });
  });

  it('Legenden-Zeilen am Blattende werden nicht zu Merkmalen', () => {
    const wand = loi.blaetter[1];
    assert.ok(!wand.merkmale.some((m) => m.merkmal === 'Legende'));
    assert.ok(!wand.merkmale.some((m) => m.merkmal === 'Ortsbezug'));
  });
});

describe('loiListe — loiZuSpezifikationen (NDA-Archiv)', { skip: NDA_FEHLT }, () => {
  it('LPH5-Default: Wand hat GlobalId-Attribut + Pflicht-Psets, keine LPH8-only-Merkmale', () => {
    const loi = parseLoiCsv(csv);
    const { spezifikationen } = loiZuSpezifikationen(loi, { blaetter: ['Wand'] });
    assert.equal(spezifikationen.length, 1);
    const wand = spezifikationen[0];

    // Entity-Facette: enumeration UPPERCASE (D-P71-02).
    const entity = wand.applicability[0];
    assert.equal(entity.typ, 'entity');
    assert.deepEqual(entity.name.enumeration, ['IFCWALL', 'IFCWALLSTANDARDCASE']);

    const namen = wand.requirements.map((r) => (r.typ === 'attribute'
      ? r.name.wert : `${r.propertySet.wert}.${r.baseName.wert}`));
    assert.ok(namen.includes('GlobalId'));
    assert.ok(namen.includes(`${P}.Material`));
    assert.ok(namen.includes(`${P}.Feuerwiderstandsklasse`));         // ab LPH3 -> auch LPH5
    assert.ok(namen.includes('BaseQuantities.Length'));
    assert.ok(!namen.includes('Pset_WallCommon.ThermalTransmittance')); // nur LPH8
    assert.ok(!namen.includes(`${P}.Lebensdauer`));                    // nur LPH8

    // dataType UPPERCASE aus Spalte J.
    const material = wand.requirements.find((r) => r.baseName?.wert === 'Material');
    assert.equal(material.dataType, 'IFCLABEL');
  });

  it('Herkunft der Beschreibung: neutraler Default, projektbezogen nur vom Aufrufer', () => {
    // The module ships to customer mirrors and must not name a project; the
    // Monorepo-only generator (tools/loi-zu-ids.mjs) passes the real provenance.
    const loi = parseLoiCsv(csv);
    const neutral = loiZuSpezifikationen(loi, { blaetter: ['Wand'] }).spezifikationen[0];
    assert.match(neutral.beschreibung, /^LOI-Tabelle, Blatt „Wand"/);
    const mitQuelle = loiZuSpezifikationen(loi, { blaetter: ['Wand'], quelle: 'Merkmalliste XY (Stand 01.01.2026)' }).spezifikationen[0];
    assert.match(mitQuelle.beschreibung, /^Merkmalliste XY \(Stand 01\.01\.2026\), Blatt „Wand"/);
  });

  it('LPH8 ergänzt die Wartungsmerkmale', () => {
    const loi = parseLoiCsv(csv);
    const { spezifikationen } = loiZuSpezifikationen(loi, { lph: 8, blaetter: ['Wand'] });
    const namen = spezifikationen[0].requirements.map((r) => (r.typ === 'attribute'
      ? r.name.wert : `${r.propertySet.wert}.${r.baseName.wert}`));
    assert.ok(namen.includes('Pset_WallCommon.ThermalTransmittance'));
    assert.ok(namen.includes(`${P}.Lebensdauer`));
  });

  it('inactive-Blätter erzeugen keine Spezifikation; Filter wirkt', () => {
    const loi = parseLoiCsv(csv);
    const ohneFilter = loiZuSpezifikationen(loi);
    assert.deepEqual(ohneFilter.spezifikationen.map((s) => s.name), ['Fassade', 'Wand']);
  });

  it('nicht_pruefbar: SiteName/BuildingName/StoreyName mit Grund, nicht in der Spec', () => {
    const loi = parseLoiCsv(csv);
    const { nichtPruefbar, spezifikationen } = loiZuSpezifikationen(loi, { blaetter: ['Wand'] });
    const namen = nichtPruefbar.filter((n) => n.blatt === 'Wand').map((n) => n.merkmal);
    assert.deepEqual(namen, ['Liegenschafts ID', 'Gebäude ID', 'Geschoss ID']);
    assert.ok(nichtPruefbar.every((n) => n.grund.includes('partOf')));
    // Und nichts davon in den Requirements:
    for (const r of spezifikationen[0].requirements) {
      assert.ok(!['SiteName', 'BuildingName', 'BuildingStoreyName']
        .includes(r.baseName?.wert || r.name?.wert));
    }
  });

  it('Beispielwerte (Spalte G) werden KEINE Restriktionen — value bleibt null', () => {
    const loi = parseLoiCsv(csv);
    const { spezifikationen } = loiZuSpezifikationen(loi, { blaetter: ['Wand'] });
    assert.ok(spezifikationen[0].requirements.every((r) => r.value === null));
  });

  it('Determinismus: zweimal dieselbe Ausgabe (JSON-Vergleich)', () => {
    const loi = parseLoiCsv(csv);
    const a = loiZuSpezifikationen(loi, { blaetter: ['Wand'] });
    const b = loiZuSpezifikationen(loi, { blaetter: ['Wand'] });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});
