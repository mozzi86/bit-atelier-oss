// 99-01…03: apartment as stored object (candidates from workshop and bars, match with stable
// numbers and reported deviations), equipment catalogue + special request (severity →
// approvals, status chain, sampling hand-over) and the decision deadline from the schedule
// (start of trade − 4 weeks, lights, moves with the schedule).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  kandidatenAusWerkstatt, kandidatenAusRiegel, kandidatenAusModell, abgleichen, abgleichPlan,
  abgleichMeldungen, naechsteWohnungNr, geschossLabel, zimmerAusName, ueberlappung, ueberlappungMasse, planRahmen, wohnungPatch, planTransform,
} from '@/lib/werkplanung/wohneinheiten.js';
import {
  wirksameSchwere, noetigeFreigaben, offeneFreigaben, schwereAusText, neueKatalogOption, katalogHinweise,
  neuerSonderwunsch, pruefungPatch, angebotPatch, kaeuferEntscheidungPatch, einarbeitungPatch, abnahmePatch,
  sonderwunschHinweise, summeWohnung, naechsteNr, gewerkLabel, zahl,
} from '@/lib/werkplanung/sonderwunsch.js';
import {
  FRIST_VORLAUF_TAGE, fristFuer, gehoertZuGewerk, ampelSonderwunsch, schlechteste, fristenDerWuensche, fristMatrix, plusTageIso,
} from '@/lib/werkplanung/sonderwunschFrist.js';
import { bemusterungAusSonderwunsch, bemusterungsProtokollPdf, neueBemusterung, istProjektMuster } from '@/lib/werkplanung/bemusterung.js';
import { tesseliere } from '@designer/lib/tesselierung.js';
import { WERKSTATT_DEFAULT, einheitenAnreichern } from '@designer/lib/werkstattDefaults.js';

const FP = [{ x: -15, z: -6 }, { x: 15, z: -6 }, { x: 15, z: 6 }, { x: -15, z: 6 }];
const werkstatt = (fp = FP, storeys = 3) => tesseliere({ footprintM: fp, storeys, typ: 'mittelflur', einheiten: einheitenAnreichern(WERKSTATT_DEFAULT.einheiten), raumzonen: true });
/** Stored rows from a plan (ids added like the server does). */
const speichern = (plan) => plan.anlegen.map((r, i) => ({ ...r, id: `w${i + 1}` }));

