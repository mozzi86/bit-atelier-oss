// 106-02: the selection as context — record fields, screen projection, the refusal without selection,
// the camera framing maths, the shared command group, and the element resolvers of the IFC viewer
// and the BIM studio (GUID parity with the IFC export).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { auswahlKontext, auswahlErforderlich, bildschirmPunkt, steckbriefKurz, KEINE_AUSWAHL_TEXT, KEIN_GUID_TEXT, AUSWAHL_KONTEXT_MAX } from "@core/lib/zeigen/auswahlKontext.js";
import { ansichtAufBox, MIN_RADIUS_M } from "@core/lib/zeigen/ansichtAufBox.js";
import { auswahlBefehleRegistrieren } from "@core/lib/zeigen/auswahlBefehle.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { steckbrief, bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { elementBox, steckbriefAusIfc, ifcBauteil, ifcAuswahlKontext, ifcModellUebersicht } from "@ifc/lib/auswahlIfc.js";
import { bimBauteil, bimAlle, bimPerGuid, bimModellUebersicht, bimAuswahlKontext } from "@designer/lib/auswahlBim.js";
import { huellwandGuid } from "@designer/lib/bauteilInfo.js";
import { createBuildingModel } from "@core/lib/buildingModel.js";
import { exportIFC } from "@designer/lib/ifcExport.js";

/** Camera at z = 10 looking at the origin; 800 x 600 px canvas. */
function kamera() {
  const k = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
  k.position.set(0, 0, 10);
  k.lookAt(0, 0, 0);
  k.updateMatrixWorld();
  return k;
}

const wand = { guid: "A".repeat(22), klasse: "IfcWall", name: "Wand 1", geschoss: "EG", mittelpunkt: [0, 0, 0],
  steckbrief: steckbrief({ status: "neubau", kg: "331", material: "Mauerwerk" }, "wand-aussen", { quelle: "t" }) };

test("auswahlKontext: Felder je Bauteil, Steckbrief mit Herkunft", () => {
  const k = auswahlKontext([wand]);
  assert.equal(k.anzahl, 1);
  const b = k.bauteile[0];
  assert.deepEqual([b.guid, b.klasse, b.name, b.geschoss], ["A".repeat(22), "IfcWall", "Wand 1", "EG"]);
  assert.equal(b.steckbrief.kg, "331");
  assert.equal(b.steckbrief.status, "neubau");
  assert.equal(b.steckbrief.material, "Mauerwerk");
  assert.equal(b.steckbrief.quelle.kg, "gesetzt");
  assert.equal(b.bildschirm, null, "ohne Kamera keine Bildschirmposition");
});

test("auswahlKontext: leere Auswahl, Mehrfachauswahl, fehlende Felder", () => {
  assert.deepEqual(auswahlKontext([]), { anzahl: 0, gekuerzt: false, ohneGuid: 0, bauteile: [] });
  assert.deepEqual(auswahlKontext(null), { anzahl: 0, gekuerzt: false, ohneGuid: 0, bauteile: [] });
  const k = auswahlKontext([wand, { guid: "", name: null }]);
  assert.equal(k.anzahl, 2);
  assert.equal(k.bauteile[1].guid, null);
  assert.equal(k.ohneGuid, 1, "ein Eintrag ohne GUID wird gezählt");
  assert.equal(k.bauteile[1].name, "");
  assert.equal(k.bauteile[1].steckbrief.kg, null);
  assert.deepEqual(k.bauteile[1].steckbrief.offen, ["kg", "gewerk", "material", "status"]);
});

test("bildschirmPunkt: Mitte, Versatz, hinter der Kamera, ausserhalb, ohne Kamera", () => {
  const opt = { kamera: kamera(), breite: 800, hoehe: 600 };
  assert.deepEqual(bildschirmPunkt([0, 0, 0], opt), { x: 400, y: 300, imBild: true });
  const rechts = bildschirmPunkt([1, 0, 0], opt);
  assert.ok(rechts.x > 400 && rechts.y === 300, "x nach rechts, y unverändert");
  const oben = bildschirmPunkt([0, 1, 0], opt);
  assert.ok(oben.y < 300, "oben im Bild = kleineres y");
  assert.equal(bildschirmPunkt([0, 0, 20], opt), null, "hinter der Kamera");
  const weit = bildschirmPunkt([50, 0, 0], opt);
  assert.equal(weit.imBild, false);
  assert.equal(bildschirmPunkt([0, 0, 0], {}), null);
  assert.equal(bildschirmPunkt([NaN, 0, 0], opt), null);
  assert.equal(bildschirmPunkt(null, opt), null);
  const k = auswahlKontext([wand], opt);
  assert.deepEqual(k.bauteile[0].bildschirm, { x: 400, y: 300, imBild: true });
});

