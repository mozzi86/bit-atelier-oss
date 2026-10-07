// personalSeed.test.js — the fictional demo seed itself (Plan 80-02 Task 3):
// personalSeedVerschieben() shifts every date by "heute − Bezug" days (pure,
// no storage), and the seed's CONTENT matches 80-RESEARCH § Seed and the
// Kontrollrechnungen exactly — including the link to the 79 seed's owner
// (bsp-g1 "Inhaberin A"), which this test imports DIRECTLY (79-01 is a
// dependency of this plan per E-08).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { personalSeedVerschieben, PERSONAL_SEED_BEZUG } from '@core/api/personalDb.js';
import { EINTRITT_SCHLUESSEL } from '@core/api/personalEntitaeten.js';
import { beispielDatensaetze } from '@/lib/accounting/beispielDaten.js';

// ESLint's parser does not yet accept import-attribute syntax ("with { type:
// 'json' }") — read + parse instead, same pattern as projektneutral.test.js.
const REPO = path.resolve(import.meta.dirname, '../..');
const personalSeed = JSON.parse(
  fs.readFileSync(path.join(REPO, 'packages/nova-core/src/api/personalSeed.json'), 'utf8')
);

describe('personalSeedVerschieben — Datumsverschiebung (rein)', () => {
  it('heute === Bezug (2026-09-27) → Seed unverändert (deepEqual)', () => {
    const verschoben = personalSeedVerschieben(personalSeed, PERSONAL_SEED_BEZUG);
    assert.deepEqual(verschoben, personalSeed);
  });

  it('heute = 2026-10-07 (10 Tage später): P-003 eintritt, V-003-Dauer, B-1 entscheidung.am', () => {
    const verschoben = personalSeedVerschieben(personalSeed, '2026-10-07');

    const p003 = verschoben.Mitarbeiter.find((m) => m.id === 'P-003');
    assert.equal(p003.eintritt, '2026-05-01');

    const v003 = verschoben.Arbeitsvertrag.find((v) => v.id === 'V-003');
    const tageZwischenBeginnUndEnde = Math.round(
      (Date.parse(v003.ende) - Date.parse(v003.beginn)) / 86_400_000
    );
    assert.equal(tageZwischenBeginnUndEnde, 730, 'die Vertragsdauer bleibt unter der Verschiebung invariant');

    const b1 = verschoben.Bewerbung.find((b) => b.id === 'B-1');
    assert.equal(b1.entscheidung.am, '2026-03-25');
  });
});

describe('Personal-Seed — Inhalt (Bezug 2026-09-27, 80-RESEARCH § Seed)', () => {
  it('4 Mitarbeiter: P-001 (inhaber, gesellschafter_id bsp-g1), P-003, P-004, P-005 (onboarding, Eintritt 2026-11-02)', () => {
    assert.deepEqual(personalSeed.Mitarbeiter.map((m) => m.id), ['P-001', 'P-003', 'P-004', 'P-005']);
    const inhaber = personalSeed.Mitarbeiter.filter((m) => m.art === 'inhaber');
    assert.equal(inhaber.length, 1);
    assert.equal(inhaber[0].id, 'P-001');
    assert.equal(inhaber[0].gesellschafter_id, 'bsp-g1');
    assert.equal(personalSeed.Mitarbeiter.filter((m) => m.art === 'gesellschafter').length, 0);
    const onboarding = personalSeed.Mitarbeiter.filter((m) => m.status === 'onboarding');
    assert.equal(onboarding.length, 1);
    assert.equal(onboarding[0].id, 'P-005');
    assert.equal(onboarding[0].eintritt, '2026-11-02');
  });

  it('3 Verträge (keiner für P-001), 3 Gehaltsänderungen, 2 Stellen, 4 Bewerbungen, 1 Personalvorgang', () => {
    assert.equal(personalSeed.Arbeitsvertrag.length, 3);
    assert.ok(!personalSeed.Arbeitsvertrag.some((v) => v.mitarbeiter_id === 'P-001'));
    assert.equal(personalSeed.Gehaltsaenderung.length, 3);
    assert.equal(personalSeed.Stelle.length, 2);
    assert.equal(personalSeed.Bewerbung.length, 4);
    assert.equal(personalSeed.Personalvorgang.length, 1);
    assert.deepEqual(personalSeed.Personaldokument, []);
    assert.deepEqual(personalSeed.Fristquittung, []);
    assert.deepEqual(personalSeed.Loeschprotokoll, []);
  });

  it('Abgleich mit 79: beispielDatensaetze(...).Gesellschafter hat genau einen Eintrag = P-001s gesellschafter_id, rolle "inhaber", Name = vorname+nachname', () => {
    const p001 = personalSeed.Mitarbeiter.find((m) => m.id === 'P-001');
    const { Gesellschafter } = beispielDatensaetze('2026-09-27');
    assert.equal(Gesellschafter.length, 1);
    const [g] = Gesellschafter;
    assert.equal(g.id, p001.gesellschafter_id);
    assert.equal(g.rolle, 'inhaber');
    assert.equal(g.name, `${p001.vorname} ${p001.nachname}`);
  });

  it('PV-005: 13 Schritte, davon 5 mit erledigt_am; alle Schlüssel ⊆ EINTRITT_SCHLUESSEL; fehlend = rv_befreiung, kammer_haftpflicht, nachweis_beschaeftigungsart', () => {
    const pv = personalSeed.Personalvorgang.find((p) => p.id === 'PV-005');
    assert.equal(pv.schritte.length, 13);
    assert.equal(pv.schritte.filter((s) => s.erledigt_am).length, 5);
    const schluessel = pv.schritte.map((s) => s.schluessel);
    assert.ok(schluessel.every((s) => EINTRITT_SCHLUESSEL.includes(s)));
    const fehlend = EINTRITT_SCHLUESSEL.filter((s) => !schluessel.includes(s));
    assert.deepEqual(fehlend.sort(), ['kammer_haftpflicht', 'nachweis_beschaeftigungsart', 'rv_befreiung']);
  });
});
