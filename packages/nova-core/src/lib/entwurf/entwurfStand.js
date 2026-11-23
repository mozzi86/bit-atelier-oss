// 115-05c (§6.3–§6.5, D-115-12, D-115-51): the draft of the open project on THIS page - the one place the sources report to,
// the one "Speichern", the local copy. Loaded lazily (size budget); the sources (BIM studio, program hook, design record) and the
// draft bar (EntwurfLeiste.jsx) import it on first use.
//
// What it does
//   - holds one draft (modellEntwurf.js) per person and project in memory; a source reports its values (melden) - fields equal to
//     the stored base leave the draft. 800 ms after the last report, and at once when the page is hidden, the draft is written to
//     the browser (entwurfSpeicher.js). A refused write (store full) is REPORTED in the state (`sicherung`), never swallowed.
//   - starten: the draft of a project for a source that loads it - from memory (same page, e.g. a tab switch inside the designer)
//     or from the browser (after a reload: `wiederhergestellt`). A stored draft of another person is never read (key per person).
//   - speichern: K5 order design record → program fields → studio (a footprint can hang on the design record's areas); each source
//     writes its own fields through its strict save path (stand protection of 115-05a/b: 409 → three ways, conflicts → cards and
//     locked fields, never a silent overwrite). The bim part of a draft whose studio is not mounted is rebased here and written
//     strictly on the stand of that rebase (K2: `basisStand`, refused when the stored record moved in between → read again, at most
//     three times). After the save the waiting proposal steps go to the change log (D-115-51). Result per record: "gespeichert",
//     "teilweise" (one record written, the other not, K5) or "konflikt" (a card waits); the unsaved part stays in the draft.
//   - verwerfen: every source puts the stored state back, the local copy goes, waiting steps are dropped (marked by the studio).
//
// In:  reports of the sources, the user id. Out: the state for the bar (zustand / abonnieren), speichern, verwerfen.

import { bitApi } from "../../api/bitApi.js";
import { saveBimModel, loadBimModel, migriereLayerDesDatensatzes, entwurfAnLeser, feldSperren, feldFreigeben, wertKurz } from "../useBimModelSync.js";
import { abgleichStand } from "../abgleich/abgleichStand.js";
import { feldDreiWege } from "../abgleich/dreiWege.js";
import { feldName } from "../abgleich/modellAbgleich.js";
import { IDX_LISTEN } from "../abgleich/idxListen.js";
import { STUDIO_WERTE } from "../abgleich/modellAbgleich.js";
import { entwurfLeer, entwurfMelden, entwurfAenderungen, entwurfSauber, entwurfNachSpeichern, entwurfEntscheiden, entwurfRebase,
  entwurfSchrittVormerken, entwurfSchrittEntfernen } from "./modellEntwurf.js";
import { entwurfBrowserSpeicher, entwurfSpeichern, entwurfLaden, entwurfLoeschen, ENTWURF_SICHERN_MS, entwurfeAufraeumen } from "./entwurfSpeicher.js";

/** @typedef {import("./modellEntwurf.js").ModellEntwurf} ModellEntwurf */
/** @typedef {string} EntwurfQuelle "komplex", "programm", "studio" (fixed order, K5) or "layer:<feld>" (after them) */
/** @typedef {"gespeichert"|"entwurf"|"speichert"|"teilweise"|"konflikt"|"fehler"} EntwurfStatus */
/**
 * What the draft bar shows for a project.
 * @typedef {{aenderungen: number, sauber: boolean, status: EntwurfStatus, meldung: string|null, sicherung: string|null,
 *   wiederhergestellt: boolean, offen: null|"ersetzt"|"geloescht", zeit: string|null, lesefehler: null|"kaputt"|"version"|"fremd"}} EntwurfZustand
 *   meldung = German key of the last save's note; sicherung = text of a refused local write; offen = a stored draft that does not
 *   fit the stored model (other record / record gone) waits for the person's decision (never continued automatically);
 *   lesefehler = the stored draft of this person and project could not be read (broken / other version / other owner) - the stored
 *   model is open, the bar says so; the next change replaces the unreadable entry (it holds nothing that could be shown)
 */

