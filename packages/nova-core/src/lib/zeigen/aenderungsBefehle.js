// 106-03: the change commands every viewer registers into its command register (104-03), next to the selection commands
// of 106-02: eigenschaft-setzen, transformieren, teilen, pruefen, vorschlaege, bestaetigen, verwerfen, rueckgaengig.
// People (command line), scripts and agents say the same words; the viewer decides how a result looks and is stored.
//
// Guard rails of the phase these commands carry:
//  (1) a command that changes something only makes a PROPOSAL (sentence in words + check); it runs in bestaetigen,
//      after a human said yes - an agent's proposal too (decision D-IM-04),
//  (2) every executed step keeps its origin (hand / text / sprache / agent / bild; since D-IM-07 a list, e.g. sprache + agent) and is reversible on its own
//      (rueckgaengig {vorschlag_id}),
//  (3) the target is a GUID: either given, or the one selected element ("dieses"); no selection, no GUID or several
//      elements are refused with a reason, never guessed.
//
// Who is calling: the local control channel (steuerungsBruecke.js, agents over HTTP) passes ctx {kanal: "steuerung"} to
// the register. Such a call is recorded with origin "agent" whatever it claims, and it can neither confirm (bestaetigen)
// nor reverse (rueckgaengig) - that stays with the person in the window (button, command line, later voice).
// The origin of everything else is ASSUMED, not measured: a typed command is "text"; "sprache" may be declared by the
// caller (the voice input of 106-05 arrives as a command line); "hand" and "bild" are only accepted from a trusted input
// path of the viewer itself (ctx.herkunft) - none exists yet: hand gestures of the studio do not run through proposals.
// D-IM-07 (25.10.2026): a proposal the agent makes from a SPOKEN sentence carries both origins. The main origin of a channel call stays
// "agent" (herkunft.quelle, for old readers); the list herkunft.quellen says more - ["sprache", "agent"], and (ASSUMPTION, same logic)
// ["sprache", "agent", "bild"] when an image of the view went along with the agent's turn. The list comes from the marker `satz_marke`
// that the speech field of THIS page issued for the sentence (satzMarke.js); an agent cannot claim it, a marker the page did not issue adds
// nothing. So "bild" is set only that way - as an additional origin of an agent turn; claimed as the one origin in the parameters it is
// still refused (the image decides nothing, the GUID does). A script inside the page cannot be told from the person (known limit).
//
// In:  register, accessor `a()` returning the viewer's surface (see AenderungsFlaeche).
// Out: a function that removes the commands again. The proposals live in the surface's vorschlagSpeicher().
import { auswahlErforderlich } from "./auswahlKontext.js";
import { HERKUNFT_QUELLEN, aenderungUmkehren, bauteilImModell, herkunftQuellen } from "./aenderungen.js";
import { agentQuellen } from "./satzMarke.js";
import { pruefeAenderung } from "./pruefung.js";
import { vorschlagAusfuehren, vorschlagVorbereiten, zielAusAuswahl } from "./vorschlag.js";
import { vomAgentenKanal } from "./kanal.js";

/** Kinds of change a surface can support. */
const ALLE_ARTEN = ["eigenschaft", "transformieren", "teilen"];

