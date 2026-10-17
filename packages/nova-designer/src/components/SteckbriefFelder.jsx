// 97-02a: element data sheet rows in the BIT-BIM inspector — IFC class, type, cost group, trade
// (STLB-Bau LB with site order), build-up, quantity, construction section, GUID. Values that are
// only derived from the element type are marked "Annahme" so nothing assumed looks decided; open
// fields are listed. Editable: type (walls), KG, trade, section — stored as optional fields on the
// element (bauteil_typ, kg, gewerk_lb, bauabschnitt), nothing else changes.
//
// In:  data sheet (steckbrief() of @core), patch(fields) of the element, inspector helpers.
// Out: inspector rows (plain function like zustandFelder — keeps input focus while typing).
import React from "react";
import { BAUTEIL_TYPEN } from "@core/lib/bauteil/steckbrief.js";
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";

const WAND_TYPEN = ["wand-aussen", "wand-tragend", "wand-innen", "zumauerung"];
const STATUS_WAHL = ["bestand", "abbruch", "neubau"];
const EINHEIT = { m2: "m²", m3: "m³", m: "m", Stk: "Stk" };
/** Readable names of the data-sheet fields (German UI strings, i18n keys). */
const FELD_LABEL = { typ: "Bauteiltyp", ifc: "IFC-Klasse", material: "Material", kg: "Kostengruppe", gewerk: "Gewerk", bauabschnitt: "Bauabschnitt" };

/**
 * @param {import("@core/lib/bauteil/steckbrief.js").Steckbrief} s data sheet
 * @param {((patch: object) => void)|null} patch writes fields onto the element; null = read only
 * @param {{field: (label: string, child: React.ReactNode) => React.ReactNode, selCls: string, t: (s: string) => string, schichtStatus?: {wert: Record<string, string>|null}|null}} o
 *   schichtStatus: current schicht_status of the element — layer rows only when given (existing projects)
 * @returns {React.ReactNode[]}
 */
export function steckbriefFelder(s, patch, { field, selCls, t, schichtStatus = null }) {
  if (!s) return [];
  // A small amber dot instead of a text badge: the inspector is 230 px wide and the selects need it.
  const annahme = (feld) => (s.quelle[feld] === "abgeleitet"
    ? <span role="img" aria-label={t("Annahme")} title={t("aus dem Bauteiltyp abgeleitet — bitte bestätigen")} data-annahme={feld}
        className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
    : null);
  const hatAnnahme = Object.values(s.quelle).includes("abgeleitet");
  const txtCls = "w-24 rounded border border-slate-300 px-1 py-0.5 bg-white";
  const rows = [
    <div key="sb-kopf" className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400" data-testid="steckbrief">{t("Steckbrief")}</div>,
    field(t("Bauteiltyp"), patch && WAND_TYPEN.includes(s.typ)
      ? <span className="flex items-center"><select className={selCls} value={s.typ} data-testid="sb-typ" onChange={(e) => patch({ bauteil_typ: e.target.value })}>
          {WAND_TYPEN.map((k) => <option key={k} value={k}>{t(BAUTEIL_TYPEN[k].label)}</option>)}
        </select>{annahme("typ")}</span>
      : <span className="text-slate-500">{t(s.label)}{annahme("typ")}</span>),
    field("IFC", <span className="font-mono text-[10px] text-slate-500" data-testid="sb-ifc">{s.ifc.klasse} · {s.ifc.typ}</span>),
    field(t("Kostengruppe"), patch
      ? <span className="flex items-center"><input className="w-14 rounded border border-slate-300 px-1 py-0.5 bg-white text-right" inputMode="numeric" maxLength={3} value={s.kg ?? ""} placeholder={t("offen")} data-testid="sb-kg"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); patch({ kg: v || null }); }} />{annahme("kg")}</span>
      : <span className="text-slate-500">{s.kg ?? t("offen")}</span>),
    field(t("Gewerk"), patch
      ? <span className="flex items-center"><select className={selCls} value={s.gewerk?.lb ?? ""} data-testid="sb-gewerk" onChange={(e) => patch({ gewerk_lb: e.target.value || null })}>
          <option value="">{t("offen")}</option>
          {STLB_LB.map((g) => <option key={g.lb} value={g.lb}>{g.lb} {g.name}</option>)}
        </select>{annahme("gewerk")}</span>
      : <span className="text-slate-500">{s.gewerk ? `${s.gewerk.lb} ${s.gewerk.name}` : t("offen")}</span>),
    field(t("Material"), <span className="text-right text-slate-500" title={s.aufbau ? s.aufbau.schichten.map((l) => `${l.name} ${Math.round(l.dicke_m * 1000)} mm`).join(" · ") : ""}>
      {s.material ?? t("offen")}{annahme("material")}</span>),
    // 97-05: status per layer (only where the element has layers and a status matters: existing projects).
    ...(patch && schichtStatus && s.aufbau?.schichten?.length > 1 ? s.aufbau.schichten.map((l, i) => field(`${t("Schicht")} ${i + 1}: ${l.name}`, (
      <select className={selCls} value={l.statusGeerbt ? "" : l.status ?? ""} data-testid={`sb-schicht-${i}`}
        onChange={(e) => patch({ schicht_status: { ...(schichtStatus.wert || {}), [i]: e.target.value || undefined } })}>
        <option value="">{t("wie Bauteil")}</option>
        {STATUS_WAHL.map((st) => <option key={st} value={st}>{t(st === "bestand" ? "Bestand" : st === "abbruch" ? "Abbruch" : "Neubau")}</option>)}
      </select>
    ))) : []),
    field(t("Menge"), <span className="text-slate-500" data-testid="sb-menge">{s.menge.wert.toLocaleString("de-DE")} {EINHEIT[s.menge.einheit] || s.menge.einheit}</span>),
    field(t("Bauabschnitt"), patch
      ? <input className={txtCls} value={s.bauabschnitt ?? ""} placeholder={t("offen")} data-testid="sb-abschnitt" onChange={(e) => patch({ bauabschnitt: e.target.value || null })} />
      : <span className="text-slate-500">{s.bauabschnitt ?? t("offen")}</span>),
    field("GUID", <span className="font-mono text-[10px] text-slate-400" title={s.guid}>{s.guid.slice(0, 10)}…</span>),
  ];
  const hinweise = [...s.annahmen.map((h) => t(h))];
  if (hatAnnahme) hinweise.unshift(`● ${t("aus dem Bauteiltyp abgeleitet — bitte bestätigen")}`);
  const offen = s.offen.filter((f) => f !== "status");
  if (offen.length) hinweise.push(`${t("Offen")}: ${offen.map((f) => t(FELD_LABEL[f] || f)).join(", ")}`);
  if (hinweise.length) rows.push(<div key="sb-hinweis" className="px-3 py-1 text-[10px] leading-snug text-amber-700" data-testid="sb-hinweise">{hinweise.map((h) => <div key={h}>{h}</div>)}</div>);
  return rows;
}
