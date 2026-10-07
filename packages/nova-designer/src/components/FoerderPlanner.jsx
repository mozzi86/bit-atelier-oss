import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Landmark, Calculator, ClipboardList, Gauge, AlertTriangle, Trash2, Plus,
} from "lucide-react";
import { toast } from "sonner";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import {
  PROGRAMM_KATALOG, TYP_LABEL, ANTRAG_STATUS,
  KUNST_PCT_MIN, KUNST_PCT_MAX, KUNST_PCT_DEFAULT,
  foerderSchaetzung, kunstAmBauBetrag, kunstAmBauSatzVorschlag, fristStatus, fundingChecks,
} from "@designer/lib/funding";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const eur = (n) => `${de(n)} €`;
const deDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
};

// Badge-Farben je Antragsstatus (geplant/eingereicht/bewilligt/abgelehnt).
const ANTRAG_STATUS_BADGE = {
  geplant: "bg-slate-100 text-slate-700",
  eingereicht: "bg-blue-100 text-blue-700",
  bewilligt: "bg-emerald-100 text-emerald-700",
  abgelehnt: "bg-rose-100 text-rose-700",
};

// Fristen-Badge (reine Anzeige): nur „bald"/„abgelaufen" werden gezeigt.
const FRIST_BADGE = {
  bald: { label: "Frist bald", className: "bg-amber-100 text-amber-800" },
  abgelaufen: { label: "Frist abgelaufen", className: "bg-rose-100 text-rose-700" },
};

const EMPTY_FORM = { titel: "", programm_key: "beg_em", kosten: 0, frist: "" };

