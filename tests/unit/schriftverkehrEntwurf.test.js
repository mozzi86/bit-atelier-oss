// 82-05: deep-link contract and the prefilled draft (reply to PE-2026-0001 on the reference day).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { leseDeepLink, schreibenLink } from "@/lib/schriftverkehr/deepLink.js";
import { ladeBezugDaten, neuerEntwurf } from "@/lib/schriftverkehr/bezugLaden.js";
import { alleVorlagen, mitBueroFassung } from "@core/lib/brief/vorlagen.js";
import { fehlendIn } from "@core/lib/brief/schreiben.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { projects, contacts } from "../../packages/nova-core/server/seed-data.js";
import { SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const KEYS = alleVorlagen().map((v) => v.key);
const vorlage = (/** @type {string} */ key) => mitBueroFassung(/** @type {any} */ (alleVorlagen().find((v) => v.key === key)), []);

test("Deep-Link: Link bauen und lesen; unbekannte Vorlage → freier Brief mit Hinweis", () => {
  const link = schreibenLink({ neu: "mahnung", bezug: { typ: "rechnung", id: "re-1" }, stufe: 2 });
  assert.equal(link, "/Correspondence?neu=mahnung&bezug=rechnung%3Are-1&stufe=2");
  const r = leseDeepLink(new URL(`http://x${link}`).searchParams, KEYS);
  assert.deepEqual(r, { vorlageKey: "mahnung", bezug: { typ: "rechnung", id: "re-1", stufe: 2 }, hinweise: [] });
  assert.deepEqual(leseDeepLink(new URLSearchParams("neu=gibtsnicht&bezug=projekt:proj-1"), KEYS), { vorlageKey: "brief", bezug: { typ: "projekt", id: "proj-1" }, hinweise: ["unbekannte_vorlage"] });
  assert.deepEqual(leseDeepLink(new URLSearchParams("neu=brief&bezug=personal:m-1"), KEYS)?.hinweise, ["unbekannter_bezug"]);
  assert.equal(leseDeepLink(new URLSearchParams("tab=letters"), KEYS), null);
});

test("Antwort auf PE-2026-0001: Empfänger mit Anschrift, Betreff, Bezug, Projekt — keine [[fehlt-Marke", () => {
  const personal = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), SEED82_ANKER);
  const r = beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal, kontakte: contacts });
  const kontakte = contacts.map((c) => ({ ...c, ...(c.address ? {} : r.kontaktAnschriften[c.id] || {}) }));
  const { entwurf, hinweise } = neuerEntwurf(vorlage("antwort"), { typ: "postbuch", id: "pb-1" }, { heute: SEED82_ANKER, briefkopf: {}, kontakte, projekte: projects, postbuch: r.Postbucheintrag });
  assert.deepEqual(hinweise, []);
  assert.equal(entwurf.betreff, "Ihr Schreiben vom 21.09.2026 – Rückfrage Bemusterung Fassade");
  assert.equal(entwurf.empfaenger.firma, kontakte.find((c) => c.id === "c-3").company);
  assert.equal(entwurf.empfaenger.strasse, "Am Werk 3");
  assert.deepEqual(entwurf.bezug, { typ: "postbuch", id: "pb-1" });
  assert.equal(entwurf.project_id, "proj-1");
  assert.equal(entwurf.bereich, "projekt");
  assert.equal(entwurf.status, "entwurf");
  assert.deepEqual(fehlendIn(entwurf), []);
  assert.match(entwurf.text, /vielen Dank für Ihr Schreiben vom 21\.09\.2026\./);
});

test("Antwort ohne Bezug: Pflichtplatzhalter sichtbar als [[fehlt: …]]; freier Brief ohne Projekt im Bereich Büro", () => {
  const { entwurf } = neuerEntwurf(vorlage("antwort"), null, { heute: SEED82_ANKER });
  assert.deepEqual(fehlendIn(entwurf), ["postbuch.datum", "postbuch.betreff"]);
  const frei = neuerEntwurf(vorlage("brief"), null, { heute: SEED82_ANKER }).entwurf;
  assert.equal(frei.bereich, "buero");
  assert.equal(frei.project_id, null);
  const mitProjekt = neuerEntwurf(vorlage("brief"), null, { heute: SEED82_ANKER }, { projectId: "proj-2" }).entwurf;
  assert.equal(mitProjekt.bereich, "projekt");
  assert.equal(mitProjekt.project_id, "proj-2");
});

