// Listings of /InvestmentPlatform: own rows, live search, missing fields.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zahl, ortZeile, formularAusInserat, eigeneInserate, inserateFiltern } from "../../src/lib/investment/inserate.js";

const A = { id: "a", title: "Gewerbegrundstück A66", owner_id: "u1", status: "active", location: { address: "Gewerbering 5", city: "Musterstadt" }, land_area: 7200, asking_price: 4200000 };
const B = { id: "b", title: "Wohnbaugrundstück Isarvorstadt", owner_id: "u2", status: "in_negotiation", location: { address: "Werkstraße 30", city: "München" }, asking_price: 1000 };
const OHNE = { id: "c", title: "Ohne Ort", owner_id: "u1", status: "active" };

describe("investment inserate", () => {
  it("zahl ist 0 bei fehlenden oder ungültigen Werten", () => {
    assert.equal(zahl(undefined), 0);
    assert.equal(zahl("nein"), 0);
    assert.equal(zahl(12.5), 12.5);
  });

  it("ortZeile übersteht ein fehlendes location", () => {
    assert.equal(ortZeile(OHNE), "");
    assert.equal(ortZeile(A), "Gewerbering 5, Musterstadt");
    assert.equal(ortZeile(null), "");
  });

  it("eigene Inserate sind nur die des Nutzers", () => {
    assert.deepEqual(eigeneInserate([A, B, OHNE], "u1").map((l) => l.id), ["a", "c"]);
    assert.deepEqual(eigeneInserate([A], null), []);
    assert.deepEqual(eigeneInserate(null, "u1"), []);
  });

  it("die Suche filtert Titel, Ort und Statuslabel, ohne Knopf", () => {
    const label = (s) => (s === "active" ? "Aktiv" : s);
    assert.deepEqual(inserateFiltern([A, B, OHNE], "münchen", label).map((l) => l.id), ["b"]);
    assert.deepEqual(inserateFiltern([A, B], "  ", label).map((l) => l.id), ["a", "b"]);
    assert.deepEqual(inserateFiltern([A, OHNE], "Aktiv", label).map((l) => l.id), ["a", "c"]);
    assert.equal(inserateFiltern([OHNE], "Musterstadt", label).length, 0);
  });

  it("formularAusInserat füllt fehlende Felder mit Zahlen, nicht mit undefined", () => {
    const f = formularAusInserat(OHNE);
    assert.equal(f.title, "Ohne Ort");
    assert.equal(f.address, "");
    assert.equal(f.land_area, 0);
    assert.equal(f.asking_price, 0);
    assert.equal(f.status, "active");
  });
});
