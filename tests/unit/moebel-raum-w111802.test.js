// W-1118-02: furniture keys follow the room GUID instead of the shifting _idx (packages/nova-designer/src/lib/moebel.js).
//
// Store zones are mirrored from customZones as { points, level, name, id: _idx, guid } (useBimModelSync load + foreign
// state, BitBimStudio mirror) — `storeZone` below repeats exactly that mapping. Coordinates in metres (x/z of the zone
// points; furniture x/y = item centre, y runs along the zone z axis).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  zoneKey, moebelFuerZone, mitMoebelFuerZone, migriereMoeblierung, verwaisteKeys, moebelOhneRaum, ohneRaumZuweisen,
  moebelImUmriss, raumGuid, RAUM_TOLERANZ_M,
} from "@designer/lib/moebel";
import * as steckbrief from "@core/lib/bauteil/steckbrief.js";

const { guidsAnheften, bauteilGuid } = steckbrief;
/**
 * Review fix R-W111802-1 (the studio writes the pinned GUIDs back into its state). Read through the namespace so this file
 * still loads on a stand without the helper — the tests that need it then fail on their own instead of the whole file.
 * @type {(aktuell: any[], gespeichertVon: any[], angeheftet: any[]) => any[]}
 */
const guidsUebernehmen = (/** @type {any} */ (steckbrief)).guidsUebernehmen;

// Two rooms side by side on the ground floor, 4 × 4 m each (neutral test geometry).
const NORD = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
const SUED = [{ x: 5, z: 0 }, { x: 9, z: 0 }, { x: 9, z: 4 }, { x: 5, z: 4 }];
const G_NORD = "0raumNordW111802000001"; // stored GUIDs, 22 characters like guidsAnheften pins them
const G_SUED = "0raumSuedW111802000002";
const G_OBEN = "0raumObenW111802000003";

/** The store shape of a customZones record (useBimModelSync / BitBimStudio mirror). @param {any} z */
const storeZone = (z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx, guid: z.guid });
/** A furniture item centred at (x, y) in metres. @param {string} id @param {number} x @param {number} y */
const tisch = (id, x, y) => ({ id, typ: "schreibtisch", x, y, rot: 0 });

describe("W-1118-02 — Möbel bleiben im Raum, wenn die Räume neu aufgebaut werden", () => {
  it("Neuaufbau verschiebt die _idx: die Möbel bleiben in ihrem Raum (der Befund)", () => {
    const vorher = [
      { points: NORD, level: 0, name: "Raum Nord", _idx: 1, guid: G_NORD },
      { points: SUED, level: 0, name: "Raum Süd", _idx: 2, guid: G_SUED },
    ];
    const [nord, sued] = vorher.map(storeZone);
    let m = mitMoebelFuerZone({}, nord, [tisch("n1", 2, 2)]);
    m = mitMoebelFuerZone(m, sued, [tisch("s1", 7, 2), tisch("s2", 6, 1)]);
    // rebuild: the same rooms come back in the other order with new _idx — the stored GUID travels with the room
    const nachher = [
      { points: SUED, level: 0, name: "Raum Süd", _idx: 1, guid: G_SUED },
      { points: NORD, level: 0, name: "Raum Nord", _idx: 2, guid: G_NORD },
    ].map(storeZone);
    const nordNeu = nachher.find((z) => z.name === "Raum Nord");
    const suedNeu = nachher.find((z) => z.name === "Raum Süd");
    assert.deepEqual(moebelFuerZone(m, nordNeu).map((i) => i.id), ["n1"]);
    assert.deepEqual(moebelFuerZone(m, suedNeu).map((i) => i.id), ["s1", "s2"]);
    assert.equal(zoneKey(nordNeu), `guid:${G_NORD}`);
  });
});

describe("W-1118-02 — Schlüssel und Geometrie", () => {
  it("zoneKey: guid:<guid> nur für eine gespeicherte 22-stellige GUID, sonst id:<_idx> bzw. level:name", () => {
    assert.equal(zoneKey({ id: 3, guid: G_NORD, level: 0, name: "A" }), `guid:${G_NORD}`);
    assert.equal(zoneKey({ id: 3, guid: "kurz", level: 0, name: "A" }), "id:3");
    assert.equal(zoneKey({ id: 3, guid: undefined, level: 0, name: "A" }), "id:3");
    assert.equal(zoneKey({ guid: G_NORD, level: 0, name: "A" }), `guid:${G_NORD}`);
    assert.equal(zoneKey({ level: 1, name: "Flur ·WT" }), "1:Flur ·WT");
    assert.equal(raumGuid({ guid: 123 }), null);
  });

  it("moebelImUmriss: alle Mittelpunkte im Umriss, Kante mit Toleranz, ungültige Lage = nein", () => {
    const raum = { points: NORD };
    assert.equal(moebelImUmriss([tisch("a", 1, 1), tisch("b", 3, 3)], raum), true);
    assert.equal(moebelImUmriss([tisch("a", 1, 1), tisch("b", 6, 3)], raum), false, "ein Möbel im Nachbarraum");
    assert.equal(moebelImUmriss([tisch("a", 4.03, 2)], raum), false, "3 cm vor der Kante, ohne Toleranz");
    assert.equal(moebelImUmriss([tisch("a", 4.03, 2)], raum, RAUM_TOLERANZ_M), true, "3 cm vor der Kante, mit Toleranz");
    assert.equal(moebelImUmriss([tisch("a", 4.2, 2)], raum, RAUM_TOLERANZ_M), false, "20 cm daneben bleibt draußen");
    assert.equal(moebelImUmriss([{ id: "x", typ: "stuhl", x: null, y: 1 }], raum), false);
    assert.equal(moebelImUmriss([], raum), false);
    assert.equal(moebelImUmriss([tisch("a", 1, 1)], { points: [{ x: 0, z: 0 }] }), false);
  });
});

