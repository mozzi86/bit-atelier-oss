// befundSpur.test.js — Phase 71-04 Task 2: Layer-Schema + Antwort-BCF.
// Kernbeweis: antwortTopics(layer) → buildBcfZip → parseBcfZip liest den
// Kommentar UNVERÄNDERT zurück (Roundtrip über die echte XSD-Sequenz).
// 72-13 (N-12): finding → ticket mapping (befundZuIssue, ticketZuBefund) and
// the sample BCF public/beispiel/musterprojekt.bcf against the sample model.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { buildBcfZip } from '@ifc/lib/bcf';
import { parseBcfZip } from '@ifc/lib/bcfImport';
import {
  STATUS,
  antwortTopics,
  befundZuIssue,
  leeresLayer,
  setzeAntwort,
  statusVon,
  ticketZuBefund,
  topicsZuLayer,
  uebergang,
} from '@ifc/lib/befundSpur';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';

// --- Status + Übergänge -------------------------------------------------------

test('STATUS ist die [ASSUMED] Catenda-Kette, eingefroren', () => {
  assert.deepEqual([...STATUS], ['Open', 'InProgress', 'Resolved', 'Closed']);
  assert.ok(Object.isFrozen(STATUS));
});

test('uebergang: erlaubt alles außer Closed→Open ohne Kommentar', () => {
  assert.equal(uebergang('Open', 'Resolved').ok, true);
  assert.equal(uebergang('Resolved', 'Closed').ok, true);
  assert.equal(uebergang('Closed', 'Open').ok, false);
  assert.match(uebergang('Closed', 'Open').grund, /Kommentar/);
  assert.equal(uebergang('Closed', 'Open', { kommentar: 'wieder offen, weil …' }).ok, true);
  assert.equal(uebergang('Open', 'Quatsch').ok, false); // unbekanntes Ziel
  // Unbekannter Herkunftsstatus (fremder Container): Ziel allein entscheidet.
  assert.equal(uebergang('Fremd', 'Closed').ok, true);
  // Überschreibbare Statusliste (Projekt-Setting-Auflösung des [ASSUMED]).
  assert.equal(uebergang('Neu', 'Fertig', { erlaubt: ['Neu', 'Fertig'] }).ok, true);
});

// --- Layer-Bau -----------------------------------------------------------------

test('leeresLayer: Feld-Erstanlage ohne Schreibpfad', () => {
  const l = leeresLayer({ quelle: 'catenda' });
  assert.deepEqual(l, { quelle: 'catenda', importiert: null, version: null, topics: [], antworten: {} });
});

test('topicsZuLayer: Import wird Layer, alte Antworten bleiben nur für bekannte Guids', () => {
  const parse = { version: '2.1', topics: [{ guid: G1, titel: 'A' }] };
  const bisher = { antworten: { [G1]: { status: 'Resolved', text: 'erledigt' }, [G2]: { status: 'Open', text: 'weg' } } };
  const { layer, verwaist } = topicsZuLayer(parse, bisher, { datum: '2026-09-10T00:00:00.000Z' });
  assert.equal(layer.quelle, 'catenda');
  assert.equal(layer.version, '2.1');
  assert.equal(layer.importiert, '2026-09-10T00:00:00.000Z');
  assert.equal(layer.topics.length, 1);
  assert.deepEqual(Object.keys(layer.antworten), [G1]); // G2-Antwort verwaist
  assert.deepEqual(verwaist, [G2]);
});

test('setzeAntwort: rein (neues Objekt), leerer Text löscht', () => {
  const l0 = { ...leeresLayer(), topics: [{ guid: G1 }] };
  const l1 = setzeAntwort(l0, G1, { status: 'Resolved', text: ' geprüft ' });
  assert.notEqual(l1, l0);
  assert.equal(l1.antworten[G1].text, 'geprüft'); // getrimmt
  assert.equal(statusVon(l1, G1), 'Resolved');
  assert.deepEqual(l0.antworten, {}); // Original unverändert
  const l2 = setzeAntwort(l1, G1, { status: 'Resolved', text: '   ' });
  assert.equal(l2.antworten[G1], undefined);
  // R-5: ohne Antwort gilt der Import-Status des Topics, dann der Fallback.
  assert.equal(statusVon(l2, { guid: G1, topicStatus: 'InProgress' }), 'InProgress');
  assert.equal(statusVon(l2, { guid: G1 }), 'Open');
  assert.equal(statusVon(l2, G1, 'Neu'), 'Neu');
});

