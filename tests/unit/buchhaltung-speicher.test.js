// Unit tests of the accounting storage (79-01 T4): no duplicate on an existing
// id (demo null and Express 404), the GoBD guard, the cloud lock (E-03) with an
// injected data path, the seed exactly once, "remove sample data", and the
// legal-form switch without data loss (79-RESEARCH risk 3a).
//
// Storage is injected: the demo path runs on demoDb with an in-memory adapter
// (setzeSpeicher, pattern of demoDb.test.js), the Express path on a fake whose
// get throws 404 and whose create appends like server/db.js.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { demoDb, setzeSpeicher } from "@core/api/demoDb.js";
import {
  CLOUD_GESPERRT, beispielEntfernen, einstellungLesen, einstellungSpeichern, ladeAlles, loesche, saeBeispielDaten,
  setzeCloudFreigabe, setzeDatenquelle, speichere, speichereViele, verfuegbar,
} from "@/lib/accounting/speicher.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";

/** In-memory IndexedDB stand-in with the demoIdb surface. */
function speicherAttrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  return {
    daten,
    async entities() { return Object.keys(daten); },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben(entity, datensatz) {
      daten[entity] = daten[entity] || [];
      const i = daten[entity].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[entity].push(structuredClone(datensatz));
      else daten[entity][i] = structuredClone(datensatz);
    },
    async schreibeViele(entity, datensaetze) { daten[entity] = structuredClone(datensaetze); },
    async loeschen(entity, recordId) { daten[entity] = (daten[entity] || []).filter((r) => r.id !== recordId); },
    async leeren(entity) { delete daten[entity]; },
    async meta(key, wert) {
      if (arguments.length === 1) return metaWerte[key];
      metaWerte[key] = wert;
      return wert;
    },
  };
}

/** bitApi-shaped client on demoDb (get answers null, like demoDb itself). */
function demoApi() {
  return {
    entities: new Proxy({}, {
      get: (_, name) => ({
        list: (sort) => demoDb.list(name, sort),
        filter: (q, sort) => demoDb.filter(name, q, sort),
        get: (id) => demoDb.get(name, id),
        create: (d) => demoDb.create(name, d),
        update: (id, d) => demoDb.update(name, id, d),
        delete: (id) => demoDb.remove(name, id),
      }),
    }),
  };
}

/** Express-shaped fake: get throws 404, create appends even with an existing id (server/db.js). */
function expressApi() {
  const db = {};
  const col = (n) => (db[n] = db[n] || []);
  const nichtGefunden = () => Object.assign(new Error("Request failed: 404"), { status: 404 });
  return {
    db,
    entities: new Proxy({}, {
      get: (_, name) => ({
        list: async () => structuredClone(col(name)),
        filter: async (q) => structuredClone(col(name).filter((r) => Object.entries(q).every(([k, v]) => String(r[k]) === String(v)))),
        get: async (id) => { const r = col(name).find((x) => x.id === id); if (!r) throw nichtGefunden(); return structuredClone(r); },
        create: async (d) => { const r = { id: `x${col(name).length + 1}`, ...d }; col(name).push(r); return structuredClone(r); },
        update: async (id, d) => {
          const i = col(name).findIndex((x) => x.id === id);
          if (i === -1) throw nichtGefunden();
          col(name)[i] = { ...col(name)[i], ...d, id };
          return structuredClone(col(name)[i]);
        },
        delete: async (id) => { db[name] = col(name).filter((x) => x.id !== id); return null; },
      }),
    }),
  };
}

const anzahl = async (entity) => (await demoDb.list(entity)).length;

