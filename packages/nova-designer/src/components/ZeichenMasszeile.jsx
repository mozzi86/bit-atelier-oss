// Numeric input row of the building studio: the click path for the same operations
// window.bitApi performs (wall by length and angle, opening on a wall, rectangular
// slab and zone, copy storey). Values are metres and degrees. The parent applies
// each action through the studio setters, so it lands in bimHistorie like a click.
//
// In:  the active tool, the storey list, the drawn walls of the current storey, t().
// Out: calls onWand / onOeffnung / onDecke / onZone / onKopieren with the typed numbers.

import React, { useState } from "react";
import { englischErgaenzen } from "@core/lib/i18n";
import { EN } from "@core/lib/i18nTeile/zeichnen-agent.js";

englischErgaenzen(EN);

const feld = "w-16 rounded border border-border bg-card px-1 py-0.5 text-right";
const knopf = "rounded border border-border bg-card px-2 py-0.5 text-foreground hover:bg-muted disabled:opacity-40";

/**
 * @param {string} v raw input
 * @returns {number} NaN when the field is empty or not a number
 */
function zahl(v) {
  if (v == null || String(v).trim() === "") return NaN;
  return Number(String(v).replace(",", "."));
}

/**
 * @param {{
 *   t: (s: string) => string,
 *   tool: string,
 *   level: number,
 *   ebenen: Array<{ level: number, name: string }>,
 *   waende: Array<{ _idx: number, level?: number }>,
 *   onWand: (spec: any) => void,
 *   onOeffnung: (spec: any) => void,
 *   onDecke: (spec: any) => void,
 *   onZone: (spec: any) => void,
 *   onKopieren: (spec: { von: number, nach: number }) => void,
 *   werkzeuge?: boolean,
 * }} props
 *   werkzeuge: false hides the wall/opening/slab/zone rows (3D view) and keeps
 *   "Geschoss kopieren", which applies in every view. The storey it copies is
 *   the same `level` the view state stores (`zustandJetzt.level`).
 */
