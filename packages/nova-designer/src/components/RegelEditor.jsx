// <RegelEditor> — Phase 55-01: create / edit / reorder graphic override rules (first match wins) and load/save project
// presets. ONE form with @core/lib/plan/ansichtszustand.js (107-12 schema); no second override logic. Lazy-loaded from
// AnsichtOptionen so the studio chunk stays lean.
//
// In:  current rules, change callback, project presets, save-preset callback, translator.
// Out: compact editor block (token classes only). UI strings via t() / i18nTeile/ueberschreibung-55.js.

import React, { useState } from "react";
import {
  OPERATOREN, REGEL_FELDER, REGEL_FARBEN, STANDARD_VORLAGEN, MAX_REGELN,
  regelnKlonen, regelnUmordnen, regelNormalisieren, naechsteVorlageId,
} from "@core/lib/plan/ansichtszustand.js";
import { englischErgaenzen } from "@core/lib/i18n";
import { EN as EN_UEB_55 } from "@core/lib/i18nTeile/ueberschreibung-55.js";

englischErgaenzen(EN_UEB_55);

/** Fill/outline choices: token names plus "dunkler" for fill and empty = none. */
const FUELL_WAHL = ["", "dunkler", ...Object.keys(REGEL_FARBEN)];
const KONTUR_WAHL = ["", ...Object.keys(REGEL_FARBEN)];

/**
 * @param {object} p
 * @param {import("@core/lib/plan/ansichtszustand.js").Regel[]|null} p.regeln current rules (null = off / empty)
 * @param {(regeln: import("@core/lib/plan/ansichtszustand.js").Regel[]|null) => void} p.onChange
 * @param {Array<{id: string, name: string, regeln: any[]}>} [p.vorlagen] project presets from ansicht_layer
 * @param {(vorlage: {id: string, name: string, regeln: any[]}) => void} [p.onVorlageSpeichern]
 * @param {(s: string) => string} p.t translator
 */
