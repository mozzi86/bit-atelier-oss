import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { Layers, Lock, Calculator, AlertTriangle, Plus } from "lucide-react";
import { bewerteSchichten, rangfolge } from "@core/lib/rules/priceStack";
import { ARTEN, neueSchicht } from "@ava/lib/preisschichten";
import { eur } from "./avaUtils";

// Alle Preisschichten EINER Position — mit Rang, Herkunft, Historie.
//
// Warum das ein eigenes Panel ist und kein Feld: der Einheitspreis ist die
// Zahl, an die ein Bürochef glauben muss. Er muss sehen KÖNNEN, woher sie kommt.
// Ein einzelnes Eingabefeld verbirgt genau das.
//
// Drei Dinge sind hier bewusst NICHT bequem gelöst:
//  * Die `kostenanschlag`-Schicht ist grau und eingefroren. Sie wird NIE neu
//    gerechnet — der Kostenanschlag ist ein Dokumentenstand vom 17.12.2020,
//    kein Rechenergebnis.
//  * Die Index-Schicht zeigt ihre FORMEL (Basis × Faktor(von→bis)), nicht nur
//    eine Zahl. Eine nackte Zahl wäre von einem belegten Preis nicht zu
//    unterscheiden.
//  * `review`-markierte Schichten bleiben SICHTBAR, sind aber nicht aktiv.
//    Wegwerfen würde bedeuten, dass sie beim nächsten Import unbemerkt
//    zurückkommen.
export default function PreisSchichtPanel({
  position,
  schichten = [],
  reihen = null,
  rangfolgeKatalog = [],
  onAddSchicht = null,
}) {
  const rf = useMemo(() => rangfolge(rangfolgeKatalog), [rangfolgeKatalog]);
  const bewertet = useMemo(
    () => bewerteSchichten(schichten, { reihen, rangfolge: rf }),
    [schichten, reihen, rf],
  );
  const aktiv = bewertet.find((s) => s.waehlbar) || null;

  const [neu, setNeu] = useState(null); // { ep, beleg }
  const [fehler, setFehler] = useState(null);

  const speichern = () => {
    setFehler(null);
    try {
      // Ein Handpreis ist immer eine Marktaussage MIT Beleg — es gibt keinen
      // anderen Weg, von Hand einen Preis zu setzen (unit_price ist Nur-Lese-Cache).
      const s = neueSchicht(null, {
        art: "markt",
        ep: Number(neu.ep),
        position_id: position?.id ?? null,
        herkunft: { typ: "marktrecherche", beleg: neu.beleg, stand: new Date().toISOString().slice(0, 7) },
      });
      onAddSchicht?.(s);
      setNeu(null);
    } catch (e) {
      setFehler(e.message);
    }
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-600" />
          Preisschichten {position?.oz ? <span className="text-slate-400 font-normal">· OZ {position.oz}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rf.leer && (
          <p className="text-xs text-amber-700 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            Katalog <code>PreisRangfolge</code> ist nicht geladen — ohne ihn gibt es keine Rangfolge
            und deshalb auch keine aktive Schicht. (Kein Default im Code: eine geratene Rangfolge
            verschiebt Millionen.)
          </p>
        )}

        {bewertet.length === 0 && (
          <p className="text-xs text-slate-500">
            Keine Preisschicht. Der Einheitspreis bleibt <code>null</code> — nicht 0.
          </p>
        )}

        <div className="space-y-1">
          {bewertet.map((s, i) => {
            const meta = ARTEN[s.art] || {};
            const eingefroren = meta.eingefroren === true;
            const istAktiv = aktiv && s === aktiv;
            return (
              <div
                key={s.id ?? i}
                className={[
                  "rounded-md border px-2 py-1.5 text-xs",
                  eingefroren ? "bg-slate-100 border-slate-200 text-slate-500" : "bg-white border-slate-200",
                  istAktiv ? "ring-2 ring-emerald-500/60" : "",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono">Rang {s.rang ?? "?"}</Badge>
                  <span className="font-medium">{meta.label || s.art}</span>
                  {eingefroren && (
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <Lock className="w-3 h-3" /> eingefroren — wird nie neu gerechnet
                    </span>
                  )}
                  {s.ep_berechnet && (
                    <span className="inline-flex items-center gap-1 text-blue-700">
                      <Calculator className="w-3 h-3" /> berechnet
                    </span>
                  )}
                  {s.review_sperre && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                      review — sichtbar, nicht aktiv
                    </Badge>
                  )}
                  {istAktiv && <Badge className="bg-emerald-600">aktiv</Badge>}
                  <span className="ml-auto font-mono tabular-nums">
                    {s.ep_effektiv == null ? "—" : eur(s.ep_effektiv)}
                  </span>
                </div>
                {/* Die Index-Schicht zeigt die Rechnung, nicht das Ergebnis allein. */}
                {s.index_formel && (
                  <p className="mt-0.5 font-mono text-[11px] text-blue-700">= {s.index_formel}</p>
                )}
                <div className="mt-0.5 text-[11px] text-slate-500 space-y-0.5">
                  {s.stand && <div>Stand: {s.stand}</div>}
                  {s.herkunft?.beleg && <div>Herkunft: {s.herkunft.beleg}</div>}
                  {s.match && (s.match.sim != null || s.match.ratio != null) && (
                    <div>Treffergüte: sim {s.match.sim ?? "—"} · ratio {s.match.ratio ?? "—"}</div>
                  )}
                  {s.ersetzt_id && <div>ersetzt Schicht {s.ersetzt_id} (Historie bleibt)</div>}
                  {s.nicht_aktiv_grund && !istAktiv && <div className="text-amber-700">nicht aktiv: {s.nicht_aktiv_grund}</div>}
                  {s.assumed && (
                    <div className="text-amber-700">
                      [ASSUMED] Indexreihe ist nicht gegen destatis geprüft — Preisstand-Angabe, kein Messwert.
                    </div>
                  )}
                  {s.prognose && <div className="text-amber-700">Prognose-Stützpunkt (+5 % p. a., Annahme)</div>}
                </div>
              </div>
            );
          })}
        </div>

        {onAddSchicht && (
          neu ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2 space-y-2">
              <p className="text-[11px] text-slate-600">
                Ein Handpreis entsteht als <strong>Marktpreis mit Beleg</strong>. Es gibt kein
                editierbares EP-Feld mehr — ein Preis ohne Herkunft ist keine Aussage.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px]">Art</Label>
                  <Select value="markt" disabled>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="markt">Marktpreis</SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">EP [€]</Label>
                  <Input type="number" step="any" value={neu.ep} onChange={(e) => setNeu({ ...neu, ep: e.target.value })} />
                </div>
                <div>
                  <Label className="text-[11px]">Beleg (Pflicht)</Label>
                  <Input value={neu.beleg} onChange={(e) => setNeu({ ...neu, beleg: e.target.value })} placeholder="Angebot / Shop / Recherche vom …" />
                </div>
              </div>
              {fehler && <p className="text-xs text-red-700">{fehler}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => { setNeu(null); setFehler(null); }}>Abbrechen</Button>
                <Button size="sm" onClick={speichern}>Schicht anlegen</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setNeu({ ep: "", beleg: "" })}>
              <Plus className="w-3 h-3 mr-1" /> Marktpreis-Schicht (mit Beleg)
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}
