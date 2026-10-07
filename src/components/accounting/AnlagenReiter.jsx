// Tab "Anlagen" of /Accounting (phase 79, plan 79-09, BUCH-13): the
// fixed-asset register (straight-line/GWG/pool depreciation), a card to take
// a purchased fleet vehicle over as a fixed asset, and a card to activate an
// eligible incoming invoice as one. Replaces the stub built by 79-01.
//
// In:  props bh (page loader object). Out: the tab.

import React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import {
  afaSumme, anlagenTabelle, anlagenverzeichnis, ausEingangsrechnung, fahrzeugKandidaten, fahrzeugUebernehmen,
  kategorieText, methodeText, methodeVorschlag, nutzungsdauerVorschlag,
} from "@/lib/accounting/anlagen.js";
import { euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import AnlageFormular from "./AnlageFormular.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * Years present among the assets (by acquisition date) plus the current one,
 * newest first — pattern of FuhrparkReiter.jsx jahresListe().
 * @param {any[]} anlagen
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number[]}
 */
function jahresListe(anlagen, heute) {
  const menge = new Set(anlagen.map((a) => Number(String(a?.anschaffung_datum || "").slice(0, 4))).filter(Boolean));
  menge.add(Number(heute.slice(0, 4)));
  return [...menge].sort((a, b) => b - a);
}

/**
 * The incoming invoice that most likely paid for a vehicle: the largest net
 * amount booked against it (a purchase is normally the single biggest entry
 * for that car; smaller ones are running costs such as fuel or service —
 * 79-08's fuhrpark.fahrzeugKosten also books those against the same
 * fahrzeug_id, so this is a best-effort pick, not a certainty).
 * @param {{Eingangsrechnung?: Array<Record<string, any>>}} daten bh.daten
 * @param {string} fahrzeugId
 * @returns {Record<string, any>|null}
 */
