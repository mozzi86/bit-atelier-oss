// 106-10: the change log of the review workplace ("Prüfen und Freigeben", the role of the BIM data manager). It reads the
// ordered list of confirmed steps (verlauf/schrittVerlauf.js, entity AenderungsSchritt) and adds what a review needs:
// a status per step (ungeprüft / freigegeben / zurückgenommen), which steps came from an agent or from speech (the ones
// that need a human review), the release note with name and time, the plan of a reversal of ONE step on the stored
// model, the order of a batch, the list of unreviewed AI changes for the plans (106-11) and the export.
//
// Guard rails this module carries:
//  (1) releasing and reversing are human actions (decision D-IM-04): nothing here runs on its own, the page asks first and
//      every patch carries the person's name; the server refuses every write by a program on this entity with 403
//      (routes.js NUR_PERSON_SCHREIBT, checked on the decoded entity name),
//  (2) every step keeps its origins; several are shown together ("Spracheingabe + Agent + Bildkontext", D-IM-07),
//  (3) a reversal goes through the same function as the viewer's undo (aenderungUmkehren): it refuses instead of putting an
//      old state over newer work,
//  D-IM-02: the export never carries an image - an NDA project says so in its head line, and any image data that might sit in a
//      text field is replaced by a word.
// Pure: no React, no I/O.
//
// In:  step records (AenderungsSchritt), the stored model / journal for a reversal, the person's name, a translator.
// Out: status, filtered lists, patches, reversal plan, export text.
import { aenderungUmkehren, herkunftQuellen, herkunftText, wertText, zahlText } from "./aenderungen.js";
import { schrittAktiv, schritteOrdnen, spaetereAktive } from "../verlauf/schrittVerlauf.js";

/** Origins that make a step an AI change needing a human review: an agent proposed it, speech recognition heard it, or an image went along. */
export const KI_HERKUNFT = Object.freeze(["agent", "sprache", "bild"]);

/** The three review states of a step. */
export const SCHRITT_STATUS = Object.freeze(["ungeprueft", "freigegeben", "zurueckgenommen"]);

/**
 * How a review state looks: word, sign and border form carry the meaning (guard rail 5), the token only adds colour.
 * `rand`: "gestrichelt" (dashed) / "durchgezogen" (solid) / "gepunktet" (dotted); `token`: app token family (warnung, erfolg) or "gedaempft".
 * @type {Readonly<Record<string, {wort: string, zeichen: string, rand: string, token: string}>>}
 */
export const STATUS_DARSTELLUNG = Object.freeze({
  ungeprueft: { wort: "Ungeprüft", zeichen: "?", rand: "gestrichelt", token: "warnung" },
  freigegeben: { wort: "Freigegeben", zeichen: "✓", rand: "durchgezogen", token: "erfolg" },
  zurueckgenommen: { wort: "Zurückgenommen", zeichen: "↶", rand: "gepunktet", token: "gedaempft" },
});

/** Refusal: a review action without the person's name (the note "freigegeben durch …" would be empty). */
export const OHNE_NAME_TEXT = "Ohne Namen keine Freigabe — erst unter Einstellungen › Nutzer & Rechte eine Person wählen (oder anmelden)";

/**
 * The name a review note and a step's author carry (review 106-10): the active office person ("Nutzer & Rechte", switched with
 * "Ansicht als"); without one, the signed-in account only in the cloud. The local sign-in is a stand-in ("Lokaler Nutzer",
 * server/routes.js DEV_USER), not a person - so locally without an office person the name is empty and a release is refused.
 * @param {{nutzer?: {name?: string}|null, datenquelle?: string}|null|undefined} zugriff  useZugriff() value.
 * @param {{full_name?: string, email?: string}|null|undefined} user  useAuth() user.
 * @returns {string} "" when no person is known
 */
export function personName(zugriff, user) {
  const n = String(zugriff?.nutzer?.name ?? "").trim();
  if (n) return n;
  if (zugriff?.datenquelle === "supabase") return String(user?.full_name || user?.email || "").trim();
  return "";
}

/**
 * Review state of a step.
 * @param {any} s  Step record. @returns {"ungeprueft"|"freigegeben"|"zurueckgenommen"}
 */
export function schrittStatus(s) {
  if (s?.zurueckgenommen) return "zurueckgenommen";
  if (s?.freigabe?.status === "freigegeben") return "freigegeben";
  return "ungeprueft";
}

/**
 * The step came (also) from an agent, from speech or with an image - it needs a human review.
 * @param {any} s @returns {boolean}
 */
export function kiAenderung(s) {
  return herkunftQuellen(s).some((q) => KI_HERKUNFT.includes(q));
}

