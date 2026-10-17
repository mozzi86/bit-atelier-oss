// 97-03: lens bar above the plan — one segment per lens of the register (@core/lib/plan/brillen),
// like the view map of an architecture program. A small legend shows how the four statuses
// appear under the chosen lens (colour from the ONE status table), so the planner sees at a
// glance what is hidden. Choosing a lens never changes the model.
//
// In:  wert (lens id), onChange(id), t. Out: UI; data-testids brillen-leiste, brille-<id>,
//      brillen-legende, legende-<status> (data-sicht).
import React from "react";
import { BRILLEN, brilleVon } from "@core/lib/plan/brillen.js";
import { statusFarbe, STATUS_DARSTELLUNG } from "@core/lib/plan/statusDarstellung.js";

const LEGENDE = ["bestand", "abbruch", "neubau", "ohne"];

/**
 * @param {{wert: string, onChange: (id: string) => void, t: (s: string) => string, sw?: boolean, onSw?: ((v: boolean) => void)|null}} props
 *   sw/onSw (97-04b): black-and-white variant, offered only by lenses with `sw` (permit)
 */
export default function BrillenLeiste({ wert, onChange, t, sw = false, onSw = null }) {
  const aktiv = brilleVon(wert);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="brillen-leiste">
      <div role="radiogroup" aria-label={t("Brille")} className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] shadow-sm">
        {BRILLEN.map((b) => {
          const an = b.id === aktiv.id;
          return (
            <button key={b.id} type="button" role="radio" aria-checked={an} data-testid={`brille-${b.id}`}
              title={`${t(b.label)} — ${t(b.zweck)}`} onClick={() => onChange(b.id)}
              className={`rounded-md px-2 py-1 transition-colors ${an ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {t(b.kurz)}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500" data-testid="brillen-legende" aria-label={t("Legende")}>
        {LEGENDE.map((s) => {
          const sicht = aktiv.sicht[s];
          return (
            <span key={s} data-testid={`legende-${s}`} data-sicht={sicht} className={`flex items-center gap-1 ${sicht === "aus" ? "line-through opacity-40" : ""}`}>
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-slate-300"
                style={{ background: statusFarbe(s === "ohne" ? null : s), opacity: sicht === "blass" ? 0.4 : 1, outline: sicht === "hervor" ? "1.5px solid #0f172a" : "none" }} />
              {t(STATUS_DARSTELLUNG[s].label)}
            </span>
          );
        })}
        <span className="text-slate-400">1:{aktiv.massstab}</span>
        {aktiv.sw && onSw && (
          <label className="flex items-center gap-1 text-slate-600" title={t("Schwarz-Weiß nach Bauvorlagenverordnung: Bestand hellgrau, Abbruch gestrichelt, Neubau schraffiert")}>
            <input type="checkbox" checked={sw} onChange={(e) => onSw(e.target.checked)} data-testid="brille-sw" /> {t("S/W")}
          </label>
        )}
      </div>
    </div>
  );
}
