// Phase 81 (81-01): status tables of the fee chain and the commissioning stages
// of an architect's contract (src/lib/honorar/vertragsdaten.js).
//
// In:  the module, 79's lphFuerLeistungsbild. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANGEBOT_STATUS, beauftragteStufenLph, NACHTRAG_STATUS, statusErlaubt, stufeSetztLph, VERTRAG_STATUS } from "@/lib/honorar/vertragsdaten.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";

test("Statustabellen: erlaubte Wege und Endzustände", () => {
  assert.equal(statusErlaubt(ANGEBOT_STATUS, "versendet", "entwurf"), false, "versendet ist unveränderlich");
  assert.equal(statusErlaubt(ANGEBOT_STATUS, "entwurf", "versendet"), true);
  assert.equal(statusErlaubt(ANGEBOT_STATUS, "versendet", "angenommen"), true);
  assert.equal(statusErlaubt(VERTRAG_STATUS, "entwurf", "beauftragt"), true);
  assert.equal(statusErlaubt(VERTRAG_STATUS, "abgeschlossen", "beauftragt"), false);
  for (const ende of ["beauftragt", "abgelehnt"]) assert.deepEqual([...NACHTRAG_STATUS[ende].naechste], [], ende);
  assert.equal(statusErlaubt(NACHTRAG_STATUS, "unbekannt", "beauftragt"), false);
  for (const t of [ANGEBOT_STATUS, VERTRAG_STATUS, NACHTRAG_STATUS]) {
    for (const [k, v] of Object.entries(t)) {
      assert.ok(v.label, k);
      for (const n of v.naechste) assert.ok(n in t, `${k} → ${n}`);
    }
  }
});

test("stufeSetztLph: Stufe 2 beauftragt LPH 5–8, übrige Felder unverändert", () => {
  const lph = lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 4 }));
  const vertrag = {
    id: "hv", leistungsbild: "gebaeude", honorarzone: "III", lph,
    stufen: [{ nr: 1, lph: [1, 2, 3, 4], beauftragt_am: "2025-03-01" }, { nr: 2, lph: [5, 6, 7, 8], beauftragt_am: null }],
  };
  assert.deepEqual(beauftragteStufenLph(vertrag), [1, 2, 3, 4]);
  const neu = stufeSetztLph(vertrag, 2, "2026-02-01");
  assert.deepEqual(neu.lph.map((l) => l.beauftragt), [true, true, true, true, true, true, true, true, false]);
  assert.deepEqual(neu.lph.map((l) => l.prozent), lph.map((l) => l.prozent), "Prozente bleiben");
  assert.equal(neu.stufen[1].beauftragt_am, "2026-02-01");
  assert.equal(neu.stufen[0].beauftragt_am, "2025-03-01");
  assert.equal(neu.honorarzone, "III");
  assert.deepEqual(beauftragteStufenLph(neu), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(vertrag.lph[4].beauftragt, false, "Eingabe unverändert");
  assert.equal(stufeSetztLph(vertrag, 9, "2026-02-01"), vertrag, "unbekannte Stufe");
});

test("beauftragteStufenLph: ohne Stufen die beauftragt-Flags von 79", () => {
  const lph = lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i === 0 || i === 2 }));
  assert.deepEqual(beauftragteStufenLph({ lph }), [1, 3]);
  assert.deepEqual(beauftragteStufenLph(null), []);
});
