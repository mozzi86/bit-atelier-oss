// 82-05 Task 3: freezing, state changes, context per reference (seed on the reference day 28.09.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { aendereText, anschriftZeilen, briefModell, dateiIdAus, festschreiben, kontextFuer, loeschbar, sha256Hex, statusWechsel } from "@core/lib/brief/schreiben.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { mahnTextFelder } from "@/lib/accounting/mahnwesen.js";
import { mahnBrief } from "@/lib/accounting/mahnPdf.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { projects, contacts } from "../../packages/nova-core/server/seed-data.js";
import { SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const PERSONAL_SEED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const JETZT = "2026-09-28T09:15:00+02:00";

/** Seed of 82 on the reference day, contacts with the sample addresses applied like server/seed.js. */
function saat() {
  const personal = personalSeedVerschieben(PERSONAL_SEED, SEED82_ANKER);
  const r = beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal, kontakte: contacts });
  const kontakte = contacts.map((c) => ({ ...c, ...(c.address ? {} : r.kontaktAnschriften[c.id] || {}) }));
  return { r, kontakte };
}

const ENTWURF = { id: "sc-t", status: "entwurf", text: "Hallo", felder: { a: 1 }, betreff: "Test" };

test("festschreiben friert Text ein, setzt Hash und Layoutversion; zweites Mal und danach Text ändern scheitern", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fest = await festschreiben(ENTWURF, { pdfBytes: bytes, jetzt: JETZT, layoutVersion: 1 });
  assert.equal(fest.status, "festgeschrieben");
  assert.equal(fest.festgeschrieben_am, JETZT);
  assert.equal(fest.text, "Hallo");
  assert.equal(fest.layout_version, 1);
  assert.equal(fest.pdf_sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  await assert.rejects(festschreiben(fest, { pdfBytes: bytes, jetzt: JETZT }), /bereits festgeschrieben/);
  assert.throws(() => aendereText(fest, "neu"), /nicht änderbar/);
  await assert.rejects(festschreiben(ENTWURF, { pdfBytes: bytes, jetzt: JETZT, fehlend: ["postbuch.betreff"] }), /Pflichtangaben fehlen: postbuch\.betreff/);
});

test("Status nur vorwärts, Löschen nur im Entwurf", async () => {
  const fest = await festschreiben(ENTWURF, { pdfBytes: new Uint8Array([9]), jetzt: JETZT });
  const vers = statusWechsel(fest, "versendet", { jetzt: "2026-09-28", versandweg: "email" });
  assert.equal(vers.status, "versendet");
  assert.equal(vers.versandweg, "email");
  assert.throws(() => statusWechsel(vers, /** @type {any} */ ("festgeschrieben")), /nicht erlaubt/);
  assert.throws(() => statusWechsel(ENTWURF, "versendet"), /nicht erlaubt/);
  assert.equal(loeschbar(ENTWURF), true);
  assert.equal(loeschbar(fest), false);
  assert.equal(loeschbar(vers), false);
});

test("sha256Hex und dateiIdAus: stabil, 32 Hex-Zeichen", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const id = await dateiIdAus("sc-test");
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(id, await dateiIdAus("sc-test"));
});

test("kontextFuer postbuch:pb-1 — Bezug, Empfänger mit Anschrift aus c-3, Projekt proj-1, Büro aus dem Briefkopf", () => {
  const { r, kontakte } = saat();
  const k = kontextFuer({ typ: "postbuch", id: "pb-1" }, {
    heute: SEED82_ANKER, briefkopf: { office: "Büro Beispiel", tagline: "", address: "Beispielweg 1\n90000 Musterstadt", contact: "" },
    kontakte, projekte: projects, postbuch: r.Postbucheintrag,
  });
  assert.deepEqual(k.daten.postbuch, { nummer: "PE-2026-0001", datum: "2026-09-21", betreff: "Rückfrage Bemusterung Fassade", ihr_zeichen: "" });
  assert.equal(k.project_id, "proj-1");
  assert.equal(k.bereich, "projekt");
  assert.equal(k.daten.buero.name, "Büro Beispiel");
  assert.equal(k.empfaenger?.contact_id, "c-3");
  const c3 = kontakte.find((c) => c.id === "c-3");
  assert.equal(k.empfaenger?.firma, c3.company);
  assert.equal(k.empfaenger?.strasse, "Am Werk 3");
  assert.equal(k.empfaenger?.plz, "90001");
  assert.deepEqual(anschriftZeilen(k.empfaenger).slice(-2), ["Am Werk 3", "90001 Musterstadt"]);
  assert.deepEqual(k.hinweise, []);
});

