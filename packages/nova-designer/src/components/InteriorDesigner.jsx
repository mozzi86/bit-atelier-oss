import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import {
  Sofa, Plus, Trash2, AlertTriangle, RotateCw, LayoutGrid,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
} from "lucide-react";
import { useBuildingProgram, polygonAreaM } from "@core/lib/useBuildingProgram";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import {
  moebelById, moebelChecks, kollisionsWarnungen, verschiebeItem,
  zoneKey, moebelFuerZone, mitMoebelFuerZone, migriereMoeblierung, verwaisteKeys,
  setzeEigeneTypen, katalogMitEigenen,
} from "@designer/lib/moebel";
import { oeffnungenAmRaum } from "@designer/lib/raumOeffnungen";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import MoebelDraufsicht, { MoebelLegende } from "./MoebelDraufsicht";
import MoeblierungsPlan from "./MoeblierungsPlan";
import MoebelKatalogPflege from "./MoebelKatalogPflege";
import KatalogPanel from "./KatalogPanel";

const STYLES = ["Modern", "Skandinavisch", "Industrial", "Minimalistisch", "Klassisch", "Biophilic"];

const geschossLabel = (z) => ((z.level ?? 0) === 0 ? "EG" : `${z.level}. OG`);

// Schrittweite Pfeiltasten/Buttons: 10 cm. Seit Phase 43 ist Drag der Hauptweg
// (MoebelDraufsicht + useSvgDrag, 5-cm-Raster über verschiebeItem); die Schritte bleiben
// für Tastatur und Feinjustage.
const SCHRITT = 0.1;

