// Unit tests of the HR rule book and the rule registry (80-01, behavior 9–10):
// shape of every HR rule, the accounting group as adapted from 79 alsRegeln(),
// visibility per context and the seed step before the first accounting write.
//
// In:  src/lib/people/hrRegeln.js, src/lib/settings/regelwerke.js and the 79 sources
//      they build on. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HR_REGELN, HR_STAND } from "@/lib/people/hrRegeln.js";
import {
  REGELWERKE, RECHTSFORM_LABEL, angepassteBuchhaltungsRegeln, regelNachId, sichtbareRegelwerke,
} from "@/lib/settings/regelwerke.js";
import { alsRegeln, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { RECHTSFORMEN } from "@/lib/accounting/rechtsform.js";
import { overridesAus, pruefeOverride, wirksamerWert } from "@core/lib/regelwerk.js";

const ARTEN = new Set(["gesetz", "buero", "praxis"]);

test("Behavior 9: HR_REGELN — eindeutige IDs mit Präfix, Quelle, Art und Stand", () => {
  const ids = HR_REGELN.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte ID");
  for (const r of HR_REGELN) {
    assert.match(r.id, /^personal\.[a-z0-9_]+$/, r.id);
    assert.ok(typeof r.quelle === "string" && r.quelle.trim(), `${r.id}: Quelle fehlt`);
    assert.ok(ARTEN.has(r.art), `${r.id}: Art ${r.art}`);
    assert.match(r.stand, /^\d{4}-\d{2}-\d{2}$/, `${r.id}: Stand`);
    assert.equal(r.stand, HR_STAND);
    assert.ok(typeof r.label === "string" && r.label.trim(), `${r.id}: Label fehlt`);
    assert.ok(typeof r.abschnitt === "string" && r.abschnitt.trim(), `${r.id}: Abschnitt fehlt`);
    assert.ok(!r.id.includes("rechtsform"), `${r.id}: Rechtsform gehört 79`);
    assert.ok(!/ag_(kostenfaktor|anteil)/.test(r.id), `${r.id}: AG-Anteil gehört 81 (E-16)`);
    if (r.typ === "formel") {
      assert.equal(typeof r.formel, "function", `${r.id}: Formel fehlt`);
      assert.equal(r.editierbar, false, `${r.id}: Formel muss editierbar:false sein`);
    } else {
      assert.ok(r.werte.length > 0, `${r.id}: keine Werte`);
      for (const z of r.werte) assert.match(z.ab, /^\d{4}-\d{2}-\d{2}$/, `${r.id}: ab`);
    }
    if (r.art === "praxis") assert.ok(r.assumed, `${r.id}: Praxiswert ohne [ASSUMED]-Grund`);
  }
  assert.ok(Object.isFrozen(HR_REGELN) && Object.isFrozen(HR_REGELN[0]) && Object.isFrozen(HR_REGELN[0].werte));
});

test("Behavior 9: jeder Standardwert erfüllt die eigene Grenze", () => {
  for (const r of HR_REGELN) {
    if (!r.grenze) continue;
    for (const z of r.werte) {
      assert.equal(pruefeOverride(r, z.wert), null, `${r.id}: Standard ${z.wert} verletzt die eigene Grenze`);
    }
  }
});

test("Behavior 9: die Kündigungsstaffel ist eine feste Tabelle nach § 622 Abs. 2 BGB", () => {
  const s = HR_REGELN.find((r) => r.id === "personal.kuendigung_staffel");
  assert.equal(s.typ, "tabelle");
  assert.equal(s.editierbar, false);
  assert.deepEqual(s.werte[0].wert, [[2, 1], [5, 2], [8, 3], [10, 4], [12, 5], [15, 6], [20, 7]]);
});

test("Behavior 10: REGELWERKE hat genau buchhaltung und personal; Sichtbarkeit je Kontext", () => {
  assert.deepEqual(REGELWERKE.map((g) => g.gruppe), ["buchhaltung", "personal"]);
  assert.deepEqual(sichtbareRegelwerke({ datenquelle: "serverlos", personalZugang: "erlaubt" }).map((g) => g.gruppe), ["buchhaltung", "personal"]);
  assert.deepEqual(sichtbareRegelwerke({ datenquelle: "express", personalZugang: "keine-berechtigung" }).map((g) => g.gruppe), ["buchhaltung"]);
  assert.deepEqual(sichtbareRegelwerke({ datenquelle: "supabase", personalZugang: "nur-lokal" }), [], "E-03");
  assert.equal(REGELWERKE[1].regeln.length, HR_REGELN.length);
  assert.deepEqual(REGELWERKE[1].speicher, { art: "zeilen" });
});

test("Behavior 10: buchhaltung.rechtsform ist genau eine Auswahl-Regel aus alsRegeln()", () => {
  const treffer = REGELWERKE.flatMap((g) => g.regeln).filter((r) => r.id === "buchhaltung.rechtsform");
  assert.equal(treffer.length, 1, "nichts angehängt");
  const r = regelNachId("buchhaltung.rechtsform");
  assert.equal(r, treffer[0]);
  assert.equal(r.typ, "auswahl");
  assert.equal(r.art, "buero");
  assert.notEqual(r.editierbar, false);
  assert.deepEqual(r.optionen.map((o) => o.wert), [...RECHTSFORMEN]);
  assert.deepEqual(r.optionen.map((o) => o.wert), ["einzelunternehmen", "gbr", "partg", "gmbh", "ug"]);
  assert.deepEqual(r.optionen.map((o) => o.label), RECHTSFORMEN.map((k) => RECHTSFORM_LABEL[k]));
  assert.equal(wirksamerWert(r, null, "2026-09-27").wert, "einzelunternehmen", "Standard E-04");
  assert.equal(regelNachId("gibt.es.nicht"), null);
});

test("Behavior 10: weitere Auswahl-Regeln, nur lesende 79-Werte", () => {
  const werte = (id) => regelNachId(id).optionen.map((o) => o.wert);
  assert.deepEqual(werte("buchhaltung.ust_zeitraum"), ["monat", "quartal", "jahr"]);
  assert.deepEqual(werte("buchhaltung.versteuerung"), ["ist", "soll"]);
  assert.deepEqual(werte("buchhaltung.kontenrahmen"), ["SKR03", "SKR04"]);
  for (const id of ["buchhaltung.rechtsform", "buchhaltung.ust_zeitraum", "buchhaltung.versteuerung", "buchhaltung.kontenrahmen"]) {
    assert.equal(regelNachId(id).typ, "auswahl", id);
  }
  assert.equal(regelNachId("buchhaltung.beleg_max_bytes").editierbar, false);
  assert.equal(regelNachId("buchhaltung.mahnstufen").editierbar, false);
  assert.match(regelNachId("buchhaltung.mahnstufen").hinweis, /Mahnwesen/);
  // Yes/no rules stay as 79 publishes them.
  for (const id of ["buchhaltung.dauerfrist", "buchhaltung.gewst_aktiv", "buchhaltung.est_ueber_buero"]) {
    assert.equal(regelNachId(id).typ, "ja_nein", id);
  }
});

test("Behavior 10: die Auswahl-Werte sind genau die Whitelist von wirksameEinstellungen", () => {
  const std = wirksameEinstellungen({});
  for (const feld of ["rechtsform", "ust_zeitraum", "versteuerung", "kontenrahmen"]) {
    const r = regelNachId(`buchhaltung.${feld}`);
    for (const o of r.optionen) assert.equal(wirksameEinstellungen({ [feld]: o.wert })[feld], o.wert, `${feld}=${o.wert} verworfen`);
    assert.equal(wirksameEinstellungen({ [feld]: "unbekannt" })[feld], std[feld], `${feld}: fremder Wert muss verworfen werden`);
  }
  // Every editable accounting rule points at a field 79 keeps (the adapter reads/writes there).
  const felder = new Set(Object.keys(std));
  const gruppe = REGELWERKE[0];
  for (const r of gruppe.regeln.filter((x) => x.art === "buero" && x.editierbar !== false)) {
    assert.ok(felder.has(gruppe.speicher.feld(r.id)), `${r.id}: Feld fehlt in wirksameEinstellungen`);
  }
});

test("Behavior 10: angepassteBuchhaltungsRegeln kopiert, hängt nichts an, ändert alsRegeln() nicht", () => {
  const quelle = alsRegeln();
  const angepasst = angepassteBuchhaltungsRegeln(quelle);
  assert.equal(quelle.length, 60);
  assert.equal(angepasst.length, quelle.length);
  assert.deepEqual(angepasst.map((r) => r.id), quelle.map((r) => r.id));
  assert.deepEqual(angepassteBuchhaltungsRegeln([]), []);
  assert.equal(quelle.find((r) => r.id === "buchhaltung.rechtsform").typ, "text", "Quelle unverändert");
  assert.equal(quelle.find((r) => r.id === "buchhaltung.beleg_max_bytes").editierbar, true, "Quelle unverändert");
  assert.equal(alsRegeln().find((r) => r.id === "buchhaltung.rechtsform").typ, "text");
  for (let i = 0; i < quelle.length; i++) assert.notEqual(angepasst[i], quelle[i], "Kopie je Regel");
  assert.equal(REGELWERKE[0].regeln.length, 60);
});

test("Behavior 10: overridesAus der Gruppe buchhaltung liest die Rechtsform", () => {
  const aus = overridesAus(REGELWERKE[0], [{ id: "b", key: "buchhaltung", value: { rechtsform: "gmbh" } }]);
  assert.deepEqual(aus.get("buchhaltung.rechtsform"), { wert: "gmbh" });
});

test("83-02: keine Regelgruppe sät vor dem Schreiben Beispieldaten (Demo entfernt)", () => {
  for (const g of REGELWERKE) assert.equal(g.vorSchreiben, undefined, g.gruppe);
});
