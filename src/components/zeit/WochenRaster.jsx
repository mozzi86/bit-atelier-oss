// Tab "Wochenansicht" of /TimeTracking (phase 81-02, ZEIT-01): the week grid of
// the person chosen under "Stunden für" — rows = project/stage/kind of work or
// office time, columns = Monday … Sunday, cells in hours. Built for the keyboard
// so a known row is booked in at most four inputs: type "2,5", Enter.
//
// Cells: Enter or leaving the cell saves a DRAFT through the storage layer
// (parseDauer on the grid zeit_honorar.raster; a value off the grid shows
// "Nur Vielfache von {n} min" and saves nothing; an empty cell deletes the
// drafts in it). A cell is locked when it holds a submitted/approved/rejected
// booking or its day is older than zeit_honorar.bearbeitbar_tage. Arrow keys
// move between cells (left/right only at the edge of the text).
// Footer: actual, target (contract, else the daily target — E-16/E-17) and the
// difference per day; absences follow with phase 82.
//
// In:  props zh (page loader), zz (useZeiterfassung). Out: the grid, the
//      "add row" dialog and the week submit (with confirmation).

import React from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock, Plus, Send, Copy } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { datumText, isoWoche, plusTage, wochenTage } from "@core/lib/kalender/datum.js";
import { ableiten, bearbeitbar, parseDauer, statusWechsel, ZEIT_STATUS_LABELS } from "@/lib/zeit/zeitbuchung.js";
import { sollIst, uebernimmVorwoche, wochenMatrix, wochenStatus, zeilenSchluessel } from "@/lib/zeit/zeitAnsicht.js";
import { FEHLER, KARTE, LEERES_ZIEL, stundenText, ZielFelder, zielText } from "./zeitGemeinsam.jsx";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ZELLE = "h-8 w-16 rounded border px-1 text-right text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-slate-900";

/**
 * Week grid with footer and actions.
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung}} props
 * @returns {React.ReactElement}
 */
