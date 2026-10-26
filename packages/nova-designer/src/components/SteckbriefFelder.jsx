// 97-02a: element data sheet rows in the BIT-BIM inspector — IFC class, type, cost group, trade
// (STLB-Bau LB with site order), build-up, quantity, construction section, GUID. Values that are
// only derived from the element type are marked "Annahme" so nothing assumed looks decided; open
// fields are listed. Editable: type (walls), KG, trade, section — stored as optional fields on the
// element (bauteil_typ, kg, gewerk_lb, bauabschnitt), nothing else changes.
// 107-03: one row per layer of a layered build-up with the layer FUNCTION (core / covering / other) and the intersection PRIORITY
// (0-999), stored as the element's `schicht_funktion` / `schicht_prioritaet` ({ "<layer index>": value }, outside → inside). Without an
// entry the build-up's own value or a proposal from the material applies; the empty choice names it ("Vorschlag: Kern" = derived).
//
// In:  data sheet (steckbrief() of @core), patch(fields) of the element, inspector helpers.
// Out: inspector rows (plain function like zustandFelder — keeps input focus while typing);
//      SteckbriefKasten — the same rows as a block for the TGA, structure and opening editors (100-02).
import React from "react";
import { BAUTEIL_TYPEN } from "@core/lib/bauteil/steckbrief.js";
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";

const WAND_TYPEN = ["wand-aussen", "wand-tragend", "wand-innen", "zumauerung"];
const STATUS_WAHL = ["bestand", "abbruch", "neubau"];
const EINHEIT = { m2: "m²", m3: "m³", m: "m", Stk: "Stk" };
/** Readable names of the data-sheet fields (German UI strings, i18n keys). */
/** German names of the layer functions (i18n keys; "Kern" and "Bekleidung" exist in other parts). */
const FUNKTION_LABEL = { kern: "Kern", bekleidung: "Bekleidung", sonstig: "Sonstig" };
const FELD_LABEL = { typ: "Bauteiltyp", ifc: "IFC-Klasse", material: "Material", kg: "Kostengruppe", gewerk: "Gewerk", bauabschnitt: "Bauabschnitt" };

/**
 * @param {import("@core/lib/bauteil/steckbrief.js").Steckbrief} s data sheet
 * @param {((patch: object) => void)|null} patch writes fields onto the element; null = read only
 * @param {{field: (label: string, child: React.ReactNode) => React.ReactNode, selCls: string, t: (s: string) => string, schichtStatus?: {wert: Record<string, string>|null}|null, schichtDetail?: {funktion: Record<string, string>|null, prioritaet: Record<string, number>|null}|null}} o
 *   schichtStatus: current schicht_status of the element — layer rows only when given (existing projects)
 *   schichtDetail: current schicht_funktion / schicht_prioritaet of the element — function/priority rows only when given and the build-up has several layers (107-03)
 * @returns {React.ReactNode[]}
 */
