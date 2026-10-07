// Chat of the KI Tool: message bubbles with streaming, code fences as <pre>,
// tool rows, notices, plain-text errors, slash menu, approval dialog,
// push-to-talk placeholder (67-05 wires /stt). History is kept per browser
// session in sessionStorage so a page switch does not lose the transcript.
//
// In: a chat handle from harnessClient.openChat() plus the event stream via
// props (the page owns the socket so the status bar sees the same events).
// Out: onOpenIfc(pfad) when the user clicks "Im Viewer öffnen".

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@core/components/ui/button';
import { Textarea } from '@core/components/ui/textarea';
import { Send, Mic, Bot, User, Info, Loader2 } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { splitFences, stt } from '@/lib/harnessClient';
import ToolActivity from './ToolActivity';
import SlashMenu, { filterSkills } from './SlashMenu';
import ApprovalDialog from './ApprovalDialog';

const STORAGE_KEY = 'kitool.verlauf.v1';

/**
 * Reduces one service event into the message list. Exported for the unit test.
 * @param {any[]} msgs
 * @param {any} ev
 * @returns {any[]}
 */
export function reduceEvent(msgs, ev) {
  const last = msgs[msgs.length - 1];
  switch (ev.type) {
    case 'text_delta': {
      if (last && last.rolle === 'ai' && last.offen) {
        return [...msgs.slice(0, -1), { ...last, text: last.text + ev.text }];
      }
      return [...msgs, { id: `ai-${Date.now()}-${msgs.length}`, rolle: 'ai', text: ev.text, offen: true }];
    }
    case 'tool_call':
      return [...msgs.map((m) => (m.offen ? { ...m, offen: false } : m)),
        { id: ev.id, rolle: 'tool', name: ev.name, arguments: ev.arguments, start: Date.now() }];
    case 'tool_result':
      return msgs.map((m) => (m.rolle === 'tool' && m.id === ev.id
        ? { ...m, result: ev.result, ms: m.start ? Date.now() - m.start : undefined }
        : m));
    case 'compression':
      return [...msgs, { id: `c-${Date.now()}`, rolle: 'notice',
        text: `Verlauf verdichtet: ${ev.vorher} → ${ev.nachher} Nachrichten (≈${ev.tokens_vorher} → ${ev.tokens_nachher} Tokens)` }];
    case 'notice':
      return [...msgs, { id: `n-${Date.now()}`, rolle: 'notice', text: ev.message }];
    case 'error':
      return [...msgs.map((m) => (m.offen ? { ...m, offen: false } : m)), { id: `e-${Date.now()}`, rolle: 'error', text: ev.message }];
    case 'done':
      return msgs.map((m) => (m.offen ? { ...m, offen: false } : m));
    default:
      return msgs;
  }
}

