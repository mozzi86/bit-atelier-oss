// 82-06 Task 1: the sample data of 81 and 82 (both relative to today, § 5) agree
// on three key dates: no time booking on an approved absence day, all references
// resolve, register numbers unique, no seed term in the past except the deliberate ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar } from "@/lib/zeitHonorar/beispielDaten.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { projects, contacts } from "../../packages/nova-core/server/seed-data.js";

const PERSONAL_SEED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const TAGE = ["2026-09-28", "2026-06-30", "2027-01-15"];

/** @param {string} tag @param {number} n */
function plus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

for (const heute of TAGE) {
  test(`Saat 81 × 82 am ${heute}: keine Buchung an Abwesenheitstagen, Verweise lösen auf, Nummern eindeutig`, () => {
    const personal = personalSeedVerschieben(PERSONAL_SEED, heute);
    const bh = beispielDatensaetze(heute);
    const zh = beispielDatensaetzeZeitHonorar(heute, { buchhaltung: bh, personal });
    const b = beispielDatensaetzeBueroOrga(heute, { personal, kontakte: contacts });

    // No booking of a person on a day of her approved absence or sickness.
    const abwesend = new Set();
    for (const a of b.Abwesenheit.filter((x) => x.status === "genehmigt")) {
      for (let t = a.von; t <= (a.bis || a.von); t = plus(t, 1)) abwesend.add(`${a.mitarbeiter_id}|${t}`);
    }
    const kollision = (zh.Zeitbuchung || []).filter((z) => abwesend.has(`${z.mitarbeiter_id}|${z.datum}`) && Number(z.minuten) > 0);
    assert.deepEqual(kollision.map((z) => `${z.mitarbeiter_id} ${z.datum}`), [], "Zeitbuchung an einem Abwesenheitstag");

    // References.
    const personen = new Set([...personal.Mitarbeiter.map((m) => m.id), "inhaber"]);
    const projektIds = new Set(projects.map((p) => p.id));
    for (const n of b.Nutzer) if (n.mitarbeiter_id) assert.ok(personen.has(n.mitarbeiter_id), `Nutzer ${n.id}`);
    for (const z of b.zuordnungen) for (const x of z.projekt_zuordnungen) assert.ok(projektIds.has(x.project_id), `Zuordnung ${z.mitarbeiter_id} → ${x.project_id}`);
    for (const m of personal.Mitarbeiter) for (const x of m.projekt_zuordnungen || []) assert.ok(projektIds.has(x.project_id), `80 ${m.id} → ${x.project_id}`);
    for (const a of b.Abwesenheit) {
      assert.ok(personen.has(a.mitarbeiter_id), `Abwesenheit ${a.id}`);
      if (a.vertretung_id) assert.ok(personen.has(a.vertretung_id), `Vertretung ${a.id}`);
    }
    for (const t of b.Termin) if (t.project_id) assert.ok(projektIds.has(t.project_id), `Termin ${t.id}`);
    for (const a of b.Abnahme) assert.ok(projektIds.has(a.project_id), `Abnahme ${a.id}`);

    // Register numbers unique per year and direction.
    const nummern = b.Postbucheintrag.map((p) => p.nummer);
    assert.equal(new Set(nummern).size, nummern.length);

    // No manual seed term before the Monday of the current week (the seed is anchored to that
    // Monday, so on a Friday this week's Monday appointment lies behind) — deadlines are
    // deliberately overdue, recurring series start in the past on purpose.
    const w = new Date(`${heute}T12:00:00Z`).getUTCDay();
    const montag = plus(heute, -((w + 6) % 7));
    for (const t of b.Termin) {
      if (t.art === "frist" || t.wiederholung) continue;
      assert.ok(t.datum >= montag, `Termin ${t.id} ${t.datum} vor ${montag}`);
    }
  });
}
