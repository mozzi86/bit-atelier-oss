// MitarbeiterFormular.jsx — Anlegen/Bearbeiten einer Person (Plan 80-04, Task
// 6): FormModal mit Stammdaten, Beschäftigung (inkl. Gesellschafter-Auswahl bei
// gesellschafter/inhaber), Kammer, Versorgungswerk, Qualifikationen,
// Projektzuordnungen, Privat-Block, Notizen und optionaler Visitenkarte im
// Adressbuch. Vor jedem create/update läuft normalisiereMitarbeiter (DS-06);
// neue Personen bekommen naechstePersonalnummer.
//
// Native <input>/<label>/<select>/<textarea> statt der shadcn-Wrapper: ihre
// forwardRef-Typisierung kostet unter der aktuellen React-Typkonfiguration
// einen tsc-Fehler je Aufrufstelle (CLAUDE.md "shadcn-tsc-Altlast"); FormModal
// selbst bleibt (baut auf ui/dialog.jsx, bereits kostenlos in Settings/People).
//
// In:  {mitarbeiter, mitarbeiterListe, gesellschafter79, einst, onClose,
//      onGespeichert}. Out: UI, ein create/update über bitApi.personal.Mitarbeiter.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import FormModal from "@core/components/common/FormModal";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import {
  PERSONENARTEN, STATUS, normalisiereMitarbeiter, validiereMitarbeiter, naechstePersonalnummer, anzeigeName,
} from "@/lib/people/mitarbeiter.js";
import KammerFeld from "./KammerFeld.jsx";
import QualifikationenFeld from "./QualifikationenFeld.jsx";
import ProjektZuordnung from "./ProjektZuordnung.jsx";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/** @param {unknown} m @returns {object} ein leerer Entwurf oder eine Kopie des Datensatzes */
function entwurfAus(m) {
  return m ? structuredClone(m) : {
    vorname: "", nachname: "", art: "angestellt", status: "onboarding", funktion: "",
    eintritt: "", austritt: "", dienstlich: { email: "", telefon: "" }, privat: {},
    kammer: {}, versorgungswerk: {}, qualifikationen: [], projekt_zuordnungen: [],
    gesellschafter_id: null, kontakt_id: null, an_lohnbuero_uebermittelt_am: "", notizen: "",
  };
}