test('R-5: eigene Statusliste gilt in setzeAntwort UND antwortTopics', () => {
  const erlaubt = ['Neu', 'Fertig'];
  const l0 = { ...leeresLayer(), topics: [{ guid: G1, titel: 'x', topicStatus: 'Neu' }] };
  // ohne Status → erster Eintrag der eigenen Liste, nicht 'Open'
  const l1 = setzeAntwort(l0, G1, { text: 'ok' }, { erlaubt });
  assert.equal(l1.antworten[G1].status, 'Neu');
  const l2 = setzeAntwort(l0, G1, { status: 'Fertig', text: 'ok' }, { erlaubt });
  assert.equal(antwortTopics(l2, { erlaubt })[0].topicStatus, 'Fertig');
  // dieselbe Antwort ohne eigene Liste fällt auf den Import-Status zurück
  assert.equal(antwortTopics(l2)[0].topicStatus, 'Neu');
});

// --- Antwort-Topics + Roundtrip -------------------------------------------------

function layerMitAntworten() {
  let layer = {
    quelle: 'catenda',
    importiert: '2026-09-10T00:00:00.000Z',
    version: '2.1',
    topics: [
      {
        guid: G1,
        titel: 'Kollision Wand/Träger',
        beschreibung: '40 mm Überlappung',
        topicType: 'Clash',
        topicStatus: 'Open',
        creationDate: '2026-08-01T10:00:00Z',
        creationAuthor: 'solibri@example.com',
        ifcGuids: ['0YvctVUKr0kx0OqL8q0Y0X'],
        kommentare: [{ guid: G2, datum: '2026-08-02T09:00:00Z', autor: 'gp@example.com', text: 'Bitte prüfen' }],
      },
      { guid: G2, titel: 'ohne Antwort', topicStatus: 'Open', ifcGuids: [], kommentare: [] },
    ],
    antworten: {
      [G1]: { status: 'Resolved', text: 'Träger ausgespart, Modellstand 09.09.', datum: '2026-09-10T08:00:00.000Z' },
    },
  };
  return layer;
}

test('antwortTopics: nur Topics mit Antwort, Kommentar-Form „BIT-Atelier · <status>: <text>"', () => {
  const topics = antwortTopics(layerMitAntworten());
  assert.equal(topics.length, 1);
  assert.equal(topics[0].guid, G1);
  assert.equal(topics[0].topicStatus, 'Resolved');
  // Importierte Historie bleibt, Antwort kommt zuletzt.
  assert.equal(topics[0].kommentare.length, 2);
  assert.equal(topics[0].kommentare[0].text, 'Bitte prüfen');
  assert.equal(topics[0].kommentare[1].text, 'BIT-Atelier · Resolved: Träger ausgespart, Modellstand 09.09.');
  assert.equal(topics[0].modifiedDate, '2026-09-10T08:00:00.000Z');
  assert.equal(topics[0].creationAuthor, 'solibri@example.com'); // Herkunft bleibt
});

test('Antwort-Roundtrip: Export → Import liest Kommentare unverändert zurück', () => {
  const layer = layerMitAntworten();
  const bytes = buildBcfZip(antwortTopics(layer), {
    autor: 'BIT-Atelier',
    datum: '2026-09-10T08:00:00.000Z',
  });
  const erg = parseBcfZip(bytes);
  assert.deepEqual(erg.warnungen, []);
  const t = erg.topics[0];
  assert.equal(t.guid, G1);
  assert.equal(t.topicStatus, 'Resolved');
  assert.equal(t.kommentare.length, 2);
  assert.equal(t.kommentare[0].text, 'Bitte prüfen');
  assert.equal(t.kommentare[1].text, 'BIT-Atelier · Resolved: Träger ausgespart, Modellstand 09.09.');
  assert.equal(t.modifiedDate, '2026-09-10T08:00:00.000Z');
  assert.deepEqual(t.ifcGuids, ['0YvctVUKr0kx0OqL8q0Y0X']);
});

