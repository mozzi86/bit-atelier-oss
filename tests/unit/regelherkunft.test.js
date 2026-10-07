// 66-07 (register no. 80): the origin of a rule travels into the finding.
// Data source: the reference project's BAP rule file in the NDA archive
// (tools/nda.mjs key `rohbauBap`; file field `quelle`, per-rule `hinweis` with
// page prefix). Nothing may be invented when the prefix is missing; findings
// without a rule keep their old shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { clashPairs, boxTris, regelKurz } from '@ifc/lib/clash.js';
import { ladeRegelsatz, grundlageAus, grundlageText } from '@ifc/lib/clashRegeln.js';
import { evaluateIds } from '@ifc/lib/ids.js';
import { NDA_FEHLT, ndaPfad } from '../../tools/nda.mjs';

// The real BAP rule file is customer material (NDA archive since Plan 83-01).
const BAP_PFAD = ndaPfad('rohbauBap');
const BAP = BAP_PFAD ? JSON.parse(fs.readFileSync(BAP_PFAD, 'utf8')) : null;

function box(id, min, max, typ, quelle = null) {
  return { expressId: id, globalId: `G${id}`, ifcType: typ, tris: boxTris(min, max), ...(quelle ? { quelle } : {}) };
}

describe('grundlageAus — Ableitung aus dem Hinweis', () => {
  it('echte BAP-Datei: jede Regel trägt das Dokument der Datei', { skip: NDA_FEHLT }, () => {
    const { regeln, koordination } = ladeRegelsatz(BAP);
    for (const r of [...regeln, koordination]) {
      assert.equal(r.grundlage.dokument, BAP.quelle, r.id);
      assert.ok(r.grundlage.stelle, `${r.id}: Stelle fehlt`);
    }
    assert.equal(koordination.grundlage.stelle, 'BAP S. 23');
    assert.equal(koordination.grundlage.abschnitt, null);
  });

  it('Abschnittsname vor dem Doppelpunkt wird eigenes Feld', () => {
    const g = grundlageAus({ hinweis: 'BAP S. 23 Balken: ‚Rohbaukomponenten sind …‘' }, { quelle: 'BAP' });
    assert.equal(g.stelle, 'BAP S. 23');
    assert.equal(g.abschnitt, 'Balken');
    assert.equal(g.text, '‚Rohbaukomponenten sind …‘');
  });

  it('Seitenbereich mit Bindestrich', () => {
    const g = grundlageAus({ hinweis: 'BAP S. 23-24 Decken: Text' }, { quelle: 'X' });
    assert.equal(g.stelle, 'BAP S. 23-24');
    assert.equal(g.abschnitt, 'Decken');
  });

  it('Hinweis ohne Seitenpräfix: Stelle bleibt null, Text bleibt erhalten', () => {
    const g = grundlageAus({ hinweis: 'frei formuliert' }, { name: 'Eigene Regeln' });
    assert.equal(g.stelle, null);
    assert.equal(g.text, 'frei formuliert');
    assert.equal(g.dokument, 'Eigene Regeln');
  });

  it('ohne Hinweis und ohne Quelle: alles null, nichts erfunden', () => {
    const g = grundlageAus({}, {});
    assert.deepEqual(g, { dokument: null, fassung: null, stelle: null, abschnitt: null, text: null });
    assert.equal(grundlageText(g), '');
  });

  it('Feld grundlage der Regel überschreibt feldweise', () => {
    const g = grundlageAus(
      { hinweis: 'BAP S. 23: Text', grundlage: { fassung: '3.2 vom 14.03.2026', stelle: 'S. 23, Zeile 7' } },
      { quelle: 'BAP Projekt Rohbau' });
    assert.equal(g.dokument, 'BAP Projekt Rohbau');
    assert.equal(g.fassung, '3.2 vom 14.03.2026');
    assert.equal(g.stelle, 'S. 23, Zeile 7');
    assert.equal(g.text, 'Text');
  });

  it('grundlageText: eine Zeile, mit und ohne Anforderungstext', () => {
    const g = { dokument: 'BAP', fassung: '3.2', stelle: 'S. 23', abschnitt: 'Balken', text: 'Toleranz 0' };
    assert.equal(grundlageText(g), 'BAP (3.2), S. 23 Balken — Toleranz 0');
    assert.equal(grundlageText(g, { mitText: false }), 'BAP (3.2), S. 23 Balken');
  });
});

