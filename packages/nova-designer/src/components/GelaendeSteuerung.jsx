// Narrow control strip under the 3D terrain view (phase 103): vertical exaggeration (103-02),
// cut-out 300 m / 1 km, and the water level study (103-03) with its results — flooded plot area
// and "what floods first". Pure UI: TerrainView3D owns the state and the three.js scene.
//
// In:  values + callbacks (see the JSDoc of the component), flood figures from gelaendeStudie.
// Out: calls onUeberhoehung(n), onAusschnitt(m), onWasserAn(bool), onPegel(m a.s.l.).
import React from "react";
import { useI18n } from "@core/lib/i18n";
import { hoeheText, UEBERHOEHUNG_MIN, UEBERHOEHUNG_MAX } from "@designer/lib/gelaendeStudie";

/** Level with two decimals and German comma, e.g. "312,40". @param {number} p m a.s.l. */
const pegelText = (p) => Number(p).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param {{
 *   ueberhoehung: number, onUeberhoehung: (n: number) => void,
 *   ausschnitt: number, onAusschnitt: (m: number) => void,
 *   wasserAn: boolean, onWasserAn: (an: boolean) => void,
 *   pegel: number, onPegel: (p: number) => void,
 *   bereich: { min: number, max: number, schritt: number },
 *   marken: Array<{ id: string, name: string, pegelNHN: number, quelle: string, lage: number, testId: string }>,
 *   flaeche: { m2: number, anteil: number } | null,
 *   reihenfolge: Array<{ art: "grundstueck"|"baukoerper"|"eg", id: string, name: string, pegelNHN: number }>,
 * }} props ueberhoehung unitless 1…10; ausschnitt metres; pegel / bereich / marken in m a.s.l.; flaeche m² + share 0…1 (null = no plot)
 */
