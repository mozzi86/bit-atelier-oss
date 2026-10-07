// 72-14 (N-13): change orders — project scope, sums, status lifecycle (nachtraege.js).
// 72-14 (N-14): prefill from a ticket and the /Finance link contract.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  gehoertZuProjekt, nachtraegeDesProjekts, projektDesNachtrags, offeneNachtraege,
  nachtragsSummen, uebergangErlaubt, bearbeitbar, projektFelder, statusWechsel,
  nachtragStatusLabel, NACHTRAG_STATUS_LABELS, NACHTRAG_STATUS, ERLAUBTE_UEBERGAENGE,
  nachtragAusTicket, ticketGehoertZuProjekt, neuerNachtragUrl, leseNachtragParameter,
  ohneNachtragParameter, NACHTRAG_SEITE, NACHTRAG_PARAMETER,
} from '@core/lib/nachtraege.js';

const NORD = { id: 'proj-1', name: 'Stadtquartier Nordhang' };
const PARK = { id: 'proj-2', name: 'Bürocampus Parkseite' };
const SEE = { id: 'proj-3', name: 'Wohnpark am See' };

// Same shape as the demo seed: legacy records carry project_name only.
const SEED = [
  { id: 'co-1', project_name: NORD.name, title: 'Zusätzliche Tiefgaragenstellplätze', cost_impact: 145000, status: 'approved' },
  { id: 'co-2', project_name: NORD.name, title: 'Upgrade Wärmepumpenanlage', cost_impact: 68000, status: 'pending' },
  { id: 'co-3', project_name: PARK.name, title: 'Änderung Fassadenraster', cost_impact: -23000, status: 'approved' },
  { id: 'co-4', project_name: PARK.name, title: 'Mehrleistung Brandschutz', cost_impact: 91500, status: 'rejected' },
];

describe('gehoertZuProjekt', () => {
  it('matches legacy records (project_name only) by name', () => {
    assert.equal(gehoertZuProjekt(SEED[0], NORD), true);
    assert.equal(gehoertZuProjekt(SEED[0], PARK), false);
  });
  it('matches by project_id', () => {
    assert.equal(gehoertZuProjekt({ project_id: 'proj-1' }, NORD), true);
    assert.equal(gehoertZuProjekt({ project_id: 'proj-1', project_name: 'alt' }, NORD), true);
  });
  it('a foreign project_id with the same name does not count', () => {
    assert.equal(gehoertZuProjekt({ project_id: 'proj-9', project_name: NORD.name }, NORD), false);
  });
  it('is false for missing order, project, project id or name', () => {
    assert.equal(gehoertZuProjekt(null, NORD), false);
    assert.equal(gehoertZuProjekt(SEED[0], null), false);
    assert.equal(gehoertZuProjekt(SEED[0], /** @type {any} */ ({ name: NORD.name })), false);
    assert.equal(gehoertZuProjekt({ project_name: '' }, { id: 'x', name: '' }), false);
    assert.equal(gehoertZuProjekt({}, { id: 'x' }), false);
  });
});

describe('nachtraegeDesProjekts', () => {
  it('seed form: proj-1 gets co-1 and co-2 in input order', () => {
    assert.deepEqual(nachtraegeDesProjekts(SEED, NORD).map((o) => o.id), ['co-1', 'co-2']);
  });
  it('mixes new records with project_id and legacy records', () => {
    const orders = [...SEED, { id: 'co-5', project_id: 'proj-1', project_name: NORD.name }, { id: 'co-6', project_id: 'proj-9', project_name: NORD.name }];
    assert.deepEqual(nachtraegeDesProjekts(orders, NORD).map((o) => o.id), ['co-1', 'co-2', 'co-5']);
  });
  it('a project without change orders gets an empty list', () => {
    assert.deepEqual(nachtraegeDesProjekts(SEED, SEE), []);
  });
  it('no project or no list → empty list', () => {
    assert.deepEqual(nachtraegeDesProjekts(SEED, null), []);
    assert.deepEqual(nachtraegeDesProjekts(/** @type {any} */ (null), NORD), []);
  });
});

describe('projektDesNachtrags', () => {
  it('finds the one project by id or name', () => {
    assert.equal(projektDesNachtrags(SEED[3], [NORD, PARK, SEE]), PARK);
    assert.equal(projektDesNachtrags({ project_id: 'proj-3' }, [NORD, PARK, SEE]), SEE);
  });
  it('is null when nothing or more than one project matches', () => {
    assert.equal(projektDesNachtrags({ project_name: 'Unbekannt' }, [NORD, PARK]), null);
    const zwilling = { id: 'proj-7', name: NORD.name };
    assert.equal(projektDesNachtrags(SEED[0], [NORD, zwilling]), null);
    assert.equal(projektDesNachtrags(SEED[0], /** @type {any} */ (null)), null);
  });
});

