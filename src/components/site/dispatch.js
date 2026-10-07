// AI dispatch: assign idle units to the areas that are most behind schedule.

// Plan-coordinate centroids per area (must match zones in SitePlan).
export const AREA_POINTS = {
  "Rohbau Nord": { x: 33, y: 26 },
  "Rohbau Süd": { x: 73, y: 59 },
  TGA: { x: 50, y: 45 },
  Fassade: { x: 55, y: 80 },
  Außenanlagen: { x: 25, y: 40 },
  Tiefgarage: { x: 40, y: 60 },
};

const clamp = (v) => Math.max(4, Math.min(96, v));

function expectedProgress(task, now) {
  const s = new Date(task.start_date).getTime();
  const e = new Date(task.end_date).getTime();
  if (now <= s) return 0;
  if (now >= e) return 100;
  return ((now - s) / (e - s)) * 100;
}

// Areas ranked by schedule deficit (expected - actual progress).
export function behindAreas(tasks, now = Date.now()) {
  const map = {};
  tasks.forEach((t) => {
    const exp = expectedProgress(t, now);
    if (!map[t.area]) map[t.area] = { area: t.area, exp: 0, prog: 0, n: 0 };
    const a = map[t.area];
    a.exp += exp;
    a.prog += t.progress || 0;
    a.n += 1;
  });
  return Object.values(map)
    .map((a) => ({ area: a.area, deficit: Math.round(a.exp / a.n - a.prog / a.n) }))
    .filter((a) => a.deficit > 10)
    .sort((a, b) => b.deficit - a.deficit);
}

export function computeDispatch(units, tasks, now = Date.now(), airspaceClosed = false) {
  const areas = behindAreas(tasks, now);
  const idle = units.filter((u) => u.status === "idle" && !(u.type === "drone" && airspaceClosed));
  if (areas.length === 0 || idle.length === 0) return [];
  return idle.map((u, i) => {
    const a = areas[i % areas.length];
    const base = AREA_POINTS[a.area] || { x: 50, y: 50 };
    const point = { x: clamp(base.x + ((i % 3) - 1) * 5), y: clamp(base.y + ((Math.floor(i / 3) % 3) - 1) * 5) };
    return { unitId: u.id, unitName: u.name, area: a.area, deficit: a.deficit, point, label: `KI-Disposition → ${a.area}` };
  });
}