export default function FoerderPlanner() {
  // Globales aktuelles Projekt — gleicher Weg wie andere Designer-Panels
  // (UnitMixCompliance/SpaceProgram): useProject() aus dem ProjectContext.
  const { projectId } = useProject();
  // Geometrie/Kosten READ-only aus der gemeinsamen Quelle — nie zurückschreiben.
  const store = useBuildingProgram();

  // „heute" GENAU EINMAL erzeugen (nur UI) — die Lib bleibt deterministisch.
  const heute = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Card A — Programmkatalog & Kunst am Bau
  const [oeffentlich, setOeffentlich] = useState("nein");
  const [kunstPct, setKunstPct] = useState(KUNST_PCT_DEFAULT);
  const [kunstPctDirty, setKunstPctDirty] = useState(false);
  const [bausumme, setBausumme] = useState(0);
  const [bausummeDirty, setBausummeDirty] = useState(false);

  // FU-01: Solange der Satz nicht selbst angefasst wurde, gilt der Staffelsatz des
  // Bundes (BMWSB 07/2024) aus den Bauwerkskosten — überschreibbar, Herkunft sichtbar.
  const kunstVorschlag = kunstAmBauSatzVorschlag(bausumme);
  const kunstPctEffektiv = kunstPctDirty || !kunstVorschlag ? kunstPct : kunstVorschlag.pct;
  const kunstBetrag = kunstAmBauBetrag(bausumme, kunstPctEffektiv);

  // Card B — Schätzung
  const [kosten, setKosten] = useState(0);
  const [kostenDirty, setKostenDirty] = useState(false);
  const [programmKey, setProgrammKey] = useState("beg_em");

  // Card C — Anträge (persistent via bitApi.entities.FoerderAntrag)
  const [antraege, setAntraege] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  // Bausumme aus dem Kosten-Tab vorbelegen (costEstimate.total), solange die
  // Nutzer:in nichts überschrieben hat (Dirty-Flag).
  useEffect(() => {
    const total = Number(store.costEstimate?.total) || 0;
    if (!bausummeDirty && total > 0) setBausumme(Math.round(total));
  }, [store.costEstimate, bausummeDirty]);

  // Förderfähige Kosten ≈ 30 % der Bausumme als Konzept-Default [ASSUMED]
  // (energetisch relevanter Kostenanteil) — überschreibbar (Dirty-Flag).
  useEffect(() => {
    if (!kostenDirty && bausumme > 0) setKosten(Math.round(bausumme * 0.3));
  }, [bausumme, kostenDirty]);

  // Anträge des aktuellen Projekts laden (persistent, reload-fest).
  const reload = async (pid) => {
    if (!pid) { setAntraege([]); return; }
    try {
      const rows = await bitApi.entities.FoerderAntrag.filter({ project_id: pid });
      setAntraege(rows);
    } catch { setAntraege([]); }
  };
  useEffect(() => { reload(projectId); }, [projectId]);

  const createAntrag = async () => {
    if (!projectId) { toast.error("Kein Projekt gewählt"); return; }
    if (!form.titel.trim()) { toast.error("Titel angeben"); return; }
    const p = PROGRAMM_KATALOG[form.programm_key] || {};
    setBusy(true);
    try {
      await bitApi.entities.FoerderAntrag.create({
        project_id: projectId,
        programm_key: form.programm_key,
        titel: form.titel.trim(),
        foerderfaehige_kosten: Number(form.kosten) || 0,
        foerdersatz_pct: form.programm_key === "kunst_am_bau" ? kunstPctEffektiv : (p.satz_pct ?? 0),
        max_betrag: p.max_betrag ?? null,
        frist: form.frist || "",
        status: "geplant",
        notiz: "",
      });
      toast.success(`Antrag „${form.titel.trim()}" angelegt`);
      setForm(EMPTY_FORM);
      reload(projectId);
    } catch { toast.error("Anlegen fehlgeschlagen"); }
    setBusy(false);
  };

  // Update mit vollständigem Datensatz (PUT ersetzt), danach neu laden.
  const updateAntrag = async (a, patch) => {
    try {
      const { id, ...rest } = a;
      await bitApi.entities.FoerderAntrag.update(id, { ...rest, ...patch });
      reload(projectId);
    } catch { toast.error("Speichern fehlgeschlagen"); }
  };

  const deleteAntrag = async (id) => {
    try {
      await bitApi.entities.FoerderAntrag.delete(id);
      reload(projectId);
    } catch { toast.error("Löschen fehlgeschlagen"); }
  };

  // Katalog-Button: Card-C-Formular mit Programmwerten vorbelegen.
  const vorbelegen = (key) => {
    const p = PROGRAMM_KATALOG[key];
    setForm({
      titel: p.label,
      programm_key: key,
      kosten: key === "kunst_am_bau"
        ? Math.round(kunstAmBauBetrag(bausumme, kunstPctEffektiv))
        : kosten,
      frist: "",
    });
  };

  const kpi = useMemo(() => {
    const p = PROGRAMM_KATALOG[programmKey] || {};
    const schaetzung = foerderSchaetzung(kosten, p.satz_pct, p.max_betrag);
    const summe = antraege.reduce(
      (acc, a) => acc + foerderSchaetzung(a.foerderfaehige_kosten, a.foerdersatz_pct, a.max_betrag),
      0,
    );
    const checks = fundingChecks(antraege, { oeffentlich: oeffentlich === "ja", bausumme }, heute);
    return { schaetzung, summe, checks };
  }, [programmKey, kosten, antraege, oeffentlich, bausumme, heute]);

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Förderungen — Konzept-Übersicht, keine Förderrechts-/Rechtsberatung.</strong>{" "}
          Programme, Sätze, Deckel und Fristen sind überschreibbare Orientierungswerte für die
          Frühphase; verbindlich sind allein die aktuellen Programmbedingungen der Fördergeber
          (KfW, BAFA, Land, Kommune). Antragstellung und Nachweise über Energieeffizienz-
          Expert:in / Fördermittelberatung.
        </span>
      </div>

      {Number(store.costEstimate?.total) > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Kostenschätzung: Bausumme ≈ {eur(store.costEstimate.total)} (Näherung, überschreibbar)
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* Card A — Programmkatalog */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="w-4 h-4" /> Programmkatalog (Orientierungswerte)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(PROGRAMM_KATALOG).map(([key, p]) => (
                <div key={key} className="rounded-lg border p-2.5 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">{p.label}</span>
                    <Badge variant="outline" className="text-[10px]">{TYP_LABEL[p.typ] || p.typ}</Badge>
                    <span className="text-[11px] text-slate-400">{p.traeger}</span>
                    <Button
                      variant="outline" size="sm" className="ml-auto h-7 text-xs"
                      onClick={() => vorbelegen(key)}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Antrag anlegen
                    </Button>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Satz: {p.satz_pct === null ? "—" : `${p.satz_pct.toLocaleString("de-DE")} %`}
                    {" · "}Deckel: {p.max_betrag === null ? "ohne Deckel" : eur(p.max_betrag)}
                  </div>
                  <div className="text-[11px] text-slate-400">{p.hinweis}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Card A (Teil 2) — Kunst am Bau */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="w-4 h-4" /> Kunst am Bau (%-Regelung der Bausumme)
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Öffentlicher Bauherr</label>
                <Select value={oeffentlich} onValueChange={setOeffentlich}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <NumberField
                  label={`Kunst-am-Bau-Satz (${KUNST_PCT_MIN.toLocaleString("de-DE")}–${KUNST_PCT_MAX.toLocaleString("de-DE")})`}
                  value={kunstPctEffektiv} step={0.1} suffix="%" min={KUNST_PCT_MIN}
                  onChange={(v) => {
                    setKunstPct(Math.min(KUNST_PCT_MAX, Math.max(KUNST_PCT_MIN, Number(v) || KUNST_PCT_DEFAULT)));
                    setKunstPctDirty(true);
                  }}
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  {kunstVorschlag
                    ? (kunstPctDirty
                      ? `selbst gesetzt — Staffelsatz des Bundes wäre ${kunstVorschlag.pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} % (${kunstVorschlag.label})`
                      : `Staffelsatz des Bundes: ${kunstVorschlag.label} (BMWSB 07/2024) — überschreibbar`)
                    : "Bauwerkskosten erfassen, dann wird der Staffelsatz des Bundes vorgeschlagen"}
                </p>
              </div>
              <NumberField
                label="Bausumme" value={bausumme} step={10000} suffix="€" min={0}
                onChange={(v) => { setBausumme(v); setBausummeDirty(true); }}
              />
              <div className="col-span-2">
                <Stat label="Kunst-am-Bau-Betrag (Richtwert)" value={eur(kunstBetrag)} accent="text-violet-600" />
              </div>
              <div className="col-span-2 text-xs text-slate-500">
                Bei öffentlichen Bauvorhaben üblich (RBBau-Kontext) — Satz 0,5–2 % der Bausumme,
                Bausumme aus der Kostenschätzung vorbelegt.
              </div>
            </CardContent>
          </Card>

          {/* Card B — Fördersummen-Schätzung */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="w-4 h-4" /> Fördersummen-Schätzung
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField
                label="Förderfähige Kosten" value={kosten} step={5000} suffix="€" min={0}
                onChange={(v) => { setKosten(v); setKostenDirty(true); }}
              />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Programm</label>
                <Select value={programmKey} onValueChange={setProgrammKey}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROGRAMM_KATALOG).map(([k, p]) => (
                      <SelectItem key={k} value={k}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Stat label="Geschätzte Förderung (Richtwert)" value={eur(kpi.schaetzung)} accent="text-emerald-600" />
              <Stat label="Summe über alle Anträge (Richtwert)" value={eur(kpi.summe)} accent="text-teal-600" />
              <div className="col-span-2 text-xs text-slate-500">
                Förderfähige Kosten als Anteil der Bausumme vorbelegt (überschreibbar) —
                Schätzung = Kosten × Satz, gedeckelt auf den Maximalbetrag.
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Card C — Anträge (persistent je Projekt) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="w-4 h-4" /> Anträge ({de(antraege.length)})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Neuer Antrag */}
              <div className="rounded-lg border border-dashed p-3 grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-slate-500">Titel</label>
                  <Input
                    value={form.titel} placeholder="z. B. BEG-Zuschuss Gebäudehülle"
                    onChange={(e) => setForm((f) => ({ ...f, titel: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Programm</label>
                  <Select value={form.programm_key} onValueChange={(v) => setForm((f) => ({ ...f, programm_key: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PROGRAMM_KATALOG).map(([k, p]) => (
                        <SelectItem key={k} value={k}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <NumberField
                  label="Förderfähige Kosten" value={form.kosten} step={5000} suffix="€" min={0}
                  onChange={(v) => setForm((f) => ({ ...f, kosten: v }))}
                />
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Frist</label>
                  <Input
                    type="date" value={form.frist}
                    onChange={(e) => setForm((f) => ({ ...f, frist: e.target.value }))}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={createAntrag} disabled={busy || !projectId} className="w-full">
                    <Plus className="w-4 h-4 mr-1" /> Neuer Antrag
                  </Button>
                </div>
                {!projectId && (
                  <div className="col-span-2 text-xs text-slate-500">
                    Kein Projekt gewählt — Anträge werden je Projekt gespeichert.
                  </div>
                )}
              </div>

              {/* Antragsliste */}
              {antraege.length === 0 && (
                <div className="text-sm text-slate-500 text-center py-4">
                  Noch keine Anträge erfasst — über den Katalog oder das Formular anlegen.
                </div>
              )}
              {antraege.map((a) => {
                const p = PROGRAMM_KATALOG[a.programm_key];
                const foerderung = foerderSchaetzung(a.foerderfaehige_kosten, a.foerdersatz_pct, a.max_betrag);
                const fs = fristStatus(a.frist, heute);
                const fristBadge = FRIST_BADGE[fs];
                return (
                  <div key={a.id} className="rounded-lg border p-2.5 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800">{a.titel}</span>
                      <Badge variant="outline" className="text-[10px]">{p?.label || a.programm_key}</Badge>
                      <Badge className={`${ANTRAG_STATUS_BADGE[a.status] || ANTRAG_STATUS_BADGE.geplant} text-[10px]`}>
                        {ANTRAG_STATUS[a.status] || a.status}
                      </Badge>
                      {fristBadge && (
                        <Badge className={`${fristBadge.className} text-[10px]`}>{fristBadge.label}</Badge>
                      )}
                      <Button
                        variant="ghost" size="icon" aria-label="Antrag löschen"
                        className="ml-auto h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                        onClick={() => deleteAntrag(a.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Kosten: {eur(a.foerderfaehige_kosten)} · Förderung (Richtwert): {eur(foerderung)}
                      {" · "}Frist: {deDate(a.frist)}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-500">Status</label>
                        <Select value={a.status || "geplant"} onValueChange={(v) => updateAntrag(a, { status: v })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(ANTRAG_STATUS).map(([k, label]) => (
                              <SelectItem key={k} value={k}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-500">Frist</label>
                        {/* ME-05: Commit erst bei onBlur — onChange feuert bei Datums-
                            Segmenteingabe (TT/MM/JJJJ) sonst pro Tastendruck PUT+Reload. */}
                        <Input
                          type="date" className="h-8"
                          key={`${a.id}-frist-${a.frist || ""}`}
                          defaultValue={a.frist || ""}
                          onBlur={(e) => {
                            if ((e.target.value || "") !== (a.frist || "")) updateAntrag(a, { frist: e.target.value });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Checkliste — nur pass/warn, nie fail */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Gauge className="w-4 h-4" /> Plausibilität (Konzept)</span>
                <Badge className={STATUS_STYLE[kpi.checks.warns > 0 ? "warn" : "pass"].color}>{kpi.checks.verdict}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {kpi.checks.items.map((it) => {
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
              <div className="text-xs text-slate-500 border-t pt-2">
                Hinweise sind Konzept-Plausibilität, kein Förderrechts-Nachweis — verbindlich sind
                allein die Programmbedingungen der Fördergeber.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
