// 70-02: local profile of the desktop client — the pure check that mirrors
// client/src-tauri/src/profil.rs::pruefen, and the shell switch outside Tauri.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { profilPruefen, istAbsoluterPfad, PROFIL_MAX_TEXT, profilLesen } from "../../src/client/profil.js";
import { inHuelle } from "../../src/client/huelle.js";

describe("70-02 client profile", () => {
  it("requires a name, office is optional", () => {
    assert.equal(profilPruefen({ name: "   ", buero: "x" }), "Der Name fehlt.");
    assert.equal(profilPruefen(null), "Der Name fehlt.");
    assert.equal(profilPruefen({ name: "A. Muster", buero: "" }), null);
  });

  it("limits name and office to PROFIL_MAX_TEXT characters (counted as code points)", () => {
    assert.equal(profilPruefen({ name: "ä".repeat(PROFIL_MAX_TEXT), buero: "" }), null);
    assert.match(profilPruefen({ name: "a", buero: "b".repeat(PROFIL_MAX_TEXT + 1) }), /höchstens 200/);
  });

  it("accepts only absolute storage locations", () => {
    assert.equal(profilPruefen({ name: "A", ablageort: null }), null);
    assert.equal(profilPruefen({ name: "A", ablageort: "C:\\Daten\\BIT" }), null);
    assert.match(profilPruefen({ name: "A", ablageort: "daten/bit" }), /vollständiger Pfad/);
  });

  it("recognises Windows drive, UNC and POSIX paths", () => {
    assert.equal(istAbsoluterPfad("D:/Projekte"), true);
    assert.equal(istAbsoluterPfad("\\\\server\\freigabe\\bit"), true);
    assert.equal(istAbsoluterPfad("/home/user/bit"), true);
    assert.equal(istAbsoluterPfad("C:relativ"), false);
    assert.equal(istAbsoluterPfad("..\\bit"), false);
  });

  it("is not in the shell under node, and shell commands refuse in plain text", async () => {
    assert.equal(inHuelle(), false);
    await assert.rejects(profilLesen(), /nur im Desktop-Client/);
  });
});
