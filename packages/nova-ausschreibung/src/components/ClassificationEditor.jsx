import React from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { Tag, Save } from "lucide-react";
import {
  KG_KATALOG, GEWERKE, SCHICHTEN, STATUS_WERTE_UI, STATUS_LABEL, STATUS_UNBEKANNT,
} from "@core/lib/bimClassification";

// Deutsche Anzeige-Labels für die Elementarten aus classifiedElements().
const KIND_LABEL = {
  "wall-inner": "Innenwand",
  "wall-hull": "Außenwand",
  column: "Stütze",
  window: "Fenster",
  door: "Tür",
  zone: "Zone / Raum",
  slab: "Decke",
  roof: "Dach",
  floorplate: "Bodenplatte",
};

// Attribut-Editor: weist klassifizierten Bauteilen die vier Achsen
// KG · Gewerk · Schicht · Status zu. Der lokale Draft hält nur geänderte
// Elemente; „Speichern" ruft onSaveClassification(patch) — der Elternteil
// (AVA.jsx) mappt den Patch per _idx zurück auf die BimModel-Custom-Arrays
// und persistiert additiv/schemalos per BimModel.update.
export default function ClassificationEditor({ elements = [], onSaveClassification }) {
  const [draft, setDraft] = usePanelState("classification:draft", {}); // element-id → {kg, gewerk, schicht, status}

  const effective = (el, key) => draft[el.id]?.[key] ?? el[key];

  const setVal = (el, key, value) =>
    setDraft((d) => ({
      ...d,
      [el.id]: {
        kg: d[el.id]?.kg ?? el.kg,
        gewerk: d[el.id]?.gewerk ?? el.gewerk,
        schicht: d[el.id]?.schicht ?? el.schicht,
        status: d[el.id]?.status ?? el.status,
        [key]: value,
      },
    }));

  const toggleSchicht = (el, s) => {
    const current = effective(el, "schicht") || [];
    setVal(el, "schicht", current.includes(s) ? current.filter((x) => x !== s) : [...current, s]);
  };

  const changedCount = Object.keys(draft).length;

  const save = async () => {
    if (changedCount === 0) return;
    await onSaveClassification?.(draft);
    setDraft({});
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="w-4 h-4" /> Bauteil-Klassifizierung
            <span className="text-sm font-normal text-slate-500">— KG · Gewerk · Schicht · Status</span>
          </CardTitle>
          <Button size="sm" onClick={save} disabled={changedCount === 0} className="bg-gradient-to-r from-emerald-600 to-teal-600">
            <Save className="w-4 h-4 mr-2" />
            {changedCount > 0 ? `Speichern (${changedCount})` : "Speichern"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.length === 0 && (
          <p className="p-4 text-sm text-slate-400 text-center">
            Keine Bauteile im Modell — im Komplex-Designer zeichnen oder Demo-Modell laden.
          </p>
        )}

        {elements.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b">
                  <th className="py-2 pr-3">Bauteil</th>
                  <th className="py-2 pr-3">Kostengruppe (KG)</th>
                  <th className="py-2 pr-3">Gewerk</th>
                  <th className="py-2 pr-3">Schicht / Baustoff</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {elements.map((el) => (
                  <tr key={el.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-700">{KIND_LABEL[el.kind] || el.kind}</div>
                      <div className="text-xs font-mono text-slate-400">{el.id}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Select value={effective(el, "kg")} onValueChange={(v) => setVal(el, "kg", v)}>
                        <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(KG_KATALOG).map(([code, label]) => (
                            <SelectItem key={code} value={code}>{code} – {label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <Select value={effective(el, "gewerk")} onValueChange={(v) => setVal(el, "gewerk", v)}>
                        <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GEWERKE.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {SCHICHTEN.map((s) => {
                          const active = (effective(el, "schicht") || []).includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleSchicht(el, s)}
                              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                active
                                  ? "bg-emerald-600 border-emerald-600 text-white"
                                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {/* status === null heißt „das Modell belegt es nicht" (355 Bauteile im
                          Realprojekt) — das wird als „unbekannt" ANGEZEIGT, nicht als
                          Neubau gedeutet und nicht zu einem leeren Feld verschluckt. */}
                      <Select
                        value={effective(el, "status") ?? STATUS_UNBEKANNT}
                        onValueChange={(v) => setVal(el, "status", v === STATUS_UNBEKANNT ? null : v)}
                      >
                        <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_WERTE_UI.map((s) => (
                            <SelectItem key={s} value={s}>{STATUS_LABEL[s] || s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Demo-Modell grob — ein echter Archicad-IFC-Export klassifiziert jedes Bauteil einzeln (IFC-Import: Folgephase).
        </p>
      </CardContent>
    </Card>
  );
}
