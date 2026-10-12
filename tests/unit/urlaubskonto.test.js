// 82-04 Task 1: leave consumption, balance, lapse (entitlement from 80). Run also under TZ=UTC.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { arbeitstageMuster, hinweisQuittiert, urlaubskonto, verbrauch } from "@/lib/abwesenheit/urlaubskonto.js";
import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { urlaubsanspruch } from "@/lib/people/urlaub.js";
import { aktiverVertrag } from "@/lib/people/vertrag.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { contacts } from "../../packages/nova-core/server/seed-data.js";
import { SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const FT = (/** @type {number} */ j) => feiertage(j, KALENDER_STANDARD);
const WEIHNACHTEN = { von: "2026-12-21", bis: "2027-01-08", art: "urlaub", status: "genehmigt" };
const PERSONAL = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), SEED82_ANKER);
const SAAT = beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal: PERSONAL, kontakte: contacts });
const aw = (/** @type {string} */ id) => SAAT.Abwesenheit.find((a) => a.id === id);
const mitarbeiter = (/** @type {string} */ id) => PERSONAL.Mitarbeiter.find((m) => m.id === id);

test("Verbrauch 21.12.2026–08.01.2027: Mo–Fr 8 + 4, halbe Heiligabend/Silvester 7 + 4, Mo/Di/Mi 6 + 2, Halbtag am Anfang 7,5", () => {
  assert.deepEqual(verbrauch(WEIHNACHTEN, { feiertageFuer: FT }), { 2026: 8, 2027: 4 });
  assert.deepEqual(verbrauch(WEIHNACHTEN, { feiertageFuer: FT, heiligabendSilvester: "halb" }), { 2026: 7, 2027: 4 });
  assert.deepEqual(verbrauch(WEIHNACHTEN, { feiertageFuer: FT, arbeitstageWoche: 3 }), { 2026: 6, 2027: 2 });
  assert.equal(verbrauch({ ...WEIHNACHTEN, halbtag_von: true }, { feiertageFuer: FT })[2026], 7.5);
  assert.deepEqual([...arbeitstageMuster(3)], [1, 2, 3]);
});

test("§ 9 BUrlG: krank 22.–23.12. im Urlaub wird nicht angerechnet", () => {
  assert.equal(verbrauch(WEIHNACHTEN, { feiertageFuer: FT, krankTage: new Set(["2026-12-22", "2026-12-23"]) })[2026], 6);
});

test("Saat: M1 Urlaub 10.–21.08. = 10 Arbeitstage, M2 05.–09.10. = 5", () => {
  assert.equal(verbrauch(aw("aw-1"), { feiertageFuer: FT })[2026], 10);
  assert.equal(verbrauch(aw("aw-3"), { feiertageFuer: FT })[2026], 5);
});

test("Konto M2 2026: Anspruch aus 80, geplant 5, genommen 0, Rest = Anspruch − 5", () => {
  const m2 = mitarbeiter(aw("aw-3").mitarbeiter_id);
  const k = urlaubskonto({ mitarbeiter: m2, vertraege: PERSONAL.Arbeitsvertrag, abwesenheiten: SAAT.Abwesenheit, jahr: 2026, heute: SEED82_ANKER, feiertageFuer: FT });
  const v = aktiverVertrag(PERSONAL.Arbeitsvertrag, m2.id, SEED82_ANKER);
  const erwartet = urlaubsanspruch({ urlaub_tage_jahr: v.urlaub_tage_jahr, eintritt: m2.eintritt, austritt: m2.austritt, jahr: 2026 }).tage;
  assert.equal(k.anspruch, erwartet);
  assert.equal(k.geplant, 5);
  assert.equal(k.genommen, 0);
  assert.equal(k.beantragt, 0);
  assert.equal(k.rest, Math.round((erwartet + k.uebertrag - 5) * 10) / 10);
});

test("Konto M3 2026: der Antrag aw-4 zählt als beantragt nach dem 3-Tage-Muster (nicht abgezogen)", () => {
  const m3 = mitarbeiter(aw("aw-4").mitarbeiter_id);
  const k = urlaubskonto({ mitarbeiter: m3, vertraege: PERSONAL.Arbeitsvertrag, abwesenheiten: SAAT.Abwesenheit, jahr: 2026, heute: SEED82_ANKER, feiertageFuer: FT });
  // 07.10. (Mi), 12.–14.10. (Mo–Mi) bei Arbeitstagen Mo/Di/Mi.
  assert.equal(k.beantragt, 4);
  assert.equal(k.geplant, 0);
});

test("Inhaber/Gesellschafter ohne Konto", () => {
  const m1 = mitarbeiter(aw("aw-1").mitarbeiter_id);
  assert.equal(m1.art, "inhaber");
  const k = urlaubskonto({ mitarbeiter: m1, vertraege: PERSONAL.Arbeitsvertrag, abwesenheiten: SAAT.Abwesenheit, jahr: 2026, heute: SEED82_ANKER, feiertageFuer: FT });
  assert.equal(k.ohneArbeitsrecht, true);
  assert.equal(k.anspruch, null);
});

test("Verfall nur mit quittiertem Hinweis aus 80; ohne Quittung „übertragen – Hinweis fehlt“", () => {
  const m = { id: "m-x", art: "angestellt", eintritt: "2020-01-01", austritt: null };
  const vertraege = [{ mitarbeiter_id: "m-x", status: "unterschrieben", beginn: "2020-01-01", ende: null, wochenstunden: 40, arbeitstage_woche: 5, urlaub_tage_jahr: 30 }];
  const abw = [{ mitarbeiter_id: "m-x", art: "urlaub", status: "genehmigt", von: "2026-03-02", bis: "2026-04-03" }]; // 25 Arbeitstage (Karfreitag 03.04. frei → 24)
  const basis = { mitarbeiter: m, vertraege, abwesenheiten: abw, jahr: 2026, heute: "2026-09-28", feiertageFuer: FT };
  const ohne = urlaubskonto(basis);
  assert.ok(ohne.rest > 0);
  assert.deepEqual(ohne.verfall, { status: "uebertragen_hinweis_fehlt", verfallAm: null });
  const quittung = [{ schluessel: "resturlaub_hinweis:buero:2026-09-30", quittiert_am: "2026-09-15" }];
  assert.equal(hinweisQuittiert(quittung, 2026), true);
  assert.deepEqual(urlaubskonto({ ...basis, fristquittungen: quittung }).verfall, { status: "verfaellt", verfallAm: "2027-03-31" });
});

test("Feiertage über die Regeln: 2027 mit Mariä Himmelfahrt 13, mit Friedensfest 14, ohne Mariä Himmelfahrt 12", () => {
  assert.equal(feiertage(2027, { bundesland: "BY", mariae_himmelfahrt: true, augsburger_friedensfest: false }).length, 13);
  assert.equal(feiertage(2027, { bundesland: "BY", mariae_himmelfahrt: true, augsburger_friedensfest: true }).length, 14);
  assert.equal(feiertage(2027, { bundesland: "BY", mariae_himmelfahrt: false, augsburger_friedensfest: false }).length, 12);
});