// the pure decisions for the sources that already hold this module (no second lazy load)
export { entwurfEntscheiden, entwurfRebase };

/** The fields the BIM studio owns (115-05c: with the attribute layer of the hull and workshop elements, 97-02) in the draft (the ten lists and the envelope values). */
export const STUDIO_ENTWURF_FELDER = Object.freeze([...IDX_LISTEN, ...Object.keys(STUDIO_WERTE), "bauteil_attribute_layer"]);

/** Order of the save (K5). @type {ReadonlyArray<EntwurfQuelle>} */
const REIHENFOLGE = Object.freeze(["komplex", "programm", "studio"]);

let benutzer = "lokal";
/** @type {Map<string, {entwurf: ModellEntwurf, status: EntwurfStatus, meldung: string|null, sicherung: string|null, wiederhergestellt: boolean, offen: null|"ersetzt"|"geloescht", lesefehler?: null|"kaputt"|"version"|"fremd"}>} */
const staende = new Map();
/** @type {Map<string, EntwurfZustand>} */
const schnappschuss = new Map();
/** @type {Set<() => void>} */
const hoerer = new Set();
/** @type {Map<string, (opt?: any) => Promise<"ok"|"teilweise"|"konflikt"|"leer">>} */
const speicherer = new Map();
/** @type {Map<string, () => (void|Promise<void>)>} */
const zuruecksetzer = new Map();
/** @type {Map<string, (s: {vorschlag_id: string, eintrag: any, pruefung?: any}) => Promise<any>>} */
const schrittSchreiber = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const timer = new Map();
/** @type {Map<string, Promise<any>>} */
const laeuft = new Map();

/** @param {string} pid @returns {string} */
const schluessel = (pid) => `${benutzer}|${pid}`;
/**
 * Key of a registered source: per project only - a source registers when it mounts, possibly before the person is known
 * (benutzerBereit), and must be found after it.
 * @param {string} pid @param {string} quelle @returns {string}
 */
const qs = (pid, quelle) => `${pid}|${quelle}`;

/**
 * The person whose drafts this page works on (AuthContext user id; "lokal" without a sign-in, express / local build).
 * @param {string|null|undefined} id
 */
export function benutzerSetzen(id) {
  const neu = id ? String(id) : "lokal";
  if (neu === benutzer) return;
  benutzer = neu;
  aendern();
}

/** @returns {string} the person of this page's drafts */
export function benutzerId() { return benutzer; }

/** @type {Promise<string>|null} */
let benutzerLaden = null;
/**
 * The signed-in person, read once per page (bitApi.auth.me: express = the local user, cloud = the session's user; without one
 * "lokal"). Every source awaits it through `starten` before it reports, so no draft is ever keyed by the wrong person.
 * @returns {Promise<string>}
 */
export function benutzerBereit() {
  benutzerLaden ||= bitApi.auth.me()
    .then((/** @type {any} */ u) => { benutzerSetzen(u?.id ?? u?.email ?? null); return benutzer; })
    .catch(() => benutzer);
  return benutzerLaden;
}

/**
 * Signing out (AuthContext): the person's drafts leave this page; the next start asks for the person again.
 * @returns {void}
 */
export function benutzerVergessen() {
  for (const k of [...staende.keys()]) if (k.startsWith(`${benutzer}|`)) staende.delete(k);
  benutzerLaden = null;
  benutzer = "lokal";
  aendern();
}

/** Projects whose draft another tab of this browser holds (K10): nothing is reported, saved or written locally here. @type {Set<string>} */
const gesperrtFuer = new Set();
/**
 * K10: this tab does not hold the project (another tab of the same browser does) - reports, saves and local writes rest.
 * @param {string} pid @param {boolean} an
 */
