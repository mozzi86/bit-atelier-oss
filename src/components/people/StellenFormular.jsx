// StellenFormular.jsx — Stelle anlegen/bearbeiten, dazu der Anzeigentext-
// Dialog (Plan 80-08, Task 3). AGG-Hinweise erscheinen live unter dem
// Stellentitel (pruefeStellentext); der Anzeigentext selbst kommt aus
// stellenanzeige.js — nur "Kopieren" und "Als PDF", NIE ein Versand oder
// eine Veröffentlichung aus der App heraus.
//
// Native <input>/<label>/<select> statt shadcn-Wrapper (CLAUDE.md
// "shadcn-tsc-Altlast", Muster wie VertragsFormular.jsx).
//
// Anforderungen: gespeichert als `string[]` (80-02-Typedef), im Formular als
// {bezeichnung, muss}. Beide Richtungen laufen über leseAnforderung/
// schreibeAnforderung (stellenanzeige.js) — beim Öffnen einer gespeicherten
// Stelle genauso wie beim Speichern, damit Text und Muss/Kann nie verloren gehen.
//
// In:  StellenFormular {stelle, onClose, onGespeichert}; AnzeigentextDialog
//      {stelle, briefkopf, onClose}. Out: UI, ein create/update über
//      bitApi.personal.Stelle.

import React from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { exportElementToPdf } from "@core/lib/pdf";
import FormModal from "@core/components/common/FormModal";
import { pruefeStellentext } from "@/lib/people/aggHinweise.js";
import { stellenanzeigeText, leseAnforderung, schreibeAnforderung } from "@/lib/people/stellenanzeige.js";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/**
 * Stellenstatus (personalEntitaeten.js Typedef Stelle `status`). `label` ist
 * die ANZEIGE, nicht der gespeicherte Wert (`key` bleibt "entwurf") — "Entwurf"
 * allein kollidiert mit i18n.jsx ("Entwurf" = "Design", die Entwurfsphase
 * eines Bauprojekts), deshalb "Stellenentwurf" wie "Vertragsentwurf" in
 * personal-vertraege.js (80-RESEARCH Pitfall 17).
 */
export const STELLEN_STATUS = Object.freeze([
  { key: "entwurf", label: "Stellenentwurf" },
  { key: "offen", label: "Offen" },
  { key: "pausiert", label: "Pausiert" },
  { key: "besetzt", label: "Besetzt" },
  { key: "geschlossen", label: "Geschlossen" },
]);

/** Vorschläge für Anforderungen — freies Feld, keine Whitelist (nur Tippunterstützung). */
const ANFORDERUNG_VORSCHLAEGE = Object.freeze([
  "LPH 1", "LPH 2", "LPH 3", "LPH 4", "LPH 5", "LPH 6", "LPH 7", "LPH 8", "LPH 9",
  "ArchiCAD", "Revit", "Vectorworks", "AVA-Software",
  "Kammerfähig (ByAK o. Ä.)", "Bauvorlageberechtigt", "Führerschein B (Bauleitung)",
]);

/**
 * @param {object|null} stelle gespeicherte Stelle (anforderungen: string[]) oder null
 * @returns {object} leerer Entwurf oder Kopie mit anforderungen als {bezeichnung, muss}[]
 */
function entwurfAus(stelle) {
  if (stelle) {
    const kopie = structuredClone(stelle);
    const roh = Array.isArray(kopie.anforderungen) ? kopie.anforderungen : [];
    return { ...kopie, anforderungen: roh.map(leseAnforderung).filter(Boolean) };
  }
  return {
    titel: "", status: "entwurf", beschaeftigungsart: "angestellt", wochenstunden: 40,
    befristet: false, beginn_ab: "", aufgaben: "", anforderungen: [],
    gehaltsspanne: { von_eur: null, bis_eur: null, einheit: "Monat" },
  };
}

/**
 * @param {{stelle: object|null, onClose: () => void, onGespeichert?: () => void}} props
 * @returns {React.ReactElement}
 */
