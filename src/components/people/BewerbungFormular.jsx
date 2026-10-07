// BewerbungFormular.jsx — Bewerbung anlegen/bearbeiten (Plan 80-08, Task 4).
// Stammdaten, Talentpool-Einwilligung (Art. 6 Abs. 1 lit. a, Art. 7 DSGVO),
// Anhänge, die berechnete Löschfrist und die Entscheidung Zusage/Absage/
// Rückzug. "Absagetext kopieren" liefert nur einen Text — die App verschickt
// nie selbst (externe Kommunikation bräuchte eine eigene Freigabe).
//
// Native <input>/<label>/<select> statt shadcn-Wrapper (Muster wie
// VertragsFormular.jsx). Vor dem Speichern läuft normalisiereBewerbung (DS-06).
//
// In:  {bewerbung, stellen, mitarbeiterListe, dokumente, regelWert, heute,
//      briefkopf, onDokumenteGespeichert, onClose, onGespeichert}.
// Out: UI, ein create/update über bitApi.personal.Bewerbung.

import React from "react";
import { Copy } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { plusMonate } from "@core/lib/kalender/datum.js";
import FormModal from "@core/components/common/FormModal";
import { normalisiereBewerbung, loeschenAb, entscheidungMitArt, absageText } from "@/lib/people/bewerbung.js";
import PersonalDokumente from "./PersonalDokumente.jsx";
import GespraechsNotizen from "./GespraechsNotizen.jsx";
import DatenschutzAktionen from "./DatenschutzAktionen.jsx";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/** Quellen einer Bewerbung (personalSeed.json B-1…B-4). */
const QUELLEN = Object.freeze([
  { key: "initiativ", label: "Initiativbewerbung" },
  { key: "stellenanzeige", label: "Stellenanzeige" },
  { key: "hochschulportal", label: "Hochschulportal" },
]);

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Leerer Entwurf, oder eine Bewerbung zum Bearbeiten. `bewerbung` ohne `id`
 * (z. B. `{stelle_id}` aus "Neue Bewerbung" in StellenListe.jsx) gilt als
 * TEILWEISE Vorbelegung eines neuen Entwurfs, nicht als vollständiger Datensatz
 * — sie wird über den leeren Entwurf gelegt, damit kein Feld undefiniert bleibt.
 * @param {object|null} bewerbung @param {string} heute @returns {object}
 */
function entwurfAus(bewerbung, heute) {
  const leer = {
    stelle_id: null, vorname: "", nachname: "", kontakt: { email: "", telefon: "" },
    eingang_am: heute, quelle: "initiativ", stufe: "eingang", stufen_verlauf: [],
    bewertung: [], gespraeche: [], gehaltswunsch_eur: null, verfuegbar_ab: "",
    datenschutzhinweis_am: "", entscheidung: {},
    talentpool: { eingewilligt_am: null, text_version: null, bis: null, widerrufen_am: null },
    uebernommen_mitarbeiter_id: null,
  };
  if (bewerbung?.id) return structuredClone(bewerbung);
  return { ...leer, ...structuredClone(bewerbung || {}) };
}

/**
 * @param {{bewerbung: object|null, stellen: object[], mitarbeiterListe: object[],
 *   dokumente?: object[], regelWert: (id: string) => any, heute: string,
 *   briefkopf?: {office?: string}|null,
 *   onDokumenteGespeichert?: () => void, onClose: () => void, onGespeichert?: () => void}} props
 *   `briefkopf` = Setting "briefkopf" (SucheReiter.jsx lädt ihn einmal), Büroname für den Absagetext
 * @returns {React.ReactElement}
 */
