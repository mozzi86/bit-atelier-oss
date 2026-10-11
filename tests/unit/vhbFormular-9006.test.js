// Unit tests for plan 90-06 (vhbFormular.js): form number/title/edition hint from office file names, the
// shared standard values (project, trade, award no., authority from the office profile, recipient), the
// assignment (input > standard > "[BITTE ERGÄNZEN]", form-specific fields untouched), filling a fillable
// PDF without flattening, clear errors for PDFs without fields, the log entry. The test form is generated
// here with pdf-lib — no real VHB form is shipped.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { formularAusDateiname, standardWerte, felderLesen, belegung, formularFuellen, protokollEintrag, LUECKE } from "@ava/lib/vhbFormular";

async function testformular() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  let y = 780;
  for (const n of ["ag_massnahme_bez_1", "ag_massnahme_bez_2", "ag_leistung_bez", "ag_vergabe_nr", "ag_vergabest_nam", "ag_vergabest_plz_ort", "ag_comm_empfaenger_nam", "ag_comm_empfaenger_str", "ag_201"]) {
    form.createTextField(n).addToPage(page, { x: 50, y, width: 300, height: 18 }); y -= 24;
  }
  form.createCheckBox("ag_115").addToPage(page, { x: 50, y, width: 12, height: 12 });
  return doc.save();
}

const PROJ = { name: "Testhaus", location: { address: "Musterweg 1", city: "Musterstadt" } };
const TENDER = { id: "t1", name: "Rohbau", trade: "Rohbauarbeiten", vergabevorschlag: { verfahren: "Beschränkte Ausschreibung" } };
const BID = { id: "b1", bidder_name: "Beta Bau GmbH", contact_id: "c1" };
const BUERO = { office: "Planungsbüro Muster", address: "Planstraße 2, 12345 Musterstadt", contact: "Tel. 0000 1" };

describe("formularAusDateiname", () => {
  it("reads number, title, part and edition hint", () => {
    assert.deepEqual(formularAusDateiname("4420_Abnahme.pdf"), { nummer: "4420", titel: "Abnahme", teil: "4", stand: "" });
    assert.equal(formularAusDateiname("111.H Vergabevermerk-Wahl der Vergabeart.pdf").nummer, "111.H");
    assert.equal(formularAusDateiname("C:\\VHB\\523_Nachtragsvereinbarung.pdf").titel, "Nachtragsvereinbarung");
    assert.equal(formularAusDateiname("211EU Aufforderung zur Abgabe.pdf").nummer, "211EU");
    assert.equal(formularAusDateiname("Hinweise_bearbeitbare Formulare(0722).pdf").stand, "(0722)");
    assert.equal(formularAusDateiname("Erfassungsblatt.pdf").nummer, "");
  });
});

describe("standardWerte + belegung", () => {
  it("fills shared fields from project/tender/bid/office; missing data → gap; form-specific fields stay open", async () => {
    const std = standardWerte({ projekt: PROJ, tender: TENDER, bid: BID, kontakt: { id: "c1", company: "Beta Bau GmbH", name: "Herr Beta" }, buero: BUERO, jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(std.ag_massnahme_bez_1, "Testhaus");
    assert.equal(std.ag_massnahme_bez_2, "Musterweg 1, Musterstadt");
    assert.equal(std.ag_leistung_bez, "Rohbauarbeiten");
    assert.equal(std.ag_vergabeart, "Beschränkte Ausschreibung");
    assert.equal(std.ag_vergabest_str, "Planstraße 2");
    assert.equal(std.ag_vergabest_plz_ort, "12345 Musterstadt");
    assert.equal(std.ag_comm_empfaenger_nam2, "Herr Beta");
    assert.equal(std.ag_vergabe_nr, null);
    const felder = await felderLesen(await testformular());
    assert.equal(felder.length, 10);
    const b = belegung(felder, std, { ag_201: "Freitext Seite 2" });
    const jeName = Object.fromEntries(b.belegt.map((x) => [x.name, x]));
    assert.equal(jeName.ag_vergabe_nr.wert, LUECKE);
    assert.equal(jeName.ag_vergabe_nr.quelle, "luecke");
    assert.equal(jeName.ag_comm_empfaenger_str.wert, LUECKE, "no address in the contact → gap, not invented");
    assert.equal(jeName.ag_201.quelle, "eingabe");
    assert.deepEqual(b.offen, ["ag_115"]);
    assert.deepEqual(b.luecken.sort(), ["ag_comm_empfaenger_str", "ag_vergabe_nr"]);
  });
});

describe("formularFuellen", () => {
  it("writes the values, keeps the form fillable (not flattened)", async () => {
    const leer = await testformular();
    const { bytes, gefuellt } = await formularFuellen(leer, [{ name: "ag_massnahme_bez_1", wert: "Testhaus – Süd" }, { name: "ag_vergabe_nr", wert: LUECKE }, { name: "gibt_es_nicht", wert: "x" }]);
    assert.equal(gefuellt, 2);
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    assert.equal(form.getFields().length, 10, "Felder bleiben erhalten");
    assert.equal(form.getTextField("ag_massnahme_bez_1").getText(), "Testhaus – Süd");
    assert.equal(form.getTextField("ag_vergabe_nr").getText(), LUECKE);
    assert.equal(form.getCheckBox("ag_115").isChecked(), false);
  });

  it("a PDF without fields is refused with a clear message", async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    await assert.rejects(async () => felderLesen(await doc.save()), /keine ausfüllbaren Felder/);
    await assert.rejects(() => felderLesen(new Uint8Array([1, 2, 3])), /PDF konnte nicht gelesen werden/);
  });

  it("log entry records form, edition, checker and gaps", () => {
    const e = protokollEintrag({ formular: formularAusDateiname("4420_Abnahme.pdf"), stand: " VHB Bund 2017, Stand 2024 ", datei: "4420_Abnahme.pdf", pruefer: "M. Muster", gefuellt: 7, luecken: ["ag_vergabe_nr"], jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.deepEqual(e, { datum: "2026-10-11T10:00:00.000Z", nummer: "4420", titel: "Abnahme", stand: "VHB Bund 2017, Stand 2024", datei: "4420_Abnahme.pdf", pruefer: "M. Muster", gefuellt: 7, luecken: ["ag_vergabe_nr"], bid_id: null, entwurf: true });
  });
});
