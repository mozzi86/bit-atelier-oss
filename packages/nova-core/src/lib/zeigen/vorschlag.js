// 106-03: the pipeline around a change - from "this wall" to a checked proposal, and from a confirmed proposal to the
// new model. It glues aenderungen.js (change functions, proposal, origin record), teilen.js and pruefung.js so the
// register commands and the preview component of the studio have ONE entry point each:
//   vorschlagVorbereiten(modell, eingabe)  -> proposal with sentence and check; changes NOTHING,
//   vorschlagAusfuehren(modell, vorschlag) -> only after a human confirmed it; returns the new model + origin record.
// Guard rails: "dieses" without a selection is refused (3), a change always waits for confirmation, also an agent's (1,
// decision D-IM-04), an agent cannot confirm its own proposal, a check result "fehler" blocks, every executed step
// returns its origin record (2).
//
// In:  model record, input {art, ziel | kontext, params, herkunft}, options. Out: proposal / {modell, eintrag}. Pure.
import { steckbrief, typFuerWand, BAUTEIL_TYPEN } from "../bauteil/steckbrief.js";
import { auswahlErforderlich } from "./auswahlKontext.js";
import { pruefeAenderung } from "./pruefung.js";
import {
  BESTAETIGUNG_KANAELE, MARKE_FELD, bauteilImModell, eigenschaftSetzen, geometrieVon, herkunftEintrag, herkunftQuellen, modellMitAenderung,
  naechsteFreieIdx, transformieren, vorschlagErzeugen,
} from "./aenderungen.js";
import { wandTeilen, deckeTeilen } from "./teilen.js";

/** Refusal text of an IFC change without a project: the journal entry would belong to no project and never be loaded again. */
export const KEIN_PROJEKT_TEXT = "Kein Projekt gewählt — ohne Projekt kann die Änderung nicht im Journal gespeichert werden";

/** Refusal text when "dieses" meets a selection of several elements (a command needs exactly one target). */
export const MEHRERE_AUSWAHL_TEXT = "Mehrere Bauteile gewählt — ein Befehl auf „dieses“ braucht genau ein Bauteil";

/**
 * The target of a command that says "dieses": the one selected element with a GUID. Refused, never guessed, when
 * nothing is selected, when the selection has no GUID, or when several elements are selected.
 * @param {Parameters<typeof auswahlErforderlich>[0]} kontext  Selection record (auswahlKontext of 106-02); null = nothing selected.
 * @returns {{guid: string, klasse: string|null, name: string}}
 * @throws {Error} KEINE_AUSWAHL_TEXT / KEIN_GUID_TEXT (auswahlKontext.js) or MEHRERE_AUSWAHL_TEXT.
 */
export function zielAusAuswahl(kontext) {
  const k = auswahlErforderlich(/** @type {any} */ (kontext));
  const mitGuid = (k.bauteile || []).filter((/** @type {any} */ b) => b?.guid);
  if (k.anzahl > 1 || mitGuid.length !== 1) throw new Error(MEHRERE_AUSWAHL_TEXT);
  const b = /** @type {any} */ (mitGuid[0]);
  return { guid: b.guid, klasse: b.klasse ?? null, name: b.name || "" };
}

/** Values the data sheet derives for a drawn wall (what an unset field shows as its "before"). @param {any} wand @param {any} pid */
function abgeleitetVonWand(wand, pid) {
  try {
    const ty = typFuerWand(wand);
    const s = steckbrief(wand, ty.typ, { projektId: pid, quelle: "customWalls", typAbgeleitet: ty.abgeleitet });
    return { name: s.label, werte: { kg: s.kg, gewerk_lb: s.gewerk?.lb ?? null, tragend: s.tragend, material: s.material, bauteil_typ: s.typ } };
  } catch { return { name: BAUTEIL_TYPEN["wand-innen"].label, werte: {} }; }
}

