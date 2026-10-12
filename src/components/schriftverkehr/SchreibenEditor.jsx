// Letter editor of the correspondence (phase 82, 82-05): template → area and
// project → recipient → fields and text (plain-text preview with the missing
// marks) → freeze (PDF with bytes and SHA-256, filed, downloaded) → sent.
// At most six steps from a template to the downloaded PDF. A fixed letter is
// shown read-only and cannot be deleted; the app sends nothing itself — "Als
// versendet markieren" only records it, "E-Mail vorbereiten" opens the mail
// program with the subject (external effect stays with the user, D-P82-29).
//
// In:  props (see the JSDoc). Out: the dialog.

import React, { useEffect, useMemo, useState } from "react";
import { Download, FileText, Lock, Mail, Send } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { BEREICHE, POST_KANAL, SCHREIBEN_STATUS } from "@core/lib/brief/status.js";
import { fehlendIn, umschreiben } from "@core/lib/brief/schreiben.js";
import { schreibenPdf } from "@/lib/schriftverkehr/aktionen.js";
import EmpfaengerWahl from "./EmpfaengerWahl.jsx";
import TextVorschau from "./TextVorschau.jsx";

/** Head row of the TOP table of a protocol letter (German document content). */
const TOP_KOPF = ["TOP", "Thema", "Verantwortlich", "Termin"];
const TOP_SPALTEN = [{ breite_mm: 15, ausrichtung: "links" }, { breite_mm: 85, ausrichtung: "links" }, { breite_mm: 40, ausrichtung: "links" }, { breite_mm: 25, ausrichtung: "rechts" }];

/** @param {any} tabelle @returns {string} one TOP per line "Thema; Verantwortlich; Termin" */
const topsAlsText = (tabelle) => (tabelle?.zeilen || []).map((/** @type {string[]} */ z) => z.slice(1).join("; ")).join("\n");
/** @param {string} text @returns {{kopf: string[], zeilen: string[][], spalten: any[]}|null} */
function topsAusText(text) {
  const zeilen = String(text || "").split("\n").map((z) => z.trim()).filter(Boolean)
    .map((z, i) => { const [thema = "", wer = "", bis = ""] = z.split(";").map((x) => x.trim()); return [String(i + 1), thema, wer, bis]; });
  return zeilen.length ? { kopf: TOP_KOPF, zeilen, spalten: TOP_SPALTEN } : null;
}

