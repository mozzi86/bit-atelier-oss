// 82-05 Task 2: general letter types next to the fee builders of 81, office version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIEFARTEN, HONORAR_BRIEFE, alleVorlagen, mitBueroFassung } from "@core/lib/brief/vorlagen.js";
import { platzhalterIn } from "@core/lib/brief/platzhalter.js";
import { erlaubt } from "@core/lib/brief/platzhalterKatalog.js";
import { istWinAnsi } from "@core/lib/brief/winAnsi.js";

/** Text with balanced placeholders only (projektneutral.test.js scans all sources for real names). */
const PLATZHALTER_ERLAUBT = /^[^{}]*(\{\{[^{}]+\}\}[^{}]*)*$/;

test("alleVorlagen: drei 81-Bauer unverändert plus sieben Briefarten (82, 88-02 Behinderungsanzeige, N-9 Büro-Fassung an den Bauherrn)", () => {
  const keys = alleVorlagen().map((v) => v.key);
  assert.deepEqual(keys, ["honorarangebot", "auftragsbestaetigung", "honorarnachtrag", "brief", "antwort", "anschreiben_honorarangebot", "protokoll", "behinderungsanzeige", "behinderung_bauherr", "mahnung"]);
  for (const v of alleVorlagen().filter((x) => x.quelle === "81")) {
    assert.equal(v.version, HONORAR_BRIEFE[/** @type {keyof typeof HONORAR_BRIEFE} */ (v.key)].version);
    assert.equal(typeof /** @type {any} */ (v).bauen, "function");
    assert.equal(v.richtwert, true);
  }
  assert.equal(BRIEFARTEN.mahnung.quelle, "79");
  assert.equal(BRIEFARTEN.mahnung.textAus79, true);
  assert.equal(BRIEFARTEN.mahnung.richtwert, true);
});

test("jede 82-Vorlage: Felder vollständig, Platzhalter im Katalog, Pflicht im Text oder Betreff", () => {
  for (const v of Object.values(BRIEFARTEN)) {
    for (const f of ["key", "art", "version", "betreff", "text", "anlagen", "pflichtPlatzhalter"]) assert.ok(f in v, `${v.key}.${f}`);
    const quelle = `${v.betreff}\n${v.text}\n${v.anlagen.join("\n")}`;
    for (const p of platzhalterIn(quelle)) assert.ok(erlaubt(v.art, p), `${v.key}: ${p}`);
    for (const p of v.pflichtPlatzhalter) assert.ok(platzhalterIn(`${v.betreff}\n${v.text}`).includes(p), `${v.key}: Pflicht ${p}`);
  }
});

test("82-Vorlagentexte sind cp1252-sauber und wohlgeformt", () => {
  for (const v of Object.values(BRIEFARTEN)) {
    const quelle = `${v.betreff}\n${v.text}\n${v.anlagen.join("\n")}`;
    for (const z of quelle.replace(/\n/g, "")) assert.ok(istWinAnsi(z), `${v.key}: ${JSON.stringify(z)}`);
    assert.match(quelle, PLATZHALTER_ERLAUBT, `${v.key}: unbalanced braces`);
  }
});

test("Antwort-Betreff und Protokoll mit Verteiler und TOP-Tabelle", () => {
  assert.equal(BRIEFARTEN.antwort.betreff, "Ihr Schreiben vom {{postbuch.datum|datum}} – {{postbuch.betreff}}");
  assert.equal(BRIEFARTEN.protokoll.variante, "verteiler");
  assert.ok(platzhalterIn(BRIEFARTEN.protokoll.text).includes("tabelle:tops"));
});

test("mitBueroFassung: Büro-Text gewinnt, neuerer Standard gibt einen Hinweis", () => {
  const std = BRIEFARTEN.antwort;
  assert.equal(mitBueroFassung(std, []).buero, false);
  const gleich = mitBueroFassung(std, [{ id: "bv-1", vorlage_key: "antwort", basis_version: std.version, text: "Eigener Text", betreff: "Eigener Betreff" }]);
  assert.equal(gleich.buero, true);
  assert.equal(gleich.text, "Eigener Text");
  assert.equal(gleich.betreff, "Eigener Betreff");
  assert.equal(gleich.briefvorlage_id, "bv-1");
  assert.equal(gleich.hinweis, null);
  const neuer = mitBueroFassung({ ...std, version: std.version + 1 }, [{ id: "bv-1", vorlage_key: "antwort", basis_version: std.version, text: "Eigener Text" }]);
  assert.equal(neuer.text, "Eigener Text");
  assert.equal(neuer.hinweis, "standard_aktualisiert");
  // A fee builder has no office version.
  const honorar = alleVorlagen().find((v) => v.key === "honorarangebot");
  assert.equal(mitBueroFassung(/** @type {any} */ (honorar), [{ vorlage_key: "honorarangebot", text: "x" }]).buero, false);
});
