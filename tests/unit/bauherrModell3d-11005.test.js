// 110-05: the client's 3D file is the BIM studio scene (bauherrModell3d.js) and follows the model (bauherrModellAbgleich.js).
// Pure parts only — the GLB writing needs a browser (GLTFExporter, FileReader) and runs in the E2E bauherrenzugang-110-03.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { BAUHERR_EBENEN, bauherrSzene, bauherrSzeneFreigeben } from '@designer/lib/bauherrModell3d';
import { lokaleModellBlobId, modellDateiVeraltet } from '@designer/lib/bauherrModellAbgleich';

/** @param {string} layer @param {Record<string, any>} [extra] @returns {THREE.Mesh} studio-like mesh on a layer */
function mesh(layer, extra = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  m.userData = { layer, ...extra };
  return m;
}

describe('bauherrSzene', () => {
  it('nimmt nur Hülle, Attika/Dach, Wände und Öffnungen — nie Räume, Stützen, Gelände, Umgebung, Durchbrüche', () => {
    const gebaeude = new THREE.Group();
    const eigene = new THREE.Group();
    gebaeude.add(mesh('shell'), mesh('attika'), mesh('openings'), mesh('terrain'), mesh('context'));
    eigene.add(mesh('walls'), mesh('zones'), mesh('columns'), mesh('openings', { kind: 'durchbruch' }));
    const s = bauherrSzene([gebaeude, eigene, null]);
    assert.equal(s.children.length, 4);
    assert.deepEqual([...BAUHERR_EBENEN].sort(), ['attika', 'openings', 'shell', 'walls']);
  });
  it('Glas einer Fenstergruppe zählt über die Ebene der Gruppe; Weltlage bleibt; Hilfslinien und Auswahlleuchten nicht', () => {
    const gebaeude = new THREE.Group();
    const fenster = new THREE.Group();
    fenster.userData.layer = 'openings';
    fenster.position.set(5, 2, -3);
    const glas = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02), new THREE.MeshStandardMaterial({ color: 0x7fb6d6, emissive: 0x3366ff }));
    const hilfe = mesh('openings', { zeigeHilfe: true });
    fenster.add(glas, hilfe);
    gebaeude.add(fenster);
    const s = bauherrSzene([gebaeude]);
    assert.equal(s.children.length, 1);
    const k = /** @type {THREE.Mesh} */ (s.children[0]);
    assert.deepEqual(k.position.toArray(), [5, 2, -3]);
    const mat = /** @type {THREE.MeshStandardMaterial} */ (k.material);
    assert.equal(mat.emissive.getHex(), 0, 'Auswahlleuchten gehen nicht zum Bauherrn');
    assert.equal(/** @type {THREE.MeshStandardMaterial} */ (glas.material).emissive.getHex(), 0x3366ff, 'Studio-Material bleibt unberührt');
    assert.equal(k.geometry, glas.geometry, 'Geometrie geteilt, nicht kopiert');
    bauherrSzeneFreigeben(s);
  });
});

describe('modellDateiVeraltet', () => {
  it('ohne Datei oder mit älterem Stand als das Modell: neu schreiben; sonst nicht', () => {
    const modell = { updated_date: '2026-11-08T10:00:00.000Z' };
    assert.equal(modellDateiVeraltet({ datei: null, stand: '2026-11-09' }, modell), true);
    assert.equal(modellDateiVeraltet({ datei: 'a.glb', stand: '2026-11-08T09:59:59.000Z' }, modell), true);
    assert.equal(modellDateiVeraltet({ datei: 'a.glb', stand: '2026-11-08T10:00:00.000Z' }, modell), false);
    assert.equal(modellDateiVeraltet({ datei: 'a.glb', stand: 'kaputt' }, modell), true);
    assert.equal(modellDateiVeraltet({ datei: 'a.glb', stand: '2026-01-01' }, {}), false, 'alter Datensatz ohne Änderungsdatum: Datei bleibt');
    assert.equal(modellDateiVeraltet(null, modell), true);
  });
  it('lokale Blob-Id nur aus Buchstaben, Ziffern, Bindestrich, Unterstrich', () => {
    assert.equal(lokaleModellBlobId('abc123-modell.glb'), 'bauherr-abc123-modell-glb');
    assert.match(lokaleModellBlobId('ä/../x y.glb'), /^[A-Za-z0-9_-]+$/);
  });
});
