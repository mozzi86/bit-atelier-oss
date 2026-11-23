// 115-13 (D-115-48/49): the inspector rows of a selected stair in the building model — moved out of BitBimStudio.jsx into this lazily
// loaded module (size budget: the designer chunk is the largest of the build) and extended by the stair type. One editor: the rows
// are rendered by the studio's own `field` helper inside its attribute panel, every change goes through the studio's `patchStair`
// (undo/redo via merken(), the autosave path of 115-05a/b) — no write path of its own.
//
// Rows: type with a preview of each type (the plan symbol of THIS stair drawn as either type), storey, antritt, direction, width,
// risers, going; straight flight: opening width; two-flight stair: risers of flight 1, stairwell eye, landing depth, turn; then the
// derived result, the slab opening and the DIN 18065 warnings (warnings only, the input is kept — treppeRegeln.js).
//
// In:  props (stair record, built model, storey table, the studio's field/class helpers, patch). Out: the rows (React elements).

import React from "react";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { EN as EN_TREPPE_11513 } from "@core/lib/i18nTeile/treppe-115-13.js";
import { treppeBerechnen, treppenText, treppenLoch } from "@core/lib/bauteil/treppe.js";
import { deckeUeber } from "@core/lib/bauteil/treppeRegeln.js";
import { istUTreppe, treppeUBerechnen, treppeULoch, treppeUText, TREPPE_U } from "@core/lib/bauteil/treppeU.js";
import { treppeSymbol } from "@core/lib/plan/treppeSymbol.js";
import { treppeUSymbol } from "@core/lib/plan/treppeUSymbol.js";
import { geschosshoehe, elevationOf, deckenLage } from "@core/lib/bauteil/hoehen.js";

englischErgaenzen(EN_TREPPE_11513);

/** Stair types of the choice: stored `art` value and German label (key of the i18n part). Winders and spiral stairs are open (115-13 part 2). */
const ARTEN = /** @type {const} */ ([["gerade", "gerade, einläufig"], [TREPPE_U, "zweiläufig mit Zwischenpodest"]]);
/** Size of a type preview in px. */
const VB = { b: 64, h: 44, rand: 3 };

/** "0,28" — metres with two decimals and a decimal comma. @param {number} v @returns {string} */
const m2 = (v) => v.toFixed(2).replace(".", ",");
/** "17,5" — metres as centimetres with one decimal. @param {number} v @returns {string} */
const cm = (v) => (v * 100).toFixed(1).replace(".", ",");

/**
 * Preview of a stair type: the plan symbol ("unten" view) of the stair with the type switched, axis-aligned (start 0/0, ascent +x),
 * scaled into a VB.b × VB.h px box. Text primitives are left out (unreadable at this size).
 * @param {{st: any, art: string, hoehe_m: number}} props
 */
function ArtVorschau({ st, art, hoehe_m }) {
  const probe = { ...st, art, start: { x: 0, z: 0 }, richtung_grad: 0 };
  const teile = (art === TREPPE_U ? treppeUSymbol(treppeUBerechnen(probe, hoehe_m), { ansicht: "unten" }) : treppeSymbol(treppeBerechnen(probe, hoehe_m), { ansicht: "unten" }))
    .filter((s) => s.art !== "text");
  const pts = teile.flatMap((s) => s.pts);
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const z0 = Math.min(...pts.map((p) => p.z)), z1 = Math.max(...pts.map((p) => p.z));
  const k = Math.min((VB.b - 2 * VB.rand) / Math.max(0.1, x1 - x0), (VB.h - 2 * VB.rand) / Math.max(0.1, z1 - z0));
  const X = (/** @type {{x: number, z: number}} */ p) => VB.rand + (p.x - x0) * k, Z = (/** @type {{x: number, z: number}} */ p) => VB.rand + (p.z - z0) * k;
  return (
    <svg width={VB.b} height={VB.h} viewBox={`0 0 ${VB.b} ${VB.h}`} aria-hidden="true" className="text-muted-foreground">
      {teile.map((s, i) => s.art === "kreis"
        ? <circle key={i} cx={X(s.pts[0])} cy={Z(s.pts[0])} r={Math.max(1, (s.radius_m || 0.1) * k)} fill="none" stroke="currentColor" strokeWidth={0.6} />
        : <polyline key={i} points={(s.art === "poly" ? [...s.pts, s.pts[0]] : s.pts).map((p) => `${X(p)},${Z(p)}`).join(" ")} fill="none" stroke="currentColor"
          strokeWidth={s.gewicht === "ansicht" ? 0.9 : 0.5} strokeDasharray={s.strich === "gestrichelt" ? "2 1.5" : undefined} />)}
    </svg>
  );
}

