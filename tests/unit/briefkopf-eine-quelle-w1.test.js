// Wave 1 "buero" (B-81-05 / BEFUNDE-82 M-2): ONE letterhead module and ONE
// read path for the office name.
//
// Before: two modules (@core/lib/briefkopf.js of 80-03 and
// @core/lib/brief/briefkopf.js of 79-03) with two copies of the defaults and
// two normalisation rules, three components that read Setting{key:"briefkopf"}
// raw past useBriefkopf (one with the retired English subtitle as default),
// and a dunning letter whose sender line ignored the legacy accounting name
// that the invoice of the same claim prints (bueroName.js, 94-02).
//
// In:  @core/lib/briefkopf.js, src/lib/accounting/mahnwesen.js, the source tree.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as briefkopfKern from "@core/lib/briefkopf.js";
import * as briefkopfBrief from "@core/lib/briefkopfBrief.js";

// The letter helpers sit beside the core module (size budget of the entry chunk), built only on it.
const briefkopfModul = { ...briefkopfKern, ...briefkopfBrief };
import { mahnTextFelder } from "@/lib/accounting/mahnwesen.js";
import { bueroNameAus } from "@/lib/accounting/bueroName.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {string} ordner @returns {string[]} source files (js/jsx) below `ordner`, relative to the repo root */
function quellen(ordner) {
  /** @type {string[]} */
  const aus = [];
  const gehe = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(path.join(WURZEL, d), { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const rel = path.join(d, e.name);
      if (e.isDirectory()) gehe(rel);
      else if (/\.(js|jsx|mjs)$/.test(e.name)) aus.push(rel);
    }
  };
  gehe(ordner);
  return aus;
}

const t = (/** @type {string} */ s) => s;

test("one letterhead module: the 79-03 copy is gone and nothing imports it", () => {
  assert.equal(fs.existsSync(path.join(WURZEL, "packages/nova-core/src/lib/brief/briefkopf.js")), false,
    "packages/nova-core/src/lib/brief/briefkopf.js must not exist next to @core/lib/briefkopf.js");
  const treffer = [...quellen("src"), ...quellen("packages"), ...quellen("tests/unit")]
    .filter((f) => !f.endsWith("briefkopf-eine-quelle-w1.test.js"))
    .filter((f) => /brief\/briefkopf(\.js)?["']/.test(fs.readFileSync(path.join(WURZEL, f), "utf8")));
  assert.deepEqual(treffer, [], "no import of brief/briefkopf");
});

test("briefkopfZeilen is built on @core/lib/briefkopf.js and normalises like the settings editor", () => {
  assert.equal(typeof briefkopfModul.briefkopfZeilen, "function", "briefkopfZeilen exported by @core/lib/briefkopfBrief.js");
  const zeilen = /** @type {any} */ (briefkopfModul).briefkopfZeilen;
  assert.deepEqual(zeilen(null), ["Architekturbüro"]);
  assert.deepEqual(zeilen({ office: "Testbüro", address: "Musterstraße 1\n 12345 Musterstadt \n" }), ["Testbüro", "Musterstraße 1", "12345 Musterstadt"]);
  // Idempotent on an already normalised letterhead (useBriefkopf hands that out).
  const normal = briefkopfModul.normalisiereBriefkopf({ office: "Testbüro", address: "A" });
  assert.deepEqual(zeilen(normal), zeilen({ office: "Testbüro", address: "A" }));
});

test("no component reads Setting{key:\"briefkopf\"} past useBriefkopf", () => {
  const treffer = [...quellen("src"), ...quellen("packages")]
    .filter((f) => /Setting\.filter\(\{\s*key:\s*["']briefkopf["']/.test(fs.readFileSync(path.join(WURZEL, f), "utf8")));
  assert.deepEqual(treffer, [], "raw letterhead reads left");
});

test("dunning letter names the same office as the invoice (letterhead > legacy accounting name)", () => {
  const rechnung = { nummer: "R-1", rechnungsdatum: "2026-01-10", brutto: 100, empfaenger: { name: "Empfänger" } };
  const einst = { buero: { name: "Büro Alt" } };
  const briefkopf = { office: "Architekturbüro", address: "Musterstraße 1" };
  const felder = mahnTextFelder(rechnung, 1, { heute: "2026-03-01", einst, briefkopf }, t);
  assert.equal(felder.absenderZeilen[0], bueroNameAus(briefkopf, einst), "sender = the invoice's seller name");
  assert.deepEqual(felder.absenderZeilen, ["Büro Alt", "Musterstraße 1"]);
  // A real letterhead name always wins over the legacy field.
  const eigen = mahnTextFelder(rechnung, 1, { heute: "2026-03-01", einst, briefkopf: { office: "Testbüro" } }, t);
  assert.deepEqual(eigen.absenderZeilen, ["Testbüro"]);
});

// W1-BUERO-F2: the correspondence letter took the letterhead alone — an office whose name lives only in
// the legacy accounting field got "Architekturbüro" as sender, while its dunning letter and invoice named it.
test("correspondence letter falls back to the legacy accounting name like the dunning letter (one function)", async () => {
  const { briefModell } = await import("@core/lib/brief/schreiben.js");
  assert.equal(typeof briefkopfModul.briefkopfFuerBrief, "function", "briefkopfFuerBrief exported by @core/lib/briefkopfBrief.js");
  const bk = briefkopfModul.briefkopfFuerBrief({ address: "Straße 1\n12345 Ort" }, "  Büro Alt ");
  const modell = briefModell({ betreff: "B", text: "x" }, { briefkopf: bk, datumText: "" });
  assert.deepEqual(modell.absender, ["Büro Alt", "Straße 1", "12345 Ort"]);
  assert.match(modell.fusszeileLinks, /^Büro Alt · /);
  // The letterhead's own name wins; with neither, the stored placeholder stays as the sender line.
  assert.equal(briefkopfModul.briefkopfFuerBrief({ office: "Eigenes Büro" }, "Büro Alt").office, "Eigenes Büro");
  assert.equal(briefkopfModul.briefkopfFuerBrief({}, "").office, briefkopfModul.DEFAULT_BRIEFKOPF.office);
  // One function: the dunning letter and the correspondence page both go through it.
  const mahn = fs.readFileSync(path.join(WURZEL, "src/lib/accounting/mahnwesen.js"), "utf8");
  const seite = fs.readFileSync(path.join(WURZEL, "src/pages/Correspondence.jsx"), "utf8");
  assert.match(mahn, /briefkopfFuerBrief\(/, "mahnwesen.js uses briefkopfFuerBrief");
  assert.match(seite, /briefkopfFuerBrief\(/, "Correspondence.jsx uses briefkopfFuerBrief");
});
