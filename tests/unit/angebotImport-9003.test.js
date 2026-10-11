// Unit tests for plan 90-03 (gaebXmlRead.js UP/IT/CTR + angebotImport.js): the app's OWN X83 export of
// an LV is filled in the way a bidder does it (DP 84, <UP>/<IT> per item, bidder in Award/CTR) and read
// back — unit prices and totals arrive, the bidder name is found, positions are assigned by
// Ordnungszahl (dots ignored), missing prices stay MISSING (no 0 in the bid), unknown positions,
// quantity and arithmetic deviations and a written 0,00 € are named.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildX83 } from "@ava/lib/gaebX83";
import { readX83 } from "@ava/lib/gaebXmlRead";
import { detectAndParse } from "@ava/lib/gaeb";
import { angebotZuordnen, angebotAlsBid, bieterKontakt, ozSchluessel } from "@ava/lib/angebotImport";

// Three LV positions of one trade (export shape of buildX83).
const EXPORT = [
  { oz: "01010010", titel: ["Rohbau", "Erdarbeiten"], titel_oz: ["01", "0101"], kurztext: "Oberboden abtragen", menge_final: 120, einheit: "m2" },
  { oz: "01010020", titel: ["Rohbau", "Erdarbeiten"], titel_oz: ["01", "0101"], kurztext: "Baugrube ausheben", menge_final: 850, einheit: "m3" },
  { oz: "01010030", titel: ["Rohbau", "Erdarbeiten"], titel_oz: ["01", "0101"], kurztext: "Verfüllen", menge_final: 300, einheit: "m3" },
];
// The same positions as AVA entities (OZ with dots, as the LV table shows them).
const LV = [
  { id: "p1", oz: "01.01.0010", title: "Oberboden abtragen", quantity: 120, unit: "m²" },
  { id: "p2", oz: "01.01.0020", title: "Baugrube ausheben", quantity: 850, unit: "m³" },
  { id: "p3", oz: "01.01.0030", title: "Verfüllen", quantity: 300, unit: "m³" },
];

/** Bidder fills the export: DP 84, contractor address, UP/IT for the first two items, none for the third. */
function angebotXml({ preise = { "0010": [4.5, 540], "0020": [12.8, 10880] }, menge = {}, extra = "" } = {}) {
  let xml = buildX83({ positionen: EXPORT, gewerk_nr: "012", lv_name: "Erdarbeiten" });
  xml = xml.replace("<DP>83</DP>", "<DP>84</DP><CTR><Address><Name1>Musterbau GmbH</Name1><Street>Beispielweg 3</Street><PCode>12345</PCode><City>Musterstadt</City></Address></CTR>");
  xml = xml.replace(/(<Item [^>]*RNoPart="(\d{4})">\s*<Qty>)([^<]*)(<\/Qty>\s*<QU>[^<]*<\/QU>)/g, (m, a, nr, q, b) => {
    const p = preise[nr];
    const qty = menge[nr] ?? q;
    return `${a}${qty}${b}${p ? `<UP>${p[0]}</UP><IT>${p[1]}</IT>` : ""}`;
  });
  return xml.replace("</BoQBody>", `${extra}</BoQBody>`);
}

describe("90-03 — GAEB X84 lesen", () => {
  it("Einheitspreis, Gesamtbetrag und Bieter kommen an; ohne UP bleibt der Preis null", () => {
    const r = readX83(angebotXml());
    assert.equal(r.dp, "84");
    assert.equal(r.mitPreisen, true);
    assert.deepEqual(r.bieter, { name: "Musterbau GmbH", strasse: "Beispielweg 3", plz: "12345", ort: "Musterstadt" });
    assert.deepEqual(r.positionen.map((p) => [p.oz, p.unit_price, p.total_price]), [["01010010", 4.5, 540], ["01010020", 12.8, 10880], ["01010030", null, null]]);
  });

  it("die Angebotsaufforderung (X83) bleibt ohne Preis und ohne Bieter (keine Regression)", () => {
    const r = readX83(buildX83({ positionen: EXPORT, gewerk_nr: "012" }));
    assert.equal(r.mitPreisen, false);
    assert.equal(r.bieter, null);
    assert.ok(r.positionen.every((p) => p.unit_price === null));
  });

  it("auch über den Datei-Import (detectAndParse, Endung .x84) kommen die Preise an", () => {
    const rows = detectAndParse("angebot.x84", angebotXml());
    assert.deepEqual(rows.map((p) => p.unit_price), [4.5, 12.8, null]);
  });
});