describe('offeneNachtraege', () => {
  it('pending and in_progress are open', () => {
    const orders = [...SEED, { id: 'co-7', status: 'in_progress' }, { id: 'co-8', status: 'completed' }];
    assert.deepEqual(offeneNachtraege(orders).map((o) => o.id), ['co-2', 'co-7']);
    assert.deepEqual(offeneNachtraege(/** @type {any} */ (undefined)), []);
  });
});

describe('nachtragsSummen', () => {
  it('sums per status bucket in euros', () => {
    assert.deepEqual(nachtragsSummen(SEED), {
      genehmigt: { anzahl: 2, summe: 122000 },
      offen: { anzahl: 1, summe: 68000 },
      abgelehnt: { anzahl: 1, summe: 91500 },
    });
  });
  it('null cost counts as a change order with 0 €; completed counts as approved', () => {
    const orders = [
      { status: 'approved', cost_impact: 145000 },
      { status: 'approved', cost_impact: 68000 },
      { status: 'completed', cost_impact: 1000 },
      { status: 'pending', cost_impact: null },
      { status: 'in_progress', cost_impact: 500 },
      { status: 'rejected' },
      { status: 'unbekannt', cost_impact: 999 },
    ];
    assert.deepEqual(nachtragsSummen(orders), {
      genehmigt: { anzahl: 3, summe: 214000 },
      offen: { anzahl: 2, summe: 500 },
      abgelehnt: { anzahl: 1, summe: 0 },
    });
  });
  it('the proj-1 case after approving co-2: 213.000 € approved', () => {
    const nachher = nachtraegeDesProjekts(SEED, NORD).map((o) => (o.id === 'co-2' ? { ...o, status: 'approved' } : o));
    assert.equal(nachtragsSummen(nachher).genehmigt.summe, 213000);
  });
  it('empty or missing input → zero buckets', () => {
    const null0 = { anzahl: 0, summe: 0 };
    assert.deepEqual(nachtragsSummen(/** @type {any} */ (null)), { genehmigt: null0, offen: null0, abgelehnt: null0 });
  });
});

describe('uebergangErlaubt', () => {
  it('allows the assumed lifecycle', () => {
    assert.equal(uebergangErlaubt('pending', 'approved'), true);
    assert.equal(uebergangErlaubt('pending', 'rejected'), true);
    assert.equal(uebergangErlaubt('pending', 'in_progress'), true);
    assert.equal(uebergangErlaubt('in_progress', 'approved'), true);
    assert.equal(uebergangErlaubt('in_progress', 'rejected'), true);
    assert.equal(uebergangErlaubt('approved', 'completed'), true);
  });
  it('forbids everything else', () => {
    assert.equal(uebergangErlaubt('pending', 'completed'), false);
    assert.equal(uebergangErlaubt('pending', 'pending'), false);
    assert.equal(uebergangErlaubt('in_progress', 'pending'), false);
    assert.equal(uebergangErlaubt('approved', 'rejected'), false);
    assert.equal(uebergangErlaubt('approved', 'pending'), false);
    assert.equal(uebergangErlaubt('rejected', 'approved'), false);
    assert.equal(uebergangErlaubt('completed', 'approved'), false);
    assert.equal(uebergangErlaubt('constructor', 'approved'), false);
    assert.equal(uebergangErlaubt(undefined, 'approved'), false);
    assert.equal(uebergangErlaubt('pending', /** @type {any} */ (null)), false);
  });
  it('every status has a transition entry', () => {
    assert.deepEqual(Object.keys(ERLAUBTE_UEBERGAENGE).sort(), [...NACHTRAG_STATUS].sort());
  });
});

describe('bearbeitbar', () => {
  it('only undecided change orders can be edited', () => {
    assert.equal(bearbeitbar({ status: 'pending' }), true);
    assert.equal(bearbeitbar({ status: 'in_progress' }), true);
    assert.equal(bearbeitbar({ status: 'approved' }), false);
    assert.equal(bearbeitbar({ status: 'rejected' }), false);
    assert.equal(bearbeitbar(null), false);
  });
});

describe('projektFelder', () => {
  it('backfills id and name when the order belongs to the project', () => {
    assert.deepEqual(projektFelder(SEED[1], NORD), { project_id: 'proj-1', project_name: NORD.name });
  });
  it('writes nothing for a foreign order or without project', () => {
    assert.deepEqual(projektFelder(SEED[3], NORD), {});
    assert.deepEqual(projektFelder(SEED[1], null), {});
  });
});