describe("W-1118-02 — Migration beim Öffnen", () => {
  const raeume = () => [
    storeZone({ points: NORD, level: 0, name: "Raum Nord", _idx: 1, guid: G_NORD }),
    storeZone({ points: SUED, level: 0, name: "Raum Süd", _idx: 2, guid: G_SUED }),
  ];

  it("Glücksfall: id:<_idx> → guid:<guid>, wenn alle Möbel im Umriss dieses Raums liegen", () => {
    const start = { "id:1": [tisch("n1", 2, 2)], "id:2": [tisch("s1", 7, 2), tisch("s2", 8, 3)] };
    const r = migriereMoeblierung(start, raeume());
    assert.equal(r.verschoben, 2);
    assert.deepEqual(Object.keys(r.moeblierung).sort(), [`guid:${G_NORD}`, `guid:${G_SUED}`]);
    assert.deepEqual(r.moeblierung[`guid:${G_SUED}`].map((i) => i.id), ["s1", "s2"]);
    assert.deepEqual(Object.keys(start).sort(), ["id:1", "id:2"], "Eingabe unverändert");
    assert.deepEqual(moebelOhneRaum(r.moeblierung, raeume()), []);
  });

  it("schon verschoben (Möbel liegen im anderen Raum) → bleibt stehen, „Möbel ohne Raum“; der fremde Raum wird nur genannt", () => {
    // the furniture of the south room sits under id:1 — after a rebuild _idx 1 is the north room
    const start = { "id:1": [tisch("s1", 7, 2)] };
    const r = migriereMoeblierung(start, raeume());
    assert.equal(r.verschoben, 0);
    assert.equal(r.moeblierung, start, "nichts geändert → dieselbe Referenz");
    const nord = raeume()[0];
    assert.deepEqual(moebelFuerZone(r.moeblierung, nord), [], "nicht im falschen Raum angezeigt");
    assert.deepEqual(verwaisteKeys(r.moeblierung, raeume()), ["id:1"]);
    const [eintrag] = moebelOhneRaum(r.moeblierung, raeume());
    assert.equal(eintrag.grund, "ausserhalb");
    assert.equal(eintrag.raum?.name, "Raum Nord");
    // review R-1: a foreign room is never preselected — it is listed (kandidaten), the person picks it
    assert.equal(eintrag.vorschlag, null, "kein vorbelegter fremder Raum");
    assert.deepEqual(eintrag.kandidaten.map((z) => z.name), ["Raum Süd"], "der Raum, in dem die Möbel liegen, wird genannt");
  });

  it("mehrdeutig: ein Raum im Geschoss darüber mit demselben Umriss → nicht raten, „Möbel ohne Raum“", () => {
    const zonen = [...raeume(), storeZone({ points: NORD, level: 1, name: "Raum Oben", _idx: 3, guid: G_OBEN })];
    const start = { "id:1": [tisch("n1", 2, 2)] };
    const r = migriereMoeblierung(start, zonen);
    assert.equal(r.verschoben, 0);
    assert.equal(r.moeblierung, start);
    const [eintrag] = moebelOhneRaum(start, zonen);
    assert.equal(eintrag.grund, "mehrdeutig");
    assert.deepEqual(eintrag.kandidaten.map((z) => z.name).sort(), ["Raum Nord", "Raum Oben"]);
    assert.equal(eintrag.vorschlag, `guid:${G_NORD}`, "Vorschlag = wo die Möbel bisher standen; zugewiesen wird erst durch die Person");
  });

  it("mehrdeutig auch bei einem doppelten Raum im selben Geschoss; generierte ·WT-Räume zählen nicht mit", () => {
    const doppelt = [...raeume(), storeZone({ points: NORD, level: 0, name: "Raum Nord", _idx: 9, guid: "0raumDoppelW1118020009" })];
    assert.equal(migriereMoeblierung({ "id:1": [tisch("n1", 2, 2)] }, doppelt).verschoben, 0);
    const mitWerkstatt = [...raeume(), { points: NORD, level: 0, name: "Wohnen ·WT" }];
    assert.equal(migriereMoeblierung({ "id:1": [tisch("n1", 2, 2)] }, mitWerkstatt).verschoben, 1);
  });

  it("belegt: der Raum hat unter seiner GUID schon Möbel → keine stille Zusammenführung", () => {
    const start = { "id:1": [tisch("alt", 2, 2)], [`guid:${G_NORD}`]: [tisch("neu", 1, 1)] };
    const r = migriereMoeblierung(start, raeume());
    assert.equal(r.verschoben, 0);
    assert.deepEqual(moebelFuerZone(start, raeume()[0]).map((i) => i.id), ["neu"]);
    assert.equal(moebelOhneRaum(start, raeume())[0].grund, "belegt");
  });

  it("kein Raum mit diesem _idx, kaputte Lage, leere Liste: nichts wird verschoben", () => {
    const start = { "id:7": [tisch("x", 2, 2)], "id:2": [{ id: "y", typ: "stuhl", x: "?", y: 1 }], "id:1": [] };
    const r = migriereMoeblierung(start, raeume());
    assert.equal(r.verschoben, 0);
    assert.equal(r.moeblierung, start);
    const liste = moebelOhneRaum(start, raeume());
    assert.deepEqual(liste.map((e) => `${e.key} ${e.grund}`).sort(), ["id:2 ausserhalb", "id:7 kein-raum"]);
    const ohneRaumMitIdx = liste.find((e) => e.key === "id:7");
    assert.equal(ohneRaumMitIdx?.vorschlag, null, "review R-1: kein eigener Raum → nichts vorbelegt");
    assert.deepEqual(ohneRaumMitIdx?.kandidaten.map((z) => z.name), ["Raum Nord"], "einziger Raum an der Stelle wird genannt");
  });

  it("idempotent: zweiter Lauf ändert nichts und gibt dieselbe Referenz zurück", () => {
    const start = { "id:1": [tisch("n1", 2, 2)], "id:2": [tisch("x", 2, 3)], "0:Raum Süd": [tisch("l", 6, 1)] };
    const r1 = migriereMoeblierung(start, raeume());
    assert.equal(r1.verschoben, 2, "id:1 → GUID, Legacy Raum Süd → GUID; id:2 liegt im Nordraum und bleibt");
    const r2 = migriereMoeblierung(r1.moeblierung, raeume());
    assert.equal(r2.verschoben, 0);
    assert.equal(r2.moeblierung, r1.moeblierung);
    assert.deepEqual(Object.keys(r1.moeblierung).sort(), ["guid:" + G_NORD, "guid:" + G_SUED, "id:2"].sort());
  });

  it("Reihenfolge: der id-Eintrag geht vor dem Legacy-Eintrag auf die GUID (der Legacy-Rest bleibt wie bisher liegen)", () => {
    const start = { "id:1": [tisch("neu", 2, 2)], "0:Raum Nord": [tisch("alt", 1, 1)] };
    const r = migriereMoeblierung(start, raeume());
    assert.equal(r.verschoben, 1);
    assert.deepEqual(r.moeblierung[`guid:${G_NORD}`].map((i) => i.id), ["neu"]);
    assert.ok(r.moeblierung["0:Raum Nord"]);
  });

  it("alte Daten ohne GUID: id:<_idx> bleibt der Schlüssel, lesen/schreiben/Migration wie in Phase 43", () => {
    const ohne = [
      storeZone({ points: NORD, level: 0, name: "Raum Nord", _idx: 1 }),
      storeZone({ points: SUED, level: 0, name: "Raum Süd", _idx: 2 }),
    ];
    const start = { "id:1": [tisch("n1", 2, 2)], "0:Raum Süd": [tisch("l", 6, 1)] };
    assert.deepEqual(moebelFuerZone(start, ohne[0]).map((i) => i.id), ["n1"]);
    assert.deepEqual(moebelFuerZone(start, ohne[1]).map((i) => i.id), ["l"], "Legacy wird gelesen");
    const r = migriereMoeblierung(start, ohne);
    assert.equal(r.verschoben, 1);
    assert.deepEqual(Object.keys(r.moeblierung).sort(), ["id:1", "id:2"]);
    assert.deepEqual(verwaisteKeys(r.moeblierung, ohne), []);
    assert.deepEqual(Object.keys(mitMoebelFuerZone({}, ohne[0], [tisch("z", 1, 1)])), ["id:1"]);
  });
});

