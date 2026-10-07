import React, { useRef } from "react";

const TYPE_GLYPH = { robot: "🤖", drone: "🚁", truck: "🚚", printer: "🖨️" };
const STATUS_COLOR = {
  working: "#10b981",
  loading: "#f59e0b",
  enroute: "#3b82f6",
  charging: "#a855f7",
  idle: "#94a3b8",
  stopped: "#ef4444",
  safety_stop: "#f43f5e",
  geofence_stop: "#e11d48",
};
const SAFETY_RADIUS = 9;

const ZONES = [
  { id: "charge", x: 84, y: 78, w: 14, h: 18, label: "Ladezone", fill: "#a855f7" },
  { id: "deliver", x: 2, y: 78, w: 22, h: 20, label: "Abladezone", fill: "#f59e0b" },
  { id: "north", x: 18, y: 12, w: 30, h: 28, label: "Rohbau Nord", fill: "#3b82f6" },
  { id: "south", x: 58, y: 45, w: 30, h: 28, label: "Rohbau Süd", fill: "#10b981" },
];
// Restricted / no-go zones for autonomous units.
const RESTRICTED = [{ x: 46, y: 6, w: 14, h: 14, label: "Sperrzone Kran" }];

export default function SitePlan({ units = [], workers = [], zones = [], selectedId, onSelectUnit, onPlanClick, ar = false }) {
  const svgRef = useRef(null);

  const handleClick = (e) => {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const x = +(((e.clientX - rect.left) / rect.width) * 100).toFixed(1);
    const y = +(((e.clientY - rect.top) / rect.height) * 100).toFixed(1);
    onPlanClick?.({ x, y });
  };

  const grid = ar ? "#1e3a5f" : "#e2e8f0";
  const bg = ar ? "#0b1220" : "#f8fafc";

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      onClick={handleClick}
      className="w-full h-full cursor-crosshair select-none"
      style={{ background: bg, borderRadius: 12 }}
    >
      {/* grid */}
      {Array.from({ length: 11 }).map((_, i) => (
        <g key={i}>
          <line x1={i * 10} y1="0" x2={i * 10} y2="100" stroke={grid} strokeWidth="0.2" />
          <line x1="0" y1={i * 10} x2="100" y2={i * 10} stroke={grid} strokeWidth="0.2" />
        </g>
      ))}

      {/* zones */}
      {ZONES.map((z) => (
        <g key={z.id}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} fill={z.fill} fillOpacity={ar ? 0.16 : 0.1} stroke={z.fill} strokeWidth="0.3" strokeDasharray="1 1" rx="1.5" />
          <text x={z.x + 1} y={z.y + 3} fontSize="2.4" fill={ar ? "#7dd3fc" : "#64748b"}>{z.label}</text>
        </g>
      ))}

      {/* restricted zones (legacy static decoration, only when no live geofences are passed) */}
      {zones.length === 0 && RESTRICTED.map((z, i) => (
        <g key={i} style={{ pointerEvents: "none" }}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="#ef4444" fillOpacity="0.18" stroke="#ef4444" strokeWidth="0.4" rx="1" />
          <text x={z.x + z.w / 2} y={z.y + z.h / 2} fontSize="2.2" fill="#ef4444" textAnchor="middle">⛔ {z.label}</text>
        </g>
      ))}

      {/* geofences (live restricted zones, enforced by the simulation) */}
      <g style={{ pointerEvents: "none" }}>
        {zones.map((z) =>
          z.active ? (
            <g key={z.id}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="#f43f5e" fillOpacity="0.18" stroke="#e11d48" strokeWidth="0.4" strokeDasharray="1.5 1" rx="1" />
              <text x={z.x + z.w / 2} y={z.y + z.h / 2} fontSize="2.2" fill="#e11d48" textAnchor="middle">⛔ {z.name}</text>
            </g>
          ) : (
            <g key={z.id}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="#94a3b8" fillOpacity="0.08" stroke="#94a3b8" strokeWidth="0.3" strokeDasharray="1.5 1" rx="1" />
              <text x={z.x + z.w / 2} y={z.y + z.h / 2} fontSize="2" fill="#94a3b8" textAnchor="middle">{z.name} (inaktiv)</text>
            </g>
          )
        )}
      </g>

      {/* movement target lines */}
      {units.filter((u) => u.target).map((u) => (
        <line key={`t-${u.id}`} x1={u.x} y1={u.y} x2={u.target.x} y2={u.target.y} stroke={STATUS_COLOR[u.status] || "#3b82f6"} strokeWidth="0.3" strokeDasharray="1.5 1" opacity="0.6" />
      ))}

      {/* workers with safety radius */}
      {workers.map((w) => (
        <g key={w.id}>
          <circle cx={w.x} cy={w.y} r={SAFETY_RADIUS} fill="#f43f5e" fillOpacity="0.1" stroke="#f43f5e" strokeWidth="0.3" strokeDasharray="1 1" />
          <text x={w.x} y={w.y + 1.2} fontSize="3.4" textAnchor="middle">👷</text>
          <text x={w.x} y={w.y + 6} fontSize="1.9" textAnchor="middle" fill={ar ? "#fda4af" : "#e11d48"}>{w.name}</text>
        </g>
      ))}

      {/* units */}
      {units.map((u) => {
        const color = STATUS_COLOR[u.status] || "#94a3b8";
        const selected = u.id === selectedId;
        return (
          <g
            key={u.id}
            onClick={(e) => { e.stopPropagation(); onSelectUnit?.(u.id); }}
            style={{ cursor: "pointer" }}
          >
            {selected && <circle cx={u.x} cy={u.y} r="4.6" fill="none" stroke={color} strokeWidth="0.5" opacity="0.9" />}
            <circle cx={u.x} cy={u.y} r="3.2" fill={ar ? "#0b1220" : "#ffffff"} stroke={color} strokeWidth="0.7" />
            {/* battery arc indicator */}
            <circle cx={u.x} cy={u.y} r="3.2" fill="none" stroke={u.battery < 20 ? "#ef4444" : color} strokeWidth="0.5"
              strokeDasharray={`${(u.battery / 100) * 20.1} 20.1`} transform={`rotate(-90 ${u.x} ${u.y})`} opacity="0.8" />
            <text x={u.x} y={u.y + 1.1} fontSize="3" textAnchor="middle">{TYPE_GLYPH[u.type] || "•"}</text>
            <text x={u.x} y={u.y + 5.6} fontSize="1.9" textAnchor="middle" fill={ar ? "#cbd5e1" : "#475569"}>
              {u.name.split(" ").slice(-1)[0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
