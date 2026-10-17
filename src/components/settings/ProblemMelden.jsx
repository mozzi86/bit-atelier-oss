// "Problem melden" card in Einstellungen › System & Info (94-08, register 172).
// Prepares a GitHub issue with a diagnostics bundle — version, page, browser,
// data source, cleaned log lines — and shows the FULL text before anything
// happens. "Auf GitHub öffnen" opens GitHub's new-issue page prefilled; the
// user submits it there. Nothing is sent from the app, no project data.
//
// In:  nothing (log tail from GET /api/system/protokoll in the express build).
// Out: the card.

import React from "react";
import { Bug } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { APP_VERSION } from "@core/lib/projektInfo";
import { DATENQUELLE } from "@core/lib/umgebung";
import { issueText, issueUrl } from "@/lib/problemMelden.js";

/**
 * @returns {React.ReactElement}
 */
export default function ProblemMelden() {
  const { t } = useI18n();
  const [offen, setOffen] = React.useState(false);
  const [beschreibung, setBeschreibung] = React.useState("");
  const [mitProtokoll, setMitProtokoll] = React.useState(true);
  const [protokoll, setProtokoll] = React.useState(/** @type {string[]} */ ([]));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  React.useEffect(() => {
    if (!offen || DATENQUELLE !== "express") return undefined;
    let aktiv = true;
    fetch("/api/system/protokoll", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (aktiv) setProtokoll(Array.isArray(j.zeilen) ? j.zeilen : []);
      })
      .catch((e) => { if (aktiv) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { aktiv = false; };
  }, [offen]);

  // The previous page (Settings opened from it) is not known; the current path is enough.
  const daten = {
    version: APP_VERSION, pfad: window.location.pathname, browser: navigator.userAgent,
    datenquelle: DATENQUELLE, protokoll: mitProtokoll ? protokoll : [], beschreibung,
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-4 dark:border-slate-700" data-testid="problem-melden">
      <p className="flex items-center gap-2 font-medium text-foreground dark:text-slate-100">
        <Bug className="h-4 w-4" aria-hidden="true" /> {t("Problem melden")}
      </p>
      <p className="text-xs text-muted-foreground dark:text-slate-300">
        {t("Bereitet eine Meldung für GitHub vor: Version, Seite, Browser und die letzten Protokollzeilen — ohne Projektdaten. Sie sehen den ganzen Text und schicken ihn selbst ab.")}
      </p>
      {!offen ? (
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setOffen(true)} data-testid="problem-melden-start">
          {t("Meldung vorbereiten")}
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground dark:text-slate-200" htmlFor="problem-beschreibung">{t("Was ist passiert?")}</label>
          <textarea id="problem-beschreibung" rows={3} value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)}
            className="w-full rounded-md border border-border bg-card p-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
          <label className="flex items-center gap-2 text-sm text-foreground dark:text-slate-200">
            <input type="checkbox" checked={mitProtokoll} onChange={(e) => setMitProtokoll(e.target.checked)} />
            {t("Protokollzeilen anhängen")}
          </label>
          {fehler && <p role="alert" className="text-xs text-fehler dark:text-rose-300">{t("Protokoll nicht lesbar:")} {fehler}</p>}
          <details>
            <summary className="cursor-pointer text-sm text-erfolg dark:text-emerald-400">{t("Diese Meldung geht an GitHub")}</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs dark:bg-slate-800" data-testid="problem-vorschau">{issueText(daten)}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <a className={buttonVariants({ variant: "default", size: "sm" })} href={issueUrl(daten)} target="_blank" rel="noopener noreferrer" data-testid="problem-github">
              {t("Auf GitHub öffnen")}
            </a>
            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setOffen(false)}>{t("Abbrechen")}</button>
          </div>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">{t("Für GitHub brauchen Sie ein kostenloses Konto. Ohne Konto: Feedback per E-Mail im Fuß der App.")}</p>
        </div>
      )}
    </div>
  );
}
