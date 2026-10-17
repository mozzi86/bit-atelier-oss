// 98-07: Grasshopper-like node editor for the Massing Studio. Nodes are cards on a canvas; drag a
// card by its title, drag from an output port (right) to an input port (left) to connect, click a
// wire or the connected input port to remove it. Unconnected inputs and sliders are edited on the card. The graph is evaluated
// by @core/lib/massing/knoten (auswerten) — errors appear on the node, the result bodies show as
// a dashed preview in the plan and in 3D, "Backen" turns them into ordinary bodies.
//
// In:  graph, setGraph(graph), ergebnis (auswerten result), onBacken(), onBeispiel(), t.
// Out: UI; data-testids knoten-editor, knoten (data-id, data-typ), knoten-port (data-richtung,
//      data-port), knoten-kante, knoten-fehler, knoten-neu, knoten-backen.
import React, { useRef, useState } from "react";
import { KNOTEN_TYPEN, passt } from "@core/lib/massing/knoten.js";

const BREITE = 170, KOPF = 26, ZEILE = 24;
const portY = (i) => KOPF + i * ZEILE + ZEILE / 2;

/**
 * @param {{graph: {knoten: any[], kanten: any[]}, setGraph: (g: any) => void, ergebnis: ReturnType<typeof import("@core/lib/massing/knoten.js").auswerten>,
 *   onBacken: () => void, onBeispiel: () => void, t: (s: string) => string}} props
 */
