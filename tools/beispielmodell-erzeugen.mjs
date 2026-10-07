#!/usr/bin/env node
// Generates the sample model that the online demo's check suite offers on its
// empty screen (Phase 65-03).
//
// Why a generator and not a checked-in blob: the website sells the check engine,
// and the demo used to ask the visitor for their own IFC first — a file nobody
// hands over on a first visit (finding BEF-01 / BL-04). The sample model closes
// that gap, but only if it is trustworthy: it must be synthetic (no client
// data), reproducible (byte-identical on re-run), and its findings must be
// KNOWN, so the demo's result doubles as a regression test of the check engine.
//
// In:  nothing — the geometry is a fixed list of boxes below.
// Out: public/beispiel/musterprojekt.ifc   (IFC4, real swept-solid geometry, plus —
//                                           since 69-32 — rooms, base quantities,
//                                           materials and a DIN 276 classification)
//      public/beispiel/musterprojekt.ids   (IDS 1.0, one requirement)
//      public/beispiel/README.md           (provenance + the built-in findings)
//
// Deterministic by construction: fixed GlobalIds, fixed order, no timestamps in
// the data section. Re-running must leave `git status` clean.
//
// 69-32 (hebel register no. 122): the model used to be pure geometry — nothing
// behind the "quantities and costs" door. The additions are APPENDED after the
// original entities, so the spatial structure, all nine elements and their
// GlobalIds keep their #numbers (musterprojekt.bcf and tests point at them).
// Four elements (one per sort) deliberately lack a material or a classification
// so that a checker has something to report — see KOEDER.
//
// Usage: node tools/beispielmodell-erzeugen.mjs

import fs from 'node:fs';
import path from 'node:path';

// import.meta.dirname, nicht new URL(import.meta.url).pathname: letzteres liefert
// unter Windows "/C:/Users/<Name>%20<Name>/..." — mit führendem Slash und
// prozentkodierten Leerzeichen. (Dasselbe Muster steht noch in
// tools/ifc-nativ-extract.mjs; dort nur notiert, nicht angefasst.)
const REPO = path.resolve(import.meta.dirname, '..');
const ZIEL = path.join(REPO, 'public', 'beispiel');

/**
 * What the check engine must find in this model. Pinned here so the unit test
 * and the headless demo run compare against ONE source, and a silent change in
 * the engine shows up as a failing expectation rather than a nicer-looking demo.
 */
export const BEISPIEL_ERWARTET = {
  /** Hard collision: the duct runs through the western downstand beam. */
  hart: 1,
  /** The eastern wall was modelled twice. */
  duplikate: 1,
  /** One wall lacks the fire rating the IDS demands. */
  idsFehler: 1,
  /** Elements carrying geometry. Rooms are no elements here: they carry none. */
  bauteile: 9,
  geschosse: 1,
  /** IfcSpace entities, at least one per storey (69-32). */
  raeume: 1,
  /** Deliberately incomplete elements, one per sort — see KOEDER (69-32). */
  koeder: 4,
};

// --------------------------------------------------------------------------
// Geometry — axis-aligned boxes in metres, IFC convention (Z up).
//
// A single hall, 12 x 8 m, 3 m clear. Two downstand beams, one ventilation
// duct. Every position is chosen so that EXACTLY the intended findings appear
// and nothing else touches: the duct stops at x = 7 so it never reaches the
// eastern wall, the beams start at x = 0.5 so they never touch the walls they
// would otherwise rest on, and the slab sits fully below z = 0.
// --------------------------------------------------------------------------

/**
 * Materials of the sample model, keyed by the `material` field of BAUTEILE.
 * Names are plain ASCII on purpose (they also appear as IfcMaterial.Name).
 * [ASSUMED] Plausible demo choices, not a structural design: the walls are
 * calcium-silicate masonry (F90, load bearing), the beams reinforced concrete,
 * the duct galvanised sheet steel. `kategorie` is IfcMaterial.Category.
 * The app import maps names through SCHICHTEN (bimClassification.js): "Stahlbeton"
 * and "Kalksandstein" are in that vocabulary, "Verzinktes Stahlblech" stays as is.
 * @type {Record<string, {name: string, kategorie: string}>}
 */
const MATERIALIEN = {
  beton: { name: 'Stahlbeton C25/30', kategorie: 'Beton' },
  mauerwerk: { name: 'Kalksandstein-Mauerwerk', kategorie: 'Mauerwerk' },
  stahlblech: { name: 'Verzinktes Stahlblech', kategorie: 'Stahl' },
};

