// 79-12 (E-07): the export-dialog registry and its pure option functions.
// Pins the <behavior> block of 79-12-PLAN.md — the numbers here (13 entities,
// which keys move where) are the actual contract projektDatei.js/demoDb.js
// build on, not illustration.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_BEREICHE,
  exportOptionen,
  bereicheInDatei,
  importOptionen,
} from '@/lib/exportBereiche.js';
import { BUCHHALTUNG_ENTITAETEN, SETTING_KEY } from '@/lib/accounting/datenmodell.js';
import { PERSONAL_EXPORT_BEREICH } from '@/lib/people/exportBereich.js';
import { englischePaareAlle } from './helpers/woerterbuch.mjs';

describe('EXPORT_BEREICHE — Registry (79-12 + 80-10)', () => {
  // 80-10: registry-allgemein statt "genau ein Eintrag" (Task 7b) — die
  // Schlüsselliste ist jetzt ['buchhaltung', 'personal'], die Buchhaltungszeile
  // selbst bleibt unverändert.
  it('Schlüsselliste ["buchhaltung", "personal"]; die Buchhaltungszeile unverändert', () => {
    assert.deepEqual(EXPORT_BEREICHE.map((b) => b.key), ['buchhaltung', 'personal']);
    const buchhaltung = EXPORT_BEREICHE.find((b) => b.key === 'buchhaltung');
    assert.equal(buchhaltung.entitaeten.length, 13);
    assert.deepEqual([...buchhaltung.entitaeten].sort(), [...BUCHHALTUNG_ENTITAETEN].sort());
    assert.deepEqual(buchhaltung.settingKeys, [SETTING_KEY]);
    assert.equal(buchhaltung.separat, null);
  });

  it('die Zeile "Personal" ist genau PERSONAL_EXPORT_BEREICH, separat ".bitpers", settingKeys ⊇ die HR-Regel-Overrides und die zwei Personal-Settings', () => {
    const personal = EXPORT_BEREICHE.find((b) => b.key === 'personal');
    assert.strictEqual(personal, PERSONAL_EXPORT_BEREICH);
    assert.equal(personal.separat, '.bitpers');
    assert.ok(personal.settingKeys.includes('regel:personal.urlaub_buero_standard'));
    assert.ok(personal.settingKeys.includes('personal.vorlagen'));
    assert.ok(personal.settingKeys.includes('personal.zaehlkarte'));
  });

  it('jedes label hat einen englischen Wörterbucheintrag', () => {
    const en = new Set(englischePaareAlle().map(([k]) => k));
    for (const bereich of EXPORT_BEREICHE) {
      assert.ok(en.has(bereich.label), `„${bereich.label}“ hat keinen EN-Eintrag (i18n.jsx oder i18nTeile/)`);
    }
  });
});

describe('exportOptionen — die reale Registry', () => {
  it('nichts gewählt → weitergabe, ohne = alle Sammlungen beider Bereiche, ohneSettingKeys, bereiche leer', () => {
    const opt = exportOptionen([]);
    assert.equal(opt.art, 'weitergabe');
    assert.deepEqual([...opt.ohne].sort(), [...BUCHHALTUNG_ENTITAETEN, ...PERSONAL_EXPORT_BEREICH.entitaeten].sort());
    assert.deepEqual(opt.ohneSettingKeys, [SETTING_KEY, ...PERSONAL_EXPORT_BEREICH.settingKeys]);
    assert.deepEqual(opt.bereiche, []);
    assert.deepEqual(opt.separat, []);
  });

  // 80-10 (E-18): exportOptionen(["buchhaltung"]) → weitergabe (Personal fehlt weiterhin).
  it('nur „buchhaltung“ gewählt → weitergabe (Personal ist nicht gewählt)', () => {
    const opt = exportOptionen(['buchhaltung']);
    assert.equal(opt.art, 'weitergabe');
    assert.deepEqual(opt.bereiche, ['buchhaltung']);
    assert.deepEqual(opt.ohne, [...PERSONAL_EXPORT_BEREICH.entitaeten]);
    assert.deepEqual(opt.separat, []);
  });

  // 80-10 (E-18): beide gewählt → sicherung, Personal bleibt in `ohne` UND wandert nach `separat`.
  it('„buchhaltung“ + „personal“ gewählt → sicherung, separat: ["personal"], ohneSettingKeys enthält alle Personal-settingKeys', () => {
    const opt = exportOptionen(['buchhaltung', 'personal']);
    assert.equal(opt.art, 'sicherung');
    assert.deepEqual(opt.ohne, [...PERSONAL_EXPORT_BEREICH.entitaeten]); // E-14: nie in der .bitproj, auch angehakt
    assert.deepEqual(opt.ohneSettingKeys, [...PERSONAL_EXPORT_BEREICH.settingKeys]);
    assert.deepEqual(opt.bereiche, ['buchhaltung']); // separat-Bereiche nicht in `bereiche`
    assert.deepEqual(opt.separat, ['personal']);
  });
});

