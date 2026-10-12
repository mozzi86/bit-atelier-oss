// BautagebuchListe — construction diary tab of the page "Werkplanung & Baustelle"
// (88-02, RE-13/14): one entry per day with weather, companies (crew size, works),
// incidents, defects and hindrance; bad-weather hints per entry; "Wetter übernehmen"
// takes the CURRENT reading of /api/weather only when it is a real measurement
// (never the offline fallback); "Behinderungsanzeige schreiben" opens the
// correspondence (82-05) with the diary entry as reference — only with the right to
// write letters.
//
// Entries are not deleted from the UI: the diary is a record of the site (liability);
// a wrong entry is corrected, not removed.
//
// In:  projectId, projekt ({location: {lat, lng}}). Loads/writes BautagebuchEintrag.
//      Rules: src/lib/werkplanung/bautagebuch.js.
// Out: UI; data-testids btb-neu, btb-form-*, btb-firma-*, btb-wetter, btb-wetter-hinweis,
//      btb-speichern, btb-zeile (data-datum, data-schlechtwetter), btb-hinweis (data-art),
//      btb-bearbeiten, btb-behinderung, btb-fehler.
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import FormModal from "@core/components/common/FormModal";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useAuth } from "@core/lib/AuthContext";
import { useZugriff } from "@core/lib/ZugriffContext";
import { isoTag } from "@core/lib/kalender/datum.js";
import { Plus, Trash2 } from "lucide-react";
import { istSchlechtwetterTag, mannstaerke, neuerEintrag, normalisiereEintrag, schlechtwetterHinweise, wetterVorschlag } from "@/lib/werkplanung/bautagebuch";
import { schreibenLink } from "@/lib/schriftverkehr/deepLink";

/** German text (i18n key) per bad-weather hint; {…} filled from the hint's values. */
const HINWEIS_TEXT = Object.freeze({
  beton_kalt: "Beton/Estrich/Mörtel bei {temp} °C (unter +{grenze} °C): Schutzmaßnahmen dokumentieren",
  mauerwerk_frost: "Mauerwerk bei Frost ({temp} °C): nicht auf gefrorenem Untergrund mauern",
  anstrich_nass: "Anstrich/Putz/Abdichtung bei Niederschlag ({mm} mm)",
  wind: "Wind {kmh} km/h an Kran/Gerüst/Dach: Betrieb prüfen",
});

/** @param {string} text @param {Record<string, any>} werte */
const fuellen = (text, werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? "").replace(".", ","));
/** @param {unknown} e */
const fehlerText = (e) => (e instanceof Error ? e.message : String(e));
/** @param {unknown} v */
const zahlText = (v) => (v === null || v === undefined || v === "" ? "" : String(v));
/** @param {string} iso */
const deDatum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

/**
 * @param {{projectId: string, projekt?: Record<string, any>|null}} props
 */