export default function KnotenEditor({ graph, setGraph, ergebnis, onBacken, onBeispiel, t }) {
  const flaeche = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [ziehen, setZiehen] = useState(/** @type {null | {art: 'knoten', id: string, dx: number, dy: number} | {art: 'kante', von: string, aus: string, typ: string, x: number, y: number}} */ (null));
  const [neuTyp, setNeuTyp] = useState("rechteck");
  const lokal = (e) => { const r = /** @type {HTMLDivElement} */ (flaeche.current).getBoundingClientRect(); return { x: e.clientX - r.left + (flaeche.current?.scrollLeft || 0), y: e.clientY - r.top + (flaeche.current?.scrollTop || 0) }; };
  const knotenVon = (id) => graph.knoten.find((k) => k.id === id);
  const aendern = (id, patch) => setGraph({ ...graph, knoten: graph.knoten.map((k) => (k.id === id ? { ...k, ...patch } : k)) });
  const wertSetzen = (id, name, v) => { const k = knotenVon(id); aendern(id, { werte: { ...(k.werte || {}), [name]: v } }); };

  const ausPos = (id, name) => { const k = knotenVon(id); const i = KNOTEN_TYPEN[k.typ].aus.findIndex((p) => p.name === name); return { x: k.x + BREITE, y: k.y + portY(i) }; };
  const einPos = (id, name) => { const k = knotenVon(id); const i = KNOTEN_TYPEN[k.typ].ein.findIndex((p) => p.name === name); return { x: k.x, y: k.y + portY(i) }; };
  const kurve = (a, b) => { const d = Math.max(40, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + d},${a.y} ${b.x - d},${b.y} ${b.x},${b.y}`; };

  const loslassen = (e) => {
    if (ziehen?.art === "kante") {
      const ziel = /** @type {HTMLElement|null} */ (document.elementFromPoint(e.clientX, e.clientY))?.closest?.("[data-richtung=ein]");
      const nach = ziel?.getAttribute("data-knoten"), ein = ziel?.getAttribute("data-port"), typ = ziel?.getAttribute("data-typ");
      if (nach && ein && nach !== ziehen.von && typ && passt(ziehen.typ, typ)) {
        // One wire per input: a new connection replaces the old one.
        setGraph({ ...graph, kanten: [...graph.kanten.filter((k) => !(k.nach === nach && k.ein === ein)), { von: ziehen.von, aus: ziehen.aus, nach, ein }] });
      }
    }
    setZiehen(null);
  };
  const neu = () => {
    const nr = Math.max(0, ...graph.knoten.map((k) => Number(String(k.id).replace(/\D/g, "")) || 0)) + 1;
    setGraph({ ...graph, knoten: [...graph.knoten, { id: `n${nr}`, typ: neuTyp, x: 20 + (graph.knoten.length % 4) * 190, y: 200 + Math.floor(graph.knoten.length / 4) * 40, werte: {} }] });
  };

  return (
    <div className="space-y-2" data-testid="knoten-editor">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={neuTyp} onChange={(e) => setNeuTyp(e.target.value)} className="rounded-md border border-border bg-card px-1.5 py-1" aria-label={t("Knotentyp")}>
          {Object.entries(KNOTEN_TYPEN).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
        </select>
        <button type="button" onClick={neu} className="rounded-md border border-border px-2 py-1 hover:bg-muted" data-testid="knoten-neu">{t("Knoten hinzufügen")}</button>
        <button type="button" onClick={onBeispiel} className="rounded-md border border-border px-2 py-1 hover:bg-muted" data-testid="knoten-beispiel">{t("Beispiel: Raster mit Attraktor")}</button>
        <span className="text-muted-foreground" data-testid="knoten-ergebnis" data-anzahl={ergebnis.koerper.length}>{ergebnis.koerper.length} {t("Körper in der Vorschau")}</span>
        <button type="button" onClick={onBacken} disabled={!ergebnis.koerper.length} className="ml-auto rounded-md border border-primary bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40" data-testid="knoten-backen">{t("Backen (ins Modell übernehmen)")}</button>
      </div>
      <div ref={flaeche} className="relative h-[360px] overflow-auto rounded-lg border border-border bg-muted" style={{ touchAction: "none" }}
        onPointerMove={(e) => {
          if (!ziehen) return;
          const p = lokal(e);
          if (ziehen.art === "knoten") aendern(ziehen.id, { x: Math.max(0, p.x - ziehen.dx), y: Math.max(0, p.y - ziehen.dy) });
          else setZiehen({ ...ziehen, x: p.x, y: p.y });
        }}
        onPointerUp={loslassen} onPointerLeave={() => setZiehen(null)}>
        <svg className="absolute left-0 top-0" width={1400} height={700} style={{ pointerEvents: "none" }}>
          {graph.kanten.filter((k) => knotenVon(k.von) && knotenVon(k.nach)).map((k) => {
            const d = kurve(ausPos(k.von, k.aus), einPos(k.nach, k.ein));
            return (
              <g key={`${k.von}.${k.aus}-${k.nach}.${k.ein}`}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: "stroke", cursor: "pointer" }} data-testid="knoten-kante"
                  onClick={() => setGraph({ ...graph, kanten: graph.kanten.filter((x) => x !== k) })}><title>{t("Klicken zum Entfernen")}</title></path>
                <path d={d} fill="none" stroke="#57534e" strokeWidth={2} />
              </g>
            );
          })}
          {ziehen?.art === "kante" && <path d={kurve(ausPos(ziehen.von, ziehen.aus), ziehen)} fill="none" stroke="#0f766e" strokeWidth={2} strokeDasharray="5 3" />}
        </svg>
        {graph.knoten.map((k) => {
          const typ = KNOTEN_TYPEN[k.typ];
          if (!typ) return null;
          const fehler = ergebnis.fehler.get(k.id);
          const verbunden = new Set(graph.kanten.filter((x) => x.nach === k.id).map((x) => x.ein));
          const zeilen = Math.max(typ.ein.length, typ.aus.length, (typ.felder || []).length);
          return (
            <div key={k.id} className={`absolute rounded-lg border bg-card text-[11px] shadow-sm ${fehler ? "border-fehler-rand" : "border-border"}`}
              style={{ left: k.x, top: k.y, width: BREITE, minHeight: KOPF + zeilen * ZEILE + 6 }} data-testid="knoten" data-id={k.id} data-typ={k.typ}>
              <div className="flex h-[26px] cursor-move items-center justify-between rounded-t-lg border-b border-border bg-muted px-2 font-semibold text-foreground"
                onPointerDown={(e) => { const p = lokal(e); setZiehen({ art: "knoten", id: k.id, dx: p.x - k.x, dy: p.y - k.y }); }}>
                <span>{t(typ.label)}</span>
                <button type="button" className="text-muted-foreground hover:text-fehler" aria-label={t("Knoten löschen")}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setGraph({ knoten: graph.knoten.filter((x) => x.id !== k.id), kanten: graph.kanten.filter((x) => x.von !== k.id && x.nach !== k.id) })}>×</button>
              </div>
              {typ.ein.map((p, i) => (
                <div key={p.name} className="absolute left-0 flex items-center gap-1 pl-3" style={{ top: KOPF + i * ZEILE, height: ZEILE, width: BREITE / 2 + 30 }}>
                  <span className={`absolute -left-[6px] h-3 w-3 rounded-full border-2 border-card bg-hinweis ${verbunden.has(p.name) ? "cursor-pointer" : ""}`} data-testid="knoten-port" data-richtung="ein" data-knoten={k.id} data-port={p.name} data-typ={p.typ}
                    title={`${p.name} (${p.typ})${verbunden.has(p.name) ? ` — ${t("klicken löst die Verbindung")}` : ""}`}
                    onClick={() => verbunden.has(p.name) && setGraph({ ...graph, kanten: graph.kanten.filter((x) => !(x.nach === k.id && x.ein === p.name)) })} />
                  <span className="text-muted-foreground">{p.name}</span>
                  {!verbunden.has(p.name) && (p.typ === "zahl" || p.typ === "liste") && (
                    <input type="number" step="any" value={k.werte?.[p.name] ?? p.standard ?? ""} onChange={(e) => wertSetzen(k.id, p.name, e.target.value === "" ? undefined : Number(e.target.value))}
                      className="w-12 rounded border border-border bg-card px-1 text-right" aria-label={`${t(typ.label)} ${p.name}`} />
                  )}
                </div>
              ))}
              {(typ.felder || []).map((f, i) => (
                <div key={f.name} className="absolute left-0 flex items-center gap-1 px-2" style={{ top: KOPF + i * ZEILE, height: ZEILE, width: BREITE - 24 }}>
                  {f.min != null && <input type="range" min={f.min} max={f.max} step={f.schritt} value={k.werte?.[f.name] ?? f.standard} onChange={(e) => wertSetzen(k.id, f.name, Number(e.target.value))} className="w-20" aria-label={t(typ.label)} />}
                  <input type="number" step="any" value={k.werte?.[f.name] ?? f.standard} onChange={(e) => wertSetzen(k.id, f.name, Number(e.target.value))}
                    className="w-14 rounded border border-border bg-card px-1 text-right" aria-label={`${t(typ.label)} ${f.name}`} />
                </div>
              ))}
              {typ.aus.map((p, i) => (
                <div key={p.name} className="absolute right-0 flex items-center justify-end pr-3" style={{ top: KOPF + i * ZEILE, height: ZEILE }}>
                  <span className="text-muted-foreground">{p.name}</span>
                  <span className="absolute -right-[6px] h-3 w-3 cursor-crosshair rounded-full border-2 border-card bg-erfolg" data-testid="knoten-port" data-richtung="aus" data-knoten={k.id} data-port={p.name} data-typ={p.typ}
                    title={`${p.name} (${p.typ}) — ${t("zum Verbinden ziehen")}`}
                    onPointerDown={(e) => { e.stopPropagation(); const q = lokal(e); setZiehen({ art: "kante", von: k.id, aus: p.name, typ: p.typ, x: q.x, y: q.y }); }} />
                </div>
              ))}
              {fehler && <div className="absolute inset-x-0 -bottom-5 truncate px-1 text-[10px] text-fehler" data-testid="knoten-fehler">{t(fehler)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
