// Plan 115-03 (user wish W-1115-02): navigation of the Komplex-Designer.
//
// What must hold: the building model ("Gebäudemodell", key `bim`) is the first tab of area 3 "Gebäude"; every
// tab key still resolves as a deep link and belongs to exactly one area; the tabs per kind of project default
// to "everything", the single-family house hides only the proposed list, and a hidden tab stays reachable
// (deep link, "Alle Reiter zeigen"); the direct views of the building model resolve from `?ansicht=`.
//
// In:  the navigation registry, the page source and the two files that carry the direct link (as text).
// Out: assertions only, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DESIGNER_BEREICHE,
  DESIGNER_REITER,
  TAB_ALIAS,
  GEBAEUDEMODELL_TAB,
  ANSICHT_PARAMETER,
  BIM_ANSICHTEN,
  PROJEKTARTEN,
  AUSGEBLENDET_JE_PROJEKTART,
  aufloesen,
  bereichFuerTab,
  reiterFuerTab,
  reiterImBereich,
  bimAnsichtAusParam,
  gebaeudemodellSuche,
  projektartVon,
  ausgeblendeteReiter,
  reiterFuerProjektart,
} from "@designer/config/designerNavigation.js";

const lies = (/** @type {string} */ pfad) => fs.readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");
const schluessel = (/** @type {Array<any>} */ liste) => liste.map((r) => r.key);

/** The list proposed for the single-family house — written out here so a change of the list is a deliberate test change. */
const EFH_AUSGEBLENDET = ["compliance", "apartments", "asr"]; // user 16.11.2026: "Hochwasser" stays visible

test("115-03: das Gebäudemodell steht in „3 · Gebäude“ als erster Reiter, der Schlüssel bleibt bim", () => {
  assert.equal(GEBAEUDEMODELL_TAB, "bim");
  assert.equal(bereichFuerTab("bim"), "gebaeude");
  assert.equal(reiterImBereich("gebaeude")[0].key, "bim");
  assert.equal(reiterFuerTab("bim").label, "Gebäudemodell");
  assert.equal(DESIGNER_BEREICHE.find((b) => b.id === "gebaeude").titel, "3 · Gebäude");
  assert.equal(schluessel(reiterImBereich("baukoerper")).includes("bim"), false);
});

test("115-03: „2 · Baukörper“ behält Bauaufnahme, Massing-Studio, Baufeld-Planung und Gebäude & Nutzung", () => {
  assert.deepEqual(schluessel(reiterImBereich("baukoerper")), ["bauaufnahme", "studio", "massing", "buildings"]);
  assert.deepEqual(schluessel(reiterImBereich("gebaeude")), ["bim", "program", "compliance", "apartments", "werkstatt", "interiors"]);
});

test("115-03: kein Reiter eines früheren Bereichs braucht das Gebäudemodell", () => {
  // The line "Braucht / Liefert" follows the move: what a tab needs must not come from a later area.
  const reihenfolge = DESIGNER_BEREICHE.map((b) => b.id);
  const vorGebaeude = DESIGNER_REITER.filter((r) => reihenfolge.indexOf(r.bereich) < reihenfolge.indexOf("gebaeude"));
  for (const r of vorGebaeude) assert.equal(r.braucht.includes("Gebäudemodell"), false, `${r.key} braucht das Gebäudemodell, liegt aber davor`);
});

test("115-03: jeder Reiter-Schlüssel löst als Deep-Link auf und gehört zu genau einem Bereich", () => {
  const bereiche = DESIGNER_BEREICHE.map((b) => b.id);
  for (const r of DESIGNER_REITER) {
    assert.equal(aufloesen(r.key), r.key, `?tab=${r.key} löst nicht mehr auf`);
    const treffer = bereiche.filter((id) => schluessel(reiterImBereich(id)).includes(r.key));
    assert.deepEqual(treffer, [r.bereich], `${r.key} steht nicht in genau einem Bereich`);
  }
  for (const [alias, ziel] of Object.entries(TAB_ALIAS)) assert.equal(aufloesen(alias), ziel);
});

test("115-03: die Schlüssel sind dieselben 31 wie vor der Umgruppierung", () => {
  // Frozen list: store fields, deep links, handoffs and the headless suites hang on these strings.
  const vorher = [
    "site", "terrain", "landscape", "flood_risk", "analysis",
    "bauaufnahme", "studio", "massing", "bim", "buildings",
    "program", "compliance", "apartments", "werkstatt", "interiors",
    "statics", "haustechnik", "brandschutz", "asr", "barrierefreiheit", "acoustics", "waermebruecken", "bauphysik", "raumklima",
    "energy", "costs", "funding", "generative", "integrations", "planner", "support",
  ];
  assert.deepEqual([...schluessel(DESIGNER_REITER)].sort(), [...vorher].sort());
});

