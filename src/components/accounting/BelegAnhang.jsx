// Receipt attachment control (phase 79, plan 79-04 T6): pick, validate,
// preview/download and remove one receipt file. A CONTROLLED component — the
// parent owns the Beleg value, because a brand-new invoice has no id yet and
// decides when (and to which record) a picked file is actually persisted
// (AusgabeFormular: after the invoice itself is first saved).
//
// In:  props beleg (an existing Beleg record, a picked-but-not-yet-saved
//      {name, mime, groesse, data}, or null), einst (beleg_max_bytes/beleg_mime),
//      onWaehle(datei: File), onEntfernen(). Out: the control; validation
//      errors as inline plain text (no upload attempt on an invalid file).

import React from "react";
import { fmtBytes } from "@core/lib/pdf";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { pruefeBeleg } from "@/lib/accounting/belege.js";
import DateiKnopf from "./gemeinsam/DateiKnopf.jsx";

/**
 * Opens a receipt's data URL in a new tab (Reports.jsx openDoc pattern):
 * an <iframe> for a PDF, an <img> for an image; XML has no useful preview,
 * so it only offers a download link.
 * @param {{mime: string, data: string, name: string}} beleg
 * @param {(k: string) => string} t
 */
function vorschauOeffnen(beleg, t) {
  const fenster = window.open();
  if (!fenster) return;
  if (beleg.mime === "application/pdf") {
    fenster.document.write(`<iframe src="${beleg.data}" style="border:0;width:100%;height:100%" title="${beleg.name}"></iframe>`);
  } else if (beleg.mime.startsWith("image/")) {
    fenster.document.write(`<img src="${beleg.data}" style="max-width:100%" alt="${beleg.name}">`);
  } else {
    fenster.document.write(`<a href="${beleg.data}" download="${beleg.name}">${t("Herunterladen")}: ${beleg.name}</a>`);
  }
}

/**
 * @param {{
 *   beleg: {name: string, mime: string, groesse: number, data: string, id?: string}|null,
 *   einst: Record<string, any>,
 *   onWaehle: (datei: File) => void,
 *   onEntfernen: () => void,
 *   disabled?: boolean,
 * }} props onWaehle: called with the raw File once it passed validation — the
 *   caller reads it (fileToDataUrl) and decides when to persist it as a Beleg
 * @returns {React.ReactElement}
 */
export default function BelegAnhang({ beleg, einst, onWaehle, onEntfernen, disabled = false }) {
  const { t } = useI18n();
  const [fehler, setFehler] = React.useState("");
  const [entfernenFrage, setEntfernenFrage] = React.useState(false);

  const waehleDatei = (/** @type {File} */ datei) => {
    setFehler("");
    const pruefung = pruefeBeleg(datei, /** @type {any} */ (einst));
    if (!pruefung.ok) { setFehler(t(pruefung.fehler)); return; }
    onWaehle(datei);
  };

  return (
    <div className="space-y-2" data-testid="beleg-anhang">
      <h4 className={"text-sm font-medium text-slate-700 dark:text-slate-200"}>{t("Beleg")}</h4>
      {beleg ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          <span className="font-medium">{beleg.name}</span>
          <span className="text-slate-500 dark:text-slate-400">{fmtBytes(beleg.groesse)}</span>
          <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => vorschauOeffnen(beleg, t)}>
            {t("Vorschau/Herunterladen")}
          </button>
          {!entfernenFrage ? (
            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} disabled={disabled} onClick={() => setEntfernenFrage(true)}>
              {t("Entfernen")}
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span>{t("Beleg wirklich entfernen?")}</span>
              <button type="button" className={buttonVariants({ variant: "destructive", size: "sm" })}
                onClick={() => { setEntfernenFrage(false); onEntfernen(); }}>{t("Ja, entfernen")}</button>
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setEntfernenFrage(false)}>{t("Nein")}</button>
            </span>
          )}
        </div>
      ) : (
        <DateiKnopf accept=".pdf,.jpg,.jpeg,.png,.xml" disabled={disabled} onDatei={waehleDatei}>{t("Beleg auswählen")}</DateiKnopf>
      )}
      {fehler && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{fehler}</p>}
    </div>
  );
}
