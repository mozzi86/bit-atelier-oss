// Phase 81 (81-04): architect's contract, contract account and the instalment
// template with fee amendments on 79's billing (abschlagsVorlage, restBisSchluss)
// — Fixture B of 81-RESEARCH (proj-1 pattern: anrechenbar 2.680.716 €, zone III,
// LPH 1–8, net 284.796,97 €), Fixture D (interiors offer), "Tafel fehlt" by
// injection, a structural-planning contract (six stages), and the counter-check
// that a billed amendment does not lower the next stage instalment.
//
// In:  src/lib/honorar/{vertrag,honorarNachtrag}.js, 79's engine. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { abschlagMitNachtraegen, angebotZuVertrag, rechnungenOhneNachtragsanteil, stufeBeauftragen, tafelStand, vertragsFristen, vertragskonto, vertragsStatusWechsel } from "@/lib/honorar/vertrag.js";
import { betragAusBerechnung, nachtragPositionen, nachtragStatusWechsel, neuerNachtrag, vertragssummeMitNachtraegen } from "@/lib/honorar/honorarNachtrag.js";
import { beauftragteStufenLph } from "@/lib/honorar/vertragsdaten.js";
import { abschlagsVorlage, restBisSchluss } from "@core/lib/hoai/abrechnung.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";

const lph = (lb, n) => lphFuerLeistungsbild(lb).map((l, i) => ({ ...l, beauftragt: i < n }));
const B = {
  id: "hv-b", project_id: "p1", nummer: "AV-2025-002", leistungsbild: "gebaeude", kg300_euro: 2399716, kg400_euro: 281000, sonstige_euro: 0,
  honorarzone: "III", satz_position_prozent: 0, lph: lph("gebaeude", 8), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
  verguetung_snapshot: { summen: { netto: 284796.97 }, tafel_stand: tafelStand("gebaeude") },
};
/** An issued instalment invoice of contract B (gross with 19 %; paid in full when bezahlt). */
const ar = (id, netto, bezahlt, lp_pos = []) => {
  const brutto = Math.round(netto * 119) / 100;
  return { id, honorarvertrag_id: "hv-b", art: "abschlag", status: "gestellt", netto, brutto, lp_pos, zahlungen: bezahlt ? [{ datum: "2026-05-01", betrag: brutto }] : [] };
};
const RECHNUNGEN = [ar("ar1", 24909.35, true), ar("ar2", 49818.71, true), ar("ar3", 30444.77, false)];
const PLAN = { progress: [100, 100, 100, 100, 60, 20, 0, 0, null] };
const N1 = { id: "n1", honorarvertrag_id: "hv-b", nr: 1, titel: "Variantenuntersuchung Fassade", lph: 5, betrag_euro: 8000, erbracht_prozent: 0, status: "angeboten" };

test("Abschlag Nr. 4 = 79s Vorschlag 16.606,24; Titel; Konto und Rest wie 79", () => {
  const a = abschlagMitNachtraegen(B, { rechnungen: RECHNUNGEN, nachtraege: [], hoaiPlan: PLAN });
  assert.ok(a);
  assert.equal(a.abschlag_nr, 4);
  assert.equal(a.vorlage.netto, 16606.24);
  assert.equal(a.vorlage.stand_quelle, "hoaiplan");
  assert.equal(a.titel, "Abschlagsrechnung Nr. 4 zum Architektenvertrag AV-2025-002");
  assert.equal(a.vorlage.netto, abschlagsVorlage(B, { 1: 100, 2: 100, 3: 100, 4: 100, 5: 60, 6: 20, 7: 0, 8: 0, 9: 0 }, RECHNUNGEN).netto);
  const k = vertragskonto(B, { rechnungen: RECHNUNGEN, nachtraege: [], hoaiPlan: PLAN });
  assert.equal(k.summe, 284796.97);
  assert.equal(k.abgerechnet, 105172.83);
  assert.equal(k.bezahlt, 74728.06);
  assert.equal(k.offen, 30444.77);
  assert.equal(k.rest, 179624.14);
  assert.equal(k.rest, restBisSchluss(B, RECHNUNGEN));
  assert.deepEqual(k.hinweise, []);
  const mitAr4 = vertragskonto(B, { rechnungen: [...RECHNUNGEN, ar("ar4", 16606.24, false)], nachtraege: [], hoaiPlan: PLAN });
  assert.equal(mitAr4.rest, 163017.9);
});

test("Honorarnachtrag N1: Status, Vertragssumme 293.196,97, Rest 188.024,14; abgelehnter N2 zählt nicht", () => {
  const beauftragt = nachtragStatusWechsel(N1, "beauftragt", { heuteIso: "2026-09-28" });
  assert.equal(beauftragt.ok, true);
  const n1 = beauftragt.ok ? beauftragt.nachtrag : N1;
  assert.equal(n1.beauftragt_am, "2026-09-28");
  assert.deepEqual(nachtragStatusWechsel(n1, "entwurf", { heuteIso: "2026-09-28" }), { ok: false, fehler: "uebergang" });
  const n2 = { ...N1, id: "n2", nr: 2, betrag_euro: 3000, status: "abgelehnt" };
  assert.equal(vertragssummeMitNachtraegen(B, [n1, n2]), 293196.97);
  const k = vertragskonto(B, { rechnungen: RECHNUNGEN, nachtraege: [n1, n2], hoaiPlan: PLAN });
  assert.equal(k.summe, 293196.97);
  assert.equal(k.rest, 188024.14);
  assert.equal(neuerNachtrag(B, [n1, n2], { heuteIso: "2026-09-28" }).nr, 3);
});

