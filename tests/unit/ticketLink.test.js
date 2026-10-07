// 72-13 (N-10): ticket links and the Issue data contract (ticketLink.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ticketUrl, neuesTicketUrl, leseTicketParameter, ohneNeuParameter, istOffen,
  hatModellpunkt, bauteilGuid, mitBauteilGuid, statusLabel, prioritaetLabel,
  TICKET_STATUS_LABELS, PRIORITAET_LABELS, TICKET_QUELLEN, NEU_PARAMETER,
} from '@ifc/lib/ticketLink.js';

describe('ticketUrl', () => {
  it('addresses one ticket on the BIM viewer page', () => {
    assert.equal(ticketUrl('iss-2'), '/BimViewer?ticket=iss-2');
  });
  it('encodes ids with reserved characters', () => {
    assert.equal(ticketUrl('a&b c/ä'), '/BimViewer?ticket=a%26b%20c%2F%C3%A4');
  });
  it('falls back to the bare page for empty or unusable ids', () => {
    assert.equal(ticketUrl(''), '/BimViewer');
    assert.equal(ticketUrl('   '), '/BimViewer');
    assert.equal(ticketUrl(undefined), '/BimViewer');
    assert.equal(ticketUrl(/** @type {any} */ ({})), '/BimViewer');
  });
});

describe('neuesTicketUrl', () => {
  it('builds the prefilled form link in a fixed parameter order', () => {
    assert.equal(
      neuesTicketUrl({ titel: 'Wand', quelle: 'ifc', element: 'nYqxeK5NUBtew1kQBTaHzk' }),
      '/BimViewer?neu=1&element=nYqxeK5NUBtew1kQBTaHzk&titel=Wand&quelle=ifc',
    );
  });
  it('drops empty values and unknown sources', () => {
    assert.equal(neuesTicketUrl(), '/BimViewer?neu=1');
    assert.equal(neuesTicketUrl({ element: '', titel: '  ', quelle: 'fax' }), '/BimViewer?neu=1');
  });
  it('encodes titles with umlauts, spaces, & and #', () => {
    const url = neuesTicketUrl({ titel: 'Tür & Zarge #3' });
    assert.equal(url, '/BimViewer?neu=1&titel=T%C3%BCr%20%26%20Zarge%20%233');
    // Round trip through the reader: the title arrives unchanged.
    assert.equal(leseTicketParameter(url.split('?')[1]).titel, 'Tür & Zarge #3');
  });
  it('the GlobalId $ survives encoding', () => {
    const url = neuesTicketUrl({ element: '0$abc_DEF' });
    assert.equal(leseTicketParameter(url.slice(url.indexOf('?'))).element, '0$abc_DEF');
  });
});

describe('leseTicketParameter', () => {
  it('reads URLSearchParams', () => {
    const p = new URLSearchParams('ticket=iss-2&neu=1&element=G1&titel=Wand&quelle=bcf');
    assert.deepEqual(leseTicketParameter(p), {
      ticket: 'iss-2', neu: true, element: 'G1', titel: 'Wand', quelle: 'bcf',
    });
  });
  it('reads a query string with or without "?"', () => {
    assert.equal(leseTicketParameter('?ticket=iss-1').ticket, 'iss-1');
    assert.equal(leseTicketParameter('ticket=iss-1').ticket, 'iss-1');
  });
  it('empty and missing values become null / false', () => {
    assert.deepEqual(leseTicketParameter('ticket=&neu=&element=%20&titel='), {
      ticket: null, neu: false, element: null, titel: null, quelle: null,
    });
    assert.deepEqual(leseTicketParameter(null), {
      ticket: null, neu: false, element: null, titel: null, quelle: null,
    });
    assert.deepEqual(leseTicketParameter(/** @type {any} */ (42)), {
      ticket: null, neu: false, element: null, titel: null, quelle: null,
    });
  });
  it('broken values never throw', () => {
    // Malformed percent escape: URLSearchParams decodes it leniently (U+FFFD for the
    // broken byte sequence) instead of throwing like decodeURIComponent would.
    const r = leseTicketParameter('?ticket=%E0%A4%A&neu=ja&quelle=IFC');
    assert.equal(typeof r.ticket, 'string');
    assert.ok(r.ticket?.endsWith('%A'));
    assert.equal(r.neu, false, 'only neu=1 opens the form');
    assert.equal(r.quelle, null, 'unknown source (case-sensitive) is dropped');
  });
  it('trims and caps overlong values', () => {
    const r = leseTicketParameter(`titel=${'x'.repeat(5000)}&element=%20G2%20`);
    assert.equal(r.titel?.length, 200);
    assert.equal(r.element, 'G2');
  });
});

