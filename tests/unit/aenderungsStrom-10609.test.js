// 106-09: sync between devices - change stream (server), strict save with conflict (105-20 part), three-way merge,
// the BIM studio's and the IFC journal's handling of a foreign change. Real Express router for the stream and the 409.

import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter, standVeraltet } from "../../packages/nova-core/server/routes.js";
import {
  aenderungsStrom, aenderungenMelden, aenderungsRouter, ereignisAusSchreiben, sseBlock, clientAus, STROM_ENTITAETEN,
} from "../../server/aenderungsStrom.js";
import { geraetDarf } from "../../server/bueroRouter.js";
import { feldDreiWege, gleichWert, elementSchluessel } from "@core/lib/abgleich/dreiWege";
import { abgleichStandNeu } from "@core/lib/abgleich/abgleichStand";
import { fremdeElementeAbgleichen, konfliktZeilen, konfliktAufloesen, aenderungsZeilen, vorschlaegeNeuPruefen } from "@core/lib/abgleich/modellAbgleich";
import { journalFremdAnwenden, entscheidungsEintrag } from "@ifc/lib/journalAbgleich";

// ------------------------------------------------------------------------------------------------ pure server parts

test("ereignisAusSchreiben: project from the record, written fields of a PUT, small records ride along", () => {
  const e = ereignisAusSchreiben({ methode: "PUT", entitaet: "BimModel", id: "b1", datensatz: { id: "b1", project_id: "P1", updated_date: "2026-10-25T10:00:00.000Z", customWalls: [] },
    body: { customWalls: [], project_id: "P1", updated_date: "x" }, geraet: { id: "g1", name: "Tablett", token: "geheim" }, client: "abcdefgh1234" });
  assert.equal(e?.projekt, "P1");
  assert.equal(e?.art, "geaendert");
  assert.deepEqual(e?.felder, ["customWalls"], "administration fields are not 'changed fields'");
  assert.deepEqual(e?.geraet, { id: "g1", name: "Tablett" }, "only id and name of the device, nothing else");
  assert.equal(e?.client, "abcdefgh1234");
  assert.equal(e?.datensatz.id, "b1");
  // a big record (the model with thousands of walls) does not ride along - the client reads it
  const gross = ereignisAusSchreiben({ methode: "POST", entitaet: "BimModel", datensatz: { id: "b2", project_id: "P1", x: "y".repeat(20000) } });
  assert.equal(gross?.datensatz, undefined);
  // a delete takes the project from the record before; without a project nothing is streamed
  const weg = ereignisAusSchreiben({ methode: "DELETE", entitaet: "IfcAenderung", id: "j1", vorher: { id: "j1", project_id: "P2", guid: "G" } });
  assert.equal(weg?.projekt, "P2");
  assert.equal(weg?.art, "geloescht");
  assert.equal(weg?.updated_date, null);
  assert.equal(ereignisAusSchreiben({ methode: "POST", entitaet: "IfcAenderung", datensatz: { id: "j2" } }), null);
  assert.equal(ereignisAusSchreiben({ methode: "GET", entitaet: "BimModel", datensatz: { id: "b", project_id: "P" } }), null);
});

test("sseBlock and clientAus", () => {
  assert.equal(sseBlock("aenderung", { a: 1 }, 7), 'id: 7\nevent: aenderung\ndata: {"a":1}\n\n');
  assert.equal(sseBlock("bereit", {}), "event: bereit\ndata: {}\n\n");
  assert.equal(clientAus({ headers: { "x-bit-client": "abcdefgh_123" } }), "abcdefgh_123");
  assert.equal(clientAus({ headers: { "x-bit-client": "kurz" } }), null);
  assert.equal(clientAus({ headers: { "x-bit-client": "<script>alert(1)</script>" } }), null);
  assert.deepEqual([...STROM_ENTITAETEN], ["BimModel", "IfcAenderung"]);
});

