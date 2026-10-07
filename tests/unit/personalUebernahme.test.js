// personalUebernahme.test.js — Zusage → Person + Vertragsentwurf + Checkliste,
// mit Rückbau bei Fehler (Plan 80-09, Task 2, Behavior 7–8). Fake-API ohne
// IndexedDB — uebernahmeAusBewerbung bekommt eine injizierte api (dieselbe
// Form wie bitApi.personal).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { uebernahmeAusBewerbung } from "@/lib/people/uebernahme.js";

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

/**
 * Minimal fake collection: in-memory array, same {create,update,delete,get,filter} shape.
 * @param {object[]} zeilen
 */
function fakeCollection(zeilen = []) {
  let n = 0;
  return {
    zeilen,
    async create(daten) {
      const rec = { id: `fake-${++n}`, ...daten };
      zeilen.push(rec);
      return rec;
    },
    async update(id, patch) {
      const rec = zeilen.find((z) => z.id === id);
      if (!rec) throw new Error("Request failed: 404");
      Object.assign(rec, patch);
      return rec;
    },
    async delete(id) {
      const i = zeilen.findIndex((z) => z.id === id);
      if (i !== -1) zeilen.splice(i, 1);
      return null;
    },
    async get(id) {
      const rec = zeilen.find((z) => z.id === id);
      if (!rec) throw new Error("Request failed: 404");
      return rec;
    },
    async filter(query) {
      return zeilen.filter((z) => Object.entries(query || {}).every(([k, v]) => z[k] === v));
    },
  };
}

/** @param {{stelle?: object|null, vertragWirft?: boolean, bewerbung?: object|null}} [optionen] */
function fakeApi({ stelle = null, vertragWirft = false, bewerbung = null } = {}) {
  const dateien = new Map();
  const arbeitsvertrag = fakeCollection([]);
  if (vertragWirft) arbeitsvertrag.create = async () => { throw new Error("Speicher voll"); };
  return {
    Mitarbeiter: fakeCollection([]),
    Arbeitsvertrag: arbeitsvertrag,
    Personalvorgang: fakeCollection([]),
    Personaldokument: fakeCollection([]),
    Bewerbung: fakeCollection(bewerbung ? [bewerbung] : []),
    Stelle: { async get(id) { if (stelle && stelle.id === id) return stelle; throw new Error("Request failed: 404"); } },
    dateien: {
      async get(id) { const d = dateien.get(id); if (!d) throw new Error("Datei nicht gefunden"); return d; },
      async put(id, datei) { dateien.set(id, datei); },
      async delete(id) { dateien.delete(id); },
      _map: dateien,
    },
  };
}

const B3_ZUSAGE = Object.freeze({
  id: "B-3", stelle_id: "S-2", vorname: "Tom", nachname: "Testfall",
  kontakt: { email: "tom.testfall@example.org", telefon: "" },
  stufe: "zusage", entscheidung: { art: "zusage", am: "2026-09-27" },
  verfuegbar_ab: "2026-10-01", gespraeche: [{ datum: "2026-09-10", notiz: "geheim" }], bewertung: [{ kriterium: "x", wert: 5 }],
});

