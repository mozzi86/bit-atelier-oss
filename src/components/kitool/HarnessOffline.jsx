// Offline card for the KI Tool page (65-03 convention: say what is missing and
// how to start it — never an error toast). The demo variant went with the
// online demo (83-02).
// 93-12: in the local app the harness is part of the program — the card offers "Jetzt starten" (when
// harness/.venv exists) or a link to Settings › KI to set it up; the manual command stays as fallback.
//
// In: onRetry, detail. Out: a card with the start options; data-testids harness-offline,
//     harness-offline-starten, harness-offline-einrichten, harness-offline-detail.

import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Button } from '@core/components/ui/button';
import { PlugZap, RefreshCw, Play, Loader2 } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { DATENQUELLE } from '@core/lib/umgebung';
import { HARNESS_URL } from '@/lib/harnessClient';
import { kiJson } from '@/lib/kiLokalApi';

/**
 * @param {{onRetry?: () => void, detail?: string}} props
 */
export default function HarnessOffline({ onRetry, detail }) {
  const { t } = useI18n();
  const [dienst, setDienst] = React.useState(/** @type {any} */ (null));
  const [startet, setStartet] = React.useState(false);
  const [startFehler, setStartFehler] = React.useState('');

  React.useEffect(() => {
    if (DATENQUELLE !== 'express') return;
    kiJson('/ki/harness').then(setDienst).catch(() => setDienst(null));
  }, []);

  const starten = async () => {
    setStartet(true); setStartFehler('');
    try {
      const s = await kiJson('/ki/harness/start', { method: 'POST' });
      setDienst(s);
      if (s.zustand === 'laeuft' || s.zustand === 'extern') onRetry?.();
      else if (s.fehler) setStartFehler(s.fehler);
    } catch (e) {
      setStartFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setStartet(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/20" data-testid="harness-offline">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-200 text-base">
          <PlugZap className="w-5 h-5" />
          {t('Kein Dienst erreichbar')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <p>
          {t('Der lokale KI-Dienst antwortet nicht unter')} <code className="px-1 rounded bg-white/70 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100">{HARNESS_URL}</code>.
        </p>
        {dienst?.eingerichtet && (
          <Button size="sm" onClick={starten} disabled={startet} className="gap-2" data-testid="harness-offline-starten">
            {startet ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {t('Jetzt starten')}
          </Button>
        )}
        {dienst && !dienst.eingerichtet && (
          <p data-testid="harness-offline-einrichten">
            {t('Der Harness ist noch nicht eingerichtet:')}{' '}
            <Link to="/Settings?tab=ai" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">{t('Einstellungen › KI › Einrichten')}</Link>
          </p>
        )}
        {startFehler && <p className="text-xs text-rose-700 dark:text-rose-300">{startFehler}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('Starte ihn im Ordner harness/ mit:')}</p>
        <pre className="rounded-md bg-slate-900 text-slate-100 text-xs p-3 overflow-x-auto">python -m harness serve</pre>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('Provider und Modell stehen in harness/config.yaml; Schlüssel nur in harness/.env. Diagnose:')} <code>python -m harness doctor</code>
        </p>
        {detail && <p className="text-xs text-rose-700 dark:text-rose-300" data-testid="harness-offline-detail">{detail}</p>}
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="gap-2">
            <RefreshCw className="w-4 h-4" /> {t('Erneut verbinden')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
