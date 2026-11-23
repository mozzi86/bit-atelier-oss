// 115-12 (D-115-47): info panel of the selected room in the apartment planner — pick a room, type width × depth
// (metres, two decimals, German decimal comma), read the area, nudge the position, see and undo the hand marker.
// It sits right of the storey plan (D-115-06: the selected element's info is on the right) and is always there, so the
// plan does not jump when a room is selected (D-115-41).
//
// The panel owns no room data: every value comes from the host (WohnungsWerkstatt), every change goes back through
// a callback; the host runs the pure geometry (@designer/lib/raumBearbeiten) and writes werkstatt_layer.raumHand.
// Everything the handles in the plan do is possible here without dragging (typed sizes, step buttons).
//
// In:  the room list of the storey, the selected room's figures (m, m²), callbacks. Out: rendering + callbacks.

import React, { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { meterLesen } from "@core/lib/massing/koordinaten.js";

/** @param {number} n @returns {string} metres / m² with two decimals and decimal comma */
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FELD = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const KNOPF = "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

/**
 * @typedef {object} RaumAngaben
 * @property {string} key raumHandSchluessel of the room
 * @property {string} name short room name
 * @property {string} we unit the room belongs to
 * @property {string} [art] room kind label
 * @property {boolean} editierbar rectangular room (sizes and position can be changed)
 * @property {number} [breite_m] width in m (along the sheet-horizontal side)
 * @property {number} [tiefe_m] depth in m
 * @property {number} flaeche_m2 area in m²
 * @property {boolean} hand the room was sized / moved by hand (it no longer follows the rule)
 * @property {number} [regelBreite_m] width the rule gives, m
 * @property {number} [regelTiefe_m] depth the rule gives, m
 */

/**
 * One length field: shows the value with two decimals and a decimal comma; accepts "3,6", "3.60", "360cm";
 * commits on Enter or when the field is left, Esc restores the shown value.
 * @param {object} p
 * @param {string} p.label visible label
 * @param {number} p.wert value in m
 * @param {(m: number) => void} p.onCommit new value in m (> 0, changed)
 * @param {string} p.testid
 */
function MassFeld({ label, wert, onCommit, testid }) {
  const [entwurf, setEntwurf] = useState(/** @type {string|null} */ (null));
  const uebernehmen = () => {
    if (entwurf === null) return;
    const v = meterLesen(entwurf.replace(/\s+/g, ""));
    setEntwurf(null);
    if (v !== null && v > 0 && Math.abs(v - wert) > 1e-6) onCommit(v);
  };
  return (
    <label className="grid grid-cols-[3.5rem_minmax(0,1fr)_1rem] items-center gap-2 text-sm text-foreground">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="text" inputMode="decimal" autoComplete="off" className={`${FELD} text-right tabular-nums`} data-testid={testid}
        value={entwurf ?? de2(wert)}
        onChange={(e) => setEntwurf(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={uebernehmen}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); uebernehmen(); }
          else if (e.key === "Escape") { e.preventDefault(); setEntwurf(null); }
        }}
      />
      <span className="text-muted-foreground">m</span>
    </label>
  );
}

/**
 * Info panel of the selected room.
 * @param {object} p
 * @param {boolean} p.bereit rooms exist in the plan (tessellation applied) — else the panel says what to do first
 * @param {Array<{key: string, label: string}>} p.raeume rooms of the shown storey (for the picker)
 * @param {RaumAngaben|null} p.raum the selected room or null
 * @param {string|null} [p.meldung] note about the last typed size (clamped to a minimum or to the apartment)
 * @param {number} p.schritt_m step of the position buttons and arrow keys, m
 * @param {number} [p.maxHoehe] height of the plan beside the panel, CSS px — the panel never gets taller (it scrolls instead)
 * @param {(key: string|null) => void} p.onWahl select a room by key (null = none)
 * @param {(m: {breite_m?: number, tiefe_m?: number}) => void} p.onMasse typed size, m
 * @param {(dx: number, dz: number) => void} p.onSchritt one step on the sheet: dx / dz ∈ {−1, 0, 1} (z down)
 * @param {() => void} p.onZuruecksetzen remove the hand edit ("Auf Regel zurücksetzen")
 * @param {() => void} p.onWohnungOeffnen open the focus view of the room's unit
 */