test("Protokoll aus projekt:proj-1: Variante verteiler, Pflicht protokoll.titel bleibt offen", () => {
  const { entwurf } = neuerEntwurf(vorlage("protokoll"), { typ: "projekt", id: "proj-1" }, { heute: SEED82_ANKER, projekte: projects });
  assert.equal(entwurf.variante, "verteiler");
  assert.deepEqual(entwurf.verteiler, []);
  assert.equal(entwurf.project_id, "proj-1");
  assert.ok(entwurf.text.startsWith(`Projekt: ${projects.find((p) => p.id === "proj-1").name}`));
  assert.deepEqual(fehlendIn(entwurf), ["protokoll.titel"]);
});

test("88-02: Behinderungsanzeige aus dem Bautagebuch — Zeitraum, Bautagebuch-Text, Projekt, Deep-Link", async () => {
  const eintraege = [
    { id: "bt-1", project_id: "proj-1", datum: "2026-11-10", temp_min: -3, behinderung: false },
    { id: "bt-2", project_id: "proj-1", datum: "2026-11-11", niederschlag_mm: 12, behinderung: true, behinderung_text: "Kran ausgefallen" },
    { id: "bt-x", project_id: "proj-2", datum: "2026-11-11", behinderung: true, behinderung_text: "anderes Projekt" },
  ];
  const api = { entities: { BautagebuchEintrag: {
    get: async (/** @type {string} */ id) => eintraege.find((e) => e.id === id),
    filter: async (/** @type {any} */ q) => eintraege.filter((e) => e.project_id === q.project_id),
  } } };
  const seite = { heute: "2026-11-12", briefkopf: {}, kontakte: [], projekte: projects, postbuch: [], t: (/** @type {string} */ s) => s };
  const daten = await ladeBezugDaten(api, { typ: "bautagebuch", id: "bt-1" }, seite);
  const { entwurf, hinweise } = neuerEntwurf(vorlage("behinderungsanzeige"), { typ: "bautagebuch", id: "bt-1" }, daten);
  assert.deepEqual(hinweise, []);
  assert.match(entwurf.betreff, /^Behinderungsanzeige nach § 6 Abs\. 1 VOB\/B – /);
  assert.match(entwurf.text, /10\.11\.2026 – 11\.11\.2026/);
  assert.match(entwurf.text, /an 2 Tagen/);
  assert.match(entwurf.text, /11\.11\.2026: Niederschlag 12 mm, Kran ausgefallen/);
  assert.doesNotMatch(entwurf.text, /anderes Projekt/);
  assert.equal(entwurf.project_id, "proj-1");
  assert.equal(entwurf.bereich, "projekt");
  assert.deepEqual(fehlendIn(entwurf), []);
  assert.deepEqual(leseDeepLink(new URLSearchParams("neu=behinderungsanzeige&bezug=bautagebuch:bt-1"), KEYS)?.bezug, { typ: "bautagebuch", id: "bt-1" });
  // unknown diary entry → reference not found, required fields visibly missing
  const leer = neuerEntwurf(vorlage("behinderungsanzeige"), { typ: "bautagebuch", id: "bt-9" }, await ladeBezugDaten(api, { typ: "bautagebuch", id: "bt-9" }, seite));
  assert.deepEqual(leer.hinweise, ["Bezug nicht gefunden"]);
  assert.ok(fehlendIn(leer.entwurf).includes("behinderung.zeitraum"));
  // N-9: the office version to the client uses the same diary data, without the statutory VOB/B wording.
  const bauherr = neuerEntwurf(vorlage("behinderung_bauherr"), { typ: "bautagebuch", id: "bt-1" }, daten);
  assert.deepEqual(bauherr.hinweise, []);
  assert.match(bauherr.entwurf.betreff, /^Mitteilung über eine Behinderung der Bauausführung – /);
  assert.match(bauherr.entwurf.text, /als Bauleitung teilen wir Ihnen mit/);
  assert.match(bauherr.entwurf.text, /11\.11\.2026: Niederschlag 12 mm, Kran ausgefallen/);
  assert.doesNotMatch(bauherr.entwurf.text, /hiermit zeigen wir gemäß/);
  assert.deepEqual(fehlendIn(bauherr.entwurf), []);
  assert.deepEqual(leseDeepLink(new URLSearchParams("neu=behinderung_bauherr&bezug=bautagebuch:bt-1"), KEYS)?.vorlageKey, "behinderung_bauherr");
});
