// Katalog-Referenzvalidierung — Modulverhalten (Phase 33 / W6, Plan 33-04).
//
// Die Ist-Zahlen des Realprojekts prüft Gate G24. Hier geht es um die Ränder:
// leere Kataloge, fehlende Felder, die Grenze zwischen „büroweit" und
// „Projekt-Override", und um die eine Stelle, an der Nachgeben teuer wäre — eine
// unbekannte Referenz durchzulassen.

import test from "node:test";
import assert from "node:assert/strict";
import {
  KATALOG_ENTITAETEN,
  SCHLUESSELFELD,
  ausschlussGrundBrauchtText,
  erlaubteAusschlussGruende,
  erlaubteEinheiten,
  erlaubteKg,
  erlaubteMengenbasis,
  katalogSnapshot,
  pruefeReferenzenOderWirf,
  validiereKatalogZeile,
  validiereReferenzen,
  wirksameZeilen,
} from "@core/lib/rules/catalogs.js";

const regel = (o = {}) => ({
  art: "modell",
  op: "add",
  selektor: {
    was: { kg: [], gewerk: [], schicht: [], ifc_klasse: ["IfcWall"] },
    zustand: { status: ["Neubau"] },
    muster: {},
    bereich: { qty: [] },
  },
  mengenbasis: "NetSideArea",
  faktor: 1,
  ...o,
});

const feld = (res, name) => res.fehler.find((f) => f.feld === name) || null;

test("ohne DB-Zeilen greift der Bürostandard — die Validierung ist auch offline scharf", () => {
  const snap = katalogSnapshot();
  assert.equal(Object.keys(snap).length, KATALOG_ENTITAETEN.length);
  assert.ok(erlaubteMengenbasis(snap).has("NetSideArea"));
  assert.ok(erlaubteMengenbasis(snap).has("Count"));
  assert.ok(erlaubteEinheiten(snap).has("m2"));
  assert.ok(erlaubteKg(snap).has("342"));
  assert.ok(erlaubteAusschlussGruende(snap).has("sonstiges"));
});

test("DB-Zeilen schlagen den Bürostandard — aber nur, wenn es welche gibt", () => {
  const snap = katalogSnapshot({ MengenbasisKatalog: [{ key: "NurDieses", einheit: "m2" }] });
  assert.deepEqual([...erlaubteMengenbasis(snap)], ["NurDieses"]);
  // Eine LEERE Liste ist kein „alles verboten", sondern „nichts gepflegt" ⇒ Bürostandard.
  const leer = katalogSnapshot({ MengenbasisKatalog: [] });
  assert.ok(erlaubteMengenbasis(leer).has("NetSideArea"));
});

test("eine gültige Regel geht durch, eine mit Tippfehler nicht", () => {
  assert.equal(validiereReferenzen(regel()).ok, true);
  const t = validiereReferenzen(regel({ mengenbasis: "NetSideAra" }));
  assert.equal(t.ok, false);
  assert.equal(t.fehler.length, 1);
  assert.equal(t.fehler[0].feld, "mengenbasis");
});

test("Fehler sind FELDBEZOGEN — eine Sammelmeldung hilft am Formular nicht", () => {
  const res = validiereReferenzen(regel({ mengenbasis: "Falsch", einheit: "qm", faktor: 3 }));
  assert.equal(res.ok, false);
  const felder = res.fehler.map((f) => f.feld).sort();
  assert.deepEqual(felder, ["einheit", "faktor_grund", "mengenbasis"]);
  for (const f of res.fehler) assert.ok(f.text.length > 10, "jeder Fehler hat einen Klartext");
});

test("faktor: 0 ist eine Zahl und braucht einen Grund — nicht dasselbe wie „kein Faktor“", () => {
  assert.equal(validiereReferenzen(regel({ faktor: 0 })).ok, false);
  assert.equal(validiereReferenzen(regel({ faktor: 0, faktor_grund: "Leistung entfällt" })).ok, true);
  // faktor null = nicht gesetzt ⇒ kein Grund nötig (die Engine nimmt 1).
  assert.equal(validiereReferenzen(regel({ faktor: null })).ok, true);
  // Leerzeichen sind kein Grund.
  assert.equal(validiereReferenzen(regel({ faktor: 2, faktor_grund: "   " })).ok, false);
});

test("`*` in der KG-Achse ist ein Wildcard, kein unbekannter Code", () => {
  const r = regel();
  r.selektor.was.kg = ["*"];
  assert.equal(validiereReferenzen(r).ok, true);
});

