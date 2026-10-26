// 106-03: change functions (property, move/rotate/scale, split), the check before takeover, the proposal with its
// origin record and the way back. Pure functions, no browser. Target of "dieses" is always a GUID.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eigenschaftSetzen, transformieren, vorschlagErzeugen, herkunftEintrag, aenderungUmkehren, modellMitAenderung, bauteilImModell,
  satzAusVorlage, SATZ_VORLAGEN, HERKUNFT_QUELLEN, zahlText,
} from "@core/lib/zeigen/aenderungen.js";
import { wandTeilen, deckeTeilen } from "@core/lib/zeigen/teilen.js";
import { pruefeAenderung } from "@core/lib/zeigen/pruefung.js";
import { vorschlagVorbereiten, vorschlagAusfuehren, zielAusAuswahl, MEHRERE_AUSWAHL_TEXT } from "@core/lib/zeigen/vorschlag.js";
import { KEINE_AUSWAHL_TEXT } from "@core/lib/zeigen/auswahlKontext.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { eintragBauen } from "@ifc/lib/attributJournal.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";
import { EN } from "@core/lib/i18nTeile/aenderungen-106.js";

const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);
const hand = { quelle: "hand" };
const nah = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// ---------------------------------------------------------------- eigenschaftSetzen

test("eigenschaftSetzen: gezeichnete Wand, vorher/nachher, Eingabe bleibt unverändert", () => {
  const w = wand(12, { feuerwiderstand: "F30" });
  const r = eigenschaftSetzen(w, { pset: "Pset_WallCommon", name: "FireRating", wert: "f 90" });
  assert.equal(r.vorher, "F30");
  assert.equal(r.nachher, "F90");
  assert.equal(r.label, "Feuerwiderstand");
  assert.equal(r.bauteil.feuerwiderstand, "F90");
  assert.equal(w.feuerwiderstand, "F30", "Original unverändert");
  assert.notEqual(r.bauteil, w);
});

test("eigenschaftSetzen: leerer Wert entfernt das Feld, falsche Werte und unbekannte Namen werfen deutschen Text", () => {
  const w = wand(1, { kg: "331" });
  assert.equal("kg" in eigenschaftSetzen(w, { name: "KG", wert: "" }).bauteil, false);
  assert.throws(() => eigenschaftSetzen(w, { name: "kg", wert: "abc" }), /keine Kostengruppe/);
  assert.throws(() => eigenschaftSetzen(w, { name: "status", wert: "halbfertig" }), /kein Status/);
  assert.throws(() => eigenschaftSetzen(w, { name: "Farbe", wert: "rot" }), /gibt es an gezeichneten Bauteilen nicht/);
  assert.throws(() => eigenschaftSetzen(w, { name: "kg", wert: "331" }), /Keine Änderung/);
  assert.equal(eigenschaftSetzen(w, { name: "Status", wert: "Abbruch" }).nachher, "abbruch");
});

test("eigenschaftSetzen: abgeleiteter Wert wird als vorher angezeigt und als abgeleitet markiert", () => {
  const r = eigenschaftSetzen(wand(1), { name: "kg", wert: "341" }, { abgeleitet: { kg: "331" } });
  assert.equal(r.vorher, "331");
  assert.equal(r.vorherQuelle, "abgeleitet");
});

