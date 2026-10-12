// Phase 82 (82-01): the phase-82 sample (src/lib/bueroOrga/beispielDaten.js) —
// deterministic for three "today"s, all references resolve, the reference-day
// dates of 82-RESEARCH, register numbers, no absence over a time booking of the
// 81 sample, no health data of third persons, and the agenda contribution of
// the two real sources (projekt, manuell) per role against the hand-computed
// constants of helpers/seed82Erwartung.mjs.
//
// In:  the 79/80/81/82 sample modules, the source registry, rechte.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar } from "@/lib/zeitHonorar/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";
import { wiederholungen } from "@core/lib/kalender/termin.js";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";
import { baueZugriff, projekteNachZugriff } from "@core/lib/rechte.js";
import { projects, contacts } from "../../packages/nova-core/server/seed-data.js";
import { AGENDA_BEITRAG, AGENDA_FENSTER_BIS, gruppeVon, NAECHSTE_NUMMERN, SEED82_ANKER, SICHTBARE_PROJEKTE_JE_ROLLE, ZUORDNUNG_ANNAHME } from "./helpers/seed82Erwartung.mjs";

const PERSONAL_SEED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const TAGE = ["2026-09-28", "2026-06-30", "2027-01-15"];

/** @param {string} heute @param {boolean} mitPersonal */
const saat = (heute, mitPersonal = true) => {
  const personal = mitPersonal ? personalSeedVerschieben(PERSONAL_SEED, heute) : null;
  return { personal, r: beispielDatensaetzeBueroOrga(heute, { personal, kontakte: contacts }) };
};

test("deterministisch und für drei Tage gültig; alle Verweise lösen auf", () => {
  for (const heute of TAGE) {
    for (const mitPersonal of [true, false]) {
      const { personal, r } = saat(heute, mitPersonal);
      assert.deepEqual(saat(heute, mitPersonal).r, r, heute);
      const personen = new Set([...(personal?.Mitarbeiter || []).map((m) => m.id), "inhaber"]);
      const projekte = new Set(projects.map((p) => p.id));
      const kontakte = new Set(contacts.map((c) => c.id));
      for (const a of r.Abwesenheit) {
        assert.ok(personen.has(a.mitarbeiter_id), `${a.id}: ${a.mitarbeiter_id}`);
        if (a.vertretung_id) assert.ok(personen.has(a.vertretung_id), a.id);
      }
      for (const n of r.Nutzer) if (n.mitarbeiter_id) assert.ok(personen.has(n.mitarbeiter_id), n.id);
      for (const x of [...r.Termin, ...r.Abnahme, ...r.Postbucheintrag, ...r.Schreiben]) if (x.project_id) assert.ok(projekte.has(x.project_id), x.id);
      for (const p of r.Postbucheintrag) {
        assert.ok(kontakte.has(p.partner_contact_id), p.id);
        if (p.schreiben_id) assert.ok(r.Schreiben.some((s) => s.id === p.schreiben_id), p.id);
      }
      for (const x of [...r.Nutzer, ...r.Termin, ...r.Abnahme, ...r.Abwesenheit, ...r.Postbucheintrag, ...r.Schreiben]) assert.equal(x.beispiel, true, x.id);
      assert.ok(!r.Abwesenheit.some((a) => a.art === "krank_kind" || (a.art === "krank" && "notiz" in a)));
    }
  }
});

