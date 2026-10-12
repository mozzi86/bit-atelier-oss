// Timer card of the day view (phase 81-02, ZEIT-02): start on a target, the
// running time ticks, stop creates a booking (quelle 'timer', minutes rounded UP
// to the grid). Under one minute nothing is booked. The timer lives in this
// device's localStorage (src/lib/zeit/timer.js) and survives a reload; a
// blocked storage turns the card into a notice.
//
// In:  props zh, zz. Out: the card; stopping writes one draft booking.

import React from "react";
import { toast } from "sonner";
import { Play, Square, X } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { isoTag } from "@core/lib/kalender/datum.js";
import { geraeteSpeicher, leseTimer, starteTimer, stoppeTimer, timerMinuten } from "@/lib/zeit/timer.js";
import { personAnzeigeName } from "@/lib/zeit/personalQuelle.js";
import { KARTE, LEERES_ZIEL, stundenText, ZielFelder, zielText } from "./zeitGemeinsam.jsx";

/**
 * @param {number} ms
 * @returns {string} "h:mm:ss"
 */
function laufzeit(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung}} props
 * @returns {React.ReactElement}
 */
export default function TimerKarte({ zh, zz }) {
  const { t, lang } = useI18n();
  const [zustand, setZustand] = React.useState(() => leseTimer(geraeteSpeicher()));
  const [ziel, setZiel] = React.useState(() => ({ ...LEERES_ZIEL }));
  const [jetzt, setJetzt] = React.useState(() => Date.now());
  const projektNamen = React.useMemo(() => new Map(zh.projekte.map((p) => [p.id, p.name])), [zh.projekte]);

  React.useEffect(() => {
    if (!zustand.laeuft) return undefined;
    const id = setInterval(() => setJetzt(Date.now()), 1000);
    return () => clearInterval(id);
  }, [zustand.laeuft]);

  if (!zustand.verfuegbar) {
    return <div className={`${KARTE} text-sm text-slate-600 dark:text-slate-300`}>{t("Der Timer braucht den Gerätespeicher des Browsers — er ist hier gesperrt.")}</div>;
  }

  const starten = () => {
    const r = starteTimer(geraeteSpeicher(), { ...ziel, mitarbeiter_id: zz.personId }, Date.now());
    if (!r.ok) { toast.error(t("Der Timer konnte nicht gestartet werden.")); return; }
    setZustand(leseTimer(geraeteSpeicher()));
    setJetzt(Date.now());
  };

  const stoppen = async () => {
    const r = stoppeTimer(geraeteSpeicher());
    setZustand(leseTimer(geraeteSpeicher()));
    if (!r.ok || !r.daten) return;
    const ende = Date.now();
    const minuten = timerMinuten(r.daten.start_ms, ende, zz.regeln.raster);
    if (!minuten) { toast.info(t("Unter einer Minute — keine Buchung.")); return; }
    const { start_ms, ...rest } = r.daten;
    try {
      await zz.speichereBuchung({ ...rest, datum: isoTag(start_ms), minuten, notiz: rest.notiz || "", status: "entwurf", quelle: "timer" });
      toast.success(t("{h} h gebucht").replace("{h}", stundenText(minuten, lang)));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const verwerfen = () => {
    stoppeTimer(geraeteSpeicher());
    setZustand(leseTimer(geraeteSpeicher()));
  };

  if (zustand.laeuft && zustand.daten) {
    const d = zustand.daten;
    const person = zz.personen.find((p) => p.id === d.mitarbeiter_id);
    return (
      <div className={KARTE} data-testid="zeit-timer">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {t("Timer läuft")} · <span className="tabular-nums" data-testid="zeit-timer-laufzeit">{laufzeit(jetzt - d.start_ms)}</span>
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-300">{zielText(d, projektNamen, t)} · {personAnzeigeName(person || { id: d.mitarbeiter_id }, t)}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonVariants({ variant: "default" })} onClick={stoppen}><Square aria-hidden="true" /> {t("Stopp")}</button>
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={verwerfen}><X aria-hidden="true" /> {t("Verwerfen")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={KARTE} data-testid="zeit-timer">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("Timer")}</p>
      <ZielFelder wert={ziel} onChange={setZiel} idPraefix="timer" projekte={zh.projekte} vertraege={zh.daten.Honorarvertrag}
        nachtraege={zh.daten.Honorarnachtrag} mitarbeiter={zz.personen} buchungen={zh.daten.Zeitbuchung}
        mitarbeiterId={zz.personId} heute={zh.heute} />
      <button type="button" className={buttonVariants({ variant: "outline" })} onClick={starten}><Play aria-hidden="true" /> {t("Start")}</button>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("Der Timer läuft auf diesem Gerät weiter, auch nach dem Neuladen.")}</p>
    </div>
  );
}
