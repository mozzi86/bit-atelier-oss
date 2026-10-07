// MitarbeiterDetail.jsx — Detailansicht einer Person über ?mitarbeiter=<id>
// (Plan 80-04, Task 6): Stammdaten, Kammer, Qualifikationen mit Ablauf-Chip und
// Projektzuordnungen (Projektname aus Project). Benannte Slots `vertrag`,
// `vorgang` sind ab 80-06/80-09 befüllt; `datenschutz` ab 80-10
// (DatenschutzAktionen.jsx) — additiv, ohne diese Datei sonst anzufassen
// (data-slot-Hüllen).
//
// DS-07 gilt hier NUR für URL und document.title (beide bleiben opak/
// routenbasiert) — der sichtbare Seiteninhalt selbst zeigt den Namen, wie
// jede andere Detailansicht der App auch.
//
// In:  {mitarbeiter, projekte, onSchliessen, onBearbeiten}.
// Out: UI, keine eigenen Schreibzugriffe.

import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { ArrowLeft, Pencil } from "lucide-react";
import EmptyState from "@core/components/common/EmptyState";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { useEinstellung } from "@core/lib/useEinstellung";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { PERSONENARTEN, STATUS, anzeigeName } from "@/lib/people/mitarbeiter.js";
import { aktiverVertrag, probezeitEnde } from "@/lib/people/vertrag.js";
import { urlaubsanspruch } from "@/lib/people/urlaub.js";
import { VORLAGE_EINTRITT, vorlageWirksam, checklisteAusVorlage } from "@/lib/people/onboarding.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";
import { usePersonalDaten } from "./usePersonalDaten.js";
import GehaltsVerlauf from "./GehaltsVerlauf.jsx";
import PersonalDokumente from "./PersonalDokumente.jsx";
import AustrittDialog from "./AustrittDialog.jsx";
import DatenschutzAktionen from "./DatenschutzAktionen.jsx";

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * Inhalt des `data-slot="vertrag"` (Plan 80-06, Task 7): additiv befüllt, ohne
 * die Props-Schnittstelle des Reiter-Callers (MitarbeitendeReiter.jsx, 80-04)
 * zu ändern — ruft `usePersonalDaten`/`useRegelWerte` selbst auf, demselben
 * "kein gemeinsamer Cache"-Muster wie jede andere Personal-Komponente
 * (80-04-SUMMARY, Schnittstellen für die Folgepläne).
 * @param {{mitarbeiter: object}} props
 * @returns {React.ReactElement}
 */
function VertragSlot({ mitarbeiter }) {
  const { t } = useI18n();
  const { daten, neuLaden } = usePersonalDaten();
  const { wert: regelWert } = useRegelWerte(REGELWERKE);
  const artInfo = PERSONENARTEN.find((p) => p.key === mitarbeiter.art);

  if (artInfo && !artInfo.arbeitsrecht) {
    return <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="mitarbeiter-kein-arbeitsvertrag">{t(artInfo.hinweis)}</p>;
  }

  const heute = heuteLokal();
  const vertrag = aktiverVertrag(daten.Arbeitsvertrag, mitarbeiter.id, heute);
  if (!vertrag) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t("Kein aktiver Vertrag.")}</p>;
  }

  const probezeit = vertrag.probezeit_monate ? probezeitEnde(vertrag.beginn, vertrag.probezeit_monate) : null;
  const anspruch = urlaubsanspruch({
    urlaub_tage_jahr: vertrag.urlaub_tage_jahr, eintritt: vertrag.beginn, austritt: vertrag.ende, jahr: Number(heute.slice(0, 4)),
  });
  const einheit = mitarbeiter.art === "werkstudent" ? "stunde" : "monat";

  return (
    <div data-testid="mitarbeiter-vertrag-slot" className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500 dark:text-slate-400">{t("Probezeit endet")}</dt><dd>{probezeit ? fmtDatum(probezeit) : "—"}</dd></div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">{t("Urlaubsanspruch (laufendes Jahr)")}</dt>
          <dd>{anspruch.tage} {t("Tage")}<span className="ml-1 text-xs text-slate-400">— {fuellen(t(anspruch.schluessel), anspruch.werte)}</span></dd>
        </div>
      </dl>
      <GehaltsVerlauf arbeitsvertragId={vertrag.id} mitarbeiterId={mitarbeiter.id} einheit={einheit} gehaelter={daten.Gehaltsaenderung} onGespeichert={neuLaden} />
    </div>
  );
}

