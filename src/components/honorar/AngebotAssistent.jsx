// "Neues Honorarangebot" in five steps (phase 81-03, HON-01): (1) project and
// client, (2) service profile with the cost basis, (3) fee zone (with the points
// helper of § 35 Abs. 6 for buildings and interiors), (4) scope of stages,
// (5) new build or conversion. "Mehr Optionen" holds rate position, incidental
// costs, VAT, payment term and flat fee. The live total below always shows what
// the offer would say — computed by 79's engine through aufstellung().
//
// All 14 service profiles are selectable (E-13); a profile without an official
// table computes nothing and says so. Defaults: neuesAngebot() (numbers, validity,
// incidental costs/VAT from 79, payment term chain E-12).
//
// In:  props zh (page loader), wert (rule reader), projektVorwahl, vorschlag
//      (fields handed over by the fee calculator), onClose. Out: a FormModal;
//      "Entwurf anlegen" writes one Honorarangebot through the storage layer.
//
// 94-03 (B-ABN-04/05): step 1 offers the address book (clients first) — the
// choice fills name, address and bauherr_contact_id, free text stays the
// fallback. A missing project can be created right there ("Neues Projekt"),
// and "Weiter" checks the project in step 1 instead of failing at the end.
// The calculator's hand-over is forgotten once an offer is created
// (vorschlagMerker.js).

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { neuesAngebot } from "@/lib/honorar/angebot.js";
import { aufstellung, honorarzoneAusPunkten, PUNKTE_LEISTUNGSBILDER } from "@/lib/honorar/aufstellung.js";
import LeistungsbildFelder from "./LeistungsbildFelder.jsx";
import { bitApi } from "@core/api/bitApi";
import { useProject } from "@core/lib/ProjectContext";
import { bauherrAusKontakt, kontaktText, sortiereKontakte } from "@/lib/honorar/bauherrKontakt.js";
import { vergissVorschlag } from "@/lib/honorar/vorschlagMerker.js";

const FELD = "h-9 w-full rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-foreground dark:text-slate-200";
const SCHRITTE = ["Projekt und Bauherr", "Leistungsbild und Kosten", "Honorarzone", "Leistungsumfang", "Neubau oder Umbau"];

