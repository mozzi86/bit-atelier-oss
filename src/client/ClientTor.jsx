// Start gate of the desktop client (Phase 70-02 profile, 70-03 storage location).
//
// Why a gate around <App/> and not a dialog inside it: the app reads data on
// its first render (ProjectProvider lists projects). The file storage has to
// be mounted BEFORE that — otherwise the first read would go to the WebView's
// IndexedDB and the app would show (and cache) the wrong data. So in the shell
// main.jsx renders this gate, and the app only after the storage is ready.
// Outside the shell (browser PWA, office build) the gate renders its children
// directly and touches nothing.
//
// Steps: read profile → (first start: profile dialog with storage location) →
// check the folder exists → mount the file storage → offer the one-time
// takeover → render the app.
//
// In:  children (the app). Out: the app, or one of the start screens.

import React from 'react';
import { FolderOpen, AlertTriangle, Download } from 'lucide-react';
import { I18nProvider, useI18n } from '@core/lib/i18n';
import { demoIdb } from '@core/api/demoIdb';
import { demoDbAuslesen, demoDbErsetzen } from '@core/api/demoDb';
import { inHuelle, huelleAufrufen } from './huelle.js';
import { profilLesen } from './profil.js';
import { speicherEinhaengen, ablageStandard, ablageWaehlen, ablagePruefen, istSyncOrdner, huellenDateien } from './ablage.js';
import { uebernahmeAngebot, uebernahmeAusfuehren, uebernahmeAblehnen } from './uebernahme.js';
import ProfilDialog from './ProfilDialog.jsx';

/**
 * @typedef {import('./profil.js').Profil} Profil
 * @typedef {import('./uebernahme.js').Angebot} Angebot
 */

/**
 * Everything this client's 70-02 stage left in the WebView's IndexedDB
 * (project collections only — demoIdb.entities() hides HR stores and the
 * snapshot ring).
 * @returns {Promise<Record<string, object[]>>}
 */
async function webviewBestand() {
  /** @type {Record<string, object[]>} */
  const db = {};
  for (const e of await demoIdb.entities()) db[e] = await demoIdb.alle(e);
  return db;
}

/**
 * Plain-text notes for a chosen folder.
 * @param {string|null} pfad
 * @param {{vorhanden: boolean, hatDaten: boolean, leer: boolean}|null} befund
 * @param {(s: string) => string} t
 * @returns {string[]}
 */
function hinweiseFuer(pfad, befund, t) {
  const h = [];
  if (istSyncOrdner(pfad)) h.push(t('Dieser Ordner wird von einem Cloud-Dienst synchronisiert. Das kann Dateien sperren oder Konfliktkopien erzeugen – ein lokaler Ordner ist sicherer.'));
  if (befund?.hatDaten) h.push(t('Der Ordner enthält bereits BIT-Atelier-Daten – sie werden verwendet.'));
  else if (befund && !befund.leer) h.push(t('Der Ordner ist nicht leer. BIT-Atelier legt seine Unterordner daneben an.'));
  return h;
}

/** Shell around the start screens: centred card, full window. */
function Karte({ children }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6 dark:bg-[#0b1220]">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" role="status" data-testid="client-tor">
        {children}
      </div>
    </div>
  );
}

const KNOPF = 'inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';
const KNOPF_HAUPT = 'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60';

/**
 * The gate itself (inside the I18nProvider of ClientTor).
 * @param {{children: React.ReactNode}} props
 * @returns {React.ReactElement}
 */