test("115-03: reiterFuerProjektart — ohne bekannte Projektart alles wie bisher", () => {
  for (const art of [null, undefined, "", "gibtsnicht", "constructor"]) {
    const je = reiterFuerProjektart(art);
    assert.deepEqual(Object.keys(je), DESIGNER_BEREICHE.map((b) => b.id));
    for (const b of DESIGNER_BEREICHE) assert.deepEqual(schluessel(je[b.id]), schluessel(reiterImBereich(b.id)), `${String(art)} / ${b.id}`);
    assert.deepEqual(ausgeblendeteReiter(art), []);
  }
});

test("115-03: Einfamilienhaus blendet nur die vorgeschlagenen Reiter aus", () => {
  assert.deepEqual([...AUSGEBLENDET_JE_PROJEKTART.efh].sort(), [...EFH_AUSGEBLENDET].sort());
  assert.deepEqual([...ausgeblendeteReiter("efh")].sort(), [...EFH_AUSGEBLENDET].sort());
  assert.equal(PROJEKTARTEN.efh.titel, "Einfamilienhaus");

  const je = reiterFuerProjektart("efh");
  const sichtbar = Object.values(je).flatMap(schluessel);
  const erwartet = schluessel(DESIGNER_REITER).filter((k) => !EFH_AUSGEBLENDET.includes(k));
  assert.deepEqual([...sichtbar].sort(), [...erwartet].sort());
  assert.equal(sichtbar.length, DESIGNER_REITER.length - EFH_AUSGEBLENDET.length);
  // The order inside an area stays the registry order, and the building model stays first in area 3.
  assert.deepEqual(schluessel(je.gebaeude), ["bim", "program", "werkstatt", "interiors"]);
  assert.deepEqual(schluessel(je.standort), ["site", "terrain", "landscape", "flood_risk", "analysis"]);
  // The tabs that DEFINE the single-family house stay: unit mix and the dwelling workshop.
  assert.ok(sichtbar.includes("buildings"));
  assert.ok(sichtbar.includes("werkstatt"));
});

test("115-03: jede hinterlegte Liste nennt nur echte Reiter und lässt keinen Bereich leer", () => {
  for (const [art, liste] of Object.entries(AUSGEBLENDET_JE_PROJEKTART)) {
    assert.ok(PROJEKTARTEN[art], `Liste für unbekannte Projektart ${art}`);
    for (const k of liste) assert.equal(aufloesen(k), k, `${art}: ${k} ist kein Reiter`);
    assert.equal(liste.includes(GEBAEUDEMODELL_TAB), false, "das Gebäudemodell wird nie ausgeblendet");
    for (const [bereich, reiter] of Object.entries(reiterFuerProjektart(art))) assert.ok(reiter.length > 0, `${art}: Bereich ${bereich} wäre leer`);
  }
});

test("115-03: ein ausgeblendeter Reiter bleibt erreichbar — Deep-Link und „Alle Reiter zeigen“", () => {
  for (const k of EFH_AUSGEBLENDET) {
    // 1. the deep link resolves, whatever the kind of project
    assert.equal(aufloesen(k), k);
    const bereich = bereichFuerTab(k);
    assert.ok(bereich, `${k} ohne Bereich`);
    // 2. opened, the tab stands in the row of its own area (at its registry position), the other hidden ones stay away
    const je = reiterFuerProjektart("efh", { aktiv: k });
    assert.ok(schluessel(je[bereich]).includes(k), `${k} fehlt in seiner Reiterzeile, obwohl er offen ist`);
    const alle = schluessel(reiterImBereich(bereich));
    assert.deepEqual(schluessel(je[bereich]), alle.filter((x) => x === k || !EFH_AUSGEBLENDET.includes(x)));
    for (const anderer of EFH_AUSGEBLENDET.filter((x) => x !== k)) {
      assert.equal(Object.values(je).flatMap(schluessel).includes(anderer), false, `${anderer} taucht mit auf`);
    }
  }
  // 3. the switch shows everything
  const alles = reiterFuerProjektart("efh", { alle: true });
  for (const b of DESIGNER_BEREICHE) assert.deepEqual(schluessel(alles[b.id]), schluessel(reiterImBereich(b.id)));
});

test("115-03: reiterFuerProjektart ist rein — neue Arrays, die Registry bleibt unverändert", () => {
  const vorher = JSON.stringify(schluessel(DESIGNER_REITER));
  const a = reiterFuerProjektart("efh");
  const b = reiterFuerProjektart("efh");
  assert.notEqual(a, b);
  assert.notEqual(a.gebaeude, b.gebaeude);
  a.gebaeude.length = 0;
  assert.equal(reiterFuerProjektart("efh").gebaeude.length, 4);
  assert.equal(JSON.stringify(schluessel(DESIGNER_REITER)), vorher);
});