export function sperren(pid, an) {
  const k = schluessel(pid);
  if (an === gesperrtFuer.has(k)) return;
  if (an) { gesperrtFuer.add(k); clearTimeout(timer.get(k)); timer.delete(k); } else gesperrtFuer.delete(k);
  aendern();
}
/** @param {string} pid @returns {boolean} */
export function istGesperrt(pid) { return gesperrtFuer.has(schluessel(pid)); }

/**
 * "Trotzdem fortsetzen" of a stored draft that does not fit the stored model (other record / record gone): the draft's base keeps
 * its values but loses its record id, so the next load rebases it three ways on the stored record (nothing is dropped silently).
 * The caller reloads the page afterwards.
 * @param {string} pid @returns {Promise<boolean>} written locally
 */
export async function trotzdemFortsetzen(pid) {
  const s = standVon(pid);
  const ohneId = (/** @type {any} */ b) => (b ? { ...b, id: null, updated_date: null } : b);
  s.entwurf = { ...s.entwurf, basis: { bim: ohneId(s.entwurf.basis.bim), komplex: ohneId(s.entwurf.basis.komplex) } };
  s.offen = null;
  return sichernJetzt(pid);
}

/** @param {() => void} fn @returns {() => void} */
export function abonnieren(fn) {
  hoerer.add(fn);
  return () => { hoerer.delete(fn); };
}

function aendern() {
  schnappschuss.clear();
  for (const fn of [...hoerer]) { try { fn(); } catch { /* a listener's error must not stop the others */ } }
}

/** @param {string} pid */
function standVon(pid) {
  const k = schluessel(pid);
  let s = staende.get(k);
  if (!s) {
    s = { entwurf: entwurfLeer({ benutzer, projekt: pid }), status: "gespeichert", meldung: null, sicherung: null, wiederhergestellt: false, offen: null };
    staende.set(k, s);
  }
  return s;
}

/**
 * The state of the draft of a project (stable object until the next change; for useSyncExternalStore).
 * @param {string|null|undefined} pid @returns {EntwurfZustand}
 */
export function zustand(pid) {
  const k = pid ? schluessel(pid) : "";
  const alt = schnappschuss.get(k);
  if (alt) return alt;
  const s = pid ? staende.get(k) : null;
  /** @type {EntwurfZustand} */
  const z = { aenderungen: s ? entwurfAenderungen(s.entwurf) : 0, sauber: s ? entwurfSauber(s.entwurf) : true,
    status: s?.status ?? "gespeichert", meldung: s?.meldung ?? null, sicherung: s?.sicherung ?? null,
    wiederhergestellt: s?.wiederhergestellt ?? false, offen: s?.offen ?? null, zeit: s?.entwurf.zeit ?? null, lesefehler: s?.lesefehler ?? null };
  if (z.status === "gespeichert" && !z.sauber) z.status = "entwurf";
  schnappschuss.set(k, z);
  return z;
}

/** @param {string|null|undefined} pid @returns {ModellEntwurf|null} the draft in memory (null = none) */
export function entwurfVon(pid) {
  return pid ? staende.get(schluessel(pid))?.entwurf ?? null : null;
}

/** @param {string|null|undefined} pid @returns {boolean} nothing unsaved for the project */
export function istSauber(pid) {
  const s = pid ? staende.get(schluessel(pid)) : null;
  return !s || entwurfSauber(s.entwurf);
}

/**
 * The draft of a project for a source that loads it: from memory (this page) or from the browser (after a reload). An unreadable
 * entry is reported in `fehler` and in the state (`lesefehler`, the bar says it) - never thrown; it stays in place until the next
 * change of the model writes a new draft over it (it holds nothing that could be continued).
 * @param {string} pid
 * @returns {Promise<{entwurf: ModellEntwurf|null, aus: "sitzung"|"speicher"|null, fehler: string|null, offen: null|"ersetzt"|"geloescht"}>}
 */
