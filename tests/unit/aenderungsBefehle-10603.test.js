// 106-03: the change commands of the register (eigenschaft-setzen, transformieren, teilen, pruefen, vorschlaege,
// bestaetigen, verwerfen, rueckgaengig) against a stand-in surface, the proposal store and the ghost matrix.
// Guard rails under test: a command only PROPOSES, a person confirms (an agent cannot), every step keeps its origin
// and goes back on its own, "dieses" without a selection is refused, a blocked check cannot be confirmed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { geisterMatrix, geisterKlon, schnittMarke, geisterEntsorgen } from "@core/lib/zeigen/geisterVorschau.js";
import { transformieren, transformZentrum } from "@core/lib/zeigen/aenderungen.js";
import { auswahlKontext, KEINE_AUSWAHL_TEXT } from "@core/lib/zeigen/auswahlKontext.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";

const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);

/** Surface stand-in: a model in a variable, a selection, the way the studio applies a result (new model replaces the old). */
function flaeche(modell0, { auswahl = [], arten, ifc } = {}) {
  const f = {
    modell: modell0,
    auswahl,
    angewendet: 0,
    zurueck: 0,
    vorschau: new Set(),
    speicher: vorschlagSpeicher(),
  };
  const reg = befehlsRegister();
  aenderungsBefehleRegistrieren(reg, () => ({
    kontext: () => auswahlKontext(f.auswahl),
    modell: () => f.modell,
    optionen: () => ({ projektId: P, geschosshoehe_m: 3, attributPruefung: pruefeAttributeVorUebernahme }),
    speicher: f.speicher,
    ...(arten ? { arten, nichtMoeglichText: "Nur für gezeichnete Bauteile (BIM-Studio) — IFC-Dateien bleiben unverändert" } : {}),
    ...(ifc ? { ifcBauteil: ifc } : {}),
    uebernehmen: (_v, r) => { f.modell = r.modell; f.angewendet += 1; },
    zuruecknehmen: (_e, r) => { f.modell = r.modell; f.zurueck += 1; },
    vorschauZeigen: (v) => f.vorschau.add(v.id),
    vorschauEntfernen: (id) => f.vorschau.delete(id),
  }));
  f.reg = reg;
  f.aus = (id, p, ctx) => reg.ausfuehren(id, p, ctx);
  return f;
}
const agent = { kanal: "steuerung" };

test("eigenschaft-setzen: nur Vorschlag mit Satz und Prüfung, Modell bleibt unverändert, Vorschau gezeigt", () => {
  const w = wand(12, { feuerwiderstand: "F30" });
  const f = flaeche({ customWalls: [w] });
  const r = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "feuerwiderstand", wert: "F90" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.result.satz, /Feuerwiderstand F30 → F90/);
  assert.match(r.result.satz, /W-12/);
  assert.equal(r.result.bestaetigung, "erforderlich");
  assert.equal(r.result.herkunft, "text");
  assert.ok(r.result.pruefung.stufe);
  assert.equal(f.angewendet, 0, "ohne Bestätigung nichts angewendet");
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F30");
  assert.equal(f.speicher.offen().length, 1);
  assert.ok(f.vorschau.has(r.result.id));
});

test("\"dieses\" ohne Auswahl wird verweigert, nicht erraten", () => {
  const f = flaeche({ customWalls: [wand(1)] });
  const r = f.aus("eigenschaft-setzen", { name: "kg", wert: "331" });
  assert.equal(r.ok, false);
  assert.equal(r.error, KEINE_AUSWAHL_TEXT);
  assert.equal(f.speicher.offen().length, 0);
});

test("\"dieses\" mit genau einem gewählten Bauteil nimmt dessen GUID; mehrere werden verweigert", () => {
  const w1 = wand(1), w2 = wand(2);
  const sel = (w) => ({ guid: guidW(w), klasse: "IfcWall", name: "Wand" });
  const f = flaeche({ customWalls: [w1, w2] }, { auswahl: [sel(w1)] });
  const r = f.aus("eigenschaft-setzen", { name: "kg", wert: "331" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.ziel.guid, guidW(w1));
  const g = flaeche({ customWalls: [w1, w2] }, { auswahl: [sel(w1), sel(w2)] });
  const r2 = g.aus("eigenschaft-setzen", { name: "kg", wert: "331" });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /Mehrere Bauteile/);
});

