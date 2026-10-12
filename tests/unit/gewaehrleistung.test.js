// Phase 82 (82-03): warranty terms from acceptances (@core/lib/kalender/gewaehrleistung.js)
// — VOB/B and BGB periods, maintenance systems, individual periods, § 188 Abs. 3
// at month end, the architect's own work (§ 650s), the mandatory rule (never
// VOB/B assumed), the sample acceptances, stable ids, norms and the weekend info.
//
// In:  gewaehrleistung.js, the rule book of 82-01. Out: assertions only (also under TZ=UTC).

import { test } from "node:test";
import assert from "node:assert/strict";
import { termineAusAbnahmen, WOCHENENDE_INFO } from "@core/lib/kalender/gewaehrleistung.js";
import { regelNachId } from "@/lib/settings/regelwerke.js";
import { wirksamerWert } from "@core/lib/regelwerk.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";

const wert = (id) => wirksamerWert(regelNachId(id), null, "2026-09-28")?.wert ?? null;
const termine = (a) => termineAusAbnahmen([{ id: "a", project_id: "p", gewerk: "Rohbau", ...a }], wert);
const datum = (r, teil) => r.termine.find((t) => t.id === `abnahme:a:${teil}`)?.datum;

test("VOB/B Bauwerk 15.05.2026: Ende 15.05.2030, Begehung 15.02.2030, Sicherheit 15.05.2028", () => {
  const r = termine({ datum: "2026-05-15", regel: "vob", kategorie: "bauwerk", sicherheit_art: "buergschaft" });
  assert.equal(datum(r, "gewaehrleistung_ende"), "2030-05-15");
  assert.equal(datum(r, "begehung"), "2030-02-15");
  assert.equal(datum(r, "sicherheit"), "2028-05-15");
  assert.equal(r.termine.find((t) => t.art === "gewaehrleistung_ende")?.herkunft, "VOB/B § 13 Abs. 4 Nr. 1");
  assert.equal(r.termine.find((t) => t.art === "begehung_vor_ablauf")?.annahme, true);
  assert.equal(termine({ datum: "2026-05-15", regel: "vob", kategorie: "bauwerk", sicherheit_art: "keine" }).termine.some((t) => t.art === "sicherheit_rueckgabe"), false);
});

test("BGB Bauwerk 5 J, sonstige 2 J; VOB Wartungsanlage ohne/mit Wartungsvertrag; individuell; 29.02.", () => {
  assert.equal(datum(termine({ datum: "2026-05-15", regel: "bgb", kategorie: "bauwerk" }), "gewaehrleistung_ende"), "2031-05-15");
  assert.equal(datum(termine({ datum: "2026-05-15", regel: "bgb", kategorie: "sonstige" }), "gewaehrleistung_ende"), "2028-05-15");
  assert.equal(datum(termine({ datum: "2026-05-15", regel: "vob", kategorie: "wartungsanlage" }), "gewaehrleistung_ende"), "2028-05-15");
  assert.equal(datum(termine({ datum: "2026-05-15", regel: "vob", kategorie: "wartungsanlage", wartungsvertrag: true }), "gewaehrleistung_ende"), "2030-05-15");
  assert.equal(datum(termine({ datum: "2026-05-15", regel: "individuell", jahre: 6 }), "gewaehrleistung_ende"), "2032-05-15");
  assert.deepEqual(termine({ datum: "2026-05-15", regel: "individuell" }), { termine: [], warnungen: [{ abnahme_id: "a", grund: "Frist fehlt" }] });
  // § 188 Abs. 3 BGB: no 29 February in 2033 → 28 February.
  assert.equal(datum(termine({ datum: "2028-02-29", regel: "bgb", kategorie: "bauwerk" }), "gewaehrleistung_ende"), "2033-02-28");
});

test("eigene Leistung (§ 650s): Teilabnahme 15.12.2025 → Haftung 15.12.2030; ohne Regel nie VOB/B", () => {
  const r = termine({ datum: "2025-12-15", regel: "bgb", kategorie: "bauwerk", teilabnahme: true, eigene_leistung: true });
  assert.deepEqual(r.termine.map((t) => [t.id, t.datum]), [["abnahme:a:haftung", "2030-12-15"]]);
  assert.deepEqual(termine({ datum: "2026-05-15" }), { termine: [], warnungen: [{ abnahme_id: "a", grund: "Regel fehlt" }] });
});

test("Saat ab-1/ab-2 am Stichtag: Ende 14.10.2026, Begehung 14.07.2026, Sicherheit 14.10.2024 erledigt, Haftung 15.12.2030", () => {
  const { Abnahme } = beispielDatensaetzeBueroOrga("2026-09-28", {});
  const r = termineAusAbnahmen(Abnahme, wert);
  const m = Object.fromEntries(r.termine.map((t) => [t.id, [t.datum, t.klasse, Boolean(t.erledigt)]]));
  assert.deepEqual(m, {
    "abnahme:ab-1:gewaehrleistung_ende": ["2026-10-14", "frist", false],
    "abnahme:ab-1:begehung": ["2026-07-14", "frist", false],
    "abnahme:ab-1:sicherheit": ["2024-10-14", "frist", true],
    "abnahme:ab-2:haftung": ["2030-12-15", "hinweis", false],
  });
});

test("Ende an einem Samstag: Info zu § 193 BGB, Datum unverschoben", () => {
  // 13.05.2028 is a Saturday: acceptance 13.05.2024, VOB building → end 13.05.2028.
  const r = termine({ datum: "2024-05-13", regel: "vob", kategorie: "bauwerk" });
  const ende = r.termine.find((t) => t.art === "gewaehrleistung_ende");
  assert.equal(ende?.datum, "2028-05-13");
  assert.equal(/** @type {any} */ (ende).info, WOCHENENDE_INFO);
});