export async function starten(pid) {
  await benutzerBereit();
  const k = schluessel(pid);
  const s = staende.get(k);
  if (s && (!entwurfSauber(s.entwurf) || s.offen)) return { entwurf: s.entwurf, aus: "sitzung", fehler: null, offen: s.offen };
  // one read of the browser per project and page (both sources of the bim part and the design record ask)
  if (!laeuft.has(k)) {
    laeuft.set(k, (async () => {
      const sp = entwurfBrowserSpeicher();
      void entwurfeAufraeumen(sp).catch(() => { /* cleaning up is best effort */ });
      return entwurfLaden(sp, benutzer, pid);
    })().catch((err) => ({ entwurf: null, fehler: String(err?.message || err) })));
  }
  const r = await laeuft.get(k);
  const jetzt = staende.get(k);
  if (jetzt && (!entwurfSauber(jetzt.entwurf) || jetzt.offen)) return { entwurf: jetzt.entwurf, aus: "sitzung", fehler: null, offen: jetzt.offen };
  if (r.entwurf && !entwurfSauber(r.entwurf)) {
    staende.set(k, { entwurf: r.entwurf, status: "gespeichert", meldung: null, sicherung: null, wiederhergestellt: true, offen: null });
    aendern();
    return { entwurf: r.entwurf, aus: "speicher", fehler: null, offen: null };
  }
  // an unreadable entry is REPORTED (the bar shows it), never thrown: the stored model opens in any case
  if (r.fehler) {
    const st = standVon(pid);
    if (st.lesefehler !== r.fehler) { st.lesefehler = /** @type {any} */ (String(r.fehler)); aendern(); }
  }
  return { entwurf: null, aus: null, fehler: r.fehler ? String(r.fehler) : null, offen: null };
}

/**
 * A stored draft that does not fit the stored model waits for the person (offen); while it waits nothing of it is overwritten.
 * @param {string} pid @param {null|"ersetzt"|"geloescht"} offen
 */
export function offenSetzen(pid, offen) {
  const s = standVon(pid);
  if (s.offen === offen) return;
  s.offen = offen;
  aendern();
}

/**
 * A source reports its values. Ignored while a stored draft waits for a decision (offen) - it must not be overwritten.
 * @param {string} pid @param {"bim"|"komplex"} teil
 * @param {{stand: {id?: any, updated_date?: any}|null, basis: Record<string, any>, werte: Record<string, any>, felder: ReadonlyArray<string>, idx?: Record<string, number[]>|null}} q
 */
export function melden(pid, teil, q) {
  if (!pid || gesperrtFuer.has(schluessel(pid))) return;
  const s = standVon(pid);
  if (s.offen) return;
  const neu = entwurfMelden(s.entwurf, teil, q);
  const vorher = entwurfAenderungen(s.entwurf);
  s.entwurf = neu;
  if (s.status !== "speichert" && entwurfAenderungen(neu) !== vorher) { s.status = entwurfSauber(neu) ? "gespeichert" : "entwurf"; s.meldung = null; }
  planeSichern(pid);
  aendern();
  // §6.8: the readers of the designer show the draft (usePlanModel, useModellDach, workshop derivation)
  if (teil === "bim") entwurfAnLeser(pid, Object.fromEntries(q.felder.filter((k) => q.werte && k in q.werte).map((k) => [k, q.werte[k]])));
}

/** @param {string} pid */
function planeSichern(pid) {
  const k = schluessel(pid);
  clearTimeout(timer.get(k));
  timer.set(k, setTimeout(() => { timer.delete(k); void sichernJetzt(pid); }, ENTWURF_SICHERN_MS));
}

/**
 * Writes the draft of a project into the browser now (pagehide, a tab giving the project away). A refused write is kept in
 * `sicherung` (the bar says it), the next change tries again.
 * @param {string} pid @returns {Promise<boolean>} true = written (or nothing to write)
 */
export async function sichernJetzt(pid) {
  const k = schluessel(pid);
  clearTimeout(timer.get(k));
  timer.delete(k);
  const s = staende.get(k);
  if (!s || s.offen || gesperrtFuer.has(k)) return true;
  try {
    await entwurfSpeichern(entwurfBrowserSpeicher(), s.entwurf);
    if (s.sicherung) { s.sicherung = null; aendern(); }
    return true;
  } catch (err) {
    s.sicherung = String(/** @type {any} */ (err)?.message || err);
    console.error(`[entwurf] lokale Sicherung fehlgeschlagen: ${s.sicherung}`);
    aendern();
    return false;
  }
}

