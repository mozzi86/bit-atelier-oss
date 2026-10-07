// Phase 71-03 Task 1: Dateinamenkonvention nach Namensrichtlinie des Auftraggebers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { KATALOG, baueDateiname, pruefeDateiname, naechsterIndex } from '@ifc/lib/dateiname.js';

const TEILE = {
  phase: 'P5', gebaeude: '24680-01', fachsicht: 'TX', modellart: 'FM',
  ebene: 'XX', status: 'P', index: 1,
};

describe('dateiname.js — Namensrichtlinie', () => {
  it('Katalog enthält die Listen der Namensrichtlinie (Fachsichten inkl. TGA/Elektro)', () => {
    assert.equal(KATALOG.phasen.length, 8);
    assert.equal(KATALOG.gebaeude.length, 4);
    assert.ok(KATALOG.fachsichten.length >= 30, `${KATALOG.fachsichten.length} Fachsichten`);
    for (const k of ['AX', 'TX', 'TS', 'GL', 'EX', 'IB']) {
      assert.ok(KATALOG.fachsichten.some((f) => f.wert === k), `Fachsicht ${k} fehlt`);
    }
    assert.deepEqual(KATALOG.modellarten.map((m) => m.wert), ['TM', 'FM', 'KM']);
    assert.equal(KATALOG.ebenen.length, 11);
    assert.deepEqual(KATALOG.status.map((s) => s.wert), ['V', 'P', 'F']);
  });

  it('gültiger Name baut und prüft sich selbst', () => {
    const name = baueDateiname({ ...TEILE, freitext: 'Rohbau' });
    assert.equal(name, 'P5_24680-01_TX_FM_XX_P_01_Rohbau.ifc');
    const p = pruefeDateiname(name);
    assert.equal(p.gueltig, true, p.fehler.join('; '));
    assert.deepEqual(p.fehler, []);
    assert.deepEqual(p.warnungen, []);
    assert.equal(p.teile.fachsicht, 'TX');
    assert.equal(p.teile.index, '01');
    assert.equal(p.teile.freitext, 'Rohbau');
  });

  it('ohne Freitext bleibt der Name 7-teilig und gültig', () => {
    const name = baueDateiname(TEILE);
    assert.equal(name, 'P5_24680-01_TX_FM_XX_P_01.ifc');
    assert.equal(pruefeDateiname(name).gueltig, true);
  });

  it('Richtlinien-Muster P2_24680-02_AX_TM_XX_V_01_FREITEXT.ifc ist gültig', () => {
    const p = pruefeDateiname('P2_24680-02_AX_TM_XX_V_01_FREITEXT.ifc');
    assert.equal(p.gueltig, true, p.fehler.join('; '));
  });

  it('AG-Ausgangsdatei P5_24680-01_TX_FM_XX_V_01_--.ifc → gültig mit Warnung zu Bindestrichen', () => {
    const p = pruefeDateiname('P5_24680-01_TX_FM_XX_V_01_--.ifc');
    // Klartext-Regel: Der AG-Name wird nicht als ungültig verworfen (fremde
    // Datei), der Regelverstoß gehört aber sichtbar ins Protokoll.
    assert.equal(p.fehler.length, 0, p.fehler.join('; '));
    assert.equal(p.gueltig, true);
    assert.equal(p.warnungen.length, 1);
    assert.match(p.warnungen[0], /Freitext „--"/);
    assert.match(p.warnungen[0], /Binde-\/Unterstriche sind laut Namenskonvention verboten/);
  });

  it('Freitext mit 11 Zeichen → Fehler (bauen und prüfen)', () => {
    assert.throws(() => baueDateiname({ ...TEILE, freitext: 'ABCDEFGHIJK' }), /maximal 10 Zeichen/);
    const p = pruefeDateiname('P5_24680-01_TX_FM_XX_P_01_ABCDEFGHIJK.ifc');
    assert.equal(p.gueltig, false);
    assert.match(p.fehler[0], /11 Zeichen lang — maximal 10/);
  });

  it('Ebene 05 → Fehler mit der Liste der erlaubten Werte', () => {
    assert.throws(() => baueDateiname({ ...TEILE, ebene: '05' }), /ebene „05" ist nicht erlaubt \(GR, 00, 01, 02, 03, U1, U2, UZ, Z1, DA, XX\)/);
    const p = pruefeDateiname('P5_24680-01_TX_FM_05_P_01.ifc');
    assert.equal(p.gueltig, false);
    assert.match(p.fehler[0], /ebene „05"/);
    assert.match(p.fehler[0], /GR, 00, 01/);
  });

  it('falsche Segmentzahl → Fehler ohne Zerlegung', () => {
    const p = pruefeDateiname('Rohbau_final.ifc');
    assert.equal(p.gueltig, false);
    assert.equal(p.teile, null);
    assert.match(p.fehler[0], /2 Segmente — die Namenskonvention verlangt 7 oder 8/);
  });

  it('Endung außerhalb des Katalogs → Warnung, fehlende Endung → Fehler', () => {
    assert.match(pruefeDateiname('P5_24680-01_TX_FM_XX_P_01.pln').warnungen[0], /Endung „.pln"/);
    assert.match(pruefeDateiname('P5_24680-01_TX_FM_XX_P_01').fehler[0], /Dateiendung fehlt/);
  });

  it('naechsterIndex: aus V_01 und V_02 wird 3; andere Kombination zählt nicht', () => {
    const namen = [
      'P5_24680-01_TX_FM_XX_V_01_--.ifc',
      'P5_24680-01_TX_FM_XX_V_02.ifc',
      'P5_24680-01_AX_FM_XX_V_07.ifc', // andere Fachsicht
      'kaputt.ifc',
    ];
    const t = { phase: 'P5', gebaeude: '24680-01', fachsicht: 'TX', modellart: 'FM', ebene: 'XX', status: 'V' };
    assert.equal(naechsterIndex(namen, t), 3);
    assert.equal(naechsterIndex(namen, { ...t, status: 'P' }), 1);
    assert.equal(naechsterIndex([], t), 1);
  });

  it('Index 0 oder 100 → Fehler beim Bauen', () => {
    assert.throws(() => baueDateiname({ ...TEILE, index: 0 }), /ganze Zahl 1-99/);
    assert.throws(() => baueDateiname({ ...TEILE, index: 100 }), /ganze Zahl 1-99/);
  });
});
