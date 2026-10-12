// Schriftverkehr — letters from templates and the mail register of the office
// (phase 82): letters, register (incoming/outgoing) and templates. Menu group
// "Büro" right after "Adressbuch" (E-02), spans all projects.
//
// 82-01 built the shell; 82-05 fills the tabs. In a locked cloud build the page
// shows only the cloud card and reads nothing (E-03). Letters, templates and
// register entries are read and written only through the office store
// (bueroEntitaet / speichereBuero / loescheBuero, 82-01). The deep link
// /Correspondence?neu=<vorlage>&bezug=<typ>:<id>[&stufe=<n>] (deepLink.js) opens
// a prefilled draft; the data of the reference come through the stores of 79/81.
// Rights: sicht.js on the access of ZugriffContext (owner fallback without 82-02, E-17).
//
// In:  ?tab=<key> (German aliases normalised), ?neu/bezug/stufe. Out: the page.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Inbox, LayoutTemplate, Mail, PenLine } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useI18n } from "@core/lib/i18n";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";
import { useProject } from "@core/lib/ProjectContext";
import { cloudGesperrt, projekteNachZugriff } from "@core/lib/rechte.js";
import { inhaltLaden } from "@core/lib/speicherOrt";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { useBriefkopf } from "@core/lib/useBriefkopf";
import { useTabParam } from "@core/lib/useTabParam";
import { useErlaubteReiter, useZugriff } from "@core/lib/ZugriffContext.jsx";
import { seitenWurzel } from "@core/lib/utils";
import { fuellePlatzhalter } from "@core/lib/brief/platzhalter.js";
import { dateiIdAus } from "@core/lib/brief/schreiben.js";
import { alleVorlagen, mitBueroFassung } from "@core/lib/brief/vorlagen.js";
import { REITER_ALIAS, REITER_SCHLUESSEL, SCHRIFT_REITER, STANDARD_REITER } from "@/lib/schriftverkehr/reiter.js";
import { ladeBueroOrga, loescheBuero, speichereBuero } from "@/lib/bueroOrga/speicher.js";
import { leseDeepLink } from "@/lib/schriftverkehr/deepLink.js";
import { ladeBezugDaten, neuerEntwurf } from "@/lib/schriftverkehr/bezugLaden.js";
import { dateiname, festschreibenUndAblegen, posteingangSpeichern, postbuchLoeschbar, schreibenPdf, versendetMarkieren } from "@/lib/schriftverkehr/aktionen.js";
import { bereicheFuer, darfVorlagenPflegen, sichtbareEintraege } from "@/lib/schriftverkehr/sicht.js";
import { vorlageTitel } from "@/lib/schriftverkehr/vorlagenTitel.js";
import { MUSTER_EMPFAENGER, musterDaten } from "@/lib/schriftverkehr/musterdaten.js";
import { BueroCloudKarte, BueroLadeFehler, TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/bueroOrga/BueroHuelle.jsx";
import SchreibenListe from "@/components/schriftverkehr/SchreibenListe.jsx";
import SchreibenEditor from "@/components/schriftverkehr/SchreibenEditor.jsx";
import PostbuchReiter from "@/components/schriftverkehr/PostbuchReiter.jsx";
import PostDialog from "@/components/schriftverkehr/PostDialog.jsx";
import VorlagenReiter from "@/components/schriftverkehr/VorlagenReiter.jsx";
import VorlagenEditor from "@/components/schriftverkehr/VorlagenEditor.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { PenLine, Inbox, LayoutTemplate };

/** Collections of this page (all through the office store). */
const ENTITAETEN = Object.freeze(["Schreiben", "Briefvorlage", "Postbucheintrag", "Nutzer"]);

/**
 * Offers bytes or a data URL as a file download.
 * @param {Uint8Array|string} inhalt
 * @param {string} name
 */
function herunterladen(inhalt, name) {
  const url = typeof inhalt === "string" ? inhalt : URL.createObjectURL(new Blob([/** @type {BlobPart} */ (inhalt)], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof inhalt !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Correspondence() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const erlaubt = useErlaubteReiter("schriftverkehr", REITER_SCHLUESSEL);
  const [tab, setTab] = useTabParam(erlaubt, STANDARD_REITER, { alias: REITER_ALIAS });
  const gesperrt = cloudGesperrt("schriftverkehr", DATENQUELLE);
  const zugriff = useZugriff();
  const ctx = useProject();
  const { briefkopf } = useBriefkopf();
  const [suche, setSuche] = useSearchParams();
  const heute = heuteLokal();
  const kontext = { datenquelle: DATENQUELLE };

  const [zustand, setZustand] = useState(() => ({ laedt: !gesperrt, fehler: "", daten: /** @type {Record<string, any[]>} */ ({}), kontakte: /** @type {any[]} */ ([]) }));
  const [editor, setEditor] = useState(/** @type {{schreiben: Record<string, any>, hinweise: string[]}|null} */ (null));
  const [postDialog, setPostDialog] = useState(/** @type {{eintrag: Record<string, any>|null}|null} */ (null));
  const [vorlageOffen, setVorlageOffen] = useState(/** @type {Record<string, any>|null} */ (null));

  const laden = useCallback(async () => {
    if (gesperrt) return;
    try {
      const [{ daten }, kontakte] = await Promise.all([
        ladeBueroOrga(bitApi, { datenquelle: DATENQUELLE, entitaeten: ENTITAETEN }),
        /** @type {any} */ (bitApi).entities.Contact.list(),
      ]);
      setZustand({ laedt: false, fehler: "", daten, kontakte: Array.isArray(kontakte) ? kontakte : [] });
    } catch (fehler) {
      setZustand((z) => ({ ...z, laedt: false, fehler: /** @type {any} */ (fehler)?.message || String(fehler) }));
    }
  }, [gesperrt]);
  useEffect(() => { laden(); }, [laden]);

  const alleProjekte = /** @type {Array<{id: string, name?: string}>} */ (ctx.alleProjekte ?? ctx.projects ?? []);
  const projekte = projekteNachZugriff(alleProjekte, zugriff);
  const projektNamen = useMemo(() => new Map(alleProjekte.map((p) => [p.id, p.name || p.id])), [alleProjekte]);
  const nutzer = zustand.daten.Nutzer || [];
  const nutzerNamen = useMemo(() => new Map(nutzer.map((n) => [n.id, n.name || n.kuerzel || n.id])), [nutzer]);
  const vorlagen = useMemo(() => /** @type {Array<Record<string, any>>} */ (alleVorlagen().map((v) => ({ ...mitBueroFassung(v, zustand.daten.Briefvorlage || []), titel: vorlageTitel(v.key) }))), [zustand.daten.Briefvorlage]);
  const darfBearbeiten = zugriff.darf("schriftverkehr", "voll");
  const bereiche = bereicheFuer(zugriff);
  const darfPflegen = darfVorlagenPflegen(zugriff);
  const schreibenSichtbar = sichtbareEintraege(zustand.daten.Schreiben || [], zugriff);
  const postSichtbar = sichtbareEintraege(zustand.daten.Postbucheintrag || [], zugriff);
  const basisDaten = () => ({ heute, briefkopf, kontakte: zustand.kontakte, projekte: alleProjekte, postbuch: zustand.daten.Postbucheintrag || [] });
  const vorlageZu = (/** @type {string} */ key) => vorlagen.find((v) => v.key === key) || vorlagen.find((v) => v.key === "brief");

  /** Opens a prefilled draft for a template and a reference. */
  const oeffneEntwurf = async (/** @type {string} */ key, /** @type {any} */ bezug, /** @type {string[]} */ hinweiseVorab = []) => {
    let daten = /** @type {import("@core/lib/brief/schreiben.js").KontextDaten} */ (basisDaten());
    /** @type {string[]} */
    const hinweise = [...hinweiseVorab];
    try {
      daten = await ladeBezugDaten(bitApi, bezug, { ...basisDaten(), t });
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
    const r = neuerEntwurf(/** @type {any} */ (vorlageZu(key)), bezug, daten, { projectId: ctx.projectId || null });
    if (!bereiche.includes(r.entwurf.bereich)) r.entwurf.bereich = bereiche[0] || "projekt";
    setEditor({ schreiben: r.entwurf, hinweise: [...hinweise, ...r.hinweise] });
  };

  // Deep link from accounting, fees or reports — once per link, after the data are there.
  const verarbeitet = useRef("");
  useEffect(() => {
    if (zustand.laedt || gesperrt || !suche.get("neu")) return;
    const schluessel = suche.toString();
    if (verarbeitet.current === schluessel) return;
    verarbeitet.current = schluessel;
    const dl = leseDeepLink(suche, vorlagen.map((v) => v.key));
    setSuche((p) => { const n = new URLSearchParams(p); n.delete("neu"); n.delete("bezug"); n.delete("stufe"); n.set("tab", "letters"); return n; }, { replace: true });
    if (dl) oeffneEntwurf(dl.vorlageKey, dl.bezug, dl.hinweise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zustand.laedt, suche]);

  // --- letter actions ---
  const speichernEntwurf = async (/** @type {Record<string, any>} */ s) => {
    const r = await mitRueckmeldung(() => speichereBuero(bitApi, "Schreiben", s, kontext), { erfolg: t("Entwurf gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (!r.ok) return null;
    setEditor((e) => (e ? { ...e, schreiben: r.wert } : e));
    await laden();
    return r.wert;
  };
  const festschreiben = async (/** @type {Record<string, any>} */ s) => {
    const r = await mitRueckmeldung(() => festschreibenUndAblegen(bitApi, s, { briefkopf, jetzt: new Date().toISOString(), datenquelle: DATENQUELLE }),
      { erfolg: t("Festgeschrieben und abgelegt"), fehler: t("Festschreiben fehlgeschlagen") });
    if (!r.ok) return null;
    herunterladen(r.wert.bytes, dateiname(r.wert.schreiben));
    if (r.wert.hinweis) toast.info(r.wert.hinweis);
    setEditor((e) => (e ? { ...e, schreiben: r.wert.schreiben } : e));
    await laden();
    return r.wert.schreiben;
  };
  const versendet = async (/** @type {Record<string, any>} */ s, /** @type {string} */ versandweg) => {
    const r = await mitRueckmeldung(() => versendetMarkieren(bitApi, s, { heute, versandweg, datenquelle: DATENQUELLE }), { erfolg: t("Als versendet vermerkt"), fehler: t("Speichern fehlgeschlagen") });
    if (!r.ok) return null;
    if (r.wert.hinweis === "nummer_neu_vergeben") toast.info(t("Nummer neu vergeben: {nummer}").replace("{nummer}", r.wert.eintrag.nummer));
    setEditor((e) => (e ? { ...e, schreiben: r.wert.schreiben } : e));
    await laden();
    return r.wert.schreiben;
  };
  const loeschenEntwurf = async (/** @type {string} */ id) => {
    const r = await mitRueckmeldung(() => loescheBuero(bitApi, "Schreiben", id, kontext), { erfolg: t("Entwurf gelöscht"), fehler: t("Löschen fehlgeschlagen") });
    if (r.ok) { setEditor(null); await laden(); }
  };
  /** Stored PDF of a letter or a scan; a fixed letter without bytes (sample) is rebuilt from the frozen text. */
  const dokumentHerunterladen = async (/** @type {string} */ id, /** @type {string} */ name) => {
    const doc = await /** @type {any} */ (bitApi).entities.Document.get(id);
    const inhalt = await inhaltLaden(doc?.data ?? null, doc?.data_blob ?? null);
    if (!inhalt) throw new Error(t("Das Dokument enthält keine Datei."));
    herunterladen(String(inhalt), doc?.name || name);
  };
  const pdf = async (/** @type {Record<string, any>} */ s) => {
    await mitRueckmeldung(async () => {
      if (s.document_id) return dokumentHerunterladen(s.document_id, dateiname(s));
      const { bytes } = await schreibenPdf(s, { briefkopf, fixiert: { erstelltAm: s.festgeschrieben_am || new Date().toISOString(), dateiId: await dateiIdAus(s.id) } });
      herunterladen(bytes, dateiname(s));
    }, { fehler: t("PDF konnte nicht erzeugt werden") });
  };

  // --- register actions ---
  const postSpeichern = async (/** @type {Record<string, any>} */ e, /** @type {any} */ scan) => {
    const r = await mitRueckmeldung(() => posteingangSpeichern(bitApi, e, { datenquelle: DATENQUELLE, scan }), { erfolg: t("Posteingang gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (!r.ok) return false;
    if (r.wert.hinweis === "nummer_neu_vergeben") toast.info(t("Nummer neu vergeben: {nummer}").replace("{nummer}", r.wert.eintrag.nummer));
    await laden();
    return true;
  };
  const postErledigt = async (/** @type {Record<string, any>} */ e) => {
    const r = await mitRueckmeldung(() => speichereBuero(bitApi, "Postbucheintrag", { ...e, erledigt_am: heute }, kontext), { erfolg: t("Als erledigt vermerkt"), fehler: t("Speichern fehlgeschlagen") });
    if (r.ok) await laden();
  };
  const postLoeschen = async (/** @type {Record<string, any>} */ e) => {
    if (!(await bestaetige({ titel: t("Eintrag löschen?"), text: `${e.nummer} ${e.betreff || ""}`, bestaetigen: t("Löschen"), gefahr: true }))) return;
    const r = await mitRueckmeldung(() => loescheBuero(bitApi, "Postbucheintrag", e.id, kontext), { erfolg: t("Eintrag gelöscht"), fehler: t("Löschen fehlgeschlagen") });
    if (r.ok) await laden();
  };

  // --- template actions ---
  const vorlageSpeichern = async (/** @type {Record<string, any>} */ v, /** @type {{betreff: string, text: string, anlagen: string[]}} */ w) => {
    const obj = { ...(v.briefvorlage_id ? { id: v.briefvorlage_id } : {}), vorlage_key: v.key, basis_version: v.version, art: v.art, ...w };
    const r = await mitRueckmeldung(() => speichereBuero(bitApi, "Briefvorlage", obj, kontext), { erfolg: t("Vorlage gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (r.ok) await laden();
    return r.ok;
  };
  const vorlageZuruecksetzen = async (/** @type {Record<string, any>} */ v) => {
    if (!v.briefvorlage_id) return true;
    const r = await mitRueckmeldung(() => loescheBuero(bitApi, "Briefvorlage", v.briefvorlage_id, kontext), { erfolg: t("Auf Standard zurückgesetzt"), fehler: t("Löschen fehlgeschlagen") });
    if (r.ok) await laden();
    return r.ok;
  };
  const probedruck = async (/** @type {Record<string, any>} */ v, /** @type {{betreff: string, text: string, anlagen: string[]}} */ w) => {
    await mitRueckmeldung(async () => {
      const d = musterDaten(heute, briefkopf);
      const fuell = (/** @type {string} */ x) => fuellePlatzhalter(x, d).text;
      const verteiler = v.variante === "verteiler";
      const s = {
        datum: heute, betreff: fuell(w.betreff), text: v.textAus79 ? "Musterschreiben — der Mahntext kommt aus der Buchhaltung." : fuell(w.text),
        anlagen: w.anlagen.map(fuell), empfaenger: MUSTER_EMPFAENGER,
        ...(verteiler ? { variante: "verteiler", verteiler: ["Bauherr Beispiel", "Tragwerksplanung Beispiel"], tabelle: { kopf: ["TOP", "Thema", "Verantwortlich", "Termin"], zeilen: [["1", "Musterthema", "Bauleitung", heute]] } } : {}),
      };
      const { bytes } = await schreibenPdf(s, { briefkopf });
      herunterladen(bytes, `Probedruck_${v.key}.pdf`);
    }, { fehler: t("PDF konnte nicht erzeugt werden") });
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <Mail className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Schriftverkehr")}
          </h1>
          <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Briefe aus Vorlagen, Postbuch Ein- und Ausgang.")}</p>
        </div>
        {gesperrt ? <BueroCloudKarte /> : zustand.fehler ? <BueroLadeFehler fehler={zustand.fehler} onRetry={laden} /> : (
          <Tabs value={tab} onValueChange={setTab} activationMode="manual">
            <TabsList aria-label={t("Bereiche des Schriftverkehrs")} className={TAB_LISTE}>
              {SCHRIFT_REITER.filter((r) => erlaubt.includes(r.key)).map((r) => {
                const Icon = /** @type {Record<string, any>} */ (ICONS)[r.icon];
                return <TabsTrigger key={r.key} value={r.key} className={TAB_AUSLOESER}>{Icon && <Icon className="h-4 w-4" aria-hidden="true" />} {t(r.label)}</TabsTrigger>;
              })}
            </TabsList>
            {zustand.laedt ? <p className="mt-4 text-sm text-slate-600 dark:text-slate-300" role="status">{t("Wird geladen …")}</p> : (
              <>
                <TabsContent value="letters" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Correspondence?tab=" + tab}>
                    <SchreibenListe schreiben={schreibenSichtbar} projektNamen={projektNamen} aktivesProjekt={ctx.projectId || null} darfBearbeiten={darfBearbeiten}
                      onNeu={() => oeffneEntwurf("brief", null)} onOeffnen={(s) => setEditor({ schreiben: s, hinweise: [] })} />
                  </ModulFehlergrenze>
                </TabsContent>
                <TabsContent value="register" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Correspondence?tab=" + tab}>
                    <PostbuchReiter eintraege={postSichtbar} projektNamen={projektNamen} nutzerNamen={nutzerNamen} aktivesProjekt={ctx.projectId || null}
                      darfBearbeiten={darfBearbeiten} loeschbar={(e) => postbuchLoeschbar(e, zustand.daten.Schreiben || [])}
                      onNeu={() => setPostDialog({ eintrag: null })} onBearbeiten={(e) => setPostDialog({ eintrag: e })}
                      onAntwort={(e) => { setTab("letters"); oeffneEntwurf("antwort", { typ: "postbuch", id: e.id }); }}
                      onErledigt={postErledigt} onLoeschen={postLoeschen}
                      onScan={(e) => mitRueckmeldung(() => dokumentHerunterladen(e.document_id, `${e.nummer}.pdf`), { fehler: t("Dokument konnte nicht geöffnet werden") })} />
                  </ModulFehlergrenze>
                </TabsContent>
                <TabsContent value="templates" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Correspondence?tab=" + tab}>
                    <VorlagenReiter vorlagen={vorlagen} darfPflegen={darfPflegen} onOeffnen={setVorlageOffen} />
                  </ModulFehlergrenze>
                </TabsContent>
              </>
            )}
          </Tabs>
        )}
      </div>
      {editor && (
        <SchreibenEditor schreiben={editor.schreiben} hinweise={editor.hinweise} vorlagen={vorlagen} kontakte={zustand.kontakte} projekte={projekte}
          bereiche={bereiche} briefkopf={briefkopf} darfBearbeiten={darfBearbeiten}
          onVorlage={(key, aktuell) => {
            const neu = neuerEntwurf(/** @type {any} */ (vorlageZu(key)), aktuell.bezug, basisDaten(), { projectId: aktuell.project_id }).entwurf;
            return { ...neu, id: aktuell.id, bereich: aktuell.bereich, project_id: aktuell.project_id, empfaenger: aktuell.empfaenger || neu.empfaenger };
          }}
          onSpeichern={speichernEntwurf} onFestschreiben={festschreiben} onVersendet={versendet} onLoeschen={loeschenEntwurf} onPdf={pdf}
          onClose={() => setEditor(null)} />
      )}
      {postDialog && (
        <PostDialog eintrag={postDialog.eintrag} kontakte={zustand.kontakte} projekte={projekte} nutzer={nutzer} bereiche={bereiche.length ? bereiche : ["projekt"]}
          heute={heute} aktivesProjekt={ctx.projectId || null} onSpeichern={postSpeichern} onClose={() => setPostDialog(null)} />
      )}
      {vorlageOffen && (
        <VorlagenEditor vorlage={vorlageOffen} darfPflegen={darfPflegen} onSpeichern={vorlageSpeichern} onZuruecksetzen={vorlageZuruecksetzen}
          onProbedruck={probedruck} onClose={() => setVorlageOffen(null)} />
      )}
    </div>
  );
}
