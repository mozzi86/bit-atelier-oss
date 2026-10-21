// BemusterungListe — sampling tab of the page "Werkplanung & Baustelle" (88-05, RE-11):
// samples with manufacturer, colour (RAL/NCS), surface, submit → release/reject with
// name, suggestions from the room book of the space programme, release protocol PDF
// (download + filed through dokumentAblegen as "Protokoll").
//
// In:  projectId, projekt ({name, client}). Loads/writes Bemusterung, reads SpaceProgram
//      (room book, written only by the space programme editor). Rules: src/lib/werkplanung/bemusterung.js.
// Out: UI; data-testids bm-neu, bm-form-*, bm-speichern, bm-vorschlaege, bm-zeile (data-nr,
//      data-status), bm-vorlegen, bm-freigeben, bm-ablehnen, bm-von, bm-entscheiden, bm-pdf, bm-fehler.
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import FormModal from "@core/components/common/FormModal";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useAuth } from "@core/lib/AuthContext";
import { fileToDataUrl } from "@core/lib/pdf";
import { dokumentAblegen } from "@core/lib/ablage";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { Plus } from "lucide-react";
import {
  OBERFLAECHEN, bemusterungStatusLabel, bemusterungHinweise, vorlagePatch, entscheidungPatch,
  neueBemusterung, vorschlaegeAusRaumbuch, bemusterungsProtokollPdf, istProjektMuster,
} from "@/lib/werkplanung/bemusterung";

