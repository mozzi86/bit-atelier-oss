// Phase 81 (81-01): the pure interpretation of phase-80 personnel data for time
// tracking (src/lib/zeit/personalQuelle.js) and the adapter that alone talks to
// the personnel storage (src/lib/people/zeitHonorarPersonal.js, 80-02 leak guard).
//
// In:  the two modules, the 80 contract logic, fake APIs. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as quelle from "@/lib/zeit/personalQuelle.js";
import * as vertrag from "@/lib/people/vertrag.js";
import { ladePersonalFuerZeit, loescheKostensatz, speichereKostensatz } from "@/lib/people/zeitHonorarPersonal.js";

const { INHABER_ID, istProjektleitung, personAnzeigeName, personenFuerZeiterfassung, personIdFuer, zuordnungenFuer } = quelle;

const P1 = { id: "P-001", art: "inhaber", status: "aktiv", vorname: "Inhaberin", nachname: "A", projekt_zuordnungen: [] };
const P3 = {
  id: "P-003", art: "angestellt", status: "aktiv", vorname: "Mitarbeiterin", nachname: "B",
  projekt_zuordnungen: [
    { project_id: "proj-1", funktion: "Projektleitung", anteil_prozent: 60, von: "2026-01-01", bis: "" },
    { project_id: "proj-2", funktion: "Mitarbeit", anteil_prozent: 40, von: "2026-01-01", bis: "2026-06-30" },
  ],
};
const P5 = { id: "P-005", art: "angestellt", status: "onboarding", eintritt: "2026-11-02", vorname: "C", nachname: "C" };

test("aktiverVertrag und gehaltAm sind die 80-Funktionen (re-exportiert, nicht nachgebaut)", () => {
  assert.equal(quelle.aktiverVertrag, vertrag.aktiverVertrag);
  assert.equal(quelle.gehaltAm, vertrag.gehaltAm);
  // 80 semantics: a terminated contract counts until its end.
  const v = [{ id: "v", mitarbeiter_id: "P-3", status: "gekuendigt", beginn: "2025-01-01", ende: "2026-12-31" }];
  assert.equal(quelle.aktiverVertrag(v, "P-3", "2026-10-01")?.id, "v");
  assert.equal(quelle.aktiverVertrag(v, "P-3", "2027-01-01"), null);
});

test("personalQuelle.js ist rein: kein Personal-Speicher-Name im Quelltext (80-02-Leck-Wächter)", () => {
  const text = fs.readFileSync(new URL("../../src/lib/zeit/personalQuelle.js", import.meta.url), "utf8");
  assert.doesNotMatch(text, /bitApi\.personal|PERSONAL_ENTITAETEN|personalDb|personalDatei/);
});

test("personenFuerZeiterfassung: virtuelle Inhaber:in ohne Datensatz (E-17), sonst die echte", () => {
  assert.deepEqual(personenFuerZeiterfassung([], "2026-09-28"), [{ id: "inhaber", art: "inhaber", virtuell: true }]);
  const mit = personenFuerZeiterfassung([P3, P1, P5], "2026-09-28");
  assert.deepEqual(mit.map((p) => p.id), ["P-001", "P-003"], "Inhaberin zuerst, P-005 noch nicht eingetreten");
  assert.ok(!mit.some((p) => p.virtuell));
  assert.deepEqual(personenFuerZeiterfassung([P3], "2026-09-28").map((p) => p.id), ["inhaber", "P-003"]);
  assert.deepEqual(personenFuerZeiterfassung([P5], "2026-11-02").map((p) => p.id), ["inhaber", "P-005"]);
  assert.equal(personIdFuer("inhaber", [P1, P3]), "P-001");
  assert.equal(personIdFuer("inhaber", [P3]), INHABER_ID);
  assert.equal(personIdFuer("P-003", [P1]), "P-003");
});

test("zuordnungenFuer: Stichtag, Projekt; ohne Zuordnung alle Projekte", () => {
  const r = zuordnungenFuer(P3, { projectId: "proj-1", stichtagIso: "2026-09-28" });
  assert.equal(r.alle, false);
  assert.equal(r.zuordnungen.length, 1);
  assert.ok(istProjektleitung(r.zuordnungen[0]));
  assert.deepEqual(zuordnungenFuer(P3, { projectId: "proj-2", stichtagIso: "2026-09-28" }).zuordnungen, [], "bis 30.06. abgelaufen");
  assert.equal(zuordnungenFuer(P3, { stichtagIso: "2026-05-01" }).zuordnungen.length, 2);
  assert.deepEqual(zuordnungenFuer(P1, { projectId: "proj-1", stichtagIso: "2026-09-28" }), { alle: true, zuordnungen: [] });
  assert.deepEqual(zuordnungenFuer({ id: "inhaber", virtuell: true }, { stichtagIso: "2026-09-28" }), { alle: true, zuordnungen: [] });
  assert.equal(istProjektleitung({ funktion: "Architekt, PROJEKTLEITER" }), true);
  assert.equal(istProjektleitung({ funktion: "Mitarbeit" }), false);
});