test("kontextFuer rechnung Stufe 2 — Zinsen und Pauschale aus mahnungen[], Text aus 79 (mahnBrief(mahnTextFelder))", () => {
  // 79 fixture: 10.000 € to a business, default from 01.06.; the dunning run of 31.07. recorded 173,76 € and 40 €.
  const rechnung = {
    id: "re-t", nummer: "RE-2026-005", rechnungsdatum: "2026-05-17", brutto: 10000, netto: 8403.36, ust: 1596.64, ust_satz: 19,
    faellig_am: "2026-05-31", zahlungen: [],
    mahnungen: [{ stufe: 1, datum: "2026-06-15", frist: "2026-06-25" }, { stufe: 2, datum: "2026-07-31", frist: "2026-08-10", zinsen: 173.76, pauschale: 40 }],
    empfaenger: { name: "Beispiel Immobilien GmbH", anschrift: "Musterstraße 1\n90402 Nürnberg", art: "unternehmer" },
  };
  const T = (/** @type {string} */ s) => s;
  const mahnText = (/** @type {any} */ re, /** @type {number} */ stufe) => {
    const f = mahnTextFelder(re, stufe, { heute: "2026-09-28", einst: {}, briefkopf: {}, vertrag: null }, T);
    const b = mahnBrief(f);
    return { betreff: b.betreff || "", absaetze: b.absaetze || [], tabelle: /** @type {any} */ (b.tabelle), offenCent: f.offenCent, zinsenCent: f.zinsenCent, pauschaleCent: f.pauschaleCent, summeCent: f.summeCent };
  };
  const k = kontextFuer({ typ: "rechnung", id: "re-t", stufe: 2 }, { heute: "2026-09-28", rechnungen: [rechnung], mahnText });
  assert.equal(k.daten.mahnung.zinsen, 173.76);
  assert.equal(k.daten.mahnung.pauschale, 40);
  assert.equal(k.daten.mahnung.frist, "2026-08-10");
  assert.equal(k.bereich, "buchhaltung");
  assert.equal(k.project_id, null);
  assert.equal(k.empfaenger?.firma, "Beispiel Immobilien GmbH");
  assert.equal(k.empfaenger?.plz, "90402");
  const erwartet = mahnBrief(mahnTextFelder(rechnung, 2, { heute: "2026-09-28", einst: {}, briefkopf: {}, vertrag: null }, T)).absaetze;
  assert.equal(k.text, (erwartet || []).join("\n\n"));
  assert.ok(String(k.text).includes("RE-2026-005"));
  // Without 79's builder the letter says so instead of inventing a text.
  assert.deepEqual(kontextFuer({ typ: "rechnung", id: "re-t", stufe: 2 }, { heute: "2026-09-28", rechnungen: [rechnung] }).hinweise, ["Mahntext aus der Buchhaltung nicht verfügbar"]);
});

test("kontextFuer: unbekannter Bezug und fehlender Datensatz werden gemeldet", () => {
  assert.deepEqual(kontextFuer({ typ: "postbuch", id: "gibt-es-nicht" }, { heute: SEED82_ANKER }).hinweise, ["Bezug nicht gefunden"]);
  assert.deepEqual(kontextFuer({ typ: "x", id: "1" }, { heute: SEED82_ANKER }).hinweise, ["Bezug unbekannt"]);
  assert.equal(kontextFuer(null, { heute: SEED82_ANKER }).bereich, "buero");
});

test("briefModell: Absender aus dem Briefkopf, Anschriftfeld, Absätze je Zeile, Anlagen, Verteiler ohne Anschriftfeld", () => {
  const bk = { office: "Büro Beispiel", address: "Beispielweg 1\n90000 Musterstadt", contact: "Tel. 000" };
  const m = briefModell({ betreff: "B", text: "Sehr geehrte Damen und Herren,\n\nText.\n\nMit freundlichen Grüßen", anlagen: ["Plan"],
    empfaenger: { firma: "Firma Beispiel", strasse: "Musterweg 4", plz: "90000", ort: "Musterstadt" } }, { briefkopf: bk, datumText: "28.09.2026" });
  assert.deepEqual(m.absender, ["Büro Beispiel", "Beispielweg 1", "90000 Musterstadt"]);
  assert.deepEqual(m.empfaenger, ["Firma Beispiel", "Musterweg 4", "90000 Musterstadt"]);
  assert.deepEqual(m.absaetze, ["Sehr geehrte Damen und Herren,", "Text.", "Mit freundlichen Grüßen", "Anlagen: Plan"]);
  assert.equal(m.seitenzahlen, true);
  assert.equal(m.fusszeileLinks, "Büro Beispiel · Beispielweg 1, 90000 Musterstadt · Tel. 000");
  const p = briefModell({ variante: "verteiler", verteiler: ["Bauherr", "Tragwerk"], text: "x", empfaenger: { firma: "F" } }, { briefkopf: bk, datumText: "" });
  assert.deepEqual(p.empfaenger, []);
  assert.deepEqual(p.verteiler, ["Bauherr", "Tragwerk"]);
});

test("fehlendIn findet [[fehlt: …]]-Marken in Betreff und Text", async () => {
  const { fehlendIn } = await import("@core/lib/brief/schreiben.js");
  assert.deepEqual(fehlendIn({ betreff: "Ihr Schreiben vom [[fehlt: postbuch.datum]]", text: "a [[fehlt: postbuch.datum]] b [[fehlt: x.y]]" }), ["postbuch.datum", "x.y"]);
  assert.deepEqual(fehlendIn({ betreff: "ok", text: "ok" }), []);
});

test("umschreiben: Empfänger „Şahin“ → „Sahin“, 1 Zeichen ersetzt, contact_id unverändert", async () => {
  const { umschreiben } = await import("@core/lib/brief/schreiben.js");
  const r = umschreiben({ betreff: "Test", text: "Hallo", empfaenger: { contact_id: "c-Ş", name: "Şahin", firma: "", strasse: "Weg 1", plz: "90000", ort: "Musterstadt" }, anlagen: [], verteiler: [] });
  assert.equal(r.ersetzt, 1);
  assert.deepEqual(r.zeichen, ["Ş"]);
  assert.equal(r.schreiben.empfaenger.name, "Sahin");
  assert.equal(r.schreiben.empfaenger.contact_id, "c-Ş");
  assert.equal(umschreiben({ betreff: "a → b", text: "", empfaenger: null }).schreiben.betreff, "a -> b");
});

test("umschreiben lässt Zeilenumbrüche stehen (kein „?“ für \n)", async () => {
  const { umschreiben } = await import("@core/lib/brief/schreiben.js");
  const r = umschreiben({ betreff: "", text: "a\n\nb", empfaenger: null });
  assert.equal(r.schreiben.text, "a\n\nb");
  assert.equal(r.ersetzt, 0);
});
