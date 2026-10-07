// Form for one incoming invoice / expense (phase 79, plan 79-04 T4). Category
// suggests a tax case (steuerfallVorschlag); the amount can be entered as net
// OR gross, the other side is computed live (betraegeAusNetto/betraegeAusBrutto)
// — the stored fields still take whatever the split produced, so an edited
// gross that no longer equals net + VAT (a supplier's own rounding) is kept,
// not "corrected" back.
//
// In:  props bh (page loader object), eintrag (existing Eingangsrechnung to
//      edit, or null for a new one), onClose. Out: a FormModal; saving writes
//      through bh.speichere (Eingangsrechnung, and a Beleg when a receipt was
//      picked — a new invoice has no id yet, so the invoice is saved FIRST and
//      the receipt attached in a second write).

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { fileToDataUrl } from "@core/lib/pdf";
import { useI18n } from "@core/lib/i18n";
import { betraegeAusBrutto, betraegeAusNetto, KATEGORIEN, kategorieText, STEUERFAELLE, steuerfallVorschlag } from "@/lib/accounting/ausgaben.js";
import { belegDatensatz, belegVerweisSetzen } from "@/lib/accounting/belege.js";
import { centZuEuro, euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import BelegAnhang from "./BelegAnhang.jsx";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/**
 * Text of a tax-case key (literal t() calls for the i18n guard).
 * @param {string} steuerfall
 * @param {(k: string) => string} t
 * @returns {string}
 */
function steuerfallText(steuerfall, t) {
  switch (steuerfall) {
    case "regel19": return t("19 % (Regelsteuersatz)");
    case "regel7": return t("7 % (ermäßigt)");
    case "steuerfrei": return t("Steuerfrei");
    case "versicherungsteuer": return t("Versicherungsteuer");
    case "reverse_charge_13b": return t("§ 13b — Reverse Charge");
    default: return steuerfall;
  }
}

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   eintrag: Record<string, any>|null,
 *   onClose: () => void,
 * }} props eintrag: existing Eingangsrechnung, or null for a new one
 * @returns {React.ReactElement}
 */
