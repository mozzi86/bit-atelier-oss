// 82-06 Task 2: the "my week" card model per role, without names; solo path; cloud lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { meineWoche, stundenDerWoche } from "@/lib/termine/meineWoche.js";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { wirksamerWert } from "@core/lib/regelwerk.js";
import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { regelNachId } from "@/lib/settings/regelwerke.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { INHABER_ID } from "@/lib/zeit/personalQuelle.js";
import { projects, contacts } from "../../packages/nova-core/server/seed-data.js";
import { AGENDA_FENSTER_BIS, SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const HEUTE = SEED82_ANKER;
const PERSONAL = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), HEUTE);
const SAAT = beispielDatensaetzeBueroOrga(HEUTE, { personal: PERSONAL, kontakte: contacts });
const PROJEKTION = SAAT.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen }));
const regelWert = (/** @type {string} */ id) => wirksamerWert(regelNachId(id), null, HEUTE)?.wert ?? null;
const API = {
  entities: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Project" ? projects : n === "Termin" ? SAAT.Termin : n === "Abnahme" ? SAAT.Abnahme : n === "Postbucheintrag" ? SAAT.Postbucheintrag : n === "Nutzer" ? SAAT.Nutzer : []), filter: async () => [] }) }),
  personal: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Abwesenheit" ? SAAT.Abwesenheit : PERSONAL[/** @type {string} */ (n)] || []) }) }),
};
const TERMINE = (await ladeTermine(API, { von: HEUTE, bis: AGENDA_FENSTER_BIS, heute: HEUTE, regelWert, datenquelle: "express", rolle: "admin", aktiveQuellen: ["projekt", "manuell", "abnahme", "postbuch", "abwesenheit"] })).termine;
const zugriffAls = (/** @type {string} */ rolle) => baueZugriff({ nutzer: SAAT.Nutzer.find((n) => n.rolle === rolle), zuordnungen: PROJEKTION, datenquelle: "express" });
const NAMEN = PERSONAL.Mitarbeiter.flatMap((m) => [m.vorname, m.nachname]).filter((x) => x && x.length > 2);

test("Inhaberin: fällig 2, Diese Woche höchstens fünf, niemand abwesend, 1 offener Antrag, Posteingang mit Frist 1", () => {
  const k = meineWoche({ termine: TERMINE, zugriff: zugriffAls("inhaber"), heute: HEUTE, abwesenheiten: SAAT.Abwesenheit, zuordnungen: PROJEKTION });
  assert.equal(k.faellig, 2);
  assert.ok(k.dieseWoche.length <= 5 && k.dieseWoche.length > 0);
  assert.equal(k.abwesendDieseWoche, 0);
  assert.equal(k.offeneAntraege, 1);
  assert.equal(k.posteingangFrist, 1);
});

test("Mitarbeiter: fällig 1, kein Personal-/Buchhaltungs- oder proj-4-Termin, Anträge nur eigene", () => {
  const z = zugriffAls("mitarbeiter");
  const k = meineWoche({ termine: TERMINE, zugriff: z, heute: HEUTE, abwesenheiten: SAAT.Abwesenheit, zuordnungen: PROJEKTION });
  assert.equal(k.faellig, 1);
  for (const t of k.dieseWoche) {
    assert.ok(!["personal", "buchhaltung"].includes(t.modul), t.id);
    assert.notEqual(t.project_id, "proj-4");
  }
  assert.equal(k.offeneAntraege, SAAT.Abwesenheit.filter((a) => a.status === "beantragt" && a.mitarbeiter_id === z.mitarbeiterId).length);
});

test("Projektleitung: offene Anträge der Personen ihrer Projekte", () => {
  const k = meineWoche({ termine: TERMINE, zugriff: zugriffAls("projektleitung"), heute: HEUTE, abwesenheiten: SAAT.Abwesenheit, zuordnungen: PROJEKTION });
  assert.equal(k.offeneAntraege, 1);
});

test("keine Namen, keine Kürzel, keine Abwesenheitsarten im Ergebnis", () => {
  for (const rolle of ["inhaber", "projektleitung", "mitarbeiter", "buchhaltung"]) {
    const text = JSON.stringify(meineWoche({ termine: TERMINE, zugriff: zugriffAls(rolle), heute: HEUTE, abwesenheiten: SAAT.Abwesenheit, zuordnungen: PROJEKTION }));
    for (const n of NAMEN) assert.ok(!text.includes(n), `${rolle}: ${n}`);
    for (const k of SAAT.Nutzer.map((n) => n.kuerzel)) assert.ok(!text.includes(`"${k}"`), `${rolle}: Kürzel ${k}`);
    assert.doesNotMatch(text, /\b(krank|urlaub|fortbildung)\b/i, rolle);
  }
});

test("Solo (E-17): Stunden der virtuellen Inhaber:in gegen das Tagessoll (KW 40/2026 = 2.400 min); Abwesend/Anträge entfallen", () => {
  const st = stundenDerWoche({ personId: INHABER_ID, buchungen: [{ mitarbeiter_id: INHABER_ID, datum: "2026-09-29", minuten: 120 }], feiertage: feiertage(2026, KALENDER_STANDARD), tagessollMinuten: 480, heute: "2026-09-28" });
  assert.deepEqual(st, { istMinuten: 120, sollMinuten: 2400 });
  const k = meineWoche({ termine: TERMINE, zugriff: baueZugriff({ rolle: "inhaber", datenquelle: "express" }), heute: HEUTE, stunden: st, solo: true });
  assert.deepEqual(k.stunden, st);
  assert.equal(k.abwesendDieseWoche, null);
  assert.equal(k.offeneAntraege, null);
  assert.ok(k.faellig >= 1);
});

test("Cloud ohne Freigabe (E-03): keine Blöcke gesperrter Module", () => {
  const z = baueZugriff({ rolle: "inhaber", datenquelle: "supabase", serverRolle: { role: "owner" }, freigabe: false });
  const k = meineWoche({ termine: TERMINE, zugriff: z, heute: HEUTE, stunden: { istMinuten: 0, sollMinuten: 0 }, abwesenheiten: SAAT.Abwesenheit });
  assert.equal(k.stunden, null);
  assert.equal(k.abwesendDieseWoche, null);
  assert.equal(k.offeneAntraege, null);
  assert.equal(k.posteingangFrist, null);
  for (const t of k.dieseWoche) assert.ok(!["abwesenheiten", "schriftverkehr", "personal", "buchhaltung"].includes(t.modul), t.id);
});
