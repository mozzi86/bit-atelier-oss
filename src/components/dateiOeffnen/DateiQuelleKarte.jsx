// DateiQuelleKarte.jsx — "Verknüpfte Projektdatei" in Settings › Daten & Sicherung (plan 93-10): the
// .bitproj this state was opened from (double-click + "Aktualisieren"/"Laden und ersetzen") and the button
// "Zurück in die Datei speichern". Before writing, the adapter compares the file with its state at import
// (local edition: size + SHA-256 on the server; desktop client: size + modification time); when it changed
// or is gone, a dialog asks: overwrite / save as copy / cancel. Writing is atomic (.tmp + rename).
//
// The path is shown here only — it is stored outside the project data (server: daten/dateiquelle.json,
// desktop client: localStorage) and never enters an export.
//
// In:  props {huelle: boolean} — true inside the desktop client (adapter from src/client/dateiHuelle.js,
//      loaded lazily), else the local server's adapter. Out: the card, or null when nothing is linked.
//      data-testids datei-quelle, datei-quelle-pfad, datei-zurueckschreiben, datei-quelle-status,
//      datei-quelle-fehler, datei-konflikt-dialog, datei-konflikt-ueberschreiben/-kopie/-abbrechen.

import React from "react";
import { FileUp } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { SERVERLOS } from "@core/lib/umgebung";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@core/components/ui/dialog";
import { quelleAdapter } from "@/lib/dateiOeffnenServer.js";

/**
 * @param {{huelle?: boolean}} props
 * @returns {React.ReactElement|null}
 */
export default function DateiQuelleKarte({ huelle = false }) {
  const { t } = useI18n();
  const [adapter, setAdapter] = React.useState(/** @type {any} */ (null));
  const [quelle, setQuelle] = React.useState(/** @type {any} */ (null));
  const [status, setStatus] = React.useState("");
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [konflikt, setKonflikt] = React.useState(/** @type {"geaendert"|"fehlt"|null} */ (null));
  const [laeuft, setLaeuft] = React.useState(false);

  React.useEffect(() => {
    let aktiv = true;
    (async () => {
      // SERVERLOS is a build-time literal: the office/cloud builds drop the shell chunk entirely.
      const a = SERVERLOS && huelle ? (await import("@/client/dateiHuelle.js")).quelleAdapterHuelle() : quelleAdapter();
      const q = await a.quelle();
      if (aktiv) { setAdapter(a); setQuelle(q); }
    })().catch((e) => { if (aktiv) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { aktiv = false; };
  }, [huelle]);

  if (!quelle) return fehler ? <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="datei-quelle-fehler">{fehler}</p> : null;

  /** @param {"ueberschreiben"|"kopie"} [entscheidung] */
  const speichern = async (entscheidung) => {
    setKonflikt(null);
    setStatus("");
    setFehler(null);
    setLaeuft(true);
    try {
      const r = await adapter.zurueck(entscheidung);
      if (r?.konflikt) {
        setKonflikt(r.konflikt);
        return;
      }
      setStatus(r.kopie ? `${t("Als Kopie gespeichert:")} ${r.pfad}` : t("In die Datei gespeichert."));
      setQuelle(await adapter.quelle());
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };

  const datum = (iso) => (iso ? new Date(iso).toLocaleString("de-DE") : "—");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900 space-y-2" data-testid="datei-quelle">
      <p className="font-medium text-slate-800 dark:text-slate-100">{t("Verknüpfte Projektdatei")}</p>
      <code className="block min-w-0 break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800" data-testid="datei-quelle-pfad">{quelle.pfad}</code>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("Geöffnet am")} {datum(quelle.importiertAm)} · {t("Zuletzt gespeichert")} {datum(quelle.gespeichertAm)}
        {!quelle.vorhanden && <> · <span className="text-amber-700 dark:text-amber-300">{t("Datei fehlt")}</span></>}
      </p>
      <button type="button" onClick={() => speichern()} disabled={laeuft} data-testid="datei-zurueckschreiben"
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">
        <FileUp className="h-4 w-4" aria-hidden="true" /> {t("Zurück in die Datei speichern")}
      </button>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("Der Pfad bleibt auf diesem Rechner und geht nie in eine Projektdatei.")}</p>
      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 break-all" data-testid="datei-quelle-status">{status}</p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="datei-quelle-fehler">{fehler}</p>}

      <Dialog open={!!konflikt} onOpenChange={(o) => { if (!o) setKonflikt(null); }}>
        <DialogContent showCloseButton={false} className="max-w-md p-5" data-testid="datei-konflikt-dialog">
          <DialogTitle className="text-base mb-1">{t("Datei geändert")}</DialogTitle>
          <DialogDescription className="mb-4">
            {konflikt === "fehlt" ? t("Die Datei ist nicht mehr vorhanden.") : t("Die Datei wurde seit dem Öffnen geändert.")}
          </DialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setKonflikt(null)} data-testid="datei-konflikt-abbrechen"
              className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              {t("Abbrechen")}
            </button>
            <button type="button" onClick={() => speichern("kopie")} data-testid="datei-konflikt-kopie"
              className="px-3 py-2 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950">
              {t("Als Kopie speichern")}
            </button>
            <button type="button" onClick={() => speichern("ueberschreiben")} data-testid="datei-konflikt-ueberschreiben"
              className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
              {t("Überschreiben")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