/**
 * What a viewer hands in: its state and how it applies a result.
 * @typedef {object} AenderungsFlaeche
 * @property {() => any} kontext  Current selection (auswahlKontext record, read from the synchronous selection).
 * @property {() => any} modell  Current model record: customWalls ... (drawn elements); `{}` for an IFC viewer.
 * @property {() => any} optionen  Options of the check, read at every call: {projektId, bauart, werkstatt, durchbrueche,
 *   geschosshoehe_m, attributPruefung, naechsteIdx, eintraege}.
 * @property {ReturnType<typeof import("./vorschlagSpeicher.js").vorschlagSpeicher>} speicher  Open proposals and history.
 * @property {(vorschlag: any, ergebnis: {modell: any, eintrag: any, journal?: any, warnungen: string[]}) => void} uebernehmen
 *   Applies a confirmed step to the viewer (new model, journal entry).
 * @property {(eintrag: any, ergebnis: {modell: any, journal?: any}) => void} zuruecknehmen  Applies the reversal of ONE step.
 * @property {(guid: string) => any|null} [ifcBauteil]  IFC viewer only: the element `{quelle: "ifc", modell, guid, psets, project_id?, klasse?, name?}`.
 * @property {ReadonlyArray<"eigenschaft"|"transformieren"|"teilen">} [arten]  Kinds this surface can do (default all).
 * @property {string} [nichtMoeglichText]  Refusal text for a kind the surface cannot do.
 * @property {(s: string) => string} [t]  Translator of the sentence templates (default: German as it stands).
 * @property {(vorschlag: any) => void} [vorschauZeigen]  Draws the ghost / mark of a new proposal in the model view.
 * @property {(id: string) => void} [vorschauEntfernen]  Removes the ghost of a proposal again.
 * @property {() => boolean} [darfAendern]  106-07: may the person at this device change the model (role with "Modell & Prüfung:
 *   Bearbeiten", rechte.js darf("modell", "voll"))? Read at every bestaetigen / rueckgaengig; missing = yes (as before).
 */

/**
 * 106-07: refusal of bestaetigen / rueckgaengig for a role that may look and propose but not change the model (e.g. a paired
 * site tablet used by a read-only role). Selecting and proposing stay open to it.
 */
export const KEIN_AENDERUNGSRECHT_TEXT = "Ihre Rolle darf das Modell nicht ändern — Übernehmen und Zurücknehmen brauchen „Modell & Prüfung: Bearbeiten“ (Einstellungen › Nutzer & Rechte)";

/** @param {AenderungsFlaeche} f @returns {void} throws the refusal when the surface says the role may not change the model */
const rechtPruefen = (f) => {
  if (typeof f.darfAendern === "function" && f.darfAendern() !== true) throw new Error(KEIN_AENDERUNGSRECHT_TEXT);
};

// vomAgentenKanal(ctx): the call came over the local control channel (an agent) - shared with eingabe.js (kanal.js), one test for both locks.

/** Origins a caller may declare in the command parameters (the others need a trusted input path, see the file head). */
const HERKUNFT_FREI = ["text", "sprache"];

/**
 * Origin of a proposal from the command: over the control channel always "agent" as the main origin, plus what the page's own marker
 * `satz_marke` says (D-IM-07: spoken sentence, image along); else a trusted input path's `ctx.herkunft`; else the caller's `herkunft`
 * parameter (default "text": a typed command), limited to the origins that need no proof (text, sprache). Outside the channel a
 * `satz_marke` parameter is ignored: the marker only describes an agent's turn.
 * @param {any} p  Command parameters. @param {any} ctx
 * @returns {{quelle: "hand"|"text"|"sprache"|"agent"|"bild", quellen?: string[], befehl_text: string|null}}
 * @throws {Error} German text: unknown origin, "hand"/"bild" claimed in the parameters.
 */
function herkunftAus(p, ctx) {
  const befehlText = p?.befehl_text ? String(p.befehl_text) : null;
  if (vomAgentenKanal(ctx)) return { quelle: "agent", quellen: agentQuellen(p?.satz_marke), befehl_text: befehlText };
  if (ctx?.herkunft != null) {
    const q = String(ctx.herkunft);
    if (!HERKUNFT_QUELLEN.includes(/** @type {any} */ (q)) || q === "agent") throw new Error(`Herkunft unbekannt: ${q}`);
    return { quelle: /** @type {any} */ (q), befehl_text: befehlText };
  }
  const quelle = String(p?.herkunft ?? "text");
  if (quelle === "bild") throw new Error("Herkunft „bild“ ist erst mit der Bildeingabe freigegeben und kann nicht als Parameter behauptet werden");
  if (quelle === "hand") throw new Error("Herkunft „hand“ gibt es nur für Änderungen mit der Maus im Fenster, nicht als Befehlsparameter (möglich: text, sprache)");
  if (!HERKUNFT_FREI.includes(quelle)) throw new Error(`Herkunft unbekannt: ${quelle} (möglich: ${HERKUNFT_FREI.join(", ")})`);
  return { quelle: /** @type {any} */ (quelle), befehl_text: befehlText };
}

