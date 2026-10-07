// Command palette, Strg/⌘+K (Phase 65-05).
//
// Why: the buyers are BIM coordinators — people who sit in one tool all day and
// navigate by keyboard. Twenty modules in a six-group tree read as a maze from
// the outside; the same twenty behind one search field read as range (finding
// A-07). It also answers the plainest question a first-time visitor has: "where
// is the thing the website showed me?"
//
// Why no cmdk: a dependency needs a decision. The overlay follows the house
// pattern (@core/components/common/FormModal.jsx — plain fixed backdrop, no
// dialog primitive), and the matching is a substring over normalised text; the
// list is short enough that nothing cleverer earns its place.
//
// In:  the navigation list (src/navigation.js), the projects and contacts from
//      the API, the settings areas (src/lib/settings/bereiche.js, 80-01), plus a
//      handful of actions. People and applications of the personnel area are
//      deliberately NOT indexed: a name typed here would show up in the palette of
//      whoever uses the device next (DS-07).
// Out: navigates, switches the current project, or runs the action.

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Command, CornerDownLeft, Search } from 'lucide-react';
import { bitApi } from '@core/api/bitApi';
import { useProject } from '@core/lib/ProjectContext';
import { useI18n } from '@core/lib/i18n';
import { createPageUrl } from '@core/utils';
import {
  aktionenFuer, abonnieren, aktionenVersion, parseKuerzel,
} from '@core/lib/aktionen';
import { navFlach, navSichtbar } from '@/navigation';
import { useAuth } from '@core/lib/AuthContext';
import { DATENQUELLE } from '@core/lib/umgebung';
import { personalZugang } from '@/lib/people/zugang';

/**
 * Lowercase, umlauts folded, accents stripped — so "prüf" finds "Prüf-Suite"
 * and "pruef" does too.
 * @param {string} s
 * @returns {string}
 */