export default function BautagebuchListe({ projectId, projekt = null }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const zugriff = useZugriff();
  const darfSchreiben = zugriff.darf("planung", "voll");
  const darfBrief = zugriff.darf("schriftverkehr", "voll");
  const [liste, setListe] = useState(/** @type {Array<any>} */ ([]));
  const [formular, setFormular] = useState(/** @type {null | Record<string, any>} */ (null));
  const [wetterHinweis, setWetterHinweis] = useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  const laden = useCallback(async () => {
    try {
      const r = await bitApi.entities.BautagebuchEintrag.filter({ project_id: projectId });
      const l = Array.isArray(r) ? r : [];
      l.sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
      setListe(l);
    } catch (e) { setFehler(`${t("Bautagebuch konnte nicht geladen werden")}: ${fehlerText(e)}`); }
  }, [projectId, t]);
  useEffect(() => { laden(); }, [laden]);

  const neu = () => {
    setWetterHinweis(null);
    setFormular({ ...neuerEintrag({ projectId, datum: isoTag(new Date().toISOString()) || "" }), ersteller: user?.full_name || "" });
  };

  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setFormular((f) => f && { ...f, [k]: v });
  const setzeFirma = (/** @type {number} */ i, /** @type {string} */ k, /** @type {any} */ v) => setFormular((f) => f && { ...f, firmen: f.firmen.map((/** @type {any} */ x, /** @type {number} */ j) => (j === i ? { ...x, [k]: v } : x)) });

  const wetterHolen = async () => {
    setWetterHinweis(null);
    const lat = projekt?.location?.lat;
    const lng = projekt?.location?.lng;
    if (!lat || !lng) { setWetterHinweis(t("Kein Standort am Projekt – Wetter bitte von Hand eintragen.")); return; }
    try {
      const w = await (await bitApi.apiFetch(`/api/weather?lat=${lat}&lng=${lng}`)).json();
      const v = wetterVorschlag(w);
      if (!v) { setWetterHinweis(t("Keine Live-Wetterdaten (offline) – bitte von Hand eintragen.")); return; }
      setFormular((f) => f && { ...f, ...v });
      setWetterHinweis(t("Aktueller Messwert übernommen (Tiefst- und Höchstwert bitte am Abend prüfen)."));
    } catch (e) { setWetterHinweis(`${t("Wetter nicht abrufbar")}: ${fehlerText(e)}`); }
  };

  const speichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    if (!formular) return;
    setFehler(null);
    const rec = normalisiereEintrag(formular);
    if (liste.some((x) => x.datum === rec.datum && x.id !== rec.id)) { setFehler(t("Für diesen Tag gibt es schon einen Eintrag – bitte diesen bearbeiten.")); return; }
    try {
      const { id, created_date, updated_date, ...daten } = rec;
      if (id) await bitApi.entities.BautagebuchEintrag.update(id, daten);
      else await bitApi.entities.BautagebuchEintrag.create({ ...daten, created_date: new Date().toISOString() });
      setFormular(null);
      await laden();
    } catch (err) { setFehler(`${t("Eintrag konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const zahlFeld = (/** @type {string} */ key, /** @type {string} */ label) => (
    <div className="space-y-1">
      <Label htmlFor={`btb-form-${key}`}>{t(label)}</Label>
      <Input id={`btb-form-${key}`} data-testid={`btb-form-${key}`} type="number" step="0.1" value={zahlText(formular?.[key])}
        onChange={(e) => setze(key, e.target.value)} />
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Bautagebuch")} ({liste.length})</CardTitle>
        {darfSchreiben && <Button size="sm" data-testid="btb-neu" onClick={neu}><Plus className="w-4 h-4 mr-1" />{t("Neuer Tag")}</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">{t("Schlechtwetter-Hinweise sind Richtwerte – Schutzmaßnahmen und Behinderung entscheidet die Bauleitung.")}</p>
        {liste.length === 0 ? (
          <p className="text-sm text-slate-500">{t("Noch keine Einträge.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b">
                  <th className="py-2 px-2">{t("Datum")}</th>
                  <th className="py-2 px-2">{t("Wetter")}</th>
                  <th className="py-2 px-2">{t("Firmen")}</th>
                  <th className="py-2 px-2">{t("Vorkommnisse")}</th>
                  <th className="py-2 px-2">{t("Hinweise")}</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {liste.map((e) => {
                  const hw = schlechtwetterHinweise(e);
                  const schlecht = istSchlechtwetterTag(e);
                  return (
                    <tr key={e.id} className="border-b last:border-0 align-top" data-testid="btb-zeile" data-datum={e.datum} data-schlechtwetter={schlecht ? "ja" : "nein"}>
                      <td className="py-1.5 px-2 whitespace-nowrap">{deDatum(e.datum)}{schlecht && <div className="text-xs text-amber-700">{t("Schlechtwettertag")}</div>}</td>
                      <td className="py-1.5 px-2 text-xs">
                        {[e.temp_min !== null && e.temp_min !== undefined ? `${String(e.temp_min).replace(".", ",")}${e.temp_max !== null && e.temp_max !== undefined && e.temp_max !== e.temp_min ? `…${String(e.temp_max).replace(".", ",")}` : ""} °C` : "",
                          e.niederschlag_mm ? `${String(e.niederschlag_mm).replace(".", ",")} mm` : "", e.wind_kmh ? `${e.wind_kmh} km/h` : ""].filter(Boolean).join(" · ") || "—"}
                        {e.wetter_text && <div className="text-slate-500">{e.wetter_text}</div>}
                        {e.wetter_quelle === "open-meteo" && <div className="text-slate-400">{t("Messwert Open-Meteo")}</div>}
                      </td>
                      <td className="py-1.5 px-2 text-xs">
                        <div className="font-medium">{fuellen(t("{n} Personen"), { n: mannstaerke(e) })}</div>
                        {(e.firmen || []).map((/** @type {any} */ f, /** @type {number} */ i) => <div key={i} className="text-slate-500">{[f.name, f.mannstaerke ? `(${f.mannstaerke})` : "", f.arbeiten].filter(Boolean).join(" ")}</div>)}
                      </td>
                      <td className="py-1.5 px-2 text-xs max-w-[260px]">
                        {e.vorkommnisse && <div>{e.vorkommnisse}</div>}
                        {e.maengel && <div className="text-slate-500">{t("Mängel")}: {e.maengel}</div>}
                        {e.behinderung && <div className="text-rose-700">{t("Behinderung")}: {e.behinderung_text || "—"}</div>}
                      </td>
                      <td className="py-1.5 px-2 text-xs">
                        {hw.map((h) => <div key={h.art} data-testid="btb-hinweis" data-art={h.art} className="text-amber-700">{fuellen(t(HINWEIS_TEXT[h.art]), h.werte)}</div>)}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {darfSchreiben && <Button size="sm" variant="ghost" data-testid="btb-bearbeiten" onClick={() => { setWetterHinweis(null); setFormular({ ...e, firmen: (e.firmen || []).length ? e.firmen : [{ name: "", mannstaerke: null, arbeiten: "" }] }); }}>{t("Bearbeiten")}</Button>}
                          {darfBrief && schlecht && (
                            <Button size="sm" variant="outline" asChild>
                              <Link data-testid="btb-behinderung" to={schreibenLink({ neu: "behinderungsanzeige", bezug: { typ: "bautagebuch", id: e.id } })}>{t("Behinderungsanzeige schreiben")}</Link>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {fehler && !formular && <p className="text-sm text-rose-700" role="alert" data-testid="btb-fehler">{fehler}</p>}
      </CardContent>

      {formular && (
        <FormModal title={formular.id ? `${t("Bautagebuch")} · ${deDatum(formular.datum)}` : t("Neuer Tag")} onClose={() => setFormular(null)}>
          <form onSubmit={speichern} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="btb-form-datum">{t("Datum")}</Label>
                <Input id="btb-form-datum" data-testid="btb-form-datum" type="date" required value={formular.datum || ""} onChange={(e) => setze("datum", e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="outline" size="sm" data-testid="btb-wetter" onClick={wetterHolen}>{t("Wetter übernehmen")}</Button>
              </div>
              {zahlFeld("temp_min", "Tiefstwert (°C)")}
              {zahlFeld("temp_max", "Höchstwert (°C)")}
              {zahlFeld("niederschlag_mm", "Niederschlag (mm)")}
              {zahlFeld("wind_kmh", "Wind (km/h)")}
            </div>
            {wetterHinweis && <p className="text-xs text-slate-600" data-testid="btb-wetter-hinweis">{wetterHinweis}</p>}
            <div className="space-y-1">
              <Label htmlFor="btb-form-wetter_text">{t("Wetter (Beschreibung)")}</Label>
              <Input id="btb-form-wetter_text" data-testid="btb-form-wetter_text" value={formular.wetter_text || ""} onChange={(e) => setze("wetter_text", e.target.value)} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("Firmen auf der Baustelle")}</legend>
              {(formular.firmen || []).map((/** @type {any} */ f, /** @type {number} */ i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_1.4fr_auto] gap-2 items-center">
                  <Input aria-label={t("Firma")} placeholder={t("Firma")} data-testid={`btb-firma-name-${i}`} value={f.name || ""} onChange={(e) => setzeFirma(i, "name", e.target.value)} />
                  <Input aria-label={t("Mannstärke")} placeholder={t("Pers.")} type="number" min="0" data-testid={`btb-firma-mann-${i}`} value={zahlText(f.mannstaerke)} onChange={(e) => setzeFirma(i, "mannstaerke", e.target.value)} />
                  <Input aria-label={t("Arbeiten")} placeholder={t("Arbeiten")} data-testid={`btb-firma-arbeiten-${i}`} value={f.arbeiten || ""} onChange={(e) => setzeFirma(i, "arbeiten", e.target.value)} />
                  <Button type="button" variant="ghost" size="icon" aria-label={t("Zeile entfernen")} onClick={() => setze("firmen", formular.firmen.filter((/** @type {any} */ _x, /** @type {number} */ j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" data-testid="btb-firma-neu" onClick={() => setze("firmen", [...(formular.firmen || []), { name: "", mannstaerke: null, arbeiten: "" }])}><Plus className="w-4 h-4 mr-1" />{t("Firma hinzufügen")}</Button>
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="btb-form-vorkommnisse">{t("Vorkommnisse")}</Label>
              <Textarea id="btb-form-vorkommnisse" data-testid="btb-form-vorkommnisse" rows={2} value={formular.vorkommnisse || ""} onChange={(e) => setze("vorkommnisse", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="btb-form-maengel">{t("Mängel")}</Label>
              <Textarea id="btb-form-maengel" data-testid="btb-form-maengel" rows={2} value={formular.maengel || ""} onChange={(e) => setze("maengel", e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" data-testid="btb-form-behinderung" checked={formular.behinderung === true} onChange={(e) => setze("behinderung", e.target.checked)} />
              {t("Behinderung der Ausführung")}
            </label>
            {formular.behinderung === true && (
              <Textarea aria-label={t("Behinderung (Beschreibung)")} data-testid="btb-form-behinderung_text" rows={2} placeholder={t("Was hat die Ausführung behindert?")}
                value={formular.behinderung_text || ""} onChange={(e) => setze("behinderung_text", e.target.value)} />
            )}
            {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="btb-fehler">{fehler}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="btb-speichern">{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}
    </Card>
  );
}
