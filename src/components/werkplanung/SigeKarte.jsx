// SigeKarte — health & safety tab of the page "Werkplanung & Baustelle" (88-07, RE-06,
// decision D-RE-04: forms and hints only, no liability). Prior notice fields after
// BaustellV Anhang I with a PDF draft, duties as hints ("SiGeKo bestellen"), hazard
// matrix Anhang II × project trades with own marking per row.
//
// In:  projekt ({id, name, location, client}); loads/writes SiGe, reads ScheduleTask (trades).
//      Rules: src/lib/werkplanung/sige.js.
// Out: UI; data-testids sg-karte, sg-<field>, sg-speichern, sg-gespeichert, sg-hinweis (data-code),
//      sg-matrix-zeile (data-nr, data-typisch), sg-z-<nr> (select), sg-pdf, sg-meldung, sg-fehler.
import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { fileToDataUrl } from "@core/lib/pdf";
import { dokumentAblegen } from "@core/lib/ablage";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { ShieldAlert } from "lucide-react";
import { ANHANG_I, sigePflichten, gefaehrdungsMatrix, sigeVorbelegung, vorankuendigungPdf } from "@/lib/werkplanung/sige";

const fehlerText = (e) => (e instanceof Error ? e.message : String(e));
// Form fields: Anhang I texts plus the key figures that decide the duties.
const TEXTFELDER = ["ort", "bauherr", "art", "dritter", "koordinator", "ausgewaehlte"];
const ZAHLFELDER = [["arbeitstage", "Arbeitstage (voraussichtlich)"], ["max_beschaeftigte", "Höchstzahl Beschäftigte gleichzeitig"], ["personentage", "Personentage (Umfang)"], ["arbeitgeber_anzahl", "Zahl der Arbeitgeber / Unternehmer"]];

/**
 * @param {{projekt: {id: string, name?: string, location?: string, client?: string}}} props
 */
