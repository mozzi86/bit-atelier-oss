import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Badge } from "@core/components/ui/badge";
import { Textarea } from "@core/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { AlertTriangle, Info, Minus, Plus, Save, Trash2, X } from "lucide-react";
// EIN Selektor-Schema, EINE Achsen-UI — aus @core, damit es keine zweite gibt.
import SelektorEditor from "@core/components/rules/SelektorEditor";
import TrefferListe from "@core/components/rules/TrefferListe";
import { validiereReferenzen } from "@core/lib/rules/catalogs";
import { buildIndex } from "@core/lib/rules/ruleEngine";
import { ARTEN, positionsMenge, musterAusRegel } from "@ava/lib/mengenregeln";

// RegelEditor — Mengenregeln einer LV-Position anlegen und ändern.
//
// Das ist die Oberfläche des Produktziels: eine neue Mengenregel entsteht HIER,
// ohne dass jemand Code anfasst. Alles, was die Regel ausmacht, ist ein Feld:
// Selektor, Mengenbasis, Faktor, art, op.
//
// Fünf Entscheidungen, die bewusst so sind:
//
//  1. **`mengenbasis` ist ein Auswahlfeld aus dem Katalog — kein Freitext.**
//     Ein getippter Größenname („NetSideAra") ergibt eine stille 0,00 (Pitfall 13).
//     Wo eine Liste existiert, gibt es kein Eingabefeld.
//  2. **`faktor` ≠ 1 verlangt `faktor_grund` als Pflichttext.** Ein Faktor 2 ohne
//     Begründung ist in einem halben Jahr nicht mehr erklärbar — und er verdoppelt
//     Geld. Gespeichert wird erst mit Grund.
//  3. **`soll` heißt „Vergleichsmenge Vor-Export", nicht „Sollwert" (A5).** Es ist
//     ein Regressionsanker gegen den letzten belegten Stand, keine Vorgabe, die
//     erreicht werden müsste. Die Beschriftung sagt das, damit niemand die
//     Modellmenge an die Vergleichsmenge „anpasst".
//  4. **Σadd − Σsub steht als Formel am Bildschirm.** Wer einen Abzug anlegt, soll
//     sehen, was rechnerisch passiert, statt es sich zu denken.
//  5. **Gespeichert wird erst nach `validiereReferenzen` UND Muster-Validierung.**
//     Fehler stehen am FELD.
const OP_LABEL = { add: "hinzurechnen (add)", sub: "abziehen (sub)" };
const ART_KLARTEXT = {
  modell: "Menge kommt aus dem Modell — sie läuft mit jedem neuen Bauteilstand nach.",
  uebernahme: "Menge ist aus einem belegten LV-Stand übernommen und EINGEFROREN — das Modell ändert sie nicht.",
  pauschal: "Pauschalposition — es gibt kein Bauteil, das die Menge trägt (Begründung als Ausschlussgrund).",
  einzel: "Feste GUID-Liste (Altbestand) — nur lesen, hier entsteht nichts Neues.",
};

const leereRegel = (r) => ({
  id: r?.id,
  art: r?.art || "modell",
  op: r?.op || "add",
  selektor:
    r?.selektor || {
      was: { kg: [], gewerk: [], schicht: [], ifc_klasse: [] },
      zustand: { status: [] },
      muster: {},
      bereich: { qty: [] },
    },
  mengenbasis: r?.mengenbasis ?? null,
  faktor: r?.faktor ?? 1,
  faktor_grund: r?.faktor_grund ?? "",
  einheit: r?.einheit ?? null,
  soll: r?.soll ?? null,
  soll_quelle: r?.soll_quelle ?? "",
  soll_stand: r?.soll_stand ?? "",
  uebernahme: r?.uebernahme ?? { menge: null, quelle: "", stand: "" },
  pauschal: r?.pauschal ?? { menge: null, begruendung: "" },
  ausschluss_grund: r?.ausschluss_grund ?? null,
  ausschluss_text: r?.ausschluss_text ?? "",
  confidence: r?.confidence ?? null,
  muster_ref: r?.muster_ref ?? null,
  zulage_zu: r?.zulage_zu ?? null,
  modell_geprueft_am: r?.modell_geprueft_am ?? null,
});

