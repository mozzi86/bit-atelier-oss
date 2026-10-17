// 73-07 (BEST-08): condition (Zustand) and Erfassungsgrad of a DRAWN element in the BIT-BIM inspector —
// optional attributes on the existing element object (status / erfassung), no new top-level field. Only in
// an existing-building project; a new build keeps today's inspector unchanged. Colours of the status dot
// are the IFC viewer's STATUS_COLORS (one palette for drawn and imported elements). An empty choice removes
// the attribute: a drawn element without status stays "neubau" (normalizeElement, unchanged behaviour), an
// element without Erfassungsgrad stays visibly unknown (never a default).
//
// In:  element object, patch(fields) of its kind, bauart. Out: two inspector rows (plain function, not a
//      component type — the inspector builds rows with a helper and must keep input focus).
import React from "react";
import { STATUS_WERTE, STATUS_LABEL, ERFASSUNG_WERTE, ERFASSUNG_LABEL } from "@core/lib/bimClassification";
import { STATUS_COLORS } from "@ifc/lib/ifcGeometry";

const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/**
 * @param {{status?: string|null, erfassung?: string|null}} el element of customWalls/-Columns/…
 * @param {(patch: object) => void} patch writes fields onto that element
 * @param {{bauart: "neubau"|"bestand", field: (label: string, child: React.ReactNode) => React.ReactNode, selCls: string, t: (s: string) => string}} o
 * @returns {React.ReactNode[]} empty in a new build
 */
export function zustandFelder(el, patch, { bauart, field, selCls, t }) {
  if (bauart !== "bestand" || !el) return [];
  const status = STATUS_WERTE.includes(el.status) ? el.status : "";
  const erfassung = ERFASSUNG_WERTE.includes(el.erfassung) ? el.erfassung : "";
  const farbe = STATUS_COLORS[status || "unbekannt"];
  return [
    field(t("Zustand"), (
      <span className="flex items-center gap-1">
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: rgb(farbe) }} />
        <select className={selCls} value={status} data-testid="el-zustand" onChange={(e) => patch({ status: e.target.value || null })}>
          {/* 97-01 (D-BW-03): an element without status is "ohne Status", never silently new build. */}
          <option value="">{t("noch nicht festgelegt")}</option>
          {STATUS_WERTE.map((w) => <option key={w} value={w}>{t(STATUS_LABEL[w])}</option>)}
        </select>
      </span>
    )),
    field(t("Erfassung"), (
      <select className={selCls} value={erfassung} data-testid="el-erfassung" onChange={(e) => patch({ erfassung: e.target.value || null })}>
        <option value="">{t("unbekannt")}</option>
        {ERFASSUNG_WERTE.map((w) => <option key={w} value={w}>{t(ERFASSUNG_LABEL[w])}</option>)}
      </select>
    )),
  ];
}
