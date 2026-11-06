// Review 106-10 — the fixes of the review of the workplace "Modellfreigabe":
//  - the server lock on the change log / command library holds for any spelling of the entity (percent-encoded, lower case),
//  - a reversal from the page writes all or nothing (saveBimModel {streng: true}); without a written model no note, and a note that fails
//    after the model was written says so,
//  - the name of a release is the active office person, never the local sign-in stand-in,
//  - the CSV export neutralises spreadsheet formulas,
//  - a property value outside the office library is a warning in the check (also for an agent's proposal),
//  - the "eingabe" command knows the library without the speech field (loaded at registration).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter, NUR_PERSON_TEXT, nurPersonSchreibt } from "../../packages/nova-core/server/routes.js";
import { SCHRITT_ENTITY, VORLAGE_ENTITY } from "@core/lib/verlauf/entitaeten.js";
import { schrittAusEintrag } from "@core/lib/verlauf/schrittVerlauf.js";
import {
  VERMERK_FEHLT_TEXT, personName, protokollCsv, ruecknahmeAusfuehren, zelle,
} from "@core/lib/zeigen/aenderungsProtokoll.js";
import { vorschlagAusfuehren, vorschlagVorbereiten } from "@core/lib/zeigen/vorschlag.js";
import { pruefeAenderung } from "@core/lib/zeigen/pruefung.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { STANDARD_VORLAGEN, bibliothekNormen, bibliothekSetzen } from "@core/lib/zeigen/befehlsBibliothek.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { eingabeBefehlRegistrieren } from "@core/lib/zeigen/eingabe.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";

const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);
const OPT = { projektId: P, geschosshoehe_m: 3 };

/** One confirmed step through the real pipeline: new model and the stored record. */
function schritt(modell, eingabe, o) {
  const v = vorschlagVorbereiten(modell, eingabe, { ...OPT, id: o.id, zeit: o.zeit });
  const r = vorschlagAusfuehren(modell, v, { ...OPT, bestaetigt_durch: "hand", zeit: o.zeit });
  return { modell: r.modell, rec: { id: `rec-${o.id}`, ...schrittAusEintrag(r.eintrag, { projektId: P, pruefung: v.pruefung, autor: "Person A" }) } };
}

