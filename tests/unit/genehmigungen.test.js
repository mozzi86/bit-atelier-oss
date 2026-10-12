// 88-04: permit procedures — status flow, statutory deadlines (guide values), condition deadlines, hints, term source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auflagenFristen, fristenVon, hinweise, naechsteStatus, normalisiereGenehmigung } from "@/lib/werkplanung/genehmigungen.js";
import { QUELLE } from "@/lib/termine/quellen/genehmigung.js";

test("Status nur vorwärts; Nachforderung führt zurück zu „eingereicht“", () => {
  assert.deepEqual(naechsteStatus("vorbereitung"), ["eingereicht", "zurueckgezogen"]);
  assert.ok(naechsteStatus("nachforderung").includes("eingereicht"));
  assert.deepEqual(naechsteStatus("genehmigt"), []);
  assert.equal(normalisiereGenehmigung({ art: "x", status: "y" }).art, "bauantrag");
  assert.equal(normalisiereGenehmigung({ art: "x", status: "y" }).status, "vorbereitung");
});

test("Vereinfachtes Verfahren: Vollständigkeit 3 Wochen, Fiktion 3 Monate nach Vollständigkeit", () => {
  const f = fristenVon({ id: "g1", art: "vereinfacht", status: "eingereicht", eingereicht_am: "2026-03-02", vollstaendig_am: "2026-03-16" });
  assert.deepEqual(f.map((x) => [x.schluessel, x.datum, x.erledigt]), [["vollstaendigkeit", "2026-03-23", true], ["fiktion", "2026-06-16", false]]);
  assert.match(f[1].herkunft, /Art\. 68/);
});

test("Freistellung: Wartefrist 1 Monat, keine Vollständigkeitsprüfung", () => {
  const f = fristenVon({ id: "g2", art: "freistellung", status: "eingereicht", eingereicht_am: "2026-01-31" });
  assert.deepEqual(f.map((x) => [x.schluessel, x.datum]), [["wartefrist", "2026-02-28"]]);
});

test("Genehmigt: Geltung 4 Jahre, erledigt mit Baubeginn; Vorbescheid 3 Jahre", () => {
  const g = fristenVon({ id: "g3", art: "bauantrag", status: "genehmigt", eingereicht_am: "2026-01-05", vollstaendig_am: "2026-01-20", bescheid_am: "2026-05-04" });
  assert.deepEqual(g.find((x) => x.schluessel === "geltung"), { schluessel: "geltung", label: "Genehmigung erlischt ohne Baubeginn", datum: "2030-05-04", herkunft: "Art. 69 Abs. 1 BayBO", erledigt: false });
  assert.equal(fristenVon({ id: "g3", art: "bauantrag", status: "genehmigt", bescheid_am: "2026-05-04", baubeginn_am: "2026-09-01" }).find((x) => x.schluessel === "geltung")?.erledigt, true);
  assert.equal(fristenVon({ id: "g4", art: "vorbescheid", status: "genehmigt", bescheid_am: "2026-05-04" }).find((x) => x.schluessel === "geltung")?.datum, "2029-05-04");
});

test("Nachforderung zum gesetzten Datum", () => {
  const f = fristenVon({ id: "g5", art: "bauantrag", status: "nachforderung", eingereicht_am: "2026-02-02", nachforderung_frist: "2026-03-10" });
  assert.deepEqual(f.map((x) => [x.schluessel, x.erledigt]), [["vollstaendigkeit", true], ["nachforderung", false]]);
});

test("Hinweise: Befreiung ohne Begründung, offene Auflage vor Baubeginn, Baubeginn vor Bescheid", () => {
  assert.deepEqual(hinweise({ id: "b", art: "befreiung" }).map((h) => h.art), ["begruendung_fehlt"]);
  assert.deepEqual(hinweise({ id: "b", art: "befreiung", begruendung: "Grundzüge der Planung nicht berührt" }), []);
  const auflagen = [{ id: "a1", genehmigung_id: "g", phase: "vor_baubeginn", status: "offen" }, { id: "a2", genehmigung_id: "g", phase: "vor_baubeginn", status: "erfuellt" }];
  assert.deepEqual(hinweise({ id: "g", art: "bauantrag", status: "genehmigt", bescheid_am: "2026-05-04", baubeginn_am: "2026-06-01" }, auflagen).map((h) => [h.art, h.werte.anzahl]), [["auflage_vor_baubeginn", 1]]);
  assert.deepEqual(hinweise({ id: "g", art: "bauantrag", status: "eingereicht", baubeginn_am: "2026-06-01" }).map((h) => h.art), ["baubeginn_vor_freigabe"]);
});

test("Auflagen-Fristen und Terminquelle", () => {
  const auflagen = [{ id: "a1", project_id: "p", nr: "3", text: "Standsicherheitsnachweis vorlegen", frist: "2026-07-01", status: "offen" }, { id: "a2", project_id: "p", text: "ohne Frist" }];
  assert.equal(auflagenFristen(auflagen).length, 1);
  const termine = QUELLE.berechnen({ genehmigungen: [{ id: "g1", project_id: "p", art: "vereinfacht", aktenzeichen: "B-2026-0001", status: "eingereicht", eingereicht_am: "2026-03-02", vollstaendig_am: "2026-03-16" }], auflagen }, /** @type {any} */ ({}));
  assert.deepEqual(termine.map((t) => [t.art, t.datum, t.erledigt]), [["genehmigung_frist", "2026-03-23", true], ["genehmigung_frist", "2026-06-16", false], ["auflage_frist", "2026-07-01", false]]);
  assert.equal(termine[1].objekt, "Vereinfachtes Verfahren · B-2026-0001: Genehmigungsfiktion");
  assert.equal(termine[1].annahme, true);
  assert.equal(termine[2].ziel, "/Werkplanung?tab=genehmigungen");
  assert.equal(QUELLE.modul, "planung");
});
