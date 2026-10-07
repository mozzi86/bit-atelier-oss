import React, { useMemo } from "react";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { AlertTriangle, Asterisk, Info } from "lucide-react";
import { validatePattern, MAX_PATTERN_LENGTH } from "@core/lib/rules/patternMatch";
import { statusKey } from "@core/lib/rules/elementIndex";

// SelektorEditor — EINE Oberfläche für ALLE VIER Achsen des Selektor-Schemas.
//
// Warum in @core und nicht in @ava: derselbe Selektor beschreibt eine Mengenregel
// (AVA), einen AvaFilter und künftig jede andere Bauteilauswahl. Zwei Achsen-UIs
// wären zwei Semantiken — und die zweite wäre irgendwann falsch.
//
// Die Regeln der Achsen, sichtbar gemacht statt kommentiert:
//   * UND über die Achsen, ODER innerhalb einer Achse.
//   * Leere Achse oder ["*"] = KEIN Filter (matcht alles) — das steht als
//     „alle" an der Achse, nicht als leeres Feld. Ein leeres Feld liest sich wie
//     „nichts gewählt", und das ist das Gegenteil.
//   * `typ`/`name`-Muster prüfen gegen `(typ||"") + "|" + (name||"")`. Im Referenzprojekt ist
//     `typ` durchweg null — die Unterscheidung steckt im Namen. Das muss die UI
//     sagen, sonst sucht jemand eine Stunde im falschen Feld.
//   * Regex wird VOR dem Speichern validiert (ReDoS, T-33-20). Glob ist der
//     Standardfall; wer Regex wählt, sieht die Prüfmeldung direkt am Feld.
//
// Alle Optionslisten kommen aus KATALOGEN bzw. dem Bauteilstand — nichts hier ist
// eine Liste im Quelltext.

