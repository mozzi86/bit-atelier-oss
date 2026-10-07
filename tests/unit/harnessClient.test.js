// Unit tests for the pure parts of src/lib/harnessClient.js (Phase 67-06):
// fence splitting (T-67-18: text stays text) and .ifc path detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitFences, findeIfcPfade, RECONNECT_DELAYS_MS } from '../../src/lib/harnessClient.js';

test('splitFences: prose and one code block', () => {
  const parts = splitFences('Hallo\n```python\nprint(1)\n```\nEnde');
  assert.deepEqual(parts, [
    { type: 'text', text: 'Hallo\n' },
    { type: 'code', lang: 'python', text: 'print(1)' },
    { type: 'text', text: '\nEnde' },
  ]);
});

test('splitFences: no fence → one text part; unclosed fence stays text', () => {
  assert.deepEqual(splitFences('nur Text'), [{ type: 'text', text: 'nur Text' }]);
  assert.deepEqual(splitFences('```js\nkaputt'), [{ type: 'text', text: '```js\nkaputt' }]);
  assert.deepEqual(splitFences(''), [{ type: 'text', text: '' }]);
});

test('findeIfcPfade: JSON result with Windows and posix paths, deduplicated', () => {
  const r = JSON.stringify({ datei: 'C:\\proj\\model\\efh.ifc', liste: ['model/efh.ifc', 'model/a.IFC', 'model/a.IFC'], text: 'kein ifc hier' });
  const hits = findeIfcPfade(r);
  assert.equal(hits.length, 3);
  assert.ok(hits.includes('model/efh.ifc') && hits.includes('model/a.IFC'));
  assert.ok(hits.some((h) => h.endsWith('\\efh.ifc')));
  assert.deepEqual(findeIfcPfade('nichts'), []);
});

test('reconnect schedule: backoff 1–8 s, five attempts', () => {
  assert.deepEqual(RECONNECT_DELAYS_MS, [1000, 2000, 4000, 8000, 8000]);
});
