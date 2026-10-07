import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Stat } from "@core/components/Field";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Thermometer, MapPin, WifiOff } from "lucide-react";
import { useProject } from "@core/lib/ProjectContext";
import { useSiteClimate } from "@designer/lib/useSiteClimate";

// Klima-Analyse aus echten Open-Meteo-Klimadaten der Projekt-Koordinaten.
export default function ClimaAnalysis({ complexData }) {
  const { project } = useProject();
  const loc = project?.location || complexData?.location;
  const lat = loc?.lat ?? 49.45;
  const { months, annualPrecip, avgTemp, elevation, offline, loading } = useSiteClimate(loc);

  const zone =
    Math.abs(lat) < 23.5 ? "Tropisch" : Math.abs(lat) < 35 ? "Subtropisch" : Math.abs(lat) < 55 ? "Gemäßigt (Cfb)" : "Kontinental/Boreal";
  const hdd = Math.max(0, Math.round((18 - avgTemp) * 280)); // grobe Gradtagzahl

  if (loading && months.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-sm text-slate-500 flex items-center gap-2 justify-center">
          <Thermometer className="w-4 h-4 animate-pulse" /> Klimadaten werden geladen…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!loc && (
        <Card className="border-dashed">
          <CardContent className="py-4 text-sm text-slate-500 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Kein Projektstandort gewählt — Analyse basiert auf Default-Breite {lat}°.
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-2 text-xs">
        {offline ? (
          <Badge variant="outline" className="text-amber-600 border-amber-300 flex items-center gap-1">
            <WifiOff className="w-3 h-3" /> Offline — synthetische Klimakurve
          </Badge>
        ) : (
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            Open-Meteo Klimadaten {loc?.address ? `· ${loc.address}` : ""}
          </Badge>
        )}
        {elevation != null && <span className="text-slate-400">Geländehöhe {Math.round(elevation)} m ü. NN</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Klimazone" value={<Badge className="bg-blue-100 text-blue-800">{zone}</Badge>} />
        <Stat label="Ø Temperatur" value={`${avgTemp} °C`} accent="text-amber-600" />
        <Stat label="Niederschlag/Jahr" value={`${annualPrecip} mm`} accent="text-blue-600" />
        <Stat label="Heizgradtage" value={hdd.toLocaleString("de-DE")} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Thermometer className="w-4 h-4 text-amber-500" /> Jahresgang Temperatur & Niederschlag
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={months}>
                <defs>
                  <linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="temp" stroke="#f59e0b" fill="url(#t)" name="Temp °C" />
                <Area type="monotone" dataKey="precip" stroke="#3b82f6" fill="url(#p)" name="Niederschlag mm" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
