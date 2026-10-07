// Status bar of the KI Tool: mode display name, provider/model, project select,
// tokens/cost, connection dot. Cost "—" when the profile has no price, tokens
// marked "(geschätzt)" when the provider sent no usage (67-02 honesty rule).
//
// In: status object from the service, projects list, connection state,
// callbacks. Out: one row of badges; no state of its own.

import React from 'react';
import { Badge } from '@core/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@core/components/ui/select';
import { useI18n } from '@core/lib/i18n';
import { Bot, Cpu, FolderOpen, Coins, Gauge } from 'lucide-react';

const nf = new Intl.NumberFormat('de-DE');
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4 });

/**
 * @param {{status: any, projekte: string[], verbindung: string, onProjekt: (slug: string) => void}} props
 */
export default function HarnessStatus({ status, projekte = [], verbindung, onProjekt }) {
  const { t } = useI18n();
  if (!status) return null;
  const tokens = status.tokens || { input: 0, output: 0, total: 0 };
  const kosten = status.kosten_eur == null ? '—' : eur.format(status.kosten_eur);
  const dot = verbindung === 'open' ? 'bg-emerald-500' : verbindung === 'offline' ? 'bg-rose-500' : 'bg-amber-400 animate-pulse';
  const fenster = status.context_window
    ? `${nf.format(status.context_used || 0)} / ${nf.format(status.context_window)}${status.context_window_assumed ? ' [ASSUMED]' : ''}`
    : '—';

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="harness-status">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} title={verbindung} data-testid="harness-dot" />
      <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5" data-testid="harness-display-name">
        <Bot className="w-4 h-4 text-emerald-600" /> {status.display_name}
      </span>
      <Badge variant="outline" className="gap-1 text-slate-700 dark:text-slate-200">
        <Cpu className="w-3.5 h-3.5" /> {status.provider}/{status.model}
      </Badge>
      <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
        <FolderOpen className="w-4 h-4" />
        <Select value={status.projekt || ''} onValueChange={onProjekt}>
          <SelectTrigger className="h-7 w-[200px] text-xs" data-testid="harness-projekt">
            <SelectValue placeholder={t('Projekt wählen')} />
          </SelectTrigger>
          <SelectContent>
            {projekte.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      <Badge variant="secondary" className="gap-1 text-slate-700 dark:text-slate-200" title={t('Tokens rein / raus')}>
        <Gauge className="w-3.5 h-3.5" /> {nf.format(tokens.input)} / {nf.format(tokens.output)}
        {tokens.estimated ? ` (${t('geschätzt')})` : ''}
      </Badge>
      <Badge variant="secondary" className="gap-1 text-slate-700 dark:text-slate-200" data-testid="harness-kosten">
        <Coins className="w-3.5 h-3.5" /> {kosten}
      </Badge>
      <span className="text-xs text-slate-500 dark:text-slate-400" title={t('Kontext zuletzt belegt / Fenster')}>
        {t('Kontext')} {fenster}
        {status.compressions ? ` · ${status.compressions}× ${t('verdichtet')}` : ''}
      </span>
    </div>
  );
}
