// Quick task 261110-mzj: the walk mode of a 3D viewer on screen — the start button and, while walking, the hint at the
// bottom with the keys and the speed. The camera work is in @core/lib/zeigen/kameraSteuerung.js; this file only shows
// its state and calls start / end.
//
// In:  the walk state (LaufZustand of kameraSteuerung.js), start and end callbacks, t.
// Out: DOM; data-testids lauf-start (button), lauf-hinweis (hint), lauf-tempo (speed text), lauf-ende (button).
import React from "react";
import { englischErgaenzen } from "@core/lib/i18n";
import { EN } from "@core/lib/i18nTeile/navigation-3d.js";

englischErgaenzen(EN);

/** Speed as a German decimal number, m/s (0,5 · 1,4 · 3 · 6 · 12). */
const tempoText = (/** @type {number} */ v) => Number(v).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/**
 * The button that starts the walk mode. Hidden while the mode runs (the hint has the way out).
 * @param {{zustand: import("@core/lib/zeigen/kameraSteuerung.js").LaufZustand, onStart: () => void, bereit?: boolean,
 *   t?: (s: string) => string, className?: string}} props
 *   bereit: a model is loaded (default true); false = the button is off
 */
export function LaufModusKnopf({ zustand, onStart, bereit = true, t = (s) => s, className = "" }) {
  if (zustand.aktiv) return null;
  return (
    <button type="button" data-testid="lauf-start" disabled={!bereit} onClick={onStart}
      title={t("Durchlaufen (W A S D) – durch das Modell gehen") + " · F3"} aria-keyshortcuts="F3"
      className={`rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow hover:bg-accent hover:text-accent-foreground disabled:opacity-50 ${className}`}>
      {t("Durchlaufen")}
    </button>
  );
}

/**
 * The hint at the bottom of the view while the walk mode runs: keys, speed, how to look around, and a button to end.
 * @param {{zustand: import("@core/lib/zeigen/kameraSteuerung.js").LaufZustand, onEnde: () => void,
 *   t?: (s: string) => string, className?: string}} props
 */
export default function LaufModusHinweis({ zustand, onEnde, t = (s) => s, className = "" }) {
  if (!zustand.aktiv) return null;
  const tasten = [t("W A S D gehen"), t("Leertaste / C hoch / runter"), t("Umschalt schnell"), t("+ / − oder Mausrad Tempo"), t("Esc beendet")];
  return (
    <div data-testid="lauf-hinweis" role="status"
      className={`flex max-w-[90%] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow ${className}`}>
      <span className="font-medium">{t("Durchlaufen")}</span>
      <span data-testid="lauf-tempo" className="font-medium tabular-nums">{t("Tempo {tempo} m/s").replace("{tempo}", tempoText(zustand.tempo))}</span>
      <span className="text-muted-foreground">{tasten.join(" · ")}</span>
      <span className="text-muted-foreground">{zustand.gefangen ? t("Blick folgt der Maus") : t("ins Modell klicken zum Umsehen")}</span>
      <button type="button" data-testid="lauf-ende" onClick={onEnde}
        className="rounded border border-border px-2 py-0.5 font-medium hover:bg-accent hover:text-accent-foreground">
        {t("Durchlaufen beenden")}
      </button>
    </div>
  );
}
