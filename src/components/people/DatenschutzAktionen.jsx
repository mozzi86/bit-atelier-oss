// DatenschutzAktionen.jsx — Betroffenenrechte je Person/Bewerbung (Plan
// 80-10, Task 5): Auskunft (Art. 15/20 DSGVO) als Download, Löschen/Sperren
// (Art. 17 Abs. 3, Art. 18) mit ehrlichem Plan vor der Rückfrage. Eingebunden
// im Slot `datenschutz` von MitarbeiterDetail.jsx und in
// BewerbungFormular.jsx.
//
// Ruft usePersonalDaten/useRegelWerte selbst auf — dasselbe "kein
// gemeinsamer Cache"-Muster wie VertragSlot/DokumenteSlot/VorgangSlot in
// MitarbeiterDetail.jsx.
//
// In:  {mitarbeiterId} ODER {bewerbungId} (genau eines). Out: UI, ein
//      fuehrePlanAus()-Lauf über bitApi.personal, ein optionales
//      Contact-delete über bitApi.entities.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { personAuskunft, loeschPlan } from "@/lib/people/auskunft.js";
import { fuehrePlanAus } from "@/lib/people/loeschlauf.js";
import { usePersonalDaten } from "./usePersonalDaten.js";

/**
 * Startet einen Datei-Download im Browser (dasselbe Muster wie
 * personalDatei.js exportPersonal — hier ohne Verschlüsselung, die
 * Auskunftsdatei ist eine Klartext-JSON-Datei zum Aushändigen an die
 * betroffene Person selbst).
 * @param {string} dateiname
 * @param {object} inhalt
 */