/**
 * DIN 276 cost groups used by the model, keyed by the `kg` field of BAUTEILE.
 * [CITED] DIN 276:2018-12 "Kosten im Bauwesen", cost group 300 (Bauwerk -
 * Baukonstruktionen). 322 and 351 carry the wording of the app's own catalog
 * (packages/nova-core/server/catalog-seed.js DIN276_2018, so the IFC reference and
 * the AVA screens name the group alike); 331 is not in that catalog.
 * [ASSUMED] The 331 wording is quoted from memory — compare it with the licensed norm
 * text before the file is shown outside the demo. Titles carry umlauts and are
 * escaped by stepText(). Only groups that an element uses are written to the file.
 * The app import reads exactly the leading "3xx" of such a reference as the cost
 * group (ifcImport.js kgOf); a reference outside 3xx (e.g. 4xx building services)
 * falls back to the element's default group there.
 * @type {Record<string, string>}
 */
const KOSTENGRUPPEN = {
  '322': 'Flachgründungen',
  '331': 'Tragende Außenwände',
  '351': 'Deckenkonstruktionen',
};

/**
 * @typedef {object} Bauteil
 * @property {string} name IfcRoot.Name
 * @property {string} typ IFC entity name, upper case
 * @property {number[]} min lower box corner [x, y, z] in metres
 * @property {number[]} max upper box corner [x, y, z] in metres
 * @property {Record<string, string>} [pset] single values of the Pset_*Common set
 * @property {string} [material] key into MATERIALIEN — MISSING means "no material" (bait)
 * @property {string} [kg] key into KOSTENGRUPPEN — MISSING means "no classification" (bait)
 */

/** @type {Bauteil[]} */
const BAUTEILE = [
  {
    // Absicht (Koeder Decke): OHNE Material — die einzige Platte hat kein Material
    // im Modell, ein Mengenermittler kann sie keiner Betonposition zuordnen.
    name: 'Bodenplatte',
    typ: 'IFCSLAB',
    min: [0, 0, -0.25],
    max: [12, 8, 0],
    pset: { LoadBearing: 'T' },
    kg: '322',
  },
  {
    name: 'Aussenwand Sued',
    typ: 'IFCWALL',
    min: [0, 0, 0],
    max: [12, 0.24, 3],
    pset: { FireRating: 'F90', LoadBearing: 'T', IsExternal: 'T' },
    material: 'mauerwerk',
    kg: '331',
  },
  {
    // Absicht: OHNE FireRating — das ist der IDS-Befund.
    name: 'Aussenwand Nord',
    typ: 'IFCWALL',
    min: [0, 7.76, 0],
    max: [12, 8, 3],
    pset: { LoadBearing: 'T', IsExternal: 'T' },
    material: 'mauerwerk',
    kg: '331',
  },
  {
    // Absicht (Koeder Wand): OHNE Material — „eine Wand ohne Material" kennt jeder
    // Mengenermittler. Die Wand traegt weder den IDS- noch den Kollisionsbefund.
    name: 'Aussenwand West',
    typ: 'IFCWALL',
    min: [0, 0.24, 0],
    max: [0.24, 7.76, 3],
    pset: { FireRating: 'F90', LoadBearing: 'T', IsExternal: 'T' },
    kg: '331',
  },
  {
    name: 'Aussenwand Ost',
    typ: 'IFCWALL',
    min: [11.76, 0.24, 0],
    max: [12, 7.76, 3],
    pset: { FireRating: 'F90', LoadBearing: 'T', IsExternal: 'T' },
    material: 'mauerwerk',
    kg: '331',
  },
  {
    // Absicht: deckungsgleich mit „Aussenwand Ost", eigene GlobalId — das ist
    // der Duplikat-Befund (zweimal modelliert, in der Ansicht unsichtbar).
    // Material und Kostengruppe wie das Original: die Menge steht doppelt im Modell.
    name: 'Aussenwand Ost (Doppelung)',
    typ: 'IFCWALL',
    min: [11.76, 0.24, 0],
    max: [12, 7.76, 3],
    pset: { FireRating: 'F90', LoadBearing: 'T', IsExternal: 'T' },
    material: 'mauerwerk',
    kg: '331',
  },
  {
    name: 'Unterzug Achse B',
    typ: 'IFCBEAM',
    min: [0.5, 1.85, 2.5],
    max: [11.5, 2.15, 3.0],
    pset: { LoadBearing: 'T' },
    material: 'beton',
    kg: '351',
  },
  {
    // Absicht (Koeder Unterzug): OHNE Klassifikation — keine Kostengruppe.
    name: 'Unterzug Achse C',
    typ: 'IFCBEAM',
    min: [0.5, 5.85, 2.5],
    max: [11.5, 6.15, 3.0],
    pset: { LoadBearing: 'T' },
    material: 'beton',
  },
  {
    // Absicht: schneidet „Unterzug Achse B" (y 1.90-2.15, z 2.60-3.00) — das
    // ist die harte Kollision. Endet bei x = 7, damit sie die einzige bleibt.
    // Absicht (Koeder Kanal): OHNE Klassifikation — das TGA-Bauteil hat keine
    // Kostengruppe; der App-Import legt es dann stillschweigend unter 390 ab.
    name: 'Lueftungskanal Zuluft',
    typ: 'IFCDUCTSEGMENT',
    min: [1.0, 1.9, 2.6],
    max: [7.0, 2.3, 3.0],
    material: 'stahlblech',
  },
];

