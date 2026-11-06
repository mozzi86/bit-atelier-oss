// 108-01: the neutral test house of phase 108 for the browser tests — project "Review EFH 108" with a generic single-family house
// 11.40 × 10.20 m (KG −1 2.75 m, EG 0 2.90 m, DG 1 2.60 m, gable roof 45°, two interior walls, one entrance door in the hull). Invented
// values (same house as tests/unit/fixtures/efh-108.js), no real project behind them.
//
// In:  a Playwright APIRequestContext (baseURL = the dev stack, Vite proxies /api).
// Out: EFH_PROJEKT (name), EFH_SOLL (the record fields), efhAnlegen (creates project + record when missing),
//      efhZuruecksetzen (writes the target state back before each spec, optionally with other fields, removes a design record
//      (BuildingComplex) of the project and checks it landed) and efhKomplexSetzen (a design record with site-planning areas).
const API = "/api/entities";

export const EFH_PROJEKT = "Review EFH 108";

/** Record fields of the test house (BimModel shape). `entranceCfg` deliberately WITHOUT `enabled` (a new project, D-EFH-04). */
export const EFH_SOLL = Object.freeze({
  footprintM: [{ x: -5.7, z: -5.1 }, { x: 5.7, z: -5.1 }, { x: 5.7, z: 5.1 }, { x: -5.7, z: 5.1 }],
  footprintQuelle: null,
  storeys: 2,
  storeyHeight: 2.9,
  untergeschosse: 1,
  geschosse: [{ level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.6 }],
  unit: "m",
  dachform: "sattel",
  dachneigung: 45,
  parapet: { enabled: false, height: 1 },
  entranceCfg: { width: 1.2, height: 2.1, uRel: 0.5, edge: null },
  customWalls: [
    { a: { x: -0.5, z: -5.1 }, b: { x: -0.5, z: 5.1 }, level: 0, thickness: 0.115, _idx: 1 },
    { a: { x: -0.5, z: 0.6 }, b: { x: 5.7, z: 0.6 }, level: 0, thickness: 0.115, _idx: 2 },
  ],
  customColumns: [],
  customWindows: [],
  customZones: [],
  customSlabs: [],
  customRoofs: [],
  envOpenings: [{ level: 0, edge: 0, kind: "door", u: 2.2, width: 1.01, height: 2.135, sill: 0 }],
});

/**
 * Project + BimModel record of the test house; created when missing (idempotent).
 * @param {import("@playwright/test").APIRequestContext} request
 * @returns {Promise<{projekt: any, modell: any}>}
 */
export async function efhAnlegen(request) {
  const p = await request.get(`${API}/Project?name=${encodeURIComponent(EFH_PROJEKT)}`);
  if (!p.ok()) throw new Error(`EFH 108: Project-Abfrage ${p.status()}`);
  let projekt = (await p.json()).find?.((/** @type {any} */ x) => x?.name === EFH_PROJEKT);
  if (!projekt) {
    const r = await request.post(`${API}/Project`, { data: { name: EFH_PROJEKT, status: "planning", build_kind: "neubau", building_area: 116, description: "E2E-Testprojekt (108-01): EFH 11,40 × 10,20 m, KG/EG/DG, Satteldach 45°" } });
    if (!r.ok()) throw new Error(`EFH 108: Projekt anlegen ${r.status()} ${await r.text()}`);
    projekt = await r.json();
  }
  const b = await request.get(`${API}/BimModel?project_id=${encodeURIComponent(projekt.id)}`);
  let modell = (b.ok() ? await b.json() : [])[0];
  if (!modell) {
    const r = await request.post(`${API}/BimModel`, { data: { project_id: projekt.id, ...EFH_SOLL } });
    if (!r.ok()) throw new Error(`EFH 108: BimModel anlegen ${r.status()} ${await r.text()}`);
    modell = await r.json();
  }
  return { projekt, modell };
}

/**
 * Writes the target state into the record (the server merges flat, so every field of EFH_SOLL is written) and reads it back; throws
 * when a field did not land. 108-01 review: `anders` overrides single fields (e.g. the parapet switched on); a design record
 * (BuildingComplex) of the test project is removed, so no site-planning area of an earlier spec takes over the outline.
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {Record<string, any>} [anders] fields that differ from EFH_SOLL in this spec
 * @returns {Promise<{projekt: any, modell: any}>}
 */
export async function efhZuruecksetzen(request, anders = {}) {
  const { projekt, modell } = await efhAnlegen(request);
  for (const c of await (await request.get(`${API}/BuildingComplex?project_id=${encodeURIComponent(projekt.id)}`)).json()) {
    await request.delete(`${API}/BuildingComplex/${c.id}`);
  }
  // 108-08: a position of the massing body (footprintLageM) a spec left behind is cleared (null = no position); a record without the
  // field keeps it absent (108-08 review, like testhaus.js) - so "old project without the field" stays testable with this fixture
  const lageZurueck = !("footprintLageM" in anders) && modell?.footprintLageM != null;
  const soll = { ...EFH_SOLL, ...(lageZurueck ? { footprintLageM: null } : {}), ...anders };
  const r = await request.put(`${API}/BimModel/${modell.id}`, { data: soll });
  if (!r.ok()) throw new Error(`EFH 108: Reset ${r.status()} ${await r.text()}`);
  const danach = (await (await request.get(`${API}/BimModel?project_id=${encodeURIComponent(projekt.id)}`)).json())[0];
  for (const [k, v] of Object.entries(soll)) {
    if (JSON.stringify(danach?.[k] ?? null) !== JSON.stringify(v ?? null)) throw new Error(`EFH 108: Feld „${k}“ nach Reset nicht wie Soll`);
  }
  return { projekt, modell: danach };
}

/**
 * 108-01 review: a design record (BuildingComplex) of the test project with site-planning areas. Removed again by efhZuruecksetzen.
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string} projektId
 * @param {Record<string, any>} daten record fields (designated_areas in canvas px, site_parcel with m_per_px)
 * @returns {Promise<any>} the created record
 */
export async function efhKomplexSetzen(request, projektId, daten) {
  const r = await request.post(`${API}/BuildingComplex`, { data: { project_id: projektId, ...daten } });
  if (!r.ok()) throw new Error(`EFH 108: BuildingComplex anlegen ${r.status()} ${await r.text()}`);
  return r.json();
}
