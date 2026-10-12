// HarnessDienst.jsx — Settings › KI › "Atelier-KI-Harness" (plan 93-12): the Python harness as part of
// the program. Shows the state of the child process managed by server/harnessProzess.js and offers
// Starten / Stoppen / Neu starten, "Einrichten" (creates harness/.venv with the pinned packages — only on
// this click, takes minutes, needs internet once), the switch "mit BIT-Atelier starten" (default off)
// and the last log lines. While the state is "startet" or "richtet-ein" the card polls every 1.5 s.
//
// In:  nothing (local express build only; returns null elsewhere). Out: the card; data-testids
//      harness-dienst, harness-zustand, harness-starten, harness-stoppen, harness-neustart,
//      harness-einrichten, harness-autostart, harness-log, harness-fehler.
import React from "react";
import { Link } from "react-router-dom";
import { Bot, Loader2, Play, Square, RotateCw, Wrench } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { kiJson, melden, EINSTELLUNGEN_EVENT } from "@/lib/kiLokalApi";

/** Label and colour per state (labels are i18n keys). */
const ZUSTAENDE = {
  "nicht-eingerichtet": { text: "nicht eingerichtet", farbe: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  gestoppt: { text: "gestoppt", farbe: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  startet: { text: "startet …", farbe: "bg-amber-100 text-amber-800" },
  laeuft: { text: "läuft", farbe: "bg-emerald-100 text-emerald-800" },
  extern: { text: "läuft (außerhalb von BIT-Atelier gestartet)", farbe: "bg-emerald-100 text-emerald-800" },
  "richtet-ein": { text: "wird eingerichtet …", farbe: "bg-amber-100 text-amber-800" },
  fehler: { text: "Fehler", farbe: "bg-rose-100 text-rose-800" },
};

/** Setup steps (i18n keys). */
const SCHRITTE = { "python-suchen": "suche Python", venv: "lege harness/.venv an", pakete: "installiere Pakete (einige Minuten)" };

/**
 * @returns {React.ReactElement|null}
 */
export default function HarnessDienst() {
  const { t } = useI18n();
  const [s, setS] = React.useState(/** @type {any} */ (null));
  const [arbeitet, setArbeitet] = React.useState("");
  const [fehler, setFehler] = React.useState("");

  const lesen = React.useCallback(async () => {
    try { setS(await kiJson("/ki/harness")); } catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); }
  }, []);

  React.useEffect(() => { if (DATENQUELLE === "express") lesen(); }, [lesen]);

  const beschaeftigt = s?.zustand === "startet" || s?.zustand === "richtet-ein";
  React.useEffect(() => {
    if (!beschaeftigt) return undefined;
    const id = setInterval(lesen, 1500);
    return () => clearInterval(id);
  }, [beschaeftigt, lesen]);

  if (DATENQUELLE !== "express") return null;

  const aktion = async (/** @type {string} */ was) => {
    setArbeitet(was); setFehler("");
    try { setS(await kiJson(`/ki/harness/${was}`, { method: "POST" })); } catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); } finally { setArbeitet(""); }
  };

  const autostart = async (/** @type {boolean} */ an) => {
    try {
      const neu = await kiJson("/llm/einstellungen", { method: "PUT", body: { harness_autostart: an } });
      setS((alt) => ({ ...alt, autostart: neu.harness_autostart }));
      melden(EINSTELLUNGEN_EVENT, neu);
    } catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); }
  };

  const z = s ? ZUSTAENDE[/** @type {keyof typeof ZUSTAENDE} */ (s.zustand)] || ZUSTAENDE.fehler : null;
  const knopf = (/** @type {string} */ was, /** @type {React.ReactNode} */ icon, /** @type {string} */ text, /** @type {boolean} */ aus) => (
    <Button size="sm" variant="outline" className="gap-1.5" disabled={aus || Boolean(arbeitet)} onClick={() => aktion(was)} data-testid={`harness-${was === "start" ? "starten" : was === "stop" ? "stoppen" : was}`}>
      {arbeitet === was ? <Loader2 className="h-4 w-4 animate-spin" /> : icon} {t(text)}
    </Button>
  );

  return (
    <section data-testid="harness-dienst" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
          <Bot className="h-4 w-4 text-emerald-600" aria-hidden="true" /> {t("Atelier-KI-Harness (lokal)")}
        </h3>
        {z && <span data-testid="harness-zustand" className={`rounded-full px-2 py-0.5 text-xs font-medium ${z.farbe}`}>{t(z.text)}{s.zustand === "richtet-ein" && s.schritt ? ` — ${t(SCHRITTE[/** @type {keyof typeof SCHRITTE} */ (s.schritt)] || s.schritt)}` : ""}</span>}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("Der Harness ist das KI-Arbeitssystem hinter dem KI-Tool (Projekt-Gedächtnis, Werkzeuge, IFC). BIT-Atelier startet ihn auf Wunsch selbst und gibt ihm die aktive lokale Verbindung mit — bei „Nur lokale KI“ arbeitet er ausschließlich mit dem lokalen Modell.")}
      </p>
      {s?.zustand === "nicht-eingerichtet" && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t("Noch nicht eingerichtet. „Einrichten“ legt harness/.venv an und installiert die festgelegten Python-Pakete (braucht Python 3.11–3.13 und einmal Internet, einige Minuten). Es wird nichts anderes installiert.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {s && !s.eingerichtet && knopf("einrichten", <Wrench className="h-4 w-4" />, "Einrichten", s.zustand === "richtet-ein")}
        {s?.eingerichtet && knopf("start", <Play className="h-4 w-4" />, "Starten", ["laeuft", "extern", "startet", "richtet-ein"].includes(s.zustand))}
        {s?.eingerichtet && knopf("stop", <Square className="h-4 w-4" />, "Stoppen", s.zustand !== "laeuft" && s.zustand !== "startet")}
        {s?.eingerichtet && knopf("neustart", <RotateCw className="h-4 w-4" />, "Neu starten", s.zustand !== "laeuft")}
        {s?.zustand === "fehler" && s.eingerichtet && knopf("einrichten", <Wrench className="h-4 w-4" />, "Erneut einrichten", false)}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
        <input type="checkbox" className="h-4 w-4 accent-emerald-600" data-testid="harness-autostart" checked={Boolean(s?.autostart)} disabled={!s} onChange={(e) => autostart(e.target.checked)} />
        {t("mit BIT-Atelier starten")}
      </label>
      {(s?.fehler || fehler) && <p className="text-xs text-rose-700 dark:text-rose-300" data-testid="harness-fehler">{s?.fehler || fehler}</p>}
      {s?.log?.length > 0 && (
        <details open={s.zustand === "fehler" || s.zustand === "richtet-ein"}>
          <summary className="cursor-pointer select-none text-xs text-slate-500">{t("Letzte Zeilen")}</summary>
          <pre data-testid="harness-log" className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-[11px] leading-snug text-slate-100">{s.log.slice(-20).join("\n")}</pre>
        </details>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("Dienst")}: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">{s?.url || "http://127.0.0.1:8765"}</code>
        {" · "}{t("Konfiguration")}: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">harness/config.yaml</code>
        {" · "}<Link to="/KiTool" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">{t("Zum KI-Tool")}</Link>
      </p>
    </section>
  );
}
