// Quick task 261110-mzl: the "3D-Fenster" bar of a 3D viewer — a compact row of icon buttons at the top of the view
// (walk through, fit, picture, style …), after the bar an Archicad user knows. The viewer hands in its entries
// (@core/lib/zeigen/leiste.js); this component knows no viewer.
//
// In:  entries, t. Out: DOM; role "toolbar", data-testid leiste-3d, one button per entry (data-testid from the entry).
import React from "react";
import { englischErgaenzen } from "@core/lib/i18n";
import { EN } from "@core/lib/i18nTeile/navigation-3d.js";
import { leistenEintraege, leistenTitel } from "@core/lib/zeigen/leiste.js";

englischErgaenzen(EN);

/**
 * @param {{eintraege: Array<import("@core/lib/zeigen/leiste.js").LeistenEintrag|null|undefined|false>,
 *   t?: (s: string) => string, grob?: boolean, className?: string}} props
 *   eintraege: the buttons in order; empty or hidden ones are skipped. Nothing is rendered for an empty bar.
 *   grob: finger or pen in use (useZeigerArt) — buttons of 40 px instead of 28 px [ASSUMED: 40 px, the smallest size the
 *   tablet layout of this app uses elsewhere is not defined; WCAG 2.5.8 asks for at least 24 px, Apple HIG for 44 pt].
 *   The bar wraps instead of leaving a narrow 3D view.
 */
export default function DreiDLeiste({ eintraege, t = (s) => s, grob = false, className = "" }) {
  const liste = leistenEintraege(eintraege);
  if (!liste.length) return null;
  return (
    <div role="toolbar" aria-label={t("3D-Fenster")} data-testid="leiste-3d"
      data-grob={grob ? "1" : undefined}
      className={`flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-0.5 rounded-md border border-border bg-card p-0.5 text-foreground shadow ${className}`}>
      {liste.map((e) => {
        const Symbol = e.symbol;
        const an = e.aktiv === true;
        return (
          <button key={e.id} type="button" data-testid={e.testid} disabled={e.gesperrt === true} onClick={e.onClick}
            title={leistenTitel(e, t)} aria-label={t(e.text)} aria-pressed={e.aktiv === undefined ? undefined : an}
            aria-keyshortcuts={e.taste || undefined}
            className={`flex ${grob ? "h-10 w-10" : "h-7 w-7"} items-center justify-center rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent ${an ? "bg-accent text-accent-foreground ring-1 ring-border" : ""}`}>
            <Symbol className={grob ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