/** Writes every unsaved draft of this page now (pagehide / hidden tab; on the IndexedDB path not guaranteed to finish). */
export function allesSichern() {
  for (const k of staende.keys()) {
    const [b, pid] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    if (b === benutzer) void sichernJetzt(pid);
  }
}

/**
 * Registers the save of one source of the open project (the mounted studio, the program hook, the designer).
 * @param {string} pid @param {EntwurfQuelle} quelle @param {(opt?: any) => Promise<"ok"|"teilweise"|"konflikt"|"leer">} fn
 * @returns {() => void} unregister
 */
export function speichererSetzen(pid, quelle, fn) {
  const k = qs(pid, quelle);
  speicherer.set(k, fn);
  return () => { if (speicherer.get(k) === fn) speicherer.delete(k); };
}

/**
 * Registers how a source puts the stored state back ("Verwerfen").
 * @param {string} pid @param {EntwurfQuelle} quelle @param {() => (void|Promise<void>)} fn @returns {() => void}
 */
export function zuruecksetzerSetzen(pid, quelle, fn) {
  const k = qs(pid, quelle);
  zuruecksetzer.set(k, fn);
  return () => { if (zuruecksetzer.get(k) === fn) zuruecksetzer.delete(k); };
}

/**
 * Registers the writer of the change log (the studio's protocol, 106-10) for waiting proposal steps.
 * @param {string} pid @param {(s: {vorschlag_id: string, eintrag: any, pruefung?: any}) => Promise<any>} fn @returns {() => void}
 */
export function schrittSchreiberSetzen(pid, fn) {
  const k = qs(pid, "schritte");
  schrittSchreiber.set(k, fn);
  return () => { if (schrittSchreiber.get(k) === fn) schrittSchreiber.delete(k); };
}

/**
 * D-115-51: a confirmed proposal step waits in the draft until the save.
 * @param {string} pid @param {{vorschlag_id: string, eintrag: any, pruefung?: any}} schritt
 */
export function schrittVormerken(pid, schritt) {
  const s = standVon(pid);
  s.entwurf = entwurfSchrittVormerken(s.entwurf, schritt);
  if (s.status === "gespeichert") s.status = "entwurf";
  planeSichern(pid);
  aendern();
}

/**
 * D-115-51: undo of a step - a waiting one leaves the draft (true); a stored one is the caller's (false: mark it reversed).
 * @param {string} pid @param {string} vorschlagId @returns {boolean}
 */
export function schrittEntfernen(pid, vorschlagId) {
  const s = staende.get(schluessel(pid));
  if (!s) return false;
  const r = entwurfSchrittEntfernen(s.entwurf, vorschlagId);
  if (!r.removed) return false;
  s.entwurf = r.entwurf;
  planeSichern(pid);
  aendern();
  return true;
}

/**
 * The bim part of the draft when no studio is mounted: rebased on the stored record read now (K3), written strictly on the stand
 * of that rebase (K2). A conflict or an orphaned opening is not written - it waits for the studio (the cards come with it).
 * @param {string} pid @param {ModellEntwurf} e
 * @returns {Promise<{ergebnis: "ok"|"konflikt"|"leer", gespeichert?: any}>}
 */
