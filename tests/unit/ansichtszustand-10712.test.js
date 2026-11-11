// 107-12: view state — one state object for plan, section, 3D, PDF and DXF (@core/lib/plan/ansichtszustand.js), the one level of
// detail (detailgradFuer), structure display, view options, graphic rules, persistence in ansicht_layer, export that waits for the
// derivation and never falls back silently, no geometry in a stored view, and the plan WITHOUT a view byte-identical to before
// (golden fixtures/plan-10712-vorher.json, written with the code of HEAD 20350cd6 before this plan).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import {
  ANSICHT_LEER, AUSSCHNITT_MAX_BYTES, GEOMETRIE_FELDER, MAX_REGELN, RUECKFALL_VERMERK, SOLID_ZEITGRENZE_MS, STANDARD_REGELN, STRUKTURDARSTELLUNGEN,
  ableitungFuerAusgabe, ansichtLayerNormalisieren, ausschnittBytes, ausschnittGleich, ausschnittNormalisieren, ausschnittStandard,
  baenderNachStruktur, darstellungsWerte, ebenenAnwenden, elementDarstellung, enthaeltGeometrie, istUmbauBrille, mitZeitgrenze,
  naechsteAusschnittId, optionenFuer, regelNormalisieren, regelPasst, rueckfallAnzahl, schichtSichtbar, tragendVon, wandFunktionen, wandSchichtStreifen,
} from "@core/lib/plan/ansichtszustand.js";
import { detailgradFuer, lodFuer, DETAILGRAD_STUFEN } from "@core/lib/plan/massstab.js";
import * as designerMassstab from "@designer/lib/massstab";
import { brilleVon, planDarstellung, dunkler } from "@core/lib/plan/brillen.js";
import { planGrafik, schnittGrafik, vektorPlanPdf, linienGruppe } from "@designer/lib/vektorPlan";
import { grundrissDxfDaten, dxfDatei } from "@designer/lib/dxfPlaene";
import { LAYER_VERSION, MIGRATIONEN, migrateLayer, stempelFuerSave, istFachlayer } from "@core/lib/fachlayerSchema.js";
import { STATUS_WERTE, STATUS_LABEL } from "@core/lib/bimClassification";
import { normalisiereStatus } from "@core/lib/kataloge.js";
import { planModell } from "./fixtures/planModell-10712.js";

const VORHER = JSON.parse(fs.readFileSync(new URL("./fixtures/plan-10712-vorher.json", import.meta.url), "utf8"));

/** Text of all (deflated) content streams of a PDF, latin1. */
function pdfInhalt(bytes) {
  const b = Buffer.from(bytes);
  const t = b.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m.index + m[0].length, e = t.indexOf("endstream", s);
    try { out += zlib.inflateSync(b.subarray(s, e)).toString("latin1"); } catch { out += t.slice(s, e); }
  }
  return out;
}
/** Hex form of a WinAnsi text as pdf-lib writes it (<...> Tj). */
const hex = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

