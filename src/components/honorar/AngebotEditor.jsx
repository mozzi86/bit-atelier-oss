// Editor of a draft fee offer (phase 81-03): client, all fee fields of the
// service profile, special services, incidental costs, VAT, payment term, text
// blocks and the live breakdown with legal sources and the review line.
// Saving goes through aendern() — a sent version is immutable in the code — and
// the storage layer, with plain-text feedback (mitRueckmeldung, NA-13).
//
// In:  props zh, angebot (a draft), onClose. Out: a FormModal.

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";
import { aendern } from "@/lib/honorar/angebot.js";
import { aufstellung } from "@/lib/honorar/aufstellung.js";
import BetragFeld from "@/components/accounting/gemeinsam/BetragFeld.jsx";
import LeistungsbildFelder from "./LeistungsbildFelder.jsx";
import AufstellungTabelle from "./AufstellungTabelle.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const TEXT = "min-h-16 w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, angebot: Record<string, any>, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
export default function AngebotEditor({ zh, angebot, onClose }) {
  const { t } = useI18n();
  const [form, setForm] = React.useState(() => ({ ...angebot }));
  const [speichert, setSpeichert] = React.useState(false);
  const projekt = zh.projekte.find((p) => p.id === form.project_id) || null;
  const aendere = (/** @type {Record<string, any>} */ patch) => setForm((f) => ({ ...f, ...patch }));
  const a = aufstellung(form);
  const besondere = Array.isArray(form.besondere_leistungen) ? form.besondere_leistungen : [];
  const setzeBesondere = (/** @type {any[]} */ liste) => aendere({ besondere_leistungen: liste });

  const speichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    const r = aendern(angebot, form);
    if (!r.ok) return;
    setSpeichert(true);
    const ergebnis = await mitRueckmeldung(() => zh.speichere("Honorarangebot", r.angebot), { erfolg: t("Honorarangebot gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    setSpeichert(false);
    if (ergebnis.ok) onClose();
  };

  return (
    <FormModal title={`${t("Honorarangebot")} ${form.nummer} · ${t("Fassung")} ${form.fassung}`} onClose={onClose}>
      <form className="space-y-5" onSubmit={speichern} data-testid="angebot-editor">
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ed-bauherr" className={LABEL}>{t("Bauherr")}</label>
            <input id="ed-bauherr" className={FELD} value={form.bauherr_name || ""} onChange={(e) => aendere({ bauherr_name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ed-anschrift" className={LABEL}>{t("Anschrift")}</label>
            <input id="ed-anschrift" className={FELD} value={form.bauherr_anschrift || ""} onChange={(e) => aendere({ bauherr_anschrift: e.target.value })} />
          </div>
        </section>

        <LeistungsbildFelder wert={form} onChange={aendere} idPraefix="ed" projekt={projekt} />

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("Besondere Leistungen")}</h3>
          {besondere.map((b, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <label htmlFor={`ed-bl-titel-${i}`} className={LABEL}>{t("Titel")}</label>
                <input id={`ed-bl-titel-${i}`} className={FELD} value={b.titel || ""} onChange={(e) => setzeBesondere(besondere.map((x, k) => (k === i ? { ...x, titel: e.target.value } : x)))} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`ed-bl-art-${i}`} className={LABEL}>{t("Art")}</label>
                <select id={`ed-bl-art-${i}`} className={FELD} value={b.art || "pauschal"} onChange={(e) => setzeBesondere(besondere.map((x, k) => (k === i ? { ...x, art: e.target.value } : x)))}>
                  <option value="pauschal">{t("pauschal")}</option>
                  <option value="stunden">{t("nach Stunden")}</option>
                </select>
              </div>
              {b.art === "stunden" ? (
                <>
                  <div className="space-y-1">
                    <label htmlFor={`ed-bl-std-${i}`} className={LABEL}>{t("Stunden")}</label>
                    <input id={`ed-bl-std-${i}`} type="number" min="0" step="0.25" className={FELD} value={b.stunden ?? ""} onChange={(e) => setzeBesondere(besondere.map((x, k) => (k === i ? { ...x, stunden: Number(e.target.value) || 0 } : x)))} />
                  </div>
                  <BetragFeld id={`ed-bl-satz-${i}`} label={t("Stundensatz")} wert={typeof b.satz_eur_h === "number" ? Math.round(b.satz_eur_h * 100) : null}
                    onChange={(c) => setzeBesondere(besondere.map((x, k) => (k === i ? { ...x, satz_eur_h: c === null ? null : c / 100 } : x)))} />
                </>
              ) : (
                <>
                  <BetragFeld id={`ed-bl-betrag-${i}`} label={t("Betrag (€)")} wert={typeof b.betrag_euro === "number" ? Math.round(b.betrag_euro * 100) : null}
                    onChange={(c) => setzeBesondere(besondere.map((x, k) => (k === i ? { ...x, betrag_euro: c === null ? null : c / 100 } : x)))} />
                  <span />
                </>
              )}
              <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={t("Entfernen")} onClick={() => setzeBesondere(besondere.filter((_, k) => k !== i))}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setzeBesondere([...besondere, { titel: "", art: "pauschal", betrag_euro: null }])}>
            <Plus aria-hidden="true" /> {t("Besondere Leistung")}
          </button>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="ed-nk" className={LABEL}>{t("Nebenkosten (%)")}</label>
            <input id="ed-nk" type="number" min="0" max="20" step="0.5" className={FELD} value={form.nebenkosten_prozent ?? 5} onChange={(e) => aendere({ nebenkosten_prozent: Number(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ed-ust" className={LABEL}>{t("Umsatzsteuer (%)")}</label>
            <input id="ed-ust" type="number" min="0" max="25" className={FELD} value={form.ust_satz ?? 19} onChange={(e) => aendere({ ust_satz: Number(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ed-ziel" className={LABEL}>{t("Zahlungsziel (Tage)")}</label>
            <input id="ed-ziel" type="number" min="0" max="120" className={FELD} value={form.zahlungsziel_tage ?? 14} onChange={(e) => aendere({ zahlungsziel_tage: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </div>
        </section>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.zahlungsziel_vertraglich !== false} onChange={(e) => aendere({ zahlungsziel_vertraglich: e.target.checked })} /> {t("Zahlungsziel vertraglich vereinbart")}</label>
        <div className="space-y-1">
          <label htmlFor="ed-gueltig" className={LABEL}>{t("Gültig bis")}</label>
          <input id="ed-gueltig" type="date" className={FELD} value={form.gueltig_bis || ""} onChange={(e) => aendere({ gueltig_bis: e.target.value })} />
        </div>

        <section className="space-y-2">
          {[["vorbemerkung", "Vorbemerkung"], ["annahmen", "Annahmen"], ["ausschluesse", "Nicht enthalten"]].map(([k, l]) => (
            <div key={k} className="space-y-1">
              <label htmlFor={`ed-${k}`} className={LABEL}>{t(l)}</label>
              <textarea id={`ed-${k}`} className={TEXT} value={form.textbausteine?.[k] || ""} onChange={(e) => aendere({ textbausteine: { ...(form.textbausteine || {}), [k]: e.target.value } })} />
            </div>
          ))}
        </section>

        <AufstellungTabelle a={a} />

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
