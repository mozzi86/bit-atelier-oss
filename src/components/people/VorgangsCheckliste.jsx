// VorgangsCheckliste.jsx — DER EINE Checklisten-Editor für Eintritt UND
// Austritt (Plan 80-09, Task 3). Kein zweiter Editor daneben (Objective,
// harte Grenze): dieselbe Komponente rendert `vorgang.art === 'eintritt'`
// gegen VORLAGE_EINTRITT-Punkte und `'austritt'` gegen VORLAGE_AUSTRITT-Punkte,
// gruppiert in denselben sechs Abschnitten.
//
// Ein Personalvorgang aus der Zeit vor diesem Plan (Seed PV-005) trägt nur
// {schluessel, erledigt_am} je Punkt — punktAnzeige() ergänzt Titel/
// Rechtsgrund/Pflicht/Gruppe in dem Fall aus der Standardvorlage (per
// Schlüssel-Lookup), ohne die gespeicherte Zeile selbst zu ändern.
//
// Dokument-Anhänge sind je PERSON verfügbar (PersonalDokumente.jsx, wie
// MitarbeiterDetail.jsx es nutzt), nicht je einzelnem Checklistenpunkt —
// Personaldokument (personalEntitaeten.js, außerhalb der files_modified
// dieses Plans) hat kein Feld für einen Punkt-Bezug.
//
// In:  {vorgang, mitarbeiter, vertraege, dokumente, regelWert, onZurueck,
//      onGeaendert}. Out: UI, Schreibzugriffe über bitApi.personal
//      (Personalvorgang.update, Mitarbeiter.update beim Abschließen).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { ArrowLeft } from "lucide-react";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { anzeigeName } from "@/lib/people/mitarbeiter.js";
import { VORLAGE_EINTRITT, VORLAGE_AUSTRITT, fortschritt, abgeleiteteErledigungen } from "@/lib/people/onboarding.js";
import PersonalDokumente from "./PersonalDokumente.jsx";

/** Die sechs Gruppen in fester Anzeigereihenfolge (Task 3). */
const GRUPPEN_REIHENFOLGE = Object.freeze([
  "Vertrag & Nachweise", "Lohnbüro & Sozialversicherung", "Kammer & Versorgung",
  "Arbeitsschutz", "Ausstattung & Konten", "Einarbeitung",
]);

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Anzeige-Informationen eines Punkts: aus der gespeicherten Zeile selbst
 * (Vorgänge, die über checklisteAusVorlage entstanden sind, tragen Titel/
 * Rechtsgrund/Pflicht/Gruppe bereits mit), sonst per Schlüssel-Lookup aus der
 * Standardvorlage (legacy Zeilen, z. B. der Seed PV-005).
 * @param {'eintritt'|'austritt'} art
 * @param {{schluessel: string, titel?: string, rechtsgrund?: string, pflicht?: boolean, gruppe?: string}} schritt
 * @returns {{titel: string, rechtsgrund: string, pflicht: boolean, gruppe: string}}
 */
function punktAnzeige(art, schritt) {
  const standard = art === "eintritt" ? VORLAGE_EINTRITT : VORLAGE_AUSTRITT;
  const basis = standard.find((p) => p.schluessel === schritt.schluessel);
  return {
    titel: schritt.titel || basis?.titel || schritt.schluessel,
    rechtsgrund: schritt.rechtsgrund || basis?.rechtsgrund || "",
    pflicht: schritt.pflicht !== undefined ? schritt.pflicht !== false : (basis ? basis.pflicht !== false : true),
    gruppe: schritt.gruppe || basis?.gruppe || "Einarbeitung",
  };
}

/**
 * @param {{vorgang: object, mitarbeiter: object|null, vertraege: object[], dokumente: object[],
 *   regelWert: (id: string) => any, onZurueck: () => void, onGeaendert: () => void}} props
 * @returns {React.ReactElement}
 */
