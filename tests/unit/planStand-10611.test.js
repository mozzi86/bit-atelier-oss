// 106-11: plans carry the model state; unreleased AI changes stand on the sheet ("Enthält ungeprüfte KI-Änderungen") with a mark
// on each affected element, and the note disappears only after a release. The plan list flags a plan whose model changed.
// Covers the pure core (@core/lib/zeigen/planStand.js), the marks of planGrafik, the PDF (title block, note box, keywords) and the DXF.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import { PDFDocument } from "pdf-lib";
import {
  MODELLSTAND_KENNUNG, VERMERK_TITEL, VERMERK_UNBEKANNT_TITEL, kiMarkierungen, markenRahmen, modellKennung, modellStand, modellStandUnbekannt,
  modellstandLesen, modellstandMetadaten, modellstandText, planModellstand, planStandVergleich, projektKennung, ungespeicherteFelder,
  vermerkNoetig, vermerkZeilen,
} from "@core/lib/zeigen/planStand.js";
import { oeffnungGuid } from "@core/lib/zeigen/aenderungen.js";
import { huellwandGuid } from "@designer/lib/bauteilInfo.js";
import { feuerwehrplanLayout } from "@designer/lib/feuerwehrplanPdf";
import { modellstandAusPdf } from "@core/lib/zeigen/planStandLaden.js";
import { planGrafik, schnittGrafik, vektorPlanPdf, winAnsi } from "@designer/lib/vektorPlan";
import { grundrissDxfDaten, dxfDatei } from "@designer/lib/dxfPlaene";
import { createBuildingModel } from "@core/lib/buildingModel";
import { brilleVon } from "@core/lib/plan/brillen.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