/**
 * @param {{
 *   zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar,
 *   wert: (id: string) => any, projektVorwahl?: string|null, vorschlag?: Record<string, any>|null, onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function AngebotAssistent({ zh, wert, projektVorwahl = null, vorschlag = null, onClose }) {
  const { t, lang } = useI18n();
  const [schritt, setSchritt] = React.useState(0);
  const [mehr, setMehr] = React.useState(false);
  const [punkte, setPunkte] = React.useState("");
  const [speichert, setSpeichert] = React.useState(false);
  const projektFuer = (/** @type {string|null} */ id) => zh.projekte.find((p) => p.id === id) || null;
  const neu = (/** @type {Record<string, any>|null} */ projekt) => neuesAngebot(projekt || {}, wert, zh.daten.Honorarangebot, { heuteIso: zh.heute, vorschlag: vorschlag || {}, einstBuchhaltung: zh.einstBuchhaltung });
  const [entwurf, setEntwurf] = React.useState(() => neu(projektFuer(projektVorwahl || zh.projectId)));
  const projekt = projektFuer(entwurf.project_id);
  const info = leistungsbildInfo(entwurf.leistungsbild);
  const a = aufstellung(entwurf);
  const aendere = (/** @type {Record<string, any>} */ patch) => setEntwurf((e) => ({ ...e, ...patch }));
  const { reloadProjects } = useProject();
  const [kontakte, setKontakte] = React.useState(/** @type {any[]} */ ([]));
  const [neuesProjekt, setNeuesProjekt] = React.useState(/** @type {string|null} */ (null));
  const [projektFehler, setProjektFehler] = React.useState(false);

  React.useEffect(() => {
    let aktiv = true;
    /** @type {any} */ (bitApi).entities.Contact.list()
      .then((/** @type {any[]} */ liste) => { if (aktiv) setKontakte(sortiereKontakte(Array.isArray(liste) ? liste : [])); })
      .catch((/** @type {any} */ err) => console.error(`Adressbuch konnte nicht geladen werden: ${err?.message || err}`));
    return () => { aktiv = false; };
  }, []);

  const kontaktWaehlen = (/** @type {string} */ id) => {
    const k = kontakte.find((x) => x.id === id);
    aendere(k ? bauherrAusKontakt(k) : { bauherr_contact_id: null });
  };

  const projektAnlegen = async () => {
    const name = String(neuesProjekt || "").trim();
    if (!name) return;
    try {
      const p = await /** @type {any} */ (bitApi).entities.Project.create({ name, status: "concept", hoai_phase: 1, build_kind: "neubau", client: entwurf.bauherr_name || "" });
      await reloadProjects?.();
      setEntwurf((e) => ({ ...e, project_id: p.id }));
      setNeuesProjekt(null);
      setProjektFehler(false);
      toast.success(t("Projekt angelegt"));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const weiter = () => {
    if (schritt === 0 && !entwurf.project_id) { setProjektFehler(true); return; }
    setSchritt((s) => s + 1);
  };

  const projektWaehlen = (/** @type {string} */ id) => {
    const p = projektFuer(id);
    const frisch = neu(p);
    setProjektFehler(false);
    // Keep what was typed in later steps; take over number, client and payment term of the new project.
    setEntwurf((e) => ({ ...e, project_id: frisch.project_id, bauherr_name: e.bauherr_name || frisch.bauherr_name, zahlungsziel_tage: frisch.zahlungsziel_tage }));
  };

  const anlegen = async () => {
    if (!entwurf.project_id) { toast.error(t("Bitte ein Projekt wählen.")); setProjektFehler(true); setSchritt(0); return; }
    setSpeichert(true);
    try {
      const gespeichert = await zh.speichere("Honorarangebot", entwurf);
      toast.success(t("Honorarangebot {nr} angelegt").replace("{nr}", gespeichert?.nummer || entwurf.nummer));
      vergissVorschlag();
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  const umbauMoeglich = typeof info?.umbau_max_prozent === "number";
  const istUmbau = Number(entwurf.umbauzuschlag_prozent) > 0;

  return (
    <FormModal title={t("Neues Honorarangebot")} onClose={onClose}>
      <div className="space-y-4" data-testid="angebot-assistent">
        <ol className="flex flex-wrap gap-2 text-xs">
          {SCHRITTE.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => setSchritt(i)} aria-current={i === schritt ? "step" : undefined}
                className={`rounded-full border px-2 py-0.5 ${i === schritt ? "border-emerald-600 bg-erfolg-flaeche text-erfolg dark:bg-emerald-950 dark:text-emerald-100" : "border-border text-muted-foreground dark:text-slate-300"}`}>
                {i + 1}. {t(s)}
              </button>
            </li>
          ))}
        </ol>

        {schritt === 0 && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="as-projekt" className={LABEL}>{t("Projekt")}</label>
              <div className="flex gap-2">
                <select id="as-projekt" className={FELD} value={entwurf.project_id || ""} onChange={(e) => projektWaehlen(e.target.value)}
                  aria-invalid={projektFehler || undefined} aria-describedby={projektFehler ? "as-projekt-fehler" : undefined}>
                  <option value="">{t("Projekt wählen …")}</option>
                  {zh.projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                </select>
                {neuesProjekt === null && (
                  <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => setNeuesProjekt("")} data-testid="as-neues-projekt">{t("Neues Projekt")}</button>
                )}
              </div>
              {projektFehler && <p id="as-projekt-fehler" role="alert" className="text-sm text-fehler dark:text-red-300">{t("Bitte ein Projekt wählen oder neu anlegen.")}</p>}
              {neuesProjekt !== null && (
                <div className="flex gap-2">
                  <label htmlFor="as-projekt-name" className="sr-only">{t("Name des neuen Projekts")}</label>
                  <input id="as-projekt-name" className={FELD} value={neuesProjekt} placeholder={t("Name des neuen Projekts")} onChange={(e) => setNeuesProjekt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); projektAnlegen(); } }} />
                  <button type="button" className={buttonVariants({ variant: "default" })} disabled={!neuesProjekt.trim()} onClick={projektAnlegen} data-testid="as-projekt-anlegen">{t("Anlegen")}</button>
                  <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={() => setNeuesProjekt(null)}>{t("Abbrechen")}</button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor="as-kontakt" className={LABEL}>{t("Bauherr aus dem Adressbuch")}</label>
              <select id="as-kontakt" className={FELD} value={entwurf.bauherr_contact_id || ""} onChange={(e) => kontaktWaehlen(e.target.value)}>
                <option value="">{kontakte.length ? t("— frei eingeben —") : t("Adressbuch ist leer")}</option>
                {kontakte.map((k) => <option key={k.id} value={k.id}>{kontaktText(k)}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="as-bauherr" className={LABEL}>{t("Bauherr")}</label>
                <input id="as-bauherr" className={FELD} value={entwurf.bauherr_name || ""} onChange={(e) => aendere({ bauherr_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label htmlFor="as-art" className={LABEL}>{t("Art des Bauherrn")}</label>
                <select id="as-art" className={FELD} value={entwurf.bauherr_art || "unternehmer"} onChange={(e) => aendere({ bauherr_art: e.target.value })}>
                  <option value="unternehmer">{t("Unternehmer")}</option>
                  <option value="verbraucher">{t("Verbraucher")}</option>
                  <option value="oeffentlich">{t("Öffentlicher Auftraggeber")}</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="as-anschrift" className={LABEL}>{t("Anschrift")}</label>
              <input id="as-anschrift" className={FELD} value={entwurf.bauherr_anschrift || ""} onChange={(e) => aendere({ bauherr_anschrift: e.target.value })} placeholder={t("Straße, PLZ Ort")} />
            </div>
          </div>
        )}
        {schritt === 1 && <LeistungsbildFelder wert={entwurf} onChange={aendere} idPraefix="as" projekt={projekt} teile={["leistungsbild", "kosten"]} />}
        {schritt === 2 && (
          <div className="space-y-3">
            <LeistungsbildFelder wert={entwurf} onChange={aendere} idPraefix="as" teile={["zone"]} />
            {PUNKTE_LEISTUNGSBILDER.includes(entwurf.leistungsbild) && (
              <details className="rounded-lg border border-border p-2 dark:border-slate-700">
                <summary className="cursor-pointer text-sm text-foreground dark:text-slate-200">{t("Honorarzone aus Punkten (§ 35 Abs. 6 HOAI)")}</summary>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <label htmlFor="as-punkte" className={LABEL}>{t("Punkte gesamt")}</label>
                    <input id="as-punkte" type="number" min="0" max="42" className={FELD} value={punkte} onChange={(e) => setPunkte(e.target.value)} />
                  </div>
                  <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!honorarzoneAusPunkten(Number(punkte))}
                    onClick={() => { const z = honorarzoneAusPunkten(Number(punkte)); if (z) aendere({ honorarzone: z }); }}>
                    {t("Zone übernehmen")}{honorarzoneAusPunkten(Number(punkte)) ? `: ${honorarzoneAusPunkten(Number(punkte))}` : ""}
                  </button>
                </div>
              </details>
            )}
          </div>
        )}
        {schritt === 3 && <LeistungsbildFelder wert={entwurf} onChange={aendere} idPraefix="as" teile={["lph"]} />}
        {schritt === 4 && (
          <div className="space-y-3">
            {umbauMoeglich ? (
              <fieldset className="space-y-2">
                <legend className={LABEL}>{t("Neubau oder Umbau")}</legend>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="as-umbau" checked={!istUmbau} onChange={() => aendere({ umbauzuschlag_prozent: 0, textform_am: null })} /> {t("Neubau")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="as-umbau" checked={istUmbau} onChange={() => aendere({ umbauzuschlag_prozent: 20 })} /> {t("Umbau oder Modernisierung")}</label>
                {istUmbau && <LeistungsbildFelder wert={entwurf} onChange={aendere} idPraefix="as" projekt={projekt} teile={["umbau"]} />}
                {istUmbau && !entwurf.textform_am && <p className="text-xs text-muted-foreground dark:text-slate-300">{t("Ohne Vereinbarung in Textform gilt ein Zuschlag von 20 % (§ 6 Abs. 2 HOAI).")}</p>}
              </fieldset>
            ) : <p className="text-sm text-muted-foreground dark:text-slate-300">{t("Für dieses Leistungsbild gibt es keinen Umbauzuschlag.")}</p>}
          </div>
        )}

        <details open={mehr} onToggle={(e) => setMehr(/** @type {HTMLDetailsElement} */ (e.currentTarget).open)} className="rounded-lg border border-border p-2 dark:border-slate-700">
          <summary className="cursor-pointer text-sm text-foreground dark:text-slate-200">{t("Mehr Optionen")}</summary>
          <div className="mt-2 space-y-3">
            <LeistungsbildFelder wert={entwurf} onChange={aendere} idPraefix="as-mehr" teile={["position", "pauschal"]} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="as-nk" className={LABEL}>{t("Nebenkosten (%)")}</label>
                <input id="as-nk" type="number" min="0" max="20" step="0.5" className={FELD} value={entwurf.nebenkosten_prozent ?? 5} onChange={(e) => aendere({ nebenkosten_prozent: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <label htmlFor="as-ust" className={LABEL}>{t("Umsatzsteuer (%)")}</label>
                <input id="as-ust" type="number" min="0" max="25" className={FELD} value={entwurf.ust_satz ?? 19} onChange={(e) => aendere({ ust_satz: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <label htmlFor="as-ziel" className={LABEL}>{t("Zahlungsziel (Tage)")}</label>
                <input id="as-ziel" type="number" min="0" max="120" className={FELD} value={entwurf.zahlungsziel_tage ?? 14} onChange={(e) => aendere({ zahlungsziel_tage: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entwurf.zahlungsziel_vertraglich !== false} onChange={(e) => aendere({ zahlungsziel_vertraglich: e.target.checked })} /> {t("Zahlungsziel vertraglich vereinbart")}</label>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">{t("Vorbelegt aus der Buchhaltung: Bauherr, sonst Bürostandard (14 Tage).")}</p>
          </div>
        </details>

        <div className="rounded-lg border border-border bg-muted p-3 text-sm dark:border-slate-700 dark:bg-slate-900" data-testid="angebot-live-summe" aria-live="polite">
          {a.tafelFehlt ? (
            <span>{t("Tafel fehlt — HOAI § {nr} noch nicht amtlich übertragen").replace("{nr}", String(info?.tafelParagraf ?? ""))}</span>
          ) : a.ausserhalb ? (
            <span>{t("frei vereinbar (§ 7 Abs. 2 HOAI)")}</span>
          ) : (
            <span>
              {a.tafel && <>{t("Anrechenbare Kosten")}: <strong>{formatEuro(Math.round(a.tafel.bezugswert * 100), lang)}</strong> · </>}
              {t("Honorar netto")}: <strong data-testid="angebot-netto">{formatEuro(Math.round((a.summen.netto ?? 0) * 100), lang)}</strong>
              {Number(entwurf.umbauzuschlag_prozent) > 0 && <> · {t("Umbauzuschlag")} § 6 Abs. 2</>}
            </span>
          )}
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} disabled={schritt === 0} onClick={() => setSchritt((s) => Math.max(0, s - 1))}>{t("Zurück")}</button>
          <div className="flex gap-2">
            <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
            {schritt < SCHRITTE.length - 1
              ? <button type="button" className={buttonVariants({ variant: "default" })} onClick={weiter}>{t("Weiter")}</button>
              : <button type="button" className={buttonVariants({ variant: "default" })} disabled={speichert} onClick={anlegen}>{t("Entwurf anlegen")}</button>}
          </div>
        </div>
      </div>
    </FormModal>
  );
}
