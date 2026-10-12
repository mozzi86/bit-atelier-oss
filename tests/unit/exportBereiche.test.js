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
import { ZEIT_HONORAR_ENTITAETEN, ZEIT_HONORAR_SETTING_KEYS } from '@/lib/zeitHonorar/entitaeten.js';
import { BUERO_ORGA_EXPORT_BEREICHE, BUERO_ORGA_ENTITAETEN } from '@/lib/bueroOrga/entitaeten.js';
import { FRISTEN_REGELN } from '@/lib/termine/fristenRegeln.js';
import { KALENDER_REGELN } from '@/lib/abwesenheit/kalenderRegeln.js';

// 82-01: the three rows of phase 82, in registry order.
const E82 = BUERO_ORGA_EXPORT_BEREICHE.flatMap((b) => b.entitaeten);
const S82 = BUERO_ORGA_EXPORT_BEREICHE.flatMap((b) => b.settingKeys);
const K82 = BUERO_ORGA_EXPORT_BEREICHE.map((b) => b.key);
import { englischePaareAlle } from './helpers/woerterbuch.mjs';

describe('EXPORT_BEREICHE — Registry (79-12 + 80-10)', () => {
  // 80-10: registry-allgemein statt "genau ein Eintrag" (Task 7b) — die
  // Schlüsselliste ist jetzt ['buchhaltung', 'personal'], die Buchhaltungszeile
  // selbst bleibt unverändert.
  // 81-06: Zeile zeiten — die Schlüsselliste ist jetzt ['buchhaltung', 'personal', 'zeiten'].
  // 82-01: drei Zeilen der Phase 82 angehängt.
  it('Schlüsselliste ["buchhaltung", "personal", "zeiten", "fristen", "schriftverkehr", "rechte"]; die Buchhaltungszeile unverändert', () => {
    assert.deepEqual(EXPORT_BEREICHE.map((b) => b.key), ['buchhaltung', 'personal', 'zeiten', 'fristen', 'schriftverkehr', 'rechte']);
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

  // 81-06: Zeile zeiten (E-07) — die 81-Sammlungen, Marker plus regel:zeit_honorar.*, nicht separat.
  it('die Zeile "zeiten" trägt ZEIT_HONORAR_ENTITAETEN und ZEIT_HONORAR_SETTING_KEYS, separat null', () => {
    const zeiten = EXPORT_BEREICHE.find((b) => b.key === 'zeiten');
    assert.equal(zeiten.label, 'Zeiten & Aufträge');
    assert.strictEqual(zeiten.entitaeten, ZEIT_HONORAR_ENTITAETEN);
    assert.strictEqual(zeiten.settingKeys, ZEIT_HONORAR_SETTING_KEYS);
    assert.ok(zeiten.settingKeys.includes('zeit_honorar'));
    assert.ok(zeiten.settingKeys.includes('regel:zeit_honorar.gemeinkosten'));
    assert.equal(zeiten.separat, null);
    assert.ok(!zeiten.entitaeten.includes('Honorarvertrag') && !zeiten.entitaeten.includes('Kostensatz'));
  });

  it('jedes label hat einen englischen Wörterbucheintrag', () => {
    const en = new Set(englischePaareAlle().map(([k]) => k));
    for (const bereich of EXPORT_BEREICHE) {
      assert.ok(en.has(bereich.label), `„${bereich.label}“ hat keinen EN-Eintrag (i18n.jsx oder i18nTeile/)`);
    }
  });
});

describe('exportOptionen — die reale Registry', () => {
  // 81-06: Zeile zeiten — "alle Bereiche" sind jetzt drei.
  it('nichts gewählt → weitergabe, ohne = alle Sammlungen aller Bereiche, ohneSettingKeys, bereiche leer', () => {
    const opt = exportOptionen([]);
    assert.equal(opt.art, 'weitergabe');
    assert.deepEqual([...opt.ohne].sort(), [...BUCHHALTUNG_ENTITAETEN, ...PERSONAL_EXPORT_BEREICH.entitaeten, ...ZEIT_HONORAR_ENTITAETEN, ...E82].sort());
    assert.deepEqual(opt.ohneSettingKeys, [SETTING_KEY, ...PERSONAL_EXPORT_BEREICH.settingKeys, ...ZEIT_HONORAR_SETTING_KEYS, ...S82]);
    assert.deepEqual(opt.bereiche, []);
    assert.deepEqual(opt.separat, []);
  });

  // 80-10 (E-18): exportOptionen(["buchhaltung"]) → weitergabe (Personal fehlt weiterhin).
  it('nur „buchhaltung“ gewählt → weitergabe (Personal ist nicht gewählt)', () => {
    const opt = exportOptionen(['buchhaltung']);
    assert.equal(opt.art, 'weitergabe');
    assert.deepEqual(opt.bereiche, ['buchhaltung']);
    assert.deepEqual(opt.ohne, [...PERSONAL_EXPORT_BEREICH.entitaeten, ...ZEIT_HONORAR_ENTITAETEN, ...E82]); // 81-06/82-01: zeiten und 82 nicht gewählt
    assert.deepEqual(opt.separat, []);
  });

  // 81-06: „buchhaltung“ + „personal“ ist ohne „zeiten“ nur noch eine weitergabe.
  it('„buchhaltung“ + „personal“ gewählt → weitergabe, solange „zeiten“ fehlt; separat: ["personal"]', () => {
    const opt = exportOptionen(['buchhaltung', 'personal']);
    assert.equal(opt.art, 'weitergabe');
    assert.deepEqual(opt.ohne, [...PERSONAL_EXPORT_BEREICH.entitaeten, ...ZEIT_HONORAR_ENTITAETEN, ...E82]);
    assert.deepEqual(opt.ohneSettingKeys, [...PERSONAL_EXPORT_BEREICH.settingKeys, ...ZEIT_HONORAR_SETTING_KEYS, ...S82]);
    assert.deepEqual(opt.separat, ['personal']);
  });

  // 80-10 (E-18), seit 81-06 mit allen drei Häkchen: sicherung, Personal bleibt in `ohne` UND wandert nach `separat`.
  it('alle Registry-Schlüssel gewählt → sicherung, separat: ["personal"], ohneSettingKeys enthält alle Personal-settingKeys', () => {
    const opt = exportOptionen(EXPORT_BEREICHE.map((b) => b.key));
    assert.equal(opt.art, 'sicherung');
    assert.deepEqual(opt.ohne, [...PERSONAL_EXPORT_BEREICH.entitaeten]); // E-14: nie in der .bitproj, auch angehakt
    assert.deepEqual(opt.ohneSettingKeys, [...PERSONAL_EXPORT_BEREICH.settingKeys]);
    assert.deepEqual(opt.bereiche, ['buchhaltung', 'zeiten', ...K82]); // separat-Bereiche nicht in `bereiche`
    assert.deepEqual(opt.separat, ['personal']);
    assert.ok(!opt.ohneSettingKeys.includes('buero_orga'), '82-01: marker travels with all three rows');
  });
});

// 82-01 (E-07): the three rows of phase 82.
describe('EXPORT_BEREICHE — Zeilen der Phase 82', () => {
  it('fristen, schriftverkehr, rechte mit Entitäten, Marker und Regel-Overrides', () => {
    const [fristen, schrift, rechte] = BUERO_ORGA_EXPORT_BEREICHE;
    assert.deepEqual([...fristen.entitaeten], ['Termin', 'Terminquittung', 'Abnahme']);
    assert.deepEqual([...schrift.entitaeten], ['Schreiben', 'Briefvorlage', 'Postbucheintrag']);
    assert.deepEqual([...rechte.entitaeten], ['Nutzer']);
    assert.deepEqual([...fristen.settingKeys].sort(), ['buero_orga', ...[...FRISTEN_REGELN, ...KALENDER_REGELN].map((r) => 'regel:' + r.id)].sort());
    assert.deepEqual([...schrift.settingKeys], ['buero_orga']);
    assert.deepEqual([...rechte.settingKeys], ['rechte', 'buero_orga']);
    for (const b of BUERO_ORGA_EXPORT_BEREICHE) assert.equal(b.separat, null);
    assert.deepEqual([...E82].sort(), [...BUERO_ORGA_ENTITAETEN].sort(), 'alle sieben Sammlungen');
  });
  it('kein Häkchen → alle sieben 82-Sammlungen, rechte, Marker und Regeln bleiben im Büro; nur zwei der drei → Marker bleibt', () => {
    const opt = exportOptionen([]);
    for (const e of BUERO_ORGA_ENTITAETEN) assert.ok(opt.ohne.includes(e), e);
    for (const k of ['rechte', 'buero_orga', 'regel:fristen.vorlauf_frist_tage', 'regel:kalender.bundesland']) assert.ok(opt.ohneSettingKeys.includes(k), k);
    assert.ok(exportOptionen(['fristen', 'schriftverkehr']).ohneSettingKeys.includes('buero_orga'));
  });
  it('Import einer Datei ohne 82-Sammlungen behält alle sieben, rechte und den Marker', () => {
    const opt = importOptionen({ daten: { Project: [] } });
    for (const e of BUERO_ORGA_ENTITAETEN) assert.ok(opt.behalte.includes(e), e);
    assert.ok(opt.behalteSettingKeys.includes('rechte'));
    assert.ok(opt.behalteSettingKeys.includes('buero_orga'));
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

  it('Datei mit den Buchhaltungs-Sammlungen (auch leer) → buchhaltung ersetzt, personal und zeiten bleiben lokal (E-14: Personal ist ohnehin nie in der .bitproj)', () => {
    const daten = { Project: [{ id: 'p1' }] };
    for (const e of BUCHHALTUNG_ENTITAETEN) daten[e] = [];
    const opt = importOptionen({ daten, bereiche: ['buchhaltung'] });
    assert.deepEqual(opt.ersetzt, ['buchhaltung']);
    // 81-06: die 81-Sammlungen fehlen in der Datei → sie bleiben lokal.
    assert.deepEqual(opt.behalte, [...PERSONAL_EXPORT_BEREICH.entitaeten, ...ZEIT_HONORAR_ENTITAETEN, ...E82]);
    assert.deepEqual(opt.behalten, ['personal', 'zeiten', ...K82]);
  });

  it('alte Datei (kein art, keine Bereichs-Sammlungen — Stand vor Phase 79) behält alle Bücher', () => {
    const obj = { schema: 1, app: 'bit-atelier-demo', daten: { Project: [{ id: 'p1' }], Contact: [] } };
    const opt = importOptionen(obj);
    assert.deepEqual(opt.behalten, EXPORT_BEREICHE.map((b) => b.key));
    assert.equal(opt.behalte.length, ALLE_ENTITAETEN_ANZAHL);
  });
});
