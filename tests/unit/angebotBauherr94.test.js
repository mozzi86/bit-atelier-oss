// 94-03 (B-ABN-04/05): client from the address book, calculator hand-over kept.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bauherrAusKontakt, istBauherr, kontaktText, sortiereKontakte } from "../../src/lib/honorar/bauherrKontakt.js";
import { liesVorschlag, merkeVorschlag, vergissVorschlag } from "../../src/lib/honorar/vorschlagMerker.js";

/** In-memory Storage stand-in. */
function speicher() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe("bauherrKontakt (94-03)", () => {
  const firma = { id: "c1", name: "Erika Muster", company: "Muster Bau GmbH", role: "Bauherr", address: "Hauptstr. 1", zip: "90402", city: "Musterstadt" };

  it("company is the client, address as one line, contact id kept", () => {
    assert.deepEqual(bauherrAusKontakt(firma), { bauherr_contact_id: "c1", bauherr_name: "Muster Bau GmbH", bauherr_anschrift: "Hauptstr. 1, 90402 Musterstadt" });
  });

  it("person without company; missing address parts are left out", () => {
    assert.deepEqual(bauherrAusKontakt({ id: "c2", name: "Max Muster", city: "Musterstadt" }), { bauherr_contact_id: "c2", bauherr_name: "Max Muster", bauherr_anschrift: "Musterstadt" });
  });

  it("clients first, then alphabetical", () => {
    const liste = sortiereKontakte([{ name: "Anna", role: "Statik" }, { name: "Zoe", role: "Auftraggeber" }, { name: "Bert" }]);
    assert.deepEqual(liste.map((k) => k.name), ["Zoe", "Anna", "Bert"]);
    assert.equal(istBauherr({ role: "bauherrin" }), true);
  });

  it("display text: company (person) · role", () => {
    assert.equal(kontaktText(firma), "Muster Bau GmbH (Erika Muster) · Bauherr");
    assert.equal(kontaktText({ name: "Max" }), "Max");
  });
});

describe("vorschlagMerker (94-03)", () => {
  it("remembers until forgotten", () => {
    const s = speicher();
    assert.equal(liesVorschlag(s), null);
    merkeVorschlag({ honorarzone: "IV", kg300_euro: 1000000 }, s);
    assert.deepEqual(liesVorschlag(s), { honorarzone: "IV", kg300_euro: 1000000 });
    vergissVorschlag(s);
    assert.equal(liesVorschlag(s), null);
  });

  it("blocked or broken storage → null, no throw", () => {
    const kaputt = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    merkeVorschlag({ a: 1 }, kaputt);
    assert.equal(liesVorschlag(kaputt), null);
    vergissVorschlag(kaputt);
    assert.equal(liesVorschlag({ getItem: () => "{kaputt" }), null);
  });
});
