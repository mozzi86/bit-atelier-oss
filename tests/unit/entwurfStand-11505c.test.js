// 115-05c (D-115-12): the page draft store (entwurfStand.js) and the further draft sources of the second build round:
//   - readers inside the designer see the draft (reader overlay: every report of the building model's draft reaches the
//     aufBimModelAenderung listeners with {entwurf: true}); bimModelLesen without an open designer is the stored record only
//   - the massing takeover changes the draft (bimListenAendern: stored ∪ draft lists, refused while the studio is mounted)
//   - single fields (program fields, layers) come back after a reload: own base as they are, a newer stored state three ways,
//     a field both changed keeps the draft value with a card and a lock; a draft made on another record is not continued
//   - a save pressed while one runs waits and saves again (a change made meanwhile is never left out)
//   - a source registered before the person was known is found by "Speichern" (keyed per project)
//   - the attribute layer is a studio value (studioWerteAusDatensatz / studioPatch)
//
// In: nothing (a fetch stand-in of the BimModel records). Out: assertions only.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as E from "@core/lib/entwurf/entwurfStand.js";
import * as sync from "@core/lib/useBimModelSync";
import { abgleichStand } from "@core/lib/abgleich/abgleichStand";
import { studioWerteAusDatensatz, studioPatch } from "@designer/lib/studioLaden.js";

const T0 = "2026-11-20T10:00:00.000Z";

/** @param {any[]} records a fetch stand-in: GET ?project_id= → the records of the project; auth/me → a fixed test person */
function server(records) {
  const antwort = (/** @type {number} */ status, /** @type {any} */ json) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => json });
  return async (/** @type {string} */ url) => {
    const u = new URL(String(url), "http://test.local");
    if (u.pathname.endsWith("/auth/me")) return antwort(200, { id: "testperson-11505c" });
    const pid = u.searchParams.get("project_id");
    return antwort(200, records.filter((r) => r.project_id === pid));
  };
}

beforeEach(() => { E._zuruecksetzenFuerTests(); });

test("reader overlay: a report of the building model's draft reaches the readers with {entwurf: true}", () => {
  /** @type {any[]} */ const gesehen = [];
  const ab = sync.aufBimModelAenderung((pid, patch, meta) => { gesehen.push({ pid, patch, meta }); });
  try {
    E.melden("pLeser", "bim", { stand: { id: "bm1", updated_date: T0 }, basis: { storeys: 2 }, werte: { storeys: 3 }, felder: ["storeys"] });
  } finally { ab(); }
  assert.equal(gesehen.length, 1);
  assert.deepEqual(gesehen[0], { pid: "pLeser", patch: { storeys: 3 }, meta: { entwurf: true } });
});

test("bimModelLesen: without an open designer the stored record only (other routes never see a draft)", async () => {
  const alt = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (server([{ id: "bmL", project_id: "pLesen", updated_date: T0, storeys: 2 }]));
  try {
    E.melden("pLesen", "bim", { stand: { id: "bmL", updated_date: T0 }, basis: { storeys: 2 }, werte: { storeys: 5 }, felder: ["storeys"] });
    const m = await sync.bimModelLesen("pLesen");
    assert.equal(m.storeys, 2);
  } finally { globalThis.fetch = alt; }
});

test("massing takeover: the draft's lists on top of the stored ones, new lists reported as draft; refused with the studio open", async () => {
  const alt = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (server([{ id: "bmM", project_id: "pMassing", updated_date: T0, customWalls: [{ _idx: 1 }] }]));
  try {
    await E.benutzerBereit(); // as on the page: the person is known before a source reports (starten)
    E.melden("pMassing", "bim", { stand: { id: "bmM", updated_date: T0 }, basis: { customWalls: [{ _idx: 1 }] }, werte: { customWalls: [{ _idx: 1 }, { _idx: 2 }] }, felder: ["customWalls"] });
    /** @type {any} */ let gesehen = null;
    const neu = await E.bimListenAendern("pMassing", (m) => { gesehen = m; return { customWalls: [...m.customWalls, { _idx: 3, quelle_koerper: "k1" }] }; });
    assert.deepEqual(gesehen.customWalls.map((/** @type {any} */ w) => w._idx), [1, 2], "stored ∪ draft");
    assert.deepEqual(neu?.customWalls.map((w) => w._idx), [1, 2, 3]);
    assert.deepEqual(E.entwurfVon("pMassing")?.aenderungen.bim.customWalls.map((/** @type {any} */ w) => w._idx), [1, 2, 3]);
    assert.deepEqual(E.entwurfVon("pMassing")?.basis.bim?.felder.customWalls, [{ _idx: 1 }], "the draft keeps its own base");
    const weg = E.speichererSetzen("pMassing", "studio", async () => "leer");
    await assert.rejects(() => E.bimListenAendern("pMassing", () => ({ customWalls: [] })), /geöffnet/);
    weg();
  } finally { globalThis.fetch = alt; }
});

