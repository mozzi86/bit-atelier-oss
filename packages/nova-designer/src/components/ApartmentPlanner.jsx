import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import {
  LayoutTemplate, Home, Repeat, Link2, AlertTriangle, Plus, Trash2, Eraser,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  DEFAULT_TYPEN, layoutApartments, wohnflaecheSumme, wohnungenAnzahl,
  istGeneriert, apartmentChecks,
} from "@designer/lib/apartments";
import { useBuildingProgram, programMetrics, polygonAreaM } from "@core/lib/useBuildingProgram";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

// [ASSUMED] Balkon-Richtwerte (KD-13 — anteil_balkon wird jetzt verrechnet):
//   BALKON_M2_DEFAULT   Fläche eines Balkons je Wohnung, je Typ überschreibbar.
//   BALKON_ANRECHNUNG   Anteil der Balkonfläche, der auf die Wohnfläche
//                       angerechnet wird — 25 % ist der Regelfall nach
//                       WoFlV § 4 Nr. 4 (bis 50 % nur bei besonderer Lage/
//                       Ausstattung und Vereinbarung).
// Beides sind Konzeptkennwerte, kein Wohnflächen-Nachweis.
const BALKON_M2_DEFAULT = 8;
const BALKON_ANRECHNUNG = 0.25;

// WE eines Runs — gleiche Semantik wie wohnungenAnzahl() in apartments.js.
const weAusRun = (run) => {
  const count = Math.max(0, Math.round(Number(run?.countPerFloor) || 0));
  const from = Math.round(Number(run?.floorFrom) || 0);
  const to = Math.round(Number(run?.floorTo) || 0);
  return count * (Math.abs(to - from) + 1);
};

