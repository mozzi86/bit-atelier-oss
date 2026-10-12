// Phase 65-03: the demo's sample model is a sales argument AND a regression
// test. The model carries three findings on purpose; if the check engine ever
// stops finding exactly those, the demo would quietly show a nicer result than
// the truth — so the expectation is pinned here and compared against the real
// pipeline (web-ifc geometry extraction + clash.js), not against a fixture.
//
// Plan 69-32 added rooms, base quantities, materials and a DIN 276 classification
// plus four deliberately incomplete elements. The second half of this file proves
// that with the app's own import (extractFromModel / mapToClassifiedElements) and
// with a plain text pass over the STEP file (referential integrity, determinism).
//
// Plan 69-19 (D-HR-03) grew the sample to three storeys, 523 elements and 24 graded
// findings (the hall of 65-03 stays first with its GlobalIds). The engine half now
// pins the per-storey counts of BEISPIEL_ERWARTET.jeGeschoss; the hall-specific
// quantity checks below restrict themselves to the hall (HALLE names).
//
// The IDS half cannot run here: parseIdsXml needs a DOMParser and Node has none
// (adding a dependency for it would need a decision). It is verified in the
// browser instead — tmp-e2e/tmp-verify-beispiel.mjs.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { clashPairs } from '@ifc/lib/clash.js';
import { extractFromModel, mapToClassifiedElements } from '@ifc/lib/ifcImport.js';
import { IFC_QUANTITY_KEYS } from '@core/lib/bimElements';
import { filterQuantity, filterTreffer } from '@ava/lib/avaFilters.js';
import {
  BEISPIEL_ERWARTET,
  BAUTEILE,
  BEFUNDE,
  HALLE,
  KOEDER,
  RAEUME,
  erzeugeIfc,
  erzeugeReadme,
  mengenVon,
} from '../../tools/beispielmodell-erzeugen.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, '../..');
const IFC = path.join(REPO, 'public/beispiel/musterprojekt.ifc');
const README = path.join(REPO, 'public/beispiel/README.md');

/** Size ceiling of the sample model (69-19, D-HR-03: "< 2 MB"), bytes. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Pair cap of the check suite (ModelCheck passes maxPairs 500 000; the engine default is 20 000). */
const LAUF = { maxPairs: 500_000 };

/** Names of the hall elements (65-03/69-32) — the hall-specific checks use only these. */
const HALLEN_NAMEN = new Set(HALLE.map((b) => b.name));

/**
 * Opens the stored sample model with web-ifc under Node (pattern from
 * tools/ifc-nativ-extract.mjs): streams the world triangles per element and runs
 * the app's own semantic import on the same open model.
 * @returns {Promise<{meta: object, trisJeId: Map<number, number[]>}>} triangles are
 *   flat x/y/z triples in web-ifc world space (axis order may differ from IFC)
 */
async function ladeBeispiel() {
  const WebIFC = require('web-ifc');
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(fs.readFileSync(IFC)), {
    COORDINATE_TO_ORIGIN: true,
  });
  assert.ok(modelID >= 0, 'web-ifc konnte das erzeugte IFC nicht öffnen');

  // Geometrie streamen: expressId → Welt-Dreiecke, danach Typ nachschlagen.
  /** @type {Map<number, number[]>} */
  const trisJeId = new Map();
  api.StreamAllMeshes(modelID, (mesh) => {
    const alle = [];
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const platziert = mesh.geometries.get(i);
      const geo = api.GetGeometry(modelID, platziert.geometryExpressID);
      const verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
      const idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
      const m = platziert.flatTransformation;
      for (let k = 0; k < idx.length; k++) {
        const v = idx[k] * 6;
        const x = verts[v], y = verts[v + 1], zz = verts[v + 2];
        alle.push(
          m[0] * x + m[4] * y + m[8] * zz + m[12],
          m[1] * x + m[5] * y + m[9] * zz + m[13],
          m[2] * x + m[6] * y + m[10] * zz + m[14],
        );
      }
    }
    if (alle.length >= 9) trisJeId.set(mesh.expressID, alle);
  });

  const meta = extractFromModel(api, modelID);
  api.CloseModel(modelID);
  return { meta, trisJeId };
}

/**
 * Volume of the axis-aligned bounding box of a triangle soup. For the sample's
 * box-shaped elements this IS the body volume, whatever the axis order.
 * @param {number[]} tris flat x/y/z triples in metres
 * @returns {number} m³
 */
