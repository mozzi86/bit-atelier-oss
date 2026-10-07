// LieferpaketKarte.jsx — Karte „Lieferung" in der Prüf-Suite (71-03).
//
// Aus Prüfung wird Lieferung: Modelllieferplan mit Soll/Ist-Ampel,
// Dateinamen-Baukasten nach der Namenskonvention mit Prüfung, und „Lieferpaket
// erzeugen" — ein ZIP mit geprüftem IFC (konventionsgerechter Name), Prüfbericht (PDF),
// BCF der Befunde, Übergabeprotokoll und Manifest (SHA-256 je Datei).
//
// Persistenz: exklusives BimModel-Feld `lieferung_layer` über loadBimModel/
// saveBimModel (Registry useFachlayer.js) — Guards NACHGEBILDET wie in
// BcfIssues.jsx (loadingRef, lastSaved, Debounce 1,2 s, Flush bei Unmount/
// Projektwechsel), weil useFachlayer in @designer liegt.
//
// Stufe A: das gelieferte IFC ist der GELADENE Puffer (modell.buffer) — hier
// wird kein IFC neu geschrieben. Das steht im Protokoll unter „Herkunft".
//
// In (props): projectId, projekt {name, client}, modell {fileName, buffer,
//   parsed, geo, quelle}, ergebnis (Prüflauf), reportRef (Druckvorlage),
//   briefkopf, baueBcf() → Uint8Array|null, onLieferInfo(info) → der
//   Prüfbericht zieht daraus seinen Abschnitt „Lieferung".
// Out: UI; Seiteneffekte: lieferung_layer, ZIP-Download, Ablage „Nachweis".

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Package, Plus, Trash2, Loader2, CalendarClock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import { useI18n } from "@core/lib/i18n";
import { exportElementToPdf } from "@core/lib/pdf";
import { dokumentAblegen, pfadText } from "@core/lib/ablage";
import { KATALOG, baueDateiname, pruefeDateiname, naechsterIndex, gebaeudeGueltig } from "@ifc/lib/dateiname";
import {
  leeresLieferungLayer, normalisiereLayer, lieferungAnlegen, lieferungAendern, lieferungLoeschen,
  markiereGeliefert, planVorlage, sollIst, naechsteLieferung, protokollText, isoTag, datumText,
  LOG_STUFEN, LIEFER_STATUS, STATUS_TEXT,
} from "@ifc/lib/lieferplan";
import { baueLieferpaket, paketNamen } from "@ifc/lib/lieferpaket";

const AMPEL = {
  gruen: "bg-emerald-100 text-emerald-700 border-emerald-200",
  gelb: "bg-amber-100 text-amber-700 border-amber-200",
  rot: "bg-rose-100 text-rose-700 border-rose-200",
  grau: "bg-slate-100 text-slate-500 border-slate-200",
};

const selectKlasse = "h-8 rounded-md border border-slate-200 bg-white px-2 text-xs";

