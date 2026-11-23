// 115-05c (D-115-12, D-115-51): the pure draft core of the building model. Model changes are a draft until "Speichern":
// the draft holds only the fields that differ from the stored base (plus the base values of exactly those fields), counts
// its changes per element, decides how a stored state goes together with it (same / rebase / replaced / deleted), rebases
// on a newer stored state with the rules of 115-05a (local new elements renumbered against the full base, three ways per
// element, the site/location group as ONE unit) and checks references (K7: an opening whose wall is gone).
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entwurfLeer, entwurfMelden, entwurfAenderungen, entwurfSauber, entwurfEntscheiden, entwurfRebase, entwurfNachSpeichern,
  entwurfSchrittVormerken, entwurfSchrittEntfernen, verweisePruefen, ENTWURF_VERSION,
} from "@core/lib/entwurf/modellEntwurf.js";
import { ENTWURF_FELDER, ABGELEITET } from "@core/lib/entwurf/entwurfRegeln.js";
import { IDX_LISTEN } from "@core/lib/abgleich/idxListen.js";
import { STUDIO_WERTE } from "@core/lib/abgleich/modellAbgleich.js";
import { KOMPLEX_LAGE_GRUPPE } from "@core/lib/abgleich/komplexAbgleich.js";
import { PROGRAMM_FELDER } from "@core/lib/useBimModelSync.js";

const wand = (/** @type {number} */ i, /** @type {number} */ x) => ({ _idx: i, a: { x, z: 0 }, b: { x: x + 4, z: 0 }, dicke: 0.24 });
const tuer = (/** @type {number} */ i, /** @type {number} */ w) => ({ _idx: i, wallIdx: w, kind: "door", t: 0.5, breite: 1 });
const ZEIT = new Date("2026-11-19T10:00:00.000Z");

test("ENTWURF_FELDER: building model = ten lists + envelope values + program fields + attribute and solid-relation layers; design = site group + cost", () => {
  for (const k of [...IDX_LISTEN, ...Object.keys(STUDIO_WERTE), ...PROGRAMM_FELDER, "bauteil_attribute_layer", "solidrelationen_layer"]) {
    assert.ok(ENTWURF_FELDER.bim.includes(k), `bim has ${k}`);
  }
  assert.deepEqual([...ENTWURF_FELDER.komplex].sort(), [...KOMPLEX_LAGE_GRUPPE, "cost_estimate"].sort());
  assert.deepEqual([...ABGELEITET].sort(), ["cost_estimate", "site_area"]);
  assert.ok(!ENTWURF_FELDER.bim.includes("csg_cache_layer") && !ENTWURF_FELDER.bim.includes("ansicht_layer"), "caches / views stay autosaved");
});

test("entwurfLeer is clean, version 1, bound to person and project", () => {
  const e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  assert.equal(e.v, ENTWURF_VERSION);
  assert.equal(ENTWURF_VERSION, 1);
  assert.equal(e.benutzer, "u1");
  assert.equal(e.projekt, "p1");
  assert.equal(entwurfSauber(e), true);
  assert.equal(entwurfAenderungen(e), 0);
});

test("entwurfMelden keeps only fields that differ from the base, with the base values of exactly those fields", () => {
  const basis = { customWalls: [wand(1, 0), wand(2, 10)], dachform: "sattel", customZones: [] };
  const werte = { customWalls: [wand(1, 0), wand(2, 12)], dachform: "sattel", customZones: [] };
  let e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  e = entwurfMelden(e, "bim", { stand: { id: "bm1", updated_date: "t1" }, basis, werte, felder: ["customWalls", "dachform", "customZones"] }, ZEIT);
  assert.deepEqual(Object.keys(e.aenderungen.bim), ["customWalls"]);
  assert.deepEqual(e.basis.bim.felder.customWalls, basis.customWalls);
  assert.deepEqual(Object.keys(e.basis.bim.felder), ["customWalls"]);
  assert.equal(e.basis.bim.id, "bm1");
  assert.equal(e.basis.bim.updated_date, "t1");
  assert.equal(entwurfAenderungen(e), 1, "one wall changed");
  // back to the stored state → the field leaves the draft again
  e = entwurfMelden(e, "bim", { stand: { id: "bm1", updated_date: "t1" }, basis, werte: basis, felder: ["customWalls", "dachform", "customZones"] }, ZEIT);
  assert.deepEqual(e.aenderungen.bim, {});
  assert.equal(entwurfSauber(e), true);
});

