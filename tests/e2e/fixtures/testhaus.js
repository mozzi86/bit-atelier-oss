// 87-01: the "Review Testhaus" project is the shared state of every massing / workshop /
// form spec — one BimModel record in the running Express JSON-DB (it exists only in
// server/db.json, there is no seed source). This module resets that record through the
// API, not the UI, and FAILS when the reset does not land.
//
// In:  a Playwright APIRequestContext (baseURL http://localhost:5173, Vite proxies /api).
// Out: TESTHAUS (the expected footprint), testhausLaden, testhausSoll (start-of-run
//      snapshot), testhausZuruecksetzen (restore + verify).
import fs from "node:fs";
import path from "node:path";

export const PROJEKT_NAME = "Review Testhaus";
/** Expected building: 70 × 16 m, centred (site corners (0,17)–(70,33)), 4 storeys of 3 m. */
export const TESTHAUS = {
  footprintM: [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }],
  storeys: 4,
  storeyHeight: 3,
  unit: "m",
};
/** Where global-setup stores the start-of-run record (layers included). */
export const SOLL_DATEI = path.resolve("test-results/testhaus-soll.json");

const API = "/api/entities";

/** Project + BimModel record of the test house from the running server. */
export async function testhausLaden(request) {
  const p = await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`);
  if (!p.ok()) throw new Error(`Testhaus: Project-Abfrage ${p.status()}`);
  const projekte = await p.json();
  const projekt = (Array.isArray(projekte) ? projekte : []).find((x) => x?.name === PROJEKT_NAME);
  if (!projekt) throw new Error(`Testhaus: Projekt „${PROJEKT_NAME}“ fehlt in der DB — npm run seed?`);
  // 72-01 A-2 reads the parcel estimate from building_area (500 m² × 3); a project created before this
  // field was part of the fixture gets it once — without it the estimate falls back to 3 000 m².
  if (projekt.building_area == null) await request.put(`${API}/Project/${projekt.id}`, { data: { building_area: 500 } });
  const b = await request.get(`${API}/BimModel?project_id=${encodeURIComponent(projekt.id)}`);
  if (!b.ok()) throw new Error(`Testhaus: BimModel-Abfrage ${b.status()}`);
  const modelle = await b.json();
  const modell = (Array.isArray(modelle) ? modelle : [])[0];
  if (!modell) throw new Error(`Testhaus: kein BimModel für Projekt ${projekt.id}`);
  return { projekt, modell };
}

/** Max corner deviation between two footprints, m (Infinity when the shapes differ). */
export function footprintAbweichung(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d = Math.max(d, Math.abs(a[i].x - b[i].x), Math.abs(a[i].z - b[i].z));
  return d;
}

/**
 * 87-03: a fresh clone (CI, reseeded machine) has no "Review Testhaus" — server/db.json
 * is gitignored. Create project + BimModel from the committed fixture
 * (tests/e2e/fixtures/testhaus-record.json = the record of 09.10.2026, layers included).
 * Idempotent: whatever exists is kept.
 */
export async function testhausAnlegen(request) {
  const fixture = JSON.parse(fs.readFileSync(path.resolve("tests/e2e/fixtures/testhaus-record.json"), "utf8"));
  const p = await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT_NAME)}`);
  let projekt = (p.ok() ? await p.json() : []).find?.((x) => x?.name === PROJEKT_NAME);
  if (!projekt) {
    const r = await request.post(`${API}/Project`, { data: { name: PROJEKT_NAME, status: "planning", building_area: 500, description: "E2E-Testprojekt (87-01/87-03): 70 × 16 m, 4 Geschosse" } });
    if (!r.ok()) throw new Error(`Testhaus: Projekt anlegen ${r.status()} ${await r.text()}`);
    projekt = await r.json();
    console.log(`[testhaus] Projekt „${PROJEKT_NAME}“ angelegt (${projekt.id})`);
  }
  const b = await request.get(`${API}/BimModel?project_id=${encodeURIComponent(projekt.id)}`);
  const modelle = b.ok() ? await b.json() : [];
  if (!(Array.isArray(modelle) && modelle.length)) {
    const r = await request.post(`${API}/BimModel`, { data: { project_id: projekt.id, ...fixture, ...TESTHAUS } });
    if (!r.ok()) throw new Error(`Testhaus: BimModel anlegen ${r.status()} ${await r.text()}`);
    console.log("[testhaus] BimModel aus der Fixture angelegt");
  }
}

/**
 * Start of a run: force the geometry to TESTHAUS (a crashed run may have left it
 * dirty), then snapshot the whole record — layers included — as the target every
 * test is restored to.
 */
