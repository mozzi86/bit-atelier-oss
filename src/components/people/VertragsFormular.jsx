// VertragsFormular.jsx — Vertrag anlegen/ersetzen (Plan 80-06, Task 4). Ein
// Vertrag im Status 'entwurf' (kein `id`-loses Feld `ersetzt_vertrag_id`) wird
// bearbeitet; ein bereits unterschriebener/gekündigter Vertrag wird NIE
// überschrieben — "Neuer Vertrag (ersetzt den bisherigen)" reicht hierher
// einen ID-losen Entwurf MIT `ersetzt_vertrag_id` herein (VertragsTabelle →
// VertraegeReiter): das Speichern legt dann einen neuen Datensatz an und
// setzt danach den alten auf `status:'ersetzt'`.
//
// D-P80-17: alle Prüfungen (pruefeVertrag, kuendigungsfristGesetzlich) sind
// `warn` — Speichern bleibt in jedem Fall möglich, mit dem Satz "Keine
// Rechtsberatung — im Zweifel Fachanwalt fragen." neben der Kündigungsfrist.
//
// Native <input>/<label>/<select>/<textarea> statt shadcn-Wrapper (CLAUDE.md
// "shadcn-tsc-Altlast", dasselbe Muster wie MitarbeiterFormular.jsx).
//
// In:  {vertrag, mitarbeiterListe, vertraege, gehaelter, regelWert, onClose, onGespeichert}.
// Out: UI, ein create/update über bitApi.personal.Arbeitsvertrag(+.Gehaltsaenderung optional nicht hier).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import FormModal from "@core/components/common/FormModal";
import { PERSONENARTEN, anzeigeName } from "@/lib/people/mitarbeiter.js";
import { VERTRAGSARTEN, pruefeVertrag, probezeitEnde } from "@/lib/people/vertrag.js";
import { kuendigungsfristGesetzlich } from "@/lib/people/kuendigung.js";
import PersonalDokumente from "./PersonalDokumente.jsx";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte?.[k] ?? ""));
}

/** Sachgründe der Befristung, § 14 Abs. 1 S. 2 Nr. 1–8 TzBfG. */
const SACHGRUENDE = Object.freeze([
  { key: "voruebergehender_bedarf", label: "Vorübergehender betrieblicher Bedarf (Nr. 1)" },
  { key: "anschluss_ausbildung", label: "Erleichterung des Übergangs nach Ausbildung/Studium (Nr. 2)" },
  { key: "vertretung", label: "Vertretung einer anderen Arbeitskraft (Nr. 3)" },
  { key: "eigenart_leistung", label: "Eigenart der Arbeitsleistung (Nr. 4)" },
  { key: "erprobung", label: "Erprobung (Nr. 5)" },
  { key: "person_gruende", label: "In der Person liegende Gründe (Nr. 6)" },
  { key: "haushaltsmittel", label: "Haushaltsmittel für befristete Beschäftigung (Nr. 7)" },
  { key: "gerichtlicher_vergleich", label: "Gerichtlicher Vergleich (Nr. 8)" },
]);

/**
 * Leerer Entwurf mit den Bürostandard-Vorbelegungen aus dem Regelwerk.
 * @param {object|null} vertrag vorhandener Entwurf (Bearbeiten) oder eine
 *   Kopie ohne `id` (Ersetzen, trägt bereits `ersetzt_vertrag_id`) — beides
 *   wird 1:1 übernommen; nur ein wirklich leeres Formular bekommt die Standardwerte.
 * @param {(id: string) => any} regelWert
 * @returns {object}
 */
function entwurfAus(vertrag, regelWert) {
  if (vertrag) return structuredClone(vertrag);
  return {
    mitarbeiter_id: "", vertragsart: "unbefristet", sachgrund: null, status: "entwurf",
    beginn: "", ende: "", probezeit_monate: regelWert("personal.probezeit_standard_monate") ?? 6,
    wochenstunden: regelWert("personal.wochenstunden_standard") ?? 40,
    arbeitstage_woche: regelWert("personal.arbeitstage_standard") ?? 5,
    urlaub_tage_jahr: regelWert("personal.urlaub_buero_standard") ?? 28,
    zusatzurlaub_tage: 0, kuendigung: { regel: "gesetzlich", text: "" }, verlaengerungen: [],
    unterschrieben_am: "", schriftform_vor_beginn: false, nachweis_ausgehaendigt_am: "",
    beendigung: {}, ersetzt_vertrag_id: null,
  };
}