/**
 * Inhalt des Abschnitts "Dokumente" (Plan 80-06, Task 6): generischer
 * `PersonalDokumente`-Baustein, hier für die ganze Personalakte (alle
 * Kategorien) statt nur "Vertrag" (das übernimmt VertragsFormular.jsx).
 * @param {{mitarbeiter: object}} props
 * @returns {React.ReactElement}
 */
function DokumenteSlot({ mitarbeiter }) {
  const { daten, neuLaden } = usePersonalDaten();
  const { wert: regelWert } = useRegelWerte(REGELWERKE);
  return <PersonalDokumente mitarbeiterId={mitarbeiter.id} dokumente={daten.Personaldokument} regelWert={regelWert} onGespeichert={neuLaden} />;
}

/**
 * Inhalt des `data-slot="vorgang"` (Plan 80-09, Task 4): laufende/abgeschlossene
 * Personalvorgänge dieser Person verlinkt, dazu "Eintritt starten" (ohne
 * Bewerbung — direkt aus der Standardvorlage) und "Austritt starten"
 * (AustrittDialog.jsx). Ruft usePersonalDaten/useRegelWerte selbst auf
 * (dasselbe "kein gemeinsamer Cache"-Muster wie VertragSlot/DokumenteSlot oben).
 * @param {{mitarbeiter: object}} props
 * @returns {React.ReactElement}
 */
