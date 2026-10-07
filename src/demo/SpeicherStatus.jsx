// Storage readout for the header of the serverless build (Phase 65-02, 70-01).
//
// Why: the client build keeps everything in the browser, and it used to say nothing
// about whether that actually worked. A failed write was swallowed, so the UI
// went on implying the state was safe (finding BEF-04 / BL-02). This component
// reports the real outcome of the last write, the current fill level, and — when
// a write fails — puts a warning strip under the header that stays until a write
// succeeds again.
//
// In:  the window events demoDb fires ("demo:gespeichert", "demo:speicher-fehler")
//      and navigator.storage.estimate().
// Out: a small status line for the header; the warning strip and the backup
//      nudge in the slot Layout passes as hinweisZiel (between header and
//      main); the import, reset and snapshot dialogs (core Radix dialog, portal
//      on document.body).
//
// Layout renders it whenever SERVERLOS is true — the client build. (Until 83-02
// the online demo used it too, with its own "Demo zurücksetzen" wording; a reset
// here throws away the user's own work, so it says so.)
//
// Plan 80-05: the four dialogs (import, reset, snapshot, export) and the handler
// logic behind them now live in speicherDialoge.jsx, shared with Settings > Daten
// & Sicherung (DatenBereich.jsx) — this component keeps only the header buttons,
// the two strips, and the open/closed state of ITS OWN dialogs.

import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Download, History, RotateCcw, Upload, Save } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { speicherStand } from '@core/api/demoIdb';
import {
  demoDbAuslesen,
  sicherungFaellig, letzteSicherungLesen,
} from '@core/api/demoDb';
import { exportProjekt } from '@core/api/projektDatei';
import { schnappschuesseListe } from '@core/api/schnappschuesse';
// 79-12 (E-07): the export-dialog registry lives in src/ (app-only), because a
// package under packages/ may not import from "@/" — see the file header there.
import { EXPORT_BEREICHE } from '@/lib/exportBereiche';
import {
  ImportVorschauDialog, ZuruecksetzenDialog, SchnappschussDialog, ExportDialog,
  useSpeicherAktionen, fokusZurueck,
} from './speicherDialoge.jsx';

/** How often the fill level is refreshed (ms). */
const STAND_INTERVALL = 30000;
/** How often the "saved N s ago" label recomputes (ms). */
const LABEL_INTERVALL = 5000;
/** "Save later" hides the nudge bar for this browser session (69-07). */
const SPATER_KEY = 'bit-atelier-sicherung-spaeter';

/**
 * Human-readable byte count.
 * @param {number} n bytes
 * @returns {string}
 */
