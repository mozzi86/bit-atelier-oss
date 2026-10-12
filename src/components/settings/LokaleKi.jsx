// LokaleKi.jsx — Settings › KI › "Lokale KI" (plan 93-12): the switch "Nur lokale KI", detection of
// Ollama / LM Studio on this computer, and the setup path when neither runs.
//
// The setup path never installs software: "Ollama herunterladen" opens the official download page in
// the browser; afterwards the card polls GET /api/ki/lokal/erkennen until Ollama answers (every 5 s,
// at most 15 min). Model choice, download and benchmark live in ModellEmpfehlung.jsx below this card.
//
// In:  nothing (local express build only; returns null elsewhere). Out: the card; data-testids
//      lokale-ki, nur-lokal-schalter, ki-erkennung-ollama, ki-erkennung-lmstudio, ki-ollama-download,
//      ki-ollama-warten, ki-adressen, ki-ollama-url, ki-lmstudio-url, ki-adressen-speichern, ki-lokal-fehler.
import React from "react";
import { Cpu, Download, RefreshCw, ShieldCheck, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { kiJson, melden, EINSTELLUNGEN_EVENT } from "@/lib/kiLokalApi";
import NurLokalPlakette from "@/components/ai/NurLokalPlakette.jsx";
import ModellEmpfehlung from "@/components/settings/ModellEmpfehlung.jsx";

/** Official Ollama download page — opened in the browser, never fetched by the app. */
const OLLAMA_DOWNLOAD = "https://ollama.com/download";
/** Poll interval while waiting for Ollama after the download click, ms. */
const WARTE_MS = 5000;
/** Give up waiting after this long, ms. [ASSUMED] 15 min covers download + install. */
const WARTE_MAX_MS = 15 * 60 * 1000;

/**
 * @returns {React.ReactElement|null}
 */
export default function LokaleKi() {
  const { t } = useI18n();
  const [einst, setEinst] = React.useState(/** @type {any} */ (null));
  const [erkannt, setErkannt] = React.useState(/** @type {any} */ (null));
  const [pruefe, setPruefe] = React.useState(false);
  const [wartenSeit, setWartenSeit] = React.useState(/** @type {number|null} */ (null));
  const [fehler, setFehler] = React.useState("");
  const [adressen, setAdressen] = React.useState({ ollama_url: "", lmstudio_url: "" });

  const erkennen = React.useCallback(async () => {
    setPruefe(true);
    try {
      const e = await kiJson("/ki/lokal/erkennen");
      setErkannt(e);
      return e;
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
      return null;
    } finally {
      setPruefe(false);
    }
  }, []);

  React.useEffect(() => {
    if (DATENQUELLE !== "express") return;
    kiJson("/llm/einstellungen").then((e) => {
      setEinst(e);
      setAdressen({ ollama_url: e.ollama_url, lmstudio_url: e.lmstudio_url });
    }).catch((e) => setFehler(String(e?.message || e)));
    erkennen();
  }, [erkennen]);

  // Waiting for Ollama after "herunterladen": poll until it answers or 15 min passed.
  React.useEffect(() => {
    if (wartenSeit == null) return undefined;
    const id = setInterval(async () => {
      const e = await erkennen();
      if (e?.ollama?.ok || Date.now() - wartenSeit > WARTE_MAX_MS) setWartenSeit(null);
    }, WARTE_MS);
    return () => clearInterval(id);
  }, [wartenSeit, erkennen]);

  if (DATENQUELLE !== "express") return null;

  const speichern = async (/** @type {Record<string, unknown>} */ patch) => {
    setFehler("");
    const alt = einst;
    // Optimistic: the switch moves at once; the server's answer (or the old value on error) follows.
    setEinst((e) => ({ ...(e || {}), ...patch }));
    try {
      const neu = await kiJson("/llm/einstellungen", { method: "PUT", body: patch });
      setEinst(neu);
      melden(EINSTELLUNGEN_EVENT, neu);
      return neu;
    } catch (e) {
      setEinst(alt);
      setFehler(String(/** @type {any} */ (e)?.message || e));
      return null;
    }
  };

  const nurLokal = Boolean(einst?.nur_lokal);
  const keiner = erkannt && !erkannt.ollama?.ok && !erkannt.lmstudio?.ok;

  /** @param {{ ok: boolean, fehler?: string }|undefined} s @param {string} gutText */
  const zeile = (s, gutText) => (
    <span className={`flex items-start gap-1.5 ${s?.ok ? "text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}>
      {s?.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{s?.ok ? gutText : t("läuft nicht")}</span>
    </span>
  );

  return (
    <section data-testid="lokale-ki" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <Cpu className="h-4 w-4 text-emerald-600" aria-hidden="true" /> {t("Lokale KI")}
          <NurLokalPlakette aktiv={nurLokal} />
        </h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            role="switch"
            aria-checked={nurLokal}
            data-testid="nur-lokal-schalter"
            className="h-4 w-4 accent-emerald-600"
            checked={nurLokal}
            disabled={!einst}
            onChange={(e) => speichern({ nur_lokal: e.target.checked })}
          />
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> {t("Nur lokale KI")}
        </label>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("Eingeschaltet weist der Server jede KI-Anfrage an einen Dienst außerhalb dieses Rechners ab — auch die des KI-Tools. Projektdaten verlassen den Rechner dann nicht über die KI.")}
      </p>

      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60 sm:grid-cols-2">
        <div data-testid="ki-erkennung-ollama">
          <p className="font-medium text-slate-700 dark:text-slate-200">Ollama</p>
          {erkannt ? zeile(erkannt.ollama, t("läuft (Version {v})").replace("{v}", erkannt.ollama?.version || "?")) : <span className="text-slate-400">…</span>}
        </div>
        <div data-testid="ki-erkennung-lmstudio">
          <p className="font-medium text-slate-700 dark:text-slate-200">LM Studio</p>
          {erkannt ? zeile(erkannt.lmstudio, t("läuft ({n} Modelle geladen)").replace("{n}", String(erkannt.lmstudio?.modelle?.length ?? 0))) : <span className="text-slate-400">…</span>}
        </div>
        <div className="sm:col-span-2">
          <Button variant="outline" size="sm" onClick={erkennen} disabled={pruefe} className="gap-2">
            {pruefe ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t("Erneut prüfen")}
          </Button>
        </div>
      </div>

      {keiner && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-slate-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-slate-200">
          <p className="font-medium">{t("Auf diesem Rechner läuft noch keine lokale KI.")}</p>
          <p className="text-xs">
            {t("Empfehlung: Ollama — ein kostenloses Programm, das KI-Modelle auf Ihrem Rechner ausführt. BIT-Atelier installiert nichts selbst: Der Knopf öffnet die offizielle Download-Seite im Browser. Nach der Installation erkennt diese Seite Ollama von allein; danach können Sie hier ein passendes Modell laden.")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={OLLAMA_DOWNLOAD}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="ki-ollama-download"
              onClick={() => setWartenSeit(Date.now())}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" /> {t("Ollama herunterladen")}
            </a>
            {wartenSeit != null && (
              <span data-testid="ki-ollama-warten" className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Warte auf Ollama … (prüft alle 5 s)")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">{t("Alternative: LM Studio (lmstudio.ai) — dort unter „Developer“ den Server starten.")}</p>
        </div>
      )}

      <details className="text-xs text-slate-600 dark:text-slate-300" data-testid="ki-adressen">
        <summary className="cursor-pointer select-none">{t("Adressen der lokalen Server ändern")}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span>Ollama</span>
            <input data-testid="ki-ollama-url" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" value={adressen.ollama_url} onChange={(e) => setAdressen((a) => ({ ...a, ollama_url: e.target.value }))} />
          </label>
          <label className="block">
            <span>LM Studio</span>
            <input data-testid="ki-lmstudio-url" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" value={adressen.lmstudio_url} onChange={(e) => setAdressen((a) => ({ ...a, lmstudio_url: e.target.value }))} />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{t("Nur Adressen auf diesem Rechner (127.0.0.1, localhost) sind erlaubt.")}</p>
        <Button size="sm" variant="outline" className="mt-2" data-testid="ki-adressen-speichern" onClick={async () => { if (await speichern(adressen)) erkennen(); }}>{t("Speichern")}</Button>
      </details>

      {fehler && <p className="text-xs text-rose-700 dark:text-rose-300" data-testid="ki-lokal-fehler">{fehler}</p>}

      <ModellEmpfehlung ollamaLaeuft={Boolean(erkannt?.ollama?.ok)} benchmark={einst?.benchmark || null} />
    </section>
  );
}
