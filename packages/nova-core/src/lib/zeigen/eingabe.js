// 106-05: the text input of a viewer - one road for typed sentences, spoken sentences and the "eingabe" command of the register.
// A sentence goes through the grammar (sprachbefehl.js) and ends as a command of the SAME register that buttons, keys and agents use;
// so every guard of the change commands (106-03: proposal first, check, origin, only a person confirms) applies unchanged.
//
// Who is calling matters and is passed on, never dropped (review point of 106-04, "Task 3b"): the register context `ctx` of the caller
// goes to the inner command as it is. A call that came over the local control channel carries `ctx.kanal === "steuerung"` (an agent);
// `eingabe {text: "bestaetigen"}` or `eingabe {text: "ja"}` over that channel therefore reaches the `bestaetigen` command WITH the marker and
// is refused there ("Ein Agent kann nicht bestätigen"), exactly like the direct command. The same for "rückgängig".
// The origin of a proposal made by a sentence is: "agent" over the channel (whatever the call claims), else a trusted input path's
// `ctx.herkunft` (the speech field passes "sprache" or "text"), else the caller's `herkunft` parameter limited to text/sprache, else "text".
//
// In:  register, the sentence, ctx, the context the viewer knows right now ({auswahl, ansicht?, zeigepunkt?}).
// Out: eingabeAusfuehren -> {ok, art, ...}; eingabeBefehlRegistrieren adds the command "eingabe {text, herkunft?}".
import { sprachbefehl } from "./sprachbefehl.js";
import { vomAgentenKanal } from "./kanal.js";

export { vomAgentenKanal };

/** Commands that make a proposal: they record which sentence led to it (`befehl_text`, shown in the history). */
const VORSCHLAG_BEFEHLE = ["eigenschaft-setzen", "transformieren", "teilen"];

/**
 * Result of one sentence. `befehl`: it ran a command (`verstanden` in words, `ergebnis` its answer); `rueckfrage`: a question that waits for "ja"
 * (`frage`, and `beiJa` the command it would run); `abgelehnt`: understood, refused (`text`); `unbekannt`: the grammar does not know it (`text`).
 * @typedef {{ok: boolean, art: "befehl"|"rueckfrage"|"abgelehnt"|"unbekannt", text?: string, frage?: string, beiJa?: {befehl: string, params: Record<string, any>},
 *   befehl?: string, verstanden?: string, ergebnis?: any}} EingabeErgebnis
 */

/** @param {string} s @returns {string} comparison form of a command name: lower case, no blanks or dashes */
const nameNorm = (s) => String(s ?? "").trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[\s/_-]+/g, "");

/**
 * Runs one sentence through the grammar and the register.
 * @param {ReturnType<typeof import("../befehlsregister.js").befehlsRegister>} reg  The viewer's register.
 * @param {string} text  The sentence (typed or a transcript).
 * @param {any} [ctx]  Register context of the caller: `{kanal}` of the control channel is passed on; `{herkunft: "text"|"sprache"}` is set by a trusted
 *   input path of the viewer (the speech field), it is ignored for an agent call.
 * @param {import("./sprachbefehl.js").SprachKontext} [kontext]  Selection, view and pointed-at spot, read by the viewer at this moment.
 * @returns {EingabeErgebnis}
 *   `abgelehnt`: understood but refused (the text says why: no selection, wrong kind of element, a refusal of the command, an agent that wants to confirm);
 *   `unbekannt`: the grammar does not know the sentence (a language model may be asked, sprechAblauf.js).
 */
