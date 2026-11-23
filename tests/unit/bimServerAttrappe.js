// 115-05b part 2: a fetch stand-in of the express entity routes for BimModel and BuildingComplex, shared by the unit tests of the
// focus check and the strict writers (pattern: projektBindung-11505b.test.js bimServer, extended by GET /:id and a second entity).
//   GET  /entities/<E>?project_id=  → the records of that project      GET /entities/<E>/<id> → the record or 404
//   PUT  /entities/<E>/<id>?stand=  → 409 {gespeichert} when the stored record is another state (routes.js standVeraltet), else a
//                                     flat merge with a new updated_date
//   POST /entities/<E>              → a new record with a new id
// Every request is recorded (`anfragen`, writes also in `schreiben`).
//
// In: start records per entity. Out: {fetch, schreiben, anfragen, setze, rec, alle, entfernen}.

/**
 * @param {Record<string, any[]>} start records per entity name (each with id, project_id, updated_date)
 */
export function bimServer(start) {
  /** @type {Map<string, Map<string, any>>} */
  const db = new Map(Object.entries(start).map(([e, rows]) => [e, new Map(rows.map((r) => [r.id, r]))]));
  /** @type {Array<{entity: string, id: string, stand: string|null, body: any, methode: string}>} */ const schreiben = [];
  /** @type {string[]} */ const anfragen = [];
  let n = 0;
  const antwort = (/** @type {number} */ status, /** @type {any} */ json) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => json });
  const tabelle = (/** @type {string} */ e) => { if (!db.has(e)) db.set(e, new Map()); return /** @type {Map<string, any>} */ (db.get(e)); };
  return {
    schreiben,
    anfragen,
    /** puts a record as another writer would (no request recorded) @param {string} e @param {any} r */
    setze: (e, r) => { tabelle(e).set(r.id, r); },
    /** @param {string} e @param {string} id */
    entfernen: (e, id) => { tabelle(e).delete(id); },
    /** the first record of a project @param {string} e @param {string} pid */
    rec: (e, pid) => [...tabelle(e).values()].find((r) => r.project_id === pid),
    /** @param {string} e */
    alle: (e) => [...tabelle(e).values()],
    fetch: async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
      const u = new URL(String(url), "http://test.local");
      const teile = u.pathname.split("/").filter(Boolean); // api, entities, <E>, [id]
      const entity = teile[2];
      const id = teile[3] ? decodeURIComponent(teile[3]) : null;
      const methode = opt.method || "GET";
      anfragen.push(`${methode} ${entity}${id ? `/${id}` : ""}`);
      const t = tabelle(entity);
      if (methode === "GET") {
        if (id) return t.has(id) ? antwort(200, t.get(id)) : antwort(404, { error: "Not found" });
        const pid = u.searchParams.get("project_id");
        return antwort(200, [...t.values()].filter((r) => r.project_id === pid));
      }
      const stand = u.searchParams.get("stand");
      const body = opt.body ? JSON.parse(opt.body) : null;
      schreiben.push({ entity, id: String(id), stand, body, methode });
      n += 1;
      const zeit = `2026-11-19T13:${String(n).padStart(2, "0")}:00.000Z`;
      if (methode === "POST") {
        const neu = { ...body, id: `neu${n}`, created_date: zeit, updated_date: zeit };
        t.set(neu.id, neu);
        return antwort(201, neu);
      }
      const vorher = id ? t.get(id) : null;
      if (!vorher) return antwort(404, { error: "Not found" });
      if (stand && stand !== vorher.updated_date) return antwort(409, { error: "veraltet", konflikt: true, gespeichert: vorher });
      const neu = { ...vorher, ...body, id, updated_date: zeit };
      t.set(String(id), neu);
      return antwort(200, neu);
    },
  };
}