/**
 * The four deliberate gaps, one per sort (slab, wall, beam, duct): an element
 * without a `material` or `kg` key IS the bait. Derived from BAUTEILE so the
 * data, the README and the test cannot drift apart.
 * @type {{name: string, typ: string, fehlt: 'material'|'klassifikation'}[]}
 */
const KOEDER = BAUTEILE.flatMap((b) => [
  ...(b.material ? [] : [{ name: b.name, typ: b.typ, fehlt: /** @type {const} */ ('material') }]),
  ...(b.kg ? [] : [{ name: b.name, typ: b.typ, fehlt: /** @type {const} */ ('klassifikation') }]),
]);

/** Name of the single storey. 69-19 turns this into a list of storeys. */
const GESCHOSS_NAME = 'Erdgeschoss';

/**
 * The rooms of the model: one per storey. The box is NOT typed in but derived
 * from the wall and slab boxes (clear space between the inner wall faces, from the
 * slab top to the wall top), so the room quantities follow the geometry.
 * Rooms carry no body: web-ifc streams no mesh for them, the clash run and the
 * "elements with geometry" count stay at nine, and nothing can collide with a room.
 * @returns {{name: string, langname: string, nummer: string, geschoss: string,
 *            min: number[], max: number[]}[]} boxes in metres
 */
function raumDefinitionen() {
  const box = (name) => {
    const b = BAUTEILE.find((x) => x.name === name);
    if (!b) throw new Error(`Bauteil fehlt: ${name}`);
    return b;
  };
  const platte = box('Bodenplatte');
  const sued = box('Aussenwand Sued');
  const nord = box('Aussenwand Nord');
  const west = box('Aussenwand West');
  const ost = box('Aussenwand Ost');
  return [
    {
      name: 'Halle',
      langname: 'Musterhalle',
      // Raumbuch-style number "<storey>.<running>" — kept in Pset_SpaceCommon.Reference.
      nummer: '0.01',
      geschoss: GESCHOSS_NAME,
      min: [west.max[0], sued.max[1], platte.max[2]],
      max: [ost.min[0], nord.min[1], sued.max[2]],
    },
  ];
}

const RAEUME = raumDefinitionen();

// --------------------------------------------------------------------------
// IFC-Schreiber
// --------------------------------------------------------------------------

const GUID_ZEICHEN = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/**
 * Deterministic 22-character IFC GlobalId. Not a compressed UUID — it only has
 * to be unique, stable across runs and made of the IFC base64 alphabet.
 * @param {string} praefix short tag, e.g. "WALL"
 * @param {number} n running number
 * @returns {string}
 */
function guid(praefix, n) {
  const kern = `${praefix}${n}`;
  let raus = '';
  for (let i = 0; i < 22; i++) {
    const code = kern.charCodeAt(i % kern.length) + i * 7 + n * 13;
    raus += GUID_ZEICHEN[code % GUID_ZEICHEN.length];
  }
  return raus;
}

/** Formats a number the way STEP wants it: always with a decimal point. */
function z(v) {
  return Number.isInteger(v) ? `${v}.` : String(v);
}

/**
 * STEP string literal. ISO 10303-21 text is ASCII: a backslash and an apostrophe
 * are doubled, every other non-ASCII character becomes `\X2\hhhh\X0\` (BMP only).
 * The generator's older strings are plain ASCII and bypass this; new texts that
 * may carry umlauts (DIN 276 titles) go through it.
 * @param {string} text any text
 * @returns {string} the literal including the surrounding apostrophes
 */