describe("uebernahme — Behavior 7: Zusage → Person + Vertragsentwurf + Checkliste", () => {
  it("legt genau 1 Mitarbeiter, 1 Arbeitsvertrag, 1 Personalvorgang an und markiert die Bewerbung", async () => {
    const bewerbung = { ...B3_ZUSAGE };
    const api = fakeApi({ bewerbung, stelle: { id: "S-2", titel: "Werkstudent:in BIM (m/w/d)", beschaeftigungsart: "werkstudent", befristet: false, wochenstunden: 20 } });
    const { mitarbeiter, vertrag, vorgang } = await uebernahmeAusBewerbung(bewerbung, api, regelWert, "2026-09-27");

    assert.equal(api.Mitarbeiter.zeilen.length, 1);
    assert.equal(mitarbeiter.status, "onboarding");
    assert.equal(api.Arbeitsvertrag.zeilen.length, 1);
    assert.equal(vertrag.status, "entwurf");
    assert.equal(vertrag.urlaub_tage_jahr, 28);
    assert.equal(vertrag.wochenstunden, 20, "aus der Stelle, nicht aus dem Bürostandard");
    assert.equal(api.Personalvorgang.zeilen.length, 1);
    assert.equal(vorgang.art, "eintritt");
    assert.equal(vorgang.mitarbeiter_id, mitarbeiter.id);

    const gespeicherteBewerbung = api.Bewerbung.zeilen.find((b) => b.id === "B-3");
    assert.equal(gespeicherteBewerbung.uebernommen_mitarbeiter_id, mitarbeiter.id);

    assert.ok(!("gespraeche" in mitarbeiter));
    assert.ok(!("bewertung" in mitarbeiter));
  });

  it("ohne Stelle greift der Bürostandard (Wochenstunden 40)", async () => {
    const bewerbung = { ...B3_ZUSAGE, stelle_id: null };
    const api = fakeApi({ bewerbung });
    const { vertrag } = await uebernahmeAusBewerbung(bewerbung, api, regelWert, "2026-09-27");
    assert.equal(vertrag.wochenstunden, 40);
    assert.equal(vertrag.arbeitstage_woche, 5);
    assert.equal(vertrag.probezeit_monate, 6);
  });

  it("kopiert Anhänge der Kategorien zeugnis/qualifikation/sonstiges inhaltlich, nicht per geteiltem datei_ref", async () => {
    const bewerbung = { ...B3_ZUSAGE };
    const api = fakeApi({ bewerbung });
    api.Personaldokument.zeilen.push(
      { id: "d-1", bewerbung_id: "B-3", kategorie: "sonstiges", name: "cv.pdf", mime: "application/pdf", groesse_bytes: 10, datei_ref: "datei-cv" },
      { id: "d-2", bewerbung_id: "B-3", kategorie: "bewertung_notiz", name: "geheim.txt", mime: "text/plain", groesse_bytes: 5, datei_ref: "datei-x" },
    );
    api.dateien._map.set("datei-cv", { mime: "application/pdf", name: "cv.pdf", data: "data:application/pdf;base64,AAA=" });
    const { mitarbeiter } = await uebernahmeAusBewerbung(bewerbung, api, regelWert, "2026-09-27");
    const kopien = api.Personaldokument.zeilen.filter((d) => d.mitarbeiter_id === mitarbeiter.id);
    assert.equal(kopien.length, 1, "nur die kopierwürdige Kategorie, nicht die andere");
    assert.equal(kopien[0].kategorie, "sonstiges");
    assert.notEqual(kopien[0].datei_ref, "datei-cv", "neue Datei-ID, kein geteilter Verweis");
    assert.ok(api.dateien._map.has(kopien[0].datei_ref));
  });

  it("wirft bei einer anderen Stufe als 'zusage' einen Klartext-Fehler", async () => {
    const api = fakeApi({});
    await assert.rejects(
      () => uebernahmeAusBewerbung({ ...B3_ZUSAGE, stufe: "angebot", entscheidung: {} }, api, regelWert, "2026-09-27"),
      /Zusage/,
    );
    assert.equal(api.Mitarbeiter.zeilen.length, 0);
  });
});

describe("uebernahme — Behavior 8: Rückbau bei Fehler", () => {
  it("wirft die Fake-api beim Vertrag: 0 neue Mitarbeiter danach, Fehler nennt 'Arbeitsvertrag'", async () => {
    const api = fakeApi({ vertragWirft: true });
    await assert.rejects(
      () => uebernahmeAusBewerbung({ ...B3_ZUSAGE }, api, regelWert, "2026-09-27"),
      /Arbeitsvertrag/,
    );
    assert.equal(api.Mitarbeiter.zeilen.length, 0, "Rückbau hat den bereits angelegten Mitarbeiter wieder entfernt");
    assert.equal(api.Personalvorgang.zeilen.length, 0);
  });
});
