// Loads the data a letter reference needs (phase 82, 82-05) and builds the
// prefilled draft. The data of other phases come through their own stores, so
// their cloud locks hold: invoices and accounting settings through 79's
// ladeAlles, fee offers/contracts/amendments through 81's ladeZeitHonorar. The
// dunning text is 79's only wording — mahnBrief(mahnTextFelder(…)) — injected
// into @core's kontextFuer (D-P82-25).
//
// In:  api, reference, page context. Out: ladeBezugDaten, neuerEntwurf.

import { fuellePlatzhalter } from "@core/lib/brief/platzhalter.js";
import { kontextFuer } from "@core/lib/brief/schreiben.js";
import { ladeAlles } from "@/lib/accounting/speicher.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { mahnTextFelder } from "@/lib/accounting/mahnwesen.js";
import { mahnBrief } from "@/lib/accounting/mahnPdf.js";
import { ladeZeitHonorar } from "@/lib/zeitHonorar/speicher.js";
import { behinderungsKontext } from "@/lib/werkplanung/bautagebuch.js";

/**
 * Data of a reference for kontextFuer().
 * @param {any} api
 * @param {{typ: string, id: string, stufe?: number}|null} bezug
 * @param {{heute: string, briefkopf: Record<string, any>, kontakte: any[], projekte: any[], postbuch: any[], t: (s: string) => string}} seite
 * @returns {Promise<import("@core/lib/brief/schreiben.js").KontextDaten>}
 * @throws {Error} plain text when a store refuses (e.g. accounting locked in the cloud)
 */
export async function ladeBezugDaten(api, bezug, { heute, briefkopf, kontakte, projekte, postbuch, t }) {
  /** @type {import("@core/lib/brief/schreiben.js").KontextDaten} */
  const daten = { heute, briefkopf, kontakte, projekte, postbuch };
  if (bezug?.typ === "rechnung") {
    const { daten: buch, setting } = await ladeAlles(api);
    const einst = wirksameEinstellungen(setting?.value || null);
    const vertraege = buch.Honorarvertrag || [];
    daten.rechnungen = buch.Ausgangsrechnung || [];
    daten.mahnText = (rechnung, stufe) => {
      const lauf = (rechnung.mahnungen || []).filter((/** @type {any} */ m) => Number(m?.stufe) === stufe).pop();
      const f = mahnTextFelder(rechnung, stufe, { heute, einst, briefkopf, vertrag: vertraege.find((v) => v.id === rechnung.honorarvertrag_id) || null, ...(lauf?.frist ? { frist: lauf.frist } : {}) }, t);
      const b = mahnBrief(f);
      return { betreff: b.betreff || "", absaetze: b.absaetze || [], tabelle: /** @type {any} */ (b.tabelle), offenCent: f.offenCent, zinsenCent: f.zinsenCent, pauschaleCent: f.pauschaleCent, summeCent: f.summeCent };
    };
  } else if (bezug && ["honorarangebot", "honorarvertrag", "honorarnachtrag"].includes(bezug.typ)) {
    const zh = await ladeZeitHonorar(api, { entitaeten: ["Honorarangebot", "Honorarvertrag", "Honorarnachtrag"] });
    daten.angebote = zh.Honorarangebot || [];
    daten.vertraege = zh.Honorarvertrag || [];
    daten.nachtraege = zh.Honorarnachtrag || [];
  } else if (bezug?.typ === "bautagebuch") {
    // 88-02: the entry and the other entries of its project → period and diary text.
    const eintrag = await api.entities.BautagebuchEintrag.get(bezug.id).catch(() => null);
    if (eintrag?.project_id) {
      const alle = (await api.entities.BautagebuchEintrag.filter({ project_id: eintrag.project_id })) || [];
      const k = behinderungsKontext(alle, bezug.id);
      daten.behinderung = k ? { eintrag_id: bezug.id, project_id: eintrag.project_id, ...k } : null;
    }
  }
  return daten;
}

/**
 * A new draft from a template and a reference: placeholders filled from the
 * reference's context (missing required ones as visible [[fehlt: …]] marks),
 * the dunning text from 79, recipient snapshot, project and area.
 * @param {Record<string, any>} vorlage template (with office version applied)
 * @param {{typ: string, id: string, stufe?: number}|null} bezug
 * @param {import("@core/lib/brief/schreiben.js").KontextDaten} daten
 * @param {{projectId?: string|null}} [vorgabe] project preselected when the reference has none
 * @returns {{entwurf: Record<string, any>, hinweise: string[]}}
 */
export function neuerEntwurf(vorlage, bezug, daten, { projectId = null } = {}) {
  const k = kontextFuer(bezug, daten);
  const pflicht = vorlage.pflichtPlatzhalter || [];
  const betreff = fuellePlatzhalter(vorlage.betreff || "", k.daten, { pflicht }).text;
  const text = vorlage.textAus79 ? (k.text ?? "") : fuellePlatzhalter(vorlage.text || "", k.daten, { pflicht }).text;
  const anlagen = (vorlage.anlagen || []).map((/** @type {string} */ a) => fuellePlatzhalter(a, k.daten).text).filter(Boolean);
  const ohneBezug = !bezug;
  const project_id = k.project_id || (ohneBezug ? projectId : null);
  return {
    entwurf: {
      vorlage_key: vorlage.key,
      vorlage_version: vorlage.version || 1,
      art: vorlage.art || vorlage.key,
      status: "entwurf",
      bereich: project_id ? "projekt" : k.bereich === "projekt" ? "buero" : k.bereich,
      project_id: project_id || null,
      empfaenger: k.empfaenger,
      ihr_zeichen: k.ihr_zeichen || "",
      unser_zeichen: "",
      datum: daten.heute,
      betreff,
      text,
      anlagen,
      felder: k.daten,
      bezug: bezug ? { typ: bezug.typ, id: bezug.id, ...(bezug.stufe ? { stufe: bezug.stufe } : {}) } : null,
      tabelle: k.tabelle,
      ...(vorlage.variante ? { variante: vorlage.variante, verteiler: [] } : {}),
      richtwert: Boolean(vorlage.richtwert),
    },
    hinweise: k.hinweise,
  };
}