export function steckbriefFelder(s, patch, { field, selCls, t, schichtStatus = null, schichtDetail = null }) {
  if (!s) return [];
  // A small amber dot instead of a text badge: the inspector is 230 px wide and the selects need it.
  const annahme = (feld) => (s.quelle[feld] === "abgeleitet"
    ? <span role="img" aria-label={t("Annahme")} title={t("aus dem Bauteiltyp abgeleitet — bitte bestätigen")} data-annahme={feld}
        className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warnung" />
    : null);
  const hatAnnahme = Object.values(s.quelle).includes("abgeleitet");
  const txtCls = "w-24 rounded border border-border px-1 py-0.5 bg-card";
  const rows = [
    <div key="sb-kopf" className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" data-testid="steckbrief">{t("Steckbrief")}</div>,
    field(t("Bauteiltyp"), patch && WAND_TYPEN.includes(s.typ)
      ? <span className="flex items-center"><select className={selCls} value={s.typ} data-testid="sb-typ" onChange={(e) => patch({ bauteil_typ: e.target.value })}>
          {WAND_TYPEN.map((k) => <option key={k} value={k}>{t(BAUTEIL_TYPEN[k].label)}</option>)}
        </select>{annahme("typ")}</span>
      : <span className="text-muted-foreground">{t(s.label)}{annahme("typ")}</span>),
    field("IFC", <span className="font-mono text-[10px] text-muted-foreground" data-testid="sb-ifc">{s.ifc.klasse} · {s.ifc.typ}</span>),
    field(t("Kostengruppe"), patch
      ? <span className="flex items-center"><input className="w-14 rounded border border-border px-1 py-0.5 bg-card text-right" inputMode="numeric" maxLength={3} value={s.kg ?? ""} placeholder={t("offen")} data-testid="sb-kg"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); patch({ kg: v || null }); }} />{annahme("kg")}</span>
      : <span className="text-muted-foreground">{s.kg ?? t("offen")}</span>),
    field(t("Gewerk"), patch
      ? <span className="flex items-center"><select className={selCls} value={s.gewerk?.lb ?? ""} data-testid="sb-gewerk" onChange={(e) => patch({ gewerk_lb: e.target.value || null })}>
          <option value="">{t("offen")}</option>
          {STLB_LB.map((g) => <option key={g.lb} value={g.lb}>{g.lb} {g.name}</option>)}
        </select>{annahme("gewerk")}</span>
      : <span className="text-muted-foreground">{s.gewerk ? `${s.gewerk.lb} ${s.gewerk.name}` : t("offen")}</span>),
    field(t("Material"), <span className="text-right text-muted-foreground" title={s.aufbau ? s.aufbau.schichten.map((l) => `${l.name} ${Math.round(l.dicke_m * 1000)} mm`).join(" · ") : ""}>
      {s.material ?? t("offen")}{annahme("material")}</span>),
    // 97-05: status per layer (only where the element has layers and a status matters: existing projects).
    ...(patch && schichtStatus && s.aufbau?.schichten?.length > 1 ? s.aufbau.schichten.map((l, i) => field(`${t("Schicht")} ${i + 1}: ${l.name}`, (
      <select className={selCls} value={l.statusGeerbt ? "" : l.status ?? ""} data-testid={`sb-schicht-${i}`}
        onChange={(e) => patch({ schicht_status: { ...(schichtStatus.wert || {}), [i]: e.target.value || undefined } })}>
        <option value="">{t("wie Bauteil")}</option>
        {STATUS_WAHL.map((st) => <option key={st} value={st}>{t(st === "bestand" ? "Bestand" : st === "abbruch" ? "Abbruch" : "Neubau")}</option>)}
      </select>
    ))) : []),
    // 107-03: function and priority per layer of a layered build-up (not for a thickness-only wall: its single layer is the core)
    ...(patch && schichtDetail && s.aufbau && s.aufbau.quelle !== "dicke" && s.aufbau.schichten.length > 1 ? [
      <div key="sb-funktion-kopf" className="flex items-center justify-between px-3 pt-1 text-[10px] text-muted-foreground"><span>{t("Funktion der Schicht")}</span><span>{t("Priorität der Schicht")}</span></div>,
      ...s.aufbau.schichten.map((l, i) => {
      const eigenF = schichtDetail.funktion?.[i] ?? "", eigenP = schichtDetail.prioritaet?.[i];
      /** @param {Record<string, any>|null|undefined} alt @param {any} wert */
      const mit = (alt, wert) => { const neu = { ...(alt || {}) }; if (wert === "" || wert == null) delete neu[i]; else neu[i] = wert; return Object.keys(neu).length ? neu : undefined; };
      // full-width row (the inspector is ~230 px wide): layer number, function, priority — a label column would wrap every row over four lines
      return (
        <div key={`sb-funktion-zeile-${i}`} className="flex items-center gap-1 px-3 py-0.5 text-[11px]" title={l.name}>
          <span className="w-3 shrink-0 text-muted-foreground">{i + 1}</span>
          <select className="min-w-0 flex-1 rounded border border-border px-1 py-0.5 bg-card" value={eigenF} data-testid={`sb-funktion-${i}`} aria-label={`${t("Funktion der Schicht")} ${i + 1}: ${l.name}`} title={t("Funktion der Schicht (Kern, Bekleidung, Sonstig); Vorschlag = abgeleitet aus dem Material")}
            onChange={(e) => patch({ schicht_funktion: mit(schichtDetail.funktion, e.target.value) })}>
            {/* no own value: the empty choice names the effective one; with an own value it names the way back */}
            <option value="">{eigenF ? t("Aufbau / Vorschlag") : `${l.funktionAbgeleitet ? t("Vorschlag") : l.funktionAnnahme ? t("Annahme") : t("wie Aufbau")}: ${t(FUNKTION_LABEL[l.funktion])}`}</option>
            {Object.entries(FUNKTION_LABEL).map(([k, lab]) => <option key={k} value={k}>{t(lab)}</option>)}
          </select>
          {/* the origin of the priority: own value, stated in the build-up, or a proposal (shown italic, named in the tooltip and in data-herkunft) */}
          <input className={`w-11 shrink-0 rounded border border-border px-1 py-0.5 bg-card text-right ${eigenP == null && l.prioritaetAbgeleitet ? "placeholder:italic" : ""}`} inputMode="numeric" maxLength={3} value={eigenP ?? ""} placeholder={String(l.prioritaet)}
            data-testid={`sb-prioritaet-${i}`} data-herkunft={eigenP != null ? "gesetzt" : l.prioritaetAbgeleitet ? "abgeleitet" : "aufbau"} aria-label={`${t("Priorität der Schicht")} ${i + 1}: ${l.name}`}
            title={`${t("Verschneidungspriorität 0 bis 999; wirkt erst, wenn Wände verschneiden")} — ${eigenP != null ? t("Priorität: am Element gesetzt") : l.prioritaetAbgeleitet ? t("Priorität: Vorschlag, abgeleitet aus dem Material") : t("Priorität: im Aufbau festgelegt")}`}
            onChange={(e) => {
              // digits only, whole numbers 0 to 999 (a letter, minus or decimal point never reaches the store)
              const v = e.target.value.replace(/\D/g, "").slice(0, 3);
              const n = Number(v);
              patch({ schicht_prioritaet: mit(schichtDetail.prioritaet, v === "" || !Number.isInteger(n) ? "" : Math.min(999, n)) });
            }} />
        </div>
      );
    })] : []),
    // 106-03: fire resistance and structural note, set through the change tools (read-only here; shown only when set)
    ...(s.feuerwiderstand ? [field(t("Feuerwiderstand"), <span className="text-muted-foreground" data-testid="sb-feuerwiderstand">{s.feuerwiderstand === "ohne" ? t("ohne") : s.feuerwiderstand}</span>)] : []),
    ...(s.statik_vermerk ? [field(t("Statik-Vermerk"), <span className="max-w-[9rem] truncate text-muted-foreground" title={s.statik_vermerk} data-testid="sb-statik-vermerk">{s.statik_vermerk}</span>)] : []),
    field(t("Menge"), <span className="text-muted-foreground" data-testid="sb-menge">{s.menge.wert.toLocaleString("de-DE")} {EINHEIT[s.menge.einheit] || s.menge.einheit}</span>),
    field(t("Bauabschnitt"), patch
      ? <input className={txtCls} value={s.bauabschnitt ?? ""} placeholder={t("offen")} data-testid="sb-abschnitt" onChange={(e) => patch({ bauabschnitt: e.target.value || null })} />
      : <span className="text-muted-foreground">{s.bauabschnitt ?? t("offen")}</span>),
    field("GUID", <span className="font-mono text-[10px] text-muted-foreground" title={s.guid}>{s.guid.slice(0, 10)}…</span>),
  ];
  const hinweise = [...s.annahmen.map((h) => t(h))];
  if (hatAnnahme) hinweise.unshift(`● ${t("aus dem Bauteiltyp abgeleitet — bitte bestätigen")}`);
  const offen = s.offen.filter((f) => f !== "status");
  if (offen.length) hinweise.push(`${t("Offen")}: ${offen.map((f) => t(FELD_LABEL[f] || f)).join(", ")}`);
  if (hinweise.length) rows.push(<div key="sb-hinweis" className="px-3 py-1 text-[10px] leading-snug text-warnung" data-testid="sb-hinweise">{hinweise.map((h) => <div key={h}>{h}</div>)}</div>);
  return rows;
}

/**
 * The data sheet as a block for editors outside the BIT-BIM inspector (100-02: TGA network, structure,
 * openings). Module-level component, so its inputs keep focus while typing.
 * @param {{s: import("@core/lib/bauteil/steckbrief.js").Steckbrief|null, patch?: ((p: object) => void)|null, t: (s: string) => string, testId?: string}} props
 */
export function SteckbriefKasten({ s, patch = null, t, testId = "steckbrief-kasten" }) {
  if (!s) return null;
  const field = (/** @type {string} */ label, /** @type {React.ReactNode} */ child) => (
    <div key={label} className="flex items-center justify-between gap-2 px-3 py-0.5 text-xs"><span className="text-muted-foreground">{label}</span>{child}</div>
  );
  return (
    <div className="rounded-md border border-border bg-card pb-1" data-testid={testId}>
      {steckbriefFelder(s, patch, { field, selCls: "max-w-[11rem] rounded border border-border bg-card px-1 py-0.5 text-xs", t })}
    </div>
  );
}
