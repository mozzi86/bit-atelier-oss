// 70-03 Task 3: one-time takeover of an earlier installation into the storage
// folder — offer rules, order of backup → replace → note, and that the offer
// never comes twice. Readers/writers are injected; nothing touches the disk.
// Plus the sync-folder warning of the storage location.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  zaehleDatensaetze, altbestandParsen, uebernahmeAngebot, uebernahmeAusfuehren, uebernahmeAblehnen, UEBERNAHME_META,
} from "../../src/client/uebernahme.js";
import { istSyncOrdner } from "../../src/client/ablage.js";

const ALT = { Project: [{ id: "p1" }, { id: "p2" }], Contact: [{ id: "c1" }], schema: 3 };

/** Injected sources with a meta store; `log` records the order of side effects. */
function quellen({ node = ALT, web = {}, ablage = {}, metaStart = {} } = {}) {
  const meta = { ...metaStart };
  const log = [];
  return {
    meta,
    log,
    q: {
      altbestandLesen: async () => (node ? { pfad: "C:/Alt/daten/db.json", text: typeof node === "string" ? node : JSON.stringify(node) } : null),
      webviewLesen: async () => web,
      ablageLesen: async () => ablage,
      meta: async (k, w) => {
        if (w === undefined) return meta[k];
        log.push(["meta", k]);
        meta[k] = w;
        return w;
      },
    },
  };
}

describe("70-03 Übernahme", () => {
  it("zählt nur Listen, parst db.json und meldet eine defekte Datei mit Pfad", () => {
    assert.equal(zaehleDatensaetze(ALT), 3);
    assert.equal(zaehleDatensaetze(null), 0);
    assert.deepEqual(Object.keys(altbestandParsen(JSON.stringify(ALT), "x")), ["Project", "Contact"]);
    assert.throws(() => altbestandParsen("{kaputt", "C:/Alt/db.json"), /beschädigt \(C:\/Alt\/db\.json\)/);
    assert.throws(() => altbestandParsen("[1,2]", "y"), /unbekanntes Format/);
  });

  it("bietet die Node-Datenbank mit der richtigen Anzahl an, wenn der Ablageort leer ist", async () => {
    const { q } = quellen();
    const a = await uebernahmeAngebot(q);
    assert.equal(a.gefunden, true);
    assert.equal(a.quelle, "node");
    assert.equal(a.datensaetze, 3);
  });

  it("fällt auf den WebView-Bestand der 70-02-Stufe zurück, wenn es keine Node-Datenbank gibt", async () => {
    const { q } = quellen({ node: null, web: { Project: [{ id: "w1" }] } });
    const a = await uebernahmeAngebot(q);
    assert.equal(a.quelle, "webview");
    assert.equal(a.datensaetze, 1);
  });

  it("kein Angebot in einen gefüllten Ablageort — und der Vermerk verhindert ein erneutes Lesen", async () => {
    const { q, meta } = quellen({ ablage: { Project: [{ id: "x" }] } });
    assert.equal((await uebernahmeAngebot(q)).gefunden, false);
    assert.equal(meta[UEBERNAHME_META].ergebnis, "uebersprungen");
    assert.equal((await uebernahmeAngebot(q)).grund, "bereits entschieden");
  });

  it("nichts gefunden → kein Angebot, kein Vermerk (eine spätere Installation kann noch kommen)", async () => {
    const { q, meta } = quellen({ node: null });
    assert.equal((await uebernahmeAngebot(q)).gefunden, false);
    assert.equal(meta[UEBERNAHME_META], undefined);
  });

  it("defekte Node-Datenbank wird geworfen, nicht verschwiegen", async () => {
    const { q } = quellen({ node: "{kaputt" });
    await assert.rejects(uebernahmeAngebot(q), /beschädigt/);
  });

  it("Ausführen: erst Sicherungskopie, dann Ersetzen, dann Vermerk — gleich viele Datensätze", async () => {
    const { q, log, meta } = quellen();
    const angebot = await uebernahmeAngebot(q);
    let ersetzt = null;
    const r = await uebernahmeAusfuehren(angebot, {
      sichernNode: async (quelle, name) => { log.push(["sichern", quelle]); return `uebernahme/${name}`; },
      sichernText: async () => { throw new Error("falscher Weg"); },
      ersetzen: async (db) => { log.push(["ersetzen"]); ersetzt = db; },
      meta: q.meta,
      jetzt: () => new Date("2026-10-12T10:00:00.000Z"),
    });
    assert.deepEqual(log.map((e) => e[0]), ["sichern", "ersetzen", "meta"]);
    assert.equal(zaehleDatensaetze(ersetzt), 3);
    assert.equal(r.datensaetze, 3);
    assert.equal(r.sicherung, "uebernahme/db-2026-10-12T10-00-00-000Z.json");
    assert.equal(meta[UEBERNAHME_META].ergebnis, "uebernommen");
    assert.equal((await uebernahmeAngebot(q)).gefunden, false);
  });

  it("WebView-Quelle wird als JSON-Text gesichert", async () => {
    const { q } = quellen({ node: null, web: { Task: [{ id: "t1" }] } });
    const angebot = await uebernahmeAngebot(q);
    let gesichert = "";
    await uebernahmeAusfuehren(angebot, {
      sichernNode: async () => { throw new Error("falscher Weg"); },
      sichernText: async (name, text) => { gesichert = text; return `uebernahme/${name}`; },
      ersetzen: async () => {},
      meta: q.meta,
    });
    assert.deepEqual(JSON.parse(gesichert), { Task: [{ id: "t1" }] });
  });

  it("schlägt die Sicherung fehl, wird nichts ersetzt und nichts vermerkt", async () => {
    const { q, meta } = quellen();
    const angebot = await uebernahmeAngebot(q);
    let ersetzt = false;
    await assert.rejects(uebernahmeAusfuehren(angebot, {
      sichernNode: async () => { throw new Error("Platte voll"); },
      sichernText: async () => "",
      ersetzen: async () => { ersetzt = true; },
      meta: q.meta,
    }), /Platte voll/);
    assert.equal(ersetzt, false);
    assert.equal(meta[UEBERNAHME_META], undefined);
  });

  it("Ablehnen wird vermerkt, das Angebot kommt nicht wieder", async () => {
    const { q, meta } = quellen();
    await uebernahmeAblehnen(await uebernahmeAngebot(q), q.meta);
    assert.equal(meta[UEBERNAHME_META].ergebnis, "abgelehnt");
    assert.equal((await uebernahmeAngebot(q)).gefunden, false);
  });
});

describe("70-03 Ablageort — Warnung vor synchronisierten Ordnern", () => {
  it("erkennt Google Drive, OneDrive, Dropbox, iCloud; lokale Ordner nicht", () => {
    assert.equal(istSyncOrdner("C:\\Users\\Nutzer\\My Drive\\BIT"), true);
    assert.equal(istSyncOrdner("G:\\Meine Ablage\\BIT"), true);
    assert.equal(istSyncOrdner("C:\\Users\\Nutzer\\OneDrive - Büro\\BIT"), true);
    assert.equal(istSyncOrdner("D:\\Dropbox\\BIT"), true);
    assert.equal(istSyncOrdner("C:\\Users\\Nutzer\\AppData\\Local\\BIT-Atelier-Ablage"), false);
    assert.equal(istSyncOrdner(null), false);
  });
});
