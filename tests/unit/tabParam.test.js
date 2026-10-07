// 72-15 (N-16): `?tab=` resolution for addressable tabs (tabParam.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { waehleTab, mitTabParameter, TAB_PARAMETER } from '@core/lib/tabParam.js';

// Same keys as the AVA page (the TabsTrigger values stay the contract with lane A).
const AVA = ['lv', 'mengenregeln', 'takeoff', 'kostenberechnung', 'tender', 'prices', 'settlement', 'control'];
const ALIAS = { kostenkontrolle: 'control', preisspiegel: 'prices', 'bim-mengen': 'takeoff', kaputt: 'gibt-es-nicht' };

describe('waehleTab', () => {
  it('returns a valid key unchanged', () => {
    for (const k of AVA) assert.equal(waehleTab(k, AVA, 'lv'), k);
  });

  it('falls back to the default for an unknown value', () => {
    assert.equal(waehleTab('xyz', AVA, 'lv'), 'lv');
    assert.equal(waehleTab('Kostenkontrolle ', AVA, 'lv', {}), 'lv', 'no alias map → unknown');
  });

  it('resolves an alias, but only to an allowed key', () => {
    assert.equal(waehleTab('kostenkontrolle', AVA, 'lv', ALIAS), 'control');
    assert.equal(waehleTab('bim-mengen', AVA, 'lv', ALIAS), 'takeoff');
    assert.equal(waehleTab('kaputt', AVA, 'lv', ALIAS), 'lv', 'alias target outside the list');
  });

  it('treats missing, empty and non-string values as the default', () => {
    assert.equal(waehleTab(null, AVA, 'lv'), 'lv');
    assert.equal(waehleTab(undefined, AVA, 'lv'), 'lv');
    assert.equal(waehleTab('', AVA, 'lv'), 'lv');
    assert.equal(waehleTab('   ', AVA, 'lv'), 'lv');
    assert.equal(waehleTab(42, AVA, 'lv'), 'lv');
    assert.equal(waehleTab({ tab: 'control' }, AVA, 'lv'), 'lv');
  });

  it('ignores case and surrounding whitespace, for keys and aliases', () => {
    assert.equal(waehleTab('CONTROL', AVA, 'lv'), 'control');
    assert.equal(waehleTab('  Prices ', AVA, 'lv'), 'prices');
    assert.equal(waehleTab('Kostenkontrolle', AVA, 'lv', ALIAS), 'control');
    assert.equal(waehleTab('PREISSPIEGEL', AVA, 'lv', ALIAS), 'prices');
  });

  it('never resolves Object.prototype members through the alias map', () => {
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(waehleTab(k, AVA, 'lv', ALIAS), 'lv', k);
    }
  });

  it('survives a broken key list or alias map', () => {
    assert.equal(waehleTab('control', null, 'lv'), 'lv');
    assert.equal(waehleTab('control', AVA, 'lv', null), 'control');
    assert.equal(waehleTab('kostenkontrolle', AVA, 'lv', null), 'lv');
  });
});

describe('mitTabParameter', () => {
  it('sets tab and keeps every other parameter', () => {
    const neu = mitTabParameter(new URLSearchParams('beispiel=1&ticket=iss-2&tab=lv'), 'control');
    assert.equal(neu.get(TAB_PARAMETER), 'control');
    assert.equal(neu.get('beispiel'), '1');
    assert.equal(neu.get('ticket'), 'iss-2');
    assert.equal(neu.getAll(TAB_PARAMETER).length, 1);
  });

  it('accepts a query string with a leading "?" and leaves the input untouched', () => {
    const alt = new URLSearchParams('tab=lv');
    const neu = mitTabParameter(alt, 'prices');
    assert.equal(alt.get('tab'), 'lv');
    assert.equal(neu.toString(), 'tab=prices');
    assert.equal(mitTabParameter('?beispiel=1', 'takeoff').toString(), 'beispiel=1&tab=takeoff');
    assert.equal(mitTabParameter(null, 'lv').toString(), 'tab=lv');
  });
});
