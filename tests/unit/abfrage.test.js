// Unit-Tests für packages/nova-core/src/api/abfrage.js (57-02 Task 2).
//
// Zwei Ebenen:
//   1. Die puren Funktionen einzeln (sort/filter/zeile↔datensatz).
//   2. PARITÄT gegen server/db.js: dieselben 6 Fixtures laufen einmal durch
//      createDb (echte Temp-Datei) und einmal durch die PostgREST-Beschreibung,
//      hier lokal ausgewertet mit derselben Textvergleichs-Regel, die Postgres
//      anwendet (data->>k = String). Gleiche Reihenfolge, gleiche Treffer-IDs —
//      damit wird die Verschiebung Text vs. JS-Wert GEMESSEN, nicht angenommen
//      (Plan 57-02 Task 2, Research §7).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  sortNachPostgrest,
  filterNachPostgrest,
  datensatzAusZeile,
  zeileAusDatensatz,
  neueId,
} from "@core/api/abfrage";
import { createDb } from "../../packages/nova-core/server/db.js";
import { demoDb, setzeSpeicher } from "@core/api/demoDb";

/**
 * Minimaler Speicher-Adapter für demoDb (wie in demoDb.test.js) — die Fixtures
 * liegen im Speicher, geschrieben wird nichts (filter ist read-only).
 * @param {Record<string, object[]>} daten Startbestand
 */
function speicherAttrappe(daten) {
  return {
    async entities() { return Object.keys(daten); },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben() { /* read-only-Test */ },
    async schreibeViele() { /* read-only-Test */ },
    async loeschen() { /* read-only-Test */ },
    async leeren() { /* read-only-Test */ },
    async meta() { return null; },
  };
}

// --- 1. sortNachPostgrest -----------------------------------------------------

describe("sortNachPostgrest", () => {
  it("-created_date → echte Spalte, absteigend", () => {
    assert.deepEqual(sortNachPostgrest("-created_date"), {
      spalte: "created_date",
      aufsteigend: false,
      jsonPfad: false,
    });
  });

  it("name → jsonb-Pfad, aufsteigend", () => {
    assert.deepEqual(sortNachPostgrest("name"), {
      spalte: "data->>name",
      aufsteigend: true,
      jsonPfad: true,
    });
  });

  it("-name → jsonb-Pfad, absteigend", () => {
    assert.deepEqual(sortNachPostgrest("-name"), {
      spalte: "data->>name",
      aufsteigend: false,
      jsonPfad: true,
    });
  });

  it("id und updated_date sind echte Spalten (kein data->>)", () => {
    assert.equal(sortNachPostgrest("id").jsonPfad, false);
    assert.equal(sortNachPostgrest("-updated_date").spalte, "updated_date");
  });

  it("undefined/null/leer → null (kein Sort)", () => {
    assert.equal(sortNachPostgrest(undefined), null);
    assert.equal(sortNachPostgrest(null), null);
    assert.equal(sortNachPostgrest(""), null);
  });
});

// --- 2. filterNachPostgrest ---------------------------------------------------

describe("filterNachPostgrest", () => {
  it("Werte werden Strings (data->> liefert Text)", () => {
    assert.deepEqual(
      filterNachPostgrest({ project_id: "p1", aktiv: true }),
      [["data->>project_id", "p1"], ["data->>aktiv", "true"]],
    );
  });

  it("Zahlen und Booleans als Text; 0 und false bleiben erhalten", () => {
    assert.deepEqual(filterNachPostgrest({ anzahl: 0 }), [["data->>anzahl", "0"]]);
    assert.deepEqual(filterNachPostgrest({ fertig: false }), [["data->>fertig", "false"]]);
  });

  it("undefined/null werden ausgelassen (wie buildQuery)", () => {
    assert.deepEqual(filterNachPostgrest({ a: 1, b: undefined, c: null, d: 2 }), [
      ["data->>a", "1"],
      ["data->>d", "2"],
    ]);
  });

  it("leeres/fehlendes Query → leere Paarliste", () => {
    assert.deepEqual(filterNachPostgrest({}), []);
    assert.deepEqual(filterNachPostgrest(undefined), []);
    assert.deepEqual(filterNachPostgrest(null), []);
  });
});

// --- 3. Zeile ↔ Datensatz -----------------------------------------------------

