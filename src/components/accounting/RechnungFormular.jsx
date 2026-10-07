// Form dialog "Rechnung" of the outgoing-invoice tab (79-02, T4): create,
// edit and issue an outgoing invoice; a gestellt/storniert invoice opens
// read-only (GoBD).
//
// In:  props bh, modus ("neu"|"bearbeiten"|"lesen"), rechnung (edit/read),
//      vorlage (prefill for a new invoice — Abschlagsvorschlag/Zahlungsplan),
//      vertrag (fee contract prechosen from a deep-link), projektIdVorwahl.
// Out: writes through bh.speichere("Ausgangsrechnung", …); onClose when done.

import React from "react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { toast } from "sonner";
import {
  doppelteRechnung, empfaengerAus, neueRechnung, rechnungBetraege, stelleRechnung,
} from "@/lib/accounting/ausgangsrechnungen.js";
import { bauherrSchluessel, zahlungszielTage } from "@/lib/accounting/grundlagen.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
// Native <label> instead of the shadcn Label wrapper: same tsc-cost reason as
// the Card wrappers (RechnungenAbschnitt.jsx).
const LABEL = "text-sm font-medium leading-none";

/** Payment-term source label for the form (E-12 chain). */
function zielQuelle(vertrag, einst, schluessel) {
  if (typeof vertrag?.zahlungsziel_tage === "number") return "aus Honorarvertrag";
  if (schluessel && einst?.zahlungsziel_je_bauherr && Object.prototype.hasOwnProperty.call(einst.zahlungsziel_je_bauherr, schluessel)) return "je Bauherr";
  return "Standard";
}

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   modus: "neu"|"bearbeiten"|"lesen",
 *   rechnung?: Record<string, any>|null,
 *   vorlage?: {netto?: number, art?: string, lp_pos?: Array<{lp: number, stand: number, netto: number}>, rechnungsdatum?: string, stand_quelle?: string}|null,
 *   vertrag?: Record<string, any>|null,
 *   projektIdVorwahl?: string|null,
 *   onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function RechnungFormular({ bh, modus, rechnung = null, vorlage = null, vertrag: vertragVorwahl = null, projektIdVorwahl = null, onClose }) {
  const { t } = useI18n();
  const lesend = modus === "lesen" || (rechnung && rechnung.status !== "entwurf" && rechnung.status !== "geplant");

  // The initial record only seeds the input state below; everything derived
  // from the chosen project/contract (recipient, payment term) is recomputed
  // on every render, so switching either selector can never keep the first
  // project's values.
  const anfang = React.useMemo(() => {
    if (rechnung) return rechnung;
    const projekt = bh.projekte.find((p) => p.id === (projektIdVorwahl || bh.projekte[0]?.id)) || null;
    return neueRechnung({ projekt, vertrag: vertragVorwahl, kontakte: [], einst: bh.einst, heute: bh.heute, vorlage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [projektId, setProjektId] = React.useState(anfang.project_id || projektIdVorwahl || bh.projekte[0]?.id || "");
  const [honorarvertragId, setHonorarvertragId] = React.useState(anfang.honorarvertrag_id || vertragVorwahl?.id || "");
  const [art, setArt] = React.useState(anfang.art || "abschlag");
  const [lpPos, setLpPos] = React.useState(() => (Array.isArray(anfang.lp_pos) && anfang.lp_pos.length ? anfang.lp_pos : [{ lp: 1, stand: 0, netto: anfang.netto || 0 }]));
  const [ustSatz, setUstSatz] = React.useState(typeof anfang.ust_satz === "number" ? anfang.ust_satz : bh.einst.ust_satz);
  const [rechnungsdatum, setRechnungsdatum] = React.useState(anfang.rechnungsdatum || bh.heute);
  const [leistungVon, setLeistungVon] = React.useState(anfang.leistung_von || "");
  const [leistungBis, setLeistungBis] = React.useState(anfang.leistung_bis || "");
  const [versandGeplantAm, setVersandGeplantAm] = React.useState(anfang.versand_geplant_am || bh.heute);
  const [verzugshinweis, setVerzugshinweis] = React.useState(Boolean(anfang.verzugshinweis));
  const [stellenBestaetigen, setStellenBestaetigen] = React.useState(false);
  const [speichert, setSpeichert] = React.useState(false);

  const projekt = bh.projekte.find((p) => p.id === projektId) || null;
  const vertraege = (bh.daten.Honorarvertrag || []).filter((v) => v.project_id === projektId);
  const vertrag = vertraege.find((v) => v.id === honorarvertragId) || null;

  React.useEffect(() => {
    // A bauherr-art default: consumers get the § 286 Abs. 3 BGB notice pre-checked.
    if (vertrag?.bauherr_art === "verbraucher") setVerzugshinweis(true);
  }, [vertrag]);

  const nettoGesamt = lpPos.reduce((n, p) => n + (Number(p.netto) || 0), 0);
  const betraege = rechnungBetraege(nettoGesamt, ustSatz);
  const schluessel = bauherrSchluessel(vertrag, projekt);
  const zielTage = zahlungszielTage({ vertrag, einst: bh.einst, bauherrSchluessel: schluessel });
  // No Contact read: a matching Contact contributes only its company, which IS
  // Project.client, and the entity carries no address — the result would be
  // identical to the Project.client step of empfaengerAus().
  const empfaengerLive = empfaengerAus(vertrag, [], projekt);
  const empfaenger = empfaengerLive.name ? empfaengerLive : (anfang.empfaenger || empfaengerLive);

  const zuSpeicherndeRechnung = (statusZiel) => ({
    ...anfang,
    project_id: projektId,
    project_name: projekt?.name,
    honorarvertrag_id: honorarvertragId || undefined,
    art,
    lp_pos: lpPos.map((p) => ({ lp: Number(p.lp) || 1, stand: Number(p.stand) || 0, netto: Number(p.netto) || 0 })),
    netto: betraege.netto,
    ust_satz: ustSatz,
    ust: betraege.ust,
    brutto: betraege.brutto,
    rechnungsdatum,
    leistung_von: leistungVon || undefined,
    leistung_bis: leistungBis || undefined,
    zahlungsziel_tage: zielTage,
    versand_geplant_am: statusZiel === "geplant" ? versandGeplantAm : undefined,
    verzugshinweis,
    empfaenger,
    status: statusZiel,
  });

  const speichereAls = async (statusZiel) => {
    setSpeichert(true);
    try {
      await bh.speichere("Ausgangsrechnung", zuSpeicherndeRechnung(statusZiel));
      toast.success(statusZiel === "geplant" ? t("Rechnung geplant") : t("Entwurf gespeichert"));
      onClose();
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichert(false);
    }
  };

  const warnungen = doppelteRechnung(bh.daten.Ausgangsrechnung || [], { ...zuSpeicherndeRechnung("entwurf"), id: anfang.id });

  const stellen = async () => {
    setSpeichert(true);
    try {
      const entwurf = zuSpeicherndeRechnung("entwurf");
      const gestellt = stelleRechnung(entwurf, { rechnungen: bh.daten.Ausgangsrechnung || [], vertrag, einst: bh.einst, heute: bh.heute, projekt });
      await bh.speichere("Ausgangsrechnung", { ...gestellt, id: anfang.id });
      toast.success(t("Rechnung {nummer} gestellt").replace("{nummer}", gestellt.nummer));
      onClose();
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichert(false);
    }
  };

  if (lesend) {
    return (
      <FormModal title={`${t("Rechnung")} ${rechnung?.nummer || ""}`} onClose={onClose} schuetzen={false}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{t("Projekt")}</dt><dd>{rechnung?.project_name || projekt?.name || "—"}</dd>
          <dt className="text-slate-500">{t("Netto")}</dt><dd className="tabular-nums">{formatEuro(Math.round((rechnung?.netto || 0) * 100))}</dd>
          <dt className="text-slate-500">{t("USt")}</dt><dd className="tabular-nums">{formatEuro(Math.round((rechnung?.ust || 0) * 100))}</dd>
          <dt className="text-slate-500">{t("Brutto")}</dt><dd className="tabular-nums">{formatEuro(Math.round((rechnung?.brutto || 0) * 100))}</dd>
          <dt className="text-slate-500">{t("Rechnungsdatum")}</dt><dd>{rechnung?.rechnungsdatum || "—"}</dd>
          <dt className="text-slate-500">{t("Fällig am")}</dt><dd>{rechnung?.faellig_am || "—"}</dd>
          <dt className="text-slate-500">{t("Empfänger")}</dt><dd>{rechnung?.empfaenger?.name || "—"}</dd>
        </dl>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Schließen")}</button>
        </div>
      </FormModal>
    );
  }

  return (
    <FormModal title={rechnung ? t("Rechnung bearbeiten") : t("Neue Rechnung")} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="rf-projekt">{t("Projekt")}</label>
            <select id="rf-projekt" className={FELD} value={projektId} onChange={(e) => { setProjektId(e.target.value); setHonorarvertragId(""); }}>
              {bh.projekte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="rf-vertrag">{t("Honorarvertrag")}</label>
            <select id="rf-vertrag" className={FELD} value={honorarvertragId} onChange={(e) => {
              setHonorarvertragId(e.target.value);
              // The contract's own VAT rate applies, as in neueRechnung().
              const gewaehlt = vertraege.find((v) => v.id === e.target.value);
              if (typeof gewaehlt?.ust_satz === "number") setUstSatz(gewaehlt.ust_satz);
            }}>
              <option value="">{t("Kein Honorarvertrag")}</option>
              {vertraege.map((v) => <option key={v.id} value={v.id}>{t(leistungsbildInfo(v.leistungsbild)?.label || v.leistungsbild)}{v.bauherr_name ? ` — ${v.bauherr_name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="rf-art">{t("Art")}</label>
            <select id="rf-art" className={FELD} value={art} onChange={(e) => setArt(e.target.value)}>
              {["abschlag", "teilschluss", "schluss", "sonstige"].map((a) => <option key={a} value={a}>{t(artLabel(a))}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="rf-ust">{t("USt-Satz")}</label>
            <select id="rf-ust" className={FELD} value={ustSatz} onChange={(e) => setUstSatz(Number(e.target.value))}>
              {[19, 7, 0].map((s) => <option key={s} value={s}>{s} %</option>)}
            </select>
          </div>
        </div>

        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-medium">{t("Leistungsphasen")}</legend>
          {lpPos.map((pos, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs">
                {t("LP")}
                <input type="number" min={1} max={9} value={pos.lp} className={`${FELD} w-16`}
                  onChange={(e) => setLpPos((liste) => liste.map((p, j) => (j === i ? { ...p, lp: Number(e.target.value) } : p)))} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                {t("Stand (%)")}
                <input type="number" min={0} max={100} value={pos.stand} className={`${FELD} w-20`}
                  onChange={(e) => setLpPos((liste) => liste.map((p, j) => (j === i ? { ...p, stand: Number(e.target.value) } : p)))} />
              </label>
              <BetragFeld label={t("Netto")} wert={Math.round((pos.netto || 0) * 100)}
                onChange={(cent) => setLpPos((liste) => liste.map((p, j) => (j === i ? { ...p, netto: (cent || 0) / 100 } : p)))} />
              {lpPos.length > 1 && (
                <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })}
                  onClick={() => setLpPos((liste) => liste.filter((_, j) => j !== i))}>{t("Zeile entfernen")}</button>
              )}
            </div>
          ))}
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
            onClick={() => setLpPos((liste) => [...liste, { lp: 1, stand: 0, netto: 0 }])}>{t("Leistungsphase hinzufügen")}</button>
        </fieldset>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm tabular-nums dark:bg-slate-800">
          {t("Netto")} {formatEuro(Math.round(betraege.netto * 100))} · {t("USt")} {formatEuro(Math.round(betraege.ust * 100))} · {t("Brutto")} {formatEuro(Math.round(betraege.brutto * 100))}
        </div>
        {!rechnung && vorlage?.stand_quelle && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("Abschlagsvorschlag aus dem Leistungsstand")} ({t(standQuelleLabel(vorlage.stand_quelle))})
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="rf-datum">{t("Rechnungsdatum")}</label>
            <input id="rf-datum" type="date" className={FELD} value={rechnungsdatum} onChange={(e) => setRechnungsdatum(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="rf-von">{t("Leistungszeitraum von")}</label>
            <input id="rf-von" type="date" className={FELD} value={leistungVon} onChange={(e) => setLeistungVon(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="rf-bis">{t("Leistungszeitraum bis")}</label>
            <input id="rf-bis" type="date" className={FELD} value={leistungBis} onChange={(e) => setLeistungBis(e.target.value)} />
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("Zahlungsziel")}: {zielTage} {t("Tage")} ({t(zielQuelleLabel(zielQuelle(vertrag, bh.einst, schluessel)))})
        </p>

        <div>
          <label className={LABEL} htmlFor="rf-versand">{t("Versand geplant am")}</label>
          <input id="rf-versand" type="date" className={FELD} value={versandGeplantAm} onChange={(e) => setVersandGeplantAm(e.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verzugshinweis} onChange={(e) => setVerzugshinweis(e.target.checked)} />
          {t("Verzugshinweis nach § 286 Abs. 3 BGB")}
        </label>

        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {t("Empfänger")}: {empfaenger.name || t("noch kein Empfänger")}
        </p>

        {stellenBestaetigen && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950">
            <p className="font-medium">{t("Rechnung wirklich stellen? Danach nur noch Zahlungen, Mahnungen oder Storno möglich.")}</p>
            {warnungen.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5">
                {warnungen.map((w) => <li key={w}>{t(warnungLabel(w))}</li>)}
              </ul>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={speichert} className={buttonVariants({ size: "sm" })} onClick={stellen}>{t("Ja, stellen")}</button>
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setStellenBestaetigen(false)}>{t("Nein")}</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="button" disabled={speichert} className={buttonVariants({ variant: "outline" })} onClick={() => speichereAls("geplant")}>{t("Planen")}</button>
          <button type="button" disabled={speichert} className={buttonVariants({ variant: "outline" })} onClick={() => speichereAls("entwurf")}>{t("Als Entwurf")}</button>
          <button type="button" disabled={speichert} className={buttonVariants({})} onClick={() => setStellenBestaetigen(true)}>{t("Stellen")}</button>
        </div>
      </div>
    </FormModal>
  );
}

/** @param {string} art @returns {string} DICT key */
function artLabel(art) {
  switch (art) {
    case "abschlag": return "Abschlag";
    case "teilschluss": return "Teilschlussrechnung";
    case "schluss": return "Schlussrechnung";
    default: return "Sonstige";
  }
}

/** @param {string} quelle abschlagsEntwurf() stand_quelle @returns {string} DICT key */
function standQuelleLabel(quelle) {
  switch (quelle) {
    case "hoaiplan": return "Planer im Komplex-Designer";
    case "projektphase": return "aus der Projektphase geschätzt";
    default: return "unbekannt";
  }
}

/** @param {string} quelle @returns {string} DICT key */
function zielQuelleLabel(quelle) {
  switch (quelle) {
    case "aus Honorarvertrag": return "aus Honorarvertrag";
    case "je Bauherr": return "je Bauherr";
    default: return "Standard";
  }
}

/** @param {string} warnung @returns {string} DICT key */
function warnungLabel(warnung) {
  switch (warnung) {
    case "schluss_doppelt": return "Zu diesem Honorarvertrag ist bereits eine Schlussrechnung gestellt.";
    case "lp_stand_doppelt": return "Dieser Leistungsstand wurde für diese Leistungsphase schon einmal abgerechnet.";
    case "zeitraum_ueberlappt": return "Der Leistungszeitraum überschneidet sich mit einer anderen Rechnung dieses Vertrags.";
    default: return warnung;
  }
}
