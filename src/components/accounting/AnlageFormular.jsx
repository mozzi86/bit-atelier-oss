// Form for one Anlagegut (phase 79, plan 79-09 T4): master data of a fixed
// asset plus a live preview of its depreciation in the acquisition year and
// its resulting book value, computed with the very same anlagen.js functions
// used everywhere else — so a wrong date, cost or method shows its effect
// immediately instead of only after saving.
//
// Nutzungsdauer/Methode follow the suggestion (nutzungsdauerVorschlag/
// methodeVorschlag) until the person edits them by hand; from then on the
// typed value wins even if the category or the amount changes again.
//
// In:  props bh (page loader object — bh.saetze prices the preview), eintrag
//      (existing Anlagegut to edit, or a not-yet-saved draft such as
//      anlagen.fahrzeugUebernehmen()'s entwurf — both have no `id` yet in the
//      latter case, so this form treats them alike as "new"), onClose. Out: a
//      FormModal; saving writes through bh.speichere("Anlagegut", …).

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { jahrVon } from "@core/lib/kalender/datum.js";
import { afaJahr, kategorieText, methodeText, methodeVorschlag, nutzungsdauerVorschlag, restbuchwert } from "@/lib/accounting/anlagen.js";
import { centZuEuro, euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";
const KATEGORIEN = ["bueroausstattung", "rechner", "plotter", "fahrzeug", "software", "sonstiges"];
const METHODEN = ["sofort", "gwg", "sammel", "linear"];

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   eintrag: Record<string, any>|null,
 *   onClose: () => void,
 * }} props eintrag: existing or draft Anlagegut, or null for a blank new one
 * @returns {React.ReactElement}
 */
