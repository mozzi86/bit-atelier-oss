// Storage-location card of the desktop client (Phase 70-03, Task 2), shown in
// Settings › "Daten & Sicherung" in place of the browser-storage readout the
// PWA shows there (fill level, persistent storage). Backup, restore, snapshots
// and reset stay the shared buttons of DatenBereich below it.
//
// Shows: the storage folder in plain text, "Ordner öffnen", bytes used, the
// profile (name, office) with "Profil bearbeiten", and "Ablageort ändern":
// copy everything into an EMPTY folder and switch, or switch to a folder that
// already holds a BIT-Atelier storage. The old folder is never deleted.
//
// In:  nothing (reads the profile from the shell). Out: the card, or null
//      outside the shell.

import React from 'react';
import { FolderOpen, FolderSync, HardDrive, UserRound, AlertTriangle } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { useBestaetigung } from '@core/lib/useBestaetigung';
import { inHuelle } from './huelle.js';
import { profilLesen, profilSchreiben } from './profil.js';
import { ablageOeffnen, ablageGroesse, ablageWaehlen, ablagePruefen, ablageKopieren, istSyncOrdner } from './ablage.js';
import ProfilDialog from './ProfilDialog.jsx';

/**
 * Human-readable byte count (KB below 1 MB — a fresh storage folder is small).
 * @param {number} n bytes
 * @returns {string}
 */
export function groesseText(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const KNOPF = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * @returns {React.ReactElement|null}
 */
export default function Ablageort() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [profil, setProfil] = React.useState(/** @type {import('./profil.js').Profil|null} */ (null));
  const [belegt, setBelegt] = React.useState(/** @type {number|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [status, setStatus] = React.useState('');
  const [bearbeiten, setBearbeiten] = React.useState(false);
  const [arbeitet, setArbeitet] = React.useState(false);
  const aktiv = inHuelle();

  React.useEffect(() => {
    if (!aktiv) return undefined;
    let lebt = true;
    profilLesen().then((p) => lebt && setProfil(p)).catch((e) => lebt && setFehler(e instanceof Error ? e.message : String(e)));
    ablageGroesse().then((n) => lebt && setBelegt(n)).catch(() => lebt && setBelegt(null));
    return () => { lebt = false; };
  }, [aktiv]);

  if (!aktiv) return null;

  const melde = (/** @type {unknown} */ e) => setFehler(e instanceof Error ? e.message : String(e));

  const oeffnen = async () => {
    setFehler(null);
    setStatus('');
    try {
      await ablageOeffnen();
      setStatus(t('Ordner wird im Dateimanager geöffnet.'));
    } catch (e) {
      melde(e);
    }
  };

  const aendern = async () => {
    if (!profil) return;
    setFehler(null);
    setStatus('');
    try {
      const ordner = await ablageWaehlen(profil.ablageort);
      if (!ordner || ordner === profil.ablageort) return;
      const befund = await ablagePruefen(ordner);
      const sync = istSyncOrdner(ordner)
        ? ` ${t('Dieser Ordner wird von einem Cloud-Dienst synchronisiert. Das kann Dateien sperren oder Konfliktkopien erzeugen – ein lokaler Ordner ist sicherer.')}`
        : '';
      if (befund.hatDaten) {
        const ok = await bestaetige({
          titel: t('Zu diesem Ablageort wechseln?'),
          text: `${t('Der Ordner enthält bereits BIT-Atelier-Daten. BIT-Atelier arbeitet danach mit diesem Bestand; der bisherige Ablageort bleibt unverändert.')}${sync}`,
          bestaetigen: t('Wechseln'),
          abbrechen: t('Abbrechen'),
        });
        if (!ok) return;
      } else if (befund.leer) {
        const ok = await bestaetige({
          titel: t('Daten in den neuen Ordner kopieren?'),
          text: `${t('Alle Daten werden in den neuen Ordner kopiert, danach arbeitet BIT-Atelier dort. Der bisherige Ordner bleibt als Kopie erhalten.')}${sync}`,
          bestaetigen: t('Kopieren und wechseln'),
          abbrechen: t('Abbrechen'),
        });
        if (!ok) return;
        setArbeitet(true);
        await ablageKopieren(ordner);
      } else {
        setFehler(t('Bitte einen leeren Ordner oder einen bestehenden BIT-Atelier-Ablageort wählen.'));
        return;
      }
      setArbeitet(true);
      await profilSchreiben({ ...profil, ablageort: ordner });
      // The start gate mounts the new folder; every cache (demoDb, adapter)
      // starts fresh with it.
      window.location.reload();
    } catch (e) {
      melde(e);
    } finally {
      setArbeitet(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900" data-testid="ablageort-karte">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100"><HardDrive className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t('Ablageort')}</p>
        <code className="block break-all rounded bg-slate-100 px-1.5 py-1 text-xs dark:bg-slate-800" data-testid="ablageort-pfad">{profil?.ablageort ?? '…'}</code>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t('Belegt')}: <span data-testid="ablageort-belegt">{belegt == null ? '…' : groesseText(belegt)}</span>
          {' · '}
          {t('Hier legt BIT-Atelier alle Projekte als Dateien ab. Nehmen Sie den Ordner in Ihre Datensicherung auf.')}
        </p>
        {istSyncOrdner(profil?.ablageort) && (
          <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('Dieser Ordner wird von einem Cloud-Dienst synchronisiert. Das kann Dateien sperren oder Konfliktkopien erzeugen – ein lokaler Ordner ist sicherer.')}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={KNOPF} onClick={oeffnen} data-testid="ablageort-oeffnen"><FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> {t('Ordner öffnen')}</button>
          <button type="button" className={KNOPF} onClick={aendern} disabled={arbeitet || !profil} data-testid="ablageort-aendern"><FolderSync className="h-3.5 w-3.5" aria-hidden="true" /> {t('Ablageort ändern')}</button>
        </div>
      </div>

      <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100"><UserRound className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t('Profil')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="ablageort-profil">
          {profil ? [profil.name, profil.buero].filter(Boolean).join(' · ') : '…'}
        </p>
        <button type="button" className={KNOPF} onClick={() => setBearbeiten(true)} disabled={!profil}>{t('Profil bearbeiten')}</button>
      </div>

      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{status}</p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="ablageort-fehler">{fehler}</p>}

      <ProfilDialog
        offen={bearbeiten}
        profil={profil}
        ablageortText={profil?.ablageort ?? undefined}
        onAbbrechen={() => setBearbeiten(false)}
        onGespeichert={(p) => { setProfil(p); setBearbeiten(false); }}
      />
    </div>
  );
}