/**
 * The GUIDs a step touched: its target, and for a split the two parts.
 * @param {any} s @returns {string[]}
 */
export function schrittGuids(s) {
  const g = [s?.ziel?.guid, ...((s?.nachher?.teile || []).map((/** @type {any} */ x) => x?.guid))].filter(Boolean).map(String);
  return [...new Set(g)];
}

/**
 * Filters and orders the steps for the list (newest first).
 * @param {ReadonlyArray<any>} schritte  Step records of the project.
 * @param {{status?: "alle"|"ungeprueft"|"freigegeben"|"zurueckgenommen", umfang?: "ki"|"alle", quelle?: "alle"|"bim"|"ifc", suche?: string}} [f]
 *   status (default "alle"); umfang "ki" = only agent / speech / image steps (default), "alle" = also typed and by-hand steps;
 *   quelle: drawn elements or IFC journal; suche: words in sentence, command text, target name or GUID (case-insensitive).
 * @returns {any[]}
 */
export function protokollFiltern(schritte, f = {}) {
  const status = f.status ?? "alle", umfang = f.umfang ?? "ki", quelle = f.quelle ?? "alle";
  const suche = String(f.suche ?? "").trim().toLowerCase();
  return schritteOrdnen(schritte).reverse().filter((s) => (status === "alle" || schrittStatus(s) === status)
    && (umfang === "alle" || kiAenderung(s))
    && (quelle === "alle" || s.quelle === quelle)
    && (!suche || [s.satz, s.befehl_text, s.ziel?.name, s.ziel?.guid, s.autor].some((x) => String(x ?? "").toLowerCase().includes(suche))));
}

/**
 * How many steps per state (within the scope).
 * @param {ReadonlyArray<any>} schritte @param {"ki"|"alle"} [umfang]
 * @returns {{ungeprueft: number, freigegeben: number, zurueckgenommen: number, alle: number}}
 */
export function statusZaehlen(schritte, umfang = "ki") {
  const n = { ungeprueft: 0, freigegeben: 0, zurueckgenommen: 0, alle: 0 };
  for (const s of schritte || []) {
    if (umfang === "ki" && !kiAenderung(s)) continue;
    n[schrittStatus(s)] += 1;
    n.alle += 1;
  }
  return n;
}

/**
 * The release note of ONE step - only for an unreviewed, active step, only with a name.
 * @param {any} s  Step record. @param {{durch: string, zeit?: string}} wer  durch: name of the person; zeit: ISO time (default now).
 * @returns {{freigabe: {status: "freigegeben", durch: string, zeit: string}}}  Patch for the record.
 * @throws {Error} German text: no name, step reversed, already released.
 */
export function freigabeVermerk(s, wer) {
  const durch = String(wer?.durch ?? "").trim();
  if (!durch) throw new Error(OHNE_NAME_TEXT);
  const st = schrittStatus(s);
  if (st === "zurueckgenommen") throw new Error("Dieser Schritt ist zurückgenommen — es gibt nichts freizugeben");
  if (st === "freigegeben") throw new Error(`Schon freigegeben durch ${s.freigabe.durch}`);
  return { freigabe: { status: "freigegeben", durch, zeit: wer.zeit || new Date().toISOString() } };
}

/**
 * The note that a step was reversed (in the viewer or here).
 * @param {{durch?: string|null, zeit?: string, ort: "fenster"|"freigabe"|"speichern"}} wer  durch: name (null when the viewer does not
 *   know it); ort: where - in the viewer's history ("fenster"), in the review workplace ("freigabe"), or because saving the step failed ("speichern").
 * @returns {{zurueckgenommen: {zeit: string, durch: string|null, ort: string}}}
 */
export function ruecknahmeVermerk(wer) {
  return { zurueckgenommen: { zeit: wer.zeit || new Date().toISOString(), durch: wer.durch ? String(wer.durch) : null, ort: wer.ort } };
}

/** Arrays of a model record a reversal may write back (the element arrays of the BIM studio). */
const MODELL_FELDER = ["customWalls", "customColumns", "customZones", "customSlabs", "customRoofs", "customWindows", "envOpenings"];

