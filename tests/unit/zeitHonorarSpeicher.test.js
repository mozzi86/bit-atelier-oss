// Phase 81 (81-01): the storage layer src/lib/zeitHonorar/speicher.js — cloud
// lock before any API call (E-03/E-20), the guarded write paths into 79's
// Honorarvertrag, read-only 79 collections, no duplicates.
//
// In:  the module with an in-memory fake of bitApi.entities. Out: assertions only.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CLOUD_GESPERRT_ZH, ladeZeitHonorar, loescheZH, setzeDatenquelleZH, speichereZH, VERTRAG_OHNE_ANGEBOT, vertragsPatch81,
} from "@/lib/zeitHonorar/speicher.js";
import { honorarVertrag, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";

/**
 * In-memory fake of bitApi.entities with a call counter.
 * @param {Record<string, any[]>} start
 */
function attrappe(start = {}) {
  const daten = structuredClone(start);
  let aufrufe = 0;
  const zaehle = () => { aufrufe++; };
  const client = (name) => ({
    list: async () => { zaehle(); return daten[name] || []; },
    filter: async (q) => { zaehle(); return (daten[name] || []).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)); },
    get: async (id) => { zaehle(); return (daten[name] || []).find((r) => r.id === id) || null; },
    create: async (obj) => { zaehle(); const neu = { id: obj.id || `n${aufrufe}`, ...obj }; (daten[name] ||= []).push(neu); return neu; },
    update: async (id, rest) => { zaehle(); const r = daten[name].find((x) => x.id === id); Object.assign(r, rest); return r; },
    delete: async (id) => { zaehle(); daten[name] = (daten[name] || []).filter((x) => x.id !== id); },
  });
  return { api: { entities: new Proxy({}, { get: (_t, n) => client(String(n)) }) }, daten, aufrufe: () => aufrufe };
}

afterEach(() => setzeDatenquelleZH("express", true));

test("Cloud-Sperre: ohne Freigabe wirft jede Funktion Klartext ohne API-Aufruf", async () => {
  setzeDatenquelleZH("supabase", false);
  const a = attrappe({ Zeitbuchung: [{ id: "z1" }] });
  await assert.rejects(() => ladeZeitHonorar(a.api), { message: CLOUD_GESPERRT_ZH });
  await assert.rejects(() => ladeZeitHonorar(a.api, { entitaeten: ["HoaiPlan"] }), { message: CLOUD_GESPERRT_ZH });
  await assert.rejects(() => speichereZH(a.api, "Zeitbuchung", { id: "z2" }), { message: CLOUD_GESPERRT_ZH });
  await assert.rejects(() => speichereZH(a.api, "Honorarvertrag", { id: "hv", status: "beauftragt" }), { message: CLOUD_GESPERRT_ZH });
  await assert.rejects(() => loescheZH(a.api, "Zeitbuchung", "z1"), { message: CLOUD_GESPERRT_ZH });
  assert.equal(a.aufrufe(), 0);
});

test("mit Cloud-Freigabe (E-20) und lokal funktioniert dieselbe Schicht", async () => {
  for (const [quelle, freigabe] of [["supabase", true], ["serverlos", false], ["express", false]]) {
    setzeDatenquelleZH(quelle, freigabe);
    const a = attrappe();
    await speichereZH(a.api, "Zeitbuchung", { id: "z1", minuten: 60 });
    const d = await ladeZeitHonorar(a.api, { entitaeten: ["Zeitbuchung"] });
    assert.equal(d.Zeitbuchung.length, 1, quelle);
  }
});

test("speichereZH: get → update | create, keine Dublette", async () => {
  const a = attrappe();
  await speichereZH(a.api, "Zeitbuchung", { id: "z1", minuten: 60 });
  await speichereZH(a.api, "Zeitbuchung", { id: "z1", minuten: 90 });
  assert.equal(a.daten.Zeitbuchung.length, 1);
  assert.equal(a.daten.Zeitbuchung[0].minuten, 90);
  await loescheZH(a.api, "Zeitbuchung", "z1");
  assert.equal(a.daten.Zeitbuchung.length, 0);
});