test('Markup-Sequenz: <Comment> zwischen </Topic> und <Viewpoints>, XSD-konform', () => {
  const bytes = buildBcfZip(antwortTopics(layerMitAntworten()), { autor: 'BIT-Atelier' });
  const files = unzipSync(bytes);
  const markup = strFromU8(files[`${G1}/markup.bcf`]);
  const posTopicEnde = markup.indexOf('</Topic>');
  const posComment = markup.indexOf('<Comment Guid=');
  const posViewpoints = markup.indexOf('<Viewpoints');
  assert.ok(posTopicEnde > -1 && posComment > -1 && posViewpoints > -1);
  assert.ok(posTopicEnde < posComment, 'Comment kommt NACH Topic');
  assert.ok(posComment < posViewpoints, 'Comment kommt VOR Viewpoints');
  // Topic-Sequenz: ModifiedDate/ModifiedAuthor nach CreationAuthor, vor Description.
  const posCreationAuthor = markup.indexOf('<CreationAuthor>');
  const posModified = markup.indexOf('<ModifiedDate>');
  assert.ok(posCreationAuthor < posModified);
});

test('Antwort ohne Status in STATUS → Import-Status bleibt', () => {
  const layer = layerMitAntworten();
  layer.antworten[G1].status = 'Fremd';
  const topics = antwortTopics(layer);
  assert.equal(topics[0].topicStatus, 'Open'); // Fallback auf Import-Status
  assert.match(topics[0].kommentare[1].text, /Fremd:/); // Text zeigt ihn trotzdem
});

// --- Befund → Ticket (72-13, N-12) ----------------------------------------------

const WAND = 'nYqxeK5NUBtew1kQBTaHzk';

test('befundZuIssue: all four BCF states map onto the ticket states, anything else is open', () => {
  const erwartet = { Open: 'open', InProgress: 'in_progress', Resolved: 'resolved', Closed: 'closed' };
  for (const [bcf, ticket] of Object.entries(erwartet)) {
    assert.equal(befundZuIssue({ guid: G1, topicStatus: bcf }).status, ticket, bcf);
  }
  // Foreign containers: case and separators do not matter, unknown values open.
  assert.equal(befundZuIssue({ guid: G1, topicStatus: 'in progress' }).status, 'in_progress');
  assert.equal(befundZuIssue({ guid: G1, topicStatus: 'CLOSED' }).status, 'closed');
  assert.equal(befundZuIssue({ guid: G1, topicStatus: 'Assigned' }).status, 'open');
  assert.equal(befundZuIssue({ guid: G1 }).status, 'open');
  assert.equal(befundZuIssue({ guid: G1, topicStatus: 'constructor' }).status, 'open');
});

test('befundZuIssue: the answer status beats the import status', () => {
  const topic = { guid: G1.toUpperCase(), titel: 'A', topicStatus: 'Open' };
  const layer = setzeAntwort(leeresLayer(), G1, { status: 'Resolved', text: 'erledigt' });
  assert.equal(befundZuIssue(topic, { projectId: 'proj-1', layer }).status, 'resolved');
  // without the layer the import status counts
  assert.equal(befundZuIssue(topic, { projectId: 'proj-1' }).status, 'open');
});

test('befundZuIssue: full Issue contract (N-10) for a finding with elements', () => {
  const issue = befundZuIssue(
    {
      guid: G1,
      titel: ' Kollision Wand/Träger ',
      beschreibung: '40 mm Überlappung',
      topicStatus: 'InProgress',
      prioritaet: 'High',
      ifcGuids: [WAND, '0YvctVUKr0kx0OqL8q0Y0X'],
    },
    { projectId: 'proj-1' },
  );
  assert.deepEqual(issue, {
    project_id: 'proj-1',
    title: 'Kollision Wand/Träger',
    description: `40 mm Überlappung\n\nAus BCF-Befund ${G1}`,
    status: 'in_progress',
    priority: 'high',
    ifc_guids: [WAND, '0YvctVUKr0kx0OqL8q0Y0X'],
    bcf_topic_guid: G1,
    quelle: 'bcf',
    location: null,
    element_guid: WAND,
    element_id: WAND,
  });
});