describe("W-1118-02 — „Möbel ohne Raum“ zuweisen", () => {
  const raeume = [
    storeZone({ points: NORD, level: 0, name: "Raum Nord", _idx: 1, guid: G_NORD }),
    storeZone({ points: SUED, level: 0, name: "Raum Süd", _idx: 2, guid: G_SUED }),
  ];

  it("hängt die Möbel an die Liste des gewählten Raums und entfernt den alten Schlüssel", () => {
    const start = { "id:1": [tisch("s1", 7, 2)], [`guid:${G_SUED}`]: [tisch("s0", 6, 1)] };
    const out = ohneRaumZuweisen(start, raeume, { "id:1": `guid:${G_SUED}` });
    assert.deepEqual(Object.keys(out), [`guid:${G_SUED}`]);
    assert.deepEqual(out[`guid:${G_SUED}`].map((i) => i.id), ["s0", "s1"]);
    assert.deepEqual(moebelOhneRaum(out, raeume), []);
  });

  it("unbekanntes Ziel oder fehlende Quelle: Eingabe unverändert (dieselbe Referenz)", () => {
    const start = { "id:1": [tisch("s1", 7, 2)] };
    assert.equal(ohneRaumZuweisen(start, raeume, { "id:1": "guid:gibtEsNicht0000000000" }), start);
    assert.equal(ohneRaumZuweisen(start, raeume, { "id:5": `guid:${G_NORD}` }), start);
  });
});

