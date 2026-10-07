// Shared project helpers: status labels/colors, HOAI progress, health "traffic
// light", and formatting. Used by the Dashboard and project detail views.
//
// 72-01 A-7 (Befund N-07): Labels und Normalisierung kommen aus der EINEN
// Quelle @core/lib/labels.js — diese Datei reichert sie nur um Farben und
// Fortschrittslogik an. statusInfo/hoaiProgress/hoaiPhaseShort verstehen
// BEIDE Datengenerationen (Seed-Labels wie „LP 5 - …"/„Cfb" und neue Keys).

import {
  STATUS_LABELS,
  labelFor,
  normalisiereStatus,
  normalisiereHoaiPhase,
} from "@core/lib/labels";

export const PROJECT_STATUS = {
  concept: { label: "Konzept", color: "bg-slate-100 text-slate-700", dot: "bg-slate-400", ring: "#94a3b8" },
  feasibility: { label: "Machbarkeit", color: "bg-slate-100 text-slate-700", dot: "bg-slate-400", ring: "#94a3b8" },
  design: { label: "Planung", color: "bg-blue-100 text-blue-800", dot: "bg-blue-500", ring: "#3b82f6" },
  design_development: { label: "Entwurfsplanung", color: "bg-blue-100 text-blue-800", dot: "bg-blue-500", ring: "#3b82f6" },
  technical_design: { label: "Ausführungsplanung", color: "bg-purple-100 text-purple-800", dot: "bg-purple-500", ring: "#8b5cf6" },
  construction: { label: "Im Bau", color: "bg-amber-100 text-amber-800", dot: "bg-amber-500", ring: "#f59e0b" },
  completed: { label: "Fertiggestellt", color: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500", ring: "#10b981" },
  operation: { label: "Betrieb", color: "bg-teal-100 text-teal-800", dot: "bg-teal-500", ring: "#14b8a6" },
  handover: { label: "Übergabe", color: "bg-violet-100 text-violet-800", dot: "bg-violet-500", ring: "#8b5cf6" },
};

/**
 * Status-Anzeigeinfo (Label + Farben) für JEDE Wertegeneration.
 * @param {string|null|undefined} s Rohstatus (Key oder altes deutsches Label)
 * @returns {{ label: string, color: string, dot: string, ring: string }}
 */
export const statusInfo = (s) => {
  const key = normalisiereStatus(s);
  if (key && PROJECT_STATUS[key]) return PROJECT_STATUS[key];
  return {
    label: labelFor(STATUS_LABELS, key), // „—" bei leer, nie „undefined"
    color: "bg-slate-100 text-slate-600",
    dot: "bg-slate-300",
    ring: "#cbd5e1",
  };
};

/**
 * HOAI Leistungsphase 1..9 → Prozent (linear, 1/9-Schritte). Versteht Zahlen
 * (neue Formulare) und „LP 5 - …"-Strings (Seed) über normalisiereHoaiPhase.
 * @param {{ hoai_phase?: string|number|null, status?: string }} project
 * @returns {number} 0–100 (Prozent), 0 ohne erkennbare Phase
 */
export function hoaiProgress(project) {
  const lp = normalisiereHoaiPhase(project?.hoai_phase);
  if (lp) return Math.round((lp / 9) * 100);
  // fall back to status-based estimate (normalisiert — Seed-Labels zählen mit)
  const byStatus = { concept: 4, feasibility: 8, design: 35, design_development: 35, technical_design: 55, construction: 70, completed: 100, operation: 100, handover: 95 };
  return byStatus[normalisiereStatus(project?.status)] ?? 0;
}

/** Kurzform „LP n" für Listen; „—" ohne Phase. */
export const hoaiPhaseShort = (project) => {
  const lp = normalisiereHoaiPhase(project?.hoai_phase);
  return lp ? `LP ${lp}` : "—";
};

// Days until completion (negative = overdue).
export function daysToCompletion(project) {
  if (!project?.completion_date) return null;
  const ms = new Date(project.completion_date).getTime() - Date.now();
  return Math.round(ms / (24 * 3600 * 1000));
}

/**
 * Traffic-light health of a project from its status and completion date.
 *
 * 72-09 (FINDINGS-BACKLOG-20): without a completion date there is no basis for
 * "Auf Kurs" — every freshly created project was reported healthy. It now says
 * so neutrally ("Kein Termin") instead of claiming green.
 * @param {{ status?: string, completion_date?: string|null }|null|undefined} project
 * @returns {{ level: "done"|"offen"|"late"|"watch"|"ok", label: string, color: string, dot: string }}
 *   level: done = completed/operation, offen = no completion date, late = date
 *   passed, watch = fewer than 120 days left, ok = otherwise; label = German
 *   badge text; color/dot = Tailwind classes
 */
export function projectHealth(project) {
  const s = normalisiereStatus(project?.status);
  if (s === "completed" || s === "operation") return { level: "done", label: "Abgeschlossen", color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" };
  const d = daysToCompletion(project);
  if (d == null) return { level: "offen", label: "Kein Termin", color: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
  if (d < 0) return { level: "late", label: "Termin überschritten", color: "bg-rose-100 text-rose-700", dot: "bg-rose-500" };
  if (d < 120) return { level: "watch", label: "Beobachten", color: "bg-amber-100 text-amber-800", dot: "bg-amber-500" };
  return { level: "ok", label: "Auf Kurs", color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" };
}

export const projectArea = (p) => p?.building_area || p?.area_net || 0;

export const fmtArea = (n) => `${Math.round(n || 0).toLocaleString("de-DE")} m²`;

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export const fmtCity = (p) => p?.location?.city || p?.location?.address || (typeof p?.location === "string" && p.location) || "—";
