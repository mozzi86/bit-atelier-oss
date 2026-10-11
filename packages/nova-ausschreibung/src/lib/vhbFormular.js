// 90-06: fill an official VHB form (Vergabe- und Vertragshandbuch, fillable PDF with `ag_*` fields) as a
// DRAFT from the AVA data. Council 10.10.2026 (HANDOFF-SKILLS-INTEGRATION §3): the office skill
// "…-vhb-formulare-fill" fills the office's VHB folder by hand; the app had no VHB support at all.
//
// D-SK-02 (which forms, which edition) is open → [ASSUMED] the app ships NO form: the user uploads the blank
// form from their own folder (edition and state are whatever they upload and are recorded with each fill).
// The app only fills the fields every VHB form shares (project, trade, award no., contracting authority,
// recipient, dates — names from the office skill's field glossary, scanned over 184 forms) and leaves all
// form-specific fields (ag_001 … ag_5xx, checkboxes) to the user. A known field without data gets
// "[BITTE ERGÄNZEN]". The PDF is NOT flattened: the user finishes and signs it in a PDF reader.
//
// Haftung: the result is a draft; the dialog demands an explicit check step ("keine Rechtsprüfung durch die
// App") before the download is offered, and every fill is logged on the tender (`vhb_formulare`).
//
// In:  PDF bytes of a blank form, project / tender / bid / contact / office profile.
// Out: pure helpers (form number from the file name, standard values) + pdf-lib read/fill. Node-testable.
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, StandardFonts } from "pdf-lib";

/** Marker for a known standard field without data (same wording as the office skill). */
export const LUECKE = "[BITTE ERGÄNZEN]";

/**
 * Known form groups by the first digit of the form number (VHB Teil 1–6), for the dialog label only.
 * @type {Readonly<Record<string, string>>}
 */
export const VHB_TEILE = Object.freeze({ "1": "Teil 1 – Vergabevorbereitung", "2": "Teil 2 – Vergabeunterlagen", "3": "Teil 3 – Vergabeverfahren", "4": "Teil 4 – Bauausführung", "5": "Teil 5 – Nachträge", "6": "Teil 6 – Abrechnung" });

/**
 * Form number and title from the file name of an office form, e.g. "4420_Abnahme.pdf" → 4420 / Abnahme,
 * "111.H Vergabevermerk-Wahl der Vergabeart.pdf" → 111.H / Vergabevermerk-Wahl der Vergabeart.
 * @param {string} dateiname
 * @returns {{nummer: string, titel: string, teil: string|null, stand: string}} stand = "(0722)"-style hint, else ""
 */
export function formularAusDateiname(dateiname) {
  const basis = String(dateiname || "").replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "");
  const m = /^(\d{3,4}(?:[.\s]?(?:[A-Z]{1,3}|\d))?(?:EU)?(?:\.[A-Z]{1,3})?)[\s_-]+(.*)$/.exec(basis);
  const nummer = m ? m[1].trim() : "";
  const titel = (m ? m[2] : basis).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const stand = (/\((\d{4})\)/.exec(basis) || [])[1] || "";
  return { nummer, titel, teil: nummer ? (VHB_TEILE[nummer[0]] ? nummer[0] : null) : null, stand: stand ? `(${stand})` : "" };
}

/** "Musterstr. 1, 90402 Nürnberg" → { str, plzOrt } (best effort; the last part with a 5-digit postcode wins). */
function adresseTeilen(adresse) {
  const teile = String(adresse || "").split(/\s*[,\n·]\s*/).map((s) => s.trim()).filter(Boolean);
  const i = teile.findIndex((t) => /^\d{5}\s/.test(t));
  if (i < 0) return { str: teile[0] || "", plzOrt: teile[1] || "" };
  return { str: teile.slice(0, i).join(", "), plzOrt: teile[i] };
}

/**
 * Values for the shared VHB fields. Every key is a real field name from the glossary; `null` = known
 * field, no data (→ LUECKE when the form has the field).
 * @param {{projekt?: any, tender?: any, bid?: any, kontakt?: any, buero?: {office?: string, address?: string, contact?: string}|null,
 *   vergabe_nr?: string, jetzt?: Date}} p
 * @returns {Record<string, string|null>}
 */
