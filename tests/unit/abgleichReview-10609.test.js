// 106-09 review fixes: a revoked / expired device or office mode off ends the stream (real Express app with the office
// gate and a device token), the hub's buffer and close functions, save locks that live as long as their conflict card,
// the old base of fields no holder takes over (no silent overwrite by a stale holder), "keep mine" writes the newest
// value, renumbering of two new elements with the same number, the XR panel line, the journal after a gap, the
// read-only test hook and the source filter of the conflict store.

import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter } from "../../packages/nova-core/server/routes.js";
import { aenderungsStrom, aenderungenMelden, aenderungsRouter, ereignisAusSchreiben, vermutlichKlein } from "../../server/aenderungsStrom.js";
import { bueroWaechter, bueroRouter } from "../../server/bueroRouter.js";
import { createBuero, TOKEN_GUELTIG_MS } from "../../server/bueroModus.js";
import { abgleichStandNeu, abgleichZeigen } from "@core/lib/abgleich/abgleichStand";
import { neueKollisionenUmnummern, feldName } from "@core/lib/abgleich/modellAbgleich";
import { naechstePause, WIEDER_PAUSEN_MS } from "@core/lib/abgleich/stromClient";
import { tafelInhalt } from "@core/lib/zeigen/xrTafel";
import { journalLuecke, journalZeile } from "@ifc/lib/journalAbgleich";

/** @param {() => boolean} bedingung @param {number} [ms] */
const warten = async (bedingung, ms = 3000) => {
  const ende = Date.now() + ms;
  while (!bedingung()) {
    if (Date.now() > ende) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 15));
  }
};

// ------------------------------------------------------------------------------------------------ server: access ends