describe("107-12 Task 1 — Zustandsobjekt und Layer", () => {
  it("Normalisierung: negatives level bleibt, unbekannte und Geometrie-Felder werden verworfen", () => {
    const roh = { id: 7, name: " UG ", type: "grundriss", level: -1, scale: 50, combo: "Rohbau", cutHeight: 1.2, brille: "ausfuehrung", sw: true,
      strukturdarstellung: "nur-kern", optionen: { tuerAufschlag: false, quatsch: true }, regeln: [{ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "dunkler" } }],
      positionen: [1, 2, 3], indizes: [0, 1, 2], mesh: { a: 1 }, fremd: "x" };
    const a = ausschnittNormalisieren(roh);
    assert.equal(a.level, -1);
    assert.equal(a.id, "7");
    assert.equal(a.name, "UG");
    assert.deepEqual(a.optionen, { tuerAufschlag: false });
    assert.equal(a.regeln.length, 1);
    for (const k of ["positionen", "indizes", "mesh", "fremd"]) assert.equal(k in a, false, k);
    assert.equal(enthaeltGeometrie(roh), true);
    assert.equal(enthaeltGeometrie(a), false);
  });
  it("die alte Sitzungs-Form {id,name,type,level,scale,combo,cutHeight} gilt unverändert, neue Felder mit Standard", () => {
    const alt = { id: 3, name: "Grundriss EG · 1:100", type: "grundriss", level: 0, scale: 100, combo: "Alle zeigen", cutHeight: 1.1 };
    const a = ausschnittNormalisieren(alt);
    for (const k of ["type", "level", "scale", "combo", "cutHeight", "name"]) assert.equal(a[k], alt[k]);
    assert.equal(a.brille, "eingabe");
    assert.equal(a.strukturdarstellung, "gesamt");
    assert.equal(a.optionen, null);
    assert.equal(a.regeln, null);
    assert.equal(a.ki_vermerk, null);
    assert.deepEqual(ausschnittStandard(), ausschnittNormalisieren({}));
  });
  it("ungültige Werte fallen auf Standard, Regeln mit unbekanntem Feld/Operator entfallen, höchstens MAX_REGELN", () => {
    const a = ausschnittNormalisieren({ type: "perspektive", scale: -5, cutHeight: 99, brille: "nix", strukturdarstellung: "rohbau",
      regeln: [...Array(30)].map(() => ({ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "dunkler" } })).concat([{ wenn: { feld: "farbe", operator: "=", wert: 1 }, dann: { fuellung: "dunkler" } }]) });
    assert.equal(a.type, "grundriss"); assert.equal(a.scale, 100); assert.equal(a.cutHeight, 1.1); assert.equal(a.brille, "eingabe");
    assert.equal(a.strukturdarstellung, "gesamt");
    assert.equal(a.regeln.length, MAX_REGELN);
    assert.equal(regelNormalisieren({ wenn: { feld: "tragend", operator: "~" }, dann: { fuellung: "dunkler" } }), null);
    assert.equal(regelNormalisieren({ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "#ff0000" } }), null, "keine freien Farben, nur Tokens");
  });
  it("ausschnittGleich vergleicht nur Parameter (id, Name, KI-Vermerk zählen nicht)", () => {
    const a = { id: "a1", name: "A", type: "grundriss", level: 0, scale: 100, ki_vermerk: true };
    assert.equal(ausschnittGleich(a, { ...a, id: "a2", name: "B", ki_vermerk: false }), true);
    assert.equal(ausschnittGleich(a, { ...a, scale: 50 }), false);
    assert.equal(ausschnittGleich(a, { ...a, strukturdarstellung: "nur-kern" }), false);
  });
  it("ansicht_layer Version 1: registriert, Migration leer, Altprojekt ohne Layer = leer; Persistenz-Rundlauf", () => {
    assert.equal(LAYER_VERSION.ansicht_layer, 1);
    assert.equal(MIGRATIONEN.ansicht_layer.length, 1);
    assert.equal(istFachlayer("ansicht_layer"), true);
    assert.equal(migrateLayer("ansicht_layer", undefined).wert ?? null, null);
    // 55-01: additive `regel_vorlagen` (absent on old blobs → [])
    assert.deepEqual(ansichtLayerNormalisieren(undefined), { ausschnitte: [], ebenen: [], kombinationen: {}, regel_vorlagen: [] });
    assert.deepEqual(ansichtLayerNormalisieren(ANSICHT_LEER), { ausschnitte: [], ebenen: [], kombinationen: {}, regel_vorlagen: [] });
    const layer = { ausschnitte: [ausschnittNormalisieren({ id: "a1", name: "Schalplan", level: -1, strukturdarstellung: "nur-kern-tragend", regeln: STANDARD_REGELN })],
      ebenen: [{ id: "walls", visible: false, locked: true, farbe: "#112233", drucken: false }], kombinationen: { Mein: ["walls"] } };
    const gespeichert = stempelFuerSave("ansicht_layer", layer, new Date("2026-10-25T10:00:00.000Z"));
    assert.equal(gespeichert.v, 1);
    const geladen = migrateLayer("ansicht_layer", JSON.parse(JSON.stringify(gespeichert))).wert;
    const n = ansichtLayerNormalisieren(geladen);
    assert.deepEqual(n.ausschnitte, layer.ausschnitte);
    assert.deepEqual(n.ebenen, layer.ebenen);
    assert.deepEqual(n.kombinationen, layer.kombinationen);
  });
  it("Ebenen: gespeicherte Eigenschaften nach id, Standard bleibt sonst; doppelte Ausschnitt-ids zählen einmal; nächste id", () => {
    const std = [{ id: "walls", name: "Wände", visible: true, locked: false }, { id: "zones", name: "Räume", visible: true, locked: false }];
    const e = ebenenAnwenden(std, [{ id: "walls", visible: false, locked: true }, { id: "fremd", visible: false }]);
    assert.deepEqual(e, [{ id: "walls", name: "Wände", visible: false, locked: true }, std[1]]);
    const n = ansichtLayerNormalisieren({ ausschnitte: [{ id: "a1" }, { id: "a1" }, { id: "a4" }, { name: "ohne id" }] });
    assert.deepEqual(n.ausschnitte.map((a) => a.id), ["a1", "a4"]);
    assert.equal(naechsteAusschnittId(n.ausschnitte), "a5");
    assert.equal(naechsteAusschnittId([]), "a1");
  });
  it("ein gespeicherter Ausschnitt enthält keine Geometrie und bleibt unter 8 KB mit allen Parametern", () => {
    const voll = ausschnittNormalisieren({ id: "a99", name: "x".repeat(200), type: "schnitt", level: -3, scale: 20, combo: "Eigene", cutHeight: 2.5, brille: "ausfuehrung", sw: true,
      strukturdarstellung: "nur-kern-tragend", optionen: Object.fromEntries(["tuerAufschlag", "fensterSymbol", "durchbruchSymbol", "schraffurMaterial", "schraffurStatus"].map((k) => [k, false])),
      regeln: [...Array(MAX_REGELN)].map((_, i) => ({ wenn: { feld: "feuerwiderstand", operator: "enthaelt", wert: `REI${i}` }, dann: { fuellung: "dunkler", kontur: "warnung", strich: "4 1 1 1", strichbreite_mm: 0.5 } })),
      ki_vermerk: true });
    const bytes = ausschnittBytes(voll);
    assert.ok(bytes < AUSSCHNITT_MAX_BYTES, `${bytes} B`);
    const schluessel = new Set();
    const sammle = (o) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { schluessel.add(k); sammle(v); } };
    sammle(voll);
    for (const g of GEOMETRIE_FELDER) assert.equal(schluessel.has(g), false, g);
  });
  it("Statuskatalog: temporaer ist Wert der Achse (D-BK-21), Katalog normalisiert ihn", () => {
    assert.deepEqual(STATUS_WERTE, ["abbruch", "neubau", "bestand", "temporaer"]);
    assert.equal(STATUS_LABEL.temporaer, "Temporär");
    assert.equal(normalisiereStatus("TEMPORARY"), "temporaer");
  });
});

