import React, { useCallback, useMemo, useState } from "react";
import { geschossName } from "@core/lib/bauteil/ebenen.js";
// W-1118-02 review R-3: the GUID the studio pins per room _idx (the same evidence the migration in ComplexDesigner uses)
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
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
  zoneKey, moebelFuerZone, mitMoebelFuerZone, moebelOhneRaum, ohneRaumZuweisen,
  setzeEigeneTypen, katalogMitEigenen,
} from "@designer/lib/moebel";
// W-1118-02: texts of the "Möbel ohne Raum" panel live in the lazy part of phase 115 (pattern raeume-107-11.js)
import { englischErgaenzen } from "@core/lib/i18n";
import { EN as EN_RAEUME_11512 } from "@core/lib/i18nTeile/raeume-115-12.js";
englischErgaenzen(EN_RAEUME_11512);
import { oeffnungenAmRaum } from "@designer/lib/raumOeffnungen";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import MoebelDraufsicht, { MoebelLegende } from "./MoebelDraufsicht";
import MoeblierungsPlan from "./MoeblierungsPlan";
import MoebelKatalogPflege from "./MoebelKatalogPflege";
import KatalogPanel from "./KatalogPanel";

const STYLES = ["Modern", "Skandinavisch", "Industrial", "Minimalistisch", "Klassisch", "Biophilic"];

