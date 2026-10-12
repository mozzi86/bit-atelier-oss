// Phase 82 (82-01): the personnel adapter of phase 82
// (src/lib/people/bueroOrgaPersonal.js) — lists only with access, never a call
// to the personnel API without it, a narrow assignment projection without names
// (E-17: no assignment = all projects), acknowledgements the way 80 does them,
// sample assignments only into empty fields.
//
// In:  the adapter with a fake personnel API. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ergaenzeBeispielZuordnungen, ladeAbwesenheitsDaten, ladeZuordnungsProjektion, quittierePersonalFrist, saeBeispielAbwesenheiten, entferneBeispielAbwesenheiten } from "@/lib/people/bueroOrgaPersonal.js";

/** Fake bitApi.personal with in-memory lists. */
function attrappe(start = {}) {
  const daten = structuredClone(start);
  let aufrufe = 0;
  const client = (name) => ({
    list: async () => { aufrufe += 1; return daten[name] || []; },
    get: async (id) => { aufrufe += 1; return (daten[name] || []).find((x) => x.id === id) || null; },
    create: async (obj) => { aufrufe += 1; const r = { id: obj.id || `${name}-${(daten[name] || []).length + 1}`, ...obj }; (daten[name] ||= []).push(r); return r; },
    update: async (id, patch) => { aufrufe += 1; const r = daten[name].find((x) => x.id === id); Object.assign(r, patch); return r; },
    delete: async (id) => { aufrufe += 1; daten[name] = daten[name].filter((x) => x.id !== id); },
  });
  return { api: { personal: new Proxy({}, { get: (_, n) => client(String(n)) }) }, daten, aufrufe: () => aufrufe };
}

const MA = [
  { id: "P-001", vorname: "A", nachname: "B", art: "inhaber", gehalt: 1, projekt_zuordnungen: [] },
  { id: "P-003", vorname: "C", nachname: "D", art: "angestellt", projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Projektleitung", von: "2026-01-01", bis: null, anteil_prozent: 50 }] },
];

test("ohne Zugang: leere Listen, kein Aufruf, kein Wurf", async () => {
  for (const kontext of [{ datenquelle: "serverlos", rolle: "gast" }, { datenquelle: "supabase", rolle: "admin" }]) {
    const a = attrappe({ Abwesenheit: [{ id: "aw-1" }] });
    const r = await ladeAbwesenheitsDaten(kontext, { api: a.api });
    assert.notEqual(r.zugang, "erlaubt");
    assert.deepEqual(r.abwesenheiten, []);
    assert.deepEqual(await ladeZuordnungsProjektion({ ...kontext, stichtagIso: "2026-09-28" }, { api: a.api }), []);
    assert.equal(a.aufrufe(), 0);
  }
});

test("mit Zugang: Listen; Projektion nur mit id, alle und Zuordnungen (keine Namen)", async () => {
  const a = attrappe({ Abwesenheit: [{ id: "aw-1" }], Mitarbeiter: MA, Arbeitsvertrag: [], Fristquittung: [] });
  const r = await ladeAbwesenheitsDaten({ datenquelle: "serverlos", rolle: "admin" }, { api: a.api });
  assert.equal(r.zugang, "erlaubt");
  assert.equal(r.abwesenheiten.length, 1);
  const p = await ladeZuordnungsProjektion({ datenquelle: "serverlos", rolle: "admin", stichtagIso: "2026-09-28" }, { api: a.api });
  assert.deepEqual(p, [
    { mitarbeiter_id: "P-001", alle: true, zuordnungen: [] },
    { mitarbeiter_id: "P-003", alle: false, zuordnungen: [{ project_id: "proj-1", funktion: "Projektleitung", von: "2026-01-01", bis: null }] },
  ]);
});

test("Quittung wie 80; Beispiel-Abwesenheiten säen und entfernen; Zuordnungen nur in leere Felder", async () => {
  const a = attrappe({ Mitarbeiter: structuredClone(MA), Abwesenheit: [{ id: "eigen", beispiel: false }] });
  const q = await quittierePersonalFrist("resturlaub_hinweis:P-003:2026-09-30", { jetzt: "2026-09-28", api: a.api });
  assert.deepEqual({ schluessel: q.schluessel, quittiert_am: q.quittiert_am }, { schluessel: "resturlaub_hinweis:P-003:2026-09-30", quittiert_am: "2026-09-28" });
  assert.equal(await saeBeispielAbwesenheiten([{ id: "aw-1", beispiel: true }, { id: "eigen", beispiel: true }], { api: a.api }), 1);
  assert.equal(await entferneBeispielAbwesenheiten({ api: a.api }), 1);
  assert.deepEqual(a.daten.Abwesenheit.map((x) => x.id), ["eigen"]);
  const n = await ergaenzeBeispielZuordnungen([
    { mitarbeiter_id: "P-001", projekt_zuordnungen: [{ project_id: "proj-3", funktion: "Projektleitung" }] },
    { mitarbeiter_id: "P-003", projekt_zuordnungen: [{ project_id: "proj-2", funktion: "Mitarbeit" }] },
  ], { api: a.api });
  assert.equal(n, 1);
  assert.equal(a.daten.Mitarbeiter[0].projekt_zuordnungen[0].project_id, "proj-3");
  assert.equal(a.daten.Mitarbeiter[1].projekt_zuordnungen[0].project_id, "proj-1", "set assignments stay");
});
