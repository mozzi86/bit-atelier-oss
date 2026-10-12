// 93-06 (lever 161): the automatic local backup in Settings › "Daten & Sicherung" (local express build only).
// Shows when the server last backed up the data folder by itself, where the zips are, how many it keeps,
// and offers "Jetzt sichern". Reads GET /api/system/sicherung, triggers POST /api/system/sicherung
// (server/sicherung.js via server/systemRouter.js — loopback only, POST only with the app's Origin).
//
// In:  nothing. Out: the card or null; data-testids auto-sicherung, auto-sicherung-letzte,
//      auto-sicherung-ordner, auto-sicherung-jetzt, auto-sicherung-status, auto-sicherung-fehler.
import React from "react";
import { Archive } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";

/**
 * @typedef {{
 *   aktiv: boolean, ordner: string, intervallStunden: number,
 *   aufbewahrung: {taeglich: number, woechentlich: number},
 *   letzte: {name: string, zeit: string, bytes: number}|null, anzahl: number,
 *   naechste: string|null, letzterFehler: string|null, laeuft: boolean,
 * }} Status
 */

/** @param {number} bytes @returns {string} "1,2 MB" / "840 KB" */
function groesse(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** @param {string} iso @param {string} lang @returns {string} local date and time */
function zeitText(iso, lang) {
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "de-DE", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * @returns {React.ReactElement|null}
 */
export default function AutoSicherung() {
  const { t, lang } = useI18n();
  const [status, setStatus] = React.useState(/** @type {Status|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [meldung, setMeldung] = React.useState("");
  const [laeuft, setLaeuft] = React.useState(false);

  const laden = React.useCallback(async () => {
    const r = await fetch("/api/system/sicherung", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return /** @type {Status} */ (j);
  }, []);

  React.useEffect(() => {
    if (DATENQUELLE !== "express") return undefined;
    let aktiv = true;
    laden().then((s) => { if (aktiv) setStatus(s); }).catch((e) => { if (aktiv) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { aktiv = false; };
  }, [laden]);

  if (DATENQUELLE !== "express") return null;

  const jetztSichern = async () => {
    setLaeuft(true); setMeldung(""); setFehler(null);
    try {
      const r = await fetch("/api/system/sicherung", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMeldung(t("Sicherung angelegt: {name}").replace("{name}", String(j.name || "")));
      setStatus(await laden());
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="space-y-1" data-testid="auto-sicherung">
      <p className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
        <Archive className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Automatische Sicherung")}
      </p>
      {status ? (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="auto-sicherung-letzte">
            {t("Letzte automatische Sicherung")}:{" "}
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {status.letzte ? `${zeitText(status.letzte.zeit, lang)} (${groesse(status.letzte.bytes)})` : t("noch keine")}
            </span>
            {!status.aktiv && <> · {t("ausgeschaltet (BIT_SICHERUNG_AUS=1)")}</>}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t("Alle {n} Stunden, aufbewahrt werden {t} tägliche und {w} wöchentliche Sicherungen.")
              .replace("{n}", String(status.intervallStunden)).replace("{t}", String(status.aufbewahrung.taeglich)).replace("{w}", String(status.aufbewahrung.woechentlich))}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-900" data-testid="auto-sicherung-ordner">{status.ordner}</code>
            <button type="button" onClick={jetztSichern} disabled={laeuft} data-testid="auto-sicherung-jetzt"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              {laeuft ? t("Sichert …") : t("Jetzt sichern")}
            </button>
          </div>
          {status.letzterFehler && (
            <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{t("Letzte Sicherung fehlgeschlagen:")} {status.letzterFehler}</p>
          )}
        </>
      ) : !fehler && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Wird geladen …")}</p>}
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("Die Sicherungen liegen auf diesem Rechner. Gegen Diebstahl, Brand oder einen defekten Datenträger hilft nur eine Kopie woanders: den Ordner in Ihre Büro-Sicherung aufnehmen oder regelmäßig auf ein anderes Laufwerk kopieren.")}
      </p>
      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="auto-sicherung-status">{meldung}</p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="auto-sicherung-fehler">{t("Sicherung nicht abrufbar:")} {fehler}</p>}
    </div>
  );
}
