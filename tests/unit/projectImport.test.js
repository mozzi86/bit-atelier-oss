// Projekt-Bundle-Import — Trockenlauf und Schreibpfad (Phase 33 / W3).
//
// Die Prüfung gegen das ECHTE Referenz-Bundle macht Gate G8 (parity/g8-modi.test.mjs).
// Hier geht es um die Zusicherungen, auf die sich der Nutzer verlässt:
//   * ohne bestandenen Trockenlauf UND ausdrückliche Bestätigung wird NICHTS geschrieben,
//   * bricht etwas ab, kommt ein Bericht statt eines stillen Teilzustands,
//   * die 6.038 Bauteile gehen als EIN Blob, nicht als 6.038 Entitäten.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBundle, validateBundle, applyBundle, stapeln, geschaetzteStapel,
  STAPEL, SCHREIB_REIHENFOLGE, ENTITAET, httpIo,
} from "@ava/lib/projectImport.js";

const minimal = () => ({
  version: "test/1",
  project: { name: "Testprojekt" },
  lose: [{ gewerk_nr: "001", name: "Los A" }],
  positionen: [{
    gewerk_nr: "001", oz: "01010010", title: "Position", quantity: 5, unit: "m2",
    unit_price: 10, mengen_modus: "handeingabe",
  }],
});

const sammler = () => {
  const schritte = [];
  return {
    schritte,
    io: {
      bulkCreate: async (entity, records) => schritte.push({ art: "bulk", entity, n: records.length }),
      createOne: async (entity, record) => {
        schritte.push({ art: "one", entity });
        return { ...record, id: entity === "Project" ? "p-1" : `${entity}-1` };
      },
      putBlob: async (id, json) => schritte.push({ art: "blob", id, n: json.elemente.length }),
    },
  };
};

test("parseBundle füllt jeden Abschnitt, auch wenn er fehlt", () => {
  const b = parseBundle({ version: "x/1" });
  for (const feld of ["lose", "positionen", "regeln", "filter", "elemente", "preisschichten",
    "vertraege", "vertragspositionen", "aenderungen", "deckung", "luecken",
    "unvollstaendig", "warnungen"]) {
    assert.ok(Array.isArray(b[feld]), `${feld} muss ein Array sein`);
  }
  assert.deepEqual(b.kataloge, {});
  assert.equal(b.project, null);
  // Auch als String lesbar (Datei-Inhalt).
  assert.equal(parseBundle(JSON.stringify({ version: "y/1" })).version, "y/1");
  assert.throws(() => parseBundle(42), /kein Objekt/);
});

test("das Minimalbundle besteht den Trockenlauf", () => {
  const b = validateBundle(parseBundle(minimal()));
  assert.deepEqual(b.fehler, []);
  assert.equal(b.ok, true);
  assert.equal(b.zusammenfassung.positionen, 1);
  assert.deepEqual(b.zusammenfassung.modi, { handeingabe: 1 });
});

test("fehlende Version und fehlendes Projekt blockieren", () => {
  const ohneVersion = validateBundle(parseBundle({ ...minimal(), version: null }));
  assert.match(ohneVersion.fehler.join(" "), /version/);
  const ohneProjekt = validateBundle(parseBundle({ ...minimal(), project: null }));
  assert.match(ohneProjekt.fehler.join(" "), /project/);
  assert.equal(ohneProjekt.ok, false);
});

test("Regeln ohne Position und Elemente ohne Modellstand blockieren", () => {
  const b1 = validateBundle(parseBundle({
    ...minimal(), regeln: [{ gewerk_nr: "001", oz: "gibtsnicht" }],
  }));
  assert.match(b1.fehler.join(" "), /Mengenregeln/);

  const b2 = validateBundle(parseBundle({
    ...minimal(), elemente: [{ guid: "abc" }], snapshot: null,
  }));
  assert.match(b2.fehler.join(" "), /snapshot/);

  const b3 = validateBundle(parseBundle({
    ...minimal(), snapshot: { id: "s" }, elemente: [{ guid: "a" }, { guid: "a" }],
  }));
  assert.match(b3.fehler.join(" "), /nicht eindeutig/);

  const b4 = validateBundle(parseBundle({
    ...minimal(), snapshot: { id: "s" }, elemente: [{ name: "ohne guid" }],
  }));
  assert.match(b4.fehler.join(" "), /ohne GlobalId/);
});

test("Warnungen blockieren NICHT — ein LV ohne Preise ist der Normalfall", () => {
  const b = validateBundle(parseBundle({
    ...minimal(),
    positionen: [{
      gewerk_nr: "001", oz: "1", title: "P", mengen_modus: "uebernahme", unit_price: null,
    }],
  }));
  assert.equal(b.ok, true, "kein Preis ist kein Fehler");
  assert.match(b.warnungen.join(" "), /ohne Einheitspreis/);
  // Übernahme ohne Grund: Hinweis, nicht Blockade.
  assert.match(b.warnungen.join(" "), /ausschluss_grund/);
});

