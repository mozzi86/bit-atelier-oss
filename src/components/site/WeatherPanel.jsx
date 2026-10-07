import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { CloudSun, Wind, RefreshCw, Plane } from "lucide-react";

export default function WeatherPanel({ weather, restrictions, loading, refresh, isSimulated, onSimulate, onClearSim }) {
  const gust = weather?.wind_gusts ?? weather?.wind_speed ?? 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><CloudSun className="w-4 h-4" /> Wetter & Sperren</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} title="Aktualisieren">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-slate-800">{weather ? Math.round(weather.temperature) : "—"}°C</div>
            <div className="text-xs text-slate-500">{weather?.condition || "lädt..."} {isSimulated && <span className="text-amber-600">· simuliert</span>}</div>
          </div>
          <div className="text-right text-sm text-slate-600">
            <div className="flex items-center gap-1 justify-end"><Wind className="w-4 h-4" /> {Math.round(weather?.wind_speed || 0)} km/h</div>
            <div className="text-xs text-slate-400">Böen {Math.round(gust)} km/h</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge className={restrictions.droneGround ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}>
            <Plane className="w-3 h-3 mr-1" /> Drohnen {restrictions.droneGround ? "gesperrt" : "frei"}
          </Badge>
          <Badge className={restrictions.craneStop ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}>
            🏗️ Kran {restrictions.craneStop ? "Stopp" : "frei"}
          </Badge>
          {restrictions.outdoorWarn && <Badge className="bg-amber-100 text-amber-800">Außenarbeiten: Vorsicht</Badge>}
        </div>

        {/* Simulation control for demos */}
        <div className="border-t pt-3">
          <div className="text-xs text-slate-500 mb-1">Wetter simulieren (Demo): Böen {isSimulated ? Math.round(gust) : "—"} km/h</div>
          <input
            type="range" min="0" max="90" step="5"
            value={isSimulated ? gust : 18}
            onChange={(e) => onSimulate(Number(e.target.value))}
            className="w-full"
          />
          {isSimulated && (
            <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={onClearSim}>
              Live-Wetter wiederherstellen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