test("hub: only the subscribers of the event's project get it; limits per source and in total; resume after a seq", () => {
  const strom = aenderungsStrom({ grenzen: { gesamt: 3, jeQuelle: 2 }, puffer: 2 });
  /** @type {any[]} */ const a = [], b = [];
  const sa = strom.abonnieren({ projekt: "A", quelle: "lokal", senden: (e) => a.push(e) });
  const sb = strom.abonnieren({ projekt: "B", quelle: "geraet:g1", senden: (e) => b.push(e) });
  assert.ok(sa.ok && sb.ok);
  strom.melden({ projekt: "A", entitaet: "BimModel", id: "1", art: "geaendert", felder: [], updated_date: null, geraet: null, client: null });
  strom.melden({ projekt: "B", entitaet: "BimModel", id: "2", art: "geaendert", felder: [], updated_date: null, geraet: null, client: null });
  assert.deepEqual(a.map((e) => e.id), ["1"]);
  assert.deepEqual(b.map((e) => e.id), ["2"], "project B never sees an event of project A");
  assert.equal(strom.abonnieren({ projekt: "A", quelle: "lokal", senden: () => {} }).ok, true);
  assert.equal(strom.abonnieren({ projekt: "A", quelle: "lokal", senden: () => {} }).ok, false, "total limit 3");
  sb.ok && sb.abmelden();
  const zweiterVomGeraet = strom.abonnieren({ projekt: "B", quelle: "lokal", senden: () => {} });
  assert.equal(zweiterVomGeraet.ok, false, "per source limit 2 (lokal has two)");
  // resume: the buffer keeps the last 2 events of a project
  strom.melden({ projekt: "A", entitaet: "BimModel", id: "3", art: "geaendert", felder: [], updated_date: null, geraet: null, client: null });
  strom.melden({ projekt: "A", entitaet: "BimModel", id: "4", art: "geaendert", felder: [], updated_date: null, geraet: null, client: null });
  sa.ok && sa.abmelden();
  const wieder = strom.abonnieren({ projekt: "A", quelle: "geraet:g2", senden: () => {}, seit: 1 });
  assert.ok(wieder.ok);
  assert.deepEqual(wieder.ok ? wieder.nachholen.map((e) => e.id) : [], ["3", "4"]);
});

test("office mode: a paired device may read the stream, never write to it", () => {
  assert.equal(geraetDarf("GET", "/api/aenderungen"), true);
  assert.equal(geraetDarf("POST", "/api/aenderungen"), false);
  assert.equal(geraetDarf("GET", "/api/aenderungen/x"), false);
});

test("standVeraltet (105-20 part): only a readable, older base is outdated", () => {
  const rec = { updated_date: "2026-10-25T10:05:00.000Z" };
  assert.equal(standVeraltet(rec, "2026-10-25T10:00:00.000Z"), true);
  assert.equal(standVeraltet(rec, "2026-10-25T10:05:00.000Z"), false);
  assert.equal(standVeraltet(rec, undefined), false, "without a stand the old behaviour (last write wins)");
  assert.equal(standVeraltet(rec, "gestern"), false);
});

// ------------------------------------------------------------------------------------------------ real Express