async function bimOhneStudio(pid, e) {
  const felder = Object.keys(e.aenderungen.bim).filter((k) => STUDIO_ENTWURF_FELDER.includes(k));
  if (!felder.length) return { ergebnis: "leer" };
  for (let versuch = 1; versuch <= 3; versuch += 1) {
    const server = migriereLayerDesDatensatzes(((await bitApi.entities.BimModel.filter({ project_id: pid })) || [])[0] || null);
    const basis = e.basis.bim;
    const wahl = entwurfEntscheiden(basis, server);
    if (wahl === "ersetzt" || wahl === "geloescht") return { ergebnis: "konflikt" };
    const mein = Object.fromEntries(felder.map((k) => [k, e.aenderungen.bim[k]]));
    const r = wahl === "gleich" ? { werte: mein, konflikte: {}, verweise: [] }
      : entwurfRebase({ teil: "bim", basis: basis?.felder || {}, mein, server: server || {}, idxBasis: basis?.idx ?? null });
    if (Object.keys(r.konflikte).length || r.verweise.length) return { ergebnis: "konflikt" };
    try {
      const gespeichert = await saveBimModel(pid, r.werte, { streng: true, basisStand: server?.updated_date ?? null });
      return { ergebnis: "ok", gespeichert };
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== "nicht_geschrieben" || versuch >= 3) throw err;
    }
  }
  return { ergebnis: "konflikt" };
}

/**
 * "Speichern": writes the draft of a project (K5 order), then the waiting proposal steps. A press while a save is on its way waits for
 * it and then saves what is still unsaved (a change made meanwhile is never left out); further presses share that queued save.
 * @param {string} pid
 * @returns {Promise<EntwurfStatus>} gespeichert / teilweise / konflikt / fehler (the draft keeps what was not written)
 */
export function speichern(pid) {
  const k = `speichern|${pid}`, kw = `speichern-wartet|${pid}`;
  const wartet = laeuft.get(kw);
  if (wartet) return wartet;
  const da = laeuft.get(k);
  if (da) {
    const p = da.then(() => undefined, () => undefined).then(() => { laeuft.delete(kw); return speichern(pid); });
    laeuft.set(kw, p);
    return p;
  }
  const p = speichernLauf(pid).finally(() => { laeuft.delete(k); });
  laeuft.set(k, p);
  return p;
}

/** @param {string} pid @returns {Promise<EntwurfStatus>} */
async function speichernLauf(pid) {
  const s = standVon(pid);
  if (s.offen || gesperrtFuer.has(schluessel(pid))) return s.status;
  s.status = "speichert"; s.meldung = null;
  aendern();
  /** @type {Array<"ok"|"teilweise"|"konflikt"|"leer">} */
  const ergebnisse = [];
  try {
    const weitere = [...speicherer.keys()].filter((k) => k.startsWith(`${pid}|`)).map((k) => k.slice(pid.length + 1))
      .filter((q) => !REIHENFOLGE.includes(/** @type {any} */ (q)));
    for (const quelle of [...REIHENFOLGE, ...weitere]) {
      const fn = speicherer.get(qs(pid, quelle));
      if (fn) { ergebnisse.push(await fn()); continue; }
      if (quelle === "studio") {
        const r = await bimOhneStudio(pid, s.entwurf);
        if (r.gespeichert) s.entwurf = entwurfNachSpeichern(s.entwurf, "bim", r.gespeichert);
        ergebnisse.push(r.ergebnis);
      }
    }
    // D-115-51: the confirmed proposal steps go to the change log once the model they changed is stored
    const schreiber = schrittSchreiber.get(qs(pid, "schritte"));
    const bimOffen = Object.keys(s.entwurf.aenderungen.bim).some((f) => STUDIO_ENTWURF_FELDER.includes(f));
    if (schreiber && s.entwurf.schritte.length && !bimOffen) {
      for (const schritt of [...s.entwurf.schritte]) {
        await schreiber(schritt);
        s.entwurf = entwurfSchrittEntfernen(s.entwurf, schritt.vorschlag_id).entwurf;
      }
    }
    const konflikt = ergebnisse.includes("konflikt");
    const teil = ergebnisse.includes("teilweise") || (ergebnisse.includes("ok") && konflikt);
    s.status = entwurfSauber(s.entwurf) ? "gespeichert" : konflikt && !teil ? "konflikt" : teil ? "teilweise" : "entwurf";
    s.meldung = null;
  } catch (err) {
    s.status = "fehler";
    s.meldung = String(/** @type {any} */ (err)?.message || err);
    console.error(`[entwurf] Speichern fehlgeschlagen: ${s.meldung}`);
  }
  await sichernJetzt(pid);
  aendern();
  return s.status;
}