export default function GelaendeSteuerung({
  ueberhoehung, onUeberhoehung, ausschnitt, onAusschnitt, wasserAn, onWasserAn, pegel, onPegel, bereich, marken, flaeche, reihenfolge,
}) {
  const { t } = useI18n();
  const knopf = (aktiv) => `rounded-md border px-2 py-1 transition-colors ${aktiv ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"}`;
  const ueText = `${t("Überhöhung {n}×").replace("{n}", String(ueberhoehung))}${ueberhoehung === 1 ? ` ${t("(echt)")}` : ""}`;
  const eintragText = (e) => {
    if (e.art === "grundstueck") return t("Grundstück wird nass");
    if (e.art === "baukoerper") return t("{name}: Wasser am Baukörper").replace("{name}", e.name);
    return t("{name}: EG-Fußboden nass").replace("{name}", e.name);
  };
  return (
    <div className="space-y-2 border-b border-border px-4 py-2 text-xs" data-testid="gelaende-steuerung">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2" title={t("Höhen werden für die Darstellung gestreckt — 1× ist maßstäblich")}>
          <span className="font-semibold text-foreground" data-testid="gelaende-ueberhoehung-text">{ueText}</span>
          <input type="range" min={UEBERHOEHUNG_MIN} max={UEBERHOEHUNG_MAX} step={1} value={ueberhoehung}
            aria-label={t("Überhöhung")} aria-valuetext={ueText} data-testid="gelaende-ueberhoehung"
            onChange={(e) => onUeberhoehung(Number(e.target.value))} className="w-28 accent-primary" />
        </label>
        <span className="flex items-center gap-1" role="group" aria-label={t("Ausschnitt")}>
          <span className="text-muted-foreground">{t("Ausschnitt")}</span>
          {[300, 1000].map((m) => (
            <button key={m} type="button" className={knopf(ausschnitt === m)} aria-pressed={ausschnitt === m}
              data-testid={`gelaende-ausschnitt-${m}`} onClick={() => onAusschnitt(m)}>
              {m === 1000 ? "1 km" : `${m} m`}
            </button>
          ))}
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={wasserAn} data-testid="gelaende-wasser" onChange={(e) => onWasserAn(e.target.checked)} />
          <span className="font-semibold text-foreground">{t("Wasserpegel")}</span>
        </label>
        {wasserAn && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="relative inline-block w-56 pt-4">
              {marken.map((m) => (
                <button key={m.id} type="button" data-testid={m.testId}
                  title={`${m.name}: ${pegelText(m.pegelNHN)} ${t("m ü. NHN")}${m.quelle ? ` · ${m.quelle}` : ""}`}
                  onClick={() => onPegel(m.pegelNHN)}
                  className="absolute top-0 -translate-x-1/2 rounded border border-hinweis-rand bg-hinweis-flaeche px-1 text-[10px] leading-tight text-hinweis"
                  style={{ left: `${m.lage * 100}%` }}>
                  {m.name}
                </button>
              ))}
              <input type="range" min={bereich.min} max={bereich.max} step={bereich.schritt} value={pegel}
                aria-label={t("Wasserpegel")} aria-valuetext={`${pegelText(pegel)} ${t("m ü. NHN")}`} data-testid="gelaende-pegel"
                onChange={(e) => onPegel(Number(e.target.value))} className="w-full accent-primary" />
            </span>
            <input type="number" min={bereich.min} max={bereich.max} step={bereich.schritt} value={Math.round(pegel * 100) / 100}
              aria-label={t("Wasserpegel in m ü. NHN")} data-testid="gelaende-pegel-zahl"
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onPegel(v); }}
              className="w-24 rounded-md border border-border bg-background px-2 py-0.5 tabular-nums text-foreground" />
            <span className="text-muted-foreground">{t("m ü. NHN (näherungsweise)")}</span>
          </span>
        )}
      </div>

      {wasserAn && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {flaeche ? (
              <span data-testid="gelaende-flut-flaeche" data-m2={Math.round(flaeche.m2)} data-anteil={Math.round(flaeche.anteil * 100)}
                className={flaeche.anteil > 0 ? "font-semibold text-hinweis" : "text-muted-foreground"}>
                {t("Grundstück überflutet:")} ≈ {Math.round(flaeche.m2).toLocaleString("de-DE")} m² ({Math.round(flaeche.anteil * 100)} %)
              </span>
            ) : (
              <span data-testid="gelaende-flut-flaeche" className="text-muted-foreground">{t("Kein gezeichnetes Grundstück — keine Flächenangabe")}</span>
            )}
          </div>
          {reihenfolge.length > 0 && (
            <ol className="flex flex-wrap gap-x-4 gap-y-1" data-testid="gelaende-flut-reihenfolge" aria-label={t("Was überflutet zuerst")}>
              <li className="text-muted-foreground">{t("Was überflutet zuerst:")}</li>
              {reihenfolge.map((e, k) => {
                const nass = pegel > e.pegelNHN;
                return (
                  <li key={`${e.art}-${e.id}`} data-art={e.art} data-pegel={e.pegelNHN.toFixed(2)} data-nass={nass ? "ja" : "nein"}
                    className={nass ? "text-hinweis" : "text-foreground"}>
                    {k + 1}. {eintragText(e)} {t("ab")} {hoeheText(e.pegelNHN)} {t("m ü. NHN")}
                    {nass && <span className="font-semibold"> · {(pegel - e.pegelNHN).toLocaleString("de-DE", { maximumFractionDigits: 2 })} {t("m Wasser")}</span>}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-muted-foreground" data-testid="gelaende-flut-hinweis">
            {t("Studie nach dem Badewannen-Modell: Alles unter dem Pegel gilt als nass — ohne Fließwege, Deiche, Abfluss oder Rückstau. Kein Hochwassernachweis.")}{" "}
            {t("Höhen aus einem 90-m-Oberflächenmodell (Bäume und Dächer können mitgemessen sein), Bezug EGM2008 statt DHHN2016 — Abweichung einige Dezimeter. EG-Fußboden = höchster Geländepunkt unter dem Baukörper + 0,30 m (Annahme).")}
          </p>
        </div>
      )}
    </div>
  );
}