// 107-13: the same storey name as the furnishing plan tabs ("1. UG" for basement rooms), from @core (bauteil/ebenen.js)
const geschossLabel = (z) => geschossName(z.level ?? 0);

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
              <Button aria-label={t("10 cm nach links verschieben")} type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach links" onClick={() => move(-SCHRITT, 0)}><ArrowLeft className="w-3.5 h-3.5" /></Button>
              <Button aria-label={t("10 cm nach oben verschieben")} type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach oben" onClick={() => move(0, -SCHRITT)}><ArrowUp className="w-3.5 h-3.5" /></Button>
              <Button aria-label={t("10 cm nach unten verschieben")} type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach unten" onClick={() => move(0, SCHRITT)}><ArrowDown className="w-3.5 h-3.5" /></Button>
              <Button aria-label={t("10 cm nach rechts verschieben")} type="button" variant="outline" size="icon" className="h-7 w-7" title="10 cm nach rechts" onClick={() => move(SCHRITT, 0)}><ArrowRight className="w-3.5 h-3.5" /></Button>
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
// complexData.moeblierung = { [zoneKey]: [{id, typ, x, y, rot}] }  (keys guid:/id:/level:name, see moebel.js)
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

  // W-1118-02: the migration on open (guid:/id:/legacy keys) runs in ComplexDesigner once both records are loaded — not here,
  // so the readers of the other tabs see the moved keys too. This tab shows what is left: "Möbel ohne Raum" — entries no room
  // shows (room deleted or rebuilt with a new GUID, or an id: entry that could not be assigned safely), with the reason and a
  // proposal the person confirms. Nothing is assigned without a click.
  // Review R-3: the same GUID evidence as the migration (ComplexDesigner) — the GUID the studio pins for a room record with this _idx.
  const pid = project?.id || null;
  const guidBeleg = useMemo(() => ({ guidAusIdx: (/** @type {number|string} */ idx) => bauteilGuid(pid, "customZones", { _idx: /** @type {any} */ (idx) }) }), [pid]);
  const ohneRaum = useMemo(() => moebelOhneRaum(moeblierung, zones, guidBeleg), [moeblierung, zones, guidBeleg]);
  const [zielKey, setZielKey] = useState(/** @type {Record<string, string>} */ ({}));
  /** Target room of a row: the person's choice, else the proposal (only ever the row's own room, review R-1). @param {{key: string, vorschlag: string|null}} e */
  const zielVon = (e) => zielKey[e.key] ?? e.vorschlag ?? "";
  /** @param {Record<string, string>} zuordnung stored key → zoneKey of the target room */
  const zuweisen = (zuordnung) => {
    const neu = ohneRaumZuweisen(moeblierung, zones, zuordnung);
    if (neu !== moeblierung) onMoeblierungChange?.(neu);
  };
  // Review R-1: "Alle zuweisen" takes the rows whose target is the proposal — the row's OWN room (moebelOhneRaum never proposes a
  // foreign one) — or a room the person picked in that row; a row without either stays.
  const alleZuweisbar = ohneRaum.filter((e) => zielVon(e));
  /** Review R-3: removing deletes the furniture for good (autosaved, no undo) — only after a confirmation. @param {{key: string, items: any[]}} e */
  const verwaisteEntfernen = (e) => {
    if (!window.confirm(t("{{n}} Möbel endgültig entfernen? Das lässt sich nicht rückgängig machen.").replace("{{n}}", String(e.items.length)))) return;
    const rest = { ...moeblierung };
    delete rest[e.key];
    onMoeblierungChange?.(rest);
  };
  /** "Name (Geschoss)" of a room. @param {any} z */
  const raumText = (z) => `${z?.name || t("Raum")} (${geschossLabel(z)})`;
  /** Why a row has no room, in words. @param {import("@designer/lib/moebel").MoebelOhneRaum} e */
  const grundText = (e) => {
    if (e.grund === "mehrdeutig") return t("Lage nicht eindeutig — an dieser Stelle liegen mehrere Räume: {{raeume}}.").replace("{{raeume}}", e.kandidaten.map(raumText).join(", "));
    if (e.grund === "belegt") return t("{{raum}} hat schon eigene Möbel.").replace("{{raum}}", raumText(e.raum));
    const grund = e.grund === "ausserhalb"
      ? (e.imRaum > 0 ? t("Nicht alle Möbel liegen in {{raum}}, dem Raum, dem sie bisher zugeordnet waren.") : t("Die Möbel liegen nicht in {{raum}}, dem Raum, dem sie bisher zugeordnet waren.")).replace("{{raum}}", raumText(e.raum))
      : t("Den Raum gibt es nicht mehr.");
    // review R-1: a room the furniture lies in is named, never preselected — the person picks it
    return e.kandidaten.length ? `${grund} ${t("Sie liegen in {{raeume}}.").replace("{{raeume}}", e.kandidaten.map(raumText).join(", "))}` : grund;
  };
  /** Marker of an option in the room choice. @param {import("@designer/lib/moebel").MoebelOhneRaum} e @param {any} z */
  const optionZusatz = (e, z) => {
    const k = zoneKey(z);
    if (k === e.vorschlag) return ` — ${t("Vorschlag")}`;
    return e.kandidaten.some((kz) => zoneKey(kz) === k) ? ` — ${t("Möbel liegen hier")}` : "";
  };
  /** Up to three furniture names of a row ("Schreibtisch, Stuhl …"). @param {Array<any>} items */
  const moebelNamen = (items) => {
    const namen = [...new Set(items.map((it) => moebelById(it?.typ)?.name || it?.typ))];
    return namen.slice(0, 3).join(", ") + (namen.length > 3 ? " …" : "");
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
            {ohneRaum.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-1.5" data-testid="ia-verwaist">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5" /> {t("Möbel ohne Raum")} ({ohneRaum.length})
                  <span className="font-normal">— {t("Diese Möbel lassen sich keinem Raum sicher zuordnen. Raum wählen und zuweisen oder entfernen.")}</span>
                  {alleZuweisbar.length > 1 && (
                    <Button type="button" size="sm" variant="outline" className="h-6 ml-auto" data-testid="ia-ohne-raum-alle"
                      onClick={() => zuweisen(Object.fromEntries(alleZuweisbar.map((e) => [e.key, zielVon(e)])))}>
                      {t("Alle zuweisen")} ({alleZuweisbar.length})
                    </Button>
                  )}
                </div>
                {ohneRaum.map((e) => (
                  <div key={e.key} className="flex flex-wrap items-center gap-2 text-xs text-amber-900" data-testid="ia-ohne-raum-eintrag" data-key={e.key} data-grund={e.grund} title={e.key}>
                    <span className="font-medium">{e.items.length} {t("Möbel")}</span>
                    <span>({moebelNamen(e.items)})</span>
                    <span className="basis-full sm:basis-auto">{grundText(e)}</span>
                    <select aria-label={t("Raum wählen …")} className="rounded border border-amber-300 bg-white px-1 py-0.5 text-xs" value={zielVon(e)}
                      onChange={(ev) => setZielKey({ ...zielKey, [e.key]: ev.target.value })}>
                      <option value="">{t("Raum wählen …")}</option>
                      {zones.map((z, i) => (
                        <option key={`${zoneKey(z)}-${i}`} value={zoneKey(z)}>
                          {raumText(z)}{optionZusatz(e, z)}
                        </option>
                      ))}
                    </select>
                    <Button type="button" size="sm" variant="outline" className="h-6" disabled={!zielVon(e)} data-testid="ia-ohne-raum-zuweisen"
                      onClick={() => zuweisen({ [e.key]: zielVon(e) })}>{t("Zuweisen")}</Button>
                    <Button type="button" size="sm" variant="outline" className="h-6 text-red-600" data-testid="ia-ohne-raum-entfernen"
                      onClick={() => verwaisteEntfernen(e)}>{t("Entfernen")}</Button>
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
                  <SelectTrigger aria-label={t("Stil")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Input type="number" value={d.area} onChange={(e) => upd(i, { area: Number(e.target.value) })} className="flex-1" />
                  <span className="text-xs text-slate-500">m²</span>
                  <input type="color" value={d.palette} onChange={(e) => upd(i, { palette: e.target.value })} className="w-9 h-9 rounded border" />
                  <Button aria-label={t("Raumgestaltung entfernen")} variant="ghost" size="icon" className="text-red-500" onClick={() => remove(i)}>
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
