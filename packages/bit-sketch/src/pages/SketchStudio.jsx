// Constraint-Zeichner (Labor; formerly "BIT Sketcher") — parametrisches 2D-Zeichnen nach FreeCAD-Sketcher-Vorbild
// auf FreeCADs eigenem Constraint-Solver (planegcs als WASM, LGPL — siehe
// THIRD-PARTY-LICENSES.md). Vorarbeit für Phase 34 „Plan-Werkstatt":
// Geometrie zeichnen → Constraints setzen → Solver hält alles konsistent,
// Ziehen verformt regelkonform (temporäre Constraints statt Koordinaten-Schreiben).

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import {
  MousePointer2, Dot, Slash, Circle as CircleIcon, Trash2, Eraser,
  AlignStartVertical, AlignStartHorizontal, Ruler, Lock, Spline, TriangleRight,
} from "lucide-react";
import { Sketch, CONSTRAINT_GLYPHS } from "../lib/sketchModel.js";
import { runSolve } from "../lib/solveCore.js";
import SketchCanvas from "../components/SketchCanvas.jsx";

const STORAGE_KEY = "bit-sketch-demo-v1";

const CONSTRAINT_LABELS = {
  coincident: "Koinzident",
  horizontal: "Horizontal",
  vertical: "Vertikal",
  parallel: "Parallel",
  perpendicular: "Senkrecht",
  distance: "Abstand",
  pointOnLine: "Punkt auf Linie",
  radius: "Radius",
  angle: "Winkel",
  lock: "Fixiert",
};

/**
 * BIT Sketcher.
 * @param initialJson Persistenz-Adapter (Phase 34, PW-05): undefined = Demo-
 *   Modus mit localStorage (Bestand); null = leerer Sketch; Objekt = per
 *   Sketch.deserialize laden. Bei Projekt-/Quellenwechsel per key remounten!
 * @param onPersist   (json) => void — ersetzt die localStorage-Persistenz
 *   (debounced + Unmount-Flush). Der projektbewusste Host ist
 *   PlanSketchStudio (@designer) mit useSketchLayer → BimModel-Feld.
 */