describe("stream and strict save through a real Express app", () => {
  /** @type {any} */ let db;
  /** @type {http.Server} */ let srv;
  let port = 0;
  let tmp = "";
  const strom = aenderungsStrom();

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-10609-"));
    db = createDb(path.join(tmp, "db.json"));
    db._reset({ Project: [{ id: "PA", name: "A" }, { id: "PB", name: "B" }] });
    const app = express();
    app.use(express.json());
    // a request with header x-test-geraet acts as a paired device (bueroWaechter sets req.bitZugang in the real server)
    const geraetVon = (/** @type {any} */ req) => (req.headers["x-test-geraet"] ? { id: "g7", name: String(req.headers["x-test-geraet"]) } : null);
    app.use("/api", aenderungenMelden(strom, db, { geraetVon }));
    app.use("/api", aenderungsRouter(strom, { db, geraetVon, herzschlagMs: 60000 }));
    app.use("/api", entitiesRouter(db));
    srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    port = /** @type {any} */ (srv.address()).port;
  });
  after(() => {
    srv.closeAllConnections?.();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Opens a stream and collects parsed events. @param {string} projekt @param {Record<string, string>} [kopf] */
  const oeffnen = (projekt, kopf = {}) => new Promise((resolve, reject) => {
    /** @type {any[]} */ const ereignisse = [];
    const req = http.get({ host: "127.0.0.1", port, path: `/api/aenderungen?projekt=${projekt}`, headers: kopf }, (res) => {
      let puffer = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        puffer += c;
        let i;
        while ((i = puffer.indexOf("\n\n")) >= 0) {
          const block = puffer.slice(0, i); puffer = puffer.slice(i + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name && data) ereignisse.push({ name, daten: JSON.parse(data) });
        }
      });
      resolve({ status: res.statusCode, typ: res.headers["content-type"], ereignisse, schliessen: () => req.destroy() });
    });
    req.on("error", reject);
  });
  /** @param {string} methode @param {string} pfad @param {any} [body] @param {Record<string, string>} [kopf] */
  const senden = (methode, pfad, body, kopf = {}) => fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode, headers: { "content-type": "application/json", ...kopf }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const warten = async (/** @type {() => boolean} */ f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); };

  it("refuses a stream without project, for an unknown project and from a foreign page", async () => {
    assert.equal((await senden("GET", "/api/aenderungen")).status, 400);
    assert.equal((await senden("GET", "/api/aenderungen?projekt=gibtsnicht")).status, 404);
    assert.equal((await senden("GET", "/api/aenderungen?projekt=PA", undefined, { "sec-fetch-site": "cross-site" })).status, 403);
  });

  it("a write of project A reaches the stream of A only, with device, client and (small) record", async () => {
    const a = /** @type {any} */ (await oeffnen("PA"));
    const b = /** @type {any} */ (await oeffnen("PB"));
    assert.equal(a.status, 200);
    assert.match(String(a.typ), /text\/event-stream/);
    await warten(() => a.ereignisse.some((/** @type {any} */ e) => e.name === "bereit"));
    const neu = await (await senden("POST", "/api/entities/IfcAenderung", { project_id: "PA", modell: "m.ifc", guid: "G1", pset: "P", eigenschaft: "FireRating", alt: "F30", wert: "F90", zeit: "2026-10-25T10:00:00.000Z", herkunft: "sprache", bestaetigt_durch: "hand" },
      { "x-bit-client": "tabEinsABCDEF", "x-test-geraet": "Tablett" })).json();
    await senden("POST", "/api/entities/BimModel", { project_id: "PB", customWalls: [] });
    await senden("POST", "/api/entities/Notiz", { project_id: "PA", text: "nicht gestreamt" });
    await warten(() => a.ereignisse.some((/** @type {any} */ e) => e.name === "aenderung"));
    await new Promise((r) => setTimeout(r, 50));
    const ea = a.ereignisse.filter((/** @type {any} */ e) => e.name === "aenderung").map((/** @type {any} */ e) => e.daten);
    assert.equal(ea.length, 1, "only the journal entry of A - not B's model, not an unstreamed entity");
    assert.equal(ea[0].entitaet, "IfcAenderung");
    assert.equal(ea[0].id, neu.id);
    assert.equal(ea[0].client, "tabEinsABCDEF");
    assert.deepEqual(ea[0].geraet, { id: "g7", name: "Tablett" });
    assert.equal(ea[0].datensatz.wert, "F90");
    assert.equal(ea[0].datensatz.herkunft, "sprache", "the origin rides along with the entry");
    const eb = b.ereignisse.filter((/** @type {any} */ e) => e.name === "aenderung");
    assert.equal(eb.length, 1);
    assert.equal(eb[0].daten.entitaet, "BimModel");
    // a refused write (404) is not an event; a delete is
    await senden("PUT", "/api/entities/IfcAenderung/gibtsnicht", { wert: 1 });
    await senden("DELETE", `/api/entities/IfcAenderung/${neu.id}`);
    await warten(() => a.ereignisse.filter((/** @type {any} */ e) => e.name === "aenderung").length >= 2);
    const zweite = a.ereignisse.filter((/** @type {any} */ e) => e.name === "aenderung")[1].daten;
    assert.equal(zweite.art, "geloescht");
    assert.equal(zweite.id, neu.id);
    a.schliessen(); b.schliessen();
    await warten(() => strom.anzahl() === 0);
    assert.equal(strom.anzahl(), 0, "closed streams are unsubscribed");
  });

  it("strict PUT on an outdated base: 409 with the stored record, nothing written, no event", async () => {
    const rec = await (await senden("POST", "/api/entities/BimModel", { project_id: "PA", storeys: 3 })).json();
    const stand1 = rec.updated_date;
    await new Promise((r) => setTimeout(r, 5));
    const zwei = await (await senden("PUT", `/api/entities/BimModel/${rec.id}?stand=${encodeURIComponent(stand1)}`, { storeys: 4 })).json();
    assert.equal(zwei.storeys, 4, "an up-to-date base is written");
    const a = /** @type {any} */ (await oeffnen("PA"));
    await warten(() => a.ereignisse.some((/** @type {any} */ e) => e.name === "bereit"));
    const alt = await senden("PUT", `/api/entities/BimModel/${rec.id}?stand=${encodeURIComponent(stand1)}`, { storeys: 9 });
    assert.equal(alt.status, 409);
    const j = await alt.json();
    assert.equal(j.konflikt, true);
    assert.equal(j.gespeichert.storeys, 4, "both versions: the client has its own, the answer brings the stored one");
    assert.equal(db.get("BimModel", rec.id).storeys, 4, "not overwritten");
    // without ?stand the old behaviour stays (last write wins) - callers that never knew a base are not broken
    assert.equal((await senden("PUT", `/api/entities/BimModel/${rec.id}`, { storeys: 5 })).status, 200);
    await warten(() => a.ereignisse.filter((/** @type {any} */ e) => e.name === "aenderung").length >= 1);
    const ev = a.ereignisse.filter((/** @type {any} */ e) => e.name === "aenderung").map((/** @type {any} */ e) => e.daten);
    assert.equal(ev.length, 1, "the refused write sent nothing, the accepted one did");
    assert.deepEqual(ev[0].felder, ["storeys"]);
    a.schliessen();
  });
});

