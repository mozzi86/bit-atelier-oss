// 106-03 review fixes: steps are reversed ONE BY ONE without putting old snapshots over newer work, a proposal that went
// stale is refused, the origin of a step survives (journal fields, mark on the drawn element), "not checked" and "hint" never
// look like a pass, and a split does not turn an old violation into a new one. Pure functions plus the command register
// against a stand-in surface - no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { aenderungUmkehren, MARKE_FELD, bauteilImModell } from "@core/lib/zeigen/aenderungen.js";
import { pruefeAenderung } from "@core/lib/zeigen/pruefung.js";
import { vorschlagVorbereiten, vorschlagAusfuehren, KEIN_PROJEKT_TEXT } from "@core/lib/zeigen/vorschlag.js";
import { planFormen } from "@core/lib/zeigen/planVorschau.js";
import { steckbrief } from "@core/lib/bauteil/steckbrief.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";

const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);
const hand = { quelle: "hand" };
const modellMit = (extra = {}) => ({
  customWalls: [wand(1, { bauteil_typ: "wand-tragend", tragend: true }), wand(2, { kg: "341" }), wand(3, { bauteil_typ: "wand-innen" })],
  customColumns: [], customWindows: [], envOpenings: [], customZones: [], customSlabs: [], customRoofs: [], ...extra,
});
const fenster = (idx, u, wallIdx = 1) => ({ wallIdx, u, typeId: "single", kind: "window", _idx: idx });
const vor = (m, idx, art, params, herkunft = hand, opt = {}) => vorschlagVorbereiten(m, { art, ziel: { guid: guidW(m.customWalls.find((w) => w._idx === idx)) }, params, herkunft }, { projektId: P, ...opt });
const lauf = (m, v, durch = "hand") => vorschlagAusfuehren(m, v, { projektId: P, bestaetigt_durch: durch });
const wandVon = (m, idx) => m.customWalls.find((w) => w._idx === idx);

// ---------------------------------------------------------------- stale proposals (finding: vorher/nachher from the time of the proposal)

test("zwei offene Vorschläge auf dasselbe Bauteil: der zweite ist nach dem ersten veraltet und läuft nicht; neu vorgeschlagen stimmt vorher", () => {
  const m = modellMit({ customWalls: [wand(1, { feuerwiderstand: "F30" }), wand(2), wand(3)] });
  const v1 = vor(m, 1, "eigenschaft", { name: "feuerwiderstand", wert: "F60" });
  const v2 = vor(m, 1, "eigenschaft", { name: "feuerwiderstand", wert: "F90" });
  assert.match(v2.satz, /F30 → F90/);
  const r1 = lauf(m, v1);
  assert.equal(wandVon(r1.modell, 1).feuerwiderstand, "F60");
  // proposal 2 still says F30 -> F90, but the wall is F60 now: refused, not run with a false "vorher"
  assert.throws(() => lauf(r1.modell, v2), { message: /^Veraltet: .* — verwerfen und neu vorschlagen/ });
  const pr = pruefeAenderung(r1.modell, v2, { projektId: P });
  assert.equal(pr.stufe, "fehler");
  assert.equal(pr.befunde[0].code, "veraltet");
  assert.equal(pr.zeilen[0].stufe, "fehler");
  // proposed again on the current state: the step records F60 -> F90 and goes back to F60
  const v2neu = vor(r1.modell, 1, "eigenschaft", { name: "feuerwiderstand", wert: "F90" });
  assert.match(v2neu.satz, /F60 → F90/);
  const r2 = lauf(r1.modell, v2neu);
  assert.equal(r2.eintrag.vorher.wert, "F60");
  assert.equal(wandVon(aenderungUmkehren(r2.modell, r2.eintrag, { projektId: P }).modell, 1).feuerwiderstand, "F60");
});

