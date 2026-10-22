// External accounts (bidder/investor/guest) never load the office rights; internal and unknown roles do.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ladeZugriffsdaten } from "@/lib/zugriffLader.js";

/** Fake api that records every call and answers with empty data. */
function api() {
  const aufrufe = [];
  const entitaet = (name) => ({ list: async () => { aufrufe.push(name); return []; }, filter: async () => { aufrufe.push(name); return []; } });
  return { aufrufe, api: { entities: new Proxy({}, { get: (_, n) => entitaet(String(n)) }) } };
}

describe("ladeZugriffsdaten — externe Rollen", () => {
  for (const rolle of ["bidder", "investor", "gast"]) {
    it(`${rolle}: keine Büro-Rechte geladen`, async () => {
      const { aufrufe, api: a } = api();
      const r = await ladeZugriffsdaten({ datenquelle: "supabase", rolle, stichtagIso: "2026-10-22" }, { api: a });
      assert.deepEqual(r, { nutzer: [], einstellung: null, zuordnungen: [] });
      assert.deepEqual(aufrufe, []);
    });
  }
  it("interne Rolle lädt die Rechte-Einstellung", async () => {
    const { aufrufe, api: a } = api();
    await ladeZugriffsdaten({ datenquelle: "express", rolle: "admin", stichtagIso: "2026-10-22" }, { api: a }).catch(() => {});
    assert.ok(aufrufe.includes("Setting"), JSON.stringify(aufrufe));
  });
});