describe("107-12 Task 2 — Detailgrad aus einer Funktion", () => {
  it("Stufen 1:1000 … 1:20, 1:20 existiert mit Zarge und Liniengruppe 1,0", () => {
    assert.deepEqual([...DETAILGRAD_STUFEN], [1000, 500, 200, 100, 50, 20]);
    const d20 = detailgradFuer(20);
    assert.equal(d20.stufe, 20); assert.equal(d20.zarge, true); assert.equal(d20.linienGruppe.schnitt, 1.0); assert.equal(d20.schichten, true);
    const d100 = detailgradFuer(100);
    assert.equal(d100.schichten, false); assert.equal(d100.tuerBogen, true); assert.equal(d100.raumnamen, true); assert.equal(d100.zarge, false);
    const d200 = detailgradFuer(200);
    assert.equal(d200.tuerBlatt, false); assert.equal(d200.raumnamen, false); assert.equal(d200.zonen, true);
    assert.equal(detailgradFuer(500).zonen, false);
    assert.equal(detailgradFuer(75).stufe, 100); assert.equal(detailgradFuer(30).stufe, 50); assert.equal(detailgradFuer(5000).stufe, 1000);
  });
  it("lodFuer ist eine Sicht auf detailgradFuer mit den Werten von 75-05 (auch für unbekannte Maßstäbe)", () => {
    assert.deepEqual(lodFuer(1000), { zonen: false, weLabel: false, raumnamen: false, balkenM: 100 });
    assert.deepEqual(lodFuer(500), { zonen: false, weLabel: false, raumnamen: false, balkenM: 50 });
    assert.deepEqual(lodFuer(200), { zonen: true, weLabel: true, raumnamen: false, balkenM: 20 });
    assert.deepEqual(lodFuer(50), { zonen: true, weLabel: true, raumnamen: true, balkenM: 5 });
    assert.deepEqual(lodFuer(100), lodFuer(200), "1:100 hatte die 1:200-Flags");
    assert.equal(designerMassstab.lodFuer, lodFuer, "Designer-Datei ist nur Re-Export");
    assert.equal(designerMassstab.detailgradFuer, detailgradFuer);
  });
  it("die Brille gewinnt als Override der Schichttiefe; Maßstab und Tiefe widersprechen sich nicht", () => {
    const aus = brilleVon("ausfuehrung"), ein = brilleVon("eingabe");
    assert.equal(detailgradFuer(100, aus).schichten, true);
    assert.equal(detailgradFuer(100, aus).quelle, "brille");
    assert.equal(detailgradFuer(50, ein).schichten, false);
    assert.equal(detailgradFuer(50).schichten, true);
    // the screen read brille.tiefe before: same flag for every lens at its own scale
    for (const b of ["eingabe", "bestand", "abbruch", "bauantrag", "ausfuehrung", "ausschreibung", "bauleitung"].map(brilleVon)) {
      assert.equal(detailgradFuer(b.massstab, b).schichten, b.tiefe === "schichten", b.id);
    }
  });
  it("Liniengruppe des Vektorplans kommt aus derselben Funktion (1:100 / 1:50 unverändert)", () => {
    assert.deepEqual(linienGruppe(100), { schnitt: 0.5, ansicht: 0.25, duenn: 0.125 });
    assert.equal(linienGruppe(50).schnitt, 0.7);
    assert.equal(linienGruppe(20).schnitt, 1.0);
  });
});