function aabbVolumen(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (tris[i + a] < min[a]) min[a] = tris[i + a];
      if (tris[i + a] > max[a]) max[a] = tris[i + a];
    }
  }
  return (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
}

describe('Beispielmodell — Datei und Determinismus', () => {
  it('liegt im public-Ordner und ist klein genug für einen schnellen Start', () => {
    assert.ok(fs.existsSync(IFC), 'public/beispiel/musterprojekt.ifc fehlt — Generator laufen lassen');
    const bytes = fs.statSync(IFC).size;
    assert.ok(bytes < 2 * 1024 * 1024, `Modell zu groß: ${bytes} B (Grenze 2 MB)`);
  });

  it('wird bei jedem Lauf byte-identisch erzeugt', () => {
    assert.equal(
      erzeugeIfc(),
      fs.readFileSync(IFC, 'utf8'),
      'Die abgelegte Datei weicht vom Generator ab — neu erzeugen und committen',
    );
  });

  it('die IDS-Datei liegt daneben', () => {
    assert.ok(fs.existsSync(path.join(REPO, 'public/beispiel/musterprojekt.ids')));
    assert.ok(fs.existsSync(path.join(REPO, 'public/beispiel/README.md')), 'Herkunft muss dokumentiert sein');
  });
});

describe('Beispielmodell — was die Prüf-Engine tatsächlich findet', () => {
  let elemente;
  let lauf;
  /** @type {Map<number, {name: string, storey: string}>} */
  let nachId;

  before(async () => {
    const { meta, trisJeId } = await ladeBeispiel();
    const typJeId = new Map((meta.elements || []).map((e) => [e.expressId, e.ifcType]));
    nachId = new Map((meta.elements || []).map((e) => [e.expressId, e]));

    elemente = [...trisJeId.entries()].map(([expressId, tris]) => ({
      expressId,
      ifcType: typJeId.get(expressId) || 'IFCBUILDINGELEMENTPROXY',
      tris: new Float32Array(tris),
    }));
    lauf = clashPairs(elemente, LAUF);
  });

  /** Storey of a finding: element A, else element B. */
  const geschossVon = (c) => nachId.get(c.aId)?.storey || nachId.get(c.bId)?.storey;

  it('jedes Bauteil trägt Geometrie', () => {
    assert.equal(
      elemente.length,
      BAUTEILE.length,
      `erwartet ${BAUTEILE.length} Bauteile mit Dreiecken, gefunden ${elemente.length}`,
    );
    assert.equal(BAUTEILE.length, BEISPIEL_ERWARTET.bauteile);
  });

  it('mit der Paargrenze der Prüf-Suite wird kein Paar übersprungen', () => {
    assert.equal(lauf.uebersprungen, 0);
  });

  it('die harten Kollisionen: zwölf, je Geschoss wie dokumentiert — darunter der Kanal im Unterzug der Halle', () => {
    const hart = lauf.clashes.filter((c) => c.kind === 'hard');
    assert.equal(
      hart.length,
      BEISPIEL_ERWARTET.hart,
      `harte Kollisionen: ${hart.length}, erwartet ${BEISPIEL_ERWARTET.hart} — ` +
        JSON.stringify(hart.map((c) => `${nachId.get(c.aId)?.name} × ${nachId.get(c.bId)?.name}`)),
    );
    for (const [geschoss, soll] of Object.entries(BEISPIEL_ERWARTET.jeGeschoss)) {
      assert.equal(hart.filter((c) => geschossVon(c) === geschoss).length, soll.hart, `harte Kollisionen ${geschoss}`);
    }
    const halle = hart.find((c) => [c.aId, c.bId].some((id) => nachId.get(id)?.name === 'Lueftungskanal Zuluft'));
    assert.ok(halle, 'der Kanal der Halle kollidiert nicht mehr');
    assert.deepEqual([halle.aType, halle.bType].map((t) => String(t).toUpperCase()).sort(), ['IFCBEAM', 'IFCDUCTSEGMENT']);
  });

  it('die Doppelmodellierungen: sechs, je Geschoss wie dokumentiert — darunter die Ostwand der Halle', () => {
    const dupl = lauf.clashes.filter((c) => c.kind === 'duplicate');
    assert.equal(dupl.length, BEISPIEL_ERWARTET.duplikate);
    for (const [geschoss, soll] of Object.entries(BEISPIEL_ERWARTET.jeGeschoss)) {
      assert.equal(dupl.filter((c) => geschossVon(c) === geschoss).length, soll.duplikate, `Doppelungen ${geschoss}`);
    }
    assert.ok(dupl.some((c) => nachId.get(c.aId)?.name === 'Aussenwand Ost' || nachId.get(c.bId)?.name === 'Aussenwand Ost'));
  });

  it('sonst nichts — kein Bauteil kollidiert versehentlich', () => {
    assert.equal(
      lauf.clashes.length,
      BEISPIEL_ERWARTET.hart + BEISPIEL_ERWARTET.duplikate,
      'Zusatzbefunde: ' + JSON.stringify(lauf.clashes.map((c) => `${c.kind} ${nachId.get(c.aId)?.name}/${nachId.get(c.bId)?.name}`)),
    );
  });

  it('die dokumentierte Befundliste stimmt mit den Erwartungszahlen überein', () => {
    assert.equal(BEFUNDE.length, BEISPIEL_ERWARTET.befunde);
    const summe = { hart: 0, duplikat: 0, ids: 0 };
    for (const f of BEFUNDE) summe[f.art] += 1;
    assert.deepEqual([summe.hart, summe.duplikat, summe.ids],
      [BEISPIEL_ERWARTET.hart, BEISPIEL_ERWARTET.duplikate, BEISPIEL_ERWARTET.idsFehler]);
    for (const [geschoss, soll] of Object.entries(BEISPIEL_ERWARTET.jeGeschoss)) {
      const hier = BEFUNDE.filter((f) => f.geschoss === geschoss);
      assert.deepEqual(
        [hier.filter((f) => f.art === 'hart').length, hier.filter((f) => f.art === 'duplikat').length, hier.filter((f) => f.art === 'ids').length],
        [soll.hart, soll.duplikate, soll.idsFehler], geschoss,
      );
    }
  });

  it('der Lauf ist deterministisch — zweimal dieselbe Ausgabe', () => {
    assert.equal(JSON.stringify(clashPairs(elemente, LAUF)), JSON.stringify(lauf));
  });
});

