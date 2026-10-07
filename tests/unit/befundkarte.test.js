// 66-08 (register no. 85): floor plan with numbered finding markers per storey.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clashPairs, boxTris } from '@ifc/lib/clash.js';
import {
  mitteVon, geschossVonBefund, befundeJeGeschoss, umrissFuerGeschoss, kartenModell,
  befundkarteSvg, massstabsbalkenM, stilVon, OHNE_GESCHOSS, RAND_M,
  elementSuche, lageVon, umrissHinweis,
} from '@ifc/lib/befundkarte.js';

/** Element in extractGeometry form (world coordinates, Y up). */
function el(expressId, ifcType, storey, min, max) {
  return { expressId, globalId: `G${expressId}`, ifcType, storey, tris: boxTris(min, max) };
}

// EG slab 20 × 10 m at x 0..20, z 0..10 (plan), 0.25 m thick.
const DECKE_EG = el(1, 'IFCSLAB', 'EG', [0, 0, 0], [20, 0.25, 10]);
const DECKE_OG = el(2, 'IFCSLAB', 'OG', [0, 3, 0], [12, 3.25, 10]);
const WAND = el(3, 'IFCWALL', 'EG', [4, 0, 4], [4.3, 3, 8]);
const BALKEN = el(4, 'IFCBEAM', 'EG', [3, 2.5, 5], [6, 2.9, 5.4]);

describe('mitteVon / geschossVonBefund', () => {
  it('liest {x,y,z} und [x,y,z], lehnt Unvollständiges ab', () => {
    assert.deepEqual(mitteVon({ center: { x: 1, y: 2, z: 3 } }), { x: 1, y: 2, z: 3 });
    assert.deepEqual(mitteVon({ center: [1, 2, 3] }), { x: 1, y: 2, z: 3 });
    assert.equal(mitteVon({ center: { x: 1, y: NaN, z: 3 } }), null);
    assert.equal(mitteVon({}), null);
  });
  it('Geschoss von A, sonst B, sonst null', () => {
    const suche = elementSuche([{ expressId: 3, storey: 'EG' }, { expressId: 9, storey: 'OG' }]);
    assert.equal(geschossVonBefund({ aId: 3, bId: 9 }, suche), 'EG');
    assert.equal(geschossVonBefund({ aId: 7, bId: 9 }, suche), 'OG');
    assert.equal(geschossVonBefund({ aId: null, bId: 8 }, suche), null);
  });
});

describe('elementSuche (zwei Modelle, express IDs wiederholen sich)', () => {
  // Model A: wall #101 in EG. Model B: door #300 in EG and an unrelated column #101 in 03 OG.
  const A_WAND = { expressId: 101, globalId: 'GA101', storey: 'EG', quelle: 'A' };
  const B_TUER = { expressId: 300, globalId: 'GB300', storey: 'EG', quelle: 'B' };
  const B_STUETZE = { expressId: 101, globalId: 'GB101', storey: '03 OG', quelle: 'B' };
  const suche = elementSuche([A_WAND, B_TUER, B_STUETZE]);

  it('GUID gewinnt vor der express ID', () => {
    assert.equal(suche('GA101', null, 101), A_WAND);
    assert.equal(suche('GB101', null, 101), B_STUETZE);
  });
  it('ohne GUID: Quelle + express ID', () => {
    assert.equal(suche('', 'A', 101), A_WAND);
    assert.equal(suche('', 'B', 101), B_STUETZE);
  });
  it('ohne GUID und Quelle: mehrdeutige express ID liefert null statt eines Fremdbauteils', () => {
    assert.equal(suche('', null, 101), null);
    assert.equal(suche('', null, 300), B_TUER);
  });
  it('harter Befund aus der BAP-Regel landet im Geschoss seiner Bauteile, nicht bei der fremden #101', () => {
    const befund = { kind: 'hard', aId: 101, bId: 300, aGuid: 'GA101', bGuid: 'GB300', center: { x: 1, y: 1, z: 1 } };
    const { geschosse } = befundeJeGeschoss([befund], [A_WAND, B_TUER, B_STUETZE]);
    assert.deepEqual([...geschosse.keys()], ['EG']);
  });
});