/**
 * Prepares ONE change as a proposal: finds the target by GUID, computes before/after, composes the sentence, runs the
 * check. Nothing is changed, nothing is stored - the proposal waits for a human's confirmation.
 * @param {any} modell  Model record of the studio (customWalls ... , see bauteilImModell), may be a stand-in for an IFC model.
 * @param {{art: "eigenschaft"|"transformieren"|"teilen", ziel?: {guid: string, klasse?: string, name?: string}, kontext?: any,
 *   params: any, herkunft: {quelle: string, befehl_text?: string|null}, ifcBauteil?: any}} eingabe
 *   ziel: explicit GUID; kontext: selection record for "dieses" (used when `ziel` is missing; refused when empty);
 *   params: see vorschlagErzeugen (teilen: wall {punkt_m} or slab {linie}); ifcBauteil: `{quelle: "ifc", modell, guid, psets,
 *   project_id?, klasse?, name?}` for a property of an imported IFC element (only art "eigenschaft").
 * @param {Parameters<typeof pruefeAenderung>[2] & {t?: (s: string) => string, id?: string, zeit?: string, eintraege?: any[], naechsteIdx?: number}} [opt]
 *   Same options as pruefeAenderung (projektId, bauart, werkstatt, durchbrueche, geschosshoehe_m, attributPruefung, t), plus
 *   eintraege (stored journal entries of IFC properties), naechsteIdx (free `_idx` for the second part of a split),
 *   id/zeit (tests).
 * @returns {ReturnType<typeof vorschlagErzeugen>}  The proposal with `pruefung`; `pruefung.stufe === "fehler"` blocks confirming.
 * @throws {Error} German text: no selection ("dieses"), target not found, change not possible in this form.
 */
export function vorschlagVorbereiten(modell, eingabe, opt = {}) {
  const pid = opt.projektId ?? null;
  const ziel0 = eingabe.ziel?.guid ? eingabe.ziel : zielAusAuswahl(eingabe.kontext ?? null);
  const params = eingabe.params ?? {};
  const optErz = { t: opt.t, id: opt.id, zeit: opt.zeit };

  // --- IFC element: only a property, only as journal entry -----------------------------------------------------
  if (eingabe.ifcBauteil?.quelle === "ifc") {
    if (eingabe.art !== "eigenschaft") throw new Error("IFC-Bauteile werden hier nicht verschoben oder geteilt — die Datei bleibt unverändert, nur Eigenschaften gehen über das Journal");
    const ifc = { ...eingabe.ifcBauteil, guid: eingabe.ifcBauteil.guid ?? ziel0.guid };
    if (!ifc.project_id) throw new Error(KEIN_PROJEKT_TEXT);
    const r = eigenschaftSetzen(ifc, params, { eintraege: opt.eintraege, zeit: opt.zeit });
    const [pset, eigenschaft] = [r.journal?.pset, r.journal?.eigenschaft];
    const ziel = { guid: ifc.guid, klasse: ifc.klasse ?? ziel0.klasse ?? null, name: ifc.name ?? ziel0.name ?? "", quelle: /** @type {"ifc"} */ ("ifc"), modell: ifc.modell };
    const vorher = { feld: r.feld, label: r.label, wert: r.vorher, quelle: r.vorherQuelle, pset, eigenschaft };
    const nachher = { feld: r.feld, label: r.label, wert: r.nachher, pset, eigenschaft };
    const roh = { art: eingabe.art, ziel, params, vorher, nachher };
    const pruefung = pruefeAenderung(modell ?? {}, roh, { ...opt, ifcBauteil: ifc });
    return vorschlagErzeugen({ ...roh, herkunft: /** @type {any} */ (eingabe.herkunft), pruefung }, optErz);
  }

  // --- drawn element ---------------------------------------------------------------------------------------------
  const fund = bauteilImModell(modell, ziel0.guid, { projektId: pid });
  if (!fund) throw new Error(`Bauteil nicht gefunden: ${ziel0.guid} (Hülle und Werkstatt-Bauteile sind abgeleitet und hier nicht änderbar)`);
  const el = fund.element;
  const abgeleitet = fund.art === "wand" ? abgeleitetVonWand(el, pid) : { name: "", werte: {} };
  const ziel = { guid: fund.guid, klasse: ziel0.klasse ?? null, name: ziel0.name || (abgeleitet.name ? `${abgeleitet.name} W-${el._idx}` : fund.kurzname), quelle: /** @type {"bim"} */ ("bim") };
  /** @type {any} */ let vorher, nachher;
  if (eingabe.art === "eigenschaft") {
    const r = eigenschaftSetzen(el, params, { abgeleitet: abgeleitet.werte });
    vorher = { feld: r.feld, label: r.label, wert: r.vorher, quelle: r.vorherQuelle };
    nachher = { feld: r.feld, label: r.label, wert: r.nachher };
  } else if (eingabe.art === "transformieren") {
    const neu = transformieren(el, params, { geschosshoehe_m: opt.geschosshoehe_m });
    vorher = { geometrie: geometrieVon(el) };
    nachher = { geometrie: geometrieVon(neu) };
  } else if (eingabe.art === "teilen") {
    const idx = opt.naechsteIdx ?? naechsteFreieIdx(modell);
    if (fund.art === "wand") {
      if (!params.punkt_m) throw new Error("Wand teilen: Teilungspunkt fehlt (punkt_m: {x, z} in m)");
      const oeff = (modell.customWindows || []).filter((/** @type {any} */ o) => o.wallIdx === el._idx);
      const r = wandTeilen(el, params.punkt_m, { naechsteIdx: idx, projektId: pid, oeffnungen: modell.customWindows });
      vorher = { element: el, laenge_m: Math.round(Math.hypot(el.b.x - el.a.x, el.b.z - el.a.z) * 1e6) / 1e6, oeffnungen: oeff };
      nachher = { teile: r.teile.map((w, i) => ({ _idx: w._idx, guid: w.guid, laenge_m: r.laengen_m[i] })), t_m: r.t_m, oeffnungen: r.oeffnungen };
    } else if (["decke", "zone", "dach"].includes(fund.art)) {
      if (!params.linie) throw new Error("Decke teilen: Teilungslinie fehlt (linie: {a, b} mit x, z in m)");
      const quelle = { decke: "customSlabs", zone: "customZones", dach: "customRoofs" }[/** @type {"decke"|"zone"|"dach"} */ (fund.art)];
      const r = deckeTeilen(el, params.linie, { naechsteIdx: idx, projektId: pid, quelle });
      vorher = { element: el, flaeche_m2: flaecheVon(el.points), oeffnungen: [] };
      nachher = { teile: r.teile.map((w, i) => ({ _idx: w._idx, guid: w.guid, flaeche_m2: r.flaechen_m2[i] })), oeffnungen: [] };
    } else throw new Error("Teilen geht nur bei Wänden und Flächen (Decke, Raum, Dach)");
  } else throw new Error(`Vorschlag: unbekannte Art „${eingabe.art}“`);

  const roh = { art: eingabe.art, ziel, params, vorher, nachher };
  const pruefung = pruefeAenderung(modell, roh, opt);
  return vorschlagErzeugen({ ...roh, herkunft: /** @type {any} */ (eingabe.herkunft), pruefung }, optErz);
}

