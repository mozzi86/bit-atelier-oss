// 86-05b: the "Vorschläge" tab of the Wohnungs-Werkstatt — computes the proposals of the
// current footprint in a Worker (useVorschlaege), sorts them by a chosen figure (native
// <select>, order from the lib — stable, id tie-break), renders a card per proposal and
// applies one on "Übernehmen" through the pure uebernehmeVorschlag(): the parent persists the
// returned configuration (ONE write path, werkstatt_layer). Layout-bound inputs are dropped
// with a hint that counts what was dropped; a stored proposal whose footprint/algorithm
// changed is shown as stale, never recomputed under the same id.
//
// In:  footprintM (m), cfg (workshop configuration incl. defaults), storeys, storeyHeight (m),
//      aktiv (tab open), onUebernehmen(neueCfg). Out: rendered panel.
// 86-05c: comparison selection (up to VERGLEICH_MAX ids in click order → VorschlagVergleich)
// and "ähnliche erzeugen" per card (hook aehnliche → neighbours appended, chip "ähnlich zu").
// 75-10: transparent variant evaluation (variantenBewertung + @core compositeScore): sort option
// "Bewertung (gewichtet)", weight sliders (werkstatt_layer.bewertungsGewichte via
// onGewichteChange), rank badge per card, knock-outs marked, "why rank 1" breakdown. The figures
// are computed once per list; a slider only re-ranks.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "@core/lib/i18n";
import { KENNZAHLEN, sortiereVorschlaege, uebernehmeVorschlag, vorschlagVeraltet, VORSCHLAEGE_MAX } from "@designer/lib/bebauungsvorschlaege";
import { useVorschlaege } from "@designer/lib/useVorschlaege";
import VorschlagKarte, { typologieLabel } from "./VorschlagKarte";
import VorschlagVergleich from "./VorschlagVergleich";
import { istRechteck } from "@designer/lib/formGeometrie";
import { compositeScore } from "@core/lib/compositeScore";
import { DIMENSIONEN, SCORE_DIMENSIONEN, BUERO_STANDARD, bewertungsWerte, wirksameGewichte } from "@designer/lib/variantenBewertung";

/** 86-05c: proposals compared side by side at most (plan: 2–4; four columns fit 1280 px with scroll). */
export const VERGLEICH_MAX = 4;

/**
 * @param {{footprintM: Array<{x:number, z:number}>|null|undefined, cfg: any, storeys: number, storeyHeight: number, aktiv: boolean, onUebernehmen: (cfg: any) => void, onGewichteChange?: (g: Record<string, number>) => void}} props
 *   onGewichteChange (75-10): the ONE write path of the evaluation weights; without it the sliders are read-only
 */
