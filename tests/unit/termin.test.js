// Phase 82 (82-01): the term data contract (@core/lib/kalender/termin.js) —
// stable ids, recurring terms with month-end clamp and an upper bound, and the
// collector (dedupe, acknowledgements, window, overdue deadlines, sort order).
//
// In:  termin.js. Out: assertions only (also run under TZ=UTC).

import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENDA_GRUPPEN, sammleTermine, TERMIN_ARTEN, terminId, WIEDERHOLUNG_MAX, wiederholungen } from "@core/lib/kalender/termin.js";

test("terminId und Labeltabellen", () => {
  assert.equal(terminId("projekt", "proj-1", "fertigstellung"), "projekt:proj-1:fertigstellung");
  assert.equal(terminId("manuell", "te-1"), "manuell:te-1");
  assert.equal(TERMIN_ARTEN.frist_manuell.klasse, "frist");
  assert.equal(TERMIN_ARTEN.abwesenheit.klasse, "hinweis");
  assert.deepEqual(AGENDA_GRUPPEN.map((g) => g.key), ["ueberfaellig", "heute", "diese_woche", "naechste_woche", "spaeter"]);
  for (const a of Object.values(TERMIN_ARTEN)) assert.ok(["frist", "termin", "hinweis"].includes(a.klasse));
});

test("wiederholungen: wöchentlich 29.09.–15.12. = 12 Vorkommen; monatlich mit Monatsende-Klemme; Obergrenze", () => {
  const te2 = { id: "te-2", datum: "2026-09-29", wiederholung: { rhythmus: "woechentlich", bis: "2026-12-15" } };
  const w = wiederholungen(te2, "2026-09-28", "2026-12-27");
  // 29.09., 06.10. … 15.12.: (15.12. − 29.09.) / 7 = 77 / 7 = 11 Schritte + 1
  assert.equal(w.length, 12);
  assert.equal(w[0].id, "manuell:te-2:2026-09-29");
  assert.equal(w[11].datum, "2026-12-15");
  const monat = wiederholungen({ id: "m", datum: "2026-01-31", wiederholung: { rhythmus: "monatlich" } }, "2026-01-01", "2026-03-31");
  assert.deepEqual(monat.map((x) => x.datum), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  const lang = wiederholungen({ id: "t", datum: "2026-01-01", wiederholung: { rhythmus: "taeglich", bis: "2099-12-31" } }, "2026-01-01", "2099-12-31");
  assert.equal(lang.length, WIEDERHOLUNG_MAX);
  assert.deepEqual(wiederholungen({ id: "x", datum: "2026-10-01" }, "2026-09-28", "2026-12-27").map((x) => x.id), ["manuell:x:2026-10-01"]);
  assert.deepEqual(wiederholungen({ id: "x", datum: "2027-10-01" }, "2026-09-28", "2026-12-27"), []);
});

test("sammleTermine: Doppel einmal, Quittung → erledigt, Fenster, überfällige Fristen bis 365 Tage, Sortierung", () => {
  const t = (id, datum, klasse, zeit) => ({ id, quelle: "manuell", art: "x", klasse, datum, zeit, project_id: null, modul: "fristen", objekt: id, ziel: "/Deadlines" });
  const liste1 = [t("a", "2026-10-01", "termin", "10:00"), t("b", "2026-10-01", "frist"), t("c", "2026-10-01", "termin")];
  const liste2 = [t("a", "2026-10-02", "termin"), t("alt", "2026-07-14", "frist"), t("sehrAlt", "2025-07-01", "frist"), t("vorbei", "2026-09-01", "termin"), t("fern", "2027-06-01", "frist")];
  const r = sammleTermine([liste1, liste2, null], { von: "2026-09-28", bis: "2026-12-27", quittungen: [{ termin_id: "c" }] });
  assert.deepEqual(r.map((x) => x.id), ["alt", "b", "c", "a"]);
  assert.equal(r.find((x) => x.id === "a")?.datum, "2026-10-01", "first list wins");
  assert.equal(r.find((x) => x.id === "c")?.erledigt, true);
  // A multi-day term that started before the window but runs into it stays.
  const lang = sammleTermine([[{ ...t("u", "2026-09-21", "hinweis"), bis: "2026-10-02" }]], { von: "2026-09-28", bis: "2026-12-27" });
  assert.equal(lang.length, 1);
});