export default function SketchStudio({ initialJson, onPersist }) {
  const { t } = useI18n();
  const sketchRef = useRef(null);
  if (!sketchRef.current) {
    sketchRef.current = ladeSketch(initialJson);
  }
  const sketch = sketchRef.current;
  const onPersistRef = useRef(null);
  onPersistRef.current = onPersist;

  const [version, setVersion] = useState(0);
  const [epoche, setEpoche] = useState(0); // remountet den Canvas bei Sketch-Austausch (Draft/View-Reset)
  const [tool, setTool] = useState("select");
  const [selection, setSelection] = useState(() => new Set());
  const [lastSolve, setLastSolve] = useState(null);
  const [solverStatus, setSolverStatus] = useState("lädt…");
  const solverRef = useRef(null);

  // Solver lazy laden (eigener Chunk, browser-only — LGPL-Trennung)
  useEffect(() => {
    let aktiv = true;
    import("../lib/solver.js")
      .then((m) => m.getSolver())
      .then((wrapper) => {
        if (!aktiv) return;
        solverRef.current = wrapper;
        setSolverStatus("bereit");
      })
      .catch((e) => aktiv && setSolverStatus(`Fehler: ${e.message}`));
    return () => {
      aktiv = false;
    };
  }, []);

  // Persistenz: über den Adapter (onPersist, z.B. BimModel-Feld je Projekt)
  // oder als Demo-Fallback in localStorage.
  useEffect(() => {
    if (version === 0) return;
    const t = setTimeout(() => {
      if (onPersistRef.current) {
        onPersistRef.current(sketch.serialize());
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sketch.serialize()));
      } catch {
        /* voll/gesperrt — Demo-Persistenz ist optional */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [version, sketch]);

  // Beim Verlassen der Seite den letzten Stand sicher wegschreiben
  // (das Debounce-Cleanup oben verwirft sonst die letzten 300 ms).
  useEffect(
    () => () => {
      if (onPersistRef.current) {
        onPersistRef.current(sketchRef.current.serialize());
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sketchRef.current.serialize()));
      } catch {
        /* optional */
      }
    },
    []
  );

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const resolve = useCallback(
    (extraConstraints = []) => {
      if (!solverRef.current) return null;
      const r = runSolve(solverRef.current, sketch, { extraConstraints });
      setLastSolve(r);
      bump();
      return r;
    },
    [sketch, bump]
  );

  // erster Solve, sobald der Solver bereit ist
  useEffect(() => {
    if (solverStatus === "bereit") resolve();
  }, [solverStatus, resolve]);

  // ---- Mutationen aus dem Canvas ----
  const endpunkt = (spec) => (spec.pointId ? spec.pointId : sketch.addPoint(spec.x, spec.y).id);

  const onAddPoint = (x, y) => {
    sketch.addPoint(x, y);
    resolve() ?? bump();
  };

  /** Liniensegment; gibt die END-Punkt-ID zurück (Linienzug). */
  const onAddSegment = (startSpec, endSpec, autoConstraint) => {
    const p1 = endpunkt(startSpec);
    // Doppelklick zum Beenden fängt auf den letzten Punkt — kein Null-Segment anlegen
    if (endSpec.pointId === p1) return p1;
    // Zwei Klicks auf dieselbe Rasterposition → keine Null-Längen-Linie
    const start = sketch.points.get(p1);
    if (endSpec.pointId == null && start && endSpec.x === start.x && endSpec.y === start.y) return p1;
    const p2 = endpunkt(endSpec);
    // Achsparallel gezeichnet → Koordinate angleichen, damit der Constraint sofort erfüllt ist
    if (autoConstraint === "horizontal") sketch.points.get(p2).y = sketch.points.get(p1).y;
    if (autoConstraint === "vertical") sketch.points.get(p2).x = sketch.points.get(p1).x;
    const { id } = sketch.addLine(p1, p2);
    if (autoConstraint) sketch.addConstraint({ type: autoConstraint, line: id });
    resolve() ?? bump();
    return p2;
  };

  const onAddCircle = (centerSpec, radius) => {
    sketch.addCircle(endpunkt(centerSpec), radius);
    resolve() ?? bump();
  };

  const onDragPoint = (pointId, x, y) => {
    if (!solverRef.current) {
      const p = sketch.points.get(pointId);
      p.x = x;
      p.y = y;
      bump();
      return;
    }
    resolve([{ type: "drag", point: pointId, x, y }]);
  };

  const onDragEnd = () => resolve(); // Diagnose/DOF ohne Drag-Constraints auffrischen

  const onSelect = (id, additiv) => {
    setSelection((alt) => {
      const neu = new Set(additiv ? alt : []);
      if (additiv && neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  };
  const onClearSelection = () => setSelection(new Set());

  // ---- Auswahl klassifizieren → verfügbare Constraints ----
  const sel = useMemo(() => {
    const ids = [...selection];
    return {
      punkte: ids.filter((i) => sketch.points.has(i)),
      linien: ids.filter((i) => sketch.lines.has(i)),
      kreise: ids.filter((i) => sketch.circles.has(i)),
      constraints: ids.filter((i) => sketch.constraints.has(i)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, version]);

  const addConstraint = (c) => {
    try {
      sketch.addConstraint(c);
      onClearSelection();
      resolve() ?? bump();
    } catch (e) {
      toast.error(`Constraint abgelehnt: ${e.message}`);
    }
  };

  // Werteingabe-Panel statt window.prompt (Phase 34-05): {titel, vorgabe,
  // positiv, nurZahl, einheit, onOk(wertOderParam)} — Parse-Regeln unverändert
  // (Zahl mit Komma ODER Parametername; Winkel nur Zahl in Grad, weil
  // Parameter-Werte als Radiant beim Solver landen würden — Grad/Radiant-Falle).
  const [massDialog, setMassDialog] = useState(null);
  const massNonce = useRef(0); // Review-Fix: neuer Dialog = Remount (key), sonst bleibt alter Eingabetext stehen
  const oeffneMassDialog = (d) => setMassDialog({ ...d, nonce: ++massNonce.current });

  const abstand = () => {
    const [a, b] = sel.punkte;
    const pa = sketch.points.get(a);
    const pb = sketch.points.get(b);
    oeffneMassDialog({
      titel: "Abstand", einheit: "m", positiv: true,
      vorgabe: Math.hypot(pb.x - pa.x, pb.y - pa.y).toFixed(2),
      onOk: (wert) => addConstraint({ type: "distance", a, b, value: wert }),
    });
  };
  const radius = () => {
    const c = sketch.circles.get(sel.kreise[0]);
    oeffneMassDialog({
      titel: "Radius", einheit: "m", positiv: true, vorgabe: c.radius.toFixed(2),
      onOk: (wert) => addConstraint({ type: "radius", circle: c.id, value: wert }),
    });
  };
  const winkel = () => {
    const [a, b] = [sel.linien[0], sel.linien[1]];
    oeffneMassDialog({
      titel: "Winkel", einheit: "°", nurZahl: true, vorgabe: "90",
      onOk: (grad) => addConstraint({ type: "angle", a, b, value: (grad * Math.PI) / 180 }),
    });
  };

  const loescheAuswahl = () => {
    for (const id of selection) sketch.deleteGeometry(id);
    onClearSelection();
    resolve() ?? bump();
  };

  useEffect(() => {
    const onKey = (e) => {
      // Nie beim Tippen in Eingabefeldern feuern (Entf löscht sonst Geometrie!)
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Delete" && selection.size) loescheAuswahl();
      if (e.key === "Escape") onClearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const allesLoeschen = () => {
    sketchRef.current = new Sketch();
    onClearSelection();
    setEpoche((e) => e + 1); // Canvas remounten: räumt aktiven Draft + Zoom auf (sonst Render-Crash auf toten Draft-Punkt)
    if (onPersistRef.current) {
      onPersistRef.current(sketchRef.current.serialize()); // leerer Stand ins Projekt
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch { /* egal */ }
    }
    // sketchRef getauscht → resolve über neuen Sketch
    if (solverRef.current) setLastSolve(runSolve(solverRef.current, sketchRef.current));
    bump();
  };

  const istLeer = sketch.points.size === 0 && sketch.circles.size === 0;
  const statusFarbe =
    lastSolve == null || istLeer ? "bg-slate-100 text-slate-600"
    : lastSolve.conflicting.length || !lastSolve.applied ? "bg-rose-100 text-rose-700"
    : lastSolve.dof === 0 ? "bg-emerald-100 text-emerald-700"
    : "bg-amber-100 text-amber-700";

  const werkzeuge = [
    { id: "select", icon: MousePointer2, label: "Auswahl / Ziehen" },
    { id: "point", icon: Dot, label: "Punkt" },
    { id: "line", icon: Slash, label: "Linienzug" },
    { id: "circle", icon: CircleIcon, label: "Kreis" },
  ];

  const constraintButtons = [
    { label: "Koinzident", glyph: CONSTRAINT_GLYPHS.coincident, aktiv: sel.punkte.length === 2, tu: () => addConstraint({ type: "coincident", a: sel.punkte[0], b: sel.punkte[1] }) },
    { label: "Horizontal", icon: AlignStartHorizontal, aktiv: sel.linien.length === 1, tu: () => addConstraint({ type: "horizontal", line: sel.linien[0] }) },
    { label: "Vertikal", icon: AlignStartVertical, aktiv: sel.linien.length === 1, tu: () => addConstraint({ type: "vertical", line: sel.linien[0] }) },
    { label: "Parallel", glyph: CONSTRAINT_GLYPHS.parallel, aktiv: sel.linien.length === 2, tu: () => addConstraint({ type: "parallel", a: sel.linien[0], b: sel.linien[1] }) },
    { label: "Senkrecht", glyph: CONSTRAINT_GLYPHS.perpendicular, aktiv: sel.linien.length === 2, tu: () => addConstraint({ type: "perpendicular", a: sel.linien[0], b: sel.linien[1] }) },
    { label: "Winkel", icon: TriangleRight, aktiv: sel.linien.length === 2, tu: winkel },
    { label: "Abstand", icon: Ruler, aktiv: sel.punkte.length === 2, tu: abstand },
    { label: "Punkt auf Linie", icon: Spline, aktiv: sel.punkte.length === 1 && sel.linien.length === 1, tu: () => addConstraint({ type: "pointOnLine", point: sel.punkte[0], line: sel.linien[0] }) },
    { label: "Radius", glyph: CONSTRAINT_GLYPHS.radius, aktiv: sel.kreise.length === 1, tu: radius },
    { label: "Fixieren", icon: Lock, aktiv: sel.punkte.length === 1, tu: () => addConstraint({ type: "lock", point: sel.punkte[0] }) },
  ];

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          {/* h1 = menu name (N-02 name table: no "BIT" prefix); "Labor" as a
              separate tag, like the Labor group it sits in. */}
          <h1 className="text-2xl font-bold">
            {t("Constraint-Zeichner")}{" "}
            <span className="text-sm font-normal text-slate-400">({t("Labor")})</span>
          </h1>
          <p className="text-sm text-slate-500">
            {t("Parametrisches Zeichnen nach FreeCAD-Vorbild — Constraints werden vom GCS-Solver (WASM) live gehalten. Ziehen verformt regelkonform.")}
          </p>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-xs font-semibold ${statusFarbe}`}>
          {lastSolve == null
            ? `Solver ${solverStatus}`
            : istLeer
              ? "leer — zeichne los"
              : lastSolve.conflicting.length
                ? `Konflikt — Constraints: ${lastSolve.conflicting.join(", ")}`
                : !lastSolve.applied
                  ? "nicht lösbar — letzte gültige Stellung bleibt"
                  : lastSolve.dof === 0
                    ? "voll bestimmt (DOF 0)"
                    : `${lastSolve.dof} Freiheitsgrade offen`}
        </div>
      </div>

      {/* Desktop: 3 Spalten · Phone/Tablet hochkant: gestapelt (Toolbar-Zeile, Canvas ~55vh, Panel darunter) */}
      <div className="grid grid-cols-1 lg:grid-cols-[56px_minmax(0,1fr)_290px] gap-3 lg:gap-4 sketch-buehne lg:h-[calc(100dvh-210px)] lg:min-h-[480px]">
        {/* Werkzeugleiste */}
        <div className="flex flex-row flex-wrap lg:flex-col gap-1.5">
          {werkzeuge.map((w) => (
            <Button
              key={w.id}
              variant={tool === w.id ? "default" : "outline"}
              size="icon"
              title={w.label}
              aria-label={w.label}
              onClick={() => setTool(w.id)}
            >
              <w.icon className="w-4 h-4" />
            </Button>
          ))}
          <div className="w-px lg:w-auto lg:h-px bg-slate-200 mx-1.5 lg:mx-0 lg:my-1.5" />
          <Button variant="outline" size="icon" title="Auswahl löschen (Entf)" aria-label="Auswahl löschen" disabled={!selection.size} onClick={loescheAuswahl}>
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" title="Alles löschen" aria-label="Alles löschen" onClick={allesLoeschen}>
            <Eraser className="w-4 h-4" />
          </Button>
        </div>

        {/* Zeichenfläche (Phone: feste Höhe, Desktop: füllt die Grid-Zeile) */}
        <div className="h-[55vh] min-h-[320px] lg:h-full">
          <SketchCanvas
            key={epoche}
            sketch={sketch}
            version={version}
            tool={tool}
            selection={selection}
            lastSolve={lastSolve}
            onSelect={onSelect}
            onClearSelection={onClearSelection}
            onAddPoint={onAddPoint}
            onAddSegment={onAddSegment}
            onAddCircle={onAddCircle}
            onDragPoint={onDragPoint}
            onDragEnd={onDragEnd}
          />
        </div>

        {/* rechtes Panel (Phone: unter dem Canvas) */}
        <div className="flex flex-col gap-3 lg:overflow-y-auto">
          {massDialog && (
            <MassDialog
              key={massDialog.nonce}
              dialog={massDialog}
              sketch={sketch}
              onSchliessen={() => setMassDialog(null)}
            />
          )}
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Constraint setzen</p>
              <div className="grid grid-cols-2 gap-1.5">
                {constraintButtons.map((b) => (
                  <Button key={b.label} variant="outline" size="sm" disabled={!b.aktiv} onClick={b.tu} className="justify-start gap-1.5 text-xs">
                    {b.icon ? <b.icon className="w-3.5 h-3.5" /> : <span className="w-3.5 text-center">{b.glyph}</span>}
                    {b.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Auswahl: {sel.punkte.length} Punkt(e), {sel.linien.length} Linie(n), {sel.kreise.length} Kreis(e) — Shift = Mehrfachauswahl
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Constraints ({sketch.constraints.size})
                {lastSolve?.redundant.length ? <span className="ml-2 text-amber-600 normal-case">redundant: {lastSolve.redundant.join(", ")}</span> : null}
              </p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {[...sketch.constraints.values()].map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between text-xs rounded px-2 py-1 cursor-pointer ${
                      lastSolve?.conflicting.includes(c.id) ? "bg-rose-50 text-rose-700"
                      : selection.has(c.id) ? "bg-teal-50 text-teal-800"
                      : "hover:bg-slate-50"
                    }`}
                    onClick={(e) => onSelect(c.id, e.shiftKey)}
                  >
                    <span>
                      <span className="inline-block w-4 text-center mr-1">{CONSTRAINT_GLYPHS[c.type]}</span>
                      {CONSTRAINT_LABELS[c.type]}
                      {c.value != null && (
                        <span className="text-slate-400 ml-1">
                          {typeof c.value === "number"
                            ? c.type === "angle" ? `${((c.value * 180) / Math.PI).toFixed(1)}°` : `${c.value.toFixed(2).replace(".", ",")} m`
                            : `⟨${c.value}⟩`}
                        </span>
                      )}
                    </span>
                    <button
                      className="text-slate-300 hover:text-rose-600"
                      title="Constraint löschen"
                      aria-label={`Constraint ${CONSTRAINT_LABELS[c.type]} löschen`}
                      onClick={(e) => {
                        e.stopPropagation();
                        sketch.deleteGeometry(c.id);
                        resolve() ?? bump();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {!sketch.constraints.size && <p className="text-xs text-slate-400">Noch keine Constraints — Geometrie wählen, dann Button links.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Parameter</p>
              <ParameterPanel sketch={sketch} onChanged={() => resolve() ?? bump()} />
            </CardContent>
          </Card>

          <p className="text-[11px] text-slate-400 leading-relaxed px-1">
            Zeichnen: Linienzug per Klick, Doppelklick/Rechtsklick beendet. Fang auf Punkte (Koinzidenz automatisch) und
            0,25-m-Raster; fast waagerechte/senkrechte Segmente bekommen den Constraint automatisch. Grün = voll bestimmt,
            Rot = Konflikt. Solver: FreeCAD planegcs (LGPL) als WebAssembly.
          </p>
        </div>
      </div>
    </div>
  );
}

// Werteingabe für Maß-Constraints (34-05, ersetzt window.prompt): Zahl mit
// Komma oder (außer bei Winkeln) ein benannter Parameter. Enter = übernehmen,
// Escape = abbrechen.
function MassDialog({ dialog, sketch, onSchliessen }) {
  const [text, setText] = useState(String(dialog.vorgabe).replace(".", ","));
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const uebernehmen = () => {
    const getrimmt = text.trim();
    if (!getrimmt) {
      toast.error("Keine Eingabe — Constraint nicht gesetzt.");
      return;
    }
    const zahl = Number(getrimmt.replace(",", "."));
    if (Number.isFinite(zahl)) {
      if (dialog.positiv && zahl <= 0) {
        toast.error("Wert muss größer als 0 sein.");
        return;
      }
      dialog.onOk(zahl);
      onSchliessen();
      return;
    }
    if (!dialog.nurZahl && sketch.params.has(getrimmt)) {
      dialog.onOk(getrimmt); // benannter Parameter
      onSchliessen();
      return;
    }
    toast.error(
      dialog.nurZahl
        ? "Winkel: bitte eine Zahl in Grad (Parameternamen wären eine Grad/Radiant-Falle)."
        : `Kein Wert und kein bekannter Parameter: „${text}"`
    );
  };

  return (
    <Card className="border-teal-300">
      <CardContent className="p-4 space-y-2">
        <p className="text-xs uppercase tracking-wider text-teal-700">
          {dialog.titel} setzen ({dialog.einheit})
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") uebernehmen();
              if (e.key === "Escape") onSchliessen();
            }}
            inputMode="decimal"
            className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm"
            aria-label={`${dialog.titel} in ${dialog.einheit}`}
          />
          <Button size="sm" onClick={uebernehmen}>OK</Button>
          <Button size="sm" variant="outline" onClick={onSchliessen}>Abbrechen</Button>
        </div>
        {!dialog.nurZahl && (
          <p className="text-[11px] text-slate-400">
            Zahl (Komma ok) oder Parametername{sketch.params.size ? ` — vorhanden: ${[...sketch.params.keys()].join(", ")}` : ""}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ParamZeile({ name, wert, onCommit }) {
  // Lokaler Editier-Puffer: Feld leeren darf den Parameter NICHT sofort auf 0
  // setzen (Number("") === 0 → Geometrie kollabiert beim Tippen).
  const [text, setText] = useState(String(wert));
  useEffect(() => setText(String(wert)), [wert]);
  const commit = () => {
    const z = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(z)) onCommit(z);
    else setText(String(wert)); // ungültig → zurück auf letzten gültigen Wert
  };
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex-1 font-mono">{name}</span>
      <input
        type="text"
        inputMode="decimal"
        className="w-20 border border-slate-200 rounded px-1.5 py-0.5 text-right"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <span className="text-slate-400">m</span>
    </div>
  );
}

function ParameterPanel({ sketch, onChanged }) {
  const [name, setName] = useState("");
  const [wert, setWert] = useState("");
  const uebernehmen = () => {
    const n = name.trim();
    const v = Number(wert.replace(",", "."));
    if (!n || !wert.trim() || !Number.isFinite(v)) return;
    sketch.setParam(n, v);
    setName("");
    setWert("");
    onChanged();
  };
  return (
    <div className="space-y-1.5">
      {[...sketch.params.entries()].map(([n, v]) => (
        <ParamZeile
          key={n}
          name={n}
          wert={v}
          onCommit={(z) => {
            sketch.setParam(n, z);
            onChanged();
          }}
        />
      ))}
      <div className="flex items-center gap-1.5 pt-1">
        <input placeholder="name" className="flex-1 min-w-0 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-mono" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Wert" className="w-16 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-right" value={wert} onChange={(e) => setWert(e.target.value)} />
        <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={uebernehmen}>+</Button>
      </div>
      <p className="text-[11px] text-slate-400">Maß-Constraints akzeptieren Parameternamen statt Zahlen — Wert ändern löst neu.</p>
    </div>
  );
}

function ladeSketch(initialJson) {
  // Adapter-Modus (Phase 34): Host liefert den Stand (null = leer starten).
  if (initialJson !== undefined) {
    if (initialJson) {
      try {
        return Sketch.deserialize(initialJson);
      } catch {
        /* korrupter Stand → frisch starten */
      }
    }
    return new Sketch();
  }
  // Demo-Modus: localStorage (Bestand).
  try {
    const roh = localStorage.getItem(STORAGE_KEY);
    if (roh) return Sketch.deserialize(JSON.parse(roh));
  } catch {
    /* korrupter Stand → frisch starten */
  }
  return new Sketch();
}
