// KuerzelHilfe.jsx — shortcut/action help overlay, opened with „?" (69-12).
//
// Why: the palette (Strg+K) hides what a view can DO until you search for it;
// buyers asked for a discoverable list (ID-08, HANDOFF-BEFUNDE-WEBSITE-DEMO
// §7). Same house pattern as Befehlspalette (plain fixed backdrop, no dialog
// primitive) — Esc or backdrop click closes.
//
// In:  `offen`, `onSchliessen`; reads the action registry for the current
//      route via aktionenFuer() and re-renders on registry changes.
// Out: a static list — action titles, descriptions, shortcut chords.

import React from 'react';
import { useLocation } from 'react-router-dom';
import { aktionenFuer, abonnieren, aktionenVersion, parseKuerzel } from '@core/lib/aktionen';
import { useI18n } from '@core/lib/i18n';

/**
 * Human-readable chord text for a parsed shortcut, e.g. "Strg ⇧ P" (⌘ on
 * macOS would be nicer but the app targets Windows/Linux office desks —
 * keep one glyph set, documented here as [ASSUMED]).
 * @param {string} kuerzel raw chord string, e.g. "mod+shift+p"
 * @returns {string} display text
 */
function kuerzelAnzeige(kuerzel) {
  const k = parseKuerzel(kuerzel);
  const teile = [];
  if (k.mod) teile.push('Strg');
  if (k.shift) teile.push('⇧');
  if (k.alt) teile.push('Alt');
  teile.push(k.key.toUpperCase());
  return teile.join(' ');
}

/**
 * Shortcut help overlay: actions of the CURRENT view with their chords.
 * @param {{offen: boolean, onSchliessen: () => void}} props
 * @returns {JSX.Element|null} the overlay, or null when closed
 */
export default function KuerzelHilfe({ offen, onSchliessen }) {
  const location = useLocation();
  const { t } = useI18n();
  // Re-render when pages (un)register actions while the overlay is open.
  React.useSyncExternalStore(abonnieren, aktionenVersion);
  const aktionen = aktionenFuer(location.pathname);

  // Esc closes even when focus never entered the overlay — the help is opened
  // by a global „?" keystroke, so the user's focus is anywhere on the page.
  // (The palette gets away without this because its input autofocuses.)
  React.useEffect(() => {
    if (!offen) return undefined;
    const beiEsc = (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onSchliessen();
      }
    };
    window.addEventListener("keydown", beiEsc);
    return () => window.removeEventListener("keydown", beiEsc);
  }, [offen, onSchliessen]);

  if (!offen) return null;

  return (
    <div className="fixed inset-0 z-[61] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onSchliessen}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Kürzel und Aktionen')}
        data-testid="kuerzel-hilfe"
        onKeyDown={(ev) => ev.key === 'Escape' && onSchliessen()}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
      >
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('Kürzel und Aktionen')}
          </h2>
          <p className="text-[11px] text-slate-400">{t('Diese Ansicht')}</p>
        </div>
        <ul className="max-h-80 overflow-auto py-1" data-testid="kuerzel-liste">
          {aktionen.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">
              {t('Keine Aktionen in dieser Ansicht')}
            </li>
          )}
          {aktionen.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 px-4 py-2 text-sm"
              data-testid={`kuerzel-aktion-${a.id}`}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate text-slate-800 dark:text-slate-100">{a.titel}</span>
                {a.beschreibung && (
                  <span className="block truncate text-xs text-slate-400">{a.beschreibung}</span>
                )}
              </span>
              {a.kuerzel && (
                <kbd className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-500 dark:text-slate-300">
                  {kuerzelAnzeige(a.kuerzel)}
                </kbd>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-[11px] text-slate-400">
          <span>{t('Esc schließt')}</span>
        </div>
      </div>
    </div>
  );
}