describe("office mode: the stream of a device ends when its access ends (real gate, real token)", () => {
  /** @type {any} */ let db;
  /** @type {http.Server} */ let srv;
  let port = 0;
  let tmp = "";
  let uhr = Date.parse("2026-10-26T08:00:00.000Z");
  /** @type {ReturnType<typeof createBuero>} */ let buero;
  const strom = aenderungsStrom({ jetzt: () => new Date(uhr).toISOString() });
  const LAN = { starten: async () => ({ adressen: [], fehler: [] }), stoppen: async () => {}, adressen: () => [], fehler: () => [] };

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-10609r-"));
    db = createDb(path.join(tmp, "db.json"));
    db._reset({ Project: [{ id: "PA", name: "A" }] });
    buero = createBuero({ datei: path.join(tmp, "buero.json"), jetzt: () => uhr });
    buero.setzeAktiv(true);
    const app = express();
    // a request with x-test-adresse comes from that LAN address, everything else from this computer (loopback)
    app.use(bueroWaechter(buero, { adresseVon: (req) => String(req.headers["x-test-adresse"] || "127.0.0.1") }));
    app.use(express.json());
    const geraetVon = (/** @type {any} */ req) => req.bitZugang?.geraet ?? null;
    const nochGueltig = (/** @type {any} */ req) => req.bitZugang?.lokal === true || (buero.istAktiv() && buero.geraetGueltig(req.bitZugang?.geraet?.id));
    const beiEntzug = (/** @type {{geraet?: string, alle?: boolean}} */ w) => {
      strom.schliessenFuer((q) => (w.alle ? q.startsWith("geraet:") : q === `geraet:${w.geraet}`));
    };
    app.use("/api", bueroRouter(buero, { port: 0, appModus: false, origins: ["http://app.test"], lan: LAN, beiEntzug }));
    app.use("/api", aenderungenMelden(strom, db, { geraetVon }));
    app.use("/api", aenderungsRouter(strom, { db, geraetVon, nochGueltig, herzschlagMs: 60000 }));
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

  /** @param {string} name @returns {string} token of a newly paired device */
  const koppeln = (name) => {
    const c = buero.codeErzeugen(name);
    const r = buero.koppeln(c.code, "192.168.1.20");
    assert.ok(r.ok);
    return /** @type {any} */ (r).token;
  };
  /** @param {string|null} token @returns {Promise<{status: number|undefined, ereignisse: any[], zu: () => boolean, schliessen: () => void}>} */
  const oeffnen = (token) => new Promise((resolve, reject) => {
    /** @type {any[]} */ const ereignisse = [];
    let ende = false;
    const kopf = /** @type {Record<string, string>} */ ({ "x-test-adresse": "192.168.1.20", ...(token ? { authorization: `Bearer ${token}` } : {}) });
    const req = http.get({ host: "127.0.0.1", port, path: "/api/aenderungen?projekt=PA", headers: kopf }, (res) => {
      let puffer = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        puffer += c;
        let i;
        while ((i = puffer.indexOf("\n\n")) >= 0) {
          const block = puffer.slice(0, i); puffer = puffer.slice(i + 2);
          const n = /^event: (.*)$/m.exec(block)?.[1];
          const d = /^data: (.*)$/m.exec(block)?.[1];
          if (n && d) ereignisse.push({ name: n, daten: JSON.parse(d) });
        }
      });
      res.on("end", () => { ende = true; });
      res.on("close", () => { ende = true; });
      resolve({ status: res.statusCode, ereignisse, zu: () => ende, schliessen: () => req.destroy() });
    });
    req.on("error", reject);
  });
  /** A write on this computer (loopback). @param {string} methode @param {string} pfad @param {any} [body] @param {Record<string, string>} [kopf] */
  const senden = async (methode, pfad, body, kopf = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: methode, headers: { "content-type": "application/json", ...kopf }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  it("no token: 401, nothing held open; a valid pairing gets the stream with the server run's identity", async () => {
    const ohne = await oeffnen(null);
    assert.equal(ohne.status, 401);
    const token = koppeln("Tablett Test");
    const a = await oeffnen(token);
    assert.equal(a.status, 200);
    await warten(() => a.ereignisse.some((e) => e.name === "bereit"));
    assert.equal(a.ereignisse[0].daten.instanz, strom.instanz);
    assert.equal(a.ereignisse[0].daten.geraet.name, "Tablett Test");
    await senden("POST", "/api/entities/IfcAenderung", { project_id: "PA", modell: "m", guid: "G1", pset: "P", eigenschaft: "E", alt: null, wert: "1" });
    await warten(() => a.ereignisse.some((e) => e.name === "aenderung"));
    a.schliessen();
  });

  it("revoked on the office computer: the open stream ends at once, the next write reaches nobody", async () => {
    const token = koppeln("Brille Test");
    const a = await oeffnen(token);
    await warten(() => a.ereignisse.some((e) => e.name === "bereit"));
    const vorher = strom.anzahl("PA");
    const id = buero.geraete().find((g) => g.name === "Brille Test")?.id;
    const r = await senden("DELETE", `/api/buero/geraete/${id}`, null, { origin: "http://app.test" });
    assert.equal(r.status, 200);
    await warten(() => a.zu());
    assert.equal(strom.anzahl("PA"), vorher - 1, "the subscription is gone");
    await senden("POST", "/api/entities/IfcAenderung", { project_id: "PA", modell: "m", guid: "G2", pset: "P", eigenschaft: "E", alt: null, wert: "2" });
    await new Promise((x) => setTimeout(x, 60));
    assert.equal(a.ereignisse.filter((e) => e.name === "aenderung").length, 0, "nothing after the revocation");
  });

  it("an expired pairing gets no further event over an old connection (checked before every event)", async () => {
    const token = koppeln("Tablett Ablauf");
    const a = await oeffnen(token);
    await warten(() => a.ereignisse.some((e) => e.name === "bereit"));
    uhr += TOKEN_GUELTIG_MS + 1000;
    try {
      await senden("POST", "/api/entities/IfcAenderung", { project_id: "PA", modell: "m", guid: "G3", pset: "P", eigenschaft: "E", alt: null, wert: "3" });
      await warten(() => a.zu());
      assert.equal(a.ereignisse.filter((e) => e.name === "aenderung").length, 0);
    } finally {
      uhr -= TOKEN_GUELTIG_MS + 1000;
    }
  });

  it("office mode switched off: every device stream ends, this computer's stream stays", async () => {
    const token = koppeln("Tablett Aus");
    const geraet = await oeffnen(token);
    await warten(() => geraet.ereignisse.some((e) => e.name === "bereit"));
    /** @type {any[]} */ const lokal = [];
    const lokalReq = http.get({ host: "127.0.0.1", port, path: "/api/aenderungen?projekt=PA" }, (res) => { res.on("data", (c) => lokal.push(String(c))); });
    await warten(() => lokal.join("").includes("bereit"));
    const r = await senden("POST", "/api/buero/aktivieren", { aktiv: false }, { origin: "http://app.test" });
    assert.equal(r.status, 200);
    await warten(() => geraet.zu());
    await senden("POST", "/api/entities/IfcAenderung", { project_id: "PA", modell: "m", guid: "G4", pset: "P", eigenschaft: "E", alt: null, wert: "4" });
    await warten(() => lokal.join("").includes("G4"));
    lokalReq.destroy();
    buero.setzeAktiv(true);
  });
});

