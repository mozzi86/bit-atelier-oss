// Phase 82 (82-03): content of the nine sources filled by 82-03 — acceptances
// (contribution per role), tenders and schedule as Berlin days, taxes as built
// by 79 (sole owner: income tax only, no trade tax), HR deadlines of 80
// (personnel number instead of name, acknowledged through 80's Fristquittung),
// contracts and offers of 81, funding, the cloud lock (no load, reason in the
// filter) and no stub left.
//
// In:  the sources, the samples of 79/80/81/82, rechte.js. Out: assertions only (also under TZ=UTC).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ladeTermine, QUELLEN, quittiereTermin, quellenStatus, GRUND_CLOUD } from "@/lib/termine/quellenRegistry.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar } from "@/lib/zeitHonorar/beispielDaten.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { regelNachId } from "@/lib/settings/regelwerke.js";
import { wirksamerWert } from "@core/lib/regelwerk.js";
import { AGENDA_BEITRAG, gruppeVon, SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const HEUTE = SEED82_ANKER;
const CTX = { von: "2025-09-28", bis: "2026-12-27", heute: HEUTE, regelWert: (id) => wirksamerWert(regelNachId(id), null, HEUTE)?.wert ?? null };
const Q = (key) => /** @type {any} */ (QUELLEN.find((q) => q.key === key));
const PERSONAL = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), HEUTE);

test("keine Quelle außer abwesenheit/postbuch ist noch Stub", async () => {
  for (const key of ["abnahme", "steuer", "personal", "vertrag", "honorarangebot", "bauzeitenplan", "ausschreibung", "lieferplan", "foerderung"]) {
    const mod = await import(new URL(`../../src/lib/termine/quellen/${key}.js`, import.meta.url).href);
    assert.ok(!("STUB_BESITZER" in mod), key);
  }
});

test("abnahme: Beitrag je Rolle wie AGENDA_BEITRAG (Inhaber), 0 für Projektleitung/Mitarbeiter (proj-4 nicht zugeordnet)", async () => {
  const saat = beispielDatensaetzeBueroOrga(HEUTE, { personal: PERSONAL });
  const api = { entities: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Abnahme" ? saat.Abnahme : []) }) }) };
  const projektion = saat.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen }));
  for (const nutzer of saat.Nutzer) {
    const r = await ladeTermine(api, { ...CTX, von: HEUTE, zugriff: baueZugriff({ nutzer, zuordnungen: projektion, datenquelle: "express" }), aktiveQuellen: ["abnahme"] });
    /** @type {Record<string, number>} */
    const z = {};
    for (const t of r.termine) { const g = gruppeVon(t, HEUTE); if (g) z[g] = (z[g] || 0) + 1; }
    const erwartet = nutzer.rolle === "inhaber" || nutzer.rolle === "buchhaltung" ? { ...AGENDA_BEITRAG.abnahme } : {};
    assert.deepEqual(z, erwartet, nutzer.rolle);
  }
  assert.equal(Q("abnahme").berechnen(saat.Abnahme, CTX)[0].ziel, "/Deadlines?tab=warranty");
});

test("ausschreibung und bauzeitenplan: Berliner Kalendertag, erledigt, Standard aus", () => {
  const a = Q("ausschreibung").berechnen([{ id: "td-1", name: "Rohbau", deadline: "2026-06-15T00:00:00.000Z", status: "published" }, { id: "td-2", deadline: "2026-07-01T00:00:00.000Z", status: "awarded" }], CTX);
  assert.deepEqual([a[0].datum, a[0].art, a[0].klasse, a[0].modul, a[0].ziel, a[0].erledigt], ["2026-06-15", "submission", "termin", "ava", "/AVA?tab=tender", false]);
  assert.equal(a[1].erledigt, true);
  const b = Q("bauzeitenplan").berechnen([{ id: "st-1", name: "Bodenplatte", end_date: "2026-06-19T22:30:00Z" }], CTX);
  assert.equal(b[0].datum, "2026-06-20");
  assert.equal(Q("bauzeitenplan").standardAn, false);
  assert.equal(Q("bauzeitenplan").modul, "labor");
});

test("steuer (79 wie gebaut): USt mit Perioden-ID, nur ESt-Vorauszahlungen beim Einzelunternehmen", () => {
  const b = beispielDatensaetze(HEUTE);
  const setting = b.Setting.find((s) => s.key === "buchhaltung");
  const t = Q("steuer").berechnen({ daten: b, setting }, CTX);
  const ust = t.find((x) => x.id === "steuer:ust:2026-08-01");
  assert.deepEqual([ust?.datum, ust?.art, ust?.klasse, ust?.modul, ust?.ziel], ["2026-10-12", "ust_voranmeldung", "frist", "buchhaltung", "/Accounting?tab=vat"]);
  const vz = t.filter((x) => x.art === "steuer_vorauszahlung");
  assert.ok(vz.length > 0);
  assert.ok(vz.every((x) => x.id.startsWith("steuer:est:")), "sole owner: no GewSt, no KSt");
});

