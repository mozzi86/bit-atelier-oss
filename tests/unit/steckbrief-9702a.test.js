// 97-02a: element data sheet for ALL elements (architecture, structure, services, penetrations,
// fire stops) — IFC class, status, build-up, trade, KG, quantity, section, stable GUID; every value
// says whether it was set, derived or is still open. One build-up table, one trade catalogue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BAUTEIL_TYPEN, steckbrief, typFuerWand, typFuerNetz, bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { WALL_COMPOSITES, WAND_KLASSEN, WANDSTAERKEN, aufbauVon } from "@core/lib/bauteil/aufbauten.js";
import { STLB_LB, lbEintrag, LB_ALT } from "@core/lib/bauteil/gewerke.js";
import { WALL_COMPOSITES as WC_ALT } from "@core/lib/buildingModel.js";
import { WAND_KLASSEN as WK_ALT } from "@core/lib/werkstattBauteile.js";
import { WANDSTAERKEN as WS_ALT } from "@designer/lib/tesselierung.js";
import { schichtFromComposite } from "@core/lib/bimClassification.js";
import { GEWERKE_KATALOG } from "@/lib/planung/bauablauf.js";

test("eine Aufbau-Tabelle: alte Namen zeigen auf dieselben Objekte", () => {
  assert.equal(WC_ALT, WALL_COMPOSITES);
  assert.equal(WK_ALT, WAND_KLASSEN);
  assert.equal(WS_ALT, WANDSTAERKEN);
  assert.deepEqual({ ...WANDSTAERKEN }, { aussen: 0.365, tragend: 0.24, leicht: 0.115 });
  for (const k of Object.values(WAND_KLASSEN)) assert.equal(k.skins.reduce((a, s) => a + s.thickness, 0) / 1000, k.dicke_m);
});

test("AVA-Schichten unverändert (byte-gleich zur alten Handtabelle)", () => {
  assert.deepEqual(schichtFromComposite("single24"), ["Stahlbeton"]);
  assert.deepEqual(schichtFromComposite("cavity"), ["Klinker", "Dämmung", "Kalksandstein"]);
  assert.deepEqual(schichtFromComposite("timber"), ["Holz", "Dämmung"]);
  assert.deepEqual(schichtFromComposite("quatsch"), []);
});

test("ein Gewerke-Katalog: Abbruch LB 084, Reihenfolge eindeutig, Bauablauf liest denselben", () => {
  assert.equal(GEWERKE_KATALOG, STLB_LB);
  assert.equal(lbEintrag("084").name, "Abbruch- und Rückbauarbeiten");
  assert.match(lbEintrag("040").name, /Wärmeversorgung/);
  assert.ok(LB_ALT["040"]);
  assert.equal(new Set(STLB_LB.map((g) => g.lb)).size, STLB_LB.length);
  assert.equal(new Set(STLB_LB.map((g) => g.folge)).size, STLB_LB.length);
  assert.ok(lbEintrag("084").folge < lbEintrag("013").folge && lbEintrag("041").folge < lbEintrag("039").folge, "Abbruch vor Rohbau, Rohinstallation vor Trockenbau");
});

test("jeder Bauteiltyp hat IFC-Klasse, Einheit und — wo fest — einen bekannten LB", () => {
  for (const [k, t] of Object.entries(BAUTEIL_TYPEN)) {
    assert.match(t.ifc, /^Ifc[A-Z]/, k);
    assert.ok(t.ifcTyp, k);
    assert.ok(["m2", "m3", "m", "Stk"].includes(t.einheit), k);
    if (t.lb) assert.ok(lbEintrag(t.lb), `${k}: LB ${t.lb} fehlt im Katalog`);
    if (t.kg) assert.match(t.kg, /^[1-8]\d\d$/, k);
  }
  for (const bereich of ["architektur", "tragwerk", "tga", "durchbruch"]) assert.ok(Object.values(BAUTEIL_TYPEN).some((t) => t.bereich === bereich), bereich);
});