// ------------------------------------------------------------------------------------------------ hub

test("hub: an invalid holder is closed instead of served; schliessenFuer; old events leave the buffer", () => {
  let jetzt = Date.parse("2026-10-26T09:00:00.000Z");
  const strom = aenderungsStrom({ jetzt: () => new Date(jetzt).toISOString(), pufferAlterMs: 60_000 });
  /** @type {any[]} */ const a = [];
  let gueltig = true, zuA = 0, zuB = 0;
  strom.abonnieren({ projekt: "P", quelle: "geraet:g1", senden: (e) => a.push(e), gueltig: () => gueltig, schliessen: () => { zuA += 1; } });
  strom.abonnieren({ projekt: "P", quelle: "geraet:g2", senden: () => {}, schliessen: () => { zuB += 1; } });
  const e = { projekt: "P", entitaet: "BimModel", id: "1", art: /** @type {const} */ ("geaendert"), felder: [], updated_date: null, geraet: null, client: null };
  strom.melden(e);
  gueltig = false;
  strom.melden(e);
  assert.equal(a.length, 1, "nothing after the pairing became invalid");
  assert.equal(zuA, 1);
  assert.equal(strom.anzahl("P"), 1);
  assert.equal(strom.schliessenFuer((q) => q === "geraet:g2"), 1);
  assert.equal(zuB, 1);
  assert.equal(strom.anzahl(), 0);
  assert.equal(strom.gepuffert(), 1);
  jetzt += 120_000;
  strom.melden({ ...e, projekt: "Q" });
  assert.equal(strom.gepuffert(), 1, "the old project's events are gone, only Q's new one stays");
  assert.match(strom.instanz, /^[0-9a-f]{12}$/);
  // a big model is recognised by a bounded walk, never serialised for an event (no stringify of several MB per save)
  assert.equal(vermutlichKlein({ a: [1, 2, 3], b: "x" }, 16 * 1024), true);
  const gross = { customWalls: Array.from({ length: 200000 }, (_, i) => ({ _idx: i, a: { x: i, z: 0 } })) };
  const t0 = performance.now();
  assert.equal(vermutlichKlein(gross, 16 * 1024), false);
  assert.ok(performance.now() - t0 < 50, "stops after about 16 KB of work, not after 200 000 walls");
  assert.equal(ereignisAusSchreiben({ methode: "PUT", entitaet: "BimModel", id: "b", datensatz: { id: "b", project_id: "P", ...gross }, body: { customWalls: [] } })?.datensatz, undefined);
  assert.equal(ereignisAusSchreiben({ methode: "PUT", entitaet: "BimModel", id: "b", datensatz: { id: "b", project_id: "P" }, body: { x: 1 }, mitDatensatz: false })?.datensatz, undefined);
});

// ------------------------------------------------------------------------------------------------ store