// ------------------------------------------------------------------------------------------------ three-way merge

const w = (/** @type {number} */ idx, /** @type {Record<string, any>} */ x = {}) => ({ _idx: idx, a: { x: 0, z: idx }, b: { x: 5, z: idx }, ...x });

test("feldDreiWege: one side changed → that side; both the same → no conflict", () => {
  assert.equal(feldDreiWege(3, 3, 4).art, "fremd");
  assert.equal(feldDreiWege(3, 4, 3).wert, 4);
  assert.equal(feldDreiWege(3, 5, 5).art, "gleich");
  assert.equal(feldDreiWege(undefined, null, null).art, "gleich", "undefined and null are both 'nothing'");
  assert.ok(gleichWert({ a: 1, updatedAt: "x" }, { a: 1, updatedAt: "y" }), "the layer time stamp is not a change");
  assert.equal(elementSchluessel({ _idx: 2, guid: "G" }), "_idx:2");
  assert.equal(elementSchluessel({ guid: "G" }), "guid:G");
  assert.equal(elementSchluessel({}), null);
});

test("feldDreiWege on element lists: different elements merge, the same element changed twice is a conflict (mine stays)", () => {
  const basis = [w(1), w(2), w(3)];
  const mein = [w(1), w(2, { feuerwiderstand: "F90" }), w(3)];
  const fremd = [w(1, { feuerwiderstand: "F60" }), w(2), w(3), w(4)];
  const r = feldDreiWege(basis, mein, fremd);
  assert.equal(r.art, "zusammen");
  assert.deepEqual(r.wert.map((/** @type {any} */ e) => [e._idx, e.feuerwiderstand ?? null]), [[1, "F60"], [2, "F90"], [3, null], [4, null]]);
  const beide = feldDreiWege(basis, [w(1), w(2, { feuerwiderstand: "F90" }), w(3)], [w(1), w(2, { feuerwiderstand: "F30" }), w(3)]);
  assert.equal(beide.art, "konflikt");
  assert.equal(beide.konflikte.length, 1);
  assert.equal(beide.konflikte[0].schluessel, "_idx:2");
  assert.equal(beide.wert[1].feuerwiderstand, "F90", "until the person decides, this device keeps its own version");
  // deleted on one side, changed on the other: a conflict, not a silent loss
  const weg = feldDreiWege(basis, [w(1), w(3)], [w(1), w(2, { status: "abriss" }), w(3)]);
  assert.equal(weg.konflikte.length, 1);
  assert.equal(weg.konflikte[0].mein, undefined);
  // deleted on one side, untouched on the other: gone
  assert.deepEqual(feldDreiWege(basis, basis, [w(1), w(3)]).wert.map((/** @type {any} */ e) => e._idx), [1, 3]);
  // a list without keys cannot be merged per element
  assert.equal(feldDreiWege([1], [2], [3]).konflikte[0].schluessel, null);
});

