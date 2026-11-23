// KuerzelHilfe.jsx — shortcut/action help overlay, opened with „?" (69-12).
//
// Why: the palette (Strg+K) hides what a view can DO until you search for it;
// buyers asked for a discoverable list (ID-08, HANDOFF-BEFUNDE-WEBSITE-DEMO
// §7). Same house pattern as Befehlspalette (plain fixed backdrop, no dialog
// primitive) — Esc or backdrop click closes.
//
// 105-14: the list is generated from the command registers (104-03) through @core/lib/tastenhilfe.js — the
// actions of the current view, the registers of the mounted drawing surfaces (published with registerAnmelden)
// and the register of the app-wide keys. The help is therefore never empty. Loaded lazily by Layout.jsx.
//
// In:  `offen`, `onSchliessen`, optional `onPalette`; reads the action registry for the current route
//      (aktionenFuer) and the published registers, re-renders on changes of either.
// Out: a static list in sections — titles, descriptions, keys and typed short forms.

import React from 'react';
import { useLocation } from 'react-router-dom';
import { aktionenFuer, abonnieren, aktionenVersion, parseKuerzel } from '@core/lib/aktionen';
import { angemeldeteRegister, registerAbonnieren, registerStand } from '@core/lib/befehlsregister.js';
import { globaleBefehle, hilfeAbschnitte } from '@core/lib/tastenhilfe.js';
import { useI18n, englischErgaenzen } from '@core/lib/i18n';
import { EN as EN_SUCHE } from '@core/lib/i18nTeile/suche-105.js';

englischErgaenzen(EN_SUCHE);

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
 * Shortcut help overlay: sections from the command registers (105-14).
 * @param {{offen: boolean, onSchliessen: () => void, onPalette?: () => void}} props
 *   onPalette: opens the command palette (handler of the global "palette" command)
 * @returns {import("react").JSX.Element|null} the overlay, or null when closed
 */
export default function KuerzelHilfe({ offen, onSchliessen, onPalette }) {
  const location = useLocation();
  const { t } = useI18n();
  // Re-render when pages (un)register actions or surfaces (un)publish registers while the overlay is open.
  React.useSyncExternalStore(abonnieren, aktionenVersion);
  React.useSyncExternalStore(registerAbonnieren, registerStand);
  const aktionen = aktionenFuer(location.pathname);
  const register = angemeldeteRegister();
  const global = React.useMemo(
    () => globaleBefehle({ paletteOeffnen: onPalette, hilfeOeffnen: () => null, schliessen: onSchliessen }),
    [onPalette, onSchliessen],
  );
  const abschnitte = hilfeAbschnitte({ aktionen, register, global, kuerzelAnzeige });

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
        </div>
        <div className="max-h-[60vh] overflow-auto py-1" data-testid="kuerzel-liste" data-anzahl={abschnitte.reduce((n, a) => n + a.eintraege.length, 0)}>
          {abschnitte.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              {t('Keine Aktionen in dieser Ansicht')}
            </p>
          )}
          {abschnitte.map((abschnitt) => (
            <section key={abschnitt.id} data-testid={`kuerzel-abschnitt-${abschnitt.id}`} aria-label={t(abschnitt.titel)}>
              <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(abschnitt.titel)}</h3>
              <ul>
                {abschnitt.eintraege.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 px-4 py-1.5 text-sm"
                    data-testid={abschnitt.id === 'ansicht' ? `kuerzel-aktion-${a.id}` : `kuerzel-befehl-${a.id}`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-slate-800 dark:text-slate-100">{t(a.titel)}</span>
                      {a.beschreibung && (
                        <span className="block truncate text-xs text-slate-400">{a.beschreibung}</span>
                      )}
                    </span>
                    {a.kurz.length > 0 && (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title={t('Kurzform in der Befehlszeile')}>
                        {a.kurz.join(' · ')}
                      </span>
                    )}
                    {a.taste && (
                      <kbd className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-500 dark:text-slate-300">
                        {a.taste}
                      </kbd>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-[11px] text-slate-400">
          <span>{t('Esc schließt')}</span>
        </div>
      </div>
    </div>
  );
}
