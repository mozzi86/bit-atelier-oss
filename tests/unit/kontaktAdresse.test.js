// Unit test for the contact postal address (address / zip / city, 11.10.2026): the fields the contact form
// now stores reach the participant list (90-07: address column in rows and PDF) and the VHB form filler
// (90-06: recipient street and postcode/city instead of "[BITTE ERGÄNZEN]").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { zeilen } from "@/lib/people/beteiligte";
import { beteiligtePdf } from "@/lib/people/beteiligtePdf";
import { standardWerte } from "@ava/lib/vhbFormular";

const K = { id: "c1", name: "Herr Beta", company: "Beta Bau GmbH", category: "contractor", address: "Bauweg 5", zip: "12345", city: "Musterstadt" };

describe("Kontakt-Anschrift", () => {
  it("participant list shows the address and the PDF gets an address column", async () => {
    const z = zeilen([{ contact_id: "c1", rolle: "ausfuehrung" }], [K]);
    assert.equal(z[0].adresse, "Bauweg 5, 12345 Musterstadt");
    const txt = Buffer.from((await beteiligtePdf(z, { name: "Testhaus" })).bytes).toString("latin1");
    assert.ok(txt.includes("Adresse") && txt.includes("Bauweg 5"));
  });

  it("VHB recipient fields are filled from the contact address", () => {
    const w = standardWerte({ bid: { bidder_name: "Beta Bau GmbH", contact_id: "c1" }, kontakt: K });
    assert.equal(w.ag_comm_empfaenger_str, "Bauweg 5");
    assert.equal(w.ag_comm_empfaenger_plz_ort, "12345 Musterstadt");
    assert.equal(w.ag_empfaenger_str, "Bauweg 5");
  });
});