const guid = (/** @type {string} */ s) => s.padEnd(22, "x").slice(0, 22);
const GA = guid("PlanWandA10611"), GB = guid("PlanWandB10611");
const MODELL = {
  updated_date: "2026-10-26T10:15:00.000Z",
  customWalls: [
    { a: { x: 0, z: 0 }, b: { x: 8, z: 0 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau" },
    { a: { x: 0, z: 6 }, b: { x: 8, z: 6 }, level: 0, height: 3, thickness: 0.3, _idx: 2, guid: GB, status: "neubau" },
  ],
  customColumns: [{ x: 4, z: 3, size: 0.4, level: 0, _idx: 3 }],
};
/** A step record as 106-10 stores it. */
const schritt = (/** @type {Record<string, any>} */ o) => ({ project_id: "p1", quelle: "bim", vorschlag_id: o.id, art: "eigenschaft", zeit: o.zeit,
  ziel: { guid: o.guid, name: o.name, quelle: "bim" }, herkunft: o.herkunft, herkunft_quellen: o.quellen ?? [o.herkunft], satz: "…",
  zurueckgenommen: o.zurueck ?? null, freigabe: o.frei ? { status: "freigegeben", durch: "Prüferin", zeit: "2026-10-26T11:00:00Z" } : null });
const S1 = schritt({ id: "a1", zeit: "2026-10-26T10:00:00Z", guid: GA, name: "Wand W-1", herkunft: "sprache", quellen: ["sprache", "agent"] });
const S2 = schritt({ id: "a2", zeit: "2026-10-26T10:05:00Z", guid: GB, name: "Wand W-2", herkunft: "agent", quellen: ["agent", "bild"] });
const S3 = schritt({ id: "h3", zeit: "2026-10-26T10:06:00Z", guid: GB, name: "Wand W-2", herkunft: "hand" });
const IFC = { ...schritt({ id: "i4", zeit: "2026-10-26T10:07:00Z", guid: guid("IfcWand"), name: "IFC-Wand", herkunft: "agent" }), quelle: "ifc" };

/** All text of the page content streams of a PDF, decoded (pdf-lib writes WinAnsi hex strings, mostly Flate-compressed). */
async function pdfText(/** @type {Uint8Array} */ bytes) {
  const doc = await PDFDocument.load(bytes);
  let roh = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const o = /** @type {any} */ (obj);
    if (!o?.contents || !o.dict) continue;
    const filter = String(o.dict.get?.(o.dict.context.obj("Filter")) ?? "");
    roh += (filter.includes("FlateDecode") ? zlib.inflateSync(Buffer.from(o.contents)) : Buffer.from(o.contents)).toString("latin1");
  }
  return [...roh.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("\n");
}

test("Modellstand: Zeit, Zahl der Änderungen, Kennung; ungeprüfte KI-Schritte mit kombinierter Herkunft (D-IM-07)", () => {
  const st = modellStand({ modell: MODELL, schritte: [S1, S2, S3, IFC] });
  assert.equal(st.ermittelt, true);
  assert.equal(st.zeit, MODELL.updated_date);
  assert.equal(st.aenderungen, 3, "drawn-element steps only (the IFC journal step does not reach a BIM studio plan)");
  assert.equal(st.ungeprueft, 2, "the by-hand step needs no review");
  assert.deepEqual(st.guids, [GA, GB]);
  assert.deepEqual(st.herkunft_quellen, ["sprache", "agent", "bild"]);
  assert.deepEqual(st.betroffen, ["Wand W-1", "Wand W-2"]);
  assert.match(st.kennung, /^[0-9a-f]{16}$/);
  assert.match(modellstandText(st), /^\d\d\.\d\d\.2026 \d\d:\d\d · 3 erfasste Änderungsschritte · Kennung [0-9a-f]{8}$/);
  assert.equal(modellStand({ modell: MODELL, schritte: [S1, S2, S3, IFC], quelle: "alle" }).ungeprueft, 3);
});

test("Kennung: gleich bei gleichem Inhalt (Schlüsselreihenfolge egal), anders bei geänderter Zeichnung; Skizze zählt nicht", () => {
  const umsortiert = { customColumns: MODELL.customColumns, customWalls: MODELL.customWalls.map((w) => ({ guid: w.guid, ...w })) };
  assert.equal(modellKennung(umsortiert), modellKennung(MODELL));
  const verschoben = { ...MODELL, customWalls: [{ ...MODELL.customWalls[0], a: { x: 0.5, z: 0 } }, MODELL.customWalls[1]] };
  assert.notEqual(modellKennung(verschoben), modellKennung(MODELL));
  assert.equal(modellKennung({ ...MODELL, sketch_layer: "{}", updated_date: "2027-01-01" }), modellKennung(MODELL));
  assert.equal(modellKennung(null), "");
});

test("Vermerk erscheint bei ungeprüften KI-Änderungen und verschwindet nach Freigabe", () => {
  const vorher = modellStand({ modell: MODELL, schritte: [S1, S2] });
  const v = vermerkZeilen(vorher, undefined, { markiert: 2 });
  assert.ok(v);
  assert.equal(v.titel, VERMERK_TITEL);
  assert.equal(v.form, "gestrichelt");
  assert.equal(v.zeichen, "?");
  assert.ok(v.zeilen[0].includes("2 Schritte") && v.zeilen[0].includes("Herkunft: Spracheingabe + Agent + Bildkontext"), v.zeilen[0]);
  assert.ok(v.zeilen[1].includes("Wand W-1, Wand W-2"));
  assert.ok(v.zeilen.some((z) => z.includes("2 von 2 Bauteilen")));
  // one released → still a note for the other
  const teil = modellStand({ modell: MODELL, schritte: [{ ...S1, freigabe: { status: "freigegeben", durch: "P", zeit: "x" } }, S2] });
  assert.equal(teil.ungeprueft, 1);
  assert.ok(vermerkZeilen(teil)?.zeilen[0].startsWith("1 Schritt"));
  // both released → no note; a reversed AI step is no longer unreviewed either
  const frei = modellStand({ modell: MODELL, schritte: [{ ...S1, freigabe: { status: "freigegeben", durch: "P", zeit: "x" } }, { ...S2, zurueckgenommen: { zeit: "y", ort: "freigabe" } }] });
  assert.equal(frei.ungeprueft, 0);
  assert.equal(vermerkNoetig(frei), false);
  assert.equal(vermerkZeilen(frei), null);
});

test("Fail-safe: ein nicht ermittelter oder fehlender Stand trägt einen Vermerk (kein sauberes Blatt ohne Nachweis)", () => {
  assert.equal(vermerkNoetig(null), true);
  assert.equal(vermerkNoetig(undefined), true);
  const u = vermerkZeilen(modellStandUnbekannt("Laden fehlgeschlagen: offline"));
  assert.equal(u?.titel, VERMERK_UNBEKANNT_TITEL);
  assert.ok(u?.zeilen.some((z) => z.includes("offline")));
  assert.match(modellstandText(null), /^nicht ermittelt/);
});

test("Metadaten-Zeile: hin und zurück, fremder Text → null", () => {
  const st = modellStand({ modell: MODELL, schritte: [S1, S2, S3] });
  const z = modellstandMetadaten(st);
  assert.ok(z.startsWith(`${MODELLSTAND_KENNUNG} v1 `));
  assert.ok(/^[\x20-\x7e]+$/.test(z), "ASCII only");
  assert.deepEqual(modellstandLesen(`Plan ${z} weiteres`), planModellstand(st));
  assert.equal(modellstandLesen("irgendein PDF"), null);
  assert.deepEqual(modellstandLesen(modellstandMetadaten(null)), { ermittelt: false, kennung: "", zeit: null, aenderungen: 0, ungeprueft: 0, projekt: "" });
  // a line of the first 106-11 build (without projekt=) is still read
  assert.equal(modellstandLesen(`${MODELLSTAND_KENNUNG} v1 ermittelt=1 kennung=ab zeit=- aenderungen=1 ungeprueft=0`)?.projekt, "");
});

test("Planliste: aktuell / veraltet / Vermerk offen / Vermerk überholt / ohne Modellstand", () => {
  const ausgabe = planModellstand(modellStand({ modell: MODELL, schritte: [S1, S2] }));
  assert.deepEqual(planStandVergleich(ausgabe, modellStand({ modell: MODELL, schritte: [S1, S2] })), {
    status: "aktuell", vermerk: "offen",
    hinweise: [{ code: "vermerk_offen", stufe: "warn", text: "Blatt trägt den Vermerk „enthält ungeprüfte KI-Änderungen“ — erst nach Freigabe gültig" }],
  });
  const freigegeben = modellStand({ modell: MODELL, schritte: [S1, S2].map((s) => ({ ...s, freigabe: { status: "freigegeben", durch: "P", zeit: "x" } })) });
  const r = planStandVergleich(ausgabe, freigegeben);
  assert.equal(r.status, "aktuell");
  assert.equal(r.vermerk, "ueberholt");
  const geaendert = { ...MODELL, customWalls: [{ ...MODELL.customWalls[0], a: { x: 1, z: 0 } }, MODELL.customWalls[1]] };
  const v = planStandVergleich(ausgabe, modellStand({ modell: geaendert, schritte: [S1, S2] }));
  assert.equal(v.status, "veraltet");
  assert.ok(v.hinweise.some((h) => h.code === "veraltet" && h.stufe === "warn"));
  assert.equal(planStandVergleich(null, freigegeben).status, "ohne");
  assert.equal(planStandVergleich({ ...ausgabe, ermittelt: false }, freigegeben).status, "unbekannt");
  assert.equal(planStandVergleich(ausgabe, modellStandUnbekannt("x")).status, "unbekannt");
  // a clean plan, then an AI change arrives (content changed) → outdated AND says so
  const sauber = planModellstand(modellStand({ modell: MODELL, schritte: [] }));
  const neu = planStandVergleich(sauber, modellStand({ modell: geaendert, schritte: [S1] }));
  assert.equal(neu.status, "veraltet");
  assert.ok(neu.hinweise.some((h) => h.code === "neu_ungeprueft"));
});

test("Markierung: Rahmen außerhalb des Bauteils, nur gezeichnete Bauteile, GUID abgeleitet wie im Studio", () => {
  const g = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customWalls: MODELL.customWalls, customColumns: MODELL.customColumns, kiMarken: { guids: [GA, "nichtImPlanxxxxxxxxxxx"], projektId: "p1" } });
  assert.deepEqual(g.markiert, [GA]);
  const rahmen = g.elemente.filter((e) => e.ebene === "ki_vermerk" && e.art === "poly");
  assert.equal(rahmen.length, 1);
  assert.equal(/** @type {any} */ (rahmen[0]).dash, "2 1", "dashed = ungeprüft (form, not only colour)");
  // the wall body spans z -0.15…0.15; the frame lies 1.5 mm on paper (0.15 m at 1:100) outside
  const zs = /** @type {any} */ (rahmen[0]).pts.map((/** @type {any} */ p) => p.z);
  assert.ok(Math.abs(Math.min(...zs) - -0.3) < 1e-9 && Math.abs(Math.max(...zs) - 0.3) < 1e-9, zs.join(","));
  assert.ok(g.elemente.some((e) => e.ebene === "ki_vermerk" && e.art === "text" && e.text === "?"));
  // column without stored GUID: derived from project + source + _idx
  const gs = bauteilGuid("p1", "customColumns", MODELL.customColumns[0]);
  assert.deepEqual(planGrafik({ model: { walls: [] }, level: 0, customColumns: MODELL.customColumns, kiMarken: { guids: [gs], projektId: "p1" } }).markiert, [gs]);
  // without marks the plan is unchanged (104-06 layers)
  assert.ok(!planGrafik({ model: { walls: [] }, level: 0, customWalls: MODELL.customWalls }).elemente.some((e) => e.ebene === "ki_vermerk"));
  // screen marks from the model (same outline, other storey filtered by the caller)
  const m = kiMarkierungen(MODELL, [GA, GB, guid("weg")], { projektId: "p1" });
  assert.deepEqual(m.map((x) => [x.guid, x.kurzname, x.level]), [[GA, "Wand W-1", 0], [GB, "Wand W-2", 0]]);
  assert.equal(markenRahmen(m[0].punkte, 0.1).length, 4);
});

