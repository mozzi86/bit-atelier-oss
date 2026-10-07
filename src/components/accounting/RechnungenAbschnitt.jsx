// Section "Rechnungen" of the outgoing-invoice tab (79-02, T3): list, filter,
// deep-links (?filter=, ?rechnung=, ?neu=1&vertrag=), issuing, payments,
// storno and the CSV/XLSX export. Fills the 79-01 stub.
//
// In:  props bh, projektId (contract of the accounting page). Out: the area;
//      every write goes through bh.speichere/bh.loesche and reloads itself.

import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { toast } from "sonner";
import {
  abschlagsEntwurf, ausgangTabelle, doppelteRechnung, istEditierbar, stelleRechnung, storniere, zahlungErfassen,
} from "@/lib/accounting/ausgangsrechnungen.js";
import { rechnungsStatus } from "@/lib/accounting/grundlagen.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";
import StatusMarke from "./gemeinsam/StatusMarke.jsx";
import RechnungFormular from "./RechnungFormular.jsx";

const TH = "h-9 px-2 text-left align-middle text-xs font-medium text-slate-500 dark:text-slate-400";
const TD = "px-2 py-1.5 align-middle text-sm";
const TR = "border-b border-slate-100 dark:border-slate-800";

// Native elements instead of the shadcn Card wrappers: Card/CardHeader/
// CardContent cost a tsc error each under the current React typing (same
// class of "children not assignable" error as the Tabs case in 79-01) — kept
// as plain classed <div>s/<h3>, one card class per component.
const KARTE = "rounded-xl border bg-card text-card-foreground shadow";
const KARTE_KOPF = "flex flex-col space-y-1.5 p-6";
const KARTE_TITEL = "font-semibold leading-none tracking-tight";
const KARTE_INHALT = "p-6 pt-0";

/** @param {string|null|undefined} iso 'YYYY-MM-DD' @returns {string} dd.mm.yyyy or "—" */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

/**
 * The project's HoaiPlan (read-only Leistungsstand source, same read as
 * HonorarvertragFormular) — null when none exists or the read fails; the
 * proposal then falls back to lpStand()'s project-phase estimate.
 * @param {string} projectId
 * @returns {Promise<{progress?: number[]}|null>}
 */
async function hoaiPlanLesen(projectId) {
  try {
    const zeilen = await /** @type {any} */ (bitApi).entities.HoaiPlan.filter({ project_id: projectId });
    return Array.isArray(zeilen) && zeilen[0] ? zeilen[0] : null;
  } catch (fehler) {
    console.error("[Buchhaltung] HoaiPlan nicht lesbar, Leistungsstand aus der Projektphase:", fehler);
    return null;
  }
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, projektId: string|null}} props
 * @returns {React.ReactElement}
 */
