// Unit tests of the Setting core (80-01, behavior 1–3): "one row per key" over a
// key/value store without a uniqueness constraint. The Setting client is an
// in-memory fake with the semantics of demoDb (create adds id/created_date/
// updated_date, update merges the top level, filter = strict equality); the change
// events are counted through a window stub.
//
// In:  packages/nova-core/src/lib/einstellungen.js and useEinstellung.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EBENEN, EINSTELLUNG_EREIGNIS, doppelteSchluessel, neuesteZeile, upsertPlan,
} from "@core/lib/einstellungen.js";
import { leseEinstellung, loescheEinstellung, setzeEinstellung } from "@core/lib/useEinstellung.js";

/**
 * In-memory Setting client (demoDb semantics). The clock ticks one second per write,
 * so updated_date orders the rows.
 * @param {any[]} [start] initial rows
 */
function attrappe(start = []) {
  const zeilen = start.map((z) => ({ ...z }));
  let uhr = Date.UTC(2026, 8, 27, 10, 0, 0);
  let naechste = 1;
  const jetzt = () => new Date((uhr += 1000)).toISOString();
  return {
    zeilen,
    async filter(q) { return zeilen.filter((z) => Object.entries(q).every(([k, v]) => z[k] === v)).map((z) => ({ ...z })); },
    async list() { return zeilen.map((z) => ({ ...z })); },
    async create(daten) {
      const zeit = jetzt();
      const z = { id: `s${naechste++}`, created_date: zeit, updated_date: zeit, ...daten };
      zeilen.push(z);
      return { ...z };
    },
    async update(id, daten) {
      const i = zeilen.findIndex((z) => z.id === id);
      if (i < 0) throw new Error("404");
      zeilen[i] = { ...zeilen[i], ...daten, id, updated_date: jetzt() };
      return { ...zeilen[i] };
    },
    async delete(id) {
      const i = zeilen.findIndex((z) => z.id === id);
      if (i >= 0) zeilen.splice(i, 1);
    },
  };
}

/** Installs a window stub that records dispatched events; returns the list. */
function fensterStub() {
  const ereignisse = [];
  globalThis.window = /** @type {any} */ ({ dispatchEvent: (e) => { ereignisse.push(e); return true; } });
  return ereignisse;
}

test("EBENEN und Ereignisname sind fest", () => {
  assert.deepEqual([...EBENEN], ["geraet", "buero", "projekt", "build"]);
  assert.ok(Object.isFrozen(EBENEN));
  assert.equal(EINSTELLUNG_EREIGNIS, "einstellung:geaendert");
});

test("Behavior 1: neuesteZeile nimmt die jüngste updated_date, leer → null", () => {
  const r = neuesteZeile([{ id: "a", updated_date: "2026-01-01" }, { id: "b", updated_date: "2026-02-01" }]);
  assert.equal(r.zeile.id, "b");
  assert.equal(r.doppelt, 2);
  assert.deepEqual(neuesteZeile([]), { zeile: null, doppelt: 0 });
  assert.deepEqual(neuesteZeile(undefined), { zeile: null, doppelt: 0 });
  // Fallback created_date; one row → doppelt 0; tie → first in input order.
  assert.equal(neuesteZeile([{ id: "x", created_date: "2026-03-01" }, { id: "y", created_date: "2026-01-01" }]).zeile.id, "x");
  assert.deepEqual(neuesteZeile([{ id: "e" }]), { zeile: { id: "e" }, doppelt: 0 });
  assert.equal(neuesteZeile([{ id: "p", updated_date: "2026-05-05" }, { id: "q", updated_date: "2026-05-05" }]).zeile.id, "p");
});

test("Behavior 2: upsertPlan — create ohne Zeile, update auf die neueste, nur eigener Schlüssel zählt", () => {
  assert.deepEqual(upsertPlan([], "briefkopf"), { aktion: "create", id: null, doppelt: 0 });
  const zwei = [
    { id: "a", key: "briefkopf", updated_date: "2026-01-01" },
    { id: "b", key: "briefkopf", updated_date: "2026-02-01" },
    { id: "c", key: "buchhaltung", updated_date: "2026-03-01" },
  ];
  assert.deepEqual(upsertPlan(zwei, "briefkopf"), { aktion: "update", id: "b", doppelt: 2 });
  assert.deepEqual(upsertPlan(zwei, "buchhaltung"), { aktion: "update", id: "c", doppelt: 0 });
  assert.deepEqual(upsertPlan(zwei, "gibtsnicht"), { aktion: "create", id: null, doppelt: 0 });
});