test("115-03: projektartVon — Einfamilienhaus nur als Wohngebäude mit einer Wohneinheit", () => {
  assert.equal(projektartVon({ projektTyp: "residential", werkstattTyp: "efh" }), "efh");
  assert.equal(projektartVon({ projektTyp: "residential", wohneinheiten: 1 }), "efh");
  assert.equal(projektartVon({ projektTyp: "", werkstattTyp: "efh" }), "efh");
  assert.equal(projektartVon({ projektTyp: null, wohneinheiten: 1 }), "efh");
  // not known = everything stays visible
  assert.equal(projektartVon(undefined), null);
  assert.equal(projektartVon({}), null);
  assert.equal(projektartVon({ projektTyp: "residential" }), null);
  assert.equal(projektartVon({ projektTyp: "residential", werkstattTyp: "mittelflur", wohneinheiten: 0 }), null);
  assert.equal(projektartVon({ projektTyp: "residential", wohneinheiten: 12 }), null);
  assert.equal(projektartVon({ projektTyp: "residential", wohneinheiten: null }), null);
  // never for mixed-use or non-residential projects, even with one dwelling or the house typology
  for (const typ of ["mixed_use", "commercial", "institutional", "heritage_conservation", "urban_development"]) {
    assert.equal(projektartVon({ projektTyp: typ, werkstattTyp: "efh", wohneinheiten: 1 }), null, typ);
  }
});

test("115-03: Direktansichten des Gebäudemodells — Grundriss zuerst, ?ansicht= löst auf", () => {
  assert.equal(ANSICHT_PARAMETER, "ansicht");
  assert.deepEqual(BIM_ANSICHTEN.map((a) => a.id), ["grundriss", "schnitt", "3d"]);
  for (const a of BIM_ANSICHTEN) {
    assert.equal(bimAnsichtAusParam(a.id), a.id);
    assert.ok(a.label.length > 0);
    assert.ok(a.icon, `${a.id}: icon fehlt`);
  }
  assert.equal(bimAnsichtAusParam(" Grundriss "), "grundriss");
  assert.equal(bimAnsichtAusParam("3D"), "3d");
  for (const muell of [null, undefined, "", "skizze", "constructor", "grundriss2"]) assert.equal(bimAnsichtAusParam(muell), null);

  assert.equal(gebaeudemodellSuche("grundriss"), "tab=bim&ansicht=grundriss");
  assert.equal(gebaeudemodellSuche("schnitt"), "tab=bim&ansicht=schnitt");
  assert.equal(gebaeudemodellSuche("quatsch"), "tab=bim");
  assert.equal(gebaeudemodellSuche(null), "tab=bim");
  // the link opens the building model: its tab part resolves, its view part resolves
  const p = new URLSearchParams(gebaeudemodellSuche("grundriss"));
  assert.equal(aufloesen(p.get("tab")), "bim");
  assert.equal(bimAnsichtAusParam(p.get(ANSICHT_PARAMETER)), "grundriss");
});

test("115-03: die Ansichts-Schlüssel sind die des Studios, und das Studio nimmt die Startansicht an", () => {
  // The ids must equal the view state of BitBimStudio.jsx — read from the file, not from a second list.
  const studio = lies("packages/nova-designer/src/components/BitBimStudio.jsx");
  for (const a of BIM_ANSICHTEN) assert.ok(studio.includes(`{ id: "${a.id}", label:`), `Studio kennt die Ansicht ${a.id} nicht mehr`);
  assert.match(studio, /export default function BitBimStudio\(\{[^)]*\bstartAnsicht\b/, "BitBimStudio nimmt startAnsicht nicht mehr an");
  const seite = lies("packages/nova-designer/src/pages/ComplexDesigner.jsx");
  assert.match(seite, /<BitBimStudio[^>]*\bstartAnsicht=\{/, "die Seite reicht die Startansicht nicht an das Studio");
  assert.ok(seite.includes("bimAnsichtAusParam(searchParams.get(ANSICHT_PARAMETER))"), "die Seite liest ?ansicht= nicht");
});

test("115-03: der Direktknopf auf der Projektkarte zeigt auf einen gültigen Link", () => {
  const dashboard = lies("src/pages/Dashboard.jsx");
  const m = dashboard.match(/to: "ComplexDesigner", suche: "([^"]+)"/);
  assert.ok(m, "Projektkarte ohne Direktknopf zum Grundriss");
  assert.equal(m[1], gebaeudemodellSuche("grundriss"));
});