function Chip({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? "bg-emerald-600 border-emerald-600 text-white"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function Achse({ titel, hinweis, werte = [], gewaehlt = [], onToggle, label }) {
  const leer = !gewaehlt.length || (gewaehlt.length === 1 && gewaehlt[0] === "*");
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-500">{titel}</Label>
        {leer && (
          <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-500">
            <Asterisk className="w-2.5 h-2.5 mr-0.5" /> alle
          </Badge>
        )}
        {!leer && (
          <span className="text-[10px] text-emerald-700">{gewaehlt.length} gewählt (ODER)</span>
        )}
      </div>
      {hinweis && <p className="text-[10px] text-slate-400">{hinweis}</p>}
      <div className="flex flex-wrap gap-1">
        {werte.length === 0 && (
          <span className="text-xs text-slate-400">keine Werte im Katalog / Bauteilstand</span>
        )}
        {werte.map((w) => (
          <Chip key={String(w)} active={gewaehlt.includes(w)} onClick={() => onToggle(w)}>
            {label ? label(w) : String(w)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

// Muster-Eingabe mit Glob/Regex-Umschaltung und Validierung AM FELD.
function MusterFeld({ titel, hinweis, wert, onChange }) {
  const op = wert?.op === "regex" ? "regex" : "glob";
  const value = wert?.value ?? "";
  const pruefung = useMemo(
    () => (op === "regex" && value ? validatePattern(value) : { valid: true }),
    [op, value],
  );
  const setzen = (patch) => {
    const next = { op, value, ...patch };
    onChange(next.value ? next : null);
  };
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-500">{titel}</Label>
      {hinweis && <p className="text-[10px] text-slate-400">{hinweis}</p>}
      <div className="flex gap-2">
        <Select value={op} onValueChange={(v) => setzen({ op: v })}>
          <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="glob">Glob</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="h-8 text-xs"
          placeholder={op === "glob" ? "*TB*15.0*" : "Neu__TB__15\\.0cm(?!.*Koffer)"}
          maxLength={MAX_PATTERN_LENGTH}
          value={value}
          onChange={(e) => setzen({ value: e.target.value })}
        />
      </div>
      {!pruefung.valid && (
        <p className="text-[11px] text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Muster abgewiesen: {pruefung.grund}
        </p>
      )}
      {op === "glob" && (
        <p className="text-[10px] text-slate-400">
          Glob ist VERANKERT (`*` für „irgendwo"), Regex ist unverankert und ohne Beachtung
          der Groß-/Kleinschreibung — wie in der Pipeline.
        </p>
      )}
    </div>
  );
}

/**
 * @param {{selektor: object, onChange: Function, kataloge?: object,
 *          elemente?: Array, mengenbasisKeys?: Array<string>}} props
 */
export default function SelektorEditor({
  selektor,
  onChange,
  kataloge = {},
  elemente = [],
}) {
  const sel = selektor || {};
  const was = sel.was || {};
  const zustand = sel.zustand || {};
  const muster = sel.muster || {};
  const bereich = sel.bereich || {};

  // --- Optionen: Kataloge zuerst, Bauteilstand als Ergänzung ---------------
  const kgOptionen = useMemo(() => {
    const rows = kataloge.Din276Katalog || [];
    const seen = new Map();
    for (const r of rows) if (!seen.has(String(r.code))) seen.set(String(r.code), r);
    return [...seen.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [kataloge.Din276Katalog]);

  const klassen = useMemo(
    () => [...new Set((elemente || []).map((e) => e?.klasse).filter(Boolean))].sort(),
    [elemente],
  );
  const gewerke = useMemo(
    () => [...new Set((elemente || []).map((e) => e?.gewerk).filter(Boolean))].sort(),
    [elemente],
  );
  const schichten = useMemo(
    () => [...new Set((elemente || []).map((e) => e?.schicht).filter(Boolean))].sort(),
    [elemente],
  );
  // Zustände AUS DEM KATALOG StatusKonvention — inklusive „unbekannt" (`?`).
  // Ein Bauteil ohne Status ist kein Datenfehler, es ist ein Zustand; wer ihn in
  // der UI weglässt, kann die 355 Bauteile ohne Status nie adressieren.
  const statusOptionen = useMemo(() => {
    const rows = kataloge.StatusKonvention || [];
    const ausKatalog = rows.map((r) => ({ wert: r.pipeline ?? "?", anzeige: r.anzeige ?? r.pipeline }));
    const imModell = new Set((elemente || []).map((e) => statusKey(e)));
    for (const w of imModell) {
      if (!ausKatalog.some((o) => o.wert === w)) ausKatalog.push({ wert: w, anzeige: `${w} (nur im Modell)` });
    }
    return ausKatalog;
  }, [kataloge.StatusKonvention, elemente]);

  const mengenbasisOptionen = useMemo(
    () => (kataloge.MengenbasisKatalog || []).map((r) => r.key),
    [kataloge.MengenbasisKatalog],
  );

  // --- Änderungen ---------------------------------------------------------
  const setWas = (achse, wert) => {
    const alt = was[achse] || [];
    const neu = alt.includes(wert) ? alt.filter((x) => x !== wert) : [...alt, wert];
    onChange({ ...sel, was: { ...was, [achse]: neu } });
  };
  const setStatus = (wert) => {
    const alt = zustand.status || [];
    const neu = alt.includes(wert) ? alt.filter((x) => x !== wert) : [...alt, wert];
    onChange({ ...sel, zustand: { ...zustand, status: neu } });
  };
  const setMuster = (achse, wert) =>
    onChange({ ...sel, muster: { ...muster, [achse]: wert } });
  const setBereich = (i, patch) => {
    const liste = [...(bereich.qty || [])];
    liste[i] = { ...liste[i], ...patch };
    onChange({ ...sel, bereich: { ...bereich, qty: liste } });
  };
  const addBereich = () =>
    onChange({
      ...sel,
      bereich: { ...bereich, qty: [...(bereich.qty || []), { key: mengenbasisOptionen[0] ?? "", min: null, max: null }] },
    });
  const delBereich = (i) =>
    onChange({ ...sel, bereich: { ...bereich, qty: (bereich.qty || []).filter((_, j) => j !== i) } });

  const zahl = (v) => (v === "" || v == null ? null : Number(v));

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-600 flex items-start gap-1">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          <strong>UND über die Achsen, ODER innerhalb einer Achse.</strong> Eine Achse ohne
          Auswahl schränkt nicht ein (Kennzeichen „alle"). Es gibt genau dieses eine
          Selektor-Schema — für Mengenregeln, Filter und jede andere Bauteilauswahl.
        </span>
      </p>

      {/* --- WAS ------------------------------------------------------------- */}
      <fieldset className="rounded-lg border border-slate-200 p-3 space-y-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">WAS</legend>
        <Achse
          titel="IFC-Klasse"
          hinweis="aus dem aktiven Bauteilstand — eine neue Klasse braucht KEINE Codeänderung"
          werte={klassen}
          gewaehlt={was.ifc_klasse || []}
          onToggle={(w) => setWas("ifc_klasse", w)}
        />
        <Achse
          titel="Kostengruppe (DIN 276, dreistellig)"
          hinweis="aus dem Katalog Din276Katalog — beide Fassungen getrennt geführt"
          werte={kgOptionen.map((r) => String(r.code))}
          gewaehlt={was.kg || []}
          onToggle={(w) => setWas("kg", w)}
          label={(code) => {
            const r = kgOptionen.find((x) => String(x.code) === String(code));
            return r ? `${code} ${r.name}` : String(code);
          }}
        />
        <Achse titel="Gewerk" werte={gewerke} gewaehlt={was.gewerk || []} onToggle={(w) => setWas("gewerk", w)} />
        <Achse titel="Schicht" werte={schichten} gewaehlt={was.schicht || []} onToggle={(w) => setWas("schicht", w)} />
      </fieldset>

      {/* --- ZUSTAND -------------------------------------------------------- */}
      <fieldset className="rounded-lg border border-slate-200 p-3 space-y-2">
        <legend className="px-1 text-xs font-semibold text-slate-700">ZUSTAND</legend>
        <Achse
          titel="Status"
          hinweis="aus dem Katalog StatusKonvention. „unbekannt“ (?) ist ein Zustand, kein Datenfehler — die Schreibweise entscheidet über Treffer oder Null."
          werte={statusOptionen.map((o) => o.wert)}
          gewaehlt={zustand.status || []}
          onToggle={setStatus}
          label={(w) => statusOptionen.find((o) => o.wert === w)?.anzeige ?? String(w)}
        />
      </fieldset>

      {/* --- MUSTER --------------------------------------------------------- */}
      <fieldset className="rounded-lg border border-slate-200 p-3 space-y-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">MUSTER</legend>
        <MusterFeld
          titel="Typ / Name"
          hinweis='geprüft wird gegen „typ|name" — in diesem Projekt ist `typ` durchweg leer, die Unterscheidung steckt im Namen'
          wert={muster.typ}
          onChange={(v) => setMuster("typ", v)}
        />
        <MusterFeld titel="Material" wert={muster.material} onChange={(v) => setMuster("material", v)} />
        <MusterFeld titel="Geschoss" wert={muster.geschoss} onChange={(v) => setMuster("geschoss", v)} />
        <MusterFeld
          titel="Klassifikation"
          wert={muster.klassifikation}
          onChange={(v) => setMuster("klassifikation", v)}
        />
      </fieldset>

      {/* --- BEREICH -------------------------------------------------------- */}
      <fieldset className="rounded-lg border border-slate-200 p-3 space-y-2">
        <legend className="px-1 text-xs font-semibold text-slate-700">BEREICH</legend>
        <p className="text-[10px] text-slate-400">
          Fenster über eine IFC-Größe. Ein Bauteil OHNE diese Größe fällt heraus — das ist
          Absicht: eine fehlende Größe ist kein „liegt im Bereich".
        </p>
        {(bereich.qty || []).map((b, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">Größe (mengenbasis)</Label>
              <Select value={b.key || ""} onValueChange={(v) => setBereich(i, { key: v })}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="wählen" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {mengenbasisOptionen.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">min</Label>
              <Input
                type="number" className="h-8 w-24 text-xs" value={b.min ?? ""}
                onChange={(e) => setBereich(i, { min: zahl(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">max</Label>
              <Input
                type="number" className="h-8 w-24 text-xs" value={b.max ?? ""}
                onChange={(e) => setBereich(i, { max: zahl(e.target.value) })}
              />
            </div>
            <button
              type="button"
              className="h-8 rounded border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50"
              onClick={() => delBereich(i)}
            >
              entfernen
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          onClick={addBereich}
        >
          + Bereich
        </button>
      </fieldset>
    </div>
  );
}