test("eigenschaftSetzen: IFC-Bauteil liefert Journal-Eintrag in der Form von eintragBauen, Datei-Daten bleiben gleich", () => {
  const psets = { Pset_WallCommon: { FireRating: "F30", LoadBearing: true } };
  const ifc = { quelle: "ifc", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", psets, project_id: "p1" };
  const kopie = JSON.stringify(ifc);
  const zeit = "2026-10-24T10:00:00.000Z";
  const r = eigenschaftSetzen(ifc, { pset: "pset_wallcommon", name: "firerating", wert: "F90" }, { zeit });
  assert.equal(JSON.stringify(ifc), kopie, "Bauteil unverändert");
  assert.equal(r.bauteil, ifc);
  assert.deepEqual(r.journal, eintragBauen({ projectId: "p1", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", pset: "Pset_WallCommon", eigenschaft: "FireRating", alt: "F30", wert: "F90", zeit }));
  // typed like the current value: boolean stays boolean
  assert.equal(eigenschaftSetzen(ifc, { pset: "Pset_WallCommon", name: "LoadBearing", wert: "nein" }).journal.wert, false);
  // the journal overlay counts as the current value
  const eintraege = [{ modell: "rohbau.ifc", guid: ifc.guid, pset: "Pset_WallCommon", eigenschaft: "FireRating", wert: "F90", zeit: "2026-10-24T09:00:00.000Z" }];
  assert.throws(() => eigenschaftSetzen(ifc, { pset: "Pset_WallCommon", name: "FireRating", wert: "F90" }, { eintraege }), /Keine Änderung/);
  assert.throws(() => eigenschaftSetzen({ ...ifc, guid: "" }, { pset: "P", name: "x", wert: "1" }), /guid fehlt/);
});

// ---------------------------------------------------------------- transformieren

test("transformieren: verschieben in m, Original unverändert, Rundung 1e-6 m", () => {
  const w = wand(1);
  const n = transformieren(w, { verschiebung_m: [1.5, 0, -2] });
  assert.deepEqual(n.a, { x: 1.5, z: 8 });
  assert.deepEqual(n.b, { x: 7.5, z: 8 });
  assert.deepEqual(w.a, { x: 0, z: 10 });
  assert.equal(n.thickness, 0.24);
});

test("transformieren: drehen gegen den Uhrzeiger wie im Grundriss gesehen, um die Wandmitte", () => {
  const n = transformieren({ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, _idx: 1 }, { drehung_grad: 90 });
  // b lay east of the centre (3|0): counter-clockwise on the sheet moves it north = z decreases
  assert.deepEqual(n.b, { x: 3, z: -3 });
  assert.deepEqual(n.a, { x: 3, z: 3 });
  const um = transformieren({ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, _idx: 1 }, { drehung_grad: 180, zentrum: { x: 0, z: 0 } });
  assert.deepEqual(um.b, { x: -6, z: 0 });
});

test("transformieren: skalieren ändert die Plan-Länge, nicht Dicke und Höhe; Stütze, Fläche, Geschoss", () => {
  const n = transformieren(wand(1), { faktor: 2 });
  assert.deepEqual([n.a.x, n.b.x], [-3, 9]);
  assert.equal(n.height, 3);
  assert.equal(n.thickness, 0.24);
  const s = transformieren({ x: 1, z: 1, size: 0.4, level: 0, _idx: 2 }, { verschiebung_m: [1, 0, 0], faktor: 1.5, zentrum: { x: 0, z: 0 } });
  assert.deepEqual([s.x, s.z, s.size], [2.5, 1.5, 0.6]);
  const f = transformieren({ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 0, z: 2 }], level: 0, _idx: 3 }, { verschiebung_m: [0, 0, 1] });
  assert.deepEqual(f.points[0], { x: 0, z: 1 });
  const oben = transformieren(wand(1), { verschiebung_m: [0, 3, 0] }, { geschosshoehe_m: 3 });
  assert.equal(oben.level, 1);
});

test("transformieren: Unmögliches wirft deutschen Text", () => {
  assert.throws(() => transformieren(wand(1), {}), /nichts angegeben/);
  assert.throws(() => transformieren(wand(1), { faktor: 0 }), /größer als 0/);
  assert.throws(() => transformieren(wand(1), { faktor: -2 }), /größer als 0/);
  assert.throws(() => transformieren(wand(1), { verschiebung_m: [0, 1, 0] }, { geschosshoehe_m: 3 }), /ganzen Geschossen/);
  assert.throws(() => transformieren(wand(1), { verschiebung_m: [0, 1, 0] }), /Geschosshöhe/);
  assert.throws(() => transformieren(wand(1), { verschiebung_m: [0, -3, 0] }, { geschosshoehe_m: 3 }), /untersten Geschoss/);
  assert.throws(() => transformieren({ wallIdx: 1, u: 2, kind: "window" }, { verschiebung_m: [1, 0, 0] }), /wandern mit ihrer Wand/);
  assert.throws(() => transformieren({ x: 1, z: 1, size: 0.4 }, { drehung_grad: 45 }), /ändert sich nichts/);
  assert.throws(() => transformieren(wand(1), { verschiebung_m: [0, 0, 0] }), /Keine Änderung/);
});

// ---------------------------------------------------------------- wandTeilen

const fenster = (idx, u, wallIdx = 1, extra = {}) => ({ wallIdx, u, typeId: "single", kind: "window", _idx: idx, ...extra }); // 1.0 m wide
const laenge = (w) => Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);

test("wandTeilen: Längen addieren sich, neue verschiedene GUIDs, Öffnungen nach ihrer Mitte verteilt", () => {
  const w = wand(1);
  const o = [fenster(5, 1.5), fenster(6, 4.5), fenster(7, 2, 99)]; // the last one belongs to another wall
  const r = wandTeilen(w, { x: 3, z: 10.4 }, { naechsteIdx: 20, projektId: P, oeffnungen: o });
  const [A, B] = r.teile;
  nah(laenge(A) + laenge(B), 6);
  assert.deepEqual(r.laengen_m, [3, 3]);
  assert.deepEqual(r.schnitt, { x: 3, z: 10 }, "Punkt wird auf die Achse projiziert");
  assert.deepEqual(A.b, B.a);
  assert.equal(A._idx, 1);
  assert.equal(B._idx, 20);
  assert.equal(A.thickness, 0.24, "Aufbau/Dicke werden kopiert");
  assert.equal(A.guid.length, 22);
  assert.equal(B.guid.length, 22);
  assert.notEqual(A.guid, B.guid);
  assert.notEqual(A.guid, r.guidAlt);
  assert.notEqual(B.guid, r.guidAlt);
  assert.equal(r.guidAlt, guidW(w));
  assert.equal(r.oeffnungen.length, 2, "nur Öffnungen dieser Wand");
  const [oa, ob] = r.oeffnungen;
  assert.deepEqual([oa.wallIdx, oa.u], [1, 1.5]);
  assert.deepEqual([ob.wallIdx, ob.u], [20, 1.5], "u des zweiten Teils um die Länge von A verkürzt");
  assert.equal(ob.guid, bauteilGuid(P, "oeffnung|cw:1|window|6", { _idx: 6 }), "GUID der Öffnung bleibt trotz neuer Wand");
  assert.equal(r.warnungen.length, 0);
  assert.deepEqual(w.b, { x: 6, z: 10 }, "Original unverändert");
});

test("wandTeilen: Öffnung über der Schnittstelle bleibt beim Teil mit ihrer Mitte und warnt", () => {
  const r = wandTeilen(wand(1), { x: 3, z: 10 }, { naechsteIdx: 20, projektId: P, oeffnungen: [fenster(5, 2.8), fenster(6, 3.2)] });
  assert.equal(r.warnungen.length, 2);
  assert.match(r.warnungen[0], /Fenster 5 ragt 30 cm über die Teilungsstelle — bleibt an Teil A/);
  assert.match(r.warnungen[1], /Fenster 6 ragt 30 cm .* Teil B/);
  assert.equal(r.oeffnungen[0].wallIdx, 1);
  assert.equal(r.oeffnungen[1].wallIdx, 20);
  nah(r.oeffnungen[1].u, 0.2);
});

test("wandTeilen: ungültiger Punkt wirft deutschen Text", () => {
  const o = { naechsteIdx: 20, projektId: P };
  assert.throws(() => wandTeilen(wand(1), { x: 7, z: 0 }, o), /außerhalb der Wand/);
  assert.throws(() => wandTeilen(wand(1), { x: -0.5, z: 0 }, o), /außerhalb der Wand/);
  assert.throws(() => wandTeilen(wand(1), { x: 0.005, z: 0 }, o), /Wandende/);
  assert.throws(() => wandTeilen(wand(1), { x: 5.995, z: 0 }, o), /Wandende/);
  assert.throws(() => wandTeilen(wand(1), { x: 3, z: 0 }, { projektId: P }), /freie Element-Nummer/);
  assert.throws(() => wandTeilen({ a: { x: 0, z: 0 }, b: { x: 0.01, z: 0 } }, { x: 0, z: 0 }, o), /zu kurz/);
  assert.doesNotThrow(() => wandTeilen(wand(1), { x: 0.011, z: 0 }, o));
});

// ---------------------------------------------------------------- deckeTeilen

const flaeche = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i].x * q.z - q.x * p[i].z; } return Math.abs(s / 2); };
const quadrat = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], level: 0, _idx: 3, status: "neubau" };

