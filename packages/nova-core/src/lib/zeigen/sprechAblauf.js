// 106-05: the flow behind the speech field - one sentence in, one answer in words out. Order of attack (guard rail 4, "deterministic first, model later"):
//   1. an open "rückgängig?" question: "ja" runs it, anything else drops it,
//   2. the grammar and the register (eingabe.js): proposals, answers ja/nein, reading commands,
//   3. only a sentence nobody knows goes to the language model (sprachAgent.js, a proposal comes back, never a change).
// "ja"/"nein" spoken by the person at the device are the human confirmation (D-IM-04); nothing else confirms. A typed or spoken sentence passes the
// same road, only the origin differs ("text" or "sprache" - the speech field is the one trusted input path that may say "sprache").
//
// In:  register, accessor for the viewer's context, optional model fallback. Out: {verarbeiten(text, herkunft), rueckfrage()}.
import { eingabeAusfuehren } from "./eingabe.js";
import { sprachbefehl } from "./sprachbefehl.js";
import { satzAusVorlage } from "./aenderungen.js";

/**
 * One answer of the flow: the result of a sentence (eingabe.js), or of the model (`modell`, `modell-freigabe`, `modell-fehler` with `werkzeuge`,
 * `anbieter`), or `abgebrochen` (a "rückgängig?" question answered with "nein").
 * @typedef {{ok: boolean, art: "befehl"|"rueckfrage"|"abgelehnt"|"unbekannt"|"modell"|"modell-freigabe"|"modell-fehler"|"bild-zustimmung"|"abgebrochen", text?: string,
 *   frage?: string, beiJa?: {befehl: string, params: Record<string, any>}, befehl?: string, verstanden?: string, ergebnis?: any, werkzeuge?: string[], anbieter?: string,
 *   vorlage?: string, werte?: Record<string, string>}} AblaufErgebnis
 *   vorlage/werte (106-06): the answer as an i18n template with its values (antwortSatz translates the template, then fills it).
 */

/**
 * @param {{register: ReturnType<typeof import("../befehlsregister.js").befehlsRegister>,
 *   kontext: () => import("./sprachbefehl.js").SprachKontext,
 *   modellFrage?: ((text: string, kontext: import("./sprachbefehl.js").SprachKontext, opt: {cloudOk?: boolean, herkunft?: string}) => Promise<{ok: boolean, art: "modell"|"modell-freigabe"|"modell-fehler"|"bild-zustimmung", text: string, werkzeuge: string[], anbieter?: string, vorlage?: string, werte?: Record<string, string>}>)|null}} opt
 *   kontext: selection / view / pointed-at spot read at the moment of the sentence; modellFrage: the fallback (null = none), it gets the
 *   sentence's origin ("text" | "sprache", D-IM-07).
 * @returns {{verarbeiten: (text: string, herkunft?: string, opt?: {cloudOk?: boolean}) => Promise<AblaufErgebnis>, rueckfrage: () => ({frage: string, beiJa: any}|null)}}
 */
export function sprechAblauf({ register, kontext, modellFrage = null }) {
  /** @type {{frage: string, beiJa: {befehl: string, params: Record<string, any>}}|null} */
  let rueckfrage = null;
  return {
    rueckfrage: () => rueckfrage,
    async verarbeiten(text, herkunft = "text", opt = {}) {
      const k = kontext();
      // a transcript answers the question only with an unambiguous "ja" (JA_GESPROCHEN), like a proposal
      const g = sprachbefehl(text, herkunft === "sprache" ? { ...k, gesprochen: true } : k);
      if (rueckfrage) {
        const offen = rueckfrage;
        rueckfrage = null; // every other sentence drops the question: a "ja" a minute later must not undo something
        if (g?.art === "befehl" && g.befehl === "bestaetigen") {
          const r = register.ausfuehren(offen.beiJa.befehl, offen.beiJa.params, { herkunft });
          return r.ok
            ? { ok: true, art: "befehl", befehl: offen.beiJa.befehl, verstanden: "Schritt zurückgenommen", ergebnis: r.result }
            : { ok: false, art: "abgelehnt", text: /** @type {{ok: false, error: string}} */ (r).error };
        }
        if (g?.art === "befehl" && g.befehl === "verwerfen") return { ok: true, art: "abgebrochen", text: "Zurücknehmen abgebrochen" };
      }
      const r = eingabeAusfuehren(register, text, { herkunft }, k);
      if (r.art === "rueckfrage") rueckfrage = { frage: r.frage, beiJa: r.beiJa };
      // D-IM-07: the model fallback learns whether the sentence was spoken (its proposals then carry "sprache" + "agent")
      if (r.art === "unbekannt" && modellFrage) return modellFrage(text, k, { cloudOk: !!opt.cloudOk, herkunft });
      return r;
    },
  };
}