export default function ZeichenMasszeile({ t, tool, level, ebenen, waende, onWand, onOeffnung, onDecke, onZone, onKopieren, werkzeuge = true }) {
  const [startX, setStartX] = useState("0");
  const [startZ, setStartZ] = useState("0");
  const [laenge, setLaenge] = useState("5");
  const [winkel, setWinkel] = useState("0");
  const [dicke, setDicke] = useState("0.30");
  const [hoehe, setHoehe] = useState("");
  const [versatz, setVersatz] = useState("1.5");
  const [breite, setBreite] = useState("1.20");
  const [oHoehe, setOHoehe] = useState("");
  const [bruestung, setBruestung] = useState("");
  const [wandId, setWandId] = useState("");
  const [rx, setRx] = useState("0");
  const [rz, setRz] = useState("0");
  const [rb, setRb] = useState("4");
  const [rt, setRt] = useState("3");
  const [name, setName] = useState("");
  const [von, setVon] = useState(String(level ?? 0));
  const [nach, setNach] = useState(String(ebenen.find((e) => e.level !== level)?.level ?? level));

  const num = (label, value, set, testid, step = "0.01") => (
    <label className="flex items-center gap-1 text-muted-foreground">
      {label}
      <input type="number" step={step} className={feld} value={value} aria-label={label} data-testid={testid} onChange={(e) => set(e.target.value)} />
    </label>
  );

  const wandSetzen = () => {
    const spec = {
      start: { x: zahl(startX), z: zahl(startZ) },
      laenge_m: zahl(laenge), winkel_grad: zahl(winkel), level,
      thickness_m: zahl(dicke),
    };
    if (String(hoehe).trim() !== "") spec.height_m = zahl(hoehe);
    onWand(spec);
  };
  const oeffnungSetzen = () => {
    const spec = { wandId: Number(wandId), kind: tool === "door" ? "door" : tool === "oeffnung" ? "oeffnung" : "window", versatz_m: zahl(versatz), level };
    if (String(breite).trim() !== "") spec.breite_m = zahl(breite);
    if (String(oHoehe).trim() !== "") spec.hoehe_m = zahl(oHoehe);
    if (String(bruestung).trim() !== "") spec.bruestung_m = zahl(bruestung);
    onOeffnung(spec);
  };
  const rechteck = () => ({ x: zahl(rx), z: zahl(rz), breite_m: zahl(rb), tiefe_m: zahl(rt), level });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/60 px-3 py-1 text-[11px]" data-testid="bim-masszeile">
      {werkzeuge && tool === "wall" && (
        <span className="flex flex-wrap items-center gap-2" data-testid="wand-mass">
          {num(t("Start x (m)"), startX, setStartX, "wand-start-x")}
          {num(t("Start z (m)"), startZ, setStartZ, "wand-start-z")}
          {num(t("Länge (m)"), laenge, setLaenge, "wand-laenge")}
          {num(t("Winkel (°)"), winkel, setWinkel, "wand-winkel", "1")}
          {num(t("Dicke (m)"), dicke, setDicke, "wand-dicke")}
          {num(t("Höhe (m)"), hoehe, setHoehe, "wand-hoehe")}
          <button type="button" className={knopf} data-testid="wand-setzen" onClick={wandSetzen}>{t("Wand setzen")}</button>
          <span className="text-muted-foreground">{t("Klick rastet ein, Alt ist frei. 0° zeigt nach +x, 90° nach +z (Süden).")}</span>
        </span>
      )}
      {werkzeuge && (tool === "window" || tool === "door" || tool === "oeffnung") && (
        <span className="flex flex-wrap items-center gap-2" data-testid="oeffnung-mass">
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("Wand")}
            <select className="rounded border border-border bg-card px-1 py-0.5" data-testid="oeffnung-wand" aria-label={t("Wand")} value={wandId} onChange={(e) => setWandId(e.target.value)}>
              <option value="">—</option>
              {waende.map((w) => <option key={w._idx} value={w._idx}>{w._idx}</option>)}
            </select>
          </label>
          {num(t("Abstand (m)"), versatz, setVersatz, "oeffnung-versatz")}
          {num(t("Breite (m)"), breite, setBreite, "oeffnung-breite")}
          {num(t("Höhe (m)"), oHoehe, setOHoehe, "oeffnung-hoehe")}
          {num(t("Brüstung (m)"), bruestung, setBruestung, "oeffnung-bruestung")}
          <button type="button" className={knopf} data-testid="oeffnung-setzen" disabled={wandId === ""} onClick={oeffnungSetzen}>{t("Öffnung setzen")}</button>
        </span>
      )}
      {werkzeuge && tool === "slab" && (
        <span className="flex flex-wrap items-center gap-2" data-testid="decke-mass">
          {num(t("x (m)"), rx, setRx, "decke-x")}
          {num(t("z (m)"), rz, setRz, "decke-z")}
          {num(t("Breite (m)"), rb, setRb, "decke-b")}
          {num(t("Tiefe (m)"), rt, setRt, "decke-t")}
          <button type="button" className={knopf} data-testid="decke-setzen" onClick={() => onDecke(rechteck())}>{t("Decke setzen")}</button>
        </span>
      )}
      {werkzeuge && tool === "zone" && (
        <span className="flex flex-wrap items-center gap-2" data-testid="zone-mass">
          {num(t("x (m)"), rx, setRx, "zone-x")}
          {num(t("z (m)"), rz, setRz, "zone-z")}
          {num(t("Breite (m)"), rb, setRb, "zone-b")}
          {num(t("Tiefe (m)"), rt, setRt, "zone-t")}
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("Name")}
            <input className="w-24 rounded border border-border bg-card px-1 py-0.5" value={name} aria-label={t("Name")} data-testid="zone-name" onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className={knopf} data-testid="zone-setzen" onClick={() => onZone({ ...rechteck(), name: name || undefined })}>{t("Raum setzen")}</button>
        </span>
      )}
      <span className="flex flex-wrap items-center gap-2" data-testid="geschoss-kopieren">
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("von Geschoss")}
          <select className="rounded border border-border bg-card px-1 py-0.5" data-testid="geschoss-kopieren-von" aria-label={t("von Geschoss")} value={von} onChange={(e) => setVon(e.target.value)}>
            {ebenen.map((e) => <option key={e.level} value={e.level}>{e.name}</option>)}
          </select>
        </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("nach Geschoss")}
          <select className="rounded border border-border bg-card px-1 py-0.5" data-testid="geschoss-kopieren-nach" aria-label={t("nach Geschoss")} value={nach} onChange={(e) => setNach(e.target.value)}>
            {ebenen.map((e) => <option key={e.level} value={e.level}>{e.name}</option>)}
          </select>
        </label>
        <button type="button" className={knopf} data-testid="geschoss-kopieren-ausfuehren" onClick={() => onKopieren({ von: Number(von), nach: Number(nach) })}>{t("Geschoss kopieren")}</button>
      </span>
    </div>
  );
}
