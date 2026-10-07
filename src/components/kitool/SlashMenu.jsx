// Slash menu: typing "/" in the composer lists the skills from GET /skills
// filtered by the typed prefix; arrows move, Tab/Enter insert, Escape closes.
//
// In: skills [{name, description}], query (text after "/"), selIdx. Out: a
// floating list; selection is handled by the parent (keyboard lives there).

import React from 'react';

/**
 * Filters skills by the query prefix (case-insensitive).
 * @param {{name: string, description: string}[]} skills
 * @param {string} query
 */
export function filterSkills(skills, query) {
  const q = (query || '').toLowerCase();
  return skills.filter((s) => s.name.toLowerCase().startsWith(q));
}

/**
 * @param {{items: {name: string, description: string}[], selIdx: number, onPick: (name: string) => void}} props
 */
export default function SlashMenu({ items, selIdx, onPick }) {
  if (!items.length) return null;
  return (
    <div
      className="absolute bottom-full left-0 mb-2 min-w-[320px] max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1 text-sm z-20"
      role="listbox"
      data-testid="slash-menu"
    >
      {items.map((s, i) => (
        <div
          key={s.name}
          role="option"
          aria-selected={i === selIdx}
          onMouseDown={(e) => { e.preventDefault(); onPick(s.name); }}
          className={`px-2.5 py-1.5 rounded-md cursor-pointer flex items-baseline gap-2 ${i === selIdx ? 'bg-emerald-50 dark:bg-emerald-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
        >
          <span className="font-mono text-slate-900 dark:text-slate-100">/{s.name}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{s.description}</span>
        </div>
      ))}
    </div>
  );
}