function kaufrechnungFuer(daten, fahrzeugId) {
  const treffer = (daten.Eingangsrechnung || []).filter((e) => e?.fahrzeug_id === fahrzeugId);
  if (!treffer.length) return null;
  return treffer.reduce((a, b) => (Number(b?.netto) > Number(a?.netto) ? b : a));
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props bh: page loader object
 * @returns {React.ReactElement}
 */
export default function AnlagenReiter({ bh }) {
  const { t } = useI18n();
  const [jahr, setJahr] = React.useState(() => Number(bh.heute.slice(0, 4)));
  const [formular, setFormular] = React.useState(/** @type {"neu"|Record<string, any>|null} */ (null));

  const anlagen = bh.daten.Anlagegut || [];
  const zeilen = anlagenverzeichnis(bh.daten, jahr, bh.saetze);
  const summeAfaCent = afaSumme(bh.daten, jahr, bh.saetze);
  const summeRestbuchwertCent = zeilen.reduce((n, a) => n + a.restbuchwertCent, 0);

  const fahrzeugkandidaten = fahrzeugKandidaten(bh.daten);
  const aktivierbareRechnungen = (bh.daten.Eingangsrechnung || []).filter((e) => !e?.anlage_id && Number(e?.netto) > 250);

  const uebernehmen = (/** @type {Record<string, any>} */ fahrzeug) => {
    try {
      setFormular(fahrzeugUebernehmen(fahrzeug, kaufrechnungFuer(bh.daten, fahrzeug.id)));
    } catch (err) {
      toast.error(/** @type {any} */ (err)?.message || String(err));
    }
  };

  // "Aktivieren" writes right away (no dialog): every field of the draft has
  // a defensible default (kategorie/AK aus der Rechnung, ND/Methode aus der
  // Vorschlag-Tabelle) and the new asset can still be corrected afterwards
  // with the normal "Bearbeiten" action, same as any other row.
  const aktivieren = async (/** @type {Record<string, any>} */ rechnung) => {
    const { entwurf, schreibliste } = ausEingangsrechnung(rechnung);
    const ergaenzterEntwurf = {
      ...entwurf,
      nutzungsdauer: nutzungsdauerVorschlag(entwurf.kategorie, bh.saetze) || 1,
      methode: methodeVorschlag(euroZuCent(entwurf.ak_netto), bh.saetze),
    };
    const ergaenzteSchreibliste = schreibliste.map((w) => (w.entitaet === "Anlagegut" ? { ...w, obj: ergaenzterEntwurf } : w));
    try {
      await bh.speichereViele(ergaenzteSchreibliste);
      toast.success(t("Anlage aus Eingangsrechnung aktiviert"));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  return (
    <div className="space-y-6" data-besitzer="79-09">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Anlagen")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="ag-jahr">{t("Jahr")}</label>
          <select id="ag-jahr" className={FELD} value={String(jahr)} onChange={(e) => setJahr(Number(e.target.value))}>
            {jahresListe(anlagen, bh.heute).map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <ExportKnopf modell={() => anlagenTabelle(bh.daten, jahr, t, bh.saetze)} bereich="anlagen" jahr={jahr} />
          <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} onClick={() => setFormular("neu")}>
            <Plus aria-hidden="true" /> {t("Neue Anlage")}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("GWG-Grenze")} {formatEuro(euroZuCent(bh.saetze?.afa?.gwg_grenze))} ·{" "}
        {t("Sammelposten")} {formatEuro(euroZuCent(bh.saetze?.afa?.sammelposten?.von))}–{formatEuro(euroZuCent(bh.saetze?.afa?.sammelposten?.bis))} ·{" "}
        {t("Werte und Quelle in den Einstellungen.")}
      </p>

      <section className="space-y-2" data-testid="anlagenliste">
        {zeilen.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Anlagegüter angelegt.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  {[t("Bezeichnung"), t("Kategorie"), t("Anschaffungsdatum"), t("AK netto"), t("Nutzungsdauer (Jahre)"),
                    t("Methode"), t("AfA im Jahr"), t("Restbuchwert"), ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {zeilen.map((a) => (
                  <tr key={a.id} data-testid={`ag-zeile-${a.id}`}>
                    <td className="px-3 py-2">{a.bezeichnung}</td>
                    <td className="px-3 py-2">{kategorieText(a.kategorie, t)}</td>
                    <td className="px-3 py-2">{a.anschaffung_datum}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(euroZuCent(a.ak_netto))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.nutzungsdauer}</td>
                    <td className="px-3 py-2">{methodeText(a.methode, t)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" data-testid="ag-afa">{formatEuro(a.afaJahrCent)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" data-testid="ag-restbuchwert">{formatEuro(a.restbuchwertCent)}</td>
                    <td className="px-3 py-2">
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular(a)}>{t("Bearbeiten")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-medium dark:border-slate-700">
                  <td className="px-3 py-2" colSpan={6}>{t("Summe")}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="anlagen-summe-afa">{formatEuro(summeAfaCent)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEuro(summeRestbuchwertCent)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="fahrzeuge-uebernehmen">
        <h3 className="font-medium text-slate-800 dark:text-slate-100">{t("Fahrzeuge aus dem Fuhrpark übernehmen")}</h3>
        {fahrzeugkandidaten.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine offenen Kauf-Fahrzeuge.")}</p>
        ) : (
          <ul className="space-y-1">
            {fahrzeugkandidaten.map((f) => (
              <li key={f.id} data-testid={`fz-kandidat-${f.id}`} className="flex items-center justify-between gap-2 text-sm">
                <span>{f.kennzeichen} {f.nutzer ? `(${f.nutzer})` : ""}</span>
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => uebernehmen(f)}>{t("Übernehmen")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="eingangsrechnung-aktivieren">
        <h3 className="font-medium text-slate-800 dark:text-slate-100">{t("Aus Eingangsrechnung aktivieren")}</h3>
        {aktivierbareRechnungen.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine aktivierbaren Eingangsrechnungen.")}</p>
        ) : (
          <ul className="space-y-1">
            {aktivierbareRechnungen.map((e) => (
              <li key={e.id} data-testid={`er-aktivierbar-${e.id}`} className="flex items-center justify-between gap-2 text-sm">
                <span>{e.lieferant} — {formatEuro(euroZuCent(e.netto))}</span>
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => aktivieren(e)}>{t("Aktivieren")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {formular && (
        <AnlageFormular bh={bh} eintrag={formular === "neu" ? null : formular} onClose={() => setFormular(null)} />
      )}
    </div>
  );
}