test("PDF Grundriss: Plankopf mit Modellstand, Vermerk-Kasten, Schlüsselwörter; nach Freigabe ohne Vermerk", async () => {
  const st = modellStand({ modell: MODELL, schritte: [S1, S2] });
  const g = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customWalls: MODELL.customWalls, kiMarken: { guids: st.guids, projektId: "p1" } });
  const a = await vektorPlanPdf(g, { massstab: 100, projekt: "Testprojekt", planinhalt: "Grundriss EG", brille: brilleVon("eingabe"), datum: "26.10.2026", modellstand: st });
  assert.equal(a.vermerk, true);
  assert.equal(a.format, "A3");
  const text = await pdfText(a.bytes);
  assert.ok(text.includes("Modellstand"), "title block row");
  assert.ok(text.includes(modellstandText(st)), "title block value");
  assert.ok(text.includes(VERMERK_TITEL), "note headline");
  assert.ok(text.includes("Herkunft: Spracheingabe + Agent + Bildkontext"));
  assert.ok(text.includes("2 von 2 Bauteilen"));
  assert.deepEqual(await modellstandAusPdf(a.bytes), planModellstand(st));

  const frei = modellStand({ modell: MODELL, schritte: [S1, S2].map((s) => ({ ...s, freigabe: { status: "freigegeben", durch: "P", zeit: "x" } })) });
  const g2 = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customWalls: MODELL.customWalls, kiMarken: { guids: frei.guids, projektId: "p1" } });
  const b = await vektorPlanPdf(g2, { massstab: 100, projekt: "Testprojekt", planinhalt: "Grundriss EG", modellstand: frei });
  assert.equal(b.vermerk, false);
  const t2 = await pdfText(b.bytes);
  assert.ok(!t2.includes(VERMERK_TITEL) && t2.includes("Modellstand"));
  assert.equal((await modellstandAusPdf(b.bytes))?.ungeprueft, 0);
});

