// Settings area "Personal-Vorlagen" (key `templates`) — Plan 80-09/80-10,
// Task 5: der Inhaber passt hier einmal die Eintritts-/Austrittsvorlagen an.
// EIN Editor deckt beide Vorlagenarten ab (kein zweiter daneben).
//
// Standardpunkte sind deaktivierbar, NIE löschbar (die volle Standardliste
// bleibt in VORLAGE_EINTRITT/VORLAGE_AUSTRITT unverändert, nur ihr Schalter
// "aktiv" ändert sich hier). Eigene Punkte lassen sich hinzufügen, umbenennen,
// entfernen und (Tastatur, kein Drag&Drop) sortieren.
//
// Speicher: Setting "personal.vorlagen" = {eintritt: VorlagenAnpassung,
// austritt: VorlagenAnpassung} (useEinstellung, 80-01). Das Setting existiert
// erst nach der ERSTEN Änderung (Behavior 10) — bis dahin liefert useEinstellung
// den Standardwert `null`. "Standard wiederherstellen" löscht die Zeile
// vollständig (loescheEinstellung), nach Rückfrage.
//
// Datenschutz-Kommentar (D-P80-20, E-07/E-14): "personal.vorlagen" trägt KEINE
// Personaldaten (nur Titel/Fälligkeit/Pflicht der Punkte), gehört aber zum
// `separat`-Bereich "Personal" (80-10, PERSONAL_EXPORT_BEREICH.settingKeys) —
// ab 80-10 steht der Schlüssel nie in der `.bitproj`, sondern reist nur in der
// verschlüsselten `.bitpers` mit; bis 80-10 landet er als gewöhnliche
// Setting-Zeile (wie jedes andere Setting).
//
// In:  props {kontext?: import("@/lib/settings/bereiche.js").EinstellungsKontext} (Zugang ist auf /Settings-Ebene bereits geprüft — DS-12).
// Out: BEREIT = true, die Komponente.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { useEinstellung, loescheEinstellung } from "@core/lib/useEinstellung";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { VORLAGE_EINTRITT, VORLAGE_AUSTRITT } from "@/lib/people/onboarding.js";

/** Whether /Settings offers this area. */
export const BEREIT = true;

const EINGABE = "h-8 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

/** @param {{deaktiviert?: string[], eigene?: object[]}|null|undefined} v @returns {{deaktiviert: string[], eigene: object[]}} eine Anpassung mit sicheren Defaults */
function sicher(v) {
  const eingabe = /** @type {any} */ (v);
  return { deaktiviert: Array.isArray(eingabe?.deaktiviert) ? eingabe.deaktiviert : [], eigene: Array.isArray(eingabe?.eigene) ? eingabe.eigene : [] };
}

/**
 * Editor EINER Vorlagenart (Eintritt ODER Austritt) — beide Aufrufe in
 * PersonalBereich unten teilen sich diese eine Komponente, also EIN Editor.
 * @param {{titel: string, standard: ReadonlyArray<object>, anpassung: object,
 *   onAendern: (neu: object) => void}} props
 * @returns {React.ReactElement}
 */
