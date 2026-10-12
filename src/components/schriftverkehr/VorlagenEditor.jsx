// Template editor (phase 82, 82-05): the office version of a template —
// subject, text, enclosures — with the placeholder help; unknown placeholders
// are listed red and block saving; "Auf Standard zurücksetzen" removes the
// office version; "Probedruck" fills neutral sample data. Without full rights
// on the settings, and for the fee builders (81) and the dunning letter (79),
// whose wording stays with their owners, the editor is read-only.
//
// In:  props vorlage (with office version), darfPflegen, briefkopf, heute,
//      onSpeichern, onZuruecksetzen, onProbedruck, onClose. Out: the dialog.

import React, { useRef, useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { platzhalterIn } from "@core/lib/brief/platzhalter.js";
import { erlaubt } from "@core/lib/brief/platzhalterKatalog.js";
import PlatzhalterHilfe from "./PlatzhalterHilfe.jsx";

/**
 * @param {{
 *   vorlage: Record<string, any>, darfPflegen: boolean,
 *   onSpeichern: (v: Record<string, any>, werte: {betreff: string, text: string, anlagen: string[]}) => Promise<boolean>,
 *   onZuruecksetzen: (v: Record<string, any>) => Promise<boolean>,
 *   onProbedruck: (v: Record<string, any>, werte: {betreff: string, text: string, anlagen: string[]}) => Promise<void>,
 *   onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function VorlagenEditor({ vorlage, darfPflegen, onSpeichern, onZuruecksetzen, onProbedruck, onClose }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const mitText = "text" in vorlage && !vorlage.textAus79;
  const bearbeitbar = darfPflegen && mitText;
  const [betreff, setBetreff] = useState(String(vorlage.betreff || ""));
  const [text, setText] = useState(String(vorlage.text || ""));
  const [anlagen, setAnlagen] = useState((vorlage.anlagen || []).join(", "));
  const [busy, setBusy] = useState(false);
  const feldRef = useRef(/** @type {HTMLTextAreaElement|null} */ (null));
  const werte = () => ({ betreff, text, anlagen: anlagen.split(",").map((/** @type {string} */ x) => x.trim()).filter(Boolean) });
  const unbekannt = platzhalterIn(`${betreff}\n${text}\n${anlagen}`).filter((p) => !erlaubt(vorlage.art, p));

  const einfuegen = (/** @type {string} */ p) => {
    const el = feldRef.current;
    const pos = el ? el.selectionStart ?? text.length : text.length;
    setText((x) => x.slice(0, pos) + p + x.slice(pos));
  };
  const lauf = async (/** @type {() => Promise<any>} */ a) => { setBusy(true); try { return await a(); } finally { setBusy(false); } };
  const zuruecksetzen = async () => {
    if (!(await bestaetige({ titel: t("Auf Standard zurücksetzen?"), text: t("Die Büro-Fassung wird gelöscht."), bestaetigen: t("Zurücksetzen"), gefahr: true }))) return;
    if (await lauf(() => onZuruecksetzen(vorlage))) onClose();
  };
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  return (
    <FormModal title={t(vorlage.titel || vorlage.key)} onClose={onClose} schuetzen={bearbeitbar}>
      <div className="space-y-3 text-sm" data-testid="vorlagen-editor">
        {vorlage.richtwert && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t("Richtwert – vor Versand prüfen")}</p>}
        {vorlage.quelle === "81" && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Der Text kommt aus Angebot & Auftrag (Phase 81) und wird beim Öffnen eines Schreibens als Entwurf übernommen.")}</p>}
        {vorlage.textAus79 && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Der Mahntext kommt aus der Buchhaltung (Phase 79); die Vorlage liefert nur den Betreff.")}</p>}
        {!darfPflegen && mitText && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Nur lesend — Vorlagen pflegt, wer die Einstellungen bearbeiten darf.")}</p>}
        {vorlage.hinweis === "standard_aktualisiert" && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{t("Der Standard wurde aktualisiert — die Büro-Fassung beruht auf einer älteren Fassung.")}</p>}
        {"text" in vorlage && (
          <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
            <div className="space-y-2">
              <label className={feld}>{t("Betreff")}<Input value={betreff} readOnly={!bearbeitbar} onChange={(e) => setBetreff(e.target.value)} data-testid="vorlage-betreff" /></label>
              {mitText && (
                <label className={feld}>{t("Text")}
                  <textarea ref={feldRef} readOnly={!bearbeitbar} value={text} onChange={(e) => setText(e.target.value)} data-testid="vorlage-text"
                    className="mt-1 h-56 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-600 dark:bg-slate-900" />
                </label>
              )}
              <label className={feld}>{t("Anlagen (durch Komma getrennt)")}<Input value={anlagen} readOnly={!bearbeitbar} onChange={(e) => setAnlagen(e.target.value)} /></label>
              {unbekannt.length > 0 && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="platzhalter-unbekannt">{t("Unbekannte Platzhalter: {liste}").replace("{liste}", unbekannt.join(", "))}</p>}
            </div>
            <PlatzhalterHilfe art={vorlage.art} onEinfuegen={einfuegen} nurLesen={!bearbeitbar} />
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {bearbeitbar && vorlage.buero && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={zuruecksetzen} data-testid="vorlage-zuruecksetzen">{t("Auf Standard zurücksetzen")}</Button>}
            {"text" in vorlage && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => lauf(() => onProbedruck(vorlage, werte()))} data-testid="vorlage-probedruck">{t("Probedruck")}</Button>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("Schließen")}</Button>
            {bearbeitbar && <Button type="button" size="sm" disabled={busy || unbekannt.length > 0} onClick={async () => { if (await lauf(() => onSpeichern(vorlage, werte()))) onClose(); }} data-testid="vorlage-speichern">{t("Speichern")}</Button>}
          </div>
        </div>
      </div>
    </FormModal>
  );
}