test("veraltet ist auch eine Verschiebung nach einer Verschiebung und ein Teilen nach einer Eigenschaft", () => {
  const m = modellMit();
  const a = vor(m, 2, "transformieren", { verschiebung_m: [1, 0, 0] });
  const b = vor(m, 2, "transformieren", { verschiebung_m: [2, 0, 0] });
  const ra = lauf(m, a);
  assert.throws(() => lauf(ra.modell, b), /Veraltet/);
  const t = vor(m, 3, "teilen", { punkt_m: { x: 3, z: 30 } });
  const e = lauf(m, vor(m, 3, "eigenschaft", { name: "material", wert: "Beton" }));
  assert.throws(() => lauf(e.modell, t), /Veraltet/);
});

// ---------------------------------------------------------------- one step at a time (findings: snapshots over newer work)

test("zwei Verschiebungen: die ältere lässt sich erst nach der neueren zurücknehmen, beide Wege enden am Ausgang", () => {
  const m = modellMit();
  const s1 = lauf(m, vor(m, 2, "transformieren", { verschiebung_m: [1, 0, 0] }));
  const s2 = lauf(s1.modell, vor(s1.modell, 2, "transformieren", { verschiebung_m: [1, 0, 0] }));
  assert.equal(wandVon(s2.modell, 2).a.x, 2);
  assert.throws(() => aenderungUmkehren(s2.modell, s1.eintrag, { projektId: P }), /noch einmal bewegt oder verändert — erst den neueren Schritt/);
  const z2 = aenderungUmkehren(s2.modell, s2.eintrag, { projektId: P }).modell;
  assert.equal(wandVon(z2, 2).a.x, 1);
  const z1 = aenderungUmkehren(z2, s1.eintrag, { projektId: P }).modell;
  assert.deepEqual(z1, m, "am Ende steht der Ausgangszustand");
});

test("zwei Schritte auf dieselbe Eigenschaft: ältester zuerst verweigert; verschiedene Eigenschaften blockieren sich nicht", () => {
  const m = modellMit({ customWalls: [wand(1, { feuerwiderstand: "F30" }), wand(2), wand(3)] });
  const s1 = lauf(m, vor(m, 1, "eigenschaft", { name: "feuerwiderstand", wert: "F60" }));
  const s2 = lauf(s1.modell, vor(s1.modell, 1, "eigenschaft", { name: "feuerwiderstand", wert: "F90" }));
  assert.throws(() => aenderungUmkehren(s2.modell, s1.eintrag, { projektId: P }), /Spätere Änderung an Feuerwiderstand .* erst den neueren Schritt/);
  const z2 = aenderungUmkehren(s2.modell, s2.eintrag, { projektId: P }).modell;
  assert.equal(wandVon(z2, 1).feuerwiderstand, "F60");
  assert.equal(wandVon(aenderungUmkehren(z2, s1.eintrag, { projektId: P }).modell, 1).feuerwiderstand, "F30");
  // another property of the same wall does not block
  const k1 = lauf(m, vor(m, 2, "eigenschaft", { name: "kg", wert: "342" }));
  const k2 = lauf(k1.modell, vor(k1.modell, 2, "eigenschaft", { name: "material", wert: "Beton" }));
  const ohneK1 = aenderungUmkehren(k2.modell, k1.eintrag, { projektId: P }).modell;
  assert.equal(wandVon(ohneK1, 2).kg, undefined, "kg war nur abgeleitet: wieder ungesetzt");
  assert.equal(wandVon(ohneK1, 2).material, "Beton", "der spätere Schritt bleibt");
});