describe('exportOptionen — synthetische Registry mit separat-Bereich (E-14)', () => {
  const REGISTRY = Object.freeze([
    Object.freeze({ key: 'buchhaltung', label: 'Buchhaltung', entitaeten: ['A', 'B'], settingKeys: ['buchhaltung'], separat: null }),
    Object.freeze({ key: 'zeiten', label: 'Zeiten', entitaeten: ['Zeitbuchung'], settingKeys: [], separat: null }),
    Object.freeze({ key: 'personal', label: 'Personal', entitaeten: ['Mitarbeiter', 'Gehalt'], settingKeys: ['personal'], separat: '.bitpers' }),
  ]);

  it('nur buchhaltung → weitergabe', () => {
    assert.equal(exportOptionen(['buchhaltung'], REGISTRY).art, 'weitergabe');
  });

  it('buchhaltung + zeiten (personal fehlt) → weitergabe', () => {
    const opt = exportOptionen(['buchhaltung', 'zeiten'], REGISTRY);
    assert.equal(opt.art, 'weitergabe');
    assert.deepEqual(opt.bereiche, ['buchhaltung', 'zeiten']);
  });

  it('alle drei gewählt → sicherung, aber Personal bleibt in `ohne` und wandert nach `separat`', () => {
    const opt = exportOptionen(['buchhaltung', 'zeiten', 'personal'], REGISTRY);
    assert.equal(opt.art, 'sicherung');
    assert.deepEqual(opt.ohne, ['Mitarbeiter', 'Gehalt']); // E-14: nie in der .bitproj
    assert.deepEqual(opt.ohneSettingKeys, ['personal']);
    assert.deepEqual(opt.bereiche, ['buchhaltung', 'zeiten']); // separat-Bereiche nicht in `bereiche`
    assert.deepEqual(opt.separat, ['personal']);
  });

  it('Personal nicht gewählt → weiterhin in `ohne`, aber nicht in `separat`', () => {
    const opt = exportOptionen(['buchhaltung', 'zeiten'], REGISTRY);
    assert.deepEqual(opt.ohne, ['Mitarbeiter', 'Gehalt']);
    assert.deepEqual(opt.separat, []);
  });
});

describe('bereicheInDatei — präsenzbasiert', () => {
  it('Sammlungen als Schlüssel vorhanden (auch leer) → Bereich gilt als enthalten', () => {
    const obj = { daten: { Honorarvertrag: [], Ausgangsrechnung: [] } };
    const REG = [{ key: 'x', label: 'X', entitaeten: ['Honorarvertrag', 'Ausgangsrechnung'], settingKeys: [], separat: null }];
    assert.deepEqual(bereicheInDatei(obj, REG), ['x']);
  });

  it('Sammlungen fehlen komplett → Bereich gilt als nicht enthalten', () => {
    const obj = { daten: { Project: [{ id: 'p1' }] } };
    const REG = [{ key: 'x', label: 'X', entitaeten: ['Honorarvertrag'], settingKeys: [], separat: null }];
    assert.deepEqual(bereicheInDatei(obj, REG), []);
  });

  it('obj.bereiche nennt den Schlüssel auch ohne (leere) Sammlungen', () => {
    const obj = { daten: {}, bereiche: ['x'] };
    const REG = [{ key: 'x', label: 'X', entitaeten: ['Honorarvertrag'], settingKeys: [], separat: null }];
    assert.deepEqual(bereicheInDatei(obj, REG), ['x']);
  });
});

describe('importOptionen — die reale Registry', () => {
  // 80-10: registry-allgemein (Task 7b, ":131") — behalte.length ist die Summe
  // der entitaeten ALLER Bereiche, die die Datei nicht enthält, nicht mehr die
  // feste Zahl 13 (jetzt buchhaltung + personal).
  const ALLE_ENTITAETEN_ANZAHL = EXPORT_BEREICHE.reduce((n, b) => n + b.entitaeten.length, 0);

  it('Datei ohne jede Bereichs-Sammlung → behalte = alle Sammlungen aller Bereiche, behalteSettingKeys, behalten = alle Schlüssel', () => {
    const obj = { daten: { Project: [{ id: 'p1' }] } };
    const opt = importOptionen(obj);
    const alleEntitaeten = EXPORT_BEREICHE.flatMap((b) => b.entitaeten);
    const alleSettingKeys = EXPORT_BEREICHE.flatMap((b) => b.settingKeys);
    assert.deepEqual([...opt.behalte].sort(), [...alleEntitaeten].sort());
    assert.deepEqual([...opt.behalteSettingKeys].sort(), [...alleSettingKeys].sort());
    assert.deepEqual(opt.ersetzt, []);
    assert.deepEqual(opt.behalten, EXPORT_BEREICHE.map((b) => b.key));
    assert.equal(opt.behalte.length, ALLE_ENTITAETEN_ANZAHL);
  });

  it('Datei mit den Buchhaltungs-Sammlungen (auch leer) → buchhaltung ersetzt, personal bleibt lokal (E-14: Personal ist ohnehin nie in der .bitproj)', () => {
    const daten = { Project: [{ id: 'p1' }] };
    for (const e of BUCHHALTUNG_ENTITAETEN) daten[e] = [];
    const opt = importOptionen({ daten, bereiche: ['buchhaltung'] });
    assert.deepEqual(opt.ersetzt, ['buchhaltung']);
    assert.deepEqual(opt.behalte, [...PERSONAL_EXPORT_BEREICH.entitaeten]);
    assert.deepEqual(opt.behalten, ['personal']);
  });

  it('alte Datei (kein art, keine Bereichs-Sammlungen — Stand vor Phase 79) behält alle Bücher', () => {
    const obj = { schema: 1, app: 'bit-atelier-demo', daten: { Project: [{ id: 'p1' }], Contact: [] } };
    const opt = importOptionen(obj);
    assert.deepEqual(opt.behalten, EXPORT_BEREICHE.map((b) => b.key));
    assert.equal(opt.behalte.length, ALLE_ENTITAETEN_ANZAHL);
  });
});
