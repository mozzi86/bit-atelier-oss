// 92-07: the real data folder in Settings › "Daten & Sicherung" (local express build only). The installer puts
// projects under %LOCALAPPDATA%\BIT-Atelier\daten (or ~/BIT-Atelier/daten), and BIT_DATA_DIR can move them —
// a folder an office backup often does not cover (lever Nr. 155). This row names the folder the server really
// writes to (GET /api/system/datenordner, from server/datenPfad.js) and opens it on request
// (POST /api/system/datenordner/oeffnen; the server opens only that folder and checks the Origin).
//
// In:  nothing. Out: the row or null; data-testids daten-ordner, daten-ordner-pfad, daten-ordner-oeffnen,
//      daten-ordner-status, daten-ordner-fehler.
import React from "react";
import { FolderOpen } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";

/**
 * @returns {React.ReactElement|null}
 */
export default function DatenOrdner() {
  const { t } = useI18n();
  const [info, setInfo] = React.useState(/** @type {{ordner: string, dateien: {db: string, personal: string}}|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    if (DATENQUELLE !== "express") return undefined;
    let aktiv = true;
    fetch("/api/system/datenordner", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (aktiv) setInfo(j);
      })
      .catch((e) => { if (aktiv) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { aktiv = false; };
  }, []);

  if (DATENQUELLE !== "express") return null;

  const oeffnen = async () => {
    setStatus(""); setFehler(null);
    try {
      const r = await fetch("/api/system/datenordner/oeffnen", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setStatus(t("Ordner wird im Dateimanager geöffnet."));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-1" data-testid="daten-ordner">
      <p className="font-medium text-slate-800 dark:text-slate-100">{t("Datenordner")}</p>
      {info ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-900" data-testid="daten-ordner-pfad">{info.ordner}</code>
          <button type="button" onClick={oeffnen} data-testid="daten-ordner-oeffnen"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> {t("Ordner öffnen")}
          </button>
        </div>
      ) : !fehler && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Wird geladen …")}</p>}
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("Hier liegen alle Projekte dieser Installation. Nehmen Sie den Ordner in Ihre Datensicherung auf – Ordner unter AppData erfasst eine Büro-Sicherung oft nicht.")}
      </p>
      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="daten-ordner-status">{status}</p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="daten-ordner-fehler">{t("Datenordner nicht abrufbar:")} {fehler}</p>}
    </div>
  );
}