test("auswahlErforderlich: ohne Auswahl der Klartext, mit Auswahl derselbe Kontext", () => {
  assert.throws(() => auswahlErforderlich(auswahlKontext([])), { message: "Keine Auswahl — erst ein Bauteil zeigen oder mit auswahl-guid wählen" });
  assert.equal(KEINE_AUSWAHL_TEXT, "Keine Auswahl — erst ein Bauteil zeigen oder mit auswahl-guid wählen");
  assert.throws(() => auswahlErforderlich(null), /Keine Auswahl/);
  const k = auswahlKontext([wand]);
  assert.equal(auswahlErforderlich(k), k);
});

test("steckbriefKurz: ohne Steckbrief alles offen, mit Steckbrief Herkunft übernommen", () => {
  assert.equal(steckbriefKurz(null).status, null);
  const s = steckbriefKurz(wand.steckbrief);
  assert.equal(s.gewerk?.lb, "012");
  assert.equal(typeof s.tragend, "boolean");
  assert.ok(Array.isArray(s.offen));
});

test("ansichtAufBox: Ziel in der Mitte, Blickrichtung bleibt, Abstand wächst mit der Box, Punkt-Box hat Mindestradius", () => {
  const a = ansichtAufBox({ min: [0, 0, 0], max: [10, 4, 2] }, { richtung: [0, 0, 5], fovGrad: 50, aspekt: 1.5 });
  assert.deepEqual(a.ziel, [5, 2, 1]);
  assert.ok(Math.abs(a.position[0] - 5) < 1e-9 && Math.abs(a.position[1] - 2) < 1e-9, "Kamera bleibt auf der z-Achse durch das Ziel");
  assert.ok(a.position[2] > 1 && Math.abs(a.position[2] - 1 - a.abstand) < 1e-9);
  const gross = ansichtAufBox({ min: [0, 0, 0], max: [100, 40, 20] }, { richtung: [0, 0, 5] });
  assert.ok(gross.abstand > a.abstand * 5);
  const punkt = ansichtAufBox({ min: [1, 1, 1], max: [1, 1, 1] }, { richtung: [1, 0, 0] });
  assert.ok(punkt.abstand >= MIN_RADIUS_M / Math.sin((25 * Math.PI) / 180));
  // the box really fits: its bounding sphere subtends less than the field of view
  const halb = Math.asin(Math.hypot(10, 4, 2) / 2 / a.abstand);
  assert.ok(halb < (25 * Math.PI) / 180);
  assert.throws(() => ansichtAufBox({ min: [0, 0], max: [1, 1] }), /Box/);
  assert.throws(() => ansichtAufBox({ min: [0, 0, NaN], max: [1, 1, 1] }), /Box/);
  const ohneRichtung = ansichtAufBox({ min: [0, 0, 0], max: [1, 1, 1] }, { richtung: [0, 0, 0] });
  assert.ok(Number.isFinite(ohneRichtung.position[0]));
});

