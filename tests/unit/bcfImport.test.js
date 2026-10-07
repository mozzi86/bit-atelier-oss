// bcfImport.test.js — Phase 71-04 Task 1: BCF-Container lesen.
// Plan-Tests (5): Roundtrip buildBcfZip→parseBcfZip; handgebautes Mini-BCF
// mit Comment+Snapshot; fehlendes markup.bcf → Warnung kein Wurf;
// Version 3.0 → Warnung; Zip über Grenze → Klartextfehler.
// Roundtrip-GUIDs sind deterministisch (uuid v4-Form, feste Werte).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';

import { buildBcfZip, zipStore } from '@ifc/lib/bcf';
import { parseBcfZip } from '@ifc/lib/bcfImport';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';
const IFC_G1 = '0YvctVUKr0kx0OqL8q0Y0X'; // 22 Zeichen

// --- Test 1: Roundtrip über den ECHTEN Writer ------------------------------

test('Roundtrip: buildBcfZip → parseBcfZip — Titel, Guids, Status, Komponenten', () => {
  const bytes = buildBcfZip(
    [
      {
        guid: G1,
        titel: 'IfcWall<->IfcBeam Kollision',
        beschreibung: 'Wand trägt Unterzug 40 mm',
        topicType: 'Clash',
        topicStatus: 'Open',
        ifcGuids: [IFC_G1],
      },
      { guid: G2, titel: 'Öffnung ohne Sturz', topicStatus: 'Resolved', ifcGuids: [] },
      { guid: G3, titel: 'Duplikat Träger', topicStatus: 'Closed', ifcGuids: [] },
    ],
    { autor: 'BIT-Atelier', modellName: 'tx.ifc', datum: '2026-09-10T00:00:00.000Z' },
  );
  const erg = parseBcfZip(bytes);

  assert.equal(erg.version, '2.1');
  assert.equal(erg.topics.length, 3);
  assert.deepEqual(erg.warnungen, []);

  const t1 = erg.topics.find((t) => t.guid === G1);
  assert.equal(t1.titel, 'IfcWall<->IfcBeam Kollision'); // xmlEscape-Reverse
  assert.equal(t1.beschreibung, 'Wand trägt Unterzug 40 mm');
  assert.equal(t1.topicType, 'Clash');
  assert.equal(t1.topicStatus, 'Open');
  assert.equal(t1.creationAuthor, 'BIT-Atelier');
  assert.equal(t1.creationDate, '2026-09-10T00:00:00.000Z');
  assert.deepEqual(t1.ifcGuids, [IFC_G1]);
  assert.match(t1.viewpoints[0].guid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(t1.dateien[0].name, 'tx.ifc');

  // Alle importierten Stati kommen unverändert zurück (frei wählbar, 71-04).
  const stati = erg.topics.map((t) => t.topicStatus).sort();
  assert.deepEqual(stati, ['Closed', 'Open', 'Resolved']);
});

// --- Test 2: handgebautes Mini-BCF mit Comment + Snapshot ------------------

function miniBcf({ version = '2.1', snapshot = true, kommentar = true } = {}) {
  const markup = `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Topic Guid="${G1}" TopicType="Issue" TopicStatus="Open">
    <Title>Handgebaut &amp; kommentiert</Title>
    <CreationDate>2026-08-01T10:00:00Z</CreationDate>
    <CreationAuthor>solibri@example.com</CreationAuthor>
  </Topic>
  ${kommentar ? `<Comment Guid="${G2}">
    <Date>2026-08-02T09:00:00Z</Date>
    <Author>gp@example.com</Author>
    <Comment>Bitte prüfen &lt;dringend&gt;</Comment>
    <Viewpoint Guid="${G3}" />
  </Comment>` : ''}
  <Viewpoints Guid="${G3}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
    ${snapshot ? '<Snapshot>snapshot.png</Snapshot>' : ''}
  </Viewpoints>
</Markup>
`;
  const bcfv = `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${G3}">
  <Components>
    <Selection>
      <Component IfcGuid="${IFC_G1}" />
      <Component IfcGuid="zu-kurz" />
    </Selection>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint><X>1</X><Y>2</Y><Z>3</Z></CameraViewPoint>
    <CameraDirection><X>0</X><Y>0</Y><Z>-1</Z></CameraDirection>
    <CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector>
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>
`;
  const eintraege = [
    { name: 'bcf.version', data: `<Version VersionId="${version}" />` },
    { name: `${G1}/markup.bcf`, data: markup },
    { name: `${G1}/viewpoint.bcfv`, data: bcfv },
  ];
  if (snapshot) eintraege.push({ name: `${G1}/snapshot.png`, data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) });
  return zipStore(eintraege);
}

