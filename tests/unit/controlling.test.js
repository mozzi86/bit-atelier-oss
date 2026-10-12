// Phase 81 (81-05): the project controlling core (src/lib/controlling/controlling.js)
// against the hand calculations of 81-RESEARCH § Formeln — Fixture A (LPH 3 red),
// Fixture B (proj-1 pattern: LPH 5 amber, LPH 6 green, weighted progress 44,9 %,
// month series), Fixture E ("Tafel fehlt" by injection, lump sum spread by LPH
// percent), the capped conversion surcharge, a six-stage profile, rounding per
// group, rates missing, the virtual owner, the office-rate mode, and the sample
// data with its SEED_AMPELN.
//
// In:  the controlling core, 79's fee engine, the seed modules of 79/80/81. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ampel, buerosatz, gewichteterFortschritt, hauptvertrag, monatsreihe, portfolio, projektControlling } from "@/lib/controlling/controlling.js";
import { honorarVertrag, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar, SEED_AMPELN, SEED_BUEROSATZ_TEAM, SEED_REFERENZ_HEUTE } from "@/lib/zeitHonorar/beispielDaten.js";

const PERSONAL = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const STICHTAG = "2026-09-28";
const REGELN = { ampel_gelb: 0, ampel_rot: 10, buerosatz: null };

const lph = (lb, n) => lphFuerLeistungsbild(lb).map((l, i) => ({ ...l, beauftragt: i < n }));

/** Fixture A: KG 300 900.000 + KG 400 400.000 → 1.212.500 €, zone III, base rate, LPH 1–8. */
const A = { id: "hv-a", project_id: "pa", leistungsbild: "gebaeude", kg300_euro: 900000, kg400_euro: 400000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph("gebaeude", 8), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null };
/** Fixture B: anrechenbar 2.680.716 €, zone III, LPH 1–8 (79 flat fields). */
const B = { id: "hv-b", project_id: "pb", leistungsbild: "gebaeude", kg300_euro: 2399716, kg400_euro: 281000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph("gebaeude", 8), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null };
const PLAN_B = { project_id: "pb", progress: [100, 100, 100, 100, 60, 20, 0, 0, null] };

/** Cost rates: owner manual 115,00, M2 111,41 (72.000 €), M3 74,27 (48.000 €); M-A 92,84 (60.000 €). */
const SAETZE = [
  { id: "ks-i", mitarbeiter_id: "inhaber", gueltig_ab: "2026-01-01", satz_eur_h: 115, herkunft: "manuell" },
  { id: "ks-2", mitarbeiter_id: "m2", gueltig_ab: "2026-01-01", satz_eur_h: 111.41, herkunft: "berechnet" },
  { id: "ks-3", mitarbeiter_id: "m3", gueltig_ab: "2026-01-01", satz_eur_h: 74.27, herkunft: "berechnet" },
];

let lfd = 0;
/** One booking (status approved unless given). */
const zb = (mitarbeiter_id, projekt, lphNr, stunden, extra = {}) => ({ id: `zb-${++lfd}`, mitarbeiter_id, project_id: projekt, lph: lphNr, minuten: Math.round(stunden * 60), datum: "2026-09-10", status: "freigegeben", ...extra });

/** Fixture B bookings: LPH 5 = 35 h owner + 250 h M2 + 200 h M3; LPH 6 = 10 h M2 + 40 h M3. */
const BUCHUNGEN_B = [
  zb("inhaber", "pb", 5, 35), zb("m2", "pb", 5, 250), zb("m3", "pb", 5, 200),
  zb("m2", "pb", 6, 10), zb("m3", "pb", 6, 40),
];

const zeile = (c, nr) => /** @type {any} */ (c.lph.find((z) => z.lph === nr));