describe("datensatzAusZeile / zeileAusDatensatz — Roundtrip", () => {
  const ORG = "11111111-2222-3333-4444-555555555555";

  it("datensatzAusZeile: data-Felder + die drei Spalten", () => {
    assert.deepEqual(
      datensatzAusZeile({
        id: "p1",
        data: { name: "Referenzprojekt", project_id: null },
        created_date: "2026-09-01T00:00:00.000Z",
        updated_date: "2026-09-02T00:00:00.000Z",
      }),
      {
        name: "Referenzprojekt",
        project_id: null,
        id: "p1",
        created_date: "2026-09-01T00:00:00.000Z",
        updated_date: "2026-09-02T00:00:00.000Z",
      },
    );
  });

  it("Top-Level-Felder GEWINNEN gegen gleichnamige data-Felder (wie db.js sie schreibt)", () => {
    // Ein (kaputter/alter) Datensatz hätte id/created_date auch im jsonb —
    // die echten Spalten sind maßgeblich (db.js:133-138).
    const datensatz = datensatzAusZeile({
      id: "echt",
      data: { id: "falsch", created_date: "alt", name: "X" },
      created_date: "neu",
      updated_date: "u",
    });
    assert.equal(datensatz.id, "echt");
    assert.equal(datensatz.created_date, "neu");
    assert.equal(datensatz.name, "X");
  });

  it("Roundtrip: Datensatz → Zeile → Datensatz ist identisch (inkl. Zeitstempel-Spalten)", () => {
    const original = {
      id: "p1",
      created_date: "2026-01-01T00:00:00.000Z",
      updated_date: "2026-01-02T00:00:00.000Z",
      name: "Projekt",
      baujahr: 2024,
      aktiv: true,
    };
    const zeile = zeileAusDatensatz("Project", ORG, original);
    // Der Client-Weg bekommt die Zeitstempel von der DB (default/Trigger);
    // für den Roundtrip hier explizit zurücksetzen, wie die DB sie liefern würde.
    zeile.created_date = original.created_date;
    zeile.updated_date = original.updated_date;
    assert.deepEqual(datensatzAusZeile(zeile), original);
  });

  it("zeileAusDatensatz ohne id → neueId im db.js-Format", () => {
    const zeile = zeileAusDatensatz("Issue", ORG, { titel: "Riss" });
    assert.match(zeile.id, /^[0-9a-z]+$/);
    assert.deepEqual(zeile.data, { titel: "Riss" });
    assert.notEqual(neueId(), neueId());
  });

  it("datensatzAusZeile ist robust gegen null/undefined", () => {
    assert.deepEqual(datensatzAusZeile(null), { id: undefined, created_date: undefined, updated_date: undefined });
    assert.deepEqual(datensatzAusZeile({ id: "x" }), { id: "x", created_date: undefined, updated_date: undefined });
  });
});

// --- 4. PARITÄT gegen db.js und demoDb.js -------------------------------------
//
// Dieselben 6 Fixtures laufen durch ALLE Datenwege und müssen dieselben
// Treffer-IDs in derselben Reihenfolge liefern:
//   - db.js (createDb, echte Temp-Datei) — mit String-Werten (wie req.query
//     sie liefert) UND mit rohen JS-Werten
//   - demoDb.filter (gespiegelte Semantik, Speicher-Attrappe)
//   - die PostgREST-Beschreibung aus abfrage.js, lokal ausgewertet mit der
//     Textvergleichs-Regel, die Postgres anwendet (data->>k = Text)
//
// Vorgeschichte (57-02): db.js matchesQuery verglich strikt (===), während
// req.query IMMER Strings liefert — bei Boolean-/Zahlenfeldern fand der
// Express-Weg deshalb nichts (der demoDb-Kommentar behauptete das Gegenteil).
// Behoben durch Angleichung auf die tolerante Regel (db.js:113-123), die
// demoDb schon hatte. Der Test misst jetzt alle drei Wege gegeneinander —
// die Verschiebung Text vs. JS-Wert wird GEMESSEN, nicht angenommen
// (Plan 57-02 Task 2, Research §7).

/**
 * Query-Werte auf Strings normieren — wie sie über den Express-HTTP-Pfad
 * (req.query) bei db.filter ankommen. undefined/null fallen weg (bitApi
 * buildQuery und filterNachPostgrest lassen sie ebenfalls aus).
 * @param {Record<string, any>|undefined} query
 * @returns {Record<string, any>|undefined} Query mit String-Werten
 */