const LEER = { gegenstand: "", raum_bezug: "", position_ref: "", fabrikat: "", produkt: "", farbe_system: "RAL", farbe: "", oberflaeche: "" };
const fehlerText = (e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {{projectId: string, projekt?: {name?: string, client?: string}|null}} props
 */
export default function BemusterungListe({ projectId, projekt = null }) {
  const { t } = useI18n();
  const { user } = useAuth();
  // alleMuster = every sample of the project (number pool); liste = project samples shown here.
  // Buyers' apartment samples (99-02) are shown in "Wohnungen & Sonderwünsche" only.
  const [alleMuster, setAlleMuster] = useState(/** @type {Array<any>} */ ([]));
  const [raumItems, setRaumItems] = useState(/** @type {Array<any>} */ ([]));
  const [formular, setFormular] = useState(/** @type {null | Record<string, string>} */ (null));
  const [entscheidung, setEntscheidung] = useState(/** @type {null | {b: any, ergebnis: 'freigegeben'|'abgelehnt', von: string, bemerkung: string}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [meldung, setMeldung] = useState(/** @type {string|null} */ (null));

  const laden = useCallback(async () => {
    try {
      const [r, sp] = await Promise.all([
        bitApi.entities.Bemusterung.filter({ project_id: projectId }),
        bitApi.entities.SpaceProgram.filter({ project_id: projectId }).catch(() => []),
      ]);
      const l = Array.isArray(r) ? r : [];
      l.sort((a, b) => String(a.nr || "").localeCompare(String(b.nr || ""), "de"));
      setAlleMuster(l);
      setRaumItems(Array.isArray(sp) && sp[0]?.items ? sp[0].items : []);
    } catch (e) { setFehler(`${t("Bemusterung konnte nicht geladen werden")}: ${fehlerText(e)}`); }
  }, [projectId, t]);
  useEffect(() => { laden(); }, [laden]);

  const liste = alleMuster.filter(istProjektMuster);
  const kaeuferMuster = alleMuster.length - liste.length;
  const vorschlaege = vorschlaegeAusRaumbuch(raumItems, liste);

  const anlegen = async (werteListe) => {
    setFehler(null);
    try {
      let alle = [...alleMuster];
      for (const w of werteListe) {
        const rec = neueBemusterung(w, { projectId, alle });
        await bitApi.entities.Bemusterung.create({ ...rec, created_date: new Date().toISOString() });
        alle = [...alle, rec];
      }
      await laden();
    } catch (err) { setFehler(`${t("Muster konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const speichern = async (e) => {
    e.preventDefault();
    if (!formular) return;
    await anlegen([formular]);
    setFormular(null);
  };

  const vorlegen = async (b) => {
    const patch = vorlagePatch(b);
    if (!patch) return;
    try { await bitApi.entities.Bemusterung.update(b.id, patch); await laden(); }
    catch (err) { setFehler(`${t("Muster konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const entscheiden = async () => {
    if (!entscheidung) return;
    const patch = entscheidungPatch(entscheidung.b, entscheidung.ergebnis, entscheidung.von, entscheidung.bemerkung);
    if (!patch) { setFehler(t("Entscheidung nur für vorgelegte Muster und mit Namen")); return; }
    try { await bitApi.entities.Bemusterung.update(entscheidung.b.id, patch); setEntscheidung(null); await laden(); }
    catch (err) { setFehler(`${t("Muster konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const protokoll = async () => {
    setFehler(null); setMeldung(null);
    try {
      const { bytes, dateiname, anzahl } = await bemusterungsProtokollPdf({ projekt, muster: liste });
      dateiAnbieten(bytes, dateiname, "application/pdf");
      // The signed protocol is a record of a client decision → bytes are filed (storage rule inside).
      const daten = await fileToDataUrl(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
      const r = await dokumentAblegen({ projectId, name: dateiname, typ: "Protokoll", daten: String(daten), notiz: `Bemusterungsprotokoll, ${anzahl} Muster` });
      setMeldung(r.ok ? t("Protokoll abgelegt unter Berichtswesen / Protokolle") : `${t("Protokoll nicht abgelegt")}: ${r.grund || ""}`);
    } catch (err) { setFehler(`${t("Protokoll konnte nicht erzeugt werden")}: ${fehlerText(err)}`); }
  };

  const feld = (key, label, props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`bm-form-${key}`}>{t(label)}</Label>
      <Input id={`bm-form-${key}`} data-testid={`bm-form-${key}`} value={formular?.[key] ?? ""}
        onChange={(e) => setFormular((f) => f && { ...f, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Bemusterung")} ({liste.length})</CardTitle>
        <div className="flex flex-wrap gap-2">
          {vorschlaege.length > 0 && (
            <Button size="sm" variant="outline" data-testid="bm-vorschlaege" onClick={() => anlegen(vorschlaege.map((v) => ({ ...LEER, farbe_system: "sonstig", ...v })))}>
              {t("{n} Muster aus dem Raumbuch anlegen").replace("{n}", String(vorschlaege.length))}
            </Button>
          )}
          <Button size="sm" variant="outline" data-testid="bm-pdf" onClick={protokoll}>{t("Freigabeprotokoll (PDF)")}</Button>
          <Button size="sm" data-testid="bm-neu" onClick={() => setFormular({ ...LEER })}><Plus className="w-4 h-4 mr-1" />{t("Neues Muster")}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {raumItems.length === 0 && (
          <p className="text-xs text-slate-500">
            {t("Kein Raumbuch: im Raumprogramm Ausbau je Raumtyp erfassen, dann schlägt diese Liste Muster vor.")}{" "}
            <Link to="/ComplexDesigner?tab=program" className="text-blue-700 underline-offset-4 hover:underline">{t("Zum Raumprogramm")}</Link>
          </p>
        )}
        {kaeuferMuster > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="bm-kaeufer-hinweis">
            {t("{n} Muster aus Sonderwünschen der Käufer stehen unter Wohnungen & Sonderwünsche (nicht in dieser Liste und nicht im Protokoll).").replace("{n}", String(kaeuferMuster))}
          </p>
        )}
        {liste.length === 0 ? (
          <p className="text-sm text-slate-500">{t("Noch keine Muster.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b">
                  <th className="py-2 px-2">{t("Nr.")}</th>
                  <th className="py-2 px-2">{t("Gegenstand")}</th>
                  <th className="py-2 px-2">{t("Fabrikat / Produkt")}</th>
                  <th className="py-2 px-2">{t("Farbe")}</th>
                  <th className="py-2 px-2">{t("Oberfläche")}</th>
                  <th className="py-2 px-2">{t("Status")}</th>
                  <th className="py-2 px-2">{t("Hinweise")}</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {liste.map((b) => {
                  const hw = bemusterungHinweise(b);
                  return (
                    <tr key={b.id} className="border-b last:border-0 align-top" data-testid="bm-zeile" data-nr={b.nr} data-status={b.status} data-gegenstand={b.gegenstand}>
                      <td className="py-1.5 px-2 font-mono text-xs">{b.nr}</td>
                      <td className="py-1.5 px-2">{b.gegenstand || "—"}{b.raum_bezug && <div className="text-xs text-slate-500">{b.raum_bezug}</div>}{b.position_ref && <div className="text-xs text-slate-400">{t("LV")} {b.position_ref}</div>}</td>
                      <td className="py-1.5 px-2 text-xs">{[b.fabrikat, b.produkt].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="py-1.5 px-2 text-xs">{b.farbe || "—"}</td>
                      <td className="py-1.5 px-2 text-xs">{b.oberflaeche || "—"}</td>
                      <td className="py-1.5 px-2 text-xs">{t(bemusterungStatusLabel(b.status))}{b.freigabe && <div className="text-slate-500">{b.freigabe.von}, {new Date(b.freigabe.am).toLocaleDateString("de-DE")}</div>}</td>
                      <td className="py-1.5 px-2 text-xs">{hw.map((h) => <div key={h.code} data-code={h.code} className={h.stufe === "warn" ? "text-amber-700" : "text-slate-500"}>{t(h.text)}</div>)}</td>
                      <td className="py-1.5 px-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {b.status === "offen" && <Button size="sm" variant="outline" data-testid="bm-vorlegen" onClick={() => vorlegen(b)}>{t("Vorgelegt")}</Button>}
                          {b.status === "vorgelegt" && (<>
                            <Button size="sm" data-testid="bm-freigeben" onClick={() => setEntscheidung({ b, ergebnis: "freigegeben", von: user?.full_name || "", bemerkung: "" })}>{t("Freigeben")}</Button>
                            <Button size="sm" variant="ghost" data-testid="bm-ablehnen" onClick={() => setEntscheidung({ b, ergebnis: "abgelehnt", von: user?.full_name || "", bemerkung: "" })}>{t("Ablehnen")}</Button>
                          </>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {meldung && <p className="text-sm text-emerald-700" data-testid="bm-meldung">{meldung}</p>}
        {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="bm-fehler">{fehler}</p>}
      </CardContent>

      {formular && (
        <FormModal title={t("Neues Muster")} onClose={() => setFormular(null)}>
          <form onSubmit={speichern} className="space-y-3">
            {feld("gegenstand", "Gegenstand", { required: true, placeholder: t("z. B. Bodenbelag Büro") })}
            <div className="grid grid-cols-2 gap-3">
              {feld("raum_bezug", "Raum / Bereich")}
              {feld("position_ref", "LV-Position (OZ)")}
              {feld("fabrikat", "Fabrikat")}
              {feld("produkt", "Produkt")}
              <div className="space-y-1">
                <Label htmlFor="bm-form-farbe_system">{t("Farbsystem")}</Label>
                <select id="bm-form-farbe_system" data-testid="bm-form-farbe_system" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={formular.farbe_system} onChange={(e) => setFormular((f) => f && { ...f, farbe_system: e.target.value })}>
                  <option value="RAL">RAL</option><option value="NCS">NCS</option><option value="sonstig">{t("sonstig")}</option>
                </select>
              </div>
              {feld("farbe", "Farbe", { placeholder: formular.farbe_system === "NCS" ? "S 0502-Y" : "RAL 9010" })}
              <div className="space-y-1">
                <Label htmlFor="bm-form-oberflaeche">{t("Oberfläche")}</Label>
                <Input id="bm-form-oberflaeche" data-testid="bm-form-oberflaeche" list="bm-oberflaechen" value={formular.oberflaeche}
                  onChange={(e) => setFormular((f) => f && { ...f, oberflaeche: e.target.value })} />
                <datalist id="bm-oberflaechen">{OBERFLAECHEN.map((o) => <option key={o} value={o} />)}</datalist>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="bm-speichern">{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}

      {entscheidung && (
        <FormModal title={`${entscheidung.b.nr} · ${entscheidung.ergebnis === "freigegeben" ? t("Freigeben") : t("Ablehnen")}`} onClose={() => setEntscheidung(null)}>
          <div className="space-y-3">
            <p className="text-sm">{entscheidung.b.gegenstand}</p>
            <div className="space-y-1">
              <Label htmlFor="bm-von">{t("Entschieden von")}</Label>
              <Input id="bm-von" data-testid="bm-von" value={entscheidung.von} onChange={(e) => setEntscheidung({ ...entscheidung, von: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bm-bemerkung">{t("Bemerkung")}</Label>
              <Input id="bm-bemerkung" value={entscheidung.bemerkung} onChange={(e) => setEntscheidung({ ...entscheidung, bemerkung: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEntscheidung(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="bm-entscheiden" disabled={!entscheidung.von.trim()} onClick={entscheiden}>{t("Speichern")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}