/** Area of a plan polygon in m2 (shoelace, rounded to 1e-6). @param {Array<{x: number, z: number}>} p */
function flaecheVon(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i].x * q.z - q.x * p[i].z; }
  return Math.round(Math.abs(s / 2) * 1e6) / 1e6;
}

/**
 * Refusal text of a blocked proposal: the first "fehler" sentence, with "Gesperrt:" in front unless it already starts so
 * (a stale proposal says "Veraltet: ..." as it is, nothing is "locked" about it).
 * @param {{saetze: string[], befunde?: Array<{stufe: string, satz: string, code?: string}>}} p
 */
function gesperrtText(p) {
  const b = p.befunde?.find((x) => x.stufe === "fehler");
  const satz = b?.satz ?? p.saetze[0];
  return /^(Gesperrt|Veraltet)/.test(satz) || b?.code === "veraltet" ? satz : `Gesperrt: ${satz}`;
}

/**
 * Executes a CONFIRMED proposal: the only function that turns a proposal into a changed model. It refuses without a
 * human confirmation (also for origin "agent", decision D-IM-04; an agent cannot confirm its own proposal), without a
 * check, and when the check - run again on the CURRENT model, it may have changed since the preview - says "fehler".
 * That check also refuses a STALE proposal: if another step changed the same property or geometry since the proposal was
 * made, the sentence the person confirmed is no longer true and nothing runs ("Veraltet: ..."). So the `vorher` the
 * origin record keeps is always the state the step really replaced, and the step can be reversed on its own.
 * The result also carries what the step really made (new geometry, the stored parts of a split) and writes the origin
 * mark onto the changed drawn element(s) (MARKE_FELD) / the origin fields into the IFC journal entry.
 * @param {any} modell  Current model record.
 * @param {ReturnType<typeof vorschlagErzeugen>} vorschlag  The proposal shown to the human.
 * @param {Parameters<typeof pruefeAenderung>[2] & {bestaetigt_durch?: string, zeit?: string, naechsteIdx?: number}} [opt]
 *   bestaetigt_durch: who confirmed - "hand" (button), "sprache" (yes) or "tastatur" (key); anything else, "agent"
 *   included, is refused. The check options are the ones of vorschlagVorbereiten (the check is repeated; for an IFC
 *   property `ifcBauteil` and `eintraege` are needed to compare with the current value).
 * @returns {{modell: any, eintrag: ReturnType<typeof herkunftEintrag>, journal?: any, warnungen: string[]}}
 *   modell: the NEW model (an IFC property change leaves it as is and returns the journal entry to store in `journal`);
 *   eintrag: origin record for the history / undo stack; warnungen: remarks of a split (openings over the cut).
 * @throws {Error} German text: not confirmed, not checked, blocked by the check, target gone.
 */
