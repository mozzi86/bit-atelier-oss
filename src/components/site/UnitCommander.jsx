import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { Play, Square, BatteryCharging, Crosshair, Package, Printer, Bot } from "lucide-react";

const TYPE_LABEL = { robot: "Roboter", drone: "Drohne", truck: "Auto-LKW", printer: "3D-Drucker" };
const STATUS_BADGE = {
  working: "bg-emerald-100 text-emerald-800",
  loading: "bg-amber-100 text-amber-800",
  enroute: "bg-blue-100 text-blue-800",
  charging: "bg-purple-100 text-purple-800",
  idle: "bg-slate-100 text-slate-700",
  stopped: "bg-red-100 text-red-800",
  safety_stop: "bg-rose-100 text-rose-800",
};

export default function UnitCommander({ units, selectedId, onSelect, sim, commandMode, setCommandMode, can = { command: true }, role }) {
  const unit = units.find((u) => u.id === selectedId);
  const lockTitle = !can.command
    ? `Rolle ${role || "Beobachter"}: nur Lesezugriff`
    : `Rolle ${role || ""}: keine Berechtigung`.trim();

  const modeBtn = (mode, label, Icon, locked = false) => (
    <Button
      variant={commandMode === mode ? "default" : "outline"}
      size="sm"
      disabled={!can.command || locked}
      title={!can.command || locked ? lockTitle : undefined}
      onClick={() => setCommandMode(commandMode === mode ? null : mode)}
    >
      <Icon className="w-4 h-4 mr-1" /> {label}
    </Button>
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="w-4 h-4" /> Einheiten-Steuerung
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
        {/* unit list */}
        <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
          {units.map((u) => (
            <button
              key={u.id}
              onClick={() => onSelect(u.id)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center justify-between ${
                u.id === selectedId ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-slate-50"
              }`}
            >
              <span className="truncate">{u.name}</span>
              <Badge className={`${STATUS_BADGE[u.status]} text-[10px]`}>{u.status}</Badge>
            </button>
          ))}
        </div>

        {/* selected unit */}
        {unit ? (
          <div className="border-t pt-3 space-y-3">
            <div>
              <div className="font-semibold text-slate-800">{unit.name}</div>
              <div className="text-xs text-slate-500">
                {TYPE_LABEL[unit.type]} · {unit.area} · {unit.task}
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">Akku</span>
                <span className={unit.battery < 20 ? "text-red-600 font-semibold" : ""}>{Math.round(unit.battery)}%</span>
              </div>
              <Progress value={unit.battery} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!can.command} title={!can.command ? lockTitle : undefined} onClick={() => sim.commandWork(unit.id)}><Play className="w-4 h-4 mr-1" /> Arbeiten</Button>
              <Button size="sm" variant="outline" disabled={!can.command} title={!can.command ? lockTitle : undefined} onClick={() => sim.commandCharge(unit.id)}><BatteryCharging className="w-4 h-4 mr-1" /> Laden</Button>
              <Button size="sm" variant="outline" disabled={!can.command} title={!can.command ? lockTitle : undefined} onClick={() => sim.commandStop(unit.id)}><Square className="w-4 h-4 mr-1" /> Stopp</Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {modeBtn("move", "Ziel setzen", Crosshair)}
              {unit.type === "truck" && modeBtn("deliver", "Abladezone", Package, can.zones === false)}
              {unit.type === "printer" && modeBtn("print", "Druckposition", Printer, can.zones === false)}
            </div>

            {!can.command && (
              <p className="text-xs text-amber-600">Rolle {role || "Beobachter"}: nur Lesezugriff - Befehle gesperrt.</p>
            )}

            {commandMode && (
              <p className="text-xs text-blue-600">
                {commandMode === "deliver"
                  ? "Klicke in den Plan, wo der LKW abladen soll."
                  : commandMode === "print"
                  ? "Klicke in den Plan, wo als Nächstes gedruckt werden soll."
                  : "Klicke in den Plan, um den Zielpunkt zu setzen."}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500 border-t pt-3">Einheit wählen, um Befehle zu geben.</p>
        )}
      </CardContent>
    </Card>
  );
}