test("Behavior 3: dreimal setzeEinstellung auf leerer Attrappe → 1 Zeile, 3 Ereignisse", async () => {
  const ereignisse = fensterStub();
  try {
    const db = attrappe();
    for (const office of ["Büro A", "Büro B", "Büro C"]) await setzeEinstellung("briefkopf", { office }, db);
    assert.equal(db.zeilen.length, 1, "genau eine Zeile");
    assert.deepEqual(db.zeilen[0].value, { office: "Büro C" });
    assert.equal(ereignisse.length, 3);
    for (const e of ereignisse) {
      assert.equal(e.type, EINSTELLUNG_EREIGNIS);
      assert.equal(e.detail.key, "briefkopf");
    }
  } finally {
    delete globalThis.window;
  }
});

test("Behavior 3: gleichzeitige Schreibvorgänge desselben Schlüssels legen keine Dublette an", async () => {
  const db = attrappe();
  await Promise.all([1, 2, 3].map((n) => setzeEinstellung("briefkopf", { n }, db)));
  assert.equal(db.zeilen.length, 1);
  assert.deepEqual(db.zeilen[0].value, { n: 3 });
});

test("Behavior 3: vorhandene Dubletten werden gemeldet, nie gelöscht", async () => {
  const warnungen = [];
  const warn = console.warn;
  console.warn = (m) => warnungen.push(String(m));
  try {
    const db = attrappe([
      { id: "alt", key: "briefkopf", value: { office: "Alt" }, updated_date: "2026-01-01T00:00:00.000Z" },
      { id: "neu", key: "briefkopf", value: { office: "Neu" }, updated_date: "2026-02-01T00:00:00.000Z" },
    ]);
    const r = await setzeEinstellung("briefkopf", { office: "Geschrieben" }, db);
    assert.equal(r.doppelt, 2);
    assert.equal(r.zeile.id, "neu", "die neueste Zeile wird geschrieben");
    assert.equal(db.zeilen.length, 2, "nichts gelöscht");
    assert.deepEqual(db.zeilen.find((z) => z.id === "alt").value, { office: "Alt" });
    assert.equal(warnungen.length, 1);
    assert.match(warnungen[0], /briefkopf/);
    const gelesen = await leseEinstellung("briefkopf", db);
    assert.equal(gelesen.wert.office, "Geschrieben");
    assert.equal(gelesen.doppelt, 2);
  } finally {
    console.warn = warn;
  }
});

test("Behavior 3: loescheEinstellung entfernt alle Zeilen des Schlüssels und meldet es", async () => {
  const ereignisse = fensterStub();
  try {
    const db = attrappe([
      { id: "a", key: "briefkopf", value: {} },
      { id: "b", key: "briefkopf", value: {} },
      { id: "c", key: "buchhaltung", value: { rechtsform: "gmbh" } },
    ]);
    assert.equal(await loescheEinstellung("briefkopf", db), 2);
    assert.deepEqual(db.zeilen.map((z) => z.key), ["buchhaltung"], "fremder Schlüssel bleibt");
    assert.equal(ereignisse.length, 1);
    assert.equal(ereignisse[0].detail.key, "briefkopf");
    assert.deepEqual(await leseEinstellung("briefkopf", db), { zeile: null, wert: undefined, doppelt: 0 });
  } finally {
    delete globalThis.window;
  }
});

test("Fehler der Datenschicht werden weitergeworfen, kein Ereignis", async () => {
  const ereignisse = fensterStub();
  try {
    const db = attrappe();
    db.create = async () => { throw new Error("Speicher voll"); };
    await assert.rejects(() => setzeEinstellung("briefkopf", {}, db), /Speicher voll/);
    assert.equal(ereignisse.length, 0);
  } finally {
    delete globalThis.window;
  }
});

test("doppelteSchluessel zählt nur mehrfach vorhandene Schlüssel", () => {
  assert.deepEqual(doppelteSchluessel([
    { key: "briefkopf" }, { key: "buchhaltung" }, { key: "briefkopf" }, { key: "briefkopf" }, null, { value: 1 },
  ]), [{ key: "briefkopf", anzahl: 3 }]);
  assert.deepEqual(doppelteSchluessel([]), []);
});
