// GehaltsVerlauf.jsx — Gehaltshistorie eines Vertrags (Plan 80-06, Task 5):
// NUR anhängend. Es gibt weder Bearbeiten- noch Löschen-Knopf — die Historie
// selbst ist der Nachweis (DSGVO-Rechenschaft). "Korrektur" legt KEINE
// Änderung der bestehenden Zeile an, sondern eine neue mit `grund:'korrektur'`.
//
// In:  {arbeitsvertragId, mitarbeiterId, einheit, gehaelter, onGespeichert}.
// Out: UI, ein create über bitApi.personal.Gehaltsaenderung.

import React from "react";
import { Plus, RotateCcw } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import FormModal from "@core/components/common/FormModal";
import { Betrag } from "./GehaltSichtbarkeit.jsx";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

// Label "Anfangsgehalt" statt des bloßen Wortes "Einstellung" (das ist in
// i18n.jsx bereits "Setting" — eine Bürowerte-Einstellung, nicht die
// Ersteinstellung eines Vertrags; Wörterbuch-Doppel vermieden, 80-RESEARCH
// Pitfall 17). Der gespeicherte Wert `art:"einstellung"` (79-02-Seed) bleibt
// unverändert — nur die Anzeige heißt hier anders.
const ARTEN = Object.freeze([
  { key: "einstellung", label: "Anfangsgehalt" },
  { key: "erhoehung", label: "Erhöhung" },
  { key: "korrektur", label: "Korrektur" },
  { key: "sonstiges", label: "Sonstiges" },
]);

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Formular für EINEN neuen (anhängenden) Gehaltsschritt.
 * @param {{arbeitsvertragId: string, mitarbeiterId: string, artVorbelegt: string, onClose: () => void, onGespeichert: () => void}} props
 * @returns {React.ReactElement}
 */
function GehaltsSchrittFormular({ arbeitsvertragId, mitarbeiterId, artVorbelegt, onClose, onGespeichert }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = React.useState({
    gueltig_ab: heuteLokal(), art: artVorbelegt, brutto_eur: "", zusatz: "", grund: artVorbelegt === "korrektur" ? "Korrektur" : "", naechste_pruefung: "",
  });
  const [speichern, setSpeichern] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  const setzen = (feld, wert) => setEntwurf((e) => ({ ...e, [feld]: wert }));

  const submit = async (e) => {
    e.preventDefault();
    setSpeichern(true);
    setFehler(null);
    try {
      await /** @type {any} */ (bitApi.personal).Gehaltsaenderung.create({
        arbeitsvertrag_id: arbeitsvertragId,
        mitarbeiter_id: mitarbeiterId,
        gueltig_ab: entwurf.gueltig_ab,
        art: entwurf.art,
        brutto_eur: Number(entwurf.brutto_eur) || 0,
        zusatz: entwurf.zusatz ? entwurf.zusatz.split(",").map((s) => s.trim()).filter(Boolean) : [],
        grund: entwurf.grund,
        naechste_pruefung: entwurf.naechste_pruefung || null,
      });
      onGespeichert();
      onClose();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setSpeichern(false);
    }
  };

  return (
    <FormModal title={artVorbelegt === "korrektur" ? t("Korrektur") : t("Gehaltsschritt hinzufügen")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" data-testid="gehaltsschritt-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="gv-ab" className={BESCHRIFTUNG}>{t("gültig ab")}</label>
            <input id="gv-ab" type="date" required className={EINGABE} value={entwurf.gueltig_ab} onChange={(e) => setzen("gueltig_ab", e.target.value)} />
          </div>
          <div>
            <label htmlFor="gv-art" className={BESCHRIFTUNG}>{t("Art")}</label>
            <select id="gv-art" className={EINGABE} value={entwurf.art} onChange={(e) => setzen("art", e.target.value)}>
              {ARTEN.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="gv-betrag" className={BESCHRIFTUNG}>{t("Betrag")}</label>
            <input id="gv-betrag" type="number" min={0} step="0.01" required className={EINGABE} value={entwurf.brutto_eur} onChange={(e) => setzen("brutto_eur", e.target.value)} />
          </div>
          <div>
            <label htmlFor="gv-pruefung" className={BESCHRIFTUNG}>{t("Nächste Prüfung")}</label>
            <input id="gv-pruefung" type="date" className={EINGABE} value={entwurf.naechste_pruefung} onChange={(e) => setzen("naechste_pruefung", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="gv-zusatz" className={BESCHRIFTUNG}>{t("Zusatzleistungen (kommagetrennt)")}</label>
            <input id="gv-zusatz" className={EINGABE} value={entwurf.zusatz} onChange={(e) => setzen("zusatz", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="gv-grund" className={BESCHRIFTUNG}>{t("Grund")}</label>
            <input id="gv-grund" required className={EINGABE} value={entwurf.grund} onChange={(e) => setzen("grund", e.target.value)} />
          </div>
        </div>
        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            {t("Abbrechen")}
          </button>
          <button type="submit" disabled={speichern} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {t("Speichern")}
          </button>
        </div>
      </form>
    </FormModal>
  );
}

/**
 * @param {{arbeitsvertragId: string, mitarbeiterId: string, einheit?: 'monat'|'stunde', gehaelter: object[], onGespeichert: () => void}} props
 * @returns {React.ReactElement}
 */
export default function GehaltsVerlauf({ arbeitsvertragId, mitarbeiterId, einheit = "monat", gehaelter, onGespeichert }) {
  const { t } = useI18n();
  const [formular, setFormular] = React.useState(/** @type {'hinzufuegen'|'korrektur'|null} */ (null));

  const zeilen = [...gehaelter.filter((g) => g.arbeitsvertrag_id === arbeitsvertragId)].sort((a, b) => (a.gueltig_ab < b.gueltig_ab ? 1 : -1));

  return (
    <div data-testid="gehaltsverlauf">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Gehaltsverlauf")}</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => setFormular("hinzufuegen")} data-testid="gehaltsschritt-hinzufuegen"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("Gehaltsschritt hinzufügen")}
          </button>
          <button type="button" onClick={() => setFormular("korrektur")} data-testid="gehalt-korrektur"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t("Korrektur")}
          </button>
        </div>
      </div>
      {zeilen.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("Noch kein Gehaltsschritt erfasst.")}</p>
      ) : (
        <ul className="space-y-1.5 text-sm" data-testid="gehaltsverlauf-liste">
          {zeilen.map((g) => (
            <li key={g.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{fmtDatum(g.gueltig_ab)} — {t(ARTEN.find((a) => a.key === g.art)?.label || g.art)}</span>
                <Betrag wert={g.brutto_eur} einheit={einheit} />
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {g.grund}{g.naechste_pruefung ? ` · ${t("nächste Prüfung")} ${fmtDatum(g.naechste_pruefung)}` : ""}
                {Array.isArray(g.zusatz) && g.zusatz.length > 0 ? ` · ${g.zusatz.join(", ")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {formular && (
        <GehaltsSchrittFormular
          arbeitsvertragId={arbeitsvertragId}
          mitarbeiterId={mitarbeiterId}
          artVorbelegt={formular === "korrektur" ? "korrektur" : "erhoehung"}
          onClose={() => setFormular(null)}
          onGespeichert={onGespeichert}
        />
      )}
    </div>
  );
}