test("Befehlsgruppe: auswahl-lesen, auswahl-guid (unbekannt/leer), aufheben, ansicht ohne Auswahl, modell", () => {
  const reg = befehlsRegister();
  let kontext = auswahlKontext([]);
  const aufrufe = [];
  const entfernen = auswahlBefehleRegistrieren(reg, () => ({
    kontext: () => kontext,
    waehleGuid: (g) => (g === "A".repeat(22) ? (kontext = auswahlKontext([wand])) : null),
    aufheben: () => { kontext = auswahlKontext([]); aufrufe.push("aufheben"); },
    ansichtAufAuswahl: () => aufrufe.push("ansicht"),
    modell: (opt) => ({ anzahl: 1, klasse: opt.klasse ?? null }),
  }));
  assert.deepEqual(reg.alle().map((b) => b.id).sort(), ["ansicht-auf-auswahl", "ansicht-bild", "auswahl-aufheben", "auswahl-guid", "auswahl-lesen", "modell"]);
  assert.deepEqual(reg.ausfuehren("ansicht-auf-auswahl"), { ok: false, error: KEINE_AUSWAHL_TEXT });
  assert.deepEqual(aufrufe, [], "ohne Auswahl wird die Kamera nicht bewegt");
  assert.deepEqual(reg.ausfuehren("auswahl-guid", { guid: "x" }), { ok: false, error: "Bauteil nicht gefunden: x" });
  assert.deepEqual(reg.ausfuehren("auswahl-guid", {}), { ok: false, error: "guid fehlt" });
  assert.equal(reg.ausfuehren("auswahl-guid", { guid: "A".repeat(22) }).result.anzahl, 1);
  assert.equal(reg.ausfuehren("auswahl-lesen").result.bauteile[0].guid, "A".repeat(22));
  assert.deepEqual(reg.ausfuehren("ansicht-auf-auswahl"), { ok: true, result: { anzahl: 1 } });
  assert.deepEqual(reg.ausfuehren("auswahl-aufheben").result, { anzahl: 0, bauteile: [] });
  assert.equal(reg.ausfuehren("auswahl-lesen").result.anzahl, 0);
  assert.deepEqual(reg.ausfuehren("modell").result, { anzahl: 1, klasse: null });
  assert.deepEqual(reg.ausfuehren("modell", { klasse: "IfcWall" }).result, { anzahl: 1, klasse: "IfcWall" });
  entfernen();
  assert.equal(reg.alle().length, 0);
});

// ---- IFC viewer ----
/** Two elements in one merged mesh: eid 1 = triangle around the origin, eid 2 = triangle at x 10..12. */
const merged = {
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0, 10, 0, 0, 12, 0, 0, 10, 0, 6]),
  index: new Uint32Array([0, 1, 2, 3, 4, 5]),
  ranges: [{ eid: 1, start: 0, count: 3 }, { eid: 2, start: 3, count: 3 }],
};

test("elementBox: Box je Element, mehrere Elemente, ohne Geometrie null", () => {
  assert.deepEqual(elementBox(merged, [1]), { min: [0, 0, 0], max: [2, 4, 0] });
  assert.deepEqual(elementBox(merged, new Set([1, 2])), { min: [0, 0, 0], max: [12, 4, 6] });
  assert.equal(elementBox(merged, [99]), null);
  assert.equal(elementBox(null, [1]), null);
});

test("IFC: steckbriefAusIfc behält die GlobalId des Modells; Modellwerte gelten als gesetzt, Rest als abgeleitet", () => {
  const el = { expressId: 1, globalId: "nYqxeK5NUBtew1kQBTaHzk", ifcType: "IfcWall", name: "Aussenwand Sued", storey: "EG", status: "neubau", classification: { code: "331" }, material: "Beton" };
  const s = steckbriefAusIfc(el);
  assert.equal(s.guid, "nYqxeK5NUBtew1kQBTaHzk");
  assert.equal(s.kg, "331");
  assert.equal(s.quelle.kg, "gesetzt");
  assert.equal(s.status, "neubau");
  assert.equal(s.material, "Beton");
  assert.equal(s.quelle.material, "gesetzt");
  assert.equal(s.ifc.klasse, "IfcWall");
  assert.equal(s.quelle.typ, "abgeleitet", "der Bauteiltyp ist eine Annahme und wird so gekennzeichnet");
  // an element the model gives no status: "ohne Status", never invented
  assert.equal(steckbriefAusIfc({ ...el, status: "unbekannt" }).status, null);
  // class without a registry type: minimal sheet, undecided fields listed
  const fremd = steckbriefAusIfc({ globalId: "G".repeat(22), ifcType: "IfcMember", status: null });
  assert.equal(fremd.guid, "G".repeat(22));
  assert.ok(fremd.offen.includes("kg") && fremd.offen.includes("gewerk"));
  assert.equal(fremd.status, null);
});

