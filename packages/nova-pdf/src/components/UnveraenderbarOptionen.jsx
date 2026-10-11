// 90-02: options of the PDF-studio tool "PDF unveränderbar" — mode (flatten form + remove annotations,
// text stays searchable / image PDF, nothing editable or extractable) and an analysis of the selected
// PDF (form fields, annotations by type) so the user sees what will be made non-editable. All strings
// through t() (i18n part file i18nTeile/pdf-plankopf.js, same PDF-studio part).
//
// In:  ladeBytes() → Uint8Array of the selected source (null without source), quelleKey (changes when
//      the source changes), modus, onModus(m). Out: rendered form; data-testids pu-modus, pu-analyse.
import React, { useEffect, useState } from "react";
import { useI18n } from "@core/lib/i18n";
import { pdfAnalyse } from "@pdf/lib/unveraenderbar";

/**
 * @param {{ladeBytes: () => Uint8Array|null, quelleKey: string, modus: "abflachen"|"rastern", onModus: (m: "abflachen"|"rastern") => void}} props
 */
export default function UnveraenderbarOptionen({ ladeBytes, quelleKey, modus, onModus }) {
  const { t } = useI18n();
  const [analyse, setAnalyse] = useState(/** @type {Awaited<ReturnType<typeof pdfAnalyse>>|null} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    let weg = false;
    setAnalyse(null); setFehler(null);
    const b = quelleKey ? ladeBytes() : null;
    if (!b) return undefined;
    pdfAnalyse(b).then((a) => { if (!weg) setAnalyse(a); }).catch((e) => { if (!weg) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { weg = true; };
  }, [quelleKey]); // eslint-disable-line react-hooks/exhaustive-deps -- ladeBytes is a fresh closure per render; the source key is the identity

  const arten = analyse ? Object.entries(analyse.arten).map(([k, n]) => `${n} × ${k}`).join(", ") : "";
  return (
    <div className="space-y-3 text-xs">
      <div className="space-y-1.5" role="radiogroup" aria-label={t("Art der Umwandlung")} data-testid="pu-modus" data-modus={modus}>
        <label className="flex items-start gap-1.5">
          <input type="radio" name="pu-modus" className="mt-0.5" checked={modus === "abflachen"} onChange={() => onModus("abflachen")} />
          <span><b>{t("Formular abflachen")}</b> — {t("Formularfelder werden fest in die Seite geschrieben, Kommentare und Stempel entfernt. Text bleibt durchsuchbar, Datei bleibt klein.")}</span>
        </label>
        <label className="flex items-start gap-1.5">
          <input type="radio" name="pu-modus" className="mt-0.5" checked={modus === "rastern"} onChange={() => onModus("rastern")} />
          <span><b>{t("Als Bild-PDF")}</b> — {t("Jede Seite wird zum Bild, Kommentare bleiben sichtbar. Nichts ist mehr bearbeitbar oder kopierbar; Text nicht mehr durchsuchbar, Datei größer.")}</span>
        </label>
      </div>
      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600" data-testid="pu-analyse"
        data-felder={analyse?.felder ?? ""} data-annotationen={analyse?.annotationen ?? ""}>
        {!quelleKey && t("Zuerst ein PDF wählen.")}
        {quelleKey && !analyse && !fehler && t("PDF wird geprüft …")}
        {fehler && <span className="text-rose-700">{fehler}</span>}
        {analyse && (
          <>
            {analyse.seiten} {t("Seiten")} · {analyse.felder} {t("Formularfelder")} · {analyse.annotationen} {t("Anmerkungen")}{arten ? ` (${arten})` : ""}
            {analyse.felder === 0 && analyse.annotationen === 0 && <div className="text-slate-500">{t("Keine Formularfelder oder Anmerkungen gefunden — Text und Seiten lassen sich trotzdem in jedem Editor ändern; dafür „Als Bild-PDF“ wählen.")}</div>}
          </>
        )}
      </div>
    </div>
  );
}
