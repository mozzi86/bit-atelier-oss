// Confirmation dialog for a shell command outside the allowlist (developer
// mode). Shows the command and the service's one-sentence explanation; the
// answer goes back as approval_reply over the same WebSocket.
//
// In: approval {id, befehl, erklaerung} or null. Out: onReply(id, ja).

import React from 'react';
import { Button } from '@core/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';

/**
 * @param {{approval: {id: string, befehl: string, erklaerung: string} | null, onReply: (id: string, ja: boolean) => void}} props
 */
export default function ApprovalDialog({ approval, onReply }) {
  const { t } = useI18n();
  if (!approval) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45" role="dialog" aria-modal="true" data-testid="approval-dialog">
      <div className="w-[92%] max-w-xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-semibold">
          <ShieldAlert className="w-5 h-5" /> {t('Bestätigung nötig')}
        </div>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{approval.erklaerung}</p>
        <pre className="mt-2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs p-3 whitespace-pre-wrap break-all" data-testid="approval-befehl">{approval.befehl}</pre>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onReply(approval.id, false)} data-testid="approval-nein">{t('Nein')}</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => onReply(approval.id, true)} data-testid="approval-ja">
            {t('Ja, ausführen')}
          </Button>
        </div>
      </div>
    </div>
  );
}
