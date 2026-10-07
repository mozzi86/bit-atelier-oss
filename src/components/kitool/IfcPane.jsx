// IFC pane of the KI Tool: shows the model file a tool result pointed at and
// opens it in the EXISTING IFC viewer page (packages/nova-ifc-viewer/pages/
// IfcViewer.jsx) via its `?url=` parameter — no second viewer (HANDOFF-KI-
// HARNESS §4.6). The file itself is served by the harness (`GET /files`,
// sandbox-checked, only model/*.ifc of the active project).
//
// In: pfad (from the tool result), onClose. Out: file facts (HEAD) + link.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Button } from '@core/components/ui/button';
import { Box, ExternalLink, X, Link2, Check } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { createPageUrl } from '@core/utils';
import { fileUrl } from '@/lib/harnessClient';
import { seitenUrl } from '@core/lib/seitenLink';

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * @param {{pfad: string, onClose: () => void}} props
 */
export default function IfcPane({ pfad, onClose }) {
  const { t } = useI18n();
  const [info, setInfo] = useState({ zustand: 'prüfe' });
  const [kopiert, setKopiert] = useState(false);
  const url = fileUrl(pfad);
  const viewerZiel = `${createPageUrl('IfcViewer')}?url=${encodeURIComponent(url)}`;

  useEffect(() => {
    let aktiv = true;
    setInfo({ zustand: 'prüfe' });
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        if (!aktiv) return;
        if (!r.ok) { setInfo({ zustand: 'fehler', text: `${t('Dienst liefert die Datei nicht')} (${r.status})` }); return; }
        setInfo({ zustand: 'ok', bytes: Number(r.headers.get('content-length') || 0) });
      })
      .catch(() => aktiv && setInfo({ zustand: 'fehler', text: t('Kein Dienst erreichbar') }));
    return () => { aktiv = false; };
  }, [url, t]);

  const kopieren = async () => {
    try {
      // Absolute link for the router of this build (72-16, N-18): origin + path
      // alone lacked the "#/" of the HashRouter and the base path of /app/.
      await navigator.clipboard.writeText(seitenUrl('IfcViewer', { url }));
      setKopiert(true);
      setTimeout(() => setKopiert(false), 1500);
    } catch { /* clipboard blocked — the link is visible below */ }
  };

  return (
    <Card className="h-[calc(100vh-290px)] min-h-[480px] flex flex-col" data-testid="ifc-pane">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2 text-slate-800 dark:text-slate-100">
          <Box className="w-5 h-5 text-emerald-600" /> {t('IFC-Modell')}
        </CardTitle>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('Schließen')}><X className="w-4 h-4" /></Button>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 text-sm text-slate-700 dark:text-slate-300">
        <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 break-all font-mono text-xs" data-testid="ifc-pfad">{pfad}</div>
        {info.zustand === 'prüfe' && <p className="text-slate-500">{t('Prüfe Datei …')}</p>}
        {info.zustand === 'fehler' && <p className="text-rose-700 dark:text-rose-300" data-testid="ifc-fehler">{info.text}</p>}
        {info.zustand === 'ok' && (
          <>
            <p>{t('Größe')}: {fmtBytes(info.bytes)}. {t('Der Viewer der App lädt die Datei direkt vom lokalen Dienst; Auswahl und Kamera lassen sich dort als Link teilen.')}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                <Link to={viewerZiel} data-testid="ifc-viewer-link"><ExternalLink className="w-4 h-4" /> {t('Im IFC-Viewer öffnen')}</Link>
              </Button>
              <Button variant="outline" onClick={kopieren} className="gap-2" data-testid="ifc-link-kopieren">
                {kopiert ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {kopiert ? t('Kopiert') : t('Viewer-Link kopieren')}
              </Button>
            </div>
          </>
        )}
        <p className="mt-auto text-xs text-slate-500 dark:text-slate-400">
          {t('Nur Dateien unter model/ des aktiven Projekts werden ausgeliefert (Sandbox des Dienstes).')}
        </p>
      </CardContent>
    </Card>
  );
}