describe("review 106-10: the server lock holds for every spelling of the entity", () => {
  let tmp, server, port;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-10610r-"));
    const db = createDb(path.join(tmp, "db.json"));
    const app = express();
    app.use(express.json());
    app.use("/api", entitiesRouter(db));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
    port = server.address().port;
  });
  after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  /** A program: node:http sends neither Origin nor Sec-Fetch-*; the path goes out exactly as written (percent signs kept). */
  const programm = (pfad, method, body) => new Promise((resolve, reject) => {
    const daten = body ? JSON.stringify(body) : "";
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${pfad}`, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(daten) } }, (res) => {
      let roh = ""; res.on("data", (c) => { roh += c; }); res.on("end", () => resolve({ status: res.statusCode, json: roh ? JSON.parse(roh) : null }));
    });
    req.on("error", reject); req.end(daten);
  });

  it("percent-encoded and lower-case names are refused for writes, reads stay open", async () => {
    assert.equal(nurPersonSchreibt("aenderungsschritt"), true);
    assert.equal(nurPersonSchreibt("BimModel"), false);
    for (const pfad of ["/entities/Aenderungs%53chritt", "/entities/aenderungsschritt", "/entities/%41enderungsSchritt", "/entities/Befehls%76orlage"]) {
      const a = await programm(pfad, "POST", { project_id: P, freigabe: { status: "freigegeben", durch: "Agent" } });
      assert.equal(a.status, 403, pfad);
      assert.equal(a.json.error, NUR_PERSON_TEXT);
      assert.equal((await programm(`${pfad}/x1`, "PUT", { freigabe: {} })).status, 403, `PUT ${pfad}`);
      assert.equal((await programm(`${pfad}/x1`, "DELETE")).status, 403, `DELETE ${pfad}`);
      assert.equal((await programm(`${pfad}/bulk`, "POST", { records: [{ x: 1 }] })).status, 403, `bulk ${pfad}`);
      assert.equal((await programm(pfad, "GET")).status, 200, `GET ${pfad}`);
    }
    const gelesen = await programm(`/entities/${SCHRITT_ENTITY}`, "GET");
    assert.deepEqual(gelesen.json, [], "nothing landed");
    assert.deepEqual((await programm(`/entities/${VORLAGE_ENTITY}`, "GET")).json, []);
  });
});

describe("review 106-10: a reversal notes only what was written", () => {
  const zweiSchritte = () => {
    const w = wand(1);
    const s1 = schritt({ customWalls: [w] }, { art: "eigenschaft", ziel: { guid: guidW(w) }, params: { name: "feuerwiderstand", wert: "F90" }, herkunft: { quelle: "sprache" } }, { id: "s1", zeit: "2026-10-25T10:00:00Z" });
    return { w, s1 };
  };

  it("bimSpeichern rejects (nothing written): the step is reported and gets no note", async () => {
    const { s1 } = zweiSchritte();
    const vermerke = [];
    const r = await ruecknahmeAusfuehren([s1.rec], [s1.rec], {
      projektId: P, durch: "Prüferin", bimLaden: async () => s1.modell,
      bimSpeichern: async () => { throw Object.assign(new Error("Modell nicht geschrieben — Wände gleichzeitig an anderer Stelle geändert oder mit offenem Konflikt; bitte neu laden"), { code: "nicht_geschrieben" }); },
      journalLaden: async () => [], journalLoeschen: async () => {}, vermerken: async (id, patch) => { vermerke.push([id, patch]); return null; },
    });
    assert.equal(r.fehler.length, 1);
    assert.match(r.fehler[0].text, /Modell nicht geschrieben/);
    assert.deepEqual(r.erledigt, []);
    assert.deepEqual(vermerke, [], "no note on an unchanged model");
  });

  it("the note fails after the model was written: said in words, not a plain error", async () => {
    const { s1 } = zweiSchritte();
    let geschrieben = 0;
    const r = await ruecknahmeAusfuehren([s1.rec], [s1.rec], {
      projektId: P, durch: "Prüferin", bimLaden: async () => s1.modell, bimSpeichern: async () => { geschrieben += 1; },
      journalLaden: async () => [], journalLoeschen: async () => {}, vermerken: async () => { throw new Error("offline"); },
    });
    assert.equal(geschrieben, 1);
    assert.equal(r.fehler.length, 1);
    assert.ok(r.fehler[0].text.startsWith(VERMERK_FEHLT_TEXT), r.fehler[0].text);
    assert.match(r.fehler[0].text, /offline/);
  });

  it("saveBimModel {streng: true}: a 409 on the same field and a held-back field reject without a conflict card and without a write", async () => {
    const altFetch = globalThis.fetch;
    const T0 = "2026-10-26T10:00:00.000Z", T1 = "2026-10-26T10:05:00.000Z";
    const w1 = wand(1), w1fremd = wand(1, { feuerwiderstand: "F60" });
    const gespeichert = { id: "bmS", project_id: "pStreng", updated_date: T0, customWalls: [w1], netz_layer: { a: 1 } };
    const fremd = { ...gespeichert, updated_date: T1, customWalls: [w1fremd], netz_layer: { a: 2 } };
    /** @type {any[]} */ const puts = [];
    globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
      const u = String(url);
      if ((opt.method || "GET") === "GET") return { ok: true, status: 200, headers: { get: () => null }, json: async () => [gespeichert] };
      puts.push({ url: u, body: JSON.parse(opt.body) });
      if (u.includes(`stand=${encodeURIComponent(T0)}`)) return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ konflikt: true, gespeichert: fremd }) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...fremd, ...JSON.parse(opt.body), updated_date: "2026-10-26T10:06:00.000Z" }) };
    });
    try {
      const sync = await import("@core/lib/useBimModelSync");
      const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
      await sync.loadBimModel("pStreng");
      // the other device set the wall differently: the strict write stops, nothing of it is written again, no card
      await assert.rejects(sync.saveBimModel("pStreng", { customWalls: [wand(1, { feuerwiderstand: "F90" })] }, { streng: true }),
        (e) => e.code === "nicht_geschrieben" && /Modell nicht geschrieben/.test(e.message) && e.felder.includes("customWalls"));
      assert.equal(puts.length, 1, "only the refused attempt");
      assert.equal(abgleichStand.stand().konflikte.some((k) => k.projektId === "pStreng"), false, "no conflict card from a strict write");
      assert.equal(sync.feldGesperrt("pStreng", "customWalls"), false);
      // a non-strict save of the net layer on the same base becomes a conflict (held back) ...
      await sync.bimModelNeuLesen("pStreng");
      await sync.loadBimModel("pStreng");
      await sync.saveBimModel("pStreng", { netz_layer: { a: 3 } });
      assert.equal(sync.feldGesperrt("pStreng", "netz_layer"), true);
      const vorher = puts.length;
      // ... and a strict write of it is refused before anything goes out
      await assert.rejects(sync.saveBimModel("pStreng", { netz_layer: { a: 1 } }, { streng: true }), (e) => e.code === "nicht_geschrieben");
      assert.equal(puts.length, vorher, "no request");
    } finally {
      globalThis.fetch = altFetch;
    }
  });
});

describe("review 106-10: name, export, library", () => {
  it("the name is the active office person; locally without one it is empty (the sign-in stand-in is no person)", () => {
    assert.equal(personName({ nutzer: { name: " Prüferin A " }, datenquelle: "express" }, { full_name: "Lokaler Nutzer" }), "Prüferin A");
    assert.equal(personName({ nutzer: null, datenquelle: "express" }, { full_name: "Lokaler Nutzer" }), "");
    assert.equal(personName({ nutzer: null, datenquelle: "serverlos" }, { full_name: "Lokaler Nutzer" }), "");
    assert.equal(personName({ nutzer: null, datenquelle: "supabase" }, { full_name: "", email: "a@b.de" }), "a@b.de");
    assert.equal(personName(null, null), "");
  });

  it("CSV: a cell that starts like a formula becomes text (leading apostrophe)", () => {
    assert.equal(zelle("=HYPERLINK(\"http://x\",\"y\")"), "\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"");
    for (const v of ["+1", "-2", "@SUM(A1)", "\tx", "\rx"]) assert.ok(zelle(v).startsWith("'") || zelle(v).startsWith("\"'"), JSON.stringify(v));
    assert.equal(zelle("F90"), "F90");
    assert.equal(zelle("Wand -1"), "Wand -1", "only the first character counts");
    const csv = protokollCsv([{ id: "1", zeit: "2026-10-26T10:00:00Z", satz: "=1+1", befehl_text: "@cmd", herkunft: "agent", art: "eigenschaft", vorher: { wert: null }, nachher: { wert: "-5" } }], { jetzt: "T" });
    const zeile = csv.split("\n")[2];
    assert.ok(zeile.includes(";'=1+1;'@cmd;"), zeile);
    assert.ok(zeile.includes(";'-5;"), zeile);
  });

  it("a property value outside the office library is a warning in the check, a listed one is not", () => {
    const w = wand(1);
    const modell = { customWalls: [w] };
    const BIB = bibliothekNormen(STANDARD_VORLAGEN);
    const v = (wert) => ({ art: "eigenschaft", ziel: { guid: guidW(w) }, params: { name: "feuerwiderstand", wert } });
    const aus = pruefeAenderung(modell, v("F45"), { ...OPT, bibliothek: BIB });
    const b = aus.befunde.find((x) => x.code === "bibliothek_wert");
    assert.ok(b, JSON.stringify(aus.befunde));
    assert.equal(b.stufe, "warn");
    assert.equal(aus.stufe === "warn" || aus.stufe === "fehler", true);
    assert.match(b.satz, /F45 steht nicht in der Befehlsbibliothek.*erlaubt: F30/);
    assert.equal(pruefeAenderung(modell, v("F90"), { ...OPT, bibliothek: BIB }).befunde.some((x) => x.code === "bibliothek_wert"), false);
    assert.equal(pruefeAenderung(modell, v("F45"), OPT).befunde.some((x) => x.code === "bibliothek_wert"), false, "without a library no warning");
  });

  it("an agent's proposal through the change commands carries the library warning on its card", () => {
    bibliothekSetzen(STANDARD_VORLAGEN);
    try {
      const w = wand(1);
      const reg = befehlsRegister();
      const speicher = vorschlagSpeicher();
      aenderungsBefehleRegistrieren(reg, () => ({ kontext: () => auswahlKontext([]), modell: () => ({ customWalls: [w] }), optionen: () => OPT, speicher, uebernehmen: () => {}, zuruecknehmen: () => {} }));
      const r = reg.ausfuehren("eigenschaft-setzen", { guid: guidW(w), name: "feuerwiderstand", wert: "F45" }, { kanal: "steuerung" });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.result.pruefung.stufe, "warn", JSON.stringify(r.result.pruefung));
      assert.ok(r.result.pruefung.saetze.some((x) => /F45 steht nicht in der Befehlsbibliothek/.test(x)), JSON.stringify(r.result.pruefung));
    } finally {
      bibliothekSetzen([]);
    }
  });

  it("eingabe knows the library without the speech field: the viewer loads it when it registers the command", () => {
    bibliothekSetzen([]);
    try {
      const w = wand(1);
      const reg = befehlsRegister();
      const speicher = vorschlagSpeicher();
      const a = () => ({
        kontext: () => auswahlKontext([{ guid: guidW(w), klasse: "IfcWall", name: "Wand" }]), ansicht: () => null, zeigepunkt: () => null,
        modell: () => ({ customWalls: [w] }), optionen: () => OPT, speicher, uebernehmen: () => {}, zuruecknehmen: () => {},
      });
      aenderungsBefehleRegistrieren(reg, a);
      let geladen = 0;
      eingabeBefehlRegistrieren(reg, a, { bibliothekVorladen: () => { geladen += 1; bibliothekSetzen(STANDARD_VORLAGEN); } });
      assert.equal(geladen, 1);
      const r = reg.ausfuehren("eingabe", { text: "Setze Brandschutz auf F45" });
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.match(/** @type {any} */ (r).error, /erlaubt: F30/);
    } finally {
      bibliothekSetzen([]);
    }
  });
});