function VorgangSlot({ mitarbeiter }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bestaetige = useBestaetigung();
  const { daten, neuLaden } = usePersonalDaten();
  const { wert: regelWert } = useRegelWerte(REGELWERKE);
  // Setting "personal.vorlagen" (80-09 Task 5) — existiert erst nach der ersten Anpassung.
  const [vorlagenAnpassung] = useEinstellung("personal.vorlagen", null);
  const [austrittOffen, setAustrittOffen] = React.useState(false);
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  const eigeneVorgaenge = daten.Personalvorgang.filter((v) => v.mitarbeiter_id === mitarbeiter.id);
  const laufenderEintritt = eigeneVorgaenge.find((v) => v.art === "eintritt" && v.status !== "abgeschlossen");
  const laufenderAustritt = eigeneVorgaenge.find((v) => v.art === "austritt" && v.status !== "abgeschlossen");

  const eintrittStarten = async () => {
    const ok = await bestaetige({ titel: t("Eintritt starten?"), text: t("Legt eine Eintritts-Checkliste für diese Person an."), bestaetigen: t("Eintritt starten") });
    if (!ok) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const stichtag = mitarbeiter.eintritt || heuteLokal();
      const vorlage = vorlageWirksam(VORLAGE_EINTRITT, vorlagenAnpassung?.eintritt);
      const schritte = checklisteAusVorlage(vorlage, mitarbeiter, stichtag);
      const vorgang = await /** @type {any} */ (bitApi.personal).Personalvorgang.create({
        art: "eintritt", mitarbeiter_id: mitarbeiter.id, bewerbung_id: null, arbeitsvertrag_id: null,
        stichtag, status: "offen", schritte, ausstattung: [],
      });
      await neuLaden();
      navigate(`/People${bauePersonalLink({ tab: "onboarding", vorgang: vorgang.id })}`);
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div data-testid="mitarbeiter-vorgang-slot">
      {eigeneVorgaenge.length > 0 && (
        <ul className="mb-2 space-y-1 text-sm">
          {eigeneVorgaenge.map((v) => (
            <li key={v.id}>
              <Link to={`/People${bauePersonalLink({ tab: "onboarding", vorgang: v.id })}`} className="text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
                {t(v.art === "eintritt" ? "Eintritt" : "Austritt")} — {t(v.status === "abgeschlossen" ? "Abgeschlossen" : "Offen")}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {fehler && <p role="alert" className="mb-2 text-sm text-rose-600">{fehler}</p>}
      <div className="flex flex-wrap gap-2">
        {!laufenderEintritt && (
          <button type="button" onClick={eintrittStarten} disabled={laeuft}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {t("Eintritt starten")}
          </button>
        )}
        {mitarbeiter.status === "aktiv" && !laufenderAustritt && (
          <button type="button" onClick={() => setAustrittOffen(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {t("Austritt starten")}
          </button>
        )}
      </div>
      {austrittOffen && (
        <AustrittDialog
          mitarbeiter={mitarbeiter}
          vertraege={daten.Arbeitsvertrag}
          regelWert={regelWert}
          onClose={() => setAustrittOffen(false)}
          onAngelegt={async (vorgang) => { await neuLaden(); navigate(`/People${bauePersonalLink({ tab: "onboarding", vorgang: vorgang.id })}`); }}
        />
      )}
    </div>
  );
}

/**
 * @param {{mitarbeiter: object|null, projekte: Array<{id: string, name?: string}>,
 *   onSchliessen: () => void, onBearbeiten: (m: object) => void}} props
 * @returns {React.ReactElement}
 */
export default function MitarbeiterDetail({ mitarbeiter, projekte, onSchliessen, onBearbeiten }) {
  const { t } = useI18n();

  if (!mitarbeiter) {
    return (
      <div data-testid="mitarbeiter-detail-fehlt">
        <button type="button" onClick={onSchliessen} className="mb-3 inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("Zurück zur Liste")}
        </button>
        <EmptyState title={t("Person nicht gefunden")} description={t("Der Eintrag wurde vielleicht entfernt oder gehört zu einem anderen Datenstand.")} action={null} />
      </div>
    );
  }

  const art = PERSONENARTEN.find((p) => p.key === mitarbeiter.art);
  const status = STATUS.find((s) => s.key === mitarbeiter.status);
  const heute = new Date().toISOString().slice(0, 10);
  const projektName = (id) => projekte.find((p) => p.id === id)?.name || id;

  return (
    <div data-testid="mitarbeiter-detail" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onSchliessen} className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("Zurück zur Liste")}
        </button>
        <button type="button" onClick={() => onBearbeiten(mitarbeiter)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t("Bearbeiten")}
        </button>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{anzeigeName(mitarbeiter)}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {mitarbeiter.personalnummer} · {t(art?.label || mitarbeiter.art)} · {t(status?.label || mitarbeiter.status)}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500 dark:text-slate-400">{t("Funktion")}</dt><dd>{mitarbeiter.funktion || "—"}</dd></div>
        <div><dt className="text-slate-500 dark:text-slate-400">{t("Eintritt")}</dt><dd>{fmtDatum(mitarbeiter.eintritt)}</dd></div>
        <div><dt className="text-slate-500 dark:text-slate-400">{t("Dienstliche E-Mail")}</dt><dd>{mitarbeiter.dienstlich?.email || "—"}</dd></div>
        <div><dt className="text-slate-500 dark:text-slate-400">{t("Austritt")}</dt><dd>{fmtDatum(mitarbeiter.austritt)}</dd></div>
      </dl>

      {mitarbeiter.kammer?.kammer && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Kammer")}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {mitarbeiter.kammer.kammer} · {mitarbeiter.kammer.fachrichtung || "—"} · {mitarbeiter.kammer.mitgliedsnr || "—"}
            {mitarbeiter.kammer.bauvorlageberechtigt ? ` · ${t("Bauvorlageberechtigt")}` : ""}
          </p>
        </div>
      )}

      {Array.isArray(mitarbeiter.qualifikationen) && mitarbeiter.qualifikationen.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Qualifikationen")}</h3>
          <ul className="mt-1 flex flex-wrap gap-2">
            {mitarbeiter.qualifikationen.map((q, i) => {
              const abgelaufen = q.gueltig_bis && q.gueltig_bis < heute;
              return (
                <li key={i} className={`rounded-full border px-2.5 py-0.5 text-xs ${abgelaufen ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200" : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}>
                  {q.bezeichnung}{q.gueltig_bis ? ` — ${fmtDatum(q.gueltig_bis)}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {Array.isArray(mitarbeiter.projekt_zuordnungen) && mitarbeiter.projekt_zuordnungen.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Projektzuordnungen")}</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {mitarbeiter.projekt_zuordnungen.map((z, i) => (
              <li key={i}>{projektName(z.project_id)} — {z.funktion || "—"} ({z.anteil_prozent ?? 0} %)</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Dokumente")}</h3>
        <div className="mt-1"><DokumenteSlot mitarbeiter={mitarbeiter} /></div>
      </div>

      {/* data-slot="vertrag"/"vorgang" sind ab 80-06/80-09 befüllt; "datenschutz" ab 80-10. */}
      <div data-slot="vertrag"><VertragSlot mitarbeiter={mitarbeiter} /></div>
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Einstellung & Austritt")}</h3>
        <div className="mt-1" data-slot="vorgang"><VorgangSlot mitarbeiter={mitarbeiter} /></div>
      </div>
      <div data-slot="datenschutz"><DatenschutzAktionen mitarbeiterId={mitarbeiter.id} /></div>
    </div>
  );
}