test("IFC: ifcBauteil liefert Mittelpunkt aus der Geometrie; Kontext trägt GUID, Klasse, Name, Geschoss", () => {
  const el = { expressId: 2, globalId: "B".repeat(22), ifcType: "IfcSlab", name: "Decke", storey: "1. OG" };
  const b = ifcBauteil(el, 2, { merged });
  assert.deepEqual(b.mittelpunkt, [11, 0, 3]);
  const k = auswahlKontext([b]);
  assert.deepEqual([k.bauteile[0].guid, k.bauteile[0].klasse, k.bauteile[0].name, k.bauteile[0].geschoss], ["B".repeat(22), "IfcSlab", "Decke", "1. OG"]);
  const ohne = ifcBauteil(undefined, 1, { merged, guid: "C".repeat(22) });
  assert.equal(ohne.guid, "C".repeat(22));
  assert.equal(ohne.klasse, null);
});

test("IFC: ifcModellUebersicht zählt je Klasse, nennt Geschosse, kürzt sichtbar", () => {
  const model = { merged, storeys: ["EG", "1. OG"], elements: [
    { expressId: 1, globalId: "A".repeat(22), ifcType: "IfcWall", name: "w", storey: "EG" },
    { expressId: 2, globalId: "B".repeat(22), ifcType: "IfcWall", name: "w2", storey: "EG" },
    { expressId: 3, globalId: "C".repeat(22), ifcType: "IfcSpace", name: "ohne Geometrie" },
  ] };
  const u = ifcModellUebersicht(model);
  assert.deepEqual(u.klassen, { IfcWall: 2 });
  assert.equal(u.anzahl, 2);
  assert.equal(u.gekuerzt, false);
  assert.deepEqual(u.geschosse, ["EG", "1. OG"]);
  assert.equal(ifcModellUebersicht(model, { max: 1 }).gekuerzt, true);
  assert.equal(ifcModellUebersicht(model, { max: 1 }).bauteile.length, 1);
  const nurWaende = ifcModellUebersicht(model, { klasse: "ifcwall", max: 1 });
  assert.deepEqual(nurWaende.klassen, { IfcWall: 2 }, "die Zählung gilt weiter für das ganze Modell");
  assert.equal(nurWaende.bauteile.length, 1);
  assert.equal(nurWaende.gekuerzt, true);
  assert.deepEqual(ifcModellUebersicht(model, { klasse: "IfcSpace" }).bauteile, [], "ohne Geometrie nicht gelistet");
});

// ---- BIM studio ----
const bimModel = { storeys: [{ level: 0, name: "EG" }, { level: 1, name: "1. OG" }],
  walls: [{ a: { x: 0, z: 0 }, b: { x: 10, z: 0 }, height: 3, level: 0, edge: 0 }, { a: { x: 10, z: 0 }, b: { x: 10, z: 8 }, height: 3, level: 0, edge: 1 }] };
const daten = {
  model: bimModel, storeyHeight: 3,
  customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 1, height: 3, composite: "cavity", _idx: 1 }],
  customColumns: [{ x: 2, z: 3, level: 0, size: 0.4, _idx: 2 }],
  customZones: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], level: 0, name: "Flur", _idx: 3 }],
  customSlabs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, _idx: 4 }],
  customRoofs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, pitch: 2, _idx: 5 }],
  customWindows: [{ wallIdx: 1, u: 2, kind: "window", typeId: "double", _idx: 6 }],
  envOpenings: [{ level: 0, edge: 0, u: 3, kind: "door", typeId: "single", _idx: 7 }],
};