test("PDF ohne Modellstand (Aufrufer lässt ihn weg) trägt „nicht ermittelt“ — kein Schalter für ein Blatt ohne Vermerk", async () => {
  const g = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customWalls: MODELL.customWalls });
  const r = await vektorPlanPdf(g, { massstab: 100, projekt: "T", planinhalt: "Grundriss EG" });
  assert.equal(r.vermerk, true);
  const text = await pdfText(r.bytes);
  assert.ok(text.includes(VERMERK_UNBEKANNT_TITEL));
  assert.equal((await modellstandAusPdf(r.bytes))?.ermittelt, false);
  assert.equal(await modellstandAusPdf(new TextEncoder().encode("%PDF-1.4 kaputt")), null);
});

test("PDF Schnitt (100-01): Vermerk und Modellstand auch auf dem Schnitt", async () => {
  const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
  const st = modellStand({ modell: MODELL, schritte: [S2] });
  const r = await vektorPlanPdf(schnittGrafik({ model, storeyHeight: 3, massstab: 100 }), { massstab: 100, projekt: "T", planinhalt: "Schnitt", modellstand: st });
  assert.equal(r.vermerk, true);
  const text = await pdfText(r.bytes);
  assert.ok(text.includes(VERMERK_TITEL) && text.includes("Herkunft: Agent + Bildkontext"));
  assert.ok(text.includes("0 von 1 Bauteilen"), "the section marks nothing and says so (review 106-11)");
});