describe('99-01 Wohnung als gespeichertes Objekt', () => {
  it('candidates from the workshop: one per unit, outline, type name, rooms', () => {
    const k = kandidatenAusWerkstatt(werkstatt(), einheitenAnreichern(WERKSTATT_DEFAULT.einheiten));
    assert.equal(k.length, 12);
    assert.equal(k[0].quelle, 'werkstatt');
    assert.equal(k[0].quelle_ref, 'WE 0-1');
    assert.equal(k[0].typ, '2-Zimmer-Wohnung');
    assert.equal(k[0].zimmer, 2);
    assert.ok(k[0].umriss.length >= 4);
    assert.ok(Math.abs(k[0].flaeche_m2 - 62.9) < 0.01);
    assert.deepEqual([...new Set(k.map((x) => x.geschoss))], [0, 1, 2]);
  });

  it('candidates from a bar: units × storeys, rooms from the type, corner unit without rooms', () => {
    const k = kandidatenAusRiegel([{ id: 'r1-1', pfad: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }], opt: { geschosse: 2 } }]);
    assert.ok(k.length > 0 && k.length % 2 === 0);
    assert.equal(k.filter((x) => x.geschoss === 0).length, k.length / 2);
    assert.ok(k.some((x) => x.typ === 'Ecke' && x.zimmer === null));
    assert.ok(k.every((x) => x.quelle === 'riegel' && /^r1-1\|\d\|\d+$/.test(x.quelle_ref)));
    assert.deepEqual(kandidatenAusRiegel([{ id: 'kaputt', pfad: [{ x: 0, y: 0 }] }]), []);
  });

  it('candidates from the BimModel: workshop only when applied, bars always', () => {
    const modell = { footprintM: FP, storeys: 2, storeyHeight: 3, werkstatt_layer: { ...WERKSTATT_DEFAULT, angewendet: false } };
    assert.equal(kandidatenAusModell(modell).length, 0);
    assert.equal(kandidatenAusModell({ ...modell, werkstatt_layer: { ...WERKSTATT_DEFAULT, angewendet: true } }).length, 8);
    assert.deepEqual(kandidatenAusModell(null), []);
  });

  it('first take-over: stable numbers W-001… in storey order, status frei', () => {
    const k = kandidatenAusWerkstatt(werkstatt());
    const plan = abgleichPlan(abgleichen([], k), { projectId: 'p', alle: [], jetzt: new Date('2026-10-21T10:00:00Z') });
    assert.equal(plan.anlegen.length, 12);
    assert.deepEqual(plan.anlegen.slice(0, 2).map((r) => r.nr), ['W-001', 'W-002']);
    assert.equal(plan.anlegen[11].nr, 'W-012');
    assert.ok(plan.anlegen.every((r) => r.status === 'frei' && r.entfallen === false && r.project_id === 'p'));
    assert.ok(plan.anlegen.slice(0, 4).every((r) => r.geschoss === 0));
  });

  it('the same model again: everything equal, numbers stay, nothing new', () => {
    const k = kandidatenAusWerkstatt(werkstatt());
    const bestand = speichern(abgleichPlan(abgleichen([], k), { projectId: 'p', alle: [] }));
    const e = abgleichen(bestand, kandidatenAusWerkstatt(werkstatt()));
    assert.equal(e.gleich.length, 12);
    assert.equal(e.neu.length + e.geaendert.length + e.entfallen.length, 0);
  });

  it('a re-cut keeps numbers and reports deviations; sold units warn', () => {
    const bestand = speichern(abgleichPlan(abgleichen([], kandidatenAusWerkstatt(werkstatt())), { projectId: 'p', alle: [] }));
    bestand[0].status = 'verkauft';
    // 2 m longer building: every unit grows, positions shift a little.
    const breiter = [{ x: -16, z: -6 }, { x: 16, z: -6 }, { x: 16, z: 6 }, { x: -16, z: 6 }];
    const e = abgleichen(bestand, kandidatenAusWerkstatt(werkstatt(breiter)));
    assert.equal(e.neu.length, 0);
    assert.equal(e.entfallen.length, 0);
    assert.ok(e.geaendert.length > 0);
    const w1 = e.geaendert.find((g) => g.wohnung.nr === 'W-001');
    assert.ok(w1, 'W-001 still matched');
    assert.ok(w1.abweichungen.some((a) => a.feld === 'flaeche_m2'));
    const meldungen = abgleichMeldungen(e);
    assert.equal(meldungen[0].stufe, 'warn');
    assert.equal(meldungen[0].nr, 'W-001');
    assert.match(meldungen[0].text, /Fläche/);
    const plan = abgleichPlan(e, { projectId: 'p', alle: bestand });
    assert.equal(plan.anlegen.length, 0);
    const p1 = plan.aendern.find((a) => a.id === bestand[0].id);
    assert.ok(p1 && !('status' in p1.patch) && !('nr' in p1.patch), 'sales data and number untouched');
  });

  it('fewer storeys: units drop out (kept, marked), numbers are never reused', () => {
    const bestand = speichern(abgleichPlan(abgleichen([], kandidatenAusWerkstatt(werkstatt())), { projectId: 'p', alle: [] }));
    const e = abgleichen(bestand, kandidatenAusWerkstatt(werkstatt(FP, 2)));
    assert.equal(e.entfallen.length, 4);
    assert.ok(e.entfallen.every((w) => w.geschoss === 2));
    const plan = abgleichPlan(e, { projectId: 'p', alle: bestand });
    assert.equal(plan.aendern.filter((a) => a.patch.entfallen === true).length, 4);
    const nachher = bestand.map((w) => ({ ...w, ...(plan.aendern.find((a) => a.id === w.id)?.patch || {}) }));
    // Back to three storeys: the dropped units come back with their old numbers.
    const zurueck = abgleichen(nachher, kandidatenAusWerkstatt(werkstatt()));
    assert.equal(zurueck.neu.length, 0);
    assert.equal(zurueck.geaendert.filter((g) => g.abweichungen.some((a) => a.feld === 'entfallen')).length, 4);
    assert.equal(naechsteWohnungNr(nachher), 'W-013');
  });

  it('helpers: storey label, rooms from name, overlap, plan frame', () => {
    assert.equal(geschossLabel(0), 'EG');
    assert.equal(geschossLabel(2), '2. OG');
    assert.equal(geschossLabel(-1), '1. UG');
    assert.equal(zimmerAusName('3-Zimmer-Wohnung'), 3);
    assert.equal(zimmerAusName('2-Zi'), 2);
    assert.equal(zimmerAusName('Ecke'), null);
    const q = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    assert.equal(ueberlappung(q, q), 1);
    assert.equal(ueberlappung(q, q.map((p) => ({ x: p.x + 2, y: p.y }))), 0.5);
    assert.equal(ueberlappung(q, []), 0);
    assert.deepEqual(planRahmen([{ umriss: q }]), { minX: 0, minY: 0, maxX: 4, maxY: 4 });
    assert.equal(planRahmen([]), null);
  });

  it('sales patch: status/buyer/section only, unknown status ignored, no change → null', () => {
    const w = { id: 'w1', nr: 'W-001', status: 'frei', kaeufer: '', bauabschnitt: '' };
    assert.deepEqual(wohnungPatch(w, { status: 'verkauft', kaeufer: ' Käufer Muster ', bauabschnitt: 'BA 1' }), { status: 'verkauft', kaeufer: 'Käufer Muster', bauabschnitt: 'BA 1' });
    assert.equal(wohnungPatch(w, { status: 'kaputt' }), null);
    assert.equal(wohnungPatch(w, { status: 'frei', kaeufer: '', bauabschnitt: '' }), null);
  });

  it('plan transform: uniform scale into the drawing, centred, y down as in the model', () => {
    const { massstab, punkt } = planTransform({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 800, 420, 16);
    assert.equal(massstab, Math.min(768 / 10, 388 / 5));
    assert.deepEqual(punkt({ x: 0, y: 0 }), { x: 16, y: (420 - 5 * massstab) / 2 });
    assert.ok(punkt({ x: 0, y: 5 }).y > punkt({ x: 0, y: 0 }).y);
    assert.deepEqual(planTransform(null, 800, 420).punkt({ x: 1, y: 2 }), { x: 1, y: 2 });
  });
});

