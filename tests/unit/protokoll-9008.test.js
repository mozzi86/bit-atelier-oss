// Unit tests for plan 90-08 (src/lib/protokoll/protokoll.js + protokollPdf.js): numbering per title series,
// new draft with participants from the project participant list, carry-forward of OPEN tasks only (with
// origin), item numbers, overdue check, CSV model, and the PDF (text, overdue mark, page break).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { PDFDocument } from "pdf-lib";

import { naechsteNummer, neuerEntwurf, fortschreiben, punktNummern, ueberfaellig, offenePunkte, teilnehmerAusBeteiligten, punkteTabelle, HINWEIS_STANDARD } from "@/lib/protokoll/protokoll";
import { protokollPdf } from "@/lib/protokoll/protokollPdf";
import { tabelleAlsCsv } from "@core/lib/tabellenExport";

const JF3 = {
  id: "m3", project_id: "p1", titel: "Jour fixe", nummer: 3, datum: "2026-10-01", ort: "Baustelle",
  teilnehmer: [{ name: "A. Muster", firma: "Bauherr", anwesend: true }, { name: "B. Beispiel", firma: "Rohbau", anwesend: false }],
  punkte: [
    { art: "info", thema: "Termine", text: "Rohbau im Plan" },
    { art: "festlegung", thema: "Fenster", text: "Farbe RAL 7016" },
    { art: "aufgabe", thema: "Statik", text: "Durchbrüche freigeben", zustaendig: "Tragwerk", frist: "2026-10-08", status: "offen", herkunft: 2 },
    { art: "aufgabe", thema: "Gerüst", text: "Abnahme", zustaendig: "Rohbau", frist: "2026-10-20", status: "offen" },
    { art: "aufgabe", thema: "Baustrom", text: "erledigt", status: "erledigt" },
  ],
  verteiler: "alle Teilnehmer", hinweis: HINWEIS_STANDARD,
};

describe("protokoll", () => {
  it("numbers per title series", () => {
    const l = [{ titel: "Jour fixe", nummer: 3 }, { titel: "jour fixe ", nummer: 1 }, { titel: "Planerbesprechung", nummer: 7 }];
    assert.equal(naechsteNummer(l, "Jour fixe"), 4);
    assert.equal(naechsteNummer(l, "Planerbesprechung"), 8);
    assert.equal(naechsteNummer(l, "Bemusterung"), 1);
  });

  it("new draft takes participants from the project participant list (unique contacts)", () => {
    const tn = teilnehmerAusBeteiligten([{ contact_id: "c1", rolle: "bauherr" }, { contact_id: "c1", rolle: "nutzer" }, { contact_id: "weg" }], [{ id: "c1", name: "A. Muster", company: "Bauherr GmbH" }]);
    assert.deepEqual(tn, [{ name: "A. Muster", firma: "Bauherr GmbH" }]);
    const e = neuerEntwurf({ projektId: "p1", protokolle: [JF3], teilnehmer: tn, jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(e.nummer, 4);
    assert.equal(e.datum, "2026-10-11");
    assert.deepEqual(e.teilnehmer, [{ name: "A. Muster", firma: "Bauherr GmbH", anwesend: true }]);
  });

  it("carry forward: only open tasks, origin kept, participants present again", () => {
    const f = fortschreiben(JF3, { jetzt: new Date("2026-10-15T10:00:00Z") });
    assert.equal(f.nummer, 4);
    assert.equal(f.fortgeschrieben_aus, "m3");
    assert.deepEqual(f.punkte.map((p) => [p.thema, p.herkunft]), [["Statik", 2], ["Gerüst", 3]]);
    assert.ok(f.teilnehmer.every((t) => t.anwesend));
    assert.deepEqual(punktNummern({ ...f, punkte: [...f.punkte, { art: "info" }] }), ["4.1 (aus 2)", "4.2 (aus 3)", "4.3"]);
    assert.equal(f.ort, "Baustelle");
  });

  it("overdue and open counts", () => {
    const heute = new Date("2026-10-11T10:00:00Z");
    assert.equal(ueberfaellig(JF3.punkte[2], heute), true);
    assert.equal(ueberfaellig(JF3.punkte[3], heute), false);
    assert.equal(ueberfaellig(JF3.punkte[4], heute), false);
    assert.equal(offenePunkte(JF3).length, 2);
  });

  it("CSV model with item numbers and status", () => {
    const m = punkteTabelle(JF3);
    assert.equal(m.zeilen.length, 5);
    assert.equal(m.zeilen[2].nr, "3.3 (aus 2)");
    assert.equal(m.zeilen[0].status, "");
    assert.equal(m.zeilen[4].status, "erledigt");
    assert.match(tabelleAlsCsv(m), /Durchbrüche freigeben/);
  });
});

describe("protokollPdf", () => {
  it("text, overdue mark, page break for many items", async () => {
    const { bytes, dateiname } = await protokollPdf(JF3, { name: "Testhaus" }, { heute: new Date("2026-10-11T10:00:00Z") });
    assert.equal(dateiname, "Protokoll_03_Jour_fixe_2026-10-01.pdf");
    const txt = Buffer.from(bytes).toString("latin1");
    // jsPDF escapes parentheses in text operators ("\(") → search without them.
    for (const s of ["Protokoll Nr. 3", "Testhaus", "entschuldigt", "RAL 7016", "3.3 \\(aus 2\\)", "berf", "Verteiler"]) assert.ok(txt.includes(s), `fehlt: ${s}`);
    const viele = { ...JF3, punkte: Array.from({ length: 90 }, (_, i) => ({ art: "aufgabe", thema: `T${i}`, text: "x ".repeat(40), status: "offen" })) };
    assert.ok((await PDFDocument.load((await protokollPdf(viele, null)).bytes)).getPageCount() >= 3);
  });
});
