// 107-08: instance, GUID, classification, box → element, pset fields, schema adapter (spec I.4, IV, V, VI.1).
// Every expected value is a hand calculation in the comment next to it (site metres, y down; BIM frame x/z = site − bezug).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  leererLayer, geometrie, koerperAnlegen, pushPull, kopieren, drehKopien, skalieren, eckeVerschieben, gruppeBilden,
  instanzMatrix, instanzNeutral, spiegeln, ohneGuid, typAutomatik, typZuruecknehmen, typAutomatikZulassen, typSetzen, statusSetzen,
  guidsSichern, koerperVorschlag, koerperElement, bauteileAusKoerper, uebernahmeEntfernen, istUebernommen, formSchluessel,
  UEBERNAHME_HUELLE_DICKE_M,
} from "@core/lib/massing/massingModell.js";
import { deckenLage, wandHoehe, unterkante, stuetzenHoehe } from "@core/lib/bauteil/hoehen.js";
import { catalogSeed } from "../../packages/nova-core/server/catalog-seed.js";
import { kopieren as bloeckeKopieren } from "@core/lib/massing/bloecke.js";
import { bauteilVorschlag, rechteckSeiten, steckbrief, kennwerteVon, uWertAusSchichten, bauteilGuid, TYP_ABGELEITET_TEXT } from "@core/lib/bauteil/steckbrief.js";
import { aufbauVon } from "@core/lib/bauteil/aufbauten.js";
import { wandGeometrie } from "@core/lib/bauteil/referenz.js";
import { bauteilSchemaAus, elementAusSchema } from "@core/lib/bauteil/schemaAdapter.js";
import { normalisiereStatus } from "@core/lib/kataloge.js";
import { migrateLayer } from "@core/lib/fachlayerSchema.js";
import { punktInnen } from "@core/lib/polygonInnen";
import { exportIFC } from "@designer/lib/ifcExport";
import { createBuildingModel } from "@core/lib/buildingModel";
import { ifcInstanzSzenario } from "./fixtures/ifcInstanzModell-10708.js";

const lies = (/** @type {string} */ n) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const R = (/** @type {number} */ w, /** @type {number} */ d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
/** Layer with one body, the automatic run as the modeller does it (setLayer). */
const mitKoerper = (/** @type {any} */ profil, /** @type {number} */ h, /** @type {any} */ l = leererLayer()) => {
  const r = koerperAnlegen(l, profil, h);
  return { layer: typAutomatik(l, r.layer), id: r.id };
};
const modell = () => createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 1, storeyHeight: 3 });
/** GlobalIds of all proxies / typed bodies (Tag = body id) in a STEP text. */
const koerperGuids = (/** @type {string} */ ifc) => [...ifc.matchAll(/=IFC(?:BUILDINGELEMENTPROXY|WALL|COLUMN|SLAB)\('([^']{22})',\$,[^\n]*?,'(k\d+)',\./g)].map((m) => [m[2], m[1]]);

describe("107-08 Task 2 — bauteilVorschlag (Rangfolge Stütze, Wand, Decke, nur Rechtecke)", () => {
  it("0,5 × 0,5 × 3 m = Stütze (nie Wand), 5 × 0,3 × 2,5 m = tragende Innenwand, 6 × 5 × 0,25 m = Decke", () => {
    assert.equal(bauteilVorschlag(R(0.5, 0.5), 3)?.typ, "stuetze"); // lang 0.5 ≤ 0.6, h 3 ≥ 2
    assert.equal(bauteilVorschlag(R(5, 0.3), 2.5)?.typ, "wand-tragend"); // kurz 0.3 ≤ 0.6, lang 5 > 0.6, h ≥ 1; 0.3 ≥ 0.175 → tragend
    assert.equal(bauteilVorschlag(R(5, 0.115), 2.5)?.typ, "wand-innen"); // 0.115 < 0.175 → nichttragend
    assert.equal(bauteilVorschlag(R(6, 5), 0.25)?.typ, "decke"); // h 0.25 ≤ 0.5, 30 m² > 2
    const v = bauteilVorschlag(R(5, 0.3), 2.5);
    assert.equal(v?.abgeleitet, true);
    assert.match(String(v?.annahme), /Tragende Innenwand.*abgeleitet.*Dicke 0,30 m/);
  });
  it("nie wand-aussen; Grenzen: 0,60 × 0,60 × 2,00 = Stütze, 0,60 × 0,61 × 2 = Wand, 1 × 1 × 1 und 1,4 × 1,4 × 0,3 (1,96 m²) offen", () => {
    assert.equal(bauteilVorschlag(R(0.6, 0.6), 2)?.typ, "stuetze");
    assert.equal(bauteilVorschlag(R(0.61, 0.6), 2)?.typ, "wand-tragend");
    assert.equal(bauteilVorschlag(R(1, 1), 1), null);
    assert.equal(bauteilVorschlag(R(1.4, 1.4), 0.3), null); // 1.96 m² ≤ 2.0
    assert.equal(bauteilVorschlag(R(0.5, 0.5), 1.5), null); // too low for a column, too short for a wall
    for (const [w, d, h] of [[5, 0.3, 2.5], [8, 0.5, 3], [0.4, 0.4, 3], [4, 4, 0.2]]) assert.notEqual(bauteilVorschlag(R(w, d), h)?.typ, "wand-aussen");
  });
  it("nur Rechteckprofile: gedreht ja, L-Form, Trapez und schiefer Winkel > 1° nein", () => {
    const w = (30 * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
    const gedreht = R(5, 0.3).map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
    assert.equal(bauteilVorschlag(gedreht, 2.5)?.typ, "wand-tragend");
    assert.equal(bauteilVorschlag([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0.3, y: 0.3 }, { x: 0.3, y: 4 }, { x: 0, y: 4 }], 2.5), null);
    assert.equal(bauteilVorschlag([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 4.8, y: 0.3 }, { x: 0.2, y: 0.3 }], 2.5), null);
    // 1.5° skew: the corner at (5, 0) leans by tan(1.5°) · 0.3 m ≈ 7.9 mm
    const schief = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5 + Math.tan((1.5 * Math.PI) / 180) * 0.3, y: 0.3 }, { x: Math.tan((1.5 * Math.PI) / 180) * 0.3, y: 0.3 }];
    assert.equal(rechteckSeiten(schief), null);
    const fast = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5 + Math.tan((0.5 * Math.PI) / 180) * 0.3, y: 0.3 }, { x: Math.tan((0.5 * Math.PI) / 180) * 0.3, y: 0.3 }];
    assert.ok(rechteckSeiten(fast)); // 0.5° is within 1°
  });
});