export default function AnlageFormular({ bh, eintrag, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const [form, setForm] = React.useState(() => ({
    bezeichnung: eintrag?.bezeichnung || "",
    kategorie: KATEGORIEN.includes(eintrag?.kategorie) ? eintrag.kategorie : "bueroausstattung",
    anschaffung_datum: eintrag?.anschaffung_datum || bh.heute,
    nutzungsdauer: Number.isFinite(eintrag?.nutzungsdauer) ? eintrag.nutzungsdauer : null,
    methode: METHODEN.includes(eintrag?.methode) ? eintrag.methode : null,
    abgang_datum: eintrag?.abgang?.datum || "",
  }));
  const [akCent, setAkCent] = React.useState(() => (typeof eintrag?.ak_netto === "number" ? euroZuCent(eintrag.ak_netto) : null));
  const [erloesCent, setErloesCent] = React.useState(() => (typeof eintrag?.abgang?.erloes === "number" ? euroZuCent(eintrag.abgang.erloes) : null));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  // Suggestions the field FOLLOWS until touched by hand (form.nutzungsdauer/
  // methode start out null for a blank field; once the person picks a value
  // the field carries it from then on, even across a category/amount change).
  const ndVorschlag = nutzungsdauerVorschlag(form.kategorie, bh.saetze);
  const ndAnzeige = form.nutzungsdauer ?? ndVorschlag ?? 1;
  const methodeVorschlagWert = methodeVorschlag(akCent ?? 0, bh.saetze);
  const methodeAnzeige = form.methode || methodeVorschlagWert;

  // Live preview: the acquisition year's own depreciation and its book value
  // at that year's end, with whatever is currently in the form — the same
  // afaJahr()/restbuchwert() the saved record will use later.
  const anschaffungJahr = jahrVon(form.anschaffung_datum) ?? Number(bh.heute.slice(0, 4));
  const vorschauAnlage = {
    ak_netto: centZuEuro(akCent ?? 0), nutzungsdauer: ndAnzeige, anschaffung_datum: form.anschaffung_datum, methode: methodeAnzeige, abgang: null,
  };
  let vorschauAfaCent = 0;
  let vorschauRestbuchwertCent = 0;
  try {
    vorschauAfaCent = afaJahr(vorschauAnlage, anschaffungJahr, bh.saetze);
    vorschauRestbuchwertCent = restbuchwert(vorschauAnlage, `${anschaffungJahr}-12-31`, bh.saetze);
  } catch { /* incomplete input while typing (e.g. Nutzungsdauer 0) — preview simply shows 0,00 € until it is valid */ }

  const pruefen = () => {
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.bezeichnung.trim()) f.bezeichnung = t("Bitte eine Bezeichnung eingeben.");
    if (akCent === null) f.ak_netto = t("Bitte einen Anschaffungswert eingeben.");
    if (!form.anschaffung_datum) f.anschaffung_datum = t("Bitte ein Anschaffungsdatum eingeben.");
    if (!Number.isInteger(ndAnzeige) || ndAnzeige < 1) f.nutzungsdauer = t("Bitte eine Nutzungsdauer von mindestens einem Jahr eingeben.");
    if (erloesCent !== null && !form.abgang_datum) f.abgang_datum = t("Bitte ein Abgangsdatum eingeben.");
    setFehler(f);
    return Object.keys(f).length === 0;
  };

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    if (!pruefen()) return;
    setSpeichert(true);
    try {
      await bh.speichere("Anlagegut", {
        ...(eintrag?.id ? { id: eintrag.id } : {}),
        bezeichnung: form.bezeichnung.trim(),
        kategorie: form.kategorie,
        anschaffung_datum: form.anschaffung_datum,
        ak_netto: centZuEuro(akCent ?? 0),
        nutzungsdauer: ndAnzeige,
        methode: methodeAnzeige,
        fahrzeug_id: eintrag?.fahrzeug_id || undefined,
        eingangsrechnung_id: eintrag?.eingangsrechnung_id || undefined,
        abgang: form.abgang_datum ? { datum: form.abgang_datum, erloes: centZuEuro(erloesCent ?? 0) } : null,
      });
      toast.success(bearbeiten ? t("Anlage gespeichert") : t("Anlage angelegt"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Anlage bearbeiten") : t("Neue Anlage")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="anlage-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-bezeichnung" className={LABEL}>{t("Bezeichnung")}</label>
            <input id="ag-bezeichnung" type="text" className={FELD} value={form.bezeichnung}
              aria-invalid={fehler.bezeichnung ? true : undefined} onChange={(e) => setze("bezeichnung", e.target.value)} />
            {fehler.bezeichnung && <p className={FEHLER}>{fehler.bezeichnung}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="ag-kategorie" className={LABEL}>{t("Kategorie")}</label>
            <select id="ag-kategorie" className={FELD} value={form.kategorie} onChange={(e) => setze("kategorie", e.target.value)}>
              {KATEGORIEN.map((k) => <option key={k} value={k}>{kategorieText(k, t)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="ag-anschaffung" className={LABEL}>{t("Anschaffungsdatum")}</label>
            <input id="ag-anschaffung" type="date" className={FELD} value={form.anschaffung_datum}
              aria-invalid={fehler.anschaffung_datum ? true : undefined} onChange={(e) => setze("anschaffung_datum", e.target.value)} />
            {fehler.anschaffung_datum && <p className={FEHLER}>{fehler.anschaffung_datum}</p>}
          </div>
          <BetragFeld id="ag-ak-netto" label={t("AK netto")} wert={akCent} onChange={setAkCent} />
          <div className="space-y-1">
            <label htmlFor="ag-nutzungsdauer" className={LABEL}>{t("Nutzungsdauer (Jahre)")}</label>
            <input id="ag-nutzungsdauer" type="number" min="1" step="1" className={FELD} value={ndAnzeige}
              aria-invalid={fehler.nutzungsdauer ? true : undefined}
              onChange={(e) => setze("nutzungsdauer", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
        {fehler.ak_netto && <p className={FEHLER}>{fehler.ak_netto}</p>}
        {fehler.nutzungsdauer && <p className={FEHLER}>{fehler.nutzungsdauer}</p>}

        <div className="space-y-1">
          <label htmlFor="ag-methode" className={LABEL}>{t("Methode")}</label>
          <select id="ag-methode" className={FELD} value={methodeAnzeige} onChange={(e) => setze("methode", e.target.value)}>
            {METHODEN.map((m) => <option key={m} value={m}>{methodeText(m, t)}</option>)}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-abgang-datum" className={LABEL}>{t("Abgangsdatum (optional)")}</label>
            <input id="ag-abgang-datum" type="date" className={FELD} value={form.abgang_datum}
              aria-invalid={fehler.abgang_datum ? true : undefined} onChange={(e) => setze("abgang_datum", e.target.value)} />
            {fehler.abgang_datum && <p className={FEHLER}>{fehler.abgang_datum}</p>}
          </div>
          <BetragFeld id="ag-abgang-erloes" label={t("Veräußerungserlös (optional)")} wert={erloesCent} onChange={setErloesCent} />
        </div>

        <p data-testid="ag-vorschau" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {t("AfA im Anschaffungsjahr")} ({anschaffungJahr}): {formatEuro(vorschauAfaCent)} — {t("Restbuchwert")}: {formatEuro(vorschauRestbuchwertCent)}
        </p>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