function queryAlsText(query) {
  if (!query) return query;
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * Query mit ROHEN JS-Werten (Zahlen/Booleans), aber undefined/null entfernt —
 * wie es der in-prozess-Aufruf von db.filter/demoDb.filter sähe. Der Unterschied
 * zu queryAlsText ist NUR der Werttyp (true vs "true", 9 vs "9"), nicht das
 * undefined-Handling: So isoliert der Test den 57-02-Bugfix (strikter vs
 * toleranter Vergleich), statt ihn mit undefined-Bereinigung zu vermengen.
 * @param {Record<string, any>|undefined} query
 * @returns {Record<string, any>|undefined}
 */
function queryRoh(query) {
  if (!query) return query;
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/** @type {Array<Record<string, any>>} 6 Fixtures — gemischte Typen, nulls, Umlaute. */
const FIXTURES = [
  { id: "f1", name: "Ziegel", anzahl: 9, aktiv: true, projekt: "p1", created_date: "2026-01-05T00:00:00.000Z" },
  { id: "f2", name: "Beton", anzahl: 10, aktiv: false, projekt: "p1", created_date: "2026-01-01T00:00:00.000Z" },
  { id: "f3", name: "á-Quader", anzahl: 3, aktiv: true, projekt: "p2", created_date: "2026-02-01T00:00:00.000Z" },
  { id: "f4", name: "Mörtel", anzahl: null, aktiv: true, projekt: null, created_date: "2026-01-10T00:00:00.000Z" },
  { id: "f5", anzahl: 7, aktiv: false, projekt: "p2", created_date: "2026-03-01T00:00:00.000Z" }, // kein name (null)
  { id: "f6", name: "Stahl", anzahl: 9, aktiv: true, projekt: "p1", created_date: "2025-12-31T00:00:00.000Z" },
];

const ORG = "11111111-2222-3333-4444-555555555555";

/**
 * Lokale Auswertung der PostgREST-Beschreibung — exakt die Regel, die
 * supabaseDb.js an den Server schickt (Textvergleich auf data->>k, Sortierung
 * über die Spalten/Texte, nulls zuletzt wie nullsFirst:false).
 * @param {Array<{ data: object, id: string, created_date: string }>} zeilen
 * @param {Array<[string, string]>} paare aus filterNachPostgrest
 * @param {{ spalte: string, aufsteigend: boolean, jsonPfad: boolean } | null} sort
 * @returns {string[]} sortierte Treffer-ids
 */
function postgrestLokal(zeilen, paare, sort) {
  // data->>ausdruck: Textwert aus dem jsonb-Payload ODER der echten Spalte.
  const textwert = (z, spalte) => {
    const m = spalte.match(/^data->>(.+)$/);
    const feld = m ? m[1] : spalte;
    const roh = m ? z.data?.[feld] : z[spalte];
    return roh == null ? null : String(roh);
  };
  let treffer = zeilen.filter((z) =>
    paare.every(([spalte, wert]) => textwert(z, spalte) === wert),
  );
  if (sort) {
    treffer = [...treffer].sort((a, b) => {
      const av = textwert(a, sort.spalte);
      const bv = textwert(b, sort.spalte);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;  // nulls zuletzt (nullsFirst:false)
      if (bv == null) return -1;
      if (av < bv) return sort.aufsteigend ? -1 : 1;
      if (av > bv) return sort.aufsteigend ? 1 : -1;
      return 0;
    });
  }
  return treffer.map((z) => z.id);
}

describe("PARITÄT abfrage.js ↔ db.js ↔ demoDb.js — dieselben 6 Fixtures", () => {
  /**
   * Alle drei Wege auf denselben Fixtures:
   * 1. express  — createDb (db.js, Temp-Datei), Query-Werte ALS STRINGS wie über req.query
   * 2. expressRoh — createDb mit den ROHEN JS-Werten (Zahlen/Booleans): muss
   *    seit der 57-02-Angleichung von matchesQuery (tolerante Gleichheit)
   *    dieselben Treffer liefern — das ist der eigentliche Bugfix-Nachweis
   * 3. demo — demoDb.filter (gespiegelte Semantik) mit Strings
   * 4. postgrest — abfrage.js-Beschreibung, lokal mit der Textvergleichs-Regel
   *    ausgewertet, die Postgres anwendet (data->>k = Text)
   */
  function alle(query, sortStr) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abfrage-paritaet-"));
    const dbPfad = path.join(tmp, "db.json");
    fs.writeFileSync(dbPfad, JSON.stringify({ Fix: FIXTURES }), "utf-8");
    const db = createDb(dbPfad);

    const textQuery = queryAlsText(query);
    const hatTextFilter = textQuery && Object.keys(textQuery).length > 0;
    const express = (hatTextFilter
      ? db.filter("Fix", textQuery, sortStr)
      : db.list("Fix", sortStr)
    ).map((r) => r.id);

    // Rohwert-Pfad (in-prozess, z. B. demoDb oder direkte API-Nutzung):
    // undefined/null entfernt, JS-Typen behalten.
    const rohQuery = queryRoh(query);
    const hatRohFilter = rohQuery && Object.keys(rohQuery).length > 0;
    const expressRoh = (hatRohFilter
      ? db.filter("Fix", rohQuery, sortStr)
      : db.list("Fix", sortStr)
    ).map((r) => r.id);

    // Die PostgREST-Zeilen: zeileAusDatensatz liefert bewusst OHNE
    // created_date/updated_date (die DB-Spalten füllt default/Trigger) — für
    // die Parität werden die Spalten hier wie in der echten DB ergänzt, sonst
    // könnte die Sortierung nach created_date nicht verglichen werden.
    const zeilen = FIXTURES.map((f) => {
      const z = zeileAusDatensatz("Fix", ORG, f);
      z.created_date = f.created_date;
      return z;
    });
    const postgrest = postgrestLokal(zeilen, filterNachPostgrest(query), sortNachPostgrest(sortStr));

    fs.rmSync(tmp, { recursive: true, force: true });
    return { express, expressRoh, postgrest, rohQuery, sortStr };
  }

  /** demoDb.filter — dieselben Fixtures über den Demo-Adapter (Test-Speicher). */
  async function demo(query, sortStr) {
    const daten = { Fix: structuredClone(FIXTURES) };
    setzeSpeicher(speicherAttrappe(daten));
    return demoDb.filter("Fix", queryRoh(query) || {}, sortStr).then((rows) => rows.map((r) => r.id));
  }

  const FALLE = [
    ["unsortiert (list ohne sort)", undefined, undefined],
    ["-created_date", undefined, "-created_date"],
    ["created_date aufsteigend", undefined, "created_date"],
    ["name aufsteigend (nulls zuletzt)", undefined, "name"],
    ["-name", undefined, "-name"],
    ["filter projekt=p1, sort -created_date", { projekt: "p1" }, "-created_date"],
    ["filter aktiv=true (Boolean → Text)", { aktiv: true }, undefined],
    ["filter aktiv=false", { aktiv: false }, "name"],
    ["filter anzahl=9 (Zahl → Text, trifft f1 UND f6)", { anzahl: 9 }, "id"],
    ["filter anzahl=10", { anzahl: 10 }, undefined],
    ["kombiniert: projekt=p2 + aktiv=true", { projekt: "p2", aktiv: true }, "-created_date"],
    ["undefined-Werte im Query werden ignoriert", { projekt: undefined, aktiv: true }, "id"],
  ];

  for (const [titel, query, sortStr] of FALLE) {
    it(`${titel}: db.js (String + Rohwerte), demoDb und PostgREST liefern dieselben IDs`, async () => {
      const { express, expressRoh, postgrest } = alle(query, sortStr);
      assert.deepEqual(postgrest, express, `express=${express} postgrest=${postgrest}`);
      // Der 57-02-Bugfix: db.js findet mit ROHEN JS-Werten (Zahlen/Booleans)
      // jetzt dieselben Zeilen wie mit Strings — vorher: strikt, 0 Treffer.
      assert.deepEqual(expressRoh, express, `roh=${expressRoh} string=${express}`);
      const demoIds = await demo(query, sortStr);
      assert.deepEqual(demoIds, express, `demo=${demoIds} express=${express}`);
      assert.ok(express.length > 0, "Fall liefert keine Treffer — Fixture-Pflege nötig");
    });
  }

  it("Zahlen-Textvergleich: anzahl=9 und anzahl=10 treffen dieselben Zeilen auf allen Wegen", async () => {
    // db.js vergleicht seit 57-02 tolerant (=== ODER String-Vergleich),
    // PostgREST mit Text "9" — bei ganzzahligen Werten deckungsgleich.
    const neun = alle({ anzahl: 9 }, "id");
    assert.deepEqual(neun.postgrest, neun.express);
    assert.deepEqual([...neun.express].sort(), ["f1", "f6"]);
    const zehn = alle({ anzahl: 10 }, undefined);
    assert.deepEqual(zehn.postgrest, zehn.express);
    assert.deepEqual(zehn.express, ["f2"]);
    assert.deepEqual(await demo({ anzahl: 9 }, "id"), neun.express);
  });

  it("Boolean-Filter aktiv=true trifft dieselben Zeilen auf allen Wegen", async () => {
    const { express, expressRoh, postgrest } = alle({ aktiv: true }, "id");
    assert.deepEqual(postgrest, express);
    assert.deepEqual(expressRoh, express);
    assert.deepEqual([...express].sort(), ["f1", "f3", "f4", "f6"]);
    assert.deepEqual(await demo({ aktiv: true }, "id"), express);
  });

  it("Bugfix-Regression: db.js findet Boolean-/Zahlenfelder auch mit String-Query (vor 57-02: 0 Treffer)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abfrage-regression-"));
    const db = createDb(path.join(tmp, "db.json"));
    db._reset({ Fix: FIXTURES });
    // Vor dem Fix: matchesQuery('aktiv' === 'true') → false → leere Liste.
    assert.equal(db.filter("Fix", { aktiv: "true" }).length, 4);
    assert.equal(db.filter("Fix", { anzahl: "9" }).length, 2);
    // Strikte Typen funktionieren weiter (Kurzschluss über ===).
    assert.equal(db.filter("Fix", { aktiv: true }).length, 4);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