describe("W-1118-02 — Hin und zurück über Speichern und Laden", () => {
  it("BimModel speichert GUIDs (guidsAnheften), Möblierung im alten Format wird beim Öffnen gehoben und übersteht den Neuaufbau", () => {
    const pid = "projekt-w111802";
    // 1. old project: rooms without GUID, furniture keyed id:<_idx> (phase 43 format)
    const records = [
      { points: NORD, level: 0, name: "Raum Nord", _idx: 4 },
      { points: SUED, level: 0, name: "Raum Süd", _idx: 5 },
    ];
    const altFormat = { "id:4": [tisch("n1", 2, 2)], "id:5": [tisch("s1", 7, 2)] };
    // 2. the studio saves the model: guidsAnheften pins the GUIDs, the server stores JSON
    const gespeichert = JSON.parse(JSON.stringify(guidsAnheften(records, pid, "customZones")));
    assert.ok(gespeichert.every((/** @type {any} */ z) => typeof z.guid === "string" && z.guid.length === 22));
    const zonen = gespeichert.map(storeZone);
    // 3. open: migration, then the normal save path stores complexData as JSON and loads it again
    const r = migriereMoeblierung(JSON.parse(JSON.stringify(altFormat)), zonen);
    assert.equal(r.verschoben, 2);
    const geladen = JSON.parse(JSON.stringify(r.moeblierung));
    assert.deepEqual(Object.keys(geladen).sort(), zonen.map((z) => `guid:${z.guid}`).sort());
    assert.equal(migriereMoeblierung(geladen, zonen).moeblierung, geladen, "nach dem Laden nichts mehr zu tun");
    // 4. a rebuild renumbers the rooms (GUID kept) and the record goes through the server again
    const neu = JSON.parse(JSON.stringify(gespeichert.map((/** @type {any} */ z, /** @type {number} */ i) => ({ ...z, _idx: 20 - i })))).map(storeZone);
    assert.deepEqual(moebelFuerZone(geladen, neu.find((z) => z.name === "Raum Nord")).map((i) => i.id), ["n1"]);
    assert.deepEqual(moebelFuerZone(geladen, neu.find((z) => z.name === "Raum Süd")).map((i) => i.id), ["s1"]);
    assert.deepEqual(moebelOhneRaum(geladen, neu), []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Review of W-1118-02 (findings R-1, R-2, R-3, R-W111802-1). PID is the project id the studio derives the GUIDs with;
// `nachIdx` is what ComplexDesigner / InteriorDesigner hand to the migration: the GUID guidsAnheften pins for the record with
// this _idx (bauteilGuid of "customZones").
const PID = "projekt-w111802-review";
const nachIdx = { guidAusIdx: (/** @type {number|string} */ idx) => bauteilGuid(PID, "customZones", { _idx: Number(idx) }) };

describe("W-1118-02 review R-1/R-2 — Vorschlag nur für den eigenen Raum, nie für einen fremden", () => {
  it("R-1: L-Raum, Sofa auf der Rechteck-Mitte (= Einfügepunkt der App) in der Aussparung → Vorschlag ist der eigene Raum, nicht das Bad", () => {
    // living room as an L (8 × 9 m bounding box), the bathroom fills the notch; the app inserts at the bounding-box centre (4, 4.5)
    const wohnenL = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 3, z: 3 }, { x: 3, z: 9 }, { x: 0, z: 9 }];
    const bad = [{ x: 3, z: 3 }, { x: 8, z: 3 }, { x: 8, z: 9 }, { x: 3, z: 9 }];
    const zonen = guidsAnheften([
      { points: wohnenL, level: 0, name: "Wohnen", _idx: 1 },
      { points: bad, level: 0, name: "Bad", _idx: 2 },
    ], PID, "customZones").map(storeZone);
    const [wohnen, badZone] = zonen;
    const start = { "id:1": [{ id: "sofa", typ: "sofa", x: 4, y: 4.5, rot: 0 }] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0, "liegt nicht im Umriss: nicht stillschweigend gehoben");
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.grund, "ausserhalb");
    assert.equal(eintrag.vorschlag, zoneKey(wohnen), "eigener Raum (Mittelpunkt im umschließenden Rechteck, wie beim Einfügen)");
    assert.deepEqual(eintrag.kandidaten.map((z) => z.name), ["Bad"], "das Bad wird nur genannt");
    // what "Zuweisen" / "Alle zuweisen" does with the proposal
    const nachher = ohneRaumZuweisen(start, zonen, { [eintrag.key]: /** @type {string} */ (eintrag.vorschlag) });
    assert.deepEqual(moebelFuerZone(nachher, wohnen).map((i) => i.id), ["sofa"]);
    assert.deepEqual(moebelFuerZone(nachher, badZone), []);
  });

  it("R-2: 9 Möbel im Zimmer, 1 in den Flur gezogen → Vorschlag ist das Zimmer (Mehrheit), die Liste bleibt beisammen", () => {
    const zimmer = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
    const flur = [{ x: 4, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 4, z: 4 }];
    const zonen = guidsAnheften([
      { points: zimmer, level: 0, name: "Zimmer", _idx: 1 },
      { points: flur, level: 0, name: "Flur", _idx: 2 },
    ], PID, "customZones").map(storeZone);
    const items = [...Array.from({ length: 9 }, (_, i) => tisch(`z${i}`, 0.5 + (i % 3), 0.5 + Math.floor(i / 3))), tisch("raus", 5, 2)];
    const start = { "id:1": items };
    // final review MIG-1 / F2: with the GUID evidence (the room was never renumbered) the majority moves the list on open; the
    // proposal below is what remains for a room WITHOUT that evidence (GUID not derived from this project and _idx)
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 1);
    assert.equal(migriereMoeblierung(start, zonen).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen);
    assert.equal(eintrag.grund, "ausserhalb");
    assert.equal(eintrag.imRaum, 9, "9 von 10 Mittelpunkten im eigenen Raum");
    assert.equal(eintrag.vorschlag, zoneKey(zonen[0]));
    assert.deepEqual(eintrag.kandidaten, [], "kein Raum enthält alle Mittelpunkte");
  });

  it("kein Beleg für den eigenen Raum (weniger als die Hälfte drin, nicht im Rechteck) → kein Vorschlag", () => {
    const zonen = [
      storeZone({ points: NORD, level: 0, name: "Raum Nord", _idx: 1, guid: G_NORD }),
      storeZone({ points: SUED, level: 0, name: "Raum Süd", _idx: 2, guid: G_SUED }),
    ];
    const start = { "id:1": [tisch("a", 2, 2), tisch("b", 7, 2), tisch("c", 8, 3)] };
    const [eintrag] = moebelOhneRaum(start, zonen);
    assert.equal(eintrag.imRaum, 1);
    assert.equal(eintrag.vorschlag, null);
  });
});

describe("W-1118-02 review R-3 — gestapelte Räume (Geschoss kopieren)", () => {
  it("nie umnummeriert (GUID aus genau diesem _idx): id:-Einträge gestapelter Räume werden sicher gehoben, jedes Geschoss behält seine Möbel", async () => {
    const { geschossKopieren } = await import("@designer/lib/zeichnenModell.js");
    // 12 rooms on the ground floor, copied onto the upper floor with the studio's own function (same outlines, new _idx, no GUID)
    const eg = Array.from({ length: 12 }, (_, i) => ({ points: [{ x: i * 5, z: 0 }, { x: i * 5 + 4, z: 0 }, { x: i * 5 + 4, z: 4 }, { x: i * 5, z: 4 }], level: 0, name: `Raum ${i + 1}`, _idx: i + 1 }));
    const leer = { customWalls: [], customWindows: [], envOpenings: [], customColumns: [], customSlabs: [], customRoofs: [] };
    const k = geschossKopieren(/** @type {any} */ ({ ...leer, customZones: eg, naechsteIdx: 13 }), { von: 0, nach: 1 });
    assert.ok(k.ok);
    const records = /** @type {any} */ (k).modell.customZones;
    assert.equal(records.length, 24);
    assert.ok(records.every((/** @type {any} */ z) => z.guid === undefined), "Kopien ohne GUID");
    // furniture placed before W-1118-02 (or before the studio pinned the GUIDs): one desk per room under id:<_idx>
    /** @type {Record<string, any[]>} */
    const start = {};
    for (const z of records) start[`id:${z._idx}`] = [tisch(`t${z._idx}`, z.points[0].x + 2, 2)];
    // the studio saves: GUIDs pinned from the _idx each record has (guidsAnheften), then the next open
    const zonen = JSON.parse(JSON.stringify(guidsAnheften(records, PID, "customZones"))).map(storeZone);
    const r = migriereMoeblierung(start, zonen, nachIdx);
    assert.equal(r.verschoben, 24, "alle 24 Einträge gehoben (vorher: 0, alle „mehrdeutig“)");
    for (const z of zonen) assert.deepEqual(moebelFuerZone(r.moeblierung, z).map((i) => i.id), [`t${z.id}`], `${z.name} Geschoss ${z.level}`);
    assert.deepEqual(moebelOhneRaum(r.moeblierung, zonen, nachIdx), []);
    // without the GUID evidence nothing is guessed (the documented behaviour of the pure function)
    assert.equal(migriereMoeblierung(start, zonen).verschoben, 0);
  });

  it("umnummeriert (die GUID ist mit dem Raum gewandert): bleibt „mehrdeutig“ und der falsche eigene Raum wird NICHT vorgeschlagen", () => {
    const original = guidsAnheften([
      { points: NORD, level: 0, name: "Unten", _idx: 1 },
      { points: NORD, level: 1, name: "Oben", _idx: 3 },
    ], PID, "customZones");
    // rebuild that keeps the GUIDs but swaps the _idx: "Oben" has _idx 1 now
    const zonen = [{ ...original[0], _idx: 3 }, { ...original[1], _idx: 1 }].map(storeZone);
    const start = { "id:1": [tisch("unten-tisch", 2, 2)] }; // placed in "Unten" while it had _idx 1
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.grund, "mehrdeutig");
    assert.equal(eintrag.raum?.name, "Oben");
    assert.equal(eintrag.vorschlag, null, "der Raum, der heute _idx 1 hat, ist nicht der, für den die Möbel gesetzt wurden");
    assert.deepEqual(eintrag.kandidaten.map((z) => z.name).sort(), ["Oben", "Unten"]);
  });

  it("doppelter Raum im SELBEN Geschoss bleibt „mehrdeutig“, auch mit GUID aus dem eigenen _idx", () => {
    const zonen = guidsAnheften([
      { points: NORD, level: 0, name: "Raum Nord", _idx: 1 },
      { points: NORD, level: 0, name: "Raum Nord (Kopie)", _idx: 2 },
    ], PID, "customZones").map(storeZone);
    const start = { "id:1": [tisch("n1", 2, 2)] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.grund, "mehrdeutig");
    assert.equal(eintrag.vorschlag, zoneKey(zonen[0]), "wo die Möbel bisher standen — erst der Klick ordnet zu");
  });
});