test("bestaetigen wendet an, trägt die Herkunft ein; rueckgaengig nimmt genau diesen Schritt zurück", () => {
  const w = wand(12, { feuerwiderstand: "F30" });
  const f = flaeche({ customWalls: [w] });
  const v = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "feuerwiderstand", wert: "F90", herkunft: "sprache", befehl_text: "mach die wand F90" }).result;
  const b = f.aus("bestaetigen", { vorschlag_id: v.id, durch: "hand" });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F90");
  assert.equal(f.speicher.offen().length, 0);
  assert.equal(f.vorschau.size, 0, "Vorschau entfernt");
  const verlauf = f.aus("vorschlaege").result.verlauf;
  assert.equal(verlauf.length, 1);
  assert.equal(verlauf[0].herkunft, "sprache");
  assert.equal(verlauf[0].befehl_text, "mach die wand F90");
  const z = f.aus("rueckgaengig", { vorschlag_id: v.id });
  assert.equal(z.ok, true, JSON.stringify(z));
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F30");
  assert.equal(f.aus("vorschlaege").result.verlauf[0].zurueckgenommen != null, true);
  assert.equal(f.aus("rueckgaengig", { vorschlag_id: v.id }).ok, false, "ein Schritt geht nur einmal zurück");
});

test("Agentenkanal: Herkunft immer agent, kann weder bestätigen noch zurücknehmen, aber verwerfen", () => {
  const w = wand(3);
  const f = flaeche({ customWalls: [w] });
  const v = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "331", herkunft: "hand" }, agent).result;
  assert.equal(v.herkunft, "agent", "der Kanal entscheidet, nicht die Behauptung des Aufrufers");
  assert.equal(v.bestaetigung, "erforderlich", "auch ein Agent-Vorschlag braucht die Bestätigung (D-IM-04)");
  const b = f.aus("bestaetigen", { vorschlag_id: v.id, durch: "hand" }, agent);
  assert.equal(b.ok, false);
  assert.match(b.error, /Agent kann nicht bestätigen/);
  assert.equal(f.angewendet, 0);
  // the person confirms in the window (no ctx): the step is recorded as the agent's
  assert.equal(f.aus("bestaetigen", { vorschlag_id: v.id, durch: "hand" }).ok, true);
  assert.equal(f.aus("vorschlaege").result.verlauf[0].herkunft, "agent");
  assert.equal(f.aus("rueckgaengig", {}, agent).ok, false);
  const v2 = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "341" }, agent).result;
  assert.equal(f.aus("verwerfen", { vorschlag_id: v2.id }, agent).ok, true);
  assert.equal(f.speicher.offen().length, 0);
});

test("ein Aufrufer kann nicht als \"agent\" bestätigen; unbekannte Herkunft wird abgelehnt", () => {
  const w = wand(3);
  const f = flaeche({ customWalls: [w] });
  const v = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "331" }).result;
  const b = f.aus("bestaetigen", { vorschlag_id: v.id, durch: "agent" });
  assert.equal(b.ok, false);
  assert.match(b.error, /Agent kann seine eigene Änderung nicht bestätigen/);
  assert.equal(f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "341", herkunft: "zauberei" }).ok, false);
});

test("gesperrter Vorschlag (Abbruch eines tragenden Bauteils ohne Vermerk): Stufe fehler, bestaetigen verweigert", () => {
  const w = wand(5, { tragend: true });
  const f = flaeche({ customWalls: [w] });
  const r = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "status", wert: "abbruch" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.pruefung.stufe, "fehler");
  assert.equal(r.result.gesperrt, true);
  assert.ok(r.result.pruefung.saetze.some((s) => /^Gesperrt:/.test(s)));
  const b = f.aus("bestaetigen", { vorschlag_id: r.result.id, durch: "hand" });
  assert.equal(b.ok, false);
  assert.match(b.error, /Gesperrt/);
  assert.equal(f.angewendet, 0);
  // the way out stays open: note the structural remark first, then the change is no longer blocked
  const vm = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "statik_vermerk", wert: "Abstützung nach Statik" }).result;
  f.aus("bestaetigen", { vorschlag_id: vm.id, durch: "hand" });
  const neu = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "status", wert: "abbruch" }).result;
  assert.notEqual(neu.pruefung.stufe, "fehler");
});