describe('ohneNeuParameter', () => {
  it('removes the form parameters and keeps the rest', () => {
    const vorher = new URLSearchParams('ticket=iss-2&neu=1&element=G1&titel=Wand&quelle=ifc&x=1');
    const nachher = ohneNeuParameter(vorher);
    assert.equal(nachher.toString(), 'ticket=iss-2&x=1');
    assert.equal(vorher.get('neu'), '1', 'input is not changed');
    assert.deepEqual(NEU_PARAMETER, ['neu', 'element', 'titel', 'quelle']);
  });
});

describe('istOffen', () => {
  it('open and in_progress are open, resolved and closed are not', () => {
    assert.equal(istOffen({ status: 'open' }), true);
    assert.equal(istOffen({ status: 'in_progress' }), true);
    assert.equal(istOffen({ status: 'resolved' }), false);
    assert.equal(istOffen({ status: 'closed' }), false);
  });
  it('missing status counts as open, missing issue as not open', () => {
    assert.equal(istOffen({}), true);
    assert.equal(istOffen(null), false);
    assert.equal(istOffen(undefined), false);
  });
});

describe('hatModellpunkt', () => {
  it('only complete, finite coordinates count as a model point', () => {
    assert.equal(hatModellpunkt({ location: { x: -4, y: 13.5, z: -3 } }), true);
    assert.equal(hatModellpunkt({ location: { x: 0, y: 0, z: 0 } }), true);
    assert.equal(hatModellpunkt({ location: null }), false);
    assert.equal(hatModellpunkt({}), false);
    assert.equal(hatModellpunkt({ location: {} }), false);
    assert.equal(hatModellpunkt({ location: { x: 1, y: '2', z: 3 } }), false);
    assert.equal(hatModellpunkt({ location: { x: 1, y: NaN, z: 3 } }), false);
    assert.equal(hatModellpunkt(null), false);
  });
});

describe('element GlobalId contract', () => {
  it('reader prefers element_guid, falls back to element_id', () => {
    assert.equal(bauteilGuid({ element_guid: 'NEU', element_id: 'ALT' }), 'NEU');
    assert.equal(bauteilGuid({ element_id: 'guid-2' }), 'guid-2');
    assert.equal(bauteilGuid({ element_guid: '  ', element_id: 'guid-2' }), 'guid-2');
    assert.equal(bauteilGuid({}), '');
    assert.equal(bauteilGuid(null), '');
  });
  it('writer sets both fields to the same trimmed value', () => {
    const d = mitBauteilGuid({ title: 'Wand', element_id: 'alt' }, ' nYqxeK5NUBtew1kQBTaHzk ');
    assert.deepEqual(d, { title: 'Wand', element_guid: 'nYqxeK5NUBtew1kQBTaHzk', element_id: 'nYqxeK5NUBtew1kQBTaHzk' });
    assert.deepEqual(mitBauteilGuid({}, ''), { element_guid: '', element_id: '' });
  });
});

describe('labels', () => {
  it('German labels for all known status and priority values', () => {
    assert.deepEqual(Object.values(TICKET_STATUS_LABELS), ['Offen', 'In Bearbeitung', 'Gelöst', 'Geschlossen']);
    assert.deepEqual(Object.values(PRIORITAET_LABELS), ['Niedrig', 'Mittel', 'Hoch', 'Kritisch']);
    assert.equal(statusLabel('in_progress'), 'In Bearbeitung');
    assert.equal(prioritaetLabel('high'), 'Hoch');
  });
  it('unknown values stay readable, missing ones are empty', () => {
    assert.equal(statusLabel('waiting_for_review'), 'waiting for review');
    assert.equal(prioritaetLabel('urgent'), 'urgent');
    assert.equal(statusLabel(undefined), '');
    assert.equal(prioritaetLabel(''), '');
  });
  it('prototype keys do not leak into labels', () => {
    assert.equal(statusLabel('constructor'), 'constructor');
    assert.equal(prioritaetLabel('toString'), 'toString');
  });
  it('sources are the documented three', () => {
    assert.deepEqual(TICKET_QUELLEN, ['manuell', 'bcf', 'ifc']);
  });
});
