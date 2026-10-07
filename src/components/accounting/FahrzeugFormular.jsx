// Form for one Fahrzeug (phase 79, plan 79-08 T4): master data of a company
// car plus a live preview of the 1 % rule (faktor + monthly value) as the
// user types, so a wrong acquisition date or drivetrain shows its effect
// immediately instead of only after saving.
//
// In:  props bh (page loader object — bh.saetze prices the preview), eintrag
//      (existing Fahrzeug to edit, or null for a new one), onClose. Out: a
//      FormModal; saving writes through bh.speichere("Fahrzeug", …).

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { antriebText, faktor, faktorGrund, kaufLeasingText, methodeText, nutzerArtText, pauschalWertMonat } from "@/lib/accounting/fuhrpark.js";
import { centZuEuro, euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   eintrag: Record<string, any>|null,
 *   onClose: () => void,
 * }} props eintrag: existing Fahrzeug, or null for a new one
 * @returns {React.ReactElement}
 */
export default function FahrzeugFormular({ bh, eintrag, onClose }) {
  const { t, lang } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const [form, setForm] = React.useState(() => ({
    kennzeichen: eintrag?.kennzeichen || "",
    nutzer: eintrag?.nutzer || "",
    nutzer_art: eintrag?.nutzer_art || "gesellschafter",
    antrieb: eintrag?.antrieb || "verbrenner",
    co2_g_km: eintrag?.co2_g_km ?? "",
    e_reichweite_km: eintrag?.e_reichweite_km ?? "",
    anschaffung_datum: eintrag?.anschaffung_datum || bh.heute,
    entfernung_km: eintrag?.entfernung_km ?? "",
    nutzung_ab: eintrag?.nutzung_ab || bh.heute,
    nutzung_bis: eintrag?.nutzung_bis || "",
    methode: eintrag?.methode || "pauschal",
    kauf_leasing: eintrag?.kauf_leasing || "kauf",
  }));
  const [blpCent, setBlpCent] = React.useState(() => (eintrag ? euroZuCent(eintrag.blp) : null));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  // Live preview of the flat rate with whatever is currently in the form —
  // the same faktor()/pauschalWertMonat() the saved record will use later.
  const vorschauFahrzeug = {
    antrieb: form.antrieb, blp: centZuEuro(blpCent ?? 0), co2_g_km: form.co2_g_km === "" ? undefined : Number(form.co2_g_km),
    e_reichweite_km: form.e_reichweite_km === "" ? undefined : Number(form.e_reichweite_km),
    anschaffung_datum: form.anschaffung_datum, entfernung_km: form.entfernung_km === "" ? 0 : Number(form.entfernung_km),
  };
  const vorschauFaktor = faktor(vorschauFahrzeug, bh.saetze);
  const vorschauWert = pauschalWertMonat(vorschauFahrzeug, bh.saetze);

  const pruefen = () => {
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.kennzeichen.trim()) f.kennzeichen = t("Bitte ein Kennzeichen eingeben.");
    if (blpCent === null) f.blp = t("Bitte einen Bruttolistenpreis eingeben.");
    if (!form.anschaffung_datum) f.anschaffung_datum = t("Bitte ein Anschaffungsdatum eingeben.");
    setFehler(f);
    return Object.keys(f).length === 0;
  };

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    if (!pruefen()) return;
    setSpeichert(true);
    try {
      await bh.speichere("Fahrzeug", {
        ...(eintrag?.id ? { id: eintrag.id } : {}),
        kennzeichen: form.kennzeichen.trim(),
        nutzer: form.nutzer.trim() || undefined,
        nutzer_art: form.nutzer_art,
        blp: centZuEuro(blpCent ?? 0),
        antrieb: form.antrieb,
        co2_g_km: form.co2_g_km === "" ? undefined : Number(form.co2_g_km),
        e_reichweite_km: form.e_reichweite_km === "" ? undefined : Number(form.e_reichweite_km),
        anschaffung_datum: form.anschaffung_datum,
        entfernung_km: form.entfernung_km === "" ? undefined : Number(form.entfernung_km),
        nutzung_ab: form.nutzung_ab || undefined,
        nutzung_bis: form.nutzung_bis || undefined,
        methode: form.methode,
        kauf_leasing: form.kauf_leasing,
      });
      toast.success(bearbeiten ? t("Fahrzeug gespeichert") : t("Fahrzeug angelegt"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  const zeigeElektroFelder = form.antrieb === "hybrid" || form.antrieb === "elektro";

  return (
    <FormModal title={bearbeiten ? t("Fahrzeug bearbeiten") : t("Neues Fahrzeug")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="fahrzeug-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="fz-kennzeichen" className={LABEL}>{t("Kennzeichen")}</label>
            <input id="fz-kennzeichen" type="text" className={FELD} value={form.kennzeichen}
              aria-invalid={fehler.kennzeichen ? true : undefined} onChange={(e) => setze("kennzeichen", e.target.value)} />
            {fehler.kennzeichen && <p className={FEHLER}>{fehler.kennzeichen}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="fz-nutzer" className={LABEL}>{t("Nutzer")}</label>
            <input id="fz-nutzer" type="text" className={FELD} value={form.nutzer} onChange={(e) => setze("nutzer", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="fz-nutzer-art" className={LABEL}>{t("Nutzerart")}</label>
            <select id="fz-nutzer-art" className={FELD} value={form.nutzer_art} onChange={(e) => setze("nutzer_art", e.target.value)}>
              <option value="gesellschafter">{nutzerArtText("gesellschafter", t)}</option>
              <option value="arbeitnehmer">{nutzerArtText("arbeitnehmer", t)}</option>
            </select>
          </div>
          <BetragFeld id="fz-blp" label={t("Bruttolistenpreis")} wert={blpCent} onChange={setBlpCent} />
        </div>
        {fehler.blp && <p className={FEHLER}>{fehler.blp}</p>}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="fz-antrieb" className={LABEL}>{t("Antrieb")}</label>
            <select id="fz-antrieb" className={FELD} value={form.antrieb} onChange={(e) => setze("antrieb", e.target.value)}>
              <option value="verbrenner">{antriebText("verbrenner", t)}</option>
              <option value="hybrid">{antriebText("hybrid", t)}</option>
              <option value="elektro">{antriebText("elektro", t)}</option>
            </select>
          </div>
          {zeigeElektroFelder && (
            <>
              <div className="space-y-1">
                <label htmlFor="fz-co2" className={LABEL}>{t("CO₂ (g/km)")}</label>
                <input id="fz-co2" type="number" min="0" step="1" className={FELD} value={form.co2_g_km} onChange={(e) => setze("co2_g_km", e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="fz-reichweite" className={LABEL}>{t("Elektrische Reichweite (km)")}</label>
                <input id="fz-reichweite" type="number" min="0" step="1" className={FELD} value={form.e_reichweite_km} onChange={(e) => setze("e_reichweite_km", e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="fz-anschaffung" className={LABEL}>{t("Anschaffungsdatum")}</label>
            <input id="fz-anschaffung" type="date" className={FELD} value={form.anschaffung_datum}
              aria-invalid={fehler.anschaffung_datum ? true : undefined} onChange={(e) => setze("anschaffung_datum", e.target.value)} />
            {fehler.anschaffung_datum && <p className={FEHLER}>{fehler.anschaffung_datum}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="fz-nutzung-ab" className={LABEL}>{t("Nutzungsbeginn")}</label>
            <input id="fz-nutzung-ab" type="date" className={FELD} value={form.nutzung_ab} onChange={(e) => setze("nutzung_ab", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="fz-nutzung-bis" className={LABEL}>{t("Nutzungsende (optional)")}</label>
            <input id="fz-nutzung-bis" type="date" className={FELD} value={form.nutzung_bis} onChange={(e) => setze("nutzung_bis", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="fz-entfernung" className={LABEL}>{t("Entfernung Wohnung–Büro (km)")}</label>
            <input id="fz-entfernung" type="number" min="0" step="1" className={FELD} value={form.entfernung_km} onChange={(e) => setze("entfernung_km", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="fz-methode" className={LABEL}>{t("Methode")}</label>
            <select id="fz-methode" className={FELD} value={form.methode} onChange={(e) => setze("methode", e.target.value)}>
              <option value="pauschal">{methodeText("pauschal", t)}</option>
              <option value="fahrtenbuch">{methodeText("fahrtenbuch", t)}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="fz-kauf-leasing" className={LABEL}>{t("Kauf/Leasing")}</label>
            <select id="fz-kauf-leasing" className={FELD} value={form.kauf_leasing} onChange={(e) => setze("kauf_leasing", e.target.value)}>
              <option value="kauf">{kaufLeasingText("kauf", t)}</option>
              <option value="leasing">{kaufLeasingText("leasing", t)}</option>
            </select>
          </div>
        </div>

        <p data-testid="fz-vorschau" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {t("Faktor")} {vorschauFaktor.faktor === 1 ? "1" : vorschauFaktor.faktor === 0.5 ? "½" : "¼"} ({faktorGrund(vorschauFahrzeug, bh.saetze, t, lang)}) —{" "}
          {t("Monatswert")}: {formatEuro(vorschauWert.summe)}
        </p>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
