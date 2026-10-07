import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { Filter as FilterIcon, AlertTriangle, Save } from "lucide-react";
import {
  KG_KATALOG, GEWERKE, SCHICHTEN, STATUS_WERTE, STATUS_LABEL,
} from "@core/lib/bimClassification";
import { filterQuantity, istWildcard } from "@ava/lib/avaFilters";
import { QUANTITY_BASES } from "@core/lib/bimElements";
import { num } from "./avaUtils";

// Leerer Filter-Entwurf (alle Achsen Wildcard).
const leererEntwurf = (f) => ({
  id: f?.id,
  name: f?.name || "",
  was: {
    kg: f?.was?.kg || [],
    gewerk: f?.was?.gewerk || [],
    schicht: f?.was?.schicht || [],
  },
  zustand: { status: f?.zustand?.status || [] },
  mengenbasis: f?.mengenbasis || "area",
});

// Multi-Select-Chip.
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
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

// Filter-Editor nach dem NOVA-AVA-Leitprinzip: Menge = WAS ∩ ZUSTAND.
// Leere Achse = Wildcard (matcht alles) — ein völlig leerer Filter matcht ALLE
// Bauteile und zeigt eine sichtbare Doppelzählungs-Warnung (RESEARCH §Pitfall 5).
export default function FilterEditor({ elements = [], initial, onSave, onCancel }) {
  const [entwurf, setEntwurf] = useState(leererEntwurf(initial));
  // Doppel-Submit-Schutz (HI-03): Button während laufendem await deaktivieren.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEntwurf(leererEntwurf(initial));
  }, [initial]);

  const toggleWas = (achse, wert) =>
    setEntwurf((d) => ({
      ...d,
      was: {
        ...d.was,
        [achse]: d.was[achse].includes(wert)
          ? d.was[achse].filter((x) => x !== wert)
          : [...d.was[achse], wert],
      },
    }));

  const toggleStatus = (wert) =>
    setEntwurf((d) => ({
      ...d,
      zustand: {
        status: d.zustand.status.includes(wert)
          ? d.zustand.status.filter((x) => x !== wert)
          : [...d.zustand.status, wert],
      },
    }));

  const vorschau = filterQuantity(elements, entwurf, entwurf.mengenbasis || "area");
  const einheit = QUANTITY_BASES.find((b) => b.value === (entwurf.mengenbasis || "area"))?.unit || "";
  const wildcard = istWildcard(entwurf);

  const save = async () => {
    if (!entwurf.name.trim() || busy) return; // leerer Name / laufender Save blockt Speichern
    setBusy(true);
    try {
      await onSave?.({
        id: entwurf.id,
        name: entwurf.name.trim(),
        was: entwurf.was,
        zustand: entwurf.zustand,
        mengenbasis: entwurf.mengenbasis,
      });
      setEntwurf(leererEntwurf(null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FilterIcon className="w-4 h-4" /> Filter — WAS ∩ ZUSTAND
          {entwurf.id && <Badge className="bg-blue-100 text-blue-800">Bearbeitung</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Filtername</label>
          <Input
            value={entwurf.name}
            onChange={(e) => setEntwurf((d) => ({ ...d, name: e.target.value }))}
            placeholder="z. B. KG340 Innenwände Trockenbau Neubau"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">WAS · Kostengruppe (KG) — leer = alle</label>
          <div className="flex flex-wrap gap-1">
            {Object.entries(KG_KATALOG).map(([code, label]) => (
              <Chip key={code} active={entwurf.was.kg.includes(code)} onClick={() => toggleWas("kg", code)}>
                {code} · {label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">WAS · Gewerk — leer = alle</label>
          <div className="flex flex-wrap gap-1">
            {GEWERKE.map((g) => (
              <Chip key={g} active={entwurf.was.gewerk.includes(g)} onClick={() => toggleWas("gewerk", g)}>
                {g}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">WAS · Schicht / Baustoff — leer = alle</label>
          <div className="flex flex-wrap gap-1">
            {SCHICHTEN.map((s) => (
              <Chip key={s} active={entwurf.was.schicht.includes(s)} onClick={() => toggleWas("schicht", s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">ZUSTAND · Status — leer = alle Zustände</label>
          <div className="flex flex-wrap gap-1">
            {STATUS_WERTE.map((s) => (
              <Chip key={s} active={entwurf.zustand.status.includes(s)} onClick={() => toggleStatus(s)}>
                {STATUS_LABEL[s] || s}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <label className="text-xs text-slate-500 mb-1 block">Mengenbasis</label>
            <Select
              value={entwurf.mengenbasis || "area"}
              onValueChange={(v) => setEntwurf((d) => ({ ...d, mengenbasis: v }))}
            >
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUANTITY_BASES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 mt-5">
            {vorschau.treffer} Bauteile · {num(vorschau.menge)} {einheit}
          </Badge>
        </div>

        {wildcard && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            Filter ohne Kriterien = ALLE Bauteile — Doppelzählungs-Gefahr über mehrere Positionen
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {entwurf.id && onCancel && (
            <Button type="button" variant="outline" onClick={() => { setEntwurf(leererEntwurf(null)); onCancel(); }}>
              Abbrechen
            </Button>
          )}
          <Button
            onClick={save}
            disabled={!entwurf.name.trim() || busy}
            className="bg-gradient-to-r from-emerald-600 to-teal-600"
          >
            <Save className="w-4 h-4 mr-2" /> {busy ? "Speichern…" : entwurf.id ? "Filter aktualisieren" : "Filter speichern"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
