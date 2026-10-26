// DurchbruchListe — openings planning tab of the page "Werkplanung & Baustelle" (88-01,
// RE-01): request openings/slots/core drillings, review matrix structural engineer →
// architect, "executed", jump to the penetrated element in the IFC viewer, BCF per
// opening and for all.
//
// In:  projectId, projektName. Loads/writes Durchbruch. Rules: src/lib/werkplanung/durchbrueche.js,
//      BCF: @ifc/lib/bcf.js buildBcfZip, viewer link: @ifc/lib/viewerLink.js (?sel=<GUID>).
// Out: UI; data-testids db-neu, db-form-*, db-speichern, db-zeile (data-nr, data-status),
//      db-statik-ok, db-statik-ab, db-architekt-ok, db-architekt-ab, db-pruefer, db-pruef-ok,
//      db-ausgefuehrt, db-viewer, db-bcf, db-bcf-alle, db-fehler.
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
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { buildBcfZip } from "@ifc/lib/bcf";
import { serialisiereZustand } from "@ifc/lib/viewerLink";
import { Plus } from "lucide-react";
import {
  DURCHBRUCH_ARTEN, DURCHBRUCH_STATUS, DURCHBRUCH_GEWERKE, FEUERWIDERSTAENDE,
  labelAus, masseText, durchbruchHinweise, pruefSchritt, ausgefuehrtPatch, neuerDurchbruch, alsBcfTopic, ZULASSUNG_ARTEN,
  durchbruchSteckbriefe,
} from "@/lib/werkplanung/durchbrueche";
// 100-02: data sheet of the opening and its fire stop (same rows as the BIT-BIM inspector)
import { SteckbriefKasten } from "@designer/components/SteckbriefFelder";

