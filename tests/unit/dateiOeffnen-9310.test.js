// Unit tests for plan 93-10 (.bitproj file association): the pure merges of projektDateiFormat.js
// (keep-what-the-file-lacks, add-as-copy with id rewrite), server/dateiOeffnenRouter.js (launcher route
// with secret + header rules, staged import, apply as replace/copy, save back with conflict detection,
// atomic write, token expiry, loopback guard) and the data helpers of tools/datei-oeffnen.mjs.
// Everything runs in a throw-away temp folder; no browser, no registry, no real data folder.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import express from "express";

import { createDb } from "../../packages/nova-core/server/db.js";
import { mitBehaltenem, kopieAnfuegen, vorhandeneProjekte, serialisiereProjekt } from "@core/api/projektDateiFormat.js";
import {
  dateiOeffnenRouter, dateiEinlesen, pfadPruefen, kopieName, SCHLUESSEL_DATEI, QUELLE_DATEI, TOKEN_MS,
  bytesEinlesen,
} from "../../server/dateiOeffnenRouter.js";
import { anfrage, argumenteLesen, schluesselKandidaten, startBefehl } from "../../tools/datei-oeffnen.mjs";
import { fensterBefehl } from "../../tools/app-fenster.mjs";

const PORT_APP = 4799;
const APP = `http://localhost:${PORT_APP}`;

/** A project file as the browser export writes it (gzip). */
function bitproj(daten, extra = {}) {
  const obj = { ...serialisiereProjekt(daten, "Musterhaus"), ...extra };
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
}

describe("projektDateiFormat merges (93-10)", () => {
  it("mitBehaltenem keeps collections, Setting keys and Document areas the file lacks", () => {
    const vorher = { Project: [{ id: "a" }], Buchung: [{ id: "b" }], Setting: [{ key: "x", v: 1 }, { key: "y", v: 1 }], Document: [{ id: "d1", bereich: "buero" }] };
    const datei = { Project: [{ id: "n" }], Setting: [{ key: "y", v: 2 }], Document: [{ id: "d2", bereich: "projekt" }] };
    const neu = mitBehaltenem(vorher, datei, { behalte: ["Buchung"], behalteSettingKeys: ["x"], behalteDokumentBereiche: ["buero"] });
    assert.deepEqual(neu.Project, [{ id: "n" }]);
    assert.deepEqual(neu.Buchung, [{ id: "b" }]);
    assert.deepEqual(neu.Setting.map((s) => `${s.key}${s.v}`).sort(), ["x1", "y2"]);
    assert.deepEqual(neu.Document.map((d) => d.id).sort(), ["d1", "d2"]);
    assert.equal(mitBehaltenem(vorher, datei), datei, "no options: the file as is");
  });

  it("kopieAnfuegen gives fresh ids, rewrites references and id keys, skips office data", () => {
    let n = 0;
    const lokal = { Project: [{ id: "p1", name: "Alt" }], Setting: [{ id: "s0", key: "k" }] };
    const datei = {
      Project: [{ id: "p1", name: "Alt" }],
      Room: [{ id: "r1", project_id: "p1", nachbarn: ["r2"], werte: { p1: 3 } }, { id: "r2", project_id: "p1" }],
      Setting: [{ id: "s1", key: "k" }],
      Din276Katalog: [{ id: "k1", scope: "buero" }],
      Buchung: [{ id: "b1" }],
      Document: [{ id: "d1", bereich: "buero", project_id: "p1" }, { id: "d2", bereich: "projekt", project_id: "p1" }],
    };
    const { daten, kopiert } = kopieAnfuegen(lokal, datei, { ohne: ["Buchung"], ohneDokumentBereiche: ["buero"], idFabrik: () => `neu${++n}` });
    assert.equal(kopiert, 4, "project, 2 rooms, 1 document");
    assert.deepEqual(daten.Project.map((p) => [p.id, p.name]), [["p1", "Alt"], ["neu1", "Alt (Kopie)"]]);
    const [r1, r2] = daten.Room;
    assert.equal(r1.project_id, "neu1");
    assert.deepEqual(r1.nachbarn, [r2.id]);
    assert.deepEqual(r1.werte, { neu1: 3 }, "id-keyed map rewritten");
    assert.deepEqual(daten.Setting, lokal.Setting, "settings stay local");
    assert.equal(daten.Din276Katalog, undefined, "office catalogue not copied");
    assert.equal(daten.Buchung, undefined, "office area not copied");
    assert.deepEqual(daten.Document.map((d) => d.bereich), ["projekt"]);
    assert.equal(lokal.Project.length, 1, "input not mutated");
  });

  it("vorhandeneProjekte finds the re-opened project by id", () => {
    assert.deepEqual(vorhandeneProjekte({ Project: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] }, ["p2"]), [{ id: "p2", name: "B" }]);
  });
});

