import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Boxes, MousePointerClick, Link2, Info, Sparkles, RefreshCw, AlertTriangle,
  Filter as FilterIcon,
} from "lucide-react";
import BimModelViewer from "@ifc/components/BimModelViewer";
import { floorElements, quantityFromElements, QUANTITY_BASES } from "@core/lib/bimElements";
import { num, positionMode, positionQuantity } from "./avaUtils";
import { filterQuantity } from "@ava/lib/avaFilters";
import FilterEditor from "./FilterEditor";
import FilterLibrary from "./FilterLibrary";
import ClassificationEditor from "./ClassificationEditor";

// Die drei Mengen-Wege einer LV-Position (mengen_modus).
const MODI = [
  { value: "filter", label: "Filter" },
  { value: "auswahl", label: "Einzelauswahl (3D)" },
  { value: "handeingabe", label: "Handeingabe" },
];

// BIM-Mengen-Tab: filter-basierte Mengenermittlung (NOVA-AVA-Prinzip
// Menge = WAS ∩ ZUSTAND) + bestehende 3D-Einzelauswahl als Fallback +
// Handeingabe. Die Einzelauswahl (bim_element_ids) bleibt unverändert erhalten.
export default function QuantityTakeoff({
  building, positions = [], onUpdate, onGenerateLv, bimModelAvailable,
  filters = [], elements = [], onSaveFilter, onDeleteFilter, onSaveClassification,
  onRecompute,
}) {
  const [positionId, setPositionId] = useState("");
  const [modus, setModus] = useState("filter");
  const [basis, setBasis] = useState("area");
  const [selected, setSelected] = useState([]); // element ids selected in 3D
  const [filterRef, setFilterRef] = useState("");
  const [handMenge, setHandMenge] = useState("");
  const [handGrund, setHandGrund] = useState("");
  const [editingFilter, setEditingFilter] = useState(null);

  const modelElements = useMemo(() => floorElements(building), [building]);
  const activePos = positions.find((p) => p.id === positionId);
  const linkedIds = activePos?.bim_element_ids || [];

  const basisUnit = QUANTITY_BASES.find((b) => b.value === basis)?.unit || "";
  const selQty = quantityFromElements(building, selected, basis);
  const activeFilter = filters.find((f) => f.id === filterRef) || null;
  const filterErgebnis = activeFilter
    ? filterQuantity(elements, activeFilter, basis)
    : { menge: 0, treffer: 0 };
  const activePosLive = activePos ? positionQuantity(activePos, filters, elements) : null;

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Position wählen → Modus + Kopplung aus der Position ableiten
  // (Altpositionen ohne mengen_modus: auswahl/manuell via positionMode).
  const loadFromPosition = (id) => {
    setPositionId(id);
    const p = positions.find((x) => x.id === id);
    if (!p) return;
    const mode = positionMode(p);
    setModus(mode === "manuell" ? "handeingabe" : mode);
    setSelected(p.bim_element_ids || []);
    setFilterRef(p.filter_ref || "");
    setBasis(p.mengenbasis || "area");
    setHandMenge(p.quantity != null ? String(p.quantity) : "");
    setHandGrund(p.handeingabe_grund || "");
  };

  // „In Position übernehmen": schreibt je nach Modus — bim_element_ids werden
  // NIE gelöscht (Rückwärtskompatibilität, Fallback Einzelauswahl).
  const apply = async () => {
    if (!activePos) return;
    if (modus === "filter") {
      await onUpdate(activePos.id, {
        mengen_modus: "filter",
        filter_ref: filterRef || null,
        mengenbasis: basis,
        quantity: filterErgebnis.menge,
        unit: basisUnit || activePos.unit,
        bim_element_ids: activePos.bim_element_ids || [],
        handeingabe_grund: "",
      });
    } else if (modus === "auswahl") {
      await onUpdate(activePos.id, {
        mengen_modus: "auswahl",
        filter_ref: null,
        mengenbasis: basis,
        quantity: selQty,
        unit: basisUnit || activePos.unit,
        bim_element_ids: selected,
        handeingabe_grund: "",
      });
    } else {
      await onUpdate(activePos.id, {
        mengen_modus: "handeingabe",
        filter_ref: null,
        mengenbasis: basis,
        quantity: Number(handMenge) || 0,
        unit: activePos.unit,
        bim_element_ids: activePos.bim_element_ids || [],
        handeingabe_grund: handGrund,
      });
    }
  };

  const applyDisabled =
    !activePos ||
    (modus === "filter" && !filterRef) ||
    (modus === "auswahl" && selected.length === 0);

  // Filter aus der Bibliothek direkt auf die gewählte Position anwenden.
  const applyFilterToPosition = (f) => {
    setModus("filter");
    setFilterRef(f.id);
    if (f.mengenbasis) setBasis(f.mengenbasis);
  };

  const saveFilter = async (data) => {
    await onSaveFilter?.(data);
    setEditingFilter(null);
  };

  return (
    <div className="space-y-4">
      {onGenerateLv && (
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50/70 to-teal-50/40">
          <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
              Mengen direkt aus dem BIT-BIM-Gebäudemodell erzeugen
            </div>
            <div className="flex gap-2">
              {onRecompute && (
                <Button variant="outline" onClick={() => onRecompute()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Mengen aktualisieren
                </Button>
              )}
              <Button
                onClick={onGenerateLv}
                disabled={!bimModelAvailable}
                title={!bimModelAvailable ? "Kein gespeichertes Gebäudemodell — im Komplex-Designer zeichnen" : undefined}
                className="bg-gradient-to-r from-emerald-600 to-teal-600"
              >
                <Sparkles className="w-4 h-4 mr-2" /> LV aus Gebäudemodell generieren
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bereich A + B: Filter-Editor (WAS ∩ ZUSTAND) und Filterbibliothek */}
      <div className="grid lg:grid-cols-2 gap-4">
        <FilterEditor
          elements={elements}
          initial={editingFilter}
          onSave={saveFilter}
          onCancel={() => setEditingFilter(null)}
        />
        <FilterLibrary
          filters={filters}
          elements={elements}
          onEdit={setEditingFilter}
          onDelete={onDeleteFilter}
          onApply={applyFilterToPosition}
        />
      </div>

      {/* Bereich C: Position ↔ Kopplung (+ 3D-Einzelauswahl als Fallback) */}
      <div className="grid lg:grid-cols-3 gap-4">
        {modus === "auswahl" && (
          <Card className="lg:col-span-2 h-[560px]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes className="w-4 h-4" /> 3D-Mengenermittlung
                <span className="text-sm font-normal text-slate-500">— Geschosse anklicken zum Auswählen</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[480px] p-0 rounded-lg overflow-hidden">
              <BimModelViewer
                building={building}
                elementMode
                selectedElementIds={selected}
                highlightElementIds={linkedIds.filter((id) => !selected.includes(id))}
                onToggleElement={toggle}
              />
            </CardContent>
          </Card>
        )}

        <div className={modus === "auswahl" ? "space-y-4" : "space-y-4 lg:col-span-3"}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MousePointerClick className="w-4 h-4" /> Position zuordnen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">LV-Position</label>
                <Select value={positionId} onValueChange={loadFromPosition}>
                  <SelectTrigger><SelectValue placeholder="Position wählen…" /></SelectTrigger>
                  <SelectContent>
                    {positions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.oz} · {p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Mengen-Modus</label>
                <Select value={modus} onValueChange={setModus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODI.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {modus === "filter" && (
                <>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Filter</label>
                    <Select value={filterRef} onValueChange={setFilterRef}>
                      <SelectTrigger>
                        <SelectValue placeholder={filters.length ? "Filter wählen…" : "Keine Filter — oben anlegen"} />
                      </SelectTrigger>
                      <SelectContent>
                        {filters.map((f) => (
                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Mengenbasis</label>
                    <Select value={basis} onValueChange={setBasis}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {QUANTITY_BASES.map((b) => (
                          <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3 space-y-1">
                    <div className="text-xs text-emerald-700 flex items-center gap-1">
                      <FilterIcon className="w-3 h-3" /> Ermittelte Menge ({filterErgebnis.treffer} Bauteile)
                    </div>
                    <div className="text-2xl font-bold text-emerald-800">
                      {num(filterErgebnis.menge)} {basisUnit}
                    </div>
                    {activeFilter && filterErgebnis.treffer === 0 && (
                      <Badge className="bg-amber-100 text-amber-800 gap-1">
                        <AlertTriangle className="w-3 h-3" /> 0 Treffer — Baustoff/Klassifizierung fehlt?
                      </Badge>
                    )}
                  </div>
                </>
              )}

              {modus === "auswahl" && (
                <>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Mengenbasis</label>
                    <Select value={basis} onValueChange={setBasis}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {QUANTITY_BASES.map((b) => (
                          <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <div className="text-xs text-emerald-700">Ermittelte Menge ({selected.length} Bauteile)</div>
                    <div className="text-2xl font-bold text-emerald-800">{num(selQty)} {basisUnit}</div>
                  </div>
                </>
              )}

              {modus === "handeingabe" && (
                <>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Menge</label>
                    <Input
                      type="number"
                      step="any"
                      value={handMenge}
                      onChange={(e) => setHandMenge(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Grund (Pauschale / Regie / Entsorgung / temporär)</label>
                    <Input
                      value={handGrund}
                      onChange={(e) => setHandGrund(e.target.value)}
                      placeholder="z. B. Pauschale Baustelleneinrichtung"
                    />
                  </div>
                  <Badge className="bg-slate-100 text-slate-500">kein Modellfilter</Badge>
                </>
              )}

              <Button
                onClick={apply}
                disabled={applyDisabled}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600"
              >
                <Link2 className="w-4 h-4 mr-2" /> Menge in Position übernehmen
              </Button>
              {activePos && (
                <p className="text-xs text-slate-400">
                  Aktuell in Position: {num(activePos.quantity)} {activePos.unit}
                  {positionMode(activePos) === "filter" && activePosLive && (
                    <> · Filter live: {num(activePosLive.menge)} ({activePosLive.treffer} Bauteile)</>
                  )}
                  {positionMode(activePos) === "auswahl" && (
                    <> · {linkedIds.length} verknüpfte Bauteile</>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          {modus === "auswahl" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Bauteile im Modell</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-48 overflow-y-auto">
                {modelElements.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => toggle(e.id)}
                    className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                      selected.includes(e.id) ? "bg-emerald-100 text-emerald-800" : "hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span>{e.name}</span>
                    <span className="text-xs text-slate-400">{e.area} m² · {e.volume} m³</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-50 border-dashed">
            <CardContent className="p-3 text-xs text-slate-500 flex gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              {modus === "auswahl"
                ? "Grün = ausgewählt · Orange = bereits mit der Position verknüpft. Mengen kommen direkt aus der Modellgeometrie."
                : "Modus Filter koppelt die Position live an klassifizierte Bauteilmengen (WAS ∩ ZUSTAND); Handeingabe für Pauschalen/Regie ohne Modellbezug."}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bauteil-Klassifizierung: KG · Gewerk · Schicht · Status */}
      <ClassificationEditor elements={elements} onSaveClassification={onSaveClassification} />
    </div>
  );
}