// Wohnungsplaner (Phase 21): wiederverwendbare Wohnungstypen definieren und über
// Geschosse wiederholen. Einziger Designer-Tab, der bewusst IN den gemeinsamen
// Store schreibt (zones via set, wie die BitBimStudio-Zonen): generierte
// Wohnungs-Zonen erscheinen sofort im Gebäudemodell, im Massing-Zonen-Overlay
// und in „Wohnungen & Compliance". Konzept-Layout, kein Grundriss-Anspruch.
export default function ApartmentPlanner() {
  // Gemeinsame Quelle der Wahrheit: Footprint/Geschosse lesen, zones schreiben.
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const zones = Array.isArray(store.zones) ? store.zones : [];

  // Typenliste (WHG-01) + Wiederholungs-Parameter je Typ (WHG-02) — lokaler
  // State, vorbelegt mit den 3 Standardtypen; Geschoss-Bereich 0 bis storeys-1.
  const [rows, setRows] = useState(() =>
    DEFAULT_TYPEN.map((t, i) => ({
      ...t,
      id: i + 1,
      anteil_balkon: 50,
      balkon_m2: BALKON_M2_DEFAULT,
      countPerFloor: 2,
      floorFrom: 0,
      floorTo: Math.max(0, (store.storeys || 4) - 1),
    }))
  );
  const [nextId, setNextId] = useState(DEFAULT_TYPEN.length + 1);

  const setRow = (id, patch) =>
    setRows((arr) => arr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((arr) => [...arr, {
      id: nextId, key: `typ${nextId}`, name: `Typ ${nextId}`, zimmer: 2,
      flaeche_m2: 60, anteil_balkon: 50, balkon_m2: BALKON_M2_DEFAULT,
      countPerFloor: 1,
      floorFrom: 0, floorTo: Math.max(0, (store.storeys || 4) - 1),
    }]);
    setNextId((n) => n + 1);
  };
  const delRow = (id) => setRows((arr) => arr.filter((r) => r.id !== id));

  // Runs im Format von layoutApartments (Geschosse auf das Modell begrenzen).
  const maxLevel = Math.max(0, Math.round(store.storeys || 1) - 1);
  const runs = useMemo(() => rows.map((r) => ({
    typ: { name: r.name, flaeche_m2: r.flaeche_m2 },
    countPerFloor: r.countPerFloor,
    floorFrom: Math.min(maxLevel, Math.max(0, Math.round(Number(r.floorFrom) || 0))),
    floorTo: Math.min(maxLevel, Math.max(0, Math.round(Number(r.floorTo) || 0))),
  })), [rows, maxLevel]);

  // Vorschau (aus den Runs) + Store-Kopplung (aus den generierten Zonen).
  const previewWe = wohnungenAnzahl(runs);
  const previewM2 = wohnflaecheSumme(runs);

  // KD-13: anteil_balkon verrechnen — WE mit Balkon, Balkonfläche und der auf
  // die Wohnfläche anrechenbare Anteil, je Typ und als Summe. Bezug sind die
  // Runs (Vorschau), NICHT die Polygonflächen der generierten Zonen: Balkone
  // sind im Konzept-Raster nicht als Zone gezeichnet.
  const balkon = useMemo(() => {
    const jeTyp = rows.map((r, i) => {
      const we = weAusRun(runs[i]);
      const anteil = Math.max(0, Math.min(100, Number(r.anteil_balkon) || 0));
      const roh = Number(r.balkon_m2);
      // 0 m² ist eine gültige Eingabe (kein Balkon) — nur fehlende/ungültige
      // Werte fallen auf den Richtwert zurück.
      const flaecheJe = Number.isFinite(roh) ? Math.max(0, roh) : BALKON_M2_DEFAULT;
      const weMit = Math.round((we * anteil) / 100);
      const flaeche = weMit * flaecheJe;
      return { id: r.id, name: r.name, we, anteil, weMit, flaeche, anrechenbar: flaeche * BALKON_ANRECHNUNG };
    });
    const summe = (feld) => jeTyp.reduce((s, t) => s + t[feld], 0);
    return {
      jeTyp,
      weMit: summe("weMit"),
      flaeche: summe("flaeche"),
      anrechenbar: summe("anrechenbar"),
    };
  }, [rows, runs]);
  const genZones = zones.filter(istGeneriert);
  const genWohnflaeche = genZones.reduce((s, z) => s + polygonAreaM(z?.points), 0);
  const auslastung = pm.ngf > 0 ? (genWohnflaeche / pm.ngf) * 100 : 0;
  const weJeTyp = useMemo(() => rows.map((r) => ({
    id: r.id, name: r.name,
    count: genZones.filter((z) => (z?.name || "").startsWith(`${r.name} `)).length,
  })), [rows, genZones]);
  const checks = useMemo(() => apartmentChecks(runs, pm.ngf), [runs, pm.ngf]);

  // WHG-02: APPEND an bestehende Zonen — manuell gezeichnete bleiben erhalten.
  const apply = () => {
    store.set({ zones: [...zones, ...layoutApartments(store.footprintM, runs)] });
  };
  // Entfernt NUR generierte Zonen (Marker ·W), nie manuell gezeichnete.
  const removeGenerated = () => {
    store.set({ zones: zones.filter((z) => !istGeneriert(z)) });
  };

  return (
    <div className="space-y-4">
      {/* Persistenter Konzept-Hinweis — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Konzept-Wohnungsraster — kein Grundriss-/Wohnflächen-Nachweis (WoFlV).</strong>{" "}
          Deterministisches Rechteck-Layout in der Footprint-Box zur Mengenermittlung;
          kein Wohnungsschlüssel- oder Förder-Nachweis.
        </span>
      </div>

      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · Grundfläche {de(pm.footArea)} m² · NGF {de(pm.ngf)} m²
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* Card A: Wohnungstypen (WHG-01) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Home className="w-4 h-4" /> Wohnungstypen</span>
                <Button size="sm" variant="outline" onClick={addRow}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Typ hinzufügen
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.length === 0 && (
                <div className="text-sm text-slate-500">Keine Wohnungstypen definiert.</div>
              )}
              {rows.map((r) => (
                <div key={r.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={r.name}
                      onChange={(e) => setRow(r.id, { name: e.target.value })}
                      className="h-8 font-medium"
                    />
                    <Button size="icon" variant="ghost" className="shrink-0 text-slate-400 hover:text-rose-600" onClick={() => delRow(r.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <NumberField label="Zimmer" value={r.zimmer} suffix="Zi." min={1} step={1} onChange={(v) => setRow(r.id, { zimmer: v })} />
                    <NumberField label="Wohnfläche" value={r.flaeche_m2} suffix="m²" min={1} step={1} onChange={(v) => setRow(r.id, { flaeche_m2: v })} />
                    <NumberField label="Anteil mit Balkon" value={r.anteil_balkon} suffix="%" min={0} step={5} onChange={(v) => setRow(r.id, { anteil_balkon: v })} />
                    <NumberField label="Balkonfläche je WE" value={r.balkon_m2 ?? BALKON_M2_DEFAULT} suffix="m²" min={0} step={1} onChange={(v) => setRow(r.id, { balkon_m2: v })} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Card B: Wiederholen über Geschosse (WHG-02) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Repeat className="w-4 h-4" /> Über Geschosse wiederholen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.map((r) => {
                const b = balkon.jeTyp.find((t) => t.id === r.id);
                return (
                  <div key={r.id} className="rounded-lg border p-3">
                    <div className="text-sm font-medium text-slate-800 mb-2">{r.name}</div>
                    <div className="grid grid-cols-3 gap-3">
                      <NumberField label="Anzahl je Geschoss" value={r.countPerFloor} suffix="WE" min={0} step={1} onChange={(v) => setRow(r.id, { countPerFloor: v })} />
                      <NumberField label="Geschoss von" value={r.floorFrom} suffix="OG" min={0} step={1} onChange={(v) => setRow(r.id, { floorFrom: v })} />
                      <NumberField label="Geschoss bis" value={r.floorTo} suffix="OG" min={0} step={1} onChange={(v) => setRow(r.id, { floorTo: v })} />
                    </div>
                    {b && b.we > 0 && (
                      <div className="mt-2 text-[11px] text-slate-500">
                        {de(b.we)} WE · davon {de(b.weMit)} mit Balkon ({de(b.anteil)} %) ·
                        Balkonfläche {de(b.flaeche)} m² · anrechenbar {de(b.anrechenbar)} m²
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 space-y-1">
                <div>
                  Vorschau: erzeugt <strong>{de(previewWe)} WE</strong> / <strong>{de(previewM2)} m²</strong> Wohnfläche
                  {maxLevel >= 0 && <span className="text-slate-400"> · Geschosse 0–{maxLevel}</span>}
                </div>
                <div>
                  davon <strong>{de(balkon.weMit)} WE mit Balkon</strong> ·
                  Balkonfläche <strong>{de(balkon.flaeche)} m²</strong> ·
                  anrechenbar <strong>{de(balkon.anrechenbar)} m²</strong>
                  {" "}⇒ Wohnfläche inkl. Balkonanrechnung <strong>{de(previewM2 + balkon.anrechenbar)} m²</strong>
                </div>
                <div className="text-[11px] text-slate-400">
                  Balkonanrechnung {Math.round(BALKON_ANRECHNUNG * 100)} % [ASSUMED] —
                  Regelfall nach WoFlV § 4 Nr. 4 (bis 50 % nur bei besonderer
                  Ausstattung/Vereinbarung). Balkone werden nicht als Zone gezeichnet
                  und sind in der Zonen-Wohnfläche unten nicht enthalten.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={apply} disabled={previewWe === 0}>
                  <LayoutTemplate className="w-4 h-4 mr-1.5" /> Auf Geschosse anwenden
                </Button>
                <Button variant="outline" onClick={removeGenerated} disabled={genZones.length === 0}>
                  <Eraser className="w-4 h-4 mr-1.5" /> Generierte Wohnungen entfernen
                </Button>
              </div>
              <div className="text-[11px] text-slate-400">
                „Anwenden" ergänzt die Zonen des Gebäudemodells (bestehende, manuell
                gezeichnete Räume bleiben erhalten). „Entfernen" löscht nur Zonen mit
                Marker „·W".
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Card C: Kopplung an den Store (WHG-03) */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="WE gesamt (generiert)" value={`${de(genZones.length)} WE`} accent="text-blue-600" />
            <Stat label="Wohnfläche gesamt (generiert)" value={`${de(genWohnflaeche)} m²`} accent="text-blue-600" />
            <Stat label="NGF aus Gebäudemodell" value={`${de(pm.ngf)} m²`} accent="text-slate-800" />
            <Stat label="Auslastung NGF" value={`${de(auslastung)} %`} accent="text-violet-600" />
            <Stat label="Balkonfläche (Vorschau)" value={`${de(balkon.flaeche)} m²`} accent="text-teal-600" />
            <Stat
              label={`Balkon anrechenbar (${Math.round(BALKON_ANRECHNUNG * 100)} %)`}
              value={`${de(balkon.anrechenbar)} m²`}
              accent="text-teal-600"
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="w-4 h-4" /> WE je Typ (im Modell)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {weJeTyp.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span className="text-slate-700">{t.name}</span>
                  <Badge variant="secondary">{de(t.count)} WE</Badge>
                </div>
              ))}
              <div className="text-[11px] text-slate-500 pt-1">
                Fördermix & Barrierefrei-Quoten → Reiter „Wohnungen & Compliance".
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Home className="w-4 h-4" /> Plausibilität (Konzept)</span>
                <Badge className={STATUS_STYLE[checks.warns > 0 ? "warn" : "pass"].color}>{checks.verdict}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {checks.items.map((it) => {
                const s = STATUS_STYLE[it.status];
                return (
                  <div key={it.key} className="flex items-center gap-3 rounded-lg border p-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800">{it.label}</div>
                      <div className="text-[11px] text-slate-500">{it.detail}</div>
                    </div>
                    <Badge className={`${s.color} shrink-0`}>{s.label}</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