export function standardWerte({ projekt = null, tender = null, bid = null, kontakt = null, buero = null, vergabe_nr = "", jetzt = new Date() }) {
  const s = (v) => { const x = String(v ?? "").trim(); return x || null; };
  const ort = [projekt?.location?.address, projekt?.location?.city].filter(Boolean).join(", ");
  const vs = adresseTeilen(buero?.address);
  const datum = jetzt.toLocaleDateString("de-DE");
  const empfaenger = s(kontakt?.company) || s(bid?.bidder_name);
  const ea = adresseTeilen([kontakt?.address, [kontakt?.zip, kontakt?.city].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  const vv = tender?.vergabevorschlag;
  return {
    ag_massnahme_nr: s(projekt?.number || projekt?.projekt_nr),
    ag_massnahme_bez_1: s(projekt?.name),
    ag_massnahme_bez_2: s(ort),
    ag_leistung_bez: s(tender?.trade || tender?.name),
    ag_leistung_ort: s(projekt?.location?.city),
    ag_vergabe_nr: s(vergabe_nr || tender?.vergabe_nr),
    ag_vergabeart: s(vv?.verfahren),
    ag_datum: datum,
    ag_druckdatum: datum,
    ag_vergabest_nam: s(buero?.office),
    ag_vergabest_str: s(vs.str),
    ag_vergabest_plz_ort: s(vs.plzOrt),
    ag_vergabest_land: "Deutschland",
    ag_vergabest_5: s(buero?.contact),
    ag_comm_empfaenger_nam: empfaenger,
    ag_comm_empfaenger_nam2: s(kontakt?.company && kontakt?.name !== kontakt?.company ? kontakt.name : ""),
    ag_comm_empfaenger_str: s(ea.str),
    ag_comm_empfaenger_plz_ort: s(ea.plzOrt),
    ag_comm_empfaenger_land: empfaenger ? "Deutschland" : null,
    ag_empfaenger_anrede: "Sehr geehrte Damen und Herren,",
    ag_empfaenger_nam: empfaenger,
    ag_empfaenger_str: s(ea.str),
    ag_empfaenger_plz_ort: s(ea.plzOrt),
  };
}

/**
 * Read the fields of a fillable PDF.
 * @param {Uint8Array} bytes
 * @returns {Promise<Array<{name: string, typ: "text"|"checkbox"|"auswahl"|"radio"|"sonst", wert: string}>>}
 */
export async function felderLesen(bytes) {
  const doc = await laden(bytes);
  const felder = doc.getForm().getFields();
  if (!felder.length) throw new Error("Das PDF hat keine ausfüllbaren Felder – bitte das leere VHB-Formular (ausfüllbare Fassung) wählen.");
  return felder.map((f) => {
    const name = f.getName();
    if (f instanceof PDFTextField) return { name, typ: /** @type {const} */ ("text"), wert: f.getText() || "" };
    if (f instanceof PDFCheckBox) return { name, typ: /** @type {const} */ ("checkbox"), wert: f.isChecked() ? "ja" : "" };
    if (f instanceof PDFDropdown) return { name, typ: /** @type {const} */ ("auswahl"), wert: f.getSelected().join(", ") };
    if (f instanceof PDFRadioGroup) return { name, typ: /** @type {const} */ ("radio"), wert: f.getSelected() || "" };
    return { name, typ: /** @type {const} */ ("sonst"), wert: "" };
  });
}

async function laden(bytes) {
  try { return await PDFDocument.load(bytes); } catch (e) {
    throw new Error(/encrypt/i.test(String(/** @type {any} */ (e)?.message)) ? "Das Formular ist geschützt und kann nicht ausgefüllt werden." : `PDF konnte nicht gelesen werden: ${/** @type {any} */ (e)?.message || e}`);
  }
}

/**
 * Assignment shown in the dialog: for every TEXT field of the form that is a known standard field, the
 * value (user input > standard value > LUECKE). Form-specific fields are listed as "offen" (left for the
 * user) and are not touched, unless the user typed a value for them.
 * @param {Array<{name: string, typ: string, wert: string}>} felder
 * @param {Record<string, string|null>} standard
 * @param {Record<string, string>} [eingaben]
 * @returns {{belegt: Array<{name: string, wert: string, quelle: "eingabe"|"standard"|"luecke"}>, offen: string[], luecken: string[]}}
 */
export function belegung(felder, standard, eingaben = {}) {
  const belegt = [], offen = [], luecken = [];
  for (const f of felder) {
    if (f.typ !== "text") { offen.push(f.name); continue; }
    const ein = eingaben[f.name];
    if (ein !== undefined && String(ein).trim() !== "") { belegt.push({ name: f.name, wert: String(ein), quelle: /** @type {const} */ ("eingabe") }); continue; }
    if (!(f.name in standard)) { offen.push(f.name); continue; }
    const w = standard[f.name];
    if (w) belegt.push({ name: f.name, wert: w, quelle: /** @type {const} */ ("standard") });
    else { belegt.push({ name: f.name, wert: LUECKE, quelle: /** @type {const} */ ("luecke") }); luecken.push(f.name); }
  }
  return { belegt, offen, luecken };
}

/** Replace characters Helvetica (WinAnsi) cannot encode — pdf-lib would throw while drawing the appearance. */
function winAnsi(font, text) {
  let out = "";
  for (const ch of String(text)) { try { font.encodeText(ch); out += ch; } catch { out += "?"; } }
  return out;
}

/**
 * Fill the text fields of the blank form. Not flattened; appearances regenerated with Helvetica so every
 * reader shows the values. Fields not in `werte` stay as they are.
 * @param {Uint8Array} bytes blank form
 * @param {Array<{name: string, wert: string}>} werte
 * @returns {Promise<{bytes: Uint8Array, gefuellt: number}>}
 */
export async function formularFuellen(bytes, werte) {
  const doc = await laden(bytes);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let gefuellt = 0;
  for (const { name, wert } of werte) {
    let feld;
    try { feld = form.getTextField(name); } catch { continue; }
    const max = feld.getMaxLength();
    let text = winAnsi(font, wert);
    if (max !== undefined && text.length > max) text = text.slice(0, max);
    feld.setText(text);
    gefuellt += 1;
  }
  form.updateFieldAppearances(font);
  return { bytes: await doc.save(), gefuellt };
}

/**
 * Log entry stored on the tender (`tender.vhb_formulare`, new optional field — list, newest last).
 * @param {{formular: ReturnType<typeof formularAusDateiname>, stand: string, datei: string, pruefer: string, gefuellt: number, luecken: string[], bid_id?: string|null, jetzt?: Date}} p
 */
export function protokollEintrag({ formular, stand, datei, pruefer, gefuellt, luecken, bid_id = null, jetzt = new Date() }) {
  return { datum: jetzt.toISOString(), nummer: formular.nummer, titel: formular.titel, stand: String(stand || "").trim(), datei, pruefer: String(pruefer || "").trim(), gefuellt, luecken: [...luecken], bid_id, entwurf: true };
}
