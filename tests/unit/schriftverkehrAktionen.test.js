// 82-05: freeze-and-file, mark sent, incoming mail with scan — against an in-memory API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { bytesZuDataUrl, dateiname, festschreibenUndAblegen, postbuchLoeschbar, posteingangSpeichern, SCAN_MAX_BYTES, versendetMarkieren } from "@/lib/schriftverkehr/aktionen.js";

/** In-memory API with get/list/filter/create/update/delete per entity; get of an unknown id is a 404. */
function fakeApi(start = {}) {
  /** @type {Record<string, Map<string, any>>} */
  const db = {};
  let n = 0;
  const tabelle = (/** @type {string} */ name) => (db[name] ||= new Map((start[name] || []).map((x) => [x.id, { ...x }])));
  const entities = new Proxy({}, { get: (_, name) => {
    const t = tabelle(String(name));
    return {
      list: async () => [...t.values()].map((x) => ({ ...x })),
      filter: async (/** @type {Record<string, any>} */ f) => [...t.values()].filter((x) => Object.entries(f).every(([k, v]) => x[k] === v)).map((x) => ({ ...x })),
      get: async (/** @type {string} */ id) => { if (!t.has(id)) throw Object.assign(new Error("404 Not Found"), { status: 404 }); return { ...t.get(id) }; },
      create: async (/** @type {any} */ o) => { const x = { id: o.id || `id-${++n}`, ...o }; t.set(x.id, x); return { ...x }; },
      update: async (/** @type {string} */ id, /** @type {any} */ o) => { const x = { ...t.get(id), ...o, id }; t.set(id, x); return { ...x }; },
      delete: async (/** @type {string} */ id) => { t.delete(id); },
    };
  } });
  return { api: { entities }, db, tabelle };
}

const BK = { office: "Büro Beispiel", tagline: "", address: "Beispielweg 1\n90000 Musterstadt", contact: "" };
const PB = [
  { id: "pb-1", richtung: "eingang", nummer: "PE-2026-0001", datum: "2026-09-21", frist: "2026-10-02", erledigt_am: null, project_id: "proj-1", bereich: "projekt", betreff: "Rückfrage Bemusterung Fassade" },
  { id: "pb-3", richtung: "ausgang", nummer: "PA-2026-0001", datum: "2026-09-25", schreiben_id: "sc-1", project_id: "proj-1", bereich: "projekt" },
];
const ENTWURF = {
  vorlage_key: "antwort", art: "antwort", status: "entwurf", bereich: "projekt", project_id: "proj-1", datum: "2026-09-28",
  betreff: "Ihr Schreiben vom 21.09.2026 – Rückfrage Bemusterung Fassade", text: "Sehr geehrte Damen und Herren,\n\nDanke.\n\nMit freundlichen Grüßen",
  empfaenger: { contact_id: "c-3", firma: "Firma Beispiel", name: "", strasse: "Am Werk 3", plz: "90001", ort: "Musterstadt" }, anlagen: [], bezug: { typ: "postbuch", id: "pb-1" },
};
const KTX = { briefkopf: BK, jetzt: "2026-09-28T09:15:00+02:00", datenquelle: "express" };

test("Festschreiben: PDF in 09_Schriftverkehr/Ausgang mit Bytes und SHA-256, Schreiben mit document_id", async () => {
  const { api, tabelle } = fakeApi({ Postbucheintrag: PB });
  const r = await festschreibenUndAblegen(api, ENTWURF, KTX);
  assert.equal(r.schreiben.status, "festgeschrieben");
  assert.equal(r.schreiben.pdf_sha256, crypto.createHash("sha256").update(r.bytes).digest("hex"));
  const doc = tabelle("Document").get(r.schreiben.document_id);
  assert.equal(doc.type, "Postausgang");
  assert.equal(doc.bereich, "projekt");
  assert.equal(doc.project_id, "proj-1");
  assert.equal(doc.sha256, r.schreiben.pdf_sha256);
  assert.ok(String(doc.data).startsWith("data:application/pdf;base64,"));
  assert.deepEqual(Buffer.from(String(doc.data).split(",")[1], "base64"), Buffer.from(r.bytes));
  const ordner = [...tabelle("ProjectFolder").values()];
  const ausgang = ordner.find((o) => o.id === doc.folder_id);
  assert.equal(ausgang.name, "Ausgang");
  assert.equal(ordner.find((o) => o.id === ausgang.parent_id).name, "09_Schriftverkehr");
  // Same id and timestamp → same bytes (fixed creation date and file id).
  const { api: api2 } = fakeApi();
  const r2 = await festschreibenUndAblegen(api2, { ...ENTWURF, id: r.schreiben.id }, KTX);
  assert.equal(r2.schreiben.pdf_sha256, r.schreiben.pdf_sha256);
});

