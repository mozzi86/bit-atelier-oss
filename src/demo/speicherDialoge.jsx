// speicherDialoge.jsx — the ONE source of the import, reset, snapshot and
// export dialogs of the serverless builds (Plan 80-05). Until now these four
// dialogs (and the handler logic behind them) lived only inside
// SpeicherStatus.jsx (the header); Settings > Daten & Sicherung needed the
// SAME dialogs, not a second copy that could drift — the plan's truth
// statement is explicit: "Daten & Sicherung nutzt DIESELBEN Import-, Reset-
// und Schnappschuss-Dialoge wie der Speicherstatus (ausgelagert, nicht
// kopiert)". SpeicherStatus.jsx (69-07/69-13/79-12) is where every text,
// data-testid and interaction pattern below comes from — this file only
// relocates them and turns the closures into props.
//
// In:  props per dialog (see each component's JSDoc) plus the handler logic
//      behind useSpeicherAktions() (file read, replace, reset, restore).
// Out: ImportVorschauDialog, ZuruecksetzenDialog, SchnappschussDialog,
//      ExportDialog, SEPARAT_SCHRITTE, useSpeicherAktionen(), fokusZurueck().

import React from 'react';
import { useI18n } from '@core/lib/i18n';
import { useAuth } from '@core/lib/AuthContext';
import { DATENQUELLE } from '@core/lib/umgebung';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@core/components/ui/dialog';
import { demoDbAuslesen, demoDbZuruecksetzen } from '@core/api/demoDb';
import { exportProjekt, leseProjektDatei, uebernehmeProjekt } from '@core/api/projektDatei';
import { schnappschussWiederherstellen } from '@core/api/schnappschuesse';
// 79-12 (E-07): the export-dialog registry lives in src/ (app-only), because a
// package under packages/ may not import from "@/" — see the file header there.
import { EXPORT_BEREICHE, exportOptionen, importOptionen } from '@/lib/exportBereiche';
import { personalZugang } from '@/lib/people/zugang.js';
// B-2 (BEFUNDE-80): the wired .bitpers step itself — PersonalSicherung.jsx is a
// JSX file like this one (loaded through Vite at build time), so importing it
// here does not affect exportSchritte.js's React-free, node-testable status.
import { bitpersSchritt } from '@/components/people/PersonalSicherung.jsx';
import { separatPlan, vorschauZeilen, passphraseGueltig, PASSPHRASE_MINDESTLAENGE } from './exportSchritte.js';

/**
 * Steps for `separat` export areas (E-14): key = an area's `separat` VALUE
 * (e.g. ".bitpers"), value = the async function that writes that side file,
 * called as `schritt({personalZugang, passphrase})`. Wired since B-2: a ticked
 * "Personal" with a valid passphrase now produces the real `.bitpers` download
 * next to the `.bitproj`; a missing/too-short/mistyped passphrase — or, in
 * principle, an area whose step is not (yet) entered here — still lands in
 * `fehlend` and ExportDialog reports it in plain text instead of silently
 * skipping it — 80-05's explicit requirement (b-12 checks it).
 * @type {Record<string, (args: {personalZugang?: string, passphrase: string}) => Promise<any>>}
 */
export const SEPARAT_SCHRITTE = { '.bitpers': bitpersSchritt };

/**
 * onCloseAutoFocus handler that returns the focus to a header/page button
 * instead of wherever Radix would otherwise put it. Shared by every dialog
 * below and by their two callers (SpeicherStatus.jsx, DatenBereich.jsx).
 * @param {React.MutableRefObject<HTMLElement|null>} ref
 * @returns {(e: Event) => void}
 */
export function fokusZurueck(ref) {
  return (e) => {
    e.preventDefault();
    ref.current?.focus();
  };
}

/**
 * Sum of a registry area's entity counts in a plain data object (demoDb shape).
 * @param {{entitaeten: readonly string[]}} bereich
 * @param {Record<string, object[]>} daten
 * @returns {number}
 */
function anzahlIn(bereich, daten) {
  return bereich.entitaeten.reduce((n, e) => n + (Array.isArray(daten?.[e]) ? daten[e].length : 0), 0);
}

