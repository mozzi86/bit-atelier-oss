// Write side of the rule-book editor (80-07, "Einstellungen › Regelwerke", E-16):
// checks an office value against its rule BEFORE it ever reaches storage, then
// writes it through whichever of the two storage kinds the group uses.
//
// - `zeilen` (HR, later 81): one Setting row per rule, key "regel:<id>" — a plain
//   upsert through @core/lib/useEinstellung, so this file adds no storage logic of
//   its own for that kind.
// - `setting` (79 accounting): a field inside the ONE row 79 reads
//   (Setting{key:"buchhaltung"}, the FIRST row of that key — not the newest, or a
//   duplicate row would let 79 and this editor disagree, BEFUNDE-79 N-17). Every
//   accepted value still has to pass 79's OWN whitelist
//   (wirksameEinstellungen — NaN, negative days, an unknown legal form …), because
//   that whitelist is the single source of truth 79 itself reads from.
//
// Boundary note (MOD-04): this package may import only @core/…, never the app's
// `@/lib/accounting/*` — so 79's wirksameEinstellungen cannot be imported here.
// The caller (src/components/settings/RegelwerkBereich.jsx, which MAY import it)
// injects it as `pruefeSetting` instead; without it, a `setting`-kind write skips
// the 79-whitelist re-check (still caught by pruefeOverride's own type/`grenze`
// checks) — every real caller in this app passes it. This is why `setzeRegel`'s
// fourth parameter is an options object and not a bare Setting client, unlike the
// plan text's literal "client?": the plan named only the client because it did not
// yet know the whitelist needed a second injected function to keep the boundary.
//
// In:  a RegelGruppe (src/lib/settings/regelwerke.js), a rule id, the new value,
//      optionally {client, pruefeSetting}. Out: setzeRegel, zuruecksetzen,
//      gruppeZuruecksetzen — all Promises, all reject on a storage failure.

import { bitApi } from "@core/api/bitApi";
import { EINSTELLUNG_EREIGNIS } from "./einstellungen.js";
import { leseEinstellung, loescheEinstellung, setzeEinstellung } from "./useEinstellung.js";
import { istEditierbar, overrideWert, pruefeOverride, regelSchluessel, settingFeldEntfernen, settingFeldSetzen } from "./regelwerk.js";

/**
 * Injectable dependencies of a write.
 * @typedef {{client?: any, pruefeSetting?: (neuerWert: Record<string, any>) => Record<string, any>}} SchreibAbhaengigkeiten
 *   client: the Setting entity client (default bitApi.entities.Setting) — storage
 *     kind `zeilen` passes it through to @core/lib/useEinstellung, kind `setting`
 *     uses it directly (filter/update/create) to read/write the FIRST row of the key.
 *   pruefeSetting: 79's wirksameEinstellungen (or an equivalent whitelist) for
 *     storage kind `setting`; the app injects it, this package never imports it.
 */

/** @returns {any} default Setting client (bitApi.entities is untyped at runtime) */
const standardSettingClient = () => /** @type {any} */ (bitApi.entities).Setting;

/**
 * Fires the change event. No-op outside a browser, like useEinstellung.js's melde().
 * @param {string} key
 */
function melde(key) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(EINSTELLUNG_EREIGNIS, { detail: { key } }));
}

/**
 * Deep-ish equality for one field's value (numbers, strings, booleans, plain data).
 * @param {any} a @param {any} b
 */