test("Stichtag 28.09.2026: Daten wie 82-RESEARCH, Nummern, nächste Nummern", () => {
  const { r } = saat(SEED82_ANKER);
  const aw = Object.fromEntries(r.Abwesenheit.map((a) => [a.id, [a.mitarbeiter_id, a.von, a.bis, a.status]]));
  assert.deepEqual(aw, {
    "aw-1": ["P-001", "2026-08-10", "2026-08-21", "genehmigt"],
    "aw-2": ["P-004", "2026-09-14", "2026-09-15", "genehmigt"],
    "aw-3": ["P-003", "2026-10-05", "2026-10-09", "genehmigt"],
    "aw-4": ["P-004", "2026-10-07", "2026-10-16", "beantragt"],
    "aw-5": ["P-001", "2026-10-22", "2026-10-22", "genehmigt"],
  });
  const te = Object.fromEntries(r.Termin.map((t) => [t.id, t.datum]));
  assert.deepEqual(te, { "te-1": "2026-09-28", "te-2": "2026-09-29", "te-3": "2026-10-15" });
  assert.equal(wiederholungen(r.Termin[1], "2026-09-28", "2026-12-27").length, 12);
  assert.deepEqual(r.Abnahme.map((a) => [a.id, a.datum, a.sicherheit_rueckgabe_am]), [["ab-1", "2022-10-14", "2024-10-21"], ["ab-2", "2025-12-15", null]]);
  assert.deepEqual(r.Postbucheintrag.map((p) => [p.nummer, p.datum, p.frist]), [["PE-2026-0001", "2026-09-21", "2026-10-02"], ["PE-2026-0002", "2026-09-24", null], ["PA-2026-0001", "2026-09-25", null]]);
  const nummern = (richtung) => r.Postbucheintrag.filter((p) => p.richtung === richtung).map((p) => p.nummer);
  assert.equal(new Set([...nummern("eingang"), ...nummern("ausgang")]).size, 3);
  assert.equal(naechsteNummer("PE-{jahr}-{nr4}", nummern("eingang"), SEED82_ANKER), NAECHSTE_NUMMERN.eingang);
  assert.equal(naechsteNummer("PA-{jahr}-{nr4}", nummern("ausgang"), SEED82_ANKER), NAECHSTE_NUMMERN.ausgang);
  assert.deepEqual(r.Nutzer.map((n) => [n.id, n.rolle, n.mitarbeiter_id]), [["nu-1", "inhaber", "P-001"], ["nu-2", "projektleitung", "P-003"], ["nu-3", "mitarbeiter", "P-004"], ["nu-4", "buchhaltung", null]]);
});

test("keine genehmigte Abwesenheit liegt über einer Zeitbuchung derselben Person (81-Saat), an drei Tagen", () => {
  for (const heute of TAGE) {
    for (const mitPersonal of [true, false]) {
      const { personal, r } = saat(heute, mitPersonal);
      const zh = beispielDatensaetzeZeitHonorar(heute, { buchhaltung: beispielDatensaetze(heute), personal });
      for (const a of r.Abwesenheit.filter((x) => x.status === "genehmigt")) {
        const treffer = zh.Zeitbuchung.filter((b) => b.mitarbeiter_id === a.mitarbeiter_id && b.datum >= a.von && b.datum <= a.bis);
        assert.deepEqual(treffer.map((b) => b.id), [], `${heute} ${a.id}`);
      }
    }
  }
});

test("Projektsicht nach der Saat entspricht ZUORDNUNG_ANNAHME und SICHTBARE_PROJEKTE_JE_ROLLE", () => {
  const { r } = saat(SEED82_ANKER);
  const projektion = r.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen }));
  for (const nutzer of r.Nutzer) {
    const z = baueZugriff({ nutzer, zuordnungen: projektion, datenquelle: "express" });
    const ids = projekteNachZugriff(projects, z).map((p) => p.id);
    assert.equal(ids.length, SICHTBARE_PROJEKTE_JE_ROLLE[nutzer.rolle], nutzer.rolle);
    if (ZUORDNUNG_ANNAHME[nutzer.rolle]) assert.deepEqual(ids, [...ZUORDNUNG_ANNAHME[nutzer.rolle]], nutzer.rolle);
  }
});

test("Agenda-Beitrag der Quellen projekt und manuell je Rolle (handgerechnet)", async () => {
  const { r } = saat(SEED82_ANKER);
  const api = { entities: new Proxy({}, { get: (_, n) => ({ list: async () => (n === "Project" ? projects : n === "Termin" ? r.Termin : []) }) }) };
  const projektion = r.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen }));
  for (const nutzer of r.Nutzer) {
    const zugriff = baueZugriff({ nutzer, zuordnungen: projektion, datenquelle: "express" });
    const { termine, fehler } = await ladeTermine(api, { von: SEED82_ANKER, bis: AGENDA_FENSTER_BIS, heute: SEED82_ANKER, zugriff, aktiveQuellen: ["projekt", "manuell"] });
    assert.deepEqual(fehler, []);
    /** @type {Record<string, number>} */
    const zaehler = {};
    for (const t of termine) {
      const g = gruppeVon(t, SEED82_ANKER);
      if (g) zaehler[g] = (zaehler[g] || 0) + 1;
    }
    /** @type {Record<string, number>} */
    const erwartet = {};
    for (const q of ["projekt", "manuell"]) for (const [g, n] of Object.entries(AGENDA_BEITRAG[q])) erwartet[g] = (erwartet[g] || 0) + n;
    assert.deepEqual(zaehler, erwartet, nutzer.rolle);
  }
});
