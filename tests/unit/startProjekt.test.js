// Tests for the start-project rule (72-08, N-01; demo default removed in 83-02):
// URL beats stored id beats the first project by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waehleStartProjekt } from '@core/lib/startProjekt';

// Same order as Project.list("name") returns them.
const PROJEKTE = [
  { id: 'proj-2', name: 'Bürocampus Parkseite' },
  { id: 'proj-4', name: 'Sanierung Altstadthof' },
  { id: 'proj-1', name: 'Stadtquartier Nordhang' },
  { id: 'proj-3', name: 'Wohnpark am See' },
];

test('URL beats stored beats first by name', () => {
  assert.equal(waehleStartProjekt(PROJEKTE, { urlWert: 'proj-3', gespeichert: 'proj-4' }), 'proj-3');
  assert.equal(waehleStartProjekt(PROJEKTE, { gespeichert: 'proj-4' }), 'proj-4');
  assert.equal(waehleStartProjekt(PROJEKTE), 'proj-2');
});

test('deep link by exact name resolves to the id', () => {
  assert.equal(waehleStartProjekt(PROJEKTE, { urlWert: 'Wohnpark am See' }), 'proj-3');
  // Not a substring match: a partial name does not select anything.
  assert.equal(waehleStartProjekt(PROJEKTE, { urlWert: 'Wohnpark' }), 'proj-2');
});

test('an unknown URL value falls through to the stored id', () => {
  assert.equal(waehleStartProjekt(PROJEKTE, { urlWert: 'proj-99', gespeichert: 'proj-4' }), 'proj-4');
});

test('an invalid stored id falls back to the first project by name', () => {
  assert.equal(waehleStartProjekt(PROJEKTE, { gespeichert: 'geloescht-7' }), 'proj-2');
  assert.equal(waehleStartProjekt(PROJEKTE, {}), 'proj-2');
});

test('the former demo flag has no effect any more', () => {
  // istDemo was removed in 83-02; an old caller passing it must not change the result.
  const alteOptionen = /** @type {any} */ ({ istDemo: true });
  assert.equal(waehleStartProjekt(PROJEKTE, alteOptionen), 'proj-2');
});

test('empty or missing list returns an empty string', () => {
  assert.equal(waehleStartProjekt([], { urlWert: 'proj-1', gespeichert: 'proj-1' }), '');
  assert.equal(waehleStartProjekt(undefined), '');
});
