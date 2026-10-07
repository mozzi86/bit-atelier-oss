import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Layers, Pencil, Trash2, Link2, AlertTriangle } from "lucide-react";
import { filterTreffer, istWildcard } from "@ava/lib/avaFilters";
import { STATUS_LABEL } from "@core/lib/bimClassification";

// Kompakte Chip-Zusammenfassung eines Filters (WAS + ZUSTAND).
const filterChips = (f) => {
  const out = [];
  (f?.was?.kg || []).forEach((k) => out.push(`KG ${k}`));
  (f?.was?.gewerk || []).forEach((g) => out.push(g));
  (f?.was?.schicht || []).forEach((s) => out.push(s));
  (f?.zustand?.status || []).forEach((s) => out.push(STATUS_LABEL[s] || s));
  return out;
};

// Filterbibliothek: benannte, wiederverwendbare WAS-∩-ZUSTAND-Filter des Projekts
// (Entität AvaFilter) mit Live-Treffer-Badge und amber Lücken-Badge bei 0 Treffern
// (AVA-FILTER-04 — Baustoff/Klassifizierung fehlt im Modell?).
export default function FilterLibrary({ filters = [], elements = [], onEdit, onDelete, onApply }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="w-4 h-4" /> Filterbibliothek
          <span className="text-sm font-normal text-slate-500">— {filters.length} Filter</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {filters.length === 0 && (
          <p className="p-4 text-sm text-slate-400 text-center">
            Noch keine Filter — links im Editor einen WAS-∩-ZUSTAND-Filter anlegen.
          </p>
        )}

        {filters.map((f) => {
          const treffer = filterTreffer(elements, f);
          const chips = filterChips(f);
          return (
            <div key={f.id} className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-slate-700 truncate">{f.name}</div>
                <div className="flex items-center gap-1 shrink-0">
                  {onApply && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Auf Position anwenden" onClick={() => onApply(f)}>
                      <Link2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Bearbeiten" onClick={() => onEdit?.(f)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500" title="Löschen" onClick={() => onDelete?.(f.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {istWildcard(f) ? (
                  <Badge className="bg-amber-100 text-amber-800 gap-1">
                    <AlertTriangle className="w-3 h-3" /> alle Bauteile (Wildcard)
                  </Badge>
                ) : (
                  chips.map((c, i) => (
                    <Badge key={`${c}-${i}`} className="bg-slate-100 text-slate-600">{c}</Badge>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge className="bg-emerald-100 text-emerald-800">{treffer} Bauteile</Badge>
                {treffer === 0 && (
                  <Badge className="bg-amber-100 text-amber-800 gap-1">
                    <AlertTriangle className="w-3 h-3" /> 0 Treffer — Baustoff/Klassifizierung fehlt?
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