function mb(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(n / 1024 / 1024)} MB`;
}

/**
 * Relative time since a timestamp, in the coarse steps a status line needs.
 * @param {number} zeit epoch ms
 * @param {(s: string) => string} t translator
 * @returns {string}
 */
function vorWieLange(zeit, t) {
  const s = Math.max(0, Math.round((Date.now() - zeit) / 1000));
  if (s < 5) return t('gerade eben');
  if (s < 60) return `${t('vor')} ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${t('vor')} ${m} min`;
  return `${t('vor')} ${Math.round(m / 60)} h`;
}

/**
 * Storage status for the header plus its strips and dialogs.
 * @param {{ hinweisZiel?: HTMLElement|null }} props hinweisZiel: the slot element Layout
 *   renders between <header> and <main>; the warning strip and the backup
 *   nudge are portalled into it (nothing is shown there while it is null, i.e. before the
 *   first commit of Layout).
 * @returns {JSX.Element}
 */
export default function SpeicherStatus({ hinweisZiel = null }) {
  const { t } = useI18n();
  const [gespeichert, setGespeichert] = React.useState(/** @type {number|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {Error|null} */ (null));
  const [stand, setStand] = React.useState(/** @type {{benutzt:number,gesamt:number}|null} */ (null));
  const [, neuZeichnen] = React.useReducer((x) => x + 1, 0);
  // 80-05: the shared dialogs' handler logic (file read, replace, reset, restore).
  const aktionen = useSpeicherAktionen();
  // 79-12 (E-07): export dialog state — anzahlen null = closed (ExportDialog's
  // own convention, speicherDialoge.jsx), a snapshot taken when the dialog
  // opens, purely informational (the actual export re-reads the database).
  const [exportAnzahlen, setExportAnzahlen] = React.useState(/** @type {Record<string, number>|null} */ (null));
  const exportKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  // 69-13: own dialogs instead of the native confirm dialog — every
  // destructive step offers "save first" as an EQUAL choice beside cancel.
  const [resetDialog, setResetDialog] = React.useState(false);
  const [snapshots, setSnapshots] = React.useState(null); // null = panel closed
  const [snapFehler, setSnapFehler] = React.useState('');
  // 69-07: backup nudge bar — shown when a visitor with meaningful content
  // has never saved a .bitproj (or grew a lot since). "Later" hides it for
  // this session only (sessionStorage), a real save hides it for good.
  const [nudge, setNudge] = React.useState(false);
  const dateiRef = React.useRef(null);
  // Header buttons that open the dialogs. The dialogs have no Radix trigger (they
  // open after async work or a file pick), so the focus is handed back by hand.
  const ladenKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  const snapKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  const resetKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));

  React.useEffect(() => {
    const beiErfolg = (e) => {
      setGespeichert(e.detail?.zeit ?? Date.now());
      setFehler(null);
    };
    const beiFehler = (e) => setFehler(e.detail?.fehler ?? new Error('Unbekannter Speicherfehler'));
    window.addEventListener('demo:gespeichert', beiErfolg);
    window.addEventListener('demo:speicher-fehler', beiFehler);
    return () => {
      window.removeEventListener('demo:gespeichert', beiErfolg);
      window.removeEventListener('demo:speicher-fehler', beiFehler);
    };
  }, []);

  React.useEffect(() => {
    let lebt = true;
    const holen = () => speicherStand().then((s) => lebt && setStand(s));
    holen();
    const id = setInterval(holen, STAND_INTERVALL);
    return () => {
      lebt = false;
      clearInterval(id);
    };
  }, []);

  // Das Label ist eine relative Zeit — ohne Takt bliebe „gerade eben" stehen.
  React.useEffect(() => {
    const id = setInterval(neuZeichnen, LABEL_INTERVALL);
    return () => clearInterval(id);
  }, []);

  // 69-07: recompute the nudge on mount and after every successful write —
  // the record count only changes through writes, and demoDb serves it from
  // its in-memory cache (cheap).
  const nudgePruefen = React.useCallback(async () => {
    try {
      const spaeter = window.sessionStorage.getItem(SPATER_KEY) === '1';
      if (spaeter) {
        setNudge(false);
        return;
      }
      const daten = await demoDbAuslesen();
      let anzahl = 0;
      for (const rows of Object.values(daten)) if (Array.isArray(rows)) anzahl += rows.length;
      setNudge(sicherungFaellig(await letzteSicherungLesen(), anzahl));
    } catch {
      setNudge(false); // without storage there is nothing to save either
    }
  }, []);

  React.useEffect(() => {
    nudgePruefen();
    window.addEventListener('demo:gespeichert', nudgePruefen);
    return () => window.removeEventListener('demo:gespeichert', nudgePruefen);
  }, [nudgePruefen]);

  const sichern = async () => {
    try {
      await exportProjekt();
      setNudge(false); // a real save ends the nudge for good (meta stamped)
    } catch (e) {
      setFehler(e);
    }
  };

  // --- Export dialog (79-12, E-07) --------------------------------------------
  // Opens with every checkbox OFF and a fresh count per area; the header
  // Download button and the "Projekt sichern" strips stay two different
  // things on purpose — the strips exist to get a FULL backup out in one
  // click (69-07 must-have "not hidden in a submenu"), the dialog is the
  // deliberate choice for a handover without the office's own books.
  const exportOeffnen = async () => {
    try {
      const daten = await demoDbAuslesen();
      /** @type {Record<string, number>} */
      const anzahlen = {};
      for (const bereich of EXPORT_BEREICHE) {
        if (bereich.separat) continue; // no local count for a separate-file area (80-05)
        anzahlen[bereich.key] = bereich.entitaeten.reduce((n, e) => n + (Array.isArray(daten[e]) ? daten[e].length : 0), 0);
      }
      setExportAnzahlen(anzahlen);
    } catch {
      setExportAnzahlen({});
    }
  };

  const exportAbbrechen = () => setExportAnzahlen(null);

  const exportAusfuehren = async (optionen) => {
    try {
      await exportProjekt(undefined, optionen);
      // Only a FULL backup (every area ticked) ends the nudge — a handover
      // file is not a save of the office's own books (see exportProjekt()).
      if (optionen.art === 'sicherung') setNudge(false);
    } catch (e) {
      setFehler(e);
      throw e; // ExportDialog leaves itself open on a thrown export
    }
  };

  const dateiGewaehlt = async (ev) => {
    const datei = ev.target.files?.[0];
    ev.target.value = ''; // dieselbe Datei soll erneut wählbar bleiben
    if (!datei) return;
    try {
      await aktionen.dateiGewaehlt(datei);
    } catch (e) {
      setFehler(e);
    }
  };

  const importBestaetigen = async (vorherSichern) => {
    try {
      const r = await aktionen.importBestaetigen(vorherSichern);
      // demoDbErsetzen reports a failed automatic snapshot honestly.
      if (r?.schnappschussFehler) setSnapFehler(r.schnappschussFehler);
    } catch (e) {
      setFehler(e);
    }
  };

  const zuruecksetzen = async (vorherSichern) => {
    setResetDialog(false);
    try {
      const r = await aktionen.zuruecksetzen(vorherSichern);
      if (r?.schnappschussFehler) setSnapFehler(r.schnappschussFehler);
    } catch (e) {
      setFehler(e);
    }
  };

  // --- Snapshot panel (69-13) ------------------------------------------------
  const snapshotsOeffnen = async () => {
    setSnapFehler('');
    try {
      setSnapshots(await schnappschuesseListe());
    } catch (e) {
      setSnapshots([]);
      setSnapFehler(t(String(e?.message || e)));
    }
  };

  const snapshotWiederherstellen = async (id) => {
    try {
      await aktionen.snapshotWiederherstellen(id);
    } catch (e) {
      setSnapFehler(t(String(e?.message || e)));
      setSnapshots(await schnappschuesseListe().catch(() => []));
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 text-xs shrink-0">
        <span
          className={
            fehler
              ? 'inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400'
              : 'inline-flex items-center gap-1 text-slate-500 dark:text-slate-400'
          }
          title={
            [
              stand
                ? `${t('Belegt')}: ${mb(stand.benutzt)} ${t('von')} ${mb(stand.gesamt)}`
                : t('Speicherstand nicht ermittelbar'),
              // In the client the storage location has to be named: browser storage is
              // not a folder and can be cleared, which is why the backup button sits
              // right next to it (70-01; a real folder arrives with 70-03).
              t('Die Daten liegen im Speicher dieses Browsers auf diesem Gerät — Sicherung als Datei empfohlen.'),
            ]
              .filter(Boolean)
              .join('\n')
          }
        >
          {fehler ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Check className="w-3.5 h-3.5 shrink-0" />}
          {/* Words from xl on; below that the icon (and the red strip on a failed
              write) carries the state, the words stay for screen readers. The
              header has no room for them next to five buttons at 1024 px. */}
          <span className="sr-only xl:not-sr-only xl:whitespace-nowrap">
            {fehler
              ? t('nicht gespeichert')
              : gespeichert
                ? `${t('gespeichert')} · ${vorWieLange(gespeichert, t)}`
                : t('bereit')}
          </span>
        </span>
        {stand && (
          <span className="text-slate-400 dark:text-slate-500 hidden 2xl:inline whitespace-nowrap">
            {mb(stand.benutzt)} / {mb(stand.gesamt)}
          </span>
        )}
        <button
          type="button"
          ref={exportKnopfRef}
          onClick={exportOeffnen}
          title={t('Projekt als Datei sichern')}
          aria-label={t('Projekt als Datei sichern')}
          data-testid="export-oeffnen"
          className="p-2 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          type="button"
          ref={ladenKnopfRef}
          onClick={() => dateiRef.current?.click()}
          title={t('Projekt aus Datei laden')}
          aria-label={t('Projekt aus Datei laden')}
          className="p-2 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
        >
          <Upload className="w-4 h-4" />
        </button>
        <button
          type="button"
          ref={snapKnopfRef}
          onClick={snapshotsOeffnen}
          title={t('Schnappschüsse')}
          aria-label={t('Schnappschüsse')}
          data-testid="snapshots-oeffnen"
          className="p-2 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
        >
          <History className="w-4 h-4" />
        </button>
        <button
          type="button"
          ref={resetKnopfRef}
          onClick={() => setResetDialog(true)}
          title={t('Alle Daten zurücksetzen')}
          aria-label={t('Alle Daten zurücksetzen')}
          data-testid="reset-oeffnen"
          className="p-2 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <input
          ref={dateiRef}
          type="file"
          accept=".bitproj,.json"
          onChange={dateiGewaehlt}
          className="hidden"
          aria-hidden="true"
        />
      </div>

      {/* Strips under the header (65-02 warning, 69-07 backup nudge). They are
          portalled into the slot Layout renders BETWEEN <header> and <main>, so
          they take their own row and push the page down instead of covering its
          first ~45 px (the overview h1 was half hidden — HUELLE-03). Warning
          first: a failed write matters more than a reminder to save. */}
      {hinweisZiel && (fehler || nudge) && createPortal(
        <>
          {fehler && (
            <div
              role="alert"
              data-testid="speicher-warnstreifen"
              className="bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900 px-4 md:px-6 py-2 flex items-center gap-3 text-sm text-red-800 dark:text-red-200"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                {t('Der letzte Schreibvorgang ist fehlgeschlagen — die Arbeit ist nicht gesichert.')}{' '}
                {String(fehler.message || fehler)}
              </span>
              <button
                type="button"
                onClick={sichern}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
              >
                {t('Projekt sichern')}
              </button>
            </div>
          )}
          {/* 69-07: backup nudge — the save button RIGHT BESIDE the text
              (must-have: not hidden in a submenu). Shows for BOTH serverless
              builds (demo and client). */}
          {nudge && (
            <div
              data-testid="sicherung-anstoss"
              className="bg-sky-50 dark:bg-sky-950/60 border-b border-sky-200 dark:border-sky-900 px-4 md:px-6 py-2 flex items-center gap-3 text-sm text-sky-900 dark:text-sky-100"
            >
              <Save className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                {t('Ihre Arbeit liegt nur im Speicher dieses Browsers — als Datei sichern, damit sie einen geleerten Browser-Speicher übersteht.')}
              </span>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.sessionStorage.setItem(SPATER_KEY, '1');
                  } catch {
                    /* private mode — hiding for the session state is enough */
                  }
                  setNudge(false);
                }}
                data-testid="sicherung-spaeter"
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900"
              >
                {t('Später')}
              </button>
              <button
                type="button"
                onClick={sichern}
                data-testid="sicherung-jetzt"
                className="shrink-0 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 transition-colors"
              >
                {t('Projekt sichern (.bitproj)')}
              </button>
            </div>
          )}
        </>,
        hinweisZiel,
      )}

      {/* The four dialogs below (speicherDialoge.jsx) use the core dialog (Radix,
          72-11): portal on document.body, so neither the header's stacking
          context (z-30, backdrop-filter) nor the demo bar (z-40) can clip or
          cover them; role=dialog named by the heading, focus inside, Escape
          closes, focus returns to the header button (HUELLE-02). */}
      <ImportVorschauDialog
        vorschau={aktionen.importVorschau}
        onAbbrechen={aktionen.importAbbrechen}
        onUebernehmen={importBestaetigen}
        rueckfokus={fokusZurueck(ladenKnopfRef)}
      />

      <ExportDialog
        anzahlen={exportAnzahlen}
        onAbbrechen={exportAbbrechen}
        onExport={exportAusfuehren}
        rueckfokus={fokusZurueck(exportKnopfRef)}
      />

      {/* Reset dialog (69-13): the initial focus lands on "Abbrechen", the
          first and harmless choice. SpeicherStatus passes the wording (a reset
          throws away the user's own work), the dialog is wording-agnostic. */}
      <ZuruecksetzenDialog
        offen={resetDialog}
        onOpenChange={setResetDialog}
        titel={t('Alle Daten zurücksetzen?')}
        text={t('Alle Eingaben auf diesem Gerät gehen verloren.')}
        knopf={t('Alle Daten zurücksetzen')}
        onZuruecksetzen={zuruecksetzen}
        rueckfokus={fokusZurueck(resetKnopfRef)}
      />

      <SchnappschussDialog
        liste={snapshots}
        fehler={snapFehler}
        onSchliessen={() => setSnapshots(null)}
        onWiederherstellen={snapshotWiederherstellen}
        rueckfokus={fokusZurueck(snapKnopfRef)}
      />
    </>
  );
}