function downloadBytes(bytes, filename, mime = "application/zip") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Bauteile je IFC-Klasse aus den Geometrie-Elementen (Fallback: Semantik). */
export function klassenZaehlung(modell) {
  const liste = modell?.geo?.elemente?.length ? modell.geo.elemente : (modell?.parsed?.elements || []);
  const out = /** @type {Record<string, number>} */ ({});
  for (const el of liste) {
    const k = String(el?.ifcType || "?").toUpperCase();
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * @param {{projectId?: string|null, projekt?: {name?: string, client?: string},
 *   modell?: object|null, ergebnis?: object|null, reportRef?: {current: HTMLElement|null},
 *   briefkopf?: {office?: string}, baueBcf?: () => Uint8Array|null,
 *   onLieferInfo?: (info: object|null) => void}} props
 */
export default function LieferpaketKarte({
  projectId, projekt = {}, modell = null, ergebnis = null, reportRef = null, briefkopf = {},
  baueBcf = () => null, onLieferInfo = () => {},
}) {
  const { t } = useI18n();

  // --- Layer-State mit Fachlayer-Guards (wie BcfIssues) -----------------------
  const [layer, setLayer] = useState(() => leeresLieferungLayer());
  const loadingRef = useRef(false);
  const lastSaved = useRef(JSON.stringify(leeresLieferungLayer()));
  const pendingRef = useRef(null);

  const setUser = useCallback((v) => {
    if (loadingRef.current) return;
    setLayer(typeof v === "function" ? (prev) => normalisiereLayer(v(prev)) : normalisiereLayer(v));
  }, []);

  useEffect(() => {
    const pend = pendingRef.current;
    if (pend && pend.pid !== projectId) {
      pendingRef.current = null;
      if (JSON.stringify(pend.state) !== lastSaved.current) {
        saveBimModel(pend.pid, { lieferung_layer: pend.state }).catch(() => {});
      }
    }
    if (!projectId) {
      setLayer(leeresLieferungLayer());
      lastSaved.current = JSON.stringify(leeresLieferungLayer());
      return undefined;
    }
    let cancelled = false;
    loadingRef.current = true;
    setLayer(leeresLieferungLayer());
    lastSaved.current = JSON.stringify(leeresLieferungLayer());
    (async () => {
      try {
        const m = await loadBimModel(projectId);
        if (cancelled) return;
        const val = normalisiereLayer(m && m.lieferung_layer != null ? m.lieferung_layer : null);
        lastSaved.current = JSON.stringify(val);
        setLayer(val);
      } catch {
        /* offline: Default bleibt */
      } finally {
        loadingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || loadingRef.current) return undefined;
    const sig = JSON.stringify(layer);
    if (sig === lastSaved.current) return undefined;
    pendingRef.current = { pid: projectId, state: layer };
    const timer = setTimeout(() => {
      lastSaved.current = sig;
      pendingRef.current = null;
      saveBimModel(projectId, { lieferung_layer: layer }).catch(() => {
        pendingRef.current = { pid: projectId, state: layer };
        lastSaved.current = "";
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [layer, projectId]);

  useEffect(() => () => {
    const pend = pendingRef.current;
    if (pend && JSON.stringify(pend.state) !== lastSaved.current) {
      saveBimModel(pend.pid, { lieferung_layer: pend.state }).catch(() => {});
    }
  }, []);

  // --- Lieferplan ---------------------------------------------------------------
  const heute = isoTag(new Date());
  const zeilen = useMemo(() => sollIst(layer, heute), [layer, heute]);
  const [gewaehltId, setGewaehltId] = useState(null);
  const gewaehlt = useMemo(
    () => zeilen.find((l) => l.id === gewaehltId) || naechsteLieferung(layer, heute) || null,
    [zeilen, gewaehltId, layer, heute],
  );
  const [beauftragung, setBeauftragung] = useState("");

  const anlegen = () => {
    const { layer: neu, lieferung } = lieferungAnlegen(layer, { termin: heute, log: 300 });
    setUser(neu);
    setGewaehltId(lieferung.id);
  };
  const aendern = (id, patch) => setUser((prev) => lieferungAendern(prev, id, patch));
  const loeschen = (id) => setUser((prev) => lieferungLoeschen(prev, id));
  const vorlage = () => {
    if (!beauftragung) { toast.info(t("Bitte zuerst das Beauftragungsdatum eintragen.")); return; }
    setUser((prev) => planVorlage(prev, { beauftragung }));
  };

  // --- Dateinamen-Baukasten -----------------------------------------------------
  const originalPruefung = useMemo(() => (modell?.fileName ? pruefeDateiname(modell.fileName) : null), [modell]);
  const [teile, setTeile] = useState(() => ({
    phase: "P5", gebaeude: KATALOG.gebaeude[0].wert, modellart: "FM", ebene: "XX", status: "P", freitext: "",
  }));
  // Vorbelegung aus der geladenen Datei, wenn sie der Konvention folgt.
  useEffect(() => {
    const tl = originalPruefung?.teile;
    if (!tl) return;
    setTeile((prev) => ({
      ...prev,
      phase: KATALOG.phasen.some((p) => p.wert === tl.phase) ? tl.phase : prev.phase,
      gebaeude: gebaeudeGueltig(tl.gebaeude) ? tl.gebaeude : prev.gebaeude,
      modellart: KATALOG.modellarten.some((m) => m.wert === tl.modellart) ? tl.modellart : prev.modellart,
      ebene: KATALOG.ebenen.some((e) => e.wert === tl.ebene) ? tl.ebene : prev.ebene,
    }));
  }, [originalPruefung]);

  const bekannteNamen = useMemo(
    () => [...layer.lieferungen.map((l) => l.dateiname).filter(Boolean), modell?.fileName].filter(Boolean),
    [layer, modell],
  );
  const kombi = useMemo(() => ({ ...teile, fachsicht: layer.fachsicht }), [teile, layer.fachsicht]);
  const index = useMemo(() => naechsterIndex(bekannteNamen, kombi), [bekannteNamen, kombi]);
  const dateiname = useMemo(() => {
    try { return { name: baueDateiname({ ...kombi, index }), fehler: null }; } catch (e) { return { name: null, fehler: e.message }; }
  }, [kombi, index]);
  const namePruefung = useMemo(() => (dateiname.name ? pruefeDateiname(dateiname.name) : null), [dateiname]);

  // Der Prüfbericht zieht seinen Abschnitt „Lieferung" hieraus.
  useEffect(() => {
    onLieferInfo({
      lieferung: gewaehlt,
      dateiname: dateiname.name,
      fachsicht: layer.fachsicht,
      herkunft: t("geladene Datei, kein Neu-Export (Stufe A)"),
      warnungen: [...(originalPruefung?.warnungen || []), ...(namePruefung?.warnungen || [])],
    });
  }, [gewaehlt, dateiname, layer.fachsicht, originalPruefung, namePruefung, onLieferInfo, t]);

  // --- Paket erzeugen ---------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [letztesPaket, setLetztesPaket] = useState(null);
  const paketMoeglich = Boolean(ergebnis && modell?.buffer && dateiname.name && gewaehlt);

  const paketErzeugen = async () => {
    if (!paketMoeglich) return;
    setBusy(true);
    try {
      const erzeugt = new Date();
      const namen = paketNamen(dateiname.name);
      // 1) PDF-Bytes aus der Druckvorlage (kein Download, keine Ablage — das Paket ist der Nachweis).
      let pdf = null;
      try {
        const r = reportRef?.current ? await exportElementToPdf(reportRef.current, namen.pdf, { alsBytes: true }) : null;
        pdf = r?.bytes || null;
      } catch (err) {
        console.error("Prüfbericht für das Paket fehlgeschlagen:", err);
      }
      // 2) BCF der Befunde (null = keine Befunde).
      let bcf = null;
      try { bcf = baueBcf(); } catch (err) { console.error("BCF für das Paket fehlgeschlagen:", err); }
      // 3) Protokoll — bekommt die Hashes der Nutzdaten (T-71-10).
      const c = ergebnis.clash || {};
      const ko = ergebnis.koordination;
      const protokoll = (hashes) => protokollText({
        projekt: { name: projekt?.name, bauherr: projekt?.client },
        lieferung: { ...gewaehlt, datum_ist: isoTag(erzeugt) },
        modell: {
          dateiname: dateiname.name,
          dateinameOriginal: modell.fileName,
          schema: modell.parsed?.schema,
          geschosse: modell.parsed?.storeys,
          klassen: klassenZaehlung(modell),
          bytes: modell.buffer.byteLength,
        },
        pruefung: {
          ids: { bestanden: (ergebnis.ids || []).filter((r) => r.bestanden).length, verletzt: (ergebnis.ids || []).filter((r) => !r.bestanden).length },
          clash: { befunde: (c.clashes || []).length, geprueft: c.geprueft, uebersprungen: c.uebersprungen },
          koordination: ko ? { bestanden: ko.bestanden, maxMm: ko.maxMm, grund: ko.grund } : null,
          warnungen: [...(originalPruefung?.warnungen || []), ...(namePruefung?.warnungen || [])],
        },
        herkunft: t("geladene Datei, kein Neu-Export (Stufe A)"),
        pruefer: briefkopf?.office || "BIT-Atelier",
        erzeugt,
        hashes,
      });
      const { zip, manifest } = await baueLieferpaket({
        dateiname: dateiname.name, ifc: modell.buffer, pdf, bcf, erzeugt, protokollErgaenzen: protokoll,
      });
      downloadBytes(zip, namen.zip);
      setUser((prev) => markiereGeliefert(prev, gewaehlt.id, { dateiname: dateiname.name, datum_ist: isoTag(erzeugt) }));
      setLetztesPaket({ zip: namen.zip, dateien: manifest.dateien.length + 1, hinweise: manifest.hinweise }); // +1 = manifest.json
      let ablageText = "";
      if (projectId) {
        const r = await dokumentAblegen({ projectId, name: namen.zip, typ: "Nachweis", notiz: `Lieferpaket Nr. ${gewaehlt.nr} — ${dateiname.name}` });
        if (r.ok) ablageText = ` · ${t("abgelegt")}: ${pfadText(r.pfad)}`;
      }
      toast.success(`${t("Lieferpaket erzeugt")}: ${namen.zip} (${manifest.dateien.length + 1} ${t("Dateien")})${ablageText}`);
    } catch (err) {
      console.error("Lieferpaket fehlgeschlagen:", err);
      toast.error(`${t("Lieferpaket fehlgeschlagen")}: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm rounded-xl" data-testid="lieferpaket-karte">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="w-4 h-4 text-emerald-600" /> {t("Lieferung & Modelllieferplan")}
        </CardTitle>
        <p className="text-xs text-slate-500">
          {t("Aus dem Prüflauf entsteht das Lieferpaket: IFC unter Richtlinien-Namen, Prüfbericht, BCF, Übergabeprotokoll, Manifest mit SHA-256.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Fachsicht */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-600">{t("Fachsicht")}</span>
            <select
              className={selectKlasse}
              value={layer.fachsicht}
              onChange={(e) => setUser((prev) => ({ ...prev, fachsicht: e.target.value }))}
              data-testid="fachsicht"
            >
              {KATALOG.fachsichten.map((f) => <option key={f.wert} value={f.wert}>{f.wert} — {f.text}</option>)}
            </select>
          </label>
          <span className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {t("Im LV nicht festgelegt (TX oder TS) — mit dem Generalplaner abstimmen.")}
          </span>
        </div>

        {/* Lieferplan */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4" /> {t("Modelllieferplan")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date" value={beauftragung} onChange={(e) => setBeauftragung(e.target.value)}
                className="h-8 w-40 text-xs" aria-label={t("Beauftragung")} data-testid="beauftragung"
              />
              <Button type="button" variant="outline" size="sm" onClick={vorlage} className="gap-1">
                {t("Vorlage nach LV")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={anlegen} className="gap-1" data-testid="lieferung-anlegen">
                <Plus className="w-3.5 h-3.5" /> {t("Lieferung anlegen")}
              </Button>
            </div>
          </div>
          {zeilen.length === 0 ? (
            <p className="text-xs text-slate-400">{t("Noch keine Lieferung geplant — „Vorlage nach LV“ erzeugt LoG 300 vier Wochen nach Beauftragung.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="lieferplan">
                <thead>
                  <tr className="text-left text-slate-400 border-b">
                    <th className="py-1 pr-2" />
                    <th className="py-1 pr-2">Nr.</th>
                    <th className="py-1 pr-2">{t("Termin")}</th>
                    <th className="py-1 pr-2">{t("Bauabschnitt")}</th>
                    <th className="py-1 pr-2">LoG</th>
                    <th className="py-1 pr-2">{t("Status")}</th>
                    <th className="py-1 pr-2">{t("Soll/Ist")}</th>
                    <th className="py-1 pr-2">{t("Dateiname")}</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {zeilen.map((l) => (
                    <tr key={l.id} className={`border-b border-slate-100 ${gewaehlt?.id === l.id ? "bg-emerald-50/60" : ""}`} data-testid={`lieferung-${l.nr}`}>
                      <td className="py-1 pr-2">
                        <input type="radio" name="lieferung" checked={gewaehlt?.id === l.id} onChange={() => setGewaehltId(l.id)} aria-label={`Lieferung ${l.nr} wählen`} />
                      </td>
                      <td className="py-1 pr-2 font-medium">{l.nr}</td>
                      <td className="py-1 pr-2">
                        <Input type="date" value={l.termin || ""} onChange={(e) => aendern(l.id, { termin: e.target.value || null })} className="h-7 w-36 text-xs" />
                      </td>
                      <td className="py-1 pr-2">
                        <Input value={l.bauabschnitt} onChange={(e) => aendern(l.id, { bauabschnitt: e.target.value })} className="h-7 w-32 text-xs" placeholder="BA" />
                      </td>
                      <td className="py-1 pr-2">
                        <select className={selectKlasse} value={l.log} onChange={(e) => aendern(l.id, { log: Number(e.target.value) })}>
                          {LOG_STUFEN.map((s) => <option key={s.wert} value={s.wert}>{s.wert}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <select className={selectKlasse} value={l.status} onChange={(e) => aendern(l.id, { status: e.target.value })} data-testid={`status-${l.nr}`}>
                          {LIEFER_STATUS.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <Badge variant="outline" className={`font-normal ${AMPEL[l.ampel]}`}>
                          {l.verzug_tage > 0 ? `${l.verzug_tage} ${t("Tage Verzug")}` : l.faellig ? t("heute fällig") : l.status === "geplant" ? t("im Plan") : datumText(l.datum_ist)}
                        </Badge>
                      </td>
                      <td className="py-1 pr-2 font-mono text-[10px]">{l.dateiname || "—"}</td>
                      <td className="py-1 text-right">
                        <Button type="button" variant="ghost" size="sm" onClick={() => loeschen(l.id)} aria-label={t("Lieferung löschen")}>
                          <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Dateinamen-Baukasten */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700">{t("Dateiname nach Namenskonvention")}</div>
          {originalPruefung && (
            <div className={`rounded-lg border p-2 text-xs ${originalPruefung.gueltig && !originalPruefung.warnungen.length ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`} data-testid="original-pruefung">
              <span className="font-medium">{t("Geladene Datei")}: </span><span className="font-mono">{modell.fileName}</span>
              {originalPruefung.fehler.map((f) => <div key={f}>✗ {f}</div>)}
              {originalPruefung.warnungen.map((w) => <div key={w}>⚠ {w}</div>)}
              {originalPruefung.gueltig && !originalPruefung.warnungen.length && <span> — {t("entspricht der Namenskonvention")}</span>}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2 text-xs">
            {[
              ["phase", t("Phase"), KATALOG.phasen], ["gebaeude", t("Gebäude"), KATALOG.gebaeude],
              ["modellart", t("Modellart"), KATALOG.modellarten], ["ebene", t("Ebene"), KATALOG.ebenen],
              ["status", t("Status"), KATALOG.status],
            ].map(([feld, label, liste]) => (feld === "gebaeude" ? (
              <label key={feld} className="flex flex-col gap-0.5">
                <span className="text-slate-500">{label}</span>
                {/* native input: the shadcn Input has no `list` prop under checkJs (tsc gate) */}
                <input list="gebaeude-vorschlaege" value={teile.gebaeude} onChange={(e) => setTeile((p) => ({ ...p, gebaeude: e.target.value.trim() }))} className="flex h-8 w-28 rounded-md border border-input bg-transparent px-3 py-1 text-xs font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" placeholder="00000-01" data-testid="teil-gebaeude" />
                <datalist id="gebaeude-vorschlaege">
                  {liste.map((o) => <option key={o.wert} value={o.wert}>{o.text}</option>)}
                </datalist>
              </label>
            ) : (
              <label key={feld} className="flex flex-col gap-0.5">
                <span className="text-slate-500">{label}</span>
                <select className={selectKlasse} value={teile[feld]} onChange={(e) => setTeile((p) => ({ ...p, [feld]: e.target.value }))} data-testid={`teil-${feld}`}>
                  {liste.map((o) => <option key={o.wert} value={o.wert}>{o.wert} — {o.text}</option>)}
                </select>
              </label>
            )))}
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">{t("Freitext (≤ 10, nur Buchstaben/Ziffern)")}</span>
              <Input value={teile.freitext} onChange={(e) => setTeile((p) => ({ ...p, freitext: e.target.value }))} className="h-8 w-36 text-xs" maxLength={12} data-testid="teil-freitext" />
            </label>
            <div className="flex flex-col gap-0.5">
              <span className="text-slate-500">{t("Index")}</span>
              <span className="h-8 flex items-center px-2 rounded-md border border-slate-200 bg-slate-50 font-mono">{String(index).padStart(2, "0")}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="dateiname-vorschau">
            {dateiname.name ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="font-mono text-xs">{dateiname.name}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span className="text-xs text-rose-700">{dateiname.fehler}</span>
              </>
            )}
            {namePruefung?.warnungen.map((w) => <span key={w} className="text-xs text-amber-700">⚠ {w}</span>)}
          </div>
        </div>

        {/* Paket */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <Button type="button" onClick={paketErzeugen} disabled={!paketMoeglich || busy} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" data-testid="lieferpaket-erzeugen">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            {t("Lieferpaket erzeugen")}
          </Button>
          <span className="text-xs text-slate-500">
            {!ergebnis ? t("Erst prüfen — das Paket baut aus dem vorhandenen Ergebnis, kein zweiter Prüflauf.")
              : !gewaehlt ? t("Lieferung im Plan anlegen oder wählen.")
                : `${t("Lieferung")} ${gewaehlt.nr} · LoG ${gewaehlt.log} · ${t("Termin")} ${datumText(gewaehlt.termin)} · ${t("Herkunft")}: ${t("geladene Datei, kein Neu-Export (Stufe A)")}`}
          </span>
          {letztesPaket && (
            <span className="text-xs text-emerald-700" data-testid="lieferpaket-ergebnis">
              ✓ {letztesPaket.zip} · {letztesPaket.dateien} {t("Dateien")}
              {letztesPaket.hinweise.length ? ` · ${letztesPaket.hinweise.join(" ")}` : ""}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
