// ModellEmpfehlung.jsx — which local model fits this computer, the catalog, loading a model into Ollama and
// the speed test (plan 93-12 B/C). Part of LokaleKi.jsx.
//
//   Hardware + recommendation  GET /api/ki/hardware + GET /api/ki/katalog → empfehlen() (pure rules in
//                              @core/lib/modellEmpfehlung): top pick + 2 alternatives, each with reasons.
//   Laden                      POST /api/ki/ollama/pull, progress by polling GET (1 s), DELETE cancels. The
//                              server checks free disk space first and, when done, enters the model into
//                              the Ollama connection (VERBINDUNGEN_EVENT tells LlmConnections to reload).
//   Verwenden                  POST /api/ki/lokal/verwenden for an installed model.
//   Geschwindigkeit messen     POST /api/ki/benchmark (closing the request = cancel), result stored.
//   Katalog aktualisieren      POST /api/ki/katalog/aktualisieren — contacts GitHub, not an AI service.
//
// Sizes are approximations from the catalog ([ASSUMED]); the real size appears in the progress bar
// (Ollama's `total`) and, once installed, from /api/tags.
//
// In:  { ollamaLaeuft, benchmark }. Out: the block; data-testids ki-hardware, ki-empfehlung-top,
//      ki-empfehlung-alt, ki-pull, ki-pull-abbrechen, ki-pull-fehler, ki-pull-fertig, ki-benchmark,
//      ki-benchmark-abbrechen, ki-katalog, ki-katalog-aktualisieren, ki-katalog-meldung, ki-modell-<tag>.
import React from "react";
import { Gauge, Download, Loader2, Sparkles, Square, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { empfehlen, benchmarkUrteil } from "@core/lib/modellEmpfehlung";
import { kiJson, melden, gbText, einsetzen, VERBINDUNGEN_EVENT } from "@/lib/kiLokalApi";

/**
 * @param {{ ollamaLaeuft: boolean, benchmark: any }} props
 * @returns {React.ReactElement}
 */
export default function ModellEmpfehlung({ ollamaLaeuft, benchmark }) {
  const { t, lang } = useI18n();
  const [hw, setHw] = React.useState(/** @type {any} */ (null));
  const [katalog, setKatalog] = React.useState(/** @type {any} */ (null));
  const [pull, setPull] = React.useState(/** @type {any} */ (null));
  const [meldung, setMeldung] = React.useState("");
  const [fehler, setFehler] = React.useState("");
  const [katalogMeldung, setKatalogMeldung] = React.useState("");
  const [aktualisiere, setAktualisiere] = React.useState(false);
  const [messung, setMessung] = React.useState(/** @type {{ modell: string, seit: number, ctrl: AbortController }|null} */ (null));
  const [messErgebnis, setMessErgebnis] = React.useState(/** @type {any} */ (benchmark));
  const [, setTick] = React.useState(0);

  const laden = React.useCallback(async () => {
    try {
      const [h, k] = await Promise.all([kiJson("/ki/hardware"), kiJson("/ki/katalog")]);
      setHw(h);
      setKatalog(k);
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    }
  }, []);

  React.useEffect(() => { laden(); }, [laden, ollamaLaeuft]);
  React.useEffect(() => { setMessErgebnis(benchmark); }, [benchmark]);
  React.useEffect(() => { kiJson("/ki/ollama/pull").then(setPull).catch(() => {}); }, []);

  const pullLaeuft = Boolean(pull && !pull.fertig && !pull.fehler && !pull.abgebrochen);
  React.useEffect(() => {
    if (!pullLaeuft) return undefined;
    const id = setInterval(async () => {
      try {
        const s = await kiJson("/ki/ollama/pull");
        setPull(s);
        if (s?.fertig) {
          setMeldung(t("{modell} ist geladen und als Modell der Ollama-Verbindung eingetragen.").replace("{modell}", s.modell));
          melden(VERBINDUNGEN_EVENT);
          laden();
        }
      } catch { /* next tick */ }
    }, 1000);
    return () => clearInterval(id);
  }, [pullLaeuft, laden, t]);

  // Elapsed seconds while the benchmark runs.
  React.useEffect(() => {
    if (!messung) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [messung]);

  const empfehlung = React.useMemo(() => (hw && katalog ? empfehlen(hw, katalog.modelle || []) : null), [hw, katalog]);
  const gb = (/** @type {number|null|undefined} */ n) => gbText(n, lang);
  const grund = (/** @type {{text: string, werte?: Record<string, string|number>}} */ g) => einsetzen(t(g.text), g.werte, lang);

  const ladenStarten = async (/** @type {string} */ modell) => {
    setFehler(""); setMeldung("");
    try {
      setPull(await kiJson("/ki/ollama/pull", { method: "POST", body: { modell } }));
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    }
  };
  const ladenAbbrechen = async () => { try { setPull(await kiJson("/ki/ollama/pull", { method: "DELETE" })); } catch { /* shown by next poll */ } };

  const verwenden = async (/** @type {string} */ modell) => {
    setFehler(""); setMeldung("");
    try {
      const r = await kiJson("/ki/lokal/verwenden", { method: "POST", body: { modell } });
      setMeldung((r.aktiv
        ? t("{modell} ist jetzt das Modell der aktiven Ollama-Verbindung.")
        : t("{modell} ist als Modell der Ollama-Verbindung eingetragen — zum Benutzen dort „Aktivieren“ klicken.")).replace("{modell}", modell));
      melden(VERBINDUNGEN_EVENT);
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    }
  };

  const messen = async (/** @type {string} */ modell) => {
    const ctrl = new AbortController();
    setMessung({ modell, seit: Date.now(), ctrl });
    setFehler("");
    try {
      const r = await kiJson("/ki/benchmark", { method: "POST", body: { modell }, signal: ctrl.signal });
      if (r.ok) setMessErgebnis({ modell, ...r.ergebnis });
      else setFehler(r.fehler);
    } catch (e) {
      if (/** @type {any} */ (e)?.name !== "AbortError") setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setMessung(null);
    }
  };

  const katalogAktualisieren = async () => {
    setAktualisiere(true); setKatalogMeldung("");
    try {
      const r = await kiJson("/ki/katalog/aktualisieren", { method: "POST" });
      if (!r.ok) setKatalogMeldung(r.fehler);
      else setKatalogMeldung((r.neu ? t("Neuer Katalog vom {stand} übernommen.") : t("Der Katalog ist aktuell (Stand {stand}).")).replace("{stand}", r.stand));
      if (r.ok && r.neu) laden();
    } catch (e) {
      setKatalogMeldung(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setAktualisiere(false);
    }
  };

  /** Buttons for one model. @param {any} e catalog entry */
  const aktionen = (e) => {
    if (!ollamaLaeuft) return <span className="text-[11px] text-slate-400">{t("Ollama starten, um Modelle zu laden")}</span>;
    if (e.installiert) {
      return (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => verwenden(e.tag)}>{t("Verwenden")}</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={Boolean(messung)} onClick={() => messen(e.tag)}><Gauge className="h-3.5 w-3.5" />{t("Geschwindigkeit messen")}</Button>
        </span>
      );
    }
    return (
      <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={pullLaeuft} onClick={() => ladenStarten(e.tag)} data-testid={`ki-laden-${e.tag}`}>
        <Download className="h-3.5 w-3.5" /> {t("Laden (≈ {gb} GB)").replace("{gb}", gb(e.groesseQ4Gb))}
      </Button>
    );
  };

  /** One recommendation card. @param {any} v Vorschlag @param {boolean} top */
  const karte = (v, top) => (
    <div key={v.eintrag.tag} data-testid={top ? "ki-empfehlung-top" : "ki-empfehlung-alt"}
      className={`rounded-lg border p-3 text-sm ${top ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/30" : "border-slate-200 dark:border-slate-700"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {top && <Sparkles className="mr-1 inline h-4 w-4 text-emerald-600" aria-hidden="true" />}
          {v.eintrag.tag}
          <span className="ml-2 text-xs font-normal text-slate-500">
            ≈ {gb(v.eintrag.groesseInstalliertGb ?? v.eintrag.groesseQ4Gb)} GB{v.eintrag.groesseGeschaetzt && !v.eintrag.groesseInstalliertGb ? ` (${t("geschätzt")})` : ""}
            {v.eintrag.installiert ? ` · ${t("installiert")}` : ""}
          </span>
        </span>
        {aktionen(v.eintrag)}
      </div>
      <ul className="mt-1 list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
        {v.gruende.map((g, i) => <li key={i}>{grund(g)}</li>)}
      </ul>
    </div>
  );

  const sekunden = messung ? Math.round((Date.now() - messung.seit) / 1000) : 0;
  const urteil = messErgebnis ? benchmarkUrteil(messErgebnis.tokenProSekunde) : null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Passendes Modell für diesen Rechner")}</h4>
      {hw && (
        <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="ki-hardware">
          {hw.gpu?.name ? `${hw.gpu.name} · ` : ""}
          {hw.gpu?.art === "nvidia" ? t("{gb} GB Grafikspeicher").replace("{gb}", gb(hw.gpu.vramGb)) : hw.gpu?.art === "apple" ? t("gemeinsamer Speicher") : t("Grafikspeicher unbekannt")}
          {" · "}{t("{gb} GB Arbeitsspeicher").replace("{gb}", gb(hw.ramGesamtGb))}
          {hw.cpu?.kerne ? ` · ${t("{n} Prozessorkerne").replace("{n}", String(hw.cpu.kerne))}` : ""}
          {hw.plattenFreiGb != null ? ` · ${t("{gb} GB frei im Modellordner").replace("{gb}", gb(hw.plattenFreiGb))}` : ""}
        </p>
      )}
      {empfehlung?.hinweise.map((h, i) => <p key={i} className="text-xs text-amber-800 dark:text-amber-300">{grund(h)}</p>)}
      {empfehlung?.top && (
        <div className="grid gap-2">
          {karte(empfehlung.top, true)}
          {empfehlung.alternativen.map((v) => karte(v, false))}
        </div>
      )}
      {!hw && !fehler && <p className="text-xs text-slate-400"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{t("Prüfe den Rechner …")}</p>}

      {pull && (
        <div data-testid="ki-pull" className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {t("{modell}: {prozent} %").replace("{modell}", pull.modell).replace("{prozent}", String(pull.prozent))}
              {pull.gesamtBytes > 0 && ` — ${t("{fertig} von {gesamt} GB").replace("{fertig}", gb(pull.fertigBytes / 1e9)).replace("{gesamt}", gb(pull.gesamtBytes / 1e9))}`}
            </span>
            {pullLaeuft && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={ladenAbbrechen} data-testid="ki-pull-abbrechen"><Square className="h-3 w-3" />{t("Abbrechen")}</Button>}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={pull.prozent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pull.prozent}%` }} />
          </div>
          <p className="mt-1 text-slate-500">{pull.abgebrochen ? t("Abgebrochen — erneutes Laden setzt fort.") : pull.status}</p>
          {pull.fehler && <p className="mt-1 text-rose-700 dark:text-rose-300" data-testid="ki-pull-fehler">{pull.fehler}</p>}
          {pull.fertig && <p className="mt-1 flex items-center gap-1 text-emerald-700 dark:text-emerald-300" data-testid="ki-pull-fertig"><CheckCircle2 className="h-3.5 w-3.5" />{t("Fertig geladen.")}</p>}
        </div>
      )}

      {(messung || messErgebnis) && (
        <div data-testid="ki-benchmark" className="rounded-lg border border-slate-200 p-3 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200">
          {messung ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("Messe {modell} … {s} s (der erste Aufruf lädt das Modell, das kann dauern)").replace("{modell}", messung.modell).replace("{s}", String(sekunden))}
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => messung.ctrl.abort()} data-testid="ki-benchmark-abbrechen">{t("Abbrechen")}</Button>
            </span>
          ) : (
            <span>
              {t("{modell}: ≈ {tok} Token/s — {urteil} · erste Antwort nach {s} s (inkl. Laden)")
                .replace("{modell}", messErgebnis.modell)
                .replace("{tok}", gb(messErgebnis.tokenProSekunde))
                .replace("{urteil}", t(urteil || ""))
                .replace("{s}", gb(messErgebnis.ersteAntwortMs / 1000))}
            </span>
          )}
        </div>
      )}

      {meldung && <p className="text-xs text-emerald-700 dark:text-emerald-300">{meldung}</p>}
      {fehler && <p className="text-xs text-rose-700 dark:text-rose-300">{fehler}</p>}

      {katalog && (
        <details className="text-xs" data-testid="ki-katalog">
          <summary className="cursor-pointer select-none text-slate-600 dark:text-slate-300">
            {t("Alle Modelle im Katalog ({n}) — Stand {stand}").replace("{n}", String(katalog.modelle?.length ?? 0)).replace("{stand}", katalog.stand)}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={katalogAktualisieren} disabled={aktualisiere} data-testid="ki-katalog-aktualisieren">
              {aktualisiere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("Katalog aktualisieren")}
            </Button>
            <span className="text-[11px] text-slate-500">{t("fragt GitHub (raw.githubusercontent.com) nach einer neueren Liste — keine KI-Anfrage, nur auf Klick")}</span>
          </div>
          {katalogMeldung && <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300" data-testid="ki-katalog-meldung">{katalogMeldung}</p>}
          {katalog.hinweis && <p className="mt-1 text-[11px] text-slate-500">{katalog.hinweis}</p>}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500">
                <tr><th className="py-1 pr-2">{t("Modell")}</th><th className="pr-2">{t("Größe")}</th><th className="pr-2">{t("Kann")}</th><th className="pr-2">{t("Deutsch")}</th><th className="pr-2">{t("Lizenz")}</th><th /></tr>
              </thead>
              <tbody>
                {(katalog.modelle || []).map((/** @type {any} */ e) => (
                  <tr key={e.tag} data-testid={`ki-modell-${e.tag}`} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="py-1 pr-2 font-medium text-slate-700 dark:text-slate-200">{e.tag}{e.moe ? " (MoE)" : ""}{e.installiert ? ` · ${t("installiert")}` : ""}</td>
                    <td className="pr-2">≈ {gb(e.groesseInstalliertGb ?? e.groesseQ4Gb)} GB{e.groesseGeschaetzt && !e.groesseInstalliertGb ? "*" : ""}</td>
                    <td className="pr-2">{(e.faehigkeiten || []).map((f) => t(f === "tools" ? "Werkzeuge" : f === "vision" ? "Bilder" : "Denkmodus")).join(", ") || "—"}</td>
                    <td className="pr-2" title={e.deutschHinweis}>{e.deutsch ? "●".repeat(e.deutsch) : "—"}</td>
                    <td className="pr-2">{e.lizenz || "—"}</td>
                    <td className="py-1">{aktionen(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-500">{t("* geschätzt aus der Parameterzahl")}</p>
          </div>
        </details>
      )}
    </div>
  );
}