test("transformieren: Verschiebung als Text oder Feld, Satz mit Komma; teilen per anteil", () => {
  const w = wand(2);
  const f = flaeche({ customWalls: [w] });
  const t = f.aus("transformieren", { guid: guidW(w), verschiebung_m: "0,5; 0; 0" });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.match(t.result.satz, /0,5 m in x/);
  assert.equal(f.aus("bestaetigen", { vorschlag_id: t.result.id }).ok, true);
  assert.equal(f.modell.customWalls[0].a.x, 0.5);
  assert.equal(f.aus("transformieren", { guid: guidW(w) }).ok, false, "ohne Angabe nichts zu tun");

  const w2 = f.modell.customWalls[0];
  const s = f.aus("teilen", { guid: guidW(w2), anteil: 0.5 });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.match(s.result.satz, /bei 3 m teilen → 3 m \+ 3 m/);
  assert.equal(f.aus("bestaetigen", { vorschlag_id: s.result.id }).ok, true);
  assert.equal(f.modell.customWalls.length, 2);
  assert.notEqual(f.modell.customWalls[0].guid, guidW(w2));
  assert.equal(f.aus("teilen", { guid: guidW(f.modell.customWalls[0]), anteil: 2 }).ok, false);
  // reversing the split merges the two parts again
  assert.equal(f.aus("rueckgaengig").ok, true);
  assert.equal(f.modell.customWalls.length, 1);
});

test("IFC-Fläche: transformieren und teilen sind nicht möglich, mit Grund", () => {
  const f = flaeche({}, { arten: ["eigenschaft"], ifc: () => null });
  for (const id of ["transformieren", "teilen"]) {
    const r = f.aus(id, { guid: "x".repeat(22), verschiebung_m: [1, 0, 0], anteil: 0.5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Nur für gezeichnete Bauteile \(BIM-Studio\) — IFC-Dateien bleiben unverändert/);
  }
});

test("bestaetigen und verwerfen: ohne Id nur bei genau einem offenen Vorschlag, sonst Rückfrage mit den Ids", () => {
  const w = wand(1);
  const f = flaeche({ customWalls: [w] });
  assert.match(f.aus("bestaetigen", {}).error, /Kein offener Vorschlag/);
  const a = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "331" }).result;
  const b = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "bauabschnitt", wert: "BA 1" }).result;
  const r = f.aus("bestaetigen", {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes(a.id) && r.error.includes(b.id));
  assert.equal(f.aus("verwerfen", { vorschlag_id: a.id }).ok, true);
  assert.equal(f.aus("bestaetigen", {}).ok, true, "jetzt ist es genau einer");
});

test("pruefen: prüft offene Vorschläge am aktuellen Modell neu (Bauteil inzwischen weg: fehler)", () => {
  const w = wand(1);
  const f = flaeche({ customWalls: [w] });
  const v = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "331" }).result;
  assert.equal(f.aus("pruefen", { vorschlag_id: v.id }).result[0].pruefung.stufe, "ok");
  f.modell = { customWalls: [] }; // the element vanished meanwhile
  const neu = f.aus("pruefen", {}).result[0];
  assert.equal(neu.pruefung.stufe, "fehler");
  assert.equal(neu.gesperrt, true);
  assert.equal(f.aus("bestaetigen", { vorschlag_id: v.id }).ok, false);
});