/**
 * Plans the reversal of ONE step on the STORED state - the same rule as the viewer's undo (aenderungUmkehren): it refuses when a later
 * step or a hand edit changed what this step made, when a later split of the same element is still active, or when the element is gone.
 * Nothing is written here: the page shows the sentence first and writes after the person confirmed.
 * @param {any} schritt  Step record (active). @param {ReadonlyArray<any>} alle  All steps of the project (for the later ones).
 * @param {{modell?: any, eintraege?: any[], projektId?: string|number|null}} kontext
 *   modell: stored BimModel record (drawn elements); eintraege: stored IfcAenderung entries of the step's IFC model; projektId: for derived GUIDs.
 * @returns {{art: "bim", felder: Record<string, any[]>}|{art: "ifc", loeschen: {modell: string, guid: string, pset: string, eigenschaft: string, zeit?: string}}}
 *   bim: only the arrays that change (to save as a partial update); ifc: the journal entry to delete.
 * @throws {Error} German text (already reversed, blocked, model missing).
 */
export function ruecknahmePlanen(schritt, alle, kontext = {}) {
  if (!schrittAktiv(schritt)) throw new Error("Dieser Schritt ist schon zurückgenommen");
  const spaetere = spaetereAktive(alle, schritt);
  if (schritt.quelle === "ifc" || schritt.ziel?.quelle === "ifc") {
    const r = aenderungUmkehren({}, /** @type {any} */ (schritt), { projektId: kontext.projektId ?? null, spaetere, eintraege: kontext.eintraege });
    if (!r.journal?.loeschen) throw new Error("Kein Journal-Eintrag zu diesem Schritt");
    return { art: "ifc", loeschen: r.journal.loeschen };
  }
  if (!kontext.modell) throw new Error("Kein gespeichertes Modell zu diesem Projekt — nichts zurückzunehmen");
  const r = aenderungUmkehren(kontext.modell, /** @type {any} */ (schritt), { projektId: kontext.projektId ?? null, spaetere });
  /** @type {Record<string, any[]>} */
  const felder = {};
  for (const k of MODELL_FELDER) if (r.modell[k] !== kontext.modell[k]) felder[k] = r.modell[k];
  return { art: "bim", felder };
}

/**
 * Order of a batch reversal: newest first, so an earlier step is not blocked by a later one of the same batch.
 * @param {ReadonlyArray<any>} schritte @returns {any[]}
 */
export function sammelReihenfolge(schritte) {
  return schritteOrdnen(schritte).reverse();
}

/**
 * The AI changes nobody reviewed yet - what a plan (106-11) must flag ("enthält ungeprüfte KI-Änderungen") and which elements to mark.
 * @param {ReadonlyArray<any>} schritte  Step records of the project.
 * @returns {{anzahl: number, guids: string[], schritte: any[]}}  Active, unreviewed AI steps in order; guids: every element they touched.
 */
export function ungepruefteKiAenderungen(schritte) {
  const offen = schritteOrdnen(schritte).filter((s) => kiAenderung(s) && schrittStatus(s) === "ungeprueft");
  return { anzahl: offen.length, guids: [...new Set(offen.flatMap(schrittGuids))], schritte: offen };
}

/**
 * Before / after of a step in words (the sentence says what; this says the values).
 * @param {any} s  Step record. @param {(x: string) => string} [t]  Translator.
 * @returns {{vorher: string, nachher: string}}
 */
export function vorherNachher(s, t = (x) => x) {
  if (s?.art === "eigenschaft") return { vorher: wertText(s.vorher?.wert ?? null, t), nachher: wertText(s.nachher?.wert ?? null, t) };
  // 261111-zs1: a creation had nothing before it; the sentence says what was made
  if (s?.art === "anlegen") return { vorher: t("nicht vorhanden"), nachher: t("neu angelegt") };
  if (s?.art === "teilen") {
    const teile = s.nachher?.teile || [];
    const mass = (/** @type {any} */ x) => (x?.laenge_m != null ? `${zahlText(x.laenge_m)} m` : x?.flaeche_m2 != null ? `${zahlText(x.flaeche_m2)} m²` : "");
    const vor = s.vorher?.laenge_m != null ? `${zahlText(s.vorher.laenge_m)} m` : s.vorher?.flaeche_m2 != null ? `${zahlText(s.vorher.flaeche_m2)} m²` : "1";
    return { vorher: vor, nachher: teile.map(mass).filter(Boolean).join(" + ") || "2" };
  }
  if (s?.art === "transformieren") {
    const g = (/** @type {any} */ x) => {
      if (!x) return "";
      if (x.a && x.b) return `(${zahlText(x.a.x)} | ${zahlText(x.a.z)}) – (${zahlText(x.b.x)} | ${zahlText(x.b.z)}) m`;
      if (Number.isFinite(x.x)) return `(${zahlText(x.x)} | ${zahlText(x.z)}) m`;
      if (Array.isArray(x.points)) return `${x.points.length} ${t("Punkte")}`;
      return "";
    };
    return { vorher: g(s.vorher?.geometrie), nachher: g(s.nachher?.geometrie) };
  }
  return { vorher: "", nachher: "" };
}