function stepText(text) {
  const roh = String(text).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const ascii = roh.replace(
    /[^\x20-\x7e]/g,
    (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`,
  );
  return `'${ascii}'`;
}

/**
 * Rounds a quantity to four decimals — what the app import keeps (qtyNum in
 * ifcImport.js) — and thereby removes binary float noise (7.52 * 3 = 22.560000000000002).
 * @param {number} v value in its own unit (m, m² or m³)
 * @returns {number}
 */
const runde = (v) => Number(v.toFixed(4));

/**
 * @typedef {object} Menge
 * @property {'LENGTH'|'AREA'|'VOLUME'} art IfcQuantity subtype: Length (m), Area (m²), Volume (m³)
 * @property {string} name quantity name; one of the 15 names of IFC_QUANTITY_KEYS
 * @property {number} wert value in m, m² or m³ (rounded to 4 decimals)
 */

/**
 * Base quantities of one element, computed from the very box that becomes its
 * extruded solid — so the numbers cannot drift from the geometry (the unit test
 * compares NetVolume with the volume of the mesh web-ifc builds).
 *
 * Names: only members of IFC_QUANTITY_KEYS (packages/nova-core/src/lib/bimElements.js),
 * the 15 BaseQuantity names the app import reads; anything else it silently drops.
 * The set is called "BaseQuantities" (IFC2x3/Archicad convention) and not
 * "Qto_<Class>BaseQuantities": the Qto_ prefix is reserved for the buildingSMART
 * definitions, and some of their members (a duct's surface area, a beam's cross
 * section) are not in the app's vocabulary. [ASSUMED] The assignment of a name to a
 * meaning is the generator's own: side area = one vertical face (Length x Height),
 * a duct's NetArea = its outer surface (sheet-metal area). There are no openings
 * and no overlaps, so Net equals Gross.
 *
 * @param {Bauteil} b element box, metres
 * @returns {Menge[]}
 */
export function mengenVon(b) {
  const dx = b.max[0] - b.min[0];
  const dy = b.max[1] - b.min[1];
  const dz = b.max[2] - b.min[2];
  const laenge = Math.max(dx, dy); // longest horizontal extent, m
  const breite = Math.min(dx, dy); // shorter horizontal extent (thickness / width), m
  const volumen = dx * dy * dz; // m³
  /** @type {(name: string, wert: number) => Menge} */
  const L = (name, wert) => ({ art: 'LENGTH', name, wert: runde(wert) });
  /** @type {(name: string, wert: number) => Menge} */
  const A = (name, wert) => ({ art: 'AREA', name, wert: runde(wert) });
  /** @type {(name: string, wert: number) => Menge} */
  const V = (name, wert) => ({ art: 'VOLUME', name, wert: runde(wert) });

  switch (b.typ) {
    case 'IFCSLAB':
      return [
        L('Length', laenge), L('Width', breite), L('Depth', dz), L('Perimeter', 2 * (dx + dy)),
        A('GrossArea', dx * dy), A('NetArea', dx * dy),
        V('GrossVolume', volumen), V('NetVolume', volumen),
      ];
    case 'IFCDUCTSEGMENT':
      return [
        L('Length', laenge), L('Width', breite), L('Height', dz),
        A('NetArea', 2 * (breite + dz) * laenge),
        V('GrossVolume', volumen), V('NetVolume', volumen),
      ];
    default: // IFCWALL, IFCBEAM
      return [
        L('Length', laenge), L('Width', breite), L('Height', dz),
        A('GrossSideArea', laenge * dz), A('NetSideArea', laenge * dz),
        V('GrossVolume', volumen), V('NetVolume', volumen),
      ];
  }
}

/**
 * Base quantities of a room: height, perimeter, net floor area, net volume.
 * [ASSUMED] Net volume = floor area x clear height, without deducting the downstand
 * beams and the duct (they hang into the room). Gross floor area is left out: with no
 * column inside the room it would equal the net floor area, and the measuring rule
 * of the IFC definition is not quoted here.
 * @param {{min: number[], max: number[]}} r room box, metres
 * @returns {Menge[]}
 */
export function raumMengenVon(r) {
  const dx = r.max[0] - r.min[0];
  const dy = r.max[1] - r.min[1];
  const dz = r.max[2] - r.min[2];
  return [
    { art: 'LENGTH', name: 'Height', wert: runde(dz) },
    { art: 'LENGTH', name: 'Perimeter', wert: runde(2 * (dx + dy)) },
    { art: 'AREA', name: 'NetFloorArea', wert: runde(dx * dy) },
    { art: 'VOLUME', name: 'NetVolume', wert: runde(dx * dy * dz) },
  ];
}

class IfcSchreiber {
  constructor() {
    this.zeilen = [];
    this.naechste = 1;
  }

  /**
   * Appends one STEP line and returns its reference.
   * @param {string} ausdruck entity text without the leading `#n=`
   * @returns {string} e.g. "#42"
   */
  add(ausdruck) {
    const ref = `#${this.naechste++}`;
    this.zeilen.push(`${ref}=${ausdruck};`);
    return ref;
  }

  text() {
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('BIT-Atelier Musterprojekt - synthetisch, keine Projektdaten'),'2;1');",
      // Fester Zeitstempel: die Datei muss bei jedem Lauf byte-identisch sein.
      "FILE_NAME('musterprojekt.ifc','2026-01-01T00:00:00',('BIT-Atelier'),('BIT-Atelier')," +
        "'BIT-Atelier beispielmodell-erzeugen.mjs','BIT-Atelier','');",
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...this.zeilen,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

/**
 * Builds the complete IFC text.
 * @returns {string}
 */
export function erzeugeIfc() {
  const s = new IfcSchreiber();

  // --- Kopf: Einheiten, Kontext, Eigentümer ---
  const person = s.add("IFCPERSON($,'Muster',$,$,$,$,$,$)");
  const orga = s.add("IFCORGANIZATION($,'BIT-Atelier',$,$,$)");
  const perOrg = s.add(`IFCPERSONANDORGANIZATION(${person},${orga},$)`);
  const anwendung = s.add(`IFCAPPLICATION(${orga},'1','BIT-Atelier','BIT')`);
  const owner = s.add(`IFCOWNERHISTORY(${perOrg},${anwendung},$,.ADDED.,$,$,$,0)`);

  const dirX = s.add('IFCDIRECTION((1.,0.,0.))');
  const dirZ = s.add('IFCDIRECTION((0.,0.,1.))');
  const nullPunkt = s.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const achsen = s.add(`IFCAXIS2PLACEMENT3D(${nullPunkt},${dirZ},${dirX})`);
  const kontext = s.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${achsen},$)`);
  const meter = s.add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const qm = s.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const cbm = s.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const einheiten = s.add(`IFCUNITASSIGNMENT((${meter},${qm},${cbm}))`);

  // --- Räumliche Struktur ---
  const projekt = s.add(
    `IFCPROJECT('${guid('PRJ', 1)}',${owner},'Musterprojekt','Synthetisches Beispielmodell der BIT-Atelier-Demo',$,$,$,(${kontext}),${einheiten})`,
  );
  const platzProjekt = s.add(`IFCLOCALPLACEMENT($,${achsen})`);
  const grundstueck = s.add(
    `IFCSITE('${guid('SIT', 1)}',${owner},'Grundstueck',$,$,${platzProjekt},$,$,.ELEMENT.,$,$,$,$,$)`,
  );
  const platzSite = s.add(`IFCLOCALPLACEMENT(${platzProjekt},${achsen})`);
  const gebaeude = s.add(
    `IFCBUILDING('${guid('BLD', 1)}',${owner},'Musterhalle',$,$,${platzSite},$,$,.ELEMENT.,$,$,$)`,
  );
  const platzBau = s.add(`IFCLOCALPLACEMENT(${platzSite},${achsen})`);
  const geschoss = s.add(
    `IFCBUILDINGSTOREY('${guid('STY', 1)}',${owner},'${GESCHOSS_NAME}',$,$,${platzBau},$,$,.ELEMENT.,0.)`,
  );
  s.add(`IFCRELAGGREGATES('${guid('AGG', 1)}',${owner},$,$,${projekt},(${grundstueck}))`);
  s.add(`IFCRELAGGREGATES('${guid('AGG', 2)}',${owner},$,$,${grundstueck},(${gebaeude}))`);
  s.add(`IFCRELAGGREGATES('${guid('AGG', 3)}',${owner},$,$,${gebaeude},(${geschoss}))`);

  // --- Bauteile mit echter Körpergeometrie ---
  const refs = [];
  BAUTEILE.forEach((b, i) => {
    const bx = b.max[0] - b.min[0];
    const by = b.max[1] - b.min[1];
    const bz = b.max[2] - b.min[2];

    // Rechteckprofil liegt um seinen Mittelpunkt; die Extrusion beginnt an der
    // Unterkante und geht nach +Z. Damit ist die Weltlage vollständig durch die
    // Platzierung des Solids beschrieben — das lokale Placement bleibt Identität.
    const p2d = s.add('IFCCARTESIANPOINT((0.,0.))');
    const pl2d = s.add(`IFCAXIS2PLACEMENT2D(${p2d},$)`);
    const profil = s.add(`IFCRECTANGLEPROFILEDEF(.AREA.,'${b.name}',${pl2d},${z(bx)},${z(by)})`);
    const mitte = s.add(
      `IFCCARTESIANPOINT((${z(b.min[0] + bx / 2)},${z(b.min[1] + by / 2)},${z(b.min[2])}))`,
    );
    const plSolid = s.add(`IFCAXIS2PLACEMENT3D(${mitte},${dirZ},${dirX})`);
    const solid = s.add(`IFCEXTRUDEDAREASOLID(${profil},${plSolid},${dirZ},${z(bz)})`);
    const form = s.add(`IFCSHAPEREPRESENTATION(${kontext},'Body','SweptSolid',(${solid}))`);
    const gestalt = s.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${form}))`);
    const platz = s.add(`IFCLOCALPLACEMENT(${platzBau},${achsen})`);

    const g = guid(b.typ.slice(3, 7), i + 1);
    const ref = s.add(
      `${b.typ}('${g}',${owner},'${b.name}',$,$,${platz},${gestalt},$,$)`,
    );
    refs.push({ ref, bauteil: b, guid: g });
  });

  s.add(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid('CON', 1)}',${owner},$,$,(${refs
      .map((r) => r.ref)
      .join(',')}),${geschoss})`,
  );

  // --- Eigenschaften (Pset_WallCommon / Pset_SlabCommon / Pset_BeamCommon) ---
  refs.forEach((r, i) => {
    const pset = r.bauteil.pset;
    if (!pset) return;
    const werte = Object.entries(pset).map(([k, v]) =>
      s.add(
        k === 'LoadBearing' || k === 'IsExternal'
          ? `IFCPROPERTYSINGLEVALUE('${k}',$,IFCBOOLEAN(.${v}.),$)`
          : `IFCPROPERTYSINGLEVALUE('${k}',$,IFCLABEL('${v}'),$)`,
      ),
    );
    const gruppe = r.bauteil.typ === 'IFCWALL' ? 'Pset_WallCommon'
      : r.bauteil.typ === 'IFCSLAB' ? 'Pset_SlabCommon'
        : 'Pset_BeamCommon';
    const menge = s.add(
      `IFCPROPERTYSET('${guid('PST', i + 1)}',${owner},'${gruppe}',$,(${werte.join(',')}))`,
    );
    s.add(
      `IFCRELDEFINESBYPROPERTIES('${guid('RDP', i + 1)}',${owner},$,$,(${r.ref}),${menge})`,
    );
  });

  // ------------------------------------------------------------------------
  // 69-32 — everything below is APPENDED, so the #numbers above stay stable.
  // ------------------------------------------------------------------------

  // --- Räume: IfcSpace je Geschoss, per IfcRelAggregates dem Geschoss zugeordnet ---
  // (IFC4: spaces are aggregated by their storey, not "contained"; the app import
  // follows the aggregation chain, ifcImport.js buildAggregateIndex / L7.) No body:
  // see raumDefinitionen(). IfcRelSpaceBoundary is not written — nothing reads it.
  const geschosse = { [GESCHOSS_NAME]: geschoss };
  const raumRefs = RAEUME.map((r, i) => {
    const ecke = s.add(`IFCCARTESIANPOINT((${z(r.min[0])},${z(r.min[1])},${z(r.min[2])}))`);
    const achse = s.add(`IFCAXIS2PLACEMENT3D(${ecke},${dirZ},${dirX})`);
    const platz = s.add(`IFCLOCALPLACEMENT(${platzBau},${achse})`);
    // IFC4 IfcSpace: ..., ObjectPlacement, Representation, LongName, CompositionType,
    // PredefinedType, ElevationWithFlooring.
    const ref = s.add(
      `IFCSPACE('${guid('SPC', i + 1)}',${owner},${stepText(r.name)},$,$,${platz},$,${stepText(r.langname)},.ELEMENT.,.INTERNAL.,$)`,
    );
    return { ref, raum: r };
  });
  Object.keys(geschosse).forEach((name, k) => {
    const refsImGeschoss = raumRefs.filter((x) => x.raum.geschoss === name).map((x) => x.ref);
    if (refsImGeschoss.length === 0) return;
    s.add(
      `IFCRELAGGREGATES('${guid('AGG', 4 + k)}',${owner},$,$,${geschosse[name]},(${refsImGeschoss.join(',')}))`,
    );
  });
  raumRefs.forEach((x, i) => {
    // The room number is the Reference of Pset_SpaceCommon (IFC4: IfcIdentifier).
    const nummer = s.add(`IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER(${stepText(x.raum.nummer)}),$)`);
    const extern = s.add("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.F.),$)");
    const pset = s.add(
      `IFCPROPERTYSET('${guid('PSS', i + 1)}',${owner},'Pset_SpaceCommon',$,(${nummer},${extern}))`,
    );
    s.add(`IFCRELDEFINESBYPROPERTIES('${guid('RDS', i + 1)}',${owner},$,$,(${x.ref}),${pset})`);
  });

  // --- Mengen: ein IfcElementQuantity je Bauteil und je Raum ---
  let mengenNr = 0;
  const schreibeMengen = (elementRef, mengen) => {
    mengenNr += 1;
    const q = mengen.map((m) => s.add(`IFCQUANTITY${m.art}('${m.name}',$,$,${z(m.wert)},$)`));
    const menge = s.add(
      `IFCELEMENTQUANTITY('${guid('QTO', mengenNr)}',${owner},'BaseQuantities',$,` +
        `${stepText('BIT-Atelier generator: box dimensions of the body geometry')},(${q.join(',')}))`,
    );
    s.add(`IFCRELDEFINESBYPROPERTIES('${guid('RDQ', mengenNr)}',${owner},$,$,(${elementRef}),${menge})`);
  };
  refs.forEach((r) => schreibeMengen(r.ref, mengenVon(r.bauteil)));
  raumRefs.forEach((x) => schreibeMengen(x.ref, raumMengenVon(x.raum)));

  // --- Material: ein IfcMaterial je Sorte, ein IfcRelAssociatesMaterial je Material ---
  // A bait element (no `material` key) is in no relation at all.
  Object.entries(MATERIALIEN).forEach(([schluessel, m], i) => {
    const elemente = refs.filter((r) => r.bauteil.material === schluessel).map((r) => r.ref);
    if (elemente.length === 0) return; // an unused material is not written
    const mat = s.add(`IFCMATERIAL(${stepText(m.name)},$,${stepText(m.kategorie)})`);
    s.add(`IFCRELASSOCIATESMATERIAL('${guid('RAM', i + 1)}',${owner},$,$,(${elemente.join(',')}),${mat})`);
  });

  // --- Klassifikation: DIN 276 mit je einer IfcClassificationReference je Kostengruppe ---
  // IFC4 IfcClassification: Source, Edition, EditionDate, Name, Description, Location,
  // ReferenceTokens. IFC4 IfcClassificationReference: Location, Identification, Name,
  // ReferencedSource, Description, Sort. A bait element (no `kg` key) is in no relation.
  const din = s.add(
    `IFCCLASSIFICATION(${stepText('DIN Deutsches Institut für Normung e. V.')},'2018-12',$,'DIN 276',` +
      `${stepText('Kosten im Bauwesen')},$,$)`,
  );
  Object.entries(KOSTENGRUPPEN).forEach(([code, titel], i) => {
    const elemente = refs.filter((r) => r.bauteil.kg === code).map((r) => r.ref);
    if (elemente.length === 0) return; // an unused cost group is not written
    const kg = s.add(`IFCCLASSIFICATIONREFERENCE($,'${code}',${stepText(titel)},${din},$,$)`);
    s.add(`IFCRELASSOCIATESCLASSIFICATION('${guid('RAC', i + 1)}',${owner},$,$,(${elemente.join(',')}),${kg})`);
  });

  return s.text();
}

/**
 * The IDS that goes with the model: every wall must carry a fire rating.
 * Exactly one wall does not — see BAUTEILE above.
 * @returns {string}
 */
export function erzeugeIds() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS">
  <info>
    <title>Musterprojekt — Mindestanforderung Brandschutz</title>
    <description>Beispielhafte Auftraggeber-Informationsanforderung der BIT-Atelier-Demo. Synthetisch, kein reales Projekt.</description>
    <author>demo@bit-atelier.de</author>
    <version>1.0</version>
  </info>
  <specifications>
    <specification name="Wände tragen eine Feuerwiderstandsklasse" ifcVersion="IFC4" identifier="BRAND-01"
                   description="Jede Wand muss im Pset_WallCommon die Eigenschaft FireRating führen.">
      <applicability minOccurs="1" maxOccurs="unbounded">
        <entity>
          <name><simpleValue>IFCWALL</simpleValue></name>
        </entity>
      </applicability>
      <requirements>
        <property dataType="IFCLABEL">
          <propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet>
          <baseName><simpleValue>FireRating</simpleValue></baseName>
        </property>
      </requirements>
    </specification>
  </specifications>
</ids>
`;
}

