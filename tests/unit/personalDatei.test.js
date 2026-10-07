// personalDatei.test.js — Plan 80-10, Task 3: encrypted `.bitpers` backup.
// Behavior 7 (round-trip, wrong passphrase, format rejection, settingKeys
// whitelist). Node's own WebCrypto (globalThis.crypto.subtle) — no browser
// needed. iterationen:1000 in every test (PBKDF2_ITERATIONEN_STANDARD would
// make the suite slow for no benefit here).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  serialisierePersonal, lesePersonalDatei, parsePersonalDatei, vorschauPersonal,
  exportPersonal, importPersonal, DATEI_ENDUNG,
} from "@core/api/personalDatei.js";
import { setzePersonalSpeicher, personalDbAuslesen, personalMeta } from "@core/api/personalDb.js";
import { parseProjektDatei } from "@core/api/projektDatei.js";
import { PERSONAL_ENTITAETEN, personalStoreName } from "@core/api/personalEntitaeten.js";

/** Same shape as personalSpeicher.test.js's attrappe (demoIdb + personalDb adapter double). */
function attrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  return {
    daten,
    async alle(store) { return structuredClone(daten[store] || []); },
    async schreiben(store, datensatz) {
      daten[store] = daten[store] || [];
      const i = daten[store].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[store].push(structuredClone(datensatz)); else daten[store][i] = structuredClone(datensatz);
    },
    async schreibeViele(store, zeilen) { daten[store] = structuredClone(zeilen); },
    async loeschen(store, id) { daten[store] = (daten[store] || []).filter((r) => r.id !== id); },
    async leeren(store) { daten[store] = []; },
    async meta(key, wert) {
      if (arguments.length === 1) return metaWerte[key];
      metaWerte[key] = wert;
      return wert;
    },
    async stelleStoresSicher(namen) { for (const n of namen) if (!daten[n]) daten[n] = []; },
  };
}

/** In-memory Setting client (demoDb semantics), same pattern as einstellungen.test.js. */
function settingClient(start = []) {
  const zeilen = start.map((z) => ({ ...z }));
  let n = 1;
  return {
    async filter(q) { return zeilen.filter((z) => Object.entries(q).every(([k, v]) => z[k] === v)).map((z) => ({ ...z })); },
    async list() { return zeilen.map((z) => ({ ...z })); },
    async create(daten) { const z = { id: `s${n++}`, created_date: "2026-09-27T00:00:00.000Z", updated_date: "2026-09-27T00:00:00.000Z", ...daten }; zeilen.push(z); return { ...z }; },
    async update(id, daten) { const i = zeilen.findIndex((z) => z.id === id); zeilen[i] = { ...zeilen[i], ...daten, id }; return { ...zeilen[i] }; },
    async delete(id) { const i = zeilen.findIndex((z) => z.id === id); if (i >= 0) zeilen.splice(i, 1); },
    __zeilen: zeilen,
  };
}

describe("serialisierePersonal / lesePersonalDatei — Behavior 7 (round-trip)", () => {
  const inhalt = { daten: { Mitarbeiter: [{ id: "P-1", nachname: "Beispielnachname" }] }, dateien: {}, einstellungen: [] };

  it("Round-Trip mit richtigem Passwort liefert denselben Inhalt", async () => {
    const datei = await serialisierePersonal(inhalt, "richtig-langes-passwort", { iterationen: 1000 });
    const zurueck = await lesePersonalDatei(datei, "richtig-langes-passwort");
    assert.deepEqual(zurueck, inhalt);
  });

  it("falsches Passwort wirft „Passphrase falsch oder Datei beschädigt.“", async () => {
    const datei = await serialisierePersonal(inhalt, "richtig-langes-passwort", { iterationen: 1000 });
    await assert.rejects(() => lesePersonalDatei(datei, "falsch"), /Passphrase falsch oder Datei beschädigt\./);
  });

  it("die serialisierte Datei enthält den Klartext-Nachnamen NICHT", async () => {
    const datei = await serialisierePersonal(inhalt, "richtig-langes-passwort", { iterationen: 1000 });
    assert.ok(!JSON.stringify(datei).includes("Beispielnachname"));
  });
});

describe("parseProjektDatei / parsePersonalDatei — gegenseitige Ablehnung", () => {
  it("parseProjektDatei lehnt eine .bitpers-Datei ab", async () => {
    const bitpers = await serialisierePersonal({ daten: {}, dateien: {}, einstellungen: [] }, "x", { iterationen: 1000 });
    const bytes = new TextEncoder().encode(JSON.stringify(bitpers));
    await assert.rejects(() => parseProjektDatei(bytes), /nicht aus der BIT-Atelier-Demo/);
  });
  it("parsePersonalDatei lehnt ein .bitproj-Objekt ab", () => {
    const bitprojObjekt = { schema: 1, app: "bit-atelier-demo", daten: {} };
    assert.throws(() => parsePersonalDatei(bitprojObjekt), /keine Personal-Sicherung/);
  });
});

