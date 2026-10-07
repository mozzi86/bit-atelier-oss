// Phase 71-02 Tasks 1+2: BAP-Regeldatei, Toleranz je Regel, Containment-
// Näherungen, Koordinationskörper.
//
// Testmuster für die Geometrie: boxTris aus clash.js (Plan 71-02 Task 1:
// „exakt gleich groß → bestanden; 1 mm größer bei 2 mm Toleranz → bestanden;
// 3 mm größer → Befund mit abweichung_mm ≈ 3").

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  clashPairs, boxTris, containmentAbweichung, deckungAbweichung, STANDARD_REGELN,
} from '@ifc/lib/clash.js';
import {
  ladeRegelsatz, regelnZuOptionen, regelBeschreibung, ART_LABELS,
} from '@ifc/lib/clashRegeln.js';
import {
  findeKoordinationskoerper, vergleicheLage,
} from '@ifc/lib/koordinationskoerper.js';
import { NDA_FEHLT, ndaPfad } from '../../tools/nda.mjs';

// The real project's BAP rule file is customer material: since Plan 83-01 it
// lives in the NDA archive (tools/nda.mjs), the block below skips without it.
const BAP_DATEI = ndaPfad('rohbauBap');

/** Box-Element mit Quelle für die clashPairsIter-Form. */
function box(id, min, max, typ = 'IFCWALL', quelle = null, globalId = `G${id}`) {
  return {
    expressId: id,
    globalId,
    ifcType: typ,
    tris: boxTris(min, max),
    ...(quelle ? { quelle } : {}),
  };
}

describe('clashRegeln — die BAP-Regeldatei des Referenzprojekts (NDA-Archiv)', { skip: NDA_FEHLT }, () => {
  const json = JSON.parse(fs.readFileSync(BAP_DATEI, 'utf8'));
  const { regeln, koordination, warnungen } = ladeRegelsatz(json);

  it('19 Zeilen der BAP-Matrix: 18 Clash-Regeln + 1 Koordinationsregel', () => {
    assert.equal(regeln.length, 18);
    assert.ok(koordination, 'Koordinationsregel fehlt');
    assert.equal(koordination.toleranzMm, 0);
    assert.equal(warnungen.length, 0);
  });

  it('Toleranzen stehen in METERN in der clash-Form (mm in der Datei)', () => {
    const oeff = regeln.find((r) => r.id === 'OEFF-01');
    assert.equal(oeff.toleranzMm, 3);
    assert.equal(oeff.toleranz, 0.003);
    const balk01 = regeln.find((r) => r.id === 'BALK-01');
    assert.equal(balk01.toleranz, 0.002);
    const balk03 = regeln.find((r) => r.id === 'BALK-03');
    assert.equal(balk03.toleranz, 0.001);
  });

  it('jede Regel hat id/name/art/quellen/klassen + BAP-Belegzeile im hinweis', () => {
    for (const r of regeln) {
      assert.ok(r.id && r.name, 'id/name fehlen');
      assert.ok(['schnitt', 'enthalten', 'gefuellt', 'deckung'].includes(r.art), r.art);
      assert.ok(r.a.length && r.b.length, `${r.id}: leere Klassenliste`);
      assert.ok(r.a.every((k) => /^IFC/.test(k)), `${r.id}: Klassen nicht UPPERCASE`);
      assert.ok(/BAP/.test(r.hinweis || ''), `${r.id}: hinweis ohne BAP-Beleg`);
      assert.ok(r.aQuelle === 'A' || r.aQuelle === 'B');
    }
  });

  it('regelnZuOptionen reicht nur clash-verstehbare Arten durch', () => {
    const opt = regelnZuOptionen(regeln, { tolerance: 0.001 });
    assert.equal(opt.rules.length, 18);
    assert.equal(opt.tolerance, 0.001);
  });

  it('regelBeschreibung nennt die AABB-Näherung (T-71-05)', () => {
    const text = regelBeschreibung(regeln.find((r) => r.id === 'BALK-01'));
    assert.match(text, /enthalten \(AABB-Näherung\)/);
    assert.match(text, /± 2 mm/);
    assert.equal(ART_LABELS.ohne_partner, 'ohne Gegenstück');
  });
});