function gleicherWert(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * The row 79 itself reads for a Setting key: the FIRST row (client.filter order),
 * never the newest — a duplicate (BEFUNDE-79 N-17) must not let this editor and 79
 * disagree about which row is "the" value.
 * @param {any} client @param {string} key
 * @returns {Promise<any|null>}
 */
async function ersteZeile(client, key) {
  const zeilen = await client.filter({ key });
  return Array.isArray(zeilen) && zeilen[0] ? zeilen[0] : null;
}

/**
 * Sets one rule's office value, after two checks: the rule's own
 * (`pruefeOverride` — type, `grenze`, read-only) and, for storage kind `setting`,
 * 79's whitelist (`pruefeSetting`). Nothing is written when either check fails.
 * @param {import("./regelwerk.js").RegelGruppe} gruppe
 * @param {string} id rule id
 * @param {{wert: any, gueltig_ab?: string, notiz?: string}} eingabe
 * @param {SchreibAbhaengigkeiten} [abh]
 * @returns {Promise<{ok: boolean, text?: string, schluessel?: string, werte?: Record<string, string>, warnung?: {schwere: string, text: string, schluessel: string, werte: Record<string, string>}}>}
 *   on a rejection, `text` is the already-filled German message and `schluessel`/`werte` are the
 *   REGEL_PRUEFTEXTE template and its placeholders — the caller (RegelwerkTabelle.jsx) translates
 *   with `t(schluessel)` instead of showing `text` directly, exactly as regelwerk.js's own file
 *   header describes for `pruefeOverride`'s result.
 */
export async function setzeRegel(gruppe, id, eingabe, abh = {}) {
  const regel = (gruppe?.regeln || []).find((r) => r.id === id);
  const befund = pruefeOverride(regel, eingabe?.wert);
  if (befund?.schwere === "fail") return { ok: false, text: befund.text, schluessel: befund.schluessel, werte: befund.werte };

  if (gruppe?.speicher?.art === "zeilen") {
    const schluessel = regelSchluessel(id);
    const { wert: vorher } = await leseEinstellung(schluessel, abh.client);
    await setzeEinstellung(schluessel, overrideWert(eingabe, regel, vorher), abh.client);
    return befund ? { ok: true, warnung: befund } : { ok: true };
  }

  if (gruppe?.speicher?.art === "setting") {
    // Optional pre-write hook of the group (RegelGruppe.vorSchreiben). Its only
    // user, the demo's sample-books seed, went with the demo in 83-02.
    await gruppe.vorSchreiben?.();
    const client = abh.client ?? standardSettingClient();
    const zeile = await ersteZeile(client, gruppe.speicher.key);
    const feld = gruppe.speicher.feld(id);
    const neu = settingFeldSetzen(zeile?.value, feld, eingabe.wert);
    const geprueft = abh.pruefeSetting ? abh.pruefeSetting(neu) : neu;
    if (abh.pruefeSetting && !gleicherWert(geprueft[feld], eingabe.wert)) {
      // No REGEL_PRUEFTEXTE placeholder needed — the literal string doubles as its own i18n key.
      return { ok: false, text: "Wert von der Buchhaltung abgelehnt", schluessel: "Wert von der Buchhaltung abgelehnt", werte: {} };
    }
    if (zeile) await client.update(zeile.id, { key: gruppe.speicher.key, value: neu });
    else await client.create({ key: gruppe.speicher.key, value: neu });
    melde(gruppe.speicher.key);
    return befund ? { ok: true, warnung: befund } : { ok: true };
  }

  return { ok: false, text: "Unbekannte Speicherart." };
}

/**
 * Resets one rule to its standard (removes the override).
 * @param {import("./regelwerk.js").RegelGruppe} gruppe
 * @param {string} id rule id
 * @param {SchreibAbhaengigkeiten} [abh]
 * @returns {Promise<void>}
 */
export async function zuruecksetzen(gruppe, id, abh = {}) {
  if (gruppe?.speicher?.art === "zeilen") {
    await loescheEinstellung(regelSchluessel(id), abh.client);
    return;
  }
  if (gruppe?.speicher?.art === "setting") {
    const client = abh.client ?? standardSettingClient();
    const zeile = await ersteZeile(client, gruppe.speicher.key);
    if (!zeile) return;
    const neu = settingFeldEntfernen(zeile.value, gruppe.speicher.feld(id));
    await client.update(zeile.id, { key: gruppe.speicher.key, value: neu });
    melde(gruppe.speicher.key);
  }
}

/**
 * Resets every editable rule of a group to its standard.
 * @param {import("./regelwerk.js").RegelGruppe} gruppe
 * @param {SchreibAbhaengigkeiten} [abh]
 * @returns {Promise<void>}
 */
export async function gruppeZuruecksetzen(gruppe, abh = {}) {
  for (const regel of (gruppe?.regeln || []).filter((r) => istEditierbar(r))) await zuruecksetzen(gruppe, regel.id, abh);
}