test("entwurfMelden of one source leaves the fields of another source alone (studio and program fields share the record)", () => {
  let e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  e = entwurfMelden(e, "bim", { stand: { id: "bm1", updated_date: "t1" }, basis: { storeys: 2 }, werte: { storeys: 3 }, felder: ["storeys"] }, ZEIT);
  e = entwurfMelden(e, "bim", { stand: { id: "bm1", updated_date: "t1" }, basis: { customWalls: [] }, werte: { customWalls: [wand(1, 0)] }, felder: ["customWalls"] }, ZEIT);
  assert.deepEqual(Object.keys(e.aenderungen.bim).sort(), ["customWalls", "storeys"]);
  assert.equal(entwurfAenderungen(e), 2);
});

test("derived values never make a draft dirty (site area, cost estimate) but ride along with real changes", () => {
  let e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  e = entwurfMelden(e, "komplex", { stand: { id: "bc1", updated_date: "t1" }, basis: { cost_estimate: { total_cost: 1 } }, werte: { cost_estimate: { total_cost: 2 } }, felder: ["cost_estimate"] }, ZEIT);
  assert.equal(entwurfSauber(e), true, "only a derived value differs");
  assert.ok("cost_estimate" in e.aenderungen.komplex, "kept for the save");
});

test("entwurfEntscheiden: equal stand / other updated_date / other id / record gone / no base", () => {
  const b = { id: "bm1", updated_date: "t1", felder: { customWalls: [] } };
  assert.equal(entwurfEntscheiden(b, { id: "bm1", updated_date: "t1" }), "gleich");
  assert.equal(entwurfEntscheiden(b, { id: "bm1", updated_date: "t0" }), "rebase", "an OLDER stored date is another state too");
  assert.equal(entwurfEntscheiden(b, { id: "bm9", updated_date: "t1" }), "ersetzt");
  assert.equal(entwurfEntscheiden(b, null), "geloescht");
  assert.equal(entwurfEntscheiden(null, { id: "bm1", updated_date: "t1" }), "gleich", "nothing drafted");
  assert.equal(entwurfEntscheiden({ id: null, updated_date: null, felder: { customWalls: [] } }, null), "gleich", "drafted on no record, still none");
  assert.equal(entwurfEntscheiden({ id: null, updated_date: null, felder: { customWalls: [] } }, { id: "bm1", updated_date: "t1" }), "rebase", "a record was created meanwhile");
});

test("entwurfRebase (bim): a local NEW wall colliding with a foreign new door gets a free number; foreign and own changes both stay", () => {
  const basis = { customWalls: [wand(1, 0), wand(2, 10)], customWindows: [] };
  const mein = { customWalls: [wand(1, 0), { ...wand(2, 10), dicke: 0.3 }, wand(3, 20)], customWindows: [] };
  const server = { customWalls: [{ ...wand(1, 0), dicke: 0.36 }, wand(2, 10)], customWindows: [tuer(3, 1)] };
  const r = entwurfRebase({ teil: "bim", basis, mein, server, idxBasis: { customWalls: [1, 2], customWindows: [] } });
  assert.deepEqual(r.konflikte, {});
  const waende = r.werte.customWalls;
  assert.deepEqual(waende.map((/** @type {any} */ w) => w._idx).sort(), [1, 2, 4]);
  assert.equal(waende.find((/** @type {any} */ w) => w._idx === 1).dicke, 0.36, "foreign change taken");
  assert.equal(waende.find((/** @type {any} */ w) => w._idx === 2).dicke, 0.3, "own change kept");
  assert.equal(waende.find((/** @type {any} */ w) => w._idx === 4).a.x, 20, "own new wall renumbered, not lost");
  assert.deepEqual(r.werte.customWindows, [tuer(3, 1)], "foreign door stays");
  assert.deepEqual(r.umbenanntJeListe, { customWalls: [[3, 4]] });
});

test("entwurfRebase (bim): both changed the same wall → a conflict, my version stays in the result until the person decides", () => {
  const basis = { customWalls: [wand(1, 0)] };
  const mein = { customWalls: [{ ...wand(1, 0), dicke: 0.3 }] };
  const server = { customWalls: [{ ...wand(1, 0), dicke: 0.5 }] };
  const r = entwurfRebase({ teil: "bim", basis, mein, server, idxBasis: { customWalls: [1] } });
  assert.equal(r.konflikte.customWalls.length, 1);
  assert.equal(r.werte.customWalls[0].dicke, 0.3);
});

test("entwurfRebase (bim) without a base of a list the draft never touched: a foreign new element there is no own element", () => {
  // draft changed only the walls; the other device added a column 3 and the draft added a wall 3 → different lists, both stay (K12)
  const basis = { customWalls: [wand(1, 0)] };
  const mein = { customWalls: [wand(1, 0), wand(3, 20)] };
  const server = { customWalls: [wand(1, 0)], customColumns: [{ _idx: 3, x: 5, z: 5 }] };
  const r = entwurfRebase({ teil: "bim", basis, mein, server, idxBasis: { customWalls: [1], customColumns: [] } });
  assert.deepEqual(r.werte.customWalls.map((/** @type {any} */ w) => w._idx).sort(), [1, 4], "renumbered against the global counter");
  assert.equal(r.werte.customColumns, undefined, "a list outside the draft is never part of the result");
});

