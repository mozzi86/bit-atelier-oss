// Unit-Tests für scripts/sw-modi.mjs (Phase 70-01, seit 83-02 nur noch `lokal`).
//
// Warum das eine Prüfung wert ist: bis 83-02 waren Demo und Client zwei
// installierbare Apps auf derselben Domain. Teilen sich zwei Modi Cache-Namen,
// Basispfad oder Manifest, überschreibt einer den anderen — und im
// Schwesterprojekt BIT-Nova PDF hat genau ein stehengebliebener Cache-Name sechs
// Releases lang alle installierten PWAs eingefroren. Die Regeln bleiben als
// Wächter stehen, falls wieder ein zweiter Modus dazukommt.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MODI, modusPruefen } from "../../scripts/sw-modi.mjs";

describe("sw-modi — die Tabelle", () => {
  it("kennt genau den serverlosen Modus lokal (Demo entfernt, 83-02)", () => {
    assert.deepEqual(Object.keys(MODI).sort(), ["lokal"]);
  });

  it("trennt Ziel, Basis, Cache und Manifest zwischen den Modi", () => {
    for (const feld of ["ziel", "basis", "cache", "manifest"]) {
      const werte = Object.values(MODI).map((m) => m[feld]);
      assert.equal(new Set(werte).size, werte.length, `Feld "${feld}" ist in zwei Modi gleich`);
    }
  });

  it("jeder Basispfad beginnt und endet mit einem Schrägstrich", () => {
    for (const [name, m] of Object.entries(MODI)) {
      assert.match(m.basis, /^\/.*\/$/, `Basis von ${name} ist kein Ordnerpfad: ${m.basis}`);
    }
  });

  it("kein Cache-Präfix ist Präfix eines anderen — sonst löscht activate() den fremden Cache", () => {
    const praefixe = Object.values(MODI).map((m) => `${m.cache}-`);
    for (const a of praefixe) {
      for (const b of praefixe) {
        if (a !== b) assert.equal(a.startsWith(b), false, `${a} beginnt mit ${b}`);
      }
    }
  });

  it("jedes Manifest heißt .webmanifest", () => {
    for (const m of Object.values(MODI)) assert.match(m.manifest, /\.webmanifest$/);
  });
});

describe("modusPruefen", () => {
  it("liefert den Eintrag für einen bekannten Modus", () => {
    assert.equal(modusPruefen("lokal").ziel, "dist-lokal");
    assert.equal(modusPruefen("lokal").basis, "/app/");
  });

  it("der entfernte Demo-Modus ist unbekannt", () => {
    assert.throws(() => modusPruefen("demo"), /Unbekannter Modus/);
  });

  it("wirft mit den erlaubten Namen im Text — der Bau-Befehl soll sagen, was geht", () => {
    assert.throws(() => modusPruefen("quatsch"), (fehler) => {
      assert.match(fehler.message, /quatsch/);
      assert.match(fehler.message, /lokal/);
      return true;
    });
  });

  it("wirft auch bei leerem Namen und bei Object-Eigenschaften", () => {
    for (const name of ["", "toString", "constructor"]) {
      assert.throws(() => modusPruefen(name), new RegExp("Unbekannter Modus"));
    }
  });
});