test("`pruefeReferenzenOderWirf` wirft mit Code und Fehlerliste", () => {
  assert.equal(pruefeReferenzenOderWirf(regel()), true);
  assert.throws(
    () => pruefeReferenzenOderWirf(regel({ mengenbasis: "x" })),
    (e) => e.code === "KATALOG_REFERENZ" && Array.isArray(e.fehler) && e.fehler.length === 1,
  );
});

test("Pflichttext nur dort, wo der Katalog ihn verlangt", () => {
  const snap = katalogSnapshot();
  assert.equal(ausschlussGrundBrauchtText(snap, "sonstiges"), true);
  assert.equal(ausschlussGrundBrauchtText(snap, "nicht_modelliert"), false);
  assert.equal(ausschlussGrundBrauchtText(snap, "gibt_es_nicht"), false);
  assert.equal(validiereReferenzen(regel({ ausschluss_grund: "nicht_modelliert" })).ok, true);
});

test("jeder der 14 Kataloge hat ein Schlüsselfeld — sonst ist Pflege nicht möglich", () => {
  assert.equal(KATALOG_ENTITAETEN.length, 14);
  for (const e of KATALOG_ENTITAETEN) {
    assert.ok(SCHLUESSELFELD[e], `kein Schlüsselfeld für ${e}`);
  }
});

test("validiereKatalogZeile: unbekannte Entität, fehlender Schlüssel, falsche Referenz", () => {
  assert.equal(validiereKatalogZeile("GibtEsNicht", { code: "x" }).ok, false);
  assert.equal(validiereKatalogZeile("MengenMuster", { name: "ohne nr" }).ok, false);
  assert.equal(validiereKatalogZeile("MengenMuster", { nr: 1, name: "x", mengenbasis: "Falsch" }).ok, false);
  assert.equal(validiereKatalogZeile("MengenMuster", { nr: 1, name: "x", mengenbasis: "NetArea", einheit: "m2" }).ok, true);
});

test("`code` wird NIE als Kostengruppe gelesen — sonst wäre der Einheitenkatalog ungültig", () => {
  // Regressionstest für einen Fehler, den G24 aufgedeckt hat: ein pauschaler
  // „prüfe alle Felder, die wie eine KG aussehen"-Ansatz hielt `AusschlussGrund.code`
  // für eine Kostengruppe und wies den eigenen Bürostandard ab.
  assert.equal(validiereKatalogZeile("EinheitenKatalog", { code: "Psch", name: "Pauschal" }).ok, true);
  assert.equal(validiereKatalogZeile("AusschlussGrund", { code: "nicht_modelliert", name: "x" }).ok, true);
  assert.equal(validiereKatalogZeile("Din276Katalog", { code: "342", name: "x" }).ok, true);
});

test("eine Override-Zeile darf sich nicht als büroweit ausgeben", () => {
  const res = validiereKatalogZeile("AmpelSchwelle", {
    kontext: "preisabweichung",
    scope: "buero",
    projekt_override_id: "p1",
  });
  assert.equal(res.ok, false);
  assert.ok(feld(res, "scope"));
});

test("wirksameZeilen: Override ersetzt, kommt nicht hinzu, und wirkt nur im eigenen Projekt", () => {
  const snap = {
    AmpelSchwelle: [
      { kontext: "preisabweichung", gruen_bis: 0.1, projekt_override_id: null },
      { kontext: "mengenabweichung", gruen_bis: 0.1, projekt_override_id: null },
      { kontext: "preisabweichung", gruen_bis: 0.02, projekt_override_id: "p1", scope: "projekt" },
    ],
  };
  assert.equal(wirksameZeilen(snap, "AmpelSchwelle", null).length, 2);
  const p1 = wirksameZeilen(snap, "AmpelSchwelle", "p1");
  assert.equal(p1.length, 2);
  assert.equal(p1.find((r) => r.kontext === "preisabweichung").gruen_bis, 0.02);
  assert.equal(
    wirksameZeilen(snap, "AmpelSchwelle", "p2").find((r) => r.kontext === "preisabweichung").gruen_bis,
    0.1,
  );
  // Leerer Katalog ⇒ leere Liste, keine Ausnahme.
  assert.deepEqual(wirksameZeilen({}, "AmpelSchwelle", "p1"), []);
});

test("StatusKonvention wird über `pipeline` identifiziert — `intern` ist bei „unbekannt“ null", () => {
  const snap = katalogSnapshot();
  assert.equal(SCHLUESSELFELD.StatusKonvention, "pipeline");
  const unbekannt = snap.StatusKonvention.find((r) => r.pipeline === "?");
  assert.equal(unbekannt.intern, null, "ein fehlender Status IST ein Zustand");
  assert.equal(validiereKatalogZeile("StatusKonvention", unbekannt, snap).ok, true);
});
