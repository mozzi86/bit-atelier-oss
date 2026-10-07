// exportSchritte.test.js — Plan 80-05, Behavior 9 (separatPlan) and Behavior 9's
// unit half of vorschauZeilen (the browser half runs in p-05). A synthetic
// two-area registry [buchhaltung, personal(separat: ".bitpers")] stood in for
// the real EXPORT_BEREICHE, which at 80-05 still had only "buchhaltung" — this
// is how the plan proved the `separat` path works BEFORE 80-10 added the real
// Personal row. The last test of each describe block runs against the real
// registry. BEFUNDE-80 B-2 added passphraseGueltig()/PASSPHRASE_MINDESTLAENGE
// and a wiring test against the real EXPORT_BEREICHE — speicherDialoge.jsx's
// own SEPARAT_SCHRITTE (a JSX file) cannot be imported here without a JSX
// transform, so the wiring is proven with a synthetic step in bitpersSchritt's
// exact shape instead (the browser half — the real .bitpers download — runs in
// p-10-datenschutz.mjs).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { separatPlan, vorschauZeilen, passphraseGueltig, PASSPHRASE_MINDESTLAENGE } from '../../src/demo/exportSchritte.js';
import { exportOptionen } from '../../src/lib/exportBereiche.js';

/** @type {ReadonlyArray<import("../../src/lib/exportBereiche.js").ExportBereich>} */
const REGISTRY = Object.freeze([
  Object.freeze({ key: 'buchhaltung', label: 'Buchhaltung', entitaeten: ['Ausgangsrechnung'], settingKeys: ['buchhaltung'], separat: null }),
  Object.freeze({ key: 'personal', label: 'Personal', entitaeten: ['Mitarbeiter'], settingKeys: ['regel:personal'], separat: '.bitpers' }),
]);

describe('exportSchritte — separatPlan (Behavior 9)', () => {
  it('ein separat-Bereich ohne Schritt in SEPARAT_SCHRITTE landet in fehlend, nicht in aufrufe', () => {
    const optionen = exportOptionen(['buchhaltung', 'personal'], REGISTRY);
    const { aufrufe, fehlend } = separatPlan(optionen, REGISTRY, {}); // SEPARAT_SCHRITTE leer wie in 80-05
    assert.deepEqual(aufrufe, []);
    assert.equal(fehlend.length, 1);
    assert.equal(fehlend[0].key, 'personal');
    assert.equal(fehlend[0].separat, '.bitpers');
  });

  it('mit passendem Schritt landet der Bereich in aufrufe, fehlend bleibt leer', () => {
    const optionen = exportOptionen(['buchhaltung', 'personal'], REGISTRY);
    let aufgerufenMit = null;
    const schritte = { '.bitpers': async () => { aufgerufenMit = 'personal'; } };
    const { aufrufe, fehlend } = separatPlan(optionen, REGISTRY, schritte);
    assert.equal(fehlend.length, 0);
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].key, 'personal');
    // separatPlan only DECIDES — it never calls the step itself (the dialog does).
    assert.equal(aufgerufenMit, null);
  });

  it('ein NICHT angehaktes separat-Feld taucht gar nicht erst in optionen.separat auf', () => {
    const optionen = exportOptionen(['buchhaltung'], REGISTRY); // personal NICHT gewählt
    assert.deepEqual(optionen.separat, []);
    const { aufrufe, fehlend } = separatPlan(optionen, REGISTRY, {});
    assert.deepEqual(aufrufe, []);
    assert.deepEqual(fehlend, []);
  });

  it('ein separat-Bereich landet unabhängig vom Häkchen immer in ohne/ohneSettingKeys (E-14, 79-12-Vertrag, nur gelesen)', () => {
    const angehaktOptionen = exportOptionen(['buchhaltung', 'personal'], REGISTRY);
    assert.ok(angehaktOptionen.ohne.includes('Mitarbeiter'));
    assert.ok(angehaktOptionen.ohneSettingKeys.includes('regel:personal'));
    const nichtAngehaktOptionen = exportOptionen(['buchhaltung'], REGISTRY);
    assert.ok(nichtAngehaktOptionen.ohne.includes('Mitarbeiter'));
    assert.ok(nichtAngehaktOptionen.ohneSettingKeys.includes('regel:personal'));
  });

  // BEFUNDE-80 B-2: speicherDialoge.jsx wires SEPARAT_SCHRITTE['.bitpers'] to
  // PersonalSicherung.jsx's bitpersSchritt (a JSX file, so it cannot be
  // imported here without a JSX transform — see this file's header). This test
  // proves the WIRING CONTRACT against the real registry instead: a step
  // shaped exactly like bitpersSchritt (an async function taking
  // {personalZugang, passphrase}) lands in `aufrufe`, not `fehlend`, once it is
  // entered under the real ".bitpers" key — the part speicherDialoge.jsx itself
  // cannot get wrong without this test catching it.
  it('gegen die echte EXPORT_BEREICHE: ein ".bitpers"-Schritt in bitpersSchritt-Form landet in aufrufe (B-2 verdrahtet, nicht mehr immer fehlend)', async () => {
    const { EXPORT_BEREICHE, exportOptionen: exportOptionenEcht } = await import('../../src/lib/exportBereiche.js');
    const personal = EXPORT_BEREICHE.find((b) => b.key === 'personal');
    assert.equal(personal?.separat, '.bitpers');
    const optionen = exportOptionenEcht(['personal'], EXPORT_BEREICHE);
    let aufgerufenMit = null;
    const schritte = { '.bitpers': async ({ personalZugang, passphrase }) => { aufgerufenMit = { personalZugang, passphrase }; } };
    const { aufrufe, fehlend } = separatPlan(optionen, EXPORT_BEREICHE, schritte);
    assert.equal(fehlend.length, 0);
    assert.deepEqual(aufrufe.map((a) => a.key), ['personal']);
    // separatPlan only decides — it never calls the step itself (the dialog does).
    assert.equal(aufgerufenMit, null);
  });
});

