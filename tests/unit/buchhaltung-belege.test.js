// Unit tests of receipt validation and the Beleg record shape (79-04 T3).
//
// In:  src/lib/accounting/belege.js, wirksameEinstellungen for realistic limits.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { belegDatensatz, belegVerweisSetzen, pruefeBeleg } from "@/lib/accounting/belege.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";

const EINST = wirksameEinstellungen(null); // beleg_max_bytes 5242880, beleg_mime PDF/JPG/PNG/XML

test("pruefeBeleg: 5.242.881 Byte → „Datei zu groß (max. 5 MB)“", () => {
  const r = pruefeBeleg({ name: "rechnung.pdf", size: 5242881, type: "application/pdf" }, EINST);
  assert.equal(r.ok, false);
  assert.equal(r.fehler, "Datei zu groß (max. 5 MB)");
});

test("pruefeBeleg: application/x-msdownload → „Dateityp nicht erlaubt“", () => {
  const r = pruefeBeleg({ name: "installer.exe", size: 1000, type: "application/x-msdownload" }, EINST);
  assert.equal(r.ok, false);
  assert.equal(r.fehler, "Dateityp nicht erlaubt");
});

test("pruefeBeleg: PDF mit 200 KB wird angenommen; belegDatensatz liefert mime und bezug", () => {
  const datei = { name: "rechnung.pdf", size: 204800, type: "application/pdf" };
  const r = pruefeBeleg(datei, EINST);
  assert.deepEqual(r, { ok: true, fehler: "" });
  const beleg = belegDatensatz(datei, "data:application/pdf;base64,AAAA", { typ: "Eingangsrechnung", id: "er-1" });
  assert.equal(beleg.mime, "application/pdf");
  assert.deepEqual(beleg.bezug, { typ: "Eingangsrechnung", id: "er-1" });
  assert.equal(beleg.groesse, 204800);
});

test("pruefeBeleg: Endung muss zum Mime passen (umbenannte Datei mit vorgetäuschtem Typ)", () => {
  const r = pruefeBeleg({ name: "schadcode.exe", size: 1000, type: "application/pdf" }, EINST);
  assert.equal(r.ok, false);
  assert.equal(r.fehler, "Dateityp nicht erlaubt");
});

test("pruefeBeleg: XML für XRechnung/ZUGFeRD ist erlaubt", () => {
  const r = pruefeBeleg({ name: "xrechnung.xml", size: 5000, type: "application/xml" }, EINST);
  assert.deepEqual(r, { ok: true, fehler: "" });
});

test("belegVerweisSetzen: setzt beleg_id ohne die Vorlage zu verändern", () => {
  const er = Object.freeze({ id: "er-2", lieferant: "Test", beleg_id: undefined });
  const mit = belegVerweisSetzen(er, "beleg-9");
  assert.equal(mit.beleg_id, "beleg-9");
  assert.equal(er.beleg_id, undefined, "Original unverändert");
});