// ------------------------------------------------------------------------------------------------ BIM studio side

test("fremdeElementeAbgleichen: takes over, keeps, reports, and the note carries the origin of the confirmed step", () => {
  const marke = { herkunft: "agent", herkunft_quellen: ["sprache", "agent"], befehl_text: "f90 bitte", zeit: "z", vorschlag_id: "v9", bestaetigt_durch: "hand", satz: "Wand #1: Feuerwiderstand — → F90" };
  const vorher = { customWalls: [w(1), w(2)], dachform: "flach" };
  const patch = { customWalls: [w(1, { feuerwiderstand: "F90", geaendert_durch: marke }), w(2)], dachform: "sattel" };
  const lokal = { customWalls: [w(1), w(2, { status: "abriss" })], dachform: "flach" };
  const r = fremdeElementeAbgleichen({ patch, vorher, lokal, felder: ["customWalls", "dachform"] });
  assert.deepEqual(r.konflikte, {});
  assert.equal(r.setzen.customWalls[0].feuerwiderstand, "F90");
  assert.equal(r.setzen.customWalls[1].status, "abriss", "my unsaved edit of another wall stays");
  assert.equal(r.setzen.dachform, "sattel");
  const zeilen = aenderungsZeilen(r.geaendert, r.einzel);
  assert.equal(zeilen[0].text, "Wand #1: Feuerwiderstand — → F90", "the sentence confirmed on the other device");
  assert.deepEqual(zeilen[0].herkunft, ["sprache", "agent"]);
  assert.equal(zeilen[0].bestaetigt_durch, "hand");
  assert.equal(zeilen[1].text, "Dachform: geändert");
  // a manual edit without a new mark names the changed properties and claims no origin
  const hand = aenderungsZeilen(fremdeElementeAbgleichen({ patch: { customWalls: [w(1, { height: 4 })] }, vorher: { customWalls: [w(1)] }, lokal: { customWalls: [w(1)] }, felder: ["customWalls"] }).geaendert);
  assert.deepEqual(hand, [{ text: "Wand #1: height", herkunft: null, bestaetigt_durch: null }]);
});

test("conflict of one wall: both versions in words, 'mine' keeps it, 'theirs' puts the foreign wall in place", () => {
  const vorher = { customWalls: [w(1), w(2)] };
  const lokal = { customWalls: [w(1, { feuerwiderstand: "F90" }), w(2)] };
  const patch = { customWalls: [w(1, { feuerwiderstand: "F30" }), w(2)] };
  const r = fremdeElementeAbgleichen({ patch, vorher, lokal, felder: ["customWalls"] });
  assert.equal(r.konflikte.customWalls.length, 1);
  assert.equal(r.setzen.customWalls, undefined, "nothing to set: mine stays on screen");
  const zeilen = konfliktZeilen("customWalls", r.konflikte.customWalls);
  assert.deepEqual(zeilen, [{ schluessel: "_idx:1", name: "Wand #1", mein: "feuerwiderstand F90", fremd: "feuerwiderstand F30" }]);
  assert.equal(konfliktAufloesen(lokal.customWalls, r.konflikte.customWalls, "mein"), lokal.customWalls);
  const fremd = konfliktAufloesen(lokal.customWalls, r.konflikte.customWalls, "fremd");
  assert.equal(fremd[0].feuerwiderstand, "F30");
  assert.equal(fremd.length, 2);
});

