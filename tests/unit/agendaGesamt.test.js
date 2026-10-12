// 82-06 Task 1: the full agenda of the five 82 sources against AGENDA_ERWARTUNG per
// role (all adapters real), and the presence rules of the 79/80/81 sources per role.
// A deviation is never fixed by changing the constants — find the cause (adapter or seed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ladeTermine, QUELLEN } from "@/lib/termine/quellenRegistry.js";
import { filterNachZugriff } from "@/lib/termine/termineAnsicht.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { wirksamerWert } from "@core/lib/regelwerk.js";
import { regelNachId } from "@/lib/settings/regelwerke.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar } from "@/lib/zeitHonorar/beispielDaten.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import * as abwesenheitQuelle from "@/lib/termine/quellen/abwesenheit.js";
import { projects, contacts } from "../../packages/nova-core/server/seed-data.js";
import { AGENDA_BEITRAG, AGENDA_ERWARTUNG, AGENDA_FENSTER_BIS, gruppeVon, SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const HEUTE = SEED82_ANKER;
const PERSONAL = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), HEUTE);
const SAAT = beispielDatensaetzeBueroOrga(HEUTE, { personal: PERSONAL, kontakte: contacts });
const regelWert = (/** @type {string} */ id) => wirksamerWert(regelNachId(id), null, HEUTE)?.wert ?? null;
const PROJEKTION = SAAT.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen }));
const zugriffVon = (/** @type {Record<string, any>} */ nutzer) => baueZugriff({ nutzer, zuordnungen: PROJEKTION, datenquelle: "express" });

/** Fake api over the demo seed: office entities and the personnel classes. */
const API = {
  entities: new Proxy({}, { get: (_, n) => {
    const liste = n === "Project" ? projects : n === "Termin" ? SAAT.Termin : n === "Abnahme" ? SAAT.Abnahme : n === "Postbucheintrag" ? SAAT.Postbucheintrag : n === "Nutzer" ? SAAT.Nutzer : [];
    return { list: async () => liste, filter: async () => [] };
  } }),
  personal: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Abwesenheit" ? SAAT.Abwesenheit : PERSONAL[/** @type {string} */ (n)] || []) }) }),
};

test("Gesamt-Agenda der fünf 82-Quellen am 28.09.2026 = AGENDA_ERWARTUNG je Rolle", async () => {
  const spurAOffen = "STUB_BESITZER" in abwesenheitQuelle;
  for (const nutzer of SAAT.Nutzer) {
    const { termine, fehler } = await ladeTermine(API, {
      von: HEUTE, bis: AGENDA_FENSTER_BIS, heute: HEUTE, regelWert, datenquelle: "express", rolle: "admin",
      zugriff: zugriffVon(nutzer), aktiveQuellen: ["projekt", "manuell", "abnahme", "postbuch", "abwesenheit"],
    });
    assert.deepEqual(fehler, [], nutzer.rolle);
    /** @type {Record<string, number>} */
    const z = { ueberfaellig: 0, heute: 0, diese_woche: 0, naechste_woche: 0, spaeter: 0 };
    for (const t of termine) { const g = gruppeVon(t, HEUTE); if (g) z[g]++; }
    const erwartet = { ...AGENDA_ERWARTUNG[/** @type {keyof typeof AGENDA_ERWARTUNG} */ (nutzer.rolle)] };
    if (spurAOffen) for (const [g, n] of Object.entries(AGENDA_BEITRAG.abwesenheit)) erwartet[/** @type {'spaeter'} */ (g)] -= n;
    const summe = erwartet.summe - (spurAOffen ? Object.values(AGENDA_BEITRAG.abwesenheit).reduce((a, b) => a + b, 0) : 0);
    delete (/** @type {any} */ (erwartet)).summe;
    assert.deepEqual(z, erwartet, nutzer.rolle);
    assert.equal(Object.values(z).reduce((a, b) => a + b, 0), summe, `${nutzer.rolle}${spurAOffen ? " (SPUR_A_OFFEN)" : ""}`);
  }
});

test("79/80/81-Quellen je Rolle: Resturlaub, USt, Honorarangebot proj-3 nur Inhaber/Buchhaltung; LPH 5 auch Projektleitung; Mitarbeiter keiner", () => {
  const Q = (/** @type {string} */ key) => /** @type {any} */ (QUELLEN.find((q) => q.key === key));
  const CTX = { von: "2025-09-28", bis: "2026-12-27", heute: HEUTE, regelWert };
  const bh = beispielDatensaetze(HEUTE);
  const zh = beispielDatensaetzeZeitHonorar(HEUTE, { buchhaltung: bh, personal: PERSONAL });
  const vertraege = bh.Honorarvertrag.map((v) => ({ ...v, ...(zh.honorarvertragPatch[v.id] || {}) }));
  const alle = [
    ...Q("personal").berechnen(PERSONAL, CTX),
    ...Q("steuer").berechnen({ daten: bh, setting: bh.Setting.find((s) => s.key === "buchhaltung") }, CTX),
    ...Q("honorarangebot").berechnen(zh.Honorarangebot, CTX),
    ...Q("vertrag").berechnen(vertraege, CTX),
  ];
  const resturlaub = (/** @type {any[]} */ l) => l.some((t) => t.quelle === "personal" && t.datum === "2026-09-30");
  const ust = (/** @type {any[]} */ l) => l.some((t) => t.art === "ust_voranmeldung");
  const angebot = (/** @type {any[]} */ l) => l.some((t) => t.objekt === "HA-2026-001" && t.datum === "2026-10-09");
  const lph5 = (/** @type {any[]} */ l) => l.some((t) => String(t.objekt).includes("LPH 5") && t.datum === "2026-11-30");
  for (const nutzer of SAAT.Nutzer) {
    const l = filterNachZugriff(alle, zugriffVon(nutzer));
    const breit = nutzer.rolle === "inhaber" || nutzer.rolle === "buchhaltung";
    assert.equal(resturlaub(l), breit, `${nutzer.rolle} Resturlaub`);
    assert.equal(ust(l), breit, `${nutzer.rolle} USt`);
    assert.equal(angebot(l), breit, `${nutzer.rolle} Honorarangebot`);
    assert.equal(lph5(l), nutzer.rolle !== "mitarbeiter", `${nutzer.rolle} LPH 5`);
  }
});