/**
 * @param {{
 *   schreiben: Record<string, any>, vorlagen: Array<Record<string, any>>, kontakte: any[], projekte: Array<{id: string, name?: string}>,
 *   bereiche: string[], briefkopf: Record<string, any>, darfBearbeiten: boolean, hinweise?: string[],
 *   onVorlage: (key: string, aktuell: Record<string, any>) => Record<string, any>,
 *   onSpeichern: (s: Record<string, any>) => Promise<Record<string, any>|null>,
 *   onFestschreiben: (s: Record<string, any>) => Promise<Record<string, any>|null>,
 *   onVersendet: (s: Record<string, any>, versandweg: string) => Promise<Record<string, any>|null>,
 *   onLoeschen: (id: string) => Promise<void>,
 *   onPdf: (s: Record<string, any>) => Promise<void>,
 *   onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function SchreibenEditor({ schreiben, vorlagen, kontakte, projekte, bereiche, briefkopf, darfBearbeiten, hinweise = [], onVorlage, onSpeichern, onFestschreiben, onVersendet, onLoeschen, onPdf, onClose }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [f, setF] = useState(/** @type {Record<string, any>} */ (schreiben));
  const [tops, setTops] = useState(() => topsAlsText(schreiben.tabelle));
  const [busy, setBusy] = useState(false);
  const [versandweg, setVersandweg] = useState("brief");
  const [pdfUrl, setPdfUrl] = useState(/** @type {string|null} */ (null));
  useEffect(() => { setF(schreiben); setTops(topsAlsText(schreiben.tabelle)); }, [schreiben]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const entwurf = f.status === "entwurf";
  const bearbeitbar = entwurf && darfBearbeiten;
  const verteiler = f.variante === "verteiler";
  const vorlage = vorlagen.find((v) => v.key === f.vorlage_key) || null;
  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setF((x) => ({ ...x, [k]: v }));
  const aktuell = () => (verteiler ? { ...f, tabelle: topsAusText(tops) } : f);
  const fehlend = fehlendIn(f);
  const ersetzt = useMemo(() => umschreiben(f).ersetzt, [f]);
  const projektFehlt = f.bereich === "projekt" && !f.project_id;

  const lauf = async (/** @type {() => Promise<any>} */ aktion) => { setBusy(true); try { return await aktion(); } finally { setBusy(false); } };
  const vorschau = () => lauf(async () => {
    const { bytes } = await schreibenPdf(aktuell(), { briefkopf });
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type: "application/pdf" })));
  });
  const festschreiben = async () => {
    if (!(await bestaetige({ titel: t("Festschreiben?"), text: t("Danach ist der Text nicht mehr änderbar."), bestaetigen: t("Festschreiben") }))) return;
    await lauf(() => onFestschreiben(aktuell()));
  };
  const loeschen = async () => {
    if (!f.id) return;
    if (await bestaetige({ titel: t("Entwurf löschen?"), text: f.betreff || "", bestaetigen: t("Löschen"), gefahr: true })) await lauf(() => onLoeschen(f.id));
  };
  const mail = () => {
    const email = (kontakte || []).find((k) => k.id === f.empfaenger?.contact_id)?.email || "";
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(f.betreff || "")}`;
  };

  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  const auswahl = "mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900";
  const status = /** @type {any} */ (SCHREIBEN_STATUS)[f.status]?.label || f.status;

  return (
    <FormModal title={f.id ? (entwurf ? t("Schreiben bearbeiten") : t("Schreiben")) : t("Neues Schreiben")} onClose={onClose} schuetzen={bearbeitbar}>
      <div className="space-y-3 text-sm" data-testid="schreiben-editor" data-status={f.status}>
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium dark:bg-slate-800" data-testid="schreiben-status">{t(status)}</span>
          {!entwurf && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" /> {t("Festgeschrieben am {datum}").replace("{datum}", String(f.festgeschrieben_am || "").slice(0, 10))}</span>}
          {f.versendet_am && <span>{t("Versendet am {datum}").replace("{datum}", String(f.versendet_am).slice(0, 10))}</span>}
        </p>
        {hinweise.includes("unbekannte_vorlage") && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{t("Unbekannte Vorlage — freier Brief geöffnet.")}</p>}
        {hinweise.includes("Bezug nicht gefunden") && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{t("Bezug nicht gefunden")}</p>}
        {hinweise.includes("Mahntext aus der Buchhaltung nicht verfügbar") && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{t("Mahntext aus der Buchhaltung nicht verfügbar")}</p>}
        {(f.richtwert || vorlage?.richtwert) && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="richtwert-hinweis">{t("Richtwert – vor Versand prüfen")}</p>}

        {bearbeitbar && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={feld}>{t("Vorlage")}
              <select className={auswahl} value={f.vorlage_key || ""} data-testid="schreiben-vorlage" onChange={(e) => setF(onVorlage(e.target.value, aktuell()))}>
                {vorlagen.filter((v) => "text" in v).map((v) => <option key={v.key} value={v.key}>{t(v.titel || v.key)}</option>)}
              </select>
            </label>
            <label className={feld}>{t("Bereich")}
              <select className={auswahl} value={f.bereich} data-testid="schreiben-bereich"
                onChange={(e) => setF((x) => ({ ...x, bereich: e.target.value, project_id: e.target.value === "projekt" ? x.project_id : null }))}>
                {bereiche.map((b) => <option key={b} value={b}>{t(/** @type {any} */ (BEREICHE)[b]?.label || b)}{b !== "projekt" ? ` (${t("ohne Projekt")})` : ""}</option>)}
              </select>
            </label>
            {f.bereich === "projekt" && (
              <label className={feld}>{t("Projekt")}
                <select className={auswahl} value={f.project_id || ""} data-testid="schreiben-projekt" onChange={(e) => setze("project_id", e.target.value || null)}>
                  <option value="">{t("Projekt wählen")}</option>
                  {projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {verteiler ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={feld}>{t("Verteiler (eine Zeile je Empfänger)")}
              <textarea className={`${auswahl} h-24 py-1`} readOnly={!bearbeitbar} value={(f.verteiler || []).join("\n")} data-testid="schreiben-verteiler"
                onChange={(e) => setze("verteiler", e.target.value.split("\n"))} />
            </label>
            <label className={feld}>{t("Tagesordnungspunkte (Thema; Verantwortlich; Termin)")}
              <textarea className={`${auswahl} h-24 py-1`} readOnly={!bearbeitbar} value={tops} onChange={(e) => setTops(e.target.value)} data-testid="schreiben-tops" />
            </label>
          </div>
        ) : (
          <EmpfaengerWahl kontakte={kontakte} wert={f.empfaenger} nurLesen={!bearbeitbar} onChange={(e) => setze("empfaenger", e)} />
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          <label className={feld}>{t("Datum")}<Input type="date" value={f.datum || ""} readOnly={!bearbeitbar} onChange={(e) => setze("datum", e.target.value)} /></label>
          <label className={feld}>{t("Ihr Zeichen")}<Input value={f.ihr_zeichen || ""} readOnly={!bearbeitbar} onChange={(e) => setze("ihr_zeichen", e.target.value)} /></label>
          <label className={feld}>{t("Unser Zeichen")}<Input value={f.unser_zeichen || ""} readOnly={!bearbeitbar} onChange={(e) => setze("unser_zeichen", e.target.value)} /></label>
        </div>
        {bearbeitbar && (
          <>
            <label className={feld}>{t("Betreff")}<Input value={f.betreff || ""} onChange={(e) => setze("betreff", e.target.value)} data-testid="schreiben-betreff" /></label>
            <label className={feld}>{t("Text")}
              <textarea className={`${auswahl} h-48 py-1 font-mono text-xs`} value={f.text || ""} onChange={(e) => setze("text", e.target.value)} data-testid="schreiben-text" />
            </label>
            <label className={feld}>{t("Anlagen (durch Komma getrennt)")}
              <Input value={(f.anlagen || []).join(", ")} onChange={(e) => setze("anlagen", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
            </label>
          </>
        )}

        <TextVorschau betreff={f.betreff || ""} text={f.text || ""} />
        {ersetzt > 0 && <p role="status" className="text-xs text-amber-800 dark:text-amber-200" data-testid="zeichen-ersetzt">{t("{n} Zeichen ersetzt").replace("{n}", String(ersetzt))}</p>}
        {bearbeitbar && fehlend.length > 0 && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="pflicht-fehlt">{t("Pflichtangaben fehlen: {liste}").replace("{liste}", fehlend.join(", "))}</p>}
        {!entwurf && f.pdf_sha256 && <p className="break-all text-xs text-slate-500" data-testid="schreiben-hash">SHA-256: {f.pdf_sha256}</p>}
        {!entwurf && !f.document_id && <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="neu-erzeugt-hinweis">{t("aus eingefrorenem Text neu erzeugt — nicht byte-identisch mit dem Original")}</p>}

        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-2">
            {bearbeitbar && f.id && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={loeschen}>{t("Löschen")}</Button>}
            {bearbeitbar && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => lauf(() => onSpeichern(aktuell()))} data-testid="schreiben-entwurf-speichern">{t("Entwurf speichern")}</Button>}
            {entwurf && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={vorschau}><FileText className="h-4 w-4" aria-hidden="true" /> {t("PDF-Vorschau")}</Button>}
            {pdfUrl && <a className="self-center text-xs underline" href={pdfUrl} target="_blank" rel="noreferrer" data-testid="pdf-vorschau-link">{t("Vorschau öffnen")}</a>}
          </div>
          <div className="flex flex-wrap gap-2">
            {bearbeitbar && (
              <Button type="button" size="sm" disabled={busy || fehlend.length > 0 || projektFehlt} onClick={festschreiben} data-testid="schreiben-festschreiben">
                <Lock className="h-4 w-4" aria-hidden="true" /> {t("Festschreiben")}
              </Button>
            )}
            {!entwurf && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => lauf(() => onPdf(f))} data-testid="schreiben-pdf"><Download className="h-4 w-4" aria-hidden="true" /> {t("PDF herunterladen")}</Button>}
            {!entwurf && <Button type="button" variant="outline" size="sm" onClick={mail}><Mail className="h-4 w-4" aria-hidden="true" /> {t("E-Mail vorbereiten")}</Button>}
            {f.status === "festgeschrieben" && darfBearbeiten && (
              <span className="flex items-center gap-1">
                <select aria-label={t("Versandweg")} className="h-9 rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={versandweg} onChange={(e) => setVersandweg(e.target.value)} data-testid="versandweg">
                  {Object.entries(POST_KANAL).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
                </select>
                <Button type="button" size="sm" disabled={busy} onClick={() => lauf(() => onVersendet(f, versandweg))} data-testid="schreiben-versendet"><Send className="h-4 w-4" aria-hidden="true" /> {t("Als versendet markieren")}</Button>
              </span>
            )}
          </div>
        </div>
      </div>
    </FormModal>
  );
}