test("vorhandener Honorarvertrag: nur 81-Felder und beauftragt-Flags, 79-Felder bleiben", async () => {
  const bsp = beispielDatensaetze("2026-09-28");
  const vertrag = bsp.Honorarvertrag.find((v) => v.id === "bsp-hv-1");
  const a = attrappe({ Honorarvertrag: [vertrag] });
  const neueLph = vertrag.lph.map((l, i) => ({ beauftragt: i < 9, prozent: 99 }));
  await speichereZH(a.api, "Honorarvertrag", {
    ...vertrag, id: "bsp-hv-1", kg300_euro: 1, honorarzone: "V", nummer: "AV-2025-002", status: "beauftragt",
    stufen: [{ nr: 1, lph: [1, 2, 3, 4], beauftragt_am: "2025-03-01" }], lph: neueLph,
  });
  const gespeichert = a.daten.Honorarvertrag[0];
  assert.equal(gespeichert.kg300_euro, vertrag.kg300_euro, "79-Feld unverändert");
  assert.equal(gespeichert.honorarzone, "III", "79-Feld unverändert");
  assert.equal(gespeichert.nummer, "AV-2025-002");
  assert.equal(gespeichert.status, "beauftragt");
  assert.equal(gespeichert.lph[8].beauftragt, true, "Flag übernommen");
  assert.deepEqual(gespeichert.lph.map((l) => l.prozent), vertrag.lph.map((l) => l.prozent), "Prozente bleiben");
  assert.equal(a.daten.Honorarvertrag.length, 1);
});

test("neuer Honorarvertrag nur mit angebot_id, vollständig; ohne Klartext und kein create", async () => {
  const a = attrappe();
  const lph = lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 8 }));
  const obj = {
    project_id: "proj-3", leistungsbild: "gebaeude", kg300_euro: 900000, kg400_euro: 400000, sonstige_euro: 0,
    honorarzone: "III", satz_position_prozent: 0, lph, umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19,
    pauschal_euro: null, angebot_id: "ha-1", nummer: "AV-2026-001", status: "beauftragt",
  };
  await assert.rejects(() => speichereZH(a.api, "Honorarvertrag", { ...obj, angebot_id: undefined }), { message: VERTRAG_OHNE_ANGEBOT });
  assert.equal((a.daten.Honorarvertrag || []).length, 0);
  const gespeichert = await speichereZH(a.api, "Honorarvertrag", obj);
  assert.equal(honorarVertrag(gespeichert).netto, honorarVertrag(obj).netto);
  // Fixture A of 81-RESEARCH says 140.999,03; it rounds the half cents of LPH 3
  // (20.553,795) and LPH 5 (34.256,325) down. 79's engine rounds commercially (half up):
  // grund 134.284,81, netto 140.999,05 — 79 is the one engine, 81 follows it.
  assert.equal(honorarVertrag(gespeichert).netto, 140999.05, "Fixture A, kaufmännisch gerundet");
});

test("79-Sammlungen nur lesend; fremde Entitäten abgelehnt", async () => {
  const bsp = beispielDatensaetze("2026-09-28");
  const a = attrappe({ HoaiPlan: bsp.HoaiPlan });
  const d = await ladeZeitHonorar(a.api, { entitaeten: ["HoaiPlan"], filter: { project_id: "proj-1" } });
  assert.deepEqual(d.HoaiPlan.map((h) => h.id), ["bsp-hoai-proj-1"]);
  await assert.rejects(() => speichereZH(a.api, "HoaiPlan", { id: "x" }), /nur gelesen/);
  await assert.rejects(() => speichereZH(a.api, "Ausgangsrechnung", { id: "x" }), /nur gelesen/);
  await assert.rejects(() => loescheZH(a.api, "Honorarvertrag", "x"), /nicht gelöscht/);
  await assert.rejects(() => ladeZeitHonorar(a.api, { entitaeten: ["Project"] }), /gehört nicht zu Zeit & Honorar/);
});

test("vertragsPatch81: ohne lph im Eingang kein lph im Patch", () => {
  assert.deepEqual(vertragsPatch81({ id: "a", lph: [{ beauftragt: true, prozent: 2 }] }, { status: "ruht", honorarzone: "I" }), { id: "a", status: "ruht" });
});