/**
 * @param {{
 *   vertrag: object|null, mitarbeiterListe: object[], vertraege: object[], gehaelter: object[],
 *   dokumente?: object[], onDokumenteGespeichert?: () => void,
 *   regelWert: (id: string, stichtag?: string) => any, onClose: () => void, onGespeichert?: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function VertragsFormular({ vertrag, mitarbeiterListe, vertraege, gehaelter, dokumente, onDokumenteGespeichert, regelWert, onClose, onGespeichert }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = React.useState(() => entwurfAus(vertrag, regelWert));
  const [speichern, setSpeichern] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const istBearbeiten = Boolean(vertrag?.id);
  const istErsatz = !istBearbeiten && Boolean(entwurf.ersetzt_vertrag_id);

  const setzen = (feld, wert) => setEntwurf((e) => ({ ...e, [feld]: wert }));

  // Person: nur Personenarten mit Arbeitsrecht ODER "frei" (freier Dienstvertrag) —
  // Gesellschafter/Inhaber:in haben keinen Arbeitsvertrag (mitarbeiter.js).
  const waehlbarePersonen = mitarbeiterListe.filter((m) => {
    const art = PERSONENARTEN.find((p) => p.key === m.art);
    return art?.arbeitsrecht || art?.key === "frei";
  });
  const mitarbeiter = mitarbeiterListe.find((m) => m.id === entwurf.mitarbeiter_id) ?? null;
  const istBefristet = typeof entwurf.vertragsart === "string" && entwurf.vertragsart.startsWith("befristet");

  // Live-Hinweise (D-P80-17: immer nur warn, Speichern bleibt möglich).
  const eigeneHistorie = vertraege.filter((v) => v.mitarbeiter_id === entwurf.mitarbeiter_id && v.id !== vertrag?.id);
  const hinweise = mitarbeiter ? pruefeVertrag(entwurf, { mitarbeiter, historie: eigeneHistorie, gehaelter }, regelWert) : [];

  // Gesetzliche Kündigungsfrist für den Fall "Zugang heute" — reine Information,
  // keine Rechtsberatung (Satz erscheint immer daneben).
  const heute = heuteLokal();
  const probezeitBisHeute = entwurf.beginn && entwurf.probezeit_monate ? probezeitEnde(entwurf.beginn, entwurf.probezeit_monate) : null;
  const kuendigungsfrist = mitarbeiter && entwurf.beginn
    ? kuendigungsfristGesetzlich({ eintritt: entwurf.beginn, zugang: heute, seite: "ag", probezeitEnde: probezeitBisHeute }, regelWert)
    : null;

  const speichernAusfuehren = async (e) => {
    e.preventDefault();
    setSpeichern(true);
    setFehler(null);
    try {
      const client = /** @type {any} */ (bitApi.personal).Arbeitsvertrag;
      const sauber = { ...entwurf };
      delete sauber.id;
      if (istBearbeiten) {
        await client.update(vertrag.id, sauber);
      } else {
        await client.create(sauber);
        // Ersetzen statt überschreiben: der alte Vertrag bekommt status:'ersetzt'
        // — ERST nachdem der neue erfolgreich angelegt ist (kein Datenverlust
        // bei einem Fehler mittendrin).
        if (entwurf.ersetzt_vertrag_id) {
          await client.update(entwurf.ersetzt_vertrag_id, { status: "ersetzt" });
        }
      }
      onGespeichert?.();
      onClose();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setSpeichern(false);
    }
  };

  return (
    <FormModal title={istErsatz ? t("Neuer Vertrag (ersetzt den bisherigen)") : istBearbeiten ? t("Vertrag bearbeiten") : t("Vertrag anlegen")} onClose={onClose}>
      <form onSubmit={speichernAusfuehren} className="space-y-6" data-testid="vertrags-formular">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Person und Vertragsart")}</legend>
          <div>
            <label htmlFor="vf-person" className={BESCHRIFTUNG}>{t("Person")}</label>
            <select id="vf-person" required disabled={istBearbeiten || istErsatz} className={EINGABE} value={entwurf.mitarbeiter_id} onChange={(e) => setzen("mitarbeiter_id", e.target.value)}>
              <option value="" disabled>{t("Auswählen")}</option>
              {waehlbarePersonen.map((m) => <option key={m.id} value={m.id}>{anzeigeName(m)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="vf-art" className={BESCHRIFTUNG}>{t("Vertragsart")}</label>
            <select id="vf-art" className={EINGABE} value={entwurf.vertragsart} onChange={(e) => setzen("vertragsart", e.target.value)}>
              {VERTRAGSARTEN.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
            </select>
          </div>
          {entwurf.vertragsart === "befristet_sachgrund" && (
            <div>
              <label htmlFor="vf-sachgrund" className={BESCHRIFTUNG}>{t("Sachgrund")}</label>
              <select id="vf-sachgrund" className={EINGABE} value={entwurf.sachgrund || ""} onChange={(e) => setzen("sachgrund", e.target.value)}>
                <option value="" disabled>{t("Auswählen")}</option>
                {SACHGRUENDE.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="vf-beginn" className={BESCHRIFTUNG}>{t("Beginn")}</label>
            <input id="vf-beginn" type="date" required className={EINGABE} value={entwurf.beginn || ""} onChange={(e) => setzen("beginn", e.target.value)} />
          </div>
          {istBefristet && (
            <div>
              <label htmlFor="vf-ende" className={BESCHRIFTUNG}>{t("Ende")}</label>
              <input id="vf-ende" type="date" className={EINGABE} value={entwurf.ende || ""} onChange={(e) => setzen("ende", e.target.value)} />
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Konditionen")}</legend>
          <div>
            <label htmlFor="vf-probezeit" className={BESCHRIFTUNG}>{t("Probezeit (Monate)")}</label>
            {/* Kein `max` (D-P80-17): eine Probezeit über 6 Monate muss erfassbar bleiben,
                pruefeVertrag warnt nur — ein natives max-Attribut würde die Formularabgabe
                sonst blockieren, bevor die Warnung überhaupt greifen kann. */}
            <input id="vf-probezeit" type="number" min={0} className={EINGABE} value={entwurf.probezeit_monate ?? 0} onChange={(e) => setzen("probezeit_monate", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="vf-wochenstunden" className={BESCHRIFTUNG}>{t("Wochenstunden")}</label>
            {/* Kein `max` (D-P80-17), s. o. bei Probezeit — § 3 ArbZG warnt über pruefeVertrag. */}
            <input id="vf-wochenstunden" type="number" min={1} className={EINGABE} value={entwurf.wochenstunden ?? 0} onChange={(e) => setzen("wochenstunden", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="vf-arbeitstage" className={BESCHRIFTUNG}>{t("Arbeitstage/Woche")}</label>
            <input id="vf-arbeitstage" type="number" min={1} max={7} className={EINGABE} value={entwurf.arbeitstage_woche ?? 0} onChange={(e) => setzen("arbeitstage_woche", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="vf-urlaub" className={BESCHRIFTUNG}>{t("Urlaub (Tage/Jahr)")}</label>
            <input id="vf-urlaub" type="number" min={0} className={EINGABE} value={entwurf.urlaub_tage_jahr ?? 0} onChange={(e) => setzen("urlaub_tage_jahr", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="vf-zusatzurlaub" className={BESCHRIFTUNG}>{t("Zusatzurlaub (Tage/Jahr)")}</label>
            <input id="vf-zusatzurlaub" type="number" min={0} className={EINGABE} value={entwurf.zusatzurlaub_tage ?? 0} onChange={(e) => setzen("zusatzurlaub_tage", Number(e.target.value))} />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("Ohne Grund erfassen (Art. 9 DSGVO).")}</p>
          </div>
          <div>
            <label htmlFor="vf-verlaengerungen" className={BESCHRIFTUNG}>{t("Verlängerungen")}</label>
            <input id="vf-verlaengerungen" type="number" min={0} className={EINGABE} value={Array.isArray(entwurf.verlaengerungen) ? entwurf.verlaengerungen.length : 0}
              onChange={(e) => setzen("verlaengerungen", Array.from({ length: Math.max(0, Number(e.target.value)) }, (_, i) => (entwurf.verlaengerungen || [])[i] || {}))} />
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Form und Nachweise")}</legend>
          <div>
            <label htmlFor="vf-unterschrieben" className={BESCHRIFTUNG}>{t("Unterschrieben am")}</label>
            <input id="vf-unterschrieben" type="date" className={EINGABE} value={entwurf.unterschrieben_am || ""} onChange={(e) => setzen("unterschrieben_am", e.target.value)} />
          </div>
          <div>
            <label htmlFor="vf-nachwg" className={BESCHRIFTUNG}>{t("NachwG-Nachweis ausgehändigt am")}</label>
            <input id="vf-nachwg" type="date" className={EINGABE} value={entwurf.nachweis_ausgehaendigt_am || ""} onChange={(e) => setzen("nachweis_ausgehaendigt_am", e.target.value)} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input id="vf-schriftform" type="checkbox" checked={Boolean(entwurf.schriftform_vor_beginn)} onChange={(e) => setzen("schriftform_vor_beginn", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
            <label htmlFor="vf-schriftform" className={BESCHRIFTUNG}>{t("Schriftform vor Beginn nachgewiesen")}</label>
          </div>
          <div>
            <label htmlFor="vf-kuendigungsregel" className={BESCHRIFTUNG}>{t("Kündigungsregel")}</label>
            <select id="vf-kuendigungsregel" className={EINGABE} value={entwurf.kuendigung?.regel || "gesetzlich"} onChange={(e) => setzen("kuendigung", { ...entwurf.kuendigung, regel: e.target.value })}>
              <option value="gesetzlich">{t("Gesetzlich (§ 622 BGB)")}</option>
              <option value="vertraglich">{t("Vertraglich abweichend")}</option>
            </select>
          </div>
          {entwurf.kuendigung?.regel === "vertraglich" && (
            <div className="sm:col-span-2">
              <label htmlFor="vf-kuendigungstext" className={BESCHRIFTUNG}>{t("Vertragliche Kündigungsregel (Text)")}</label>
              <textarea id="vf-kuendigungstext" rows={2} className={EINGABE} value={entwurf.kuendigung?.text || ""} onChange={(e) => setzen("kuendigung", { ...entwurf.kuendigung, text: e.target.value })} />
            </div>
          )}
        </fieldset>

        {mitarbeiter && Array.isArray(dokumente) && (
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Vertragsdokument")}</legend>
            <PersonalDokumente mitarbeiterId={mitarbeiter.id} kategorieFest="vertrag" dokumente={dokumente} regelWert={regelWert} onGespeichert={() => onDokumenteGespeichert?.()} />
          </fieldset>
        )}

        {kuendigungsfrist && (
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="kuendigungsfrist-vorschau">
            <p className="font-medium text-slate-700 dark:text-slate-200">
              {t("Gesetzliche Kündigungsfrist bei Zugang heute")}: {kuendigungsfrist.letzterTag} ({kuendigungsfrist.norm})
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
              {kuendigungsfrist.warnungen.map((w, i) => <li key={i}>{t(w.text)} ({w.norm})</li>)}
            </ul>
            <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">{t("Keine Rechtsberatung — im Zweifel Fachanwalt fragen.")}</p>
          </div>
        )}

        {hinweise.length > 0 && (
          <ul className="space-y-1" data-testid="vertrag-hinweise">
            {hinweise.map((h, i) => (
              <li key={i} className="text-xs text-amber-700 dark:text-amber-300">
                {/* Translate the unfilled template, then fill: h.text already carries the
                    numbers and therefore never matches a dictionary key (EN mode). */}
                {fuellen(t(h.schluessel), h.werte)}{h.norm ? ` (${h.norm})` : ""}
              </li>
            ))}
          </ul>
        )}
        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            {t("Abbrechen")}
          </button>
          <button type="submit" disabled={speichern || !entwurf.mitarbeiter_id} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {t("Speichern")}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