export async function testhausSollSchreiben(request) {
  await testhausAnlegen(request);
  const { modell } = await testhausLaden(request);
  if (footprintAbweichung(modell.footprintM, TESTHAUS.footprintM) > 0.011 || modell.storeys !== TESTHAUS.storeys
    || modell.storeyHeight !== TESTHAUS.storeyHeight || modell.unit !== TESTHAUS.unit) {
    console.warn(`[testhaus] Geometrie beim Start abweichend (${JSON.stringify(modell.footprintM)}) — wird auf 70 × 16 gesetzt`);
    const r = await request.put(`${API}/BimModel/${modell.id}`, { data: { ...modell, ...TESTHAUS } });
    if (!r.ok()) throw new Error(`Testhaus: Reset beim Start ${r.status()}`);
  }
  // 86-07: the drawn axis (programme field achseM) is no part of the test house — a run that
  // stopped before its clean-up would otherwise freeze it into the snapshot and every later
  // restore would bring it back. Start every run without an axis.
  if (Array.isArray(modell.achseM) && modell.achseM.length) {
    console.warn("[testhaus] liegengebliebene Achse (achseM) beim Start entfernt");
    const r = await request.put(`${API}/BimModel/${modell.id}`, { data: { achseM: null } });
    if (!r.ok()) throw new Error(`Testhaus: Achse entfernen ${r.status()}`);
  }
  // 73-05: an outline edit stamps footprintQuelle "gezeichnet" — the test house carries no provenance
  // (73-02 expects no "Umriss" line on the new-build house). Start every run without it.
  if (modell.footprintQuelle != null) {
    console.warn("[testhaus] footprintQuelle beim Start entfernt");
    const r = await request.put(`${API}/BimModel/${modell.id}`, { data: { footprintQuelle: null } });
    if (!r.ok()) throw new Error(`Testhaus: footprintQuelle entfernen ${r.status()}`);
  }
  const { modell: soll } = await testhausLaden(request);
  fs.mkdirSync(path.dirname(SOLL_DATEI), { recursive: true });
  fs.writeFileSync(SOLL_DATEI, JSON.stringify(soll, null, 2));
  return soll;
}

/** The start-of-run record (throws when global-setup did not run). */
export function testhausSoll() {
  if (!fs.existsSync(SOLL_DATEI)) throw new Error(`Testhaus: ${SOLL_DATEI} fehlt — läuft global-setup?`);
  return JSON.parse(fs.readFileSync(SOLL_DATEI, "utf8"));
}

/**
 * Set the footprint (centred metres, as stored) through the API — for specs that need a
 * shape the UI cannot reach by dragging (massing-75-06: 30 m moves are clamped by the
 * parcel). The page must reload afterwards; base.js restores the house after the test.
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {Array<{x:number, z:number}>} footprintM
 */
export async function testhausFootprintSetzen(request, footprintM) {
  const { modell } = await testhausLaden(request);
  const r = await request.put(`${API}/BimModel/${modell.id}`, { data: { footprintM } });
  if (!r.ok()) throw new Error(`Testhaus: Footprint setzen ${r.status()}`);
  const { modell: danach } = await testhausLaden(request);
  const d = footprintAbweichung(danach.footprintM, footprintM);
  if (d > 0.011) throw new Error(`Testhaus: Footprint nach Setzen weicht ${d.toFixed(3)} m ab`);
  return danach;
}

/**
 * Restore the record to the start-of-run snapshot and read it back. Throws (= the test
 * fails) when the footprint is still off by more than 1 cm or the layers differ — a spec
 * that leaves the house dirty must not pass silently (87-01).
 */
export async function testhausZuruecksetzen(request, soll = testhausSoll()) {
  const { modell } = await testhausLaden(request);
  const { id, created_date, updated_date, ...felder } = soll; // eslint-disable-line no-unused-vars
  const r = await request.put(`${API}/BimModel/${modell.id}`, { data: felder });
  if (!r.ok()) throw new Error(`Testhaus: Reset ${r.status()} ${await r.text()}`);
  const { modell: danach } = await testhausLaden(request);
  const d = footprintAbweichung(danach.footprintM, soll.footprintM);
  if (d > 0.011) throw new Error(`Testhaus: Footprint nach Reset weicht ${d.toFixed(3)} m ab`);
  for (const k of Object.keys(felder)) {
    if (k === "footprintM") continue;
    if (JSON.stringify(danach[k] ?? null) !== JSON.stringify(felder[k] ?? null)) {
      throw new Error(`Testhaus: Feld „${k}“ nach Reset nicht wie beim Start`);
    }
  }
  return danach;
}