export default function RaumInfo({ bereit, raeume, raum, meldung = null, schritt_m, maxHoehe, onWahl, onMasse, onSchritt, onZuruecksetzen, onWohnungOeffnen }) {
  const { t } = useI18n();
  const schrittText = `${(schritt_m * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} cm`;
  return (
    <aside className="flex min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-3 text-sm text-foreground"
      style={maxHoehe ? { maxHeight: maxHoehe } : undefined} data-testid="wt-raum-info" data-raum={raum?.key || ""} aria-label={t("Rauminfo")}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("Raum")}</span>
        <select className={FELD} value={raum?.key || ""} disabled={!bereit || raeume.length === 0} data-testid="wt-raum-wahl"
          onChange={(e) => onWahl(e.target.value || null)}>
          <option value="">{t("— kein Raum gewählt —")}</option>
          {raeume.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>

      {!raum && (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="wt-raum-leer">
          {bereit
            ? t("Raum im Plan anklicken oder hier wählen. Dann Größe eintippen, an den Griffen ziehen oder den Raum verschieben.")
            : t("Erst „Tesselierung anwenden“ — danach lassen sich die Räume im Plan anklicken.")}
        </p>
      )}

      {raum && (
        <>
          <div className="min-w-0">
            <div className="truncate text-base font-medium leading-6" data-testid="wt-raum-name">{raum.name}</div>
            <div className="truncate text-xs text-muted-foreground">{raum.we}{raum.art ? ` · ${raum.art}` : ""}</div>
          </div>

          {raum.editierbar ? (
            <div className="flex flex-col gap-2">
              <MassFeld label={t("Breite")} wert={raum.breite_m ?? 0} onCommit={(v) => onMasse({ breite_m: v })} testid="wt-raum-breite" />
              <MassFeld label={t("Tiefe")} wert={raum.tiefe_m ?? 0} onCommit={(v) => onMasse({ tiefe_m: v })} testid="wt-raum-tiefe" />
              <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_1rem] items-center gap-2">
                <span className="text-muted-foreground">{t("Fläche")}</span>
                <span className="px-2 text-right font-semibold tabular-nums" data-testid="wt-raum-flaeche">{de2(raum.flaeche_m2)}</span>
                <span className="text-muted-foreground">m²</span>
              </div>
              {meldung && <p className="text-xs leading-5 text-warnung" role="status" data-testid="wt-raum-meldung">{meldung}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_1rem] items-center gap-2">
                <span className="text-muted-foreground">{t("Fläche")}</span>
                <span className="px-2 text-right font-semibold tabular-nums" data-testid="wt-raum-flaeche">{de2(raum.flaeche_m2)}</span>
                <span className="text-muted-foreground">m²</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground" data-testid="wt-raum-fest">
                {t("Dieser Raum ist kein Rechteck (Diele über Eck, Raum an einer Schräge, Balkon) — Größe und Lage folgen der Regel.")}
              </p>
            </div>
          )}

          {raum.editierbar && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("Lage")} · {t("Schritt")} {schrittText}</span>
              <div className="flex gap-1" role="group" aria-label={t("Raum verschieben")}>
                <button type="button" className={KNOPF} onClick={() => onSchritt(-1, 0)} aria-label={t("Raum nach links schieben")} title={t("Raum nach links schieben")} data-testid="wt-raum-links"><ArrowLeft className="h-4 w-4" /></button>
                <button type="button" className={KNOPF} onClick={() => onSchritt(0, -1)} aria-label={t("Raum nach oben schieben")} title={t("Raum nach oben schieben")} data-testid="wt-raum-oben"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className={KNOPF} onClick={() => onSchritt(0, 1)} aria-label={t("Raum nach unten schieben")} title={t("Raum nach unten schieben")} data-testid="wt-raum-unten"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" className={KNOPF} onClick={() => onSchritt(1, 0)} aria-label={t("Raum nach rechts schieben")} title={t("Raum nach rechts schieben")} data-testid="wt-raum-rechts"><ArrowRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {raum.hand && (
            <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="wt-raum-hand">
              <div className="flex items-start gap-2 text-xs leading-5">
                {/* form + word, no colour: the same small square marks the room in the plan */}
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 bg-foreground" aria-hidden="true" />
                <span>
                  <span className="font-medium">{t("Von Hand gesetzt")}</span>
                  <span className="text-muted-foreground"> — {t("bleibt beim Neu-Erzeugen aus den Regeln stehen.")}</span>
                  {raum.regelBreite_m != null && raum.regelTiefe_m != null && (
                    <span className="block text-muted-foreground tabular-nums">{t("Regel")}: {de2(raum.regelBreite_m)} × {de2(raum.regelTiefe_m)} m</span>
                  )}
                </span>
              </div>
              <button type="button" className={KNOPF} onClick={onZuruecksetzen} data-testid="wt-raum-reset">{t("Auf Regel zurücksetzen")}</button>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
            <button type="button" className={KNOPF} onClick={onWohnungOeffnen} data-testid="wt-raum-wohnung">{t("Wohnung öffnen")}</button>
            {raum.editierbar && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t("Im Plan: Griffe ziehen ändert die Größe, der Raum selbst lässt sich schieben. Pfeiltasten schieben schrittweise, Esc hebt die Auswahl auf, Alt zieht ohne Fang.")}
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
