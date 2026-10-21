// 104-03: one command register — register, list with "aktiv", find, run without throwing, JSON-line protocol.
import { test } from "node:test";
import assert from "node:assert/strict";
import { befehlsRegister } from "@core/lib/befehlsregister.js";

function beispiel() {
  const r = befehlsRegister();
  const log = [];
  r.registrieren({ id: "linie", label: "Linie", taste: "L", kurz: ["l"], ausfuehren: () => log.push("linie") });
  r.registrieren({ id: "loeschen", label: "Löschen", taste: "Entf", aktiv: (ctx) => ctx?.auswahl > 0, ausfuehren: (_p, ctx) => ctx.auswahl });
  r.registrieren({ id: "eingabe", label: "Eingabe", parameter: { text: "text" }, ausfuehren: (p) => { if (!p.text) throw new Error("Text fehlt"); return p.text.length; } });
  return { r, log };
}

test("registrieren, Liste mit aktiv, finden, entfernen", () => {
  const { r } = beispiel();
  assert.deepEqual(r.alle({ auswahl: 0 }).map((b) => `${b.id}:${b.aktiv}`), ["linie:true", "loeschen:false", "eingabe:true"]);
  assert.deepEqual(r.finden("l"), { id: "linie" });
  assert.deepEqual(r.finden("lö"), { id: "loeschen" });
  const weg = r.registrieren({ id: "x", label: "X", ausfuehren: () => 1 });
  weg();
  assert.equal(r.holen("x"), null);
  assert.throws(() => r.registrieren(/** @type {any} */ ({ id: "" })), /id und ausfuehren/);
});

test("ausfuehren wirft nie: unbekannt, nicht aktiv, Fehler im Befehl, Ergebnis", () => {
  const { r, log } = beispiel();
  assert.deepEqual(r.ausfuehren("linie"), { ok: true, result: 1 });
  assert.deepEqual(log, ["linie"]);
  assert.deepEqual(r.ausfuehren("gibtsnicht"), { ok: false, error: "Befehl unbekannt: gibtsnicht" });
  assert.equal(r.ausfuehren("loeschen", {}, { auswahl: 0 }).ok, false);
  assert.deepEqual(r.ausfuehren("loeschen", {}, { auswahl: 2 }), { ok: true, result: 2 });
  assert.deepEqual(r.ausfuehren("eingabe", {}), { ok: false, error: "Text fehlt" });
  assert.deepEqual(r.ausfuehren("eingabe", { text: "@3;4" }), { ok: true, result: 4 });
});

test("JSON-Zeilen-Protokoll", () => {
  const { r } = beispiel();
  assert.deepEqual(JSON.parse(r.zeileBearbeiten('{"id":7,"method":"ausfuehren","params":{"befehl":"eingabe","params":{"text":"ab"}}}')), { id: 7, ok: true, result: 2 });
  assert.equal(JSON.parse(r.zeileBearbeiten('{"id":1,"method":"befehle"}')).result.length, 3);
  assert.deepEqual(JSON.parse(r.zeileBearbeiten('{"id":2,"method":"finden","params":{"text":"lin"}}')).result, { id: "linie" });
  assert.deepEqual(JSON.parse(r.zeileBearbeiten("kein json")), { id: null, ok: false, error: "Kein gültiges JSON" });
  assert.equal(JSON.parse(r.zeileBearbeiten('{"id":3,"method":"loeschenAlles"}')).ok, false);
});
