// W-1118-22: the client moves furniture in the portal — projection of the furnished rooms, the proposal as text, the checks the
// office runs on it, and the take-over into the model's furnishing. Placeholder rooms and furniture only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  umrissText, umrissLesen, moeblierungProjektion, drehung, stehtImRaum, ueberlappt, platzieren, drehen, aenderungenAus,
  vorschlagText, vorschlagLesen, vorschlagPruefen, vorschlagAnwenden, VORSCHLAG_MAX, VORSCHLAG_EINTRAEGE_MAX,
} from "@core/lib/bauherrMoeblierung.js";
import { BAUHERR_FELDER, bereinigen } from "@core/lib/bauherrProjektion";

const RK = "guid:0123456789abcdefghijkl";
const RAUM = { name: "Wohnen ·W", level: 0, guid: "0123456789abcdefghijkl", points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] };
const BAD = { name: "Bad", level: 1, id: 7, points: [{ x: 6, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 2 }, { x: 6, z: 2 }] };
const KATALOG = { sofa: { name: "Sofa", b: 2, t: 0.9, kategorie: "furn" }, tisch: { name: "Tisch", b: 1.2, t: 0.8, kategorie: "desk" }, wc: { name: "WC", b: 0.4, t: 0.6, kategorie: "sanitaer" } };
const MOEBLIERUNG = {
  [RK]: [{ id: "s1", typ: "sofa", x: 1.5, y: 0.45, rot: 0 }, { id: "t1", typ: "tisch", x: 3, y: 2, rot: 90 }, { id: "x", typ: "gibtsnicht", x: 1, y: 1, rot: 0 }],
  "id:7": [{ id: "w1", typ: "wc", x: 7, y: 0.3, rot: 0 }],
};
const schluessel = (/** @type {any} */ r) => (r.guid ? `guid:${r.guid}` : `id:${r.id}`);
const projektion = (aenderbar = true) => moeblierungProjektion({ raeume: [RAUM, BAD, { name: "ohne Umriss", points: [] }], moeblierung: MOEBLIERUNG,
  schluessel, moebelVon: (r) => MOEBLIERUNG[schluessel(r)] || [], typ: (t) => KATALOG[t] || null, geschossName: (l) => (l === 0 ? "EG" : "OG"), stand: "22.11.2026", aenderbar });

test("outline text round trip; too few points give nothing", () => {
  assert.equal(umrissText(RAUM.points), "0,0;5,0;5,4;0,4");
  assert.deepEqual(umrissLesen("0,0;5,0;5,4;0,4"), [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }]);
  assert.equal(umrissText([{ x: 0, z: 0 }, { x: 1, z: 0 }]), "");
  assert.deepEqual(umrissLesen("0,0;x,1"), []);
  assert.deepEqual(umrissLesen(42), []);
});

test("projection: rooms with an outline, furniture with size from the catalogue, unknown types left out", () => {
  const p = projektion();
  assert.deepEqual(p.raeume.map((r) => [r.schluessel, r.name, r.geschoss]), [[RK, "Wohnen", "EG"], ["id:7", "Bad", "OG"]]);
  assert.deepEqual(p.moebel.map((m) => m.id), ["s1", "t1", "w1"]);
  assert.deepEqual(p.moebel[1], { id: "t1", raum: RK, typ: "tisch", name: "Tisch", kategorie: "desk", b: 1.2, t: 0.8, x: 3, y: 2, rot: 90 });
});

test("the projection passes the whitelist of the client contract unchanged (only scalars and flat lists)", () => {
  const p = { project_id: "p1", ...projektion() };
  assert.deepEqual(bereinigen("BauherrMoeblierung", { ...p, geheim: "x", moebel: p.moebel.map((m) => ({ ...m, honorar: 1 })) }), p);
  for (const k of ["raeume", "moebel"]) assert.ok(BAUHERR_FELDER[`BauherrMoeblierung.${k}`].length > 0);
});

test("geometry: inside the room incl. against the wall, rotation swaps the sides, overlap", () => {
  const u = umrissLesen("0,0;5,0;5,4;0,4");
  const sofa = { b: 2, t: 0.9, x: 1, y: 0.45, rot: 0 };
  assert.equal(stehtImRaum(sofa, u), true, "flush in the corner counts as inside");
  assert.equal(stehtImRaum({ ...sofa, x: 0.9 }, u), false);
  assert.equal(stehtImRaum({ ...sofa, rot: 90, x: 0.45, y: 1 }, u), true);
  assert.equal(ueberlappt(sofa, { b: 1, t: 1, x: 2.5, y: 0.5, rot: 0 }), false, "touching is no overlap");
  assert.equal(ueberlappt(sofa, { b: 1, t: 1, x: 2.4, y: 0.5, rot: 0 }), true);
  assert.deepEqual([0, 90, 180, 270, 360, 450, -90, "x"].map(drehung), [0, 90, 180, 270, 0, 90, 270, 0]);
});