test("BIM: bimBauteil nimmt die GUID wie der IFC-Export (bauteilGuid / huellwandGuid), Geschossname, Mittelpunkt", () => {
  const opt = { projektId: "P1" };
  const w = bimBauteil({ type: "wall", index: 1 }, daten, opt);
  assert.equal(w.guid, bauteilGuid("P1", "customWalls", daten.customWalls[0]));
  assert.equal(w.klasse, "IfcWall");
  assert.equal(w.geschoss, "1. OG");
  assert.deepEqual(w.mittelpunkt, [20, 3 + 1.5, -16]);
  const h = bimBauteil({ type: "hullwall", level: 0, edge: 1 }, daten, opt);
  assert.equal(h.guid, huellwandGuid("P1", 0, 1));
  assert.equal(h.klasse, "IfcWall");
  assert.equal(bimBauteil({ type: "column", index: 2 }, daten, opt).klasse, "IfcColumn");
  const z = bimBauteil({ type: "zone", index: 3 }, daten, opt);
  assert.deepEqual([z.klasse, z.name], ["IfcSpace", "Flur"]);
  assert.deepEqual(z.mittelpunkt, [2, 1.5, 2]);
  assert.equal(bimBauteil({ type: "slab", index: 4 }, daten, opt).klasse, "IfcSlab");
  assert.equal(bimBauteil({ type: "roof", index: 5 }, daten, opt).klasse, "IfcRoof");
  assert.equal(bimBauteil({ type: "opening", index: 6, scope: "custom" }, daten, opt).klasse, "IfcWindow");
  assert.equal(bimBauteil({ type: "opening", index: 7, scope: "env" }, daten, opt).klasse, "IfcDoor");
});

test("BIM: unbekannter, fehlender oder GUID-loser Eintrag wird verweigert, nicht geraten", () => {
  assert.equal(bimBauteil({ type: "wall", index: 99 }, daten), null);
  assert.equal(bimBauteil({ type: "autowin", kind: "window", level: 0, edge: 0 }, daten), null);
  assert.equal(bimBauteil({ type: "hullwall", level: 9, edge: 0 }, daten), null);
  assert.equal(bimBauteil(null, daten), null);
});