export default function BewerbungFormular({ bewerbung, stellen, mitarbeiterListe, dokumente, regelWert, heute, briefkopf, onDokumenteGespeichert, onClose, onGespeichert }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = React.useState(() => entwurfAus(bewerbung, heute));
  const [speichern, setSpeichern] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [kopiert, setKopiert] = React.useState(false);
  const istBearbeiten = Boolean(bewerbung?.id);

  const setzen = (feld, wert) => setEntwurf((e) => ({ ...e, [feld]: wert }));
  const setzenKontakt = (feld, wert) => setEntwurf((e) => ({ ...e, kontakt: { ...e.kontakt, [feld]: wert } }));
  const setzenTalentpool = (feld, wert) => setEntwurf((e) => ({ ...e, talentpool: { ...e.talentpool, [feld]: wert } }));
  const setzenEntscheidung = (feld, wert) => setEntwurf((e) => ({ ...e, entscheidung: { ...e.entscheidung, [feld]: wert } }));
  const entscheidungWaehlen = (art) => setEntwurf((e) => ({ ...e, entscheidung: entscheidungMitArt(e.entscheidung, art) }));

  const talentpoolMonate = regelWert("personal.aufbewahrung_talentpool_monate");
  const einwilligungSetzen = (am) => {
    const bis = am ? plusMonate(am, typeof talentpoolMonate === "number" ? talentpoolMonate : 24) : null;
    setEntwurf((e) => ({ ...e, talentpool: { ...e.talentpool, eingewilligt_am: am || null, bis, widerrufen_am: null } }));
  };
  const einwilligungWiderrufen = () => setzenTalentpool("widerrufen_am", heute);

  const faelligAm = loeschenAb(entwurf, regelWert);

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(absageText(entwurf, briefkopf));
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      setKopiert(false);
    }
  };

  const speichernAusfuehren = async (e) => {
    e.preventDefault();
    setSpeichern(true);
    setFehler(null);
    try {
      const client = /** @type {any} */ (bitApi.personal).Bewerbung;
      const sauber = normalisiereBewerbung(entwurf);
      delete sauber.id;
      if (istBearbeiten) await client.update(bewerbung.id, sauber);
      else await client.create(sauber);
      onGespeichert?.();
      onClose();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setSpeichern(false);
    }
  };

  return (
    <FormModal title={istBearbeiten ? t("Bewerbung bearbeiten") : t("Bewerbung erfassen")} onClose={onClose}>
      <form onSubmit={speichernAusfuehren} className="space-y-6" data-testid="bewerbung-formular">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Stammdaten")}</legend>
          <div>
            <label htmlFor="bf-stelle" className={BESCHRIFTUNG}>{t("Stelle")}</label>
            <select id="bf-stelle" className={EINGABE} value={entwurf.stelle_id || ""} onChange={(e) => setzen("stelle_id", e.target.value || null)}>
              <option value="">{t("Initiativ (keine Stelle)")}</option>
              {stellen.map((s) => <option key={s.id} value={s.id}>{s.titel}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="bf-quelle" className={BESCHRIFTUNG}>{t("Quelle")}</label>
            <select id="bf-quelle" className={EINGABE} value={entwurf.quelle || "initiativ"} onChange={(e) => setzen("quelle", e.target.value)}>
              {QUELLEN.map((q) => <option key={q.key} value={q.key}>{t(q.label)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="bf-vorname" className={BESCHRIFTUNG}>{t("Vorname")}</label>
            <input id="bf-vorname" required className={EINGABE} value={entwurf.vorname} onChange={(e) => setzen("vorname", e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-nachname" className={BESCHRIFTUNG}>{t("Nachname")}</label>
            <input id="bf-nachname" required className={EINGABE} value={entwurf.nachname} onChange={(e) => setzen("nachname", e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-email" className={BESCHRIFTUNG}>{t("E-Mail")}</label>
            <input id="bf-email" type="email" className={EINGABE} value={entwurf.kontakt?.email || ""} onChange={(e) => setzenKontakt("email", e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-telefon" className={BESCHRIFTUNG}>{t("Telefon")}</label>
            <input id="bf-telefon" className={EINGABE} value={entwurf.kontakt?.telefon || ""} onChange={(e) => setzenKontakt("telefon", e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-eingang" className={BESCHRIFTUNG}>{t("Eingang am")}</label>
            <input id="bf-eingang" type="date" required className={EINGABE} value={entwurf.eingang_am || ""} onChange={(e) => setzen("eingang_am", e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-gehaltswunsch" className={BESCHRIFTUNG}>{t("Gehaltswunsch (€)")}</label>
            <input id="bf-gehaltswunsch" type="number" min={0} className={EINGABE} value={entwurf.gehaltswunsch_eur ?? ""} onChange={(e) => setzen("gehaltswunsch_eur", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="bf-verfuegbar" className={BESCHRIFTUNG}>{t("Verfügbar ab")}</label>
            <input id="bf-verfuegbar" type="date" className={EINGABE} value={entwurf.verfuegbar_ab || ""} onChange={(e) => setzen("verfuegbar_ab", e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-datenschutz" className={BESCHRIFTUNG}>{t("Datenschutzhinweis (Art. 13) übergeben am")}</label>
            <input id="bf-datenschutz" type="date" className={EINGABE} value={entwurf.datenschutzhinweis_am || ""} onChange={(e) => setzen("datenschutzhinweis_am", e.target.value)} />
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Talentpool (Einwilligung, Art. 6 Abs. 1 lit. a, Art. 7 DSGVO)")}</legend>
          <div>
            <label htmlFor="bf-tp-am" className={BESCHRIFTUNG}>{t("Einwilligung erteilt am")}</label>
            <input id="bf-tp-am" type="date" className={EINGABE} value={entwurf.talentpool?.eingewilligt_am || ""} onChange={(e) => einwilligungSetzen(e.target.value)} />
          </div>
          <div>
            <label htmlFor="bf-tp-version" className={BESCHRIFTUNG}>{t("Textversion")}</label>
            <input id="bf-tp-version" className={EINGABE} value={entwurf.talentpool?.text_version || ""} onChange={(e) => setzenTalentpool("text_version", e.target.value)} disabled={!entwurf.talentpool?.eingewilligt_am} />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {entwurf.talentpool?.bis ? fuellenBis(t, entwurf.talentpool.bis) : t("Keine Einwilligung.")}
            </span>
            {entwurf.talentpool?.eingewilligt_am && !entwurf.talentpool?.widerrufen_am && (
              <button type="button" onClick={einwilligungWiderrufen} className="rounded-md border border-rose-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40">
                {t("Einwilligung widerrufen")}
              </button>
            )}
            {entwurf.talentpool?.widerrufen_am && (
              <span className="text-xs text-slate-500 dark:text-slate-400">{fuellenWiderrufen(t, entwurf.talentpool.widerrufen_am)}</span>
            )}
          </div>
        </fieldset>

        {faelligAm && (
          <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="bf-loeschen-ab">
            {t("Löschen ab")}: <strong>{fmtDatum(faelligAm)}</strong>
          </p>
        )}

        {/* 80-10: Betroffenenrechte dieser Bewerbung — nur bei einer bereits gespeicherten Zeile (eine echte bewerbungId ist nötig). */}
        {istBearbeiten && <DatenschutzAktionen bewerbungId={bewerbung.id} />}

        {(istBearbeiten || entwurf.stelle_id) && (
          <fieldset>
            <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Anhänge")}</legend>
            <PersonalDokumente bewerbungId={bewerbung?.id} dokumente={Array.isArray(dokumente) ? dokumente : []} regelWert={regelWert} onGespeichert={() => onDokumenteGespeichert?.()} />
          </fieldset>
        )}

        <GespraechsNotizen
          gespraeche={entwurf.gespraeche}
          bewertung={entwurf.bewertung}
          mitarbeiterListe={mitarbeiterListe}
          onGespraecheChange={(neu) => setzen("gespraeche", neu)}
          onBewertungChange={(neu) => setzen("bewertung", neu)}
        />

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Entscheidung")}</legend>
          <div>
            <label htmlFor="bf-entscheidung" className={BESCHRIFTUNG}>{t("Ergebnis")}</label>
            <select id="bf-entscheidung" className={EINGABE} value={entwurf.entscheidung?.art || ""} onChange={(e) => entscheidungWaehlen(e.target.value)}>
              <option value="">{t("Offen")}</option>
              <option value="zusage">{t("Zusage")}</option>
              <option value="absage">{t("Absage")}</option>
              <option value="zurueckgezogen">{t("Zurückgezogen")}</option>
            </select>
          </div>
          {entwurf.entscheidung?.art && (
            <div>
              <label htmlFor="bf-entscheidung-am" className={BESCHRIFTUNG}>{t("Datum")}</label>
              <input id="bf-entscheidung-am" type="date" className={EINGABE} value={entwurf.entscheidung?.am || ""} onChange={(e) => setzenEntscheidung("am", e.target.value)} />
            </div>
          )}
          {entwurf.entscheidung?.art === "absage" && (
            <div className="sm:col-span-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={kopieren} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  <Copy className="h-4 w-4" aria-hidden="true" /> {t("Absagetext kopieren")}
                </button>
                {kopiert && <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{t("In die Zwischenablage kopiert.")}</span>}
              </div>
              <div>
                <label htmlFor="bf-absage-versandt" className={BESCHRIFTUNG}>{t("Absage versandt am")}</label>
                <input id="bf-absage-versandt" type="date" className={EINGABE} value={entwurf.entscheidung?.absage_versandt_am || ""} onChange={(e) => setzenEntscheidung("absage_versandt_am", e.target.value)} />
              </div>
            </div>
          )}
        </fieldset>

        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            {t("Abbrechen")}
          </button>
          <button type="submit" disabled={speichern || !entwurf.vorname || !entwurf.nachname} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {t("Speichern")}
          </button>
        </div>
      </form>
    </FormModal>
  );
}

/** @param {(s: string) => string} t @param {string} bis @returns {string} */
function fuellenBis(t, bis) {
  return t("Talentpool bis {datum}").replace("{datum}", fmtDatum(bis));
}
/** @param {(s: string) => string} t @param {string} am @returns {string} */
function fuellenWiderrufen(t, am) {
  return t("Widerrufen am {datum}").replace("{datum}", fmtDatum(am));
}