/** Image data in text: a data URL or a long base64 run with a PNG/JPEG/WebP head. */
const BILD_MUSTER = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+|(?:iVBORw0KGgo|\/9j\/|UklGR)[A-Za-z0-9+/=]{40,}/g;

/** Word that replaces image data in the export (i18n key). */
export const BILD_ENTFERNT = "[Bild entfernt]";

/**
 * A text without image data (D-IM-02: the export of the workplace carries no image, an NDA project never one).
 * @param {any} v @returns {string}
 */
export function bildFrei(v) {
  return String(v ?? "").replace(BILD_MUSTER, BILD_ENTFERNT);
}

/** Column heads of the export (i18n keys). */
export const EXPORT_SPALTEN = Object.freeze(["Zeit", "Status", "Herkunft", "Satz", "Befehl", "Vorher", "Nachher", "Prüfung", "Bestätigt von", "Bestätigt über",
  "Freigabe durch", "Freigabe am", "Zurückgenommen am", "Bauteil", "GUID", "Modell"]);

/** Labels of the confirming channels (i18n keys). */
const KANAL_LABEL = { hand: "Knopf", sprache: "Sprache", tastatur: "Tastatur" };

/**
 * One CSV cell (semicolon list, quotes doubled). Review 106-10: a cell starting with = + - @ tab or CR gets a leading apostrophe, so a
 * spreadsheet shows it as text instead of running it as a formula (CSV injection, OWASP) - sentences and values come from agents and
 * speech recognition.
 * @param {any} v @returns {string}
 */
