// PersonalSicherung.jsx — die verschlüsselte `.bitpers`-Sicherung im
// Personal-Kopf (Plan 80-10, Task 6, D-P80-15): "Personaldaten sichern"
// (Passphrase zweimal, mindestens 12 Zeichen), "Sicherung laden" (Datei →
// Passphrase → Vorschau → Rückfrage). (Der Demo-Knopf "Personal-Beispieldaten
// zurücksetzen" ist mit der Demo entfallen, 83-02.) `bitpersSchritt` (Task 7b) ist der
// `SEPARAT_SCHRITTE`-Eintrag des registry-getriebenen Exportdialogs (80-05) —
// dieselbe Passphrase-Abfrage wie "Personaldaten sichern" oben, nur ohne
// eigenen Auslöse-Knopf (der Exportdialog ruft sie auf).
//
// In:  nichts von außen (ruft usePersonalDaten selbst auf). Out: UI,
//      exportPersonal/importPersonal-Aufrufe (personalDatei.js) über die
//      Personal-Sammlungen von personalDb.js.

import React from "react";
import { ShieldCheck, Download, Upload } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { Dialog, DialogContent, DialogTitle } from "@core/components/ui/dialog";
import {
  exportPersonal, importPersonal, parsePersonalDatei, lesePersonalDatei, vorschauPersonal,
} from "@core/api/personalDatei.js";
import { PERSONAL_ENTITAETEN } from "@core/api/personalEntitaeten.js";
import { PERSONAL_EXPORT_BEREICH } from "@/lib/people/exportBereich.js";
import { usePersonalDaten } from "./usePersonalDaten.js";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const MINDESTLAENGE = 12;

/**
 * Fragt eine Passphrase mit doppelter Eingabe ab, im Aufrufer als
 * kontrolliertes Overlay gerendert — kein eigener Zustand, damit
 * `bitpersSchritt` (Task 7b) und "Personaldaten sichern" (dieselbe Datei) die
 * gleiche kleine Komponente teilen.
 * @param {{titel: string, bestaetigen: string, onAbbrechen: () => void, onWeiter: (passphrase: string) => void, zweimal?: boolean, fehler?: string|null}} props
 * @returns {React.ReactElement}
 */
function PassphraseDialog({ titel, bestaetigen, onAbbrechen, onWeiter, zweimal = true, fehler }) {
  const { t } = useI18n();
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");
  const nichtGleich = zweimal && a !== b;
  const zuKurz = zweimal && a.length < MINDESTLAENGE;
  const gesperrt = zweimal ? (nichtGleich || zuKurz || !a) : !a;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onAbbrechen(); }}>
      <DialogContent className="max-w-sm" data-testid="personal-passphrase-dialog">
        <DialogTitle>{titel}</DialogTitle>
        {zweimal && (
          <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="personal-sicherung-passphrase-warnung">
            {t("Passphrase weg = Sicherung weg. Es gibt keine Wiederherstellung ohne sie.")}
          </p>
        )}
        <div className="space-y-2">
          <input type="password" autoFocus className={EINGABE} placeholder={t("Passphrase")} value={a}
            onChange={(e) => setA(e.target.value)} data-testid="personal-passphrase-1" />
          {zweimal && (
            <input type="password" className={EINGABE} placeholder={t("Passphrase wiederholen")} value={b}
              onChange={(e) => setB(e.target.value)} data-testid="personal-passphrase-2" />
          )}
        </div>
        {zweimal && zuKurz && a && <p className="text-xs text-rose-600">{t("Mindestens {n} Zeichen.").replace("{n}", String(MINDESTLAENGE))}</p>}
        {zweimal && nichtGleich && b && <p className="text-xs text-rose-600">{t("Die Passphrasen stimmen nicht überein.")}</p>}
        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onAbbrechen} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">{t("Abbrechen")}</button>
          <button type="button" disabled={gesperrt} onClick={() => onWeiter(a)} data-testid="personal-passphrase-weiter"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            {bestaetigen}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Personal-Kopf-Widget: Export/Import der verschlüsselten `.bitpers`-Sicherung,
 * plus — nur in der Demo — ein Reset auf die erfundenen Beispieldaten.
 * @returns {React.ReactElement}
 */