export default function RegelEditor({ regeln, onChange, vorlagen = [], onVorlageSpeichern, t }) {
  const list = Array.isArray(regeln) ? regeln : [];
  const [vorlageName, setVorlageName] = useState("");
  const [presetWahl, setPresetWahl] = useState("");

  const setList = (next) => {
    const clean = next.map(regelNormalisieren).filter(Boolean).slice(0, MAX_REGELN);
    onChange(clean.length ? clean : null);
  };

  const patch = (i, teil) => {
    const next = regelnKlonen(list);
    next[i] = regelNormalisieren({ ...next[i], ...teil }) || next[i];
    setList(next);
  };

  const add = () => {
    if (list.length >= MAX_REGELN) return;
    setList([...regelnKlonen(list), { wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "dunkler" } }]);
  };

  const loadPreset = (id) => {
    if (!id) return;
    const built = STANDARD_VORLAGEN.find((v) => v.id === id);
    const proj = (vorlagen || []).find((v) => v.id === id);
    const src = built || proj;
    if (!src) return;
    setList(regelnKlonen(src.regeln));
    setPresetWahl("");
  };

  const savePreset = () => {
    if (!onVorlageSpeichern || !list.length) return;
    const name = vorlageName.trim() || t("Projekt-Vorlagen");
    onVorlageSpeichern({ id: naechsteVorlageId(vorlagen), name: name.slice(0, 80), regeln: regelnKlonen(list) });
    setVorlageName("");
  };

  return (
    <div className="mt-1 space-y-1 border-t border-border pt-1" data-testid="regel-editor">
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium text-foreground">{t("Regel-Editor")}</span>
        <span className="text-[10px] text-muted-foreground" title={t("Erste passende Regel gewinnt")}>{t("Erste passende Regel gewinnt")}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <label className="sr-only" htmlFor="regel-preset">{t("Vorlage laden")}</label>
        <select id="regel-preset" data-testid="regel-preset" value={presetWahl} aria-label={t("Vorlage laden")}
          className="max-w-[140px] rounded border border-border bg-card px-1 py-0.5 text-foreground"
          onChange={(e) => { setPresetWahl(e.target.value); loadPreset(e.target.value); }}>
          <option value="">{t("Vorlage laden")}</option>
          <optgroup label={t("Eingebaute Vorlagen")}>
            {STANDARD_VORLAGEN.map((v) => <option key={v.id} value={v.id}>{t(v.name)}</option>)}
          </optgroup>
          {vorlagen?.length > 0 && (
            <optgroup label={t("Projekt-Vorlagen")}>
              {vorlagen.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" data-testid="regel-add" onClick={add} disabled={list.length >= MAX_REGELN}
          className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-muted disabled:opacity-40">{t("Regel hinzufügen")}</button>
      </div>

      {list.map((r, i) => (
        <div key={i} className="rounded border border-border bg-card/50 p-1 space-y-0.5" data-testid="regel-zeile" data-regel-index={i}>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-muted-foreground">#{i + 1}</span>
            <div className="flex gap-0.5">
              <button type="button" aria-label={t("Nach oben")} data-testid="regel-up" disabled={i === 0}
                className="px-1 disabled:opacity-30" onClick={() => setList(regelnUmordnen(list, i, i - 1))}>▲</button>
              <button type="button" aria-label={t("Nach unten")} data-testid="regel-down" disabled={i === list.length - 1}
                className="px-1 disabled:opacity-30" onClick={() => setList(regelnUmordnen(list, i, i + 1))}>▼</button>
              <button type="button" aria-label={t("Regel löschen")} data-testid="regel-del"
                className="px-1 text-destructive" onClick={() => setList(list.filter((_, j) => j !== i))}>×</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-0.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Feld")}</span>
              <select data-testid="regel-feld" value={r.wenn?.feld || "tragend"} aria-label={t("Feld")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                onChange={(e) => patch(i, { wenn: { ...r.wenn, feld: e.target.value } })}>
                {REGEL_FELDER.map((f) => <option key={f} value={f}>{t(f)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Operator")}</span>
              <select data-testid="regel-op" value={r.wenn?.operator || "="} aria-label={t("Operator")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                onChange={(e) => {
                  const op = e.target.value;
                  const wenn = { feld: r.wenn?.feld || "tragend", operator: op };
                  if (op !== "gesetzt") wenn.wert = r.wenn?.wert ?? true;
                  patch(i, { wenn });
                }}>
                {OPERATOREN.map((o) => <option key={o} value={o}>{t(o)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Wert")}</span>
              <input data-testid="regel-wert" disabled={r.wenn?.operator === "gesetzt"} aria-label={t("Wert")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground disabled:opacity-40"
                value={r.wenn?.operator === "gesetzt" ? "" : (r.wenn?.wert == null ? "" : String(r.wenn.wert))}
                onChange={(e) => {
                  const raw = e.target.value;
                  let wert = /** @type {string|number|boolean|null} */ (raw);
                  if (raw === "true") wert = true;
                  else if (raw === "false") wert = false;
                  else if (raw === "null" || raw === "") wert = null;
                  else if (raw !== "" && Number.isFinite(Number(raw)) && String(Number(raw)) === raw) wert = Number(raw);
                  patch(i, { wenn: { ...r.wenn, wert } });
                }} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-0.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Füllung")}</span>
              <select data-testid="regel-fuellung" value={r.dann?.fuellung || ""} aria-label={t("Füllung")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                onChange={(e) => patch(i, { dann: { ...r.dann, fuellung: e.target.value || undefined } })}>
                {FUELL_WAHL.map((f) => <option key={f || "none"} value={f}>{f ? t(f) : t("keine")}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Kontur")}</span>
              <select data-testid="regel-kontur" value={r.dann?.kontur || ""} aria-label={t("Kontur")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                onChange={(e) => patch(i, { dann: { ...r.dann, kontur: e.target.value || undefined } })}>
                {KONTUR_WAHL.map((f) => <option key={f || "none"} value={f}>{f ? t(f) : t("keine")}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Strich")}</span>
              <input data-testid="regel-strich" aria-label={t("Strich")} placeholder="4 1 1 1"
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                value={r.dann?.strich || ""}
                onChange={(e) => patch(i, { dann: { ...r.dann, strich: e.target.value || undefined } })} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]">{t("Strichbreite (mm)")}</span>
              <input type="number" step="0.05" min="0.05" max="2" data-testid="regel-breite" aria-label={t("Strichbreite (mm)")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                value={r.dann?.strichbreite_mm ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  patch(i, { dann: { ...r.dann, strichbreite_mm: Number.isFinite(n) ? n : undefined } });
                }} />
            </label>
            <label className="flex flex-col gap-0.5 col-span-2">
              <span className="text-[10px]">{t("Deckkraft")}</span>
              <input type="number" step="0.05" min="0.05" max="1" data-testid="regel-deckkraft" aria-label={t("Deckkraft")}
                className="rounded border border-border bg-background px-0.5 py-0.5 text-foreground"
                value={r.dann?.deckkraft ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  patch(i, { dann: { ...r.dann, deckkraft: Number.isFinite(n) ? n : undefined } });
                }} />
            </label>
          </div>
        </div>
      ))}

      {onVorlageSpeichern && list.length > 0 && (
        <div className="flex items-center gap-1 pt-0.5">
          <input data-testid="regel-vorlage-name" value={vorlageName} onChange={(e) => setVorlageName(e.target.value)}
            placeholder={t("Name der Vorlage")} aria-label={t("Name der Vorlage")}
            className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-foreground" />
          <button type="button" data-testid="regel-vorlage-save" onClick={savePreset}
            className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-muted">{t("Als Vorlage speichern")}</button>
        </div>
      )}
    </div>
  );
}