describe("90-03 — Zuordnung zum LV", () => {
  it("OZ mit/ohne Punkte gleich; fehlender Preis → ohnePreis, nicht 0; Summe aus LV-Menge × EP", () => {
    assert.equal(ozSchluessel("01.01.0010"), ozSchluessel("01010010"));
    const z = angebotZuordnen(readX83(angebotXml()).positionen, LV);
    assert.deepEqual(z.zeilen.map((x) => [x.position_id, x.unit_price]), [["p1", 4.5], ["p2", 12.8]]);
    assert.deepEqual(z.ohnePreis.map((x) => x.position_id), ["p3"]);
    assert.equal(z.summe, 540 + 10880);
    assert.equal(z.unbekannt.length, 0);
    assert.ok(z.zeilen.every((x) => x.hinweise.length === 0));
  });

  it("Menge vom Bieter geändert, Gesamtbetrag verrechnet, EP 0,00 €, Position nicht im LV — alles benannt", () => {
    const extra = `<Item ID="X" RNoPart="0099"><Qty>1</Qty><QU>psch</QU><UP>500</UP><IT>500</IT><Description><CompleteText><OutlineText><OutlTxt><TextOutlTxt><span>Zusatz</span></TextOutlTxt></OutlTxt></OutlineText></CompleteText></Description></Item>`;
    // Bidder changed the quantity of 0020 to 900 and computed his total on it (900 × 12,80 = 11 520).
    const xml = angebotXml({ preise: { "0010": [4.5, 999], "0020": [12.8, 11520], "0030": [0, 0] }, menge: { "0020": 900 }, extra });
    const z = angebotZuordnen(readX83(xml).positionen, LV);
    const h = Object.fromEntries(z.zeilen.map((x) => [x.position_id, x.hinweise.join(" | ")]));
    assert.match(h.p1, /Gesamtbetrag 999 € ≠ Menge × EP 540 €/);
    assert.match(h.p2, /Menge im Angebot 900 statt 850/);
    assert.equal(z.zeilen.find((x) => x.position_id === "p2").gp_gerechnet, 10880, "es zählt die LV-Menge");
    assert.match(h.p3, /Einheitspreis 0,00 €/);
    assert.equal(z.nullpreise, 1);
    assert.equal(z.gpAbweichend, 1);
    assert.equal(z.mengeAbweichend, 1);
    assert.equal(z.unbekannt.length, 1);
  });
});

describe("90-03 — Bieter und Angebot (Bid)", () => {
  it("Kontakt nur bei eindeutigem Namen (Rechtsform-Satzzeichen egal), sonst null", () => {
    const k = [{ id: "c1", company: "Musterbau  GmbH" }, { id: "c2", company: "Andere AG" }];
    assert.equal(bieterKontakt({ name: "Musterbau GmbH" }, k), "c1");
    assert.equal(bieterKontakt({ name: "Musterbau" }, k), null, "kein Raten");
    assert.equal(bieterKontakt(null, k), null);
  });

  it("Bid: nur Positionen mit Preis als line_items, Notiz nennt Datei und Lücken, Quelle gaeb_x84", () => {
    const z = angebotZuordnen(readX83(angebotXml()).positionen, LV);
    const bid = angebotAlsBid({ tender: { id: "t1", project_id: "pr1" }, zuordnung: z, contact_id: "c1", bieterName: "Musterbau GmbH", datei: "angebot.x84", jetzt: new Date("2026-10-11T08:00:00Z") });
    // 90-04: the bidder's line total and quantity travel along for the offer check.
    assert.deepEqual(bid.line_items, [{ position_id: "p1", unit_price: 4.5, total_price: 540, quantity: 120 }, { position_id: "p2", unit_price: 12.8, total_price: 10880, quantity: 850 }]);
    assert.equal(bid.quelle, "gaeb_x84");
    assert.equal(bid.status, "submitted");
    assert.match(bid.note, /^GAEB-Import angebot\.x84 · 1 Position\(en\) ohne Preis$/);
    assert.equal(bid.submitted_date, "2026-10-11T08:00:00.000Z");
  });
});