test("K7: an opening of the draft whose wall the other device deleted is reported, not silently orphaned", () => {
  const basis = { customWalls: [wand(1, 0), wand(2, 10)], customWindows: [] };
  const mein = { customWalls: [wand(1, 0), wand(2, 10)], customWindows: [tuer(3, 2)] };
  const server = { customWalls: [wand(1, 0)], customWindows: [] };
  const r = entwurfRebase({ teil: "bim", basis, mein, server, idxBasis: { customWalls: [1, 2], customWindows: [] } });
  assert.equal(r.verweise.length, 1);
  assert.equal(r.verweise[0].schluessel, "_idx:3");
  assert.equal(r.verweise[0].wallIdx, 2);
  assert.deepEqual(verweisePruefen({ customWalls: [wand(1, 0)], customWindows: [tuer(3, 1)] }), []);
});

test("entwurfRebase (komplex): the site group is ONE unit — both changed it → one conflict, mine stays; derived never conflicts", () => {
  const basis = { site_parcel: { p: 1 }, nordwinkel: 0, cost_estimate: { total_cost: 1 } };
  const mein = { site_parcel: { p: 1 }, nordwinkel: 30, cost_estimate: { total_cost: 2 } };
  const server = { site_parcel: { p: 2 }, nordwinkel: 0, cost_estimate: { total_cost: 3 } };
  const r = entwurfRebase({ teil: "komplex", basis, mein, server });
  assert.equal(r.konflikte.length, 1);
  assert.equal(r.konflikte[0].einheit, "lage");
  assert.equal(r.werte.nordwinkel, 30);
  assert.deepEqual(r.werte.cost_estimate, { total_cost: 3 }, "derived: the stored value counts");
  // only the other device moved the parcel → taken
  const r2 = entwurfRebase({ teil: "komplex", basis, mein: { ...basis }, server });
  assert.deepEqual(r2.konflikte, []);
  assert.deepEqual(r2.werte.site_parcel, { p: 2 });
});

test("entwurfNachSpeichern drops what is stored now, keeps what was not written (K5: partly saved)", () => {
  let e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  e = entwurfMelden(e, "bim", { stand: { id: "bm1", updated_date: "t1" }, basis: { customWalls: [], dachform: "flach" }, werte: { customWalls: [wand(1, 0)], dachform: "sattel" }, felder: ["customWalls", "dachform"] }, ZEIT);
  const teil = entwurfNachSpeichern(e, "bim", { id: "bm1", updated_date: "t2", customWalls: [wand(1, 0)], dachform: "flach" });
  assert.deepEqual(Object.keys(teil.aenderungen.bim), ["dachform"], "the field held back stays");
  assert.equal(teil.basis.bim.updated_date, "t2");
  assert.equal(teil.basis.bim.felder.dachform, "flach");
  const alles = entwurfNachSpeichern(teil, "bim", { id: "bm1", updated_date: "t3", customWalls: [wand(1, 0)], dachform: "sattel" });
  assert.equal(entwurfSauber(alles), true);
});

test("D-115-51: a confirmed proposal step waits in the draft; undo of a waiting step removes it", () => {
  let e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  e = entwurfSchrittVormerken(e, { vorschlag_id: "v1", eintrag: { vorschlag_id: "v1", art: "aendern" }, pruefung: null });
  assert.equal(e.schritte.length, 1);
  assert.equal(entwurfSauber(e), false, "a waiting step is unsaved work");
  const ohne = entwurfSchrittEntfernen(e, "v1");
  assert.equal(ohne.removed, true);
  assert.equal(ohne.entwurf.schritte.length, 0);
  assert.equal(entwurfSchrittEntfernen(ohne.entwurf, "v1").removed, false);
});

test("entwurfNachSpeichern: a wall stored with the GUID the save pinned counts as stored (no fake change after a switch)", () => {
  let e = entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT });
  e = entwurfMelden(e, "bim", { stand: { id: "bm1", updated_date: "t1" }, basis: { customWalls: [] }, werte: { customWalls: [wand(1, 0)] }, felder: ["customWalls"] }, ZEIT);
  const n = entwurfNachSpeichern(e, "bim", { id: "bm1", updated_date: "t2", customWalls: [{ ...wand(1, 0), guid: "2abcdefghijklmnopqrstu" }] });
  assert.equal(entwurfSauber(n), true);
});