function VorlagenEditor({ titel, standard, anpassung, onAendern }) {
  const { t } = useI18n();
  const a = sicher(anpassung);

  const schalten = (schluessel) => {
    const deaktiviert = a.deaktiviert.includes(schluessel) ? a.deaktiviert.filter((s) => s !== schluessel) : [...a.deaktiviert, schluessel];
    onAendern({ ...a, deaktiviert });
  };
  const eigeneAendern = (neueEigene) => onAendern({ ...a, eigene: neueEigene });
  const eigenenHinzufuegen = () => {
    const schluessel = `eigen_${Date.now().toString(36)}`;
    eigeneAendern([...a.eigene, { schluessel, titel: "", faellig: { tage: 0 }, pflicht: true }]);
  };
  const eigenenAendern = (i, patch) => eigeneAendern(a.eigene.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const eigenenEntfernen = (i) => eigeneAendern(a.eigene.filter((_, j) => j !== i));
  const eigenenVerschieben = (i, richtung) => {
    const ziel = i + richtung;
    if (ziel < 0 || ziel >= a.eigene.length) return;
    const kopie = [...a.eigene];
    [kopie[i], kopie[ziel]] = [kopie[ziel], kopie[i]];
    eigeneAendern(kopie);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{titel}</h3>

      <ul className="space-y-1.5" data-testid="vorlagen-standard-liste">
        {standard.map((p) => {
          const aktiv = !a.deaktiviert.includes(p.schluessel);
          const inputId = `pv-standard-${titel}-${p.schluessel}`;
          return (
            <li key={p.schluessel} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
              <input id={inputId} type="checkbox" checked={aktiv} onChange={() => schalten(p.schluessel)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600" />
              <label htmlFor={inputId} className="min-w-0 flex-1">
                <span className={aktiv ? "text-slate-800 dark:text-slate-100" : "text-slate-400 line-through dark:text-slate-500"}>{t(p.titel)}</span>
                {p.rechtsgrund && <span className="block text-xs text-slate-400 dark:text-slate-500">{p.rechtsgrund}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      <div>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Eigene Punkte")}</h4>
        <ul className="space-y-1.5" data-testid="vorlagen-eigene-liste">
          {a.eigene.map((e, i) => (
            <li key={e.schluessel} className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
              <label className="sr-only" htmlFor={`pv-eigen-titel-${titel}-${i}`}>{t("Titel")}</label>
              <input id={`pv-eigen-titel-${titel}-${i}`} className={EINGABE} placeholder={t("Titel")} value={e.titel || ""} onChange={(ev) => eigenenAendern(i, { titel: ev.target.value })} />
              <label className="sr-only" htmlFor={`pv-eigen-tage-${titel}-${i}`}>{t("Fällig (Tage)")}</label>
              <input id={`pv-eigen-tage-${titel}-${i}`} type="number" className={`${EINGABE} w-20`} placeholder={t("Tage")} value={e.faellig?.tage ?? 0}
                onChange={(ev) => eigenenAendern(i, { faellig: { tage: Number(ev.target.value) || 0 } })} />
              <label className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={e.pflicht !== false} onChange={(ev) => eigenenAendern(i, { pflicht: ev.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 dark:border-slate-600" />
                {t("Pflicht")}
              </label>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => eigenenVerschieben(i, -1)} disabled={i === 0} aria-label={t("nach oben")}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"><ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
                <button type="button" onClick={() => eigenenVerschieben(i, 1)} disabled={i === a.eigene.length - 1} aria-label={t("nach unten")}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
                <button type="button" onClick={() => eigenenEntfernen(i)} aria-label={t("entfernen")}
                  className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={eigenenHinzufuegen} className="mt-1.5 text-xs text-emerald-700 hover:underline dark:text-emerald-400">
          {t("+ Eigenen Punkt hinzufügen")}
        </button>
      </div>
    </div>
  );
}

/**
 * @returns {React.ReactElement}
 */
export default function PersonalBereich() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [anpassung, setzeAnpassung] = useEinstellung("personal.vorlagen", null);
  // 80-10 Task 7 (D-P80-24): Schalter für die Zählkarte "Personal: N Fristen
  // fällig" auf der Projektübersicht — Standard an, abschaltbar.
  const [zaehlkarte, setzeZaehlkarte] = useEinstellung("personal.zaehlkarte", true);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  const speichern = async (zweig, neu) => {
    setFehler(null);
    try {
      await setzeAnpassung({ eintritt: sicher(anpassung?.eintritt), austritt: sicher(anpassung?.austritt), [zweig]: neu });
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    }
  };

  const wiederherstellen = async () => {
    const ok = await bestaetige({
      titel: t("Standard wiederherstellen?"),
      text: t("Alle Anpassungen an den Personal-Vorlagen gehen verloren. Bestehende Checklisten bleiben unverändert."),
      bestaetigen: t("Wiederherstellen"),
      gefahr: true,
    });
    if (!ok) return;
    setFehler(null);
    try {
      await loescheEinstellung("personal.vorlagen");
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    }
  };

  const hatAnpassung = anpassung !== null && anpassung !== undefined;

  return (
    <div data-testid="personal-bereich" className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Änderungen gelten für neue Vorgänge; bestehende Checklisten bleiben unverändert.")}
      </p>
      {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}

      <VorlagenEditor titel={t("Eintritt")} standard={VORLAGE_EINTRITT} anpassung={anpassung?.eintritt} onAendern={(neu) => speichern("eintritt", neu)} />
      <VorlagenEditor titel={t("Austritt")} standard={VORLAGE_AUSTRITT} anpassung={anpassung?.austritt} onAendern={(neu) => speichern("austritt", neu)} />

      <button type="button" onClick={wiederherstellen} disabled={!hatAnpassung}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
        {t("Standard wiederherstellen")}
      </button>

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={zaehlkarte !== false} onChange={(e) => setzeZaehlkarte(e.target.checked)}
            data-testid="personal-zaehlkarte-schalter" className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" />
          {t("Zählkarte in der Projektübersicht anzeigen")}
        </label>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("„Personal: N Fristen fällig“ auf dem Dashboard — ohne Namen, ohne Beträge, kein Push, keine Mail.")}
        </p>
      </div>
    </div>
  );
}
