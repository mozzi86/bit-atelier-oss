// 115-05a (A-4, K6): the design record (BuildingComplex) writes only the fields that changed, and a refused write (409)
// is merged per field three ways - the site/location fields as ONE unit, so a new location is never mixed with old
// buildings. Derived values (site area, cost estimate) never make a conflict; the stored value counts.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  komplexPatch, komplexAbgleichen, KOMPLEX_VERWALTUNG, KOMPLEX_LAGE_GRUPPE, KOMPLEX_ABGELEITET, KOMPLEX_FELDNAMEN,
} from "@core/lib/abgleich/komplexAbgleich.js";

/** Start values like ComplexDesigner komplexStart (the caller normalises; a shortened copy is enough here). */
const START = Object.freeze({
  name: "", location: null, site_area: 0, site_parcel: null, grundstueck: null, nordwinkel: 0, context_buildings: [], designated_areas: [],
  buildings: [], riegel: [], unit_types: [], kennzahlen_hand: null, energy_systems: [], topography: { elevation_points: [] }, hochwasser: null,
  cost_estimate: { total_cost: 0 }, interior_designs: [], moeblierung: {}, moebel_eigene: [], map_context: { center: [51, 10], zoom: 6, style: "normal" },
});
/** @param {Record<string, any>} rec a stored record @returns {Record<string, any>} normalised fields, without administration */
const normal = (rec) => Object.fromEntries(Object.entries({ ...START, ...rec }).filter(([k]) => !KOMPLEX_VERWALTUNG.includes(k)));
const PARZELLE = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }], m_per_px: 0.5, source: "gezeichnet" };
const BASIS = normal({ id: "c1", project_id: "P", updated_date: "2026-11-19T10:00:00.000Z", name: "Wohnhaus", location: { lat: 49.4, lng: 11.1 },
  site_parcel: PARZELLE, site_area: 2000, energy_systems: [{ id: "e1", typ: "wp" }], buildings: [{ id: "b1", x: 10, y: 10 }] });

test("constants: administration, the site/location group, derived fields, German labels", () => {
  assert.deepEqual([...KOMPLEX_VERWALTUNG].sort(), ["created_date", "id", "project_id", "updated_date"]);
  for (const k of ["location", "map_context", "site_parcel", "site_area", "topography", "context_buildings", "context_buildings_source", "grundstueck",
    "designated_areas", "riegel", "buildings", "nordwinkel"]) assert.ok(KOMPLEX_LAGE_GRUPPE.includes(k), k);
  assert.deepEqual([...KOMPLEX_ABGELEITET].sort(), ["cost_estimate", "site_area"]);
  assert.equal(KOMPLEX_FELDNAMEN.lage, "Grundstück und Lage");
  assert.equal(KOMPLEX_FELDNAMEN.kennzahlen_hand, "Kennzahlen von Hand");
});

test("komplexPatch: only changed fields, never administration or a held-back field; start values are no change", () => {
  const jetzt = { ...BASIS, kennzahlen_hand: { wohneinheiten: 3, stellplaetze: null }, nordwinkel: 15, id: "c1", updated_date: "x", created_date: "y", project_id: "P" };
  assert.deepEqual(komplexPatch(BASIS, jetzt, []), { kennzahlen_hand: { wohneinheiten: 3, stellplaetze: null }, nordwinkel: 15 });
  assert.deepEqual(komplexPatch(BASIS, jetzt, ["nordwinkel"]), { kennzahlen_hand: { wohneinheiten: 3, stellplaetze: null } });
  assert.deepEqual(komplexPatch(BASIS, jetzt, new Set(["kennzahlen_hand", "nordwinkel"])), {});
  // a record without most fields, normalised on both sides: nothing to write
  assert.deepEqual(komplexPatch(normal({ name: "X" }), normal({ name: "X" }), []), {});
});