test("Unkodierbare Zeichen im Bauteilnamen brechen das PDF nicht", async () => {
  assert.equal(winAnsi("Wand ✓ „W-1“ — 5 €"), "Wand ? „W-1“ — 5 €");
  const st = modellStand({ modell: MODELL, schritte: [{ ...S1, ziel: { guid: GA, name: "Wand 🙂 W-1" } }] });
  const g = planGrafik({ model: { walls: [] }, level: 0, customWalls: MODELL.customWalls, kiMarken: { guids: st.guids, projektId: "p1" } });
  const r = await vektorPlanPdf(g, { massstab: 100, modellstand: st });
  assert.ok((await pdfText(r.bytes)).includes("Wand ? W-1"));
});

test("DXF Grundriss: Modellstand im Kopf, sichtbarer Vermerk + gestrichelte Markierung auf A_KI_VERMERK; ohne Stand unverändert (104-06)", () => {
  const st = modellStand({ modell: MODELL, schritte: [S1] });
  const g = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customWalls: MODELL.customWalls, kiMarken: { guids: st.guids, projektId: "p1" } });
  const d = grundrissDxfDaten(g, { massstab: 100, geschoss: "EG", projekt: "T", modellstand: st });
  assert.equal(d.vermerk, true);
  assert.ok(d.kommentar.includes(modellstandMetadaten(st)));
  assert.ok(d.kommentar.some((k) => k.startsWith("Modellstand: ") && /^[\x20-\x7e]+$/.test(k)));
  assert.ok(d.kommentar.some((k) => k.startsWith("ACHTUNG: Enthaelt ungepruefte KI-Aenderungen")));
  assert.equal(d.ebenen.find((e) => e.name === "A_KI_VERMERK")?.linientyp, "STRICH");
  const texte = d.elemente.filter((e) => e.art === "text" && e.ebene === "A_KI_VERMERK").map((e) => /** @type {any} */ (e).text);
  assert.ok(texte.some((t) => t === `?  ${VERMERK_TITEL}`), texte.join(" | "));
  assert.ok(texte.some((t) => t.includes("Herkunft: Spracheingabe + Agent")));
  assert.ok(d.elemente.some((e) => e.art === "polylinie" && e.ebene === "A_KI_VERMERK"));
  assert.ok(d.elemente.some((e) => e.art === "text" && e.ebene === "A_PLANKOPF" && /** @type {any} */ (e).text.startsWith("Modellstand: ")));
  const { text } = dxfDatei(d);
  assert.ok(text.includes("A_KI_VERMERK") && text.includes(MODELLSTAND_KENNUNG));
  // after release: state line, no note
  const stFrei = modellStand({ modell: MODELL, schritte: [{ ...S1, freigabe: { status: "freigegeben", durch: "P", zeit: "x" } }] });
  const gFrei = planGrafik({ model: { walls: [] }, level: 0, massstab: 100, customWalls: MODELL.customWalls, kiMarken: { guids: stFrei.guids, projektId: "p1" } });
  const frei = grundrissDxfDaten(gFrei, { massstab: 100, modellstand: stFrei });
  assert.equal(frei.vermerk, false);
  assert.ok(!frei.elemente.some((e) => e.art === "text" && e.ebene === "A_KI_VERMERK"));
  // null = could not be determined → the note says so
  assert.equal(grundrissDxfDaten(g, { massstab: 100, modellstand: null }).vermerk, true);
  // no state handed in: the 104-06 translation, plus only the comment "nicht ermittelt"
  const alt = grundrissDxfDaten(planGrafik({ model: { walls: [] }, level: 0, customWalls: MODELL.customWalls }), { massstab: 100 });
  assert.equal(alt.vermerk, false);
  assert.ok(!alt.elemente.some((e) => e.ebene === "A_PLANKOPF" || e.ebene === "A_KI_VERMERK"));
  assert.ok(alt.kommentar.some((k) => k.includes("ermittelt=0")));
});

// ---- review 106-11 ----

