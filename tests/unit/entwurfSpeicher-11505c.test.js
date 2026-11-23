// 115-05c (D-115-12 "Ungespeichertes bleibt lokal"): the local storage of an unsaved draft of the building model.
// - key = person + project (bit-modell-entwurf:<benutzerId>:<projektId>): a draft of person X is never offered to person Y
//   on the same browser, and signing out deletes the drafts of the person signing out only;
// - format v1, a corrupted, foreign-version or misplaced entry is reported as such and never misread or thrown;
// - below 256 KB localStorage, above IndexedDB (browserJournal, moved from the PDF studio with its names as parameters:
//   the PDF keeps its own keys, nothing stored is renamed); a full store is REPORTED (rejects), never swallowed;
// - drafts older than 30 days are cleared.
//
// In: nothing (a fake localStorage on globalThis, no IndexedDB in node). Out: assertions only.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ENTWURF_PRAEFIX, entwurfSchluessel, entwurfLesen, entwurfSpeichern, entwurfLaden, entwurfLoeschen, entwurfeDesBenutzersLoeschen,
  entwurfeAufraeumen,
} from "@core/lib/entwurf/entwurfSpeicher.js";
import { entwurfLeer, entwurfMelden } from "@core/lib/entwurf/modellEntwurf.js";
import { browserJournal } from "@core/lib/browserJournal.js";
import { browserSpeicher, JOURNAL_PRAEFIX } from "@pdf/lib/wiederherstellung.js";

/** Map adapter (the JournalSpeicher shape). */
function mapSpeicher() {
  const m = new Map();
  return {
    m,
    lesen: async (/** @type {string} */ k) => (m.has(k) ? m.get(k) : null),
    schreiben: async (/** @type {string} */ k, /** @type {string} */ t) => { m.set(k, t); },
    loeschen: async (/** @type {string} */ k) => { m.delete(k); },
    schluessel: async () => [...m.keys()],
  };
}

/** A fake Web Storage; `voll` makes setItem throw like a full quota. */
function fakeLocalStorage({ voll = false } = {}) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (/** @type {number} */ i) => [...m.keys()][i] ?? null,
    getItem: (/** @type {string} */ k) => (m.has(k) ? m.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => {
      if (voll) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      m.set(k, String(v));
    },
    removeItem: (/** @type {string} */ k) => { m.delete(k); },
  };
}

const ZEIT = new Date("2026-11-19T10:00:00.000Z");
/** @param {string} benutzer @param {string} projekt */
const dirty = (benutzer, projekt, jetzt = ZEIT) => entwurfMelden(entwurfLeer({ benutzer, projekt, jetzt }), "bim",
  { stand: { id: "bm1", updated_date: "t1" }, basis: { customWalls: [] }, werte: { customWalls: [{ _idx: 1 }] }, felder: ["customWalls"] }, jetzt);

beforeEach(() => { delete (/** @type {any} */ (globalThis)).localStorage; });

test("key: person and project, prefix bit-modell-entwurf:", () => {
  assert.equal(ENTWURF_PRAEFIX, "bit-modell-entwurf:");
  assert.equal(entwurfSchluessel("u1", "p1"), "bit-modell-entwurf:u1:p1");
  assert.notEqual(entwurfSchluessel("u1", "p1"), entwurfSchluessel("u2", "p1"));
});

test("a draft of person X is never offered to person Y (same browser, same project)", async () => {
  const s = mapSpeicher();
  await entwurfSpeichern(s, dirty("u1", "p1"));
  assert.ok((await entwurfLaden(s, "u1", "p1")).entwurf, "X gets it back");
  const y = await entwurfLaden(s, "u2", "p1");
  assert.equal(y.entwurf, null);
  // an entry copied under Y's key that names X inside is refused as well
  s.m.set(entwurfSchluessel("u2", "p1"), s.m.get(entwurfSchluessel("u1", "p1")));
  const kopie = await entwurfLaden(s, "u2", "p1");
  assert.equal(kopie.entwurf, null);
  assert.equal(kopie.fehler, "fremd");
});

test("corrupted / other version / not an object: reported, never thrown, never misread", () => {
  assert.deepEqual(entwurfLesen("{kaputt", { benutzer: "u1", projekt: "p1" }), { entwurf: null, fehler: "kaputt" });
  assert.deepEqual(entwurfLesen(JSON.stringify({ v: 2, benutzer: "u1", projekt: "p1" }), { benutzer: "u1", projekt: "p1" }), { entwurf: null, fehler: "version" });
  assert.deepEqual(entwurfLesen("42", { benutzer: "u1", projekt: "p1" }), { entwurf: null, fehler: "kaputt" });
  assert.deepEqual(entwurfLesen(null, { benutzer: "u1", projekt: "p1" }), { entwurf: null, fehler: null });
  const ok = entwurfLesen(JSON.stringify(dirty("u1", "p1")), { benutzer: "u1", projekt: "p1" });
  assert.equal(ok.fehler, null);
  assert.equal(ok.entwurf?.aenderungen.bim.customWalls.length, 1);
});

