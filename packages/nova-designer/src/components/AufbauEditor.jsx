// Project build-ups in the BIT-BIM inspector (phase 107-03 task 5, D-BK-22): the rows under the "Aufbau" select of a wall.
// Not a second editor — the same inspector; the data lives in the fachlayer `aufbauten_layer`
// ({ aufbauten: { "<id>": { name, skins[{name, material, thickness (mm), color, hatch, schicht?, funktion?, prioritaet?}] } } },
// @core/lib/bauteil/aufbauten.js). The three fixed build-ups stay as they are; "Als Projektaufbau kopieren" makes an editable copy of the
// wall's current build-up (or of its single thickness) in the layer and selects it for the wall. A project build-up lists its layers
// (material, thickness in mm, remove) and can be renamed or extended. Layer function and priority are NOT edited here: they are
// proposed from the material or stated per element in the data sheet rows (SteckbriefFelder, schicht_funktion/schicht_prioritaet).
// The inspector is only about 230 px wide, so the layer rows use the full width (material | mm | remove) instead of label + control.
//
// Removing a layer re-indexes the per-layer settings of the elements that use the build-up (schicht_funktion, schicht_prioritaet,
// schicht_status are stored by layer index), see aufbauten.js overridesNachEntfernen; deleting a build-up leaves the wall with the
// thickness it had (not with a standard build-up).
//
// In:  the current layer value, a setter, the wall's `composite` id and thickness (m), callbacks (select a build-up id for the wall,
//      layer removed, build-up deleted).
// Out: inspector rows (plain function like steckbriefFelder — inputs keep their focus while typing); newProjektAufbauId().
import React from "react";
import { MATERIAL_KATALOG, materialById } from "@core/lib/bauteil/materialien.js";
import { aufbauById } from "@core/lib/bauteil/aufbauten.js";

/** [ASSUMED] thickness in mm of a layer added in the editor (a typical masonry/insulation layer); the user edits it right away. Way to a proven value: the material's catalogue thickness once the catalogue carries one. */
const NEUE_SCHICHT_MM = 100;
/** [ASSUMED] total thickness in m of a wall without build-up and without own thickness (the default of the wall tool). */
const RUECKFALL_DICKE_M = 0.3;

/** Value of an empty `aufbauten_layer` (no project build-ups). */
export const AUFBAUTEN_LEER = Object.freeze({ aufbauten: Object.freeze({}) });

const KNOPF = "rounded border border-border bg-card px-1.5 py-0.5 text-[11px] hover:bg-muted";
const FELD = "rounded border border-border bg-card px-1 py-0.5";

/**
 * Next free id for a new project build-up: "p-1", "p-2" … (never a fixed id like "cavity").
 * @param {{aufbauten?: Record<string, any>}|null|undefined} layer current layer value
 * @returns {string}
 */
export function newProjektAufbauId(layer) {
  const ids = Object.keys(layer?.aufbauten || {});
  const max = Math.max(0, ...ids.map((id) => Number(/^p-(\d+)$/.exec(id)?.[1]) || 0));
  return `p-${max + 1}`;
}

/**
 * Rows to copy the wall's build-up into the project and to edit a project build-up.
 * @param {{layer: {aufbauten?: Record<string, any>}|null, setLayer: (f: (alt: any) => any) => void, composite: string|null|undefined, dicke_m?: number|null,
 *   waehlen: (id: string|null, dicke_m?: number) => void, verwendet: (id: string) => number, schichtEntfernt?: (id: string, index: number) => void, geloescht?: (id: string) => void,
 *   field: (label: string, child: React.ReactNode) => React.ReactNode, selCls: string, numCls: string, t: (s: string) => string}} o
 *   composite: id of the wall's build-up (null = none, the wall has only its own thickness); dicke_m: that thickness in m; waehlen: selects a
 *   build-up id for the wall, `null` + thickness in m takes the build-up away and keeps the thickness; verwendet: how many elements use an id
 *   (deleting is only offered while no other element uses it); schichtEntfernt: called with the id and the 0-based index (outside → inside) of a removed
 *   layer so the elements can re-index their per-layer settings; geloescht: called with the id of a deleted build-up (tool default, favourites);
 *   field/selCls/numCls: the inspector helpers
 * @returns {React.ReactNode[]}
 */
