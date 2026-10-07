// Phase 71-03 Task 1: Modelllieferplan — Soll/Ist, Vorlage nach LV-Position Modelllieferung,
// Übergabeprotokoll.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  leeresLieferungLayer, normalisiereLayer, lieferungAnlegen, lieferungAendern,
  lieferungLoeschen, markiereGeliefert, planVorlage, sollIst, naechsteLieferung,
  protokollText, tageZwischen, plusTage, datumText, FACHSICHT_DEFAULT,
} from '@ifc/lib/lieferplan.js';

const HEUTE = '2026-10-01';

describe('lieferplan.js — Datum', () => {
  it('tageZwischen/plusTage rechnen in UTC-Tagen', () => {
    assert.equal(tageZwischen('2026-03-28', '2026-03-30'), 2); // über die Sommerzeit-Umstellung
    assert.equal(tageZwischen('2026-10-05', '2026-10-01'), -4);
    assert.equal(plusTage('2026-02-27', 2), '2026-03-01');
    assert.equal(datumText('2026-10-01'), '01.10.2026');
    assert.equal(datumText(null), '—');
  });
});

describe('lieferplan.js — Layer', () => {
  it('leerer Layer hat Fachsicht TX und keine Lieferungen', () => {
    assert.deepEqual(leeresLieferungLayer(), { fachsicht: 'TX', lieferungen: [] });
    assert.equal(FACHSICHT_DEFAULT, 'TX');
  });

  it('normalisiereLayer repariert fremde Werte', () => {
    const l = normalisiereLayer({ fachsicht: 'xx', lieferungen: [{ termin: 'kein datum', log: 999, status: 'egal' }, null] });
    assert.equal(l.fachsicht, 'TX');
    assert.equal(l.lieferungen.length, 1);
    assert.equal(l.lieferungen[0].termin, null);
    assert.equal(l.lieferungen[0].log, 300);
    assert.equal(l.lieferungen[0].status, 'geplant');
  });

  it('anlegen/ändern/löschen sind immutable und nummerieren fortlaufend', () => {
    const a = lieferungAnlegen(null, { termin: '2026-10-15', bauabschnitt: 'BA1', log: 400 });
    assert.equal(a.lieferung.nr, 1);
    const b = lieferungAnlegen(a.layer, { termin: '2026-11-01' });
    assert.equal(b.lieferung.nr, 2);
    assert.equal(a.layer.lieferungen.length, 1, 'Ausgangslayer unverändert');
    const c = lieferungAendern(b.layer, a.lieferung.id, { bauabschnitt: 'BA1-neu' });
    assert.equal(c.lieferungen[0].bauabschnitt, 'BA1-neu');
    assert.equal(b.layer.lieferungen[0].bauabschnitt, 'BA1');
    const d = lieferungLoeschen(c, b.lieferung.id);
    assert.equal(d.lieferungen.length, 1);
  });

  it('markiereGeliefert setzt geplant → geliefert mit Datum und Dateiname, späteren Status nicht zurück', () => {
    const { layer, lieferung } = lieferungAnlegen(null, { termin: '2026-10-15' });
    const g = markiereGeliefert(layer, lieferung.id, { dateiname: 'P5_24680-01_TX_FM_XX_P_01.ifc', datum_ist: '2026-10-14' });
    assert.equal(g.lieferungen[0].status, 'geliefert');
    assert.equal(g.lieferungen[0].datum_ist, '2026-10-14');
    assert.equal(g.lieferungen[0].dateiname, 'P5_24680-01_TX_FM_XX_P_01.ifc');
    const f = lieferungAendern(g, lieferung.id, { status: 'freigegeben' });
    const g2 = markiereGeliefert(f, lieferung.id, { dateiname: 'P5_24680-01_TX_FM_XX_P_02.ifc', datum_ist: '2026-10-20' });
    assert.equal(g2.lieferungen[0].status, 'freigegeben');
    assert.equal(g2.lieferungen[0].dateiname, 'P5_24680-01_TX_FM_XX_P_02.ifc');
  });

  it('planVorlage: LoG 300 +4 Wochen, LoG 400 je BA −3 Wochen, LoG 500 +4 Wochen nach Rohbauende', () => {
    const l = planVorlage(null, {
      beauftragung: '2026-09-01',
      bauabschnitte: [{ name: 'BA1 Bodenplatte', produktionsbeginn: '2026-11-02' }, { name: 'BA2', produktionsbeginn: '2027-01-11' }],
      rohbauende: '2027-06-30',
    });
    assert.equal(l.lieferungen.length, 4);
    assert.deepEqual(l.lieferungen.map((x) => [x.log, x.termin]), [
      [300, '2026-09-29'], [400, '2026-10-12'], [400, '2026-12-21'], [500, '2027-07-28'],
    ]);
    assert.equal(l.lieferungen[1].bauabschnitt, 'BA1 Bodenplatte');
  });
});