describe("107-12 Task 3 — Strukturdarstellung", () => {
  const { model, faelle } = planModell();
  const huelle = model.walls.find((w) => w.level === 0);
  it("Funktion je Schicht und Regel je Darstellung", () => {
    assert.deepEqual(wandFunktionen(huelle), ["bekleidung", "sonstig", "sonstig", "kern", "bekleidung"]); // cavity: Klinker, Luft, Dämmung, KS, Putz
    assert.deepEqual(STRUKTURDARSTELLUNGEN.map((sd) => schichtSichtbar("bekleidung", sd)), [true, false, false, false]);
    assert.deepEqual(STRUKTURDARSTELLUNGEN.map((sd) => schichtSichtbar("kern", sd, false)), [true, true, true, false]);
    assert.equal(tragendVon({ thickness: 0.115, a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }), false);
    assert.equal(tragendVon({ thickness: 0.24, a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }), true);
    assert.equal(tragendVon({}, "stuetze"), true);
  });
  it("Streifen gefiltert, Referenzlinie unverändert: der Kernstreifen hat dieselben Punkte wie in der Gesamtdarstellung", () => {
    const alle = wandSchichtStreifen(huelle);
    const kern = baenderNachStruktur(alle, alle.map((b) => b.funktion), "nur-kern");
    assert.equal(kern.length, 1);
    assert.deepEqual(kern[0].pts, alle[3].pts);
    assert.equal(baenderNachStruktur(alle, alle.map((b) => b.funktion), "ohne-bekleidung").length, 3);
  });
  it("Bänder und Solid-Materialgruppen werden gleich gefiltert (Index `schicht` → Funktion aus dem Aufbau)", () => {
    const f = wandFunktionen(huelle);
    const gruppen = [4, 3, 2, 1, 0].map((schicht) => ({ schicht, ringe: [[{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]] })); // other order, as a solid cut may return
    const streifen = wandSchichtStreifen(huelle);
    for (const sd of STRUKTURDARSTELLUNGEN) {
      const a = baenderNachStruktur(gruppen, f, sd).map((b) => b.schicht).sort();
      const b = baenderNachStruktur(streifen, f, sd).map((x) => x.schicht).sort();
      assert.deepEqual(a, b, sd);
    }
  });
  it("Vektorplan: nur-kern zeichnet je Hüllwand nur den Kern, nur-kern-tragend blendet die 11,5er Wand aus", () => {
    const n0 = (g) => g.elemente.filter((e) => e.art === "poly" && e.ebene === "wand").length;
    const gesamt = planGrafik({ ...faelle.eingabe100, ansicht: { strukturdarstellung: "gesamt" } });
    const kern = planGrafik({ ...faelle.eingabe100, ansicht: { strukturdarstellung: "nur-kern" } });
    const tragend = planGrafik({ ...faelle.eingabe100, ansicht: { strukturdarstellung: "nur-kern-tragend" } });
    const huellen = model.walls.filter((w) => w.level === 0).length;
    assert.equal(n0(gesamt), huellen + 3);
    assert.equal(n0(kern), huellen + 3, "Hülle: ein Kernstreifen je Wand; gezeichnete Wände ohne Aufbau/mit Einschicht-Aufbau = Kern");
    assert.equal(n0(tragend), huellen + 2, "die nichttragende 11,5-cm-Wand entfällt");
    // the hull core strip lies where it lies in the whole wall (reference line unchanged)
    const kernStreifen = wandSchichtStreifen(huelle)[3].pts;
    assert.ok(kern.elemente.some((e) => e.ebene === "wand" && JSON.stringify(e.pts) === JSON.stringify(kernStreifen)));
  });
  it("Solid-Schnitt (schichtFlaechen): Materialgruppen werden wie die Streifen gefiltert", () => {
    const k = `env:${huelle.level}:${huelle.edge}`;
    const ring = (i) => [{ x: i, z: 0 }, { x: i + 0.1, z: 0 }, { x: i + 0.1, z: 1 }, { x: i, z: 1 }];
    const sf = new Map([[k, { quelle: "solid", baender: [0, 1, 2, 3, 4].map((schicht) => ({ schicht, ringe: [ring(schicht)] })) }]]);
    const g = planGrafik({ ...faelle.eingabe100, schichtFlaechen: sf, ansicht: { strukturdarstellung: "nur-kern" } });
    const aus = g.elemente.filter((e) => e.ebene === "wand" && e.pts.length === 4 && e.pts[0].z === 0 && e.pts[2].z === 1 && e.pts[1].x - e.pts[0].x < 0.11);
    assert.deepEqual(aus.map((e) => e.pts[0].x), [3]);
  });
  it("Schnitt: Schnittgruppen der Hülle nach Funktion gefiltert", () => {
    const sf = [0, 1, 2, 3, 4].map((schicht) => ({ schluessel: "env:0:0", schicht, ringe: [[{ x: schicht, h: 0 }, { x: schicht + 0.1, h: 0 }, { x: schicht + 0.1, h: 3 }]] }));
    const zaehle = (sd) => schnittGrafik({ model, storeyHeight: 3, schnittFlaechen: sf, ansicht: sd ? { strukturdarstellung: sd } : null }).elemente.filter((e) => e.ebene === "wand" && e.pts.length === 3).length;
    assert.equal(zaehle(null), 5);
    assert.equal(zaehle("nur-kern"), 1);
    assert.equal(zaehle("ohne-bekleidung"), 3);
  });
});

describe("107-12 Task 4 — Optionen und Regeln", () => {
  const { faelle } = planModell();
  it("Optionen: Standard aus dem Detailgrad, gesetzte Werte gewinnen", () => {
    assert.deepEqual(optionenFuer(detailgradFuer(100), null), { tuerAufschlag: true, fensterSymbol: true, durchbruchSymbol: true, schraffurMaterial: false, schraffurStatus: true });
    assert.equal(optionenFuer(detailgradFuer(200), null).tuerAufschlag, false);
    assert.equal(optionenFuer(detailgradFuer(50), null).schraffurMaterial, true);
    assert.equal(optionenFuer(detailgradFuer(50), { schraffurMaterial: false }).schraffurMaterial, false);
  });
  it("Regeln: Operatoren und Felder", () => {
    const w = darstellungsWerte({ thickness: 0.24, a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, feuerwiderstand: "REI90", u_wert: 0.2 });
    assert.equal(w.tragend, true);
    assert.equal(regelPasst({ feld: "feuerwiderstand", operator: "gesetzt" }, w), true);
    assert.equal(regelPasst({ feld: "feuerwiderstand", operator: "enthaelt", wert: "rei" }, w), true);
    assert.equal(regelPasst({ feld: "u_wert", operator: "<", wert: 0.24 }, w), true);
    assert.equal(regelPasst({ feld: "u_wert", operator: ">=", wert: 0.24 }, w), false);
    assert.equal(regelPasst({ feld: "tragend", operator: "!=", wert: true }, w), false);
    assert.equal(regelPasst({ feld: "feuerwiderstand", operator: "gesetzt" }, darstellungsWerte({ feuerwiderstand: "ohne" })), false, "„ohne“ ist kein Feuerwiderstand");
  });
  it("Rangfolge: erste passende Regel; in Umbau-Brillen gewinnt der Status; ohne Regeln = planDarstellung", () => {
    const ein = brilleVon("eingabe"), bau = brilleVon("bauantrag");
    const tragend = { tragend: true, feuerwiderstand: null, status: null };
    const r1 = elementDarstellung(ein, tragend, STANDARD_REGELN, { standard: { fill: "#3f3f46", stroke: "#18181b" } });
    assert.equal(r1.regel, 1); assert.equal(r1.fill, dunkler("#3f3f46", 0.35));
    const brand = { tragend: true, feuerwiderstand: "F90", status: null };
    const r2 = elementDarstellung(ein, brand, STANDARD_REGELN);
    assert.equal(r2.regel, 0); assert.equal(r2.dash, "4 1 1 1"); assert.equal(r2.breite_mm, 0.5); assert.equal(r2.stroke, "#542508");
    // renovation lens with a status: the status wins
    const mitStatus = { ...brand, status: "abbruch" };
    assert.deepEqual(elementDarstellung(bau, mitStatus, STANDARD_REGELN), planDarstellung(bau, "abbruch"));
    assert.equal(istUmbauBrille(bau), true); assert.equal(istUmbauBrille(ein), false);
    // input lens with a status: the rule applies on the status look
    assert.equal(elementDarstellung(ein, mitStatus, STANDARD_REGELN).regel, 0);
    // renovation lens, element WITHOUT status: the rule applies (there is no status to win)
    assert.equal(elementDarstellung(bau, tragend, STANDARD_REGELN).regel, 1);
    assert.deepEqual(elementDarstellung(bau, mitStatus, null), planDarstellung(bau, "abbruch"));
    assert.equal(elementDarstellung(ein, { status: null, tragend: false }, STANDARD_REGELN), null);
  });
  it("Regeln im Vektorplan: die 24er Wand mit Feuerwiderstand bekommt die strichpunktierte Kontur, tragende Stütze dunkler", () => {
    const g = planGrafik({ ...faelle.eingabe100, ansicht: { regeln: STANDARD_REGELN } });
    assert.ok(g.elemente.some((e) => e.ebene === "wand" && e.dash === "4 1 1 1" && e.breite_mm === 0.5));
    assert.ok(g.elemente.some((e) => e.ebene === "stuetze" && e.fill === dunkler("#3f3f46", 0.35)));
  });
  it("Öffnungen auf eigener Ebene: Vektorplan `oeffnung`, DXF A_OEFFNUNG ohne SOLID; Symbole schaltbar", () => {
    const g = planGrafik({ ...faelle.eingabe100, ansicht: {} });
    const oe = g.elemente.filter((e) => e.ebene === "oeffnung");
    assert.ok(oe.length > 10, String(oe.length));
    const d = grundrissDxfDaten(g, { massstab: 100, geschoss: "EG" });
    assert.ok(d.ebenen.some((e) => e.name === "A_OEFFNUNG"));
    assert.equal(d.elemente.filter((e) => e.ebene === "A_OEFFNUNG" && e.art === "flaeche").length, 0);
    assert.match(dxfDatei(d).text, /A_OEFFNUNG/);
    const ohne = planGrafik({ ...faelle.eingabe100, ansicht: { optionen: { tuerAufschlag: false, fensterSymbol: false, durchbruchSymbol: false } } });
    const offen = (x) => x.elemente.filter((e) => e.ebene === "oeffnung" && e.offen).length;
    assert.equal(offen(ohne), 0, "ohne Symbole bleiben nur die Öffnungsschnitte");
    assert.ok(offen(g) > 0);
    // 1:20: door frame
    const g20 = planGrafik({ ...faelle.eingabe100, massstab: 20, ansicht: {} });
    assert.ok(g20.elemente.filter((e) => e.ebene === "oeffnung").length > oe.length);
  });
});

describe("107-12 Task 4 — Öffnungen unter der Strukturdarstellung", () => {
  const { model, faelle } = planModell();
  it("Schalplan: Öffnungen nur so tief wie die sichtbaren Schichten; Öffnungen ausgeblendeter Wände entfallen", () => {
    const zaehle = (sd) => planGrafik({ ...faelle.eingabe100, ansicht: { strukturdarstellung: sd } }).elemente.filter((e) => e.ebene === "oeffnung" && !e.offen);
    const gesamt = zaehle("gesamt"), tragend = zaehle("nur-kern-tragend");
    assert.equal(gesamt.length - tragend.length, 1, "die Tür der nichttragenden 11,5-cm-Wand entfällt mit der Wand");
    // the cut of a hull rule window: whole thickness (0.46 m cavity) vs. the core only (KS 0.175 m)
    const tiefe = (e) => Math.hypot(e.pts[1].x - e.pts[2].x, e.pts[1].z - e.pts[2].z);
    const huelle = model.walls.find((w) => w.level === 0);
    const aufHuelle = (liste) => liste.filter((e) => Math.abs(tiefe(e) - 0.175) < 1e-6 || Math.abs(tiefe(e) - huelle.thickness) < 1e-6);
    assert.ok(aufHuelle(gesamt).some((e) => Math.abs(tiefe(e) - 0.46) < 1e-6));
    assert.ok(aufHuelle(tragend).length > 0 && aufHuelle(tragend).every((e) => Math.abs(tiefe(e) - 0.175) < 1e-6));
  });
});

describe("107-12 Task 5 — Export aus dem Ausschnitt, wartet auf die Ableitung", () => {
  const { faelle } = planModell();
  const flaechen = (solids) => new Map([["env:0:0", { quelle: solids ? "solid" : "baender", baender: [{ schicht: 3, ringe: [[{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]] }] }]]);
  it("verzögertes Solid → dieselbe Grafik wie ohne Verzögerung, kein Rückfall", async () => {
    const sofort = await ableitungFuerAusgabe(() => ({ ok: 1 }), flaechen, { zeitgrenze_ms: 1000 });
    const spaet = await ableitungFuerAusgabe(() => new Promise((r) => setTimeout(() => r({ ok: 1 }), 40)), flaechen, { zeitgrenze_ms: 1000 });
    assert.deepEqual([...spaet.flaechen], [...sofort.flaechen]);
    assert.equal(spaet.rueckfall, false);
    const g1 = planGrafik({ ...faelle.eingabe100, schichtFlaechen: sofort.flaechen, ansicht: {} });
    const g2 = planGrafik({ ...faelle.eingabe100, schichtFlaechen: spaet.flaechen, ansicht: {} });
    assert.deepEqual(g2, g1);
  });
  it("Zeitgrenze → Rückfall auf die Bänder mit Vermerk im PDF und im DXF", async () => {
    assert.equal(SOLID_ZEITGRENZE_MS, 10000);
    const r = await ableitungFuerAusgabe(() => new Promise((res) => setTimeout(() => res({ ok: 1 }), 300)), flaechen, { zeitgrenze_ms: 20 });
    assert.equal(r.zeitUeber, true); assert.equal(r.rueckfall, true); assert.equal(r.solids, null);
    assert.equal(rueckfallAnzahl(r.flaechen), 1);
    const g = planGrafik({ ...faelle.eingabe100, schichtFlaechen: r.flaechen });
    const pdf = await vektorPlanPdf(g, { massstab: 100, ableitungsVermerk: RUECKFALL_VERMERK });
    assert.ok(pdfInhalt(pdf.bytes).includes(hex("Wände aus Bändern abgeleitet")), "Vermerk im Blatt");
    const ohne = await vektorPlanPdf(g, { massstab: 100 });
    assert.equal(pdfInhalt(ohne.bytes).includes(hex("Wände aus Bändern abgeleitet")), false);
    const dxf = dxfDatei(grundrissDxfDaten(g, { massstab: 100, ableitungsVermerk: RUECKFALL_VERMERK })).text;
    assert.match(dxf, /A_PLANKOPF/);
    // the TEXT entity on A_PLANKOPF keeps the German text (review 107-12: the former line compared the same string twice)
    assert.ok(dxf.includes(`! ${RUECKFALL_VERMERK}`), "Vermerk als Text auf A_PLANKOPF");
    assert.match(dxf, /ACHTUNG: Waende aus Baendern abgeleitet/);
  });
  it("ein Solid, das den Abgleich nicht bestand (quelle baender), ist ebenfalls ein Rückfall", async () => {
    const r = await ableitungFuerAusgabe(() => ({ ok: 1 }), () => new Map([["a", { quelle: "solid" }], ["b", { quelle: "baender" }]]));
    assert.equal(r.zeitUeber, false); assert.equal(r.rueckfall, true);
    const aus = await ableitungFuerAusgabe(() => null, () => null);
    assert.equal(aus.rueckfall, false, "Verschneidung aus: kein Rückfall, nichts abgeleitet");
  });
  it("mitZeitgrenze: Wert vor der Grenze, sonst zeitUeber", async () => {
    assert.deepEqual(await mitZeitgrenze(Promise.resolve(5), 50), { wert: 5, zeitUeber: false });
    assert.deepEqual(await mitZeitgrenze(new Promise(() => {}), 10), { wert: null, zeitUeber: true });
  });
});

describe("107-12 Task 6 — Plan ohne Ausschnitt byte-gleich (Golden vor 107-12)", () => {
  const { faelle } = planModell();
  for (const [name, arg] of Object.entries(faelle)) {
    it(`${name}: planGrafik und DXF wie vor dem Plan`, () => {
      const g = planGrafik(arg);
      assert.deepEqual(JSON.parse(JSON.stringify(g)), VORHER[name].grafik);
      const text = dxfDatei(grundrissDxfDaten(g, { massstab: arg.massstab || 100, geschoss: "EG", projekt: "Test", modellstand: null })).text;
      assert.equal(text, VORHER[name].dxf);
    });
  }
});
