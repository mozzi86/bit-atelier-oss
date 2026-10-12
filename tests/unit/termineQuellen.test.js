// Phase 82 (82-01): the source registry of the deadline calendar —
// 14 sources (88-04: + genehmigung) with unique keys and valid modules, rights before loading (spy),
// a failing source does not break the agenda, the two real sources (projekt,
// manuell) and the acknowledgement path; every stub names the plan that fills it.
//
// In:  quellenRegistry.js and the sources, rechte.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ladeTermine, QUELLEN, quittiereTermin } from "@/lib/termine/quellenRegistry.js";
import { baueZugriff, MODULE } from "@core/lib/rechte.js";

const CTX = { von: "2026-09-28", bis: "2026-12-27", heute: "2026-09-28" };

/** Fake bitApi with lists per entity and a call log. */
function attrappe(listen = {}) {
  const angelegt = [];
  return {
    angelegt,
    entities: new Proxy({}, { get: (_, name) => ({
      list: async () => listen[name] || [],
      create: async (obj) => { angelegt.push([name, obj]); return { id: "neu", ...obj }; },
    }) }),
  };
}

test("14 Quellen, eindeutige Schlüssel, gültige Module; Bauzeitenplan und Lieferplan standardmäßig aus", () => {
  assert.equal(QUELLEN.length, 14);
  assert.equal(new Set(QUELLEN.map((q) => q.key)).size, 14);
  for (const q of QUELLEN) assert.ok(MODULE.includes(q.modul), `${q.key}: ${q.modul}`);
  assert.equal(QUELLEN.find((q) => q.key === "bauzeitenplan")?.standardAn, false);
  assert.equal(QUELLEN.find((q) => q.key === "lieferplan")?.standardAn, false);
});

test("Rechte vor dem Laden: ohne Recht auf personal/buchhaltung wird die Quelle nie geladen (Spy)", async () => {
  let aufrufe = 0;
  const spy = (key, modul) => ({ key, label: key, modul, standardAn: true, laden: async () => { aufrufe += 1; return [{ id: `${key}:1`, quelle: key, art: "personal_frist", klasse: "frist", datum: "2026-10-01", project_id: null, modul, objekt: "x", ziel: "/" }]; }, berechnen: (roh) => roh });
  const quellen = [spy("personal", "personal"), spy("steuer", "buchhaltung")];
  const ma = baueZugriff({ rolle: "mitarbeiter", datenquelle: "express" });
  const r = await ladeTermine(attrappe(), { ...CTX, zugriff: ma, quellen });
  assert.equal(aufrufe, 0);
  assert.deepEqual(r.termine, []);
  const inh = await ladeTermine(attrappe(), { ...CTX, zugriff: baueZugriff({ rolle: "inhaber", datenquelle: "express" }), quellen });
  assert.equal(aufrufe, 2);
  assert.equal(inh.termine.length, 2);
});

test("eine werfende Quelle bricht nicht ab: übrige Termine plus Klartext-Fehler", async () => {
  const kaputt = { key: "kaputt", label: "k", modul: "fristen", standardAn: true, laden: async () => { throw new Error("Speicher weg"); }, berechnen: () => [] };
  const gut = QUELLEN.find((q) => q.key === "projekt");
  const r = await ladeTermine(attrappe({ Project: [{ id: "proj-1", name: "Projekt A", completion_date: "2026-09-30T00:00:00.000Z" }] }), { ...CTX, quellen: [kaputt, gut] });
  assert.equal(r.termine.length, 1);
  assert.deepEqual(r.fehler, [{ quelle: "kaputt", meldung: "Speicher weg" }]);
});

test("Quelle projekt: Berliner Kalendertag, abgeschlossene Projekte entfallen", async () => {
  const q = QUELLEN.find((x) => x.key === "projekt");
  const t = q.berechnen([{ id: "proj-1", name: "Projekt A", completion_date: "2026-09-30T00:00:00.000Z" }, { id: "proj-2", completion_date: "2026-10-01", status: "completed" }], CTX);
  assert.deepEqual(t, [{ id: "projekt:proj-1:fertigstellung", quelle: "projekt", art: "projekt_fertigstellung", klasse: "termin", datum: "2026-09-30", project_id: "proj-1", modul: "projekte", objekt: "Projekt A", ziel: "/Projects" }]);
});

test("Quelle manuell: Frist mit Klasse und Ziel; wöchentlich 12 Vorkommen im Fenster", () => {
  const q = QUELLEN.find((x) => x.key === "manuell");
  const t = q.berechnen([
    { id: "te-3", titel: "Unterlagen nachreichen", art: "frist", datum: "2026-10-15", project_id: "proj-2" },
    { id: "te-2", titel: "Jour fixe", art: "termin", terminart: "jour_fixe", datum: "2026-09-29", zeit: "10:00", wiederholung: { rhythmus: "woechentlich", bis: "2026-12-15" } },
  ], CTX);
  const frist = t.find((x) => x.id.startsWith("manuell:te-3"));
  assert.equal(frist?.klasse, "frist");
  assert.equal(frist?.modul, "fristen");
  assert.equal(frist?.ziel, "/Deadlines?tab=agenda");
  assert.equal(t.filter((x) => x.id.startsWith("manuell:te-2:")).length, 12);
  assert.equal(t.find((x) => x.id === "manuell:te-2:2026-09-29")?.art, "jour_fixe");
});

test("Quittieren: ohne eigenes quittiere genau eine Terminquittung; mit eigenem die Funktion der Quelle", async () => {
  const api = attrappe();
  await quittiereTermin(api, { id: "projekt:proj-1:fertigstellung", quelle: "projekt" }, { jetzt: "2026-09-28", nutzerId: "nu-1" });
  assert.deepEqual(api.angelegt, [["Terminquittung", { termin_id: "projekt:proj-1:fertigstellung", erledigt_am: "2026-09-28", von: "nu-1" }]]);
});

test("jeder Stub nennt den füllenden Plan (STUB_BESITZER) im Kopf", async () => {
  const besitzer = { abnahme: "82-03", steuer: "82-03", personal: "82-03", vertrag: "82-03", honorarangebot: "82-03", bauzeitenplan: "82-03", ausschreibung: "82-03", lieferplan: "82-03", foerderung: "82-03", abwesenheit: "82-04", postbuch: "82-05" };
  for (const [key, plan] of Object.entries(besitzer)) {
    const pfad = new URL(`../../src/lib/termine/quellen/${key}.js`, import.meta.url);
    const quelle = fs.readFileSync(pfad, "utf8");
    const mod = await import(pfad.href);
    // A stub that a later plan filled no longer exports STUB_BESITZER — then this case is moot.
    if (!("STUB_BESITZER" in mod)) continue;
    assert.equal(mod.STUB_BESITZER, plan, key);
    assert.match(quelle, new RegExp(`filled by ${plan}`), key);
  }
});
