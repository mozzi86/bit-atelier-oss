// 82-05 Task 3/6: register numbers, outgoing entry, settling a reply, reply deadlines and the term source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bezugErledigen, eintragAusSchreiben, fristenAusPostbuch, naechsteNummer, nummerSichern } from "@core/lib/brief/postbuch.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { gruppiere } from "@/lib/termine/termineAnsicht.js";
import { contacts } from "../../packages/nova-core/server/seed-data.js";
import { AGENDA_BEITRAG, NAECHSTE_NUMMERN, SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const PERSONAL_SEED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const saat = () => beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal: personalSeedVerschieben(PERSONAL_SEED, SEED82_ANKER), kontakte: contacts });

test("Nummern PE/PA je Jahr; Saat am Stichtag = NAECHSTE_NUMMERN", () => {
  assert.equal(naechsteNummer([], "ausgang", 2026), "PA-2026-0001");
  const pb = saat().Postbucheintrag;
  assert.equal(naechsteNummer(pb, "eingang", "2026-09-28"), NAECHSTE_NUMMERN.eingang);
  assert.equal(naechsteNummer(pb, "ausgang", "2026-09-28"), NAECHSTE_NUMMERN.ausgang);
  assert.equal(naechsteNummer(pb, "ausgang", 2027), "PA-2027-0001");
});

test("Kollision beim Speichern → nächste freie Nummer mit Hinweis", () => {
  const pb = saat().Postbucheintrag;
  const neu = { richtung: "ausgang", nummer: "PA-2026-0001", datum: "2026-09-28" };
  const r = nummerSichern(neu, pb);
  assert.equal(r.eintrag.nummer, "PA-2026-0002");
  assert.equal(r.hinweis, "nummer_neu_vergeben");
  assert.equal(nummerSichern({ ...neu, nummer: "PA-2026-0002" }, pb).hinweis, null);
});

test("eintragAusSchreiben: Postausgang aus einem versendeten Schreiben", () => {
  const sc = { id: "sc-9", status: "versendet", versendet_am: "2026-09-28", versandweg: "email", betreff: "Antwort", project_id: "proj-1", bereich: "projekt",
    empfaenger: { contact_id: "c-3", firma: "Firma Beispiel", name: "" }, document_id: "doc-1" };
  const e = eintragAusSchreiben(sc, saat().Postbucheintrag);
  assert.equal(e.richtung, "ausgang");
  assert.equal(e.nummer, "PA-2026-0002");
  assert.equal(e.schreiben_id, "sc-9");
  assert.equal(e.partner_name, "Firma Beispiel");
  assert.equal(e.kanal, "email");
  assert.equal(e.project_id, "proj-1");
  assert.equal(e.bereich, "projekt");
  assert.throws(() => eintragAusSchreiben({ ...sc, status: "festgeschrieben" }, []), /versendetes/);
});

test("Antwort auf pb-1 versendet → pb-1 erledigt am Versanddatum", () => {
  const pb = saat().Postbucheintrag;
  const geaendert = bezugErledigen(pb, { status: "versendet", versendet_am: "2026-09-29", bezug: { typ: "postbuch", id: "pb-1" } });
  assert.equal(geaendert?.id, "pb-1");
  assert.equal(geaendert?.erledigt_am, "2026-09-29");
  assert.equal(bezugErledigen(pb, { status: "festgeschrieben", bezug: { typ: "postbuch", id: "pb-1" } }), null);
  assert.equal(bezugErledigen(pb, { status: "versendet", versendet_am: "2026-09-29", bezug: { typ: "postbuch", id: "pb-2" } }), null, "pb-2 ist schon erledigt");
});

