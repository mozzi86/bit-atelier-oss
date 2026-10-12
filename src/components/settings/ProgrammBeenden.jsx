// ProgrammBeenden.jsx — card "Programm" in Settings › System & Info (plan 93-11, local edition only).
// Since 93-11 the installed app runs its server without a console window, and the server keeps running
// when the last app window closes (the .bitproj double-click and AI clients find it). This card says so
// and offers "Programm beenden": after a confirmation it calls POST /api/programm/beenden (server writes
// its databases, then stops), shows that the app has ended and tries to close the window.
//
// In:  nothing. Out: the card or null (not the express data source).
//      data-testids programm-karte, programm-beenden, programm-status, programm-fehler.

import React from "react";
import { Power } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { DATENQUELLE } from "@core/lib/umgebung";

/**
 * @returns {React.ReactElement|null}
 */
export default function ProgrammBeenden() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [beendet, setBeendet] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  if (DATENQUELLE !== "express") return null;

  const beenden = async () => {
    setFehler(null);
    const ok = await bestaetige({
      titel: t("BIT-Atelier beenden?"),
      text: t("Der Server wird beendet, alle Fenster der App verlieren die Verbindung. Gespeicherte Daten bleiben erhalten."),
      bestaetigen: t("Programm beenden"),
      abbrechen: t("Abbrechen"),
    });
    if (!ok) return;
    try {
      const r = await fetch("/api/programm/beenden", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBeendet(true);
      // An app window opened from the command line may refuse; the message above then stays visible.
      setTimeout(() => { try { window.close(); } catch { /* not script-closable */ } }, 800);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900 space-y-2" data-testid="programm-karte">
      <h3 className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
        <Power className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Programm & Server")}
      </h3>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("BIT-Atelier läuft im Hintergrund weiter, wenn Sie das Fenster schließen – so öffnet ein Doppelklick auf eine Projektdatei sofort. Hier beenden Sie es ganz; Protokoll: daten/server.log.")}
      </p>
      <button type="button" onClick={beenden} disabled={beendet} data-testid="programm-beenden"
        className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40">
        <Power className="h-4 w-4" aria-hidden="true" /> {t("Programm beenden")}
      </button>
      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="programm-status">
        {beendet ? t("BIT-Atelier wurde beendet. Sie können dieses Fenster schließen.") : ""}
      </p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="programm-fehler">{fehler}</p>}
    </div>
  );
}