describe("dateiOeffnenRouter (93-10)", () => {
  /** @type {string} */ let tmp;
  /** @type {string} */ let daten;
  /** @type {any} */ let db;
  /** @type {import('node:http').Server} */ let srv;
  let port = 0;
  let uhr = Date.now();

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-9310-"));
    daten = path.join(tmp, "daten");
    fs.mkdirSync(daten);
    db = createDb(path.join(daten, "db.json"));
    db._reset({ Project: [{ id: "lokal1", name: "Bestand" }] });
    const app = express();
    app.use(express.json());
    app.use("/api", dateiOeffnenRouter({ db, lokalGebunden: true, port: PORT_APP, datenOrdnerFn: () => daten, jetzt: () => uhr }));
    srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    port = /** @type {any} */ (srv.address()).port;
  });
  after(() => {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const schluessel = () => fs.readFileSync(path.join(daten, SCHLUESSEL_DATEI), "utf8");
  const oeffnen = (pfad, kopf = {}) => {
    const body = JSON.stringify({ pfad });
    return anfrage({ port, methode: "POST", pfad: "/api/datei/oeffnen", body, kopf: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "x-bit-schluessel": schluessel(), ...kopf } });
  };
  const app = (pfad, methode = "POST", body) => fetch(`http://127.0.0.1:${port}/api${pfad}`, {
    method: methode, headers: { Origin: APP, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });

  it("launcher route: secret required, browser headers refused, secret used once", async () => {
    const datei = path.join(tmp, "Musterhaus.bitproj");
    fs.writeFileSync(datei, bitproj({ Project: [{ id: "p1", name: "Muster" }] }));
    assert.equal((await oeffnen(datei, { "x-bit-schluessel": "falsch" })).status, 403);
    assert.equal((await oeffnen(datei, { origin: "https://evil.example" })).status, 403, "Origin");
    assert.equal((await oeffnen(datei, { "sec-fetch-site": "cross-site" })).status, 403, "Sec-Fetch-Site");
    const alt = schluessel();
    const ok = await oeffnen(datei);
    assert.equal(ok.status, 200);
    assert.match(ok.json.pfad, /^\/\?import=[a-f0-9]{64}$/);
    assert.notEqual(schluessel(), alt, "secret rotated");
    assert.equal((await oeffnen(datei, { "x-bit-schluessel": alt })).status, 403, "old secret dead");
  });

  it("launcher route: path rules (relative, extension, missing, not a project file)", async () => {
    assert.equal((await oeffnen("relativ.bitproj")).status, 400);
    const txt = path.join(tmp, "a.txt");
    fs.writeFileSync(txt, "x");
    assert.equal((await oeffnen(txt)).status, 400);
    assert.equal((await oeffnen(path.join(tmp, "fehlt.bitproj"))).status, 404);
    const kaputt = path.join(tmp, "kaputt.bitproj");
    fs.writeFileSync(kaputt, '{"app":"etwas"}');
    const r = await oeffnen(kaputt);
    assert.equal(r.status, 422);
    assert.match(r.json.error, /BIT-Atelier/);
  });

  it("refuses a gzip bomb above the unpack cap", async () => {
    const bombe = path.join(tmp, "bombe.bitproj");
    fs.writeFileSync(bombe, zlib.gzipSync(Buffer.alloc(200_000, 0x20)));
    await assert.rejects(dateiEinlesen(await pfadPruefen(bombe), 100_000), (e) => /** @type {any} */ (e).status === 413);
  });

  it("import → re-open detected → copy, then replace links the file, save back with conflict", async () => {
    const datei = path.join(tmp, "Wieder.bitproj");
    fs.writeFileSync(datei, bitproj({ Project: [{ id: "lokal1", name: "Bestand" }], Room: [{ id: "r1", project_id: "lokal1" }] }));
    const token = (await oeffnen(datei)).json.pfad.split("=")[1];
    const info = await (await fetch(`http://127.0.0.1:${port}/api/datei/import/${token}`)).json();
    assert.deepEqual(info.wiederOeffnen, [{ id: "lokal1", name: "Bestand" }]);
    assert.equal(info.quelle.name, "Wieder.bitproj");

    assert.equal((await fetch(`http://127.0.0.1:${port}/api/datei/import/${token}/uebernehmen`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"modus":"kopie"}' })).status, 403, "no app Origin");
    const kopie = await (await app(`/datei/import/${token}/uebernehmen`, "POST", { modus: "kopie" })).json();
    assert.equal(kopie.kopiert, 2);
    assert.deepEqual(db._raw().Project.map((p) => p.name), ["Bestand", "Bestand (Kopie)"]);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/datei/import/${token}`)).status, 404, "token consumed");
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/datei/quelle`)).json()).quelle, null, "a copy links nothing");

    const t2 = (await oeffnen(datei)).json.pfad.split("=")[1];
    const ersetzt = await (await app(`/datei/import/${t2}/uebernehmen`, "POST", { modus: "ersetzen", behalte: ["Buchung"] })).json();
    assert.equal(ersetzt.ok, true);
    assert.ok(fs.existsSync(path.join(daten, "vor-import", ersetzt.sicherung)), "pre-import copy");
    assert.deepEqual(db._raw().Project.map((p) => p.name), ["Bestand"]);
    const q = JSON.parse(fs.readFileSync(path.join(daten, QUELLE_DATEI), "utf8"));
    assert.equal(q.pfad, fs.realpathSync.native(datei));
    assert.equal(JSON.stringify(db._raw()).includes(fs.realpathSync.native(tmp).replace(/\\/g, "\\\\")), false, "the path never enters the database");

    // Unchanged file → written back (gzip, readable, no .tmp left).
    db._raw().Project[0].name = "Bestand geändert";
    let r = await app("/datei/zurueckschreiben", "POST", {});
    assert.equal(r.status, 200);
    let gelesen = await dateiEinlesen(datei);
    assert.equal(gelesen.obj.daten.Project[0].name, "Bestand geändert");
    assert.equal(fs.existsSync(`${datei}.tmp`), false);

    // Someone else changed the file → konflikt, then "as copy" and "overwrite".
    fs.writeFileSync(datei, bitproj({ Project: [{ id: "lokal1", name: "Fremd" }] }));
    r = await app("/datei/zurueckschreiben", "POST", {});
    assert.equal(r.status, 200);
    assert.deepEqual([(await r.json()).konflikt, fs.readFileSync(datei).length > 0], ["geaendert", true], "conflict reported, nothing written");
    const alsKopie = await (await app("/datei/zurueckschreiben", "POST", { entscheidung: "kopie" })).json();
    assert.match(path.basename(alsKopie.pfad), /^Wieder \(Kopie \d{4}-\d\d-\d\d \d{4}\)\.bitproj$/);
    assert.equal((await dateiEinlesen(datei)).obj.daten.Project[0].name, "Fremd", "original untouched");
    // The link now points at the copy, which is unchanged → plain save works.
    assert.equal((await app("/datei/zurueckschreiben", "POST", {})).status, 200);
    fs.writeFileSync(alsKopie.pfad, "{}");
    assert.equal((await app("/datei/zurueckschreiben", "POST", { entscheidung: "ueberschreiben" })).status, 200);
    gelesen = await dateiEinlesen(alsKopie.pfad);
    assert.equal(gelesen.obj.daten.Project[0].name, "Bestand geändert");
  });

  it("tokens expire and can be cancelled", async () => {
    const datei = path.join(tmp, "Ablauf.bitproj");
    fs.writeFileSync(datei, bitproj({ Project: [] }));
    const t1 = (await oeffnen(datei)).json.pfad.split("=")[1];
    uhr += TOKEN_MS + 1;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/datei/import/${t1}`)).status, 404);
    const t2 = (await oeffnen(datei)).json.pfad.split("=")[1];
    assert.equal((await app(`/datei/import/${t2}`, "DELETE")).status, 204);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/datei/import/${t2}`)).status, 404);
  });

  it("kopieName picks a free name next to the source", () => {
    const quelle = path.join(tmp, "Haus.bitproj");
    const jetzt = new Date(2026, 9, 12, 22, 15);
    const erster = kopieName(quelle, jetzt);
    assert.equal(path.basename(erster), "Haus (Kopie 2026-10-12 2215).bitproj");
    fs.writeFileSync(erster, "x");
    assert.equal(path.basename(kopieName(quelle, jetzt)), "Haus (Kopie 2026-10-12 2215 2).bitproj");
  });

  it("everything is 403 when the API is not loopback-only", async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use("/api", dateiOeffnenRouter({ db, lokalGebunden: false, port: 1, datenOrdnerFn: () => daten }));
    const s2 = app2.listen(0, "127.0.0.1");
    await new Promise((r) => s2.once("listening", r));
    try {
      const p2 = /** @type {any} */ (s2.address()).port;
      assert.equal((await fetch(`http://127.0.0.1:${p2}/api/datei/quelle`)).status, 403);
      assert.equal((await anfrage({ port: p2, methode: "POST", pfad: "/api/datei/oeffnen", body: "{}", kopf: { "content-type": "application/json", "content-length": "2" } })).status, 403);
    } finally {
      s2.close();
    }
  });

  it("everything is 403 for a paired LAN device of the office mode (93-03)", async () => {
    const app3 = express();
    app3.use(express.json());
    app3.use((req, _res, next) => { /** @type {any} */ (req).bitZugang = { lokal: false }; next(); });
    app3.use("/api", dateiOeffnenRouter({ db, lokalGebunden: true, port: 1, datenOrdnerFn: () => daten, anfrageEntfernt: (req) => req.bitZugang?.lokal === false }));
    const s3 = app3.listen(0, "127.0.0.1");
    await new Promise((r) => s3.once("listening", r));
    try {
      const p3 = /** @type {any} */ (s3.address()).port;
      assert.equal((await fetch(`http://127.0.0.1:${p3}/api/datei/quelle`)).status, 403);
      assert.equal((await fetch(`http://127.0.0.1:${p3}/api/datei/zurueckschreiben`, { method: "POST", headers: { Origin: "http://localhost:1" } })).status, 403);
    } finally {
      s3.close();
    }
  });

  it("93-13: export as .bitproj (same origin only), upload opens the preview without a source path", async () => {
    const basis = `http://127.0.0.1:${port}/api`;
    assert.equal((await fetch(`${basis}/datei/export`, { headers: { Origin: "https://evil.example" } })).status, 403, "foreign origin");
    const ex = await fetch(`${basis}/datei/export`, { headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get("content-disposition") || "", /\.bitproj"/);
    const bytes = Buffer.from(await ex.arrayBuffer());
    const gelesen = await bytesEinlesen(bytes, { groesse: bytes.length, mtimeMs: 0 });
    assert.ok(Array.isArray(gelesen.obj.daten.Project), "export carries the projects");
    assert.equal((await fetch(`${basis}/datei/hochladen`, { method: "POST", headers: { Origin: "https://evil.example", "content-type": "application/octet-stream" }, body: bytes })).status, 403);
    const up = await fetch(`${basis}/datei/hochladen`, { method: "POST", headers: { Origin: APP, "content-type": "application/octet-stream" }, body: bytes });
    assert.equal(up.status, 200);
    assert.match((await up.json()).pfad, /^\/\?import=[a-f0-9]{64}$/);
    const kaputt = await fetch(`${basis}/datei/hochladen`, { method: "POST", headers: { Origin: APP, "content-type": "application/octet-stream" }, body: Buffer.from("kein projekt") });
    assert.equal(kaputt.status, 422);
  });
});