function ladeVerlauf() {
  try { return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

/**
 * @param {{chat: any, events: any[], skills: {name: string, description: string}[], verbunden: boolean, approval: any, onReply: (id: string, ja: boolean) => void, onOpenIfc?: (pfad: string) => void, sttInfo?: any}} props
 */
export default function HarnessChat({ chat, events, skills = [], verbunden, approval, onReply, onOpenIfc, sttInfo }) {
  const { t } = useI18n();
  const [msgs, setMsgs] = useState(ladeVerlauf);
  const [text, setText] = useState('');
  const [selIdx, setSelIdx] = useState(0);
  const seen = useRef(0);
  const endRef = useRef(null);

  // The page appends events to one array; we consume only the new tail.
  useEffect(() => {
    if (events.length <= seen.current) { if (events.length < seen.current) seen.current = 0; return; }
    const neu = events.slice(seen.current);
    seen.current = events.length;
    setMsgs((prev) => neu.reduce(reduceEvent, prev));
  }, [events]);

  useEffect(() => {
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-200))); } catch { /* quota — history is a convenience */ }
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);

  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.slice(1) : null;
  const menu = useMemo(() => (slashQuery === null ? [] : filterSkills(skills, slashQuery)), [skills, slashQuery]);

  const senden = () => {
    const v = text.trim();
    if (!v || !verbunden) return;
    if (!chat.sendText(v)) return;
    setMsgs((prev) => [...prev, { id: `me-${Date.now()}`, rolle: 'me', text: v }]);
    setText('');
  };

  const pick = (name) => { setText(`/${name} `); setSelIdx(0); };

  // --- Push-to-Talk --------------------------------------------------------------
  const [aufnahme, setAufnahme] = useState(false);
  const [transkribiert, setTranskribiert] = useState(false);
  const [sttFehler, setSttFehler] = useState('');
  const recRef = useRef(null);
  const sttTitle = !sttInfo?.verfuegbar
    ? (sttInfo?.hinweis || t('Diktat nicht verfügbar'))
    : sttInfo.bereit
      ? `${t('Halten zum Sprechen')} — ${sttInfo.modell} · ${sttInfo.geraet}${sttInfo.warnung ? ` · ${sttInfo.warnung}` : ''}`
      : `${t('Modell lädt noch')} (${sttInfo.modell})`;

  const pttStart = async () => {
    if (aufnahme || !sttInfo?.verfuegbar) return;
    setSttFehler('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = window.MediaRecorder?.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new window.MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setTranskribiert(true);
        try {
          const r = await stt(new Blob(chunks, { type: rec.mimeType }));
          // Preview: append to the composer, the user decides with Enter.
          setText((v) => (v && !/\s$/.test(v) ? `${v} ` : v) + (r.text || ''));
        } catch (e) {
          setSttFehler(`${t('Diktat fehlgeschlagen')}: ${e.message}`);
        } finally {
          setTranskribiert(false);
        }
      };
      rec.start();
      recRef.current = rec;
      setAufnahme(true);
    } catch (e) {
      setSttFehler(`${t('Mikrofon nicht verfügbar')}: ${e.message}`);
    }
  };
  const pttStop = () => {
    if (recRef.current && aufnahme) { recRef.current.stop(); recRef.current = null; setAufnahme(false); }
  };

  const onKey = (e) => {
    if (menu.length) {
      if (e.key === 'ArrowDown') { setSelIdx((i) => (i + 1) % menu.length); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { setSelIdx((i) => (i - 1 + menu.length) % menu.length); e.preventDefault(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { pick(menu[Math.min(selIdx, menu.length - 1)].name); e.preventDefault(); return; }
      if (e.key === 'Escape') { setText(text + ' '); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); senden(); }
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="harness-chat">
      <div className="flex-1 min-h-0 overflow-auto space-y-2 pr-1">
        {msgs.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 py-6 justify-center">
            <Info className="w-4 h-4" /> {t('Frag etwas zum Projekt oder tippe / für Skills.')}
          </p>
        )}
        {msgs.map((m) => {
          if (m.rolle === 'tool') return <ToolActivity key={m.id} call={m} onOpenIfc={onOpenIfc} />;
          if (m.rolle === 'notice') return <div key={m.id} className="text-xs text-center text-slate-500 dark:text-slate-400" data-testid="chat-notice">{m.text}</div>;
          if (m.rolle === 'error') return <div key={m.id} className="text-sm text-rose-700 dark:text-rose-300 border border-rose-200 rounded-md px-3 py-2 bg-rose-50/70 dark:bg-rose-950/30" data-testid="chat-error">{m.text}</div>;
          const me = m.rolle === 'me';
          return (
            <div key={m.id} className={`flex gap-2 ${me ? 'justify-end' : 'justify-start'}`} data-testid={me ? 'chat-me' : 'chat-ai'}>
              {!me && <Bot className="w-5 h-5 mt-2 text-emerald-600 shrink-0" />}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm border ${me
                ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-slate-900 dark:text-slate-100'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100'}`}>
                {splitFences(m.text).map((part, i) => part.type === 'code'
                  ? <pre key={i} className="my-1 rounded-md bg-slate-900 text-slate-100 text-xs p-2 overflow-x-auto">{part.text}</pre>
                  : <span key={i} className="whitespace-pre-wrap break-words">{part.text}</span>)}
                {m.offen && <span className="inline-block w-1.5 h-4 ml-0.5 bg-emerald-500 animate-pulse align-text-bottom" />}
              </div>
              {me && <User className="w-5 h-5 mt-2 text-slate-500 shrink-0" />}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="relative mt-3 flex gap-2 items-end">
        <SlashMenu items={menu} selIdx={selIdx} onPick={pick} />
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setSelIdx(0); }}
          onKeyDown={onKey}
          placeholder={verbunden ? t('Nachricht … ( / für Skills, Enter sendet, Shift+Enter Zeilenumbruch )') : t('Nicht verbunden')}
          disabled={!verbunden}
          rows={2}
          className="min-h-[44px] max-h-40 resize-none text-sm"
          data-testid="chat-input"
        />
        {/* Push-to-Talk (67-05): hold → MediaRecorder → POST /stt → text INTO the field. Never auto-send (T-67-16). */}
        <Button
          variant={aufnahme ? 'destructive' : 'outline'}
          size="icon"
          disabled={!sttInfo?.verfuegbar}
          title={sttTitle}
          onMouseDown={pttStart} onMouseUp={pttStop} onMouseLeave={pttStop}
          onTouchStart={(e) => { e.preventDefault(); pttStart(); }} onTouchEnd={pttStop}
          onKeyDown={(e) => { if (e.code === 'Space') { e.preventDefault(); pttStart(); } }}
          onKeyUp={(e) => { if (e.code === 'Space') pttStop(); }}
          data-testid="ptt"
          data-aufnahme={aufnahme ? '1' : '0'}
        >
          {transkribiert ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Button onClick={senden} disabled={!verbunden || !text.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="chat-send">
          <Send className="w-4 h-4" /> {t('Senden')}
        </Button>
      </div>
      {sttFehler && <p className="mt-1 text-xs text-rose-700 dark:text-rose-300" data-testid="stt-fehler">{sttFehler}</p>}
      <ApprovalDialog approval={approval} onReply={onReply} />
    </div>
  );
}
