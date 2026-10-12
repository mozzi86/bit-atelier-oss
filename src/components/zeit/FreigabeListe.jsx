// Tab "Freigabe" of /TimeTracking (phase 81-02, ZEIT-03): submitted weeks per
// person with their sums per project and stage; approve (with confirmation) or
// reject with a mandatory reason; approved weeks of the last four ISO weeks can
// be reopened — only by the person who approved them.
//
// The approver is the person chosen under "Stunden für" (there are no roles
// before phase 82; the tab says so). The proof lives on the booking itself
// (freigegeben_von/_am, ablehnung_grund) — NO AuditLog: personnel-related code
// never writes the AuditLog (80 invariant, D-P81-24).
//
// In:  props zh, zz. Out: the tab; status changes go through statusWechsel and
//      the storage layer.

import React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, RotateCcw, X } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { isoWoche, plusTage } from "@core/lib/kalender/datum.js";
import { kwSchluessel, statusWechsel } from "@/lib/zeit/zeitbuchung.js";
import { personAnzeigeName } from "@/lib/zeit/personalQuelle.js";
import { FEHLER, KARTE, LABEL, stundenText, zielText } from "./zeitGemeinsam.jsx";

/**
 * Bookings grouped by person and ISO week.
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @returns {Array<{schluessel: string, mitarbeiter_id: string, kw: string, buchungen: Array<Record<string, any>>, summe: number}>}
 */
function nachPersonUndWoche(buchungen) {
  /** @type {Map<string, any>} */
  const gruppen = new Map();
  for (const b of buchungen) {
    const schluessel = `${b.mitarbeiter_id}|${b.kw}`;
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, { schluessel, mitarbeiter_id: b.mitarbeiter_id, kw: b.kw, buchungen: [], summe: 0 });
    const g = gruppen.get(schluessel);
    g.buchungen.push(b);
    g.summe += Number(b.minuten) || 0;
  }
  return [...gruppen.values()].sort((a, b) => String(b.kw).localeCompare(String(a.kw)) || String(a.mitarbeiter_id).localeCompare(String(b.mitarbeiter_id)));
}

/**
 * Sums per target of a group (project/stage/kind or office category).
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @param {Map<string, string>} projektNamen
 * @param {(s: string) => string} t
 * @returns {Array<[string, number]>}
 */
function summenJeZiel(buchungen, projektNamen, t) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const b of buchungen) {
    const k = zielText(b, projektNamen, t);
    m.set(k, (m.get(k) || 0) + (Number(b.minuten) || 0));
  }
  return [...m.entries()];
}

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung}} props
 * @returns {React.ReactElement}
 */
