// PersonalDokumente.jsx — Anhänge einer Person ODER einer Bewerbung (Plan
// 80-06, Task 6): generisch, EIN Baustein für beide Reiter-Familien (Vertrag
// im Vertragsformular, Personalakte im Detail, 80-08 nutzt ihn für
// Bewerbungsunterlagen). Der Inhalt liegt IMMER getrennt vom Datensatz in
// `personal.dateien` (bitApi.personal.dateien) — die Personaldokument-Zeile
// trägt nur `datei_ref`, NIE `data`.
//
// In:  {mitarbeiterId} ODER {bewerbungId} (genau eines), dokumente
//      (Personaldokument-Liste), regelWert, onGespeichert. Out: UI.

import React from "react";
import { FileText, Trash2 } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { fileToDataUrl, fmtBytes } from "@core/lib/pdf";
import { fristEnde } from "@core/lib/kalender/fristen.js";
import { neueId } from "@core/api/sammlungKern.js";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import DateiKnopf from "@/components/accounting/gemeinsam/DateiKnopf.jsx";

/** Kategorien für Anhänge einer Person (mitarbeiterId) — Bewerbungen (80-08) nutzen ihre eigenen. */
const KATEGORIEN_MITARBEITER = Object.freeze([
  { key: "vertrag", label: "Vertrag" },
  { key: "nachweis", label: "Nachweis" },
  { key: "zeugnis", label: "Zeugnis" },
  { key: "qualifikation", label: "Qualifikation" },
  { key: "kammer", label: "Kammer" },
  { key: "sonstiges", label: "Sonstiges" },
]);

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * Data-URL ('data:<mime>;base64,<...>', wie `fileToDataUrl`/`personalDb.dateien`
 * sie speichern) zu einem Blob — rein lokal über `atob` + `Uint8Array`, ohne
 * den globalen Netzwerkabruf zu benutzen: der Leck-Wächter
 * (personalLeck.test.js, DS-08) verbietet dessen Aufrufmuster im ganzen
 * Personal-Code, weil er ihn nicht von einem echten Fernzugriff unterscheiden kann.
 * @param {string} dataUrl
 * @returns {Blob}
 */