test("Fixture A LPH 3: H 20.553,80 (79), K 18.040,80, V 87,8 %, rot (+27,8 pp), E/DB/EAC/PDB/R, Reststunden 25,1 bei 100,23 €/h", () => {
  const saetze = [{ mitarbeiter_id: "ma", gueltig_ab: "2026-01-01", satz_eur_h: 92.84 }, { mitarbeiter_id: "inhaber", gueltig_ab: "2026-01-01", satz_eur_h: 115 }];
  const c = projektControlling({ vertrag: A, hoaiPlan: { progress: [100, 100, 60, 0, 0, 0, 0, 0, 0] }, buchungen: [zb("ma", "pa", 3, 120), zb("inhaber", "pa", 3, 60)], kostensaetze: saetze, regeln: { ...REGELN, buerosatz: 100.23 } }, { stichtagIso: STICHTAG });
  const z = zeile(c, 3);
  // H = 79's LPH 3 amount of Fixture A: 15 % of 137.025,30 = 20.553,795 → 20.553,80
  // (81-RESEARCH rounded down to ,79; 79's engine is the single source, hoaiAufstellung.test.js).
  assert.equal(z.H, 20553.8);
  // K = 120 × 92,84 + 60 × 115,00 = 11.140,80 + 6.900,00
  assert.equal(z.K, 18040.8);
  assert.equal(z.V, 87.77);
  assert.equal(z.ampel, "rot", "V − F = 87,8 − 60 = +27,8 pp > 10");
  // E = H × F = 20.553,79 × 0,6; DB = E − K; EAC = K / F; PDB = H − EAC; R = H − K
  assert.equal(z.E, 12332.28);
  assert.equal(z.DB, -5708.52);
  assert.equal(z.EAC, 30068);
  assert.equal(z.PDB, -9514.2);
  assert.equal(z.R, 2513);
  // 2.513,00 / 100,23 = 25,07 h
  assert.equal(z.reststunden, 25.1);
  assert.equal(c.buerosatz, 100.23);
});

test("Fixture B: LPH 5 gelb (K 46.731,50, V 67,54 %), LPH 6 grün (K 4.084,90, V 14,76 %), LPH 1–4 ohne Zeiten, Projekt gelb, gewichtet 44,9 %", () => {
  const c = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: BUCHUNGEN_B, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  const l5 = zeile(c, 5);
  // 35 × 115 + 250 × 111,41 + 200 × 74,27 = 4.025,00 + 27.852,50 + 14.854,00
  assert.equal(l5.K, 46731.5);
  assert.equal(l5.H, 69192.66);
  assert.equal(l5.V, 67.54);
  assert.equal(l5.ampel, "gelb", "+7,54 pp: über 0, unter 10");
  const l6 = zeile(c, 6);
  // 10 × 111,41 + 40 × 74,27 = 1.114,10 + 2.970,80
  assert.equal(l6.K, 4084.9);
  assert.equal(l6.V, 14.76);
  assert.equal(l6.ampel, "gruen", "14,76 − 20 = −5,24 pp");
  for (const nr of [1, 2, 3, 4]) assert.equal(zeile(c, nr).ampel, "ohne_zeiten", `LPH ${nr}`);
  assert.equal(zeile(c, 7).F, 0);
  assert.equal(c.ampel, "gelb");
  // Σ H·F / Σ H = 12.177.906,80 / 271.235,21
  assert.equal(c.fortschrittGewichtet, 44.9);
  assert.equal(gewichteterFortschritt(c.lph), 44.9);
  assert.equal(c.summe.H, 271235.21);
  assert.equal(c.summe.K, 50816.4);
  assert.equal(c.tafelFehlt, false);
  assert.equal(c.ohneKostensatzMinuten, 0);
  assert.equal(c.satzQuelle, "persoenlich");
});

test("Rundung je Gruppe: 250 h als 1.000 Viertelstunden-Buchungen bei 111,41 €/h → exakt 27.852,50 €", () => {
  const buchungen = Array.from({ length: 1000 }, () => zb("m2", "pb", 5, 0.25));
  const c = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(zeile(c, 5).K, 27852.5);
  // Per-booking rounding would give 1.000 × round(27,8525) = 27.850,00 — the drift the rule prevents.
  assert.notEqual(1000 * Math.round(0.25 * 111.41 * 100) / 100, 27852.5);
});

