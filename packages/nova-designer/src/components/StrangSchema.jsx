// Strangschema (Phase 41, NETZ-02) — the auto-generated riser diagram as SVG.
//
// In:  daten = strangschema(netz, storeys) from @designer/lib/tgaNetz (columns = strand heads,
//      rows = storeys, cells = incident edges + served outlets), kennwerte = strangKennwerte()
//      (demand per strand, [ASSUMED] concept values).
// Out: one SVG, top row = highest storey. No calculation here — the lib decides, this draws.

import React from "react";
import { GEWERKE_TGA, KNOTEN_ARTEN } from "@designer/lib/tgaNetz";

const SPALTE_PX = 78;   // column pitch in px
const ZEILE_PX = 38;    // row pitch in px
const LINKS_PX = 52;    // room for the storey labels
const OBEN_PX = 34;     // room for the column headers
const UNTEN_PX = 30;    // room for the demand line

const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const geschoss = (lvl) => (lvl === 0 ? "EG" : `${lvl}. OG`);

/**
 * @param {object} p
 * @param {{spalten:Array<object>, zeilen:number[], zellen:Array<object>}} p.daten strangschema() result
 * @param {Array<{strangId:string|null, kennwert:number, einheit:string}>} [p.kennwerte] strangKennwerte() result
 * @param {string} [p.leerText] shown when there is no strand yet
 */
export default function StrangSchema({ daten, kennwerte = [], leerText = "Noch kein Strang — Schacht, Verteiler oder Erzeuger setzen." }) {
  const spalten = daten?.spalten || [];
  const zeilen = daten?.zeilen || [0];
  if (!spalten.length) {
    return <p className="text-xs text-slate-400" data-testid="tn-schema-leer">{leerText}</p>;
  }
  const W = LINKS_PX + spalten.length * SPALTE_PX + 12;
  const H = OBEN_PX + zeilen.length * ZEILE_PX + UNTEN_PX;
  // row index 0 = highest storey at the top
  const yVon = (lvl) => OBEN_PX + (zeilen.length - 1 - lvl) * ZEILE_PX + ZEILE_PX / 2;
  const xVon = (i) => LINKS_PX + i * SPALTE_PX + SPALTE_PX / 2;
  const zelle = (strangId, lvl) => (daten.zellen || []).find((z) => z.strangId === strangId && z.level === lvl);
  const wert = (strangId) => kennwerte.find((k) => k.strangId === strangId);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 320 }} role="img" data-testid="tn-schema">
      {/* storey lines + labels */}
      {zeilen.map((lvl) => (
        <g key={`z${lvl}`}>
          <line x1={LINKS_PX - 6} y1={yVon(lvl)} x2={W - 6} y2={yVon(lvl)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={LINKS_PX - 10} y={yVon(lvl)} textAnchor="end" dominantBaseline="central" fontSize="10" fill="#64748b">{geschoss(lvl)}</text>
        </g>
      ))}
      {/* strands */}
      {spalten.map((sp, i) => {
        const farbe = GEWERKE_TGA[sp.gewerk]?.farbe || "#334155";
        const x = xVon(i);
        const lvlBis = Math.min(sp.levelBis, zeilen.length - 1);
        const kw = wert(sp.strangId);
        return (
          <g key={sp.strangId} data-testid="tn-schema-strang" data-id={sp.strangId}>
            <text x={x} y={12} textAnchor="middle" fontSize="9" fontWeight="600" fill={farbe}>{GEWERKE_TGA[sp.gewerk]?.label || sp.gewerk}</text>
            <text x={x} y={24} textAnchor="middle" fontSize="8.5" fill="#475569">
              {sp.name.length > 14 ? `${sp.name.slice(0, 13)}…` : sp.name}
            </text>
            {/* riser line (schacht spans storeys; other heads are a single storey) */}
            <line x1={x} y1={yVon(sp.levelVon)} x2={x} y2={yVon(lvlBis)} stroke={farbe} strokeWidth={sp.art === "schacht" ? 3 : 1.5} strokeLinecap="round" />
            {zeilen.filter((lvl) => lvl >= sp.levelVon && lvl <= lvlBis).map((lvl) => {
              const z = zelle(sp.strangId, lvl) || { kanten: 0, auslaesse: 0 };
              const aktiv = z.kanten > 0 || z.auslaesse > 0;
              return (
                <g key={lvl}>
                  <circle cx={x} cy={yVon(lvl)} r={aktiv ? 6 : 3.5} fill={aktiv ? farbe : "#fff"} stroke={farbe} strokeWidth="1.5" />
                  {z.auslaesse > 0 && (
                    <text x={x} y={yVon(lvl)} textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight="700" fill="#fff">{z.auslaesse}</text>
                  )}
                  {z.kanten > 0 && (
                    <text x={x + 9} y={yVon(lvl) - 6} fontSize="7" fill="#64748b">{z.kanten} L</text>
                  )}
                </g>
              );
            })}
            {/* demand at the foot */}
            <text x={x} y={H - 10} textAnchor="middle" fontSize="8.5" fill="#334155" fontWeight="600">
              {kw ? `${de1(kw.kennwert)} ${kw.einheit}` : "—"}
            </text>
          </g>
        );
      })}
      {/* legend: symbol meaning */}
      <text x={8} y={H - 10} fontSize="7.5" fill="#94a3b8">{KNOTEN_ARTEN.auslass.label.split(" ")[0]} = Zahl</text>
    </svg>
  );
}
