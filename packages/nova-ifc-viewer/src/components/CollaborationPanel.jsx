import React, { useEffect, useRef, useState } from "react";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { MessageSquare, Check, Trash2, CircleDot, Send, CornerDownRight, Radio } from "lucide-react";

// Echter lokaler Live-Kanal: synchronisiert Kommentar-Änderungen zwischen Browser-Tabs.
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("bit-bim-collab") : null;
export const collabChannel = {
  publish: (type, payload) => bc?.postMessage({ type, payload }),
  subscribe: (fn) => { if (!bc) return () => {}; const h = (e) => fn(e.data); bc.addEventListener("message", h); return () => bc.removeEventListener("message", h); },
  active: !!bc,
};

// Testlauf 26.08. (Weisung: „remove floating ghosts"): Die simulierten
// Kollaborateure (A. Weber / M. Klein / S. Hoffmann, wandernde Cursor,
// „… tippt")sind entfernt — erfundene Menschen in Echtzeit-Optik verletzen
// die Ehrlichkeitsregel („kein gesendet ohne Versand"). Echt bleibt nur der
// BroadcastChannel zwischen den eigenen Browser-Tabs.
export const COLLABORATORS = [
  { id: "you", name: "Du", color: "#10b981", you: true },
];

const initials = (n) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// Presence avatars + rotating "typing…" hint.
export function PresenceBar() {
  const typer = null; // keine simulierte Aktivität mehr
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {COLLABORATORS.map((c) => (
          <div key={c.id} title={c.name + (c.you ? " (du)" : " · online")}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white"
            style={{ background: c.color }}>
            {initials(c.name)}
          </div>
        ))}
      </div>
      <span className="text-xs text-slate-400">{COLLABORATORS.length === 1 ? "nur du" : `${COLLABORATORS.length} online`}</span>
      {collabChannel.active && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
          <Radio className="w-3 h-3" />Live-Kanal aktiv
        </span>
      )}
    </div>
  );
}

// Live cursors drifting over the 3D viewer (absolute overlay; parent must be relative).
export function PresenceCursors() {
  const others = COLLABORATORS.filter((c) => !c.you);
  const [pos, setPos] = useState(() => others.map(() => ({ x: 30 + Math.random() * 40, y: 30 + Math.random() * 40 })));
  const vel = useRef(others.map(() => ({ dx: (Math.random() - 0.5) * 4, dy: (Math.random() - 0.5) * 4 })));
  useEffect(() => {
    const id = setInterval(() => {
      setPos((prev) => prev.map((p, i) => {
        let { dx, dy } = vel.current[i];
        let x = p.x + dx, y = p.y + dy;
        if (x < 5 || x > 90) { dx = -dx; x = Math.max(5, Math.min(90, x)); }
        if (y < 5 || y > 90) { dy = -dy; y = Math.max(5, Math.min(90, y)); }
        vel.current[i] = { dx, dy };
        return { x, y };
      }));
    }, 700);
    return () => clearInterval(id);
  }, []);
  // Ohne echte Mitnutzer gibt es nichts zu zeigen. Die Prüfung steht NACH allen
  // Hooks — ein früher Return davor bricht die Hooks-Reihenfolge (ESLint-Befund).
  if (!others.length) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {others.map((c, i) => (
        <div key={c.id} className="absolute transition-all duration-700 ease-linear" style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.3))" }}>
            <path d="M1 1 L1 12 L4 9 L6.5 14 L8.5 13 L6 8 L10 8 Z" fill={c.color} stroke="#fff" strokeWidth="0.8" />
          </svg>
          <span className="ml-3 -mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] text-white" style={{ background: c.color }}>{c.name}</span>
        </div>
      ))}
    </div>
  );
}

// Comments list with resolve / delete / select / reply threads / assignment.
export function CommentsList({ comments, selectedId, onSelect, onResolve, onDelete, onReply, onAssign }) {
  const open = comments.filter((c) => !c.resolved);
  const [replyDrafts, setReplyDrafts] = useState({});
  const sendReply = (c) => {
    const text = (replyDrafts[c.id] || "").trim();
    if (!text || !onReply) return;
    onReply(c, text);
    setReplyDrafts((d) => ({ ...d, [c.id]: "" }));
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{open.length} offen · {comments.length} gesamt</span>
      </div>
      {comments.length === 0 && <p className="text-xs text-slate-400">Noch keine Kommentare. „Kommentar setzen" und ins Modell klicken.</p>}
      {comments.map((c) => {
        const assignee = COLLABORATORS.find((u) => u.id === c.assignee);
        const replies = c.replies || [];
        return (
        <div key={c.id} onClick={() => onSelect(c.id)}
          // Keyboard access (WCAG 2.1.1): the card is the only way to select a
          // comment, so it has to be reachable and activatable without a mouse.
          role="button" tabIndex={0} aria-pressed={selectedId === c.id}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(c.id); } }}
          className={`rounded-lg border p-2 cursor-pointer transition-colors ${selectedId === c.id ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:bg-slate-50"} ${c.resolved ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-2">
            <CircleDot className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${c.resolved ? "text-emerald-500" : "text-amber-500"}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-800">{c.text}</div>
              <div className="text-[11px] text-slate-400">{c.author} · {new Date(c.created_date).toLocaleString("de-DE")}</div>
            </div>
            {assignee && (
              <span title={`Zugewiesen an ${assignee.name}`}
                className="shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                style={{ background: assignee.color }}>
                {initials(assignee.name)}
              </span>
            )}
          </div>
          {onAssign && (
            <div className="flex items-center gap-1 mt-1.5 text-[11px] text-slate-500">
              <span>Zuweisen:</span>
              <select value={c.assignee || ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); onAssign(c, e.target.value); }}
                className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px] text-slate-700 focus:outline-none">
                <option value="">Niemand</option>
                {COLLABORATORS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          {replies.length > 0 && (
            <div className="mt-1.5 ml-5 space-y-1 border-l-2 border-slate-100 pl-2">
              <div className="text-[10px] text-slate-400">{replies.length} {replies.length === 1 ? "Antwort" : "Antworten"}</div>
              {replies.map((r, i) => (
                <div key={r.id || i} className="flex items-start gap-1 text-xs text-slate-600">
                  <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0 text-slate-300" />
                  <span className="min-w-0">
                    <span className="font-medium text-slate-700">{r.author}</span>
                    <span className="text-slate-400"> · {new Date(r.created_date).toLocaleString("de-DE")} · </span>
                    {r.text}
                  </span>
                </div>
              ))}
            </div>
          )}
          {onReply && (
            <div className="flex items-center gap-1 mt-1.5 ml-5" onClick={(e) => e.stopPropagation()}>
              <input type="text" value={replyDrafts[c.id] || ""}
                placeholder="Antworten…"
                onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendReply(c); } }}
                className="h-7 flex-1 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:border-amber-400" />
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-slate-500"
                onClick={(e) => { e.stopPropagation(); sendReply(c); }} title="Antwort senden">
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-1 mt-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onResolve(c); }}>
              <Check className="w-3.5 h-3.5 mr-1" />{c.resolved ? "Öffnen" : "Erledigt"}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
