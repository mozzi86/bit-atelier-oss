// stellenanzeige.test.js — Anzeigentext aus einer Stelle (Plan 80-08, Behavior 5)
// und die Umwandlung der Anforderungen (string[] <-> {bezeichnung, muss}).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stellenanzeigeText, leseAnforderung, schreibeAnforderung } from "@/lib/people/stellenanzeige.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const seed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));
const S1 = seed.Stelle.find((s) => s.id === "S-1");

const BRIEFKOPF = { office: "Musterbüro", tagline: "Architektur", address: "Musterstr. 1, 90000 Musterstadt", contact: "info@example.org" };

describe("stellenanzeigeText — Behavior 5", () => {
  it("enthält die formatierte Gehaltsspanne (3.800 – 4.800) und keinen Personennamen aus dem Seed", () => {
    const text = stellenanzeigeText(S1, BRIEFKOPF);
    assert.ok(text.includes("3.800"));
    assert.ok(text.includes("4.800"));
    for (const b of seed.Bewerbung) {
      assert.ok(!text.includes(b.vorname));
      assert.ok(!text.includes(b.nachname));
    }
  });
  it("enthält den Stellentitel und das Büro aus dem Briefkopf", () => {
    const text = stellenanzeigeText(S1, BRIEFKOPF);
    assert.ok(text.includes(S1.titel));
    assert.ok(text.includes(BRIEFKOPF.office));
  });
  it("kein Netzaufruf: 0 Vorkommen von fetch( in der Datei", () => {
    const quelle = fs.readFileSync(path.join(REPO, "src/lib/people/stellenanzeige.js"), "utf8");
    assert.equal((quelle.match(/fetch\(/g) || []).length, 0);
  });
  it("ohne Stelle liefert die Funktion einen leeren Text", () => {
    assert.equal(stellenanzeigeText(null, BRIEFKOPF), "");
  });
});

// Review follow-up 80-08: the form reads stored string[] requirements through
// leseAnforderung and writes them back through schreibeAnforderung — before,
// an edited Stelle showed blank labels and a Muss toggle destroyed the text.
describe("Anforderungen — gespeicherte Zeile <-> Formularform {bezeichnung, muss}", () => {
  it("jede Seed-Anforderung (string[]) lädt mit sichtbarem Text", () => {
    for (const s of seed.Stelle) {
      for (const roh of s.anforderungen) {
        const a = leseAnforderung(roh);
        assert.ok(a && a.bezeichnung.length > 0, `${s.id}: ${roh}`);
        assert.ok(roh.includes(a.bezeichnung));
      }
    }
  });
  it("Muss-Zeile bleibt reiner Text, Kann trägt den Zusatz (von Vorteil)", () => {
    assert.deepEqual(leseAnforderung("Berufserfahrung LPH 5–8"), { bezeichnung: "Berufserfahrung LPH 5–8", muss: true });
    assert.equal(schreibeAnforderung({ bezeichnung: "Revit", muss: true }), "Revit");
    assert.equal(schreibeAnforderung({ bezeichnung: "Revit", muss: false }), "Revit (von Vorteil)");
  });
  it("das Seed-Idiom „… von Vorteil“ ohne Klammern gilt als Kann", () => {
    assert.deepEqual(leseAnforderung("ByAK-Mitgliedschaft von Vorteil"), { bezeichnung: "ByAK-Mitgliedschaft", muss: false });
  });
  it("Rundlauf Formular -> Speichern -> Öffnen verliert weder Text noch Muss/Kann", () => {
    for (const a of [{ bezeichnung: "ArchiCAD", muss: true }, { bezeichnung: "Führerschein B (Bauleitung)", muss: false }]) {
      assert.deepEqual(leseAnforderung(schreibeAnforderung(a)), a);
    }
  });
  it("leere und zerlegte Einträge werden verworfen statt als leere Zeile gespeichert", () => {
    assert.equal(leseAnforderung(""), null);
    assert.equal(leseAnforderung(null), null);
    assert.equal(schreibeAnforderung({ 0: "R", 1: "e", muss: false }), null);
  });
  it("stellenanzeigeText schreibt Kann mit Zusatz und nimmt auch Formularobjekte", () => {
    const text = stellenanzeigeText({ titel: "T", anforderungen: ["Revit", { bezeichnung: "ArchiCAD", muss: false }] }, null);
    assert.ok(text.includes("– Revit\n"));
    assert.ok(text.includes("– ArchiCAD (von Vorteil)"));
  });
});
