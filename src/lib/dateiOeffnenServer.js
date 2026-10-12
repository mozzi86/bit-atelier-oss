// dateiOeffnenServer.js — the app's side of the double-click import in the LOCAL edition (express data
// source, plan 93-10): fetch wrappers around server/dateiOeffnenRouter.js. Same-origin requests, so the
// browser sends the app's Origin, which the server requires for every changing call.
//
// In:  the import token from the URL (?import=<64 hex>), the preview built by dateiOeffnen.js.
// Out: two adapters with the shape DateiOeffnenEmpfang.jsx / DateiQuelleKarte.jsx expect —
//      importAdapter (load / replace / copy / cancel) and quelleAdapter (linked file / save back).

import { anzahlenVon, kopieOptionen } from "./dateiOeffnen.js";

/**
 * The import token of the current URL, or null. Only 64 hex characters count — anything else is ignored.
 * @param {string} search location.search
 * @returns {string|null}
 */
export function importTokenAusUrl(search) {
  const t = new URLSearchParams(search || "").get("import");
  return t && /^[a-f0-9]{64}$/.test(t) ? t : null;
}

/**
 * Reads a JSON answer; a non-2xx status becomes an Error with the server's message.
 * @param {Response} r
 * @returns {Promise<any>}
 */
async function json(r) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { status: r.status, daten: j });
  return j;
}

/** @param {string} url @param {string} methode @param {object} [body] */
const senden = (url, methode, body) => fetch(url, {
  method: methode,
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

/**
 * Import adapter for one token.
 * @param {string} token
 * @returns {{
 *   laden: () => Promise<{obj: any, lokalAnzahl: Record<string, number>, wiederOeffnen: Array<{id: string, name: string}>, quelle: {name: string}}>,
 *   ersetzen: (vorschau: {importOptionen: {behalte: string[], behalteSettingKeys: string[], behalteDokumentBereiche: string[]}}) => Promise<void>,
 *   kopie: () => Promise<void>,
 *   abbrechen: () => Promise<void>,
 * }}
 */
export function importAdapter(token) {
  const basis = `/api/datei/import/${token}`;
  return {
    async laden() {
      const j = await json(await fetch(basis, { cache: "no-store" }));
      return { obj: j.obj, lokalAnzahl: j.lokal?.anzahl || anzahlenVon({}), wiederOeffnen: j.wiederOeffnen || [], quelle: j.quelle };
    },
    async ersetzen(vorschau) {
      const o = vorschau.importOptionen;
      await json(await senden(`${basis}/uebernehmen`, "POST", {
        modus: "ersetzen", behalte: o.behalte, behalteSettingKeys: o.behalteSettingKeys, behalteDokumentBereiche: o.behalteDokumentBereiche,
      }));
    },
    async kopie() {
      await json(await senden(`${basis}/uebernehmen`, "POST", { modus: "kopie", ...kopieOptionen() }));
    },
    async abbrechen() {
      await fetch(basis, { method: "DELETE" }).catch(() => {});
    },
  };
}

/**
 * Linked-source adapter of the local edition.
 * @returns {{
 *   quelle: () => Promise<{name: string, pfad: string, importiertAm?: string, gespeichertAm?: string|null, vorhanden: boolean}|null>,
 *   zurueck: (entscheidung?: "ueberschreiben"|"kopie") => Promise<{ok?: boolean, pfad?: string, kopie?: boolean, konflikt?: "geaendert"|"fehlt"}>,
 * }}
 */
export function quelleAdapter() {
  return {
    async quelle() {
      const j = await json(await fetch("/api/datei/quelle", { cache: "no-store" }));
      return j.quelle ? { ...j.quelle, vorhanden: !!j.vorhanden } : null;
    },
    async zurueck(entscheidung) {
      // A changed or missing file is an ordinary answer ({ok: false, konflikt}), not an HTTP error.
      return json(await senden("/api/datei/zurueckschreiben", "POST", entscheidung ? { entscheidung } : {}));
    },
  };
}