export default function VorschlaegePanel({ footprintM, cfg, storeys, storeyHeight, aktiv, onUebernehmen, onGewichteChange }) {
  const { t } = useI18n();
  const [sortKey, setSortKey] = useState("we");
  const [hinweis, setHinweis] = useState(/** @type {string|null} */ (null));
  const [auswahl, setAuswahl] = useState(/** @type {string[]} */ ([]));
  const [vergleichOffen, setVergleichOffen] = useState(false);
  const nG = Math.max(1, Math.round(Number(storeys) || 1));
  // Base = the workshop inputs that are NOT layout-bound (the lib drops the rest anyway).
  const basis = useMemo(() => ({
    storeys: nG, einheiten: cfg.einheiten, raumzonen: true, regeln: cfg.regeln, nordwinkel: cfg.nordwinkel,
    okf_m: (nG - 1) * (Number(storeyHeight) || 3),
  }), [nG, cfg.einheiten, cfg.regeln, cfg.nordwinkel, storeyHeight]);
  const { liste, laedt, fehler, dauer_ms, aehnliche, aehnlichLaedt, aehnlichErgebnis } = useVorschlaege({ footprintM, basis, aktiv });
  // 75-10: values once per list, ranking per weight change (no figure is recomputed by a slider).
  const werte = useMemo(() => liste.map((k) => ({ id: String(k.id), ...bewertungsWerte(k, { footprintM, storeys: nG, storeyHeight_m: Number(storeyHeight) || 3 }) })), [liste, footprintM, nG, storeyHeight]);
  const gewichte = useMemo(() => wirksameGewichte(cfg.bewertungsGewichte), [cfg.bewertungsGewichte]);
  const bewertung = useMemo(() => compositeScore(werte, SCORE_DIMENSIONEN, gewichte), [werte, gewichte]);
  const bewertungJeId = useMemo(() => new Map(bewertung.ergebnisse.map((e, i) => [e.id, { ...e, werte: werte[i]?.werte || {} }])), [bewertung, werte]);
  const sortiert = useMemo(() => (sortKey === "bewertung"
    ? bewertung.reihenfolge.map((id) => liste.find((v) => String(v.id) === id)).filter(Boolean)
    : sortiereVorschlaege(liste, sortKey)), [liste, sortKey, bewertung]);
  const erster = bewertung.reihenfolge.length ? bewertungJeId.get(bewertung.reihenfolge[0]) : null;
  const ersterKarte = erster && erster.rang === 1 ? liste.find((v) => String(v.id) === erster.id) : null;
  const setzeGewicht = (key, wert) => {
    if (typeof onGewichteChange !== "function") return;
    const neu = { ...(cfg.bewertungsGewichte || {}) };
    if (Number(wert) === BUERO_STANDARD[key]) delete neu[key]; else neu[key] = Number(wert);
    onGewichteChange(neu);
  };
  const de = (v, d = 2) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: d }));
  const gewaehlt = cfg.gewaehlterVorschlag && typeof cfg.gewaehlterVorschlag === "object" ? cfg.gewaehlterVorschlag : null;
  const stale = vorschlagVeraltet(gewaehlt, footprintM);
  // Selection survives only while its cards exist (a new list = new ids → selection empties).
  const ids = useMemo(() => new Set(liste.map((v) => v.id)), [liste]);
  useEffect(() => { setAuswahl((a) => (a.every((id) => ids.has(id)) ? a : a.filter((id) => ids.has(id)))); }, [ids]);
  const verglichen = useMemo(() => auswahl.map((id) => liste.find((v) => v.id === id)).filter(Boolean), [auswahl, liste]);
  const rechteck = useMemo(() => istRechteck(Array.isArray(footprintM) ? footprintM : []), [footprintM]);
  const aehnlichText = aehnlichErgebnis === null ? null
    : aehnlichErgebnis.neu > 0 ? `${aehnlichErgebnis.neu} ${t("ähnliche Vorschläge hinzugefügt")}`
      : liste.length >= VORSCHLAEGE_MAX ? t("Liste voll — keine weiteren Vorschläge")
        : rechteck ? t("keine neuen ähnlichen Vorschläge (Rechteck: ein Riegel, alle Erschließungen vorhanden)")
          : t("keine neuen ähnlichen Vorschläge (alle schon in der Liste)");

  const waehlen = (v, an) => setAuswahl((a) => (an ? (a.includes(v.id) || a.length >= VERGLEICH_MAX ? a : [...a, v.id]) : a.filter((id) => id !== v.id)));

  const uebernehmen = (v) => {
    const { cfg: neu, verworfen } = uebernehmeVorschlag(cfg, v);
    onUebernehmen(neu);
    const teile = [
      [verworfen.gesperrteGrenzen, t("Sperren")], [verworfen.anordnung, t("Anordnungen")], [verworfen.grenzenPositionen, t("Grenzpositionen")],
      [verworfen.tuerAufschlaege, t("Türaufschläge")], [verworfen.stufeJeWe, t("Stufen-Schalter")], [verworfen.raumGrenzen, t("Innenwand-Versätze")], [verworfen.geschosseJeRiegel, t("Geschosszahlen je Haus")],
    ].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
    setHinweis(`${t("Vorschlag übernommen")}: ${typologieLabel(v.typologie)} — ${teile.length ? `${t("verworfen")}: ${teile.join(", ")}` : t("keine layout-gebundenen Eingaben verworfen")}`);
  };

  return (
    <div className="space-y-3" data-testid="vs-panel" data-anzahl={liste.length} data-laedt={laedt ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-slate-600">
          {t("Sortieren nach")}
          <select className="h-7 rounded border border-slate-300 bg-white px-1 text-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value)} data-testid="vs-sortierung">
            <option value="bewertung">{t("Bewertung (gewichtet)")}</option>
            {KENNZAHLEN.map((k) => <option key={k.key} value={k.key}>{t(k.label)}</option>)}
          </select>
        </label>
        <span className="text-slate-500" data-testid="vs-status">
          {laedt ? t("Berechnung läuft …") : fehler ? `${t("Vorschläge konnten nicht berechnet werden")}: ${fehler}` : `${liste.length} ${t("Vorschläge")}${dauer_ms !== null ? ` · ${dauer_ms} ms` : ""}`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setVergleichOffen(true)} disabled={verglichen.length < 2} data-testid="vs-vergleichen" data-anzahl={verglichen.length}>
            {t("Vergleichen")} ({verglichen.length}/{VERGLEICH_MAX})
          </button>
          {auswahl.length > 0 && (
            <button type="button" className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 text-slate-600 hover:bg-slate-50" onClick={() => { setAuswahl([]); setVergleichOffen(false); }} data-testid="vs-auswahl-leeren">
              {t("Auswahl leeren")}
            </button>
          )}
          {aehnlichLaedt && <span className="text-slate-500" data-testid="vs-aehnlich-laedt">{t("Ähnliche werden berechnet …")}</span>}
        </span>
      </div>
      {/* 75-10: weights (office standard = equal for the four decided dimensions, grey energy 0
          [ASSUMED values]) and the breakdown of rank 1. Native range inputs. */}
      {liste.length > 0 && (
        <details className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs" data-testid="vs-bewertung" open={sortKey === "bewertung"}>
          <summary className="cursor-pointer font-semibold text-slate-700">{t("Bewertung — Gewichte")}</summary>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="vs-gewichte">
            {DIMENSIONEN.map((d) => (
              <label key={d.key} className="flex items-center gap-2 text-slate-600" title={d.quelle}>
                <span className="w-44 shrink-0">{t(d.label)}{d.annahme ? " [ASSUMED]" : ""}</span>
                <input type="range" min={0} max={3} step={1} value={gewichte[d.key]} disabled={typeof onGewichteChange !== "function"}
                  onChange={(e) => setzeGewicht(d.key, e.target.value)} className="flex-1 accent-teal-700" data-testid="vs-gewicht" data-key={d.key} />
                <span className="w-6 text-right tabular-nums">{gewichte[d.key]}</span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <button type="button" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={typeof onGewichteChange !== "function" || !Object.keys(cfg.bewertungsGewichte || {}).length}
              onClick={() => onGewichteChange?.({})} data-testid="vs-gewichte-standard">{t("Bürostandard")}</button>
            <span>{t("Nur harte Regeln schließen aus (Planungsfehler, Rettungsweg > 35 m); keine weichen Kriterien.")}</span>
          </div>
          {ersterKarte && erster && (
            <div className="mt-2 rounded border border-teal-200 bg-white px-2 py-1.5" data-testid="vs-warum" data-vorschlag={erster.id} data-score={erster.score ?? ""}>
              <div className="font-semibold text-slate-700">{t("Warum Rang 1")}: {typologieLabel(ersterKarte.typologie)} · {de(erster.score, 3)}</div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                {DIMENSIONEN.filter((d) => gewichte[d.key] > 0).sort((a, b) => (erster.beitraege[b.key] || 0) - (erster.beitraege[a.key] || 0)).map((d) => (
                  <li key={d.key} data-key={d.key} data-beitrag={erster.beitraege[d.key]}>
                    {t(d.label)}: {de(erster.werte?.[d.key], 3)} {d.einheit} → {de(erster.normiert[d.key] * 100, 0)} % × {t("Gewicht")} {de(bewertung.gewichte[d.key] * 100, 0)} % = {de(erster.beitraege[d.key], 3)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bewertung.ergebnisse.some((e) => e.ko.length) && (
            <div className="mt-1 text-[11px] text-red-700" data-testid="vs-ko-anzahl">{bewertung.ergebnisse.filter((e) => e.ko.length).length} {t("Vorschläge ausgeschlossen (K.-o.)")}</div>
          )}
        </details>
      )}
      {aehnlichText && !aehnlichLaedt && (
        <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" role="status" data-testid="vs-aehnlich-hinweis" data-neu={aehnlichErgebnis?.neu ?? ""}>{aehnlichText}</div>
      )}
      {vergleichOffen && verglichen.length >= 2 && (
        <VorschlagVergleich vorschlaege={verglichen} footprintM={footprintM} onSchliessen={() => setVergleichOffen(false)} onEntfernen={(id) => setAuswahl((a) => a.filter((x) => x !== id))} />
      )}
      {gewaehlt && stale.veraltet && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="vs-veraltet" data-grund={stale.grund}>
          {t("Vorschlag veraltet")} ({stale.grund === "algorithmus" ? t("Algorithmus geändert") : t("Grundfläche geändert")}): {typologieLabel(gewaehlt.typologie)} — {t("Übernehmen Sie einen Vorschlag aus der aktuellen Liste.")}
        </div>
      )}
      {hinweis && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status" data-testid="vs-hinweis">{hinweis}</div>
      )}
      {!laedt && !fehler && liste.length === 0 && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{t("Keine Vorschläge für diese Grundfläche")}</div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="vs-liste">
        {sortiert.map((v) => (
          <VorschlagKarte key={v.id} vorschlag={v} footprintM={footprintM} sortKey={sortKey}
            gewaehlt={!!gewaehlt && gewaehlt.id === v.id} veraltet={!!gewaehlt && gewaehlt.id === v.id && stale.veraltet}
            onUebernehmen={uebernehmen}
            ausgewaehlt={auswahl.includes(v.id)} auswahlGesperrt={auswahl.length >= VERGLEICH_MAX} onAuswahl={waehlen}
            onAehnliche={aehnliche} aehnlichLaedt={aehnlichLaedt} bewertung={bewertungJeId.get(String(v.id)) || null} />
        ))}
      </div>
    </div>
  );
}
