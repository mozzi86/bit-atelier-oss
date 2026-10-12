// 74-01 Task 14: which controls the office sees per tender phase
// (@ava/lib/vergabeZugriff.js), and that the panel stays invisible without
// access separation (today's live schema).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fristAusEingabe, vergabeAktionen, vergabePhase, zuschlagWeg } from '@ava/lib/vergabeZugriff';

const JETZT = new Date('2026-10-12T12:00:00Z');
const LAEUFT = { frist: '2026-10-13T12:00:00Z', geoeffnet_am: null };
const ABGELAUFEN = { frist: '2026-10-11T12:00:00Z', geoeffnet_am: null };
const OFFEN = { frist: '2026-10-11T12:00:00Z', geoeffnet_am: '2026-10-11T13:00:00Z' };

describe('vergabeZugriff — Phasen und Knöpfe', () => {
  it('Phasen', () => {
    assert.equal(vergabePhase(null, JETZT), 'ohne');
    assert.equal(vergabePhase(LAEUFT, JETZT), 'laeuft');
    assert.equal(vergabePhase(ABGELAUFEN, JETZT), 'abgelaufen');
    assert.equal(vergabePhase(OFFEN, JETZT), 'geoeffnet');
    assert.equal(vergabePhase({ frist: 'kaputt' }, JETZT), 'ohne');
  });
  it('owner: anlegen → Frist/Freigabe/Einladung → öffnen → Zuschlag', () => {
    const k = (s) => vergabeAktionen({ rolle: 'owner', submission: s, jetzt: JETZT });
    assert.deepEqual(k(null), { phase: 'ohne', anlegen: true, fristVerschieben: false, freigeben: false, oeffnen: false, zuschlagPerRpc: false, einladen: true });
    assert.equal(k(LAEUFT).fristVerschieben, true);
    assert.equal(k(LAEUFT).freigeben, true);
    assert.equal(k(LAEUFT).oeffnen, false);
    assert.equal(k(ABGELAUFEN).oeffnen, true);
    assert.equal(k(ABGELAUFEN).fristVerschieben, false, 'abgelaufene Frist wird nie verlängert');
    assert.equal(k(OFFEN).zuschlagPerRpc, true);
    assert.equal(k(OFFEN).einladen, false);
  });
  it('planner legt an und gibt frei, öffnet aber nicht; leser und Externe bekommen nichts', () => {
    const p = vergabeAktionen({ rolle: 'planner', submission: ABGELAUFEN, jetzt: JETZT });
    assert.equal(p.freigeben, true);
    assert.equal(p.oeffnen, false);
    assert.equal(p.einladen, false);
    for (const rolle of ['leser', 'bidder', undefined]) {
      const a = vergabeAktionen({ rolle, submission: LAEUFT, jetzt: JETZT });
      assert.equal(Object.entries(a).filter(([k, v]) => k !== 'phase' && v).length, 0, String(rolle));
    }
  });
  it('fristAusEingabe: nur gültig und in der Zukunft', () => {
    assert.match(String(fristAusEingabe('2099-01-01T10:00', JETZT)), /^2099-01-01T/);
    assert.equal(fristAusEingabe('2020-01-01T10:00', JETZT), null);
    assert.equal(fristAusEingabe('', JETZT), null);
    assert.equal(fristAusEingabe('2099-01-01', JETZT), null);
  });
  it('zuschlagWeg: ohne Zugriffstrennung oder ohne Submission wie bisher', () => {
    assert.equal(zuschlagWeg({ zugriffstrennung: false, submission: OFFEN }), 'update');
    assert.equal(zuschlagWeg({ zugriffstrennung: true, submission: null }), 'update');
    assert.equal(zuschlagWeg({ zugriffstrennung: true, submission: LAEUFT }), 'rpc-erst-oeffnen');
    assert.equal(zuschlagWeg({ zugriffstrennung: true, submission: OFFEN }), 'rpc');
  });
  it('das Panel rendert nur mit Cloud + Zugriffstrennung + interner Rolle', () => {
    const q = fs.readFileSync(path.resolve(import.meta.dirname, '../../packages/nova-ausschreibung/src/components/VergabeZugriff.jsx'), 'utf8');
    assert.match(q, /DATENQUELLE === "supabase" && user\?\.zugriffstrennung === true && user\?\.intern === true/);
    assert.match(q, /if \(!aktiv\) return null;/);
  });
});