describe('exportSchritte — passphraseGueltig / PASSPHRASE_MINDESTLAENGE (B-2)', () => {
  it('PASSPHRASE_MINDESTLAENGE ist 12 (dieselbe Grenze wie PersonalSicherung.jsx)', () => {
    assert.equal(PASSPHRASE_MINDESTLAENGE, 12);
  });

  it('zu kurz ist ungültig, genau die Mindestlänge ist gültig (ohne Bestätigungsfeld)', () => {
    assert.equal(passphraseGueltig('a'.repeat(PASSPHRASE_MINDESTLAENGE - 1)), false);
    assert.equal(passphraseGueltig('a'.repeat(PASSPHRASE_MINDESTLAENGE)), true);
  });

  it('leer, fehlend oder kein String ist ungültig', () => {
    assert.equal(passphraseGueltig(''), false);
    assert.equal(passphraseGueltig(undefined), false);
    assert.equal(passphraseGueltig(null), false);
    assert.equal(passphraseGueltig(123456789012), false);
  });

  it('mit Bestätigungsfeld muss sie exakt übereinstimmen', () => {
    const lang = 'richtig-langes-testpasswort';
    assert.equal(passphraseGueltig(lang, lang), true);
    assert.equal(passphraseGueltig(lang, lang + 'x'), false);
    assert.equal(passphraseGueltig(lang, ''), false);
  });
});

describe('exportSchritte — vorschauZeilen (Behavior 9)', () => {
  it('eine synthetische Registry [buchhaltung, personal(separat)] liefert 1 Bereichszeile und den Personal-Hinweis', () => {
    // Emuliert eine Weitergabe-Datei, die "buchhaltung" enthält (importOptionen().ersetzt).
    const importOpt = { ersetzt: ['buchhaltung'] };
    const { zeilen, separatHinweis } = vorschauZeilen(REGISTRY, importOpt);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].key, 'buchhaltung');
    assert.equal(zeilen[0].enthalten, true);
    assert.equal(separatHinweis, true);
  });

  it('ohne separat-Bereich in der Registry bleibt separatHinweis false', () => {
    const nurBuchhaltung = [REGISTRY[0]];
    const { zeilen, separatHinweis } = vorschauZeilen(nurBuchhaltung, { ersetzt: [] });
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].enthalten, false);
    assert.equal(separatHinweis, false);
  });

  // Since 80-10 the real registry carries the Personal row (separat ".bitpers"),
  // so the real registry now behaves like the synthetic one above: one line per
  // non-separat area (buchhaltung first) and the shared Personal hint.
  it('gegen die echte EXPORT_BEREICHE (Stand 80-10: buchhaltung + personal separat) liefert je Nicht-separat-Bereich eine Zeile und den Personal-Hinweis', async () => {
    const { EXPORT_BEREICHE, importOptionen } = await import('../../src/lib/exportBereiche.js');
    const personal = EXPORT_BEREICHE.find((b) => b.key === 'personal');
    assert.ok(personal, 'EXPORT_BEREICHE hat die Personal-Zeile (80-10)');
    assert.equal(personal.separat, '.bitpers');
    const opt = importOptionen({ daten: { Ausgangsrechnung: [] }, bereiche: ['buchhaltung'] });
    const { zeilen, separatHinweis } = vorschauZeilen(EXPORT_BEREICHE, opt);
    assert.deepEqual(zeilen.map((z) => z.key), EXPORT_BEREICHE.filter((b) => !b.separat).map((b) => b.key));
    assert.equal(zeilen[0].key, 'buchhaltung');
    assert.ok(!zeilen.some((z) => z.key === 'personal'), 'ein separat-Bereich bekommt nie eine eigene Vorschauzeile');
    assert.equal(separatHinweis, true);
  });
});
