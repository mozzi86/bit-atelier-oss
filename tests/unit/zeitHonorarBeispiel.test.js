// Phase 81 (81-01): the sample data of time, fees and controlling
// (src/lib/zeitHonorar/beispielDaten.js) on top of the 79 accounting sample and —
// optionally — the 80 personnel sample: deterministic, valid for several "today"s,
// on the 15-minute grid, Bavarian working days only, the slots kept free for 82,
// the three calibrated traffic lights and the SEED_* constants.
//
// In:  the seed modules of 79/80/81, 80's contract logic. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import {
  beispielDatensaetzeZeitHonorar, SEED_AMPELN, SEED_ANGEBOT_OFFEN, SEED_BUEROSATZ_TEAM, SEED_KOSTENSAETZE_TEAM,
  SEED_MINUTEN_WOCHE_MINUS1, SEED_REFERENZ_HEUTE, SEED_ZEITBUCHUNGEN,
} from "@/lib/zeitHonorar/beispielDaten.js";
import { ableiten } from "@/lib/zeit/zeitbuchung.js";
import { aktiverVertrag } from "@/lib/people/vertrag.js";
import { buerosatz } from "@/lib/controlling/kostensatz.js";
import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { isoWoche, plusTage, wochentag } from "@core/lib/kalender/datum.js";
import { honorarVertrag } from "@core/lib/hoai/honorar.js";

const PERSONAL = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));

/** @param {string} heute @param {any} personal */
const saat = (heute, personal) => beispielDatensaetzeZeitHonorar(heute, { buchhaltung: beispielDatensaetze(heute), personal });

/**
 * V − F in percentage points per calibrated stage, computed from the bookings.
 * @param {ReturnType<typeof saat>} r
 */
function abstaende(r) {
  const satz = Object.fromEntries(r.Kostensatz.map((k) => [k.mitarbeiter_id, k.satz_eur_h]));
  return Object.fromEntries(r.ziele.map((z) => {
    const k = r.Zeitbuchung.filter((b) => b.project_id === z.project_id && b.lph === z.lph).reduce((s, b) => s + (b.minuten / 60) * satz[b.mitarbeiter_id], 0);
    return [z.schluessel, (k / z.H - z.F) * 100];
  }));
}

test("deterministisch und für mehrere Tage gültig; Ampeln in den Zielbändern", () => {
  for (const heute of ["2026-09-28", "2026-06-30", "2027-01-15"]) {
    for (const personal of [null, PERSONAL]) {
      const a = saat(heute, personal);
      assert.deepEqual(saat(heute, personal), a, `${heute}: zwei Aufrufe gleich`);
      const d = abstaende(a);
      assert.ok(d.gelb > 5 && d.gelb < 10, `${heute} gelb ${d.gelb}`);
      assert.ok(d.gruen > -10 && d.gruen < 0, `${heute} grün ${d.gruen}`);
      assert.ok(d.rot > 10, `${heute} rot ${d.rot}`);
    }
  }
});

test("Raster, abgeleitete Felder, bayerische Arbeitstage im Fenster, max. 9 h je Person und Tag", () => {
  const heute = SEED_REFERENZ_HEUTE;
  const r = saat(heute, PERSONAL);
  const fei = new Set(feiertage(2026, KALENDER_STANDARD).map((f) => f.datum));
  const wt = /** @type {number} */ (wochentag(heute));
  const montag = /** @type {string} */ (plusTage(heute, -((wt === 0 ? 7 : wt) - 1)));
  const fensterStart = /** @type {string} */ (plusTage(montag, -56));
  /** @type {Record<string, number>} */
  const proTag = {};
  for (const b of r.Zeitbuchung) {
    assert.equal(b.minuten % 15, 0, b.id);
    assert.ok(b.minuten > 0, b.id);
    assert.deepEqual({ monat: b.monat, kw: b.kw }, { monat: ableiten(b).monat, kw: ableiten(b).kw }, b.id);
    assert.equal(b.beispiel, true);
    assert.match(b.id, /^bsp-zh-zb-\d{4}$/);
    if (b.quelle === "import") { assert.ok(b.datum < fensterStart, "Übertrag vor dem Fenster"); continue; }
    assert.ok(b.datum >= fensterStart && b.datum < montag, `${b.id} im Fenster`);
    const w = /** @type {number} */ (wochentag(b.datum));
    assert.ok(w >= 1 && w <= 5 && !fei.has(b.datum), `${b.datum} ist ein Arbeitstag`);
    proTag[b.mitarbeiter_id + b.datum] = (proTag[b.mitarbeiter_id + b.datum] || 0) + b.minuten;
  }
  assert.ok(Math.max(...Object.values(proTag)) <= 540);
});

test("frei für 82: M1 nicht in Woche −7/−6, M3 nicht Mo/Di der Woche −2; Status je Woche", () => {
  const r = saat(SEED_REFERENZ_HEUTE, PERSONAL);
  const kw = (tag) => /** @type {{woche: number}} */ (isoWoche(tag)).woche;
  const referenz = kw(SEED_REFERENZ_HEUTE); // 40
  for (const b of r.Zeitbuchung.filter((x) => x.quelle !== "import")) {
    const abstand = kw(b.datum) - referenz;
    if (b.mitarbeiter_id === "P-001") assert.ok(abstand !== -7 && abstand !== -6, `M1 ${b.datum}`);
    if (b.mitarbeiter_id === "P-004" && abstand === -2) assert.ok((wochentag(b.datum) ?? 0) >= 3, `M3 ${b.datum}`);
    assert.equal(b.status, abstand <= -2 ? "freigegeben" : "eingereicht", b.id);
    if (b.status === "freigegeben") assert.equal(b.freigegeben_von, "P-001");
  }
  assert.ok(!r.Zeitbuchung.some((b) => kw(b.datum) === referenz), "laufende Woche leer");
});