test("deckeTeilen: Quadrat entlang x = 1, Flächen addieren sich, neue GUIDs, Felder kopiert", () => {
  const r = deckeTeilen(quadrat, { a: { x: 1, z: -1 }, b: { x: 1, z: 5 } }, { naechsteIdx: 9, projektId: P });
  const [A, B] = r.teile;
  nah(flaeche(A.points) + flaeche(B.points), 16);
  assert.deepEqual([...r.flaechen_m2].sort((x, y) => x - y), [4, 12]);
  assert.equal(A._idx, 3);
  assert.equal(B._idx, 9);
  assert.notEqual(A.guid, B.guid);
  assert.equal(A.status, "neubau");
  assert.equal(r.schnittpunkte.length, 2);
  // A is left of the direction a -> b (z down): direction is +z, left of it is +x ... checked by the area of the part
  assert.equal(quadrat.points.length, 4, "Original unverändert");
});

test("deckeTeilen: L-Form (konkav), Linie durch eine Ecke, Fehlerfälle", () => {
  const l = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }], level: 0, _idx: 1 };
  const r = deckeTeilen(l, { a: { x: 1, z: -1 }, b: { x: 1, z: 6 } }, { naechsteIdx: 2 });
  nah(r.flaechen_m2[0] + r.flaechen_m2[1], 12);
  const diag = deckeTeilen(quadrat, { a: { x: 0, z: 0 }, b: { x: 4, z: 4 } }, { naechsteIdx: 2 });
  assert.deepEqual(diag.flaechen_m2, [8, 8], "Diagonale durch zwei Ecken");
  assert.throws(() => deckeTeilen(quadrat, { a: { x: 9, z: 0 }, b: { x: 9, z: 5 } }, { naechsteIdx: 2 }), /schneidet die Decke nicht/);
  assert.throws(() => deckeTeilen(quadrat, { a: { x: 0, z: 0 }, b: { x: 0, z: 4 } }, { naechsteIdx: 2 }), /entlang einer Kante/);
  // a line across the notch of the L cuts the outline four times
  assert.throws(() => deckeTeilen(l, { a: { x: 0, z: 3.5 }, b: { x: 4, z: 1.5 } }, { naechsteIdx: 2 }), /Stellen — Teilen geht nur bei genau 2/);
  assert.throws(() => deckeTeilen(quadrat, { a: { x: 0.001, z: -1 }, b: { x: 0.001, z: 5 } }, { naechsteIdx: 2 }), /nur .* m² groß/);
  assert.throws(() => deckeTeilen(quadrat, { a: { x: 1, z: 0 }, b: { x: 1, z: 4 } }, {}), /freie Element-Nummer/);
});