/**
 * The handler logic behind the import/reset/restore dialogs — SpeicherStatus
 * (header) and DatenBereich (Settings) each call this instead of duplicating
 * the file-read, demoDbErsetzen, demoDbZuruecksetzen and
 * schnappschussWiederherstellen wiring. Each caller keeps its OWN open/closed
 * state (its own buttons trigger its own dialogs) — only the ACTIONS, and the
 * import preview they compute, are shared. Every function here can throw; the
 * caller wraps its own click handlers the way SpeicherStatus.jsx always did
 * (`try { … } catch (e) { setFehler(e); }`) so the header's failure banner
 * still means what it says.
 * @returns {{
 *   importVorschau: object|null,
 *   dateiGewaehlt: (datei: File) => Promise<void>,
 *   importAbbrechen: () => void,
 *   importBestaetigen: (vorherSichern?: boolean) => Promise<{schnappschuss: object|null, schnappschussFehler: string|null}>,
 *   zuruecksetzen: (vorherSichern?: boolean) => Promise<{schnappschuss: object|null, schnappschussFehler: string|null}>,
 *   snapshotWiederherstellen: (id: string) => Promise<void>,
 * }}
 */
export function useSpeicherAktionen() {
  const [importVorschau, setImportVorschau] = React.useState(/** @type {any} */ (null));

  const dateiGewaehlt = async (datei) => {
    const gelesen = await leseProjektDatei(datei);
    // 79-12 (E-07): per-area preview — an area the file omits keeps its local
    // data (importOptionen, presence-based); an area the file DOES carry, but
    // empty, over a locally FILLED one needs an extra, explicit confirmation
    // (leerErsetztGefuellt) before the import is allowed to proceed.
    const importOpt = importOptionen(gelesen.obj);
    /** @type {Record<string, object[]>} */
    let lokal = {};
    try {
      lokal = await demoDbAuslesen();
    } catch {
      lokal = {};
    }
    const { zeilen: basisZeilen, separatHinweis } = vorschauZeilen(EXPORT_BEREICHE, importOpt);
    const zeilen = basisZeilen.map((zeile) => {
      const bereich = EXPORT_BEREICHE.find((b) => b.key === zeile.key);
      const lokalAnzahl = anzahlIn(bereich, lokal);
      const dateiAnzahl = zeile.enthalten ? anzahlIn(bereich, gelesen.obj?.daten || {}) : 0;
      return { ...zeile, leerErsetztGefuellt: zeile.enthalten && dateiAnzahl === 0 && lokalAnzahl > 0 };
    });
    setImportVorschau({ ...gelesen, importOptionen: importOpt, zeilen, separatHinweis });
  };

  const importAbbrechen = () => setImportVorschau(null);

  const importBestaetigen = async (vorherSichern = false) => {
    // 69-13: "save first" exports the CURRENT state as a .bitproj file before
    // the import replaces it — an equal choice beside cancel.
    if (vorherSichern) await exportProjekt();
    const r = await uebernehmeProjekt(importVorschau.obj, importVorschau.importOptionen);
    setImportVorschau(null);
    // Every module holds loaded records in memory — after a full replace a
    // reload is more honest than a partial refresh.
    window.location.reload();
    return r;
  };

  const zuruecksetzen = async (vorherSichern = false) => {
    if (vorherSichern) await exportProjekt();
    const r = await demoDbZuruecksetzen();
    window.location.reload();
    return r;
  };

  const snapshotWiederherstellen = async (id) => {
    await schnappschussWiederherstellen(id);
    window.location.reload();
  };

  return { importVorschau, dateiGewaehlt, importAbbrechen, importBestaetigen, zuruecksetzen, snapshotWiederherstellen };
}