describe('statusWechsel', () => {
  const JETZT = new Date('2026-09-24T10:00:00.000Z');
  it('approval sets decided_date and backfills project_id', () => {
    assert.deepEqual(statusWechsel(SEED[1], 'approved', NORD, JETZT), {
      status: 'approved', decided_date: '2026-09-24T10:00:00.000Z', project_id: 'proj-1', project_name: NORD.name,
    });
  });
  it('rejection sets decided_date too', () => {
    assert.equal(statusWechsel(SEED[1], 'rejected', NORD, JETZT)?.decided_date, '2026-09-24T10:00:00.000Z');
  });
  it('in_progress and completed leave decided_date alone', () => {
    const patch = statusWechsel(SEED[1], 'in_progress', NORD, JETZT);
    assert.equal(patch?.status, 'in_progress');
    assert.equal('decided_date' in (patch || {}), false);
    assert.equal('decided_date' in (statusWechsel(SEED[0], 'completed', NORD, JETZT) || {}), false);
  });
  it('no backfill for an order of another project', () => {
    assert.deepEqual(statusWechsel(SEED[1], 'approved', PARK, JETZT), { status: 'approved', decided_date: '2026-09-24T10:00:00.000Z' });
  });
  it('a forbidden transition yields null', () => {
    assert.equal(statusWechsel(SEED[0], 'rejected', NORD, JETZT), null);
    assert.equal(statusWechsel(SEED[3], 'approved', PARK, JETZT), null);
    assert.equal(statusWechsel(/** @type {any} */ (null), 'approved', NORD, JETZT), null);
  });
  it('defaults the decision time to now', () => {
    const vorher = Date.now();
    const zeit = Date.parse(statusWechsel(SEED[1], 'approved', NORD)?.decided_date || '');
    assert.ok(zeit >= vorher && zeit <= Date.now());
  });
});

describe('nachtragStatusLabel', () => {
  it('German labels for all known values', () => {
    assert.equal(nachtragStatusLabel('pending'), 'Offen');
    assert.equal(nachtragStatusLabel('approved'), 'Genehmigt');
    assert.equal(nachtragStatusLabel('rejected'), 'Abgelehnt');
    assert.equal(nachtragStatusLabel('in_progress'), 'In Bearbeitung');
    assert.equal(nachtragStatusLabel('completed'), 'Abgeschlossen');
    assert.equal(Object.keys(NACHTRAG_STATUS_LABELS).length, 5);
  });
  it('readable fallback, no prototype keys, empty for nothing', () => {
    assert.equal(nachtragStatusLabel('on_hold'), 'on hold');
    assert.equal(nachtragStatusLabel('constructor'), 'constructor');
    assert.equal(nachtragStatusLabel(undefined), '');
    assert.equal(nachtragStatusLabel(''), '');
  });
});

// Same shape as the demo seed ticket iss-1 (legacy: element_id only).
const ISS_1 = {
  id: 'iss-1', project_id: 'proj-1', title: 'Kollision Lüftungskanal / Unterzug',
  description: 'TGA-Trasse kreuzt Unterzug in der Tiefgaragendecke.', element_id: 'guid-4',
  priority: 'high', status: 'open',
};