function normalisiere(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Maximum entries shown — beyond that the list stops being scannable. */
const MAX = 12;

/**
 * Human-readable chord, e.g. "mod+shift+p" → "Strg ⇧ P" (same glyph set as
 * KuerzelHilfe — one Windows/Linux convention [ASSUMED], see 69-12-SUMMARY).
 * @param {string} kuerzel raw chord string
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

export default function Befehlspalette({ offen, onSchliessen }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { setProjectId } = useProject();
  const [suche, setSuche] = React.useState('');
  const [aktiv, setAktiv] = React.useState(0);
  const [projekte, setProjekte] = React.useState([]);
  const [kontakte, setKontakte] = React.useState([]);
  // 80-01: settings areas, loaded with the palette instead of with the shell — the
  // registry pulls the rule books (79 settings, HOAI tables) and the area files.
  const [einstellungsQuelle, setEinstellungsQuelle] = React.useState(
    /** @type {{paletteEintraege: (k: any) => Array<{key: string, titel: string, beschreibung: string, stichworte: string, ziel: string}>, bereit: Set<string>}|null} */ (null),
  );
  const { user } = useAuth();
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const eingabeRef = React.useRef(null);
  // Verbs of the current view re-render the palette when pages (un)register
  // actions while it is open (69-12). The snapshot value doubles as a memo
  // dependency below.
  const version = React.useSyncExternalStore(abonnieren, aktionenVersion);

  // Erst beim Öffnen laden — die Palette soll den Startpfad nicht belasten.
  React.useEffect(() => {
    if (!offen) return;
    setSuche('');
    setAktiv(0);
    let lebt = true;
    (async () => {
      try {
        // bitApi.entities ist zur Laufzeit dynamisch (ein Eintrag je Entität) —
        // tsc kennt die Namen nicht, deshalb hier bewusst ungetypt.
        const e = /** @type {any} */ (bitApi.entities);
        const [p, k] = await Promise.all([
          e.Project.list('-updated_date'),
          e.Contact.list('name'),
        ]);
        if (!lebt) return;
        setProjekte(p || []);
        setKontakte(k || []);
      } catch {
        /* ohne Daten bleibt die Navigation durchsuchbar */
      }
    })();
    Promise.all([import('@/lib/settings/bereiche.js'), import('@/components/settings/index.js')])
      .then(([bereiche, komponenten]) => {
        if (!lebt) return;
        // Only areas that exist on the page: an entry for an unfinished area would
        // silently land on another tab.
        const bereit = new Set(Object.entries(komponenten.BEREICH_KOMPONENTEN).filter(([, b]) => b.BEREIT).map(([k]) => k));
        setEinstellungsQuelle({ paletteEintraege: bereiche.paletteEintraege, bereit });
      })
      .catch(() => { /* without the registry chunk the modules stay searchable */ });
    return () => {
      lebt = false;
    };
  }, [offen]);

  React.useEffect(() => {
    if (offen) setTimeout(() => eingabeRef.current?.focus(), 30);
  }, [offen]);

  const eintraege = React.useMemo(() => {
    /** @type {{art: string, aktionId?: string, titel: string, zusatz?: string, beschreibung?: string, stichworte?: string, kuerzel?: string, tun: () => void}[]} */
    const alle = [];

    // Verbs of the CURRENT view first (69-12): registered by the page itself,
    // one registration site per action — the palette only offers them.
    for (const a of aktionenFuer(location.pathname)) {
      alle.push({
        art: t('Aktion'),
        aktionId: a.id,
        titel: a.titel,
        beschreibung: a.beschreibung,
        kuerzel: a.kuerzel,
        tun: a.ausfuehren,
      });
    }

    for (const n of navFlach) {
      // 80-01 (DS-12): no personnel entry without personnel access.
      if (!navSichtbar(n, { personalZugang: zugang })) continue;
      alle.push({
        art: t('Modul'),
        titel: t(n.title),
        zusatz: t(n.gruppe),
        tun: () => navigate(n.url),
      });
    }
    // 80-01: "Einstellung: <area>" per visible, finished settings area.
    if (einstellungsQuelle) {
      const kontext = { datenquelle: DATENQUELLE, personalZugang: zugang };
      for (const e of einstellungsQuelle.paletteEintraege(kontext)) {
        if (!einstellungsQuelle.bereit.has(e.key)) continue;
        alle.push({
          art: t('Einstellungen'),
          titel: t('Einstellung') + ': ' + t(e.titel),
          beschreibung: t(e.beschreibung),
          stichworte: e.stichworte,
          tun: () => navigate(e.ziel),
        });
      }
    }
    for (const p of projekte) {
      alle.push({
        art: t('Projekt'),
        titel: p.name,
        zusatz: p.client || '',
        tun: () => {
          setProjectId(p.id);
          navigate(createPageUrl('Projects'));
        },
      });
    }
    for (const k of kontakte) {
      alle.push({
        art: t('Kontakt'),
        titel: k.name,
        zusatz: k.company || k.role || '',
        tun: () => navigate(createPageUrl('AddressBook')),
      });
    }
    // Generic jump actions stay navigation entries (they work on EVERY route).
    // „Prüflauf starten" is the ModelCheck verb (registered there, 69-12) —
    // the navigation twin is retitled so the palette never shows two entries
    // with the same name on /ModelCheck.
    alle.push(
      { art: t('Modul'), titel: t('Zur Prüf-Suite'), tun: () => navigate(createPageUrl('ModelCheck')) },
      { art: t('Aktion'), titel: t('Musterprojekt prüfen'), tun: () => navigate(`${createPageUrl('ModelCheck')}?beispiel=1`) },
    );

    const q = normalisiere(suche);
    if (!q) return alle.slice(0, MAX);
    return alle
      .filter((e) => normalisiere(`${e.titel} ${e.zusatz || ''} ${e.beschreibung || ''} ${e.stichworte || ''} ${e.art}`).includes(q))
      .slice(0, MAX);
  }, [suche, projekte, kontakte, navigate, setProjectId, t, location.pathname, version, zugang, einstellungsQuelle]);

  React.useEffect(() => {
    if (aktiv >= eintraege.length) setAktiv(0);
  }, [eintraege.length, aktiv]);

  const ausfuehren = (e) => {
    if (!e) return;
    onSchliessen();
    e.tun();
  };

  const taste = (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setAktiv((i) => (i + 1) % Math.max(1, eintraege.length));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setAktiv((i) => (i - 1 + eintraege.length) % Math.max(1, eintraege.length));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      ausfuehren(eintraege[aktiv]);
    }
  };

  if (!offen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onSchliessen}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Suche und Befehle')}
        data-testid="befehlspalette"
        onKeyDown={(ev) => ev.key === 'Escape' && onSchliessen()}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={eingabeRef}
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            onKeyDown={taste}
            placeholder={t('Modul, Projekt, Kontakt oder Aktion…')}
            aria-label={t('Suche und Befehle')}
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-slate-400"
          />
        </div>

        <ul className="max-h-80 overflow-auto py-1" role="listbox">
          {eintraege.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">{t('Nichts gefunden')}</li>
          )}
          {eintraege.map((e, i) => (
            <li key={`${e.art}-${e.titel}-${i}`} role="option" aria-selected={i === aktiv}>
              <button
                type="button"
                onMouseEnter={() => setAktiv(i)}
                onClick={() => ausfuehren(e)}
                data-testid={e.aktionId ? `palette-aktion-${e.aktionId}` : undefined}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  i === aktiv ? 'bg-slate-100 dark:bg-slate-800' : ''
                }`}
              >
                <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-slate-400">
                  {e.art}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-slate-800 dark:text-slate-100">{e.titel}</span>
                  {/* 69-12: description as second line — verbs need context */}
                  {e.beschreibung && (
                    <span className="block truncate text-xs text-slate-400">{e.beschreibung}</span>
                  )}
                </span>
                {e.zusatz && (
                  <span className="hidden sm:block max-w-[9rem] truncate text-xs text-slate-400">
                    {e.zusatz}
                  </span>
                )}
                {/* 69-12: shortcut on the right */}
                {e.kuerzel && (
                  <kbd className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-300">
                    {kuerzelAnzeige(e.kuerzel)}
                  </kbd>
                )}
                {i === aktiv && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-[11px] text-slate-400">
          <Command className="w-3 h-3" />
          {/* 69-12: the footer names the ? shortcut so the help is findable */}
          <span>{t('Pfeile zum Wählen · Enter zum Öffnen · Esc schließt · ? zeigt Kürzel')}</span>
        </div>
      </div>
    </div>
  );
}