test("Review: Geschosstabelle, Aufbauten, Achse und Werkstatt-Layer ändern die Kennung → Plan „veraltet“; Speicherstempel nicht", () => {
  const basis = { ...MODELL, geschosse: [{ hoehe_m: 3 }, { hoehe_m: 3 }], aufbauten_layer: { aufbauten: { "p-1": { name: "AW", skins: [{ thickness: 240 }] } } } };
  const k = modellKennung(basis);
  assert.notEqual(modellKennung({ ...basis, geschosse: [{ hoehe_m: 4 }, { hoehe_m: 3 }] }), k, "storey table");
  assert.notEqual(modellKennung({ ...basis, aufbauten_layer: { aufbauten: { "p-1": { name: "AW", skins: [{ thickness: 300 }] } } } }), k, "build-up thickness");
  assert.notEqual(modellKennung({ ...basis, achseM: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }), k, "centre line");
  assert.notEqual(modellKennung({ ...basis, werkstatt_layer: { riegel: [1] } }), k, "workshop layer");
  // the same content saved again (new stamp) is no change; a record without storeys draws the default 4 × 3 m
  assert.equal(modellKennung({ ...basis, aufbauten_layer: { ...basis.aufbauten_layer, v: 1, updatedAt: "2027-01-01T00:00:00Z" } }), k);
  assert.equal(modellKennung({ ...MODELL, storeys: 4, storeyHeight: 3, achseM: null, geschosse: [] }), modellKennung(MODELL));
  const ausgabe = planModellstand(modellStand({ modell: basis, schritte: [] }));
  assert.equal(planStandVergleich(ausgabe, modellStand({ modell: { ...basis, geschosse: [{ hoehe_m: 4 }, { hoehe_m: 3 }] }, schritte: [] })).status, "veraltet");
});

test("Review: ungespeicherte Felder — Live-Stand des Studios gegen den gespeicherten Datensatz", () => {
  const gespeichert = { ...MODELL, storeys: 2, geschosse: [{ hoehe_m: 3 }], bauteil_attribute_layer: { attribute: { "hull-wall": { status: "neubau" } }, v: 1, updatedAt: "x" } };
  // equal content (stamps aside, defaults the hook loads) → nothing open
  assert.deepEqual(ungespeicherteFelder(gespeichert, { storeys: 2, storeyHeight: 3, geschosse: [{ hoehe_m: 3 }], achseM: null, footprintM: null,
    bauteil_attribute_layer: { attribute: { "hull-wall": { status: "neubau" } } }, aufbauten_layer: { aufbauten: {} } }), []);
  // a storey table not yet written by the debounced hook → the sheet must not carry the stored Kennung
  assert.deepEqual(ungespeicherteFelder(gespeichert, { storeys: 2, geschosse: [{ hoehe_m: 3.5 }] }), ["geschosse"]);
  assert.deepEqual(ungespeicherteFelder(null, { storeys: 4 }), []);
  assert.deepEqual(ungespeicherteFelder(null, { storeys: 3 }), ["storeys"]);
  // fields outside the fingerprint are ignored
  assert.deepEqual(ungespeicherteFelder(gespeichert, { sketch_layer: "{}" }), []);
});

test("Review: Projektbindung — Blatt eines anderen Projekts liest nicht „aktuell“; Ladefehler-Grund mit festem Schlüssel", () => {
  const a = modellStand({ modell: { ...MODELL, project_id: "pA" }, schritte: [] });
  const b = modellStand({ modell: MODELL, schritte: [], projektId: "pB" });
  assert.equal(a.projekt, projektKennung("pA"));
  assert.match(modellstandMetadaten(a), / projekt=[0-9a-f]{8}$/);
  assert.equal(a.kennung, b.kennung, "same content, same Kennung");
  const v = planStandVergleich(planModellstand(a), b);
  assert.equal(v.status, "unbekannt");
  assert.ok(v.hinweise.some((h) => h.code === "anderes_projekt"));
  assert.equal(planStandVergleich(planModellstand(a), modellStand({ modell: MODELL, schritte: [], projektId: "pA" })).status, "aktuell");
  const u = modellStandUnbekannt("Laden fehlgeschlagen", "offline");
  const en = (/** @type {string} */ k) => (k === "Laden fehlgeschlagen" ? "loading failed" : k);
  assert.ok(vermerkZeilen(u, en)?.zeilen.includes("Grund: loading failed: offline"), "the key is translated, the error text goes along");
  assert.equal(modellstandText(u, en), "nicht ermittelt (loading failed: offline)");
});

