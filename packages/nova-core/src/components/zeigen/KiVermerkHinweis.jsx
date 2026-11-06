// 106-11: the note "Enthält ungeprüfte KI-Änderungen" above a plan view (Grundriss / Schnitt of the BIM studio) - the screen
// counterpart of the note on the printed sheet (planStand.js vermerkZeilen). Shown while the model holds AI changes nobody
// released, or while the state could not be determined. Form, not colour alone (guard rail 5): dashed border, "?" sign, words;
// the warning tokens add the colour. It has no close button: it goes away only when the changes are released or reversed in the
// review workplace (D-IM-04) - the link leads there.
//
// In:  stand (planStand.js ModellStand or null while loading), t, optional className / markiert (marks drawn in this view).
// Out: <div data-testid="ki-vermerk" data-anzahl data-ermittelt> or nothing.
import React from "react";
import { Link } from "react-router-dom";
import { vermerkZeilen } from "@core/lib/zeigen/planStand.js";

/**
 * @param {{stand: import("@core/lib/zeigen/planStand.js").ModellStand|null|undefined, t: (s: string) => string, className?: string, markiert?: number}} props
 *   stand: undefined/null = still loading (nothing is shown - the view must not flash a false note); markiert: marks drawn in this view.
 */
export default function KiVermerkHinweis({ stand, t, className = "", markiert }) {
  if (!stand) return null;
  const v = vermerkZeilen(stand, t, { markiert });
  if (!v) return null;
  return (
    <div data-testid="ki-vermerk" data-anzahl={stand.ungeprueft} data-ermittelt={stand.ermittelt ? "1" : "0"} role="status"
      className={`rounded-md border-2 border-dashed border-warnung bg-warnung-flaeche px-2 py-1.5 text-xs text-warnung shadow ${className}`}>
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-dashed border-warnung font-bold">{v.zeichen}</span>
        <div className="min-w-0">
          <div className="font-semibold" data-testid="ki-vermerk-titel">{v.titel}</div>
          {v.zeilen.map((z) => <div key={z} className="text-foreground">{z}</div>)}
          <Link to="/Modellfreigabe" className="underline underline-offset-2" data-testid="ki-vermerk-freigabe">{t("Zur Modellfreigabe")}</Link>
        </div>
      </div>
    </div>
  );
}
