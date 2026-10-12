// Profile dialog of the desktop client (Phase 70-02, Task 3): name, office and
// the storage location, shown on the first start and whenever the profile is
// edited. Only ever rendered inside the shell (ClientStart / Ablageort check
// inHuelle()); the browser build never shows it.
//
// In:  props (see ProfilDialog). Out: the dialog; calls onGespeichert with the
//      stored profile.

import React from 'react';
import { UserRound, FolderOpen, AlertTriangle } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@core/components/ui/dialog';
import { profilPruefen, profilSchreiben } from './profil.js';

/**
 * @typedef {import('./profil.js').Profil} Profil
 */

/**
 * @param {{
 *   offen: boolean,
 *   profil: Profil|null,
 *   pflicht?: boolean,
 *   ladeFehler?: string|null,
 *   ablageortText?: string,
 *   ablageortWahl?: {wert: string|null, onWaehlen: () => void, hinweise?: string[]},
 *   onGespeichert: (p: Profil) => void,
 *   onAbbrechen?: () => void,
 * }} props
 *   pflicht: first start — no close button, Escape and outside click do nothing;
 *   ladeFehler: the shell could not read an existing profile (shown, saving overwrites it);
 *   ablageortText: what the storage line shows when it cannot be changed here;
 *   ablageortWahl (70-03): the storage location is chosen in this dialog — current value,
 *   picker callback, plain-text notes (sync folder, existing data); saved into the profile
 * @returns {React.ReactElement}
 */
export default function ProfilDialog({ offen, profil, pflicht = false, ladeFehler = null, ablageortText, ablageortWahl, onGespeichert, onAbbrechen }) {
  const { t } = useI18n();
  const [name, setName] = React.useState(profil?.name ?? '');
  const [buero, setBuero] = React.useState(profil?.buero ?? '');
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [speichert, setSpeichert] = React.useState(false);

  React.useEffect(() => {
    if (!offen) return;
    setName(profil?.name ?? '');
    setBuero(profil?.buero ?? '');
    setFehler(null);
  }, [offen, profil]);

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    const neu = { ...(profil || { ablageort: null }), name, buero };
    if (ablageortWahl) {
      if (!ablageortWahl.wert) {
        setFehler(t('Bitte einen Ablageort wählen.'));
        return;
      }
      neu.ablageort = ablageortWahl.wert;
    }
    const grund = profilPruefen(neu);
    if (grund) {
      setFehler(grund);
      return;
    }
    setSpeichert(true);
    try {
      onGespeichert(await profilSchreiben(/** @type {Profil} */ (neu)));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setSpeichert(false);
    }
  };

  const sperren = (/** @type {Event} */ e) => { if (pflicht) e.preventDefault(); };

  return (
    <Dialog open={offen} onOpenChange={(o) => { if (!o && !pflicht) onAbbrechen?.(); }}>
      <DialogContent
        showCloseButton={!pflicht}
        onEscapeKeyDown={sperren}
        onPointerDownOutside={sperren}
        onInteractOutside={sperren}
        data-testid="profil-dialog"
        className="p-6"
      >
        <form onSubmit={speichern} className="space-y-4">
          <div className="space-y-1">
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {pflicht ? t('Willkommen bei BIT-Atelier') : t('Profil bearbeiten')}
            </DialogTitle>
            <DialogDescription>
              {t('Ein lokales Profil für dieses Gerät – kein Konto, kein Server, keine Zahlung. Sie können es jederzeit ändern.')}
            </DialogDescription>
          </div>

          {ladeFehler && (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {t('Das gespeicherte Profil ließ sich nicht lesen:')} {ladeFehler}
            </p>
          )}

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">{t('Ihr Name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              maxLength={200}
              autoComplete="name"
              data-testid="profil-name"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">{t('Büro')}</span>
            <input
              value={buero}
              onChange={(e) => setBuero(e.target.value)}
              maxLength={200}
              autoComplete="organization"
              data-testid="profil-buero"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-slate-700 dark:text-slate-200">{t('Ablageort')}</p>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="profil-ablageort">
                {ablageortWahl ? (ablageortWahl.wert ?? '…') : (ablageortText ?? profil?.ablageort ?? t('WebView-Speicher (vorläufig)'))}
              </p>
              {ablageortWahl && (
                <button type="button" onClick={ablageortWahl.onWaehlen} data-testid="profil-ablageort-waehlen"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> {t('Ordner wählen')}
                </button>
              )}
            </div>
            {ablageortWahl?.hinweise?.map((h) => (
              <p key={h} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300" data-testid="profil-ablageort-hinweis">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {h}
              </p>
            ))}
            {ablageortWahl && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('Hier legt BIT-Atelier alle Projekte als Dateien ab. Nehmen Sie den Ordner in Ihre Datensicherung auf.')}
              </p>
            )}
          </div>

          {fehler && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="profil-fehler">{fehler}</p>}

          <div className="flex justify-end gap-2 pt-1">
            {!pflicht && (
              <button type="button" onClick={() => onAbbrechen?.()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                {t('Abbrechen')}
              </button>
            )}
            <button type="submit" disabled={speichert} data-testid="profil-speichern"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {pflicht ? t('Profil anlegen') : t('Speichern')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
