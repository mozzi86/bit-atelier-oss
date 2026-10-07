// AustrittDialog.jsx — Austritt starten (Plan 80-09, Task 4): Art der
// Beendigung und Zugangstag, der letzte Tag daraus (kuendigungsfristGesetzlich
// bzw. das Vertragsende bei Befristungsende), mit den drei festen Warnungen
// und "Keine Rechtsberatung". Legt einen Vorgang `austritt` aus
// VORLAGE_AUSTRITT an und schreibt `beendigung` in den aktiven Vertrag. Der
// Mitarbeitende bleibt `aktiv`, bis VorgangsCheckliste.jsx "Austritt
// abschließen" bestätigt (dort erst `status:'ausgeschieden'`).
//
// In:  {mitarbeiter, vertraege, regelWert, onClose, onAngelegt}. Out: UI, ein
//      create (Personalvorgang) + update (Arbeitsvertrag.beendigung) über
//      bitApi.personal.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import FormModal from "@core/components/common/FormModal";
import { useEinstellung } from "@core/lib/useEinstellung";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { aktiverVertrag, probezeitEnde } from "@/lib/people/vertrag.js";
import { kuendigungsfristGesetzlich } from "@/lib/people/kuendigung.js";
import { VORLAGE_AUSTRITT, vorlageWirksam, checklisteAusVorlage } from "@/lib/people/onboarding.js";

/** Beendigungsarten (Task 4). "ag"/"an" nutzen kuendigungsfristGesetzlich; "aufhebung" und "befristungsende" haben ihren letzten Tag anderswo. */
const ARTEN = Object.freeze([
  { key: "ag", label: "Kündigung durch den Arbeitgeber" },
  { key: "an", label: "Kündigung durch den Arbeitnehmer" },
  { key: "aufhebung", label: "Aufhebungsvertrag" },
  { key: "befristungsende", label: "Befristungsende" },
]);

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * @param {{mitarbeiter: object, vertraege: object[], regelWert: (id: string) => any,
 *   onClose: () => void, onAngelegt: (vorgang: object) => void}} props
 * @returns {React.ReactElement}
 */
export default function AustrittDialog({ mitarbeiter, vertraege, regelWert, onClose, onAngelegt }) {
  const { t } = useI18n();
  const heute = heuteLokal();
  const vertrag = aktiverVertrag(vertraege, mitarbeiter.id, heute);
  // Setting "personal.vorlagen" (Einstellungen › Personal-Vorlagen, 80-09
  // Task 5) — existiert erst nach der ersten Anpassung des Büros (Behavior 10).
  const [vorlagenAnpassung] = useEinstellung("personal.vorlagen", null);
  const vorlageAustritt = vorlageWirksam(VORLAGE_AUSTRITT, vorlagenAnpassung?.austritt);
  const [art, setArt] = React.useState("ag");
  const [zugang, setZugang] = React.useState(heute);
  const [aufhebungTag, setAufhebungTag] = React.useState(heute);
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  const probezeit = vertrag?.probezeit_monate ? probezeitEnde(vertrag.beginn, vertrag.probezeit_monate) : null;

  let letzterTag = null;
  let norm = "";
  /** @type {ReadonlyArray<{schwere: string, text: string, norm: string}>} */
  let warnungen = [];
  if (art === "befristungsende") {
    letzterTag = vertrag?.ende || null;
    norm = "§ 15 Abs. 2 TzBfG";
  } else if (art === "aufhebung") {
    letzterTag = aufhebungTag;
    norm = t("einvernehmlich vereinbart");
  } else {
    const ergebnis = kuendigungsfristGesetzlich({ eintritt: mitarbeiter.eintritt, zugang, seite: art === "an" ? "an" : "ag", probezeitEnde: probezeit }, regelWert);
    letzterTag = ergebnis.letzterTag;
    norm = ergebnis.norm;
    warnungen = ergebnis.warnungen;
  }

  const anlegen = async () => {
    if (!letzterTag) { setFehler(t("Letzter Tag konnte nicht ermittelt werden — Vertrag ohne Ende bei Befristungsende?")); return; }
    setLaeuft(true);
    setFehler(null);
    try {
      const schritte = checklisteAusVorlage(vorlageAustritt, mitarbeiter, letzterTag);
      const vorgang = await /** @type {any} */ (bitApi.personal).Personalvorgang.create({
        art: "austritt", mitarbeiter_id: mitarbeiter.id, bewerbung_id: null,
        arbeitsvertrag_id: vertrag?.id || null, stichtag: letzterTag, status: "offen",
        schritte, ausstattung: [],
      });
      if (vertrag) {
        await /** @type {any} */ (bitApi.personal).Arbeitsvertrag.update(vertrag.id, {
          beendigung: { art, zugang: art === "aufhebung" ? null : zugang, letzter_tag: letzterTag },
        });
      }
      onAngelegt?.(vorgang);
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <FormModal title={t("Austritt starten")} onClose={onClose}>
      <div className="space-y-4" data-testid="austritt-dialog">
        <div>
          <label htmlFor="ad-art" className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Art")}</label>
          <select id="ad-art" value={art} onChange={(e) => setArt(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
            {ARTEN.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
          </select>
        </div>

        {art !== "befristungsende" && art !== "aufhebung" && (
          <div>
            <label htmlFor="ad-zugang" className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Zugang am")}</label>
            <input id="ad-zugang" type="date" value={zugang} onChange={(e) => setZugang(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </div>
        )}
        {art === "aufhebung" && (
          <div>
            <label htmlFor="ad-tag" className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Letzter Tag")}</label>
            <input id="ad-tag" type="date" value={aufhebungTag} onChange={(e) => setAufhebungTag(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </div>
        )}

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="ad-letzter-tag">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t("Letzter Tag")}: {fmtDatum(letzterTag)}
          </p>
          {norm && <p className="text-xs text-slate-500 dark:text-slate-400">{norm}</p>}
          {warnungen.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-200">
              {warnungen.map((w, i) => <li key={i}>⚠ {t(w.text)} ({w.norm})</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">{t("Keine Rechtsberatung.")}</p>
        </div>

        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={laeuft}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {t("Abbrechen")}
          </button>
          <button type="button" onClick={anlegen} disabled={laeuft || !letzterTag}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {t("Austritt starten")}
          </button>
        </div>
      </div>
    </FormModal>
  );
}
