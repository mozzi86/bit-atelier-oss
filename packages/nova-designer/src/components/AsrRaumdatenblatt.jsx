import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  ClipboardCheck, Lightbulb, Users, AlertTriangle, LayoutGrid,
  Search, Printer, Download, ListTodo, X,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  NUTZUNGSARTEN, sollwerteFuer, belegungsAequivalent, flaecheJeAequivalent,
  asrChecks, roomKey, bewegungsflaeche, checklistFuer, konformitaetAusCheckliste,
} from "@designer/lib/asr";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, polygonAreaM } from "@core/lib/useBuildingProgram";
import { moebelById, moebelChecks } from "@designer/lib/moebel";
import MoebelDraufsicht from "./MoebelDraufsicht";
import { moebelFuerZone, setzeEigeneTypen } from "@designer/lib/moebel";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Sollwert-Felder, die vom Nutzungsart-Select vorbelegt werden (Dirty-Schutz je Feld).
const SOLL_FELDER = ["beleuchtung_lx", "temp_soll_c", "temp_min_c", "hitzeschutz_c", "luftwechsel_1h", "laerm_dbA"];

// Check-/Ampel-Styling: NUR pass/warn/offen — "offen" bekommt ein eigenes neutrales
// slate-Badge; STATUS_STYLE.fail wird hier bewusst NIE gerendert (Haftung).
const AMPEL_BADGE = {
  pass: { className: STATUS_STYLE.pass.color, label: "konform (Konzept)" },
  warn: { className: STATUS_STYLE.warn.color, label: "mit Hinweisen" },
  neutral: { className: "bg-slate-100 text-slate-600", label: "offen" },
};

const SEITEN = { nord: "Nord", ost: "Ost", sued: "Süd", west: "West" };

// Status-Buttons je Checklisten-Zeile (Vorlage: erfüllt grün / offen rot / n. z. grau).
const CHECK_BTN = [
  { v: "ok",    label: "erfüllt", on: "bg-emerald-600 text-white border-emerald-600" },
  { v: "offen", label: "offen",   on: "bg-rose-600 text-white border-rose-600" },
  { v: "nz",    label: "n. z.",   on: "bg-slate-500 text-white border-slate-500" },
];

const geschossLabel = (z) => ((z.level ?? 0) === 0 ? "EG" : `${z.level}. OG`);
// Card-DOM-Id für "Offene Punkte"-Sprungziel (getElementById verkraftet beliebige Zeichen).
const cardId = (key) => `asr-card-${key}`;

// Dirty-Felder blau hinterlegen (Vorlagen-Muster) — Wrapper, da NumberField
// keine className durchreicht.
function DirtyWrap({ dirty, children }) {
  return (
    <div className={dirty ? "rounded-lg bg-sky-50 ring-1 ring-sky-200 p-1.5 -m-1.5" : ""}>
      {children}
    </div>
  );
}