export default function StellenFormular({ stelle, onClose, onGespeichert }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = React.useState(() => entwurfAus(stelle));
  const [neueAnforderung, setNeueAnforderung] = React.useState("");
  const [speichern, setSpeichern] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const istBearbeiten = Boolean(stelle?.id);

  const setzen = (feld, wert) => setEntwurf((e) => ({ ...e, [feld]: wert }));
  const setzenSpanne = (feld, wert) => setEntwurf((e) => ({ ...e, gehaltsspanne: { ...e.gehaltsspanne, [feld]: wert } }));

  const aggHinweise = pruefeStellentext(entwurf.titel);

  const anforderungHinzufuegen = () => {
    // Typed "Revit (von Vorteil)" lands as Kann right away, same rule as on load.
    const neu = leseAnforderung(neueAnforderung);
    if (!neu) return;
    setzen("anforderungen", [...(entwurf.anforderungen || []), neu]);
    setNeueAnforderung("");
  };
  const anforderungEntfernen = (i) => setzen("anforderungen", entwurf.anforderungen.filter((_, idx) => idx !== i));
  const anforderungMussUmschalten = (i) => setzen("anforderungen", entwurf.anforderungen.map((a, idx) => (idx === i ? { ...a, muss: !a.muss } : a)));

  const speichernAusfuehren = async (e) => {
    e.preventDefault();
    setSpeichern(true);
    setFehler(null);
    try {
      const client = /** @type {any} */ (bitApi.personal).Stelle;
      const anforderungen = (entwurf.anforderungen || []).map(schreibeAnforderung).filter(Boolean);
      const payload = { ...entwurf, anforderungen };
      delete payload.id;
      if (istBearbeiten) await client.update(stelle.id, payload);
      else await client.create(payload);
      onGespeichert?.();
      onClose();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setSpeichern(false);
    }
  };

  return (
    <FormModal title={istBearbeiten ? t("Stelle bearbeiten") : t("Stelle anlegen")} onClose={onClose}>
      <form onSubmit={speichernAusfuehren} className="space-y-6" data-testid="stellen-formular">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Titel und Status")}</legend>
          <div className="sm:col-span-2">
            <label htmlFor="sf-titel" className={BESCHRIFTUNG}>{t("Stellentitel")}</label>
            <input id="sf-titel" required className={EINGABE} value={entwurf.titel} onChange={(e) => setzen("titel", e.target.value)} placeholder={t("z. B. Architekt:in (m/w/d) LPH 5–8")} />
            {aggHinweise.length > 0 && (
              <ul className="mt-1 space-y-0.5" data-testid="agg-hinweise">
                {aggHinweise.map((h, i) => (
                  <li key={i} className="text-xs text-amber-700 dark:text-amber-300">{t(h.hinweis)} ({h.norm})</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label htmlFor="sf-status" className={BESCHRIFTUNG}>{t("Status")}</label>
            <select id="sf-status" className={EINGABE} value={entwurf.status} onChange={(e) => setzen("status", e.target.value)}>
              {STELLEN_STATUS.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sf-beginn" className={BESCHRIFTUNG}>{t("Beginn ab")}</label>
            <input id="sf-beginn" type="date" className={EINGABE} value={entwurf.beginn_ab || ""} onChange={(e) => setzen("beginn_ab", e.target.value)} />
          </div>
          <div>
            <label htmlFor="sf-wochenstunden" className={BESCHRIFTUNG}>{t("Wochenstunden")}</label>
            <input id="sf-wochenstunden" type="number" min={1} className={EINGABE} value={entwurf.wochenstunden ?? 0} onChange={(e) => setzen("wochenstunden", Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2">
            <input id="sf-befristet" type="checkbox" checked={Boolean(entwurf.befristet)} onChange={(e) => setzen("befristet", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
            <label htmlFor="sf-befristet" className={BESCHRIFTUNG}>{t("Befristet")}</label>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sf-aufgaben" className={BESCHRIFTUNG}>{t("Aufgaben")}</label>
            <textarea id="sf-aufgaben" rows={3} className={EINGABE} value={entwurf.aufgaben || ""} onChange={(e) => setzen("aufgaben", e.target.value)} />
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Anforderungen")}</legend>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label htmlFor="sf-anforderung-neu" className={BESCHRIFTUNG}>{t("Anforderung hinzufügen (Enter)")}</label>
              <input id="sf-anforderung-neu" list="sf-anforderung-vorschlaege" className={EINGABE} value={neueAnforderung}
                onChange={(e) => setNeueAnforderung(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anforderungHinzufuegen(); } }} />
              <datalist id="sf-anforderung-vorschlaege">
                {ANFORDERUNG_VORSCHLAEGE.map((v) => <option key={v} value={v} />)}
              </datalist>
            </div>
            <button type="button" onClick={anforderungHinzufuegen} className="h-9 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
              {t("Hinzufügen")}
            </button>
          </div>
          {(entwurf.anforderungen || []).length > 0 && (
            <ul className="mt-2 space-y-1.5" data-testid="sf-anforderungen">
              {entwurf.anforderungen.map((a, i) => (
                <li key={`${a.bezeichnung}-${i}`} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{a.bezeichnung}</span>
                  <label className="ml-auto flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={Boolean(a.muss)} onChange={() => anforderungMussUmschalten(i)} className="h-3.5 w-3.5" />
                    {t("Muss (sonst Kann)")}
                  </label>
                  <button type="button" onClick={() => anforderungEntfernen(i)} className="rounded-md px-2 py-0.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
                    {t("entfernen")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Gehaltsspanne")}</legend>
          <div>
            <label htmlFor="sf-gehalt-von" className={BESCHRIFTUNG}>{t("Von (€)")}</label>
            <input id="sf-gehalt-von" type="number" min={0} className={EINGABE} value={entwurf.gehaltsspanne?.von_eur ?? ""} onChange={(e) => setzenSpanne("von_eur", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="sf-gehalt-bis" className={BESCHRIFTUNG}>{t("Bis (€)")}</label>
            <input id="sf-gehalt-bis" type="number" min={0} className={EINGABE} value={entwurf.gehaltsspanne?.bis_eur ?? ""} onChange={(e) => setzenSpanne("bis_eur", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="sf-gehalt-einheit" className={BESCHRIFTUNG}>{t("Einheit")}</label>
            <select id="sf-gehalt-einheit" className={EINGABE} value={entwurf.gehaltsspanne?.einheit || "Monat"} onChange={(e) => setzenSpanne("einheit", e.target.value)}>
              <option value="Monat">{t("€/Monat")}</option>
              <option value="Stunde">{t("€/Stunde")}</option>
            </select>
          </div>
        </fieldset>

        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            {t("Abbrechen")}
          </button>
          <button type="submit" disabled={speichern || !entwurf.titel} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {t("Speichern")}
          </button>
        </div>
      </form>
    </FormModal>
  );
}

/**
 * Der Anzeigentext-Dialog: nur Kopieren und Als-PDF, NIE ein Versand oder
 * eine Veröffentlichung. `schuetzen={false}` — es gibt hier nichts einzugeben,
 * das verloren gehen könnte.
 * @param {{stelle: object, briefkopf: object|null, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
export function AnzeigentextDialog({ stelle, briefkopf, onClose }) {
  const { t } = useI18n();
  const [kopiert, setKopiert] = React.useState(false);
  const textRef = React.useRef(/** @type {HTMLPreElement|null} */ (null));
  const text = stellenanzeigeText(stelle, briefkopf);

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      setKopiert(false);
    }
  };
  const alsPdf = async () => {
    if (textRef.current) await exportElementToPdf(textRef.current, `Stellenanzeige-${(stelle?.titel || "Stelle").replace(/\s+/g, "-")}.pdf`);
  };

  return (
    <FormModal title={t("Anzeigentext")} onClose={onClose} schuetzen={false}>
      <div className="space-y-4" data-testid="anzeigentext-dialog">
        <pre ref={textRef} className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">{text}</pre>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={kopieren} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {kopiert ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {t("Kopieren")}
          </button>
          <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{kopiert ? t("In die Zwischenablage kopiert.") : ""}</span>
          <button type="button" onClick={alsPdf} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {t("Als PDF")}
          </button>
        </div>
        <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            {t("Schließen")}
          </button>
        </div>
      </div>
    </FormModal>
  );
}