test("Büro-Brief ohne Projekt: Document.bereich 'schriftverkehr' ohne project_id; Buchhaltung 'buchhaltung'", async () => {
  const { api, tabelle } = fakeApi();
  const r = await festschreibenUndAblegen(api, { ...ENTWURF, bereich: "buero", project_id: null, bezug: null }, KTX);
  const doc = tabelle("Document").get(r.schreiben.document_id);
  assert.equal(doc.bereich, "schriftverkehr");
  assert.equal(doc.project_id, null);
  assert.equal(doc.folder_id, null);
  const b = await festschreibenUndAblegen(api, { ...ENTWURF, bereich: "buchhaltung", project_id: null, bezug: null }, KTX);
  assert.equal(tabelle("Document").get(b.schreiben.document_id).bereich, "buchhaltung");
  assert.ok(![...tabelle("Document").values()].some((d) => d.bereich === "buero"), "82 schreibt nie bereich 'buero'");
});

test("Festschreiben verweigert offene Pflichtangaben und Projektbriefe ohne Projekt; Entwurf bleibt", async () => {
  const { api, tabelle } = fakeApi();
  await assert.rejects(festschreibenUndAblegen(api, { ...ENTWURF, betreff: "Ihr Schreiben vom [[fehlt: postbuch.datum]]" }, KTX), /Pflichtangaben fehlen: postbuch\.datum/);
  await assert.rejects(festschreibenUndAblegen(api, { ...ENTWURF, project_id: null }, KTX), /Projekt fehlt/);
  assert.equal(tabelle("Document").size, 0);
});

test("Umschrift: Empfänger „Şahin“ → „Sahin“, 1 Zeichen ersetzt, eingefrorener Text = PDF-Text", async () => {
  const { api } = fakeApi();
  const r = await festschreibenUndAblegen(api, { ...ENTWURF, bereich: "buero", project_id: null, bezug: null, empfaenger: { ...ENTWURF.empfaenger, name: "Şahin" } }, KTX);
  assert.equal(r.ersetzt, 1);
  assert.equal(r.schreiben.empfaenger.name, "Sahin");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: r.bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((/** @type {any} */ i) => i.str).join("|");
  assert.match(text, /Sahin/);
  assert.doesNotMatch(text, /\?ahin/);
});

test("Versendet: Postausgang PA-2026-0002 mit schreiben_id, pb-1 erledigt; festgeschriebener Ausgang nicht löschbar", async () => {
  const { api, tabelle } = fakeApi({ Postbucheintrag: PB });
  const fest = (await festschreibenUndAblegen(api, ENTWURF, KTX)).schreiben;
  const r = await versendetMarkieren(api, fest, { heute: "2026-09-28", versandweg: "brief", datenquelle: "express" });
  assert.equal(r.eintrag.nummer, "PA-2026-0002");
  assert.equal(r.eintrag.schreiben_id, fest.id);
  assert.equal(r.schreiben.status, "versendet");
  assert.equal(r.schreiben.postbuch_id, r.eintrag.id);
  assert.equal(tabelle("Postbucheintrag").get("pb-1").erledigt_am, "2026-09-28");
  assert.equal(postbuchLoeschbar(r.eintrag, [r.schreiben]), false);
  assert.equal(postbuchLoeschbar(PB[0], []), true);
});

test("Posteingang: nächste PE-Nummer, Scan in 09_Schriftverkehr/Eingang; zu großer Scan mit Klartext abgelehnt", async () => {
  const { api, tabelle } = fakeApi({ Postbucheintrag: PB });
  const scan = { name: "scan-probe.pdf", dataUrl: bytesZuDataUrl(new Uint8Array([37, 80, 68, 70])), bytes: 4 };
  const r = await posteingangSpeichern(api, { datum: "2026-09-28", betreff: "Probe", project_id: "proj-1", bereich: "projekt", kanal: "brief" }, { datenquelle: "express", scan });
  assert.equal(r.eintrag.nummer, "PE-2026-0002");
  const doc = tabelle("Document").get(r.eintrag.document_id);
  assert.equal(doc.type, "Posteingang");
  const ordner = tabelle("ProjectFolder").get(doc.folder_id);
  assert.equal(ordner.name, "Eingang");
  await assert.rejects(posteingangSpeichern(api, { datum: "2026-09-28", bereich: "buero" }, { datenquelle: "express", scan: { ...scan, bytes: SCAN_MAX_BYTES + 1 } }), /größer als 5 MB/);
});

test("Dateiname ohne Sonderzeichen", () => {
  assert.equal(dateiname({ datum: "2026-09-28", betreff: "Ihr Schreiben vom 21.09.2026 – Rückfrage/Fassade" }), "Schreiben_2026-09-28_Ihr_Schreiben_vom_21_09_2026_Ruckfrage_Fassade.pdf");
});