describe('99-02 Katalog und Sonderwunsch', () => {
  it('severity → approvals (D-P99-01), text raises, never lowers', () => {
    assert.deepEqual(noetigeFreigaben({ schwere: 'ausstattung', beschreibung: 'Parkett Eiche statt Laminat' }), ['bauleitung']);
    assert.deepEqual(noetigeFreigaben({ schwere: 'ausstattung', beschreibung: 'Zusätzliche Steckdose im Flur' }), ['bauleitung', 'architektur']);
    assert.deepEqual(noetigeFreigaben({ schwere: 'ausstattung', beschreibung: 'Durchbruch Küche–Wohnen' }), ['bauleitung', 'architektur', 'statik']);
    assert.equal(wirksameSchwere({ schwere: 'tragwerk', beschreibung: 'Wandfarbe weiß' }), 'tragwerk');
    assert.equal(wirksameSchwere({ beschreibung: 'Wandfarbe weiß' }), 'grundriss');
    assert.equal(schwereAusText('Wandfliesen bis Decke, Deckenleuchte'), null);
    assert.equal(schwereAusText('tragende Wand entfernen'), 'tragwerk');
  });

  it('catalogue option: numbers, standard has price 0, hints', () => {
    const o = neueKatalogOption({ gewerk_lb: '036', bezeichnung: 'Parkett Eiche', art: 'option', preis_eur: '1.250,50', einheit: 'psch', schwere: 'ausstattung' }, { projectId: 'p', alle: [{ nr: 'K-004' }] });
    assert.equal(o.nr, 'K-005');
    assert.equal(o.preis_eur, 1250.5);
    assert.deepEqual(katalogHinweise(o), []);
    const s = neueKatalogOption({ art: 'standard', preis_eur: 99 }, { projectId: 'p', alle: [] });
    assert.equal(s.preis_eur, 0);
    assert.deepEqual(katalogHinweise(s).map((h) => h.code), ['gewerk_fehlt']);
    assert.equal(gewerkLabel('036'), '036 Bodenbelagarbeiten');
  });

  it('request from a catalogue option: trade, severity, price × quantity, deadline kept', () => {
    const option = { id: 'k1', gewerk_lb: '036', bezeichnung: 'Parkett Eiche', preis_eur: 45, schwere: 'ausstattung' };
    const sw = neuerSonderwunsch({ wohnung_id: 'w1', raum: 'Wohnen', menge: '30' }, { projectId: 'p', alle: [], option, frist: '2027-03-01', jetzt: new Date('2026-10-21T09:00:00Z') });
    assert.equal(sw.nr, 'SW-001');
    assert.equal(sw.gewerk_lb, '036');
    assert.equal(sw.preis_eur, 1350);
    assert.equal(sw.beschreibung, 'Parkett Eiche');
    assert.equal(sw.status, 'angefragt');
    assert.equal(sw.angefragt_am, '2026-10-21');
    assert.equal(sw.frist_bei_anfrage, '2027-03-01');
    assert.equal(naechsteNr([sw], 'SW'), 'SW-002');
  });

  it('status chain: approvals by role → geprüft → angeboten → freigegeben → eingearbeitet → abgenommen', () => {
    let sw = neuerSonderwunsch({ wohnung_id: 'w1', gewerk_lb: '053', beschreibung: 'Zusätzliche Steckdose', schwere: 'ausstattung', preis_eur: '120' }, { projectId: 'p', alle: [] });
    assert.deepEqual(offeneFreigaben(sw), ['bauleitung', 'architektur']);
    assert.equal(pruefungPatch(sw, 'statik', 'ok', 'X'), null, 'role not needed');
    assert.equal(pruefungPatch(sw, 'bauleitung', 'ok', ' '), null, 'name required');
    sw = { ...sw, ...pruefungPatch(sw, 'bauleitung', 'ok', 'Bauleitung Muster') };
    assert.equal(sw.status, 'angefragt');
    sw = { ...sw, ...pruefungPatch(sw, 'architektur', 'ok', 'Architektin Muster') };
    assert.equal(sw.status, 'geprueft');
    assert.equal(angebotPatch(sw, 'abc'), null);
    sw = { ...sw, ...angebotPatch(sw, '150', new Date('2026-10-22T00:00:00Z')) };
    assert.equal(sw.status, 'angeboten');
    assert.equal(sw.preis_eur, 150);
    const spaet = kaeuferEntscheidungPatch(sw, 'freigegeben', 'Käufer Muster', { frist: '2026-10-01', jetzt: new Date('2026-10-23T00:00:00Z') });
    assert.equal(spaet.nach_frist, true);
    sw = { ...sw, ...kaeuferEntscheidungPatch(sw, 'freigegeben', 'Käufer Muster', { frist: '2027-01-01', jetzt: new Date('2026-10-23T00:00:00Z') }) };
    assert.equal(sw.status, 'freigegeben');
    assert.equal(sw.nach_frist, false);
    assert.equal(abnahmePatch(sw, 'X'), null, 'only after worked in');
    sw = { ...sw, ...einarbeitungPatch(sw, 'Planer Muster', 'Grundriss 1.OG Index c') };
    assert.equal(sw.status, 'eingearbeitet');
    sw = { ...sw, ...abnahmePatch(sw, 'Bauleitung Muster') };
    assert.equal(sw.status, 'abgenommen');
    assert.deepEqual(summeWohnung([sw, { status: 'angeboten', preis_eur: -200 }, { status: 'abgelehnt', preis_eur: 999 }]), { beauftragt: 150, angeboten: -200 });
  });

  it('a technical rejection ends the request with reason; buyer rejection too', () => {
    const sw = neuerSonderwunsch({ beschreibung: 'Wand entfernen', schwere: 'grundriss' }, { projectId: 'p', alle: [] });
    const p = pruefungPatch(sw, 'statik', 'abgelehnt', 'Statik Muster', 'Aussteifung');
    assert.equal(p.status, 'abgelehnt');
    assert.match(p.abgelehnt_grund, /Tragwerksplanung: Aussteifung/);
    const k = kaeuferEntscheidungPatch({ status: 'angeboten' }, 'abgelehnt', 'Käufer Muster');
    assert.equal(k.status, 'abgelehnt');
    assert.match(k.abgelehnt_grund, /^Käufer/);
  });

  it('hints: late release, raised severity, colour format, missing price/trade', () => {
    const h = sonderwunschHinweise({ status: 'freigegeben', nach_frist: true, schwere: 'ausstattung', beschreibung: 'Heizkörper versetzen', farbe_system: 'RAL', farbe: 'weiß', preis_eur: null, gewerk_lb: '' });
    assert.deepEqual(h.map((x) => x.code), ['nach_frist', 'schwere_erhoeht', 'farbe_format', 'preis_fehlt', 'gewerk_fehlt']);
    assert.deepEqual(sonderwunschHinweise({ status: 'abgelehnt', nach_frist: true }), []);
  });

  it('released request with product data → one released apartment sample (Bemusterung)', async () => {
    const sw = { id: 's1', nr: 'SW-003', status: 'freigegeben', beschreibung: 'Wandfarbe Wohnen', raum: 'Wohnen', fabrikat: 'Hersteller A', farbe_system: 'RAL', farbe: 'RAL 9010', angeboten_am: '2026-10-22', entscheidung: { von: 'Käufer Muster', am: '2026-10-23T10:00:00.000Z' } };
    const b = bemusterungAusSonderwunsch(sw, { id: 'w1', nr: 'W-001' }, { projectId: 'p', alle: [{ nr: 'B-002' }] });
    assert.equal(b.nr, 'B-003');
    assert.equal(b.status, 'freigegeben');
    assert.equal(b.wohnung_id, 'w1');
    assert.equal(b.sonderwunsch_id, 's1');
    assert.equal(b.raum_bezug, 'W-001 · Wohnen');
    assert.equal(b.freigabe.von, 'Käufer Muster');
    assert.equal(bemusterungAusSonderwunsch({ ...sw, fabrikat: '', farbe: '' }, null, { projectId: 'p', alle: [] }), null);
    assert.equal(bemusterungAusSonderwunsch({ ...sw, status: 'angeboten' }, null, { projectId: 'p', alle: [] }), null);
    // Project samples stay without apartment (additive field).
    assert.equal('wohnung_id' in neueBemusterung({ gegenstand: 'x' }, { projectId: 'p', alle: [] }), false);
    const pdf = await bemusterungsProtokollPdf({ projekt: { name: 'Testprojekt' }, muster: [b, { ...b, wohnung_id: 'w2' }], wohnung: { id: 'w1', nr: 'W-001' }, jetzt: new Date('2026-10-23T00:00:00Z') });
    assert.equal(pdf.anzahl, 1);
    assert.equal(pdf.dateiname, 'Bemusterungsprotokoll_Testprojekt_W-001_2026-10-23.pdf');
  });
});

