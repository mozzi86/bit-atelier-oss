// One-line header above the Komplex-Designer panels (72-02, review N-10).
//
// Replaces the six-line amber wall of text that used to explain what is a real
// project state and what is a tool default. Instead every tab says in one line:
// what it READS, what it PRODUCES, and on what kind of data it currently runs.
//
// In:  a registry entry from config/designerNavigation.js (+ optional overrides).
// Out: a <= 48 px bar. No data access, no hooks — the caller owns the state, so
//      this component can never disturb the panels' hook order.

import React from "react";
import { Badge } from "@core/components/ui/badge";

/**
 * Badge styles per data state. Colour is never the only carrier — the text says
 * the same thing (A11y, review 18.09.: colour alone must not carry meaning).
 * @type {Record<string, { text: string, klasse: string, titel: string }>}
 */
const STAND_STIL = {
  modell: {
    text: "Live-Modell",
    klasse: "bg-emerald-100 text-emerald-800 border-emerald-200",
    titel: "Rechnet auf erfasster Geometrie dieses Projekts.",
  },
  richtwert: {
    text: "Richtwert",
    klasse: "bg-amber-100 text-amber-800 border-amber-200",
    titel: "Rechnet auf [ASSUMED]-Richtwerten — kein geprüfter Nachweis.",
  },
  offen: {
    text: "Offen",
    klasse: "bg-slate-100 text-slate-700 border-slate-200",
    titel: "Noch keine Daten erfasst.",
  },
};

/**
 * @param {object} props
 * @param {{ label: string, braucht: string[], liefert: string[], stand: string }} props.reiter
 *   registry entry of the active tab
 * @param {string} props.bereichTitel human title of the active area, e.g. "2 · Baukörper"
 * @param {'modell'|'richtwert'|'offen'} [props.standOverride] overrides the registry
 *   default once a caller knows the real state (follow-up work)
 * @returns {JSX.Element|null} the header bar, or null without a registry entry
 */
export default function PanelHeader({ reiter, bereichTitel, standOverride }) {
  if (!reiter) return null;
  const stand = STAND_STIL[standOverride || reiter.stand] || STAND_STIL.offen;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-slate-200 bg-slate-50/80 text-sm min-h-[40px]">
      <span className="font-medium text-slate-900">
        <span className="text-slate-500">{bereichTitel} › </span>
        {reiter.label}
      </span>

      {reiter.braucht.length > 0 && (
        <span className="flex items-center gap-1 text-slate-600">
          <span className="text-xs uppercase tracking-wide text-slate-400">Braucht</span>
          {reiter.braucht.map((b) => (
            <Badge key={b} variant="outline" className="font-normal">{b}</Badge>
          ))}
        </span>
      )}

      {reiter.liefert.length > 0 && (
        <span className="flex items-center gap-1 text-slate-600">
          <span className="text-xs uppercase tracking-wide text-slate-400">Liefert</span>
          {reiter.liefert.map((l) => (
            <Badge key={l} variant="outline" className="font-normal">{l}</Badge>
          ))}
        </span>
      )}

      <Badge className={`ml-auto font-normal border ${stand.klasse}`} title={stand.titel}>
        {stand.text}
      </Badge>
    </div>
  );
}