function dataUrlZuBlob(dataUrl) {
  const [kopf, base64 = ""] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(kopf)?.[1] || "application/octet-stream";
  const binaer = atob(base64);
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * @param {{mitarbeiterId?: string, bewerbungId?: string, dokumente: object[],
 *   regelWert: (id: string) => any, onGespeichert: () => void, kategorieFest?: string}} props
 *   `kategorieFest`: eingebettet in einen Kontext mit fester Kategorie (z. B.
 *   das Vertragsformular, Kategorie "vertrag") — versteckt die Auswahl und
 *   zeigt nur Anhänge dieser Kategorie.
 * @returns {React.ReactElement}
 */
export default function PersonalDokumente({ mitarbeiterId, bewerbungId, dokumente, regelWert, onGespeichert, kategorieFest }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [kategorie, setKategorie] = React.useState(kategorieFest || "sonstiges");
  const [hochladen, setHochladen] = React.useState(false);
  const [loeschendId, setLoeschendId] = React.useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  const eigene = dokumente
    .filter((d) => (mitarbeiterId ? d.mitarbeiter_id === mitarbeiterId : d.bewerbung_id === bewerbungId))
    .filter((d) => !kategorieFest || d.kategorie === kategorieFest);
  const maxMb = typeof regelWert === "function" ? regelWert("personal.datei_max_mb") : null;
  const maxBytes = (typeof maxMb === "number" ? maxMb : 7) * 1024 * 1024;

  const hochgeladen = async (/** @type {File} */ datei) => {
    setFehler(null);
    if (datei.size > maxBytes) {
      setFehler(fuellen(t("Datei zu groß ({groesse}, höchstens {max} MB)."), { groesse: fmtBytes(datei.size), max: maxMb ?? 7 }));
      return;
    }
    setHochladen(true);
    try {
      const data = await fileToDataUrl(datei);
      const dateiId = neueId();
      await /** @type {any} */ (bitApi.personal).dateien.put(dateiId, { mime: datei.type || "application/octet-stream", name: datei.name, data });
      // Erst NACH dem Anlegen der Datei die Metadaten-Zeile — ohne `data`
      // (der Inhalt lebt ausschließlich in personal.dateien).
      await /** @type {any} */ (bitApi.personal).Personaldokument.create({
        mitarbeiter_id: mitarbeiterId || null,
        bewerbung_id: bewerbungId || null,
        kategorie,
        name: datei.name,
        mime: datei.type || "application/octet-stream",
        groesse_bytes: datei.size,
        datei_ref: dateiId,
      });
      onGespeichert();
    } catch (err) {
      const nachricht = /** @type {any} */ (err)?.name === "SpeicherVollError"
        ? t("Der Browser-Speicher ist voll — die Datei konnte nicht gespeichert werden.")
        : err?.message || String(err);
      setFehler(nachricht);
    } finally {
      setHochladen(false);
    }
  };

  const herunterladen = async (/** @type {object} */ dok) => {
    setFehler(null);
    try {
      const datei = await /** @type {any} */ (bitApi.personal).dateien.get(dok.datei_ref);
      if (!datei?.data) { setFehler(t("Datei nicht gefunden.")); return; }
      const blob = dataUrlZuBlob(datei.data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = dok.name || "dokument";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFehler(err?.message || String(err));
    }
  };

  const entfernen = async (/** @type {object} */ dok) => {
    const ok = await bestaetige({
      titel: `"${dok.name}" ${t("entfernen?")}`,
      text: t("Die Datei wird zusammen mit ihren Metadaten endgültig gelöscht."),
      bestaetigen: t("Entfernen"),
      gefahr: true,
    });
    if (!ok) return;
    setLoeschendId(dok.id);
    try {
      // File first, metadata second — on purpose: if the second call fails, the
      // row stays visible and a retry works (dateien.delete is idempotent in
      // personalDb and personalRouter). The reverse order could leave an
      // invisible, unreachable file with personal data behind (E-14).
      await /** @type {any} */ (bitApi.personal).dateien.delete(dok.datei_ref);
      await /** @type {any} */ (bitApi.personal).Personaldokument.delete(dok.id);
      onGespeichert();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setLoeschendId(null);
    }
  };

  return (
    <div data-testid="personal-dokumente">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {!kategorieFest && (
          <>
            <label htmlFor="pd-kategorie" className="sr-only">{t("Kategorie")}</label>
            <select id="pd-kategorie" className="h-9 rounded-md border border-slate-300 px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" value={kategorie} onChange={(e) => setKategorie(e.target.value)}>
              {KATEGORIEN_MITARBEITER.map((k) => <option key={k.key} value={k.key}>{t(k.label)}</option>)}
            </select>
          </>
        )}
        <DateiKnopf onDatei={hochgeladen} disabled={hochladen}>{t("Datei hochladen")}</DateiKnopf>
      </div>
      {fehler && <p role="alert" className="mb-2 text-sm text-rose-600">{fehler}</p>}

      {eigene.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("Noch keine Anhänge.")}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="personal-dokumente-liste">
          {eigene.map((d) => {
            // [ASSUMED] grober Aufbewahrungshinweis (Personalakte, 3 Jahre ab
            // Anlage) — die genaue Löschfrist-Prüfung gehört zu 80-10.
            const aufbewahrungBis = d.created_date ? fristEnde(String(d.created_date).slice(0, 10), { jahre: regelWert?.("personal.aufbewahrung_personalakte_jahre") ?? 3 }) : null;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
                <button type="button" onClick={() => herunterladen(d)} className="inline-flex items-center gap-1.5 text-left text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{d.name}</span>
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t(KATEGORIEN_MITARBEITER.find((k) => k.key === d.kategorie)?.label || d.kategorie)} · {fmtBytes(d.groesse_bytes)}
                  {aufbewahrungBis ? ` · ${t("Aufbewahrung bis")} ${fmtDatum(aufbewahrungBis)}` : ""}
                </span>
                <button type="button" onClick={() => entfernen(d)} disabled={loeschendId === d.id}
                  aria-label={`"${d.name}" ${t("entfernen")}`}
                  className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