test("only foreign energy_systems → setzen; only my kennzahlen_hand → schreiben; no conflict", () => {
  const mein = { ...BASIS, kennzahlen_hand: { wohneinheiten: 4, stellplaetze: null } };
  const fremd = { ...BASIS, energy_systems: [{ id: "e2", typ: "fernwaerme" }] };
  const r = komplexAbgleichen({ basis: BASIS, mein, fremd, gesperrt: [] });
  assert.deepEqual(r.setzen, { energy_systems: fremd.energy_systems });
  assert.deepEqual(r.schreiben, { kennzahlen_hand: mein.kennzahlen_hand });
  assert.deepEqual(r.konflikte, []);
  assert.deepEqual(r.neueBasis, fremd, "the stored record is the new base");
});

test("foreign moves site_parcel, mine turns nordwinkel → ONE conflict 'lage', nothing of the group mixed", () => {
  const mein = { ...BASIS, nordwinkel: 30 };
  const fremd = { ...BASIS, site_parcel: { ...PARZELLE, points: [{ x: 5, y: 0 }, { x: 105, y: 0 }, { x: 105, y: 80 }] }, site_area: 2100 };
  const r = komplexAbgleichen({ basis: BASIS, mein, fremd, gesperrt: [] });
  assert.equal(r.konflikte.length, 1);
  const k = r.konflikte[0];
  assert.equal(k.einheit, "lage");
  assert.ok(k.felder.includes("site_parcel") && k.felder.includes("nordwinkel"));
  assert.equal(k.mein.nordwinkel, 30);
  assert.deepEqual(k.fremd.site_parcel, fremd.site_parcel);
  for (const f of KOMPLEX_LAGE_GRUPPE) {
    assert.equal(f in r.setzen, false, `group field ${f} is not set while the card is open`);
    assert.equal(f in r.schreiben, false, `group field ${f} is not written while the card is open`);
  }
});

test("foreign changes moeblierung, mine site_parcel → no conflict, both kept", () => {
  const mein = { ...BASIS, site_parcel: { ...PARZELLE, m_per_px: 0.6 }, site_area: 2400 };
  const fremd = { ...BASIS, moeblierung: { "guid:R1": [{ id: "m1", typ: "bett" }] } };
  const r = komplexAbgleichen({ basis: BASIS, mein, fremd, gesperrt: [] });
  assert.deepEqual(r.konflikte, []);
  assert.deepEqual(r.setzen, { moeblierung: fremd.moeblierung });
  assert.deepEqual(r.schreiben, { site_parcel: mein.site_parcel, site_area: 2400 });
});

test("derived values changed on both sides: never a conflict, the stored value counts", () => {
  const mein = { ...BASIS, site_area: 1999.5, cost_estimate: { total_cost: 100 } };
  const fremd = { ...BASIS, site_area: 2000.4, cost_estimate: { total_cost: 200 } };
  const r = komplexAbgleichen({ basis: BASIS, mein, fremd, gesperrt: [] });
  assert.deepEqual(r.konflikte, []);
  assert.deepEqual(r.setzen, { site_area: 2000.4, cost_estimate: { total_cost: 200 } });
  assert.deepEqual(r.schreiben, {});
});

test("two plain fields changed differently on both sides → one conflict per field, a held-back field is never written", () => {
  const mein = { ...BASIS, energy_systems: [{ id: "e1", typ: "pellet" }], kennzahlen_hand: { wohneinheiten: 2 } };
  const fremd = { ...BASIS, energy_systems: [{ id: "e1", typ: "gas" }] };
  const r = komplexAbgleichen({ basis: BASIS, mein, fremd, gesperrt: ["kennzahlen_hand"] });
  assert.deepEqual(r.konflikte.map((k) => k.einheit), ["energy_systems"]);
  assert.deepEqual(r.konflikte[0].felder, ["energy_systems"]);
  assert.equal("energy_systems" in r.setzen, false, "mine stays on screen until the person decides");
  assert.deepEqual(r.schreiben, {}, "the held-back field waits for its card");
});