export function eingabeAusfuehren(reg, text, ctx = {}, kontext = {}) {
  const agent = vomAgentenKanal(ctx);
  const herkunft = agent ? "agent" : ctx?.herkunft === "sprache" ? "sprache" : "text";
  // a transcript confirms only with an unambiguous word (sprachbefehl.js JA_GESPROCHEN)
  let g = sprachbefehl(text, herkunft === "sprache" ? { ...kontext, gesprochen: true } : kontext);

  if (g?.art === "abgelehnt") return { ok: false, art: "abgelehnt", text: g.grund };

  // a typed command NAME of "rueckgaengig" ("Schritt zurücknehmen", "undo") takes the same road as the sentence: asked back first
  if (!g && herkunft !== "sprache") {
    const t = nameNorm(text);
    const rueck = t ? reg.alle(ctx).find((b) => b.id === "rueckgaengig" && [b.id, b.label, ...(b.kurz || [])].some((n) => nameNorm(n) === t)) : null;
    if (rueck) g = { art: "zurueck" };
  }

  if (g?.art === "zurueck") {
    // "rückgängig" is asked back first (speech recognition errs, and a step that went back is a change): shown in words, runs only after a "ja"
    const lesen = reg.ausfuehren("vorschlaege", {}, ctx);
    if (!lesen.ok) return { ok: false, art: "abgelehnt", text: /** @type {{ok: false, error: string}} */ (lesen).error };
    const { offen = [], verlauf = [] } = lesen.result || {};
    if (offen.length) return { ok: false, art: "abgelehnt", text: "Erst den offenen Vorschlag übernehmen oder verwerfen — dann zurücknehmen" };
    const frei = verlauf.filter((/** @type {any} */ s) => !s.zurueckgenommen);
    if (!frei.length) return { ok: false, art: "abgelehnt", text: "Nichts zurückzunehmen" };
    const letzter = frei[frei.length - 1];
    return { ok: true, art: "rueckfrage", frage: `Schritt zurücknehmen: ${letzter.satz} — „ja“ oder „nein“?`, beiJa: { befehl: "rueckgaengig", params: { vorschlag_id: letzter.vorschlag_id } } };
  }

  /** @type {string|null} */ let befehl = null;
  /** @type {Record<string, any>} */ let params = {};
  /** @type {string|undefined} */ let verstanden;
  if (g?.art === "befehl") {
    befehl = g.befehl; params = { ...g.params }; verstanden = g.verstanden;
    if (VORSCHLAG_BEFEHLE.includes(befehl)) params.befehl_text = String(text);
    // a typed "ja" is the keyboard, a spoken one is speech; an agent never gets here with an effect (the command refuses it)
    if (befehl === "bestaetigen") params.durch = herkunft === "sprache" ? "sprache" : "tastatur";
  } else if (herkunft !== "sprache") {
    // typed command names, CAD style, exact only ("vorschlaege", "modell", "bestaetigen"): never a prefix, a typo must not run a command
    const t = nameNorm(text);
    const treffer = t ? reg.alle(ctx).find((b) => [b.id, b.label, ...(b.kurz || [])].some((n) => nameNorm(n) === t)) : null;
    if (treffer) { befehl = treffer.id; verstanden = treffer.label; }
  }
  if (!befehl) return { ok: false, art: "unbekannt", text: `Satz nicht verstanden: „${String(text).trim()}“` };

  const r = reg.ausfuehren(befehl, params, { ...ctx, ...(agent ? {} : { herkunft }) });
  if (!r.ok) return { ok: false, art: "abgelehnt", text: /** @type {{ok: false, error: string}} */ (r).error, befehl, ...(verstanden ? { verstanden } : {}) };
  return { ok: true, art: "befehl", befehl, verstanden: verstanden ?? befehl, ergebnis: r.result };
}

/**
 * Registers the command "eingabe {text, herkunft?}": a sentence as a command, for agents, scripts and typed input.
 * @param {ReturnType<typeof import("../befehlsregister.js").befehlsRegister>} reg
 * @param {() => {kontext: () => any, ansicht?: () => any, zeigepunkt?: () => any}} a  Accessor of the viewer's surface (called at every command).
 * @returns {() => void} Remover.
 */
export function eingabeBefehlRegistrieren(reg, a) {
  return reg.registrieren({
    id: "eingabe", label: "Eingabe", menue: "Befehlszeile", kurz: ["satz"], parameter: { text: "text", herkunft: "text" },
    ausfuehren: (p, ctx) => {
      const text = String(p?.text ?? "").trim();
      if (!text) throw new Error("text fehlt");
      const f = a();
      // `herkunft` as a parameter: only text and speech, only for a caller that is not the agent channel (the channel is always "agent")
      const frei = ["text", "sprache"].includes(String(p?.herkunft)) ? String(p.herkunft) : null;
      const innen = { ...(ctx || {}), ...(frei && ctx?.herkunft == null && !vomAgentenKanal(ctx) ? { herkunft: frei } : {}) };
      const r = eingabeAusfuehren(reg, text, innen, { auswahl: f.kontext(), ansicht: f.ansicht?.() ?? null, zeigepunkt: f.zeigepunkt?.() ?? null });
      if (!r.ok) throw new Error(r.text);
      return r.art === "rueckfrage" ? { rueckfrage: r.frage, beiJa: r.beiJa } : { befehl: r.befehl, verstanden: r.verstanden, ergebnis: r.ergebnis };
    },
  });
}