/**
 * @param {{
 *   mitarbeiter?: object|null, mitarbeiterListe: object[], gesellschafter79: object[],
 *   einst: object, onClose: () => void, onGespeichert?: (m: object) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function MitarbeiterFormular({ mitarbeiter, mitarbeiterListe, gesellschafter79, einst, onClose, onGespeichert }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = React.useState(() => entwurfAus(mitarbeiter));
  const [visitenkarte, setVisitenkarte] = React.useState(false);
  const [speichern, setSpeichern] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const istNeu = !mitarbeiter;

  const setzen = (feld, wert) => setEntwurf((e) => ({ ...e, [feld]: wert }));
  const setzenTief = (feld, wert) => setEntwurf((e) => ({ ...e, [feld]: wert }));

  const artInfo = PERSONENARTEN.find((p) => p.key === entwurf.art) ?? PERSONENARTEN[0];
  const wirkung = rechtsformWirkung(einst);
  const gesellschafterRecord = gesellschafter79.find((g) => g.id === entwurf.gesellschafter_id) ?? null;

  const pruefungen = validiereMitarbeiter(entwurf, { einst, mitarbeiterListe, gesellschafter79 });
  const fehlerVon = (feld) => pruefungen.find((p) => p.feld === feld && p.schwere === "fail");
  const warnungen = pruefungen.filter((p) => p.schwere === "warn");

  const speichernAusfuehren = async (e) => {
    e.preventDefault();
    if (pruefungen.some((p) => p.schwere === "fail")) return;
    setSpeichern(true);
    setFehler(null);
    try {
      const roh = { ...entwurf };
      if (istNeu) roh.personalnummer = naechstePersonalnummer(mitarbeiterListe.map((m) => m.personalnummer));
      const sauber = normalisiereMitarbeiter(roh);
      const client = /** @type {any} */ (bitApi.personal).Mitarbeiter;
      const gespeichert = istNeu ? await client.create(sauber) : await client.update(mitarbeiter.id, sauber);

      if (visitenkarte && !gespeichert.kontakt_id) {
        const kontakt = await /** @type {any} */ (bitApi.entities).Contact.create({
          name: anzeigeName(gespeichert), role: gespeichert.funktion || "", category: "internal",
          email: gespeichert.dienstlich?.email || "", phone: gespeichert.dienstlich?.telefon || "",
        });
        await client.update(gespeichert.id, { kontakt_id: kontakt.id });
      }
      onGespeichert?.(gespeichert);
      onClose();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setSpeichern(false);
    }
  };

  return (
    <FormModal title={istNeu ? t("Neue Person") : t("Person bearbeiten")} onClose={onClose}>
      <form onSubmit={speichernAusfuehren} className="space-y-6" data-testid="mitarbeiter-formular">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Stammdaten")}</legend>
          <div>
            <label htmlFor="mf-vorname" className={BESCHRIFTUNG}>{t("Vorname")}</label>
            <input id="mf-vorname" required className={EINGABE} value={entwurf.vorname} onChange={(e) => setzen("vorname", e.target.value)} />
          </div>
          <div>
            <label htmlFor="mf-nachname" className={BESCHRIFTUNG}>{t("Nachname")}</label>
            <input id="mf-nachname" required className={EINGABE} value={entwurf.nachname} onChange={(e) => setzen("nachname", e.target.value)} />
            {fehlerVon("nachname") && <p role="alert" className="mt-1 text-xs text-rose-600">{t(fehlerVon("nachname").text)}</p>}
          </div>
          <div>
            <label htmlFor="mf-email" className={BESCHRIFTUNG}>{t("Dienstliche E-Mail")}</label>
            <input id="mf-email" type="email" className={EINGABE} value={entwurf.dienstlich?.email || ""} onChange={(e) => setzenTief("dienstlich", { ...entwurf.dienstlich, email: e.target.value })} />
          </div>
          <div>
            <label htmlFor="mf-telefon" className={BESCHRIFTUNG}>{t("Dienstliches Telefon")}</label>
            <input id="mf-telefon" className={EINGABE} value={entwurf.dienstlich?.telefon || ""} onChange={(e) => setzenTief("dienstlich", { ...entwurf.dienstlich, telefon: e.target.value })} />
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Beschäftigung")}</legend>
          <div>
            <label htmlFor="mf-art" className={BESCHRIFTUNG}>{t("Personenart")}</label>
            <select id="mf-art" className={EINGABE} value={entwurf.art} onChange={(e) => setzen("art", e.target.value)}>
              {PERSONENARTEN.map((p) => <option key={p.key} value={p.key}>{t(p.label)}</option>)}
            </select>
            {artInfo.hinweis && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t(artInfo.hinweis)}</p>}
          </div>
          <div>
            <label htmlFor="mf-funktion" className={BESCHRIFTUNG}>{t("Funktion")}</label>
            <input id="mf-funktion" className={EINGABE} value={entwurf.funktion} onChange={(e) => setzen("funktion", e.target.value)} />
          </div>
          <div>
            <label htmlFor="mf-status" className={BESCHRIFTUNG}>{t("Status")}</label>
            <select id="mf-status" className={EINGABE} value={entwurf.status} onChange={(e) => setzen("status", e.target.value)}>
              {STATUS.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mf-eintritt" className={BESCHRIFTUNG}>{t("Eintritt")}</label>
            <input id="mf-eintritt" type="date" className={EINGABE} value={entwurf.eintritt || ""} onChange={(e) => setzen("eintritt", e.target.value)} />
          </div>
          <div>
            <label htmlFor="mf-austritt" className={BESCHRIFTUNG}>{t("Austritt")}</label>
            <input id="mf-austritt" type="date" className={EINGABE} value={entwurf.austritt || ""} onChange={(e) => setzen("austritt", e.target.value)} />
            {fehlerVon("austritt") && <p role="alert" className="mt-1 text-xs text-rose-600">{t(fehlerVon("austritt").text)}</p>}
          </div>

          {artInfo.arbeitsrecht ? (
            <p className="col-span-full text-xs text-slate-500 dark:text-slate-400">
              {t("Vertrag, Urlaub und Kündigungsfrist werden im Reiter Verträge gepflegt.")}
            </p>
          ) : (
            <div className="col-span-full rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="gesellschafter-auswahl">
              <label htmlFor="mf-gesellschafter" className={BESCHRIFTUNG}>{t("Verknüpfter Gesellschafter (Buchhaltung)")}</label>
              {gesellschafter79.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t("Verknüpfter Datensatz der Buchhaltung fehlt — Buchhaltung einmal öffnen")}{" "}
                  <Link to="/Accounting" className="underline">{t("Buchhaltung öffnen")}</Link>
                </p>
              ) : (
                <select id="mf-gesellschafter" className={EINGABE} value={entwurf.gesellschafter_id || ""} onChange={(e) => setzen("gesellschafter_id", e.target.value)}>
                  <option value="" disabled>{t("Auswählen")}</option>
                  {gesellschafter79.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {wirkung.schluesselNoetig
                  ? fuellenAnteil(t, einst, entwurf.gesellschafter_id)
                  : t("100 % — Einzelunternehmen, kein Gewinnschlüssel")}
              </p>
              <Link to="/Accounting?tab=drawings" className="mt-1 inline-block text-xs text-emerald-700 underline dark:text-emerald-400">
                {t("In der Buchhaltung pflegen")}
              </Link>
            </div>
          )}
        </fieldset>

        <KammerFeld wert={entwurf.kammer} onChange={(v) => setzenTief("kammer", v)} />

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Versorgungswerk")}</legend>
          <div>
            <label htmlFor="mf-vw-beantragt" className={BESCHRIFTUNG}>{t("Befreiung beantragt am")}</label>
            <input id="mf-vw-beantragt" type="date" className={EINGABE} value={entwurf.versorgungswerk?.befreiung_beantragt_am || ""} onChange={(e) => setzenTief("versorgungswerk", { ...entwurf.versorgungswerk, befreiung_beantragt_am: e.target.value })} />
          </div>
          <div>
            <label htmlFor="mf-vw-bescheid" className={BESCHRIFTUNG}>{t("Bescheid am")}</label>
            <input id="mf-vw-bescheid" type="date" className={EINGABE} value={entwurf.versorgungswerk?.bescheid_am || ""} onChange={(e) => setzenTief("versorgungswerk", { ...entwurf.versorgungswerk, bescheid_am: e.target.value })} />
          </div>
        </fieldset>

        <QualifikationenFeld wert={entwurf.qualifikationen} onChange={(v) => setzen("qualifikationen", v)} />

        <ProjektZuordnung wert={entwurf.projekt_zuordnungen} onChange={(v) => setzen("projekt_zuordnungen", v)} />

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Privat")}</legend>
          <div className="sm:col-span-2">
            <label htmlFor="mf-privat-adresse" className={BESCHRIFTUNG}>{t("Adresse")}</label>
            <input id="mf-privat-adresse" className={EINGABE} value={entwurf.privat?.adresse || ""} onChange={(e) => setzenTief("privat", { ...entwurf.privat, adresse: e.target.value })} />
          </div>
          <div>
            <label htmlFor="mf-privat-telefon" className={BESCHRIFTUNG}>{t("Privates Telefon")}</label>
            <input id="mf-privat-telefon" className={EINGABE} value={entwurf.privat?.telefon || ""} onChange={(e) => setzenTief("privat", { ...entwurf.privat, telefon: e.target.value })} />
          </div>
          <div>
            <label htmlFor="mf-privat-notfall" className={BESCHRIFTUNG}>{t("Notfallkontakt")}</label>
            <input id="mf-privat-notfall" className={EINGABE} value={entwurf.privat?.notfallkontakt || ""} onChange={(e) => setzenTief("privat", { ...entwurf.privat, notfallkontakt: e.target.value })} />
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Notizen")}</legend>
          <p className="mb-1 text-xs text-amber-700 dark:text-amber-300">
            {t("Keine Angaben zu Gesundheit, Religion, Gewerkschaft oder anderen besonderen Kategorien (Art. 9 DSGVO).")}
          </p>
          <label htmlFor="mf-notizen" className="sr-only">{t("Notizen")}</label>
          <textarea id="mf-notizen" className={EINGABE} value={entwurf.notizen || ""} onChange={(e) => setzen("notizen", e.target.value)} rows={3} />
        </fieldset>

        <div>
          <label htmlFor="mf-lohnbuero" className={BESCHRIFTUNG}>{t("An Lohnbüro übermittelt am")}</label>
          <input id="mf-lohnbuero" type="date" className={EINGABE} value={entwurf.an_lohnbuero_uebermittelt_am || ""} onChange={(e) => setzen("an_lohnbuero_uebermittelt_am", e.target.value)} />
        </div>

        <div className="flex items-center gap-2">
          <input id="mf-visitenkarte" type="checkbox" checked={visitenkarte} onChange={(e) => setVisitenkarte(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
          <label htmlFor="mf-visitenkarte" className={BESCHRIFTUNG}>{t("Dienstliche Visitenkarte im Adressbuch anlegen")}</label>
        </div>

        {warnungen.length > 0 && (
          <ul className="space-y-1" data-testid="mitarbeiter-hinweise">
            {warnungen.map((w, i) => <li key={i} className="text-xs text-amber-700 dark:text-amber-300">{t(w.text)}</li>)}
          </ul>
        )}
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
 * Anzeigetext des Gewinnschlüssel-Anteils (GbR/PartG) für den gewählten
 * Gesellschafter, aus 79s `einst.schluessel[laufendes Jahr]`.
 * @param {(s: string) => string} t
 * @param {{schluessel?: Record<string, Record<string, number>>}|null|undefined} einst
 * @param {string|null|undefined} gesellschafterId
 * @returns {string}
 */
function fuellenAnteil(t, einst, gesellschafterId) {
  const jahr = String(new Date().getFullYear());
  const anteil = gesellschafterId && einst?.schluessel?.[jahr]?.[gesellschafterId];
  if (typeof anteil !== "number") return t("Kein Gewinnschlüssel für dieses Jahr hinterlegt — in der Buchhaltung pflegen");
  return `${anteil.toLocaleString("de-DE")} %`;
}
