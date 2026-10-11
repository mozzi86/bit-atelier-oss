// 92-01: update banner of the downloaded (local) BIT-Atelier. Asks the local server (/api/update) once after
// start and every 6 h whether a newer release exists; "Jetzt aktualisieren" installs it without any download
// link: the server fetches, verifies (SHA-256) and swaps the files, restarts, and this component waits until
// /api/status reports the new version, then reloads the page. "Später" hides the banner for that version.
//
// Only in the express build (DATENQUELLE "express" = local app); the cloud app updates through its host and the
// serverless build has no server. A blocked installation (developer checkout, release without checksum) shows
// the reason instead of the button.
//
// In:  nothing. Out: the banner; data-testids upd-banner (data-phase, data-neueste), upd-installieren,
//      upd-spaeter, upd-fortschritt (data-prozent), upd-fehler.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { Download, RefreshCw, X } from "lucide-react";

const PRUEF_INTERVALL_MS = 6 * 60 * 60 * 1000;
const SPAETER_KEY = "bit.update.spaeter";

const leseSpaeter = () => { try { return localStorage.getItem(SPAETER_KEY) || ""; } catch { return ""; } };
const schreibeSpaeter = (v) => { try { localStorage.setItem(SPAETER_KEY, v); } catch { /* private mode: banner just comes back */ } };

export default function UpdateHinweis() {
  const { t } = useI18n();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  const [phase, setPhase] = useState("ruhe"); // ruhe | laedt | prueft | entpackt | neustart | fehler
  const [fortschritt, setFortschritt] = useState({ geladen: 0, gesamt: 0 });
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [spaeter, setSpaeter] = useState(leseSpaeter);
  const timer = useRef(/** @type {any} */ (null));

  const pruefen = useCallback(async () => {
    try {
      const r = await fetch("/api/update");
      if (r.ok) setInfo(await r.json());
    } catch { /* offline or old server without the route: no banner */ }
  }, []);

  useEffect(() => {
    if (DATENQUELLE !== "express") return undefined;
    pruefen();
    const id = setInterval(pruefen, PRUEF_INTERVALL_MS);
    return () => { clearInterval(id); clearTimeout(timer.current); };
  }, [pruefen]);

  if (DATENQUELLE !== "express" || !info?.verfuegbar || (phase === "ruhe" && spaeter === info.neueste)) return null;

  const warteAufNeustart = async (ziel) => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => { timer.current = setTimeout(r, 2000); });
      try {
        const s = await (await fetch("/api/status", { cache: "no-store" })).json();
        if (s?.version === ziel) { window.location.reload(); return; }
      } catch { /* server is restarting */ }
    }
    setPhase("fehler");
    setFehler(t("Die App ist nach dem Update nicht wieder gestartet. Bitte start-windows.cmd bzw. start.sh von Hand starten; Details in daten/update.log."));
  };

  const installieren = async () => {
    setFehler(null); setPhase("laedt");
    try {
      const r = await fetch("/api/update/installieren", { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      for (;;) {
        await new Promise((res) => { timer.current = setTimeout(res, 700); });
        let s;
        try { s = await (await fetch("/api/update/fortschritt", { cache: "no-store" })).json(); } catch { s = { phase: "neustart" }; }
        if (s.phase === "fehler") throw new Error(s.fehler || t("Update fehlgeschlagen."));
        setPhase(s.phase === "bereit" ? "laedt" : s.phase);
        setFortschritt({ geladen: s.geladen || 0, gesamt: s.gesamt || 0 });
        if (s.phase === "neustart") { await warteAufNeustart(info.neueste); return; }
      }
    } catch (e) {
      setPhase("fehler");
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const prozent = fortschritt.gesamt ? Math.min(100, Math.round(fortschritt.geladen / fortschritt.gesamt * 100)) : 0;
  const text = {
    laedt: `${t("Update wird geladen")} … ${prozent} %`,
    prueft: t("Prüfsumme wird geprüft …"),
    entpackt: t("Update wird vorbereitet …"),
    neustart: t("App startet neu – die Seite lädt gleich von selbst neu …"),
  }[phase];

  return (
    <div className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
      role="status" data-testid="upd-banner" data-phase={phase} data-neueste={info.neueste}>
      <div className="flex flex-wrap items-center gap-2">
        <Download className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          <b>{t("Update verfügbar")}: {info.neueste}</b> <span className="text-emerald-800/80 dark:text-emerald-200/80">({t("installiert")} {info.aktuell})</span>
          {text && <span className="ml-2" data-testid="upd-fortschritt" data-prozent={prozent}>{text}</span>}
        </span>
        {phase === "ruhe" || phase === "fehler" ? (
          info.installierbar ? (
            <>
              <Button size="sm" onClick={installieren} data-testid="upd-installieren" className="bg-emerald-600 hover:bg-emerald-700">
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("Jetzt aktualisieren")}
              </Button>
              <button type="button" className="text-emerald-800 hover:underline dark:text-emerald-200" onClick={() => { schreibeSpaeter(info.neueste); setSpaeter(info.neueste); }} data-testid="upd-spaeter">
                {t("Später")}
              </button>
            </>
          ) : (
            <span className="text-xs text-amber-800 dark:text-amber-200">{info.sperre}</span>
          )
        ) : null}
        {phase === "ruhe" && (
          <button type="button" aria-label={t("Schließen")} className="text-emerald-700 hover:text-emerald-900" onClick={() => { schreibeSpaeter(info.neueste); setSpaeter(info.neueste); }}><X className="h-4 w-4" /></button>
        )}
      </div>
      {phase === "laedt" && <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-emerald-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${prozent}%` }} /></div>}
      {fehler && <div className="mt-1 text-xs text-rose-700 dark:text-rose-300" data-testid="upd-fehler">{fehler}</div>}
    </div>
  );
}