// Gruppierte Möbel-Liste je Raum („8× WC-Becken") — Klick wählt das erste Exemplar.
// Gruppen mit überlappenden Exemplaren werden rot markiert (KD-14); der Klick
// springt dann bevorzugt auf das nächste betroffene Exemplar.
function MoebelListe({ items, selectedId, onSelect, kollisionIds = [] }) {
  const gruppen = useMemo(() => {
    const m = new Map();
    items.forEach((it) => {
      const g = m.get(it.typ) || { typ: it.typ, ids: [] };
      g.ids.push(it.id);
      m.set(it.typ, g);
    });
    return [...m.values()];
  }, [items]);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">Möbel im Raum ({items.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {gruppen.map((g) => {
          const aktiv = g.ids.includes(selectedId);
          const kollisionen = g.ids.filter((id) => kollisionIds.includes(id));
          const stil = aktiv
            ? "border-sky-400 bg-sky-50 text-sky-800"
            : kollisionen.length > 0
              ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
          return (
            <button
              key={g.typ}
              type="button"
              title={kollisionen.length > 0 ? `${kollisionen.length}× überlappt` : undefined}
              onClick={() => onSelect(aktiv ? g.ids[(g.ids.indexOf(selectedId) + 1) % g.ids.length] : (kollisionen[0] ?? g.ids[0]))}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${stil}`}
            >
              {g.ids.length}× {moebelById(g.typ)?.name || g.typ}
              {kollisionen.length > 0 && <span className="ml-1">⚠</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Möblierungs-Karte je Modell-Raum ------------------------------------------------------
// plan = usePlanModel-Ergebnis (Hüllwände, Öffnungen, Innenwände) für die Tür-/Fenster-
// Darstellung (Phase 43, MOEBEL-03); optional — ohne plan nur Umriss + Möbel wie zuvor.
function RaumKarte({ zone, items, onItemsChange, plan, katalog }) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(null);
  const selected = items.find((it) => it.id === selectedId) || null;
  // Türen/Fenster an den Raumgrenzen (Hülle: Regel- und platzierte Öffnungen; Innenwände:
  // customWindows) — reine Geometrie aus raumOeffnungen.js.
  const oeffnungen = useMemo(
    () => oeffnungenAmRaum(zone, {
      walls: plan?.model?.walls, envOpenings: plan?.envOpenings, entranceCfg: plan?.entranceCfg,
      customWalls: plan?.customWalls, customWindows: plan?.customWindows,
    }),
    [zone, plan],
  );
  // Überlappungen (KD-14) getrennt berechnen: die Ids markieren die Möbel in der
  // Draufsicht und in der Liste, die Texte laufen in dieselbe amber Warnliste.
  const kollisionen = useMemo(() => kollisionsWarnungen(items), [items]);
  const kollisionIds = useMemo(
    () => [...new Set(kollisionen.flatMap((w) => w.itemIds))],
    [kollisionen],
  );
  const warnungen = useMemo(
    () => [...moebelChecks(items, zone.points), ...kollisionen],
    [items, zone.points, kollisionen],
  );

  // Katalog-Klick: Möbel in die Raummitte (Bounding-Box-Zentrum) setzen.
  const addTyp = (typId) => {
    const xs = zone.points.map((p) => p.x);
    const zs = zone.points.map((p) => p.z);
    const item = {
      id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      typ: typId,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...zs) + Math.max(...zs)) / 2,
      rot: 0,
    };
    onItemsChange([...items, item]);
    setSelectedId(item.id);
  };

  const updSelected = (patch) =>
    onItemsChange(items.map((it) => (it.id === selectedId ? { ...it, ...patch } : it)));
  const move = (dx, dy) =>
    selected && updSelected({ x: Math.round((selected.x + dx) * 100) / 100, y: Math.round((selected.y + dy) * 100) / 100 });
  const rotateId = (id) =>
    onItemsChange(items.map((it) => (it.id === id ? { ...it, rot: ((it.rot || 0) + 90) % 360 } : it)));
  const rotate = () => selected && rotateId(selected.id);
  // Drag (Phase 43): die Draufsicht liefert die ungerasterte neue Mitte, hier wird auf das
  // 5-cm-Raster gesetzt. useSvgDrag ruft rAF-gedrosselt — jeder Aufruf schreibt den Stand.
  const moveTo = (id, x, y) =>
    onItemsChange(items.map((it) => (it.id === id ? verschiebeItem(it, x, y) : it)));
  const remove = () => {
    onItemsChange(items.filter((it) => it.id !== selectedId));
    setSelectedId(null);
  };

  // Pfeiltasten auf dem fokussierten Karten-Container (10-cm-Schritte).
  const onKeyDown = (e) => {
    if (!selected) return;
    const map = {
      ArrowUp: [0, -SCHRITT], ArrowDown: [0, SCHRITT],
      ArrowLeft: [-SCHRITT, 0], ArrowRight: [SCHRITT, 0],
    };
    if (map[e.key]) { e.preventDefault(); move(...map[e.key]); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
    if (e.key.toLowerCase() === "r") { e.preventDefault(); rotate(); }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <LayoutGrid className="w-4 h-4 text-slate-500" />
        <span className="font-medium text-slate-800">{zone.name || "Raum"}</span>
        <span className="text-xs text-slate-500">
          {geschossLabel(zone)} · {Math.round(polygonAreaM(zone.points))} m² · {items.length} Möbel
        </span>
        {kollisionen.length > 0 && (
          <span className="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[11px] text-rose-700">
            {kollisionen.length} Überlappung{kollisionen.length === 1 ? "" : "en"}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_190px] gap-3">
        {/* Draufsicht + Auswahl-Aktionen */}
        <div className="space-y-2 min-w-0">
          <div className="rounded-lg border bg-white p-2 overflow-x-auto">
            <MoebelDraufsicht
              polygon={zone.points}
              items={items}
              selectable
              selectedId={selectedId}
              onSelect={setSelectedId}
              kollisionIds={kollisionIds}
              onItemMove={moveTo}
              onItemRotate={rotateId}
              oeffnungen={oeffnungen}
            />
          </div>
          <MoebelLegende />
          {selected && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5">
              <span className="text-xs font-medium text-sky-800 mr-1">
                {moebelById(selected.typ)?.name || selected.typ}
              </span>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach links" onClick={() => move(-SCHRITT, 0)}><ArrowLeft className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach oben" onClick={() => move(0, -SCHRITT)}><ArrowUp className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach unten" onClick={() => move(0, SCHRITT)}><ArrowDown className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach rechts" onClick={() => move(SCHRITT, 0)}><ArrowRight className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={rotate}>
                <RotateCw className="w-3.5 h-3.5 mr-1" /> 90°
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-red-600" onClick={remove}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Löschen
              </Button>
              <span className="text-[10px] text-slate-500 ml-auto">{t("Ziehen verschiebt (5-cm-Raster) · Doppelklick/R dreht · Pfeiltasten 10 cm · Entf löscht")}</span>
            </div>
          )}
          <MoebelListe items={items} selectedId={selectedId} onSelect={setSelectedId} kollisionIds={kollisionIds} />
          {warnungen.length > 0 && (
            <div className="space-y-1">
              {warnungen.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
                  {w.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Katalog-Seitenleiste — generisches KatalogPanel (Phase 34, PW-03) */}
        <KatalogPanel
          titel="Möbelkatalog"
          katalog={katalog}
          onAdd={addTyp}
          chipTitle={(t) => `${t.name} (${t.b.toLocaleString("de-DE")} × ${t.t.toLocaleString("de-DE")} m) einfügen`}
        />
      </div>
    </div>
  );
}

// Innenausbau: Raum-Möblierung (Hauptsektion) + Raumkonzepte (kompakte Zweitsektion).
// complexData.moeblierung = { [zoneKey]: [{id, typ, x, y, rot}] }  (Legacy level:name lesbar, s. moebel.js)
// complexData.moebel_eigene = [{ id, name, b, t, kategorie, benutzerseite }]  (Phase 43)
// complexData.interior_designs = [{ room, style, area, palette }]
export default function InteriorDesigner({ complexData, onInteriorDesignsChange, onMoeblierungChange, onMoebelEigeneChange }) {
  const designs = complexData?.interior_designs || [];
  const moeblierung = complexData?.moeblierung || {};
  // Eigene Typen ins Register (vor dem Rendern der Kinder — moebelById/itemRect brauchen sie).
  const eigene = complexData?.moebel_eigene || [];
  setzeEigeneTypen(eigene);
  const katalog = useMemo(() => katalogMitEigenen(eigene), [eigene]);
  const { zones } = useBuildingProgram(); // echte Räume aus dem Gebäudemodell
  const { t } = useI18n();
  // Phase 43: Hülle/Öffnungen/Innenwände des Projekts (read-only) für Tür-/Fenster-Kontext.
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  // Phase 43 (MOEBEL-02): Geschossplan als Hauptansicht, Raum-Karten als zweite Ansicht.
  // Aktiver Raum und Geschoss überleben den Ansichtswechsel.
  const [ansicht, setAnsicht] = useState("plan");
  const [aktivKey, setAktivKey] = useState(null);
  const [level, setLevel] = useState(0);
  const waehleRaum = (key) => {
    setAktivKey(key);
    const z = key ? zones.find((zz) => zoneKey(zz) === key) : null;
    if (z) setLevel(z.level ?? 0);
  };
  const itemsFuer = useCallback((z) => moebelFuerZone(moeblierung, z), [moeblierung]);
  const schreibe = (z, items) => onMoeblierungChange?.(mitMoebelFuerZone(moeblierung, z, items));

  // MOEBEL-04: Legacy-Einträge (level:name) auf den id-Schlüssel heben, sobald die Zonen ids
  // tragen — läuft beim Öffnen des Reiters, also vor jedem späteren Rename. Idempotent.
  useEffect(() => {
    const { moeblierung: neu, verschoben } = migriereMoeblierung(moeblierung, zones);
    if (verschoben > 0) onMoeblierungChange?.(neu);
  }, [zones, moeblierung, onMoeblierungChange]);

  // Verwaiste Möblierungen (Raum gelöscht oder vor Phase 43 umbenannt): zuweisen oder entfernen.
  const verwaist = useMemo(() => verwaisteKeys(moeblierung, zones), [moeblierung, zones]);
  const [zielKey, setZielKey] = useState({});
  const verwaisteZuweisen = (key) => {
    const ziel = zones.find((z) => zoneKey(z) === zielKey[key]);
    if (!ziel) return;
    const rest = { ...moeblierung };
    const items = rest[key] || [];
    delete rest[key];
    onMoeblierungChange?.(mitMoebelFuerZone(rest, ziel, [...moebelFuerZone(rest, ziel), ...items]));
  };
  const verwaisteEntfernen = (key) => {
    const rest = { ...moeblierung };
    delete rest[key];
    onMoeblierungChange?.(rest);
  };

  const add = () =>
    onInteriorDesignsChange?.([...designs, { room: "Wohnzimmer", style: "Modern", area: 25, palette: "#e2e8f0" }]);
  const upd = (i, patch) =>
    onInteriorDesignsChange?.(designs.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const remove = (i) => onInteriorDesignsChange?.(designs.filter((_, idx) => idx !== i));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sofa className="w-4 h-4" /> Innenausbau
        </CardTitle>
        <Button size="sm" onClick={add}><Plus className="w-4 h-4 mr-1" /> Raumkonzept</Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Möblierung: Geschossplan (alle Räume eines Geschosses) oder Raum-Karten (Zonen aus der gemeinsamen Quelle) */}
        {zones.length > 0 ? (
          <Tabs value={ansicht} onValueChange={setAnsicht}>
            <TabsList>
              <TabsTrigger value="plan" data-testid="ia-tab-plan">{t("Geschossplan")}</TabsTrigger>
              <TabsTrigger value="raeume" data-testid="ia-tab-raeume">{t("Räume")} ({zones.length})</TabsTrigger>
              <TabsTrigger value="katalog" data-testid="ia-tab-katalog">{t("Katalog")}{eigene.length ? ` (${eigene.length})` : ""}</TabsTrigger>
            </TabsList>
            {verwaist.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-1.5" data-testid="ia-verwaist">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5" /> {t("Möblierung ohne Raum")} ({verwaist.length}) — {t("Raum gelöscht oder umbenannt; zuweisen oder entfernen")}
                </div>
                {verwaist.map((key) => (
                  <div key={key} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                    <span className="font-mono">{key}</span>
                    <span>{(moeblierung[key] || []).length} {t("Möbel")}</span>
                    <select className="rounded border border-amber-300 bg-white px-1 py-0.5 text-xs" value={zielKey[key] || ""}
                      onChange={(e) => setZielKey({ ...zielKey, [key]: e.target.value })}>
                      <option value="">{t("Raum wählen …")}</option>
                      {zones.map((z) => <option key={zoneKey(z)} value={zoneKey(z)}>{z.name} ({geschossLabel(z)})</option>)}
                    </select>
                    <Button type="button" size="sm" variant="outline" className="h-6" disabled={!zielKey[key]} onClick={() => verwaisteZuweisen(key)}>{t("Zuweisen")}</Button>
                    <Button type="button" size="sm" variant="outline" className="h-6 text-red-600" onClick={() => verwaisteEntfernen(key)}>{t("Entfernen")}</Button>
                  </div>
                ))}
              </div>
            )}
            <TabsContent value="plan">
              <MoeblierungsPlan
                plan={plan}
                zones={zones}
                level={level}
                onLevelChange={setLevel}
                keyFuer={zoneKey}
                itemsFuer={itemsFuer}
                onItemsChange={schreibe}
                katalog={katalog}
                aktivKey={aktivKey}
                onAktivChange={waehleRaum}
              />
            </TabsContent>
            <TabsContent value="raeume">
              <div className="space-y-3">
                {zones.map((z) => {
                  const key = zoneKey(z);
                  return (
                    <RaumKarte
                      key={key}
                      zone={z}
                      items={itemsFuer(z)}
                      onItemsChange={(items) => schreibe(z, items)}
                      plan={plan}
                      katalog={katalog}
                    />
                  );
                })}
              </div>
            </TabsContent>
            <TabsContent value="katalog">
              <MoebelKatalogPflege eigene={eigene} moeblierung={moeblierung} onChange={onMoebelEigeneChange} />
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-xs text-slate-400">
            Räume im Gebäudemodell zeichnen (Zone-Werkzeug), dann können sie hier möbliert werden.
          </p>
        )}

        {/* Raumkonzepte (Stil/Palette) — kompakte Zweitsektion, unverändert editierbar */}
        <div className="border-t pt-4">
          <div className="text-xs font-medium text-slate-600 mb-2">Raumkonzepte (Stil &amp; Palette)</div>
          {designs.length === 0 && <p className="text-sm text-slate-500">Noch keine Raumkonzepte.</p>}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {designs.map((d, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2">
                <div className="h-10 rounded-md" style={{ background: `linear-gradient(135deg, ${d.palette}, #ffffff)` }} />
                <Input value={d.room} onChange={(e) => upd(i, { room: e.target.value })} placeholder="Raum" />
                <Select value={d.style} onValueChange={(v) => upd(i, { style: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Input type="number" value={d.area} onChange={(e) => upd(i, { area: Number(e.target.value) })} className="flex-1" />
                  <span className="text-xs text-slate-500">m²</span>
                  <input type="color" value={d.palette} onChange={(e) => upd(i, { palette: e.target.value })} className="w-9 h-9 rounded border" />
                  <Button variant="ghost" size="icon" className="text-red-500" onClick={() => remove(i)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