export function vorschlagAusfuehren(modell, vorschlag, opt = {}) {
  const von = opt.bestaetigt_durch;
  if (von === "agent") throw new Error("Ein Agent kann seine eigene Änderung nicht bestätigen — es ändert sich nichts");
  if (!von || !BESTAETIGUNG_KANAELE.includes(von)) throw new Error("Nicht bestätigt — es ändert sich nichts");
  if (!vorschlag?.pruefung) throw new Error("Der Vorschlag ist nicht geprüft — es ändert sich nichts");
  if (vorschlag.pruefung.stufe === "fehler") throw new Error(gesperrtText(vorschlag.pruefung));
  const aktuell = pruefeAenderung(modell ?? {}, vorschlag, opt);
  if (aktuell.stufe === "fehler") throw new Error(gesperrtText(aktuell));
  const zeit = opt.zeit || new Date().toISOString();
  const ifc = vorschlag.ziel?.quelle === "ifc";
  // herkunft_quellen (D-IM-07): all origins next to the main one, so a reload still tells "Spracheingabe + Agent" from "Agent"
  const marke = { herkunft: vorschlag.herkunft.quelle, herkunft_quellen: herkunftQuellen(vorschlag.herkunft), befehl_text: vorschlag.herkunft.befehl_text ?? null, zeit, vorschlag_id: vorschlag.id };
  // the mark the element carried before (a step reverses it only while it is still its own)
  const markeVorher = ifc ? null : (bauteilImModell(modell ?? {}, vorschlag.ziel.guid, { projektId: opt.projektId ?? null })?.element?.[MARKE_FELD] ?? null);
  const r = modellMitAenderung(modell ?? {}, vorschlag, { projektId: opt.projektId, geschosshoehe_m: opt.geschosshoehe_m, naechsteIdx: opt.naechsteIdx, zeit, bestaetigt_durch: von, marke });
  // what the step REALLY made: the studio's counter may have given the second part of a split another number than the preview
  let nachher = vorschlag.nachher;
  if (vorschlag.art === "transformieren" && r.element) nachher = { geometrie: geometrieVon(r.element) };
  if (vorschlag.art === "teilen" && r.teile) {
    nachher = { ...vorschlag.nachher, teile: r.teile.map((w, i) => ({ ...(vorschlag.nachher?.teile?.[i] || {}), _idx: w._idx, guid: w.guid, element: w })), oeffnungenNach: r.oeffnungenNach };
  }
  const eintrag = herkunftEintrag({ ...vorschlag, nachher }, {
    zeit, bestaetigt_durch: von,
    ...(r.journal ? { journal_zeit: r.journal.zeit } : {}),
    ...(ifc || vorschlag.art === "teilen" ? {} : { marke_vorher: markeVorher }),
  });
  return { modell: r.modell, eintrag, ...(r.journal ? { journal: r.journal } : {}), warnungen: r.warnungen };
}
