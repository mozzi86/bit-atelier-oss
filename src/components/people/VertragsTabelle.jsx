// VertragsTabelle.jsx — Liste aller Arbeitsverträge (Plan 80-06, Task 4).
// Muster: src/components/finance/ChangeOrderTable.jsx:31-149 (native <table>),
// wie MitarbeiterTabelle.jsx (80-04) aus derselben Reiter-Familie.
//
// Ein Vertrag im Status 'entwurf' wird bearbeitet (überschrieben — er ist noch
// nicht unterschrieben). Ein Vertrag im Status 'unterschrieben'/'gekuendigt'
// wird NIE überschrieben: "Neuer Vertrag (ersetzt den bisherigen)" öffnet das
// Formular mit einer Kopie als Entwurf und `ersetztVertragId` gesetzt.
//
// In:  {vertraege, mitarbeiterListe, gehaelter, faellig, hervorhebenId,
//      onBearbeiten(vertrag), onErsetzen(vertrag)}.
// Out: UI, keine eigenen Schreibzugriffe.

import React from "react";
import { Pencil, Repeat } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { VERTRAGSARTEN, gehaltAm } from "@/lib/people/vertrag.js";
import { anzeigeName } from "@/lib/people/mitarbeiter.js";
import { Betrag } from "./GehaltSichtbarkeit.jsx";

const TH = "h-10 px-2 text-left align-middle font-medium text-muted-foreground";
const TD = "p-2 align-middle";
const TR = "border-b transition-colors hover:bg-muted/50";

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

// Eigene Anzeige-Texte statt VERTRAGS_STATUS[i].label direkt zu übersetzen:
// "Entwurf" ist in i18n.jsx bereits "Design" (Entwurfsphase eines Bauprojekts)
// — ein anderer Sinn desselben deutschen Worts. Wörterbuch-Doppel vermieden
// (80-RESEARCH Pitfall 17); die übrigen Status-Schlüssel kollidieren nicht.
const STATUS_TEXT = Object.freeze({
  entwurf: "Vertragsentwurf", unterschrieben: "Unterschrieben", gekuendigt: "Gekündigt", beendet: "Beendet", ersetzt: "Ersetzt",
});

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * @param {{
 *   vertraege: object[], mitarbeiterListe: object[], gehaelter: object[],
 *   faellig: import("@/lib/people/fristen.js").PersonalFrist[],
 *   hervorhebenId?: string, onBearbeiten: (v: object) => void, onErsetzen: (v: object) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function VertragsTabelle({ vertraege, mitarbeiterListe, gehaelter, faellig, hervorhebenId, onBearbeiten, onErsetzen }) {
  const { t } = useI18n();
  const containerRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));

  // ?vertrag=<id> (aus der Fristenleiste, Behavior 16): die Zeile fokussieren.
  React.useEffect(() => {
    if (!hervorhebenId) return;
    const el = /** @type {HTMLElement|null} */ (containerRef.current?.querySelector(`[data-vertrag="${hervorhebenId}"]`));
    if (el && typeof el.focus === "function") { el.scrollIntoView?.({ block: "nearest" }); el.focus(); }
  }, [hervorhebenId]);

  const mitarbeiterVon = (id) => mitarbeiterListe.find((m) => m.id === id) ?? null;
  const naechsteFristVon = (vertragId) => {
    const treffer = faellig.filter((f) => f.bezug?.tab === "contracts" && f.bezug?.id === vertragId);
    return treffer.length ? treffer[0] : null; // faellig ist bereits nach Datum sortiert (personalFristen)
  };

  const sortiert = [...vertraege].sort((a, b) => (a.beginn < b.beginn ? 1 : a.beginn > b.beginn ? -1 : 0));

  return (
    <div data-testid="vertraege-tabelle">
      <div className="mb-3 flex items-center justify-between">
        <span role="status" className="text-sm text-slate-500 dark:text-slate-400">
          {fuellen(t("{n} Verträge"), { n: vertraege.length })}
        </span>
      </div>
      <div ref={containerRef} className="relative w-full overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full caption-bottom text-sm" aria-label={t("Verträge")}>
          <thead className="[&_tr]:border-b">
            <tr className={TR}>
              <th scope="col" className={TH}>{t("Person")}</th>
              <th scope="col" className={TH}>{t("Vertragsart")}</th>
              <th scope="col" className={TH}>{t("Beginn – Ende")}</th>
              <th scope="col" className={TH}>{t("Wochenstunden")}</th>
              <th scope="col" className={TH}>{t("Urlaub")}</th>
              <th scope="col" className={TH}>{t("Status")}</th>
              <th scope="col" className={TH}>{t("Gehalt")}</th>
              <th scope="col" className={TH}>{t("Nächste Frist")}</th>
              <th scope="col" className={TH}>{t("Aktionen")}</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {sortiert.map((v) => {
              const m = mitarbeiterVon(v.mitarbeiter_id);
              const art = VERTRAGSARTEN.find((a) => a.key === v.vertragsart);
              const gehalt = gehaltAm(gehaelter, v.mitarbeiter_id, v.beginn);
              const einheit = m?.art === "werkstudent" ? "stunde" : "monat";
              const frist = naechsteFristVon(v.id);
              const kannErsetzen = v.status === "unterschrieben" || v.status === "gekuendigt";
              return (
                <tr key={v.id} className={TR} data-vertrag={v.id} tabIndex={-1}>
                  <td className={TD}>{anzeigeName(m) || "—"}</td>
                  <td className={TD}>{t(art?.label || v.vertragsart)}</td>
                  <td className={TD}>{fmtDatum(v.beginn)} – {v.ende ? fmtDatum(v.ende) : t("unbefristet")}</td>
                  <td className={TD}>{fuellen(t("{n} h/Woche"), { n: v.wochenstunden ?? "—" })}</td>
                  <td className={TD}>{fuellen(t("{n} Tage/Jahr"), { n: v.urlaub_tage_jahr ?? "—" })}</td>
                  <td className={TD}>{t(STATUS_TEXT[v.status] || v.status)}</td>
                  <td className={TD}><Betrag wert={gehalt?.brutto_eur} einheit={einheit} /></td>
                  <td className={TD}>
                    {frist ? (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${frist.ueberfaellig ? "border border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-100" : "border border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}>
                        {frist.ueberfaellig ? `${t("überfällig")}: ` : ""}{fuellen(t(frist.schluessel), frist.werte)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-1">
                      {v.status === "entwurf" && (
                        <button type="button" onClick={() => onBearbeiten(v)}
                          aria-label={t("Vertrag bearbeiten")}
                          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      {kannErsetzen && (
                        <button type="button" onClick={() => onErsetzen(v)} data-aktion="ersetzen"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                          <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> {t("Neuer Vertrag (ersetzt den bisherigen)")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sortiert.length === 0 && (
              <tr><td className={TD} colSpan={9}>{t("Noch keine Verträge erfasst.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