/**
 * A source tells that it wrote its part (its own save path): what is stored leaves the draft.
 * @param {string} pid @param {"bim"|"komplex"} teil @param {any} gespeichert the stored record (fields + id / updated_date)
 */
export function gespeichertMelden(pid, teil, gespeichert) {
  const s = standVon(pid);
  s.entwurf = entwurfNachSpeichern(s.entwurf, teil, gespeichert);
  aendern();
}

/**
 * "Verwerfen": every source puts the stored state back, the local copy goes, waiting steps are dropped.
 * @param {string} pid @returns {Promise<void>}
 */
export async function verwerfen(pid) {
  const k = schluessel(pid);
  clearTimeout(timer.get(k));
  timer.delete(k);
  staende.set(k, { entwurf: entwurfLeer({ benutzer, projekt: pid }), status: "gespeichert", meldung: null, sicherung: null, wiederhergestellt: false, offen: null });
  laeuft.delete(k);
  const weitere = [...zuruecksetzer.keys()].filter((k) => k.startsWith(`${pid}|`)).map((k) => k.slice(pid.length + 1))
    .filter((q) => !REIHENFOLGE.includes(/** @type {any} */ (q)));
  for (const quelle of [...REIHENFOLGE, ...weitere]) {
    const fn = zuruecksetzer.get(qs(pid, quelle));
    if (fn) { try { await fn(); } catch (err) { console.error(`[entwurf] Verwerfen (${quelle}): ${/** @type {any} */ (err)?.message || err}`); } }
  }
  // what a source reported while it put the stored state back is the stored state (equal to the base) - the draft stays clean
  const jetzt = staende.get(k);
  if (jetzt) { jetzt.entwurf = { ...jetzt.entwurf, schritte: [] }; jetzt.status = "gespeichert"; }
  await entwurfLoeschen(entwurfBrowserSpeicher(), benutzer, pid).catch(() => { /* the entry may not exist */ });
  aendern();
}

/**
 * The status of a project while a source's own save runs (the studio shows "Speichert…" in its chip as well).
 * @param {string} pid @param {EntwurfStatus} status @param {string|null} [meldung]
 */
export function statusSetzen(pid, status, meldung = null) {
  const s = standVon(pid);
  s.status = status; s.meldung = meldung;
  aendern();
}

/** Test seam: forget everything (unit tests only). */
export function _zuruecksetzenFuerTests() {
  staende.clear(); schnappschuss.clear(); speicherer.clear(); zuruecksetzer.clear(); schrittSchreiber.clear(); laeuft.clear();
  for (const t of timer.values()) clearTimeout(t);
  timer.clear();
  gesperrtFuer.clear();
  benutzer = "lokal";
  benutzerLaden = null;
}

/**
 * 115-05c: puts the draft values of single fields of the BimModel (program fields, layers of an editor) onto the freshly loaded
 * stored record. Same base → the draft value; another state of the same record → three ways per field (feldDreiWege); a field both
 * changed keeps the draft value on screen, is held back from every save (feldSperren) and gets a conflict card whose decision
 * stays in the draft ("Meine" releases the lock, "Andere" puts the stored value back) - nothing is written, nothing dropped.
 * A draft made on another record / a record gone is not continued (offen, the bar asks).
 * @param {{pid: string, entwurf: ModellEntwurf|null, gespeichert: any, felder: ReadonlyArray<string>,
 *   setzen: (werte: Record<string, any>) => void, quelle: string}} a gespeichert = the stored record (null = none); setzen = puts
 *   values into the source's state; quelle = the card source ("programm", "layer")
 * @returns {Record<string, any>} the values put into the state
 */