export default function WochenRaster({ zh, zz }) {
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();
  const [kw, setKw] = React.useState(() => /** @type {{jahr: number, woche: number}} */ (isoWoche(zh.heute)));
  /** rows added by hand / "Wie Vorwoche" that carry no booking yet, per person and week */
  const [extra, setExtra] = React.useState(/** @type {Record<string, any[]>} */ ({}));
  const [eingaben, setEingaben] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [dialog, setDialog] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Cells being saved: Enter saves and moves the focus, and the blur of that move
  // must not save the same text a second time (it would create a duplicate draft
  // before the first write has reloaded the data).
  const laufend = React.useRef(new Set());

  const buchungen = zh.daten.Zeitbuchung;
  const matrix = React.useMemo(() => wochenMatrix(buchungen, { mitarbeiterId: zz.personId, jahr: kw.jahr, woche: kw.woche }), [buchungen, zz.personId, kw]);
  const extraKey = `${zz.personId}|${kw.jahr}-${kw.woche}`;
  const zeilen = React.useMemo(() => {
    const vorhanden = new Set(matrix.zeilen.map((z) => z.schluessel));
    const neu = (extra[extraKey] || []).filter((z) => !vorhanden.has(z.schluessel))
      .map((z) => ({ ...z, tage: [0, 0, 0, 0, 0, 0, 0], buchungen: [[], [], [], [], [], [], []] }));
    return [...matrix.zeilen, ...neu];
  }, [matrix, extra, extraKey]);
  const projektNamen = React.useMemo(() => new Map(zh.projekte.map((p) => [p.id, p.name])), [zh.projekte]);
  const tage = matrix.tage;
  const feiertage = React.useMemo(() => new Map(zz.feiertage.map((f) => [f.datum, f.name])), [zz.feiertage]);
  const vertrag = zz.vertragAm(zz.personId, tage[0]);
  // 82-04: approved absences of the person lower the target; the day shows "abwesend" (never the kind, E-14).
  const eigeneAbwesenheiten = (zz.abwesenheiten || []).filter((a) => a.mitarbeiter_id === zz.personId);
  const si = sollIst(kw, { vertrag, feiertage: zz.feiertage, tagessollMinuten: zz.regeln.tagessoll, istMinuten: matrix.tagesSummen, abwesenheiten: eigeneAbwesenheiten });
  const abwesendeTageMitBuchung = si.tage.filter((d, i) => d.abwesend && (Number(matrix.tagesSummen[i]) || 0) > 0).map((d) => d.datum);
  const wocheBuchungen = (buchungen || []).filter((b) => b.mitarbeiter_id === zz.personId && tage.includes(b.datum));
  const status = wochenStatus(wocheBuchungen);
  const entwuerfe = wocheBuchungen.filter((b) => (b.status || "entwurf") === "entwurf" && Number(b.minuten) > 0);

  const zellKey = (/** @type {string} */ s, /** @type {number} */ i) => `${s}#${i}`;

  /**
   * Why a cell cannot be edited, or null.
   * @param {any} zeile
   * @param {number} i weekday index
   * @returns {string|null}
   */
  const sperrGrund = (zeile, i) => {
    const fremd = zeile.buchungen[i].find((b) => (b.status || "entwurf") !== "entwurf");
    if (fremd) {
      if (fremd.status === "abgelehnt") return `${t("Abgelehnt")}: ${fremd.ablehnung_grund || ""} — ${t("in der Tagesansicht korrigieren")}`;
      return t(/** @type {any} */ (ZEIT_STATUS_LABELS)[fremd.status] || fremd.status);
    }
    if (!bearbeitbar({ status: "entwurf", datum: tage[i] }, zh.heute, { bearbeitbarTage: zz.regeln.bearbeitbarTage })) {
      return t("Älter als {n} Tage — nur noch über die Freigabe korrigierbar").replace("{n}", String(zz.regeln.bearbeitbarTage));
    }
    return null;
  };

  const speichereZelle = async (/** @type {any} */ zeile, /** @type {number} */ i) => {
    const key = zellKey(zeile.schluessel, i);
    const text = eingaben[key];
    if (text === undefined || laufend.current.has(key)) return;
    laufend.current.add(key);
    try {
      await speichereZelleEinmal(zeile, i, key, text);
    } finally {
      laufend.current.delete(key);
    }
  };

  const speichereZelleEinmal = async (/** @type {any} */ zeile, /** @type {number} */ i, /** @type {string} */ key, /** @type {string} */ text) => {
    const r = /** @type {any} */ (text.trim() === "" ? { ok: true, minuten: 0 } : parseDauer(text, zz.regeln.raster));
    if (!r.ok) {
      const meldung = r.fehler === "raster"
        ? t("Nur Vielfache von {n} min").replace("{n}", String(zz.regeln.raster))
        : t("Bitte als Stunden eingeben, z. B. 1,5 oder 1:30");
      setFehler((f) => ({ ...f, [key]: meldung }));
      return;
    }
    setFehler((f) => { const n = { ...f }; delete n[key]; return n; });
    setEingaben((e) => { const n = { ...e }; delete n[key]; return n; });
    const minuten = /** @type {number} */ (r.minuten);
    if (minuten === zeile.tage[i]) return;
    const entwuerfeZelle = zeile.buchungen[i].filter((/** @type {any} */ b) => (b.status || "entwurf") === "entwurf");
    /** @type {Array<any>} */
    const aufgaben = [];
    if (minuten === 0) {
      for (const b of entwuerfeZelle) aufgaben.push({ art: "loeschen", entitaet: "Zeitbuchung", id: b.id });
    } else if (entwuerfeZelle.length) {
      aufgaben.push({ art: "speichern", entitaet: "Zeitbuchung", obj: { ...entwuerfeZelle[0], minuten } });
      for (const b of entwuerfeZelle.slice(1)) aufgaben.push({ art: "loeschen", entitaet: "Zeitbuchung", id: b.id });
    } else {
      aufgaben.push({
        art: "speichern", entitaet: "Zeitbuchung",
        obj: neueBuchung(zeile, tage[i], minuten),
      });
    }
    try {
      await zh.schreibeStapel(aufgaben.map((a) => (a.art === "speichern" ? { ...a, obj: ableiten(a.obj) } : a)));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  /**
   * A new draft booking of the chosen person on a target and day.
   * @param {any} zeile target descriptor
   * @param {string} datum 'YYYY-MM-DD'
   * @param {number} minuten
   * @returns {Record<string, any>}
   */
  const neueBuchung = (zeile, datum, minuten) => ({
    mitarbeiter_id: zz.personId, project_id: zeile.project_id, lph: zeile.lph, leistung: zeile.leistung,
    kategorie_intern: zeile.kategorie_intern, honorarnachtrag_id: zeile.honorarnachtrag_id,
    datum, minuten, notiz: "", status: "entwurf", quelle: "manuell",
  });

  const bewege = (/** @type {number} */ r, /** @type {number} */ c) => {
    const ziel = /** @type {HTMLInputElement|null} */ (document.querySelector(`[data-zelle="${r}-${c}"]`));
    if (ziel) { ziel.focus(); ziel.select(); }
  };

  const tastatur = (/** @type {React.KeyboardEvent<HTMLInputElement>} */ e, /** @type {any} */ zeile, /** @type {number} */ r, /** @type {number} */ c) => {
    const el = e.currentTarget;
    if (e.key === "Enter") { e.preventDefault(); speichereZelle(zeile, c); bewege(r + 1, c); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); bewege(r + 1, c); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); bewege(r - 1, c); return; }
    if (e.key === "ArrowRight" && el.selectionStart === el.value.length) { e.preventDefault(); bewege(r, c + 1); return; }
    if (e.key === "ArrowLeft" && el.selectionEnd === 0) { e.preventDefault(); bewege(r, c - 1); }
  };

  const zeileHinzufuegen = (/** @type {any} */ ziel) => {
    const schluessel = zeilenSchluessel(ziel);
    setExtra((x) => ({ ...x, [extraKey]: [...(x[extraKey] || []).filter((z) => z.schluessel !== schluessel), { ...ziel, schluessel }] }));
    setDialog(false);
  };

  const wieVorwoche = () => {
    const vor = uebernimmVorwoche(buchungen, { mitarbeiterId: zz.personId, jahr: kw.jahr, woche: kw.woche });
    if (!vor.length) { toast.info(t("Die Vorwoche hat keine Buchungen.")); return; }
    setExtra((x) => {
      const bisher = x[extraKey] || [];
      const neu = vor.filter((z) => !bisher.some((b) => b.schluessel === z.schluessel));
      return { ...x, [extraKey]: [...bisher, ...neu] };
    });
  };

  const einreichen = async () => {
    if (!entwuerfe.length) return;
    const summe = entwuerfe.reduce((s, b) => s + (Number(b.minuten) || 0), 0);
    const ok = await bestaetige({
      titel: t("Woche einreichen?"),
      text: t("{n} Buchungen mit {h} h werden eingereicht und sind danach gesperrt.").replace("{n}", String(entwuerfe.length)).replace("{h}", stundenText(summe, lang) || "0"),
      bestaetigen: t("Einreichen"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const jetztIso = new Date().toISOString();
      const aufgaben = [];
      for (const b of entwuerfe) {
        const r = statusWechsel(b, "eingereicht", { jetztIso });
        if (r.ok) aufgaben.push({ art: /** @type {const} */ ("speichern"), entitaet: "Zeitbuchung", obj: r.buchung });
      }
      await zh.schreibeStapel(aufgaben);
      toast.success(t("Woche eingereicht"));
    } catch (err) {
      toast.error(`${t("Einreichen fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const verschiebe = (/** @type {number} */ wochen) => {
    const montag = /** @type {string} */ (plusTage(wochenTage(kw.jahr, kw.woche)[0], wochen * 7));
    setKw(/** @type {any} */ (isoWoche(montag)));
    setEingaben({});
    setFehler({});
  };

  return (
    <div className="space-y-4" data-testid="zeit-woche">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => verschiebe(-1)} aria-label={t("Vorige Woche")}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <span className="text-sm font-medium tabular-nums" data-testid="zeit-kw">
          {t("KW")} {kw.woche} · {datumText(tage[0], lang)} – {datumText(tage[6], lang)}
        </span>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => verschiebe(1)} aria-label={t("Nächste Woche")}>
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => { setKw(/** @type {any} */ (isoWoche(zh.heute))); setEingaben({}); }}>
          {t("Heute")}
        </button>
        <span className="ml-auto text-xs text-slate-600 dark:text-slate-300" data-testid="zeit-wochenstatus">
          {t("Status")}: {status === "leer" ? t("keine Buchungen") : status === "gemischt" ? t("gemischt") : t(/** @type {any} */ (ZEIT_STATUS_LABELS)[status] || status)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("Projekt")} · {t("LPH")}</th>
              {tage.map((d, i) => (
                <th key={d} scope="col" className={`px-1 py-2 text-right font-medium ${i >= 5 ? "text-slate-400" : "text-slate-600 dark:text-slate-300"}`}>
                  <div>{t(WOCHENTAGE[i])} {d.slice(8, 10)}.{d.slice(5, 7)}.</div>
                  {feiertage.has(d) && <div className="text-[10px] font-normal text-amber-700 dark:text-amber-300">{t("Feiertag")}</div>}
                  {si.tage[i]?.abwesend && <div className="rounded bg-slate-200 text-[10px] font-normal text-slate-700 dark:bg-slate-700 dark:text-slate-200" data-testid="zeit-abwesend">{t("abwesend")}</div>}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t("Summe")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {zeilen.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">{t("Noch keine Zeile in dieser Woche — „Zeile hinzufügen“ oder „Wie Vorwoche“.")}</td></tr>
            )}
            {zeilen.map((zeile, r) => (
              <tr key={zeile.schluessel} data-testid="zeit-zeile">
                <th scope="row" className="px-3 py-1 text-left font-normal text-slate-700 dark:text-slate-200">{zielText(zeile, projektNamen, t)}</th>
                {tage.map((d, c) => {
                  const key = zellKey(zeile.schluessel, c);
                  const grund = sperrGrund(zeile, c);
                  const st = zeile.buchungen[c][0]?.status;
                  const farbe = st === "freigegeben" ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950" : st === "eingereicht" ? "bg-sky-50 border-sky-200 dark:bg-sky-950" : st === "abgelehnt" ? "border-red-400" : "bg-white border-slate-300";
                  const tagName = `${t(WOCHENTAGE[c])} ${datumText(d, lang)}`;
                  return (
                    <td key={d} className="px-1 py-1 text-right align-top">
                      <div className="inline-flex items-center gap-1" title={grund || undefined}>
                        {grund && <Lock className="h-3 w-3 text-slate-400" aria-hidden="true" />}
                        <input
                          className={`${ZELLE} ${farbe}`}
                          data-zelle={`${r}-${c}`}
                          inputMode="decimal"
                          aria-label={`${tagName}, ${zielText(zeile, projektNamen, t)}`}
                          aria-invalid={fehler[key] ? true : undefined}
                          readOnly={Boolean(grund)}
                          value={eingaben[key] ?? stundenText(zeile.tage[c], lang)}
                          onChange={(e) => setEingaben((x) => ({ ...x, [key]: e.target.value }))}
                          onBlur={() => { if (!grund) speichereZelle(zeile, c); }}
                          onKeyDown={(e) => tastatur(e, zeile, r, c)}
                        />
                      </div>
                      {fehler[key] && <p className={`${FEHLER} text-xs`} role="alert">{fehler[key]}</p>}
                    </td>
                  );
                })}
                <td className="px-3 py-1 text-right tabular-nums font-medium">{stundenText(zeile.tage.reduce((a, b) => a + b, 0), lang) || "0"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-xs dark:bg-slate-800/60">
            <tr>
              <th scope="row" className="px-3 py-1 text-left font-medium">{t("Ist")}</th>
              {si.tage.map((d) => <td key={d.datum} className="px-1 py-1 text-right tabular-nums">{stundenText(d.ist, lang) || "0"}</td>)}
              <td className="px-3 py-1 text-right tabular-nums font-medium" data-testid="zeit-ist">{stundenText(si.ist, lang) || "0"}</td>
            </tr>
            <tr>
              <th scope="row" className="px-3 py-1 text-left font-medium">
                {t("Soll")} <span className="font-normal text-slate-500">({si.sollQuelle === "vertrag" ? t("Arbeitsvertrag") : t("Tagessoll")})</span>
              </th>
              {si.tage.map((d) => <td key={d.datum} className="px-1 py-1 text-right tabular-nums">{stundenText(d.soll, lang) || "0"}</td>)}
              <td className="px-3 py-1 text-right tabular-nums font-medium" data-testid="zeit-soll">{stundenText(si.soll, lang) || "0"}</td>
            </tr>
            <tr>
              <th scope="row" className="px-3 py-1 text-left font-medium">{t("Differenz")}</th>
              {si.tage.map((d) => <td key={d.datum} className={`px-1 py-1 text-right tabular-nums ${d.diff < 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{d.diff ? `${d.diff > 0 ? "+" : "−"}${stundenText(Math.abs(d.diff), lang)}` : "0"}</td>)}
              <td className="px-3 py-1 text-right tabular-nums font-medium">{si.diff ? `${si.diff > 0 ? "+" : "−"}${stundenText(Math.abs(si.diff), lang)}` : "0"}</td>
            </tr>
          </tfoot>
        </table>
        {abwesendeTageMitBuchung.length > 0 && (
          <p role="status" className="px-3 py-2 text-xs text-amber-800 dark:text-amber-200" data-testid="zeit-abwesend-warnung">
            {t("An diesem Tag ist eine Abwesenheit eingetragen")}: {abwesendeTageMitBuchung.map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`).join(", ")}
          </p>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("Abwesenheiten werden ab Phase 82 berücksichtigt.")}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => setDialog(true)}>
          <Plus aria-hidden="true" /> {t("Zeile hinzufügen")}
        </button>
        <button type="button" className={buttonVariants({ variant: "outline" })} onClick={wieVorwoche}>
          <Copy aria-hidden="true" /> {t("Wie Vorwoche")}
        </button>
        <button type="button" className={buttonVariants({ variant: "default" })} onClick={einreichen} disabled={busy || entwuerfe.length === 0}>
          <Send aria-hidden="true" /> {t("Woche einreichen")}
        </button>
      </div>

      {dialog && <ZeileDialog zh={zh} zz={zz} onAdd={zeileHinzufuegen} onClose={() => setDialog(false)} />}
    </div>
  );
}

/**
 * Dialog "Zeile hinzufügen": choose a target; the row appears empty in the grid.
 * @param {{zh: any, zz: import("./useZeiterfassung.js").Zeiterfassung, onAdd: (ziel: any) => void, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
function ZeileDialog({ zh, zz, onAdd, onClose }) {
  const { t } = useI18n();
  const [ziel, setZiel] = React.useState(() => ({ ...LEERES_ZIEL }));
  return (
    <FormModal title={t("Zeile hinzufügen")} onClose={onClose} schuetzen={false}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onAdd(ziel); }}>
        <ZielFelder wert={ziel} onChange={setZiel} idPraefix="zeile" projekte={zh.projekte} vertraege={zh.daten.Honorarvertrag}
          nachtraege={zh.daten.Honorarnachtrag} mitarbeiter={zz.personen} buchungen={zh.daten.Zeitbuchung}
          mitarbeiterId={zz.personId} heute={zh.heute} />
        <div className={`${KARTE} text-xs text-slate-600 dark:text-slate-300`}>{t("Die Zeile erscheint leer im Raster; gebucht wird mit der ersten Eingabe.")}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })}>{t("Hinzufügen")}</button>
        </div>
      </form>
    </FormModal>
  );
}