export default function PersonalSicherung() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const { daten, neuLaden } = usePersonalDaten();
  const [modus, setModus] = React.useState(/** @type {'sichern'|'laden'|null} */ (null));
  const [geladeneDatei, setGeladeneDatei] = React.useState(/** @type {object|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [meldung, setMeldung] = React.useState(/** @type {string|null} */ (null));
  const [laeuft, setLaeuft] = React.useState(false);
  const dateiEingabe = React.useRef(/** @type {HTMLInputElement|null} */ (null));

  const sichernAbschliessen = async (passphrase) => {
    setLaeuft(true);
    setFehler(null);
    try {
      await exportPersonal(passphrase, { settingKeys: PERSONAL_EXPORT_BEREICH.settingKeys });
      setModus(null);
      setMeldung(t("Sicherung gespeichert."));
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setLaeuft(false);
    }
  };

  const dateiGewaehlt = async (e) => {
    const datei = e.target.files?.[0];
    e.target.value = "";
    if (!datei) return;
    setFehler(null);
    try {
      const bytes = new Uint8Array(await datei.arrayBuffer());
      const obj = parsePersonalDatei(bytes);
      setGeladeneDatei(obj);
      setModus("laden");
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    }
  };

  const ladenAbschliessen = async (passphrase) => {
    if (!geladeneDatei) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const inhalt = await lesePersonalDatei(geladeneDatei, passphrase);
      const neu = vorschauPersonal(inhalt);
      const aktuell = Object.fromEntries(PERSONAL_ENTITAETEN.map((e) => [e, (daten[e] || []).length]));
      const zeilen = PERSONAL_ENTITAETEN.map((e) => `${e}: ${aktuell[e] ?? 0} → ${neu[e] ?? 0}`).join("\n");
      const ok = await bestaetige({
        titel: t("Sicherung laden?"),
        text: `${t("Ersetzt den aktuellen Stand vollständig.")}\n${zeilen}`,
        bestaetigen: t("Sicherung laden"),
        gefahr: true,
      });
      if (!ok) { setLaeuft(false); return; }
      await importPersonal(geladeneDatei, passphrase, { settingKeys: PERSONAL_EXPORT_BEREICH.settingKeys });
      await neuLaden();
      setModus(null);
      setGeladeneDatei(null);
      setMeldung(t("Sicherung geladen."));
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div data-testid="personal-sicherung" className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setModus("sichern")} disabled={laeuft} data-testid="personal-sicherung-sichern"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> {t("Personaldaten sichern")}
      </button>
      <button type="button" onClick={() => dateiEingabe.current?.click()} disabled={laeuft} data-testid="personal-sicherung-laden"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
        <Upload className="h-3.5 w-3.5" aria-hidden="true" /> {t("Sicherung laden")}
      </button>
      <input ref={dateiEingabe} type="file" accept=".bitpers" className="hidden" onChange={dateiGewaehlt} data-testid="personal-sicherung-datei-eingabe" />
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" title={t("Personaldaten sind nur so sicher wie die Sperre dieses Geräts (Art. 32 DSGVO).")}>
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {t("Gerät sperren schützt zusätzlich (Art. 32 DSGVO)")}
      </span>
      {meldung && <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{meldung}</span>}
      {fehler && !modus && <span role="alert" className="text-xs text-rose-600">{fehler}</span>}

      {modus === "sichern" && (
        <PassphraseDialog
          titel={t("Personaldaten sichern")}
          bestaetigen={t("Sicherung erstellen")}
          onAbbrechen={() => { setModus(null); setFehler(null); }}
          onWeiter={sichernAbschliessen}
          fehler={fehler}
        />
      )}
      {modus === "laden" && (
        <PassphraseDialog
          titel={t("Passphrase der Sicherung")}
          bestaetigen={t("Weiter")}
          zweimal={false}
          onAbbrechen={() => { setModus(null); setGeladeneDatei(null); setFehler(null); }}
          onWeiter={ladenAbschliessen}
          fehler={fehler}
        />
      )}
    </div>
  );
}

/**
 * Der `.bitpers`-Schritt des registry-getriebenen Exportdialogs (80-05
 * `SEPARAT_SCHRITTE`, Plan 80-10 Task 7b): fragt die Passphrase über
 * denselben Weg wie "Personaldaten sichern" ab und ruft exportPersonal mit
 * der EXAKTEN Schlüsselliste aus PERSONAL_EXPORT_BEREICH. Läuft nur mit
 * Personal-Zugang — der Exportdialog selbst läuft nur serverlos, wo das immer
 * gilt (80-05), diese Prüfung ist die zweite, unabhängige Absicherung.
 * @param {{rueckfokus?: () => void, personalZugang?: string, passphrase: string}} optionen
 *   `passphrase` kommt vom Exportdialog (er fragt sie inline ab, wie 80-05 das
 *   für jeden `separat`-Schritt vorsieht); diese Funktion selbst zeigt keinen
 *   eigenen Dialog, damit der Exportdialog EINEN durchgehenden Ablauf bleibt.
 * @returns {Promise<void>}
 * @throws {Error} "Personaldaten bleiben lokal" ohne Zugang; sonst was exportPersonal wirft
 */
export async function bitpersSchritt({ personalZugang, passphrase } = /** @type {any} */ ({})) {
  if (personalZugang !== "erlaubt") {
    throw new Error("Personaldaten bleiben lokal – ohne Personal-Zugang keine .bitpers-Sicherung.");
  }
  await exportPersonal(passphrase, { settingKeys: PERSONAL_EXPORT_BEREICH.settingKeys });
}
