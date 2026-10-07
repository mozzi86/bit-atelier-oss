import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { Building2, Info, Layers, Search, Wand2 } from "lucide-react";
import { buildIndex } from "@core/lib/rules/ruleEngine";
import { positionsMenge, regelAusMuster } from "@ava/lib/mengenregeln";
import { num } from "./avaUtils";

// MusterBibliothek — die büroweiten `MengenMuster`.
//
// Hier steckt der Verkaufswert des Moduls: das nächste Projekt startet nicht bei
// null. Ein `MengenMuster` trägt KEIN `project_id` — es gehört dem Büro, nicht dem
// Projekt. Anwenden erzeugt eine Regel mit `muster_ref`, damit später
// nachvollziehbar ist, woraus sie entstanden ist.
//
// Was hier ausdrücklich sichtbar gemacht wird: **ob ein Muster einen vollständigen
// Selektor trägt.** Die Bürostandard-Vorlagen sind Kurzform (Klasse + Basis +
// Faktor) und damit grobe Startpunkte; ein aus einer bewährten Regel ABGELEITETES
// Muster trägt den ganzen Selektor und reproduziert die Menge exakt. Beide sind
// nützlich, aber sie sind nicht dasselbe — und ein Muster, das nur „IfcWall +
// NetSideArea" merkt, kann Trennwand 150 und Vorsatzschale 125 nicht
// unterscheiden. Die Badge „Kurzform" sagt das, statt es zu verschweigen.
export default function MusterBibliothek({
  muster = [],
  elemente = [],
  positionen = [],
  zielPositionId = null,
  onAnwenden,
  onLoeschen,
}) {
  const [suche, setSuche] = useState("");
  const index = useMemo(() => buildIndex(elemente || []), [elemente]);

  const zeilen = useMemo(() => {
    const t = suche.trim().toLowerCase();
    return (muster || [])
      .filter((m) => !t || `${m.name} ${m.ifc_klasse} ${m.mengenbasis}`.toLowerCase().includes(t))
      .map((m) => {
        const regel = regelAusMuster(m);
        const res = positionsMenge([regel], index);
        return {
          m,
          regel,
          treffer: res.regeln[0]?.treffer ?? 0,
          menge: res.menge,
          warnungen: res.warnungen,
          vollstaendig: !!m.selektor,
        };
      })
      .sort((a, b) => (a.m.nr ?? 999) - (b.m.nr ?? 999));
  }, [muster, suche, index]);

  const ziel = positionen.find((p) => p.id === zielPositionId) || null;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>Musterbibliothek — {muster.length} MengenMuster</span>
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
            <Input
              className="h-8 w-56 pl-7 text-xs"
              placeholder="Name, Klasse, Mengenbasis"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            <strong>MengenMuster sind büroweit</strong> (kein <code>project_id</code>) und
            projektübergreifend anwendbar. „Anwenden" erzeugt eine Regel an der gewählten
            Position und hält über <code>muster_ref</code> fest, woraus sie entstanden ist.
            Die Vorschau rechnet gegen den aktuell geladenen Bauteilstand.
          </span>
        </p>

        {ziel ? (
          <p className="text-xs text-emerald-800">
            Ziel: <strong>{ziel.oz}</strong> {ziel.title}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Keine Zielposition gewählt — in der Tabelle eine Position anklicken, um ein Muster
            anzuwenden.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="px-2 py-1">Nr.</th>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Klasse</th>
                <th className="px-2 py-1">Mengenbasis</th>
                <th className="px-2 py-1 text-right">Faktor</th>
                <th className="px-2 py-1">Einheit</th>
                <th className="px-2 py-1">Form</th>
                <th className="px-2 py-1 text-right">Treffer</th>
                <th className="px-2 py-1 text-right">Menge</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {zeilen.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-2 py-3 text-slate-400">
                    Keine Muster — aus einer bewährten Regel im Regel-Editor „als Muster
                    speichern".
                  </td>
                </tr>
              )}
              {zeilen.map((z, i) => (
                <tr key={z.m.id ?? z.m.nr ?? i} className="border-b border-slate-100">
                  <td className="px-2 py-1">{z.m.nr ?? "—"}</td>
                  <td className="px-2 py-1 max-w-xs truncate" title={z.m.name}>{z.m.name}</td>
                  <td className="px-2 py-1">{z.m.ifc_klasse ?? "—"}</td>
                  <td className="px-2 py-1">{z.m.mengenbasis ?? "—"}</td>
                  <td className="px-2 py-1 text-right" title={z.m.faktor_grund || ""}>{z.m.faktor ?? 1}</td>
                  <td className="px-2 py-1">{z.m.einheit ?? "—"}</td>
                  <td className="px-2 py-1">
                    {z.vollstaendig ? (
                      <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <Layers className="w-2.5 h-2.5 mr-0.5" /> voller Selektor
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-300 text-amber-700"
                        title="Nur Klasse + Mengenbasis + Faktor. Ein grober Startpunkt — mehrere fachlich verschiedene Positionen wären damit nicht unterscheidbar."
                      >
                        Kurzform
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {z.treffer === 0 ? (
                      <span className="rounded bg-red-100 px-1 text-red-700">0</span>
                    ) : (
                      z.treffer
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">{num(z.menge)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      disabled={!ziel}
                      onClick={() => onAnwenden?.(z.m, ziel)}
                    >
                      <Wand2 className="w-3 h-3 mr-1" /> anwenden
                    </Button>
                    {onLoeschen && z.m.id && (
                      <button
                        type="button"
                        className="ml-2 text-slate-400 hover:text-red-600"
                        onClick={() => onLoeschen(z.m)}
                      >
                        löschen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-slate-400 flex items-start gap-1">
          <Building2 className="w-3 h-3 mt-0.5 shrink-0" />
          {zeilen.filter((z) => z.vollstaendig).length} von {zeilen.length} Mustern tragen den
          vollständigen Selektor und reproduzieren die Menge exakt; die übrigen sind
          Bürostandard-Startpunkte, die im Regel-Editor verfeinert werden.
        </p>
      </CardContent>
    </Card>
  );
}