/**
 * Sentence templates of the answers (German keys WITH {placeholders}): the speech field passes them through t() and fills them afterwards
 * (satzAusVorlage), like the proposal sentences of 106-03. English texts: i18nTeile/zeigen-106.js.
 */
export const ANTWORT_VORLAGEN = Object.freeze({
  uebernommen: "Übernommen: {satz}",
  zurueckgenommen: "Zurückgenommen: {satz}",
  verworfen: "Verworfen: {satz}",
  auswahl: "Auswahl ({anzahl}): {liste}",
  nichtsAusgewaehlt: "Nichts ausgewählt",
  vorschlaege: "{offen} offene Vorschläge, {schritte} Schritte im Verlauf",
  geprueft: "{anzahl} Vorschlag/Vorschläge geprüft",
  verstanden: "Verstanden: {satz} — Vorschlag prüfen, dann „ja“ sagen oder Übernehmen wählen",
  bauteil: "Bauteil",
});

/**
 * The answer of the flow as one sentence for the speech field (what was understood, what happened, what to do next).
 * @param {AblaufErgebnis} r  Result of verarbeiten().
 * @param {(s: string) => string} [t]  Translator of the templates and of fixed answer texts (default: German as it stands); a text that is
 *   not in the dictionary (a model's answer, a sentence with a value in it) stays as it is.
 * @returns {string}
 */
export function antwortSatz(r, t = (s) => s) {
  const V = ANTWORT_VORLAGEN;
  const f = (/** @type {string} */ vorlage, /** @type {Record<string, any>} */ werte) => satzAusVorlage(t(vorlage), werte);
  // a sentence with values (106-06: model name, the viewer's reason) comes as a template: translate the template, then fill it
  if (r.art !== "befehl" && r.art !== "rueckfrage") return r.vorlage ? satzAusVorlage(t(r.vorlage), r.werte ?? {}) : t(r.text ?? "");
  if (r.art === "rueckfrage") return r.frage ?? "";
  const e = r.ergebnis;
  switch (r.befehl) {
    case "bestaetigen": return f(V.uebernommen, { satz: e?.satz ?? "" });
    case "rueckgaengig": return f(V.zurueckgenommen, { satz: e?.satz ?? r.verstanden ?? "" });
    case "verwerfen": return f(V.verworfen, { satz: e?.satz ?? "" });
    case "auswahl-lesen": {
      const b = e?.bauteile ?? [];
      const liste = `${b.slice(0, 3).map((/** @type {any} */ x) => `${x.name || x.klasse || t(V.bauteil)}${x.klasse && x.name ? ` (${x.klasse})` : ""}`).join(", ")}${e?.anzahl > 3 ? ", …" : ""}`;
      return e?.anzahl > 0 ? f(V.auswahl, { anzahl: e.anzahl, liste }) : t(V.nichtsAusgewaehlt);
    }
    case "vorschlaege": return f(V.vorschlaege, { offen: e?.offen?.length ?? 0, schritte: (e?.verlauf ?? []).filter((/** @type {any} */ s) => !s.zurueckgenommen).length });
    case "pruefen": return f(V.geprueft, { anzahl: Array.isArray(e) ? e.length : 0 });
    case "eigenschaft-setzen": case "transformieren": case "teilen": return f(V.verstanden, { satz: r.verstanden ?? "" });
    default: return r.verstanden ?? "";
  }
}