function Tor({ children }) {
  const { t } = useI18n();
  const [schritt, setSchritt] = React.useState(/** @type {'laden'|'profil'|'fehlt'|'fehler'|'uebernahme'|'bereit'} */ ('laden'));
  const [profil, setProfil] = React.useState(/** @type {Profil|null} */ (null));
  const [ladeFehler, setLadeFehler] = React.useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [wahl, setWahl] = React.useState(/** @type {{wert: string|null, befund: any}} */ ({ wert: null, befund: null }));
  const [angebot, setAngebot] = React.useState(/** @type {Angebot|null} */ (null));
  const [arbeitet, setArbeitet] = React.useState(false);
  const speicherRef = React.useRef(/** @type {any} */ (null));

  /** Mount the storage of a profile and continue with the takeover check. */
  const einhaengen = React.useCallback(async (/** @type {Profil} */ p) => {
    setFehler(null);
    const ort = /** @type {string} */ (p.ablageort);
    try {
      const befund = await ablagePruefen(ort);
      if (!befund.vorhanden) {
        setSchritt('fehlt');
        return;
      }
      speicherRef.current = await speicherEinhaengen(ort);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      setSchritt('fehler');
      return;
    }
    try {
      const a = await uebernahmeAngebot({
        altbestandLesen: () => huelleAufrufen('altbestand_lesen'),
        webviewLesen: webviewBestand,
        ablageLesen: demoDbAuslesen,
        meta: (...arg) => speicherRef.current.meta(...arg),
      });
      if (a.gefunden) {
        setAngebot(a);
        setSchritt('uebernahme');
        return;
      }
    } catch (e) {
      // A damaged old database is shown — the app still starts, nothing is marked,
      // so the offer comes back once the file is repaired.
      setAngebot(null);
      setFehler(e instanceof Error ? e.message : String(e));
      setSchritt('uebernahme');
      return;
    }
    setSchritt('bereit');
  }, []);

  React.useEffect(() => {
    let aktiv = true;
    (async () => {
      try {
        const p = await profilLesen();
        if (!aktiv) return;
        setProfil(p);
        if (p?.ablageort) {
          await einhaengen(p);
          return;
        }
      } catch (e) {
        if (!aktiv) return;
        setLadeFehler(e instanceof Error ? e.message : String(e));
      }
      // First start, a 70-02 profile without a folder, or a damaged profile:
      // propose the default folder.
      try {
        const standard = await ablageStandard();
        const befund = await ablagePruefen(standard);
        if (aktiv) setWahl({ wert: standard, befund });
      } catch (e) {
        if (aktiv) setLadeFehler((alt) => alt ?? (e instanceof Error ? e.message : String(e)));
      }
      if (aktiv) setSchritt('profil');
    })();
    return () => { aktiv = false; };
  }, [einhaengen]);

  const waehlen = async () => {
    try {
      const ordner = await ablageWaehlen(wahl.wert);
      if (!ordner) return;
      setWahl({ wert: ordner, befund: await ablagePruefen(ordner) });
    } catch (e) {
      setLadeFehler(e instanceof Error ? e.message : String(e));
    }
  };

  /** The folder in the profile is gone: create it empty, or pick another one. */
  const fehltNeuAnlegen = async () => {
    if (!profil) return;
    setArbeitet(true);
    try {
      // dateiSpeicher.vorbereiten() creates the whole layout; the shell's
      // root is the profile's folder, so creating "" creates the folder itself.
      await huellenDateien.ordnerAnlegen('');
      await einhaengen(profil);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      setSchritt('fehler');
    } finally {
      setArbeitet(false);
    }
  };

  const anderenOrdner = async () => {
    try {
      const ordner = await ablageWaehlen(profil?.ablageort ?? null);
      if (!ordner) return;
      setWahl({ wert: ordner, befund: await ablagePruefen(ordner) });
      setSchritt('profil');
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const uebernehmen = async () => {
    if (!angebot) return;
    setArbeitet(true);
    try {
      await uebernahmeAusfuehren(angebot, {
        sichernNode: (quelle, name) => huelleAufrufen('altbestand_sichern', { quelle, name }),
        sichernText: async (name, text) => {
          await huellenDateien.ordnerAnlegen('uebernahme');
          await huellenDateien.schreiben(`uebernahme/${name}`, text);
          return `uebernahme/${name}`;
        },
        ersetzen: (db) => demoDbErsetzen(db, 'vor Übernahme'),
        meta: (...arg) => speicherRef.current.meta(...arg),
      });
      setSchritt('bereit');
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setArbeitet(false);
    }
  };

  const ablehnen = async () => {
    setArbeitet(true);
    try {
      if (angebot) await uebernahmeAblehnen(angebot, (...arg) => speicherRef.current.meta(...arg));
      setSchritt('bereit');
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setArbeitet(false);
    }
  };

  if (schritt === 'bereit') return <>{children}</>;

  if (schritt === 'profil') {
    return (
      <div className="fixed inset-0 bg-slate-50 dark:bg-[#0b1220]">
        <ProfilDialog
          offen
          pflicht
          profil={profil}
          ladeFehler={ladeFehler}
          ablageortWahl={{ wert: wahl.wert, onWaehlen: waehlen, hinweise: hinweiseFuer(wahl.wert, wahl.befund, t) }}
          onGespeichert={(p) => { setProfil(p); setLadeFehler(null); setSchritt('laden'); einhaengen(p); }}
        />
      </div>
    );
  }

  if (schritt === 'fehlt') {
    return (
      <Karte>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" /> {t('Ablageort nicht gefunden')}</h1>
        <p className="break-all rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800" data-testid="client-tor-pfad">{profil?.ablageort}</p>
        <p>{t('Der Ordner aus Ihrem Profil existiert nicht (mehr). Ist ein Laufwerk nicht verbunden, schließen Sie BIT-Atelier und verbinden Sie es zuerst.')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={KNOPF} onClick={anderenOrdner}><FolderOpen className="h-4 w-4" aria-hidden="true" /> {t('Anderen Ordner wählen')}</button>
          <button type="button" className={KNOPF_HAUPT} disabled={arbeitet} onClick={fehltNeuAnlegen} data-testid="client-tor-neu">{t('Leer neu anlegen')}</button>
        </div>
      </Karte>
    );
  }

  if (schritt === 'fehler') {
    return (
      <Karte>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><AlertTriangle className="h-5 w-5 text-rose-600" aria-hidden="true" /> {t('Ablageort nicht nutzbar')}</h1>
        <p className="break-all rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">{profil?.ablageort}</p>
        <p role="alert" className="text-rose-700 dark:text-rose-300" data-testid="client-tor-fehler">{fehler}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={KNOPF} onClick={anderenOrdner}><FolderOpen className="h-4 w-4" aria-hidden="true" /> {t('Anderen Ordner wählen')}</button>
          <button type="button" className={KNOPF_HAUPT} onClick={() => profil && einhaengen(profil)}>{t('Erneut versuchen')}</button>
        </div>
      </Karte>
    );
  }

  if (schritt === 'uebernahme') {
    return (
      <Karte>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Download className="h-5 w-5 text-emerald-600" aria-hidden="true" /> {t('Bisherige Daten übernehmen?')}</h1>
        {angebot ? (
          <>
            <p data-testid="uebernahme-text">
              {t('{n} Datensätze aus der bisherigen Installation übernehmen?').replace('{n}', String(angebot.datensaetze))}
            </p>
            <p className="break-all text-xs text-slate-500 dark:text-slate-400">
              {angebot.quelle === 'node' ? `${t('Quelle')}: ${angebot.pfad}` : t('Quelle: Browser-Speicher dieses Programms (frühere Fassung)')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('Vorher wird eine Sicherungskopie im Ablageort (Ordner „uebernahme“) angelegt. Die bisherige Installation bleibt unverändert.')}</p>
          </>
        ) : null}
        {fehler && <p role="alert" className="text-rose-700 dark:text-rose-300" data-testid="uebernahme-fehler">{fehler}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={KNOPF} disabled={arbeitet} onClick={ablehnen} data-testid="uebernahme-nein">{angebot ? t('Nicht übernehmen') : t('Ohne Übernahme weiter')}</button>
          {angebot && <button type="button" className={KNOPF_HAUPT} disabled={arbeitet} onClick={uebernehmen} data-testid="uebernahme-ja">{t('Übernehmen')}</button>}
        </div>
      </Karte>
    );
  }

  return (
    <Karte>
      <p>{t('Ablageort wird geöffnet …')}</p>
    </Karte>
  );
}

/**
 * Renders the app — in the desktop shell only after the profile and the
 * storage folder are ready.
 * @param {{children: React.ReactNode}} props
 * @returns {React.ReactElement}
 */
export default function ClientTor({ children }) {
  if (!inHuelle()) return <>{children}</>;
  return (
    <I18nProvider>
      <Tor>{children}</Tor>
    </I18nProvider>
  );
}