describe('lageVon', () => {
  // 22 m wall along x at z 0..0.2; a 1 m door 0.05 m in front of a 30 m wall.
  const WAND_22 = el(11, 'IFCWALL', 'EG', [10, 0, 0], [22, 3, 0.2]);
  const WAND_30 = el(12, 'IFCWALL', 'EG', [0, 0, 0.15], [30, 3, 0.35]);
  const TUER = el(13, 'IFCDOOR', 'EG', [1, 0, 0], [2, 2.1, 0.1]);
  const suche = elementSuche([WAND_22, WAND_30, TUER]);

  it('ohne_partner: Mitte des Bauteils, nicht die AABB-Ecke aus clash.js', () => {
    const b = { kind: 'ohne_partner', aId: 11, aGuid: 'G11', bId: null, bGuid: '', center: { x: 10, y: 0, z: 0 } };
    const l = lageVon(b, suche);
    assert.equal(l.x, 16);
    assert.ok(Math.abs(l.z - 0.1) < 1e-9);
  });
  it('ohne_partner auf der B-Seite (gefüllt): Mitte des B-Bauteils', () => {
    const b = { kind: 'ohne_partner', aId: null, aGuid: '', bId: 11, bGuid: 'G11', center: { x: 10, y: 0, z: 0 } };
    assert.equal(lageVon(b, suche).x, 16);
  });
  it('clearance: Mitte der Lücke bzw. der Überdeckung je Achse, an der Tür statt 6 m daneben', () => {
    const b = { kind: 'clearance', aId: 13, aGuid: 'G13', bId: 12, bGuid: 'G12', center: { x: 8.25, y: 1.5, z: 0.15 } };
    const l = lageVon(b, suche);
    assert.equal(l.x, 1.5); // x overlap 1..2
    assert.ok(Math.abs(l.z - 0.125) < 1e-9); // gap 0.10..0.15
  });
  it('andere Arten und unbekannte Bauteile: center unverändert', () => {
    assert.deepEqual(lageVon({ kind: 'hard', aId: 11, aGuid: 'G11', bId: 12, bGuid: 'G12', center: { x: 4, y: 1, z: 2 } }, suche), { x: 4, y: 1, z: 2 });
    assert.deepEqual(lageVon({ kind: 'ohne_partner', aId: 999, center: { x: 7, y: 0, z: 3 } }, suche), { x: 7, y: 0, z: 3 });
  });
  it('befundeJeGeschoss zeichnet mit lageVon', () => {
    const b = { kind: 'ohne_partner', aId: 11, aGuid: 'G11', bId: null, bGuid: '', center: { x: 10, y: 0, z: 0 } };
    const { geschosse } = befundeJeGeschoss([b], [WAND_22]);
    assert.equal(geschosse.get('EG')[0].x, 16);
  });
});

describe('befundeJeGeschoss', () => {
  it('Nummer = Position im Bericht + 1, gruppiert nach Geschoss, ohne Geschoss eigene Gruppe', () => {
    const befunde = [
      { kind: 'hard', aId: 3, bId: 4, center: { x: 4, y: 2.7, z: 5 } },
      { kind: 'duplicate', aId: 99, bId: 98, center: { x: 1, y: 0, z: 1 } },
      { kind: 'hard', aId: 2, bId: 4, center: { x: 5, y: 3, z: 5 } },
      { kind: 'hard', aId: 3, bId: 4 }, // no centre
    ];
    const { geschosse, ohneLage } = befundeJeGeschoss(befunde, [DECKE_EG, DECKE_OG, WAND, BALKEN]);
    assert.deepEqual(geschosse.get('EG').map((m) => m.nr), [1]);
    assert.deepEqual(geschosse.get('OG').map((m) => m.nr), [3]);
    assert.deepEqual(geschosse.get(OHNE_GESCHOSS).map((m) => m.nr), [2]);
    assert.equal(ohneLage, 1);
  });
});