export const zelle = (v) => {
  let s = bildFrei(v).replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The log as CSV text (semicolon separated, for a spreadsheet): one head line with project and date, then one row per step in order.
 * Never an image: image data in any text is replaced (bildFrei); for an NDA project the head says "NDA-Projekt — ohne Bilder".
 * @param {ReadonlyArray<any>} schritte  The steps to export (e.g. the filtered list).
 * @param {{projekt?: {name?: string, nda?: boolean}|null, t?: (s: string) => string, jetzt?: string}} [opt]  jetzt: ISO time of the export (tests).
 * @returns {string}
 */
export function protokollCsv(schritte, opt = {}) {
  const t = opt.t || ((s) => s);
  const kopf = [`${t("Änderungsprotokoll")}: ${opt.projekt?.name ?? ""}`, `${t("Stand")}: ${opt.jetzt || new Date().toISOString()}`];
  if (opt.projekt?.nda) kopf.push(t("NDA-Projekt — ohne Bilder"));
  const zeilen = [kopf.map(zelle).join(";"), EXPORT_SPALTEN.map((s) => zelle(t(s))).join(";")];
  for (const s of schritteOrdnen(schritte)) {
    const vn = vorherNachher(s, t);
    const st = schrittStatus(s);
    zeilen.push([
      s.zeit, t(STATUS_DARSTELLUNG[st].wort), herkunftText(s, t), s.satz, s.befehl_text ?? "", vn.vorher, vn.nachher,
      s.pruefung ? `${s.pruefung.stufe}: ${(s.pruefung.saetze || []).join(" / ")}` : t("nicht geprüft"),
      s.autor ?? "", s.bestaetigt_durch ? t(KANAL_LABEL[/** @type {keyof typeof KANAL_LABEL} */ (s.bestaetigt_durch)] ?? s.bestaetigt_durch) : "",
      s.freigabe?.durch ?? "", s.freigabe?.zeit ?? "", s.zurueckgenommen?.zeit ?? "", s.ziel?.name ?? "", s.ziel?.guid ?? "", s.modell ?? "",
    ].map(zelle).join(";"));
  }
  return zeilen.join("\n");
}

/**
 * Releases the given steps (after the person confirmed the list on the page): one note each with name and time. A step that cannot be
 * released (reversed, already released) is reported, the others go on.
 * @param {ReadonlyArray<any>} auswahl  Steps to release. @param {{durch: string, zeit?: string, speichern: (id: string, patch: any) => Promise<any>}} o
 *   durch: the person's name; speichern: writes the patch onto the stored record (aenderungsProtokollSpeicher.js schrittAktualisieren).
 * @returns {Promise<{erledigt: any[], fehler: Array<{schritt: any, text: string}>}>}  erledigt: the records as stored afterwards.
 */
export async function freigabeAusfuehren(auswahl, o) {
  const erledigt = [], fehler = [];
  for (const s of schritteOrdnen(auswahl)) {
    try {
      const patch = freigabeVermerk(s, { durch: o.durch, zeit: o.zeit });
      const neu = await o.speichern(s.id, patch);
      erledigt.push({ ...s, ...patch, ...(neu && typeof neu === "object" ? neu : {}) });
    } catch (e) { fehler.push({ schritt: s, text: String(/** @type {any} */ (e)?.message || e) }); }
  }
  return { erledigt, fehler };
}

/** Review 106-10: the model was reversed but the note on the step could not be written (the log still shows the step as active). */
export const VERMERK_FEHLT_TEXT = "Modell zurückgenommen, Vermerk nicht gespeichert — bitte neu laden";

/**
 * Reverses the given steps on the stored model, newest first (after the person confirmed the list on the page). Each step goes through
 * ruecknahmePlanen against the CURRENT stored state (the model is read once and carried along, the IFC journal is read per model); a step
 * that is blocked is reported with the reason and the others go on. Only a step whose model change was written gets the reversal note;
 * review 106-10: `bimSpeichern` must reject when it could not write every field (a silently dropped field would leave a note "zurückgenommen"
 * on an unchanged model), and a note that fails after the model was written is reported as VERMERK_FEHLT_TEXT.
 * @param {ReadonlyArray<any>} auswahl  Steps to reverse. @param {ReadonlyArray<any>} alle  All steps of the project (for the later ones).
 * @param {{projektId: string, durch: string|null, zeit?: string,
 *   bimLaden: () => Promise<any>, bimSpeichern: (felder: Record<string, any[]>) => Promise<any>,
 *   journalLaden: (modell: string) => Promise<any[]>, journalLoeschen: (eintrag: any) => Promise<any>,
 *   vermerken: (id: string, patch: any) => Promise<any>}} o
 *   bimLaden: the stored BimModel record (fresh); bimSpeichern: partial update of the element arrays; journalLaden: stored IfcAenderung
 *   entries of a model; journalLoeschen: deletes one entry (record with id); vermerken: writes the reversal note onto the step record.
 * @returns {Promise<{erledigt: any[], fehler: Array<{schritt: any, text: string}>}>}
 */
export async function ruecknahmeAusfuehren(auswahl, alle, o) {
  const erledigt = [], fehler = [];
  let stand = [...(alle || [])];
  /** @type {any} */
  let modell;
  let modellGeladen = false;
  for (const s of sammelReihenfolge(auswahl)) {
    let geschrieben = false;
    try {
      const aktuell = stand.find((x) => x.id === s.id) ?? s;
      if (aktuell.quelle === "ifc" || aktuell.ziel?.quelle === "ifc") {
        const eintraege = await o.journalLaden(String(aktuell.modell ?? aktuell.ziel?.modell ?? ""));
        const plan = ruecknahmePlanen(aktuell, stand, { eintraege, projektId: o.projektId });
        if (plan.art !== "ifc") throw new Error("Unerwarteter Plan");
        const l = plan.loeschen;
        const treffer = (eintraege || []).find((e) => e.modell === l.modell && e.guid === l.guid && e.pset === l.pset && e.eigenschaft === l.eigenschaft && (l.zeit == null || e.zeit === l.zeit));
        if (!treffer) throw new Error("Der Journal-Eintrag dieses Schrittes ist nicht mehr da");
        await o.journalLoeschen(treffer);
        geschrieben = true;
      } else {
        if (!modellGeladen) { modell = await o.bimLaden(); modellGeladen = true; }
        const plan = ruecknahmePlanen(aktuell, stand, { modell, projektId: o.projektId });
        if (plan.art !== "bim") throw new Error("Unerwarteter Plan");
        // bimSpeichern must write all or nothing (saveBimModel {streng: true}) and reject otherwise: then no note is written
        if (Object.keys(plan.felder).length) { await o.bimSpeichern(plan.felder); geschrieben = true; }
        modell = { ...modell, ...plan.felder };
      }
      const patch = ruecknahmeVermerk({ durch: o.durch, zeit: o.zeit, ort: "freigabe" });
      let neu;
      try { neu = await o.vermerken(aktuell.id, patch); }
      catch (e) {
        if (!geschrieben) throw e;
        // the model is already back, the log still says "active": say so instead of a plain error
        throw new Error(`${VERMERK_FEHLT_TEXT} (${/** @type {any} */ (e)?.message || e})`);
      }
      const fertig = { ...aktuell, ...patch, ...(neu && typeof neu === "object" ? neu : {}) };
      stand = stand.map((x) => (x.id === aktuell.id ? fertig : x));
      erledigt.push(fertig);
    } catch (e) { fehler.push({ schritt: s, text: String(/** @type {any} */ (e)?.message || e) }); }
  }
  return { erledigt, fehler };
}