test('befundZuIssue: missing guids, title and description do not break the contract', () => {
  const ohne = befundZuIssue({ guid: G2 });
  assert.equal(ohne.element_guid, '');
  assert.equal(ohne.element_id, '');
  assert.deepEqual(ohne.ifc_guids, []);
  assert.equal(ohne.title, 'BCF-Befund');
  assert.equal(ohne.description, `Aus BCF-Befund ${G2}`);
  assert.equal(ohne.project_id, null);
  assert.equal(ohne.location, null);
  // empty entries are dropped, the first real GlobalId becomes the element
  const leer = befundZuIssue({ guid: G2, ifcGuids: ['', '  ', WAND] });
  assert.deepEqual(leer.ifc_guids, [WAND]);
  assert.equal(leer.element_guid, WAND);
  // no topic at all: still a valid (if empty) record, no throw
  assert.equal(befundZuIssue(null).quelle, 'bcf');
});

test('befundZuIssue: priority mapping with fallback medium ([ASSUMED])', () => {
  const erwartet = { Critical: 'critical', High: 'high', Normal: 'medium', Medium: 'medium', Low: 'low', low: 'low' };
  for (const [bcf, ticket] of Object.entries(erwartet)) {
    assert.equal(befundZuIssue({ guid: G1, prioritaet: bcf }).priority, ticket, bcf);
  }
  for (const unbekannt of ['Major', '', null, undefined, 'constructor']) {
    assert.equal(befundZuIssue({ guid: G1, prioritaet: unbekannt }).priority, 'medium', String(unbekannt));
  }
});

test('ticketZuBefund: finds the ticket regardless of case, null otherwise', () => {
  const issues = [
    { id: 'iss-1', bcf_topic_guid: '' },
    { id: 'iss-2' },
    { id: 'iss-3', bcf_topic_guid: G1.toUpperCase() },
  ];
  assert.equal(ticketZuBefund(issues, G1)?.id, 'iss-3');
  assert.equal(ticketZuBefund(issues, ` ${G1.toUpperCase()} `)?.id, 'iss-3');
  assert.equal(ticketZuBefund(issues, G2), null);
  assert.equal(ticketZuBefund(issues, ''), null); // an empty guid never matches iss-1
  assert.equal(ticketZuBefund(issues, null), null);
  assert.equal(ticketZuBefund(null, G1), null);
});

test('Beispiel-BCF: three findings on real walls of musterprojekt.ifc, readable without warnings', () => {
  const repo = path.resolve(import.meta.dirname, '../..');
  const bytes = fs.readFileSync(path.join(repo, 'public/beispiel/musterprojekt.bcf'));
  const ifc = fs.readFileSync(path.join(repo, 'public/beispiel/musterprojekt.ifc'), 'utf8');
  const erg = parseBcfZip(new Uint8Array(bytes));
  assert.deepEqual(erg.warnungen, []);
  assert.equal(erg.version, '2.1');
  assert.equal(erg.topics.length, 3);
  const guids = erg.topics.flatMap((t) => t.ifcGuids);
  assert.deepEqual(guids.sort(), ['ByEL4kVnudH2KRAqbt_jN8', WAND, '_l18sXIahP4r7EydOgnVAx'].sort());
  for (const g of guids) assert.ok(ifc.includes(`IFCWALL('${g}'`), `${g} ist keine Wand im Musterprojekt`);
  assert.deepEqual([...new Set(erg.topics.map((t) => t.topicStatus))].sort(), ['InProgress', 'Open']);
  assert.deepEqual([...new Set(erg.topics.map((t) => t.prioritaet))].sort(), ['High', 'Normal']);
  // and each one becomes a ticket with its element
  for (const t of erg.topics) {
    const issue = befundZuIssue(t, { projectId: 'proj-1' });
    assert.equal(issue.element_guid, t.ifcGuids[0]);
    assert.ok(['high', 'medium'].includes(issue.priority));
    assert.ok(['open', 'in_progress'].includes(issue.status));
  }
});