/**
 * Numbers from an array ([dx, dz] or [dx, dy, dz]), an object {x, y?, z} or text ("0,5; 0; 1" with ; or blanks).
 * @param {any} v @param {string} name Parameter name for the message.
 * @returns {number[]}  Three numbers [dx, dy, dz] in m (a missing dy is 0).
 * @throws {Error} German text when it is not readable.
 */
function verschiebung(v, name) {
  /** @type {any[]} */
  let teile;
  if (Array.isArray(v)) teile = v;
  else if (v && typeof v === "object") teile = [v.x, v.y ?? 0, v.z];
  else if (typeof v === "string") teile = v.split(/[;\s]+/).filter(Boolean).map((s) => Number(s.replace(",", ".")));
  else throw new Error(`${name}: drei Zahlen [dx, dy, dz] in m erwartet`);
  if (teile.length === 2) teile = [teile[0], 0, teile[1]];
  const z = teile.map(Number);
  if (z.length !== 3 || !z.every(Number.isFinite)) throw new Error(`${name}: drei Zahlen [dx, dy, dz] in m erwartet (oder [dx, dz])`);
  return z;
}

/** Plan point {x, z} from {x, z}, [x, z] or text "x; z" (m). @param {any} v @param {string} name @returns {{x: number, z: number}} */
function planPunkt(v, name) {
  let x, z;
  if (Array.isArray(v)) [x, z] = v;
  else if (v && typeof v === "object") ({ x, z } = v);
  else if (typeof v === "string") [x, z] = v.split(/[;\s]+/).filter(Boolean).map((s) => Number(s.replace(",", ".")));
  x = Number(x); z = Number(z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`${name}: ein Punkt {x, z} in m erwartet`);
  return { x, z };
}

/**
 * Short record of a proposal for the command answer (what a person or agent needs to decide).
 * @param {any} v  Proposal (vorschlagErzeugen). @returns {Record<string, any>}
 */
export function vorschlagKurz(v) {
  return {
    id: v.id, art: v.art, satz: v.satz,
    ziel: { guid: v.ziel.guid, klasse: v.ziel.klasse ?? null, name: v.ziel.name || "" },
    pruefung: v.pruefung ? { stufe: v.pruefung.stufe, saetze: v.pruefung.saetze } : null,
    herkunft: v.herkunft.quelle,
    herkunft_quellen: herkunftQuellen(v), // D-IM-07: all origins in order; the marker itself never goes back to the caller
    bestaetigung: v.bestaetigung,
    // a blocked proposal can still be looked at, but bestaetigen refuses it
    gesperrt: v.pruefung?.stufe === "fehler",
  };
}

/**
 * Registers the change commands.
 * @param {ReturnType<typeof import("../befehlsregister.js").befehlsRegister>} reg
 * @param {() => AenderungsFlaeche} a  Accessor of the surface's current functions (called at every command).
 * @returns {() => void} Remover for all commands of the group.
 */