test("Nachtrag 100 % erbracht → Abschlag 24.606,24; nach dem Stellen ist der LPH-Vorschlag wie ohne N1 (Gegenprobe)", () => {
  const n1 = { ...N1, status: "beauftragt", erbracht_prozent: 100 };
  const a = abschlagMitNachtraegen(B, { rechnungen: RECHNUNGEN, nachtraege: [n1], hoaiPlan: PLAN });
  assert.equal(a?.vorlage.netto, 24606.24);
  const pos = a?.vorlage.lp_pos.find((p) => p.nachtrag_id === "n1");
  assert.deepEqual(pos, { lp: null, nachtrag_id: "n1", bezeichnung: "Honorarnachtrag 1 – Variantenuntersuchung Fassade", stand: 100, netto: 8000 });
  // Issue AR4 with both parts, then progress LPH 5 to 80 %.
  const ar4 = ar("ar4", 24606.24, false, /** @type {any[]} */ (a?.vorlage.lp_pos));
  const danach = [...RECHNUNGEN, ar4];
  assert.deepEqual(nachtragPositionen([n1], danach), [], "N1 vollständig abgerechnet");
  const plan80 = { progress: [100, 100, 100, 100, 80, 20, 0, 0, null] };
  const mit = abschlagMitNachtraegen(B, { rechnungen: danach, nachtraege: [n1], hoaiPlan: plan80 });
  const ohne = abschlagMitNachtraegen(B, { rechnungen: [...RECHNUNGEN, ar("ar4", 16606.24, false)], nachtraege: [], hoaiPlan: plan80 });
  assert.equal(mit?.vorlage.netto, ohne?.vorlage.netto, "LPH-Vorschlag unverändert durch N1");
  // Counter-check: 79 on the UNCLEANED invoices would propose 8.000,00 less.
  const roh = abschlagsVorlage(B, { 1: 100, 2: 100, 3: 100, 4: 100, 5: 80, 6: 20 }, danach).netto;
  assert.equal(Math.round(((ohne?.vorlage.netto ?? 0) - roh) * 100) / 100, 8000);
  assert.equal(rechnungenOhneNachtragsanteil([ar4])[0].netto, 16606.24);
});

test("Tafel fehlt (Injektion): kein Abschlag, Summe/Rest null; mit Pauschale wie 79; Tragwerksplanung ohne LPH-Stand", () => {
  const tw = WEITERE_TAFELN.find((t) => t.leistungsbild === "tragwerksplanung");
  const optionen = { weitere: [{ ...tw, annahme: true }] };
  const e = { ...B, id: "hv-e", leistungsbild: "tragwerksplanung", bezugswert: 1000000, lph: lph("tragwerksplanung", 6) };
  assert.equal(abschlagMitNachtraegen(e, { rechnungen: [] }, optionen), null);
  const k = vertragskonto(e, { rechnungen: [] }, optionen);
  assert.equal(k.summe, null);
  assert.equal(k.rest, null);
  assert.ok(k.hinweise.includes("tafel_fehlt"));
  const p = abschlagMitNachtraegen({ ...e, pauschal_euro: 12000 }, { rechnungen: [] }, optionen);
  assert.ok(p);
  assert.equal(p?.vorlage.lp_pos.length, 0, "79: Pauschale ohne LPH-Positionen");
  // Structural planning with an official table: lpStand null → manual, amendment positions still there.
  const t = { ...B, id: "hv-t", leistungsbild: "tragwerksplanung", bezugswert: 425000, lph: lph("tragwerksplanung", 6) };
  const n = { ...N1, honorarvertrag_id: "hv-t", status: "beauftragt", erbracht_prozent: 50 };
  const at = abschlagMitNachtraegen(t, { rechnungen: [], nachtraege: [n], hoaiPlan: PLAN });
  assert.equal(at?.vorlage.stand_quelle, "manuell");
  assert.deepEqual(at?.vorlage.lp_pos.map((x) => x.lp), [null]);
  assert.equal(at?.vorlage.netto, 4000);
});

test("Vergütungs-Beleg: geänderter Tafelstand → Hinweis, Summe bleibt; NK am Vertrag", () => {
  const anders = { ...B, verguetung_snapshot: { ...B.verguetung_snapshot, tafel_stand: { ...B.verguetung_snapshot.tafel_stand, abgerufen_am: "2021-01-01" } } };
  const k = vertragskonto(anders, { rechnungen: [] });
  assert.ok(k.hinweise.includes("tafel_geaendert"));
  assert.equal(k.summe, 284796.97);
});

