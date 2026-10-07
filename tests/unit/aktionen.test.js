// Unit tests for packages/nova-core/src/lib/aktionen.js (Phase 69-12 Task 1).
// Plan requirements (≥ 8 tests): register/unregister, view filter,
// aktiv=false hidden, shortcut parser, two actions with the same shortcut in
// one view → throw naming both ids. Run:
//   node --test --import ./tests/alias-register.mjs tests/unit/aktionen.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  registriereAktionen,
  aktionenFuer,
  parseKuerzel,
  passtKuerzel,
  kuerzelText,
  abonnieren,
} from "@core/lib/aktionen";

// Minimal action factory — never name it `it` (node:test collision, 75-09 lesson).
const aktion = (id, extra = {}) => ({
  id,
  titel: id,
  ausfuehren: () => {},
  ...extra,
});

// Minimal KeyboardEvent-ish object for passtKuerzel.
const ev = (key, { ctrl = false, meta = false, shift = false, alt = false } = {}) => ({
  key,
  ctrlKey: ctrl,
  metaKey: meta,
  shiftKey: shift,
  altKey: alt,
});

describe("aktionen.js — Registrierung", () => {
  test("registriereAktionen liefert Abmelde-Funktion; Aktionen sind danach sichtbar", () => {
    const ab = registriereAktionen("/Test-A", [aktion("a1"), aktion("a2")]);
    assert.equal(typeof ab, "function");
    assert.deepEqual(
      aktionenFuer("/Test-A").map((a) => a.id),
      ["a1", "a2"],
    );
    ab();
  });

  test("Abmeldung entfernt genau den eigenen Block (zweiter Block bleibt)", () => {
    const ab1 = registriereAktionen("/Test-B", [aktion("b1")]);
    const ab2 = registriereAktionen("/Test-B", [aktion("b2")]);
    ab1();
    assert.deepEqual(
      aktionenFuer("/Test-B").map((a) => a.id),
      ["b2"],
    );
    ab2();
    assert.deepEqual(aktionenFuer("/Test-B"), []);
  });

  test("Ansicht-Filter: Aktionen einer Route sind in einer anderen unsichtbar", () => {
    const ab = registriereAktionen("/Test-C", [aktion("c1")]);
    assert.equal(aktionenFuer("/Test-C").length, 1);
    assert.deepEqual(aktionenFuer("/Test-D"), []);
    ab();
  });

  test("aktiv=false wird ausgeblendet, aktiv=true und ohne Flag bleiben sichtbar", () => {
    const ab = registriereAktionen("/Test-E", [
      aktion("e-an", { aktiv: true }),
      aktion("e-aus", { aktiv: false }),
      aktion("e-default"),
    ]);
    assert.deepEqual(
      aktionenFuer("/Test-E").map((a) => a.id),
      ["e-an", "e-default"],
    );
    ab();
  });

  test("abonnieren wird bei Registrierung UND Abmeldung benachrichtigt", () => {
    let n = 0;
    const abo = abonnieren(() => {
      n += 1;
    });
    const ab = registriereAktionen("/Test-F", [aktion("f1")]);
    assert.equal(n, 1, "Registrierung → 1 Benachrichtigung");
    ab();
    assert.equal(n, 2, "Abmeldung → 2. Benachrichtigung");
    abo();
    registriereAktionen("/Test-F", [aktion("f2")])();
    assert.equal(n, 2, "nach abo() keine weitere Benachrichtigung");
  });
});

describe("aktionen.js — Kürzel-Parser", () => {
  test("parseKuerzel zerlegt mod/shift/alt/Taste, Reihenfolge frei", () => {
    assert.deepEqual(parseKuerzel("mod+shift+p"), { mod: true, shift: true, alt: false, key: "p" });
    assert.deepEqual(parseKuerzel("Shift+MOD+P"), { mod: true, shift: true, alt: false, key: "p" });
    assert.deepEqual(parseKuerzel("alt+k"), { mod: false, shift: false, alt: true, key: "k" });
    assert.deepEqual(parseKuerzel("p"), { mod: false, shift: false, alt: false, key: "p" });
  });

  test("parseKuerzel wirft bei unbekanntem Bestandteil und bei fehlender Taste", () => {
    assert.throws(() => parseKuerzel("super+p"), /unbekannter Bestandteil/i);
    assert.throws(() => parseKuerzel("mod+shift"), /keine Taste/i);
  });

  test("kuerzelText normalisiert — gleiche Chorde, andere Reihenfolge, gleicher Text", () => {
    assert.equal(kuerzelText(parseKuerzel("shift+mod+p")), kuerzelText(parseKuerzel("mod+shift+p")));
    assert.equal(kuerzelText(parseKuerzel("mod+p")), "mod+p");
  });

  test("passtKuerzel: exakte Modifikator-Passung, kein Treffer bei Zusatz-Modifikator", () => {
    const k = parseKuerzel("mod+shift+p");
    assert.equal(passtKuerzel(ev("p", { ctrl: true, shift: true }), k), true);
    assert.equal(passtKuerzel(ev("P", { ctrl: true, shift: true }), k), true, "Groß/klein egal");
    assert.equal(passtKuerzel(ev("p", { meta: true, shift: true }), k), true, "⌘ zählt als mod");
    assert.equal(passtKuerzel(ev("p", { ctrl: true }), k), false, "shift fehlt");
    assert.equal(passtKuerzel(ev("p", { ctrl: true, shift: true, alt: true }), k), false, "alt zu viel");
    const nackt = parseKuerzel("p");
    assert.equal(passtKuerzel(ev("p"), nackt), true);
    assert.equal(passtKuerzel(ev("p", { ctrl: true }), nackt), false, "Ctrl+P gehört dem Browser");
  });
});

describe("aktionen.js — Kürzel-Konflikt", () => {
  test("zwei gleiche Kürzel in einer Ansicht → throw mit beiden IDs im Text", () => {
    const ab = registriereAktionen("/Test-G", [aktion("g-export", { kuerzel: "mod+shift+p" })]);
    assert.throws(
      () => registriereAktionen("/Test-G", [aktion("g-pdf", { kuerzel: "mod+shift+p" })]),
      (err) => {
        assert.match(err.message, /g-export/);
        assert.match(err.message, /g-pdf/);
        return true;
      },
    );
    ab();
  });

  test("Konflikt wird über Reihenfolge-Faltung erkannt (shift+mod+p vs mod+shift+p)", () => {
    const ab = registriereAktionen("/Test-H", [aktion("h1", { kuerzel: "mod+shift+p" })]);
    assert.throws(() => registriereAktionen("/Test-H", [aktion("h2", { kuerzel: "shift+mod+p" })]), /Kürzel-Konflikt/);
    ab();
  });

  test("gleiches Kürzel in ANDERER Ansicht ist erlaubt; nach Abmeldung ist das Kürzel wieder frei", () => {
    const ab1 = registriereAktionen("/Test-I1", [aktion("i1", { kuerzel: "mod+b" })]);
    const ab2 = registriereAktionen("/Test-I2", [aktion("i2", { kuerzel: "mod+b" })]); // kein Throw
    assert.equal(aktionenFuer("/Test-I2").length, 1);
    ab1();
    const ab3 = registriereAktionen("/Test-I1", [aktion("i3", { kuerzel: "mod+b" })]); // wieder frei
    assert.equal(aktionenFuer("/Test-I1")[0].id, "i3");
    ab2();
    ab3();
  });
});