test("fristenAusPostbuch: genau eine offene Frist am Stichtag (pb-1, 02.10.)", () => {
  const termine = fristenAusPostbuch(saat().Postbucheintrag);
  assert.deepEqual(termine.map((t) => ({ id: t.id, art: t.art, klasse: t.klasse, datum: t.datum, objekt: t.objekt, modul: t.modul, project_id: t.project_id, ziel: t.ziel })), [
    { id: "postbuch:pb-1:antwort", art: "postbuch_antwort", klasse: "frist", datum: "2026-10-02", objekt: "PE-2026-0001", modul: "schriftverkehr", project_id: "proj-1", ziel: "/Correspondence?tab=register" },
  ]);
  const g = gruppiere(termine, SEED82_ANKER);
  const beitrag = Object.fromEntries(Object.entries(g).filter(([, l]) => l.length).map(([k, l]) => [k, l.length]));
  assert.deepEqual(beitrag, AGENDA_BEITRAG.postbuch);
});

test("Terminquelle postbuch: Beitrag am Stichtag, über den Büro-Speicher; Cloud ohne Freigabe lädt nichts", async () => {
  const { ladeTermine } = await import("@/lib/termine/quellenRegistry.js");
  const s = saat();
  const aufrufe = [];
  const api = { entities: new Proxy({}, { get: (_, n) => ({ list: async () => { aufrufe.push(String(n)); return n === "Postbucheintrag" ? s.Postbucheintrag : []; } }) }) };
  const ctx = { heute: SEED82_ANKER, von: SEED82_ANKER, bis: "2026-12-27", aktiveQuellen: ["postbuch"], datenquelle: "express" };
  const r = await ladeTermine(api, ctx);
  const g = gruppiere(r.termine, SEED82_ANKER);
  assert.deepEqual(Object.fromEntries(Object.entries(g).filter(([, l]) => l.length).map(([k, l]) => [k, l.length])), AGENDA_BEITRAG.postbuch);
  assert.ok(aufrufe.includes("Postbucheintrag"));
  aufrufe.length = 0;
  const cloud = await ladeTermine(api, { ...ctx, datenquelle: "supabase", freigabe: false });
  assert.deepEqual(cloud.termine, []);
  assert.ok(!aufrufe.includes("Postbucheintrag"), "das Postbuch wird im gesperrten Cloud-Build nicht gelesen");
});

test("Sicht: Mitarbeiter sieht nur Einträge seiner Projekte; Bereiche ohne Personal; Vorlagen nur mit Einstellungen voll", async () => {
  const { baueZugriff } = await import("@core/lib/rechte.js");
  const { bereicheFuer, darfVorlagenPflegen, sichtbareEintraege } = await import("@/lib/schriftverkehr/sicht.js");
  const s = saat();
  const projektion = s.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen }));
  const zugriffVon = (/** @type {string} */ rolle) => baueZugriff({ nutzer: s.Nutzer.find((n) => n.rolle === rolle), zuordnungen: projektion, datenquelle: "express" });
  const ma = zugriffVon("mitarbeiter");
  assert.deepEqual(sichtbareEintraege(s.Postbucheintrag, ma).map((e) => e.nummer), ["PE-2026-0001", "PA-2026-0001"]);
  assert.deepEqual(sichtbareEintraege(s.Postbucheintrag, zugriffVon("inhaber")).map((e) => e.nummer), ["PE-2026-0001", "PE-2026-0002", "PA-2026-0001"]);
  // Office and accounting letters: buero for everyone with the module, buchhaltung only with the accounting module.
  const buero = { bereich: "buero", project_id: null };
  const buchh = { bereich: "buchhaltung", project_id: null };
  assert.deepEqual(sichtbareEintraege([buero, buchh], ma), [buero]);
  assert.deepEqual(sichtbareEintraege([buero, buchh], zugriffVon("buchhaltung")), [buero, buchh]);
  assert.deepEqual(bereicheFuer(zugriffVon("inhaber")), ["projekt", "buero", "buchhaltung"]);
  assert.deepEqual(bereicheFuer(ma), ["projekt", "buero"]);
  for (const r of ["inhaber", "projektleitung", "mitarbeiter", "buchhaltung"]) assert.ok(!(/** @type {string[]} */ (bereicheFuer(zugriffVon(r)))).includes("personal"), r);
  assert.equal(darfVorlagenPflegen(zugriffVon("inhaber")), true);
  assert.equal(darfVorlagenPflegen(zugriffVon("projektleitung")), false);
  assert.equal(darfVorlagenPflegen(ma), false);
});
