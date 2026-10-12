// Abwesenheiten — leave, sickness and training of the office (phase 82):
// team calendar, requests, leave account and public holidays. Menu group
// "Büro" right after "Personal" (E-02), spans all projects.
//
// 82-01 built the shell; 82-04 fills the tabs. In a locked cloud build the page
// shows only the cloud card and reads nothing (E-03; the absences live in the
// personnel storage class anyway, which stays local). Absences, persons,
// contracts and acknowledgements come only through 82-01's adapter
// (bueroOrgaPersonal.js); persons are read through 81's personalQuelle (with the
// virtual owner when there is no person record — the sole-owner path, E-17).
// Rights (82-02): the team calendar never shows reasons; the kind appears in
// the request list and the balance only with personnel rights or for the own entry.
//
// In:  ?tab=<key> (German aliases normalised, src/lib/abwesenheit/reiter.js). Out: the page.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { CalendarCheck, ClipboardList, Sun, TreePalm, Users } from "lucide-react";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { feiertage } from "@core/lib/kalender/feiertage.js";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";
import { cloudGesperrt } from "@core/lib/rechte.js";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { useTabParam } from "@core/lib/useTabParam";
import { useErlaubteReiter, useZugriff } from "@core/lib/ZugriffContext.jsx";
import { seitenWurzel } from "@core/lib/utils";
import { ABWESENHEIT_REITER, REITER_ALIAS, REITER_SCHLUESSEL, STANDARD_REITER } from "@/lib/abwesenheit/reiter.js";
import { abwesenheitStatusWechsel } from "@/lib/abwesenheit/abwesenheit.js";
import { kuerzelVon, teamRaster } from "@/lib/abwesenheit/abwesenheitAnsicht.js";
import { darfEntscheiden, sichtbareAntraege, sichtbarePersonen } from "@/lib/abwesenheit/abwesenheitRechte.js";
import { kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";
import { urlaubskonto, verbrauch } from "@/lib/abwesenheit/urlaubskonto.js";
import { ladeAbwesenheitsDaten, speichereAbwesenheit } from "@/lib/people/bueroOrgaPersonal.js";
import { aktiverVertrag } from "@/lib/people/vertrag.js";
import { INHABER_ID, personAnzeigeName, personenFuerZeiterfassung } from "@/lib/zeit/personalQuelle.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { BueroCloudKarte, BueroLadeFehler, TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/bueroOrga/BueroHuelle.jsx";
import TeamKalender from "@/components/abwesenheit/TeamKalender.jsx";
import AntragsListe from "@/components/abwesenheit/AntragsListe.jsx";
import AntragDialog from "@/components/abwesenheit/AntragDialog.jsx";
import UrlaubsKonto from "@/components/abwesenheit/UrlaubsKonto.jsx";
import FeiertageReiter from "@/components/abwesenheit/FeiertageReiter.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { Users, ClipboardList, CalendarCheck, Sun };

export default function Absences() {
  const { t } = useI18n();
  const erlaubt = useErlaubteReiter("abwesenheiten", REITER_SCHLUESSEL);
  const [tab, setTab] = useTabParam(erlaubt, STANDARD_REITER, { alias: REITER_ALIAS });
  const gesperrt = cloudGesperrt("abwesenheiten", DATENQUELLE);
  const zugriff = useZugriff();
  const { user } = useAuth();
  const { wert } = useRegelWerte(REGELWERKE);
  const heute = heuteLokal();
  const [monat, setMonat] = useState(() => ({ jahr: Number(heute.slice(0, 4)), monat: Number(heute.slice(5, 7)) }));
  const [jahr, setJahr] = useState(Number(heute.slice(0, 4)));
  const [dialog, setDialog] = useState(false);
  const [zustand, setZustand] = useState(() => ({ laedt: !gesperrt, fehler: "", abwesenheiten: /** @type {any[]} */ ([]), mitarbeiter: /** @type {any[]} */ ([]), vertraege: /** @type {any[]} */ ([]), fristquittungen: /** @type {any[]} */ ([]) }));

  const laden = useCallback(async () => {
    if (gesperrt) return;
    const d = await ladeAbwesenheitsDaten({ datenquelle: DATENQUELLE, rolle: user?.role ?? null });
    setZustand({ laedt: false, fehler: d.fehler || "", abwesenheiten: d.abwesenheiten, mitarbeiter: d.mitarbeiter, vertraege: d.vertraege, fristquittungen: d.fristquittungen });
  }, [gesperrt, user?.role]);
  useEffect(() => { laden(); }, [laden]);

  const einst = useMemo(() => kalenderEinstellung(wert), [wert]);
  const feiertageFuer = useCallback((/** @type {number} */ j) => feiertage(j, einst), [einst]);
  const zuordnungen = zugriff.zuordnungen || [];
  const personenRoh = useMemo(() => personenFuerZeiterfassung(zustand.mitarbeiter, heute), [zustand.mitarbeiter, heute]);
  const personen = useMemo(() => /** @type {Array<Record<string, any> & {id: string, kuerzel: string, name: string}>} */ (personenRoh.map((/** @type {any} */ p) => ({ ...p, kuerzel: kuerzelVon(p, zugriff.nutzerListe || []) || (p.id === INHABER_ID ? "IN" : "?"), name: personAnzeigeName(p, t) }))), [personenRoh, zugriff.nutzerListe, t]);
  const kuerzel = (/** @type {string} */ id) => personen.find((p) => p.id === id)?.kuerzel || id;
  const hs = wert("kalender.heiligabend_silvester") || "arbeitstag";
  const tageFuer = (/** @type {Record<string, any>} */ a) => {
    const v = aktiverVertrag(zustand.vertraege, a.mitarbeiter_id, a.von);
    return Object.values(verbrauch(a, { arbeitstageWoche: v?.arbeitstage_woche ?? 5, feiertageFuer, heiligabendSilvester: hs })).reduce((s, n) => s + n, 0);
  };
  const kontoFuer = (/** @type {Record<string, any>} */ p, /** @type {number} */ j) => urlaubskonto({
    mitarbeiter: p, vertraege: zustand.vertraege, abwesenheiten: zustand.abwesenheiten, fristquittungen: zustand.fristquittungen, jahr: j, heute, feiertageFuer, regelWert: wert,
  });

  // Rights: who records for whom.
  const personalRecht = zugriff.darf("personal", "voll") || zugriff.rolle === "inhaber";
  const eigeneId = zugriff.mitarbeiterId || (zugriff.rolle === "inhaber" ? (personen.find((p) => p.art === "inhaber")?.id ?? null) : null);
  const nurEigene = !personalRecht;
  const darfNeu = zugriff.darf("abwesenheiten", "voll") && (!nurEigene || Boolean(eigeneId));

  const raster = useMemo(() => teamRaster(sichtbarePersonen(personen, zugriff, zuordnungen), zustand.abwesenheiten, monat.jahr, monat.monat, feiertageFuer(monat.jahr), { nutzer: zugriff.nutzerListe || [] }),
    [personen, zugriff, zuordnungen, zustand.abwesenheiten, monat, feiertageFuer]);
  const antraege = sichtbareAntraege(zustand.abwesenheiten, zugriff, zuordnungen);
  const kontoPersonen = personalRecht ? personen : personen.filter((p) => p.id === eigeneId);
  const konten = kontoPersonen.map((p) => ({ person: p, konto: kontoFuer(p, jahr) }));

  const speichern = async (/** @type {Record<string, any>} */ obj) => {
    const mitEntscheidung = obj.status === "genehmigt" ? { ...obj, entschieden_von: zugriff.nutzer?.id ?? null, entschieden_am: heute } : obj;
    const r = await mitRueckmeldung(() => speichereAbwesenheit(mitEntscheidung), { erfolg: t("Abwesenheit gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (r.ok) await laden();
    return r.ok;
  };
  const statusSetzen = async (/** @type {Record<string, any>} */ a, /** @type {'genehmigt'|'abgelehnt'|'storniert'} */ ziel) => {
    const w = abwesenheitStatusWechsel(a, ziel, { von: zugriff.nutzer?.id ?? null, amIso: heute });
    if (!w.ok) return;
    const r = await mitRueckmeldung(() => speichereAbwesenheit(/** @type {any} */ (w).abwesenheit), { erfolg: t("Abwesenheit gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (r.ok) await laden();
  };
  const wechsleMonat = (/** @type {number} */ delta) => setMonat((m) => {
    const n = m.monat + delta;
    return n < 1 ? { jahr: m.jahr - 1, monat: 12 } : n > 12 ? { jahr: m.jahr + 1, monat: 1 } : { jahr: m.jahr, monat: n };
  });

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <TreePalm className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Abwesenheiten")}
          </h1>
          <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Urlaub, Krankheit und Fortbildung – Gründe sieht nur, wer Personal verwalten darf.")}</p>
        </div>
        {gesperrt ? <BueroCloudKarte /> : zustand.fehler ? <BueroLadeFehler fehler={zustand.fehler} onRetry={laden} /> : (
          <Tabs value={tab} onValueChange={setTab} activationMode="manual">
            <TabsList aria-label={t("Bereiche der Abwesenheiten")} className={TAB_LISTE}>
              {ABWESENHEIT_REITER.filter((r) => erlaubt.includes(r.key)).map((r) => {
                const Icon = /** @type {Record<string, any>} */ (ICONS)[r.icon];
                return <TabsTrigger key={r.key} value={r.key} className={TAB_AUSLOESER}>{Icon && <Icon className="h-4 w-4" aria-hidden="true" />} {t(r.label)}</TabsTrigger>;
              })}
            </TabsList>
            {zustand.laedt ? <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">{t("Wird geladen …")}</p> : (
              <>
                <TabsContent value="team" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Absences?tab=" + tab}><TeamKalender raster={raster} jahr={monat.jahr} monat={monat.monat} onMonat={wechsleMonat} /></ModulFehlergrenze>
                </TabsContent>
                <TabsContent value="requests" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Absences?tab=" + tab}>
                    <AntragsListe antraege={antraege} alle={zustand.abwesenheiten} zugriff={zugriff} kuerzel={kuerzel} maxGleichzeitig={Number(wert("kalender.max_gleichzeitig_abwesend")) || 2}
                      darfEntscheiden={(a) => darfEntscheiden(zugriff, a, zuordnungen)} darfStornieren={(a) => a.mitarbeiter_id === eigeneId || darfEntscheiden(zugriff, a, zuordnungen)}
                      darfNeu={darfNeu} onNeu={() => setDialog(true)} onStatus={statusSetzen} />
                  </ModulFehlergrenze>
                </TabsContent>
                <TabsContent value="balance" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Absences?tab=" + tab}><UrlaubsKonto konten={konten} jahr={jahr} onJahr={setJahr} /></ModulFehlergrenze>
                </TabsContent>
                <TabsContent value="holidays" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Absences?tab=" + tab}>
                    <FeiertageReiter jahr={jahr} einst={einst} kalkulationTage={Number(wert("zeit_honorar.feiertage")) || 0} onJahr={setJahr} />
                  </ModulFehlergrenze>
                </TabsContent>
              </>
            )}
          </Tabs>
        )}
      </div>
      {dialog && (
        <AntragDialog personen={personen} eigeneId={eigeneId} nurEigene={nurEigene} darfBetriebsruhe={zugriff.rolle === "inhaber"}
          abwesenheiten={zustand.abwesenheiten} heute={heute} maxGleichzeitig={Number(wert("kalender.max_gleichzeitig_abwesend")) || 2}
          tageFuer={tageFuer} restFuer={(id) => { const p = personen.find((x) => x.id === id); return p ? kontoFuer(p, Number(heute.slice(0, 4))).rest : null; }}
          onSpeichern={speichern} onClose={() => setDialog(false)} />
      )}
    </div>
  );
}