test("Ampel-Fixtures: F null → grau; kein Vertrag → grau; +5 pp gelb; −3 pp grün; K > H bei +4 pp → rot", () => {
  const s = { gelbPp: 0, rotPp: 10 };
  assert.equal(ampel({ H: 1000, K: 500, F: null }, s), "grau");
  assert.equal(ampel({ H: null, K: 500, F: 50 }, s), "grau");
  assert.equal(ampel({ H: 1000, K: 650, F: 60 }, s), "gelb");
  assert.equal(ampel({ H: 1000, K: 570, F: 60 }, s), "gruen");
  assert.equal(ampel({ H: 1000, K: 1040, F: 100 }, s), "rot", "K > H wins although +4 pp < 10");
  assert.equal(ampel({ H: 1000, K: 0, F: 40 }, s), "ohne_zeiten");
  const ohne = projektControlling({ vertrag: null, buchungen: [zb("m2", "px", 3, 5)], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(ohne.ampel, "grau");
  assert.equal(ohne.ohneVertrag, true);
  assert.equal(ohne.summe.K, 557.05);
});

test("Fixture E (Tafel fehlt per Injektion): H null, grau, K gerechnet; mit Pauschale 12.000 → anteilig nach LPH-Prozent, Summe exakt", () => {
  const tw = WEITERE_TAFELN.find((t) => t.leistungsbild === "tragwerksplanung");
  const optionen = { weitere: [{ ...tw, annahme: true }] };
  const E = { ...B, id: "hv-e", leistungsbild: "tragwerksplanung", bezugswert: 1000000, lph: lph("tragwerksplanung", 6) };
  assert.equal(honorarVertrag(E, optionen).quelle, "tafel_fehlt");
  const buchungen = [zb("m2", "pb", 2, 10)];
  const c = projektControlling({ vertrag: E, buchungen, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG, optionen });
  assert.equal(c.tafelFehlt, true);
  assert.equal(c.ampel, "grau");
  assert.ok(c.lph.every((z) => z.H === null && z.ampel === "grau"));
  assert.equal(c.summe.H, null);
  assert.equal(c.summe.DB, null);
  assert.equal(c.summe.K, 1114.1);

  const P = { ...E, pauschal_euro: 12000 };
  const p = projektControlling({ vertrag: P, buchungen, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG, optionen });
  assert.equal(p.honorarQuelle, "pauschal");
  assert.equal(p.pauschalAnteilig, true);
  assert.equal(p.tafelFehlt, false);
  const prozente = lphFuerLeistungsbild("tragwerksplanung").map((l) => l.prozent);
  const summeProzent = prozente.reduce((a, b) => a + b, 0);
  assert.equal(p.lph.length, 6);
  p.lph.slice(0, 5).forEach((z, i) => assert.equal(z.H, Math.round((12000 * prozente[i] / summeProzent) * 100) / 100, `LPH ${z.lph}`));
  assert.equal(Math.round(p.lph.reduce((a, z) => a + z.H, 0) * 100) / 100, 12000, "Rundungsrest auf der letzten LPH");
  assert.equal(p.summe.H, 12000);
  assert.equal(p.ohneLeistungsstand, "nur_objektplanung");
});

test("Umbau über der Obergrenze: H_i nutzt den von 79 gekappten Faktor umbau/grund = 0,33, nicht 0,60", () => {
  const U = { ...A, umbauzuschlag_prozent: 60 };
  const h = honorarVertrag(U);
  assert.equal(Math.round(((h.umbau ?? 0) / (h.grund ?? 1)) * 1000) / 1000, 0.33);
  const c = projektControlling({ vertrag: U, regeln: REGELN }, { stichtagIso: STICHTAG });
  const l3 = zeile(c, 3);
  assert.ok(Math.abs(l3.H - 20553.8 * 1.33) <= 0.01, `H3 ${l3.H}`);
  assert.ok(Math.abs(l3.H - 20553.8 * 1.6) > 1000);
});

test("Tragwerksplanung (6 LPH) mit HoaiPlan: F null überall, grau „nur Objektplanung“, K gerechnet", () => {
  const T = { ...B, id: "hv-t", leistungsbild: "tragwerksplanung", bezugswert: 425000, lph: lph("tragwerksplanung", 6) };
  const c = projektControlling({ vertrag: T, hoaiPlan: PLAN_B, buchungen: [zb("m3", "pb", 4, 8)], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(c.lph.length, 6);
  assert.ok(c.lph.every((z) => z.F === null && z.ampel === "grau"));
  assert.equal(c.ampel, "grau");
  assert.equal(c.ohneLeistungsstand, "nur_objektplanung");
  assert.equal(zeile(c, 4).K, 594.16);
  assert.ok(zeile(c, 4).H > 0);
});

test("Stunden ohne Kostensatz: 180 min gemeldet, K unverändert (nie 0 €)", () => {
  const ohne = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: [...BUCHUNGEN_B, zb("neu", "pb", 5, 3)], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(ohne.ohneKostensatzMinuten, 180);
  assert.equal(zeile(ohne, 5).K, 46731.5);
  assert.equal(zeile(ohne, 5).minutenOhneSatz, 180);
  // Only hours without a rate on a stage → no honest light: grey, not green — and the
  // project is grey too, although the stages not yet started (F 0, K 0) are green.
  const nur = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: [zb("neu", "pb", 6, 30)], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(zeile(nur, 6).ampel, "grau");
  assert.equal(zeile(nur, 7).ampel, "gruen");
  assert.equal(nur.ampel, "grau");
});

test("Virtuelle Inhaber:in mit manuellem Satz 115,00; mit 80-Datensatz art 'inhaber' zählen ihre Buchungen dieser Person (E-17)", () => {
  const virtuell = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: [zb("inhaber", "pb", 5, 10)], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(zeile(virtuell, 5).K, 1150);
  assert.deepEqual(virtuell.stundenJeMitarbeiter, { inhaber: 600 });
  const mitarbeiter = [{ id: "P-001", art: "inhaber", status: "aktiv" }];
  const echt = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: [zb("inhaber", "pb", 5, 10), zb("P-001", "pb", 5, 2)], kostensaetze: SAETZE, mitarbeiter, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.deepEqual(echt.stundenJeMitarbeiter, { "P-001": 720 });
  assert.equal(zeile(echt, 5).K, 1380, "the owner's manual rate under the virtual id still applies");
});

test("abgelehnt zählt nie; nurFreigegeben → K sinkt genau um eingereichte und Entwurfs-Buchungen", () => {
  const extra = [zb("m3", "pb", 5, 4, { status: "eingereicht" }), zb("m3", "pb", 5, 2, { status: "entwurf" }), zb("m3", "pb", 5, 100, { status: "abgelehnt" })];
  const alle = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: [...BUCHUNGEN_B, ...extra], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  // 46.731,50 + 6 × 74,27; the 100 rejected hours never count
  assert.equal(zeile(alle, 5).K, 47177.12);
  const frei = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: [...BUCHUNGEN_B, ...extra], kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG, nurFreigegeben: true });
  assert.equal(zeile(frei, 5).K, 46731.5);
  assert.equal(Math.round((zeile(alle, 5).K - zeile(frei, 5).K) * 100) / 100, 445.62);
});

test("Honorarnachtrag N1 beauftragt (LPH 5, 8.000 €) → H5 77.192,66, V5 60,54 %, weiter gelb; angeboten zählt nicht", () => {
  const n1 = { id: "n1", honorarvertrag_id: "hv-b", lph: 5, betrag_euro: 8000, status: "beauftragt" };
  const c = projektControlling({ vertrag: B, nachtraege: [n1], hoaiPlan: PLAN_B, buchungen: BUCHUNGEN_B, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(zeile(c, 5).H, 77192.66);
  assert.equal(zeile(c, 5).nachtragH, 8000);
  assert.equal(zeile(c, 5).V, 60.54);
  assert.equal(zeile(c, 5).ampel, "gelb");
  const angeboten = projektControlling({ vertrag: B, nachtraege: [{ ...n1, status: "angeboten" }], hoaiPlan: PLAN_B, buchungen: BUCHUNGEN_B, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG });
  assert.equal(zeile(angeboten, 5).H, 69192.66);
});

test("Bürosatz: Modus 'buero' → K5 = 485 h × 100,23 = 48.611,55; stundenJeMitarbeiter nur Minuten; ohne Sätze mit Regel 95 → 'regel'", () => {
  assert.deepEqual(buerosatz(SAETZE, [], STICHTAG, null), { satz: 100.23, quelle: "mittel" });
  // An inactive person's rate does not enter the mean.
  assert.deepEqual(buerosatz(SAETZE, [{ id: "m3", status: "ausgeschieden" }], STICHTAG, null), { satz: 113.21, quelle: "mittel" });
  const c = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: BUCHUNGEN_B, kostensaetze: SAETZE, regeln: REGELN }, { stichtagIso: STICHTAG, satzModus: "buero" });
  assert.equal(zeile(c, 5).K, 48611.55);
  assert.equal(c.satzQuelle, "mittel");
  assert.deepEqual(c.stundenJeMitarbeiter, { inhaber: 2100, m2: 15600, m3: 14400 });
  for (const v of Object.values(c.stundenJeMitarbeiter)) assert.equal(Number.isInteger(v), true, "minutes, never money");
  const ohneZugang = projektControlling({ vertrag: B, hoaiPlan: PLAN_B, buchungen: BUCHUNGEN_B, kostensaetze: [], regeln: { ...REGELN, buerosatz: 95 } }, { stichtagIso: STICHTAG, satzModus: "buero" });
  assert.equal(ohneZugang.satzQuelle, "regel");
  assert.equal(zeile(ohneZugang, 5).K, 46075);
  assert.equal(zeile(ohneZugang, 6).K, 4750);
  assert.equal(ohneZugang.ohneKostensatzMinuten, 0);
});

test("monatsreihe Fixture B: ΔE 2026-08 = 13.146,61, 2026-09 = 16.606,24; abgerechnet = gestellte Rechnungen im Monat netto", () => {
  const plan = { ...PLAN_B, verlauf: [
    { monat: "2026-07", progress: [100, 100, 100, 100, 25, 0, 0, 0, 0] },
    { monat: "2026-08", progress: [100, 100, 100, 100, 40, 10, 0, 0, 0] },
    { monat: "2026-09", progress: [100, 100, 100, 100, 60, 20, 0, 0, 0] },
  ] };
  const rechnungen = [
    { id: "ar3", honorarvertrag_id: "hv-b", status: "gestellt", art: "abschlag", rechnungsdatum: "2026-08-20", netto: 30444.77 },
    { id: "ar-e", honorarvertrag_id: "hv-b", status: "entwurf", art: "abschlag", rechnungsdatum: "2026-09-02", netto: 999 },
    { id: "ar-s", honorarvertrag_id: "hv-b", status: "gestellt", art: "storno", rechnungsdatum: "2026-09-03", netto: -30444.77 },
    { id: "ar-f", honorarvertrag_id: "hv-x", status: "gestellt", art: "abschlag", rechnungsdatum: "2026-09-04", netto: 500 },
  ];
  const r = monatsreihe({ hoaiPlan: plan, vertrag: B, buchungen: BUCHUNGEN_B, kostensaetze: SAETZE, rechnungen, regeln: REGELN }, { stichtagIso: STICHTAG });
  const m = Object.fromEntries(r.map((x) => [x.monat, x]));
  assert.deepEqual(Object.keys(m), ["2026-07", "2026-08", "2026-09"]);
  assert.equal(m["2026-07"].dE, null, "first month of the history has no predecessor");
  // ΔE 08 = 69.192,66 × 15 % + 27.677,06 × 10 %; ΔE 09 = 69.192,66 × 20 % + 27.677,06 × 10 %
  assert.equal(m["2026-08"].dE, 13146.61);
  assert.equal(m["2026-09"].dE, 16606.24);
  assert.equal(m["2026-08"].abgerechnet, 30444.77);
  assert.equal(m["2026-09"].abgerechnet, 0);
  assert.equal(m["2026-09"].K, 50816.4);
  assert.equal(m["2026-09"].DB, Math.round((16606.24 - 50816.4) * 100) / 100);
});

test("hauptvertrag: beauftragter vor Entwurf, dann jüngstes Vertragsdatum", () => {
  assert.equal(hauptvertrag([]), null);
  const v = hauptvertrag([{ id: "a", status: "entwurf", vertragsdatum: "2026-09-01" }, { id: "b", status: "beauftragt", vertragsdatum: "2025-01-01" }, { id: "c", vertragsdatum: "2025-06-01" }]);
  assert.equal(v?.id, "c");
});

/** Sample data of 79 + 81 on the reference day, with the 81 patches applied to the 79 rows. */
function saat(personal) {
  const bh = beispielDatensaetze(SEED_REFERENZ_HEUTE);
  const zh = beispielDatensaetzeZeitHonorar(SEED_REFERENZ_HEUTE, { buchhaltung: bh, personal });
  const vertraege = bh.Honorarvertrag.map((v) => ({ ...v, ...(zh.honorarvertragPatch[v.id] || {}) }));
  const hoaiPlaene = bh.HoaiPlan.map((h) => ({ ...h, verlauf: zh.hoaiPlanVerlauf[h.project_id] || [] }));
  return { bh, zh, vertraege, hoaiPlaene };
}

test("Saat: portfolio zeigt die SEED_AMPELN (proj-1 gelb/grün, proj-2 rot) — ohne und mit 80-Personal; Stunden ohne Vertrag erscheinen", () => {
  for (const personal of [null, PERSONAL]) {
    const { zh, vertraege, hoaiPlaene } = saat(personal);
    const projekte = [{ id: "proj-1", name: "Projekt 1" }, { id: "proj-2", name: "Projekt 2" }, { id: "proj-3", name: "Projekt 3" }, { id: "proj-9", name: "Ohne Vertrag" }];
    const buchungen = [...zh.Zeitbuchung, zb("inhaber", "proj-9", null, 3, { datum: "2026-09-21" })];
    const reihen = portfolio(projekte, {
      vertraege, nachtraege: zh.Honorarnachtrag, hoaiPlaene, buchungen, kostensaetze: zh.Kostensatz,
      mitarbeiter: personal ? personal.Mitarbeiter : [], angebote: zh.Honorarangebot, regeln: REGELN,
    }, { stichtagIso: SEED_REFERENZ_HEUTE });
    const r = Object.fromEntries(reihen.map((x) => [x.project_id, x]));
    for (const s of SEED_AMPELN) {
      assert.equal(zeile(r[s.project_id].c, s.lph).ampel, s.ampel, `${personal ? "team" : "solo"} ${s.schluessel}`);
    }
    assert.equal(r["proj-1"].c.ampel, "gelb");
    assert.equal(r["proj-2"].c.ampel, "rot");
    assert.equal(reihen[0].project_id, "proj-2", "worst light first");
    assert.equal(r["proj-9"].vertrag, null);
    assert.equal(r["proj-9"].c.ampel, "grau");
    assert.equal(r["proj-9"].c.summe.K, 345);
    assert.ok(r["proj-4"], "a contract without bookings is listed too");
    assert.equal(r["proj-1"].c.ohneKostensatzMinuten, 0, "every sample person has a rate");
  }
});

test("Saat (Team): Bürosatz = SEED_BUEROSATZ_TEAM", () => {
  const { zh } = saat(PERSONAL);
  assert.equal(buerosatz(zh.Kostensatz, PERSONAL.Mitarbeiter, SEED_REFERENZ_HEUTE, null)?.satz, SEED_BUEROSATZ_TEAM);
});