// --- Einklappbare ASR-Checkliste je Raum (Vorlagen-Muster <details>) ---------------------
function AsrCheckliste({ punkte, status, onToggle }) {
  const refs = punkte.filter((p) => p.ref).map((p) => p.ref);
  const ok = refs.filter((r) => status[r] === "ok").length;
  const offen = refs.filter((r) => status[r] === "offen").length;
  return (
    <details className="rounded-lg border bg-white">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700 flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-slate-500" />
        ASR-Checkliste
        <span className="text-xs font-normal text-slate-500">
          {(ok || offen)
            ? <><span className="text-emerald-700 font-medium">{ok} erfüllt</span> · <span className="text-rose-700 font-medium">{offen} offen</span> · {refs.length} Punkte</>
            : `${refs.length} Punkte — noch nicht bewertet`}
        </span>
      </summary>
      <div className="border-t divide-y">
        {punkte.map((p, i) =>
          p.gruppe ? (
            <div key={`g-${i}`} className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold tracking-wide text-slate-500">
              {p.gruppe}
            </div>
          ) : (
            <div key={p.ref} className="px-3 py-2 flex items-start gap-3">
              <span className="shrink-0 mt-0.5 text-[11px] font-mono text-slate-500 w-20">{p.ref}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800">{p.titel}</div>
                <div className="text-[11px] text-slate-500">{p.hinweis}</div>
              </div>
              <div className="shrink-0 flex gap-1">
                {CHECK_BTN.map((b) => (
                  <button
                    key={b.v}
                    type="button"
                    onClick={() => onToggle(p.ref, b.v)}
                    className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                      status[p.ref] === b.v ? b.on : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </details>
  );
}

// --- Raum-Card (eine Card je Raum, Vorlagen-Layout) ---------------------------------------
function RoomCard({ zone, ov, checkStatus, setRoom, setCheck, moebel }) {
  const key = roomKey(zone);
  const nutzung = ov.nutzung || "sonstige";
  const punkte = useMemo(() => checklistFuer(nutzung), [nutzung]);

  // Möblierung (read-only aus dem Innenausbau-Reiter): Warnungen + Gruppierung.
  const moebelWarn = useMemo(() => moebelChecks(moebel, zone.points), [moebel, zone.points]);
  const moebelGruppen = useMemo(() => {
    const m = new Map();
    (moebel || []).forEach((it) => m.set(it.typ, (m.get(it.typ) || 0) + 1));
    return [...m.entries()];
  }, [moebel]);

  const kpi = useMemo(() => {
    const sw = sollwerteFuer(nutzung);
    // Merge: manuell geänderte Felder (Dirty) gewinnen, sonst Katalog-Default.
    const soll = {};
    SOLL_FELDER.forEach((f) => { soll[f] = ov[`${f}Dirty`] ? ov[f] : sw[f]; });
    const flaeche = polygonAreaM(zone.points);
    const arbeitsplaetze = ov.arbeitsplaetze ?? 0;
    const arbeitsgelegenheiten = ov.arbeitsgelegenheiten ?? 0;
    const personen = ov.personen ?? 0;
    const aequivalent = belegungsAequivalent(arbeitsplaetze, arbeitsgelegenheiten);
    const flaecheJeAeq = flaecheJeAequivalent(flaeche, aequivalent);
    // Konformität wird aus der Checkliste ABGELEITET (alle erfüllt → ja,
    // irgendein offen → offen, n. z. neutral) — manueller Override (Dirty) gewinnt.
    const abgeleitet = konformitaetAusCheckliste(checkStatus, punkte);
    const konformitaet = ov.konformitaetDirty ? (ov.konformitaet || "offen") : abgeleitet;
    const checks = asrChecks(zone, soll, { konformitaet });
    return { soll, flaeche, arbeitsplaetze, arbeitsgelegenheiten, personen, aequivalent, flaecheJeAeq, konformitaet, abgeleitet, checks };
  }, [zone, ov, nutzung, checkStatus, punkte]);

  // Nutzungsart-Wechsel: Sollwerte vorbelegen — Dirty-Felder springen NICHT zurück.
  const onNutzung = (v) => {
    setRoom(key, (r) => {
      const sw = sollwerteFuer(v);
      const next = { ...r, nutzung: v };
      SOLL_FELDER.forEach((f) => { next[f] = r[`${f}Dirty`] ? r[f] : sw[f]; });
      return next;
    });
  };
  const setFeld = (feld) => (v) => setRoom(key, (r) => ({ ...r, [feld]: v, [`${feld}Dirty`]: true }));

  // Draufsicht-Parameter (per Raum): Seite + Tiefe des Bewegungsflächen-Bands.
  const bewegungsSeite = ov.bewegungsSeite || "sued";
  const bewegungTiefe = ov.bewegungTiefe ?? 1.0;

  // Raumseiten-Band (ASR A1.2) — die Draufsicht selbst rendert MoebelDraufsicht.
  const band = useMemo(
    () => bewegungsflaeche(zone.points, bewegungTiefe, bewegungsSeite),
    [zone, bewegungTiefe, bewegungsSeite],
  );

  return (
    <Card
      id={cardId(key)}
      className="break-inside-avoid"
      // Rendering-Entlastung bei vielen Räumen (Vorlagen-Muster).
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 700px" }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4" /> {zone.name || "Raum"}
          </span>
          <span className="text-sm font-normal text-slate-500">
            {geschossLabel(zone)} · {de(kpi.flaeche)} m²
          </span>
          <Badge className={`${AMPEL_BADGE[kpi.checks.ampel].className} ml-auto`}>
            {AMPEL_BADGE[kpi.checks.ampel].label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1 col-span-2">
            <label className="text-xs text-slate-500">Nutzungsart (treibt Sollwert-Vorbelegung)</label>
            <Select value={nutzung} onValueChange={onNutzung}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(NUTZUNGSARTEN).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Stat label="Fläche (aus Modell)" value={`${de(kpi.flaeche)} m²`} accent="text-emerald-700" />
          <Stat label="Geschoss" value={geschossLabel(zone)} accent="text-slate-700" />
        </div>

        {/* Feld-Grid (10 Felder) — Dirty-Felder blau hinterlegt wie in der Vorlage. */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <DirtyWrap dirty={ov.temp_soll_cDirty}><NumberField label="Heizung Soll (Winterfall) ASR A3.5" value={kpi.soll.temp_soll_c} step={0.5} suffix="°C" onChange={setFeld("temp_soll_c")} /></DirtyWrap>
          <DirtyWrap dirty={ov.temp_min_cDirty}><NumberField label="Temperatur min ASR A3.5" value={kpi.soll.temp_min_c} step={0.5} suffix="°C" onChange={setFeld("temp_min_c")} /></DirtyWrap>
          <DirtyWrap dirty={ov.hitzeschutz_cDirty}><NumberField label="Hitzeschutz max (Sommerfall) ASR A3.5 (≤26)" value={kpi.soll.hitzeschutz_c} step={0.5} suffix="°C" onChange={setFeld("hitzeschutz_c")} /></DirtyWrap>
          <DirtyWrap dirty={ov.luftwechsel_1hDirty}><NumberField label="Luftwechsel ASR A3.6" value={kpi.soll.luftwechsel_1h} step={0.5} suffix="1/h" onChange={setFeld("luftwechsel_1h")} /></DirtyWrap>
          <DirtyWrap dirty={ov.laerm_dbADirty}><NumberField label="Schallschutz / Geräusch ASR A3.7" value={kpi.soll.laerm_dbA} suffix="dB(A)" min={0} onChange={setFeld("laerm_dbA")} /></DirtyWrap>
          <DirtyWrap dirty={ov.beleuchtung_lxDirty}><NumberField label="Beleuchtung ASR A3.4" value={kpi.soll.beleuchtung_lx} suffix="lx" min={0} onChange={setFeld("beleuchtung_lx")} /></DirtyWrap>
          <DirtyWrap dirty={ov.arbeitsplaetzeDirty}><NumberField label="Arbeitsplätze dauerhaft bis 8h" value={kpi.arbeitsplaetze} suffix="Stk." min={0} onChange={setFeld("arbeitsplaetze")} /></DirtyWrap>
          <DirtyWrap dirty={ov.arbeitsgelegenheitenDirty}><NumberField label="Arbeitsgelegenheiten bis 3h (Faktor 0,5)" value={kpi.arbeitsgelegenheiten} suffix="Stk." min={0} onChange={setFeld("arbeitsgelegenheiten")} /></DirtyWrap>
          <DirtyWrap dirty={ov.personenDirty}><NumberField label="Personen heute anwesend" value={kpi.personen} suffix="Pers." min={0} onChange={setFeld("personen")} /></DirtyWrap>
          <DirtyWrap dirty={ov.konformitaetDirty}>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">
                ASR-Konformität ({ov.konformitaetDirty ? "manueller Override" : "aus Checkliste abgeleitet"})
              </label>
              <Select
                value={kpi.konformitaet}
                onValueChange={(v) => setRoom(key, (r) => ({ ...r, konformitaet: v, konformitaetDirty: true }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja">ja</SelectItem>
                  <SelectItem value="nein">nein</SelectItem>
                  <SelectItem value="offen">offen</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyWrap>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Belegungsäquivalent (Richtwert)" value={`${de1(kpi.aequivalent)} Pers.-Äq.`} accent="text-sky-600" />
          <Stat label="Fläche je Belegungsäquivalent (Richtwert)" value={`${de1(kpi.flaecheJeAeq)} m²/Pers.-Äq.`} accent="text-violet-600" />
        </div>
        <div className="text-xs text-slate-500">
          Leere Felder = für diese Nutzungsart nicht anwendbar (n. a.) — kein Verstoß.
          Manuell geänderte Werte (blau) springen beim Nutzungsart-Wechsel nicht zurück.
        </div>

        {/* Einklappbare ASR-Checkliste (Vorlagen-Muster) — Status je Raum persistent. */}
        <AsrCheckliste
          punkte={punkte}
          status={checkStatus}
          onToggle={(ref, v) => setCheck(key, ref, v)}
        />

        {/* Draufsicht (ASR A1.2): Zone-Umriss + freizuhaltendes Bewegungsflächen-Band. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Benutzerseite (Bewegungsfläche)</label>
            <Select
              value={bewegungsSeite}
              onValueChange={(v) => setRoom(key, (r) => ({ ...r, bewegungsSeite: v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SEITEN).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <NumberField label="Tiefe Bewegungsfläche (ASR A1.2)" value={bewegungTiefe} step={0.1} suffix="m" min={0} onChange={(v) => setRoom(key, (r) => ({ ...r, bewegungTiefe: v }))} />
        </div>
        <div className="rounded-lg border bg-white p-2 overflow-x-auto">
          <MoebelDraufsicht polygon={zone.points} items={moebel} band={band} />
          <div className="text-xs text-amber-700 mt-1">
            freizuhaltende Bewegungsfläche Benutzerseite ({de2(bewegungTiefe)} m tief, ASR A1.2)
          </div>
          {/* Legende (Vorlagen-Muster) */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 mt-1">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-2.5 rounded-[2px]" style={{ background: "#9ec5ff", border: "1px solid #0f62fe" }} />Schreibtisch / Tisch</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-2.5 rounded-[2px]" style={{ background: "#e6edf3", border: "1px solid #afb8c1" }} />Stuhl</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-2.5 rounded-[2px]" style={{ background: "#d8dee4", border: "1px solid #8b949e" }} />Möbel / Sanitär</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-2.5 rounded-[2px]" style={{ background: "rgba(45,164,78,.10)", border: "1px dashed #2da44e" }} />Bewegungsfläche frei</span>
          </div>
        </div>

        {/* Möbel-Liste (read-only, aus dem Innenausbau-Reiter) + A1.2-Kontext. */}
        {moebel.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-600">Möbel im Raum ({moebel.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {moebelGruppen.map(([typ, anzahl]) => (
                <span key={typ} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                  {anzahl}× {moebelById(typ)?.name || typ}
                </span>
              ))}
            </div>
            <div className={`text-xs ${moebelWarn.length ? "text-amber-700" : "text-slate-500"}`}>
              ASR A1.2 (Bewegungsflächen): {moebel.length} Möbel, davon{" "}
              {new Set(moebelWarn.map((w) => w.itemId)).size} mit Konflikt
              {moebelWarn.length > 0 ? ":" : "."}
            </div>
            {moebelWarn.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
                {w.text}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 border-t pt-2">
            Noch keine Möbel — Möblierung erfolgt im Reiter „Innenausbau“ und erscheint hier automatisch.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AsrRaumdatenblatt({ complexData }) {
  // Raumquelle READ-only aus der gemeinsamen Quelle — nie zurückschreiben.
  const { zones } = useBuildingProgram();
  // Möblierung read-only aus dem Innenausbau-Reiter (complexData.moeblierung).
  const moeblierung = complexData?.moeblierung || {};
  // Phase 43: eigene Möbeltypen des Projekts registrieren, damit die Draufsicht ihre Maße kennt.
  setzeEigeneTypen(complexData?.moebel_eigene || []);
  const { project } = useProject();

  // Per-Raum-State (usePanelState, keyed roomKey): Overrides/Dirty + Checklisten-Stände.
  const [asrByRoom, setAsrByRoom] = usePanelState("asr:asrByRoom", {});
  const [checkByRoom, setCheckByRoom] = usePanelState("asr:checkByRoom", {});
  const [suche, setSuche] = usePanelState("asr:suche", "");
  const [offenePanel, setOffenePanel] = useState(false);

  // ---- Bestandsräume (Entity AsrRaum, z. B. importiert aus dem echten
  // Raumdatenblatt-Export eines Referenzprojekts, anonymisiert: 215 Räume mit IFC-GUID).
  // Bewusst GETRENNT von den Designer-Zonen: Bestand ist erfasst, nicht entworfen.
  const [bestand, setBestand] = useState([]);
  const [bestandDirty, setBestandDirty] = useState({});
  useEffect(() => {
    if (!project?.id) return;
    let weg = false;
    bitApi.entities.AsrRaum.filter({ project_id: project.id })
      .then((rows) => { if (!weg) setBestand(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { weg = true; };
  }, [project?.id]);
  const ASR_FELDER = [
    ["temp_soll", "Heizung Soll (Winterfall)", "°C", "ASR A3.5"],
    ["temp_min", "Temperatur min", "°C", "ASR A3.5"],
    ["temp_max", "Hitzeschutz max (Sommerfall)", "°C", "ASR A3.5 (≤26)"],
    ["luftwechsel", "Luftwechsel", "1/h", "ASR A3.6"],
    ["schallschutz_db", "Schallschutz", "dB", "ASR A3.7"],
    ["beleuchtung_lx", "Beleuchtung", "lx", "ASR A3.4"],
    ["personen_heute", "Personen (heute)", "", ""],
    ["ap_dauerhaft", "Arbeitsplätze dauerhaft", "", "ASR A1.2"],
    ["ap_gelegenheit", "Arbeitsplätze gelegentlich", "", "ASR A1.2"],
  ];
  const setBestandFeld = (id, feld, wert) => {
    setBestand((list) => list.map((r) => (r.id === id ? { ...r, felder: { ...r.felder, [feld]: wert } } : r)));
    setBestandDirty((d) => ({ ...d, [id]: true }));
  };
  const speichereBestand = async (r) => {
    await bitApi.entities.AsrRaum.update(r.id, { felder: r.felder });
    setBestandDirty((d) => ({ ...d, [r.id]: false }));
  };
  const bestandGefiltert = useMemo(() => {
    const q = (suche || "").trim().toLowerCase();
    if (!q) return bestand;
    return bestand.filter((r) => `${r.nr} ${r.name} ${r.geschoss}`.toLowerCase().includes(q));
  }, [bestand, suche]);

  const setRoom = (key, fn) => setAsrByRoom((m) => ({ ...m, [key]: fn(m[key] || {}) }));
  // Status-Toggle je Checklisten-Zeile: erneuter Klick auf aktiven Status löscht ihn.
  const setCheck = (key, ref, v) =>
    setCheckByRoom((m) => {
      const st = { ...(m[key] || {}) };
      if (st[ref] === v) delete st[ref]; else st[ref] = v;
      return { ...m, [key]: st };
    });

  // Live-Suche über Name + Geschoss.
  const gefiltert = useMemo(() => {
    const q = (suche || "").trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) =>
      `${z.name || ""} ${geschossLabel(z)}`.toLowerCase().includes(q));
  }, [zones, suche]);

  // "Offene Punkte" über alle Räume aggregieren (Raum + Referenz + Titel).
  const offenePunkte = useMemo(() => {
    const out = [];
    zones.forEach((z) => {
      const key = roomKey(z);
      const st = checkByRoom[key] || {};
      const punkte = checklistFuer((asrByRoom[key] || {}).nutzung || "sonstige");
      punkte.forEach((p) => {
        if (p.ref && st[p.ref] === "offen") {
          out.push({ key, raum: `${z.name || "Raum"} (${geschossLabel(z)})`, ref: p.ref, titel: p.titel });
        }
      });
    });
    return out;
  }, [zones, checkByRoom, asrByRoom]);

  const springeZuRaum = (key) => {
    setOffenePanel(false);
    // Nach dem Schließen des Overlays zur Karte scrollen.
    requestAnimationFrame(() => {
      document.getElementById(cardId(key))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // JSON-Export: alle Overrides + Checklisten-Stände, Dateiname mit Projektname.
  const exportJson = () => {
    const payload = {
      projekt: project?.name || null,
      exportiert: new Date().toISOString(),
      overrides: asrByRoom,
      checklisten: checkByRoom,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name = (project?.name || "Projekt").replace(/[^\wäöüÄÖÜß-]+/g, "_");
    a.download = `ASR_Raumdatenblatt_${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>ASR-Raumdatenblatt — Konzept-Richtwerte, kein arbeitsschutzrechtlicher Nachweis.</strong>{" "}
          Soll-Werte nach ASR A3.4 (Beleuchtung), A3.5 (Raumtemperatur/Hitzeschutz), A3.6 (Lüftung),
          A3.7 (Lärm) und Bewegungsflächen nach A1.2 sind überschreibbare Orientierungswerte und
          ersetzen keine Gefährdungsbeurteilung. Prüfung durch Fachkraft für Arbeitssicherheit /
          Betriebsarzt / zuständige Behörde erforderlich.
        </span>
      </div>
      <div className="text-xs text-slate-500 print:hidden">
        Anlagen-/Bedarfsberechnung → Reiter „Haustechnik (TGA)“; Bauakustik → Reiter „Schallschutz“;
        DIN-18040-Nachweise → Reiter „Barrierefreiheit“.
      </div>

      {/* Sticky-Top-Bar (Vorlagen-Muster): Suche + Reset + Offene Punkte + Druck + Export. */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-white/95 backdrop-blur border-b flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Raum suchen (Name oder Geschoss) …"
            className="pl-8"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setSuche("")}>
          <Users className="w-4 h-4 mr-1.5" /> Alle Räume ({zones.length})
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOffenePanel(true)}>
          <ListTodo className="w-4 h-4 mr-1.5" /> Offene Punkte
          {offenePunkte.length > 0 && (
            <Badge className="ml-1.5 bg-rose-100 text-rose-700">{offenePunkte.length}</Badge>
          )}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-1.5" /> Drucken / PDF
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={exportJson}>
          <Download className="w-4 h-4 mr-1.5" /> JSON sichern
        </Button>
      </div>

      {/* Bestandsräume (Entity AsrRaum) — erfasster Bestand, z. B. aus dem echten
          Raumdatenblatt-Export importiert. Eigener Abschnitt VOR den Designer-Zonen. */}
      {bestand.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Bestandsräume ({bestandGefiltert.length}/{bestand.length})
            <Badge className="bg-emerald-100 text-emerald-700">aus Raumdatenblatt-Vorlage · IFC-GUIDs</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {bestandGefiltert.map((r) => (
              <Card key={r.id} className="border shadow-sm">
                <CardHeader className="py-2.5 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <b className="text-slate-500">{r.nr}</b> {r.name}
                    <span className="text-[11px] font-normal text-slate-400">{r.geschoss}</span>
                  </CardTitle>
                  <Button size="sm" variant={bestandDirty[r.id] ? "default" : "outline"} className="h-7 px-2 text-xs"
                    disabled={!bestandDirty[r.id]} onClick={() => speichereBestand(r)}>
                    speichern
                  </Button>
                </CardHeader>
                <CardContent className="pt-0 pb-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {ASR_FELDER.map(([feld, label, einheit, ref]) => (
                    <label key={feld} className="text-[11px] text-slate-500 flex flex-col gap-0.5">
                      <span>{label}{ref ? <em className="not-italic text-slate-300"> · {ref}</em> : null}</span>
                      <span className="flex items-center gap-1">
                        <Input className="h-7 text-xs" value={r.felder?.[feld] ?? ""}
                          onChange={(e) => setBestandFeld(r.id, feld, e.target.value)} />
                        {einheit && <u className="no-underline text-slate-400">{einheit}</u>}
                      </span>
                    </label>
                  ))}
                  {r.guid && <div className="col-span-2 text-[10px] text-slate-300 truncate" title={r.guid}>IFC-GUID {r.guid}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Alle Räume als durchscrollbare Karten-Liste (Vorlagen-Muster). */}
      {zones.length === 0 && bestand.length > 0 ? null : zones.length === 0 ? (
        <p className="text-xs text-slate-400">
          Räume im Gebäudemodell zeichnen (Zone-Werkzeug), dann erscheinen sie hier.
        </p>
      ) : gefiltert.length === 0 ? (
        <p className="text-sm text-slate-500">
          Kein Raum passt zu „{suche}“ — Suchbegriff anpassen oder „Alle Räume“ wählen.
        </p>
      ) : (
        <div className="space-y-4">
          {gefiltert.map((z) => {
            const key = roomKey(z);
            return (
              <RoomCard
                key={key}
                zone={z}
                ov={asrByRoom[key] || {}}
                checkStatus={checkByRoom[key] || {}}
                setRoom={setRoom}
                setCheck={setCheck}
                moebel={moebelFuerZone(moeblierung, z)}
              />
            );
          })}
        </div>
      )}

      {/* "Offene Punkte"-Overlay: aggregiert alle offenen Checklisten-Punkte. */}
      {offenePanel && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 print:hidden"
          onClick={() => setOffenePanel(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <div className="font-semibold text-slate-800 flex items-center gap-2">
                <ListTodo className="w-4 h-4" /> Offene Punkte ({offenePunkte.length})
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOffenePanel(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="divide-y">
              {offenePunkte.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">Keine offenen Punkte erfasst.</p>
              ) : (
                offenePunkte.map((p, i) => (
                  <button
                    key={`${p.key}-${p.ref}-${i}`}
                    type="button"
                    onClick={() => springeZuRaum(p.key)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-3"
                  >
                    <span className="shrink-0 mt-0.5 text-[11px] font-mono text-slate-500 w-20">{p.ref}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-800">{p.titel}</span>
                      <span className="block text-[11px] text-slate-500">{p.raum}</span>
                    </span>
                    <Lightbulb className="w-3.5 h-3.5 mt-1 text-slate-300" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