test("Personen: M1 = P-001, M2 = P-003, M3 = P-004; ohne 80-Saat nur die virtuelle Inhaber:in (E-17)", () => {
  const team = saat(SEED_REFERENZ_HEUTE, PERSONAL);
  assert.deepEqual([...new Set(team.Zeitbuchung.map((b) => b.mitarbeiter_id))].sort(), ["P-001", "P-003", "P-004"]);
  assert.deepEqual(Object.fromEntries(team.Kostensatz.map((k) => [k.mitarbeiter_id, k.satz_eur_h])), SEED_KOSTENSAETZE_TEAM);
  assert.equal(buerosatz(team.Kostensatz, SEED_REFERENZ_HEUTE, null)?.satz, SEED_BUEROSATZ_TEAM);
  const solo = saat(SEED_REFERENZ_HEUTE, null);
  assert.deepEqual([...new Set(solo.Zeitbuchung.map((b) => b.mitarbeiter_id))], ["inhaber"]);
  assert.deepEqual(solo.Kostensatz.map((k) => [k.mitarbeiter_id, k.satz_eur_h, k.herkunft]), [["inhaber", 115, "manuell"]]);
  // The seed's own contract check agrees with 80's aktiverVertrag on the 80 sample.
  for (const m of PERSONAL.Mitarbeiter) {
    const v = aktiverVertrag(PERSONAL.Arbeitsvertrag, m.id, SEED_REFERENZ_HEUTE);
    const mitSatz = team.Kostensatz.some((k) => k.mitarbeiter_id === m.id && k.herkunft === "berechnet");
    if (mitSatz) assert.ok(v, m.id);
  }
});

test("SEED_*-Konstanten stimmen mit dem Neuberechnen überein", () => {
  for (const [name, personal] of /** @type {const} */ ([["solo", null], ["team", PERSONAL]])) {
    const r = saat(SEED_REFERENZ_HEUTE, personal);
    assert.equal(r.Zeitbuchung.length, SEED_ZEITBUCHUNGEN[name], name);
    /** @type {Record<string, number>} */
    const w39 = {};
    for (const b of r.Zeitbuchung) if (b.kw === "2026-W39") w39[b.mitarbeiter_id] = (w39[b.mitarbeiter_id] || 0) + b.minuten;
    assert.deepEqual(w39, SEED_MINUTEN_WOCHE_MINUS1[name], name);
    assert.deepEqual(r.ziele.map((z) => [z.schluessel, z.project_id, z.lph]), SEED_AMPELN.map((a) => [a.schluessel, a.project_id, a.lph]), name);
  }
});

test("Honorarangebote, Vertragsfelder, Honorarnachtrag, Verlauf und Tagesrahmen", () => {
  const heute = SEED_REFERENZ_HEUTE;
  const buchhaltung = beispielDatensaetze(heute);
  const r = beispielDatensaetzeZeitHonorar(heute, { buchhaltung, personal: PERSONAL });
  // One accepted offer per 79 contract, proj-1 with a replaced V1.
  for (const v of buchhaltung.Honorarvertrag) {
    const angenommen = r.Honorarangebot.filter((a) => a.honorarvertrag_id === v.id && a.status === "angenommen");
    assert.equal(angenommen.length, 1, v.id);
    assert.equal(angenommen[0].kg300_euro, v.kg300_euro);
    assert.equal(angenommen[0].summen.netto, honorarVertrag(v).netto);
  }
  const v1 = r.Honorarangebot.find((a) => a.id === "bsp-zh-ha-1a");
  assert.equal(v1.status, "ersetzt");
  assert.equal(v1.nebenkosten_prozent, 6);
  assert.equal(r.Honorarangebot.find((a) => a.id === "bsp-zh-ha-1").ersetzt_id, "bsp-zh-ha-1a");
  const offen = r.Honorarangebot.find((a) => a.id === SEED_ANGEBOT_OFFEN.id);
  assert.equal(offen.nummer, SEED_ANGEBOT_OFFEN.nummer);
  assert.equal(offen.summen.netto, SEED_ANGEBOT_OFFEN.netto, "Fixture D");
  assert.equal(offen.gueltig_bis, SEED_ANGEBOT_OFFEN.gueltig_bis);
  assert.equal(offen.status, "versendet");
  assert.equal(offen.zahlungsziel_tage, 14);
  assert.equal(offen.leistungsbild, "innenraeume");
  // Contract proj-1: only fields 79 does not carry.
  const patch = r.honorarvertragPatch["bsp-hv-1"];
  for (const k of Object.keys(patch)) assert.ok(!(k in buchhaltung.Honorarvertrag[0]), `${k} ist ein 79-Feld`);
  assert.equal(patch.termine[0].datum, plusTage(heute, 63));
  assert.equal(patch.status, "beauftragt");
  assert.equal(r.Honorarnachtrag[0].lph, 5);
  assert.equal(r.Honorarnachtrag[0].status, "angeboten");
  assert.equal(r.hoaiPlanVerlauf["proj-1"].length, 3);
  assert.deepEqual(r.hoaiPlanVerlauf["proj-1"].map((v) => v.progress[4]), [60, 70, 80]);
  assert.deepEqual(r.hoaiPlanVerlauf["proj-2"].map((v) => v.progress[2]), [70, 80, 90]);
  assert.ok(r.Arbeitszeit.some((a) => a.beginn === "07:30" && a.ende === "18:30" && a.pause_minuten === 30), "ein Tag mit 10,5 h netto");
  assert.ok(r.Arbeitszeit.every((a) => a.mitarbeiter_id === "P-003"));
});
