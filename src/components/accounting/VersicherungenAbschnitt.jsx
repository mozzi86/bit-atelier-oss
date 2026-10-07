// Insurance policies and guarantees/bonds (phase 79, plan 79-04 T6): term,
// cancellation deadline, premium and payment interval, the computed upcoming
// due date, and — for a Bürgschaft — the pro-rata bond commission and return
// date (ausgaben.buergschaftStatus). Warns when a policy's end or cancellation
// deadline is within `ablauf_warn_tage` (ausgaben.ablaufWarnungen).
//
// In:  props {bh, projektId} (null = all projects). Out: the section (list +
//      inline create/edit form; the plan lists no separate file for the form).

import React from "react";
import { toast } from "sonner";
import { Plus, TriangleAlert } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { ablaufWarnungen, buergschaftStatus, versicherungFaelligkeiten } from "@/lib/accounting/ausgaben.js";
import { plusMonate } from "@core/lib/kalender/datum.js";
import { centZuEuro, euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/** @param {string} typ @param {(k: string) => string} t */
function typText(typ, t) {
  switch (typ) {
    case "berufshaftpflicht": return t("Berufshaftpflicht");
    case "betriebshaftpflicht": return t("Betriebshaftpflicht");
    case "buergschaft": return t("Bürgschaft");
    default: return t("Sonstige");
  }
}
/** @param {string} zahlweise @param {(k: string) => string} t */
function zahlweiseText(zahlweise, t) {
  switch (zahlweise) {
    case "monat": return t("Monatlich");
    case "quartal": return t("Vierteljährlich");
    case "halbjahr": return t("Halbjährlich");
    default: return t("Jährlich");
  }
}

/**
 * Inline create/edit form (FormModal) for one policy/bond.
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, versicherung: Record<string, any>|null, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
function VersicherungFormular({ bh, versicherung: v, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(v?.id);
  const [form, setForm] = React.useState(() => ({
    typ: v?.typ || "berufshaftpflicht",
    versicherer: v?.versicherer || "",
    police: v?.police || "",
    beginn: v?.beginn || bh.heute,
    ende: v?.ende || "",
    kuendigung_tage: v?.kuendigung_tage != null ? String(v.kuendigung_tage) : "",
    zahlweise: v?.zahlweise || "jahr",
    naechste_faelligkeit: v?.naechste_faelligkeit || v?.beginn || bh.heute,
    naechsteFaelligkeitAngefasst: false,
    project_id: v?.project_id || "",
    aval_prozent: v?.aval_prozent != null ? String(v.aval_prozent) : "",
    rueckgabe_am: v?.rueckgabe_am || "",
  }));
  const [deckung, setDeckung] = React.useState(() => (v?.deckung != null ? euroZuCent(v.deckung) : null));
  const [praemie, setPraemie] = React.useState(() => (v?.praemie != null ? euroZuCent(v.praemie) : null));
  const [buergschaftBetrag, setBuergschaftBetrag] = React.useState(() => (v?.buergschaft_betrag != null ? euroZuCent(v.buergschaft_betrag) : null));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);
  const istBuergschaft = form.typ === "buergschaft";

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));
  const beginnGeaendert = (/** @type {string} */ beginn) => setForm((f) => ({ ...f, beginn, naechste_faelligkeit: f.naechsteFaelligkeitAngefasst ? f.naechste_faelligkeit : beginn }));

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.versicherer.trim()) f.versicherer = t("Bitte einen Versicherer eingeben.");
    if (!form.beginn) f.beginn = t("Bitte ein Beginn-Datum eingeben.");
    if (praemie === null) f.praemie = t("Bitte eine Prämie eingeben.");
    if (istBuergschaft && buergschaftBetrag === null) f.buergschaft_betrag = t("Bitte den Bürgschaftsbetrag eingeben.");
    setFehler(f);
    if (Object.keys(f).length) return;
    setSpeichert(true);
    try {
      await bh.speichere("Versicherung", {
        ...(v?.id ? { id: v.id } : {}),
        typ: form.typ,
        versicherer: form.versicherer.trim(),
        police: form.police.trim() || undefined,
        deckung: deckung !== null ? centZuEuro(deckung) : undefined,
        beginn: form.beginn,
        ende: form.ende || undefined,
        kuendigung_tage: form.kuendigung_tage.trim() !== "" ? Number(form.kuendigung_tage) : undefined,
        praemie: centZuEuro(/** @type {number} */ (praemie)),
        zahlweise: form.zahlweise,
        naechste_faelligkeit: form.naechste_faelligkeit,
        project_id: form.project_id || undefined,
        buergschaft_betrag: istBuergschaft ? centZuEuro(/** @type {number} */ (buergschaftBetrag)) : undefined,
        aval_prozent: istBuergschaft && form.aval_prozent.trim() !== "" ? Number(form.aval_prozent.replace(",", ".")) : undefined,
        rueckgabe_am: istBuergschaft ? (form.rueckgabe_am || form.ende || undefined) : undefined,
      });
      toast.success(bearbeiten ? t("Gespeichert") : t("Angelegt"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Versicherung bearbeiten") : t("Neue Versicherung / Bürgschaft")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="versicherung-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="vs-typ" className={LABEL}>{t("Typ")}</label>
            <select id="vs-typ" className={FELD} value={form.typ} onChange={(e) => setze("typ", e.target.value)}>
              {["berufshaftpflicht", "betriebshaftpflicht", "buergschaft", "sonstige"].map((k) => <option key={k} value={k}>{typText(k, t)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="vs-versicherer" className={LABEL}>{t("Versicherer")}</label>
            <input id="vs-versicherer" type="text" className={FELD} value={form.versicherer}
              aria-invalid={fehler.versicherer ? true : undefined} onChange={(e) => setze("versicherer", e.target.value)} />
            {fehler.versicherer && <p className={FEHLER}>{fehler.versicherer}</p>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="vs-police" className={LABEL}>{t("Police")}</label>
            <input id="vs-police" type="text" className={FELD} value={form.police} onChange={(e) => setze("police", e.target.value)} />
          </div>
          <BetragFeld id="vs-deckung" label={t("Deckung")} wert={deckung} onChange={setDeckung} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="vs-beginn" className={LABEL}>{t("Beginn")}</label>
            <input id="vs-beginn" type="date" className={FELD} value={form.beginn}
              aria-invalid={fehler.beginn ? true : undefined} onChange={(e) => beginnGeaendert(e.target.value)} />
            {fehler.beginn && <p className={FEHLER}>{fehler.beginn}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="vs-ende" className={LABEL}>{t("Ende")}</label>
            <input id="vs-ende" type="date" className={FELD} value={form.ende} onChange={(e) => setze("ende", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="vs-kuendigung" className={LABEL}>{t("Kündigungsfrist (Tage)")}</label>
            <input id="vs-kuendigung" type="text" inputMode="numeric" className={FELD} value={form.kuendigung_tage} onChange={(e) => setze("kuendigung_tage", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <BetragFeld id="vs-praemie" label={t("Prämie (jährlich)")} wert={praemie} onChange={setPraemie} />
          <div className="space-y-1">
            <label htmlFor="vs-zahlweise" className={LABEL}>{t("Zahlweise")}</label>
            <select id="vs-zahlweise" className={FELD} value={form.zahlweise} onChange={(e) => setze("zahlweise", e.target.value)}>
              {["monat", "quartal", "halbjahr", "jahr"].map((z) => <option key={z} value={z}>{zahlweiseText(z, t)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="vs-naechste" className={LABEL}>{t("Nächste Fälligkeit")}</label>
            <input id="vs-naechste" type="date" className={FELD} value={form.naechste_faelligkeit}
              onChange={(e) => setForm((f) => ({ ...f, naechste_faelligkeit: e.target.value, naechsteFaelligkeitAngefasst: true }))} />
          </div>
        </div>
        {fehler.praemie && <p className={FEHLER}>{fehler.praemie}</p>}
        {istBuergschaft && (
          <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <BetragFeld id="vs-buergschaft-betrag" label={t("Bürgschaftsbetrag")} wert={buergschaftBetrag} onChange={setBuergschaftBetrag} />
            <div className="space-y-1">
              <label htmlFor="vs-aval" className={LABEL}>{t("Avalprovision (% p. a.)")}</label>
              <input id="vs-aval" type="text" inputMode="decimal" className={FELD} value={form.aval_prozent} onChange={(e) => setze("aval_prozent", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="vs-rueckgabe" className={LABEL}>{t("Rückgabe am")}</label>
              <input id="vs-rueckgabe" type="date" className={FELD} value={form.rueckgabe_am} onChange={(e) => setze("rueckgabe_am", e.target.value)} />
            </div>
            {fehler.buergschaft_betrag && <p className={FEHLER}>{fehler.buergschaft_betrag}</p>}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, projektId: string|null}} props
 * @returns {React.ReactElement}
 */
export default function VersicherungenAbschnitt({ bh, projektId }) {
  const { t } = useI18n();
  const [formular, setFormular] = React.useState(/** @type {"neu"|Record<string, any>|null} */ (null));

  const alle = bh.daten.Versicherung || [];
  const liste = projektId ? alle.filter((v) => !v.project_id || v.project_id === projektId) : alle;
  const warnungen = ablaufWarnungen(bh.daten, bh.heute, bh.einst.ablauf_warn_tage);
  const warnungJe = (/** @type {string} */ id) => warnungen.filter((w) => w.id === id);

  return (
    <section className="space-y-3" aria-labelledby="vs-titel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="vs-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Versicherungen und Bürgschaften")}</h3>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setFormular("neu")}>
          <Plus aria-hidden="true" /> {t("Neue Versicherung")}
        </button>
      </div>
      {liste.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Versicherungen angelegt.")}</p>
      ) : (
        <ul className="space-y-2">
          {liste.map((v) => {
            const naechste = versicherungFaelligkeiten(v, bh.heute, /** @type {string} */ (plusMonate(bh.heute, 24)))[0] || null;
            const eigeneWarnungen = warnungJe(v.id);
            const buergschaft = v.typ === "buergschaft" ? buergschaftStatus(v, bh.heute) : null;
            return (
              <li key={v.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{v.versicherer}</span>{" "}
                    <span className="text-sm text-slate-600 dark:text-slate-300">
                      {typText(v.typ, t)}{v.police ? ` · ${v.police}` : ""} · {zahlweiseText(v.zahlweise, t)} · {formatEuro(euroZuCent(v.praemie))}
                    </span>
                  </div>
                  <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular(v)}>{t("Bearbeiten")}</button>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("Nächste Fälligkeit")}: {naechste ? `${naechste.datum} · ${formatEuro(euroZuCent(naechste.betrag))}` : "—"}
                  {v.ende && ` · ${t("Ende")}: ${v.ende}`}
                </p>
                {buergschaft && (
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" data-testid="buergschaft-status">
                    {t("Avalprovision")} {buergschaft.jahr}: {formatEuro(buergschaft.avalprovisionJahrCent)}
                    {buergschaft.rueckgabeAm && ` · ${t("Rückgabe am")} ${buergschaft.rueckgabeAm}`}
                  </p>
                )}
                {eigeneWarnungen.length > 0 && (
                  <p role="alert" className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {eigeneWarnungen.some((w) => w.grund === "ablauf") ? t("Läuft bald ab") : t("Kündigungsfrist läuft bald ab")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {formular && (
        <VersicherungFormular bh={bh} versicherung={formular === "neu" ? null : formular} onClose={() => setFormular(null)} />
      )}
    </section>
  );
}
