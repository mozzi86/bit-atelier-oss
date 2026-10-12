// 92-04: "Updates" card in Settings › System & Info of the local app (express build only). Shows the
// installed and the newest version, when the server last asked GitHub, a "Jetzt prüfen" button, the switch
// for the automatic check, and "Fassung festhalten bis …" — an office in a running tender keeps its version
// until the submission date (no banner, the server refuses the install until then).
//
// Server: GET /api/update (?frisch=1 = ask GitHub now), PUT /api/update/einstellungen
// ({automatisch?, festhaltenBis?}; the server checks the Origin). The settings live server-side in
// <app>/daten/update-einstellungen.json, so they hold for every browser of this installation.
// BIT_KEIN_UPDATECHECK on the server → only a line saying so.
//
// In:  nothing. Out: the card; data-testids upd-einstellungen, upd-aktuell, upd-neueste, upd-letzte-pruefung,
//      upd-jetzt-pruefen, upd-automatisch, upd-festhalten-datum, upd-festhalten-speichern,
//      upd-festhalten-aufheben, upd-einst-status, upd-einst-fehler.
import React from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { APP_VERSION } from "@core/lib/projektInfo";

/**
 * ISO time → local date + time text, or null.
 * @param {string|null|undefined} iso
 * @returns {string|null}
 */
function zeitText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * @returns {React.ReactElement|null}
 */
export default function UpdateEinstellungen() {
  const { t } = useI18n();
  const [info, setInfo] = React.useState(/** @type {any} */ (null));
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [status, setStatus] = React.useState("");
  const [datum, setDatum] = React.useState("");

  const laden = React.useCallback(async (frisch) => {
    setLaeuft(true); setFehler(null);
    try {
      const r = await fetch(`/api/update${frisch ? "?frisch=1" : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setInfo(j);
      setDatum(j?.einstellungen?.festhaltenBis || "");
      if (j?.fehler) setFehler(j.fehler);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  }, []);

  React.useEffect(() => { if (DATENQUELLE === "express") laden(false); }, [laden]);

  /** @param {{automatisch?: boolean, festhaltenBis?: string|null}} werte */
  const speichern = async (werte) => {
    setFehler(null); setStatus("");
    try {
      const r = await fetch("/api/update/einstellungen", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(werte) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setStatus(t("Gespeichert."));
      await laden(false);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  if (DATENQUELLE !== "express") return null;
  const einst = info?.einstellungen || { automatisch: true, festhaltenBis: null };
  const knopf = "inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-800/60" data-testid="upd-einstellungen">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Updates")}
      </h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium text-slate-600 dark:text-slate-300">{t("Installierte Fassung")}</dt>
        <dd data-testid="upd-aktuell"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-900">{info?.aktuell || APP_VERSION}</code></dd>
        {!info?.deaktiviert && (
          <>
            <dt className="font-medium text-slate-600 dark:text-slate-300">{t("Neueste Fassung")}</dt>
            <dd data-testid="upd-neueste">{info?.neueste ? <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-900">{info.neueste}</code> : "—"}
              {info?.verfuegbar && <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">{t("Update verfügbar")}</span>}
            </dd>
            <dt className="font-medium text-slate-600 dark:text-slate-300">{t("Letzte Prüfung")}</dt>
            <dd data-testid="upd-letzte-pruefung">{zeitText(info?.letztePruefung) || t("noch nicht")}</dd>
          </>
        )}
      </dl>

      {info?.deaktiviert ? (
        <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="upd-deaktiviert">
          {t("Die Update-Prüfung ist auf diesem Rechner abgeschaltet (Umgebungsvariable BIT_KEIN_UPDATECHECK).")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={knopf} onClick={() => laden(true)} disabled={laeuft} data-testid="upd-jetzt-pruefen">
              <RefreshCw className={`h-3.5 w-3.5 ${laeuft ? "animate-spin" : ""}`} aria-hidden="true" /> {t("Jetzt prüfen")}
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={einst.automatisch !== false} onChange={(e) => speichern({ automatisch: e.target.checked })} data-testid="upd-automatisch" />
              {t("Automatisch nach Updates suchen")}
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-slate-700 dark:text-slate-200">
              <span className="block text-xs text-slate-600 dark:text-slate-300">{t("Fassung festhalten bis (einschließlich)")}</span>
              <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} data-testid="upd-festhalten-datum"
                className="mt-0.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" />
            </label>
            <button type="button" className={knopf} onClick={() => speichern({ festhaltenBis: datum || null })} data-testid="upd-festhalten-speichern">{t("Speichern")}</button>
            {einst.festhaltenBis && (
              <button type="button" className={knopf} onClick={() => { setDatum(""); speichern({ festhaltenBis: null }); }} data-testid="upd-festhalten-aufheben">{t("Aufheben")}</button>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t("Bis zu diesem Tag zeigt die App keinen Update-Hinweis und installiert keine neue Fassung – z. B. bis zur Submission einer laufenden Vergabe.")}
          </p>
          {info?.sperre && !info?.festgehalten && <p className="text-xs text-amber-800 dark:text-amber-200">{info.sperre}</p>}
          {info?.festgehalten && <p className="text-xs text-amber-800 dark:text-amber-200" data-testid="upd-festgehalten">{info.sperre}</p>}
        </>
      )}
      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="upd-einst-status">{status}</p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="upd-einst-fehler">{fehler}</p>}
    </div>
  );
}