export function aufbauEditorFelder({ layer, setLayer, composite, dicke_m = null, waehlen, verwendet, schichtEntfernt, geloescht, field, t }) {
  const eintrag = composite ? layer?.aufbauten?.[composite] : null;
  /** @param {string} id @param {(e: any) => any} f */
  const aendere = (id, f) => setLayer((alt) => ({ ...(alt || {}), aufbauten: { ...(alt?.aufbauten || {}), [id]: f(alt?.aufbauten?.[id]) } }));
  const kopieren = () => {
    const id = newProjektAufbauId(layer);
    const quelle = composite ? aufbauById(composite) : null;
    const skins = quelle ? quelle.skins.map((s) => ({ ...s })) : [{ name: t("Wand"), material: "", thickness: Math.round((dicke_m || RUECKFALL_DICKE_M) * 1000), color: "#e2e8f0", hatch: "none" }];
    setLayer((alt) => ({ ...(alt || {}), aufbauten: { ...(alt?.aufbauten || {}), [id]: { name: `${quelle?.name || t("Wand")} (${t("Projekt")})`, skins } } }));
    waehlen(id);
  };
  /** @param {string} key @param {React.ReactNode} child */
  const zeile = (key, child) => <div key={key} className="flex items-center gap-1 px-3 py-0.5 text-[11px]">{child}</div>;
  /** @type {React.ReactNode[]} */
  const rows = [
    zeile("aufbau-kopieren", <button type="button" className={`${KNOPF} w-full`} data-testid="aufbau-kopieren" onClick={kopieren}>{t("Als Projektaufbau kopieren")}</button>),
  ];
  if (!eintrag) return rows;
  rows.push(field(t("Name"), (
    <input className={`${FELD} w-28`} value={eintrag.name ?? ""} data-testid="aufbau-name" aria-label={t("Name des Aufbaus")}
      onChange={(e) => aendere(composite, (alt) => ({ ...alt, name: e.target.value }))} />
  )));
  (eintrag.skins || []).forEach((sk, i) => {
    const mat = materialById(sk.material);
    /** @param {(s: any) => any} f */
    const skin = (f) => aendere(composite, (alt) => ({ ...alt, skins: (alt?.skins || []).map((x, j) => (j === i ? f(x) : x)) }));
    rows.push(zeile(`aufbau-schicht-${i}`, (
      <>
        <select className={`${FELD} min-w-0 flex-1`} value={sk.material || ""} data-testid={`aufbau-material-${i}`} aria-label={`${t("Material")} ${i + 1}`}
          onChange={(e) => { const m = materialById(e.target.value); skin((x) => ({ ...x, material: e.target.value, ...(m ? { name: m.name, color: m.color, hatch: m.hatch, schicht: m.schicht ?? undefined } : {}) })); }}>
          <option value="">{t("offen")}</option>
          {MATERIAL_KATALOG.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="number" className={`${FELD} w-14 shrink-0 text-right`} step="5" min="1" max="1000" value={sk.thickness} data-testid={`aufbau-dicke-${i}`}
          aria-label={`${t("Dicke (mm)")} ${i + 1}`} title={`${t("Dicke (mm)")} — ${mat ? mat.name : t("offen")}`}
          onChange={(e) => { const v = +e.target.value; if (v > 0) skin((x) => ({ ...x, thickness: v })); }} />
        <button type="button" className={`${KNOPF} shrink-0 !px-1`} aria-label={`${t("Schicht entfernen")} ${i + 1}`}
          disabled={(eintrag.skins || []).length <= 1}
          title={verwendet(composite) > 0 ? `${t("Schicht entfernen")} — ${t("Die Einstellungen je Schicht (Funktion, Priorität, Status) der Elemente wandern mit den übrigen Schichten")}` : t("Schicht entfernen")}
          onClick={() => { aendere(composite, (alt) => ({ ...alt, skins: (alt?.skins || []).filter((_, j) => j !== i) })); schichtEntfernt?.(composite, i); }}>×</button>
      </>
    )));
  });
  rows.push(zeile("aufbau-schicht-neu", (
    <button type="button" className={`${KNOPF} w-full`} data-testid="aufbau-schicht-neu"
      onClick={() => aendere(composite, (alt) => ({ ...alt, skins: [...(alt?.skins || []), { name: t("Schicht"), material: "", thickness: NEUE_SCHICHT_MM, color: "#e2e8f0", hatch: "none" }] }))}>
      + {t("Schicht hinzufügen")}
    </button>
  )));
  // deleting is only offered while no OTHER element uses the build-up; the wall keeps the total thickness it had (no jump to a standard build-up)
  if (verwendet(composite) <= 1) {
    const gesamt_m = Math.round((eintrag.skins || []).reduce((a, s) => a + (Number(s.thickness) || 0), 0)) / 1000;
    rows.push(zeile("aufbau-loeschen", (
      <button type="button" className={`${KNOPF} w-full`} data-testid="aufbau-loeschen"
        onClick={() => { setLayer((alt) => { const { [composite]: _weg, ...rest } = alt?.aufbauten || {}; return { ...(alt || {}), aufbauten: rest }; }); waehlen(null, gesamt_m || RUECKFALL_DICKE_M); geloescht?.(composite); }}>
        {t("Aufbau löschen")}
      </button>
    )));
  }
  return rows;
}