export default function RegelEditor({
  position,
  regeln = [],
  elemente = [],
  kataloge = {},
  snapshotId = null,
  onSpeichern,
  onLoeschen,
  onMusterSpeichern,
  onSchliessen,
}) {
  const [entwurf, setEntwurf] = useState(null);
  const [fehler, setFehler] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setEntwurf(null); setFehler([]); }, [position?.id]);

  const index = useMemo(() => buildIndex(elemente || []), [elemente]);
  const mengenbasisOptionen = useMemo(
    () => (kataloge.MengenbasisKatalog || []).map((r) => ({ key: r.key, einheit: r.einheit, dimension: r.dimension })),
    [kataloge.MengenbasisKatalog],
  );
  const einheitOptionen = useMemo(
    () => (kataloge.EinheitenKatalog || []).map((r) => r.code),
    [kataloge.EinheitenKatalog],
  );
  const gruende = useMemo(() => kataloge.AusschlussGrund || [], [kataloge.AusschlussGrund]);

  // Σadd − Σsub live, inklusive des Entwurfs.
  const vorschau = useMemo(() => {
    const liste = entwurf
      ? [...regeln.filter((r) => r.id !== entwurf.id), entwurf]
      : regeln;
    return positionsMenge(liste, index);
  }, [regeln, entwurf, index]);

  const set = (patch) => setEntwurf((d) => ({ ...d, ...patch }));
  const feldFehler = (feld) => fehler.find((f) => f.feld === feld) || null;

  const speichern = async () => {
    // Referenzvalidierung UND Muster-Validierung — vor dem Speichern, nicht danach.
    const pruefung = validiereReferenzen(entwurf, kataloge);
    const fehlerListe = [...pruefung.fehler];
    const probe = positionsMenge([entwurf], index);
    for (const w of probe.warnungen) {
      if (/abgewiesen/.test(w)) fehlerListe.push({ feld: "selektor.muster", text: w });
    }
    setFehler(fehlerListe);
    if (fehlerListe.length > 0) return;
    setBusy(true);
    try {
      await onSpeichern?.({ ...entwurf, faktor_grund: entwurf.faktor_grund || null }, { snapshotId });
      setEntwurf(null);
    } finally {
      setBusy(false);
    }
  };

  const alsMuster = async () => {
    const name = entwurf?.name || position?.title || "Muster";
    await onMusterSpeichern?.(
      musterAusRegel(entwurf, {
        name,
        einheit: entwurf?.einheit ?? position?.unit ?? null,
        herkunft: { projekt_nr: position?.project_id ?? null, quelle_oz: position?.oz ?? null },
      }),
    );
  };

  if (!position) {
    return (
      <Card className="border-slate-200">
        <CardContent className="py-6 text-sm text-slate-500">
          Position in der Tabelle wählen, um ihre Mengenregeln zu bearbeiten.
        </CardContent>
      </Card>
    );
  }

  const basisInfo = mengenbasisOptionen.find((o) => o.key === entwurf?.mengenbasis) || null;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>
            Mengenregeln · {position.oz} {position.title && <span className="text-slate-500 font-normal">{position.title}</span>}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs border-slate-300 text-slate-600">
              Σadd {vorschau.add} − Σsub {vorschau.sub} = <strong className="ml-1">{vorschau.menge}</strong>{" "}
              {position.unit || ""}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => setEntwurf(leereRegel(null))}>
              <Plus className="w-3 h-3 mr-1" /> Regel
            </Button>
            {onSchliessen && (
              <button type="button" onClick={onSchliessen} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            <strong>Menge der Position = Σ „hinzurechnen" − Σ „abziehen".</strong> Jede Regel
            steht für sich; die Position ist ihre Summe. Ohne gewählten Bauteilstand wird
            nichts gerechnet.
          </span>
        </p>

        {/* --- Bestehende Regeln ------------------------------------------- */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="px-2 py-1">op</th>
                <th className="px-2 py-1">art</th>
                <th className="px-2 py-1">Mengenbasis</th>
                <th className="px-2 py-1 text-right">Faktor</th>
                <th className="px-2 py-1 text-right">Treffer</th>
                <th className="px-2 py-1 text-right">Menge</th>
                <th className="px-2 py-1">Hinweise</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {regeln.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-slate-400">
                    Diese Position hat noch keine Regel — die Menge ist damit nicht ermittelt
                    (nicht „0").
                  </td>
                </tr>
              )}
              {regeln.map((r, i) => {
                const res = vorschau.regeln[i] || {};
                return (
                  <tr key={r.id ?? i} className="border-b border-slate-100">
                    <td className="px-2 py-1">
                      {r.op === "sub" ? (
                        <Minus className="w-3 h-3 text-red-500" />
                      ) : (
                        <Plus className="w-3 h-3 text-emerald-600" />
                      )}
                    </td>
                    <td className="px-2 py-1">{r.art}</td>
                    <td className="px-2 py-1">{r.mengenbasis ?? "—"}</td>
                    <td className="px-2 py-1 text-right">
                      {r.faktor ?? 1}
                      {r.faktor != null && r.faktor !== 1 && (
                        <span className="ml-1 text-[10px] text-slate-400" title={r.faktor_grund || ""}>
                          ⓘ
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{res.treffer ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{res.menge ?? "—"}</td>
                    <td className="px-2 py-1 text-amber-700">
                      {(res.warnungen || []).length > 0 ? `${res.warnungen.length} Warnung(en)` : "—"}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <button type="button" className="text-emerald-700 hover:underline" onClick={() => { setFehler([]); setEntwurf(leereRegel(r)); }}>
                        ändern
                      </button>
                      {onLoeschen && (
                        <button type="button" className="ml-2 text-slate-400 hover:text-red-600" onClick={() => onLoeschen(r)}>
                          <Trash2 className="w-3 h-3 inline" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* --- Formular ---------------------------------------------------- */}
        {entwurf && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Wirkung</Label>
                <Select value={entwurf.op} onValueChange={(v) => set({ op: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(OP_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Art der Mengenermittlung</Label>
                <Select value={entwurf.art} onValueChange={(v) => set({ art: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ARTEN.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500">{ART_KLARTEXT[entwurf.art]}</p>
              </div>

              {/* Mengenbasis: AUSWAHL aus dem Katalog. Kein Eingabefeld. */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Mengenbasis (aus MengenbasisKatalog)</Label>
                <Select value={entwurf.mengenbasis ?? ""} onValueChange={(v) => set({ mengenbasis: v })}>
                  <SelectTrigger className={`h-8 text-xs ${feldFehler("mengenbasis") ? "border-red-400" : ""}`}>
                    <SelectValue placeholder="wählen" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {mengenbasisOptionen.map((o) => (
                      <SelectItem key={o.key} value={o.key}>{o.key} · {o.einheit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {basisInfo && (
                  <p className="text-[10px] text-slate-500">
                    Dimension {basisInfo.dimension} · Katalog-Einheit {basisInfo.einheit}
                  </p>
                )}
                {feldFehler("mengenbasis") && (
                  <p className="text-[11px] text-red-600 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {feldFehler("mengenbasis").text}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Einheit (aus EinheitenKatalog)</Label>
                <Select value={entwurf.einheit ?? ""} onValueChange={(v) => set({ einheit: v })}>
                  <SelectTrigger className={`h-8 text-xs ${feldFehler("einheit") ? "border-red-400" : ""}`}>
                    <SelectValue placeholder="wählen" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {einheitOptionen.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* --- Faktor + PFLICHTGRUND ----------------------------------- */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Faktor</Label>
                <Input
                  type="number" step="any"
                  className={`h-8 text-xs ${feldFehler("faktor") ? "border-red-400" : ""}`}
                  value={entwurf.faktor ?? ""}
                  onChange={(e) => set({ faktor: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs text-slate-500">
                  Grund für den Faktor{" "}
                  {entwurf.faktor !== 1 && <span className="text-red-600">(Pflicht bei Faktor ≠ 1)</span>}
                </Label>
                <Input
                  className={`h-8 text-xs ${feldFehler("faktor_grund") ? "border-red-400" : ""}`}
                  placeholder="z. B. beidseitige Beschichtung der Trockenbauwand"
                  value={entwurf.faktor_grund ?? ""}
                  onChange={(e) => set({ faktor_grund: e.target.value })}
                />
                {feldFehler("faktor_grund") && (
                  <p className="text-[11px] text-red-600 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {feldFehler("faktor_grund").text}
                  </p>
                )}
              </div>
            </div>

            {/* --- art-spezifische Formulare ------------------------------- */}
            {entwurf.art === "uebernahme" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">übernommene Menge</Label>
                  <Input
                    type="number" step="any" className="h-8 text-xs"
                    value={entwurf.uebernahme?.menge ?? ""}
                    onChange={(e) => set({ uebernahme: { ...entwurf.uebernahme, menge: e.target.value === "" ? null : Number(e.target.value) } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Quelle (Beleg)</Label>
                  <Input
                    className="h-8 text-xs" placeholder="LV D83 14.01.2020"
                    value={entwurf.uebernahme?.quelle ?? ""}
                    onChange={(e) => set({ uebernahme: { ...entwurf.uebernahme, quelle: e.target.value } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Stand</Label>
                  <Input
                    type="date" className="h-8 text-xs"
                    value={entwurf.uebernahme?.stand ?? ""}
                    onChange={(e) => set({ uebernahme: { ...entwurf.uebernahme, stand: e.target.value } })}
                  />
                </div>
              </div>
            )}

            {entwurf.art === "pauschal" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Pauschalmenge</Label>
                  <Input
                    type="number" step="any" className="h-8 text-xs"
                    value={entwurf.pauschal?.menge ?? ""}
                    onChange={(e) => set({ pauschal: { ...entwurf.pauschal, menge: e.target.value === "" ? null : Number(e.target.value) } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Begründung</Label>
                  <Input
                    className="h-8 text-xs"
                    value={entwurf.pauschal?.begruendung ?? ""}
                    onChange={(e) => set({ pauschal: { ...entwurf.pauschal, begruendung: e.target.value } })}
                  />
                </div>
              </div>
            )}

            {/* --- Ausschlussgrund ---------------------------------------- */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">
                  Ausschlussgrund (warum trägt kein Bauteil die Menge?)
                </Label>
                <Select value={entwurf.ausschluss_grund ?? ""} onValueChange={(v) => set({ ausschluss_grund: v })}>
                  <SelectTrigger className={`h-8 text-xs ${feldFehler("ausschluss_grund") ? "border-red-400" : ""}`}>
                    <SelectValue placeholder="kein Ausschluss" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {gruende.map((g) => (
                      <SelectItem key={g.code} value={g.code}>
                        {g.name}{g.text_pflicht ? " (Begründung nötig)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Begründung im Klartext</Label>
                <Input
                  className={`h-8 text-xs ${feldFehler("ausschluss_text") ? "border-red-400" : ""}`}
                  value={entwurf.ausschluss_text ?? ""}
                  onChange={(e) => set({ ausschluss_text: e.target.value })}
                />
                {feldFehler("ausschluss_text") && (
                  <p className="text-[11px] text-red-600">{feldFehler("ausschluss_text").text}</p>
                )}
              </div>
            </div>

            {/* --- soll: Vergleichsmenge, KEIN Sollwert (A5) --------------- */}
            <div className="rounded-md border border-slate-200 bg-white p-2 space-y-2">
              <p className="text-[11px] text-slate-600">
                <strong>Vergleichsmenge Vor-Export — kein Sollwert.</strong> Der Wert ist ein
                Regressionsanker gegen den letzten belegten Stand. Weicht die Modellmenge ab,
                ist das eine <em>Ampel</em> („das Modell hat sich geändert"), kein Fehler — und
                erst recht keine Aufforderung, die Modellmenge anzupassen.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Vergleichsmenge</Label>
                  <Input
                    type="number" step="any" className="h-8 text-xs"
                    value={entwurf.soll ?? ""}
                    onChange={(e) => set({ soll: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Quelle</Label>
                  <Input className="h-8 text-xs" value={entwurf.soll_quelle ?? ""} onChange={(e) => set({ soll_quelle: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Stand</Label>
                  <Input type="date" className="h-8 text-xs" value={entwurf.soll_stand ?? ""} onChange={(e) => set({ soll_stand: e.target.value })} />
                </div>
              </div>
            </div>

            {/* --- Selektor + Live-Treffer -------------------------------- */}
            {(entwurf.art === "modell" || entwurf.art === "einzel") && (
              <div className="grid gap-4 lg:grid-cols-2">
                <SelektorEditor
                  selektor={entwurf.selektor}
                  onChange={(s) => set({ selektor: s })}
                  kataloge={kataloge}
                  elemente={elemente}
                />
                <div className="space-y-2">
                  <Label className="text-xs text-slate-500">Live-Treffer im aktiven Bauteilstand</Label>
                  {!snapshotId && (
                    <p className="text-[11px] text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      Kein Bauteilstand gewählt — die Vorschau rechnet gegen die geladene
                      Elementliste, gespeichert wird ohne Snapshot-Bezug kein Lauf.
                    </p>
                  )}
                  <TrefferListe
                    selektor={entwurf.selektor}
                    mengenbasis={entwurf.mengenbasis}
                    faktor={entwurf.faktor ?? 1}
                    elemente={elemente}
                    index={index}
                  />
                  {feldFehler("selektor.muster") && (
                    <p className="text-[11px] text-red-600 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {feldFehler("selektor.muster").text}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* --- Konfidenz + Zulage ------------------------------------- */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Konfidenz (Selbsteinschätzung)</Label>
                <Select value={entwurf.confidence ?? ""} onValueChange={(v) => set({ confidence: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="nicht angegeben" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hoch">hoch</SelectItem>
                    <SelectItem value="mittel">mittel</SelectItem>
                    <SelectItem value="niedrig">niedrig</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">
                  Zulage / Folgeleistung zu Position(en) — kommagetrennt
                </Label>
                <Textarea
                  rows={1} className="text-xs"
                  placeholder="001/01010010, 001/01010020"
                  value={Array.isArray(entwurf.zulage_zu) ? entwurf.zulage_zu.join(", ") : entwurf.zulage_zu ?? ""}
                  onChange={(e) => {
                    const teile = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    set({ zulage_zu: teile.length === 0 ? null : teile });
                  }}
                />
                <p className="text-[10px] text-slate-400">
                  Erklärt dem Mehrfachnutzungs-Report, dass dieselben Bauteile hier legitim
                  ein zweites Mal mengenwirksam sind.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={speichern} disabled={busy}>
                <Save className="w-3 h-3 mr-1" /> Speichern &amp; nachrechnen
              </Button>
              {onMusterSpeichern && (
                <Button size="sm" variant="outline" onClick={alsMuster} disabled={busy}>
                  als Muster speichern (büroweit)
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setEntwurf(null); setFehler([]); }}>
                Abbrechen
              </Button>
              {fehler.length > 0 && (
                <span className="text-[11px] text-red-600">
                  {fehler.length} Fehler — Speichern abgewiesen
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
