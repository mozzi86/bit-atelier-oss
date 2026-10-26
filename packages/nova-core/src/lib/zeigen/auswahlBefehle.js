// 106-02: the selection commands every viewer registers into its command register (104-03), so the
// IFC viewer and the BIM studio answer to the same words for people, scripts and agents:
//   auswahl-lesen, auswahl-guid {guid}, auswahl-aufheben, ansicht-auf-auswahl, modell, ansicht-bild {breite?} (106-04).
// Same pattern as fangBefehleRegistrieren (fangEinstellungen.js): a group of commands that read the
// surface through ONE accessor, so the register can be built once while the state changes.
//
// "modell" is the one id that answers per surface in its own shape: the Massing studio (104-03) returns its bodies and
// tool state, the IFC viewer and the BIM studio return {klassen, geschosse, anzahl, gekuerzt, bauteile}. An agent reads
// the answer's keys, not a fixed schema. Labels are German like every other command label of the register.
//
// In:  register (befehlsRegister()), accessor `a()` returning the viewer's current functions.
// Out: a function that removes the commands again.
import { auswahlErforderlich } from "./auswahlKontext.js";
import { BILD_GRUENDE } from "./bildKontext.js";

/**
 * @typedef {object} AuswahlFlaeche
 * @property {() => any} kontext        Current selection as auswahlKontext() record (read from the viewer's synchronous selection, not from a render).
 * @property {(guid: string) => any|null} waehleGuid  Select by GUID; the new context, or null when the model has no such element.
 * @property {() => void} aufheben      Clear the selection.
 * @property {() => void} ansichtAufAuswahl  Frame the selection with the camera (only called with a selection).
 * @property {(opt: {klasse?: string}) => any} modell  Short read-out of the model (counts, storeys, elements with GUID), optionally one IFC class.
 * @property {(opt: {breite?: any}) => {png_base64: string, breite: number, hoehe: number, format: string}} [ansichtBild]
 *   The current 3D view as PNG (ansichtAlsPng); throws a German reason when there is no 3D view. A surface without it answers "ansicht-bild" with a refusal.
 * @property {() => {id: string|null, nda: boolean}} [projekt]  106-06: the open project (id, NDA marker). With the NDA marker "ansicht-bild"
 *   refuses (an image of an NDA project never goes to a model); the answer names the project id, so the MCP server can ask the store for consent.
 */

/** 106-06: refusal of "ansicht-bild" in an NDA project (same words as bildKontext.BILD_GRUENDE.nda). */
export const NDA_BILD_TEXT = BILD_GRUENDE.nda;

/**
 * @param {ReturnType<typeof import("../befehlsregister.js").befehlsRegister>} reg
 * @param {() => AuswahlFlaeche} a  Accessor of the surface's current functions (called at every command).
 * @returns {() => void} Remover for all commands of the group.
 */
export function auswahlBefehleRegistrieren(reg, a) {
  const entfernen = [
    reg.registrieren({ id: "auswahl-lesen", label: "Auswahl lesen", menue: "Abfrage", kurz: ["auswahl"],
      ausfuehren: () => a().kontext() }),
    reg.registrieren({ id: "auswahl-guid", label: "Bauteil per GUID wählen", menue: "Auswahl", parameter: { guid: "text" },
      ausfuehren: (p) => {
        const guid = String(p?.guid ?? "").trim();
        if (!guid) throw new Error("guid fehlt");
        const kontext = a().waehleGuid(guid);
        if (!kontext) throw new Error(`Bauteil nicht gefunden: ${guid}`);
        return kontext;
      } }),
    reg.registrieren({ id: "auswahl-aufheben", label: "Auswahl aufheben", menue: "Auswahl",
      // idempotent on purpose (no `aktiv` guard): an agent that clears an empty selection gets "anzahl 0", not an error
      ausfuehren: () => { a().aufheben(); return { anzahl: 0, bauteile: [] }; } }),
    reg.registrieren({ id: "ansicht-auf-auswahl", label: "Ansicht auf Auswahl", menue: "Ansicht",
      ausfuehren: () => {
        const kontext = auswahlErforderlich(a().kontext()); // "dieses" without a selection is refused, not guessed
        a().ansichtAufAuswahl();
        return { anzahl: kontext.anzahl };
      } }),
    reg.registrieren({ id: "modell", label: "Modell lesen", menue: "Abfrage", parameter: { klasse: "text" },
      // optional "klasse" (e.g. IfcWall): a long model lists at most 200 elements, so an agent searches class by class
      ausfuehren: (p) => a().modell({ klasse: p?.klasse ? String(p.klasse) : undefined }) }),
    reg.registrieren({ id: "ansicht-bild", label: "Ansicht als Bild", menue: "Ansicht", parameter: { breite: "zahl" },
      // 106-04: one PNG of the 3D view for a model that cannot look at the screen; synchronous (the register never awaits)
      // 106-06: never for an NDA project (D-IM-02), and the answer names the project so the MCP server can check the consent in the store
      ausfuehren: (p) => {
        const f = a();
        if (typeof f.ansichtBild !== "function") throw new Error("Diese Fläche kann kein Bild der Ansicht liefern");
        const projekt = f.projekt?.() ?? null;
        if (projekt?.nda) throw new Error(NDA_BILD_TEXT);
        return { ...f.ansichtBild({ breite: p?.breite }), projekt_id: projekt?.id ?? null };
      } }),
  ];
  return () => entfernen.forEach((f) => f());
}