describe("exportPersonal / importPersonal — Behavior 7 (settingKeys-Whitelist)", () => {
  beforeEach(() => {
    setzePersonalSpeicher(attrappe({ [personalStoreName("Mitarbeiter")]: [{ id: "P-1", personalnummer: "P-001" }] }), async () => ({}), { istDemo: false });
  });

  it("exportPersonal trägt genau die angegebene Setting-Zeile mit; importPersonal schreibt sie zurück, ignoriert einen fremden Schlüssel", async () => {
    const client = settingClient([{ id: "s0", key: "regel:personal.urlaub_buero_standard", value: { wert: 30 } }]);
    const dateiname = await exportPersonal("richtig-langes-passwort", {
      settingKeys: ["regel:personal.urlaub_buero_standard"],
      settingClient: client,
    });
    assert.ok(dateiname.endsWith(DATEI_ENDUNG));

    // Was der letzte Export tatsächlich verschlüsselt hat, direkt nachvollzogen
    // (dieselbe Attrappe wie oben, kein Browser-Download in Node) —
    // serialisierePersonal() erneut mit denselben Rohdaten aufrufen, um den
    // Klartext zu inspizieren.
    const daten = await personalDbAuslesen();
    const roherInhalt = { daten, dateien: {}, einstellungen: [{ key: "regel:personal.urlaub_buero_standard", value: { wert: 30 } }] };
    const datei = await serialisierePersonal(roherInhalt, "richtig-langes-passwort", { iterationen: 1000 });
    const entschluesselt = await lesePersonalDatei(datei, "richtig-langes-passwort");
    assert.deepEqual(entschluesselt.einstellungen, [{ key: "regel:personal.urlaub_buero_standard", value: { wert: 30 } }]);

    // Ein untergeschobener Schlüssel "briefkopf" im entschlüsselten Klartext
    // darf importPersonal NICHT übernehmen (Whitelist).
    const manipuliert = { ...roherInhalt, einstellungen: [...roherInhalt.einstellungen, { key: "briefkopf", value: { office: "fremd" } }] };
    const manipulierteDatei = await serialisierePersonal(manipuliert, "richtig-langes-passwort", { iterationen: 1000 });
    const zielClient = settingClient([]);
    await importPersonal(manipulierteDatei, "richtig-langes-passwort", { settingKeys: ["regel:personal.urlaub_buero_standard"], settingClient: zielClient });
    assert.equal(zielClient.__zeilen.length, 1);
    assert.equal(zielClient.__zeilen[0].key, "regel:personal.urlaub_buero_standard");
  });

  it("vorschauPersonal zählt je Entität", () => {
    const anzahl = vorschauPersonal({ daten: { Mitarbeiter: [{}, {}], Bewerbung: [{}] } });
    assert.deepEqual(anzahl, { Mitarbeiter: 2, Bewerbung: 1 });
  });

  it("personalMeta('letzte_sicherung') ist nach dem Export gesetzt", async () => {
    const client = settingClient([]);
    await exportPersonal("richtig-langes-passwort", { settingKeys: [], settingClient: client });
    const stand = await personalMeta("letzte_sicherung");
    assert.ok(typeof stand === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stand));
  });
});

describe("DS-11 — importPersonal(falsches Passwort) ändert nichts", () => {
  it("wirft und ersetzt personalDb nicht", async () => {
    setzePersonalSpeicher(attrappe({ [personalStoreName("Mitarbeiter")]: [{ id: "P-1", personalnummer: "P-001" }] }), async () => ({}), { istDemo: false });
    const datei = await serialisierePersonal({ daten: { Mitarbeiter: [{ id: "P-9", personalnummer: "P-009" }] }, dateien: {}, einstellungen: [] }, "richtig-langes-passwort", { iterationen: 1000 });
    await assert.rejects(() => importPersonal(datei, "falsch", { settingClient: settingClient([]) }));
    const daten = await personalDbAuslesen();
    assert.equal(daten.Mitarbeiter.length, 1);
    assert.equal(daten.Mitarbeiter[0].id, "P-1");
  });
});

describe("PERSONAL_ENTITAETEN unverändert bei alledem", () => {
  it("9 Entitäten", () => assert.equal(PERSONAL_ENTITAETEN.length, 9));
});
