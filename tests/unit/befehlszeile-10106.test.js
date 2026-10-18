// 101-06: the command line says which command runs and what the next input expects, step by step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { befehlsAufforderung } from "@core/lib/befehlszeile.js";

test("Linie: erster Punkt → nächster Punkt → schließen", () => {
  assert.deepEqual(befehlsAufforderung("linie", { punkte: [] }), { befehl: "Linie", aufforderung: "Ersten Punkt klicken" });
  assert.match(befehlsAufforderung("linie", { punkte: [1] }).aufforderung, /Länge tippen/);
  assert.match(befehlsAufforderung("linie", { punkte: [1, 2, 3] }).aufforderung, /Fläche schließen/);
});

test("Verschieben: Körper → Basispunkt → Ziel; ohne Werkzeug: Kürzel-Hinweis", () => {
  assert.equal(befehlsAufforderung("verschieben", {}).aufforderung, "Körper anklicken");
  assert.equal(befehlsAufforderung("verschieben", { auswahl: ["k1"] }).aufforderung, "Basispunkt klicken");
  assert.match(befehlsAufforderung("verschieben", { auswahl: ["k1"], start: { x: 0, y: 0 } }).aufforderung, /Strg = Kopie/);
  const leer = befehlsAufforderung(null);
  assert.equal(leer.befehl, "Bereit");
  assert.match(leer.aufforderung, /L Linie/);
  assert.match(befehlsAufforderung("riegel", { punkte: [1, 2] }).aufforderung, /Enter = Riegel/);
});

test("Baufeld-Planung: Polygon schrittweise, Auswahl mit/ohne Auswahl", async () => {
  const { baufeldAufforderung } = await import("@core/lib/befehlszeile.js");
  assert.equal(baufeldAufforderung("polygon", { entwurf: 0 }).aufforderung, "Ersten Stützpunkt klicken");
  assert.match(baufeldAufforderung("polygon", { entwurf: 3 }).aufforderung, /schließen/);
  assert.match(baufeldAufforderung("auswahl", { gewaehlt: 2 }).aufforderung, /Strg = Kopie/);
  assert.match(baufeldAufforderung("auswahl", { karte: true }).aufforderung, /Leertaste/);
  assert.equal(baufeldAufforderung("building").befehl, "Baukörper");
});
