// One collapsible tool row in the chat: name, shortened arguments, result,
// duration. Results are rendered as text only (T-67-18). If the result names
// an .ifc file, an "Im Viewer öffnen" button appears (IfcPane, Task 3).
//
// In: call {id, name, arguments, result?, ms?}. Out: <details> row.

import React from 'react';
import { Button } from '@core/components/ui/button';
import { Wrench, Box } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { findeIfcPfade } from '@/lib/harnessClient';

const kurz = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

/**
 * @param {{call: {id: string, name: string, arguments?: object, result?: string, ms?: number}, onOpenIfc?: (pfad: string) => void}} props
 */
export default function ToolActivity({ call, onOpenIfc }) {
  const { t } = useI18n();
  const args = kurz(JSON.stringify(call.arguments || {}), 120);
  const fehler = call.result && /^\s*\{\s*"error"/.test(call.result);
  const ifcs = call.result ? findeIfcPfade(call.result) : [];
  const tint = fehler ? 'border-rose-200 bg-rose-50/70 dark:bg-rose-950/30' : 'border-amber-200 bg-amber-50/70 dark:bg-amber-950/20';
  return (
    <div className={`rounded-md border text-xs font-mono ${tint} text-slate-800 dark:text-slate-100`} data-testid="tool-activity">
      <details>
        <summary className="cursor-pointer px-3 py-1.5 flex items-center gap-2 select-none">
          <Wrench className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">{call.name}</span>
          <span className="text-slate-500 dark:text-slate-400 truncate">{args}</span>
          <span className="ml-auto text-slate-400">
            {call.result === undefined ? t('läuft…') : call.ms != null ? `${(call.ms / 1000).toFixed(1)} s` : ''}
          </span>
        </summary>
        <pre className="px-3 pb-2 whitespace-pre-wrap break-all max-h-64 overflow-auto">{kurz(call.result, 4000)}</pre>
      </details>
      {/* Visible without expanding: the model file is the thing the user wants next. */}
      {ifcs.length > 0 && onOpenIfc && (
        <div className="flex flex-wrap gap-2 px-3 pb-2">
          {ifcs.map((p) => (
            <Button key={p} size="sm" variant="outline" className="h-7 gap-1 font-sans" onClick={() => onOpenIfc(p)} data-testid="ifc-open">
              <Box className="w-3.5 h-3.5" /> {t('Im Viewer öffnen')}: {p.split(/[\\/]/).pop()}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