test("single fields after a reload: same base → draft value; newer base, both changed → draft value + card + lock; other record → not continued", () => {
  const entwurf = E.entwurfVon("pFeld") ?? (E.melden("pFeld", "bim", { stand: { id: "bmF", updated_date: T0 }, basis: { storeys: 2, unit: "m" }, werte: { storeys: 3, unit: "m" }, felder: ["storeys", "unit"] }), E.entwurfVon("pFeld"));
  /** @type {any[]} */ const gesetzt = [];
  E.felderEinspielen({ pid: "pFeld", entwurf, gespeichert: { id: "bmF", updated_date: T0, storeys: 2 }, felder: ["storeys"], quelle: "programm", setzen: (w) => gesetzt.push(w) });
  assert.deepEqual(gesetzt, [{ storeys: 3 }]);
  gesetzt.length = 0;
  E.felderEinspielen({ pid: "pFeld", entwurf, gespeichert: { id: "bmF", updated_date: "2026-11-20T11:00:00.000Z", storeys: 4 }, felder: ["storeys"], quelle: "programm", setzen: (w) => gesetzt.push(w) });
  assert.deepEqual(gesetzt, [{ storeys: 3 }], "mine stays on screen");
  assert.equal(sync.feldGesperrt("pFeld", "storeys"), true, "held back from every save until decided");
  assert.ok(abgleichStand.stand().konflikte.some((k) => k.projektId === "pFeld" && k.feld === "storeys"), "a card");
  abgleichStand.leeren("pFeld");
  gesetzt.length = 0;
  E.felderEinspielen({ pid: "pFeld", entwurf, gespeichert: { id: "bmANDERS", updated_date: T0, storeys: 2 }, felder: ["storeys"], quelle: "programm", setzen: (w) => gesetzt.push(w) });
  assert.deepEqual(gesetzt, []);
  assert.equal(E.zustand("pFeld").offen, "ersetzt");
});

test("a save pressed while one runs waits for it and saves again (a change made meanwhile is written)", async () => {
  /** @type {string[]} */ const laeufe = [];
  /** @type {(v?: any) => void} */ let los = () => {};
  const tor = new Promise((r) => { los = r; });
  let n = 0;
  E.speichererSetzen("pQueue", "studio", async () => { n += 1; laeufe.push(`start ${n}`); if (n === 1) await tor; laeufe.push(`ende ${n}`); return "ok"; });
  const a = E.speichern("pQueue");
  await new Promise((r) => setTimeout(r, 0));
  const b = E.speichern("pQueue");
  const c = E.speichern("pQueue");
  assert.equal(b, c, "further presses share the queued save");
  los();
  await Promise.all([a, b]);
  assert.deepEqual(laeufe, ["start 1", "ende 1", "start 2", "ende 2"]);
});

test("a source registered before the person was known is found by Speichern (keyed per project)", async () => {
  let gerufen = 0;
  E.speichererSetzen("pPerson", "studio", async () => { gerufen += 1; return "leer"; });
  E.benutzerSetzen("testperson-11505c");
  await E.speichern("pPerson");
  assert.equal(gerufen, 1);
});

test("attribute layer: a studio value (loaded like the envelope values, part of the studio's patch)", () => {
  const layer = { v: 1, attribute: { "hull-wall": { status: "bestand" } } };
  assert.deepEqual(studioWerteAusDatensatz({ bauteil_attribute_layer: layer }).bauteil_attribute_layer, layer);
  assert.equal(studioWerteAusDatensatz({}).bauteil_attribute_layer, null);
  const w = studioWerteAusDatensatz({ bauteil_attribute_layer: layer });
  const { patch } = studioPatch(w, "pAttr", { verschneidung: false, dachIfc: false, treppen: false, gauben: false, notizen: false });
  assert.deepEqual(patch.bauteil_attribute_layer, layer);
  assert.ok(E.STUDIO_ENTWURF_FELDER.includes("bauteil_attribute_layer"));
});