test("vorschlaegeNeuPruefen counts the proposals that became stale (Veraltet), and does nothing without open ones", () => {
  /** @type {string[]} */ const aufrufe = [];
  const reg = (/** @type {any[]} */ offen, /** @type {any[]} */ geprueft) => ({ ausfuehren: (/** @type {string} */ id) => {
    aufrufe.push(id);
    return id === "vorschlaege" ? { ok: true, result: { offen } } : { ok: true, result: geprueft };
  } });
  assert.equal(vorschlaegeNeuPruefen(reg([], [])), 0);
  assert.deepEqual(aufrufe, ["vorschlaege"], "no check without open proposals");
  assert.equal(vorschlaegeNeuPruefen(reg([{}, {}], [
    { gesperrt: true, pruefung: { saetze: ["Veraltet: Wand #1 hat sich seit dem Vorschlag verändert"] } },
    { gesperrt: true, pruefung: { saetze: ["Tragende Wand ohne Statikvermerk"] } },
  ])), 1);
});

test("abgleichStand: newest notes first (at most five), one conflict per field, resolved only through its resolver", async () => {
  const s = abgleichStandNeu();
  for (let i = 0; i < 7; i++) s.hinweisHinzu({ geraet: null, zeilen: [{ text: `h${i}` }] });
  assert.equal(s.stand().hinweise.length, 5);
  assert.equal(s.stand().hinweise[0].zeilen[0].text, "h6");
  /** @type {string[]} */ const gewaehlt = [];
  const k = { quelle: "bim", projektId: "P", feld: "customWalls", titel: "Wände", geraet: { name: "Tablett" }, zeilen: [],
    loesen: { mein: () => { gewaehlt.push("mein"); }, fremd: () => { gewaehlt.push("fremd"); } } };
  const id = s.konfliktMelden(k);
  s.konfliktMelden({ ...k, titel: "Wände (neu)" });
  assert.equal(s.stand().konflikte.length, 1, "the same field again replaces the card");
  assert.equal(JSON.stringify(s.fuerTest()).includes("loesen"), false, "test data carry no functions");
  await s.konfliktLoesen(id, "fremd");
  assert.deepEqual(gewaehlt, ["fremd"]);
  assert.equal(s.stand().konflikte.length, 0);
  await assert.rejects(s.konfliktLoesen(id, "mein"), /schon geklärt/);
});

// ------------------------------------------------------------------------------------------------ IFC journal side

