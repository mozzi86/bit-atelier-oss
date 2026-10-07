// Generic site plan on the Plan-Werkstatt core (Phase 37, GARTEN-01 — the "Lageplan-Kern" Phase 63 reuses).
// BimPlan2D readOnly shows the building; this component widens the plan to the parcel (or footprint + margin),
// paints the site context (footprint grey, drawn parcel, OSM greens/trees, optional building shadow) and then
// hands the same live transformers to the caller's overlay. Knows nothing about plants or drainage.
//
// In:  plan (usePlanModel result), parzelleM (lageplan.parzelleInMetern), osm (useOsmEnvironment result),
//      schattenPolys (sonnenstand.schattenPolygone or null), overlay(args), onKlick(pMetres), extraBounds.
// Out: rendering only. Coordinates in metres (x east, z south).

import React, { useMemo } from "react";
import { lageplanExtent } from "@designer/lib/lageplan";
import BimPlan2D from "./BimPlan2D";

/** Plan layers hidden on a site plan — the building reads as a grey block (GARTEN-01). */
const LAGEPLAN_LAYER = { zones: false, labels: false, dimensions: false, openings: false, walls: false, columns: false };
/** Crown diameter drawn for OSM context trees ([ASSUMED] 6 m — OSM carries no crown size). */
export const OSM_BAUM_KRONE_M = 6;
/** Context beyond the plan extent is dropped to keep the SVG light (m). */
const KONTEXT_RAND_M = 20;

const inBox = (p, b) => p.x >= b.minX - KONTEXT_RAND_M && p.x <= b.maxX + KONTEXT_RAND_M && p.z >= b.minZ - KONTEXT_RAND_M && p.z <= b.maxZ + KONTEXT_RAND_M;
const bbox = (pts) => ({ minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)) });

/**
 * @param {{ plan: any, parzelleM?: Array<{x:number,z:number}>|null, osm?: { trees?: Array<{x:number,z:number}>, greens?: Array<Array<{x:number,z:number}>> }|null,
 *   schattenPolys?: Array<Array<{x:number,z:number}>>|null, overlay?: (args: any) => any, onKlick?: (p: {x:number,z:number}) => void,
 *   extraBounds?: Array<{x:number,z:number}>, height?: number, testid?: string }} props
 */
export default function LageplanPlan({ plan, parzelleM = null, osm = null, schattenPolys = null, overlay, onKlick, extraBounds = [], height = 460, testid = "lp-overlay" }) {
  const footprint = plan?.model?.footprint || [];
  const extent = useMemo(() => lageplanExtent(footprint, parzelleM), [footprint, parzelleM]);
  const box = useMemo(() => bbox(extent), [extent]);
  const greens = useMemo(() => (osm?.greens || []).filter((g) => g.some((p) => inBox(p, box))), [osm, box]);
  const trees = useMemo(() => (osm?.trees || []).filter((p) => inBox(p, box)), [osm, box]);
  if (!plan?.model) return null;
  return (
    <BimPlan2D
      model={plan.model}
      mode="grundriss"
      level={0}
      storeyHeight={plan.storeyHeight}
      readOnly
      layerVis={LAGEPLAN_LAYER}
      unit={plan.unit}
      height={height}
      overlayBounds={[...extent, ...extraBounds]}
      overlay={(args) => {
        const { X, Z, SCALE, toMeters, bounds } = args;
        const poly = (pts) => pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
        return (
          <g data-testid={testid}>
            <g style={{ pointerEvents: "none" }}>
              {/* OSM greens (context) */}
              {greens.map((g, i) => <polygon key={`g${i}`} points={poly(g)} fill="#dcfce7" fillOpacity="0.6" stroke="#86efac" strokeWidth="0.8" />)}
              {/* drawn parcel */}
              {parzelleM && <polygon data-testid="lp-parzelle" points={poly(parzelleM)} fill="#ecfdf5" fillOpacity="0.35" stroke="#059669" strokeWidth="1.5" strokeDasharray="6 4" />}
              {/* building as a grey block */}
              {footprint.length >= 3 && <polygon data-testid="lp-gebaeude" points={poly(footprint)} fill="#cbd5e1" fillOpacity="0.85" stroke="#475569" strokeWidth="1.2" />}
              {/* building shadow (union of edge sweeps + translated footprint) */}
              {schattenPolys && schattenPolys.map((s, i) => <polygon key={`s${i}`} data-testid="lp-schatten" points={poly(s)} fill="#1e293b" fillOpacity="0.10" stroke="none" />)}
              {/* OSM trees */}
              {trees.map((p, i) => (
                <g key={`t${i}`} data-testid="lp-osm-baum">
                  <circle cx={X(p.x)} cy={Z(p.z)} r={Math.max(2, (OSM_BAUM_KRONE_M / 2) * SCALE)} fill="#a3b18a" fillOpacity="0.45" stroke="#6b8e4e" strokeWidth="0.8" />
                  <circle cx={X(p.x)} cy={Z(p.z)} r="1.2" fill="#3f6212" />
                </g>
              ))}
            </g>
            {overlay ? overlay(args) : null}
            {onKlick && (
              <rect x="0" y="0" width={X(bounds.maxX) + X(bounds.minX)} height={Z(bounds.maxZ) + Z(bounds.minZ)} fill="transparent" style={{ cursor: "crosshair" }} data-testid="lp-klick"
                onClick={(e) => { const p = toMeters(e); if (p) onKlick(p); }} />
            )}
          </g>
        );
      }}
    />
  );
}