// ---------------------------------------------------------------- Vorschlag und Herkunft

test("vorschlagErzeugen: Satz in Worten, Herkunft Pflicht, Bestätigung immer erforderlich", () => {
  const ziel = { guid: "G".repeat(22), klasse: "IfcWall", name: "Wand W-12" };
  const v = vorschlagErzeugen({ art: "eigenschaft", ziel, params: { name: "Feuerwiderstand", wert: "F90" }, herkunft: { quelle: "agent", befehl_text: "mach die Wand F90" },
    vorher: { wert: "F30" }, nachher: { label: "Feuerwiderstand", wert: "F90" } }, { id: "abc12345", zeit: "2026-10-24T10:00:00.000Z" });
  assert.equal(v.satz, "Wand W-12: Feuerwiderstand F30 → F90");
  assert.equal(v.id, "abc12345");
  assert.equal(v.bestaetigung, "erforderlich");
  assert.deepEqual(v.herkunft, { quelle: "agent", quellen: ["agent"], befehl_text: "mach die Wand F90" });
  assert.equal(v.pruefung, null);
  assert.equal(v.satz_vorlage, SATZ_VORLAGEN.eigenschaft);
  assert.equal(v.satz, satzAusVorlage(v.satz_vorlage, v.satz_werte));
  assert.equal(vorschlagErzeugen({ art: "eigenschaft", ziel, params: {}, herkunft: hand, vorher: { wert: null }, nachher: { label: "Status", wert: "neubau" } }).satz, "Wand W-12: Status leer → neubau");
  assert.equal(vorschlagErzeugen({ art: "transformieren", ziel, params: { verschiebung_m: [1.5, 0, -2], drehung_grad: 90, faktor: 1.1 }, herkunft: hand, vorher: {}, nachher: {} }).satz,
    "Wand W-12: um 1,5 m in x und -2 m in z verschieben, um 90° drehen, auf 110 % skalieren");
  assert.equal(vorschlagErzeugen({ art: "teilen", ziel, params: {}, herkunft: hand, vorher: {}, nachher: { t_m: 3.25, teile: [{ laenge_m: 3.25 }, { laenge_m: 2.75 }] } }).satz, "Wand W-12: bei 3,25 m teilen → 3,25 m + 2,75 m");
  assert.throws(() => vorschlagErzeugen({ art: "eigenschaft", ziel, params: {}, vorher: {}, nachher: {} }), /Herkunft fehlt/);
  assert.throws(() => vorschlagErzeugen({ art: "eigenschaft", ziel, params: {}, herkunft: { quelle: "orakel" }, vorher: {}, nachher: {} }), /unbekannte Herkunft/);
  assert.throws(() => vorschlagErzeugen({ art: "eigenschaft", ziel: { klasse: "IfcWall" }, params: {}, herkunft: hand, vorher: {}, nachher: {} }), /GUID/);
  assert.deepEqual([...HERKUNFT_QUELLEN], ["hand", "text", "sprache", "agent", "bild"]);
});

test("vorschlagErzeugen: Übersetzer ersetzt die Vorlage, Platzhalter bleiben", () => {
  const ziel = { guid: "G".repeat(22), name: "Wall W-1" };
  const t = (s) => EN[s] ?? s;
  const v = vorschlagErzeugen({ art: "transformieren", ziel, params: { drehung_grad: 45 }, herkunft: hand, vorher: {}, nachher: {} }, { t });
  assert.equal(v.satz, "Wall W-1: rotate by 45°");
  for (const vorlage of Object.values(SATZ_VORLAGEN)) assert.ok(vorlage in EN, `EN fehlt: ${vorlage}`);
});

test("herkunftEintrag: Herkunft, Befehlstext, Zeit, vorher/nachher, Vorschlags-Id", () => {
  const ziel = { guid: "G".repeat(22), name: "Wand W-12" };
  const v = vorschlagErzeugen({ art: "eigenschaft", ziel, params: { name: "kg", wert: "341" }, herkunft: { quelle: "sprache", befehl_text: "Kostengruppe 341" },
    vorher: { wert: "331" }, nachher: { label: "Kostengruppe", wert: "341" } }, { id: "id000001" });
  const e = herkunftEintrag(v, { zeit: "2026-10-24T11:00:00.000Z" });
  assert.equal(e.herkunft, "sprache");
  assert.equal(e.befehl_text, "Kostengruppe 341");
  assert.equal(e.zeit, "2026-10-24T11:00:00.000Z");
  assert.deepEqual(e.vorher, { wert: "331" });
  assert.deepEqual(e.nachher, { label: "Kostengruppe", wert: "341" });
  assert.equal(e.vorschlag_id, "id000001");
  assert.throws(() => herkunftEintrag({}), /ohne Id oder Herkunft/);
});