test("angebotZuVertrag (Fixture D): AV-2026-001, flache Felder 1:1, Beleg; Besondere Leistung wird Honorarnachtrag", () => {
  const angebot = {
    id: "ha-d", project_id: "proj-3", nummer: "HA-2026-001", status: "versendet", leistungsbild: "innenraeume", bauherr_name: "Bauherrschaft B", bauherr_anschrift: "Musterstraße 1",
    bauherr_art: "unternehmer", zahlungsziel_tage: 14, zahlungsziel_vertraglich: true, anrechenbare_quelle: "manuell", kg300_euro: 480000, kg400_euro: 0, sonstige_euro: 0,
    honorarzone: "III", satz_position_prozent: 0, lph: lph("innenraeume", 8), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, pauschal_euro: null, ust_satz: 19, textform_am: null,
    besondere_leistungen: [{ titel: "Möblierungsplan", art: "pauschal", betrag_euro: 2500 }],
  };
  const wert = (id) => ({ "zeit_honorar.nummer_vertrag": "AV-{jahr}-{nr3}" })[id] ?? null;
  const r = angebotZuVertrag(angebot, [], { heuteIso: "2026-09-28", wert });
  assert.equal(r.vertrag.nummer, "AV-2026-001");
  assert.equal(r.vertrag.status, "beauftragt");
  for (const f of ["leistungsbild", "kg300_euro", "honorarzone", "satz_position_prozent", "umbauzuschlag_prozent", "nebenkosten_prozent", "ust_satz", "bauherr_name", "zahlungsziel_tage", "zahlungsziel_vertraglich"]) {
    assert.deepEqual(r.vertrag[f], /** @type {any} */ (angebot)[f], f);
  }
  assert.equal(r.vertrag.verguetung_snapshot.summen.netto, 62365.74);
  assert.equal(r.vertrag.verguetung_snapshot.tafel_stand.paragraf, 35);
  assert.ok(r.vertrag.verguetung_snapshot.tafel_stand.fassung);
  assert.deepEqual(r.vertrag.stufen, [{ nr: 1, lph: [1, 2, 3, 4, 5, 6, 7, 8], beauftragt_am: "2026-09-28" }]);
  assert.equal(r.angebot.status, "angenommen");
  assert.equal(r.nachtraege.length, 1);
  assert.equal(r.nachtraege[0].status, "beauftragt");
  assert.equal(r.nachtraege[0].betrag_euro, 2500);
});

test("Stufen, Statuswechsel, betragAusBerechnung, Fristen für 82", () => {
  const mitStufen = { ...B, lph: lph("gebaeude", 4), stufen: [{ nr: 1, lph: [1, 2, 3, 4], beauftragt_am: "2025-03-01" }, { nr: 2, lph: [5, 6, 7, 8], beauftragt_am: null }] };
  assert.deepEqual(beauftragteStufenLph(mitStufen), [1, 2, 3, 4]);
  const neu = stufeBeauftragen(mitStufen, 2, "2026-02-01");
  assert.deepEqual(neu.lph.slice(4, 8).map((l) => l.beauftragt), [true, true, true, true]);
  assert.equal(vertragsStatusWechsel({ ...B, status: "beauftragt" }, "ruht").ok, true);
  assert.equal(vertragsStatusWechsel({ ...B, status: "abgeschlossen" }, "beauftragt").ok, false);
  assert.equal(betragAusBerechnung({ art: "wiederholung", lph: 2, wiederholung_prozent: 50 }, B), 9686.97);
  const wert = (id) => (id === "zeit_honorar.verrechnungssatz_projektleitung" ? 105 : null);
  assert.equal(betragAusBerechnung({ art: "stunden", stunden: 10, rolle: "projektleitung" }, B, wert), 1050);
  assert.equal(betragAusBerechnung({ art: "pauschal", betrag_euro: 8000 }, B), 8000);
  assert.deepEqual(vertragsFristen({ ...B, termine: [{ titel: "LPH 5 abgeschlossen", datum: "2026-11-30", lph: 5, art: "meilenstein" }] }), [
    { quelle: "vertrag", art: "meilenstein", datum: "2026-11-30", titel: "LPH 5 abgeschlossen", objekt: "AV-2025-002", project_id: "p1", ziel: "/Fees?tab=contracts" },
  ]);
});

test("AVA-Preisschichten bleiben unberührt: keine Kopplung zwischen Honorar-Libs und preisschichten.js", async () => {
  // preisschichten.summen(positionen, …) reads LV positions and price layers only; the
  // contract sum of the cost control therefore cannot move when a Honorarvertrag or a
  // Honorarnachtrag is created. Checked on the sources so a later import would fail here.
  const fs = await import("node:fs");
  const lesen = (/** @type {string} */ p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const ps = lesen("packages/nova-ausschreibung/src/lib/preisschichten.js");
  assert.doesNotMatch(ps, /Honorarvertrag|Honorarnachtrag|Honorarangebot/);
  for (const p of ["src/lib/honorar/vertrag.js", "src/lib/honorar/honorarNachtrag.js", "src/lib/honorar/vertragPdf.js"]) {
    assert.doesNotMatch(lesen(p), /preisschichten/, p);
  }
});