test("personAnzeigeName: Inhaber/in als Schlüssel, sonst Vor- und Nachname", () => {
  const t = (s) => `[${s}]`;
  assert.equal(personAnzeigeName({ id: "inhaber", virtuell: true }, t), "[Inhaber/in]");
  assert.equal(personAnzeigeName(P3, t), "Mitarbeiterin B");
});

/**
 * Fake of bitApi with a call counter on every personnel list.
 * @param {Record<string, any[]>} daten
 * @param {{wirft?: boolean}} [optionen]
 */
function attrappe(daten = {}, { wirft = false } = {}) {
  let aufrufe = 0;
  const speicher = structuredClone(daten);
  const client = (name) => ({
    list: async () => { aufrufe++; if (wirft) throw new Error("Personaldaten bleiben lokal"); return speicher[name] || []; },
    get: async (id) => (speicher[name] || []).find((x) => x.id === id) || null,
    create: async (obj) => { (speicher[name] ||= []).push({ ...obj }); return obj; },
    update: async (id, rest) => { const z = speicher[name].find((x) => x.id === id); Object.assign(z, rest); return z; },
    delete: async (id) => { speicher[name] = (speicher[name] || []).filter((x) => x.id !== id); },
  });
  const personal = new Proxy({}, { get: (_t, name) => client(String(name)) });
  return { api: { personal }, aufrufe: () => aufrufe, speicher };
}

test("ladePersonalFuerZeit: Listen nur mit Zugang 'erlaubt', sonst leer ohne API-Aufruf", async () => {
  const a = attrappe({ Mitarbeiter: [P1, P3], Kostensatz: [{ id: "k1", mitarbeiter_id: "P-003", gueltig_ab: "2026-01-01", satz_eur_h: 90 }] });
  const r = await ladePersonalFuerZeit({ datenquelle: "serverlos", rolle: "admin" }, { api: a.api });
  assert.equal(r.zugang, "erlaubt");
  assert.equal(r.mitarbeiter.length, 2);
  assert.equal(r.kostensaetze.length, 1);
  assert.equal(r.fehler, null);

  const ohne = attrappe({ Mitarbeiter: [P1] });
  const keine = await ladePersonalFuerZeit({ datenquelle: "express", rolle: "mitglied" }, { api: ohne.api });
  assert.equal(keine.zugang, "keine-berechtigung");
  assert.deepEqual(keine.mitarbeiter, []);
  const cloud = await ladePersonalFuerZeit({ datenquelle: "supabase", rolle: "admin" }, { api: ohne.api });
  assert.equal(cloud.zugang, "nur-lokal");
  assert.equal(ohne.aufrufe(), 0, "kein Aufruf ohne Zugang");
});

test("ladePersonalFuerZeit: ein werfender Personal-Speicher wird Klartext in fehler, kein Wurf", async () => {
  const a = attrappe({}, { wirft: true });
  const alt = console.error;
  console.error = () => {};
  try {
    const r = await ladePersonalFuerZeit({ datenquelle: "express", rolle: "owner" }, { api: a.api });
    assert.equal(r.zugang, "nur-lokal");
    assert.match(String(r.fehler), /Personaldaten konnten nicht gelesen werden: Personaldaten bleiben lokal/);
    assert.deepEqual(r.mitarbeiter, []);
  } finally {
    console.error = alt;
  }
});

test("speichereKostensatz: get → update | create, keine Dublette; loescheKostensatz", async () => {
  const a = attrappe({ Kostensatz: [] });
  await speichereKostensatz({ id: "k1", mitarbeiter_id: "inhaber", gueltig_ab: "2026-01-01", satz_eur_h: 115 }, { api: a.api });
  await speichereKostensatz({ id: "k1", mitarbeiter_id: "inhaber", gueltig_ab: "2026-01-01", satz_eur_h: 120 }, { api: a.api });
  assert.equal(a.speicher.Kostensatz.length, 1);
  assert.equal(a.speicher.Kostensatz[0].satz_eur_h, 120);
  await loescheKostensatz("k1", { api: a.api });
  assert.equal(a.speicher.Kostensatz.length, 0);
});