test("journal: an entry of another device joins; the same property changed from the same value on both is a conflict", () => {
  const meins = { id: "m1", eigen: true, project_id: "P", modell: "m.ifc", guid: "G1", pset: "Pset_WallCommon", eigenschaft: "FireRating", alt: "F30", wert: "F90", zeit: "2026-10-25T10:00:01.000Z" };
  const eigen = (/** @type {any} */ x) => x.eigen === true;
  const fremd = { id: "f1", project_id: "P", modell: "m.ifc", guid: "G1", pset: "Pset_WallCommon", eigenschaft: "FireRating", alt: "F30", wert: "F60", zeit: "2026-10-25T10:00:02.000Z", herkunft: "sprache", bestaetigt_durch: "hand" };
  const r = journalFremdAnwenden([meins], { art: "angelegt", id: "f1" }, fremd, { modell: "m.ifc", eigen });
  assert.equal(r.journal.length, 2);
  assert.ok(r.konflikt);
  assert.equal(r.konflikt?.mein.wert, "F90");
  assert.equal(r.zeile?.text, "FireRating (Pset_WallCommon) an G1: F30 → F60");
  assert.deepEqual(r.zeile?.herkunft, ["sprache"]);
  // built on top of mine (alt = my value): no conflict
  const darauf = journalFremdAnwenden([meins], { art: "angelegt", id: "f2" }, { ...fremd, id: "f2", alt: "F90", wert: "F120" }, { modell: "m.ifc", eigen });
  assert.equal(darauf.konflikt, null);
  // another model is not this viewer's business; a deletion removes the entry
  assert.equal(journalFremdAnwenden([meins], { art: "angelegt", id: "f3" }, { ...fremd, id: "f3", modell: "anderes.ifc" }, { modell: "m.ifc", eigen }).geaendert, false);
  const weg = journalFremdAnwenden(r.journal, { art: "geloescht", id: "f1" }, null, { modell: "m.ifc", eigen });
  assert.deepEqual(weg.journal.map((x) => x.id), ["m1"]);
  assert.equal(weg.zeile?.zurueck, true);
  // the decision is a NEW entry from the value in force to the chosen one (origin hand), or nothing when it is in force
  const e = entscheidungsEintrag(r.journal, /** @type {any} */ (r.konflikt), "mein", { zeit: "2026-10-25T10:01:00.000Z" });
  assert.deepEqual({ alt: e?.alt, wert: e?.wert, herkunft: e?.herkunft, bestaetigt_durch: e?.bestaetigt_durch }, { alt: "F60", wert: "F90", herkunft: "hand", bestaetigt_durch: "hand" });
  assert.equal(entscheidungsEintrag(r.journal, /** @type {any} */ (r.konflikt), "fremd"), null, "the foreign value (newest) is already in force");
});

// ------------------------------------------------------------------------------------------------ client save path

