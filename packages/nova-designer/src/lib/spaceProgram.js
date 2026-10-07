// Space program (Raumprogramm) → automatic vertical stacking, BIM-2.0 style
// early-stage design from an area brief (à la Hypar / Snaptrude).

// Use catalog: stacking order (0 = ground/bottom), color, default unit area.
export const USES = {
  parken: { label: "Tiefgarage / Parken", color: "#64748b", order: 0, unit: 25, unitLabel: "Stellplatz" },
  technik: { label: "Technik / Lager", color: "#94a3b8", order: 1, unit: 40, unitLabel: "Einheit" },
  handel: { label: "Einzelhandel", color: "#f59e0b", order: 2, unit: 150, unitLabel: "Laden" },
  gastronomie: { label: "Gastronomie", color: "#ef4444", order: 2, unit: 120, unitLabel: "Lokal" },
  gewerbe: { label: "Gewerbe", color: "#14b8a6", order: 2, unit: 200, unitLabel: "Einheit" },
  buero: { label: "Büro", color: "#8b5cf6", order: 3, unit: 25, unitLabel: "Arbeitsplatz" },
  gemeinschaft: { label: "Gemeinschaft", color: "#10b981", order: 3, unit: 60, unitLabel: "Raum" },
  wohnen: { label: "Wohnen", color: "#3b82f6", order: 4, unit: 70, unitLabel: "Wohnung" },
};

export const usageInfo = (key) => USES[key] || { label: key, color: "#cbd5e1", order: 5, unit: 50, unitLabel: "Einheit" };

// total programmed usable area (NUF) of an item
export const itemArea = (it) => (Number(it.area) || 0) * (Number(it.count) || 0);

// Greedy vertical stacking: fills floors bottom-up by use order. A use can span
// several floors; a floor can mix the tail of one use with the start of the next.
export function autoStack(items, floorArea, efficiency = 0.8) {
  const fa = Math.max(1, Number(floorArea) || 1);
  // remaining BGF per item, sorted by stacking order then index
  const queue = items
    .map((it, i) => ({
      key: it.use,
      label: usageInfo(it.use).label,
      color: usageInfo(it.use).color,
      order: usageInfo(it.use).order,
      idx: i,
      remaining: itemArea(it) / Math.max(0.3, efficiency), // NUF → BGF
    }))
    .filter((x) => x.remaining > 0.01)
    .sort((a, b) => a.order - b.order || a.idx - b.idx);

  const floors = [];
  let guard = 0;
  while (queue.some((q) => q.remaining > 0.01) && guard < 80) {
    guard += 1;
    let cap = fa;
    const segments = [];
    for (const q of queue) {
      if (q.remaining <= 0.01 || cap <= 0.01) continue;
      const take = Math.min(q.remaining, cap);
      q.remaining -= take;
      cap -= take;
      const existing = segments.find((s) => s.key === q.key);
      if (existing) existing.area += take;
      else segments.push({ key: q.key, label: q.label, color: q.color, area: take });
    }
    floors.push({ segments, used: fa - cap, free: cap });
  }

  const totalBGF = items.reduce((s, it) => s + itemArea(it) / Math.max(0.3, efficiency), 0);
  return { floors, totalBGF, floorsNeeded: floors.length };
}

export const floorLabel = (i) => (i === 0 ? "EG" : `${i}. OG`);