test("vorschlagSpeicher: stabiler Stand, Abonnenten werden benachrichtigt, Verlauf ist begrenzt", () => {
  const s = vorschlagSpeicher();
  const a0 = s.stand();
  assert.equal(s.stand(), a0, "derselbe Stand bis zur Änderung");
  let n = 0;
  const ab = s.abonnieren(() => { n += 1; });
  s.hinzu({ id: "a" });
  s.hinzu({ id: "a", satz: "neu" });
  assert.equal(s.offen().length, 1, "gleiche Id ersetzt");
  assert.notEqual(s.stand(), a0);
  assert.equal(s.aktualisieren("a", { satz: "x" }).satz, "x");
  assert.equal(s.entfernen("a"), true);
  assert.equal(s.entfernen("a"), false);
  ab();
  s.hinzu({ id: "b" });
  assert.equal(n, 4, "nach dem Abmelden keine Meldung mehr");
  for (let i = 0; i < 250; i++) s.verlaufHinzu({ vorschlag_id: `s${i}` });
  assert.equal(s.verlauf().length, 200);
  assert.equal(s.verlaufMarkieren("s249", { zurueckgenommen: "t" }), true);
  assert.equal(s.verlaufMarkieren("gibt-es-nicht", {}), false);
});

test("geisterMatrix trägt Punkte genau dorthin, wohin transformieren() das Bauteil setzt", () => {
  const w = wand(4);
  const ziele = [{ verschiebung_m: [0.5, 0, 1] }, { drehung_grad: 90 }, { faktor: 2 }, { verschiebung_m: [1, 0, -2], drehung_grad: 37, faktor: 0.5 }];
  for (const p of ziele) {
    const neu = transformieren(w, p, { geschosshoehe_m: 3 });
    const m = geisterMatrix({ zentrum: transformZentrum(w, p.zentrum), ...p });
    for (const [alt, nach] of [[w.a, neu.a], [w.b, neu.b]]) {
      const q = new THREE.Vector3(alt.x, 1.5, alt.z).applyMatrix4(m);
      assert.ok(Math.abs(q.x - nach.x) < 1e-5 && Math.abs(q.z - nach.z) < 1e-5, `${JSON.stringify(p)}: (${q.x}, ${q.z}) != (${nach.x}, ${nach.z})`);
      assert.ok(Math.abs(q.y - 1.5) < 1e-9, "die Höhe bleibt");
    }
  }
  const hoch = new THREE.Vector3(1, 1, 1).applyMatrix4(geisterMatrix({ zentrum: { x: 0, z: 0 }, verschiebung_m: [0, 3, 0] }));
  assert.equal(hoch.y, 4);
});

test("Geist und Schnittmarke: Klon ist durchsichtig, nie pickbar, trägt die Id und lässt sich entsorgen", () => {
  const szene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.24), new THREE.MeshStandardMaterial());
  mesh.position.set(3, 1.5, 0);
  szene.add(mesh);
  const geist = geisterKlon([mesh], geisterMatrix({ zentrum: { x: 3, z: 0 }, verschiebung_m: [1, 0, 0] }), "abc12345");
  szene.add(geist);
  assert.equal(geist.userData.geisterId, "abc12345");
  const klon = /** @type {any} */ (geist.children[0]);
  assert.equal(klon.material.transparent, true);
  assert.ok(klon.material.opacity < 1);
  assert.equal(klon.raycast(), undefined, "Hilfsobjekt wird nie getroffen");
  assert.ok(klon.children.some((c) => c.userData.zeigeZustand === "warnung" && c.material.type === "LineDashedMaterial"), "gestrichelter Umriss: Form, nicht nur Farbe");
  assert.ok(Math.abs(klon.matrix.elements[12] - 4) < 1e-9, "um 1 m nach x verschoben");
  const marke = schnittMarke({ x: 0, z: -1 }, { x: 0, z: 1 }, 0, 3, "abc12345");
  szene.add(marke);
  assert.equal(marke.material.type, "LineDashedMaterial");
  geisterEntsorgen(geist); geisterEntsorgen(marke);
  assert.equal(szene.children.length, 1, "nur das Original bleibt");
  assert.ok(mesh.geometry.attributes.position, "die Geometrie des Originals wurde nicht freigegeben");
});
