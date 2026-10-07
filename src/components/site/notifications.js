// Notification thresholds for schedule tasks: 1 week, 3 days, 10 hours before start.
export const THRESHOLDS = [
  { key: "1w", label: "1 Woche", ms: 7 * 24 * 3600 * 1000 },
  { key: "3d", label: "3 Tage", ms: 3 * 24 * 3600 * 1000 },
  { key: "10h", label: "10 Stunden", ms: 10 * 3600 * 1000 },
];

const HOUR = 3600 * 1000;

// Returns the lead-time status of a task relative to `now`.
export function taskTiming(task, now = new Date()) {
  const start = new Date(task.start_date).getTime();
  const end = new Date(task.end_date).getTime();
  const t = now.getTime();
  const msToStart = start - t;

  if (t >= end) return { phase: "done", label: "Abgeschlossen", msToStart };
  if (t >= start) return { phase: "active", label: "Läuft", msToStart };

  // Which notification window are we in? (smallest threshold that has been crossed)
  let due = null;
  for (const th of THRESHOLDS) {
    if (msToStart <= th.ms) due = th; // last matching = smallest
  }
  return {
    phase: due ? "due" : "upcoming",
    due, // the active threshold, or null
    label: due ? `Start in ${formatLead(msToStart)} (${due.label}-Hinweis)` : `Start in ${formatLead(msToStart)}`,
    msToStart,
  };
}

export function formatLead(ms) {
  if (ms <= 0) return "0 h";
  const days = Math.floor(ms / (24 * HOUR));
  const hours = Math.floor((ms % (24 * HOUR)) / HOUR);
  if (days > 0) return `${days} T ${hours} h`;
  return `${hours} h`;
}

// Pending notifications across all tasks (for the notification center / toasts).
export function pendingNotifications(tasks, now = new Date()) {
  const out = [];
  for (const task of tasks) {
    const timing = taskTiming(task, now);
    if (timing.phase === "due" && timing.due) {
      out.push({
        taskId: task.id,
        name: task.name,
        company: task.company_name,
        assignee: task.assignee_name,
        threshold: timing.due,
        msToStart: timing.msToStart,
      });
    }
  }
  return out.sort((a, b) => a.msToStart - b.msToStart);
}