export default function AusgabeFormular({ bh, eintrag, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const [form, setForm] = React.useState(() => ({
    lieferant: eintrag?.lieferant || "",
    kategorie: eintrag?.kategorie || "sonstiges",
    steuerfall: eintrag?.steuerfall || steuerfallVorschlag(eintrag?.kategorie || "sonstiges").steuerfall,
    fremd_nr: eintrag?.fremd_nr || "",
    rechnungsdatum: eintrag?.rechnungsdatum || bh.heute,
    leistungsdatum: eintrag?.leistungsdatum || eintrag?.rechnungsdatum || bh.heute,
    faellig_am: eintrag?.faellig_am || "",
    bezahlt_am: eintrag?.bezahlt_am || "",
    project_id: eintrag?.project_id || "",
    fahrzeug_id: eintrag?.fahrzeug_id || "",
  }));
  // Amounts in cents (BetragFeld's unit); converted to Euro only on save (the
  // stored Eingangsrechnung keeps netto/vorsteuer/brutto in Euro, like every
  // other accounting entity — beispielDaten.js `betraege()`, grundlagen.js).
  const [betrag, setBetrag] = React.useState(() => {
    if (eintrag) return { netto: euroZuCent(eintrag.netto), vorsteuer: euroZuCent(eintrag.vorsteuer), brutto: euroZuCent(eintrag.brutto) };
    return { netto: null, vorsteuer: null, brutto: null };
  });
  const [anlagegutHinweis, setAnlagegutHinweis] = React.useState(false);
  // Pending receipt: an existing Beleg (from bh.daten.Beleg via eintrag.beleg_id),
  // a freshly picked but not-yet-saved file {name, mime, groesse, data}, or null.
  const belegVorhanden = React.useMemo(
    () => (eintrag?.beleg_id ? (bh.daten.Beleg || []).find((b) => b.id === eintrag.beleg_id) || null : null),
    [bh.daten.Beleg, eintrag?.beleg_id]
  );
  const [beleg, setBeleg] = React.useState(belegVorhanden);
  const [belegEntfernt, setBelegEntfernt] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  const kategorieWechsel = (/** @type {string} */ kategorie) => {
    const vorschlag = steuerfallVorschlag(kategorie);
    setForm((f) => ({ ...f, kategorie, steuerfall: vorschlag.steuerfall }));
    if (vorschlag.hinweis) toast.info(t(vorschlag.hinweis));
  };

  const nettoGeaendert = (/** @type {number|null} */ cent) => {
    if (cent === null) { setBetrag((b) => ({ ...b, netto: null })); return; }
    const r = betraegeAusNetto(cent, form.steuerfall);
    setBetrag(r);
  };
  const bruttoGeaendert = (/** @type {number|null} */ cent) => {
    if (cent === null) { setBetrag((b) => ({ ...b, brutto: null })); return; }
    const r = betraegeAusBrutto(cent, form.steuerfall);
    setBetrag(r);
  };
  const steuerfallGeaendert = (/** @type {string} */ steuerfall) => {
    setze("steuerfall", steuerfall);
    // Recompute from whichever side is currently known, net taking precedence.
    if (betrag.netto !== null) setBetrag(betraegeAusNetto(betrag.netto, steuerfall));
    else if (betrag.brutto !== null) setBetrag(betraegeAusBrutto(betrag.brutto, steuerfall));
  };

  const pruefen = () => {
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.lieferant.trim()) f.lieferant = t("Bitte einen Lieferanten eingeben.");
    if (betrag.brutto === null) f.betrag = t("Bitte einen Betrag eingeben (netto oder brutto).");
    if (!form.rechnungsdatum) f.rechnungsdatum = t("Bitte ein Rechnungsdatum eingeben.");
    setFehler(f);
    return Object.keys(f).length === 0;
  };

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    if (!pruefen()) return;
    setSpeichert(true);
    try {
      const basis = {
        ...(eintrag?.id ? { id: eintrag.id } : {}),
        lieferant: form.lieferant.trim(),
        kategorie: form.kategorie,
        steuerfall: form.steuerfall,
        fremd_nr: form.fremd_nr.trim() || undefined,
        rechnungsdatum: form.rechnungsdatum,
        leistungsdatum: form.leistungsdatum || form.rechnungsdatum,
        netto: centZuEuro(betrag.netto ?? 0),
        vorsteuer: centZuEuro(betrag.vorsteuer ?? 0),
        brutto: centZuEuro(betrag.brutto ?? 0),
        faellig_am: form.faellig_am || undefined,
        bezahlt_am: form.bezahlt_am || null,
        project_id: form.project_id || undefined,
        fahrzeug_id: form.fahrzeug_id || undefined,
        beleg_id: belegEntfernt ? undefined : eintrag?.beleg_id,
      };
      let gespeichert = await bh.speichere("Eingangsrechnung", basis);
      // A newly picked (not yet persisted) receipt needs the invoice's id first.
      if (beleg && !beleg.id) {
        const belegDatei = { name: beleg.name, type: beleg.mime, size: beleg.groesse };
        const neuerBeleg = await bh.speichere("Beleg", belegDatensatz(belegDatei, beleg.data, { typ: "Eingangsrechnung", id: gespeichert.id }));
        gespeichert = await bh.speichere("Eingangsrechnung", belegVerweisSetzen(gespeichert, neuerBeleg.id));
      } else if (belegEntfernt && belegVorhanden) {
        await bh.loesche("Beleg", belegVorhanden.id);
      }
      toast.success(bearbeiten ? t("Ausgabe gespeichert") : t("Ausgabe erfasst"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  const waehleBelegDatei = async (/** @type {File} */ datei) => {
    try {
      const data = await fileToDataUrl(datei);
      setBeleg({ name: datei.name, mime: datei.type, groesse: datei.size, data });
      setBelegEntfernt(false);
    } catch (err) {
      toast.error(`${t("Datei konnte nicht gelesen werden")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const fahrzeuge = bh.daten.Fahrzeug || [];

  return (
    <FormModal title={bearbeiten ? t("Ausgabe bearbeiten") : t("Neue Ausgabe erfassen")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="ausgabe-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-lieferant" className={LABEL}>{t("Lieferant")}</label>
            <input id="ag-lieferant" type="text" className={FELD} value={form.lieferant}
              aria-invalid={fehler.lieferant ? true : undefined} onChange={(e) => setze("lieferant", e.target.value)} />
            {fehler.lieferant && <p className={FEHLER}>{fehler.lieferant}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="ag-fremd-nr" className={LABEL}>{t("Rechnungsnummer des Lieferanten")}</label>
            <input id="ag-fremd-nr" type="text" className={FELD} value={form.fremd_nr} onChange={(e) => setze("fremd_nr", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-kategorie" className={LABEL}>{t("Kategorie")}</label>
            <select id="ag-kategorie" className={FELD} value={form.kategorie} onChange={(e) => kategorieWechsel(e.target.value)}>
              {Object.keys(KATEGORIEN).map((k) => <option key={k} value={k}>{kategorieText(k, t)}</option>)}
            </select>
            {form.kategorie === "personal" && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("Löhne/Gehälter — Buchungen kommen vom Lohnbüro, nicht im DATEV-Stapel.")}</p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="ag-steuerfall" className={LABEL}>{t("Steuerfall")}</label>
            <select id="ag-steuerfall" className={FELD} value={form.steuerfall} onChange={(e) => steuerfallGeaendert(e.target.value)}>
              {Object.keys(STEUERFAELLE).map((s) => <option key={s} value={s}>{steuerfallText(s, t)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BetragFeld id="ag-netto" label={t("Netto")} wert={betrag.netto} onChange={nettoGeaendert} />
          <div className="space-y-1">
            <span className={LABEL}>{t("Vorsteuer")}</span>
            <p className="h-9 content-center px-1 text-sm tabular-nums text-slate-700 dark:text-slate-200">{formatEuro(betrag.vorsteuer ?? 0)}</p>
          </div>
          <BetragFeld id="ag-brutto" label={t("Brutto")} wert={betrag.brutto} onChange={bruttoGeaendert} />
        </div>
        {fehler.betrag && <p className={FEHLER}>{fehler.betrag}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-rechnungsdatum" className={LABEL}>{t("Rechnungsdatum")}</label>
            <input id="ag-rechnungsdatum" type="date" className={FELD} value={form.rechnungsdatum}
              aria-invalid={fehler.rechnungsdatum ? true : undefined} onChange={(e) => setze("rechnungsdatum", e.target.value)} />
            {fehler.rechnungsdatum && <p className={FEHLER}>{fehler.rechnungsdatum}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="ag-leistungsdatum" className={LABEL}>{t("Leistungsdatum")}</label>
            <input id="ag-leistungsdatum" type="date" className={FELD} value={form.leistungsdatum} onChange={(e) => setze("leistungsdatum", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-faellig" className={LABEL}>{t("Fällig am")}</label>
            <input id="ag-faellig" type="date" className={FELD} value={form.faellig_am} onChange={(e) => setze("faellig_am", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ag-bezahlt" className={LABEL}>{t("Bezahlt am")}</label>
            <input id="ag-bezahlt" type="date" className={FELD} value={form.bezahlt_am} onChange={(e) => setze("bezahlt_am", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ag-projekt" className={LABEL}>{t("Projekt (optional)")}</label>
            <select id="ag-projekt" className={FELD} value={form.project_id} onChange={(e) => setze("project_id", e.target.value)}>
              <option value="">{t("— kein Projekt —")}</option>
              {bh.projekte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="ag-fahrzeug" className={LABEL}>{t("Fahrzeug (optional)")}</label>
            <select id="ag-fahrzeug" className={FELD} value={form.fahrzeug_id} onChange={(e) => setze("fahrzeug_id", e.target.value)}>
              <option value="">{t("— kein Fahrzeug —")}</option>
              {fahrzeuge.map((f) => <option key={f.id} value={f.id}>{f.kennzeichen}</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={anlagegutHinweis} onChange={(e) => setAnlagegutHinweis(e.target.checked)} />
          {t("Ist ein Anlagegut")}
        </label>
        {anlagegutHinweis && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("Anlagegüter werden im Reiter „Anlagen“ verwaltet — die Verknüpfung zu dieser Rechnung setzt Plan 79-09.")}</p>
        )}

        <BelegAnhang
          beleg={belegEntfernt ? null : beleg}
          einst={bh.einst}
          onWaehle={waehleBelegDatei}
          onEntfernen={() => { setBeleg(null); setBelegEntfernt(true); }}
        />

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