describe('nachtragAusTicket', () => {
  it('prefills title, description, issue_id and the active project', () => {
    const v = nachtragAusTicket(ISS_1, NORD);
    assert.deepEqual(v, {
      title: 'Nachtrag: Kollision Lüftungskanal / Unterzug',
      description: 'Aus Ticket „Kollision Lüftungskanal / Unterzug“\n\nBauteil (IFC-GUID): guid-4'
        + '\n\nTGA-Trasse kreuzt Unterzug in der Tiefgaragendecke.',
      issue_id: 'iss-1',
      project_id: 'proj-1',
      project_name: 'Stadtquartier Nordhang',
      status: 'pending',
      cost_impact: null,
      ticket_titel: 'Kollision Lüftungskanal / Unterzug',
    });
  });
  it('element_guid wins over the legacy element_id', () => {
    const v = nachtragAusTicket({ ...ISS_1, element_guid: 'nYqxeK5NUBtew1kQBTaHzk' }, NORD);
    assert.match(v?.description || '', /Bauteil \(IFC-GUID\): nYqxeK5NUBtew1kQBTaHzk/);
    assert.doesNotMatch(v?.description || '', /guid-4/);
  });
  it('without element and description only the ticket line', () => {
    const v = nachtragAusTicket({ id: 'iss-9', title: '  Wand  ' }, NORD);
    assert.equal(v?.title, 'Nachtrag: Wand');
    assert.equal(v?.description, 'Aus Ticket „Wand“');
  });
  it('a ticket without title falls back to its id', () => {
    assert.equal(nachtragAusTicket({ id: 'iss-7' }, NORD)?.title, 'Nachtrag: Ticket iss-7');
    assert.equal(nachtragAusTicket({}, NORD)?.title, 'Nachtrag: Ticket');
    assert.equal(nachtragAusTicket({}, NORD)?.issue_id, null);
  });
  it('without an active project the ticket keeps its project_id', () => {
    const v = nachtragAusTicket(ISS_1, null);
    assert.equal(v?.project_id, 'proj-1');
    assert.equal(v?.project_name, null);
  });
  it('the amount is never taken from the ticket', () => {
    assert.equal(nachtragAusTicket({ ...ISS_1, cost_impact: 5000 }, NORD)?.cost_impact, null);
  });
  it('no ticket → null', () => {
    assert.equal(nachtragAusTicket(null, NORD), null);
    assert.equal(nachtragAusTicket(undefined, NORD), null);
  });
});

describe('ticketGehoertZuProjekt', () => {
  it('same project_id or none at all', () => {
    assert.equal(ticketGehoertZuProjekt(ISS_1, NORD), true);
    assert.equal(ticketGehoertZuProjekt({ id: 'x' }, NORD), true);
  });
  it('a ticket of another project does not become a change order here', () => {
    assert.equal(ticketGehoertZuProjekt(ISS_1, PARK), false);
  });
  it('false without ticket or project', () => {
    assert.equal(ticketGehoertZuProjekt(null, NORD), false);
    assert.equal(ticketGehoertZuProjekt(ISS_1, null), false);
    assert.equal(ticketGehoertZuProjekt(ISS_1, /** @type {any} */ ({ name: NORD.name })), false);
  });
});

describe('neuerNachtragUrl', () => {
  it('empty form and form from a ticket', () => {
    assert.equal(NACHTRAG_SEITE, '/Finance');
    assert.equal(neuerNachtragUrl(), '/Finance?neu=1');
    assert.equal(neuerNachtragUrl(''), '/Finance?neu=1');
    assert.equal(neuerNachtragUrl('iss-1'), '/Finance?neu=1&ticket=iss-1');
  });
  it('encodes the id', () => {
    assert.equal(neuerNachtragUrl('a b&c'), '/Finance?neu=1&ticket=a%20b%26c');
  });
});

describe('leseNachtragParameter', () => {
  it('reads neu and ticket from a string or URLSearchParams', () => {
    assert.deepEqual(leseNachtragParameter('?neu=1&ticket=iss-1'), { neu: true, ticket: 'iss-1' });
    assert.deepEqual(leseNachtragParameter(new URLSearchParams('neu=1')), { neu: true, ticket: null });
  });
  it('round trip with neuerNachtragUrl', () => {
    const query = neuerNachtragUrl('a b&c').split('?')[1];
    assert.deepEqual(leseNachtragParameter(query), { neu: true, ticket: 'a b&c' });
  });
  it('ticket only counts together with neu=1; broken input never throws', () => {
    assert.deepEqual(leseNachtragParameter('ticket=iss-1'), { neu: false, ticket: null });
    assert.deepEqual(leseNachtragParameter('neu=true'), { neu: false, ticket: null });
    assert.deepEqual(leseNachtragParameter(null), { neu: false, ticket: null });
    assert.deepEqual(leseNachtragParameter(undefined), { neu: false, ticket: null });
    assert.deepEqual(leseNachtragParameter('neu=1&ticket=%20%20'), { neu: true, ticket: null });
  });
  it('caps an overlong ticket id', () => {
    assert.equal(leseNachtragParameter(`neu=1&ticket=${'x'.repeat(500)}`).ticket?.length, 200);
  });
});

describe('ohneNachtragParameter', () => {
  it('drops neu and ticket, keeps the rest, leaves the input alone', () => {
    const ein = new URLSearchParams('neu=1&ticket=iss-1&projekt=proj-1');
    const aus = ohneNachtragParameter(ein);
    assert.equal(aus.toString(), 'projekt=proj-1');
    assert.equal(ein.toString(), 'neu=1&ticket=iss-1&projekt=proj-1');
    assert.deepEqual([...NACHTRAG_PARAMETER], ['neu', 'ticket']);
  });
});
