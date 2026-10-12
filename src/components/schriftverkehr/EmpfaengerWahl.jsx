// Recipient of a letter (phase 82, 82-05): pick a contact from the address
// book or type freely; the address is a SNAPSHOT copied into the letter and
// stays editable. A contact without street or town gets a hint with a link to
// the address book.
//
// In:  props kontakte, wert (snapshot or null), onChange, nurLesen. Out: the field group.

import React from "react";
import { Link } from "react-router-dom";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { anschriftVollstaendig, empfaengerAusKontakt } from "@core/lib/brief/schreiben.js";

const LEER = Object.freeze({ contact_id: null, anrede: "", titel: "", name: "", firma: "", abteilung: "", strasse: "", plz: "", ort: "", land: "" });

/**
 * @param {{kontakte: any[], wert: Record<string, any>|null, onChange: (e: Record<string, any>) => void, nurLesen?: boolean}} props
 * @returns {React.ReactElement}
 */
export default function EmpfaengerWahl({ kontakte, wert, onChange, nurLesen = false }) {
  const { t } = useI18n();
  const e = { ...LEER, ...(wert || {}) };
  const setze = (/** @type {string} */ k, /** @type {string} */ v) => onChange({ ...e, [k]: v });
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  const auswahl = "mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900";
  const sortiert = [...(kontakte || [])].sort((a, b) => String(a.company || a.name).localeCompare(String(b.company || b.name), "de"));
  return (
    <fieldset className="space-y-2" data-testid="empfaenger">
      <legend className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("Empfänger")}</legend>
      {!nurLesen && (
        <label className={feld}>{t("Aus dem Adressbuch")}
          <select className={auswahl} value={e.contact_id || ""} data-testid="empfaenger-kontakt"
            onChange={(ev) => { const k = sortiert.find((x) => x.id === ev.target.value); onChange(k ? /** @type {any} */ (empfaengerAusKontakt(k)) : { ...e, contact_id: null }); }}>
            <option value="">{t("frei eingeben")}</option>
            {sortiert.map((k) => <option key={k.id} value={k.id}>{[k.company, k.name].filter(Boolean).join(" · ")}</option>)}
          </select>
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={feld}>{t("Firma")}<Input value={e.firma} readOnly={nurLesen} onChange={(ev) => setze("firma", ev.target.value)} data-testid="empfaenger-firma" /></label>
        <label className={feld}>{t("Name")}<Input value={e.name} readOnly={nurLesen} onChange={(ev) => setze("name", ev.target.value)} data-testid="empfaenger-name" /></label>
        <label className={feld}>{t("Abteilung")}<Input value={e.abteilung} readOnly={nurLesen} onChange={(ev) => setze("abteilung", ev.target.value)} /></label>
        <label className={feld}>{t("Straße")}<Input value={e.strasse} readOnly={nurLesen} onChange={(ev) => setze("strasse", ev.target.value)} data-testid="empfaenger-strasse" /></label>
        <label className={feld}>{t("PLZ")}<Input value={e.plz} readOnly={nurLesen} onChange={(ev) => setze("plz", ev.target.value)} /></label>
        <label className={feld}>{t("Ort")}<Input value={e.ort} readOnly={nurLesen} onChange={(ev) => setze("ort", ev.target.value)} data-testid="empfaenger-ort" /></label>
      </div>
      {!nurLesen && !anschriftVollstaendig(/** @type {any} */ (e)) && (
        <p className="text-xs text-amber-800 dark:text-amber-200" data-testid="anschrift-fehlt">
          {t("Anschrift unvollständig.")} <Link className="underline" to="/AddressBook">{t("Im Adressbuch ergänzen")}</Link>
        </p>
      )}
    </fieldset>
  );
}