describe("Speicher der Buchhaltung", () => {
  let attrappe;
  beforeEach(() => {
    attrappe = speicherAttrappe();
    setzeSpeicher(attrappe, async () => ({}));
    setzeDatenquelle("serverlos");
  });
  afterEach(() => setzeDatenquelle("express"));

  it("verfuegbar: Cloud gesperrt ohne E-20-Freigabe, Demo/lokal und Express frei", () => {
    assert.equal(verfuegbar("supabase", false), false);
    assert.equal(verfuegbar("supabase", true), true, "E-20: einziges Org-Mitglied");
    assert.equal(verfuegbar("serverlos"), true);
    assert.equal(verfuegbar("express"), true);
  });

  it("Cloud-Sperre mit injizierter Datenquelle: Lesen und Schreiben werden verweigert", async () => {
    setzeDatenquelle("supabase");
    setzeCloudFreigabe(false);
    const api = demoApi();
    await assert.rejects(() => ladeAlles(api), { message: CLOUD_GESPERRT });
    await assert.rejects(() => speichere(api, "Entnahme", { betrag: 1 }), { message: CLOUD_GESPERRT });
    await assert.rejects(() => einstellungLesen(api), { message: CLOUD_GESPERRT });
    await assert.rejects(() => saeBeispielDaten(api, "2026-09-27", { istDemo: true }), { message: CLOUD_GESPERRT });
    assert.equal(await anzahl("Entnahme"), 0, "nichts geschrieben");
    setzeCloudFreigabe(true);
    assert.deepEqual(Object.keys(await ladeAlles(api)).length > 0, true, "E-20: mit Freigabe liest die Cloud");
  });

  it("speichere mit vorhandener id aktualisiert (Anzahl bleibt), ohne id legt an", async () => {
    const api = demoApi();
    await speichere(api, "Entnahme", { id: "e1", betrag: 100 });
    await speichere(api, "Entnahme", { id: "e1", betrag: 250 });
    assert.equal(await anzahl("Entnahme"), 1);
    assert.equal((await demoDb.get("Entnahme", "e1")).betrag, 250);
    const neu = await speichere(api, "Entnahme", { betrag: 5 });
    assert.ok(neu.id);
    assert.equal(await anzahl("Entnahme"), 2);
  });

  it("Express-Attrappe: 404 bei get → create; zweites Speichern → update, kein Duplikat", async () => {
    setzeDatenquelle("express");
    const api = expressApi();
    await speichere(api, "Fahrt", { id: "f1", km: 10 });
    await speichere(api, "Fahrt", { id: "f1", km: 12 });
    assert.equal(api.db.Fahrt.length, 1);
    assert.equal(api.db.Fahrt[0].km, 12);
  });

  it("GoBD: gestellte Rechnung — Betrag ändern wird verweigert, Zahlung erfassen geht", async () => {
    const api = demoApi();
    await speichere(api, "Ausgangsrechnung", { id: "ar1", status: "gestellt", netto: 100, brutto: 119, zahlungen: [] });
    await assert.rejects(() => speichere(api, "Ausgangsrechnung", { id: "ar1", netto: 120 }), /schreibgeschützt/);
    await speichere(api, "Ausgangsrechnung", { id: "ar1", zahlungen: [{ datum: "2026-09-27", betrag: 119 }] });
    assert.equal((await demoDb.get("Ausgangsrechnung", "ar1")).zahlungen.length, 1);
    await speichere(api, "Ausgangsrechnung", { id: "ar1", status: "storniert" });
    assert.equal((await demoDb.get("Ausgangsrechnung", "ar1")).status, "storniert");
  });

  it("loesche: gestellte Rechnung verweigert (Klartext), Entwurf gelingt", async () => {
    const api = demoApi();
    await speichereViele(api, [
      { entitaet: "Ausgangsrechnung", obj: { id: "g", status: "gestellt", netto: 1 } },
      { entitaet: "Ausgangsrechnung", obj: { id: "e", status: "entwurf", netto: 1 } },
    ]);
    await assert.rejects(() => loesche(api, "Ausgangsrechnung", "g"), { message: "Gestellte Rechnungen können nicht gelöscht werden — bitte stornieren." });
    await loesche(api, "Ausgangsrechnung", "e");
    assert.deepEqual((await demoDb.list("Ausgangsrechnung")).map((r) => r.id), ["g"]);
  });

  it("einstellungSpeichern: read-modify-write des ganzen value", async () => {
    const api = demoApi();
    await einstellungSpeichern(api, { zahlungsziel_tage: 21, buero: { name: "A" } });
    await einstellungSpeichern(api, { puffer_tage: 5 });
    const zeile = await einstellungLesen(api);
    assert.equal(zeile.key, "buchhaltung");
    assert.deepEqual(zeile.value, { zahlungsziel_tage: 21, buero: { name: "A" }, puffer_tage: 5 });
    assert.equal(await anzahl("Setting"), 1);
  });

  it("saeBeispielDaten: zweimal parallel → genau eine Saat, danach keine weitere", async () => {
    const api = demoApi();
    const [a, b] = await Promise.all([
      saeBeispielDaten(api, "2026-09-27", { istDemo: true }),
      saeBeispielDaten(api, "2026-09-27", { istDemo: true }),
    ]);
    assert.equal(a, b, "derselbe Lauf");
    assert.equal(a.gesaet, true);
    const erwartet = beispielDatensaetze("2026-09-27");
    for (const [entity, liste] of Object.entries(erwartet)) assert.equal(await anzahl(entity), liste.length, entity);
    const nochmal = await saeBeispielDaten(api, "2026-09-27", { istDemo: true });
    assert.equal(nochmal.gesaet, false);
    assert.equal(await anzahl("Ausgangsrechnung"), 16);
  });

  it("saeBeispielDaten: nicht außerhalb der Demo, nicht bei vorhandenem Setting, vorhandener HoaiPlan bleibt", async () => {
    const api = demoApi();
    assert.equal((await saeBeispielDaten(api, "2026-09-27", { istDemo: false })).gesaet, false);
    assert.equal(await anzahl("Ausgangsrechnung"), 0);
    await speichere(api, "HoaiPlan", { id: "eigen", project_id: "proj-1", progress: [100] });
    await saeBeispielDaten(api, "2026-09-27", { istDemo: true });
    assert.deepEqual((await demoDb.list("HoaiPlan")).map((p) => p.id).sort(), ["bsp-hoai-proj-2", "eigen"]);
  });

  it("beispielEntfernen: alle beispiel-Datensätze weg, beispiel_entfernt gesetzt, keine neue Saat", async () => {
    const api = demoApi();
    await saeBeispielDaten(api, "2026-09-27", { istDemo: true });
    await speichere(api, "Entnahme", { id: "eigene", gesellschafter_id: "bsp-g1", datum: "2026-09-01", betrag: 10 });
    const { entfernt } = await beispielEntfernen(api);
    // Every sample record except the Setting (which stays with beispiel_entfernt).
    const gesaet = Object.entries(beispielDatensaetze("2026-09-27")).filter(([e]) => e !== "Setting").reduce((n, [, l]) => n + l.length, 0);
    assert.equal(entfernt, gesaet);
    const { daten, setting } = await ladeAlles(api);
    for (const [entity, liste] of Object.entries(daten)) assert.equal(liste.filter((r) => r.beispiel).length, 0, entity);
    assert.deepEqual(daten.Entnahme.map((e) => e.id), ["eigene"], "eigene Daten bleiben");
    assert.equal(setting.value.beispiel_entfernt, true);
    assert.equal(setting.value.buero, undefined, "Büro-Angaben des Beispiels entfernt");
    assert.equal((await saeBeispielDaten(api, "2026-09-27", { istDemo: true })).gesaet, false);
    assert.equal(await anzahl("Ausgangsrechnung"), 0);
  });

  it("Rechtsform-Wechsel verliert nichts: GmbH und zurück, Gesellschafter und Werte bleiben", async () => {
    const api = demoApi();
    await saeBeispielDaten(api, "2026-09-27", { istDemo: true });
    await einstellungSpeichern(api, { rechtsform: "gmbh", schluessel: { 2026: { "bsp-g1": 100 } } });
    await einstellungSpeichern(api, { rechtsform: "einzelunternehmen" });
    const { daten, setting } = await ladeAlles(api);
    assert.equal(daten.Gesellschafter.length, 1);
    assert.equal(daten.Entnahme.length, 9);
    assert.equal(setting.value.rechtsform, "einzelunternehmen");
    assert.deepEqual(setting.value.schluessel, { 2026: { "bsp-g1": 100 } });
    assert.equal(setting.value.kontostand_start[2026].betrag, 48000);
  });

  it("speichere wiederholt nach „IndexedDB blockiert“ (Versionssprung), andere Fehler sofort", async () => {
    const api = demoApi();
    let verweigert = 0;
    const wackelig = {
      entities: new Proxy({}, {
        get: (_, name) => ({
          ...api.entities[name],
          create: async (d) => {
            if (verweigert < 2) { verweigert++; throw new Error("IndexedDB blockiert — ein anderer Tab hält eine ältere Version offen"); }
            return demoDb.create(name, d);
          },
        }),
      }),
    };
    await speichere(wackelig, "Beleg", { id: "b1", name: "x.pdf" });
    assert.equal(verweigert, 2);
    assert.equal(await anzahl("Beleg"), 1, "nach zwei Ablehnungen genau ein Datensatz");
    // Without an id as well: the id is fixed before the first attempt.
    verweigert = 0;
    await speichere(wackelig, "Beleg", { name: "y.pdf" });
    assert.equal(verweigert, 2);
    assert.equal((await demoDb.list("Beleg")).filter((b) => b.name === "y.pdf").length, 1, "kein Duplikat unter neuer id");
    const kaputt = { entities: new Proxy({}, { get: () => ({ get: async () => null, create: async () => { throw new Error("Speicher voll"); } }) }) };
    await assert.rejects(() => speichere(kaputt, "Beleg", { id: "b2" }), /Speicher voll/);
  });

  it("ladeAlles: alle 13 Sammlungen als Listen plus Setting", async () => {
    const { daten, setting } = await ladeAlles(demoApi());
    assert.equal(Object.keys(daten).length, 13);
    assert.ok(Object.values(daten).every(Array.isArray));
    assert.equal(setting, null);
  });
});
