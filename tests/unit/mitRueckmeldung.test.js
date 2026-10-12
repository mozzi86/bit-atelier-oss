// Phase 81 (81-01): the NA-13 wrapper @core/lib/mitRueckmeldung.js — success
// toast, plain-text failure, never thrown. In: the module with an injected toast.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";

test("mitRueckmeldung: Erfolg mit Toast, Fehler im Klartext ohne Wurf", async () => {
  const meldungen = [];
  const toast = { success: (s) => meldungen.push(["ok", s]), error: (s) => meldungen.push(["fehler", s]) };
  assert.deepEqual(await mitRueckmeldung(async () => 42, { erfolg: "Gespeichert", toast }), { ok: true, wert: 42 });
  const alt = console.error;
  console.error = () => {};
  try {
    const r = await mitRueckmeldung(async () => { throw new Error("Platte voll"); }, { fehler: "Speichern fehlgeschlagen", toast });
    assert.deepEqual(r, { ok: false, fehler: "Platte voll" });
    const r2 = await mitRueckmeldung(() => { throw "roh"; }, { toast });
    assert.deepEqual(r2, { ok: false, fehler: "roh" });
  } finally {
    console.error = alt;
  }
  assert.deepEqual(meldungen, [["ok", "Gespeichert"], ["fehler", "Speichern fehlgeschlagen: Platte voll"], ["fehler", "roh"]]);
});
