// 94-04 (B-ABN-07): "Stand (%)" in the invoice form computes the row amount —
// fixture B of abschlag81.test.js (zone III, LPH 1–8, 284.796,97 € net).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lpZeilenNetto } from "@/lib/accounting/ausgangsrechnungen.js";
import { abschlagsVorlage } from "@core/lib/hoai/abrechnung.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { tafelStand } from "@/lib/honorar/vertrag.js";

const lph = (lb, n) => lphFuerLeistungsbild(lb).map((l, i) => ({ ...l, beauftragt: i < n }));
const B = {
  id: "hv-b", project_id: "p1", leistungsbild: "gebaeude", kg300_euro: 2399716, kg400_euro: 281000, sonstige_euro: 0,
  honorarzone: "III", satz_position_prozent: 0, lph: lph("gebaeude", 8), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
  verguetung_snapshot: { summen: { netto: 284796.97 }, tafel_stand: tafelStand("gebaeude") },
};

test("ohne Vertrag keine Rechnung (Betrag bleibt von Hand)", () => {
  assert.equal(lpZeilenNetto(null, [{ lp: 1, stand: 100 }], []), null);
});

test("Stand 100 % je Zeile = Betrag der Vorlage mit denselben Ständen", () => {
  const zeilen = [{ lp: 1, stand: 100 }, { lp: 2, stand: 100 }];
  const karte = lpZeilenNetto(B, zeilen, []);
  const vorlage = abschlagsVorlage(B, { 1: 100, 2: 100 }, []);
  assert.deepEqual(karte, Object.fromEntries(vorlage.lp_pos.map((p) => [p.lp, p.netto])));
  assert.ok(karte[1] > 0 && karte[2] > karte[1], "LP 2 (7 %) > LP 1 (2 %)");
});

test("halber Stand halbiert ungefähr, 0 % ergibt keine Zeile; schon Gestelltes wird angerechnet", () => {
  const voll = lpZeilenNetto(B, [{ lp: 2, stand: 100 }], [])[2];
  const halb = lpZeilenNetto(B, [{ lp: 2, stand: 50 }], [])[2];
  assert.ok(Math.abs(halb * 2 - voll) <= 0.01);
  assert.equal(lpZeilenNetto(B, [{ lp: 3, stand: 0 }], [])[3], undefined);
  const gestellt = [{ id: "r1", honorarvertrag_id: "hv-b", art: "abschlag", status: "gestellt", netto: 1000 }];
  assert.equal(Math.round((voll - lpZeilenNetto(B, [{ lp: 2, stand: 100 }], gestellt)[2]) * 100), 100000);
});

test("Nachtragszeilen und Stand über 100 % werden sauber behandelt", () => {
  const karte = lpZeilenNetto(B, [{ lp: null, nachtrag_id: "n1", stand: 100 }, { lp: 1, stand: 150 }], []);
  assert.equal(karte[1], lpZeilenNetto(B, [{ lp: 1, stand: 100 }], [])[1]);
});
