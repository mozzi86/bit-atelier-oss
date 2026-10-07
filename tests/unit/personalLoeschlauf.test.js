// personalLoeschlauf.test.js — Plan 80-10, Task 2: loeschVorschlaege,
// fuehrePlanAus. Behavior 5–6 gegen den 80-02-Seed und eine fakeApi
// (In-Memory, dieselbe Form wie bitApi.personal).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { loeschPlan } from "@/lib/people/auskunft.js";
import { loeschVorschlaege, fuehrePlanAus } from "@/lib/people/loeschlauf.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const roherSeed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));
const HEUTE = "2026-09-27";
const seed = personalSeedVerschieben(roherSeed, HEUTE);

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

describe("loeschVorschlaege — Behavior 6 (Seed @ 2026-09-27)", () => {
  it("genau 1 Plan (B-1)", () => {
    const vorschlaege = loeschVorschlaege(seed, HEUTE, regelWert);
    assert.equal(vorschlaege.length, 1);
    assert.deepEqual(vorschlaege[0].subjekt, { bewerbungId: "B-1" });
  });
});

/**
 * Kleine In-Memory-API mit derselben Form wie bitApi.personal: je Entität
 * {get, create, delete}, dazu {dateien: {delete}} — reicht für fuehrePlanAus.
 * @param {Record<string, object[]>} anfangsDaten
 */
function fakeApi(anfangsDaten) {
  const tabellen = Object.fromEntries(Object.entries(anfangsDaten).map(([k, v]) => [k, [...v]]));
  const geloeschteDateien = [];
  /** @type {any} */
  const api = { dateien: { delete: async (id) => { geloeschteDateien.push(id); return true; } } };
  for (const [entitaet, zeilen] of Object.entries(tabellen)) {
    api[entitaet] = {
      get: async (id) => zeilen.find((z) => z.id === id) || null,
      // Wie personalDb.create(): id per Zufall vorbelegt, aber data.id (nach
      // dem Spread) gewinnt — created_date/updated_date immer neu gesetzt.
      create: async (data) => {
        const now = new Date().toJSON();
        const record = { id: `fake-${zeilen.length}`, created_date: now, updated_date: now, ...data };
        zeilen.push(record);
        return record;
      },
      delete: async (id) => {
        const i = zeilen.findIndex((z) => z.id === id);
        if (i >= 0) zeilen.splice(i, 1);
        return true;
      },
    };
  }
  api.__tabellen = tabellen;
  api.__geloeschteDateien = geloeschteDateien;
  return api;
}

describe("fuehrePlanAus — Behavior 5 (P-003, Austritt 2026-12-31)", () => {
  const seedMitAustritt = {
    ...seed,
    Mitarbeiter: seed.Mitarbeiter.map((m) => (m.id === "P-003" ? { ...m, status: "ausgeschieden", austritt: "2026-12-31" } : m)),
    Loeschprotokoll: [],
  };
  const plan = loeschPlan({ mitarbeiterId: "P-003" }, "austritt", seedMitAustritt, "2026-12-31", regelWert);
  const api = fakeApi(seedMitAustritt);

  it("führt aus: genau 1 Loeschprotokoll ohne Namen/E-Mail, Mitarbeiter als Grabstein", async () => {
    const { protokoll } = await fuehrePlanAus(plan, api, "austritt", "2026-12-31");

    assert.equal(api.__tabellen.Loeschprotokoll.length, 1);
    const protokollSchluessel = Object.keys(protokoll);
    for (const k of protokollSchluessel) {
      assert.ok(["id", "created_date", "updated_date", "am", "entitaet", "datensatz_id", "anlass", "umfang"].includes(k), `unerwarteter Schlüssel ${k}`);
    }
    const text = JSON.stringify(protokoll);
    assert.ok(!text.includes("Lena"));
    assert.ok(!text.includes("Beispiel"));
    assert.ok(!text.includes("@"));

    const mitarbeiter = await api.Mitarbeiter.get("P-003");
    assert.deepEqual(Object.keys(mitarbeiter).sort(), ["created_date", "id", "personalnummer", "sperre", "status", "updated_date"].sort());
    assert.equal(mitarbeiter.status, "gesperrt");
    assert.equal(mitarbeiter.personalnummer, "P-003");
  });
});
