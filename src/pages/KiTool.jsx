// Page "KI Tool" (Phase 67-06): the Atelier AI Harness inside the app.
//
// Owns the connection to the local service (status, projects, skills, one
// WebSocket) and lays out status bar, chat and the IFC pane. Without a
// service it shows the offline card with the start command instead of an
// error (65-03 convention). The developer mode shows up
// only through the display name; a separate developer tab is Phase 68.

import { seitenWurzel } from '@core/lib/utils';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@core/components/ui/card';
import { Wrench } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import * as harness from '@/lib/harnessClient';
import HarnessStatus from '../components/kitool/HarnessStatus';
import HarnessOffline from '../components/kitool/HarnessOffline';
import HarnessChat from '../components/kitool/HarnessChat';
import IfcPane from '../components/kitool/IfcPane';

export default function KiTool() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [projekte, setProjekte] = useState([]);
  const [skills, setSkills] = useState([]);
  const [verbindung, setVerbindung] = useState('connecting');
  const [fehler, setFehler] = useState('');
  const [events, setEvents] = useState([]);
  const [approval, setApproval] = useState(null);
  const [ifcPfad, setIfcPfad] = useState(null);
  const chatRef = useRef(null);

  const ladeMeta = useCallback(async () => {
    const [s, p, k] = await Promise.all([harness.status(), harness.projects(), harness.skills()]);
    setStatus(s);
    setProjekte(p.projekte || []);
    setSkills(k.skills || []);
    setFehler('');
  }, []);

  // One socket per page visit; events flow into one array the chat consumes.
  useEffect(() => {
    let aktiv = true;
    ladeMeta().catch((e) => { if (aktiv) setFehler(String(e.message || e)); });
    const chat = harness.openChat({
      onState: (s) => { if (aktiv) setVerbindung(s); },
      onEvent: (ev) => {
        if (!aktiv) return;
        if (ev.type === 'hello' || ev.type === 'status') { setStatus(ev); return; }
        if (ev.type === 'approval') { setApproval(ev); return; }
        setEvents((prev) => [...prev, ev]);
        if (ev.type === 'done') chat.requestStatus();
      },
    });
    chatRef.current = chat;
    return () => { aktiv = false; chat.close(); };
  }, [ladeMeta]);

  const onReply = (id, ja) => { chatRef.current?.reply(id, ja); setApproval(null); };

  const onProjekt = async (slug) => {
    try {
      await harness.setProject(slug);
      // The service applies a project to NEW sessions: reconnect for a fresh one.
      chatRef.current?.close();
      setEvents([]);
      chatRef.current = harness.openChat({
        onState: setVerbindung,
        onEvent: (ev) => {
          if (ev.type === 'hello' || ev.type === 'status') { setStatus(ev); return; }
          if (ev.type === 'approval') { setApproval(ev); return; }
          setEvents((prev) => [...prev, ev]);
          if (ev.type === 'done') chatRef.current?.requestStatus();
        },
      });
      await ladeMeta();
    } catch (e) {
      setFehler(String(e.message || e));
    }
  };

  const offline = verbindung === 'offline';

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-4">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl shadow-lg"><Wrench className="w-7 h-7 text-white" /></div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">{t('KI Tool')}</h1>
            <p className="text-slate-600 dark:text-slate-300 mt-1">{t('Provider-unabhängiges Arbeitssystem mit Projekt-Gedächtnis, Werkzeugen und Skills')}</p>
          </div>
        </motion.div>

        {offline ? (
          <HarnessOffline detail={fehler} onRetry={() => { setVerbindung('connecting'); chatRef.current?.retry(); ladeMeta().catch((e) => setFehler(String(e.message || e))); }} />
        ) : (
          <>
            <Card>
              <CardContent className="py-3">
                {status
                  ? <HarnessStatus status={status} projekte={projekte} verbindung={verbindung} onProjekt={onProjekt} />
                  : <p className="text-sm text-slate-500">{t('Verbinde mit dem lokalen Dienst …')}{fehler ? ` — ${fehler}` : ''}</p>}
              </CardContent>
            </Card>
            <div className={`grid gap-4 ${ifcPfad ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
              <Card className="h-[calc(100vh-290px)] min-h-[480px]">
                <CardContent className="h-full py-4">
                  <HarnessChat
                    chat={chatRef.current}
                    events={events}
                    skills={skills}
                    verbunden={verbindung === 'open'}
                    approval={approval}
                    onReply={onReply}
                    onOpenIfc={setIfcPfad}
                    sttInfo={status?.stt}
                  />
                </CardContent>
              </Card>
              {ifcPfad && <IfcPane pfad={ifcPfad} onClose={() => setIfcPfad(null)} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
