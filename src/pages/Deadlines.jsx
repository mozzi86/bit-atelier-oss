// Fristen & Termine — every deadline and appointment of the office in one
// agenda (phase 82, FRIST-01…04): projects, own terms, warranties, taxes,
// personnel, contracts, offers, tenders, funding, absences and the mail
// register. Menu group "Übersicht" (E-02), spans all projects.
//
// The page loads through the source registry (ladeTermine): rights first —
// a source whose module the role may not read is not even loaded —, a failing
// source is reported in plain text while the other terms stay; acknowledging
// goes through the source (HR deadlines → 80's Fristquittung) or a
// Terminquittung. The route stays open in the cloud (E-03 does not name it);
// locked sources stand disabled with their reason in the filter.
//
// In:  ?tab=<key> (German aliases normalised, src/lib/termine/reiter.js). Out: the page.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { CalendarClock, CalendarDays, ListChecks, ShieldCheck } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { heuteLokal, plusTage } from "@core/lib/kalender/datum.js";
import { feiertage } from "@core/lib/kalender/feiertage.js";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";
import { useProject } from "@core/lib/ProjectContext";
import { projekteNachZugriff } from "@core/lib/rechte.js";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { BUERO_CLOUD_FREIGABE, DATENQUELLE } from "@core/lib/umgebung";
import { useTabParam } from "@core/lib/useTabParam";
import { useErlaubteReiter, useZugriff } from "@core/lib/ZugriffContext.jsx";
import { seitenWurzel } from "@core/lib/utils";
import { FRISTEN_REITER, REITER_ALIAS, REITER_SCHLUESSEL, STANDARD_REITER } from "@/lib/termine/reiter.js";
import { ladeTermine, quellenStatus, quittiereTermin, QUELLEN } from "@/lib/termine/quellenRegistry.js";
import { filterNachZugriff } from "@/lib/termine/termineAnsicht.js";
import { kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";
import { loescheBuero, speichereBuero } from "@/lib/bueroOrga/speicher.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/bueroOrga/BueroHuelle.jsx";
import Agenda from "@/components/termine/Agenda.jsx";
import QuellenFilter, { ladeQuellenWahl, speichereQuellenWahl } from "@/components/termine/QuellenFilter.jsx";
import MonatsRaster from "@/components/termine/MonatsRaster.jsx";
import GewaehrleistungReiter from "@/components/termine/GewaehrleistungReiter.jsx";
import TerminDialog from "@/components/termine/TerminDialog.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { ListChecks, CalendarDays, ShieldCheck };

/** Fills {key} placeholders after translation. */
const fuellen = (/** @type {string} */ text, /** @type {Record<string, any>} */ werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

export default function Deadlines() {
  const { t } = useI18n();
  const zugriff = useZugriff();
  const { user } = useAuth();
  const ctx = /** @type {any} */ (useProject());
  const { wert } = useRegelWerte(REGELWERKE);
  const erlaubt = useErlaubteReiter("fristen", REITER_SCHLUESSEL);
  const [tab, setTab] = useTabParam(erlaubt, STANDARD_REITER, { alias: REITER_ALIAS });

  const heute = heuteLokal();
  const agendaTage = Number(wert("fristen.agenda_tage")) || 90;
  const regelWert = useCallback((/** @type {string} */ id) => wert(id), [wert]);
  const einst = kalenderEinstellung(wert);
  const jahr = Number(heute.slice(0, 4));
  const feiertagListe = useMemo(() => [jahr - 1, jahr, jahr + 1].flatMap((j) => feiertage(j, einst)), [jahr, einst.bundesland, einst.mariae_himmelfahrt, einst.augsburger_friedensfest]); // eslint-disable-line react-hooks/exhaustive-deps
  const vorlauf = { frist: wert("fristen.vorlauf_frist_tage") || [30, 7, 1], termin: wert("fristen.vorlauf_termin_tage") || [7, 1], hinweis: wert("fristen.vorlauf_hinweis_tage") || [14] };

  const [aktiv, setAktiv] = useState(() => new Set(ladeQuellenWahl() || QUELLEN.filter((q) => q.standardAn).map((q) => q.key)));
  const [projektfilter, setProjektfilter] = useState(/** @type {'alle'|'aktiv'} */ ("alle"));
  const [nurFristen, setNurFristen] = useState(false);
  const [zustand, setZustand] = useState({ laedt: true, termine: /** @type {any[]} */ ([]), fehler: /** @type {Array<{quelle: string, meldung: string}>} */ ([]), abnahmen: /** @type {any[]} */ ([]), rohTermine: /** @type {any[]} */ ([]) });
  const [dialog, setDialog] = useState(/** @type {{termin: any}|null} */ (null));
  const [neu, setNeu] = useState(0);

  const kontext = useMemo(() => ({
    von: /** @type {string} */ (plusTage(heute, -365)), bis: /** @type {string} */ (plusTage(heute, Math.max(agendaTage, 400))), heute, regelWert,
    feiertage: feiertagListe, kalender: einst, projectId: projektfilter === "aktiv" ? ctx.projectId : null, zugriff,
    datenquelle: DATENQUELLE, freigabe: BUERO_CLOUD_FREIGABE, rolle: user?.role ?? null,
  }), [heute, agendaTage, regelWert, feiertagListe, projektfilter, ctx.projectId, zugriff, user?.role]);
  const status = useMemo(() => quellenStatus(kontext), [kontext]);

  useEffect(() => {
    let aktuell = true;
    setZustand((z) => ({ ...z, laedt: true }));
    (async () => {
      const [r, abnahmen, roh] = await Promise.all([
        ladeTermine(bitApi, { ...kontext, aktiveQuellen: [...aktiv] }),
        (async () => { try { return (await /** @type {any} */ (bitApi.entities).Abnahme.list()) || []; } catch { return []; } })(),
        (async () => { try { return (await /** @type {any} */ (bitApi.entities).Termin.list()) || []; } catch { return []; } })(),
      ]);
      if (aktuell) setZustand({ laedt: false, termine: r.termine, fehler: r.fehler, abnahmen, rohTermine: roh });
    })().catch((fehler) => {
      if (aktuell) setZustand((z) => ({ ...z, laedt: false, fehler: [{ quelle: "", meldung: String(fehler?.message || fehler) }] }));
    });
    return () => { aktuell = false; };
  }, [kontext, aktiv, neu]);

  const projekte = projekteNachZugriff(/** @type {Array<{id: string, name?: string}>} */ (ctx.alleProjekte ?? ctx.projects ?? []), zugriff);
  const projektNamen = useMemo(() => new Map(projekte.map((p) => [p.id, p.name || p.id])), [projekte]);
  const sichtbar = filterNachZugriff(zustand.termine, zugriff).filter((x) => !nurFristen || x.klasse === "frist");
  const darfBearbeiten = zugriff.darf("fristen", "voll");
  const quelleLabel = (/** @type {string} */ key) => t(QUELLEN.find((q) => q.key === key)?.label || key);

  const setzeAktiv = (/** @type {string} */ key, /** @type {boolean} */ an) => setAktiv((alt) => {
    const neuSet = new Set(alt);
    if (an) neuSet.add(key); else neuSet.delete(key);
    speichereQuellenWahl([...neuSet]);
    return neuSet;
  });
  const erledigt = async (/** @type {any} */ termin) => {
    const r = await mitRueckmeldung(() => quittiereTermin(bitApi, termin, { jetzt: heute, nutzerId: zugriff.nutzer?.id ?? null }), { erfolg: t("Als erledigt vermerkt"), fehler: t("Konnte nicht als erledigt vermerkt werden") });
    if (r.ok) setNeu((n) => n + 1);
  };
  const speichereTermin = async (/** @type {Record<string, any>} */ obj) => {
    const r = await mitRueckmeldung(() => speichereBuero(bitApi, "Termin", obj, { datenquelle: DATENQUELLE }), { erfolg: t("Termin gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (r.ok) { setDialog(null); setNeu((n) => n + 1); }
  };
  const loescheTermin = async (/** @type {string} */ id) => {
    const r = await mitRueckmeldung(() => loescheBuero(bitApi, "Termin", id, { datenquelle: DATENQUELLE }), { erfolg: t("Termin gelöscht"), fehler: t("Löschen fehlgeschlagen") });
    if (r.ok) { setDialog(null); setNeu((n) => n + 1); }
  };
  const speichereAbnahme = async (/** @type {Record<string, any>} */ obj) => {
    const r = await mitRueckmeldung(() => speichereBuero(bitApi, "Abnahme", obj, { datenquelle: DATENQUELLE }), { erfolg: t("Abnahme gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (r.ok) setNeu((n) => n + 1);
    return r.ok;
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <CalendarClock className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Fristen & Termine")}
          </h1>
          <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Alle Fristen und Termine aus Projekten, Verträgen, Buchhaltung, Personal und Postbuch.")}</p>
          <p className="text-sm text-slate-500 mt-1 dark:text-slate-400" data-testid="fristen-ehrlichkeit">{t("Erinnerungen erscheinen nur bei geöffneter App – für Outlook als .ics exportieren.")}</p>
        </div>
        <QuellenFilter status={status} aktiv={aktiv} onAktiv={setzeAktiv} projektfilter={projektfilter} onProjektfilter={setProjektfilter}
          nurFristen={nurFristen} onNurFristen={setNurFristen} hatProjekt={Boolean(ctx.projectId)} zeigeRegelLink={zugriff.darf("einstellungen", "lesen")} />
        {zustand.laedt && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{t("Termine werden geladen …")}</p>}
        {zustand.fehler.map((f) => (
          <p key={f.quelle + f.meldung} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{fuellen(t("Termine aus {quelle} konnten nicht geladen werden: {meldung}"), { quelle: quelleLabel(f.quelle), meldung: f.meldung })}</p>
        ))}
        <Tabs value={tab} onValueChange={setTab} activationMode="manual">
          <TabsList aria-label={t("Bereiche von Fristen & Termine")} className={TAB_LISTE}>
            {FRISTEN_REITER.filter((r) => erlaubt.includes(r.key)).map((r) => {
              const Icon = /** @type {Record<string, any>} */ (ICONS)[r.icon];
              return <TabsTrigger key={r.key} value={r.key} className={TAB_AUSLOESER}>{Icon && <Icon className="h-4 w-4" aria-hidden="true" />} {t(r.label)}</TabsTrigger>;
            })}
          </TabsList>
          <TabsContent value="agenda" className={TAB_INHALT}>
            <ModulFehlergrenze key={tab} pfad={"/Deadlines?tab=" + tab}>
              <Agenda termine={sichtbar} heute={heute} agendaTage={agendaTage} vorlauf={vorlauf} projektNamen={projektNamen} onErledigt={erledigt}
                darfBearbeiten={darfBearbeiten} onNeu={() => setDialog({ termin: null })}
                onBearbeiten={(x) => setDialog({ termin: zustand.rohTermine.find((r) => r.id === x.datensatz_id) || null })} />
            </ModulFehlergrenze>
          </TabsContent>
          <TabsContent value="month" className={TAB_INHALT}>
            <ModulFehlergrenze key={tab} pfad={"/Deadlines?tab=" + tab}>
              <MonatsRaster termine={sichtbar} heute={heute} feiertage={feiertagListe} projektNamen={projektNamen} />
            </ModulFehlergrenze>
          </TabsContent>
          <TabsContent value="warranty" className={TAB_INHALT}>
            <ModulFehlergrenze key={tab} pfad={"/Deadlines?tab=" + tab}>
              <GewaehrleistungReiter abnahmen={zustand.abnahmen} regelWert={regelWert} projekte={projekte} darfBearbeiten={darfBearbeiten} onSpeichern={speichereAbnahme} />
            </ModulFehlergrenze>
          </TabsContent>
        </Tabs>
        {dialog && <TerminDialog termin={dialog.termin} projekte={projekte} heute={heute} projektVorwahl={ctx.projectId} onClose={() => setDialog(null)} onSpeichern={speichereTermin} onLoeschen={loescheTermin} />}
      </div>
    </div>
  );
}