test("BIM: bimPerGuid findet jedes Element über seine GUID, unbekannte GUID null; GUIDs sind eindeutig", () => {
  const opt = { projektId: "P1" };
  const alle = bimAlle(daten, opt);
  assert.equal(alle.length, 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
  assert.equal(new Set(alle.map((b) => b.guid)).size, alle.length, "jede GUID kommt genau einmal vor");
  for (const b of alle) assert.deepEqual(bimPerGuid(b.guid, daten, opt).sel, b.sel);
  assert.equal(bimPerGuid("0".repeat(22), daten, opt), null);
});

test("BIM: bimModellUebersicht zählt je Klasse und kürzt sichtbar", () => {
  const u = bimModellUebersicht(daten, { projektId: "P1" });
  assert.equal(u.klassen.IfcWall, 3);
  assert.deepEqual(u.geschosse, ["EG", "1. OG"]);
  assert.equal(u.anzahl, 9);
  assert.equal(u.gekuerzt, false);
  const kurz = bimModellUebersicht(daten, { projektId: "P1" }, { max: 3 });
  assert.equal(kurz.bauteile.length, 3);
  assert.equal(kurz.gekuerzt, true);
  const saeulen = bimModellUebersicht(daten, { projektId: "P1" }, { klasse: "IfcColumn" });
  assert.equal(saeulen.bauteile.length, 1);
  assert.equal(saeulen.gekuerzt, false);
  assert.equal(saeulen.klassen.IfcWall, 3, "die Zählung gilt weiter für das ganze Modell");
});

// ---- review fixes 106-02 ----
test("auswahlErforderlich: Auswahl ohne jede GUID wird verweigert (Leitplanke 3), mit einer GUID nicht", () => {
  const ohneGuid = auswahlKontext([{ guid: null, klasse: "IfcWall" }]);
  assert.equal(ohneGuid.anzahl, 1);
  assert.throws(() => auswahlErforderlich(ohneGuid), { message: KEIN_GUID_TEXT });
  // entries a viewer dropped because they have no GUID (generated openings): counted, anzahl 0 → also the GUID text, not "Keine Auswahl"
  const verworfen = auswahlKontext([], { verworfen: 1 });
  assert.deepEqual([verworfen.anzahl, verworfen.ohneGuid], [0, 1]);
  assert.throws(() => auswahlErforderlich(verworfen), { message: KEIN_GUID_TEXT });
  assert.throws(() => auswahlErforderlich(auswahlKontext([])), { message: KEINE_AUSWAHL_TEXT });
  const gemischt = auswahlKontext([{ guid: null }, wand]);
  assert.equal(auswahlErforderlich(gemischt), gemischt);
  assert.equal(gemischt.ohneGuid, 1);
});

test("auswahlKontext: grosse Mehrfachauswahl wird sichtbar gekürzt (anzahl = Gesamt, gekuerzt)", () => {
  const kopf = Array.from({ length: 3 }, (_, i) => ({ guid: String(i).repeat(22).slice(0, 22), klasse: "IfcWall" }));
  const k = auswahlKontext(kopf, { gesamt: 250 });
  assert.deepEqual([k.anzahl, k.gekuerzt, k.bauteile.length], [250, true, 3]);
  assert.equal(auswahlKontext(kopf).gekuerzt, false);
  assert.equal(auswahlKontext(kopf, { gesamt: 2 }).anzahl, 3, "gesamt kleiner als die Liste zählt nicht");
});

test("steckbriefKurz: menge, tragend, gewerkGrob tragen immer eine Herkunft", () => {
  const s = steckbriefKurz(steckbrief({ status: "neubau" }, "wand-aussen", { quelle: "t" }));
  assert.equal(s.label, "Außenwand");
  for (const f of ["menge", "tragend", "gewerkGrob"]) assert.ok(["abgeleitet", "offen"].includes(s.quelle[f]), `${f} hat eine Herkunft`);
  // a null value is listed as open
  const leer = steckbriefKurz({ typ: "x", menge: null, tragend: undefined, gewerkGrob: null, quelle: {}, offen: [] });
  assert.deepEqual([leer.quelle.menge, leer.quelle.tragend, leer.quelle.gewerkGrob], ["offen", "offen", "offen"]);
  assert.deepEqual(leer.offen.sort(), ["gewerkGrob", "menge", "tragend"]);
});

test("IFC: steckbriefAusIfc erfindet keine Menge und kein 'tragend'; Menge kommt aus den Modell-Mengen", () => {
  const wandEl = { expressId: 1, globalId: "W".repeat(22), ifcType: "IfcWall", name: "Innenwand", mengen: { area: 12.5, volume: 3 } };
  const w = steckbriefAusIfc(wandEl);
  assert.deepEqual(w.menge, { wert: 12.5, einheit: "m2" }, "Fläche aus den Modell-Mengen");
  assert.equal(w.quelle.menge, "gesetzt");
  assert.equal(w.tragend, null, "aus dem geratenen Typ wird nichts über die Tragfähigkeit behauptet");
  assert.equal(w.gewerkGrob, null);
  assert.deepEqual([w.quelle.tragend, w.quelle.gewerkGrob], ["offen", "offen"]);
  assert.ok(w.offen.includes("tragend") && w.offen.includes("gewerkGrob"));
  const kurz = steckbriefKurz(w);
  assert.deepEqual([kurz.menge, kurz.tragend, kurz.gewerkGrob], [{ wert: 12.5, einheit: "m2" }, null, null]);
  // the model states no quantity: null and open, never "0 m2"
  const ohneMenge = steckbriefAusIfc({ ...wandEl, mengen: {} });
  assert.equal(ohneMenge.menge, null);
  assert.equal(ohneMenge.quelle.menge, "offen");
  // a door is one piece, marked as derived
  const tuer = steckbriefAusIfc({ expressId: 2, globalId: "D".repeat(22), ifcType: "IfcDoor", mengen: {} });
  assert.deepEqual(tuer.menge, { wert: 1, einheit: "Stk" });
  assert.equal(tuer.quelle.menge, "abgeleitet");
  // a slab: area of the model, a beam: length of the model
  assert.deepEqual(steckbriefAusIfc({ globalId: "S".repeat(22), ifcType: "IfcSlab", mengen: { area: 40 } }).menge, { wert: 40, einheit: "m2" });
  assert.deepEqual(steckbriefAusIfc({ globalId: "B".repeat(22), ifcType: "IfcBeam", mengen: { length: 6.5 } }).menge, { wert: 6.5, einheit: "m" });
});

test("IFC: ifcAuswahlKontext — Mehrfachauswahl als Liste, über 200 gekürzt mit Gesamtzahl; Element ohne GlobalId zählt als ohneGuid", () => {
  const elemente = Array.from({ length: 250 }, (_, i) => ({ expressId: 100 + i, globalId: i === 3 ? "" : String(i).padStart(22, "x"), ifcType: "IfcWall", name: `W${i}`, storey: "EG" }));
  const model = { merged, elements: elemente, guidByExpressId: new Map() };
  const klein = ifcAuswahlKontext([100, 101, 102], model);
  assert.deepEqual([klein.anzahl, klein.gekuerzt, klein.bauteile.map((b) => b.name)], [3, false, ["W0", "W1", "W2"]]);
  const gross = ifcAuswahlKontext(elemente.map((e) => e.expressId), model);
  assert.equal(AUSWAHL_KONTEXT_MAX, 200);
  assert.deepEqual([gross.anzahl, gross.gekuerzt, gross.bauteile.length], [250, true, 200]);
  assert.equal(gross.ohneGuid, 1, "W3 hat keine GlobalId");
  const nurOhne = ifcAuswahlKontext([103], model);
  assert.equal(nurOhne.bauteile[0].guid, null);
  assert.throws(() => auswahlErforderlich(nurOhne), { message: KEIN_GUID_TEXT });
});

test("BIM: Name und Typ-Label für jedes Bauteil; Hüllwand mit Menge und Aufbau wie im Export", () => {
  const opt = { projektId: "P1" };
  assert.equal(bimBauteil({ type: "wall", index: 1 }, daten, opt).name, "Außenwand", "gezeichnete Wand nach Aufbau cavity");
  assert.equal(bimBauteil({ type: "column", index: 2 }, daten, opt).name, "Stütze");
  assert.equal(bimBauteil({ type: "zone", index: 3 }, daten, opt).name, "Flur", "eigener Name vor Typ-Label");
  assert.equal(bimBauteil({ type: "slab", index: 4 }, daten, opt).name, "Decke");
  for (const sel of [{ type: "roof", index: 5 }, { type: "opening", index: 6, scope: "custom" }, { type: "opening", index: 7, scope: "env" }, { type: "hullwall", level: 0, edge: 0 }]) {
    assert.ok(bimBauteil(sel, daten, opt).name.length > 0, `${sel.type} hat einen Namen`);
  }
  assert.equal(steckbriefKurz(bimBauteil({ type: "wall", index: 1 }, daten, opt).steckbrief).label, "Außenwand");
  // hull wall of the generated model: 10 m x 3 m = 30 m2 (the export builds it from the same wall), build-up from the model
  const model = createBuildingModel({ footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }], storeys: 2, storeyHeight: 3, wallComposite: "cavity" });
  const h = bimBauteil({ type: "hullwall", level: 0, edge: 0 }, { model, storeyHeight: 3 }, opt);
  assert.deepEqual(h.steckbrief.menge, { wert: 30, einheit: "m2" });
  assert.ok(h.steckbrief.material, "Aufbau (Material) aus dem Hüllwand-Aufbau des Modells");
  assert.equal(h.guid, huellwandGuid("P1", 0, 0));
  // the table's decisions for the hull lie over it
  const mitStatus = bimBauteil({ type: "hullwall", level: 0, edge: 0 }, { model, storeyHeight: 3, huelleAttribute: { status: "bestand", kg: "331" } }, opt);
  assert.equal(mitStatus.steckbrief.status, "bestand");
  assert.equal(mitStatus.steckbrief.kg, "331");
});