test("Teilen zurücknehmen: verweigert, wenn ein Teil danach geändert wurde oder ein neues Fenster hängt; sonst verschmilzt es samt Öffnungen", () => {
  const m = modellMit({ customWindows: [fenster(5, 1.5, 1), fenster(6, 4.5, 1)] });
  const t = lauf(m, vor(m, 1, "teilen", { punkt_m: { x: 3, z: 10 } }));
  const teile = t.eintrag.nachher.teile;
  assert.ok(teile[0].element && teile[1].element && Array.isArray(t.eintrag.nachher.oeffnungenNach));
  // later property on part B -> would be lost: refused with the reason
  const gB = teile[1].guid;
  const eig = lauf(t.modell, vorschlagVorbereiten(t.modell, { art: "eigenschaft", ziel: { guid: gB }, params: { name: "material", wert: "Beton" }, herkunft: hand }, { projektId: P }));
  assert.throws(() => aenderungUmkehren(eig.modell, t.eintrag, { projektId: P }), /nach dem Teilen verändert — erst die späteren Schritte zurücknehmen/);
  // ... a later move of part A as well
  const mv = lauf(t.modell, vorschlagVorbereiten(t.modell, { art: "transformieren", ziel: { guid: teile[0].guid }, params: { verschiebung_m: [0, 0, 2] }, herkunft: hand }, { projektId: P }));
  assert.throws(() => aenderungUmkehren(mv.modell, t.eintrag, { projektId: P }), /nach dem Teilen verändert/);
  // ... and a new window on part B
  const neuesFenster = { ...t.modell, customWindows: [...t.modell.customWindows, fenster(9, 1, t.modell.customWalls.find((w) => w.guid === gB)._idx)] };
  assert.throws(() => aenderungUmkehren(neuesFenster, t.eintrag, { projektId: P }), /nach dem Teilen verändert/);
  // undone in the right order it works: property first, then the split
  const zEig = aenderungUmkehren(eig.modell, eig.eintrag, { projektId: P }).modell;
  assert.deepEqual(aenderungUmkehren(zEig, t.eintrag, { projektId: P }).modell, m);
  // the step before a later split of the same element is blocked by the split
  const e1 = lauf(m, vor(m, 2, "eigenschaft", { name: "kg", wert: "342" }));
  const t2 = lauf(e1.modell, vor(e1.modell, 2, "teilen", { punkt_m: { x: 3, z: 20 } }));
  assert.throws(() => aenderungUmkehren(t2.modell, e1.eintrag, { projektId: P, spaetere: [{ art: "teilen", ziel: t2.eintrag.ziel }] }), /danach geteilt — erst das Teilen/);
});

test("Teilen einer Wand mit vorhandener Regelverletzung: die Verletzung gilt nicht als neu durch die Teilung", () => {
  const m = modellMit({ customWalls: [wand(1, { bauteil_typ: "wand-tragend", tragend: true, status: "abbruch" }), wand(2), wand(3)] });
  const r = pruefeAenderung(m, { art: "teilen", ziel: { guid: guidW(m.customWalls[0]) }, params: { punkt_m: { x: 3, z: 10 } } }, { projektId: P });
  assert.notEqual(r.stufe, "fehler", JSON.stringify(r.saetze));
  assert.ok(!r.befunde.some((b) => b.code === "abbruch_tragend"));
  // a really new violation is still found: demolish another load-bearing wall
  const m2 = modellMit({ customWalls: [wand(1, { bauteil_typ: "wand-tragend", tragend: true }), wand(2), wand(3)] });
  assert.equal(pruefeAenderung(m2, { art: "eigenschaft", ziel: { guid: guidW(m2.customWalls[0]) }, params: { name: "status", wert: "abbruch" } }, { projektId: P }).stufe, "fehler");
});

// ---------------------------------------------------------------- origin that stays