/**
 * Import preview dialog (79-12/80-05): the file's project name, export date
 * and total record count, one row per non-`separat` registry area ("enthalten
 * — ersetzt Ihre …" / "nicht enthalten — Ihre … bleibt erhalten") plus, when
 * the registry has a `separat` area, one shared sentence for it (BEFUNDE-79
 * N-11 — a `separat` area is never "in" a .bitproj, so a per-area line for it
 * would always misleadingly read "not included"). An area the file carries
 * EMPTY over one locally filled needs an explicit tick before either replace
 * button unlocks.
 * @param {{
 *   vorschau: {vorschau: {projektname: string, exportiert: string, gesamt: number},
 *     zeilen: Array<{key: string, label: string, enthalten: boolean, leerErsetztGefuellt: boolean}>,
 *     separatHinweis: boolean} | null,
 *   onAbbrechen: () => void,
 *   onUebernehmen: (vorherSichern: boolean) => void,
 *   rueckfokus: (e: Event) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export function ImportVorschauDialog({ vorschau, onAbbrechen, onUebernehmen, rueckfokus }) {
  const { t } = useI18n();
  const [leerBestaetigt, setLeerBestaetigt] = React.useState(false);
  // A freshly offered file (a new `vorschau` object) always starts unconfirmed —
  // reusing an earlier tick across two different files would be a silent bypass.
  React.useEffect(() => {
    setLeerBestaetigt(false);
  }, [vorschau]);

  const importWarnungNoetig = (vorschau?.zeilen || []).some((z) => z.leerErsetztGefuellt);
  const importGesperrt = importWarnungNoetig && !leerBestaetigt;

  return (
    <Dialog open={!!vorschau} onOpenChange={(offen) => { if (!offen) onAbbrechen(); }}>
      <DialogContent showCloseButton={false} className="max-w-md p-5" data-testid="import-dialog" onCloseAutoFocus={rueckfokus}>
        <DialogTitle className="text-base mb-1">{t('Projekt laden')}</DialogTitle>
        <DialogDescription className="mb-3">
          {t('Der aktuelle Stand in diesem Browser wird dabei vollständig ersetzt.')}{' '}
          {t('Ein Schnappschuss der aktuellen Daten wird automatisch angelegt.')}
        </DialogDescription>
        {vorschau && (
          <dl className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 mb-4">
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">{t('Projekt')}</dt>
              <dd className="font-medium">{vorschau.vorschau.projektname}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">{t('Gesichert am')}</dt>
              <dd>{new Date(vorschau.vorschau.exportiert).toLocaleString('de-DE')}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">{t('Datensätze')}</dt>
              <dd>{vorschau.vorschau.gesamt}</dd>
            </div>
          </dl>
        )}
        {/* 79-12 (E-07): one line per non-separat registry area — presence-based,
            so an area the file omits is announced as kept, not silently dropped. */}
        {vorschau?.zeilen?.length > 0 && (
          <ul className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 mb-3" data-testid="import-bereiche">
            {vorschau.zeilen.map((zeile) => (
              <li
                key={zeile.key}
                className={`px-3 py-2 ${zeile.enthalten ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}
                data-testid={`import-bereich-${zeile.key}`}
              >
                {zeile.enthalten
                  ? <>{t('enthalten — ersetzt Ihre')} {t(zeile.label)}</>
                  : <>{t('nicht enthalten — Ihre')} {t(zeile.label)} {t('bleibt erhalten')}</>}
              </li>
            ))}
          </ul>
        )}
        {/* 80-05: a `separat` area (Personal, E-14) never enters the .bitproj at
            all — one shared sentence instead of a misleading per-area row. */}
        {vorschau?.separatHinweis && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3" data-testid="import-separat-hinweis">
            {t('Personaldaten sind nie Teil der Projektdatei und bleiben unverändert.')}
          </p>
        )}
        {importWarnungNoetig && (
          <div
            role="alert"
            data-testid="import-leer-warnung"
            className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <p className="mb-1.5">{t('Die Datei enthält einen leeren Bereich, der hier gefüllt ist — dieser Import löscht die vorhandenen Daten.')}</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={leerBestaetigt}
                onChange={(ev) => setLeerBestaetigt(ev.target.checked)}
                data-testid="import-leer-bestaetigen"
              />
              {t('Trotzdem ersetzen')}
            </label>
          </div>
        )}
        {/* 69-13 must-have 3: "save first" is an EQUAL choice beside cancel. */}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onAbbrechen}
            data-testid="import-abbrechen"
            className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('Abbrechen')}
          </button>
          <button
            type="button"
            onClick={() => onUebernehmen(true)}
            disabled={importGesperrt}
            data-testid="import-vorher-sichern"
            className="px-3 py-2 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {t('Vorher sichern (.bitproj)')}
          </button>
          <button
            type="button"
            onClick={() => onUebernehmen(false)}
            disabled={importGesperrt}
            data-testid="import-ersetzen"
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
          >
            {t('Laden und ersetzen')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reset confirmation (69-13): three equal choices — save first, reset,
 * cancel. `titel`/`text` come from the caller (SpeicherStatus.jsx, the
 * Settings data area) — this component stays wording-agnostic.
 * @param {{
 *   offen: boolean,
 *   onOpenChange: (offen: boolean) => void,
 *   titel: string, text: string, knopf: string,
 *   onZuruecksetzen: (vorherSichern: boolean) => void,
 *   rueckfokus: (e: Event) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export function ZuruecksetzenDialog({ offen, onOpenChange, titel, text, knopf, onZuruecksetzen, rueckfokus }) {
  const { t } = useI18n();
  return (
    <Dialog open={offen} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-md p-5" data-testid="reset-dialog" onCloseAutoFocus={rueckfokus}>
        <DialogTitle className="text-base mb-1">{titel}</DialogTitle>
        <DialogDescription className="mb-4">
          {text}{' '}
          {t('Ein Schnappschuss der aktuellen Daten wird automatisch angelegt.')}
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            data-testid="reset-abbrechen"
            className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('Abbrechen')}
          </button>
          <button
            type="button"
            onClick={() => onZuruecksetzen(true)}
            data-testid="reset-vorher-sichern"
            className="px-3 py-2 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950"
          >
            {t('Vorher sichern (.bitproj)')}
          </button>
          <button
            type="button"
            onClick={() => onZuruecksetzen(false)}
            data-testid="reset-zuruecksetzen"
            className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
          >
            {knopf}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Snapshot panel (69-13 must-have 2): time, reason and record count per
 * entry; restore asks for an inline confirmation first. Failure/refresh stays
 * the caller's concern (it owns `liste` and re-fetches it) — this component
 * only shows what it is given.
 * @param {{
 *   liste: Array<{id: string, zeit: number, grund: string, datensaetze: number}> | null,
 *   fehler?: string,
 *   onSchliessen: () => void,
 *   onWiederherstellen: (id: string) => void,
 *   rueckfokus: (e: Event) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export function SchnappschussDialog({ liste, fehler = '', onSchliessen, onWiederherstellen, rueckfokus }) {
  const { t } = useI18n();
  const [bestaetigen, setBestaetigen] = React.useState(/** @type {string|null} */ (null));
  React.useEffect(() => {
    setBestaetigen(null);
  }, [liste]);

  return (
    <Dialog open={liste !== null} onOpenChange={(offen) => { if (!offen) onSchliessen(); }}>
      <DialogContent showCloseButton={false} className="max-w-md max-h-[90vh] overflow-y-auto p-5" data-testid="snapshot-panel" onCloseAutoFocus={rueckfokus}>
        <DialogTitle className="text-base mb-1">{t('Schnappschüsse')}</DialogTitle>
        <DialogDescription className="mb-3">
          {t('Die letzten fünf Schnappschüsse — vor jedem Zurücksetzen, Import und Wiederherstellen automatisch angelegt.')}
        </DialogDescription>
        {fehler && (
          <p className="mb-3 text-xs text-red-600 dark:text-red-400" role="alert" data-testid="snapshot-fehler">{fehler}</p>
        )}
        {liste?.length === 0 && (
          <p className="text-sm text-slate-400 py-4 text-center" data-testid="snapshot-leer">
            {t('Noch keine Schnappschüsse — sie entstehen automatisch vor dem nächsten Zurücksetzen oder Import.')}
          </p>
        )}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg max-h-72 overflow-auto" data-testid="snapshot-liste">
          {(liste || []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`snapshot-eintrag-${s.id}`}>
              <span className="flex-1 min-w-0">
                {/* The stored reason stays German ("vor Reset", data); the label follows the language. */}
                <span className="block truncate text-slate-800 dark:text-slate-100">{t(s.grund)}</span>
                <span className="block text-xs text-slate-400">
                  {new Date(s.zeit).toLocaleString('de-DE')} · {s.datensaetze} {t('Datensätze')}
                </span>
              </span>
              {bestaetigen === s.id ? (
                <span className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onWiederherstellen(s.id)}
                    data-testid={`snapshot-ja-${s.id}`}
                    className="px-2 py-1 rounded-md bg-emerald-600 text-white text-xs hover:bg-emerald-700"
                  >
                    {t('Wiederherstellen?')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBestaetigen(null)}
                    className="px-2 py-1 rounded-md text-slate-500 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t('Abbrechen')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setBestaetigen(s.id)}
                  data-testid={`snapshot-wiederherstellen-${s.id}`}
                  className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  {t('Wiederherstellen')}
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={onSchliessen}
            data-testid="snapshot-schliessen"
            className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('Schließen')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shared input look — same class as PersonalSicherung.jsx's own passphrase fields. */
const PASSPHRASE_EINGABE = 'flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

/**
 * Export dialog (79-12, E-07, extended 80-05/80-10/B-2): one checkbox per
 * REGISTRY area, OFF by default (the dialog IS the deliberate choice for a
 * handover file). The button reads "Sicherung speichern (alles)" once every
 * area is ticked (`exportOptionen(...).art === "sicherung"`), otherwise
 * "Projektdatei speichern". A `separat` area (Personal, E-14) shows no record
 * count next to its checkbox — its collections never live in demoDb (80-05
 * objective) — and, once ticked, an inline passphrase field (B-2): the
 * `.bitproj` always exports regardless (a separat area never touches it), the
 * `.bitpers` side file only when that passphrase is present, long enough and
 * (with its confirm field) matching — otherwise the area is reported exactly
 * like an unwired step, never silently attempted with a weak passphrase.
 * `open` is driven by `anzahlen` itself (`null` = closed), the same pattern
 * ImportVorschauDialog/SchnappschussDialog use with `vorschau`/`liste`.
 * @param {{
 *   registry?: ReadonlyArray<import("@/lib/exportBereiche.js").ExportBereich>,
 *   anzahlen: Record<string, number> | null,
 *   onAbbrechen: () => void,
 *   onExport: (optionen: ReturnType<typeof exportOptionen>) => Promise<void>,
 *   rueckfokus: (e: Event) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export function ExportDialog({ registry = EXPORT_BEREICHE, anzahlen, onAbbrechen, onExport, rueckfokus }) {
  const { t } = useI18n();
  const { user } = useAuth();
  // Same gate PersonalZaehlkarte.jsx/usePersonalkostenPlan.js use — locally
  // cosmetic (see @/lib/people/zugang.js), bitpersSchritt checks it again itself.
  const zugangAktuell = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const [gewaehlt, setGewaehlt] = React.useState(/** @type {Set<string>} */ (new Set()));
  const [fehlendeSchritte, setFehlendeSchritte] = React.useState(/** @type {Array<{key: string, label: string}>} */ ([]));
  const [passphrasen, setPassphrasen] = React.useState(/** @type {Record<string, {a: string, b: string}>} */ ({}));
  const offen = anzahlen != null;

  // A freshly opened dialog always starts with every box off (the deliberate
  // choice for a handover file, 79-12), no leftover "missing step" text from a
  // previous open, and empty passphrase fields (B-2).
  React.useEffect(() => {
    if (offen) {
      setGewaehlt(new Set());
      setFehlendeSchritte([]);
      setPassphrasen({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on the open/close EDGE, not on every re-render while open
  }, [offen]);

  const umschalten = (schluessel) => {
    setGewaehlt((bisher) => {
      const naechster = new Set(bisher);
      if (naechster.has(schluessel)) naechster.delete(schluessel);
      else naechster.add(schluessel);
      return naechster;
    });
  };

  /** @param {string} schluessel @param {'a'|'b'} feld @param {string} wert */
  const passphraseAendern = (schluessel, feld, wert) => {
    setPassphrasen((bisher) => ({ ...bisher, [schluessel]: { ...(bisher[schluessel] || { a: '', b: '' }), [feld]: wert } }));
  };

  const optionenAktuell = exportOptionen([...gewaehlt], registry);
  // Which separat areas need a passphrase field right now (only while ticked).
  const separatGewaehlt = registry.filter((b) => b.separat && gewaehlt.has(b.key));

  const bestaetigen = async () => {
    try {
      // onExport is the caller's own exportProjekt(...) wrapper — it reports
      // its own errors (SpeicherStatus.jsx's `setFehler`) and rethrows, same
      // as before this plan, so a failed download leaves the dialog open. A
      // separat area never enters the .bitproj either way (E-14), so this
      // always runs regardless of any passphrase below.
      await onExport(optionenAktuell);
    } catch {
      return;
    }
    // B-2: a wired step (SEPARAT_SCHRITTE) still needs a valid passphrase
    // before it runs — invalid/missing lands in `nichtBereit` exactly like an
    // unwired step (same banner, same testid, b-12's existing check for it
    // stays meaningful: it now proves the GUARD, not just the gap).
    const { aufrufe, fehlend } = separatPlan(optionenAktuell, registry, SEPARAT_SCHRITTE);
    const nichtBereit = [...fehlend];
    for (const eintrag of aufrufe) {
      const werte = passphrasen[eintrag.key] || { a: '', b: '' };
      if (!passphraseGueltig(werte.a, werte.b)) { nichtBereit.push(eintrag); continue; }
      try {
        await SEPARAT_SCHRITTE[eintrag.separat]({ personalZugang: zugangAktuell, passphrase: werte.a });
      } catch {
        nichtBereit.push(eintrag); // e.g. no personal access — reported the same way, never thrown at the visitor
      }
    }
    if (nichtBereit.length) {
      setFehlendeSchritte(nichtBereit); // stay open, say so in plain text — never silently skip
      return;
    }
    onAbbrechen(); // closes the dialog, same as a successful export always has
  };

  return (
    <Dialog open={offen} onOpenChange={(o) => { if (!o) onAbbrechen(); }}>
      <DialogContent showCloseButton={false} className="max-w-md p-5" data-testid="export-dialog" onCloseAutoFocus={rueckfokus}>
        <DialogTitle className="text-base mb-1">{t('Projektdatei exportieren')}</DialogTitle>
        <DialogDescription className="mb-3">
          {t('Ohne Häkchen: Datei für Planer und Bauherr — ohne Büro-Daten.')}
        </DialogDescription>
        <ul className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 mb-4">
          <li className="flex items-center justify-between px-3 py-2 text-slate-500 dark:text-slate-400">
            <span>{t('Projektdaten (immer)')}</span>
          </li>
          {registry.map((bereich) => (
            <li key={bereich.key} className="flex items-center justify-between px-3 py-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={gewaehlt.has(bereich.key)}
                  onChange={() => umschalten(bereich.key)}
                  data-testid={`export-bereich-${bereich.key}`}
                />
                {t(bereich.label)}
              </label>
              {/* A separat area's records never live in demoDb — no count to show (80-05 objective). */}
              {!bereich.separat && (
                <span className="text-slate-400 dark:text-slate-500 text-xs">
                  {anzahlen?.[bereich.key] ?? 0} {t('Datensätze')}
                </span>
              )}
            </li>
          ))}
        </ul>
        {/* B-2: a ticked separat area (Personal) asks for its own passphrase right
            here — masked, no autocomplete, the same rule as PersonalSicherung.jsx's
            "Personaldaten sichern" (min. length, must match its confirm field). */}
        {separatGewaehlt.map((bereich) => {
          const werte = passphrasen[bereich.key] || { a: '', b: '' };
          const zuKurz = werte.a.length > 0 && werte.a.length < PASSPHRASE_MINDESTLAENGE;
          const nichtGleich = !zuKurz && werte.b.length > 0 && werte.a !== werte.b;
          return (
            <div
              key={bereich.key}
              className="mb-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3"
              data-testid={`export-passphrase-block-${bereich.key}`}
            >
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                {t('Für {bereich} eine Passphrase für die verschlüsselte Sicherung festlegen.').replace('{bereich}', t(bereich.label))}
              </p>
              <div className="space-y-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  className={PASSPHRASE_EINGABE}
                  placeholder={t('Passphrase')}
                  value={werte.a}
                  onChange={(e) => passphraseAendern(bereich.key, 'a', e.target.value)}
                  data-testid={`export-passphrase-${bereich.key}`}
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  className={PASSPHRASE_EINGABE}
                  placeholder={t('Passphrase wiederholen')}
                  value={werte.b}
                  onChange={(e) => passphraseAendern(bereich.key, 'b', e.target.value)}
                  data-testid={`export-passphrase-wiederholen-${bereich.key}`}
                />
              </div>
              {zuKurz && (
                <p className="mt-1 text-xs text-rose-600" data-testid={`export-passphrase-hinweis-${bereich.key}`}>
                  {t('Mindestens {n} Zeichen.').replace('{n}', String(PASSPHRASE_MINDESTLAENGE))}
                </p>
              )}
              {nichtGleich && (
                <p className="mt-1 text-xs text-rose-600" data-testid={`export-passphrase-hinweis-${bereich.key}`}>
                  {t('Die Passphrasen stimmen nicht überein.')}
                </p>
              )}
            </div>
          );
        })}
        {fehlendeSchritte.map((f) => (
          <p
            key={f.key}
            role="alert"
            data-testid={`export-separat-fehlt-${f.key}`}
            className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            {t('Für {bereich} fehlt der Sicherungsschritt — nicht gesichert').replace('{bereich}', t(f.label))}
          </p>
        ))}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onAbbrechen}
            data-testid="export-abbrechen"
            className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('Abbrechen')}
          </button>
          <button
            type="button"
            onClick={bestaetigen}
            data-testid="export-bestaetigen"
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            {optionenAktuell.art === 'sicherung' ? t('Sicherung speichern (alles)') : t('Projektdatei speichern')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