test("die Selbstauskunft des Erzeugers landet im Bericht", () => {
  const b = validateBundle(parseBundle({
    ...minimal(), unvollstaendig: ["Preise fehlen noch"],
  }));
  assert.match(b.warnungen.join(" "), /unvollständig.*Preise fehlen noch/);
});

test("ohne Bestätigung passiert NICHTS", async () => {
  const { io, schritte } = sammler();
  const res = await applyBundle(parseBundle(minimal()), io, { bestaetigt: false });
  assert.equal(res.ok, false);
  assert.deepEqual(schritte, []);
  assert.deepEqual(res.geschrieben, {});
});

test("mit Bestätigung wird in Fremdschlüssel-Reihenfolge geschrieben", async () => {
  const { io, schritte } = sammler();
  const b = parseBundle({
    ...minimal(),
    filter: [{ id: "f1", name: "F" }],
    regeln: [{ gewerk_nr: "001", oz: "01010010" }],
    snapshot: { id: "s1" },
    elemente: [{ guid: "g1" }, { guid: "g2" }],
    luecken: [{ kategorie: "k", beschreibung: "b" }],
  });
  const res = await applyBundle(b, io, { bestaetigt: true });
  assert.deepEqual(res.fehler, []);
  assert.equal(res.ok, true);
  assert.equal(res.projektId, "p-1");

  const reihe = schritte.map((s) => s.entity || s.art);
  assert.ok(reihe.indexOf("Project") < reihe.indexOf("Los"));
  assert.ok(reihe.indexOf("AvaFilter") < reihe.indexOf("LVPosition"));
  assert.ok(reihe.indexOf("LVPosition") < reihe.indexOf("MengenRegel"));
  // Speicherregel (11.10.2026): zwei kleine Bauteile liegen inline am Modellstand — kein Blob.
  assert.equal(schritte.find((s) => s.art === "blob"), undefined);
  assert.equal(res.geschrieben.BimElementInline, 2);
  assert.ok(!("BimElement" in res.geschrieben));
});

test("große Bauteilliste (> 256 KB) geht als EIN Blob nach dem Modellstand", async () => {
  const { io, schritte } = sammler();
  const gross = Array.from({ length: 3000 }, (_, i) => ({ guid: `g${i}`, name: "x".repeat(100) }));
  const b = parseBundle({ ...minimal(), snapshot: { id: "s1" }, elemente: gross });
  const res = await applyBundle(b, io, { bestaetigt: true });
  assert.equal(res.ok, true);
  const reihe = schritte.map((s) => s.entity || s.art);
  assert.ok(reihe.indexOf("BimSnapshot") < reihe.indexOf("blob"));
  assert.equal(schritte.find((s) => s.art === "blob").n, 3000);
  assert.equal(res.geschrieben.BimElementBlob, 3000);
});

test("ein Abbruch liefert einen Bericht darüber, was schon geschrieben wurde", async () => {
  const io = {
    bulkCreate: async (entity) => { if (entity === "MengenRegel") throw new Error("Platte voll"); },
    createOne: async (entity, record) => ({ ...record, id: "p-1" }),
    putBlob: async () => {},
  };
  const b = parseBundle({ ...minimal(), regeln: [{ gewerk_nr: "001", oz: "01010010" }] });
  const res = await applyBundle(b, io, { bestaetigt: true });
  assert.equal(res.ok, false);
  assert.equal(res.abgebrochen, true);
  assert.match(res.fehler.join(" "), /Platte voll/);
  assert.equal(res.geschrieben.LVPosition, 1, "der Bericht muss den Teilzustand benennen");
  assert.equal(res.geschrieben.MengenRegel ?? 0, 0);
});

test("ein Projekt ohne id bricht ab, bevor Kindsätze entstehen", async () => {
  const geschrieben = [];
  const io = {
    bulkCreate: async (e) => geschrieben.push(e),
    createOne: async () => ({}), // keine id
    putBlob: async () => {},
  };
  const res = await applyBundle(parseBundle(minimal()), io, { bestaetigt: true });
  assert.equal(res.ok, false);
  assert.match(res.fehler.join(" "), /ohne id/);
  assert.ok(!geschrieben.includes("LVPosition"), "keine Position ohne Projekt");
});

test("Fortschritt wird gemeldet", async () => {
  const meldungen = [];
  const { io } = sammler();
  io.onProgress = (text, anteil) => meldungen.push([text, anteil]);
  await applyBundle(parseBundle(minimal()), io, { bestaetigt: true });
  assert.ok(meldungen.length >= 5);
  assert.ok(meldungen.every(([, a]) => a > 0 && a <= 1));
  assert.ok(meldungen.some(([t]) => /Position/i.test(t)));
});

