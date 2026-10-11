// Unit tests for plan 90-07 (src/lib/people/beteiligte.js + beteiligtePdf.js): the stored list is
// normalised (no duplicates, entries without contact dropped, unknown roles kept), rows are sorted by the
// role catalogue, a deleted contact stays visible, suggestions come from client contacts and awarded
// tenders, add/remove/change return new lists, the PDF is A4 landscape with groups and breaks pages.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { PDFDocument } from "pdf-lib";

import { ROLLEN, normalisieren, zeilen, vorschlaege, hinzufuegen, entfernen, aendern } from "@/lib/people/beteiligte";
import { beteiligtePdf } from "@/lib/people/beteiligtePdf";

const K = [
  { id: "c1", name: "Anna Weber", company: "Weber Ingenieure", role: "Tragwerksplanerin", category: "engineer", phone: "0911 1", email: "a@w.example" },
  { id: "c2", name: "Sandra Hoffmann", company: "Stadtwerke Muster", category: "client" },
  { id: "c3", name: "BetonBau GmbH", company: "BetonBau GmbH", category: "contractor" },
];

describe("beteiligte", () => {
  it("normalises: drops entries without contact and exact duplicates, keeps unknown roles", () => {
    const n = normalisieren([{ contact_id: "c1", rolle: "tragwerk" }, { contact_id: "c1", rolle: "tragwerk", bemerkung: " " }, { rolle: "bauherr" }, { contact_id: "c9", rolle: "Freitext-Rolle" }, null]);
    assert.deepEqual(n, [{ contact_id: "c1", rolle: "tragwerk", bemerkung: "" }, { contact_id: "c9", rolle: "Freitext-Rolle", bemerkung: "" }]);
  });

  it("rows follow the role catalogue; deleted contact stays visible; index points into the stored list", () => {
    const liste = [{ contact_id: "c3", rolle: "ausfuehrung", bemerkung: "Rohbau" }, { contact_id: "c1", rolle: "tragwerk" }, { contact_id: "c2", rolle: "bauherr" }, { contact_id: "weg", rolle: "sigeko" }];
    const z = zeilen(liste, K);
    assert.deepEqual(z.map((r) => r.rolle), ["bauherr", "tragwerk", "sigeko", "ausfuehrung"]);
    assert.deepEqual(z.map((r) => r.gruppe), ["Bauherr", "Planung", "Sachverständige und Behörden", "Ausführung"]);
    assert.equal(z[2].fehlt, true);
    assert.equal(z[2].name, "(Kontakt gelöscht)");
    assert.equal(z[0].index, 2);
    assert.equal(z[1].funktion, "Tragwerksplanerin");
    assert.equal(ROLLEN[0].id, "bauherr");
  });

  it("suggestions: client contacts and awarded bidders of THIS project, nothing already listed", () => {
    const tenders = [{ id: "t1", project_id: "p1", name: "Rohbau", trade: "Rohbau", awarded_bid_id: "b1" }, { id: "t2", project_id: "p2", awarded_bid_id: "b2" }, { id: "t3", project_id: "p1", name: "offen" }];
    const bids = [{ id: "b1", contact_id: "c3" }, { id: "b2", contact_id: "c1" }];
    const v = vorschlaege({ liste: [{ contact_id: "c2", rolle: "bauherr" }], kontakte: K, tenders, bids, projektId: "p1" });
    assert.deepEqual(v.map((x) => [x.contact_id, x.rolle, x.bemerkung]), [["c3", "ausfuehrung", "Rohbau"]]);
  });

  it("add / change / remove return new normalised lists", () => {
    let l = hinzufuegen([], { contact_id: "c1", rolle: "tragwerk" });
    l = hinzufuegen(l, { contact_id: "c1", rolle: "tragwerk" });
    assert.equal(l.length, 1);
    l = hinzufuegen(l, { contact_id: "c2", rolle: "bauherr" });
    const l2 = aendern(l, 0, { rolle: "pruefstatik", bemerkung: "Prüfung Statik" });
    assert.deepEqual(l2[0], { contact_id: "c1", rolle: "pruefstatik", bemerkung: "Prüfung Statik" });
    assert.equal(l[0].rolle, "tragwerk");
    assert.deepEqual(entfernen(l2, 0).map((e) => e.contact_id), ["c2"]);
  });
});

describe("beteiligtePdf", () => {
  it("A4 landscape with title, project, groups; many rows break pages", async () => {
    const z = zeilen([{ contact_id: "c2", rolle: "bauherr" }, { contact_id: "c1", rolle: "tragwerk" }], K);
    const { bytes, dateiname } = await beteiligtePdf(z, { name: "Testhaus", client: "Bauherr Muster" }, { jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(dateiname, "Projektbeteiligte_Testhaus_2026-10-11.pdf");
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    assert.ok(width > height, "quer");
    const txt = Buffer.from(bytes).toString("latin1");
    for (const s of ["Projektbeteiligtenliste", "Testhaus", "Planung", "Weber Ingenieure", "0911 1"]) assert.ok(txt.includes(s), `fehlt: ${s}`);
    const viele = zeilen(Array.from({ length: 80 }, (_, i) => ({ contact_id: "c3", rolle: "ausfuehrung", bemerkung: `Los ${i}` })), K);
    const gross = await beteiligtePdf(viele, null);
    assert.ok((await PDFDocument.load(gross.bytes)).getPageCount() >= 2);
  });
});