test("a clean draft removes the entry; an unsaved one is written", async () => {
  const s = mapSpeicher();
  await entwurfSpeichern(s, dirty("u1", "p1"));
  assert.ok(s.m.has(entwurfSchluessel("u1", "p1")));
  await entwurfSpeichern(s, entwurfLeer({ benutzer: "u1", projekt: "p1", jetzt: ZEIT }));
  assert.ok(!s.m.has(entwurfSchluessel("u1", "p1")));
  await entwurfSpeichern(s, dirty("u1", "p1"));
  await entwurfLoeschen(s, "u1", "p1");
  assert.equal(s.m.size, 0);
});

test("signing out deletes the drafts of that person only (other people, the PDF journal stay)", async () => {
  const s = mapSpeicher();
  await entwurfSpeichern(s, dirty("u1", "p1"));
  await entwurfSpeichern(s, dirty("u1", "p2"));
  await entwurfSpeichern(s, dirty("u2", "p1"));
  s.m.set(`${JOURNAL_PRAEFIX}abc`, "{}");
  assert.equal(await entwurfeDesBenutzersLoeschen(s, "u1"), 2);
  assert.deepEqual([...s.m.keys()].sort(), [`${JOURNAL_PRAEFIX}abc`, entwurfSchluessel("u2", "p1")].sort());
});

test("drafts older than 30 days and unreadable entries are cleared, younger ones stay", async () => {
  const s = mapSpeicher();
  await entwurfSpeichern(s, dirty("u1", "p1", new Date("2026-10-01T10:00:00.000Z")));
  await entwurfSpeichern(s, dirty("u1", "p2", new Date("2026-11-18T10:00:00.000Z")));
  s.m.set(entwurfSchluessel("u1", "p3"), "{kaputt");
  assert.equal(await entwurfeAufraeumen(s, { jetzt: ZEIT }), 2);
  assert.deepEqual([...s.m.keys()], [entwurfSchluessel("u1", "p2")]);
});

test("browserJournal: below 256 KB in localStorage under its own prefix", async () => {
  const ls = fakeLocalStorage();
  /** @type {any} */ (globalThis).localStorage = ls;
  const j = browserJournal({ idbName: "test-db", idbStore: "s", praefix: "x-pre:" });
  await j.schreiben("x-pre:a", "klein");
  assert.equal(ls.getItem("x-pre:a"), "klein");
  assert.equal(await j.lesen("x-pre:a"), "klein");
  ls.setItem("anderes", "1");
  assert.deepEqual(await j.schluessel(), ["x-pre:a"]);
  await j.loeschen("x-pre:a");
  assert.equal(ls.getItem("x-pre:a"), null);
});

test("browserJournal: a full store is REPORTED (rejects) — localStorage full and no IndexedDB", async () => {
  /** @type {any} */ (globalThis).localStorage = fakeLocalStorage({ voll: true });
  const j = browserJournal({ idbName: "test-db", idbStore: "s", praefix: "x-pre:" });
  await assert.rejects(() => j.schreiben("x-pre:a", "klein"), /Browserspeicher/);
  await assert.rejects(() => entwurfSpeichern(j, dirty("u1", "p1")), /Browserspeicher/, "the draft store passes the refusal on");
});

test("browserJournal: above 256 KB it needs IndexedDB (none in node → reported, localStorage not filled)", async () => {
  const ls = fakeLocalStorage();
  /** @type {any} */ (globalThis).localStorage = ls;
  const j = browserJournal({ idbName: "test-db", idbStore: "s", praefix: "x-pre:" });
  await assert.rejects(() => j.schreiben("x-pre:gross", "x".repeat(300 * 1024)), /Browserspeicher/);
  assert.equal(ls.getItem("x-pre:gross"), null);
});

test("the PDF studio keeps its keys (prefix unchanged, its listing ignores model drafts)", async () => {
  const ls = fakeLocalStorage();
  /** @type {any} */ (globalThis).localStorage = ls;
  assert.equal(JOURNAL_PRAEFIX, "bit-pdfstudio-journal:");
  const pdf = browserSpeicher();
  await pdf.schreiben(`${JOURNAL_PRAEFIX}h1`, "{}");
  ls.setItem(entwurfSchluessel("u1", "p1"), "{}");
  assert.equal(ls.getItem(`${JOURNAL_PRAEFIX}h1`), "{}");
  assert.deepEqual(await pdf.schluessel(), [`${JOURNAL_PRAEFIX}h1`]);
});