// ---------------------------------------------------------------- Prüfung

const modellMit = (extra = {}) => ({
  customWalls: [wand(1, { bauteil_typ: "wand-tragend", tragend: true }), wand(2, { kg: "341" }), wand(3, { bauteil_typ: "wand-innen" })],
  customColumns: [], customWindows: [], envOpenings: [], customZones: [], customSlabs: [], customRoofs: [], ...extra,
});
const vs = (modell, idx, art, params, opt = {}) => ({ art, ziel: { guid: guidW(modell.customWalls.find((w) => w._idx === idx)), ...opt }, params });

test("pruefeAenderung: Abbruch einer tragenden Wand ohne Statik-Vermerk ist ein Fehler, mit Vermerk nicht", () => {
  const m = modellMit();
  const r = pruefeAenderung(m, vs(m, 1, "eigenschaft", { name: "status", wert: "abbruch" }), { projektId: P });
  assert.equal(r.stufe, "fehler");
  assert.match(r.saetze[0], /^Gesperrt: Abbruch tragender Bauteile ohne Vermerk/);
  assert.equal(r.befunde[0].code, "abbruch_tragend");
  assert.equal(r.geprueft.regeln, true);
  // with the note set the same change passes
  const m2 = modellMit({ customWalls: [wand(1, { bauteil_typ: "wand-tragend", tragend: true, statik_vermerk: "Abfangung mit Stahlträger, Statik liegt vor" }), wand(2)] });
  const r2 = pruefeAenderung(m2, vs(m2, 1, "eigenschaft", { name: "status", wert: "abbruch" }), { projektId: P });
  assert.notEqual(r2.stufe, "fehler");
  // a non-load-bearing wall may go
  const r3 = pruefeAenderung(m, vs(m, 3, "eigenschaft", { name: "status", wert: "abbruch" }), { projektId: P });
  assert.notEqual(r3.stufe, "fehler");
});

test("pruefeAenderung: tragend setzen in einer Wand mit Durchbruch ohne Statik ist ein Fehler; Bestehendes zählt nicht", () => {
  const m = modellMit();
  const g2 = guidW(m.customWalls[2]);
  const durchbrueche = [{ nr: "D-1", bauteil_guid: g2, feuerwiderstand: "EI 90", abschottung: "", status: "geplant" }];
  const r = pruefeAenderung(m, vs(m, 3, "eigenschaft", { name: "tragend", wert: "ja" }), { projektId: P, durchbrueche });
  assert.equal(r.stufe, "fehler");
  assert.ok(r.befunde.some((b) => b.code === "durchbruch_tragend_ohne_statik" && b.stufe === "fehler"));
  // the missing fire stop (rule 8) exists independent of the change: not reported as caused by it
  assert.ok(!r.befunde.some((b) => b.code === "schott_fehlt"));
});

test("pruefeAenderung: harmlose Änderung ist ok und sagt, was geprüft wurde", () => {
  const m = modellMit();
  const r = pruefeAenderung(m, vs(m, 2, "eigenschaft", { name: "kg", wert: "342" }), { projektId: P });
  assert.equal(r.stufe, "ok");
  assert.equal(r.saetze.length, 1);
  assert.match(r.saetze[0], /Keine Auffälligkeit gefunden \(Prüfregeln\)/);
  assert.deepEqual(r.geprueft, { regeln: true, attribute: false, kollision: false });
});

test("pruefeAenderung: geometrisch Unmögliches ist ein Fehler mit der Ursache als Satz", () => {
  const m = modellMit();
  const r = pruefeAenderung(m, vs(m, 1, "teilen", { punkt_m: { x: 9, z: 10 } }), { projektId: P });
  assert.equal(r.stufe, "fehler");
  assert.match(r.saetze[0], /außerhalb der Wand/);
  const r2 = pruefeAenderung(m, vs(m, 1, "transformieren", { faktor: 0 }), { projektId: P });
  assert.equal(r2.stufe, "fehler");
  const r3 = pruefeAenderung(m, { art: "eigenschaft", ziel: { guid: "X".repeat(22) }, params: { name: "kg", wert: "1" } }, { projektId: P });
  assert.equal(r3.stufe, "fehler");
  assert.match(r3.saetze[0], /Bauteil nicht gefunden/);
});

test("pruefeAenderung: neue Überschneidung im Umkreis warnt, bestehende Eckverbindung nicht", () => {
  // wall 1 runs z = 0, wall 2 runs z = 10; moving wall 1 by 10 m in z puts it onto wall 2
  const m = modellMit();
  const r = pruefeAenderung(m, vs(m, 1, "transformieren", { verschiebung_m: [0, 0, 10] }), { projektId: P });
  assert.equal(r.stufe, "warn");
  assert.equal(r.geprueft.kollision, true);
  assert.match(r.saetze.join("|"), /Überschneidet Wand W-2/);
  // moving it along the free side is fine
  const frei = pruefeAenderung(m, vs(m, 1, "transformieren", { verschiebung_m: [0, 0, -5] }), { projektId: P });
  assert.equal(frei.stufe, "ok");
  // an existing T-joint (touching before and after) is not reported when the wall only slides along its own axis
  const t = { customWalls: [{ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.3, _idx: 1 }, { a: { x: 3, z: 0 }, b: { x: 3, z: 4 }, level: 0, thickness: 0.3, _idx: 2 }] };
  const gleiten = pruefeAenderung(t, { art: "transformieren", ziel: { guid: bauteilGuid(P, "customWalls", t.customWalls[0]) }, params: { verschiebung_m: [0.5, 0, 0] } }, { projektId: P });
  assert.equal(gleiten.stufe, "ok");
});