test("abgleichStand: clearing by source and 'all other projects'; which sources a viewer shows; read-only hook", async () => {
  const s = abgleichStandNeu();
  const k = (/** @type {string} */ quelle, /** @type {string} */ projektId, /** @type {string} */ feld) => s.konfliktMelden({ quelle, projektId, feld, titel: feld, geraet: null, zeilen: [], loesen: { mein: () => {}, fremd: () => {} } });
  k("bim", "A", "customWalls"); k("ifc", "A", "g|p|e"); k("modell", "B", "netz_layer");
  s.hinweisHinzu({ geraet: null, zeilen: [] });
  s.leeren("A", { quellen: ["ifc"] });
  assert.deepEqual(s.stand().konflikte.map((x) => x.id), ["bim:customWalls", "modell:netz_layer"], "the IFC viewer clears only its own cards");
  assert.equal(s.stand().hinweise.length, 0);
  s.leeren("A", { ausser: true });
  assert.deepEqual(s.stand().konflikte.map((x) => x.id), ["bim:customWalls"], "opening project A drops the other projects' conflicts");
  const ab = s.anzeigeMelden("bim");
  assert.equal(s.angezeigt("bim"), true);
  ab(); ab();
  assert.equal(s.angezeigt("bim"), false);
  assert.equal(abgleichZeigen(s.stand(), ["ifc"]), false);
  assert.equal(abgleichZeigen(s.stand(), ["bim"]), true);
  s.verbindungSetzen({ status: "getrennt", projekt: "A", grund: "x" });
  assert.equal(abgleichZeigen(s.stand(), ["ifc"]), true, "a broken stream is shown");
  // the page's hook is read-only: deciding is the person's step at the card
  const { abgleichTesthaken } = await import("@core/lib/abgleich/abgleichStand");
  const altWindow = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = {};
  try {
    abgleichTesthaken();
    assert.deepEqual(Object.keys(/** @type {any} */ (globalThis).window.__bitAbgleich), ["stand"]);
  } finally {
    /** @type {any} */ (globalThis).window = altWindow;
  }
});

// ------------------------------------------------------------------------------------------------ client save path

const T0 = "2026-10-26T10:00:00.000Z";
/**
 * A fetch stand-in of the BimModel record. @param {any} gespeichert
 * @returns {{puts: any[], fetch: any, setze: (r: any) => void}}
 */
function bimServer(gespeichert) {
  let rec = gespeichert;
  /** @type {any[]} */ const puts = [];
  let n = 0;
  return {
    puts,
    setze: (r) => { rec = r; },
    fetch: async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
      if ((opt.method || "GET") === "GET") return { ok: true, status: 200, headers: { get: () => null }, json: async () => [rec] };
      const body = JSON.parse(opt.body);
      puts.push({ url: String(url), body });
      n += 1;
      rec = { ...rec, ...body, updated_date: `2026-10-26T10:${String(10 + n).padStart(2, "0")}:00.000Z` };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => rec };
    },
  };
}