describe('99-03 Frist aus dem Bauablauf', () => {
  const TASKS = [
    { name: 'Bodenbelag BA 1', gewerk_lb: '036', bauabschnitt: 'BA 1', start_date: '2027-03-01', end_date: '2027-03-20' },
    { name: 'Bodenbelag BA 2', gewerk_lb: '036', bauabschnitt: 'BA 2', start_date: '2027-05-03', end_date: '2027-05-20' },
    { name: 'Elektro', trade: 'Niederspannungsanlagen – Kabel/Leitungen, Verlegesysteme', start_date: '2026-11-02', end_date: '2027-01-15' },
  ];

  it('deadline = start of the trade in the section − 4 weeks; project-wide fallback is the earliest', () => {
    assert.equal(FRIST_VORLAUF_TAGE, 28);
    assert.deepEqual(fristFuer(TASKS, '036', 'BA 2'), { frist: '2027-04-05', beginn: '2027-05-03', basis: 'abschnitt', vorgaenge: ['Bodenbelag BA 2'] });
    assert.equal(fristFuer(TASKS, '036', '').frist, '2027-02-01');
    assert.equal(fristFuer(TASKS, '036', 'BA 9').basis, 'projekt');
    assert.equal(fristFuer(TASKS, '053').frist, '2026-10-05', 'free-text trade equal to the catalogue name');
    assert.equal(fristFuer(TASKS, '024'), null);
    assert.equal(gehoertZuGewerk({ trade: 'Elektro' }, '053'), false, 'no fuzzy match');
  });

  it('lights: open and running = gelb, passed = rot, without deadline = offen, done = gruen', () => {
    const f = { frist: '2027-02-01', beginn: '2027-03-01', basis: 'projekt', vorgaenge: [] };
    assert.equal(ampelSonderwunsch({ status: 'angeboten' }, f, '2027-01-31'), 'gelb');
    assert.equal(ampelSonderwunsch({ status: 'angefragt' }, f, '2027-02-02'), 'rot');
    assert.equal(ampelSonderwunsch({ status: 'angefragt' }, null, '2027-02-02'), 'offen');
    assert.equal(ampelSonderwunsch({ status: 'freigegeben' }, f, '2027-02-02'), 'gelb');
    assert.equal(ampelSonderwunsch({ status: 'eingearbeitet' }, f, '2027-02-02'), 'gruen');
    assert.equal(ampelSonderwunsch({ status: 'abgelehnt' }, f, '2027-02-02'), 'gruen');
    assert.equal(schlechteste(['gruen', 'gelb', 'offen']), 'gelb');
    assert.equal(schlechteste([]), 'gruen');
  });

  it('the deadline moves with the schedule and the shift is shown', () => {
    const wohnungen = [{ id: 'w1', nr: 'W-001', bauabschnitt: 'BA 1' }];
    const sw = [{ id: 's1', wohnung_id: 'w1', gewerk_lb: '036', status: 'angefragt', frist_bei_anfrage: '2027-02-01' }];
    const vorher = fristenDerWuensche(sw, wohnungen, TASKS, '2026-10-21').get('s1');
    assert.equal(vorher.frist.frist, '2027-02-01');
    assert.equal(vorher.verschoben_tage, 0);
    const verschoben = TASKS.map((t) => (t.name === 'Bodenbelag BA 1' ? { ...t, start_date: '2027-03-15' } : t));
    const nachher = fristenDerWuensche(sw, wohnungen, verschoben, '2026-10-21').get('s1');
    assert.equal(nachher.frist.frist, plusTageIso('2027-03-15', -28));
    assert.equal(nachher.verschoben_tage, 14);
    assert.equal(fristenDerWuensche(sw, wohnungen, TASKS, '2027-02-02').get('s1').zu_spaet, true);
  });

  it('matrix apartment × trade: deadlines also without request, worst light per apartment, dropped left out', () => {
    const m = fristMatrix({
      wohnungen: [{ id: 'w1', nr: 'W-001', bauabschnitt: 'BA 1' }, { id: 'w2', nr: 'W-002', bauabschnitt: 'BA 2' }, { id: 'w3', nr: 'W-003', entfallen: true }],
      wuensche: [{ id: 's1', wohnung_id: 'w1', gewerk_lb: '036', status: 'angefragt' }],
      tasks: TASKS,
      katalog: [{ gewerk_lb: '053' }, { gewerk_lb: '036' }, { gewerk_lb: '024', aktiv: false }],
      heute: '2027-02-15',
    });
    assert.deepEqual(m.gewerke, ['053', '036'], 'site order, inactive options left out');
    assert.equal(m.zeilen.length, 2);
    assert.equal(m.zeilen[0].ampel, 'rot');
    assert.equal(m.zeilen[0].zellen['036'].ampel, 'rot');
    assert.equal(m.zeilen[0].zellen['053'].ampel, null);
    assert.equal(m.zeilen[1].ampel, 'gruen');
    assert.equal(m.zeilen[1].zellen['036'].frist.frist, '2027-04-05');
  });
});