test("personal (80 über den 82-Adapter): Resturlaub-Hinweis 30.09., Personalnummer statt Name; Quittung über die Fristquittung", async () => {
  const t = Q("personal").berechnen(PERSONAL, CTX);
  const hinweis = t.find((x) => x.datum === "2026-09-30");
  assert.ok(hinweis, "Resturlaub-Hinweis am 30.09.");
  for (const x of t) {
    for (const m of PERSONAL.Mitarbeiter) {
      const name = [m.vorname, m.nachname].filter(Boolean).join(" ");
      const woerter = x.objekt.split(/[\s·]+/);
      assert.ok(!x.objekt.includes(name) && !woerter.includes(String(m.nachname || "~~")), `${x.id}: Name ${name}`);
    }
    assert.match(x.objekt, /P-\d{3}|\d+$/, `${x.id}: Personalnummer oder Anzahl`);
    assert.equal(x.modul, "personal");
  }
  const angelegt = [];
  const api = { personal: { Fristquittung: { create: async (o) => { angelegt.push(["Fristquittung", o]); return o; } } }, entities: { Terminquittung: { create: async (o) => { angelegt.push(["Terminquittung", o]); return o; } } } };
  await quittiereTermin(api, hinweis, { jetzt: HEUTE, nutzerId: "nu-1" });
  assert.deepEqual(angelegt, [["Fristquittung", { schluessel: hinweis.schluessel, quittiert_am: HEUTE }]]);
  // After the acknowledgement 80 leaves the entry out.
  const danach = Q("personal").berechnen({ ...PERSONAL, Fristquittung: [{ schluessel: hinweis.schluessel, quittiert_am: HEUTE }] }, CTX);
  assert.ok(!danach.some((x) => x.id === hinweis.id));
  assert.doesNotMatch(fs.readFileSync(new URL("../../src/lib/termine/quellen/personal.js", import.meta.url), "utf8"), /bitApi\.personal/);
});

test("vertrag und honorarangebot (81-Saat): LPH 5 abgeschlossen 30.11., Angebot proj-3 läuft am 09.10. ab", () => {
  const bh = beispielDatensaetze(HEUTE);
  const zh = beispielDatensaetzeZeitHonorar(HEUTE, { buchhaltung: bh, personal: PERSONAL });
  const vertraege = bh.Honorarvertrag.map((v) => ({ ...v, ...(zh.honorarvertragPatch[v.id] || {}) }));
  const v = Q("vertrag").berechnen(vertraege, CTX);
  const lph5 = v.find((x) => x.objekt.includes("LPH 5"));
  assert.deepEqual([lph5?.datum, lph5?.art, lph5?.project_id, lph5?.ziel], ["2026-11-30", "vertrag_meilenstein", "proj-1", "/Fees?tab=contracts"]);
  const a = Q("honorarangebot").berechnen(zh.Honorarangebot, CTX);
  const ha = a.find((x) => x.objekt === "HA-2026-001");
  assert.deepEqual([ha?.datum, ha?.project_id, ha?.art, ha?.ziel], ["2026-10-09", "proj-3", "honorarangebot_ablauf", "/Fees?tab=offers"]);
});

test("foerderung und lieferplan", () => {
  const f = Q("foerderung").berechnen([{ id: "fa-1", programm_key: "beg", frist: "2026-11-30", status: "geplant", project_id: "proj-2" }, { id: "fa-2", frist: "2026-10-01", status: "bewilligt" }], CTX);
  assert.deepEqual([f[0].datum, f[0].art, f[0].modul, f[1].erledigt], ["2026-11-30", "foerderfrist", "planung", true]);
  const l = Q("lieferplan").berechnen([{ id: "bm", project_id: "proj-1", lieferung_layer: { lieferungen: [{ id: "L1", nr: 1, termin: "2026-10-20", log: 300, status: "geplant" }, { id: "L2", nr: 2, termin: "2026-09-01", log: 400, status: "geliefert" }] } }], CTX);
  assert.deepEqual(l.map((x) => [x.datum, x.art, x.modul]), [["2026-10-20", "modelllieferung", "modell"]]);
});

test("Cloud ohne Freigabe: gesperrte Quellen nicht geladen (Spy), im Filter mit Grund", async () => {
  const geladen = [];
  const spy = (key, modul) => ({ key, label: key, modul, standardAn: true, laden: async () => { geladen.push(key); return []; }, berechnen: () => [] });
  await ladeTermine({ entities: {} }, { ...CTX, datenquelle: "supabase", freigabe: false, quellen: [spy("steuer", "buchhaltung"), spy("personal", "personal"), spy("projekt", "projekte"), spy("vertrag", "auftrag")] });
  assert.deepEqual(geladen, ["projekt"]);
  const status = Object.fromEntries(quellenStatus({ ...CTX, datenquelle: "supabase", freigabe: false }).map((s) => [s.key, s]));
  for (const k of ["steuer", "personal", "vertrag", "honorarangebot", "postbuch", "abwesenheit"]) assert.deepEqual([status[k].ok, status[k].grund], [false, GRUND_CLOUD], k);
  for (const k of ["projekt", "manuell", "abnahme", "ausschreibung", "lieferplan", "foerderung"]) assert.equal(status[k].ok, true, k);
  assert.ok(quellenStatus({ ...CTX, datenquelle: "supabase", freigabe: true }).every((s) => s.ok));
});