test("a save lock lives as long as its conflict card: cleared card → the field is saved again", async () => {
  const srv = bimServer({ id: "bmL", project_id: "pSperre", updated_date: T0, customWalls: [] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
    await sync.loadBimModel("pSperre");
    sync.feldSperren("pSperre", "customWalls");
    abgleichStand.konfliktMelden({ quelle: "bim", projektId: "pSperre", feld: "customWalls", titel: "Wände", geraet: null, zeilen: [], loesen: { mein: () => {}, fremd: () => {} } });
    await sync.saveBimModel("pSperre", { customWalls: [{ _idx: 1 }] });
    assert.equal(srv.puts.length, 0, "held back while the card is open");
    assert.deepEqual(sync.zurueckgehaltenerWert("pSperre", "customWalls"), [{ _idx: 1 }]);
    assert.deepEqual(sync.felderZurueckgehalten("pSperre", ["customWalls", "storeys"]), ["customWalls"]);
    // the viewer closes / another project opens: the card goes - and the lock with it
    abgleichStand.leeren("pSperre");
    assert.equal(sync.feldGesperrt("pSperre", "customWalls"), false);
    await sync.saveBimModel("pSperre", { customWalls: [{ _idx: 1 }] });
    assert.equal(srv.puts.length, 1, "written again - nothing is lost silently");
    assert.deepEqual(srv.puts[0].body.customWalls, [{ _idx: 1 }]);
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("a field no holder takes over keeps its old base: a stale save is not written, a further edit is a conflict", async () => {
  const L = (/** @type {string} */ s) => ({ attribute: { "hull-wall": { status: s } } });
  const srv = bimServer({ id: "bmV", project_id: "pVorbehalt", updated_date: T0, bauteil_attribute_layer: L("neu") });
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
    await sync.loadBimModel("pVorbehalt");
    // another device sets the hull to "abriss"; no holder on this page takes the attribute layer over
    const fremd = { id: "bmV", project_id: "pVorbehalt", updated_date: "2026-10-26T10:05:00.000Z", bauteil_attribute_layer: L("abriss") };
    srv.setze(fremd);
    assert.deepEqual(await sync.fremdenStandUebernehmen("pVorbehalt", fremd, { geraet: { name: "Tablett" } }), ["bauteil_attribute_layer"]);
    // the stale holder saves its unchanged old value: not written, the other device's change stays
    await sync.saveBimModel("pVorbehalt", { bauteil_attribute_layer: L("neu") });
    assert.equal(srv.puts.length, 0, "no silent overwrite by the stale holder");
    // the stale holder changes it further: both changed the field - a conflict card, nothing written
    await sync.saveBimModel("pVorbehalt", { bauteil_attribute_layer: L("bestand") });
    assert.equal(srv.puts.length, 0);
    const k = abgleichStand.konflikt("modell:bauteil_attribute_layer");
    assert.ok(k, "a conflict with both versions");
    assert.equal(k?.titel, "Bauteil-Attribute", "the field in words, not its key");
    assert.equal(k?.geraet?.name, "Tablett");
    assert.equal(sync.feldGesperrt("pVorbehalt", "bauteil_attribute_layer"), true);
    // the holder keeps editing while the card is open; "keep mine" writes the NEWEST value
    await sync.saveBimModel("pVorbehalt", { bauteil_attribute_layer: L("erhalt") });
    assert.equal(srv.puts.length, 0);
    assert.match(String(abgleichStand.konflikt("modell:bauteil_attribute_layer")?.zeilen[0].mein), /erhalt/, "the card shows the newest own value");
    await abgleichStand.konfliktLoesen("modell:bauteil_attribute_layer", "mein");
    assert.equal(srv.puts.length, 1);
    assert.equal(srv.puts[0].body.bauteil_attribute_layer.attribute["hull-wall"].status, "erhalt");
    // afterwards the field is an ordinary field again
    await sync.saveBimModel("pVorbehalt", { bauteil_attribute_layer: L("neu") });
    assert.equal(srv.puts.length, 2);
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("'take the other device's version' for a field nobody holds: the stale value is never written back", async () => {
  const srv = bimServer({ id: "bmF", project_id: "pFremd", updated_date: T0, netz_layer: { a: 1 } });
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
    await sync.loadBimModel("pFremd");
    const fremd = { id: "bmF", project_id: "pFremd", updated_date: "2026-10-26T10:05:00.000Z", netz_layer: { a: 2 } };
    srv.setze(fremd);
    await sync.fremdenStandUebernehmen("pFremd", fremd, { geraet: null });
    await sync.saveBimModel("pFremd", { netz_layer: { a: 3 } });
    assert.ok(abgleichStand.konflikt("modell:netz_layer"));
    await abgleichStand.konfliktLoesen("modell:netz_layer", "fremd");
    assert.equal(srv.puts.length, 0, "the stored version stays");
    await sync.saveBimModel("pFremd", { netz_layer: { a: 3 } });
    assert.equal(srv.puts.length, 0, "the holder's stale value (the one the person did not choose) is not written");
    await sync.saveBimModel("pFremd", { netz_layer: { a: 2 } });
    assert.equal(srv.puts.length, 0, "the holder caught up: equal to the stored version");
    await sync.saveBimModel("pFremd", { netz_layer: { a: 5 } });
    assert.equal(srv.puts.length, 1, "an edit on the chosen version is written normally");
  } finally {
    globalThis.fetch = altFetch;
  }
});

// ------------------------------------------------------------------------------------------------ pure parts

test("two devices drew a new wall with the same _idx: this page's wall (and its window) gets a free number, both stay", () => {
  const wand = (/** @type {number} */ i, /** @type {number} */ x) => ({ _idx: i, a: { x, z: 0 }, b: { x: x + 5, z: 0 } });
  const basis = [wand(1, 0)];
  const fremd = [wand(1, 0), wand(2, 10)];
  const lokal = { customWalls: [wand(1, 0), wand(2, 20)], customWindows: [{ _idx: 3, wallIdx: 2, u: 0.5 }] };
  const r = neueKollisionenUmnummern({ vorher: { customWalls: basis }, lokal, patch: { customWalls: fremd } });
  assert.deepEqual(r.umbenannt, [[2, 4]]);
  assert.deepEqual(r.geaendert.sort(), ["customWalls", "customWindows"]);
  assert.equal(r.lokal.customWalls[1]._idx, 4);
  assert.equal(r.lokal.customWindows[0].wallIdx, 4, "the opening follows its wall");
  assert.equal(r.naechsteIdx, 5);
  // the same new element on both (identical) is no collision
  const gleich = neueKollisionenUmnummern({ vorher: { customWalls: basis }, lokal: { customWalls: fremd }, patch: { customWalls: fremd } });
  assert.deepEqual(gleich.umbenannt, []);
  // a foreign new COLUMN with the number of my new wall (the counter is shared by all lists)
  const quer = neueKollisionenUmnummern({ vorher: { customColumns: [] }, lokal: { customWalls: [wand(1, 0), wand(2, 20)] }, patch: { customColumns: [{ _idx: 2, x: 1, z: 1 }] } });
  assert.deepEqual(quer.umbenannt, [[2, 3]]);
  assert.equal(feldName("netz_layer"), "Haustechnik-Netz");
  assert.equal(feldName("customWalls"), "Wände");
  assert.equal(feldName("unbekannt_xy"), "unbekannt_xy");
});

test("XR panel: an open conflict is a solid ✕ line that says the decision is made at the screen", () => {
  const inhalt = tafelInhalt({ abgleich: { konflikte: 2, titel: "Wände", hinweis: null, getrennt: true } });
  const z = inhalt.zeilen.find((x) => x.text.includes("Konflikt mit einem anderen Gerät"));
  assert.ok(z);
  assert.equal(z?.rahmen, "durchgezogen");
  assert.match(String(z?.text), /^✕ .*Wände \(\+1\) — wird nicht gespeichert, bis Sie am Bildschirm entscheiden$/);
  assert.ok(inhalt.zeilen.some((x) => x.rahmen === "gestrichelt" && x.text.includes("unterbrochen")));
  assert.equal(tafelInhalt({}).zeilen.some((x) => /Konflikt/.test(x.text)), false);
});

test("journal after a gap: new stored entries and gone foreign ones, never an own entry on its way", () => {
  const e = (/** @type {string|undefined} */ id, /** @type {boolean} */ eigen = false) => ({ id, modell: "m", guid: "G", pset: "P", eigenschaft: "E", alt: null, wert: "1", eigen });
  const journal = [e("a"), e("b"), e(undefined, true), e("c", true)];
  const gespeichert = [e("a"), e("d")];
  const r = journalLuecke(/** @type {any} */ (journal), /** @type {any} */ (gespeichert), (x) => /** @type {any} */ (x).eigen === true);
  assert.deepEqual(r.map((x) => `${x.ereignis.art}:${x.ereignis.id}`), ["angelegt:d", "geloescht:b"]);
  const zeile = journalZeile(/** @type {any} */ ({ eigenschaft: "FireRating", pset: "Pset_WallCommon", guid: "G1", alt: "F30", wert: "F90" }), false, (s) => s.replace(" an ", " on "));
  assert.equal(zeile.text, "FireRating (Pset_WallCommon) on G1: F30 → F90", "the sentence pattern goes through the translator");
});

test("stream client: a closed stream is opened again with a growing pause", () => {
  assert.equal(naechstePause(1), WIEDER_PAUSEN_MS[0]);
  assert.ok(naechstePause(2) > naechstePause(1));
  assert.equal(naechstePause(99), WIEDER_PAUSEN_MS[WIEDER_PAUSEN_MS.length - 1]);
});