describe("W-1118-02 review R-W111802-1 — ein in der Sitzung gezeichneter Raum bekommt seine GUID mit dem Speichern", () => {
  it("guidsUebernehmen: nur die gespeicherten Objekte bekommen ihre GUID, alles andere bleibt (gleiche Referenz ohne Änderung)", () => {
    const a = { points: NORD, level: 0, name: "A", _idx: 1, guid: G_NORD };
    const b = { points: SUED, level: 0, name: "B", _idx: 2 };
    const vorher = [a, b];
    const angeheftet = guidsAnheften(vorher, PID, "customZones");
    assert.notEqual(angeheftet, vorher);
    const out = guidsUebernehmen(vorher, vorher, angeheftet);
    assert.equal(out[0], a, "hatte schon eine GUID: dasselbe Objekt");
    assert.equal(out[1].guid, bauteilGuid(PID, "customZones", b));
    // B was moved while the save was under way (new object) and C was drawn: both wait for their own save
    const bNeu = { ...b, points: NORD };
    const c = { points: SUED, level: 1, name: "C", _idx: 3 };
    const waehrend = guidsUebernehmen([a, bNeu, c], vorher, angeheftet);
    assert.equal(waehrend[1], bNeu);
    assert.equal(waehrend[2], c);
    // another project is open by now: none of its objects was saved here
    const fremd = [{ ...a }, { ...b }];
    assert.equal(guidsUebernehmen(fremd, vorher, angeheftet), fremd);
    assert.equal(guidsUebernehmen(vorher, vorher, vorher), vorher, "nichts angeheftet → dieselbe Referenz");
  });

  it("Raum über einem gleichen Raum in der Sitzung gezeichnet und möbliert: Schlüssel sofort guid:, nach dem Neuladen im Raum", () => {
    // the studio state after load: the ground-floor room carries its pinned GUID; the upper room is drawn now (no GUID yet)
    const unten = guidsAnheften([{ points: NORD, level: 0, name: "Unten", _idx: 4 }], PID, "customZones")[0];
    const oben = { points: NORD, level: 1, name: "Oben", _idx: 12 };
    const zustand = [unten, oben];
    // the save pins the GUIDs (what goes to the server) and writes them back into the state
    const gespeichert = guidsAnheften(zustand, PID, "customZones");
    const zustandNachher = guidsUebernehmen(zustand, zustand, gespeichert);
    const obenImStore = storeZone(zustandNachher[1]);
    assert.equal(zoneKey(obenImStore), `guid:${bauteilGuid(PID, "customZones", oben)}`, "kein id:-Schlüssel mehr für den neuen Raum");
    // furniture placed in the interior tab of the same session
    const m = mitMoebelFuerZone({}, obenImStore, [tisch("og-tisch", 3, 3)]);
    // reload: the store comes from the stored record; the migration has nothing to do and the desk stays upstairs
    const zonen = JSON.parse(JSON.stringify(gespeichert)).map(storeZone);
    const r = migriereMoeblierung(m, zonen, nachIdx);
    assert.equal(r.verschoben, 0);
    assert.equal(r.moeblierung, m);
    assert.deepEqual(moebelFuerZone(m, zonen[1]).map((i) => i.id), ["og-tisch"]);
    assert.deepEqual(moebelFuerZone(m, zonen[0]), []);
    assert.deepEqual(moebelOhneRaum(m, zonen, nachIdx), []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Nachgang (final review of W-1118-02, findings MIG-1, F2, F-W111802-FINAL-1). Data as main stored it: furniture under
// id:<_idx>, the rooms carry the GUID the studio pinned from exactly that _idx (107-08) — never renumbered. Before this fix such a
// room showed up empty in every reader (moebelFuerZone does not read id: for a room with a GUID) until someone clicked "Zuweisen".
/** Rectangle outline in metres. @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 */
const rechteck = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** Outline from x/z pairs in metres. @param {...number} xz */
const umriss = (...xz) => Array.from({ length: xz.length / 2 }, (_, i) => ({ x: xz[2 * i], z: xz[2 * i + 1] }));
/** Records as the studio stores them (GUID pinned from the _idx), in the store shape. @param {any[]} records */
const angeheftet = (records) => guidsAnheften(records, PID, "customZones").map(storeZone);
/** Ids of the furniture a reader shows in the room. @param {any} m @param {any} z */
const zeigt = (m, z) => moebelFuerZone(m, z).map((i) => i.id);

describe("W-1118-02 Nachgang MIG-1/F2 — nie umnummerierte Räume behalten ihre Möbel ohne Klick", () => {
  it("F2 C / MIG-1: eins von fünf Möbeln in den Flur gezogen → gehoben, der Raum zeigt alle fünf", () => {
    const zonen = angeheftet([
      { points: rechteck(0, 0, 5, 5), level: 0, name: "Wohnen", _idx: 1 },
      { points: rechteck(5, 0, 7, 5), level: 0, name: "Flur", _idx: 2 },
    ]);
    const items = [1, 2, 3, 4].map((k) => tisch(`i${k}`, k, 2)).concat(tisch("i5-flur", 6, 2));
    const r = migriereMoeblierung({ "id:1": items }, zonen, nachIdx);
    assert.equal(r.verschoben, 1);
    assert.deepEqual(zeigt(r.moeblierung, zonen[0]), ["i1", "i2", "i3", "i4", "i5-flur"], "die Liste bleibt beisammen (R-2)");
    assert.deepEqual(zeigt(r.moeblierung, zonen[1]), []);
    assert.deepEqual(moebelOhneRaum(r.moeblierung, zonen, nachIdx), []);
  });

  it("F2 A: Wohnungszone im selben Geschoss um die Räume → jeder Raum behält seine Möbel, die Wohnung bekommt keine", () => {
    const zonen = angeheftet([
      { points: rechteck(0, 0, 10, 8), level: 0, name: "WE 1", _idx: 1 },
      { points: rechteck(0, 0, 6, 8), level: 0, name: "Wohnen", _idx: 2 },
      { points: rechteck(6, 0, 10, 4), level: 0, name: "Bad", _idx: 3 },
    ]);
    const start = { "id:2": [{ id: "sofa", typ: "sofa", x: 3, y: 4, rot: 0 }], "id:3": [{ id: "wc", typ: "wc", x: 8, y: 2, rot: 0 }] };
    const r = migriereMoeblierung(start, zonen, nachIdx);
    assert.equal(r.verschoben, 2);
    assert.deepEqual(zonen.map((z) => zeigt(r.moeblierung, z)), [[], ["sofa"], ["wc"]]);
    assert.deepEqual(moebelOhneRaum(r.moeblierung, zonen, nachIdx), []);
  });

  it("MIG-1: Einfamilienhaus, L-Raum mit einem Stuhl im Flur, Studio über dem ganzen Dachgeschoss → gehoben", () => {
    const zonen = angeheftet([
      { points: rechteck(0, 0, 3, 3), level: 0, name: "WC", _idx: 1 },
      { points: rechteck(0, 3, 3, 9), level: 0, name: "Flur", _idx: 2 },
      { points: umriss(3, 0, 10, 0, 10, 4, 5, 4, 5, 9, 3, 9), level: 0, name: "Wohnen", _idx: 3 },
      { points: rechteck(5, 4, 10, 9), level: 0, name: "Küche", _idx: 4 },
      { points: rechteck(0, 0, 10, 9), level: 2, name: "Studio", _idx: 9 },
    ]);
    const wohnen = ["sofa", "couchtisch", "esstisch", "stuhl1"].map((id, i) => tisch(id, [4, 4, 7, 7][i], [7, 5.5, 2, 1][i]));
    const start = { "id:3": [...wohnen, tisch("stuhl2-flur", 1.5, 6)], "id:2": [tisch("garderobe", 0.5, 6)] };
    const r = migriereMoeblierung(start, zonen, nachIdx);
    assert.equal(r.verschoben, 2);
    assert.deepEqual(zeigt(r.moeblierung, zonen[2]), ["sofa", "couchtisch", "esstisch", "stuhl1", "stuhl2-flur"]);
    assert.deepEqual(zeigt(r.moeblierung, zonen[1]), ["garderobe"]);
    assert.deepEqual(zeigt(r.moeblierung, zonen[4]), [], "das Studio darüber bekommt nichts");
  });

  it("Grenze: ohne GUID-Beleg (GUID nicht aus diesem Projekt und _idx) bleibt die strenge Regel — Liste mit Vorschlag", () => {
    const zonen = [
      storeZone({ points: rechteck(0, 0, 5, 5), level: 0, name: "Wohnen", _idx: 1, guid: G_NORD }),
      storeZone({ points: rechteck(5, 0, 7, 5), level: 0, name: "Flur", _idx: 2, guid: G_SUED }),
    ];
    const start = { "id:1": [1, 2, 3, 4].map((k) => tisch(`i${k}`, k, 2)).concat(tisch("i5-flur", 6, 2)) };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.grund, "ausserhalb");
    assert.equal(eintrag.vorschlag, `guid:${G_NORD}`);
  });

  it("Grenze: ein Raum im selben Geschoss, der ALLE Mittelpunkte enthält, sperrt weiter (so sähe auch ein Neuaufbau ohne GUID aus)", () => {
    // F2 B: L-shaped corridor, the shelf sits at the bounding-box centre (the app's insertion point), which lies in the child's room
    const zonen = angeheftet([
      { points: umriss(0, 0, 8, 0, 8, 3, 3, 3, 3, 8, 0, 8), level: 0, name: "Flur L", _idx: 1 },
      { points: rechteck(3, 3, 8, 8), level: 0, name: "Kind", _idx: 2 },
    ]);
    const start = { "id:1": [{ id: "regal", typ: "regal", x: 4, y: 4, rot: 0 }] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.grund, "ausserhalb");
    assert.equal(eintrag.vorschlag, zoneKey(zonen[0]), "eigener Raum vorbelegt, „Alle zuweisen“ genügt");
    assert.deepEqual(eintrag.kandidaten.map((z) => z.name), ["Kind"]);
  });

  it("Grenze: ein nur wenig größerer Raum gleicher Lage ist keine Wohnungszone, sondern ein doppelter Raum → „mehrdeutig“", () => {
    const zonen = angeheftet([
      { points: NORD, level: 0, name: "Raum Nord", _idx: 1 },
      { points: rechteck(-0.05, -0.05, 4.05, 4.05), level: 0, name: "Raum Nord neu gezeichnet", _idx: 2 },
    ]);
    const start = { "id:1": [tisch("n1", 2, 2)] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    assert.equal(moebelOhneRaum(start, zonen, nachIdx)[0].grund, "mehrdeutig");
  });
});

describe("W-1118-02 Nachgang F-W111802-FINAL-1 — Raum teilen", () => {
  /** A room as stored after a studio save (GUID pinned from _idx 5) and its two parts after "Raum teilen" at x = 4 m. */
  const geteilt = async () => {
    const { deckeTeilen } = await import("@core/lib/zeigen/teilen.js");
    const raum = guidsAnheften([{ points: rechteck(0, 0, 8, 4), level: 0, name: "Wohnen", _idx: 5 }], PID, "customZones")[0];
    const r = deckeTeilen(raum, { a: { x: 4, z: -1 }, b: { x: 4, z: 5 } }, { naechsteIdx: 6, projektId: PID, quelle: "customZones" });
    const zonen = r.teile.map(storeZone);
    assert.equal(zonen[0].id, 5, "Teil A behält den _idx");
    assert.notEqual(zonen[0].guid, raum.guid, "beide Teile bekommen neue GUIDs (IFC)");
    return { alt: `guid:${raum.guid}`, zonen };
  };

  it("die Möbel unter der alten GUID gehen zu dem Teil, der den _idx behalten hat (wie auf main)", async () => {
    const { alt, zonen } = await geteilt();
    const start = { [alt]: [tisch("t1", 2, 2), tisch("t2", 3, 3)] };
    const r = migriereMoeblierung(start, zonen, nachIdx);
    assert.equal(r.verschoben, 1);
    assert.deepEqual(zeigt(r.moeblierung, zonen[0]), ["t1", "t2"]);
    assert.deepEqual(zeigt(r.moeblierung, zonen[1]), []);
    assert.deepEqual(moebelOhneRaum(r.moeblierung, zonen, nachIdx), []);
  });

  it("liegen die Möbel alle im neuen Teil, wird nichts verschoben — der Teil wird genannt, nichts vorbelegt", async () => {
    const { alt, zonen } = await geteilt();
    const start = { [alt]: [tisch("t1", 6, 2)] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.key, alt);
    assert.equal(eintrag.vorschlag, null);
    assert.deepEqual(eintrag.kandidaten.map((z) => z.id), [6]);
  });

  it("über beide Teile verteilt: nicht stillschweigend verschoben, Teil A ist der Vorschlag", async () => {
    const { alt, zonen } = await geteilt();
    const start = { [alt]: [tisch("t1", 2, 2), tisch("t2", 3, 3), tisch("t3", 6, 2)] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0);
    const [eintrag] = moebelOhneRaum(start, zonen, nachIdx);
    assert.equal(eintrag.grund, "ausserhalb");
    assert.equal(eintrag.vorschlag, zoneKey(zonen[0]));
  });

  it("kein Raten: Neuaufbau mit neuen GUIDs vertauscht die _idx gestapelter Räume → nichts wird verschoben", () => {
    // furniture of "Unten" under its GUID (derived from _idx 1); the rebuild gives both rooms new GUIDs and swaps the _idx
    const unten = guidsAnheften([{ points: NORD, level: 0, name: "Unten", _idx: 1 }], PID, "customZones")[0];
    const zonen = [
      storeZone({ points: NORD, level: 0, name: "Unten", _idx: 2, guid: "0neuUntenW111802000001" }),
      storeZone({ points: NORD, level: 1, name: "Oben", _idx: 1, guid: "0neuObenW1118020000002" }),
    ];
    const start = { [`guid:${unten.guid}`]: [tisch("unten-tisch", 2, 2)] };
    assert.equal(migriereMoeblierung(start, zonen, nachIdx).verschoben, 0, "„Oben“ hat heute _idx 1, die Möbel liegen aber auch in „Unten“");
    assert.equal(moebelOhneRaum(start, zonen, nachIdx)[0].grund, "mehrdeutig");
  });

  it("ohne GUID-Beleg (GUID nicht aus dem _idx abgeleitet) kein Bezug: „Den Raum gibt es nicht mehr“ wie bisher", async () => {
    const { alt, zonen } = await geteilt();
    const start = { [alt]: [tisch("t1", 2, 2)] };
    assert.equal(migriereMoeblierung(start, zonen).verschoben, 0);
    assert.equal(moebelOhneRaum(start, zonen)[0].grund, "kein-raum");
  });
});