export function aenderungsBefehleRegistrieren(reg, a) {
  /** Options for the check/execution of the CURRENT state, translator included. */
  const opt = () => ({ ...(a().optionen() || {}), t: a().t });

  /**
   * Resolves the target of a command: a given GUID or the one selected element.
   * @param {any} p @returns {{guid: string, klasse?: string|null, name?: string}}
   */
  const ziel = (p) => {
    const guid = String(p?.guid ?? "").trim();
    if (guid) return { guid };
    return zielAusAuswahl(auswahlErforderlich(a().kontext())); // "dieses" without a selection is refused, not guessed
  };

  /**
   * Makes, stores and shows one proposal.
   * @param {"eigenschaft"|"transformieren"|"teilen"} art @param {any} p Command parameters @param {any} ctx
   * @param {(z: {guid: string}) => any} paramsAus  Builds the change parameters once the target is known.
   */
  const vorschlagMachen = (art, p, ctx, paramsAus) => {
    const f = a();
    const arten = f.arten || ALLE_ARTEN;
    if (!arten.includes(art)) throw new Error(f.nichtMoeglichText || `Diese Änderung gibt es hier nicht: ${art}`);
    const z = ziel(p);
    const params = paramsAus(z);
    const ifcBauteil = f.ifcBauteil ? f.ifcBauteil(z.guid) : null;
    if (f.ifcBauteil && !ifcBauteil) throw new Error(`Bauteil nicht gefunden: ${z.guid}`);
    const v = vorschlagVorbereiten(f.modell(), { art, ziel: z, params, herkunft: herkunftAus(p, ctx), ...(ifcBauteil ? { ifcBauteil } : {}) }, opt());
    f.speicher.hinzu(v);
    f.vorschauZeigen?.(v);
    return vorschlagKurz(v);
  };

  /**
   * The open proposal a command means: by id, or the only open one. Never "the newest", never a guess.
   * @param {any} p @returns {any}
   */
  const offenerVorschlag = (p) => {
    const offen = a().speicher.offen();
    const id = String(p?.vorschlag_id ?? "").trim();
    if (id) {
      const v = a().speicher.holen(id);
      if (!v) throw new Error(`Kein offener Vorschlag mit der Id ${id}`);
      return v;
    }
    if (offen.length === 1) return offen[0];
    if (!offen.length) throw new Error("Kein offener Vorschlag — erst eine Änderung vorschlagen");
    throw new Error(`${offen.length} offene Vorschläge — vorschlag_id angeben (${offen.map((v) => v.id).join(", ")})`);
  };

  /**
   * Re-runs the check of an open proposal on the CURRENT model (it may have changed since: another step, a hand edit)
   * and stores the result in the proposal; a proposal whose target changed becomes blocked ("Veraltet: ...").
   * @param {any} v  Open proposal. @returns {any}  The proposal with its new check.
   */
  const neuPruefen = (v) => {
    const f = a();
    const ifc = v.ziel.quelle === "ifc" && f.ifcBauteil ? f.ifcBauteil(v.ziel.guid) : null;
    const pruefung = pruefeAenderung(f.modell() ?? {}, v, { ...opt(), ...(ifc ? { ifcBauteil: ifc } : {}) });
    const neu = f.speicher.aktualisieren(v.id, { pruefung }) ?? v;
    f.vorschauZeigen?.(neu); // the outline follows the new level (a blocked proposal gets the solid one)
    return neu;
  };

  const entfernen = [
    reg.registrieren({ id: "eigenschaft-setzen", label: "Eigenschaft setzen (Vorschlag)", menue: "Ändern", parameter: { guid: "text", pset: "text", name: "text", wert: "text", satz_marke: "text" },
      ausfuehren: (p, ctx) => vorschlagMachen("eigenschaft", p, ctx, () => {
        if (!String(p?.name ?? "").trim()) throw new Error("name fehlt (welche Eigenschaft?)");
        return { ...(p.pset ? { pset: String(p.pset) } : {}), name: String(p.name), wert: p.wert ?? "" };
      }) }),
    reg.registrieren({ id: "transformieren", label: "Verschieben, drehen, skalieren (Vorschlag)", menue: "Ändern",
      parameter: { guid: "text", verschiebung_m: "text", drehung_grad: "zahl", faktor: "zahl", satz_marke: "text" },
      ausfuehren: (p, ctx) => vorschlagMachen("transformieren", p, ctx, () => {
        /** @type {Record<string, any>} */
        const params = {};
        if (p?.verschiebung_m != null) params.verschiebung_m = verschiebung(p.verschiebung_m, "verschiebung_m");
        if (p?.drehung_grad != null) params.drehung_grad = Number(p.drehung_grad);
        if (p?.faktor != null) params.faktor = Number(p.faktor);
        if (p?.zentrum != null) params.zentrum = planPunkt(p.zentrum, "zentrum");
        return params;
      }) }),
    reg.registrieren({ id: "teilen", label: "Bauteil teilen (Vorschlag)", menue: "Ändern", parameter: { guid: "text", punkt: "punkt", anteil: "zahl", linie: "text", satz_marke: "text" },
      ausfuehren: (p, ctx) => vorschlagMachen("teilen", p, ctx, (z) => {
        if (p?.linie != null) return { linie: { a: planPunkt(p.linie.a, "linie.a"), b: planPunkt(p.linie.b, "linie.b") } };
        if (p?.punkt != null) return { punkt_m: planPunkt(p.punkt, "punkt") };
        if (p?.anteil != null) {
          // fraction along the wall from its start a to its end b - an agent cannot know coordinates, it can say "in der Mitte"
          const f = Number(p.anteil);
          if (!(f > 0 && f < 1)) throw new Error("anteil muss zwischen 0 und 1 liegen (0,5 = Wandmitte)");
          const fund = bauteilImModell(a().modell(), z.guid, { projektId: a().optionen()?.projektId ?? null });
          const el = fund?.element;
          if (!el?.a || !el?.b) throw new Error("anteil gilt nur für Wände — bei Flächen die Linie angeben");
          return { punkt_m: { x: el.a.x + (el.b.x - el.a.x) * f, z: el.a.z + (el.b.z - el.a.z) * f } };
        }
        throw new Error("Teilen braucht punkt {x, z} (Wand), anteil (Wand, 0 bis 1) oder linie {a, b} (Fläche)");
      }) }),
    reg.registrieren({ id: "pruefen", label: "Offene Vorschläge prüfen", menue: "Ändern", parameter: { vorschlag_id: "text", guid: "text" },
      // re-runs the check on the CURRENT model: the model may have changed since the proposal was made
      ausfuehren: (p) => {
        const f = a();
        const id = String(p?.vorschlag_id ?? "").trim();
        const guid = String(p?.guid ?? "").trim();
        const liste = f.speicher.offen().filter((v) => (id ? v.id === id : guid ? v.ziel.guid === guid : true));
        if (!liste.length) throw new Error(id ? `Kein offener Vorschlag mit der Id ${id}` : "Kein offener Vorschlag zu prüfen");
        return liste.map((v) => vorschlagKurz(neuPruefen(v)));
      } }),
    reg.registrieren({ id: "vorschlaege", label: "Vorschläge und Verlauf lesen", menue: "Abfrage", kurz: ["aenderungen"],
      ausfuehren: () => ({
        offen: a().speicher.offen().map(vorschlagKurz),
        verlauf: a().speicher.verlauf().map((s) => ({
          vorschlag_id: s.vorschlag_id, art: s.art, satz: s.satz, herkunft: s.herkunft, herkunft_quellen: herkunftQuellen(s), befehl_text: s.befehl_text, zeit: s.zeit,
          bestaetigt_durch: s.bestaetigt_durch ?? null,
          zurueckgenommen: s.zurueckgenommen ?? null,
        })),
      }) }),
    reg.registrieren({ id: "bestaetigen", label: "Vorschlag bestätigen", menue: "Ändern", parameter: { vorschlag_id: "text", durch: "text" },
      ausfuehren: (p, ctx) => {
        // guard rail 1 / D-IM-04: whoever proposed, a person confirms - the agent channel cannot
        if (vomAgentenKanal(ctx)) throw new Error("Ein Agent kann nicht bestätigen — die Person übernimmt im Fenster (Übernehmen), per Befehlszeile oder Sprache");
        const f = a();
        rechtPruefen(f); // 106-07: a person confirms - and only one whose role may change the model
        const v = offenerVorschlag(p);
        const durch = String(p?.durch ?? "tastatur"); // a typed command is the keyboard; the button passes "hand", later voice "sprache"
        const ifc = v.ziel.quelle === "ifc" && f.ifcBauteil ? f.ifcBauteil(v.ziel.guid) : null; // the staleness check needs the element as it is now
        const r = vorschlagAusfuehren(f.modell() ?? {}, v, { ...opt(), bestaetigt_durch: durch, ...(ifc ? { ifcBauteil: ifc } : {}) });
        f.uebernehmen(v, r);
        f.speicher.entfernen(v.id);
        f.speicher.verlaufHinzu({ ...r.eintrag, zurueckgenommen: null });
        f.vorschauEntfernen?.(v.id);
        // the model changed: the other open proposals are checked again - one on the same target is now stale and blocked
        for (const andere of f.speicher.offen()) neuPruefen(andere);
        return { vorschlag_id: v.id, art: v.art, satz: v.satz, herkunft: r.eintrag.herkunft, bestaetigt_durch: durch, warnungen: r.warnungen };
      } }),
    reg.registrieren({ id: "verwerfen", label: "Vorschlag verwerfen", menue: "Ändern", parameter: { vorschlag_id: "text" },
      // discarding changes nothing in the model, so every channel may do it - but an agent only withdraws its OWN proposals,
      // not the ones the person is looking at
      ausfuehren: (p, ctx) => {
        const f = a();
        const v = offenerVorschlag(p);
        if (vomAgentenKanal(ctx) && v.herkunft?.quelle !== "agent") throw new Error("Ein Agent kann nur eigene Vorschläge verwerfen");
        f.speicher.entfernen(v.id);
        f.vorschauEntfernen?.(v.id);
        return { vorschlag_id: v.id, satz: v.satz, verworfen: true };
      } }),
    reg.registrieren({ id: "rueckgaengig", label: "Schritt zurücknehmen", menue: "Ändern", parameter: { vorschlag_id: "text" },
      ausfuehren: (p, ctx) => {
        if (vomAgentenKanal(ctx)) throw new Error("Ein Agent kann keinen Schritt zurücknehmen — das macht die Person im Fenster");
        const f = a();
        rechtPruefen(f); // 106-07: reversing a step changes the model as well
        const frei = f.speicher.verlauf().filter((s) => !s.zurueckgenommen);
        const id = String(p?.vorschlag_id ?? "").trim();
        // without an id the NEWEST step goes (the usual "undo"); with an id any step can go on its own
        const schritt = id ? f.speicher.verlauf().find((s) => s.vorschlag_id === id) : frei[frei.length - 1];
        if (!schritt) throw new Error(id ? `Kein Schritt mit der Id ${id} im Verlauf` : "Nichts zurückzunehmen");
        if (schritt.zurueckgenommen) throw new Error("Dieser Schritt ist schon zurückgenommen");
        // a later active step on the same element (a split) or a newer journal entry of the same property blocks the reversal
        const alle = f.speicher.verlauf();
        const spaetere = alle.slice(alle.findIndex((s) => s.vorschlag_id === schritt.vorschlag_id) + 1).filter((s) => !s.zurueckgenommen);
        const r = aenderungUmkehren(f.modell() ?? {}, schritt, { projektId: f.optionen()?.projektId ?? null, spaetere, eintraege: f.optionen()?.eintraege });
        f.zuruecknehmen(schritt, r);
        f.speicher.verlaufMarkieren(schritt.vorschlag_id, { zurueckgenommen: new Date().toISOString() });
        return { vorschlag_id: schritt.vorschlag_id, art: schritt.art, satz: schritt.satz, herkunft: schritt.herkunft, zurueckgenommen: true };
      } }),
  ];
  return () => entfernen.forEach((fn) => fn());
}