test("placing: 5 cm grid, pulled flush to a wall, never outside the room; turning refused when it would leave the room", () => {
  const p = projektion(), u = umrissLesen(p.raeume[0].umriss), sofa = p.moebel[0];
  const frei = platzieren(sofa, 2.512, 2.03, u);
  assert.deepEqual([frei.x, frei.y], [2.5, 2.05]);
  const anWand = platzieren(sofa, 1.1, 0.52, u);
  assert.deepEqual([anWand.x, anWand.y], [1, 0.45], "both near walls pull the sofa into the corner");
  assert.equal(platzieren(sofa, 9, 9, u), sofa, "a place outside keeps the last place inside");
  const schmal = { ...sofa, x: 4, y: 0.45 };
  assert.equal(drehen(schmal, u), schmal, "turned it would stand through the wall: refused");
  assert.equal(drehen({ ...sofa, x: 2.5, y: 2 }, u).rot, 90);
});

test("proposal: only changed furniture, text round trip, malformed text is no proposal", () => {
  const p = projektion();
  const jetzt = p.moebel.map((m) => (m.id === "s1" ? { ...m, x: 2.5, y: 3.55, rot: 180 } : m));
  const a = aenderungenAus(p.moebel, jetzt);
  assert.deepEqual(a, [[RK, "s1", 2.5, 3.55, 180]]);
  assert.deepEqual(vorschlagLesen(vorschlagText(a)), a);
  const kaputt = ["", "{", "{}", "[[1,2,3,4,5]]", "[[\"r\",\"i\",1,2]]", "[[\"r\",\"i\",1,\"2\",0]]", "x".repeat(VORSCHLAG_MAX + 1),
    JSON.stringify(Array.from({ length: VORSCHLAG_EINTRAEGE_MAX + 1 }, () => ["r", "i", 1, 1, 0]))];
  for (const k of kaputt) assert.equal(vorschlagLesen(k), null, k.slice(0, 30));
});

test("check: unknown furniture and places outside the room are refused entry by entry; nothing without a request", () => {
  const p = projektion();
  const r = vorschlagPruefen(p, [[RK, "s1", 2.5, 3.55, 180], [RK, "fremd", 1, 1, 0], [RK, "t1", 9, 9, 0], ["id:7", "s1", 7, 1, 0]]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.gueltig, [[RK, "s1", 2.5, 3.55, 180]]);
  assert.deepEqual(r.abgelehnt.map((x) => x.id), ["fremd", "t1", "s1"], "the sofa of another room is not furniture of the bathroom");
  assert.equal(r.moebel.find((m) => m.id === "s1").y, 3.55);
  assert.equal(vorschlagPruefen(projektion(false), [[RK, "s1", 2.5, 3.55, 180]]).ok, false);
  assert.equal(vorschlagPruefen(p, []).ok, false);
  assert.equal(vorschlagPruefen(p, null).ok, false);
  assert.equal(vorschlagPruefen(p, [[RK, "t1", 1.5, 0.6, 90]]).ueberlappungen, 1, "an overlap is reported, not refused");
});

test("take-over: only centre and rotation change, the input stays untouched, furniture gone meanwhile is skipped", () => {
  const vorher = JSON.stringify(MOEBLIERUNG);
  const r = vorschlagAnwenden(MOEBLIERUNG, [[RK, "s1", 2.5, 3.55, 180], [RK, "weg", 1, 1, 0], ["guid:anderer-schluessel", "w1", 7, 1.5, 90]]);
  assert.equal(JSON.stringify(MOEBLIERUNG), vorher);
  assert.deepEqual(r.moeblierung[RK][0], { id: "s1", typ: "sofa", x: 2.5, y: 3.55, rot: 180 });
  assert.deepEqual(r.moeblierung[RK][1], MOEBLIERUNG[RK][1]);
  assert.deepEqual(r.moeblierung["id:7"][0], { id: "w1", typ: "wc", x: 7, y: 1.5, rot: 90 }, "found under its older key by its unique id");
  assert.deepEqual([r.uebernommen, r.uebersprungen], [2, ["weg"]]);
});