test("pruefeAenderung: Teilen warnt vor Öffnung über der Schnittstelle und vor Durchbrüchen an der alten GUID", () => {
  const m = modellMit({ customWindows: [fenster(5, 2.8)] });
  const g = guidW(m.customWalls[0]);
  const r = pruefeAenderung(m, vs(m, 1, "teilen", { punkt_m: { x: 3, z: 0 } }), { projektId: P, durchbrueche: [{ nr: "D-1", bauteil_guid: g, status: "geplant" }] });
  assert.equal(r.stufe, "warn");
  assert.ok(r.befunde.some((b) => b.code === "oeffnung_teilung"));
  assert.ok(r.befunde.some((b) => b.code === "durchbruch_guid"));
});

test("pruefeAenderung: Attributprüfung (als Funktion übergeben) meldet, was die Änderung neu offen macht", () => {
  const ifc = { quelle: "ifc", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", ifcType: "IfcWall", psets: { Pset_WallCommon: { FireRating: "F30", LoadBearing: true } }, classifications: [{ code: "331" }] };
  const mk = (wert) => {
    const r = eigenschaftSetzen(ifc, { pset: "Pset_WallCommon", name: "FireRating", wert });
    return { art: "eigenschaft", ziel: { guid: ifc.guid, quelle: "ifc", modell: ifc.modell }, params: { pset: "Pset_WallCommon", name: "FireRating", wert },
      vorher: { wert: r.vorher }, nachher: { pset: "Pset_WallCommon", eigenschaft: "FireRating", wert: r.nachher } };
  };
  const ok = pruefeAenderung({}, mk("F90"), { attributPruefung: pruefeAttributeVorUebernahme, ifcBauteil: ifc });
  assert.equal(ok.stufe, "ok");
  assert.equal(ok.geprueft.attribute, true);
  const leer = pruefeAenderung({}, mk(""), { attributPruefung: pruefeAttributeVorUebernahme, ifcBauteil: ifc });
  assert.ok(leer.befunde.some((b) => b.code === "feuer_fehlt" && b.stufe === "ok"));
  assert.match(leer.saetze.join("|"), /Hinweis: Der Feuerwiderstand \(FireRating\) ist nicht gesetzt/);
  // without the function the attribute check is reported as not run
  const ohne = pruefeAenderung({}, mk("F90"), { ifcBauteil: ifc });
  assert.equal(ohne.geprueft.attribute, false);
  assert.match(ohne.saetze.join("|"), /Nicht geprüft: Attribute/);
});

// ---------------------------------------------------------------- Pipeline: vorbereiten -> bestätigen -> zurücknehmen

const kopie = (x) => JSON.parse(JSON.stringify(x));

test("zielAusAuswahl: 'dieses' ohne Auswahl wird verweigert, nicht geraten", () => {
  assert.throws(() => zielAusAuswahl(null), (e) => e.message === KEINE_AUSWAHL_TEXT);
  assert.throws(() => zielAusAuswahl({ anzahl: 0, bauteile: [] }), (e) => e.message === KEINE_AUSWAHL_TEXT);
  const zwei = { anzahl: 2, ohneGuid: 0, bauteile: [{ guid: "A".repeat(22) }, { guid: "B".repeat(22) }] };
  assert.throws(() => zielAusAuswahl(zwei), (e) => e.message === MEHRERE_AUSWAHL_TEXT);
  assert.deepEqual(zielAusAuswahl({ anzahl: 1, ohneGuid: 0, bauteile: [{ guid: "A".repeat(22), klasse: "IfcWall", name: "Wand" }] }), { guid: "A".repeat(22), klasse: "IfcWall", name: "Wand" });
  const m = modellMit();
  assert.throws(() => vorschlagVorbereiten(m, { art: "eigenschaft", params: { name: "kg", wert: "1" }, herkunft: hand, kontext: null }, { projektId: P }), /Keine Auswahl/);
});

test("vorschlagVorbereiten ändert nichts; Ausführen nur nach Bestätigung, nie durch einen Agenten, nie bei Fehler", () => {
  const m = modellMit();
  const vorher = kopie(m);
  const guid = guidW(m.customWalls[1]);
  const v = vorschlagVorbereiten(m, { art: "eigenschaft", ziel: { guid }, params: { name: "Feuerwiderstand", wert: "F90" }, herkunft: { quelle: "agent", befehl_text: "Wand F90" } },
    { projektId: P, id: "v0000001" });
  assert.deepEqual(m, vorher, "Vorschlag ändert das Modell nicht");
  assert.equal(v.satz, "Tragende Innenwand W-2: Feuerwiderstand leer → F90");
  assert.equal(v.pruefung.stufe, "ok");
  assert.equal(v.herkunft.quelle, "agent");
  assert.throws(() => vorschlagAusfuehren(m, v, { projektId: P }), /Nicht bestätigt/);
  assert.throws(() => vorschlagAusfuehren(m, v, { projektId: P, bestaetigt_durch: "agent" }), /Agent kann seine eigene Änderung nicht bestätigen/);
  assert.throws(() => vorschlagAusfuehren(m, v, { projektId: P, bestaetigt_durch: "irgendwer" }), /Nicht bestätigt/);
  assert.throws(() => vorschlagAusfuehren(m, { ...v, pruefung: null }, { projektId: P, bestaetigt_durch: "hand" }), /nicht geprüft/);
  assert.deepEqual(m, vorher);
  const r = vorschlagAusfuehren(m, v, { projektId: P, bestaetigt_durch: "hand", zeit: "2026-10-24T12:00:00.000Z" });
  assert.equal(r.modell.customWalls[1].feuerwiderstand, "F90");
  assert.deepEqual(m, vorher, "Eingabemodell bleibt unverändert");
  assert.equal(r.eintrag.herkunft, "agent");
  assert.equal(r.eintrag.vorschlag_id, "v0000001");
  assert.equal(r.eintrag.zeit, "2026-10-24T12:00:00.000Z");

  // blocked proposal
  const g1 = guidW(m.customWalls[0]);
  const gesperrt = vorschlagVorbereiten(m, { art: "eigenschaft", ziel: { guid: g1 }, params: { name: "status", wert: "abbruch" }, herkunft: hand }, { projektId: P });
  assert.equal(gesperrt.pruefung.stufe, "fehler");
  assert.throws(() => vorschlagAusfuehren(m, gesperrt, { projektId: P, bestaetigt_durch: "hand" }), { message: /^Gesperrt: Abbruch tragender Bauteile ohne Vermerk/ });
});

test("vorschlagAusfuehren prüft gegen den AKTUELLEN Stand: ein inzwischen gesperrter Vorschlag läuft nicht", () => {
  const m = modellMit({ customWalls: [wand(1, { bauteil_typ: "wand-tragend", tragend: true, statik_vermerk: "liegt vor" }), wand(2)] });
  const g = guidW(m.customWalls[0]);
  const v = vorschlagVorbereiten(m, { art: "eigenschaft", ziel: { guid: g }, params: { name: "status", wert: "abbruch" }, herkunft: hand }, { projektId: P });
  assert.notEqual(v.pruefung.stufe, "fehler");
  // meanwhile somebody removes the note
  const spaeter = { ...m, customWalls: [{ ...m.customWalls[0], statik_vermerk: "" }, m.customWalls[1]] };
  assert.throws(() => vorschlagAusfuehren(spaeter, v, { projektId: P, bestaetigt_durch: "hand" }), /Gesperrt/);
});

test("Rückweg: Eigenschaft, Transformation und Teilen lassen sich je Schritt zurücknehmen (Modell wieder gleich)", () => {
  const m = modellMit({ customWindows: [fenster(5, 1.5), fenster(6, 4.5)] });
  const opt = { projektId: P, bestaetigt_durch: "hand" };
  const guid = guidW(m.customWalls[1]);

  // property
  const e1 = vorschlagAusfuehren(m, vorschlagVorbereiten(m, { art: "eigenschaft", ziel: { guid }, params: { name: "kg", wert: "342" }, herkunft: hand }, { projektId: P }), opt);
  assert.equal(e1.modell.customWalls[1].kg, "342");
  assert.deepEqual(aenderungUmkehren(e1.modell, e1.eintrag, { projektId: P }).modell, m);
  // property that was only derived goes back to unset
  const e1b = vorschlagAusfuehren(m, vorschlagVorbereiten(m, { art: "eigenschaft", ziel: { guid: guidW(m.customWalls[0]) }, params: { name: "feuerwiderstand", wert: "F90" }, herkunft: hand }, { projektId: P }), opt);
  assert.deepEqual(aenderungUmkehren(e1b.modell, e1b.eintrag, { projektId: P }).modell, m);

  // transformation, undone independently of a later step
  const e2 = vorschlagAusfuehren(m, vorschlagVorbereiten(m, { art: "transformieren", ziel: { guid }, params: { verschiebung_m: [1, 0, 0], drehung_grad: 10 }, herkunft: { quelle: "text", befehl_text: "schieb sie" } }, { projektId: P }), opt);
  const e3 = vorschlagAusfuehren(e2.modell, vorschlagVorbereiten(e2.modell, { art: "eigenschaft", ziel: { guid }, params: { name: "kg", wert: "342" }, herkunft: hand }, { projektId: P }), opt);
  const ohne2 = aenderungUmkehren(e3.modell, e2.eintrag, { projektId: P }).modell;
  assert.deepEqual(ohne2.customWalls[1].a, m.customWalls[1].a, "Schritt 2 zurückgenommen");
  assert.equal(ohne2.customWalls[1].kg, "342", "Schritt 3 bleibt");
  assert.deepEqual(aenderungUmkehren(e2.modell, e2.eintrag, { projektId: P }).modell, m);

  // split with openings
  const g1 = guidW(m.customWalls[0]);
  const v = vorschlagVorbereiten(m, { art: "teilen", ziel: { guid: g1 }, params: { punkt_m: { x: 3, z: 0 } }, herkunft: { quelle: "sprache", befehl_text: "teile die Wand in der Mitte" } }, { projektId: P });
  assert.equal(v.satz, "Tragende Innenwand W-1: bei 3 m teilen → 3 m + 3 m");
  assert.equal(v.nachher.teile.length, 2);
  const t = vorschlagAusfuehren(m, v, opt);
  assert.equal(t.modell.customWalls.length, 4);
  assert.equal(t.modell.customWindows.find((o) => o._idx === 6).wallIdx, t.modell.customWalls[3]._idx);
  assert.ok(!t.modell.customWalls.some((w) => guidW(w) === g1 && !w.guid), "alte Wand ist ersetzt");
  assert.deepEqual(aenderungUmkehren(t.modell, t.eintrag, { projektId: P }).modell, m);
  // the target of the step is gone -> a clear refusal
  assert.throws(() => aenderungUmkehren(m, t.eintrag, { projektId: P }), /nicht mehr/);
});

test("Teilen einer Decke über die Pipeline, Rückweg und IFC-Eigenschaft als Journal", () => {
  const m = { customSlabs: [{ ...quadrat }], customWalls: [], customWindows: [] };
  const g = bauteilGuid(P, "customSlabs", quadrat);
  const v = vorschlagVorbereiten(m, { art: "teilen", ziel: { guid: g }, params: { linie: { a: { x: 1, z: -1 }, b: { x: 1, z: 5 } } }, herkunft: hand }, { projektId: P });
  assert.match(v.satz, /entlang der Linie teilen → (4|12) m² \+ (12|4) m²/);
  const r = vorschlagAusfuehren(m, v, { projektId: P, bestaetigt_durch: "tastatur" });
  assert.equal(r.modell.customSlabs.length, 2);
  assert.deepEqual(aenderungUmkehren(r.modell, r.eintrag, { projektId: P }).modell, m);

  const ifc = { quelle: "ifc", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", klasse: "IfcWall", name: "Wand A", project_id: P, psets: { Pset_WallCommon: { FireRating: "F30" } } };
  const vi = vorschlagVorbereiten({}, { art: "eigenschaft", ziel: { guid: ifc.guid }, params: { pset: "Pset_WallCommon", name: "FireRating", wert: "F90" }, herkunft: { quelle: "bild" }, ifcBauteil: ifc }, { projektId: P });
  assert.equal(vi.satz, "Wand A: Feuerwiderstand F30 → F90");
  const ri = vorschlagAusfuehren({}, vi, { projektId: P, bestaetigt_durch: "sprache", zeit: "2026-10-24T13:00:00.000Z" });
  // the journal entry has the shape of eintragBauen, plus - additive - who asked and who confirmed
  assert.deepEqual(ri.journal, { ...eintragBauen({ projectId: P, modell: "rohbau.ifc", guid: ifc.guid, pset: "Pset_WallCommon", eigenschaft: "FireRating", alt: "F30", wert: "F90", zeit: "2026-10-24T13:00:00.000Z" }),
    herkunft: "bild", herkunft_quellen: ["bild"], befehl_text: null, bestaetigt_durch: "sprache" });
  assert.equal(ri.eintrag.herkunft, "bild");
  assert.deepEqual(aenderungUmkehren({}, ri.eintrag).journal, { loeschen: { modell: "rohbau.ifc", guid: ifc.guid, pset: "Pset_WallCommon", eigenschaft: "FireRating", zeit: "2026-10-24T13:00:00.000Z" } });
  assert.throws(() => vorschlagVorbereiten({}, { art: "teilen", ziel: { guid: ifc.guid }, params: {}, herkunft: hand, ifcBauteil: ifc }), /Datei bleibt unverändert/);
});

test("bauteilImModell: Hülle/Werkstatt-GUID wird nicht geraten; modellMitAenderung ändert das Eingabemodell nie; zahlText", () => {
  const m = modellMit();
  assert.equal(bauteilImModell(m, "H".repeat(22), { projektId: P }), null);
  assert.throws(() => modellMitAenderung(m, { art: "eigenschaft", ziel: { guid: "H".repeat(22) }, params: { name: "kg", wert: "1" } }, { projektId: P }), /Bauteil nicht gefunden/);
  const fund = bauteilImModell(m, guidW(m.customWalls[0]), { projektId: P });
  assert.equal(fund.kurzname, "Wand W-1");
  assert.equal(zahlText(1.23456), "1,235");
  assert.equal(zahlText(-0.0001), "0");
});