export default function RechnungenAbschnitt({ bh, projektId }) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const alle = React.useMemo(() => bh.daten.Ausgangsrechnung || [], [bh.daten.Ausgangsrechnung]);
  const liste = React.useMemo(() => (projektId ? alle.filter((r) => r.project_id === projektId) : alle), [alle, projektId]);

  const [statusFilter, setStatusFilter] = React.useState(() => searchParams.get("filter") || "");
  const [jahrFilter, setJahrFilter] = React.useState("");

  // ?filter=… also applies on a LATER change of the URL (not only the first
  // mount) — a link opened while this tab is already showing must still filter.
  React.useEffect(() => {
    setStatusFilter(searchParams.get("filter") || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("filter")]);
  const [formular, setFormular] = React.useState(/** @type {{modus: "neu"|"bearbeiten"|"lesen", rechnung?: any, vorlage?: any, projektIdVorwahl?: string|null, vertrag?: any}|null} */ (null));
  const [zahlungFuer, setZahlungFuer] = React.useState(/** @type {any} */ (null));
  const [zahlungDatum, setZahlungDatum] = React.useState("");
  const [zahlungBetrag, setZahlungBetrag] = React.useState(/** @type {number|null} */ (null));
  const [stornoFuer, setStornoFuer] = React.useState(/** @type {any} */ (null));
  const [stellenFuer, setStellenFuer] = React.useState(/** @type {any} */ (null));

  // Both deep links wait for the books (bh.laedt): a link from another page
  // (79-10, phase 81) mounts this section while the collections are still
  // empty, and resolving the id then would silently open nothing/the wrong form.
  // ?rechnung=<id> öffnet genau diese Rechnung (lesend, wenn gestellt/storniert).
  React.useEffect(() => {
    const id = searchParams.get("rechnung");
    if (!id || bh.laedt) return;
    const treffer = alle.find((r) => r.id === id);
    if (treffer) setFormular({ modus: istEditierbar(treffer) ? "bearbeiten" : "lesen", rechnung: treffer });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("rechnung"), bh.laedt]);

  // ?neu=1[&vertrag=<honorarvertrag_id>] opens the form prefilled with this
  // contract's instalment proposal (abschlagsEntwurf — one computation for the
  // "Abschlag vorschlagen" button and phase 81's link); neu/vertrag are then
  // removed (replace), every other parameter stays. The run counter drops a
  // stale HoaiPlan read when the link fires again meanwhile.
  const deepLinkLauf = React.useRef(0);
  React.useEffect(() => {
    if (searchParams.get("neu") !== "1" || bh.laedt) return;
    const vertragId = searchParams.get("vertrag");
    const vertrag = vertragId ? (bh.daten.Honorarvertrag || []).find((v) => v.id === vertragId) || null : null;
    const naechste = new URLSearchParams(searchParams);
    naechste.delete("neu");
    naechste.delete("vertrag");
    setSearchParams(naechste, { replace: true });
    const lauf = ++deepLinkLauf.current;
    if (!vertrag) {
      if (vertragId) toast.error(t("Der verlinkte Honorarvertrag wurde nicht gefunden."));
      setFormular({ modus: "neu", projektIdVorwahl: projektId, vertrag: null });
      return;
    }
    const projekt = bh.projekte.find((p) => p.id === vertrag.project_id) || null;
    hoaiPlanLesen(vertrag.project_id).then((hoaiPlan) => {
      if (lauf !== deepLinkLauf.current) return;
      const vorlage = abschlagsEntwurf({ vertrag, projekt, hoaiPlan, rechnungen: alle });
      if (vorlage.netto <= 0) toast(t("Kein offener Leistungsstand — Vorschlag ist 0 €."));
      setFormular({ modus: "neu", projektIdVorwahl: vertrag.project_id, vertrag, vorlage });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("neu"), searchParams.get("vertrag"), bh.laedt]);

  const modell = ausgangTabelle(liste, t, { heute: bh.heute, projekte: bh.projekte }, { status: statusFilter || undefined, jahr: jahrFilter || undefined });
  const jahre = [...new Set(liste.map((r) => (r.rechnungsdatum || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  // The on-screen table shows the SAME filter as the export model (modell) —
  // computed separately here because the table needs the live record (for the
  // row actions), not the already-translated export row.
  const sichtbare = React.useMemo(() => liste.filter((r) => {
    if (statusFilter && rechnungsStatus(r, bh.heute) !== statusFilter) return false;
    if (jahrFilter && (r.rechnungsdatum || "").slice(0, 4) !== jahrFilter) return false;
    return true;
  }), [liste, statusFilter, jahrFilter, bh.heute]);

  const setzeFilterParam = (wert) => {
    setStatusFilter(wert);
    const naechste = new URLSearchParams(searchParams);
    if (wert) naechste.set("filter", wert); else naechste.delete("filter");
    setSearchParams(naechste, { replace: true });
  };

  const stellenBestaetigen = async () => {
    if (!stellenFuer) return;
    try {
      const vertrag = (bh.daten.Honorarvertrag || []).find((v) => v.id === stellenFuer.honorarvertrag_id) || null;
      const projekt = bh.projekte.find((p) => p.id === stellenFuer.project_id) || null;
      const gestellt = stelleRechnung(stellenFuer, { rechnungen: alle, vertrag, einst: bh.einst, heute: bh.heute, projekt });
      await bh.speichere("Ausgangsrechnung", gestellt);
      toast.success(t("Rechnung {nummer} gestellt").replace("{nummer}", gestellt.nummer));
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setStellenFuer(null);
    }
  };

  const loescheEntwurf = async (rechnung) => {
    try {
      await bh.loesche("Ausgangsrechnung", rechnung.id);
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  const stornoBestaetigen = async () => {
    if (!stornoFuer) return;
    try {
      const { storno, original } = storniere(stornoFuer, { rechnungen: alle, einst: bh.einst, heute: bh.heute });
      await bh.speichere("Ausgangsrechnung", original);
      await bh.speichere("Ausgangsrechnung", storno);
      toast.success(t("Storniert, Stornobeleg {nummer} angelegt").replace("{nummer}", storno.nummer));
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setStornoFuer(null);
    }
  };

  const zahlungBestaetigen = async () => {
    if (!zahlungFuer || zahlungBetrag == null || !zahlungDatum) return;
    try {
      const aktualisiert = zahlungErfassen(zahlungFuer, { datum: zahlungDatum, betrag: zahlungBetrag / 100 });
      await bh.speichere("Ausgangsrechnung", aktualisiert);
      toast.success(t("Zahlung erfasst"));
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setZahlungFuer(null);
      setZahlungDatum("");
      setZahlungBetrag(null);
    }
  };

  return (
    <div className={KARTE}>
      <div className={`${KARTE_KOPF} flex-row flex-wrap items-center justify-between gap-3`}>
        <h3 className={KARTE_TITEL}>{t("Rechnungen")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t("Status")} value={statusFilter} onChange={(e) => setzeFilterParam(e.target.value)}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="">{t("Alle Status")}</option>
            {["geplant", "entwurf", "offen", "teilbezahlt", "ueberfaellig", "bezahlt", "storniert"].map((s) => (
              <option key={s} value={s}>{t(statusLabel(s))}</option>
            ))}
          </select>
          <select aria-label={t("Jahr")} value={jahrFilter} onChange={(e) => setJahrFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="">{t("Alle Jahre")}</option>
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <ExportKnopf modell={modell} bereich="ausgangsrechnungen" jahr={jahrFilter || new Date(bh.heute).getFullYear()} />
          {bh.projekte.length > 0 ? (
            <button type="button" className={buttonVariants({ size: "sm" })}
              onClick={() => setFormular({ modus: "neu", projektIdVorwahl: projektId })}>
              {t("Neue Rechnung")}
            </button>
          ) : (
            <Link to="/Projects?neu=1" className={buttonVariants({ size: "sm" })}>{t("Projekt anlegen")}</Link>
          )}
        </div>
      </div>
      <div className={KARTE_INHALT}>
        {sichtbare.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Noch keine Rechnungen")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className={TR}>
                  <th className={TH}>{t("Nummer")}</th>
                  {!projektId && <th className={TH}>{t("Projekt")}</th>}
                  <th className={TH}>{t("LP")}</th>
                  <th className={TH}>{t("Netto")}</th>
                  <th className={TH}>{t("USt")}</th>
                  <th className={TH}>{t("Brutto")}</th>
                  <th className={TH}>{t("Rechnungsdatum")}</th>
                  <th className={TH}>{t("Fällig am")}</th>
                  <th className={TH}>{t("Status")}</th>
                  <th className={TH}>{t("Aktionen")}</th>
                </tr>
              </thead>
              <tbody>
                {sichtbare.map((r) => {
                  const status = rechnungsStatus(r, bh.heute);
                  const editierbar = istEditierbar(r);
                  return (
                    <tr key={r.id} className={TR}>
                      <td className={TD}>{r.nummer || t("Rechnungsentwurf")}</td>
                      {!projektId && <td className={TD}>{r.project_name || bh.projekte.find((p) => p.id === r.project_id)?.name || "—"}</td>}
                      <td className={TD}>{Array.isArray(r.lp_pos) ? r.lp_pos.map((p) => p.lp).join(", ") : "—"}</td>
                      <td className={`${TD} text-right`}>{formatEuro(Math.round((r.netto || 0) * 100))}</td>
                      <td className={`${TD} text-right`}>{formatEuro(Math.round((r.ust || 0) * 100))}</td>
                      <td className={`${TD} text-right`}>{formatEuro(Math.round((r.brutto || 0) * 100))}</td>
                      <td className={TD}>{tagText(r.rechnungsdatum)}</td>
                      <td className={TD}>{tagText(r.faellig_am)}</td>
                      <td className={TD}><StatusMarke status={status} /></td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-1">
                          {editierbar && (
                            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                              onClick={() => setFormular({ modus: "bearbeiten", rechnung: r })}>{t("Bearbeiten")}</button>
                          )}
                          {editierbar && (
                            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setStellenFuer(r)}>{t("Stellen")}</button>
                          )}
                          {editierbar && (
                            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => loescheEntwurf(r)}>{t("Löschen")}</button>
                          )}
                          {r.status === "gestellt" && (
                            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                              onClick={() => setZahlungFuer(r)}>{t("Zahlung erfassen")}</button>
                          )}
                          {r.status === "gestellt" && (
                            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                              onClick={() => setStornoFuer(r)}>{t("Stornieren")}</button>
                          )}
                          {!editierbar && (
                            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })}
                              onClick={() => setFormular({ modus: "lesen", rechnung: r })}>{t("Ansehen")}</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formular && (
        <RechnungFormular
          bh={bh}
          modus={formular.modus}
          rechnung={formular.rechnung}
          vorlage={formular.vorlage}
          vertrag={formular.vertrag}
          projektIdVorwahl={formular.projektIdVorwahl ?? projektId}
          onClose={() => setFormular(null)}
        />
      )}

      {stellenFuer && (
        <div role="group" aria-label={t("Rechnung wirklich stellen?")} className="mx-6 mb-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium">{t("Rechnung wirklich stellen? Danach nur noch Zahlungen, Mahnungen oder Storno möglich.")}</p>
          {doppelteRechnung(alle, stellenFuer).length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-100">
              {doppelteRechnung(alle, stellenFuer).map((w) => <li key={w}>{t(warnungText(w))}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button type="button" className={buttonVariants({ size: "sm" })} onClick={stellenBestaetigen}>{t("Ja, stellen")}</button>
            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setStellenFuer(null)}>{t("Nein")}</button>
          </div>
        </div>
      )}

      {stornoFuer && (
        <div role="group" aria-label={t("Rechnung wirklich stornieren?")} className="mx-6 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950">
          <span className="font-medium">{t("Rechnung {nummer} wirklich stornieren?").replace("{nummer}", stornoFuer.nummer || "")}</span>
          <button type="button" className={buttonVariants({ variant: "destructive", size: "sm" })} onClick={stornoBestaetigen}>{t("Ja, stornieren")}</button>
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setStornoFuer(null)}>{t("Nein")}</button>
        </div>
      )}

      {zahlungFuer && (
        <div role="group" aria-label={t("Zahlung erfassen")} className="mx-6 mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
          <span className="text-sm font-medium">{t("Zahlung für {nummer}").replace("{nummer}", zahlungFuer.nummer || "")}</span>
          <label className="flex flex-col gap-1 text-xs">
            {t("Datum")}
            <input type="date" value={zahlungDatum} onChange={(e) => setZahlungDatum(e.target.value)}
              className="h-9 rounded-md border border-slate-300 px-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
          </label>
          <BetragFeld label={t("Betrag")} wert={zahlungBetrag} onChange={setZahlungBetrag} />
          <button type="button" className={buttonVariants({ size: "sm" })} disabled={zahlungBetrag == null || !zahlungDatum} onClick={zahlungBestaetigen}>{t("Speichern")}</button>
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setZahlungFuer(null)}>{t("Abbrechen")}</button>
        </div>
      )}
    </div>
  );
}

/** @param {string} warnung doppelteRechnung() key @returns {string} DICT key */
function warnungText(warnung) {
  switch (warnung) {
    case "schluss_doppelt": return "Zu diesem Honorarvertrag ist bereits eine Schlussrechnung gestellt.";
    case "lp_stand_doppelt": return "Dieser Leistungsstand wurde für diese Leistungsphase schon einmal abgerechnet.";
    case "zeitraum_ueberlappt": return "Der Leistungszeitraum überschneidet sich mit einer anderen Rechnung dieses Vertrags.";
    default: return warnung;
  }
}

/** @param {string} status @returns {string} DICT key */
function statusLabel(status) {
  switch (status) {
    case "geplant": return "Geplant";
    case "entwurf": return "Rechnungsentwurf";
    case "offen": return "Offen";
    case "teilbezahlt": return "Teilbezahlt";
    case "ueberfaellig": return "Überfällig";
    case "bezahlt": return "Bezahlt";
    case "storniert": return "Storniert";
    default: return status;
  }
}