/**
 * The inspector rows of a stair.
 * @param {{st: any, model: any, gs: any, field: (label: string, child: React.ReactNode) => React.ReactNode, numCls: string, selCls: string,
 *   storeyOpts: React.ReactNode, patch: (p: Record<string, any>) => void}} props  `patch` = the studio's patchStair for this stair
 */
export default function TreppeInspektor({ st, model, gs, field, numCls, selCls, storeyOpts, patch }) {
  const { t: tz } = useI18n();
  const lvl = Math.round(Number(st.level) || 0);
  const hoehe = geschosshoehe(lvl, gs);
  const u = istUTreppe(st);
  const decke = deckeUeber(model, lvl, gs);
  const uk = decke ? deckenLage(decke, gs, "huelle").unterkante_m - elevationOf(lvl, gs) : null;
  const ue = u ? treppeUBerechnen(st, hoehe) : null;
  const erg = u ? null : treppeBerechnen(st, hoehe);
  const loch = uk == null ? null : ue ? treppeULoch(st, ue, uk) : treppenLoch(st, /** @type {any} */ (erg), uk);
  const e = /** @type {NonNullable<typeof ue>|NonNullable<typeof erg>} */ (ue || erg);
  const warnungen = [...e.warnungen, ...(loch?.warnung ? [loch.warnung] : [])];
  const zahl = (/** @type {string} */ v) => (v === "" ? undefined : +v);
  const kurz = "w-16 rounded border border-border px-1 py-0.5 text-right bg-card";
  return (
    <>
      {/* own row, not `field`: the studio's field is a <label>, and a click on a label would press the first button inside it */}
      <div className="flex items-center justify-between gap-2 px-3 py-1 text-[11px] text-muted-foreground">
        <span>{tz("Treppenart")}</span>
        <span className="flex gap-1" role="radiogroup" aria-label={tz("Treppenart")}>
        {ARTEN.map(([art, text]) => {
          const aktiv = art === TREPPE_U ? u : !u;
          return (
            <button key={art} type="button" role="radio" aria-checked={aktiv} title={tz(text)} aria-label={tz(text)} data-testid={`treppe-art-${art}`}
              className={`rounded border px-0.5 ${aktiv ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"}`}
              onClick={() => { if (!aktiv) patch({ art }); }}>
              <ArtVorschau st={st} art={art} hoehe_m={hoehe} />
            </button>
          );
        })}
        </span>
      </div>
      {field("Geschoss", <select className={selCls} value={lvl} data-testid="treppe-geschoss" onChange={(ev) => patch({ level: +ev.target.value })}>{storeyOpts}</select>)}
      {field(tz("Antritt x / z (m)"), <span className="flex gap-1"><input type="number" className={kurz} step="0.05" value={st.start.x} aria-label={tz("Antritt x (m)")} onChange={(ev) => patch({ start: { ...st.start, x: +ev.target.value } })} />
        <input type="number" className={kurz} step="0.05" value={st.start.z} aria-label={tz("Antritt z (m)")} onChange={(ev) => patch({ start: { ...st.start, z: +ev.target.value } })} /></span>)}
      {field(tz("Richtung (°)"), <input type="number" className={numCls} step="15" value={Number(st.richtung_grad) || 0} data-testid="treppe-richtung" aria-label={tz("Richtung (°)")} onChange={(ev) => patch({ richtung_grad: ((+ev.target.value % 360) + 360) % 360 })} />)}
      {field(tz("Laufbreite (m)"), <input type="number" className={numCls} step="0.05" min="0.5" max="3" value={Number(st.breite_m) || 1} data-testid="treppe-breite" aria-label={tz("Laufbreite (m)")} onChange={(ev) => patch({ breite_m: +ev.target.value })} />)}
      {field(tz("Steigungen"), <input type="number" className={numCls} step="1" min="2" max="40" value={st.steigungen ?? ""} placeholder={String(e.n)} data-testid="treppe-steigungen" aria-label={tz("Steigungen")} onChange={(ev) => patch({ steigungen: zahl(ev.target.value) })} />)}
      {field(tz("Auftritt (m)"), <input type="number" className={numCls} step="0.01" min="0.15" max="0.5" value={st.auftritt_m ?? ""} placeholder={e.a_m.toFixed(3)} aria-label={tz("Auftritt (m)")} onChange={(ev) => patch({ auftritt_m: zahl(ev.target.value) })} />)}
      {ue ? (
        <>
          {field(tz("Steigungen Lauf 1"), <input type="number" className={numCls} step="1" min="1" max="39" value={st.steigungen_lauf1 ?? ""} placeholder={String(ue.n1)} data-testid="treppe-lauf1" aria-label={tz("Steigungen Lauf 1")} onChange={(ev) => patch({ steigungen_lauf1: zahl(ev.target.value) })} />)}
          {field(tz("Treppenauge (m)"), <input type="number" className={numCls} step="0.05" min="0" max="2" value={st.auge_m ?? ""} placeholder={ue.auge_m.toFixed(2)} data-testid="treppe-auge" aria-label={tz("Treppenauge (m)")} onChange={(ev) => patch({ auge_m: zahl(ev.target.value) })} />)}
          {field(tz("Podesttiefe (m)"), <input type="number" className={numCls} step="0.05" min="0.5" max="4" value={st.podest_tiefe_m ?? ""} placeholder={ue.podest_tiefe_m.toFixed(2)} data-testid="treppe-podest" aria-label={tz("Podesttiefe (m)")} onChange={(ev) => patch({ podest_tiefe_m: zahl(ev.target.value) })} />)}
          {field(tz("Wendung"), <select className={selCls} value={st.wende === "rechts" ? "rechts" : "links"} data-testid="treppe-wende" aria-label={tz("Wendung")} onChange={(ev) => patch({ wende: ev.target.value })}><option value="links">{tz("links")}</option><option value="rechts">{tz("rechts")}</option></select>)}
        </>
      ) : field(tz("Deckenloch Breite (m)"), <input type="number" className={numCls} step="0.01" min="0.5" max="4" value={st.loch_breite_m ?? ""} placeholder={(Number(st.breite_m) || 1).toFixed(2)} aria-label={tz("Deckenloch Breite (m)")} onChange={(ev) => patch({ loch_breite_m: zahl(ev.target.value) })} />)}
      {field(tz("Ergebnis"), <span data-testid="treppe-ergebnis">{ue ? treppeUText(ue) : treppenText(/** @type {any} */ (erg))} · {tz("Schrittmaß")} {cm(e.schrittmass_m)} cm · {tz("Lauflänge")} {m2(e.laufLaenge_m)} m</span>)}
      {ue && field(tz("Läufe"), <span data-testid="treppe-laeufe">{ue.n1} + {ue.n2} · {tz("Podestfläche")} {m2(ue.podest.flaeche_m2)} m²</span>)}
      {field(tz("Deckenloch"), <span data-testid="treppe-loch">{!loch ? tz("keine Decke darüber") : "flaeche_m2" in loch ? `${m2(Number(loch.flaeche_m2))} m²` : `${m2(loch.laenge_m)} × ${m2(loch.breite_m)} m`}</span>)}
      {warnungen.length > 0 && field(tz("Hinweise"), <ul className="list-disc pl-4 text-warnung" data-testid="treppe-warnungen">{warnungen.map((w) => <li key={w.code}>{tz(w.text)} ({w.code === "lauf_lang" ? w.wert : `${cm(w.wert)} cm`})</li>)}</ul>)}
    </>
  );
}