test("Review: Markierung von Hüllwänden und geänderten Öffnungen (Rahmen um die gezeichnete Wirtswand)", () => {
  const model = createBuildingModel({ footprintM: null, storeys: 1, storeyHeight: 3 });
  const hw = model.walls.find((/** @type {any} */ w) => w.level === 0);
  const gHuelle = huellwandGuid("p1", hw.level, hw.edge);
  const fenster = { wallIdx: 2, u: 2, kind: "window", _idx: 7 };
  const huellFenster = { level: hw.level, edge: hw.edge, u: 1, kind: "door", _idx: 8 };
  const gF = oeffnungGuid("p1", fenster, false), gH = oeffnungGuid("p1", huellFenster, true);
  const g = planGrafik({ model, level: 0, massstab: 100, customWalls: MODELL.customWalls, customWindows: [fenster], envOpenings: [huellFenster],
    kiMarken: { guids: [gHuelle, gF, gH], projektId: "p1" } });
  assert.deepEqual([...g.markiert].sort(), [gHuelle, gF, gH].sort());
  // the window's frame lies around its host wall W-2 (z = 6 ± 0.15 + 0.15)
  const rahmenF = /** @type {any} */ (g.elemente.find((e) => e.ebene === "ki_vermerk" && e.art === "poly" && e.guid === gF));
  assert.ok(rahmenF && Math.abs(Math.max(...rahmenF.pts.map((/** @type {any} */ p) => p.z)) - 6.3) < 1e-9);
  // shell hidden → hull wall and its opening get no mark, the note then counts fewer
  const ohne = planGrafik({ model, level: 0, customWalls: MODELL.customWalls, customWindows: [fenster], envOpenings: [huellFenster], layerVis: { shell: false },
    kiMarken: { guids: [gHuelle, gF, gH], projektId: "p1" } });
  assert.deepEqual(ohne.markiert, [gF]);
  // screen: the same with the generated hull walls handed in
  const m = kiMarkierungen({ ...MODELL, customWindows: [fenster], envOpenings: [huellFenster] }, [gHuelle, gF, gH], { projektId: "p1", huellWaende: model.walls });
  assert.deepEqual(m.map((x) => x.guid).sort(), [gHuelle, gF, gH].sort());
  assert.equal(kiMarkierungen({ ...MODELL, envOpenings: [huellFenster] }, [gH], { projektId: "p1" }).length, 0, "without hull walls no host");
});

test("Review: Raum- und Projektnamen außerhalb von WinAnsi brechen das PDF nicht; Plankopf bleibt 46 mm (Format wie vor 106-11)", async () => {
  const zonen = [{ level: 0, name: "Bad \u2713 \u{1F642}", points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] }];
  const r = await vektorPlanPdf(planGrafik({ model: { walls: [] }, level: 0, customWalls: MODELL.customWalls, customZones: zonen }),
    { massstab: 100, projekt: "Haus \u2713", planinhalt: "Grundriss \u{1F642}", modellstand: modellStand({ modell: MODELL, schritte: [] }) });
  const text = await pdfText(r.bytes);
  assert.ok(text.includes("Bad ? ?"), "room label");
  assert.ok(text.includes("Haus ?"), "title block project");
  // free drawing height on A3 with the 46 mm title block: 297 - 20 - 46 - 8 = 223 mm; a drawing 222 mm high at 1:100 fits A3
  // (with the 52 mm block of the first 106-11 build it jumped to A2): the format choice is the one before 106-11
  const wand = (/** @type {number} */ z) => ({ a: { x: 0, z: 0 }, b: { x: 0, z }, level: 0, thickness: 0.0001 });
  const passt = await vektorPlanPdf(planGrafik({ model: { walls: [] }, level: 0, customWalls: [wand(22.2)] }), { massstab: 100 });
  assert.equal(passt.format, "A3");
});

test("Review: Feuerwehrplan-Blatt — Platz für den Vermerk-Kasten über der Haftungszeile, Planfeld schrumpft", () => {
  const ohne = feuerwehrplanLayout({ imgW: 1600, imgH: 1200, legendeZeilen: 3 });
  assert.equal(ohne.vermerk, null);
  const mit = feuerwehrplanLayout({ imgW: 1600, imgH: 1200, legendeZeilen: 3, vermerkZeilen: 4 });
  assert.ok(mit.vermerk);
  assert.ok(mit.vermerk.y + mit.vermerk.h <= mit.hinweis.y, "above the liability line");
  assert.ok(mit.planFeld.y + mit.planFeld.h <= mit.vermerk.y, "below the plan field");
  assert.ok(mit.planFeld.h < ohne.planFeld.h);
  assert.ok(mit.vermerk.x + mit.vermerk.w <= mit.legende.x, "left of the legend");
});
