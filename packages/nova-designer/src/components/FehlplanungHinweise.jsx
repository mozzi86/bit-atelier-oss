// 97-06: findings of the checks against wrong planning (@core/lib/bauteil/pruefregeln) next to
// the lens bar — a calm chip ("keine Hinweise" / "n Hinweise") that opens the list. Hints only:
// nothing is blocked, the planner decides (liability decision, see pruefregeln.js).
//
// In:  befunde (Befund[]), t. Out: UI; data-testids fehlplanung, fehlplanung-liste,
//      fehlplanung-befund (data-regel, data-code).
import React, { useState } from "react";

/**
 * @param {{befunde: Array<{regel: number, code: string, stufe: string, text: string, ids: string[]}>, t: (s: string) => string}} props
 */
export default function FehlplanungHinweise({ befunde, t }) {
  const [offen, setOffen] = useState(false);
  const warn = befunde.filter((b) => b.stufe === "warn").length;
  const farbe = warn ? "border-amber-300 bg-amber-50 text-amber-800" : befunde.length ? "border-sky-200 bg-sky-50 text-sky-800" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return (
    <div className="relative" data-testid="fehlplanung" data-anzahl={befunde.length}>
      <button type="button" onClick={() => setOffen((o) => !o)} aria-expanded={offen} disabled={!befunde.length}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${farbe}`}
        title={t("Prüfregeln gegen Fehlplanung — Hinweise, keine Sperre")}>
        {befunde.length ? `⚠ ${befunde.length} ${t(befunde.length === 1 ? "Hinweis" : "Hinweise")}` : `✓ ${t("keine Hinweise")}`}
      </button>
      {offen && befunde.length > 0 && (
        <ul className="absolute right-0 z-30 mt-1 w-[320px] space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-lg" data-testid="fehlplanung-liste">
          {befunde.map((b) => (
            <li key={`${b.regel}-${b.code}-${b.ids.join(",")}`} data-testid="fehlplanung-befund" data-regel={b.regel} data-code={b.code}
              className={`rounded border-l-2 px-2 py-1 ${b.stufe === "warn" ? "border-amber-500 bg-amber-50/60" : "border-sky-400 bg-sky-50/50"}`}>
              <span className="mr-1 font-semibold text-slate-500">R{b.regel}</span>{b.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