export default function SigeKarte({ projekt }) {
  const { t } = useI18n();
  const [s, setS] = useState(/** @type {Record<string, any>} */ (sigeVorbelegung(projekt)));
  const [recId, setRecId] = useState(/** @type {string|null} */ (null));
  const [gewerke, setGewerke] = useState(/** @type {string[]} */ ([]));
  const [gespeichert, setGespeichert] = useState(false);
  const [meldung, setMeldung] = useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    let weg = false;
    Promise.all([
      bitApi.entities.SiGe.filter({ project_id: projekt.id }),
      bitApi.entities.ScheduleTask.filter({ project_id: projekt.id }).catch(() => []),
    ]).then(([rows, tasks]) => {
      if (weg) return;
      const r = Array.isArray(rows) ? rows[0] : null;
      setRecId(r?.id || null);
      setS(r ? { ...sigeVorbelegung(projekt), ...r } : sigeVorbelegung(projekt));
      setGewerke([...new Set((Array.isArray(tasks) ? tasks : []).map((x) => x.trade).filter(Boolean))]);
    }).catch((e) => setFehler(`${t("SiGe-Daten konnten nicht geladen werden")}: ${fehlerText(e)}`));
    return () => { weg = true; };
  }, [projekt, t]);

  const pflichten = sigePflichten(s);
  const matrix = gefaehrdungsMatrix(gewerke, s.gefaehrdungen);
  const setze = (k, v) => { setGespeichert(false); setS((x) => ({ ...x, [k]: v })); };
  const setzeGefahr = (nr, v) => setze("gefaehrdungen", { ...(s.gefaehrdungen || {}), [String(nr)]: { ...(s.gefaehrdungen?.[String(nr)] || {}), zutreffend: v === "ja" ? true : v === "nein" ? false : null } });

  const speichern = async () => {
    setFehler(null);
    try {
      const { id: _id, ...rest } = s;
      const payload = { ...rest, project_id: projekt.id };
      if (recId) await bitApi.entities.SiGe.update(recId, payload);
      else setRecId((await bitApi.entities.SiGe.create(payload)).id);
      setGespeichert(true);
    } catch (e) { setFehler(`${t("SiGe-Daten konnten nicht gespeichert werden")}: ${fehlerText(e)}`); }
  };

  const pdf = async () => {
    setFehler(null); setMeldung(null);
    try {
      const { bytes, dateiname, offen } = await vorankuendigungPdf({ s, projektName: projekt.name });
      dateiAnbieten(bytes, dateiname, "application/pdf");
      const daten = await fileToDataUrl(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
      const r = await dokumentAblegen({ projectId: projekt.id, name: dateiname, typ: "Bericht", daten: String(daten), notiz: "Vorankündigung BaustellV (Entwurf)" });
      setMeldung(`${t("Entwurf erzeugt")}${offen ? ` — ${t("{n} Felder offen").replace("{n}", String(offen))}` : ""}${r.ok ? "" : ` · ${t("nicht abgelegt")}: ${r.grund || ""}`}`);
    } catch (e) { setFehler(`${t("PDF konnte nicht erzeugt werden")}: ${fehlerText(e)}`); }
  };

  const label = (k) => ANHANG_I.find((f) => f.key === k)?.label || k;
  return (
    <Card data-testid="sg-karte">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> {t("Sicherheits- und Gesundheitsschutz (BaustellV)")}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" data-testid="sg-pdf" onClick={pdf}>{t("Vorankündigung (PDF-Entwurf)")}</Button>
            <Button size="sm" data-testid="sg-speichern" onClick={speichern}>{t("Speichern")}</Button>
          </span>
        </CardTitle>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          {t("Nur Formulare und Hinweise: BIT-Atelier übernimmt keine Koordination und keine Haftung nach BaustellV. Für Planung und Ausführung einen Koordinator (SiGeKo) bestellen.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1 text-sm">
          {pflichten.hinweise.map((h) => (
            <li key={h.code} data-testid="sg-hinweis" data-code={h.code} className={h.stufe === "warn" ? "text-amber-800 font-medium" : "text-slate-500 text-xs"}>
              {h.stufe === "warn" ? "⚠ " : "ℹ "}{t(h.text)}
            </li>
          ))}
        </ul>

        <div className="grid md:grid-cols-4 gap-3">
          {ZAHLFELDER.map(([k, l]) => (
            <div key={k} className="space-y-1">
              <label htmlFor={`sg-${k}`} className="text-xs text-slate-500">{t(l)}</label>
              <Input id={`sg-${k}`} data-testid={`sg-${k}`} type="number" min="0" className="h-8" value={s[k] ?? ""} onChange={(e) => setze(k, e.target.value)} />
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {TEXTFELDER.map((k) => (
            <div key={k} className="space-y-1">
              <label htmlFor={`sg-${k}`} className="text-xs text-slate-500">{t(label(k))}</label>
              <Input id={`sg-${k}`} data-testid={`sg-${k}`} className="h-8" value={s[k] ?? ""} onChange={(e) => setze(k, e.target.value)} />
            </div>
          ))}
          <div className="space-y-1">
            <label htmlFor="sg-beginn" className="text-xs text-slate-500">{t("Voraussichtlicher Beginn")}</label>
            <Input id="sg-beginn" data-testid="sg-beginn" type="date" className="h-8" value={s.beginn ?? ""} onChange={(e) => setze("beginn", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="sg-dauer_text" className="text-xs text-slate-500">{t("Voraussichtliche Dauer")}</label>
            <Input id="sg-dauer_text" data-testid="sg-dauer_text" className="h-8" value={s.dauer_text ?? ""} onChange={(e) => setze("dauer_text", e.target.value)} placeholder={t("z. B. 14 Monate")} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <p className="text-sm font-medium mb-1">{t("Gefährdungsmatrix: besonders gefährliche Arbeiten (Anhang II BaustellV)")}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-1 px-2">{t("Nr.")}</th>
                <th className="py-1 px-2">{t("Arbeit")}</th>
                <th className="py-1 px-2">{t("Typisch bei Gewerk (Faustregel)")}</th>
                <th className="py-1 px-2">{t("Im Projekt?")}</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((z) => (
                <tr key={z.nr} className="border-b last:border-0 align-top" data-testid="sg-matrix-zeile" data-nr={z.nr} data-typisch={z.typisch.join("|")}>
                  <td className="py-1 px-2">{z.nr}</td>
                  <td className="py-1 px-2 text-xs">{t(z.label)}</td>
                  <td className="py-1 px-2 text-xs text-amber-800">{z.typisch.join(", ") || "—"}</td>
                  <td className="py-1 px-2">
                    <select data-testid={`sg-z-${z.nr}`} aria-label={`${t("Im Projekt?")} ${z.nr}`} className="h-8 rounded-md border border-input bg-transparent px-1 text-xs"
                      value={z.zutreffend === true ? "ja" : z.zutreffend === false ? "nein" : ""} onChange={(e) => setzeGefahr(z.nr, e.target.value)}>
                      <option value="">{t("offen")}</option><option value="ja">{t("ja")}</option><option value="nein">{t("nein")}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gewerke.length === 0 && <p className="text-xs text-slate-500 mt-1">{t("Keine Gewerke im Bauzeitenplan — die Spalte „typisch“ bleibt leer.")}</p>}
        </div>
        {gespeichert && <p className="text-sm text-emerald-700" data-testid="sg-gespeichert">{t("Gespeichert")}</p>}
        {meldung && <p className="text-sm text-emerald-700" data-testid="sg-meldung">{meldung}</p>}
        {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="sg-fehler">{fehler}</p>}
      </CardContent>
    </Card>
  );
}