describe("launcher helpers (93-10)", () => {
  it("reads its arguments", () => {
    const o = argumenteLesen(["C:\\Users\\Nutzer\\Haus.bitproj", "--port", "3029", "--app-url", "http://localhost:5199/", "--kein-browser"], {});
    assert.deepEqual(o, { datei: "C:\\Users\\Nutzer\\Haus.bitproj", port: 3029, appUrl: "http://localhost:5199", keinBrowser: true, keinStart: false });
    assert.equal(argumenteLesen([], { API_PORT: "4000" }).port, 4000);
  });

  it("looks for the secret where the server writes it", () => {
    const w = path.resolve("/app");
    assert.deepEqual(schluesselKandidaten(w, {}), [path.join(w, "daten", ".oeffnen-schluessel"), path.join(w, "server", ".oeffnen-schluessel")]);
    assert.equal(schluesselKandidaten(w, { BIT_DATA_DIR: path.join(w, "x") })[0], path.join(w, "x", ".oeffnen-schluessel"));
  });

  it("starts the server like the shortcut and opens the browser without a shell (helpers shared with 93-11)", () => {
    const w = "C:\\Users\\Nutzer\\AppData\\Local\\BIT-Atelier";
    const s = startBefehl(w, "win32");
    assert.equal(s.programm, "cmd.exe");
    assert.equal(s.verbatim, true);
    assert.equal(s.args.at(-1), `"start "BIT-Atelier" "${path.join(w, "start-windows.cmd")}""`);
    assert.equal(startBefehl("/home/nutzer/BIT-Atelier", "linux").programm, "sh");
    // 93-11: without Edge/Chrome (or with BIT_FENSTER=0) the default browser, never through a shell.
    const ohne = { env: { BIT_FENSTER: "0" }, datenOrdner: "/x", vorhanden: () => false };
    assert.deepEqual(fensterBefehl("http://localhost:3001/?import=ab", { ...ohne, plattform: "win32" }), { programm: "rundll32.exe", args: ["url.dll,FileProtocolHandler", "http://localhost:3001/?import=ab"], art: "browser" });
    assert.equal(fensterBefehl("u", { ...ohne, plattform: "darwin" }).programm, "open");
    assert.equal(fensterBefehl("u", { ...ohne, plattform: "linux" }).programm, "xdg-open");
  });
});