describe("107-08 Task 2 — Automatik (D-BK-09): setzt sichtbar, Rücknahme bleibt", () => {
  it("Anlegen setzt den Typ mit Quelle automatisch; Speichern und Neuladen behält „abgeleitet (Annahme)“", () => {
    const { layer, id } = mitKoerper(R(5, 0.3), 2.5);
    const k = layer.koerper.find((x) => x.id === id);
    assert.equal(k?.bauteil_typ, "wand-tragend");
    assert.equal(k?.bauteil_typ_quelle, "automatisch");
    // save (JSON) and reload through the one read path (migrateLayer)
    const geladen = migrateLayer("massing_layer", JSON.parse(JSON.stringify(layer))).wert;
    const k2 = geladen.koerper[0];
    const s = steckbrief(koerperElement(geladen, k2), k2.bauteil_typ, { quelle: "massing" });
    assert.equal(s.quelle.typ, "abgeleitet");
    assert.equal(s.typQuelle, "automatisch");
    assert.ok(s.annahmen.some((a) => a.includes(TYP_ABGELEITET_TEXT)));
  });
  it("Rücknahme: Typ weg, Quelle zurueckgenommen; eine Formänderung setzt ihn nicht wieder; „wieder zulassen“ rechnet neu", () => {
    const { layer, id } = mitKoerper(R(5, 0.3), 2.5);
    let l = typZuruecknehmen(layer, [id]);
    assert.equal(l.koerper[0].bauteil_typ, undefined);
    assert.equal(l.koerper[0].bauteil_typ_quelle, "zurueckgenommen");
    const nachPush = typAutomatik(l, pushPull(l, id, 0.5));
    assert.equal(nachPush.koerper[0].bauteil_typ, undefined, "Formänderung setzt den zurückgenommenen Typ nicht wieder");
    l = typAutomatikZulassen(nachPush, [id]);
    assert.equal(l.koerper[0].bauteil_typ, "wand-tragend");
    assert.equal(l.koerper[0].bauteil_typ_quelle, "automatisch");
  });
  it("Nutzer-Typ wird nie überschrieben; automatischer Typ fällt weg, wenn keine Schwelle mehr greift", () => {
    const { layer, id } = mitKoerper(R(5, 0.3), 2.5);
    const hand = typSetzen(layer, [id], "wand-aussen");
    assert.equal(typAutomatik(hand, pushPull(hand, id, -2)).koerper[0].bauteil_typ, "wand-aussen");
    // 2.5 − 2.0 = 0.5 m high: no wall (< 1 m), no slab (area 1.5 m² ≤ 2) → automatic type removed
    const flach = typAutomatik(layer, pushPull(layer, id, -2));
    assert.equal(flach.koerper[0].bauteil_typ, undefined);
    assert.equal(flach.koerper[0].bauteil_typ_quelle, undefined);
    assert.throws(() => typSetzen(layer, [id], "gibtsnicht"), /Unbekannter Bauteiltyp/);
    assert.equal(typSetzen(layer, [id], "").koerper[0].bauteil_typ_quelle, "zurueckgenommen");
  });
  it("alte Körper bleiben untypisiert, bis ihre Form sich ändert; Verschieben und Drehen sind keine Formänderung", () => {
    const alt = { ...leererLayer(), koerper: [{ id: "k1", profil: R(0.4, 0.4), hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], naechsteId: 2 };
    const verschoben = { ...alt, koerper: alt.koerper.map((k) => ({ ...k, pos: { x: 3, y: 1 }, drehung: 45 })) };
    assert.equal(typAutomatik(alt, verschoben), verschoben, "nichts geändert");
    const hoeher = typAutomatik(alt, pushPull(alt, "k1", 0.5));
    assert.equal(hoeher.koerper[0].bauteil_typ, "stuetze");
    assert.notEqual(formSchluessel(alt, alt.koerper[0]), formSchluessel(hoeher, hoeher.koerper[0]));
  });
  it("Körper mit Innenring ist keine Box; Status wird normalisiert", () => {
    const l = koerperAnlegen(leererLayer(), R(6, 5), 0.3, { loecher: [[{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 }]] }).layer;
    assert.equal(koerperVorschlag(l, l.koerper[0]), null);
    assert.equal(statusSetzen(l, ["k1"], "Existing").koerper[0].status, "bestand");
    assert.equal("status" in statusSetzen(statusSetzen(l, ["k1"], "neubau"), ["k1"], "").koerper[0], false);
  });
});

describe("107-08 Task 1 — GUID lazy persistieren, Kopien ohne guid", () => {
  it("guidsSichern schreibt die heutige abgeleitete GUID; der Export bleibt Zeichen für Zeichen gleich", () => {
    const { model, opts } = ifcInstanzSzenario();
    const ohneGespeichert = JSON.parse(JSON.stringify(opts.massing));
    for (const k of ohneGespeichert.koerper) delete k.guid;
    const vorher = exportIFC(model, { ...opts, massing: ohneGespeichert });
    const gesichert = guidsSichern(ohneGespeichert, "p-golden");
    assert.ok(gesichert.koerper.every((k) => typeof k.guid === "string" && k.guid.length === 22));
    assert.equal(gesichert.koerper[0].guid, bauteilGuid("p-golden", "massing", { id: "k1" }));
    assert.equal(exportIFC(model, { ...opts, massing: gesichert }), vorher);
    assert.equal(guidsSichern(gesichert, "p-golden"), gesichert, "schon gesichert = dasselbe Objekt");
  });
  it("eine gespeicherte GUID gewinnt im Export (auch nach Projektkopie)", () => {
    const { model, opts } = ifcInstanzSzenario();
    const ifc = exportIFC(model, { ...opts, steckbrief: { projektId: "andere-kopie" } });
    assert.ok(ifc.includes("'3Stuetze0Gespeichert00'"));
  });
  it("*5-Kopie eines Körpers mit gespeicherter GUID: fünf Kopien, sechs verschiedene GlobalIds im IFC", () => {
    let l = guidsSichern(koerperAnlegen(leererLayer(), R(4, 3), 3).layer, "p1");
    const r = kopieren(l, ["k1"], { x: 6, y: 0 }, { anzahl: 5 });
    l = r.layer;
    assert.equal(r.neu.length, 5);
    assert.ok(r.neu.every((id) => !("guid" in /** @type {any} */ (l.koerper.find((k) => k.id === id)))));
    const guids = koerperGuids(exportIFC(modell(), { storeyHeight: 3, massing: l, steckbrief: { projektId: "p1" } })).map(([, g]) => g);
    assert.equal(guids.length, 6);
    assert.equal(new Set(guids).size, 6);
  });
  it("Dreh-Kopien und Lageplan-Blöcke lassen die guid weg; ohneGuid ändert sonst nichts", () => {
    const l = guidsSichern(koerperAnlegen(leererLayer(), R(4, 3), 3).layer, "p1");
    const d = drehKopien(l, ["k1"], { x: 0, y: 0 }, 90, { anzahl: 3 });
    assert.ok(d.neu.every((id) => !("guid" in /** @type {any} */ (d.layer.koerper.find((k) => k.id === id)))));
    let n = 0;
    const b = bloeckeKopieren([{ id: "b1", cx: 0, cy: 0, guid: "0123456789ABCDEFabcdef" }], ["b1"], 5, 0, () => `n${++n}`, 3);
    assert.ok(b.bloecke.filter((x) => x.id !== "b1").every((x) => !("guid" in x)));
    assert.deepEqual(ohneGuid({ id: "x", guid: "g", hoehe: 3 }), { id: "x", hoehe: 3 });
  });
  it("Anti-Sticky (VI.3): Körper und übernommene Elemente speichern keine freien Kanten oder Linienzüge", () => {
    const { layer } = mitKoerper(R(5, 0.3), 2.5);
    const erlaubt = new Set(["id", "name", "profil", "hoehe", "basis", "pos", "drehung", "gruppe", "loecher", "oeffnungen", "guid", "spiegel", "massstab", "bauteil_typ", "bauteil_typ_quelle", "status"]);
    for (const k of layer.koerper) for (const f of Object.keys(k)) assert.ok(erlaubt.has(f), `Körperfeld ${f}`);
    const ue = bauteileAusKoerper(layer, layer.koerper[0], { geschossHoehe_m: 3 });
    const verboten = /^(kanten|linien|edges|lines|polyline|polylinien|strokes|freieKanten|offeneKanten)$/;
    for (const w of [...ue.customWalls, ...ue.customSlabs, ...ue.customColumns]) for (const f of Object.keys(w)) assert.ok(!verboten.test(f), `Elementfeld ${f}`);
    for (const f of Object.keys(layer)) assert.ok(!verboten.test(f), `Layerfeld ${f}`);
  });
});

describe("107-08 Task 2 — Export mit und ohne Typ", () => {
  it("Golden mit Typen und Instanz-Typen (zweiter Golden des Plans)", () => {
    const { model, opts } = ifcInstanzSzenario();
    const ifc = exportIFC(model, opts);
    const pfad = fileURLToPath(new URL("./fixtures/ifc-golden-107-instanz.ifc", import.meta.url));
    if (!existsSync(pfad) && process.env.GOLDEN_SCHREIBEN === "1") writeFileSync(pfad, ifc);
    assert.equal(ifc, lies("ifc-golden-107-instanz.ifc"));
  });
  it("typisierter Körper: Klasse des Typs, dieselbe GlobalId wie als Proxy, Herkunft im Pset; ohne Typ Proxy", () => {
    const { model, opts } = ifcInstanzSzenario();
    const ohneTyp = JSON.parse(JSON.stringify(opts.massing));
    for (const k of ohneTyp.koerper) { delete k.bauteil_typ; delete k.bauteil_typ_quelle; }
    const a = exportIFC(model, { ...opts, instanzTypen: false });
    const b = exportIFC(model, { ...opts, instanzTypen: false, massing: ohneTyp });
    assert.match(a, /=IFCWALL\('[^']+',\$,'Wand',\$,'Massing',#\d+,#\d+,'k1',\.STANDARD\.\)/);
    assert.match(a, /=IFCCOLUMN\('3Stuetze0Gespeichert00',\$,'St\\X2\\00FC\\X0\\tze',\$,'Massing',#\d+,#\d+,'k2',\.COLUMN\.\)/);
    assert.match(a, /=IFCSLAB\('[^']+',\$,'Platte',\$,'Massing',#\d+,#\d+,'k3',\.FLOOR\.\)/);
    assert.match(a, /=IFCBUILDINGELEMENTPROXY\('[^']+',\$,'Block',/);
    assert.ok(a.includes("'Bauteiltyp_Herkunft',$,IFCLABEL('abgeleitet (Annahme)')"));
    assert.ok(a.includes("'Bauteiltyp_Herkunft',$,IFCLABEL('gesetzt')"));
    assert.deepEqual(koerperGuids(a), koerperGuids(b), "Typisieren ändert keine GlobalId");
    assert.equal(b.includes("IFCWALL('") && /IFCWALL\('[^']+',\$,'Wand',\$,'Massing'/.test(b), false);
  });
  it("Instanz-Typen: ein Proxy-Typ je Gruppennummer, MappedItem mit Spiegelung und Maßstab, nur mit Option", () => {
    const { model, opts } = ifcInstanzSzenario();
    const mit = exportIFC(model, opts);
    assert.equal((mit.match(/=IFCBUILDINGELEMENTPROXYTYPE\(/g) || []).length, 1);
    assert.equal((mit.match(/=IFCMAPPEDITEM\(/g) || []).length, 2);
    assert.equal((mit.match(/=IFCRELDEFINESBYTYPE\(/g) || []).length, 2);
    // k6: mirrored (Axis1 −x), scale x 1.5
    assert.ok(mit.includes("IFCDIRECTION((-1.,0.,0.))"));
    assert.match(mit, /IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM\(#\d+,#\d+,#\d+,1\.5000,#\d+,1\.0000,1\.0000\)/);
    const ohne = exportIFC(model, { ...opts, instanzTypen: false });
    assert.equal(ohne.includes("IFCMAPPEDITEM"), false);
    assert.equal(ohne.includes("IFCBUILDINGELEMENTPROXYTYPE"), false);
  });
});

describe("107-08 Task 4 — Pset-Felder mit Herkunft", () => {
  it("kennwerteVon: gesetzt, abgeleitet (Rw aus dem Aufbau, U aus λ und Dicke), offen", () => {
    // single24: Stahlbeton 0.24 m, λ 2.3 → R = 0.13 + 0.24/2.3 + 0.04 = 0.2743 → U = 3.65 W/(m²K)
    const w = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "single24" };
    const k = kennwerteVon(w, aufbauVon(w));
    assert.deepEqual(k.schallschutz_rw_db, { wert: 57, quelle: "abgeleitet" });
    assert.deepEqual(k.u_wert, { wert: 3.65, quelle: "abgeleitet" });
    assert.deepEqual(k.feuerwiderstand, { wert: null, quelle: "offen" });
    const gesetzt = kennwerteVon({ ...w, feuerwiderstand: "REI90", schallschutz_rw_db: 60, u_wert: 0.25 }, aufbauVon(w));
    assert.deepEqual([gesetzt.feuerwiderstand.quelle, gesetzt.schallschutz_rw_db.wert, gesetzt.u_wert.wert], ["gesetzt", 60, 0.25]);
    // thickness only: no material → U open
    assert.deepEqual(kennwerteVon({ thickness: 0.3 }, aufbauVon({ thickness: 0.3 })).u_wert, { wert: null, quelle: "offen" });
    assert.equal(uWertAusSchichten([{ material: "beton", dicke_m: 0.2 }, { material: "mw035", dicke_m: 0.16 }]), 0.21); // R = 0.13 + 0.04 + 0.2/2.3 + 0.16/0.035 = 4.828 → U = 0.207
  });
  it("Export schreibt FireRating, AcousticRating, ThermalTransmittance nur, wenn gesetzt", () => {
    const { model, opts } = ifcInstanzSzenario();
    const mit = exportIFC(model, opts);
    assert.ok(mit.includes("'FireRating',$,IFCLABEL('REI90')"));
    assert.ok(mit.includes("'AcousticRating',$,IFCLABEL('Rw 58 dB')"));
    assert.ok(mit.includes("'ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(0.2800)"));
    const ohneFelder = { ...opts, customWalls: opts.customWalls.map((/** @type {any} */ w) => { const { feuerwiderstand: _f, schallschutz_rw_db: _s, u_wert: _u, ...r } = w; return r; }) };
    const ohne = exportIFC(model, ohneFelder);
    for (const t of ["FireRating", "AcousticRating", "ThermalTransmittance", "Schallschutz_Rw_dB", "U_Wert"]) assert.equal(ohne.includes(`'${t}'`), false, t);
  });
});

describe("107-08 Task 5 — Instanz: Spiegel, Maßstab, Matrix", () => {
  it("instanzMatrix: T(pos, basis) · Rz(drehung) · S(±sx, sy, sz), spaltenweise", () => {
    // drehung 90°: c = 0, s = 1; mirror → sx = −2: column 0 = (c·sx, s·sx) = (0, −2); column 1 = (−s·1, c·1) = (−1, 0)
    assert.deepEqual(instanzMatrix(/** @type {any} */ ({ pos: { x: 1, y: 2 }, basis: 3, drehung: 90, massstab: { x: 2, y: 1, z: 1 }, spiegel: true })),
      [0, -2, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
    assert.deepEqual(instanzMatrix(/** @type {any} */ ({ pos: { x: 0, y: 0 }, basis: 0, drehung: 0 })), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    // the matrix maps a profile point exactly where geometrie() puts it
    const k = /** @type {any} */ ({ id: "k1", profil: R(4, 3), hoehe: 3, basis: 0, pos: { x: 10, y: 5 }, drehung: 30, gruppe: null, massstab: { x: 1.5, y: 1, z: 2 } });
    const M = instanzMatrix(k);
    const p = { x: 4, y: 3 };
    const welt = { x: M[0] * p.x + M[4] * p.y + M[12], y: M[1] * p.x + M[5] * p.y + M[13] };
    const g = geometrie({ ...leererLayer(), koerper: [k] }, k);
    assert.ok(g.profil.some((q) => Math.abs(q.x - welt.x) < 1e-5 && Math.abs(q.y - welt.y) < 1e-5));
    assert.equal(g.hoehe, 6); // 3 × massstab.z 2
  });
  it("geometrie: ohne Instanzfelder unverändert; gespiegelt normalisiert (Außenring positiv); skalieren mit instanz ändert nur die Instanz", () => {
    const l0 = gruppeBilden(koerperAnlegen(koerperAnlegen(leererLayer(), R(4, 3), 3).layer, R(4, 3), 3).layer, ["k1", "k2"]).layer;
    const vorher = geometrie(l0, l0.koerper[0]);
    const l1 = skalieren(l0, ["k2"], { x: 0, y: 0 }, 2, { instanz: true });
    assert.deepEqual(l1.gruppen["1"], l0.gruppen["1"], "Definition unverändert");
    assert.deepEqual(geometrie(l1, l1.koerper[0]), vorher, "andere Instanz unverändert");
    assert.deepEqual(l1.koerper[1].massstab, { x: 2, y: 2, z: 1 });
    const l2 = spiegeln(l1, ["k2"]);
    assert.equal(l2.koerper[1].spiegel, true);
    const g = geometrie(l2, l2.koerper[1]);
    let a = 0; for (let i = 0; i < g.profil.length; i++) { const q = g.profil[(i + 1) % g.profil.length]; a += g.profil[i].x * q.y - q.x * g.profil[i].y; }
    assert.ok(a > 0, "Außenring positiv nach Spiegelung");
    assert.equal(Math.abs(a) / 2, 48); // 8 × 6
    assert.equal("spiegel" in spiegeln(l2, ["k2"]).koerper[1], false, "zweimal spiegeln = Feld weg");
    assert.equal(instanzNeutral(skalieren(l1, ["k2"], { x: 0, y: 0 }, 0.5, { instanz: true }).koerper[1]), true);
    // the default still scales the definition (component rule)
    assert.notDeepEqual(skalieren(l0, ["k2"], { x: 0, y: 0 }, 2).gruppen["1"], l0.gruppen["1"]);
  });
  it("Formwerkzeuge im lokalen Rahmen lehnen eine skalierte Instanz ab; Push/Pull rechnet den z-Maßstab heraus", () => {
    let l = koerperAnlegen(leererLayer(), R(4, 3), 3).layer;
    l = { ...l, koerper: l.koerper.map((k) => ({ ...k, massstab: { x: 1, y: 1, z: 2 } })) };
    /** @type {any} */ let grund = null;
    assert.equal(eckeVerschieben(l, "k1", 1, { x: 6, y: 0 }, { abgelehnt: (pr) => { grund = pr.grund; } }), l);
    assert.equal(grund, "instanz");
    const p = pushPull(l, "k1", 1); // shown height 6 → 7: stored 3 + 1/2
    assert.equal(geometrie(p, p.koerper[0]).hoehe, 7);
  });
});

describe("107-08 Task 3 — Als Bauteil übernehmen", () => {
  it("Wand-Box: eine Wand je Geschoss auf der Mittellinie, Dicke = kurze Seite, Typ und quelle_koerper", () => {
    const { layer } = mitKoerper(R(5, 0.3), 5.5);
    const l = { ...layer, bezug: { x: 10, y: 10 } };
    const ue = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3, startIdx: 7 });
    assert.equal(ue.art, "wand");
    assert.equal(ue.customWalls.length, 2); // 0 … 5.5 m reaches storey 0 and 1
    const w = ue.customWalls[0];
    // centre line from the middle of the short side at x 0 to the one at x 5, y 0.15 → BIM x − 10, z 0.15 − 10
    assert.deepEqual([w.a, w.b], [{ x: -10, z: -9.85 }, { x: -5, z: -9.85 }]);
    assert.deepEqual([w.thickness, w.level, w.bauteil_typ, w.quelle_koerper, w._idx, w.oberkante_bezug], [0.3, 0, "wand-tragend", "k1", 7, "geschoss"]);
    assert.equal(ue.naechsterIdx, 9);
    // review 107-08: the second piece ends at the body top 5.5 m, not at the storey plane 6 m — 3.0 … 5.5 = 2.5 m, own height
    const w2 = ue.customWalls[1];
    assert.deepEqual([w2.level, w2.oberkante_bezug, w2.height, unterkante(w2, 3), wandHoehe(w2, 3)], [1, "absolut", 2.5, 3, 2.5]);
  });
  it("Stütze, Decke und untypisierter Körper (Hüllwände innen am Profil, Decke je Geschoss)", () => {
    const st = mitKoerper(R(0.5, 0.5), 3).layer;
    const s = bauteileAusKoerper(st, st.koerper[0]);
    assert.deepEqual([s.art, s.customColumns.length, s.customColumns[0].size, s.customColumns[0].x, s.customColumns[0].z], ["stuetze", 1, 0.5, 0.25, 0.25]);
    // review 107-08: the 6 × 5 × 0.25 m slab box on base 2.75 m (top on the ceiling plane 3.0 m) — see the slab test below
    const de0 = mitKoerper(R(6, 5), 0.25).layer;
    const de = { ...de0, koerper: de0.koerper.map((k) => ({ ...k, basis: 2.75 })) };
    const d = bauteileAusKoerper(de, de.koerper[0]);
    assert.deepEqual([d.art, d.customSlabs.length, d.customSlabs[0].dicke_m, d.customSlabs[0].bauteil_typ], ["decke", 1, 0.25, "decke"]);
    const bl = koerperAnlegen(leererLayer(), R(8, 6), 6).layer;
    const h = bauteileAusKoerper(bl, bl.koerper[0], { geschossHoehe_m: 3, composite: "cavity" });
    assert.equal(h.art, "huelle");
    assert.equal(h.customWalls.length, 8); // 4 edges × 2 storeys
    assert.equal(h.customSlabs.length, 2);
    // refLine "outside" puts the body on the inner side of the profile: its centre lies inside the outline
    for (const w of h.customWalls.slice(0, 4)) {
      const m = wandGeometrie(w, { dicke_m: 0.3 }).koerperMitte;
      assert.ok(punktInnen(R(8, 6).map((p) => ({ x: p.x, y: p.y })), { x: m.x, y: m.z }), JSON.stringify(m));
      assert.equal(w.composite, "cavity");
    }
  });
  it("Review: übernommene Decke liegt genau auf dem Körper (deckenLage = basis … basis + Höhe) oder wird abgelehnt", () => {
    /** @param {number} basis @param {number} h */
    const platte = (basis, h) => { const l = mitKoerper(R(6, 5), h).layer; return { ...l, koerper: l.koerper.map((k) => ({ ...k, basis })) }; };
    // top on the ceiling plane of storey 0 (3.0 m): level 0, bezug "oben" → 2.75 … 3.00
    let l = platte(2.75, 0.25);
    let sl = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customSlabs[0];
    assert.deepEqual([sl.level, sl.bezug], [0, "oben"]);
    assert.deepEqual(deckenLage(sl, 3), { unterkante_m: 2.75, oberkante_m: 3, dicke_m: 0.25 });
    // bottom on the ceiling plane 3.0 m (a slab standing on it): level 0, bezug "unten" → 3.00 … 3.25
    l = platte(3, 0.25);
    sl = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customSlabs[0];
    assert.deepEqual([sl.level, sl.bezug], [0, "unten"]);
    assert.deepEqual(deckenLage(sl, 3), { unterkante_m: 3, oberkante_m: 3.25, dicke_m: 0.25 });
    // second ceiling 6.0 m: top on it → level 1, 5.8 … 6.0
    l = platte(5.8, 0.2);
    sl = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customSlabs[0];
    assert.equal(sl.level, 1);
    assert.deepEqual([deckenLage(sl, 3).unterkante_m, deckenLage(sl, 3).oberkante_m].map((v) => Math.round(v * 1e6) / 1e6), [5.8, 6]);
    // the plan's box on base 0 (0 … 0.25 m) lies on no storey ceiling: refused, nothing to write (it landed at 2.75 … 3.00 before)
    l = platte(0, 0.25);
    const ab = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3, startIdx: 4 });
    assert.deepEqual([ab.art, ab.abgelehnt?.grund, ab.abgelehnt?.unterkante_m, ab.abgelehnt?.oberkante_m, ab.customSlabs.length, ab.naechsterIdx], ["abgelehnt", "lage", 0, 0.25, 0, 4]);
    // 1.2 … 1.45 m: neither edge on a ceiling plane
    l = platte(1.2, 0.25);
    assert.equal(bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).abgelehnt?.grund, "lage");
  });
  it("Review: Wand- und Stützen-Box behalten Körperhöhe und Basis (Brüstung 1,10 m, Basis 0,5 m)", () => {
    /** @param {any} profil @param {number} h @param {number} [basis] */
    const box = (profil, h, basis = 0) => { const l = mitKoerper(profil, h).layer; return { ...l, koerper: l.koerper.map((k) => ({ ...k, basis })) }; };
    let l = box(R(5, 0.3), 1.1);
    assert.equal(l.koerper[0].bauteil_typ, "wand-tragend");
    let w = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customWalls;
    assert.equal(w.length, 1);
    assert.deepEqual([w[0].oberkante_bezug, wandHoehe(w[0], 3), unterkante(w[0], 3)], ["absolut", 1.1, 0]);
    // a 2.5 m box on base 0.5 m ends on the plane 3.0 m: linked to the storey, lower edge 0.5 m, height 2.5 m
    l = box(R(5, 0.3), 2.5, 0.5);
    w = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customWalls;
    assert.deepEqual([w[0].oberkante_bezug, w[0].unterkante_versatz_m, unterkante(w[0], 3), wandHoehe(w[0], 3)], ["geschoss", 0.5, 0.5, 2.5]);
    // column 0.4 × 0.4 × 2.5 m on base 0: stuetzenHoehe 2.5 (oberkante_versatz −0.5 against the plane 3.0 m)
    l = box(R(0.4, 0.4), 2.5);
    const c = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customColumns;
    assert.deepEqual([c.length, c[0].oberkante_versatz_m, stuetzenHoehe(c[0], 3), unterkante(c[0], 3)], [1, -0.5, 2.5, 0]);
    // column 0.4 × 0.4 × 4 m on base 1: storey 0 piece 1 … 3, storey 1 piece 3 … 5
    l = box(R(0.4, 0.4), 4, 1);
    const c2 = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 }).customColumns;
    assert.deepEqual(c2.map((x) => [x.level, unterkante(x, 3), Math.round((unterkante(x, 3) + stuetzenHoehe(x, 3)) * 1e6) / 1e6]), [[0, 1, 3], [1, 3, 5]]);
  });
  it("Review: Typen ohne BIM-Element (Träger, Fundament, Flachdach, Bekleidung) und Wand/Stütze ohne Rechteck werden abgelehnt", () => {
    const { layer } = mitKoerper(R(5, 0.3), 0.5);
    for (const typ of ["traeger", "fundament", "dach-flach", "bekleidung"]) {
      const l = typSetzen(layer, ["k1"], typ);
      const ue = bauteileAusKoerper(l, l.koerper[0], { geschossHoehe_m: 3 });
      assert.deepEqual([ue.art, ue.abgelehnt?.grund, ue.abgelehnt?.typ, ue.customWalls.length + ue.customSlabs.length + ue.customColumns.length], ["abgelehnt", "typ", typ, 0], typ);
    }
    const L = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0.3, y: 0.3 }, { x: 0.3, y: 4 }, { x: 0, y: 4 }];
    const lw = typSetzen(koerperAnlegen(leererLayer(), L, 3).layer, ["k1"], "wand-tragend");
    assert.deepEqual([bauteileAusKoerper(lw, lw.koerper[0]).art, bauteileAusKoerper(lw, lw.koerper[0]).abgelehnt?.grund], ["abgelehnt", "profil"]);
    const ls = typSetzen(koerperAnlegen(leererLayer(), L, 3).layer, ["k1"], "stuetze");
    assert.equal(bauteileAusKoerper(ls, ls.koerper[0]).abgelehnt?.grund, "profil");
  });
  it("Review: Hüllwand-Dicke nur ohne Hüllaufbau; Hülle folgt Körperhöhe, Decke nur unter einer Geschossdecke im Körper", () => {
    const bl = koerperAnlegen(leererLayer(), R(8, 6), 4.5).layer;
    const ohne = bauteileAusKoerper(bl, bl.koerper[0], { geschossHoehe_m: 3 });
    assert.equal(UEBERNAHME_HUELLE_DICKE_M, 0.3);
    for (const w of ohne.customWalls) assert.deepEqual([w.thickness, "composite" in w], [0.3, false]);
    // 0 … 4.5 m: storey 0 walls 3 m linked, storey 1 walls 1.5 m own height; one ceiling slab (3.0 m), none at 6.0 m (above the body)
    assert.deepEqual(ohne.customWalls.filter((_, i) => i % 4 === 0).map((w) => [w.level, wandHoehe(w, 3)]), [[0, 3], [1, 1.5]]);
    assert.deepEqual(ohne.customSlabs.map((x) => x.level), [0]);
    const mit = bauteileAusKoerper(bl, bl.koerper[0], { geschossHoehe_m: 3, composite: "cavity" });
    for (const w of mit.customWalls) assert.deepEqual(["thickness" in w, w.composite], [false, "cavity"]);
  });
  it("Review: Menge eines Platten- und Fundament-Körpers aus Fläche bzw. Volumen, nicht aus einer Mittellinie", () => {
    const de = mitKoerper(R(6, 5), 0.25).layer;
    const el = koerperElement(de, de.koerper[0]);
    assert.deepEqual([el.a, el.b, el.flaeche_m2, el.volumen_m3], [undefined, undefined, 30, 7.5]);
    assert.deepEqual(steckbrief(el, "decke", { projektId: "p", quelle: "massing" }).menge, { wert: 30, einheit: "m2" });
    const fu = typSetzen(koerperAnlegen(leererLayer(), R(2, 1), 0.8).layer, ["k1"], "fundament");
    assert.deepEqual(steckbrief(koerperElement(fu, fu.koerper[0]), "fundament", { projektId: "p", quelle: "massing" }).menge, { wert: 1.6, einheit: "m3" });
    // a wall box keeps its centre line: 5 m × 2.5 m = 12.5 m²
    const wa = mitKoerper(R(5, 0.3), 2.5).layer;
    assert.deepEqual(steckbrief(koerperElement(wa, wa.koerper[0]), "wand-tragend", { projektId: "p", quelle: "massing" }).menge, { wert: 12.5, einheit: "m2" });
  });
  it("Review: ein übernommener typisierter Körper steht nicht zweimal als Bauteilklasse im IFC; Status eines Proxys nur wenn gesetzt", () => {
    const st = mitKoerper(R(0.5, 0.5), 3).layer;
    const ue = bauteileAusKoerper(st, st.koerper[0], { geschossHoehe_m: 3 });
    const ohne = exportIFC(modell(), { storeyHeight: 3, massing: st, steckbrief: { projektId: "p1" } });
    const mit = exportIFC(modell(), { storeyHeight: 3, massing: st, customColumns: ue.customColumns, steckbrief: { projektId: "p1" } });
    assert.equal((ohne.match(/=IFCCOLUMN\(/g) || []).length, 1, "nur der typisierte Körper");
    assert.equal((mit.match(/=IFCCOLUMN\(/g) || []).length, 1, "nur die übernommene Stütze");
    assert.match(mit, /=IFCBUILDINGELEMENTPROXY\('[^']{22}',\$,'[^']*',\$,'Massing',#\d+,#\d+,'k1',\.ELEMENT\.\)/);
    assert.ok(mit.includes("'Uebernommen_als_Bauteil',$,IFCBOOLEAN(.T.)"));
    assert.equal(ohne.includes("Uebernommen_als_Bauteil"), false);
    assert.deepEqual(koerperGuids(mit).filter(([id]) => id === "k1"), koerperGuids(ohne).filter(([id]) => id === "k1"), "dieselbe GlobalId");
    // status of an untyped body: Pset row + Pset_BuildingElementProxyCommon only when set
    const bl = koerperAnlegen(leererLayer(), R(8, 6), 3).layer;
    const a = exportIFC(modell(), { storeyHeight: 3, massing: bl, steckbrief: { projektId: "p1" } });
    const b = exportIFC(modell(), { storeyHeight: 3, massing: statusSetzen(bl, ["k1"], "Existing"), steckbrief: { projektId: "p1" } });
    assert.equal(a.includes("Pset_BuildingElementProxyCommon"), false);
    assert.ok(b.includes("'Status',$,IFCLABEL('bestand')"));
    assert.ok(b.includes("'Pset_BuildingElementProxyCommon'"));
    assert.ok(b.includes("'Status',$,IFCLABEL('EXISTING')"));
  });
  it("Übernahme zurücknehmen entfernt genau die Elemente dieses Körpers", () => {
    const m = { customWalls: [{ _idx: 1 }, { _idx: 2, quelle_koerper: "k1" }, { _idx: 3, quelle_koerper: "k2" }], customSlabs: [{ _idx: 4, quelle_koerper: "k1" }], customColumns: [] };
    assert.equal(istUebernommen(m, "k1"), true);
    const r = uebernahmeEntfernen(m, "k1");
    assert.equal(r.entfernt, 2);
    assert.deepEqual(r.customWalls.map((w) => w._idx), [1, 3]);
    assert.equal(istUebernommen(r, "k1"), false);
  });
});

describe("107-08 Task 6 — Adapter (englisches Schema nur als Übersetzung, D-BK-18) und Katalog", () => {
  it("Rundlauf: Element → Schema → Element behält die deutschen Felder", () => {
    const w = { a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 1, thickness: 0.3, refLine: "outside", composite: "single24", status: "neubau", feuerwiderstand: "REI90",
      schallschutz_rw_db: 58, u_wert: 0.3, oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: -0.2, unterkante_versatz_m: 0.1, bauteil_typ: "wand-tragend", _idx: 4 };
    const j = bauteilSchemaAus(w, { projektId: "p1", quelle: "customWalls", storeyHeight: 3 });
    assert.equal(j.guid, bauteilGuid("p1", "customWalls", w));
    assert.deepEqual(j.ifc_classification, { schema: "IFC4", entity: "IfcWall", predefined_type: "STANDARD", source: "set" });
    assert.deepEqual(j.pset_common, { IsExternal: false, LoadBearing: true, FireRating: "REI90", AcousticRating: 58, ThermalTransmittance: 0.3 });
    assert.equal(j.renovation_status, "New");
    assert.deepEqual([j.spatial_linking.home_story_id, j.spatial_linking.home_story_elevation, j.spatial_linking.top_link_story_id], [1, 3, 2]);
    assert.equal(j.structure?.total_thickness, 0.24);
    const zurueck = elementAusSchema(JSON.parse(JSON.stringify(j)), { guidUebernehmen: true });
    for (const f of ["a", "b", "level", "refLine", "composite", "status", "feuerwiderstand", "schallschutz_rw_db", "u_wert", "oberkante_bezug", "oberkante_geschosse", "oberkante_versatz_m", "unterkante_versatz_m", "bauteil_typ"]) {
      assert.deepEqual(zurueck[f], /** @type {any} */ (w)[f], f);
    }
    assert.equal(zurueck.guid, j.guid);
    assert.equal("guid" in elementAusSchema(JSON.parse(JSON.stringify(j))), false, "GUID nur auf Wunsch");
    // nothing English is stored: every key of the patch is a German/stored field name
    for (const f of Object.keys(zurueck)) assert.ok(!/^(ifc_classification|pset_common|spatial_linking|renovation_status|container|geometry|structure)$/.test(f));
  });
  it("Massing-Körper mit Matrix; unbekannte Klasse bleibt ifc_klasse; Text-Rating wird gelesen", () => {
    const { layer } = mitKoerper(R(0.5, 0.5), 3);
    const k = layer.koerper[0];
    const j = bauteilSchemaAus(koerperElement(layer, k), { quelle: "massing", matrix: instanzMatrix(k) });
    assert.equal(j.ifc_classification.entity, "IfcColumn");
    assert.equal(j.container.transformation_matrix?.length, 16);
    assert.deepEqual(elementAusSchema({ ifc_classification: { schema: "IFC4", entity: "IfcChimney", predefined_type: "NOTDEFINED" }, pset_common: /** @type {any} */ ({ AcousticRating: "Rw 52 dB" }) }),
      { ifc_klasse: "IfcChimney", ifc_typ: "NOTDEFINED", schallschutz_rw_db: 52 });
    assert.deepEqual(elementAusSchema(null), {});
  });
  it("Statuskatalog kennt temporaer und die Spec-Wörter", () => {
    assert.deepEqual(["Existing", "New", "Demolition", "Temporary", "TEMPORARY", "temporaer"].map((s) => normalisiereStatus(s)), ["bestand", "neubau", "abbruch", "temporaer", "temporaer", "temporaer"]);
  });
  it("Review: auch der büroweite Katalog-Seed (Snapshot) kennt temporaer und die Spec-Wörter", () => {
    const snap = catalogSeed();
    assert.deepEqual(["Existing", "New", "Demolition", "Temporary", "TEMPORARY", "temporaer", "?"].map((s) => normalisiereStatus(s, snap)), ["bestand", "neubau", "abbruch", "temporaer", "temporaer", "temporaer", null]);
  });
  it("Review: Rundlauf mit nur abgeleiteten Werten erzeugt keine neuen Felder; ohne GUID-Quelle Fehler", () => {
    // composite single24 (R'w from the build-up, U from λ), type from the thickness rule, fire resistance "ohne"; nothing else set
    const w = { a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, thickness: 0.24, composite: "single24", feuerwiderstand: "ohne", _idx: 9 };
    const j = bauteilSchemaAus(w, { projektId: "p1", quelle: "customWalls", storeyHeight: 3 });
    assert.deepEqual([j.pset_common.FireRating, j.pset_common.AcousticRating, j.pset_common.ThermalTransmittance], [null, null, null]);
    assert.ok(Number(j.pset_common_derived.AcousticRating) > 0 && Number(j.pset_common_derived.ThermalTransmittance) > 0, JSON.stringify(j.pset_common_derived));
    assert.equal(j.ifc_classification.source, "derived");
    assert.equal(j.guid, bauteilGuid("p1", "customWalls", w));
    const zurueck = elementAusSchema(JSON.parse(JSON.stringify(j)));
    for (const f of ["schallschutz_rw_db", "u_wert", "bauteil_typ", "guid", "feuerwiderstand"]) assert.equal(f in zurueck, false, f);
    for (const f of Object.keys(zurueck)) assert.deepEqual(zurueck[f], /** @type {any} */ (w)[f], `kein neues oder geändertes Feld: ${f}`);
    // the automatic type of a body is derived as well
    const { layer } = mitKoerper(R(5, 0.3), 2.5);
    const jk = bauteilSchemaAus(koerperElement(layer, layer.koerper[0]), { quelle: "massing" });
    assert.equal(jk.ifc_classification.source, "derived");
    assert.equal("bauteil_typ" in elementAusSchema(jk), false);
    assert.throws(() => bauteilSchemaAus(w, { projektId: "p1" }), /GUID-Quelle/);
  });
});