describe('lieferplan.js — Soll/Ist', () => {
  function drei() {
    let { layer } = lieferungAnlegen(null, { termin: '2026-09-20', log: 300 }); // überfällig 11 Tage
    layer = lieferungAnlegen(layer, { termin: '2026-10-05', log: 400 }).layer; // in 4 Tagen → gelb
    layer = lieferungAnlegen(layer, { termin: '2026-12-01', log: 500 }).layer; // weit → grün
    return layer;
  }

  it('Verzug in Tagen zu fixem heute, Ampel rot/gelb/grün, sortiert nach Termin', () => {
    const s = sollIst(drei(), HEUTE);
    assert.deepEqual(s.map((l) => l.termin), ['2026-09-20', '2026-10-05', '2026-12-01']);
    assert.equal(s[0].faellig, true);
    assert.equal(s[0].verzug_tage, 11);
    assert.equal(s[0].ampel, 'rot');
    assert.equal(s[1].faellig, false);
    assert.equal(s[1].verzug_tage, 0);
    assert.equal(s[1].ampel, 'gelb');
    assert.equal(s[2].ampel, 'gruen');
  });

  it('gelieferte Lieferung: Verzug = Ist − Soll, nie fällig', () => {
    const l0 = drei();
    const g = markiereGeliefert(l0, l0.lieferungen[0].id, { dateiname: 'x.ifc', datum_ist: '2026-09-23' });
    const s = sollIst(g, HEUTE);
    assert.equal(s[0].status, 'geliefert');
    assert.equal(s[0].verzug_tage, 3);
    assert.equal(s[0].faellig, false);
    assert.equal(s[0].ampel, 'rot');
    const p = markiereGeliefert(l0, l0.lieferungen[0].id, { dateiname: 'x.ifc', datum_ist: '2026-09-19' });
    assert.equal(sollIst(p, HEUTE)[0].ampel, 'gruen');
  });

  it('ohne Termin: grau, kein Verzug', () => {
    const { layer } = lieferungAnlegen(null, {});
    const s = sollIst(layer, HEUTE);
    assert.equal(s[0].ampel, 'grau');
    assert.equal(s[0].verzug_tage, 0);
  });

  it('naechsteLieferung: die früheste offene — überfällige zuerst; null wenn alles geliefert', () => {
    const l0 = drei();
    assert.equal(naechsteLieferung(l0, HEUTE).termin, '2026-09-20');
    let alle = l0;
    for (const l of l0.lieferungen) alle = markiereGeliefert(alle, l.id, { dateiname: 'x.ifc', datum_ist: HEUTE });
    assert.equal(naechsteLieferung(alle, HEUTE), null);
  });
});

describe('lieferplan.js — Übergabeprotokoll', () => {
  it('enthält alle Pflichtfelder, den Hinweis an den AG, nicht die interne Bemerkung', () => {
    const { layer, lieferung } = lieferungAnlegen(null, {
      termin: '2026-10-15', bauabschnitt: 'BA1 Bodenplatte', log: 400,
      bemerkung: 'INTERN: Nachtrag noch offen', hinweis_ag: 'Aussparungen TGA noch ohne Freigabe',
    });
    const text = protokollText({
      projekt: { name: 'Referenzprojekt Rohbau', bauherr: 'Bauamt Beispielstadt', nummer: '24680' },
      lieferung: sollIst(layer, HEUTE)[0],
      modell: {
        dateiname: 'P5_24680-01_TX_FM_XX_P_01.ifc', dateinameOriginal: 'P5_24680-01_TX_FM_XX_V_01_--.ifc',
        schema: 'IFC4', geschosse: ['EG', '1.OG'], klassen: { IFCWALL: 120, IFCSLAB: 14 }, bytes: 123456,
      },
      pruefung: {
        ids: { bestanden: 5, verletzt: 2 }, clash: { befunde: 3, geprueft: 4000, uebersprungen: 12 },
        koordination: { bestanden: true, maxMm: 0.02 },
        warnungen: ['Freitext „--": Binde-/Unterstriche sind laut Namenskonvention verboten'],
      },
      herkunft: 'geladene Datei, kein Neu-Export (Stufe A)',
      pruefer: 'BIT-Atelier',
      erzeugt: '2026-10-01T08:30:00.000Z',
      hashes: [{ name: 'P5_24680-01_TX_FM_XX_P_01.ifc', sha256: 'abc123' }],
    });
    void lieferung;
    for (const muss of [
      '# Übergabeprotokoll Modelllieferung',
      'Erzeugt: 2026-10-01 08:30 UTC · Prüfer: BIT-Atelier',
      '| Projekt | Referenzprojekt Rohbau |',
      '| Bauherr | Bauamt Beispielstadt |',
      '| Lieferung Nr. | 1 |',
      '| Bauabschnitt | BA1 Bodenplatte |',
      '| LoG | 400 |',
      '| Termin (Soll) | 15.10.2026 |',
      '| Geliefert (Ist) | 01.10.2026 |',
      '| Status | geplant |',
      '| Hinweis an den AG | Aussparungen TGA noch ohne Freigabe |',
      '| Dateiname (Namenskonvention) | P5_24680-01_TX_FM_XX_P_01.ifc |',
      '| Ausgangsdatei | P5_24680-01_TX_FM_XX_V_01_--.ifc |',
      '| IFC-Schema | IFC4 |',
      '| Geschosse | 2 |',
      '| Herkunft | geladene Datei, kein Neu-Export (Stufe A) |',
      '| IFCWALL | 120 |',
      '| IDS bestanden / verletzt | 5 / 2 |',
      '| Kollisions-Befunde | 3 |',
      '| Übersprungen (Cap) | 12 |',
      '| Koordinationskörper | Lage bestätigt (max. 0.02 mm) |',
      '- Freitext „--"',
      '| P5_24680-01_TX_FM_XX_P_01.ifc | abc123 |',
    ]) {
      assert.ok(text.includes(muss), `fehlt im Protokoll: ${muss}`);
    }
    assert.ok(!text.includes('INTERN'), 'interne Bemerkung darf nicht ins Protokoll (T-71-12)');
  });

  it('ohne Lieferung und ohne Koordination bleibt der Text vollständig', () => {
    const text = protokollText({ modell: { dateiname: 'a.ifc' }, pruefung: {}, herkunft: 'x', pruefer: 'y' });
    assert.ok(text.includes('| Lieferung Nr. | — |'));
    assert.ok(text.includes('| Koordinationskörper | nicht geprüft (Ein-Modell-Lauf) |'));
  });
});