function ladeJsonHerunter(dateiname, inhalt) {
  const blob = new Blob([JSON.stringify(inhalt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Text des Bestätigungsdialogs vor einer Löschung/Sperrung: "N Datensätze
 * werden gelöscht; M bleiben bis <Datum> gesperrt (<Grund>, <Norm>)" — bei
 * mehreren Sperrgründen (z. B. Lohnkonto- UND Personalakte-Frist zugleich)
 * zeigt die Zeile das späteste Enddatum und alle Gründe/Normen zusammengefasst.
 * @param {(s: string) => string} t
 * @param {{loeschen: Array<unknown>, sperren: Array<{bis: string, grund: string, norm: string}>}} plan
 * @returns {string}
 */
function bestaetigungsText(t, plan) {
  const n = plan.loeschen.length;
  if (plan.sperren.length === 0) {
    return t("{n} Datensätze werden gelöscht.").replace("{n}", String(n));
  }
  const spaetesteBis = plan.sperren.reduce((max, s) => (s.bis > max ? s.bis : max), "");
  const gruende = [...new Set(plan.sperren.map((s) => s.grund))].join("; ");
  const normen = [...new Set(plan.sperren.map((s) => s.norm))].join("; ");
  return t("{n} Datensätze werden gelöscht; {m} bleiben bis {bis} gesperrt ({grund}, {norm}).")
    .replace("{n}", String(n)).replace("{m}", String(plan.sperren.length))
    .replace("{bis}", spaetesteBis).replace("{grund}", gruende).replace("{norm}", normen);
}

/**
 * @param {{mitarbeiterId?: string, bewerbungId?: string}} props genau eines der beiden Felder
 * @returns {React.ReactElement}
 */
export default function DatenschutzAktionen({ mitarbeiterId, bewerbungId }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const { daten, neuLaden } = usePersonalDaten();
  const { wert: regelWert } = useRegelWerte(REGELWERKE);
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [erledigt, setErledigt] = React.useState(/** @type {string|null} */ (null));

  const subjekt = mitarbeiterId ? { mitarbeiterId } : { bewerbungId };
  const mitarbeiter = mitarbeiterId ? daten.Mitarbeiter.find((m) => m.id === mitarbeiterId) : null;
  const kennung = mitarbeiterId ? (mitarbeiter?.personalnummer || mitarbeiterId) : bewerbungId;
  // Ohne Austrittsdatum kennt loeschPlan() keine Personalakte-/Lohnkonto-Frist
  // (die Frist rechnet vom Austrittsjahr) und stuft alles als sofort löschbar
  // ein — bewusst kein zusätzlicher Block hier: die Bestätigung unten nennt
  // vorher genau, wie viele Datensätze das betrifft (D-P80-17-Muster: warnen,
  // nicht automatisch verhindern), und das Löschen einer noch beschäftigten
  // Person bleibt eine bewusste, von Hand bestätigte Handlung des Büros.
  const nochBeschaeftigt = Boolean(mitarbeiterId) && !mitarbeiter?.austritt && mitarbeiter?.status !== "ausgeschieden" && mitarbeiter?.status !== "gesperrt";

  const auskunftHerunterladen = () => {
    setFehler(null);
    try {
      const auskunft = personAuskunft(subjekt, daten, {});
      ladeJsonHerunter(`auskunft-${kennung}-${heuteLokal()}.json`, auskunft);
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    }
  };

  const loeschenSperren = async () => {
    setFehler(null);
    setErledigt(null);
    const heute = heuteLokal();
    const anlass = mitarbeiterId ? "austritt" : "antrag_art17";
    const plan = loeschPlan(subjekt, anlass, daten, heute, regelWert);
    if (plan.loeschen.length === 0 && plan.sperren.length === 0) {
      setErledigt(t("Nichts zu tun — keine Datensätze mit Bezug auf diese Person."));
      return;
    }
    const ok = await bestaetige({
      titel: t("Löschen / Sperren?"),
      text: bestaetigungsText(t, plan),
      bestaetigen: t("Löschen / Sperren"),
      gefahr: true,
    });
    if (!ok) return;

    setLaeuft(true);
    try {
      await fuehrePlanAus(plan, /** @type {any} */ (bitApi).personal, anlass, heute);
      await neuLaden();
      setErledigt(t("Erledigt: {n} Datensätze gelöscht.").replace("{n}", String(plan.loeschen.length)));

      // Eine dienstliche Visitenkarte im Adressbuch (Contact) ist KEINE
      // Personal-Entität (personalEntitaeten.js) und wird deshalb GETRENNT
      // abgefragt — ein Nein hier löscht nur die Personal-Daten, die
      // Visitenkarte bleibt.
      const mitarbeiter = mitarbeiterId ? daten.Mitarbeiter.find((m) => m.id === mitarbeiterId) : null;
      if (mitarbeiter?.kontakt_id) {
        const auchKontakt = await bestaetige({
          titel: t("Visitenkarte im Adressbuch ebenfalls löschen?"),
          text: t("Die dienstliche Visitenkarte im Adressbuch ist von der Personal-Löschung nicht betroffen."),
          bestaetigen: t("Auch löschen"),
          abbrechen: t("Im Adressbuch behalten"),
        });
        if (auchKontakt) {
          await /** @type {any} */ (bitApi.entities).Contact.delete(mitarbeiter.kontakt_id);
        }
      }
    } catch (err) {
      const e = /** @type {any} */ (err);
      const nAusgefuehrt = Array.isArray(e?.erledigt) ? e.erledigt.length : 0;
      setFehler(t("Löschlauf teilweise ausgeführt ({n} Schritte): {fehler}").replace("{n}", String(nAusgefuehrt)).replace("{fehler}", e?.message || String(err)));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div data-testid="datenschutz-aktionen" className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Datenschutz")}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={auskunftHerunterladen} data-testid="datenschutz-auskunft"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
          {t("Auskunft herunterladen (JSON)")}
        </button>
        <button type="button" onClick={loeschenSperren} disabled={laeuft} data-testid="datenschutz-loeschen"
          className="rounded-md border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
          {t("Löschen / Sperren")}
        </button>
      </div>
      {nochBeschaeftigt && (
        <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="datenschutz-noch-beschaeftigt">
          {t("Diese Person ist noch beschäftigt — ohne Austrittsdatum gilt keine Aufbewahrungsfrist, alle verknüpften Datensätze wären sofort löschbar.")}
        </p>
      )}
      {erledigt && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{erledigt}</p>}
      {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}
      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="datenschutz-download-hinweis">
        {t("Bereits heruntergeladene Dateien (Auskunft, Sicherungen) kann die App nicht löschen.")}
      </p>
    </div>
  );
}
