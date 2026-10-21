// WohnungsPlan — plan drawing of the stored apartments of one storey (99-01/99-03,
// "drawing first"): the outlines of the Wohneinheit rows, coloured by the deadline light of
// the apartment's special requests, number and sales status inside, click or Enter selects.
// No editing here — the cut is made in the apartment workshop / massing studio, this view
// only shows what was taken over.
//
// In:  wohnungen (Wohneinheit rows of ONE storey, umriss in m), lichter (Map id →
//      {ampel, anzahl}), auswahlId, onWaehlen(id). Out: SVG; data-testids sw-plan,
//      sw-plan-wohnung (data-nr, data-ampel, data-status).
import React from "react";
import { useI18n } from "@core/lib/i18n";
import { planRahmen, planTransform, wohnungStatusLabel } from "@/lib/werkplanung/wohneinheiten";

/** Drawing size in SVG user units (px); the SVG scales to the card width. */
const BREITE = 800;
const HOEHE = 420;

/**
 * Token classes of a light (fill + stroke). Apartments without requests stay neutral so the
 * drawing shows where something is to decide, not a sea of green.
 * @type {Record<string, string>}
 */
const FARBE = {
  rot: "fill-fehler-flaeche stroke-fehler",
  gelb: "fill-warnung-flaeche stroke-warnung",
  gruen: "fill-erfolg-flaeche stroke-erfolg",
  offen: "fill-hinweis-flaeche stroke-hinweis",
  keine: "fill-card stroke-muted-foreground",
};

/**
 * @param {{
 *   wohnungen: Array<any>,
 *   lichter: Map<string, {ampel: string, anzahl: number}>,
 *   auswahlId: string|null,
 *   onWaehlen: (id: string) => void,
 * }} props
 * @returns {import("react").JSX.Element}
 */
export default function WohnungsPlan({ wohnungen, lichter, auswahlId, onWaehlen }) {
  const { t } = useI18n();
  const mitUmriss = wohnungen.filter((w) => Array.isArray(w.umriss) && w.umriss.length >= 3);
  const { punkt, massstab } = planTransform(planRahmen(mitUmriss), BREITE, HOEHE);
  if (!mitUmriss.length) {
    return <p className="text-sm text-muted-foreground" data-testid="sw-plan-leer">{t("Für dieses Geschoss liegen keine Umrisse vor.")}</p>;
  }
  return (
    <svg viewBox={`0 0 ${BREITE} ${HOEHE}`} className="w-full h-auto max-h-[60vh] rounded-md border border-border bg-muted/30" data-testid="sw-plan"
      role="group" aria-label={t("Wohnungsplan")}>
      {mitUmriss.map((w) => {
        const pkt = w.umriss.map(punkt);
        const mitte = {
          x: pkt.reduce((s, p) => s + p.x, 0) / pkt.length,
          y: pkt.reduce((s, p) => s + p.y, 0) / pkt.length,
        };
        const licht = lichter.get(w.id);
        const art = licht && licht.anzahl > 0 ? licht.ampel : "keine";
        const gewaehlt = w.id === auswahlId;
        // Text size follows the scale but stays readable: 0.9 m of the model, 11…16 px.
        const schrift = Math.max(11, Math.min(16, massstab * 0.9));
        return (
          <g key={w.id} role="button" tabIndex={0} className="cursor-pointer" data-testid="sw-plan-wohnung"
            data-nr={w.nr} data-ampel={art} data-status={w.status || "frei"}
            aria-label={`${w.nr} · ${t(wohnungStatusLabel(w.status || "frei"))}`} aria-pressed={gewaehlt}
            onClick={() => onWaehlen(w.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onWaehlen(w.id); } }}>
            <polygon points={pkt.map((p) => `${p.x},${p.y}`).join(" ")}
              className={`${FARBE[art] || FARBE.keine} ${gewaehlt ? "stroke-primary" : ""}`}
              strokeWidth={gewaehlt ? 3 : 1.2} strokeDasharray={w.status === "verkauft" ? undefined : w.status === "reserviert" ? "6 3" : undefined} />
            <text x={mitte.x} y={mitte.y} textAnchor="middle" dominantBaseline="middle" className="fill-foreground font-semibold pointer-events-none" fontSize={schrift}>{w.nr}</text>
            {w.status && w.status !== "frei" && (
              <text x={mitte.x} y={mitte.y + schrift * 1.1} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground pointer-events-none" fontSize={schrift * 0.75}>
                {t(wohnungStatusLabel(w.status))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