describe('umrissFuerGeschoss', () => {
  // The raster (grundriss.js, 0.5 m cells) marks every cell a triangle touches, so
  // the outline lies up to half a cell outside: area between w·d and (w+0.5)·(d+0.5).
  const imRaster = (fl, w, d) => fl >= w * d - 1e-6 && fl <= (w + 0.5) * (d + 0.5) + 0.1;

  it('Deckenplatte des Geschosses, NICHT zentriert, Fläche 20 × 10 m bis auf eine Rasterzelle', () => {
    const u = umrissFuerGeschoss([DECKE_EG, DECKE_OG, WAND], 'EG');
    assert.ok(u);
    assert.equal(u.quelle, 'Deckenplatten');
    assert.ok(imRaster(u.flaeche, 20, 10), `Fläche ${u.flaeche}`);
    const xs = u.polygon.map((p) => p.x);
    assert.ok(Math.min(...xs) > -0.6 && Math.max(...xs) < 20.6, 'liegt im Weltsystem 0..20 m');
  });
  it('OG nimmt nur die OG-Platte (12 × 10 m)', () => {
    const u = umrissFuerGeschoss([DECKE_EG, DECKE_OG], 'OG');
    assert.ok(imRaster(u.flaeche, 12, 10), `Fläche ${u.flaeche}`);
  });
  it('ohne Decken: Rückfall auf die Hülle', () => {
    const u = umrissFuerGeschoss([WAND], 'EG');
    assert.equal(u.quelle, 'Hülle');
  });
  it('nichts Passendes: null', () => {
    assert.equal(umrissFuerGeschoss([BALKEN], 'EG'), null);
  });
});

describe('kartenModell / SVG', () => {
  it('Box umfasst Umriss und Marken plus Rand; schwerster Befund zuletzt', () => {
    const marken = [{ nr: 1, kind: 'hard', x: 4, z: 5 }, { nr: 2, kind: 'clearance', x: 25, z: 5 }];
    const m = kartenModell({ umriss: umrissFuerGeschoss([DECKE_EG], 'EG'), marken, geschoss: 'EG' });
    assert.ok(m.box.maxX >= 25 + RAND_M - 1e-9);
    assert.equal(m.marken.at(-1).kind, 'hard');
  });
  it('SVG trägt Umriss, je Marke Nummer und Art, Maßstab und Nordpfeil', () => {
    const befunde = clashPairs([WAND, BALKEN], { rules: [{ name: 'x', a: ['IFCWALL'], b: ['IFCBEAM'] }], tolerance: 0 }).clashes;
    assert.equal(befunde.length, 1);
    const { geschosse } = befundeJeGeschoss(befunde, [DECKE_EG, WAND, BALKEN]);
    const m = kartenModell({ umriss: umrissFuerGeschoss([DECKE_EG, WAND, BALKEN], 'EG'), marken: geschosse.get('EG'), geschoss: 'EG' });
    const svg = befundkarteSvg(m);
    assert.match(svg, /data-umriss="1"/);
    assert.match(svg, /data-marke="1" data-art="hard"/);
    assert.match(svg, />1<\/text>/);
    assert.match(svg, /data-massstab="/);
    assert.match(svg, /data-nord="1"/);
  });
  it('Umriss-Quelle reist ins Kartenmodell, der Hinweis nennt sie ehrlich', () => {
    const decke = kartenModell({ umriss: umrissFuerGeschoss([DECKE_EG], 'EG'), marken: [], geschoss: 'EG' });
    const huelle = kartenModell({ umriss: umrissFuerGeschoss([WAND], 'EG'), marken: [], geschoss: 'EG' });
    const ohne = kartenModell({ umriss: null, marken: [], geschoss: 'EG' });
    assert.equal(decke.umrissQuelle, 'Deckenplatten');
    assert.equal(huelle.umrissQuelle, 'Hülle');
    assert.equal(ohne.umrissQuelle, null);
    assert.match(umrissHinweis(decke.umrissQuelle), /Deckenplatten/);
    assert.match(umrissHinweis(huelle.umrissQuelle), /Gebäudehülle/);
    assert.doesNotMatch(umrissHinweis(huelle.umrissQuelle), /aus Deckenplatten/);
    assert.match(umrissHinweis(null), /kein Umriss/);
  });
  it('Geschossname wird im SVG maskiert', () => {
    const m = kartenModell({ marken: [], geschoss: '<EG & "1">' });
    assert.match(befundkarteSvg(m), /data-befundkarte="&lt;EG &amp; &quot;1&quot;&gt;"/);
  });
  it('Maßstabsbalken: runde Längen', () => {
    assert.equal(massstabsbalkenM(24), 2);
    assert.equal(massstabsbalkenM(60), 10);
    assert.equal(massstabsbalkenM(260), 50);
  });
  it('unbekannte Art bekommt den neutralen Stil', () => {
    assert.equal(stilVon('xyz').form, 'kreis');
  });
});