// ---------------------------------------------------------------------------
// 69-32 — STEP text pass (no WASM): determinism, size, referential integrity
// ---------------------------------------------------------------------------

/**
 * Splits the DATA section of a STEP file into entities.
 * @param {string} text file content
 * @returns {{id: number, typ: string, args: string, zeile: string}[]}
 */
function zerlegeStep(text) {
  const zeilen = text.split('\n');
  const von = zeilen.indexOf('DATA;');
  const bis = zeilen.indexOf('ENDSEC;', von);
  assert.ok(von > 0 && bis > von, 'DATA-Abschnitt nicht gefunden');
  return zeilen.slice(von + 1, bis).map((zeile) => {
    const m = /^#(\d+)=([A-Z0-9_]+)\((.*)\);$/.exec(zeile);
    assert.ok(m, `keine gültige STEP-Zeile: ${zeile.slice(0, 80)}`);
    return { id: Number(m[1]), typ: m[2], args: m[3], zeile };
  });
}

/** Entity references (#n) of an argument list, string literals blanked out first. */
function verweise(args) {
  const ohneText = args.replace(/'(?:[^']|'')*'/g, "''");
  return [...ohneText.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

describe('Beispielmodell 69-32 — Datei: deterministisch, klein, referenzintegr', () => {
  const text = fs.readFileSync(IFC, 'utf8');
  const entitaeten = zerlegeStep(text);
  const nachId = new Map(entitaeten.map((e) => [e.id, e]));

  it('zweimal erzeugt ergibt byte-gleiche Ausgabe (Generator und Datei)', () => {
    const a = erzeugeIfc();
    const b = erzeugeIfc();
    assert.equal(a, b);
    assert.equal(a, text);
  });

  it('IFC4, kleiner als 2 MB, rein ASCII, nur LF', () => {
    assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\);/);
    const bytes = Buffer.byteLength(text, 'utf8');
    assert.ok(bytes < MAX_BYTES, `Modell zu groß: ${bytes} B (Grenze ${MAX_BYTES} B)`);
    assert.equal(bytes, text.length, 'Nicht-ASCII-Zeichen in der STEP-Datei (Umlaute gehören als \\X2\\…\\X0\\)');
    assert.ok(!text.includes('\r'), 'CR in der STEP-Datei — der Generator schreibt LF');
    assert.ok(text.endsWith('END-ISO-10303-21;\n'));
  });

  it('die #-Nummern sind lückenlos und eindeutig', () => {
    assert.equal(nachId.size, entitaeten.length, 'doppelte #-Nummer');
    entitaeten.forEach((e, i) => assert.equal(e.id, i + 1, `Lücke oder Sprung bei #${e.id}`));
  });

  it('jeder Verweis #nn zeigt auf eine existierende Entität', () => {
    const kaputt = [];
    for (const e of entitaeten) {
      for (const ziel of verweise(e.args)) {
        if (!nachId.has(ziel)) kaputt.push(`#${e.id} ${e.typ} → #${ziel}`);
      }
    }
    assert.deepEqual(kaputt, [], 'hängende Verweise');
  });

  it('alle GlobalIds sind 22 Zeichen lang, aus dem IFC-Alphabet und eindeutig', () => {
    const guids = entitaeten
      .map((e) => /^'([^']*)',#\d+,/.exec(e.args)?.[1])
      .filter((g) => g !== undefined);
    assert.ok(guids.length >= 40, `zu wenige GlobalIds gefunden: ${guids.length}`);
    for (const g of guids) assert.match(g, /^[0-9A-Za-z_$]{22}$/, `ungültige GlobalId ${g}`);
    assert.equal(new Set(guids).size, guids.length, 'doppelte GlobalId');
  });

  it('die GlobalIds der Bauteile sind unverändert (BCF-Beispiel verweist darauf)', () => {
    // The three walls of musterprojekt.bcf (befundSpur.test.js reads the same pins).
    for (const g of ['nYqxeK5NUBtew1kQBTaHzk', '_l18sXIahP4r7EydOgnVAx', 'ByEL4kVnudH2KRAqbt_jN8']) {
      assert.ok(text.includes(`IFCWALL('${g}'`), `${g} fehlt oder ist keine Wand mehr`);
    }
  });

  it('Anzahl je Klasse: ein Raum je Geschoss, eine Menge je Bauteil und Raum', () => {
    const anzahl = (typ) => entitaeten.filter((e) => e.typ === typ).length;
    const bauteile = BEISPIEL_ERWARTET.bauteile;
    assert.equal(anzahl('IFCBUILDINGSTOREY'), BEISPIEL_ERWARTET.geschosse);
    assert.equal(anzahl('IFCSPACE'), BEISPIEL_ERWARTET.raeume);
    assert.equal(anzahl('IFCELEMENTQUANTITY'), bauteile + BEISPIEL_ERWARTET.raeume);
    assert.equal(anzahl('IFCCLASSIFICATION'), 1);
    assert.equal(anzahl('IFCRELASSOCIATESMATERIAL'), anzahl('IFCMATERIAL'));
    assert.equal(anzahl('IFCRELASSOCIATESCLASSIFICATION'), anzahl('IFCCLASSIFICATIONREFERENCE'));
  });

  it('je Geschoss mindestens ein IfcSpace, per IfcRelAggregates zugeordnet', () => {
    const geschosse = entitaeten.filter((e) => e.typ === 'IFCBUILDINGSTOREY').map((e) => e.id);
    const raeume = new Set(entitaeten.filter((e) => e.typ === 'IFCSPACE').map((e) => e.id));
    assert.ok(geschosse.length >= 1);
    for (const g of geschosse) {
      const kinder = entitaeten
        .filter((e) => e.typ === 'IFCRELAGGREGATES')
        .map((e) => /^'[^']*',#\d+,\$,\$,#(\d+),\(([^)]*)\)$/.exec(e.args))
        .filter((m) => m && Number(m[1]) === g)
        .flatMap((m) => m[2].split(',').map((r) => Number(r.slice(1))));
      assert.ok(kinder.some((k) => raeume.has(k)), `Geschoss #${g} hat keinen IfcSpace`);
    }
  });

  it('jede Bauteil-Sorte hat ein IfcElementQuantity mit Länge, Fläche und Volumen', () => {
    const mengenDefs = new Map();
    for (const e of entitaeten.filter((x) => x.typ === 'IFCRELDEFINESBYPROPERTIES')) {
      const m = /\(#(\d+)\),#(\d+)$/.exec(e.args);
      assert.ok(m, `unerwartete Relation #${e.id}`);
      if (nachId.get(Number(m[2]))?.typ === 'IFCELEMENTQUANTITY') mengenDefs.set(Number(m[1]), Number(m[2]));
    }
    for (const typ of ['IFCSLAB', 'IFCWALL', 'IFCBEAM', 'IFCDUCTSEGMENT']) {
      const sorte = entitaeten.filter((e) => e.typ === typ);
      assert.ok(sorte.length >= 1, `Sorte ${typ} fehlt`);
      for (const b of sorte) {
        const def = nachId.get(mengenDefs.get(b.id));
        assert.ok(def, `${typ} #${b.id} ohne IfcElementQuantity`);
        const arten = new Set(verweise(def.args).map((q) => nachId.get(q).typ));
        for (const art of ['IFCQUANTITYLENGTH', 'IFCQUANTITYAREA', 'IFCQUANTITYVOLUME']) {
          assert.ok(arten.has(art), `${typ} #${b.id}: ${art} fehlt`);
        }
      }
    }
  });

  it('der Generator liefert dieselben Mengen wie die Quader (reine Funktion)', () => {
    const wand = BAUTEILE.find((b) => b.name === 'Aussenwand Sued');
    const werte = Object.fromEntries(mengenVon(wand).map((m) => [m.name, m.wert]));
    assert.deepEqual(werte, {
      Length: 12, Width: 0.24, Height: 3,
      GrossSideArea: 36, NetSideArea: 36, GrossVolume: 8.64, NetVolume: 8.64,
    });
  });

  it('die README stimmt mit dem Generator überein (inklusive BCF-Abschnitt)', () => {
    // Windows checkouts may carry CRLF in README.md (it is not in .gitattributes).
    const datei = fs.readFileSync(README, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(datei, erzeugeReadme(), 'public/beispiel/README.md weicht ab — Generator laufen lassen');
    assert.match(datei, /## Beispiel-BCF/, 'der BCF-Abschnitt darf beim Neuerzeugen nicht verloren gehen');
  });
});

describe('Beispielmodell 69-32 — was der App-Import daraus liest', () => {
  let meta;
  let trisJeId;
  let bauteile;
  let raeume;

  before(async () => {
    ({ meta, trisJeId } = await ladeBeispiel());
    raeume = meta.elements.filter((e) => e.ifcType === 'IfcSpace');
    bauteile = meta.elements.filter((e) => e.ifcType !== 'IfcSpace');
  });

  it('Bauteile und Räume wie erwartet, Räume sind keine Bauteile und tragen keine Geometrie', () => {
    assert.equal(bauteile.length, BEISPIEL_ERWARTET.bauteile);
    assert.equal(raeume.length, BEISPIEL_ERWARTET.raeume);
    assert.equal(RAEUME.length, BEISPIEL_ERWARTET.raeume);
    assert.equal(trisJeId.size, BEISPIEL_ERWARTET.bauteile, 'ein Raum würde als Mesh gestreamt');
    assert.equal(meta.storeys.length, BEISPIEL_ERWARTET.geschosse);
    assert.equal(meta.kennzahlen.anzahl, BEISPIEL_ERWARTET.bauteile + BEISPIEL_ERWARTET.raeume);
  });

  it('jedes Geschoss hat mindestens einen Raum mit Name und Nummer', () => {
    for (const geschoss of meta.storeys) {
      const imGeschoss = raeume.filter((r) => r.geschoss === geschoss);
      assert.ok(imGeschoss.length >= 1, `Geschoss „${geschoss}“ ohne Raum`);
      for (const r of imGeschoss) {
        assert.ok(r.name && r.name.length > 0, 'Raum ohne Name');
        assert.match(String(r.psets?.Pset_SpaceCommon?.Reference), /^\d+\.\d+$/, 'Raum ohne Nummer');
      }
    }
    assert.equal(meta.kennzahlen.ohne_geschoss, 0, 'ein Element hängt an keinem Geschoss');
  });

  it('jedes Bauteil und jeder Raum trägt Länge, Fläche und Volumen (> 0)', () => {
    for (const e of meta.elements) {
      assert.ok(e.mengen.length > 0, `${e.name}: keine Länge`);
      assert.ok(e.mengen.area > 0, `${e.name}: keine Fläche`);
      assert.ok(e.mengen.volume > 0, `${e.name}: kein Volumen`);
      for (const k of Object.keys(e.qty)) assert.ok(IFC_QUANTITY_KEYS.includes(k), `${k} kennt der Import nicht`);
    }
    assert.equal(meta.kennzahlen.mit_qty, meta.kennzahlen.anzahl);
  });

  it('die Mengen kommen aus der Geometrie: NetVolume = Volumen des Körpers', () => {
    for (const e of bauteile) {
      const tris = trisJeId.get(e.expressId);
      assert.ok(tris, `${e.name}: keine Dreiecke`);
      const soll = aabbVolumen(tris);
      const ist = e.qty.NetVolume;
      assert.ok(
        Math.abs(ist - soll) < 1e-3 * Math.max(1, soll),
        `${e.name}: NetVolume ${ist} m³, Körper ${soll.toFixed(4)} m³`,
      );
    }
  });

  it('die Raumfläche folgt den Wänden: Plattenfläche minus Wandgrundflächen', () => {
    // The hall (69-19: the office block has its own rooms, checked by their boxes in the generator).
    const raum = raeume.find((r) => r.name === 'Halle');
    const platte = bauteile.find((b) => b.ifcType === 'IfcSlab' && HALLEN_NAMEN.has(b.name));
    const waende = bauteile.filter((b) => b.ifcType === 'IfcWall' && HALLEN_NAMEN.has(b.name) && !/Doppelung/.test(b.name));
    assert.equal(waende.length, 4);
    // wall footprint = volume / height, both from the mesh of the wall
    const grundflaeche = waende.reduce(
      (summe, w) => summe + aabbVolumen(trisJeId.get(w.expressId)) / w.qty.Height, 0,
    );
    assert.ok(
      Math.abs(raum.qty.NetFloorArea - (platte.qty.NetArea - grundflaeche)) < 1e-3,
      `Raumfläche ${raum.qty.NetFloorArea} m² ≠ ${(platte.qty.NetArea - grundflaeche).toFixed(4)} m²`,
    );
    assert.ok(Math.abs(raum.qty.NetVolume - raum.qty.NetFloorArea * raum.qty.Height) < 1e-3);
  });

  it('genau die vier Köder fehlen an Material bzw. Klassifikation — je Sorte einer', () => {
    const ohneMaterial = bauteile.filter((e) => !e.material).map((e) => e.name).sort();
    const ohneKlass = bauteile.filter((e) => !e.klassifikation).map((e) => e.name).sort();
    assert.deepEqual(ohneMaterial, ['Aussenwand West', 'Bodenplatte']);
    assert.deepEqual(ohneKlass, ['Lueftungskanal Zuluft', 'Unterzug Achse C']);

    const koeder = [...ohneMaterial, ...ohneKlass];
    assert.equal(new Set(koeder).size, BEISPIEL_ERWARTET.koeder, 'ein Bauteil fehlt an beidem oder ein Köder fehlt');
    const sorten = koeder.map((n) => bauteile.find((e) => e.name === n).ifcType).sort();
    assert.deepEqual(sorten, ['IfcBeam', 'IfcDuctSegment', 'IfcSlab', 'IfcWall']);

    // the generator's own list agrees with what the import sees
    assert.deepEqual(
      KOEDER.map((k) => `${k.name}:${k.fehlt}`).sort(),
      [
        'Aussenwand West:material', 'Bodenplatte:material',
        'Lueftungskanal Zuluft:klassifikation', 'Unterzug Achse C:klassifikation',
      ],
    );
  });

  it('alle übrigen Bauteile sind vollständig: Material und DIN-276-Klassifikation', () => {
    const koeder = new Set(KOEDER.map((k) => k.name));
    // 69-19: the building construction carries 3xx; services (4xx) and furniture (6xx)
    // carry their own group, which the app import files under its default.
    const bau = new Set(['IfcWall', 'IfcSlab', 'IfcBeam', 'IfcDoor', 'IfcWindow']);
    for (const e of bauteile.filter((b) => !koeder.has(b.name))) {
      assert.ok(e.material, `${e.name}: Material fehlt`);
      assert.equal(e.classifications.length, 1, `${e.name}: Klassifikation fehlt`);
      assert.match(e.classifications[0], bau.has(e.ifcType) ? /^3\d\d / : /^[46]\d\d /, `${e.name}: falsche DIN-276-Gruppe`);
    }
    // umlauts survive the STEP escape (\X2\…\X0\) on the way through web-ifc
    const wand = bauteile.find((b) => b.name === 'Aussenwand Sued');
    assert.equal(wand.classifications[0], '331 Tragende Außenwände');
  });

  it('die Zuordnung der App: Außenwände sind Rohbau und Kostengruppe 331', () => {
    const klassifiziert = mapToClassifiedElements(meta);
    const istAussen = (e) => meta.elements.find((x) => x.id === e.id)?.psets?.Pset_WallCommon?.IsExternal === true;
    const waende = klassifiziert.filter((e) => e.ifc_klasse === 'IfcWall' && istAussen(e));
    // hall 5 + office 16 per storey (12 facade segments + 4 gable segments) × 3
    assert.equal(waende.length, 5 + 16 * 3);
    for (const w of waende) {
      assert.equal(w.kind, 'wall-hull', `${w.id}: IsExternal fehlt, der Import liest eine Innenwand`);
      assert.equal(w.gewerk, 'Rohbau');
      assert.equal(w.kg, '331');
    }
    const kg = (name) => klassifiziert.find((e) => e.id === meta.elements.find((x) => x.name === name).id).kg;
    assert.equal(kg('Bodenplatte'), '322');
    assert.equal(kg('Unterzug Achse B'), '351');
  });

  it('die AVA-Filter rechnen auf dem Modell: Kostengruppe 331, Material, Lücken (Halle)', () => {
    const hallenIds = new Set(meta.elements.filter((x) => HALLEN_NAMEN.has(x.name) || x.name === 'Halle').map((x) => x.id));
    const klassifiziert = mapToClassifiedElements(meta).filter((e) => hallenIds.has(e.id));
    // KG 331: five walls, the duplicate counts — "in der Menge doppelt" (README).
    // 8.64 + 8.64 + 3 x 5.4144 = 33.5232 m³ → rounded to 2 decimals by the engine.
    assert.deepEqual(
      filterQuantity(klassifiziert, { was: { kg: ['331'] } }, 'volume'),
      { menge: 33.52, treffer: 5 },
    );
    assert.deepEqual(
      filterQuantity(klassifiziert, { was: { kg: ['331'] } }, 'area'),
      { menge: 36 + 36 + 3 * 22.56, treffer: 5 },
    );
    // Material filter: four walls — the western one is a bait without material.
    assert.deepEqual(
      filterQuantity(klassifiziert, { muster: { material: 'Kalksandstein*' } }, 'volume'),
      { menge: 28.11, treffer: 4 },
    );
    // The slab has no material: "Stahlbeton" finds the two beams only.
    assert.equal(filterTreffer(klassifiziert, { was: { schicht: ['Stahlbeton'] } }), 2);
    // Room book: the net floor area is what the quantity source offers for the room.
    assert.deepEqual(
      filterQuantity(klassifiziert, { was: { ifc_klasse: ['IfcSpace'] } }, 'area'),
      { menge: 86.63, treffer: 1 },
    );
  });

  it('die AVA-Filter rechnen auf dem ganzen Modell: Kostengruppe 331 = Generator-Quader', () => {
    const klassifiziert = mapToClassifiedElements(meta);
    const soll = BAUTEILE.filter((b) => b.kg === '331');
    const vol = soll.reduce((s, b) => s + (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]), 0);
    const ist = filterQuantity(klassifiziert, { was: { kg: ['331'] } }, 'volume');
    assert.equal(ist.treffer, soll.length);
    assert.ok(Math.abs(ist.menge - vol) < 0.02, `KG 331: ${ist.menge} m³ ≠ ${vol.toFixed(2)} m³`);
  });

  it('die Erwartungswerte des Beispiels bleiben (Kollisionen, Duplikate, IDS, Geschosse)', () => {
    assert.deepEqual(
      [BEISPIEL_ERWARTET.hart, BEISPIEL_ERWARTET.duplikate, BEISPIEL_ERWARTET.idsFehler, BEISPIEL_ERWARTET.geschosse],
      [12, 6, 6, 3],
    );
    // exactly the documented walls lack the FireRating the IDS demands — the hall's
    // northern wall is still one of them (stand-in for the IDS run, no DOMParser here)
    const ohne = bauteile.filter((b) => b.ifcType === 'IfcWall' && !b.psets?.Pset_WallCommon?.FireRating).map((b) => b.name).sort();
    const doku = BEFUNDE.filter((f) => f.art === 'ids').map((f) => f.wo.replace(' (Halle)', '')).sort();
    assert.deepEqual(ohne, doku);
    assert.ok(ohne.includes('Aussenwand Nord'));
  });
});