/**
 * Provenance file — a model without a stated origin has no business in a sales demo.
 * Since 69-32 it also carries the BCF section that used to be appended by hand
 * (72-xx): the generator overwrites this file on every run, so a section that lives
 * only in the file would be lost at the next run. A unit test compares file and
 * generator output.
 * @returns {string} Markdown, LF line endings
 */
export function erzeugeReadme() {
  const luecke = { material: 'Material', klassifikation: 'Klassifikation (Kostengruppe)' };
  const sorte = { IFCSLAB: 'Platte', IFCWALL: 'Wand', IFCBEAM: 'Unterzug', IFCDUCTSEGMENT: 'Kanal' };
  const koederTabelle = KOEDER
    .map((k) => `| ${k.name} | ${sorte[k.typ] || k.typ} | ${luecke[k.fehlt]} |`)
    .join('\n');
  const kgListe = Object.entries(KOSTENGRUPPEN)
    .map(([code, titel]) => `${code} ${titel}`)
    .join(' · ');
  const materialListe = Object.values(MATERIALIEN).map((m) => m.name).join(' · ');
  return `# Musterprojekt der Online-Demo

**Synthetisch erzeugt — enthält keinerlei Projekt- oder Kundendaten.**

Erzeugt von \`tools/beispielmodell-erzeugen.mjs\`. Neu erzeugen:

\`\`\`
node tools/beispielmodell-erzeugen.mjs
\`\`\`

Der Lauf ist deterministisch: feste GlobalIds, fester Zeitstempel im Kopf,
feste Reihenfolge. Ein zweiter Lauf ändert die Dateien nicht.

## Was drin ist

Eine Halle 12 × 8 m, lichte Höhe 3 m, ein Geschoss, ${BAUTEILE.length} Bauteile:
Bodenplatte, vier Außenwände (eine davon doppelt), zwei Unterzüge, ein Lüftungskanal —
dazu ${RAEUME.length} Raum (kein Bauteil, ohne Körper).

## Räume, Mengen, Material, Klassifikation

Seit Plan 69-32 ist das Modell mehr als Geometrie:

- **Raum:** \`${RAEUME[0].name}\` (Langname \`${RAEUME[0].langname}\`, Nummer ${RAEUME[0].nummer} in
  \`Pset_SpaceCommon.Reference\`), dem Geschoss per \`IfcRelAggregates\` zugeordnet. Der Raum hat
  bewusst keinen Körper: Kollisionsprüfung und „Bauteil-Geometrien“ bleiben bei ${BAUTEILE.length};
  die App zählt ihn unter „Bauteile mit Eigenschaften“.
- **Mengen:** je Bauteil und Raum ein \`IfcElementQuantity\` „BaseQuantities“ mit Länge (m),
  Fläche (m²) und Volumen (m³), aus den Quadermaßen derselben Geometrie berechnet; Net gleich
  Brutto, weil das Modell keine Öffnungen hat. Raum: Nettogrundfläche aus dem lichten Maß
  zwischen den Wänden.
- **Material:** ${materialListe}.
- **Klassifikation:** DIN 276, Kostengruppen ${kgListe} (Bezeichnungen sinngemäß).
- **Außenwände** tragen \`Pset_WallCommon.IsExternal = true\` — sonst liest der Import sie als
  Innenwand (Gewerk „Ausbau“).

### Die vier Köder (je Sorte ein unvollständiges Bauteil)

| Bauteil | Sorte | Es fehlt |
|---|---|---|
${koederTabelle}

Die Köder ändern keine der Erwartungszahlen unten. Die Prüf-Suite meldet sie heute nicht von
selbst (die mitgelieferte IDS fragt nur den Brandschutz ab); sichtbar werden sie in den Mengen
(Material „–“, Kostengruppe fällt auf die Vorgabe zurück) und mit einer IDS-Regel auf Material
oder Klassifikation.

## Die drei eingebauten Befunde

| Befund | Wo | Was die Prüf-Suite meldet |
|---|---|---|
| **Harte Kollision** | Lüftungskanal Zuluft × Unterzug Achse B | Der Kanal läuft auf 2,60–3,00 m durch den Unterzug. |
| **Doppelte Modellierung** | Aussenwand Ost | Zweimal deckungsgleich modelliert, eigene GlobalId — im 3D unsichtbar, in der Menge doppelt. |
| **IDS-Verstoß** | Aussenwand Nord | Ohne \`Pset_WallCommon.FireRating\`, das \`musterprojekt.ids\` verlangt. |

Erwartete Zahlen (auch im Test festgehalten, \`tests/unit/beispielmodell.test.js\`):
${JSON.stringify(BEISPIEL_ERWARTET, null, 2)}

Alles andere ist bewusst kollisionsfrei: die Unterzüge beginnen bei x = 0,50 m
und berühren die Wände nicht, der Kanal endet bei x = 7,00 m und erreicht die
Ostwand nicht, die Bodenplatte liegt vollständig unter z = 0.

## Beispiel-BCF (\`musterprojekt.bcf\`)

Drei synthetische BCF-2.1-Befunde auf echte GlobalIds dieses Modells — für
„Beispiel-BCF laden“ in der Prüf-Suite (Karte „Befunde (BCF)“), damit ein
Demo-Besucher ohne eigene BCF-Datei einen Befund als Ticket übernehmen kann.

| Befund | Bauteil (GlobalId) | Status | Priorität |
|---|---|---|---|
| Aussenwand Süd: Dämmung fehlt im Modell | \`nYqxeK5NUBtew1kQBTaHzk\` | Open | High |
| Aussenwand Nord: Feuerwiderstand nicht angegeben | \`_l18sXIahP4r7EydOgnVAx\` | InProgress | Normal |
| Aussenwand West: Durchbruch für die Zuluft fehlt | \`ByEL4kVnudH2KRAqbt_jN8\` | Open | Normal |

Erzeugt mit \`buildBcfZip\` (\`packages/nova-ifc-viewer/src/lib/bcf.js\`), deterministisch
(feste Guids und Zeitstempel). Neu erzeugen bzw. prüfen, ob die Datei aktuell ist:

\`\`\`
node --import ./tests/alias-register.mjs .planning/phases/72-produktreife/tmp-e2e/n-12-beispiel-bcf-erzeugen.mjs
node --import ./tests/alias-register.mjs .planning/phases/72-produktreife/tmp-e2e/n-12-beispiel-bcf-erzeugen.mjs --pruefen
\`\`\`
`;
}

// --------------------------------------------------------------------------

function main() {
  fs.mkdirSync(ZIEL, { recursive: true });
  const dateien = [
    ['musterprojekt.ifc', erzeugeIfc()],
    ['musterprojekt.ids', erzeugeIds()],
    ['README.md', erzeugeReadme()],
  ];
  for (const [name, inhalt] of dateien) {
    fs.writeFileSync(path.join(ZIEL, name), inhalt, 'utf8');
    const kb = (Buffer.byteLength(inhalt, 'utf8') / 1024).toFixed(1);
    console.log(`  ${String(kb).padStart(7)} KB  public/beispiel/${name}`);
  }
  console.log('\nErwartete Befunde:', JSON.stringify(BEISPIEL_ERWARTET));
}

if (process.argv[1] && process.argv[1].endsWith('beispielmodell-erzeugen.mjs')) main();

export { BAUTEILE, RAEUME, KOEDER, MATERIALIEN, KOSTENGRUPPEN };