test("saveBimModel: no write for unchanged fields, the base goes along; a foreign version is taken in only when newer", async () => {
  const altFetch = globalThis.fetch;
  const T0 = "2026-10-25T10:00:00.000Z", T2 = "2026-10-25T10:06:00.000Z";
  const gespeichert = { id: "bm9", project_id: "p10609", updated_date: T0, storeys: 3, customWalls: [w(1), w(2)], dachform: "flach" };
  /** @type {any[]} */ const puts = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
    if ((opt.method || "GET") === "GET") return { ok: true, status: 200, headers: { get: () => null }, json: async () => [gespeichert] };
    puts.push({ url: String(url), body: JSON.parse(opt.body), client: opt.headers?.["X-Bit-Client"] });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...gespeichert, ...JSON.parse(opt.body), updated_date: T2 }) };
  });
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("p10609");
    await sync.saveBimModel("p10609", { storeys: 3, dachform: "flach" });
    assert.equal(puts.length, 0, "no write for nothing (no echo of a change that just arrived)");
    await sync.saveBimModel("p10609", { storeys: 4, dachform: "flach" });
    assert.equal(puts.length, 1);
    assert.deepEqual(Object.keys(puts[0].body).sort(), ["project_id", "storeys"]);
    assert.ok(puts[0].url.includes(`stand=${encodeURIComponent(T0)}`), "the write names its base");
    assert.match(String(puts[0].client), /^[A-Za-z0-9_-]{22}$/, "every request names its tab");
    /** @type {any[]} */ const gehoert = [];
    const ab = sync.aufFremdenStand((pid, f) => { gehoert.push([pid, Object.keys(f.patch).sort(), f.vorher.dachform, f.geraet?.name]); return []; });
    // not newer than the base (T2 after the own write): ignored
    assert.deepEqual(await sync.fremdenStandUebernehmen("p10609", { ...gespeichert, updated_date: "2026-10-25T09:00:00.000Z", dachform: "walm" }), []);
    // newer: the changed fields go to the holders, the base moves on
    const felder = await sync.fremdenStandUebernehmen("p10609", { ...gespeichert, storeys: 4, updated_date: "2026-10-25T10:07:00.000Z", dachform: "sattel" }, { geraet: { name: "Tablett" } });
    ab();
    assert.deepEqual(felder, ["dachform"]);
    assert.deepEqual(gehoert, [["p10609", ["dachform"], "flach", "Tablett"]]);
    // the next save builds on the foreign version and does not write its value back
    await sync.saveBimModel("p10609", { dachform: "sattel", storeys: 4 });
    assert.equal(puts.length, 1, "the value that arrived is not echoed");
    await sync.saveBimModel("p10609", { storeys: 6 });
    assert.ok(puts[1].url.includes(encodeURIComponent("2026-10-25T10:07:00.000Z")));
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("saveBimModel race: 409 → only-mine fields written on the new base, a field both changed and nobody merges is held back", async () => {
  const altFetch = globalThis.fetch;
  const T0 = "2026-10-25T11:00:00.000Z", T1 = "2026-10-25T11:05:00.000Z", T2 = "2026-10-25T11:06:00.000Z";
  const gespeichert = { id: "bmR", project_id: "pRace", updated_date: T0, storeys: 3, customWalls: [w(1), w(2)], dachform: "flach", netz_layer: { a: 1 } };
  const fremd = { ...gespeichert, updated_date: T1, customWalls: [w(1, { feuerwiderstand: "F60" }), w(2)], dachform: "pult", netz_layer: { a: 2 } };
  /** @type {any[]} */ const puts = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
    const u = String(url);
    if ((opt.method || "GET") === "GET") return { ok: true, status: 200, headers: { get: () => null }, json: async () => [gespeichert] };
    puts.push({ url: u, body: JSON.parse(opt.body) });
    if (u.includes(`stand=${encodeURIComponent(T0)}`)) return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ konflikt: true, gespeichert: fremd }) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...fremd, ...JSON.parse(opt.body), updated_date: T2 }) };
  });
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
    await sync.loadBimModel("pRace");
    /** @type {any[]} */ const gehoert = [];
    // a holder (like the BIM studio) merges customWalls itself
    const ab = sync.aufFremdenStand((pid, f) => {
      gehoert.push(Object.keys(f.patch).sort());
      return "customWalls" in f.patch ? ["customWalls"] : [];
    });
    // this page changed wall 2, the storeys and the net layer; the other device wall 1, the roof and the net layer
    await sync.saveBimModel("pRace", { customWalls: [w(1), w(2, { status: "abriss" })], storeys: 5, netz_layer: { a: 3 } });
    ab();
    assert.equal(puts.length, 2, "refused once, then written on the new base");
    assert.ok(puts[1].url.includes(`stand=${encodeURIComponent(T1)}`));
    assert.deepEqual(Object.keys(puts[1].body).sort(), ["project_id", "storeys"], "only the field nobody else touched");
    assert.deepEqual(gehoert, [["customWalls", "dachform", "netz_layer"]], "the holder heard the foreign version");
    const k = abgleichStand.stand().konflikte.find((x) => x.feld === "netz_layer");
    assert.ok(k, "the net layer (both changed, nobody merges) is a conflict with both versions");
    assert.equal(sync.feldGesperrt("pRace", "netz_layer"), true, "held back until the decision");
    assert.equal(abgleichStand.stand().konflikte.some((x) => x.feld === "customWalls"), false, "the holder's field is its own business");
    // held back: a later save of the layer does not go out
    await sync.saveBimModel("pRace", { netz_layer: { a: 4 } });
    assert.equal(puts.length, 2);
    // the person keeps her version: released and written - review 106-09: the NEWEST value this page tried to save
    // while the card was open (a: 4), not the one at the moment of the conflict (a: 3)
    await abgleichStand.konfliktLoesen(/** @type {any} */ (k).id, "mein");
    assert.equal(sync.feldGesperrt("pRace", "netz_layer"), false);
    assert.equal(puts.length, 3);
    assert.deepEqual(puts[2].body.netz_layer.a, 4);
  } finally {
    globalThis.fetch = altFetch;
  }
});