export function felderEinspielen({ pid, entwurf, gespeichert, felder, setzen, quelle }) {
  const mein = Object.fromEntries(felder.filter((k) => entwurf && k in (entwurf.aenderungen.bim || {})).map((k) => [k, entwurf?.aenderungen.bim[k]]));
  if (!Object.keys(mein).length || !entwurf) return {};
  const basis = entwurf.basis.bim;
  const wahl = entwurfEntscheiden(basis, gespeichert);
  if (wahl === "ersetzt" || wahl === "geloescht") { offenSetzen(pid, wahl); return {}; }
  /** @type {Record<string, any>} */ const werte = {};
  for (const [k, v] of Object.entries(mein)) {
    if (wahl === "gleich") { werte[k] = v; continue; }
    const r = feldDreiWege(basis?.felder?.[k], v, gespeichert?.[k]);
    werte[k] = r.wert;
    if (!r.konflikte.length) continue;
    const fremd = gespeichert?.[k];
    feldSperren(pid, k);
    abgleichStand.konfliktMelden({
      quelle, projektId: pid, feld: k, titel: feldName(k), geraet: { name: "", unbekannt: true },
      zeilen: [{ schluessel: null, name: feldName(k), mein: wertKurz(v), fremd: wertKurz(fremd) }],
      loesen: {
        mein: async () => { feldFreigeben(pid, k); },
        fremd: async () => { feldFreigeben(pid, k); setzen({ [k]: fremd }); },
      },
    });
  }
  if (Object.keys(werte).length) setzen(werte);
  return werte;
}

/**
 * 115-05c (§6.3): a writer outside the BIM studio changes element lists as a DRAFT change (MassingModellierer "Als Bauteil
 * übernehmen" / "Übernahme zurücknehmen"; before: a strict direct write). It sees the stored record with the draft's lists on top
 * (gespeichert ∪ Entwurf - so a number for new elements is free in both, K11), returns the new lists, and they are reported to the
 * draft with the draft's own base where it has one. The studio shows them when it opens (draft of this page).
 * @param {string} pid project
 * @param {(modell: Record<string, any>) => (Record<string, any[]>|null)} aendern gets stored record ∪ draft lists, returns the
 *   changed lists (null = nothing to change)
 * @returns {Promise<Record<string, any[]>|null>} the changed lists (null = none)
 * @throws when the BIM studio of the project is mounted (its state would overwrite the draft) or the record cannot be read
 */
export async function bimListenAendern(pid, aendern) {
  if (speicherer.has(qs(pid, "studio"))) throw new Error("Gebäudemodell ist geöffnet — dort ändern");
  const rec = await loadBimModel(pid);
  await starten(pid);
  const s = standVon(pid);
  if (s.offen) throw new Error("Der lokale Entwurf passt nicht mehr zum gespeicherten Modell (ersetzt oder gelöscht). Er wird nicht automatisch fortgesetzt.");
  const draft = s.entwurf.aenderungen.bim || {};
  const aktuell = { ...(rec || {}), ...Object.fromEntries(IDX_LISTEN.filter((k) => k in draft).map((k) => [k, draft[k]])) };
  const neu = aendern(aktuell);
  if (!neu || !Object.keys(neu).length) return null;
  const felder = Object.keys(neu);
  const alteBasis = s.entwurf.basis.bim?.felder || {};
  const basis = Object.fromEntries(felder.map((k) => [k, k in alteBasis ? alteBasis[k] : (Array.isArray(rec?.[k]) ? rec[k] : [])]));
  melden(pid, "bim", { stand: rec ? { id: rec.id ?? null, updated_date: rec.updated_date ?? null } : null, basis, werte: neu, felder,
    idx: Object.fromEntries(IDX_LISTEN.map((l) => [l, (Array.isArray(rec?.[l]) ? rec[l] : []).map((e) => e?._idx).filter((x) => typeof x === "number")])) });
  await sichernJetzt(pid);
  return neu;
}

// pagehide / hidden tab: the local copy at once (the 800-ms timer may not fire any more). On the IndexedDB path the browser does
// not wait for the write - there only the timer secures it (115-05-PLAN §6.2, SUMMARY).
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", allesSichern);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") allesSichern(); });
}
