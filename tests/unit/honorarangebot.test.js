// Phase 81 (81-03): lifecycle of a fee offer — new draft with office defaults
// (number range, validity, incidental costs/VAT from 79, payment term chain
// E-12), only 79 field names, immutability after sending, versions, "abgelaufen"
// shown only, deadlines for phase 82, "Tafel fehlt" blocks sending.
//
// In:  src/lib/honorar/angebot.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aendern, angebotsFristen, effektiverStatus, neueFassung, neuesAngebot, versenden, VERTRAGSFELDER } from "@/lib/honorar/angebot.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";

const REGELN = {
  "zeit_honorar.nummer_angebot": "HA-{jahr}-{nr3}",
  "zeit_honorar.angebot_gueltigkeit": 30,
  "buchhaltung.nebenkosten_prozent": 5,
  "buchhaltung.ust_satz": 19,
};
const wert = (id) => REGELN[id] ?? null;
const PROJEKT = { id: "p1", name: "Projekt Eins", client: "Bauherrschaft  B", estimated_cost: 900000 };

test("neuesAngebot: Nummer, Gültigkeit, Nebenkosten/USt aus 79, Zahlungsziel-Kette, nur 79-Feldnamen", () => {
  const a = neuesAngebot(PROJEKT, wert, [{ nummer: "HA-2026-001" }, { nummer: "RE-2026-014" }], { heuteIso: "2026-09-28" });
  assert.equal(a.nummer, "HA-2026-002");
  assert.equal(a.gueltig_bis, "2026-10-28");
  assert.equal(a.nebenkosten_prozent, 5);
  assert.equal(a.ust_satz, 19);
  assert.equal(a.zahlungsziel_tage, 14);
  assert.equal(a.zahlungsziel_vertraglich, true);
  assert.deepEqual(a.lph, lphFuerLeistungsbild("gebaeude"));
  assert.equal(a.kg300_euro, 900000, "Vorschlag aus estimated_cost");
  assert.equal(a.status, "entwurf");
  for (const f of VERTRAGSFELDER) assert.ok(f in a, `${f} fehlt`);
  for (const alt of ["kg300", "zone", "satz_position", "umbau_prozent", "pauschal_netto", "bauherr"]) assert.ok(!(alt in a), `alter Feldname ${alt}`);
  // Payment term per client (79 settings map, key = normalised project client).
  const je = neuesAngebot(PROJEKT, wert, [], { heuteIso: "2026-09-28", einstBuchhaltung: { zahlungsziel_tage: 14, zahlungsziel_je_bauherr: { "bauherrschaft b": 45 } } });
  assert.equal(je.zahlungsziel_tage, 45);
  // Renovation: 20 % conversion surcharge proposed.
  assert.equal(neuesAngebot({ ...PROJEKT, build_kind: "sanierung" }, wert, [], { heuteIso: "2026-09-28" }).umbauzuschlag_prozent, 20);
});

test("aendern: nur im Entwurf; Leistungsbild-Wechsel baut lph neu auf (H-2)", () => {
  const a = neuesAngebot(PROJEKT, wert, [], { heuteIso: "2026-09-28" });
  const r = aendern(a, { leistungsbild: "tragwerksplanung" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.angebot.lph.length, 6);
  assert.deepEqual(r.ok && r.angebot.lph.map((l) => l.prozent), [3, 10, 15, 30, 40, 2]);
  assert.deepEqual(aendern({ ...a, status: "versendet" }, { honorarzone: "IV" }), { ok: false, fehler: "unveraenderlich" });
});

test("neueFassung, versenden ersetzt die anderen offenen Fassungen", () => {
  const lph18 = lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 8 }));
  const v1 = { ...neuesAngebot(PROJEKT, wert, [], { heuteIso: "2026-09-01" }), id: "v1", kg300_euro: 900000, kg400_euro: 400000, honorarzone: "III", lph: lph18, status: "versendet" };
  const v2Entwurf = neueFassung(v1, [v1], { heuteIso: "2026-09-28" });
  assert.equal(v2Entwurf.fassung, 2);
  assert.equal(v2Entwurf.ersetzt_id, "v1");
  assert.equal(v2Entwurf.status, "entwurf");
  assert.ok(!("id" in v2Entwurf));
  assert.equal(v2Entwurf.gueltig_bis, "2026-10-28", "Gültigkeitslänge bleibt");
  const v2 = { ...v2Entwurf, id: "v2" };
  const r = versenden(v2, [v1, v2], { heuteIso: "2026-09-28" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.angebot.status, "versendet");
  assert.equal(r.ok && r.angebot.summen.netto, 140999.05);
  assert.deepEqual(r.ok && r.ersetzte.map((x) => [x.id, x.status]), [["v1", "ersetzt"]]);
  assert.deepEqual(versenden(v1, [v1], { heuteIso: "2026-09-28" }), { ok: false, fehler: "status" });
});

test("versenden ohne Betrag: Tafel fehlt (Injektion) bzw. außerhalb der Tafel", () => {
  const tw = WEITERE_TAFELN.find((t) => t.leistungsbild === "tragwerksplanung");
  const e = { id: "e", nummer: "HA-2026-009", status: "entwurf", leistungsbild: "tragwerksplanung", bezugswert: 1000000, honorarzone: "III", satz_position_prozent: 0, lph: lphFuerLeistungsbild("tragwerksplanung"), nebenkosten_prozent: 5, ust_satz: 19 };
  assert.deepEqual(versenden(e, [e], { heuteIso: "2026-09-28", optionen: { weitere: [{ ...tw, annahme: true }] } }), { ok: false, fehler: "tafel_fehlt" });
  const mitPauschale = versenden({ ...e, pauschal_euro: 12000 }, [e], { heuteIso: "2026-09-28", optionen: { weitere: [{ ...tw, annahme: true }] } });
  assert.equal(mitPauschale.ok, true);
  const frei = { ...e, leistungsbild: "gebaeude", kg300_euro: 10000, kg400_euro: 0, sonstige_euro: 0, lph: lphFuerLeistungsbild("gebaeude") };
  assert.deepEqual(versenden(frei, [frei], { heuteIso: "2026-09-28" }), { ok: false, fehler: "frei" });
});

test("effektiverStatus zeigt „abgelaufen“, gespeichert bleibt „versendet“; Fristen für 82", () => {
  const a = { id: "a", nummer: "HA-2026-003", project_id: "p1", status: "versendet", gueltig_bis: "2026-10-09" };
  assert.equal(effektiverStatus(a, "2026-10-10"), "abgelaufen");
  assert.equal(effektiverStatus(a, "2026-10-09"), "versendet");
  assert.equal(a.status, "versendet");
  assert.deepEqual(angebotsFristen([a, { ...a, id: "b", status: "entwurf" }], "2026-09-28"), [
    { quelle: "honorarangebot", art: "angebot_laeuft_ab", datum: "2026-10-09", objekt: "HA-2026-003", project_id: "p1", ziel: "/Fees?tab=offers" },
  ]);
});