describe('99 review fixes', () => {
  const rect = (x0, x1) => [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 10 }, { x: x0, y: 10 }];
  const kand = (x0, x1, ref) => ({ quelle: 'werkstatt', quelle_ref: ref, geschoss: 0, typ: '', typ_key: '', zimmer: null, flaeche_m2: (x1 - x0) * 10, umriss: rect(x0, x1) });

  it('split apartment keeps its number on the larger half, in any order and against the source id', () => {
    const bestand = [{ id: 'a', nr: 'W-001', quelle: 'werkstatt', quelle_ref: 'WE 0-1', geschoss: 0, umriss: rect(0, 10), flaeche_m2: 100, typ: '', typ_key: '', zimmer: null, status: 'verkauft' }];
    for (const ks of [[kand(0, 2, 'WE 0-1'), kand(2, 10, 'WE 0-2')], [kand(2, 10, 'WE 0-2'), kand(0, 2, 'WE 0-1')]]) {
      const e = abgleichen(bestand, ks);
      const paar = [...e.gleich, ...e.geaendert][0];
      assert.equal(paar.wohnung.nr, 'W-001');
      assert.equal(paar.kandidat.flaeche_m2, 80);
      assert.deepEqual(e.neu.map((k) => k.flaeche_m2), [20]);
    }
    const m = ueberlappungMasse(rect(0, 10), rect(0, 2));
    assert.equal(m.anteil, 1);
    assert.ok(Math.abs(m.iou - 0.2) < 1e-9);
    // A moved unit (shift 4 m of 10 m) is still eligible.
    assert.equal(abgleichen(bestand, [kand(4, 14, 'WE 0-9')]).gleich.length + abgleichen(bestand, [kand(4, 14, 'WE 0-9')]).geaendert.length, 1);
  });

  it('German thousands dots in price fields', () => {
    const cases = [['1.250', 1250], ['2.500', 2500], ['12.500.000', 12500000], ['1.250,50', 1250.5], ['1,5', 1.5], ['12.5', 12.5], ['0.75', 0.75],
      ['1250', 1250], ['-300', -300], ['-1.250', -1250], ['€ 1.250', 1250], ['1,250.50', 1250.5], ['', null], ['abc', null], ['1.2.3', null]];
    for (const [v, n] of cases) assert.equal(zahl(v), n, String(v));
    assert.equal(neueKatalogOption({ art: 'option', preis_eur: '1.250' }, { projectId: 'p', alle: [] }).preis_eur, 1250);
    assert.equal(neuerSonderwunsch({ preis_eur: '2.500' }, { projectId: 'p', alle: [] }).preis_eur, 2500);
    assert.equal(angebotPatch({ status: 'geprueft' }, '1.350').preis_eur, 1350);
  });

  it('natural phrasings of structural interventions raise to tragwerk; fit-out stays', () => {
    for (const t of ['Wand zwischen Küche und Wohnzimmer entfernen', 'Wand abreißen', 'Wand herausreißen', 'Wand öffnen', 'Türöffnung verbreitern',
      'Öffnung in der Wand', 'Fenster vergrößern', 'Treppe verlegen', 'Entfernen der Wand zum Flur', 'zusätzliche Tür zum Bad']) {
      assert.equal(wirksameSchwere({ schwere: 'ausstattung', beschreibung: t }), 'tragwerk', t);
    }
    for (const t of ['Parkett Eiche statt Laminat', 'Wandfliesen bis zur Decke, Bordüre entfernen', 'Deckenleuchte entfernen', 'Wandfarbe RAL 9010', 'neue Türdrücker']) {
      assert.equal(wirksameSchwere({ schwere: 'ausstattung', beschreibung: t }), 'ausstattung', t);
    }
    assert.equal(wirksameSchwere({ schwere: 'ausstattung', beschreibung: 'Trennwand entfernen' }), 'grundriss');
    // The form's empty severity = not classified → architect looks at it.
    assert.equal(neuerSonderwunsch({ schwere: '', beschreibung: 'Einbauschrank' }, { projectId: 'p', alle: [] }).schwere, '');
    assert.equal(wirksameSchwere({ schwere: '', beschreibung: 'Einbauschrank' }), 'grundriss');
  });

  it('project protocol without apartment leaves the samples of buyers out', async () => {
    const b = { nr: 'B-001', gegenstand: 'Boden', status: 'freigegeben', freigabe: { von: 'Bauherr', am: '2026-10-20T00:00:00Z' } };
    const muster = [b, { ...b, nr: 'B-002', wohnung_id: 'w1', freigabe: { von: 'Käufer Muster', am: '2026-10-20T00:00:00Z' } }];
    const pdf = await bemusterungsProtokollPdf({ projekt: { name: 'Testprojekt' }, muster, jetzt: new Date('2026-10-23T00:00:00Z') });
    assert.equal(pdf.anzahl, 1);
    assert.equal(istProjektMuster(muster[0]), true);
    assert.equal(istProjektMuster(muster[1]), false);
    assert.equal(istProjektMuster({ wohnung_id: '' }), true);
  });
});
