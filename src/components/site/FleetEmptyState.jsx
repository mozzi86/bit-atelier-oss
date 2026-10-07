import React from "react";
import { Card, CardContent } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Cpu, Loader2, Sparkles } from "lucide-react";

// Leerer Zustand für den Baustellen-Leitstand: das aktuelle Projekt hat keine
// SiteUnits. Erklärt warum und bietet (außer für Beobachter) das Anlegen einer
// Demo-Flotte an (3 Drohnen + 3 Roboter).
export default function FleetEmptyState({ canSeed, busy, onSeed }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-10 flex flex-col items-center text-center gap-3">
        <div className="p-3 rounded-full bg-slate-100 text-slate-500">
          <Cpu className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800">Keine Einheiten auf dieser Baustelle</h3>
        <p className="text-sm text-slate-500 max-w-md">
          Die Flotte gehört zur jeweiligen Baustelle — für dieses Projekt sind noch keine
          autonomen Einheiten angemeldet. (Tipp: Projekt „Stadtquartier Nordhang" ist im Bau
          und hat eine aktive Flotte.)
        </p>
        {canSeed && (
          <Button
            className="mt-2 bg-gradient-to-r from-emerald-600 to-teal-600"
            disabled={busy}
            onClick={onSeed}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {busy ? "Flotte wird angelegt …" : "Flotte simulieren (Demo)"}
          </Button>
        )}
        {!canSeed && (
          <p className="text-xs text-slate-400">Rolle Beobachter: nur Lesezugriff — keine Demo-Flotte anlegbar.</p>
        )}
      </CardContent>
    </Card>
  );
}
