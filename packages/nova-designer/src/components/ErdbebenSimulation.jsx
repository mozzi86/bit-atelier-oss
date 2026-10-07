import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Activity, AlertTriangle, Play, Pause } from "lucide-react";
import { erdbebenKennwerte } from "@designer/lib/statics";

const de = (n, d = 0) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

// Erdbeben-Simulation: vereinfachte Schwingungs-Visualisierung des Gebäudes unter
// seismischer Anregung (Konzept). Das Gebäude wird als gestapelte Geschoss-Boxen
// gezeichnet; die horizontale Auslenkung wächst linear mit der Höhe (1. Eigenform)
// und schwingt sinusförmig. KEIN Nachweis — nur Anschauung der Größenordnung.
export default function ErdbebenSimulation({ open, onClose, zone = "0", storeys = 4, height = 12, gebaeudelastKN = 0 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const [running, setRunning] = useState(true);

  const k = useMemo(
    () => erdbebenKennwerte({ zone, height, gebaeudelastKN }),
    [zone, height, gebaeudelastKN]
  );

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, Hc = canvas.height;
    const n = Math.max(1, Math.round(storeys));
    const groundY = Hc - 46;
    const storeyPx = Math.min(46, (groundY - 30) / n);
    const bw = 130; // Gebäudebreite px
    const cx = W / 2;
    // Sicht-Amplitude: an Zone gekoppelt, gut sichtbar (numerische Werte stehen daneben)
    const ampPx = k.active ? 16 + k.agR * 46 : 0;
    const omega = 2 * Math.PI * 0.85; // ~0,85 Hz Schwingungsbild

    const draw = (tSec) => {
      ctx.clearRect(0, 0, W, Hc);
      // Hintergrund
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, W, Hc);
      // Boden
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, groundY, W, Hc - groundY);
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();
      // Boden-Rütteln (Marker)
      const gShake = k.active ? Math.sin(tSec * omega) * Math.min(8, ampPx * 0.25) : 0;
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      for (let x = 10; x < W; x += 26) {
        ctx.beginPath(); ctx.moveTo(x + gShake, groundY + 6); ctx.lineTo(x - 8 + gShake, Hc - 6); ctx.stroke();
      }

      // Geschosse von unten nach oben; Auslenkung ∝ Höhe (1. Eigenform)
      let prevTopL = null, prevTopR = null;
      for (let i = 0; i < n; i++) {
        const yTop = groundY - (i + 1) * storeyPx;
        const yBot = groundY - i * storeyPx;
        const frac = (i + 1) / n;
        const off = gShake + (k.active ? ampPx * frac * Math.sin(tSec * omega) : 0);
        const offBot = gShake + (k.active ? ampPx * (i / n) * Math.sin(tSec * omega) : 0);
        const lT = cx - bw / 2 + off, rT = cx + bw / 2 + off;
        const lB = cx - bw / 2 + offBot, rB = cx + bw / 2 + offBot;
        // Geschoss als Parallelogramm (Scherung visualisiert Stockwerksversatz)
        ctx.beginPath();
        ctx.moveTo(lB, yBot); ctx.lineTo(rB, yBot); ctx.lineTo(rT, yTop); ctx.lineTo(lT, yTop); ctx.closePath();
        ctx.fillStyle = i % 2 ? "#3b82f6" : "#60a5fa";
        ctx.fill();
        ctx.strokeStyle = "#1e3a8a"; ctx.lineWidth = 1.5; ctx.stroke();
        // Fenster
        ctx.fillStyle = "rgba(219,234,254,0.55)";
        for (let wx = -1; wx <= 1; wx++) {
          const fx = cx + wx * 34 + (off + offBot) / 2;
          ctx.fillRect(fx - 7, (yTop + yBot) / 2 - 8, 14, 16);
        }
        prevTopL = lT; prevTopR = rT;
      }
      // Dachplatte
      if (prevTopL != null) {
        const yRoof = groundY - n * storeyPx;
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(prevTopL - 4, yRoof - 6, (prevTopR - prevTopL) + 8, 6);
      }

      if (!k.active) {
        ctx.fillStyle = "rgba(15,23,42,0.55)";
        ctx.fillRect(0, 0, W, Hc);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "600 15px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Zone 0 — keine Erdbebenbemessung erforderlich", W / 2, Hc / 2 - 8);
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("Erdbebenzone 1–3 wählen für eine Schwingungs-Simulation.", W / 2, Hc / 2 + 14);
      }
    };

    const loop = (now) => {
      if (!startRef.current) startRef.current = now;
      const tSec = (now - startRef.current) / 1000;
      draw(running ? tSec : (startRef.current ? (performance.now() - startRef.current) / 1000 : 0));
      rafRef.current = requestAnimationFrame(loop);
    };
    // Bei Pause Standbild zeichnen, sonst animieren
    if (running) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      draw(2.3); // ausgelenktes Standbild
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, running, storeys, k]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}
      // Escape closes the dialog (WCAG 2.1.2): the backdrop click alone left
      // keyboard users without a way out.
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Erdbeben-Simulation ${k.zoneLabel}`}
        className="w-full max-w-3xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Activity className="w-4 h-4 text-rose-600" /> Erdbeben-Simulation — {k.zoneLabel}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRunning((r) => !r); startRef.current = 0; }}
              disabled={!k.active}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {running ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Start</>}
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Schließen">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[auto,1fr]">
          <canvas ref={canvasRef} width={360} height={440} className="mx-auto rounded-lg"
            role="img" aria-label="Animierte Darstellung der Gebäudeschwingung unter Erdbebenlast; die Kennwerte stehen rechts als Text" />

          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <span><strong>Vereinfachte Modellvorstellung (Richtwerte) — kein Erdbebennachweis nach EC8.</strong> Antwortspektrum, Baugrund- und Verhaltensbeiwert sind grob angenommen.</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Bodenbeschl. agR" value={`${de(k.agR, 1)} m/s²`} />
              <Kpi label="Eigenperiode T₁ (Richtwert)" value={`${de(k.T1, 2)} s`} />
              <Kpi label="Spektralbeschl. Sd (Richtwert)" value={`${de(k.Sd, 2)} m/s²`} />
              <Kpi label="Erdbebenbeiwert (Richtwert)" value={de(k.seismicCoeff, 3)} />
              <Kpi label="Basisschub Fb (Richtwert)" value={`${de(k.Fb)} kN`} accent="text-rose-600" />
              <Kpi label="Kopfauslenkung (Richtwert)" value={`${de(k.topDisp, 1)} cm`} accent="text-violet-600" />
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Die Simulation zeigt die 1. Eigenform: die horizontale Auslenkung wächst mit der
              Höhe, das Gebäude schwingt um die Ruhelage. Höhere Zone → größere Anregung. Werte
              dienen ausschließlich der Größenordnungs-Einschätzung in der Konzeptphase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent = "text-slate-800" }) {
  return (
    <div className="rounded-lg border bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
    </div>
  );
}