test("gezeichnete Wand: Steckbrief komplett, Annahmen und offene Felder sichtbar, kein Neubau-Default", () => {
  const w = { a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, height: 3, composite: "cavity", _idx: 4 };
  const { typ, abgeleitet } = typFuerWand(w);
  assert.equal(typ, "wand-aussen"); assert.equal(abgeleitet, true);
  const s = steckbrief(w, typ, { projektId: "p1", quelle: "customWalls", typAbgeleitet: abgeleitet });
  assert.deepEqual(s.ifc, { klasse: "IfcWall", typ: "STANDARD" });
  assert.equal(s.kg, "331"); assert.equal(s.gewerk.lb, "012");
  assert.equal(s.status, null, "ohne Status, nie Neubau");
  assert.deepEqual(s.menge, { wert: 15, einheit: "m2" });
  assert.equal(s.aufbau.schichten.length, 5); assert.equal(s.aufbau.dicke_m, 0.46);
  assert.equal(s.quelle.typ, "abgeleitet"); assert.equal(s.quelle.kg, "abgeleitet");
  assert.ok(s.offen.includes("status") && s.offen.includes("bauabschnitt"));
  assert.ok(s.annahmen.length >= 1);
  assert.equal(s.guid.length, 22);
  assert.equal(s.guid, steckbrief(w, typ, { projektId: "p1", quelle: "customWalls" }).guid, "stabil ohne Speichern");
  assert.notEqual(s.guid, bauteilGuid("p2", "customWalls", w), "projektweise eindeutig");
});

test("gesetzte Werte schlagen Ableitungen; Status läuft durch die eine Normalisierung", () => {
  const w = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.115, _idx: 1, status: "Bestand", kg: "342", gewerk_lb: "039", bauabschnitt: "BA 2", bauteil_typ: "wand-innen" };
  const s = steckbrief(w, typFuerWand(w).typ, { projektId: "p1" });
  assert.equal(s.status, "bestand");
  assert.equal(s.gewerk.name, "Trockenbauarbeiten");
  assert.equal(s.bauabschnitt, "BA 2");
  assert.equal(s.quelle.typ, "gesetzt"); assert.equal(s.quelle.gewerk, "gesetzt");
  assert.deepEqual(s.offen, ["material"], "nur das Material ist offen (Dicke ohne Aufbau)");
  assert.equal(aufbauVon(w).quelle, "dicke");
});

test("Haustechnik: Leitungen, Erzeuger und Auslässe je Gewerk mit KG 4xx", () => {
  assert.equal(typFuerNetz({ gewerk: "abwasser" }), "leitung-abwasser");
  assert.equal(typFuerNetz({ gewerk: "heizung", art: "erzeuger" }), "waermeerzeuger");
  assert.equal(typFuerNetz({ gewerk: "lueftung", art: "auslass" }), "luftdurchlass");
  const kante = { id: "k1", gewerk: "abwasser", dn: 100, points: [{ x: 0, z: 0 }, { x: 3, z: 4 }] };
  const s = steckbrief(kante, typFuerNetz(kante), { projektId: "p1", quelle: "netz-kante" });
  assert.deepEqual(s.ifc, { klasse: "IfcPipeSegment", typ: "RIGIDSEGMENT" }, "nicht GUTTER (Dachrinne)");
  assert.equal(s.kg, "411"); assert.deepEqual(s.menge, { wert: 5, einheit: "m" });
  const verteiler = steckbrief({ id: "n1", gewerk: "trinkwasser", art: "verteiler" }, "rohrformteil", { netzGewerk: "trinkwasser" });
  assert.equal(verteiler.gewerk.lb, "042");
});

test("Tragwerk, Durchbruch und Brandschott sind eigene Bauteile", () => {
  const t = steckbrief({ id: "tr1", a: { x: 0, z: 0 }, b: { x: 6, z: 0 } }, "traeger");
  assert.equal(t.ifc.klasse, "IfcBeam"); assert.equal(t.tragend, true); assert.equal(t.menge.wert, 6);
  const d = steckbrief({ id: "D-001" }, "durchbruch");
  assert.deepEqual(d.ifc, { klasse: "IfcBuildingElementProxy", typ: "PROVISIONFORVOID" });
  assert.ok(d.offen.includes("kg"), "Durchbruch ohne Zuordnung: KG offen, nicht erfunden");
  const b = steckbrief({ id: "BS-1" }, "brandschott", { netzGewerk: "heizung" });
  assert.equal(b.gewerk.lb, "047"); assert.equal(b.kg, "422", "KG folgt dem durchführenden System");
  assert.throws(() => steckbrief({}, "gibtsnicht"), /Unbekannter Bauteiltyp/);
});