test("BIM: Hüllplatten sind gelistet (GUID wie im Export), aber nicht per Befehl wählbar; Auto-Öffnungen zählen als ohneGuid", () => {
  const model = createBuildingModel({ footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }], storeys: 2, storeyHeight: 3 });
  const d = { model, storeyHeight: 3 };
  const alle = bimAlle(d, { projektId: "P1" });
  const platten = alle.filter((b) => b.sel.type === "hullslab");
  assert.equal(platten.length, model.slabs.length, "Bodenplatte + je Geschoss eine Decke");
  assert.ok(platten.every((b) => b.klasse === "IfcSlab" && b.waehlbar === false));
  assert.equal(platten[0].steckbrief.typ, "bodenplatte");
  assert.equal(platten[1].steckbrief.typ, "decke");
  assert.ok(alle.filter((b) => b.sel.type === "hullwall").every((b) => b.waehlbar === true));
  const uebersicht = bimModellUebersicht(d, { projektId: "P1" });
  assert.equal(uebersicht.klassen.IfcSlab, model.slabs.length, "die Übersicht zählt die Hüllplatten mit");
  assert.ok(uebersicht.bauteile.filter((b) => b.klasse === "IfcSlab").every((b) => b.waehlbar === false));
  const k = bimAuswahlKontext([{ type: "autowin", kind: "window", level: 0, edge: 0 }], d, { projektId: "P1" });
  assert.deepEqual([k.anzahl, k.ohneGuid], [0, 1]);
  assert.throws(() => auswahlErforderlich(k), { message: KEIN_GUID_TEXT });
});

