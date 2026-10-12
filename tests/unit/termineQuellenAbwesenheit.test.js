// 82-04 Task 3: term source abwesenheit — approved only, initials without reason, contribution on the reference day.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { QUELLE } from "@/lib/termine/quellen/abwesenheit.js";
import * as quelleModul from "@/lib/termine/quellen/abwesenheit.js";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";
import { gruppiere } from "@/lib/termine/termineAnsicht.js";
import { alsIcs } from "@core/lib/kalender/ics.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { contacts } from "../../packages/nova-core/server/seed-data.js";
import { AGENDA_BEITRAG, SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const PERSONAL = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), SEED82_ANKER);
const SAAT = beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal: PERSONAL, kontakte: contacts });

/** Fake api: personnel classes and the users of the office store. */
const api = {
  personal: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Abwesenheit" ? SAAT.Abwesenheit : n === "Mitarbeiter" ? PERSONAL.Mitarbeiter : []) }) }),
  entities: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Nutzer" ? SAAT.Nutzer : []), filter: async () => [] }) }),
};
const CTX = { heute: SEED82_ANKER, von: SEED82_ANKER, bis: "2026-12-27", datenquelle: "express", rolle: "admin", aktiveQuellen: ["abwesenheit"] };

test("kein Stub mehr", () => {
  assert.ok(!("STUB_BESITZER" in quelleModul));
});

test("nur genehmigte, Kürzel ohne Grund, ziel Teamkalender", async () => {
  const daten = await QUELLE.laden(api, CTX);
  const termine = QUELLE.berechnen(daten, CTX);
  assert.deepEqual(termine.map((t) => t.id).sort(), ["abwesenheit:aw-3", "abwesenheit:aw-5"]);
  for (const t of termine) {
    assert.equal(t.klasse, "hinweis");
    assert.equal(t.modul, "abwesenheiten");
    assert.equal(t.project_id, null);
    assert.equal(t.ziel, "/Absences?tab=team");
    assert.doesNotMatch(JSON.stringify(t), /urlaub|krank|fortbildung/i);
  }
  assert.equal(termine.find((t) => t.id === "abwesenheit:aw-3")?.objekt, SAAT.Nutzer.find((n) => n.mitarbeiter_id === SAAT.Abwesenheit.find((a) => a.id === "aw-3")?.mitarbeiter_id)?.kuerzel);
  assert.ok(!alsIcs(termine, { jetzt: "2026-09-28T08:00:00Z", titel: (x) => x.objekt }).includes("VEVENT"), "nie in der .ics");
});

test("Beitrag am Stichtag = AGENDA_BEITRAG.abwesenheit, für Inhaber, Projektleitung und Mitarbeiter gleich", async () => {
  for (const rolle of ["inhaber", "projektleitung", "mitarbeiter"]) {
    const r = await ladeTermine(api, { ...CTX, zugriff: baueZugriff({ rolle, datenquelle: "express" }) });
    const g = gruppiere(r.termine, SEED82_ANKER);
    assert.deepEqual(Object.fromEntries(Object.entries(g).filter(([, l]) => l.length).map(([k, l]) => [k, l.length])), AGENDA_BEITRAG.abwesenheit, rolle);
  }
});