export default function FreigabeListe({ zh, zz }) {
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();
  const [ablehnen, setAblehnen] = React.useState(/** @type {any} */ (null));
  const projektNamen = React.useMemo(() => new Map(zh.projekte.map((p) => [p.id, p.name])), [zh.projekte]);
  const name = (/** @type {string} */ id) => personAnzeigeName(zz.personen.find((p) => p.id === id) || { id }, t);
  // 82-02: a project lead approves only bookings of the projects in her project view.
  const zugriff = useZugriff();
  const alle = (zh.daten.Zeitbuchung || []).filter((b) => zugriff.darfProjekt(b.project_id));
  const offen = nachPersonUndWoche(alle.filter((b) => b.status === "eingereicht"));
  // Approved weeks of the last four ISO weeks (reopen window).
  const grenze = /** @type {{jahr: number, woche: number}} */ (isoWoche(/** @type {string} */ (plusTage(zh.heute, -28))));
  const grenzKw = kwSchluessel(grenze.jahr, grenze.woche);
  const frei = nachPersonUndWoche(alle.filter((b) => b.status === "freigegeben" && String(b.kw) >= grenzKw));

  const wechsel = async (/** @type {Array<Record<string, any>>} */ liste, /** @type {string} */ ziel, /** @type {string} */ grund = "") => {
    const jetztIso = new Date().toISOString();
    const aufgaben = [];
    for (const b of liste) {
      const r = /** @type {any} */ (statusWechsel(b, ziel, { nutzerId: zz.personId, grund, jetztIso }));
      if (!r.ok) {
        toast.error(r.fehler === "nicht_freigeber" ? t("Nur die Person, die freigegeben hat, kann wieder öffnen.") : t("Dieser Statuswechsel ist nicht erlaubt."));
        return false;
      }
      aufgaben.push({ art: /** @type {const} */ ("speichern"), entitaet: "Zeitbuchung", obj: r.buchung });
    }
    try {
      await zh.schreibeStapel(aufgaben);
      return true;
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
      return false;
    }
  };

  const freigeben = async (/** @type {any} */ g) => {
    const ok = await bestaetige({
      titel: t("Woche freigeben?"),
      text: `${name(g.mitarbeiter_id)} · ${g.kw} · ${stundenText(g.summe, lang)} h`,
      bestaetigen: t("Freigeben"),
    });
    if (ok && (await wechsel(g.buchungen, "freigegeben"))) toast.success(t("Woche freigegeben"));
  };

  return (
    <div className="space-y-6" data-testid="zeit-freigabe">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Bis Rollen & Rechte (Phase 82) kann jede Person freigeben.")} {t("Sie geben frei als")}: <strong>{name(zz.personId)}</strong>
      </p>
      {!zz.regeln.freigabePflicht && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {t("Freigabe ist in den Regelwerken ausgeschaltet.")} <Link to="/Settings?tab=rules" className="underline">{t("Regelwerke öffnen")}</Link>
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Eingereicht")}</h2>
        {offen.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine eingereichten Wochen.")}</p>}
        {offen.map((g) => (
          <div key={g.schluessel} className={KARTE} data-testid="zeit-freigabe-woche">
            <p className="font-medium text-slate-800 dark:text-slate-100">{name(g.mitarbeiter_id)} · {g.kw} · {stundenText(g.summe, lang)} h</p>
            <ul className="text-sm text-slate-700 dark:text-slate-200">
              {summenJeZiel(g.buchungen, projektNamen, t).map(([k, m]) => <li key={k} className="flex justify-between gap-4"><span>{k}</span><span className="tabular-nums">{stundenText(m, lang)} h</span></li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} onClick={() => freigeben(g)}><Check aria-hidden="true" /> {t("Woche freigeben")}</button>
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setAblehnen(g)}><X aria-hidden="true" /> {t("Ablehnen")}</button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Freigegeben (letzte 4 Wochen)")}</h2>
        {frei.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine freigegebenen Wochen.")}</p>}
        {frei.map((g) => {
          const eigene = g.buchungen.every((b) => b.freigegeben_von === zz.personId);
          return (
            <div key={g.schluessel} className={`${KARTE} flex flex-wrap items-center gap-2`}>
              <span className="flex-1 text-sm text-slate-800 dark:text-slate-100">{name(g.mitarbeiter_id)} · {g.kw} · {stundenText(g.summe, lang)} h · {t("freigegeben von")} {name(g.buchungen[0].freigegeben_von)}</span>
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!eigene}
                title={eigene ? undefined : t("Nur die Person, die freigegeben hat, kann wieder öffnen.")}
                onClick={async () => { if (await wechsel(g.buchungen, "entwurf")) toast.success(t("Woche wieder geöffnet")); }}>
                <RotateCcw aria-hidden="true" /> {t("Wieder öffnen")}
              </button>
            </div>
          );
        })}
      </section>

      {ablehnen && <AblehnenDialog gruppe={ablehnen} titel={`${name(ablehnen.mitarbeiter_id)} · ${ablehnen.kw}`} onClose={() => setAblehnen(null)}
        onAblehnen={async (grund) => { if (await wechsel(ablehnen.buchungen, "abgelehnt", grund)) { toast.success(t("Woche abgelehnt")); setAblehnen(null); } }} />}
    </div>
  );
}

/**
 * Reject dialog with a mandatory reason (the button stays disabled without text).
 * @param {{gruppe: any, titel: string, onClose: () => void, onAblehnen: (grund: string) => void}} props
 * @returns {React.ReactElement}
 */
function AblehnenDialog({ titel, onClose, onAblehnen }) {
  const { t } = useI18n();
  const [grund, setGrund] = React.useState("");
  return (
    <FormModal title={`${t("Woche ablehnen")} — ${titel}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (grund.trim()) onAblehnen(grund.trim()); }}>
        <label htmlFor="ablehnen-grund" className={LABEL}>{t("Grund (Pflicht)")}</label>
        <textarea id="ablehnen-grund" className="min-h-24 w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={grund} onChange={(e) => setGrund(e.target.value)} />
        {!grund.trim() && <p className={`${FEHLER} text-xs`}>{t("Ohne Grund kann nicht abgelehnt werden.")}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "destructive" })} disabled={!grund.trim()}>{t("Ablehnen")}</button>
        </div>
      </form>
    </FormModal>
  );
}
