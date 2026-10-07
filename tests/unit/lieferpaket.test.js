// Phase 71-03 Task 2: Lieferpaket als ZIP — fünf Dateien, Manifest-Hashes,
// Ausfall des PDF.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

import { baueLieferpaket, paketNamen, sha256Hex } from '@ifc/lib/lieferpaket.js';

const NAME = 'P5_24680-01_TX_FM_XX_P_01.ifc';
const ifc = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5]);
const bcf = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]);
const nodeSha = (b) => createHash('sha256').update(b).digest('hex');

describe('lieferpaket.js', () => {
  it('paketNamen leitet alle Dateinamen aus dem Richtlinien-Namen ab', () => {
    const n = paketNamen(`C:\\x\\${NAME}`);
    assert.equal(n.basis, 'P5_24680-01_TX_FM_XX_P_01');
    assert.equal(n.ifc, NAME);
    assert.equal(n.pdf, 'P5_24680-01_TX_FM_XX_P_01_Pruefbericht.pdf');
    assert.equal(n.bcf, 'P5_24680-01_TX_FM_XX_P_01_Befunde.bcf');
    assert.equal(n.protokoll, 'P5_24680-01_TX_FM_XX_P_01_Uebergabeprotokoll.md');
    assert.equal(n.manifest, 'manifest.json');
    assert.equal(n.zip, 'P5_24680-01_TX_FM_XX_P_01_Lieferpaket.zip');
  });

  it('sha256Hex stimmt mit node:crypto überein', async () => {
    assert.equal(await sha256Hex(ifc), nodeSha(ifc));
  });

  it('Paket aus Dummy-Bytes → fünf Dateien, Hashes stimmen, Protokoll trägt den IFC-Hash', async () => {
    const { zip, manifest, namen } = await baueLieferpaket({
      dateiname: NAME, ifc, pdf, bcf,
      erzeugt: '2026-10-01T08:30:00.000Z',
      protokollErgaenzen: (hashes) => `# Protokoll\n${hashes.map((h) => `${h.name}: ${h.sha256}`).join('\n')}\n`,
    });
    const inhalt = unzipSync(zip);
    const dateien = Object.keys(inhalt).sort();
    assert.deepEqual(dateien, [
      namen.ifc, namen.bcf, namen.protokoll, namen.pdf, 'manifest.json',
    ].sort());
    assert.equal(dateien.length, 5);

    // Nutzdaten byte-identisch (STORE).
    assert.deepEqual(Array.from(inhalt[namen.ifc]), Array.from(ifc));
    assert.deepEqual(Array.from(inhalt[namen.pdf]), Array.from(pdf));
    assert.deepEqual(Array.from(inhalt[namen.bcf]), Array.from(bcf));

    // Manifest im ZIP = zurückgegebenes Manifest; Hashes = node:crypto.
    const m = JSON.parse(strFromU8(inhalt['manifest.json']));
    assert.deepEqual(m, manifest);
    assert.equal(m.erzeugt, '2026-10-01T08:30:00.000Z');
    assert.equal(m.dateien.length, 4);
    for (const d of m.dateien) {
      assert.equal(d.sha256, nodeSha(inhalt[d.name]), `Hash ${d.name}`);
      assert.equal(d.bytes, inhalt[d.name].length);
    }
    assert.deepEqual(m.hinweise, []);
    assert.match(m.herkunft, /kein Neu-Export/);

    // Protokoll nennt den IFC-Hash (T-71-10) — und nicht seinen eigenen.
    const protokoll = strFromU8(inhalt[namen.protokoll]);
    assert.ok(protokoll.includes(`${NAME}: ${nodeSha(ifc)}`));
    assert.ok(!protokoll.includes(namen.protokoll));
  });

  it('pdf: null → vier Dateien und ein Hinweis im Manifest', async () => {
    const { zip, manifest } = await baueLieferpaket({ dateiname: NAME, ifc, pdf: null, bcf, protokoll: 'x' });
    const inhalt = unzipSync(zip);
    assert.equal(Object.keys(inhalt).length, 4);
    assert.equal(manifest.hinweise.length, 1);
    assert.match(manifest.hinweise[0], /Prüfbericht \(PDF\) nicht enthalten/);
  });

  it('bcf: null → Hinweis „keine offenen Befunde"; ohne IFC → Fehler', async () => {
    const { manifest } = await baueLieferpaket({ dateiname: NAME, ifc: ifc.buffer.slice(0), pdf, bcf: null, protokoll: 'x' });
    assert.match(manifest.hinweise[0], /Kein BCF enthalten/);
    await assert.rejects(() => baueLieferpaket({ dateiname: NAME, ifc: new Uint8Array(0), protokoll: 'x' }), /IFC-Bytes fehlen/);
  });

  it('derselbe Inhalt gibt dieselben ZIP-Bytes (fester Zeitstempel)', async () => {
    const a = await baueLieferpaket({ dateiname: NAME, ifc, pdf, bcf, protokoll: 'p', erzeugt: '2026-10-01T08:30:00.000Z' });
    const b = await baueLieferpaket({ dateiname: NAME, ifc, pdf, bcf, protokoll: 'p', erzeugt: '2026-10-01T08:30:00.000Z' });
    assert.deepEqual(Array.from(a.zip), Array.from(b.zip));
  });
});