describe('clashRegeln — Validierung im Klartext (T-71-06)', () => {
  it('unbekannte Prüfart wird mit Regel-ID gemeldet', () => {
    assert.throws(
      () => ladeRegelsatz({ regeln: [{ id: 'X-1', name: 'x', art: 'zaubern',
        a: { klassen: ['IFCWALL'] }, b: { klassen: ['IFCSLAB'] } }] }),
      /Regel X-1.*'zaubern' unbekannt/,
    );
  });

  it('negative Toleranz, leere Klassen, Doppel-ID, Nicht-IFC-Klasse', () => {
    const basis = { id: 'X-1', name: 'x', art: 'schnitt',
      a: { klassen: ['IFCWALL'] }, b: { klassen: ['IFCSLAB'] } };
    assert.throws(() => ladeRegelsatz({ regeln: [{ ...basis, toleranzMm: -1 }] }),
      /X-1.*negativ/);
    assert.throws(() => ladeRegelsatz({ regeln: [{ ...basis, a: { klassen: [] } }] }),
      /X-1.*keine Klassen/);
    assert.throws(() => ladeRegelsatz({ regeln: [basis, basis] }), /doppelt/);
    assert.throws(() => ladeRegelsatz({ regeln: [{ ...basis, b: { klassen: ['Wand'] } }] }),
      /sieht nicht nach einer IFC-Klasse aus/);
    assert.throws(() => ladeRegelsatz({}), /'regeln'.*fehlt/);
  });
});

describe('clash.js — Toleranz je Regel und Quellen (71-02)', () => {
  it('Regel ohne toleranz nutzt die globale Option (Bestandsverhalten)', () => {
    // Zwei Boxen, die sich 0,5 mm tief schneiden — globale Toleranz 1 mm
    // filtert den Berührungsbefund, 0 mm lässt ihn durch.
    const a = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL');
    const b = box(2, [0.9995, 0, 0], [2, 1, 1], 'IFCBEAM');
    const rules = [{ name: 'x', a: ['IFCWALL'], b: ['IFCBEAM'] }];
    assert.equal(clashPairs([a, b], { rules, tolerance: 0.001 }).clashes.length, 0);
    assert.equal(clashPairs([a, b], { rules, tolerance: 0 }).clashes.filter((c) => c.kind === 'hard').length, 1);
  });

  it('Regel-toleranz schlägt die globale Option', () => {
    const a = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL');
    const b = box(2, [0.9995, 0, 0], [2, 1, 1], 'IFCBEAM'); // 0,5 mm Überlappung
    const rules = [{ name: 'x', a: ['IFCWALL'], b: ['IFCBEAM'], toleranz: 0.002 }];
    // global 0 (würde finden), regel-toleranz 2 mm (filtert) → kein Befund.
    assert.equal(clashPairs([a, b], { rules, tolerance: 0 }).clashes.length, 0);
  });

  it('aQuelle/bQuelle filtern auf je ein Modell', () => {
    const txWand = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL', 'A');
    const axStuetze = box(2, [0.5, 0.5, 0], [1.5, 1.5, 1], 'IFCCOLUMN', 'B');
    const axWand = box(3, [0, 0, 0], [1, 1, 1], 'IFCWALL', 'B'); // überlagert txWand
    const rules = [{ name: 'x', a: ['IFCWALL'], b: ['IFCCOLUMN'], aQuelle: 'A', bQuelle: 'B' }];
    const r = clashPairs([txWand, axStuetze, axWand], { rules, tolerance: 0.001 });
    // axWand (B) darf NICHT als a-Seite dienen — nur txWand (A).
    assert.equal(r.clashes.filter((c) => c.kind === 'hard').length, 1);
    assert.equal(r.clashes[0].aGuid, 'G1');
  });

  it('Duplikate nur INNERHALB einer Quelle', () => {
    // Dieselbe Box in A und B — gewollt (dasselbe Bauteil zweimal modelliert),
    // kein Duplikat-Befund. Zwei Kopien in A — Duplikat.
    const a1 = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL', 'A');
    const b1 = box(2, [0, 0, 0], [1, 1, 1], 'IFCWALL', 'B');
    const ohneRegeln = clashPairs([a1, b1], { rules: [], tolerance: 0.001 });
    assert.equal(ohneRegeln.clashes.filter((c) => c.kind === 'duplicate').length, 0);

    const a2 = box(3, [0.001, 0, 0], [1.001, 1, 1], 'IFCWALL', 'A');
    const mitDup = clashPairs([a1, a2], { rules: [], tolerance: 0.001 });
    assert.equal(mitDup.clashes.filter((c) => c.kind === 'duplicate').length, 1);
  });

  it('Elemente ohne quelle verhalten sich wie bisher (Bestand)', () => {
    const a1 = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL');
    const a2 = box(2, [0.001, 0, 0], [1.001, 1, 1], 'IFCWALL');
    const r = clashPairs([a1, a2], { rules: [], tolerance: 0.001 });
    assert.equal(r.clashes.filter((c) => c.kind === 'duplicate').length, 1);
  });
});