export default function VorgangsCheckliste({ vorgang, mitarbeiter, vertraege, dokumente, regelWert, onZurueck, onGeaendert }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [speichertSchluessel, setSpeichertSchluessel] = React.useState(/** @type {string|null} */ (null));
  const [abschliessend, setAbschliessend] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const heute = heuteLokal();

  if (!vorgang) {
    return (
      <div data-testid="vorgangscheckliste-fehlt">
        <button type="button" onClick={onZurueck} className="mb-3 inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("Zurück zur Liste")}
        </button>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("Vorgang nicht gefunden.")}</p>
      </div>
    );
  }

  const schritte = Array.isArray(vorgang.schritte) ? vorgang.schritte : [];
  const abgeleitet = abgeleiteteErledigungen(vorgang, vertraege);
  const abgeleitetSet = new Set(abgeleitet.map((a) => a.schluessel));
  const prozent = fortschritt(schritte, abgeleitet);
  const alleAbgeschlossen = vorgang.status === "abgeschlossen";
  const allePflichtErledigt = schritte
    .filter((s) => punktAnzeige(vorgang.art, s).pflicht)
    .every((s) => Boolean(s.erledigt_am) || abgeleitetSet.has(s.schluessel));

  /** @param {object[]} neueSchritte */
  const schritteSpeichern = async (neueSchritte) => {
    await /** @type {any} */ (bitApi.personal).Personalvorgang.update(vorgang.id, { schritte: neueSchritte });
    onGeaendert();
  };

  /** @param {string} schluessel @param {Partial<{erledigt_am: string|null, notiz: string}>} patch */
  const punktAendern = async (schluessel, patch) => {
    setSpeichertSchluessel(schluessel);
    setFehler(null);
    try {
      const neueSchritte = schritte.map((s) => (s.schluessel === schluessel ? { ...s, ...patch } : s));
      await schritteSpeichern(neueSchritte);
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setSpeichertSchluessel(null);
    }
  };

  /** @param {(liste: object[]) => object[]} aendern */
  const ausstattungAendern = async (aendern) => {
    setFehler(null);
    try {
      const neueAusstattung = aendern(Array.isArray(vorgang.ausstattung) ? vorgang.ausstattung : []);
      await /** @type {any} */ (bitApi.personal).Personalvorgang.update(vorgang.id, { ausstattung: neueAusstattung });
      onGeaendert();
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    }
  };

  const abschliessen = async () => {
    const istEintritt = vorgang.art === "eintritt";
    const ok = await bestaetige({
      titel: istEintritt ? t("Eintritt abschließen?") : t("Austritt abschließen?"),
      text: istEintritt
        ? t("Der Mitarbeitende wird ab jetzt als aktiv geführt.")
        : t("Der Mitarbeitende wird ab jetzt als ausgeschieden geführt."),
      bestaetigen: t("Abschließen"),
    });
    if (!ok) return;
    setAbschliessend(true);
    setFehler(null);
    try {
      await /** @type {any} */ (bitApi.personal).Personalvorgang.update(vorgang.id, { status: "abgeschlossen" });
      if (mitarbeiter) {
        if (istEintritt) {
          await /** @type {any} */ (bitApi.personal).Mitarbeiter.update(mitarbeiter.id, { status: "aktiv" });
        } else {
          await /** @type {any} */ (bitApi.personal).Mitarbeiter.update(mitarbeiter.id, { status: "ausgeschieden", austritt: vorgang.stichtag });
        }
      }
      onGeaendert();
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setAbschliessend(false);
    }
  };

  const gruppen = GRUPPEN_REIHENFOLGE
    .map((gruppe) => ({ gruppe, punkte: schritte.filter((s) => punktAnzeige(vorgang.art, s).gruppe === gruppe) }))
    .filter((g) => g.punkte.length > 0);

  return (
    <div data-testid="vorgangscheckliste" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onZurueck} className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("Zurück zur Liste")}
        </button>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
          {t(vorgang.art === "eintritt" ? "Eintritt" : "Austritt")} — {anzeigeName(mitarbeiter) || t("Unbekannt")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("Stichtag")} {fmtDatum(vorgang.stichtag)} · {t(alleAbgeschlossen ? "Abgeschlossen" : "Offen")}
        </p>
        <progress
          value={prozent}
          max={100}
          aria-valuenow={prozent}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="vorgangscheckliste-fortschritt"
          className="mt-2 h-2 w-full accent-emerald-600"
        >
          {prozent}%
        </progress>
      </div>

      {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}

      {gruppen.map(({ gruppe, punkte }) => (
        <section key={gruppe} aria-labelledby={`vc-h-${gruppe}`}>
          <h3 id={`vc-h-${gruppe}`} className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{t(gruppe)}</h3>
          <ul className="space-y-2.5">
            {punkte.map((schritt) => {
              const info = punktAnzeige(vorgang.art, schritt);
              const istAbgeleitet = abgeleitetSet.has(schritt.schluessel);
              const erledigt = Boolean(schritt.erledigt_am) || istAbgeleitet;
              const inputId = `vc-punkt-${vorgang.id}-${schritt.schluessel}`;
              return (
                <li key={schritt.schluessel} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                  <div className="flex flex-wrap items-start gap-2">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={erledigt}
                      disabled={istAbgeleitet || speichertSchluessel === schritt.schluessel}
                      onChange={(e) => punktAendern(schritt.schluessel, { erledigt_am: e.target.checked ? heute : null })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600"
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={inputId} className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {t(info.titel)}{!info.pflicht ? ` (${t("optional")})` : ""}
                        {istAbgeleitet && (
                          <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-normal text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                            {t("aus Vertrag")}
                          </span>
                        )}
                      </label>
                      {info.rechtsgrund && <p className="text-xs text-slate-400 dark:text-slate-500">{info.rechtsgrund}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{t("Fällig")} {fmtDatum(schritt.faellig_am)}</span>
                        {schritt.erledigt_am && (
                          <span className="inline-flex items-center gap-1">
                            {t("Erledigt am")}
                            <input
                              type="date"
                              value={schritt.erledigt_am}
                              onChange={(e) => punktAendern(schritt.schluessel, { erledigt_am: e.target.value || null })}
                              className="h-6 rounded border border-slate-300 px-1 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            />
                          </span>
                        )}
                      </div>
                      <label htmlFor={`${inputId}-notiz`} className="sr-only">{t("Notiz")}</label>
                      <input
                        id={`${inputId}-notiz`}
                        type="text"
                        placeholder={t("Notiz")}
                        defaultValue={schritt.notiz || ""}
                        onBlur={(e) => { if (e.target.value !== (schritt.notiz || "")) punktAendern(schritt.schluessel, { notiz: e.target.value }); }}
                        className="mt-1.5 h-8 w-full rounded-md border border-slate-300 bg-transparent px-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {gruppe === "Ausstattung & Konten" && (
            <AusstattungListe
              austritt={vorgang.art === "austritt"}
              liste={Array.isArray(vorgang.ausstattung) ? vorgang.ausstattung : []}
              onAendern={ausstattungAendern}
            />
          )}
        </section>
      ))}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Dokumente")}</h3>
        {mitarbeiter ? (
          <PersonalDokumente mitarbeiterId={mitarbeiter.id} dokumente={dokumente || []} regelWert={regelWert} onGespeichert={onGeaendert} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine Person zugeordnet.")}</p>
        )}
      </div>

      {!alleAbgeschlossen && (
        <button
          type="button"
          onClick={abschliessen}
          disabled={!allePflichtErledigt || abschliessend}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(vorgang.art === "eintritt" ? "Eintritt abschließen" : "Austritt abschließen")}
        </button>
      )}
    </div>
  );
}

/**
 * Abschnitt "Ausstattung": Gegenstand, Inventarnummer, ausgegeben am, zurück
 * am — beim Austritt erscheint eine noch nicht zurückgegebene Zeile als
 * "offen" (nur Anzeige, kein Abschluss-Gate).
 * @param {{austritt: boolean, liste: Array<{gegenstand?: string, inventarnummer?: string, ausgegeben_am?: string|null, zurueck_am?: string|null}>,
 *   onAendern: (aendern: (liste: object[]) => object[]) => void}} props
 * @returns {React.ReactElement}
 */
function AusstattungListe({ austritt, liste, onAendern }) {
  const { t } = useI18n();
  const zeileAendern = (i, patch) => onAendern((l) => l.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const zeileEntfernen = (i) => onAendern((l) => l.filter((_, j) => j !== i));
  const zeileHinzufuegen = () => onAendern((l) => [...l, { gegenstand: "", inventarnummer: "", ausgegeben_am: null, zurueck_am: null }]);
  const eingabe = "h-8 rounded-md border border-slate-300 bg-transparent px-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="mt-3" data-testid="ausstattung-liste">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Ausstattung")}</h4>
      <ul className="space-y-1.5">
        {liste.map((z, i) => {
          const offen = austritt && !z.zurueck_am;
          return (
            <li key={i} className={`flex flex-wrap items-center gap-1.5 rounded-md border p-1.5 text-xs ${offen ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : "border-slate-200 dark:border-slate-700"}`}>
              <label className="sr-only" htmlFor={`ausst-gegenstand-${i}`}>{t("Gegenstand")}</label>
              <input id={`ausst-gegenstand-${i}`} className={eingabe} placeholder={t("Gegenstand")} value={z.gegenstand || ""} onChange={(e) => zeileAendern(i, { gegenstand: e.target.value })} />
              <label className="sr-only" htmlFor={`ausst-inv-${i}`}>{t("Inventarnummer")}</label>
              <input id={`ausst-inv-${i}`} className={eingabe} placeholder={t("Inventarnummer")} value={z.inventarnummer || ""} onChange={(e) => zeileAendern(i, { inventarnummer: e.target.value })} />
              <label className="sr-only" htmlFor={`ausst-aus-${i}`}>{t("Ausgegeben am")}</label>
              <input id={`ausst-aus-${i}`} type="date" className={eingabe} value={z.ausgegeben_am || ""} onChange={(e) => zeileAendern(i, { ausgegeben_am: e.target.value || null })} />
              <label className="sr-only" htmlFor={`ausst-zurueck-${i}`}>{t("Zurück am")}</label>
              <input id={`ausst-zurueck-${i}`} type="date" className={eingabe} value={z.zurueck_am || ""} onChange={(e) => zeileAendern(i, { zurueck_am: e.target.value || null })} />
              {offen && <span className="text-amber-700 dark:text-amber-300">{t("offen")}</span>}
              <button type="button" onClick={() => zeileEntfernen(i)} className="ml-auto text-slate-400 hover:text-rose-600" aria-label={t("Zeile entfernen")}>×</button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={zeileHinzufuegen} className="mt-1.5 text-xs text-emerald-700 hover:underline dark:text-emerald-400">
        {t("+ Gegenstand hinzufügen")}
      </button>
    </div>
  );
}