test("BIM: bimAuswahlKontext — Mehrfachauswahl, über 200 gekürzt mit Gesamtzahl", () => {
  const spalten = Array.from({ length: 205 }, (_, i) => ({ x: i, z: 0, level: 0, size: 0.4, _idx: i + 1 }));
  const d = { model: bimModel, storeyHeight: 3, customColumns: spalten };
  const klein = bimAuswahlKontext(spalten.slice(0, 3).map((c) => ({ type: "column", index: c._idx })), d, { projektId: "P1" });
  assert.deepEqual([klein.anzahl, klein.gekuerzt, klein.ohneGuid, klein.bauteile.length], [3, false, 0, 3]);
  const gross = bimAuswahlKontext(spalten.map((c) => ({ type: "column", index: c._idx })), d, { projektId: "P1" });
  assert.deepEqual([gross.anzahl, gross.gekuerzt, gross.bauteile.length], [205, true, 200]);
  // an entry that no longer exists is not guessed: counted as ohneGuid
  assert.equal(bimAuswahlKontext([{ type: "column", index: 1 }, { type: "column", index: 9999 }], d).ohneGuid, 1);
});

test("BIM: GUID wie im echten IFC-Export — jede GlobalId der Datei (Wand, Stütze, Zone, Decke, Dach, Fenster, Tür) steht in bimAlle und umgekehrt", () => {
  const footprintM = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }];
  const model = createBuildingModel({ footprintM, storeys: 2, storeyHeight: 3, wallComposite: "cavity" });
  const d = {
    model, storeyHeight: 3,
    customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 1, height: 3, composite: "cavity", _idx: 1 }, { a: { x: 0, z: 2 }, b: { x: 4, z: 2 }, level: 0, thickness: 0.115, _idx: 8 }],
    customColumns: [{ x: 2, z: 3, level: 0, size: 0.4, _idx: 2 }],
    customZones: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], level: 0, name: "Flur", _idx: 3 }],
    customSlabs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, _idx: 4 }],
    customRoofs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, pitch: 2, _idx: 5 }],
    customWindows: [{ wallIdx: 1, u: 6, kind: "window", typeId: "double", _idx: 6 }],
    envOpenings: [{ level: 0, edge: 0, u: 5, kind: "door", typeId: "single", _idx: 7 }],
  };
  const ifc = exportIFC(model, { ...d, steckbrief: { projektId: "P1" } });
  /** GlobalId (first attribute) per element row of the file: #n=IFCWALL('guid', ... */
  const imExport = new Map();
  for (const m of ifc.matchAll(/^#\d+=(IFC(?:WALL|COLUMN|SPACE|SLAB|ROOF|WINDOW|DOOR))\('([^']{22})'/gm)) imExport.set(m[2], m[1]);
  const alle = bimAlle(d, { projektId: "P1" });
  assert.ok(alle.length >= 10);
  for (const b of alle) assert.equal(imExport.get(b.guid), b.klasse.toUpperCase(), `${b.sel.type} ${JSON.stringify(b.sel)}: GlobalId und Klasse stehen so in der IFC-Datei`);
  // the other direction: every wall, column, slab, roof, window and door of the file is in the studio list (spaces: the model's own are generated)
  const imStudio = new Set(alle.map((b) => b.guid));
  for (const [g, klasse] of imExport) if (klasse !== "IFCSPACE") assert.ok(imStudio.has(g), `${klasse} ${g} fehlt in bimAlle`);
});