test("Stapelgröße und Schätzung", () => {
  assert.equal(STAPEL, 500);
  assert.deepEqual(stapeln([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(stapeln([]), []);
  assert.equal(stapeln(new Array(500).fill(0)).length, 1);
  assert.equal(stapeln(new Array(501).fill(0)).length, 2);

  const b = parseBundle({ ...minimal(), elemente: [{ guid: "g" }], snapshot: { id: "s" } });
  assert.ok(geschaetzteStapel(b) >= 3);
});

test("Reihenfolge und Entitätsnamen sind dokumentiert", () => {
  assert.ok(SCHREIB_REIHENFOLGE.indexOf("kataloge") < SCHREIB_REIHENFOLGE.indexOf("project"));
  assert.ok(SCHREIB_REIHENFOLGE.indexOf("filter") < SCHREIB_REIHENFOLGE.indexOf("positionen"));
  assert.ok(SCHREIB_REIHENFOLGE.indexOf("positionen") < SCHREIB_REIHENFOLGE.indexOf("regeln"));
  assert.equal(ENTITAET.positionen, "LVPosition");
  assert.equal(ENTITAET.luecken, "ModellLuecke");
});

test("httpIo trifft den BULK-Endpunkt (mit /bulk-Suffix)", async () => {
  const rufe = [];
  const echtesFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    rufe.push([url, opt.method]);
    return { ok: true, json: async () => ({ created: 1 }) };
  };
  try {
    const io = httpIo("/api");
    await io.bulkCreate("LVPosition", [{ a: 1 }]);
    await io.createOne("Project", { name: "P" });
    await io.putBlob("elemente-1", { elemente: [] });
    assert.deepEqual(rufe, [
      // Ohne `/bulk` träfe man die normale Create-Route und schriebe EINEN Satz.
      // B-111-02-01: the bundle's ids are references, so the import names the explicit id path.
      ["/api/entities/LVPosition/bulk?kennung=uebernehmen", "POST"],
      ["/api/entities/Project", "POST"],
      ["/api/blobs/elemente-1", "PUT"],
    ]);
  } finally {
    globalThis.fetch = echtesFetch;
  }
});

test("httpIo meldet HTTP-Fehler als Fehler, nicht als Erfolg", async () => {
  const echtesFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: "gesperrt" }) });
  try {
    await assert.rejects(() => httpIo().bulkCreate("LlmConnection", [{}]), /403.*gesperrt/);
  } finally {
    globalThis.fetch = echtesFetch;
  }
});

// Review R1 (B-111-02-01 follow-up): catalogs are office-wide. A second project bundle from the same source carries the same
// catalog ids; the import must keep the existing rows and go on instead of refusing the whole bundle with 409.
test("ein zweites Bundle derselben Quelle mit gleichen Katalog-ids wird importiert, vorhandene Katalogzeilen bleiben", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createDb } = await import("../../packages/nova-core/server/db.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "import-kataloge-"));
  const db = createDb(path.join(tmp, "db.json"));
  const echtesFetch = globalThis.fetch;
  // fetch → the store, with the same id rules as the routes (explicit id path on POST …/bulk?kennung=uebernehmen, 409).
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(String(url), "http://x");
    const teile = u.pathname.split("/").filter(Boolean); // api, entities, Entity, [bulk]
    const antwort = (status, body) => ({ ok: status < 400, status, json: async () => body });
    try {
      if (opt.method === "GET" || !opt.method) return antwort(200, db.list(teile[2]));
      const body = JSON.parse(opt.body || "{}");
      const kennungUebernehmen = u.searchParams.get("kennung") === "uebernehmen";
      if (teile[3] === "bulk") return antwort(201, { ids: db.bulkCreate(teile[2], body.records, { kennungUebernehmen }).map((r) => r.id) });
      return antwort(201, db.create(teile[2], body, { kennungUebernehmen }));
    } catch (e) {
      return antwort(e?.status || 500, { error: e.message });
    }
  };
  const bundle = (name, pos) => parseBundle({
    ...minimal(),
    project: { name },
    kataloge: { EinheitenKatalog: [{ id: "kat-1", code: "m2" }, { id: `kat-${pos}`, code: pos }] },
    positionen: [{ ...minimal().positionen[0], id: pos }],
  });
  try {
    const a = await applyBundle(bundle("Projekt A", "a"), httpIo("/api"), { bestaetigt: true });
    assert.equal(a.ok, true, a.fehler.join(" | "));
    const b = await applyBundle(bundle("Projekt B", "b"), httpIo("/api"), { bestaetigt: true });
    assert.equal(b.ok, true, b.fehler.join(" | "));
    assert.deepEqual(db.list("Project").map((p) => p.name).sort(), ["Projekt A", "Projekt B"]);
    // the shared row exists once; the new row of B was added
    assert.deepEqual(db.list("EinheitenKatalog").map((r) => r.id).sort(), ["kat-1", "kat-a", "kat-b"]);
    assert.equal(b.geschrieben.EinheitenKatalog, 1);
    assert.deepEqual(b.uebersprungen, { EinheitenKatalog: 1 });
    // project child rows keep the 409: the same position id again is still refused
    const c = await applyBundle(bundle("Projekt C", "a"), httpIo("/api"), { bestaetigt: true });
    assert.equal(c.ok, false);
    assert.match(c.fehler.join(" "), /409.*id a /);
  } finally {
    globalThis.fetch = echtesFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