test("Herkunft am gezeichneten Bauteil: Marke nach dem Ausführen, nach dem Zurücknehmen wieder die alte", () => {
  const m = modellMit();
  const v = vor(m, 2, "eigenschaft", { name: "kg", wert: "342" }, { quelle: "agent", befehl_text: "setz die kg" });
  const r = vorschlagAusfuehren(m, v, { projektId: P, bestaetigt_durch: "hand", zeit: "2026-10-25T10:00:00.000Z" });
  const marke = wandVon(r.modell, 2)[MARKE_FELD];
  assert.deepEqual(marke, { herkunft: "agent", herkunft_quellen: ["agent"], befehl_text: "setz die kg", zeit: "2026-10-25T10:00:00.000Z", vorschlag_id: v.id });
  assert.equal(r.eintrag.bestaetigt_durch, "hand");
  assert.equal(wandVon(m, 2)[MARKE_FELD], undefined, "Eingabemodell bleibt unverändert");
  // a second step puts its own mark; undoing the second restores the first one
  const v2 = vor(r.modell, 2, "transformieren", { verschiebung_m: [1, 0, 0] }, { quelle: "text" });
  const r2 = lauf(r.modell, v2);
  assert.equal(wandVon(r2.modell, 2)[MARKE_FELD].herkunft, "text");
  assert.equal(wandVon(aenderungUmkehren(r2.modell, r2.eintrag, { projektId: P }).modell, 2)[MARKE_FELD].herkunft, "agent");
  assert.deepEqual(aenderungUmkehren(r.modell, r.eintrag, { projektId: P }).modell, m, "ohne Schritte keine Marke");
  // both parts of a split carry the mark; the undivided wall comes back without
  const t = lauf(m, vor(m, 3, "teilen", { punkt_m: { x: 3, z: 30 } }, { quelle: "sprache" }));
  assert.equal(t.eintrag.nachher.teile.every((p) => p.element[MARKE_FELD].herkunft === "sprache"), true);
});

