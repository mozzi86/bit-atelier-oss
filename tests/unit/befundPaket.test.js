// Phase 69-14 Task 2: Befund-Paket — Manifest-Hashes stimmen mit den
// ZIP-Einträgen überein (unzipSync-Gegenprobe), Name deterministisch,
// fehlende PDF → Paket ohne PDF + Hinweis im Manifest.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

import { baueBefundPaket, paketDateiname, PAKET_DATEIEN } from '@ifc/lib/befundPaket.js';

const nodeSha = (b) => createHash('sha256').update(b).digest('hex');
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const bcf = new Uint8Array([0x50, 0x4b, 3, 4, 7, 7]);
const HTML = '<!doctype html><html><body>Zusammenfassung</body></html>';

describe('baueBefundPaket', () => {
  it('vier Einträge; Manifest-Hashes = Hashes der ZIP-Bytes (Gegenprobe)', async () => {
    const { zip, manifest } = await baueBefundPaket({
      projekt: 'Bürocampus Nord', datum: '2026-09-25T10:00:00Z', pdf, bcf, html: HTML,
      kennzahlen: { bauteile: 4211, kollisionen: 3 },
    });
    const inhalt = unzipSync(zip);
    const namen = Object.keys(inhalt).sort();
    assert.deepEqual(namen, [PAKET_DATEIEN.bcf, PAKET_DATEIEN.html, PAKET_DATEIEN.manifest, PAKET_DATEIEN.pdf].sort());
    // Every manifest hash matches the actual entry bytes (the point of a manifest).
    for (const d of manifest.dateien) {
      assert.ok(inhalt[d.name], `Eintrag ${d.name} fehlt im ZIP`);
      assert.equal(nodeSha(inhalt[d.name]), d.sha256, `Hash ${d.name}`);
      assert.equal(inhalt[d.name].length, d.bytes);
    }
    // sha256Hex (WebCrypto) == node:crypto — cross-implementation proof.
    const man = JSON.parse(strFromU8(inhalt[PAKET_DATEIEN.manifest]));
    assert.deepEqual(man.dateien, manifest.dateien);
    assert.equal(man.projekt, 'Bürocampus Nord');
    assert.deepEqual(man.kennzahlen, { bauteile: 4211, kollisionen: 3 });
    assert.equal(strFromU8(inhalt[PAKET_DATEIEN.html]), HTML);
  });

  it('Name deterministisch: <projekt>_<JJJJ-MM-TT>_befundpaket.zip, dateinamensicher', async () => {
    const a = await baueBefundPaket({ projekt: 'Büro/campus: West', datum: '2026-01-09T23:00:00', html: HTML });
    const b = await baueBefundPaket({ projekt: 'Büro/campus: West', datum: '2026-01-09T01:00:00', html: HTML });
    assert.equal(a.name, b.name, 'gleicher Tag → gleicher Name');
    assert.match(a.name, /_befundpaket\.zip$/);
    assert.equal(a.name.includes('/'), false);
    assert.equal(a.name.includes(':'), false);
    assert.equal(paketDateiname('P', new Date(2026, 8, 25)), 'P_2026-09-25_befundpaket.zip');
  });

  it('deterministische Bytes: gleicher Inhalt + gleiches Datum → identisches ZIP', async () => {
    const opts = { projekt: 'P', datum: '2026-09-25T08:00:00Z', pdf, bcf, html: HTML, kennzahlen: { k: 1 } };
    const a = await baueBefundPaket(opts);
    const b = await baueBefundPaket(opts);
    assert.deepEqual(a.zip, b.zip);
  });

  it('fehlende PDF → Paket ohne bericht.pdf + ehrlicher Hinweis im Manifest', async () => {
    const { zip, manifest } = await baueBefundPaket({ projekt: 'P', datum: '2026-09-25T08:00:00Z', pdf: null, bcf, html: HTML });
    const inhalt = unzipSync(zip);
    assert.equal(inhalt[PAKET_DATEIEN.pdf], undefined);
    assert.ok(inhalt[PAKET_DATEIEN.bcf]);
    assert.ok(inhalt[PAKET_DATEIEN.html]);
    assert.ok(manifest.hinweise.some((h) => h.includes('PDF')));
    // The manifest still hashes what IS inside.
    for (const d of manifest.dateien) assert.equal(nodeSha(inhalt[d.name]), d.sha256);
  });

  it('kein BCF (befundfreier Lauf) → Paket ohne befunde.bcf + Hinweis', async () => {
    const { zip, manifest } = await baueBefundPaket({ projekt: 'P', datum: '2026-09-25T08:00:00Z', pdf, bcf: null, html: HTML });
    const inhalt = unzipSync(zip);
    assert.equal(inhalt[PAKET_DATEIEN.bcf], undefined);
    assert.ok(manifest.hinweise.some((h) => h.includes('BCF')));
  });

  it('html ist Pflicht — ohne wirft die Funktion im Klartext', async () => {
    await assert.rejects(() => baueBefundPaket({ projekt: 'P', pdf, bcf }), /html fehlt/);
  });

  it('nimmt ArrayBuffer und TypedArray-Views wie Uint8Array an', async () => {
    const buf = pdf.slice().buffer; // ArrayBuffer
    const view = new Uint8Array(buf, 1, 3); // Sicht mit Offset
    const { manifest, zip } = await baueBefundPaket({ projekt: 'P', datum: '2026-09-25T08:00:00Z', pdf: buf, bcf: view, html: HTML });
    const inhalt = unzipSync(zip);
    for (const d of manifest.dateien) assert.equal(nodeSha(inhalt[d.name]), d.sha256);
    assert.equal(inhalt[PAKET_DATEIEN.bcf].length, 3);
  });
});