test('Mini-BCF: Comment gelesen, Snapshot als Bytes, Kamera durchgereicht', () => {
  const erg = parseBcfZip(miniBcf());
  assert.equal(erg.topics.length, 1);
  const t = erg.topics[0];
  assert.equal(t.titel, 'Handgebaut & kommentiert');
  assert.equal(t.kommentare.length, 1);
  assert.equal(t.kommentare[0].text, 'Bitte prüfen <dringend>');
  assert.equal(t.kommentare[0].autor, 'gp@example.com');
  assert.equal(t.kommentare[0].viewpointGuid, G3);
  assert.deepEqual(t.ifcGuids, [IFC_G1]); // „zu-kurz" gefiltert …
  assert.ok(erg.warnungen.some((w) => /zu-kurz/.test(w) && /22 Zeichen/.test(w))); // … mit Warnung
  assert.equal(erg.snapshots[G1].length, 4); // PNG-Signatur-Bytes durchgereicht
  assert.equal(t.viewpoints[0].kamera.typ, 'perspektive');
  assert.deepEqual(t.viewpoints[0].kamera.position, { x: 1, y: 2, z: 3 });
  assert.equal(t.viewpoints[0].kamera.fieldOfView, 60);
});

// --- Test 3: fehlendes markup.bcf → Warnung, kein Wurf ----------------------

test('Ordner ohne markup.bcf → Warnung, Container bleibt lesbar', () => {
  const eintraege = [
    { name: 'bcf.version', data: '<Version VersionId="2.1" />' },
    { name: `${G1}/markup.bcf`, data: miniMarkup(G1) },
    { name: 'kaputt-ordner/irgendwas.png', data: new Uint8Array([1, 2, 3]) },
  ];
  const erg = parseBcfZip(zipStore(eintraege));
  assert.equal(erg.topics.length, 1);
  assert.ok(erg.warnungen.some((w) => /kaputt-ordner/.test(w) && /ohne markup\.bcf/.test(w)));
});

function miniMarkup(guid) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup><Topic Guid="${guid}" TopicType="Issue" TopicStatus="Open">
<Title>T</Title><CreationDate>2026-01-01T00:00:00Z</CreationDate><CreationAuthor>a</CreationAuthor>
</Topic><Viewpoints Guid="${guid}"><Viewpoint>viewpoint.bcfv</Viewpoint></Viewpoints></Markup>`;
}

// --- Test 4: Version ≠ 2.1 → lesen + warnen --------------------------------

test('Version 3.0 → Warnung, Topics werden trotzdem gelesen', () => {
  const erg = parseBcfZip(miniBcf({ version: '3.0', snapshot: false }));
  assert.equal(erg.version, '3.0');
  assert.ok(erg.warnungen.some((w) => /3\.0/.test(w) && /≠ 2\.1/.test(w)));
  assert.equal(erg.topics.length, 1);
});

test('fehlende bcf.version → Warnung, Version null', () => {
  const zip = zipSync({ [`${G1}/markup.bcf`]: strToU8(miniMarkup(G1)) });
  const erg = parseBcfZip(zip);
  assert.equal(erg.version, null);
  assert.ok(erg.warnungen.some((w) => /bcf\.version fehlt/.test(w)));
  assert.equal(erg.topics.length, 1);
});

// --- Test 5: Grenzen (Zip-Bombe, T-71-07) -----------------------------------

test('entpackte Größe über maxEntpackt → Klartextfehler', () => {
  // miniBcf ist klein; Grenze auf 50 Byte ziehen → Fehler.
  assert.throws(() => parseBcfZip(miniBcf(), { maxEntpackt: 50 }), /entpackte Größe/i);
});

test('kein ZIP → Klartextfehler, String-Eingabe → Klartextfehler', () => {
  assert.throws(() => parseBcfZip(new Uint8Array([1, 2, 3, 4])), /ZIP konnte nicht entpackt/);
  assert.throws(() => parseBcfZip('<Markup/>'), /Rohbytes erwartet/);
});

test('leerer Container ohne Topics → Warnung statt Wurf', () => {
  const zip = zipSync({ 'bcf.version': strToU8('<Version VersionId="2.1" />') });
  const erg = parseBcfZip(zip);
  assert.equal(erg.topics.length, 0);
  assert.ok(erg.warnungen.some((w) => /Kein Topic/.test(w)));
});
