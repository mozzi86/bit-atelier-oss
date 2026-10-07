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
  assert.ok(reihe.indexOf("BimSnapshot") < reihe.indexOf("blob"));

  // Bauteile als EIN Blob — nicht als Entitäten.
  const blob = schritte.find((s) => s.art === "blob");
  assert.equal(blob.n, 2);
  assert.equal(res.geschrieben.BimElementBlob, 2);
  assert.ok(!("BimElement" in res.geschrieben));
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
      ["/api/entities/LVPosition/bulk", "POST"],
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