test("IFC: Herkunft im Journal-Eintrag, Zurücknehmen löscht genau den Eintrag des Schrittes und verweigert, wenn ein neuerer existiert", () => {
  const ifc = { quelle: "ifc", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", klasse: "IfcWall", name: "Wand A", project_id: P, psets: { Pset_WallCommon: { FireRating: "F30" } } };
  const schritt = (eintraege, wert, zeit, hk = hand) => {
    const v = vorschlagVorbereiten({}, { art: "eigenschaft", ziel: { guid: ifc.guid }, params: { pset: "Pset_WallCommon", name: "FireRating", wert }, herkunft: hk, ifcBauteil: ifc }, { projektId: P, eintraege });
    return vorschlagAusfuehren({}, v, { projektId: P, bestaetigt_durch: "tastatur", zeit, ifcBauteil: ifc, eintraege });
  };
  const r1 = schritt([], "F60", "2026-10-25T10:00:00.000Z", { quelle: "agent", befehl_text: "F60" });
  assert.equal(r1.journal.herkunft, "agent");
  assert.equal(r1.journal.befehl_text, "F60");
  assert.equal(r1.journal.bestaetigt_durch, "tastatur");
  assert.equal(r1.eintrag.journal_zeit, "2026-10-25T10:00:00.000Z");
  const j1 = [r1.journal];
  const r2 = schritt(j1, "F90", "2026-10-25T10:05:00.000Z");
  assert.equal(r2.eintrag.vorher.wert, "F60", "vorher ist der Journalstand, nicht der Dateistand");
  const j2 = [r1.journal, r2.journal];
  // step 1 first: refused, step 2 is not dropped
  assert.throws(() => aenderungUmkehren({}, r1.eintrag, { eintraege: j2 }), /Spätere Änderung an FireRating im Journal/);
  const u2 = aenderungUmkehren({}, r2.eintrag, { eintraege: j2 });
  assert.equal(u2.journal.loeschen.zeit, "2026-10-25T10:05:00.000Z");
  assert.equal(aenderungUmkehren({}, r1.eintrag, { eintraege: [r1.journal] }).journal.loeschen.zeit, "2026-10-25T10:00:00.000Z");
  // the entry is gone (deleted in the attribute editor): clear text
  assert.throws(() => aenderungUmkehren({}, r2.eintrag, { eintraege: [r1.journal] }), /nicht mehr da/);
  // a second proposal made before the first ran is stale
  const a = vorschlagVorbereiten({}, { art: "eigenschaft", ziel: { guid: ifc.guid }, params: { pset: "Pset_WallCommon", name: "FireRating", wert: "F60" }, herkunft: hand, ifcBauteil: ifc }, { projektId: P });
  const b = vorschlagVorbereiten({}, { art: "eigenschaft", ziel: { guid: ifc.guid }, params: { pset: "Pset_WallCommon", name: "FireRating", wert: "F90" }, herkunft: hand, ifcBauteil: ifc }, { projektId: P });
  vorschlagAusfuehren({}, a, { projektId: P, bestaetigt_durch: "hand", ifcBauteil: ifc, eintraege: [] });
  assert.throws(() => vorschlagAusfuehren({}, b, { projektId: P, bestaetigt_durch: "hand", ifcBauteil: ifc, eintraege: [r1.journal] }), /Veraltet/);
});

test("IFC ohne Projekt wird verweigert, nicht verwaist gespeichert", () => {
  const ifc = { quelle: "ifc", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", klasse: "IfcWall", name: "Wand A", project_id: null, psets: { Pset_WallCommon: { FireRating: "F30" } } };
  assert.throws(() => vorschlagVorbereiten({}, { art: "eigenschaft", ziel: { guid: ifc.guid }, params: { pset: "Pset_WallCommon", name: "FireRating", wert: "F90" }, herkunft: hand, ifcBauteil: ifc }, {}), { message: KEIN_PROJEKT_TEXT });
});

// ---------------------------------------------------------------- form of the check lines

test("Prüfzeilen: Hinweis, nicht geprüft und sauber sehen verschieden aus (Stufe je Zeile über das Befund-Objekt)", () => {
  const m = modellMit();
  // hint only: the sentence "Hinweis: ..." is a hint, not a pass
  const hinweis = pruefeAenderung(m, { art: "eigenschaft", ziel: { guid: guidW(m.customWalls[1]) }, params: { name: "kg", wert: "342" } }, { projektId: P, attributPruefung: pruefeAttributeVorUebernahme });
  assert.deepEqual(hinweis.zeilen.map((z) => z.satz), hinweis.saetze);
  for (const z of hinweis.zeilen) assert.ok(["fehler", "warn", "hinweis", "ok", "ungeprueft"].includes(z.stufe));
  assert.ok(hinweis.zeilen.filter((z) => /^Hinweis:/.test(z.satz)).every((z) => z.stufe === "hinweis"));
  // IFC element without attribute check: "nothing found" is NOT said, the line says it was not checked
  const ifc = { quelle: "ifc", modell: "rohbau.ifc", guid: "2O2Fr$t4X7Zf8NOew3FLOH", klasse: "IfcWall", name: "Wand A", project_id: P, psets: { Pset_WallCommon: { FireRating: "F30" } } };
  const roh = { art: "eigenschaft", ziel: { guid: ifc.guid, quelle: "ifc", modell: ifc.modell }, params: {}, vorher: { feld: "Pset_WallCommon.FireRating", wert: "F30", pset: "Pset_WallCommon", eigenschaft: "FireRating" },
    nachher: { feld: "Pset_WallCommon.FireRating", wert: "F90", pset: "Pset_WallCommon", eigenschaft: "FireRating" } };
  const ohne = pruefeAenderung({}, roh, { ifcBauteil: ifc });
  assert.deepEqual(ohne.zeilen.map((z) => z.stufe), ["ungeprueft"]);
  assert.match(ohne.saetze[0], /^Nicht geprüft: Attribute/);
  // with the attribute check the clean result is a real "ok" line
  const mit = pruefeAenderung({}, roh, { ifcBauteil: ifc, attributPruefung: pruefeAttributeVorUebernahme });
  assert.ok(mit.zeilen.every((z) => z.stufe !== "ungeprueft"));
  // drawn element, rules ran, nothing found
  const sauber = pruefeAenderung(m, { art: "eigenschaft", ziel: { guid: guidW(m.customWalls[1]) }, params: { name: "kg", wert: "343" } }, { projektId: P });
  assert.deepEqual(sauber.zeilen.map((z) => z.stufe), ["ok"]);
});

// ---------------------------------------------------------------- plan preview, data sheet

test("planFormen: Umriss der Wand nach der Verschiebung, Schnittlinie beim Teilen, nichts für IFC", () => {
  const m = modellMit();
  const g = guidW(m.customWalls[1]);
  const [f] = planFormen(m, { art: "transformieren", ziel: { guid: g }, params: { verschiebung_m: [1, 0, 0] } }, { projektId: P });
  assert.equal(f.typ, "flaeche");
  assert.equal(f.punkte.length, 4);
  assert.equal(Math.min(...f.punkte.map((q) => q.x)), 1);
  const [l] = planFormen(m, { art: "teilen", ziel: { guid: g }, params: { punkt_m: { x: 3, z: 20 } } }, { projektId: P });
  assert.equal(l.typ, "linie");
  assert.equal(l.punkte[0].x, 3);
  assert.ok(Math.abs(l.punkte[0].z - l.punkte[1].z) > 0.24, "die Linie geht quer über die Wanddicke");
  assert.deepEqual(planFormen(m, { art: "transformieren", ziel: { guid: g }, params: { faktor: 0 } }, { projektId: P }), [], "Unmögliches hat kein Bild");
  assert.deepEqual(planFormen(m, { art: "eigenschaft", ziel: { guid: g, quelle: "ifc" }, params: {} }, { projektId: P }), []);
  assert.equal(planFormen(m, { art: "eigenschaft", ziel: { guid: g }, params: { name: "kg", wert: "1" } }, { projektId: P })[0].level, 0);
});

test("Steckbrief nennt Feuerwiderstand und Statik-Vermerk, wenn sie am Bauteil stehen (additiv, sonst null)", () => {
  const s = steckbrief(wand(1, { feuerwiderstand: "F90", statik_vermerk: "Abstützung liegt vor" }), "wand-innen", { projektId: P, quelle: "customWalls" });
  assert.equal(s.feuerwiderstand, "F90");
  assert.equal(s.statik_vermerk, "Abstützung liegt vor");
  const leer = steckbrief(wand(1), "wand-innen", { projektId: P, quelle: "customWalls" });
  assert.equal(leer.feuerwiderstand, null);
  assert.equal(leer.statik_vermerk, null);
});

// ---------------------------------------------------------------- commands

function flaeche(modell0, { auswahl = [] } = {}) {
  const f = { modell: modell0, auswahl, speicher: vorschlagSpeicher(), vorschau: new Set() };
  const reg = befehlsRegister();
  aenderungsBefehleRegistrieren(reg, () => ({
    kontext: () => auswahlKontext(f.auswahl),
    modell: () => f.modell,
    optionen: () => ({ projektId: P, geschosshoehe_m: 3, attributPruefung: pruefeAttributeVorUebernahme }),
    speicher: f.speicher,
    uebernehmen: (_v, r) => { f.modell = r.modell; },
    zuruecknehmen: (_e, r) => { f.modell = r.modell; },
    vorschauZeigen: (v) => f.vorschau.add(v.id),
    vorschauEntfernen: (id) => f.vorschau.delete(id),
  }));
  f.aus = (id, p, ctx) => reg.ausfuehren(id, p, ctx);
  return f;
}
const agent = { kanal: "steuerung" };

test("Befehle: hand und bild sind als Parameter nicht zu behaupten, sprache und text schon; ein vertrauter Eingabeweg setzt ctx.herkunft", () => {
  const w = wand(1);
  const f = flaeche({ customWalls: [w] });
  const g = guidW(w);
  const hk = (p, ctx) => f.aus("eigenschaft-setzen", { guid: g, name: "kg", wert: "331", ...p }, ctx);
  assert.match(hk({ herkunft: "bild" }).error, /erst mit der Bildeingabe freigegeben/);
  assert.match(hk({ herkunft: "hand" }).error, /nur für Änderungen mit der Maus/);
  assert.equal(hk({ herkunft: "sprache" }).result.herkunft, "sprache");
  assert.equal(hk({}).result.herkunft, "text");
  assert.equal(hk({ herkunft: "hand" }, { herkunft: "hand" }).result.herkunft, "hand", "vom Eingabeweg selbst gesetzt");
  assert.equal(hk({ herkunft: "text" }, { kanal: "steuerung", herkunft: "hand" }).result.herkunft, "agent", "der Agentenkanal gewinnt immer");
});

test("Befehle: ein Agent verwirft nur eigene Vorschläge, nicht die der Person", () => {
  const w = wand(1);
  const f = flaeche({ customWalls: [w] });
  const g = guidW(w);
  const meins = f.aus("eigenschaft-setzen", { guid: g, name: "kg", wert: "331" }).result;
  const seins = f.aus("eigenschaft-setzen", { guid: g, name: "kg", wert: "341" }, agent).result;
  assert.match(f.aus("verwerfen", { vorschlag_id: meins.id }, agent).error, /nur eigene Vorschläge/);
  assert.equal(f.aus("verwerfen", { vorschlag_id: seins.id }, agent).ok, true);
  assert.equal(f.aus("verwerfen", { vorschlag_id: meins.id }).ok, true);
});

test("Befehle: nach bestaetigen sind offene Vorschläge desselben Ziels veraltet und gesperrt; rueckgaengig verweigert die Reihenfolge", () => {
  const w = wand(1, { feuerwiderstand: "F30" });
  const f = flaeche({ customWalls: [w, wand(2)] });
  const g = guidW(w);
  const v1 = f.aus("eigenschaft-setzen", { guid: g, name: "feuerwiderstand", wert: "F60" }).result;
  const v2 = f.aus("eigenschaft-setzen", { guid: g, name: "feuerwiderstand", wert: "F90" }).result;
  assert.equal(f.aus("bestaetigen", { vorschlag_id: v1.id, durch: "hand" }).ok, true);
  const offen = f.aus("vorschlaege").result.offen;
  assert.equal(offen.length, 1);
  assert.equal(offen[0].gesperrt, true, "der zweite Vorschlag ist veraltet");
  assert.match(offen[0].pruefung.saetze[0], /^Veraltet:/);
  const nein = f.aus("bestaetigen", { vorschlag_id: v2.id, durch: "hand" });
  assert.equal(nein.ok, false);
  assert.match(nein.error, /^Veraltet:/);
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F60");
  // neu vorschlagen, bestätigen, dann den ÄLTEREN Schritt zuerst zurücknehmen: verweigert, der neuere bleibt
  f.aus("verwerfen", { vorschlag_id: v2.id });
  const v3 = f.aus("eigenschaft-setzen", { guid: g, name: "feuerwiderstand", wert: "F90" }).result;
  assert.equal(f.aus("bestaetigen", { vorschlag_id: v3.id, durch: "hand" }).ok, true);
  const z1 = f.aus("rueckgaengig", { vorschlag_id: v1.id });
  assert.equal(z1.ok, false);
  assert.match(z1.error, /erst den neueren Schritt zurücknehmen/);
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F90");
  assert.equal(f.aus("vorschlaege").result.verlauf[0].zurueckgenommen, null, "der Verlauf markiert den verweigerten Schritt nicht");
  assert.equal(f.aus("rueckgaengig").ok, true, "ohne Id geht der neueste");
  assert.equal(f.aus("rueckgaengig", { vorschlag_id: v1.id }).ok, true);
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F30");
});

test("bauteilImModell findet das markierte Bauteil weiter (die Marke ändert die GUID nicht)", () => {
  const m = modellMit();
  const r = lauf(m, vor(m, 2, "eigenschaft", { name: "kg", wert: "342" }));
  assert.ok(bauteilImModell(r.modell, guidW(m.customWalls[1]), { projektId: P }));
});