const LEER = { art: "durchbruch", form: "rechteck", x: "", y: "", z: "", b_mm: "", h_mm: "", d_mm: "", t_mm: "", bauteil_guid: "", bauteil_name: "", geschoss: "", gewerk: "GH", feuerwiderstand: "ohne", abschottung: "", kommentar: "", schott_klasse: "", schott_system: "", schott_zulassung_art: "abZ", schott_zulassung_nr: "", schott_hersteller: "" };
const fehlerText = (e) => (e instanceof Error ? e.message : String(e));
const dateiTeil = (s) => String(s || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_");

/**
 * @param {{projectId: string, projektName?: string}} props
 */
export default function DurchbruchListe({ projectId, projektName = "" }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [liste, setListe] = useState(/** @type {Array<any>} */ ([]));
  const [formular, setFormular] = useState(/** @type {null | Record<string, string>} */ (null));
  const [pruefen, setPruefen] = useState(/** @type {null | {d: any, rolle: 'statik'|'architekt', ergebnis: 'ok'|'abgelehnt', von: string, kommentar: string}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [steckbriefId, setSteckbriefId] = useState(/** @type {string|null} */ (null)); // 100-02: open data sheet row

  const laden = useCallback(async () => {
    try {
      const r = await bitApi.entities.Durchbruch.filter({ project_id: projectId });
      const l = Array.isArray(r) ? r : [];
      l.sort((a, b) => String(a.nr || "").localeCompare(String(b.nr || ""), "de"));
      setListe(l);
    } catch (e) { setFehler(`${t("Durchbrüche konnten nicht geladen werden")}: ${fehlerText(e)}`); }
  }, [projectId, t]);
  useEffect(() => { laden(); }, [laden]);

  const speichern = async (e) => {
    e.preventDefault();
    if (!formular) return;
    setFehler(null);
    try {
      await bitApi.entities.Durchbruch.create({ ...neuerDurchbruch(formular, { projectId, alle: liste }), created_date: new Date().toISOString() });
      setFormular(null);
      await laden();
    } catch (err) { setFehler(`${t("Durchbruch konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const pruefungSpeichern = async () => {
    if (!pruefen) return;
    const patch = pruefSchritt(pruefen.d, pruefen.rolle, pruefen.ergebnis, pruefen.von, pruefen.kommentar);
    if (!patch) { setFehler(t("Prüfschritt nicht möglich (Reihenfolge Statik → Architekt, Name nötig)")); return; }
    try { await bitApi.entities.Durchbruch.update(pruefen.d.id, patch); setPruefen(null); await laden(); }
    catch (err) { setFehler(`${t("Durchbruch konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  // 100-02: KG / trade / section from the data sheet — optimistic in the list (the inputs save per keystroke),
  // then stored on the record; a failed write reloads the list and says so.
  const steckbriefPatch = async (d, patch) => {
    setListe((l) => l.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
    try { await bitApi.entities.Durchbruch.update(d.id, patch); }
    catch (err) { setFehler(`${t("Durchbruch konnte nicht gespeichert werden")}: ${fehlerText(err)}`); await laden(); }
  };

  const ausgefuehrt = async (d) => {
    const patch = ausgefuehrtPatch(d);
    if (!patch) return;
    try { await bitApi.entities.Durchbruch.update(d.id, patch); await laden(); }
    catch (err) { setFehler(`${t("Durchbruch konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const bcf = (auswahl, name) => {
    try {
      const bytes = buildBcfZip(auswahl.map((d) => alsBcfTopic(d, { autor: user?.full_name || "BIT-Atelier" })));
      dateiAnbieten(bytes, name, "application/octet-stream");
    } catch (err) { setFehler(`${t("BCF-Export fehlgeschlagen")}: ${fehlerText(err)}`); }
  };

  const feld = (key, label, props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`db-form-${key}`}>{t(label)}</Label>
      <Input id={`db-form-${key}`} data-testid={`db-form-${key}`} value={formular?.[key] ?? ""}
        onChange={(e) => setFormular((f) => f && { ...f, [key]: e.target.value })} {...props} />
    </div>
  );
  const auswahl = (key, label, optionen) => (
    <div className="space-y-1">
      <Label htmlFor={`db-form-${key}`}>{t(label)}</Label>
      <select id={`db-form-${key}`} data-testid={`db-form-${key}`} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
        value={formular?.[key] ?? ""} onChange={(e) => setFormular((f) => f && { ...f, [key]: e.target.value })}>
        {optionen.map((o) => <option key={o.wert} value={o.wert}>{o.text}</option>)}
      </select>
    </div>
  );
  const vermerk = (v) => (v ? `${v.ergebnis === "ok" ? "✓" : "✗"} ${v.von}` : "—");
  const offenePruefung = (d, rolle, ergebnis) => setPruefen({ d, rolle, ergebnis, von: user?.full_name || "", kommentar: "" });

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Durchbrüche")} ({liste.length})</CardTitle>
        <div className="flex gap-2">
          {liste.length > 0 && (
            <Button size="sm" variant="outline" data-testid="db-bcf-alle"
              onClick={() => bcf(liste.filter((d) => d.status !== "abgelehnt"), `Durchbrueche_${dateiTeil(projektName)}.bcf`)}>
              {t("Alle als BCF")}
            </Button>
          )}
          <Button size="sm" data-testid="db-neu" onClick={() => setFormular({ ...LEER })}><Plus className="w-4 h-4 mr-1" />{t("Durchbruch beantragen")}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {liste.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Noch keine Durchbrüche beantragt.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 px-2">{t("Nr.")}</th>
                  <th className="py-2 px-2">{t("Art / Maße")}</th>
                  <th className="py-2 px-2">{t("Bauteil")}</th>
                  <th className="py-2 px-2">{t("Gewerk")}</th>
                  <th className="py-2 px-2">{t("Brandschutz")}</th>
                  <th className="py-2 px-2">{t("Statik")}</th>
                  <th className="py-2 px-2">{t("Architekt")}</th>
                  <th className="py-2 px-2">{t("Status")}</th>
                  <th className="py-2 px-2">{t("Hinweise")}</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {liste.map((d) => {
                  const hw = durchbruchHinweise(d, liste);
                  const guidOk = /^[0-9A-Za-z_$]{22}$/.test(String(d.bauteil_guid || ""));
                  const sb = steckbriefId === d.id ? durchbruchSteckbriefe(d, { projektId: projectId }) : null;
                  return (
                    <React.Fragment key={d.id}>
                    <tr className="border-b last:border-0 align-top" data-testid="db-zeile" data-nr={d.nr} data-status={d.status}>
                      <td className="py-1.5 px-2 font-mono text-xs">{d.nr}</td>
                      <td className="py-1.5 px-2">{t(labelAus(DURCHBRUCH_ARTEN, d.art))}<div className="text-xs text-muted-foreground">{masseText(d)}</div></td>
                      <td className="py-1.5 px-2 text-xs">{d.bauteil_name || "—"}<div className="font-mono text-muted-foreground">{d.bauteil_guid || ""}</div>{d.geschoss && <div>{d.geschoss}</div>}</td>
                      <td className="py-1.5 px-2 text-xs">{d.gewerk || "—"}</td>
                      <td className="py-1.5 px-2 text-xs">{d.feuerwiderstand || "ohne"}{d.abschottung && <div className="text-muted-foreground">{d.abschottung}</div>}
                        {d.brandschott && <div className="text-muted-foreground" data-testid="db-schott">{t("Schott")} {d.brandschott.klasse}{d.brandschott.system ? ` · ${d.brandschott.system}` : ""}{d.brandschott.zulassung_nr ? ` · ${d.brandschott.zulassung_art} ${d.brandschott.zulassung_nr}` : ""}</div>}</td>
                      <td className="py-1.5 px-2 text-xs" data-testid="db-statik">{vermerk(d.pruefung?.statik)}</td>
                      <td className="py-1.5 px-2 text-xs" data-testid="db-architekt">{vermerk(d.pruefung?.architekt)}</td>
                      <td className="py-1.5 px-2">{t(labelAus(DURCHBRUCH_STATUS, d.status))}</td>
                      <td className="py-1.5 px-2 text-xs">
                        {hw.map((h) => <div key={h.code} data-code={h.code} className={h.stufe === "warn" ? "text-warnung" : "text-muted-foreground"}>{t(h.text)}</div>)}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {d.status === "beantragt" && (<>
                            <Button size="sm" variant="outline" data-testid="db-statik-ok" onClick={() => offenePruefung(d, "statik", "ok")}>{t("Statik i. O.")}</Button>
                            <Button size="sm" variant="ghost" data-testid="db-statik-ab" onClick={() => offenePruefung(d, "statik", "abgelehnt")}>{t("Statik lehnt ab")}</Button>
                          </>)}
                          {d.status === "statik_geprueft" && (<>
                            <Button size="sm" data-testid="db-architekt-ok" onClick={() => offenePruefung(d, "architekt", "ok")}>{t("Architekt gibt frei")}</Button>
                            <Button size="sm" variant="ghost" data-testid="db-architekt-ab" onClick={() => offenePruefung(d, "architekt", "abgelehnt")}>{t("Architekt lehnt ab")}</Button>
                          </>)}
                          {d.status === "freigegeben" && (
                            <Button size="sm" variant="outline" data-testid="db-ausgefuehrt" onClick={() => ausgefuehrt(d)}>{t("Ausgeführt")}</Button>
                          )}
                          {guidOk && (
                            <Link data-testid="db-viewer" className="text-xs text-blue-700 underline-offset-4 hover:underline self-center"
                              to={`/IfcViewer?${serialisiereZustand({ sel: d.bauteil_guid })}`}>{t("Im Modell zeigen")}</Link>
                          )}
                          <Button size="sm" variant="ghost" data-testid="db-bcf" onClick={() => bcf([d], `${d.nr}_${dateiTeil(projektName)}.bcf`)}>BCF</Button>
                          <Button size="sm" variant="ghost" data-testid="db-steckbrief-knopf" aria-expanded={steckbriefId === d.id}
                            onClick={() => setSteckbriefId((id) => (id === d.id ? null : d.id))}>{t("Steckbrief")}</Button>
                        </div>
                      </td>
                    </tr>
                    {sb && (
                      <tr className="border-b" data-testid="db-steckbrief">
                        <td colSpan={10} className="px-2 pb-2">
                          <div className="grid gap-2 sm:grid-cols-2 max-w-3xl">
                            <SteckbriefKasten t={t} s={sb.durchbruch} patch={(p) => steckbriefPatch(d, p)} testId="db-steckbrief-durchbruch" />
                            {sb.brandschott && <SteckbriefKasten t={t} s={sb.brandschott} testId="db-steckbrief-schott" />}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {fehler && <p className="text-sm text-fehler" role="alert" data-testid="db-fehler">{fehler}</p>}
        <p className="text-xs text-muted-foreground">
          {t("Ablauf: beantragt → Statik prüft → Architekt gibt frei → ausgeführt. Hinweise ersetzen keine Prüfung durch Tragwerks- und Brandschutzplanung.")}
        </p>
      </CardContent>

      {formular && (
        <FormModal title={t("Durchbruch beantragen")} onClose={() => setFormular(null)}>
          <form onSubmit={speichern} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {auswahl("art", "Art", DURCHBRUCH_ARTEN.map((a) => ({ wert: a.key, text: t(a.label) })))}
              {auswahl("form", "Form", [{ wert: "rechteck", text: t("rechteckig") }, { wert: "rund", text: t("rund") }])}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {formular.form === "rund" || formular.art === "kernbohrung"
                ? feld("d_mm", "Ø (mm)", { type: "number", step: "any" })
                : (<>{feld("b_mm", "Breite (mm)", { type: "number", step: "any" })}{feld("h_mm", "Höhe (mm)", { type: "number", step: "any" })}</>)}
              {formular.art === "schlitz" && feld("t_mm", "Tiefe (mm)", { type: "number", step: "any" })}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {feld("x", "x (m)", { type: "number", step: "any" })}
              {feld("y", "y (m)", { type: "number", step: "any" })}
              {feld("z", "z (m)", { type: "number", step: "any" })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {feld("bauteil_guid", "Bauteil (IFC-GUID)")}
              {feld("bauteil_name", "Bauteil (Bezeichnung)")}
              {feld("geschoss", "Geschoss")}
              {auswahl("gewerk", "Gewerk", DURCHBRUCH_GEWERKE.map((g) => ({ wert: g.wert, text: `${g.wert} ${g.text}` })))}
              {auswahl("feuerwiderstand", "Feuerwiderstand des Bauteils", FEUERWIDERSTAENDE.map((f) => ({ wert: f, text: f === "ohne" ? t("ohne") : f })))}
              {feld("abschottung", "Abschottung (System, Zulassung)")}
            </div>
            {/* 97-02a: the fire stop as its own element — only when the penetrated element has a rating. */}
            {formular.feuerwiderstand && formular.feuerwiderstand !== "ohne" && (
              <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-warnung-rand bg-warnung-flaeche p-3" data-testid="db-schott-form">
                <legend className="px-1 text-xs font-semibold text-warnung">{t("Brandschott")}</legend>
                {auswahl("schott_klasse", "Feuerwiderstand des Schotts", [{ wert: "", text: t("wie Bauteil") }, ...FEUERWIDERSTAENDE.filter((f) => f !== "ohne").map((f) => ({ wert: f, text: f }))])}
                {feld("schott_system", "System / Produkt")}
                {auswahl("schott_zulassung_art", "Zulassung", ZULASSUNG_ARTEN.map((z) => ({ wert: z.key, text: t(z.label) })))}
                {feld("schott_zulassung_nr", "Zulassungsnummer")}
                {feld("schott_hersteller", "Hersteller")}
              </fieldset>
            )}
            {feld("kommentar", "Kommentar")}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="db-speichern">{t("Beantragen")}</Button>
            </div>
          </form>
        </FormModal>
      )}

      {pruefen && (
        <FormModal title={`${pruefen.d.nr} · ${pruefen.rolle === "statik" ? t("Statik") : t("Architekt")}: ${pruefen.ergebnis === "ok" ? t("i. O.") : t("abgelehnt")}`} onClose={() => setPruefen(null)}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="db-pruefer">{t("Geprüft von")}</Label>
              <Input id="db-pruefer" data-testid="db-pruefer" value={pruefen.von} onChange={(e) => setPruefen({ ...pruefen, von: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="db-pruef-kommentar">{t("Kommentar")}</Label>
              <Input id="db-pruef-kommentar" value={pruefen.kommentar} onChange={(e) => setPruefen({ ...pruefen, kommentar: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPruefen(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="db-pruef-ok" disabled={!pruefen.von.trim()} onClick={pruefungSpeichern}>{t("Vermerk speichern")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}