describe('clash.js — Containment/Deckung (die BAP-Prüfarten)', () => {
  const REGEL_ENTHALTEN = {
    id: 'T', name: 'enthalten', art: 'enthalten',
    a: ['IFCWALL'], b: ['IFCWALL'], aQuelle: 'A', bQuelle: 'B', toleranz: 0.002,
  };

  it('exakt gleich groß → kein Befund', () => {
    const a = box(1, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b = box(2, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    const r = clashPairs([a, b], { rules: [REGEL_ENTHALTEN], tolerance: 0.001 });
    assert.equal(r.clashes.filter((c) => c.kind === 'enthalten').length, 0);
  });

  it('1 mm größer bei 2 mm Toleranz → bestanden (kein Befund)', () => {
    // R-6 (Nacharbeit): EINE Seite um 1 mm — die alte symmetrische Box
    // (±0,5 mm) maß nur 0,5 mm und grenzte die 2-mm-Schwelle vierfach ab.
    const a = box(1, [-0.001, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b = box(2, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    const r = clashPairs([a, b], { rules: [REGEL_ENTHALTEN], tolerance: 0.001 });
    assert.equal(r.clashes.filter((c) => c.kind === 'enthalten').length, 0);
  });

  it('3 mm größer bei 2 mm Toleranz → Befund mit abweichung_mm ≈ 3', () => {
    // A ragt 3 mm über die B-Seite hinaus (eine Seite; größte Achsen-
    // überschreitung = 3 mm > 2 mm Toleranz → Befund, Plan-Verify 71-02 T1).
    const a = box(1, [-0.003, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b = box(2, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    const r = clashPairs([a, b], { rules: [REGEL_ENTHALTEN], tolerance: 0.001 });
    const befund = r.clashes.find((c) => c.kind === 'enthalten');
    assert.ok(befund, 'kein enthalten-Befund');
    assert.ok(Math.abs(befund.abweichungMm - 3) < 0.01,
      `abweichung_mm ${befund.abweichungMm} ≠ 3`);
    assert.equal(befund.regel.id, 'T');
    assert.equal(befund.toleranzMm, 2);
    assert.equal(befund.aQuelle, 'A');
  });

  it('beste Partner gewinnt: ein Element in zwei B-Boxen → minimale Abweichung', () => {
    // a ragt 5 mm über b1, passt aber exakt in b2 → kein Befund (bestes Match).
    const a = box(1, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b1 = box(2, [0.005, 0, 0], [0.995, 1, 3], 'IFCWALL', 'B');
    const b2 = box(3, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    const r = clashPairs([a, b1, b2], { rules: [REGEL_ENTHALTEN], tolerance: 0.001 });
    assert.equal(r.clashes.filter((c) => c.kind === 'enthalten').length, 0);
  });

  it('ohne Partner → kind ohne_partner (bId null)', () => {
    const a = box(1, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b = box(2, [50, 50, 50], [51, 51, 53], 'IFCWALL', 'B'); // weit weg
    const r = clashPairs([a, b], { rules: [REGEL_ENTHALTEN], tolerance: 0.001 });
    const ohne = r.clashes.filter((c) => c.kind === 'ohne_partner');
    assert.equal(ohne.length, 1);
    assert.equal(ohne[0].aGuid, 'G1');
    assert.equal(ohne[0].bId, null);
  });

  it('gefuellt: b ⊆ a — iteriert die B-Seite', () => {
    const regel = { ...REGEL_ENTHALTEN, id: 'G', art: 'gefuellt' };
    const rohbau = box(1, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const archGenau = box(2, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    assert.equal(
      clashPairs([rohbau, archGenau], { rules: [regel], tolerance: 0.001 })
        .clashes.filter((c) => c.kind === 'gefuellt').length, 0);

    const archGroesser = box(3, [-0.01, 0, 0], [1.01, 1, 3], 'IFCWALL', 'B'); // 10 mm über
    const r = clashPairs([rohbau, archGroesser], { rules: [regel], tolerance: 0.001 });
    const befund = r.clashes.find((c) => c.kind === 'gefuellt');
    assert.ok(befund, 'ARC-Wand ragt 10 mm aus der Rohbau-Wand → gefuellt-Befund fehlt');
    assert.ok(Math.abs(befund.abweichungMm - 10) < 0.01, `abweichung ${befund.abweichungMm}`);
    // R-2 (Nacharbeit): Seiten wie in der Regel — a* = Rohbau (A), b* = Architektur (B).
    assert.equal(befund.aQuelle, 'A');
    assert.equal(befund.bQuelle, 'B');
    assert.equal(befund.aGuid, 'G1');
    assert.equal(befund.bGuid, 'G3');
  });

  it('gefuellt ohne Gegenstück: das B-Element steht auf der b-Seite, a bleibt leer (R-2)', () => {
    const regel = { ...REGEL_ENTHALTEN, id: 'G', art: 'gefuellt' };
    const archAllein = box(7, [5, 5, 0], [6, 6, 3], 'IFCWALL', 'B');
    const rohbau = box(1, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const r = clashPairs([rohbau, archAllein], { rules: [regel], tolerance: 0.001 });
    const ohne = r.clashes.filter((c) => c.kind === 'ohne_partner');
    assert.equal(ohne.length, 1);
    assert.equal(ohne[0].aId, null);
    assert.equal(ohne[0].bGuid, 'G7');
    assert.equal(ohne[0].bQuelle, 'B');
  });

  it('Containment-Pass ist durch maxPairs gedeckelt (R-4)', () => {
    const elemente = [];
    for (let i = 0; i < 6; i++) {
      elemente.push(box(100 + i, [i * 2, 0, 0], [i * 2 + 1, 1, 3], 'IFCWALL', 'A'));
      elemente.push(box(200 + i, [i * 2 + 0.01, 0, 0], [i * 2 + 0.99, 1, 3], 'IFCWALL', 'B')); // A ragt 10 mm über
    }
    const voll = clashPairs(elemente, { rules: [REGEL_ENTHALTEN], tolerance: 0.001 });
    assert.equal(voll.uebersprungen, 0);
    assert.equal(voll.clashes.filter((c) => c.kind === 'enthalten').length, 6);
    const gedeckelt = clashPairs(elemente, { rules: [REGEL_ENTHALTEN], tolerance: 0.001, maxPairs: 2 });
    assert.equal(gedeckelt.clashes.filter((c) => c.kind === 'enthalten').length, 2);
    assert.equal(gedeckelt.uebersprungen, 4);
    assert.equal(gedeckelt.geprueft, 2);
  });

  it('deckung: 0,5 mm Versatz bei 0 mm Toleranz → Befund', () => {
    const regel = { id: 'D', name: 'deckung', art: 'deckung',
      a: ['IFCWINDOW'], b: ['IFCOPENINGELEMENT'], aQuelle: 'B', bQuelle: 'A', toleranz: 0 };
    const fenster = box(1, [0.0005, 0, 0], [1.0005, 0.1, 1], 'IFCWINDOW', 'B');
    const oeffnung = box(2, [0, 0, 0], [1, 0.1, 1], 'IFCOPENINGELEMENT', 'A');
    const r = clashPairs([fenster, oeffnung], { rules: [regel], tolerance: 0.001 });
    const befund = r.clashes.find((c) => c.kind === 'deckung');
    assert.ok(befund, 'Deckungs-Befund fehlt');
    assert.ok(Math.abs(befund.abweichungMm - 0.5) < 0.01, `abweichung ${befund.abweichungMm}`);
  });

  it('deterministisch: Doppellauf byte-identisch (JSON)', () => {
    const a = box(1, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b1 = box(2, [0.005, 0, 0], [0.995, 1, 3], 'IFCWALL', 'B');
    const b2 = box(3, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    const opt = { rules: [REGEL_ENTHALTEN], tolerance: 0.001 };
    assert.equal(
      JSON.stringify(clashPairs([a, b1, b2], opt)),
      JSON.stringify(clashPairs([a, b1, b2], opt)),
    );
  });

  it('STANDARD_REGELN unverändert nutzbar (keine art-Felder nötig)', () => {
    const a = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL');
    const b = box(2, [0.5, 0.5, 0.5], [2, 2, 2], 'IFCBEAM');
    const r = clashPairs([a, b], { rules: STANDARD_REGELN, tolerance: 0.001 });
    assert.equal(r.clashes.filter((c) => c.kind === 'hard').length, 1);
  });
});

describe('containmentAbweichung / deckungAbweichung (rein)', () => {
  const boxA = { min: [0, 0, 0], max: [1, 1, 1] };
  it('innen → 0, außen → größte Überschreitung', () => {
    assert.equal(containmentAbweichung(boxA, boxA), 0);
    assert.equal(containmentAbweichung({ min: [0.1, 0.1, 0.1], max: [0.9, 0.9, 0.9] }, boxA), 0);
    assert.equal(containmentAbweichung({ min: [-0.002, 0, 0], max: [1.001, 1, 1] }, boxA), 0.002);
  });
  it('deckung: max Grenzdifferenz', () => {
    assert.equal(deckungAbweichung(boxA, boxA), 0);
    assert.equal(deckungAbweichung({ min: [0.0005, 0, 0], max: [1.0005, 1, 1] }, boxA), 0.0005);
  });
});

describe('koordinationskoerper.js', () => {
  const koerper = (name, min, max) => ({
    expressId: 1, globalId: 'G1', ifcType: 'IfcSite', name,
    aabb: { min, max },
  });

  it('Name gewinnt: „RKW_Koordinationskörper-…" wird gefunden', () => {
    const elemente = [
      koerper('Referenzprojekt Rohbau', [0, 0, 0], [100, 100, 100]),
      koerper('RKW_Koordinationskörper-3912985', [-1, -1, -1], [1, 1, 1]),
    ];
    const k = findeKoordinationskoerper(elemente);
    assert.match(k.name, /Koordinationskörper/);
  });

  it('Fallback: kleinster IfcSite mit Geometrie', () => {
    const elemente = [
      koerper('Grundstück', [0, 0, 0], [100, 100, 100]),
      { ...koerper('Unbenannt', [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]), name: 'xyz' },
    ];
    const k = findeKoordinationskoerper(elemente);
    assert.equal(k.name, 'xyz');
  });

  it('zwei identische Körper → Abweichung 0 mm, bestanden', () => {
    const a = koerper('K', [0, 0, -10], [2, 2, -8]);
    const b = koerper('K', [0, 0, -10], [2, 2, -8]);
    const r = vergleicheLage(a, b, 0);
    assert.equal(r.maxMm, 0);
    assert.equal(r.bestanden, true);
    assert.deepEqual(r.abweichungMm, { x: 0, y: 0, z: 0 });
  });

  it('Float32-Rauschen (0,019 mm, am echten Paar gemessen) ist kein Befund', () => {
    // MESSBODEN_MM 0,05: die gemessene Differenz der Referenzmodelle bei
    // geometrisch gleicher Lage (referenz-modelle.test.js, 10.09.2026).
    const a = koerper('K', [0, 0, -10], [2, 2, -8]);
    const b = koerper('K', [0.000019, 0, -10], [2.000019, 2, -8]);
    const r = vergleicheLage(a, b, 0);
    assert.equal(r.maxMm, 0.019);
    assert.equal(r.bestanden, true);
  });

  it('1,5 m in z versetzt (der RESEARCH-Befund) → 1500 mm, nicht bestanden', () => {
    const a = koerper('K', [0, 0, -10.8], [2, 2, -8.8]);  // TX-Placement z
    const b = koerper('K', [0, 0, -9.3], [2, 2, -7.3]);   // AX-Placement z
    const r = vergleicheLage(a, b, 0);
    assert.equal(r.maxMm, 1500);
    assert.equal(r.abweichungMm.z, 1500);
    assert.equal(r.bestanden, false);
    assert.match(r.grund, /1500 mm/);
  });

  it('fehlender Körper → bestanden null mit Grund (offener Befund)', () => {
    const a = koerper('K', [0, 0, 0], [1, 1, 1]);
    const r = vergleicheLage(a, null, 0);
    assert.equal(r.bestanden, null);
    assert.match(r.grund, /in Modell B nicht gefunden/);
    const r2 = vergleicheLage(null, null, 0);
    assert.match(r2.grund, /A und B/);
  });
});