describe('clash.js — die Regel reist in den Befund', () => {
  const REGEL = {
    id: 'R-1', name: 'Wand gegen Balken', art: 'schnitt', a: ['IFCWALL'], b: ['IFCBEAM'],
    toleranz: 0, hinweis: 'BAP S. 23: kreuzungsfrei',
    grundlage: grundlageAus({ hinweis: 'BAP S. 23: kreuzungsfrei' }, { quelle: 'BAP' }),
  };
  const wand = () => box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL');
  const balken = () => box(2, [0.5, 0, 0], [2, 1, 1], 'IFCBEAM');

  it('harte Kollision aus einer Regel trägt Regel, Grundlage und Toleranz', () => {
    const [c] = clashPairs([wand(), balken()], { rules: [REGEL], tolerance: 0 }).clashes.filter((x) => x.kind === 'hard');
    assert.ok(c, 'keine harte Kollision');
    assert.equal(c.regel.id, 'R-1');
    assert.equal(c.regel.grundlage.stelle, 'BAP S. 23');
    assert.equal(c.toleranzMm, 0);
  });

  it('bei zwei Regeln für dasselbe Paar gewinnt die erste', () => {
    const zweite = { ...REGEL, id: 'R-2', name: 'zweite' };
    const [c] = clashPairs([wand(), balken()], { rules: [REGEL, zweite], tolerance: 0 }).clashes.filter((x) => x.kind === 'hard');
    assert.equal(c.regel.id, 'R-1');
  });

  it('Abstandsbefund aus derselben Regel trägt KEINE Regel — der Mindestabstand kommt aus der UI', () => {
    // Beam 0.05 m beside the wall, no overlap; clearance 0.1 m is the UI setting.
    const nah = box(3, [1.05, 0, 0], [2, 1, 1], 'IFCBEAM');
    const [c] = clashPairs([wand(), nah], { rules: [REGEL], tolerance: 0, clearance: 0.1 }).clashes.filter((x) => x.kind === 'clearance');
    assert.ok(c, 'kein Abstandsbefund');
    assert.equal('regel' in c, false);
    assert.equal('toleranzMm' in c, false);
  });

  it('Regel ohne ID (Standardregeln): Befund bleibt ohne Feld regel', () => {
    const ohneId = { name: 'x', a: ['IFCWALL'], b: ['IFCBEAM'] };
    const [c] = clashPairs([wand(), balken()], { rules: [ohneId], tolerance: 0 }).clashes.filter((x) => x.kind === 'hard');
    assert.equal('regel' in c, false);
    assert.equal('toleranzMm' in c, false);
  });

  it('Duplikat bleibt ohne Regel', () => {
    const a = box(1, [0, 0, 0], [1, 1, 1], 'IFCWALL');
    const b = box(2, [0.001, 0, 0], [1.001, 1, 1], 'IFCWALL');
    const [d] = clashPairs([a, b], { rules: [REGEL], tolerance: 0 }).clashes.filter((x) => x.kind === 'duplicate');
    assert.ok(d);
    assert.equal('regel' in d, false);
  });

  it('Containment-Befund trägt Grundlage (BAP-Prüfart enthalten)', () => {
    const enthalten = { ...REGEL, id: 'E-1', art: 'enthalten', a: ['IFCWALL'], b: ['IFCWALL'], aQuelle: 'A', bQuelle: 'B', toleranz: 0.002 };
    const a = box(1, [-0.01, 0, 0], [1, 1, 3], 'IFCWALL', 'A');
    const b = box(2, [0, 0, 0], [1, 1, 3], 'IFCWALL', 'B');
    const [c] = clashPairs([a, b], { rules: [enthalten], tolerance: 0.001 }).clashes.filter((x) => x.kind === 'enthalten');
    assert.ok(c, 'kein enthalten-Befund');
    assert.equal(c.regel.id, 'E-1');
    assert.equal(c.regel.grundlage.dokument, 'BAP');
  });

  it('regelKurz: null bleibt null', () => {
    assert.equal(regelKurz(null), null);
  });
});

describe('IDS: Grundlage der Spezifikation überlebt die Auswertung', () => {
  // parseIdsXml needs a DOMParser (not in Node) — the spec is built by hand in the same
  // shape it produces: description → beschreibung, instructions → hinweise.
  const spec = {
    name: 'Wände mit Brandschutz', kardinalitaet: 'required',
    beschreibung: 'LOI-Tabelle des Auftraggebers (Stand 07.08.2026), Blatt 3', hinweise: 'Pset_WallCommon.FireRating',
    applicability: [], requirements: [],
  };
  it('beschreibung und hinweise stehen im Ergebnis — BCF nennt sie als „Grundlage:“', () => {
    const [r] = evaluateIds([spec], []);
    assert.equal(r.bestanden, false);
    assert.equal(r.spec.beschreibung, 'LOI-Tabelle des Auftraggebers (Stand 07.08.2026), Blatt 3');
    assert.equal(r.spec.hinweise, 'Pset_WallCommon.FireRating');
  });
  it('ohne Angaben: null, nichts erfunden', () => {
    const [r] = evaluateIds([{ ...spec, beschreibung: undefined, hinweise: '' }], []);
    assert.equal(r.spec.beschreibung, null);
    assert.equal(r.spec.hinweise, null);
  });
});
