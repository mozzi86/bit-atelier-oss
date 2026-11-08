// Bauherrenzugang — the office side of the client portal (Phase 110-03).
//
// For the active project the office picks what its client sees: the project
// overview, participants, cost status by DIN 276 group, plans, documents,
// photos, appointments, sampling, issued invoices. The right half shows the
// result exactly as the client will see it (BauherrAnsicht with projections
// built by bauherrProjektion.js — the same whitelist the database applies).
//
// Local (express/serverlos): "Freigeben" stores the same projection rows through
// bitApi (zugriff.bauherrFreigeben, whitelist of the RPC) — they feed the preview
// "Ansicht als … Bauherr (Vorschau)" in the header. No invitation, no files.
// Cloud (supabase): "Freigeben" writes the projections through the RPC
// bauherr_freigeben (files go to freigaben/<org>/<projekt>/_bauherr/ first;
// the building model's 3D file is written by the BIM studio from its own scene
// while the release stands — 110-05, bauherrModellAbgleich.js),
// existing releases are pre-selected and can be withdrawn, the owner invites
// the client by e-mail (magic link, role bauherr), and the client's feedback
// is listed with an answer field.
//
// In:  the active project (useProject), office entities through bitApi.
// Out: the page. Side effects (cloud only): RPCs, storage upload, invitation.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { bitApi } from '@core/api/bitApi';
import {
  bauherrAntworten, bauherrDateiAblegen, bauherrFreigeben, bauherrZuruecknehmen, einladungscodeErstellen, einladungsLink,
} from '@core/api/zugriff';
import { flaecheErfolg, flaecheFeld, flaecheFehler, flaecheHinweis, flaecheKarte, flaecheKnopf, flaecheKnopfLeise, flaecheRuhe, flaecheWhatsapp } from '@core/lib/portalFlaeche';
import { useProject } from '@core/lib/ProjectContext';
import { useI18n } from '@core/lib/i18n';
import { seitenWurzel } from '@core/lib/utils';
import { DATENQUELLE } from '@core/lib/umgebung';
import { inhaltLaden } from '@core/lib/speicherOrt';
import {
  BAUHERR_ARTEN, BAUHERR_LABELS, bauherrDateiname, freigebbar, kgVerdichten, kostenAusLv, portalAufbereiten, projektionAus,
} from '@core/lib/bauherrProjektion';
import { kostenJeKg } from '@ava/lib/kostenJeKg';
import { ROLLEN as BETEILIGTEN_ROLLEN } from '@/lib/people/beteiligte';
import BauherrAnsicht from '../components/bauherr/BauherrAnsicht';

const CLOUD = DATENQUELLE === 'supabase';

/** Kinds where the office may ask the client for a decision (D-BH-05). */
const MIT_ENTSCHEIDUNG = Object.freeze(['BauherrPlan', 'BauherrDokument', 'BauherrBemusterung']);

/**
 * @typedef {{ schluessel: string, art: string, entity: string, quelle: Record<string, any>,
 *   titel: string, grund: string|null, dateiQuelle: Record<string, any>|null }} Kandidat
 *   dateiQuelle: the Document whose content goes out as the file (plan PDF, document, photo)
 */

/** @param {Record<string, any>} d @returns {boolean} an image document (photo) */
const istBild = (d) => /^image\//i.test(String(d?.type || '')) || /\.(jpe?g|png|webp|heic)$/i.test(String(d?.name || ''));

/**
 * Every office row of the project that could go to the client, one entry per
 * (kind, source). Rows freigebbar() refuses stay in the list with the reason.
 * @param {Record<string, any>} projekt
 * @param {Record<string, any[]>} q office rows per entity
 * @returns {Kandidat[]}
 */
function kandidatenBilden(projekt, q) {
  /** @type {Kandidat[]} */
  const k = [];
  const dokNachId = new Map((q.Document || []).map((d) => [d.id, d]));
  /** @param {string} art @param {string} entity @param {Record<string, any>} quelle @param {string} titel @param {Record<string, any>|null} [datei] */
  const dazu = (art, entity, quelle, titel, datei = null) => {
    const f = freigebbar(art, entity, quelle, { entscheidung: art === 'BauherrPlan' });
    k.push({ schluessel: `${art}:${quelle.id}`, art, entity, quelle, titel, grund: f.ok ? null : (f.grund || ''), dateiQuelle: datei });
  };
  dazu('BauherrProjekt', 'Project', projekt, projekt.name || 'Projekt');
  dazu('BauherrBeteiligter', 'Project', projekt, 'Projektbeteiligte');
  dazu('BauherrKosten', 'Project', projekt, 'Kosten nach Kostengruppen');
  for (const s of q.KostenStand || []) dazu('BauherrKosten', 'KostenStand', s, `${s.stufe || 'Kostenstand'} ${s.datum || ''}`.trim());
  for (const t of q.ScheduleTask || []) dazu('BauherrTermin', 'ScheduleTask', t, t.name || t.title || 'Vorgang');
  for (const t of q.Termin || []) dazu('BauherrTermin', 'Termin', t, t.titel || 'Termin');
  // 110-05: the building model goes out as a 3D view of its hull (GLB, built on release).
  for (const m of q.BimModel || []) dazu('BauherrModell', 'BimModel', m, 'Gebäudemodell (3D-Ansicht)');
  for (const p of q.Plan || []) dazu('BauherrPlan', 'Plan', p, `${p.nr || ''} ${p.titel || ''}`.trim(), p.datei_ref ? dokNachId.get(p.datei_ref) || null : null);
  for (const d of q.Document || []) {
    if (istBild(d)) dazu('BauherrFoto', 'Document', d, d.name || 'Foto', d);
    else dazu('BauherrDokument', 'Document', d, d.name || 'Dokument', d);
  }
  for (const b of q.Bemusterung || []) dazu('BauherrBemusterung', 'Bemusterung', b, `${b.nr || ''} ${b.gegenstand || ''}`.trim());
  for (const s of q.Sonderwunsch || []) dazu('BauherrBemusterung', 'Sonderwunsch', s, s.beschreibung || 'Sonderwunsch');
  for (const r of q.Ausgangsrechnung || []) dazu('BauherrRechnung', 'Ausgangsrechnung', r, `${r.nummer || ''} ${r.art || ''}`.trim());
  return k;
}

/**
 * The file content of a Document as a Blob (inline data URL or blob store).
 * @param {Record<string, any>} dok
 * @returns {Promise<Blob|null>}
 */
async function dokumentBlob(dok) {
  const inhalt = await inhaltLaden(dok.data, dok.data_blob);
  if (typeof inhalt !== 'string' || !inhalt.startsWith('data:')) return null;
  return (await fetch(inhalt)).blob();
}

/**
 * The page.
 * @returns {React.ReactElement}
 */
export default function Bauherrenzugang() {
  const { t } = useI18n();
  const { project } = useProject();
  const [quellen, setQuellen] = useState(/** @type {Record<string, any[]>|null} */ (null));
  const [bestand, setBestand] = useState(/** @type {Record<string, any[]>} */ ({}));
  const [auswahl, setAuswahl] = useState(/** @type {Record<string, { an: boolean, entscheidung: boolean }>} */ ({}));
  const [hinweis, setHinweis] = useState('');
  const [linkRolle, setLinkRolle] = useState(/** @type {'bauherr'} */ ('bauherr'));
  const [linkTage, setLinkTage] = useState('14');
  const [link, setLink] = useState('');
  const [antwort, setAntwort] = useState(/** @type {Record<string, string>} */ ({}));
  const [meldung, setMeldung] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const projektId = project?.id || null;

  const laden = useCallback(async () => {
    if (!projektId) { setQuellen(null); return; }
    setFehler('');
    try {
      const f = { project_id: projektId };
      const [plan, dok, ks, st, te, bem, sw, ar, kon, lv, ten, bid, mea, bim] = await Promise.all([
        bitApi.entities.Plan.filter(f), bitApi.entities.Document.filter(f), bitApi.entities.KostenStand.filter(f),
        bitApi.entities.ScheduleTask.filter(f), bitApi.entities.Termin.filter(f), bitApi.entities.Bemusterung.filter(f),
        bitApi.entities.Sonderwunsch.filter(f), bitApi.entities.Ausgangsrechnung.filter(f), bitApi.entities.Contact.list(),
        bitApi.entities.LVPosition.filter(f), bitApi.entities.Tender.filter(f), bitApi.entities.Bid.list(), bitApi.entities.Measurement.filter(f),
        bitApi.entities.BimModel.filter(f),
      ]);
      // Existing releases: the office reads the client kinds like any project row (both data paths).
      // Loaded BEFORE the candidates are shown (06.11.2026): setting the candidates first and the
      // pre-selection afterwards overwrote boxes ticked in the meantime — ticks of the first second were lost.
      const arten = [...BAUHERR_ARTEN, 'BauherrRueckmeldung', 'BauherrAntwort', 'BauherrUpload'];
      const listen = await Promise.all(arten.map((a) => bitApi.entities[a].filter(f)));
      /** @type {Record<string, any[]>} */
      const b = Object.fromEntries(arten.map((a, i) => [a, listen[i]]));
      /** @type {Record<string, { an: boolean, entscheidung: boolean }>} */
      const vor = {};
      for (const a of BAUHERR_ARTEN) {
        for (const z of b[a] || []) if (z.freigegeben === true && z.quelle_id) vor[`${a}:${z.quelle_id}`] = { an: true, entscheidung: z.entscheidung_offen === true };
      }
      setBestand(b);
      setAuswahl(vor);
      setQuellen({
        Plan: plan, Document: dok, KostenStand: ks, ScheduleTask: st, Termin: te, Bemusterung: bem, Sonderwunsch: sw,
        Ausgangsrechnung: ar, Contact: kon, LVPosition: lv, Tender: ten, Bid: bid, Measurement: mea,
        // One record per project: the first row, as loadBimModel (useBimModelSync) reads it.
        BimModel: (bim || []).slice(0, 1),
      });
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
      setQuellen({});
    }
  }, [projektId]);
  useEffect(() => { laden(); }, [laden]);

  const kandidaten = useMemo(() => (project && quellen ? kandidatenBilden(project, quellen) : []), [project, quellen]);

  // KG level 1. Net per group: forecast where the AVA has one, else budget
  // (D-BH-08 — which figure the client sees is the office's decision). Gross per
  // group from the LV positions with their own VAT rate (kostenAusLv), so tax-free
  // positions stay tax-free; a forecast keeps the group's gross/net ratio of the
  // estimate [ASSUMED: awarded work has the same VAT mix as the estimate].
  const gruppen = useMemo(() => {
    if (!quellen) return [];
    const lv = kostenAusLv(quellen.LVPosition || []);
    const zeilen = kostenJeKg({ positions: quellen.LVPosition || [], tenders: quellen.Tender || [], bids: quellen.Bid || [], measurements: quellen.Measurement || [] });
    const prognose = kgVerdichten(zeilen.map((z) => ({ kg: z.kg, betrag_netto: Number.isFinite(/** @type {any} */ (z).prognose) ? /** @type {any} */ (z).prognose : z.budget })));
    return lv.map((g) => {
      const p = prognose.find((x) => x.kg === g.kg);
      if (!p || !g.betrag_netto || Math.abs(p.betrag_netto - g.betrag_netto) < 0.005) return g;
      return { ...g, betrag_netto: p.betrag_netto, betrag_brutto: Math.round(p.betrag_netto * (g.betrag_brutto / g.betrag_netto) * 100) / 100 };
    });
  }, [quellen]);

  const rollenLabel = useCallback((/** @type {string} */ id) => BETEILIGTEN_ROLLEN.find((r) => r.id === id)?.label || id, []);

  /** @param {Kandidat} k @returns {Record<string, unknown>|null} */
  const projektion = useCallback((k) => {
    const a = auswahl[k.schluessel];
    const p = projektionAus(k.art, k.entity, k.quelle, {
      entscheidung: a?.entscheidung === true,
      hinweis: k.art === 'BauherrProjekt' ? hinweis : undefined,
      gruppen: k.art === 'BauherrKosten' ? gruppen : undefined,
      kontakte: quellen?.Contact || [],
      rollenLabel,
    });
    if (p && k.dateiQuelle) p.datei = bauherrDateiname(k.dateiQuelle.name || 'datei.pdf');
    return p;
  }, [auswahl, hinweis, gruppen, quellen, rollenLabel]);

  // A plan that is not released internally goes out only WITH a decision request
  // (freigebbar, D-BH-05): the box "Entscheidung anfragen" is then forced on.
  const mussEntscheiden = (/** @type {Kandidat} */ k) => k.entity === 'Plan' && k.quelle.status !== 'freigegeben';
  const gewaehlt = kandidaten.filter((k) => auswahl[k.schluessel]?.an && !k.grund
    && freigebbar(k.art, k.entity, k.quelle, { entscheidung: auswahl[k.schluessel]?.entscheidung === true }).ok);
  const vorschau = useMemo(() => {
    /** @type {Record<string, any[]>} */
    const zeilen = {};
    for (const k of gewaehlt) {
      const p = projektion(k);
      if (p) (zeilen[k.art] ||= []).push({ id: `vorschau-${k.schluessel}`, ...p });
    }
    return portalAufbereiten(zeilen);
  }, [gewaehlt, projektion]);

  /** @param {string} schluessel @param {Partial<{ an: boolean, entscheidung: boolean }>} w */
  const setzen = (schluessel, w) => setAuswahl((s) => ({ ...s, [schluessel]: { an: false, entscheidung: false, ...s[schluessel], ...w } }));

  /** @param {() => Promise<string|void>} fn */
  const ausfuehren = async (fn) => {
    setBusy(true);
    setFehler('');
    setMeldung('');
    try {
      const m = await fn();
      if (m) setMeldung(m);
      await laden();
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const freigeben = () => ausfuehren(async () => {
    let n = 0;
    for (const k of gewaehlt) {
      const p = projektion(k);
      if (!p) continue;
      let datei = null;
      if (k.art === 'BauherrModell') {
        // 110-05: the 3D file belongs to the BIM studio (one truth: its scene, rewritten after every saved change).
        // A release from here keeps the file and its date the studio wrote; a first release has none until the studio runs.
        const vorhanden = (bestand.BauherrModell || []).find((z) => z.quelle_id === k.quelle.id && z.datei);
        if (vorhanden) { datei = vorhanden.datei; p.stand = vorhanden.stand; }
      } else if (CLOUD && k.dateiQuelle && projektId) {
        // Files only in the cloud (bucket freigaben); locally the preview shows no download.
        const blob = await dokumentBlob(k.dateiQuelle);
        const name = bauherrDateiname(`${k.quelle.id}-${k.dateiQuelle.name || 'datei.pdf'}`);
        if (blob && name) datei = await bauherrDateiAblegen(projektId, name, blob);
      }
      await bauherrFreigeben(k.art, k.quelle.id, p, datei, projektId);
      n += 1;
    }
    return `${n} ${t('Einträge für den Bauherrn freigegeben.')}`;
  });

  /** @param {string} id @param {string} art */
  const zuruecknehmen = (id, art) => ausfuehren(async () => { await bauherrZuruecknehmen(id, art); return t('Freigabe zurückgenommen.'); });

  // 110-06: invitation by link (code, no e-mail needed). The code is shown once.
  const linkErstellen = () => ausfuehren(async () => {
    if (!projektId) return;
    const code = await einladungscodeErstellen(projektId, linkRolle, Number(linkTage));
    setLink(einladungsLink(code));
    return t('Einladelink erstellt — kopieren oder per WhatsApp senden. Er gilt einmal.');
  });
  const whatsappText = link
    ? `${t('Einladung zu Ihrem Projekt im BIT-Atelier')}${project?.name ? ` „${project.name}“` : ''}: ${link}`
    : '';

  /** @param {string} id */
  const beantworten = (id) => ausfuehren(async () => {
    await bauherrAntworten(id, antwort[id] || '');
    setAntwort((a) => ({ ...a, [id]: '' }));
    return t('Antwort freigegeben.');
  });

  // `freigegeben` is the data mirror of the column sicht (0016, bauherr_freigeben).
  const freigegeben = BAUHERR_ARTEN.flatMap((a) => (bestand[a] || []).filter((z) => z.freigegeben === true).map((z) => ({ art: a, z })));
  const rueckmeldungen = [...(bestand.BauherrRueckmeldung || [])].sort((a, b) => String(b.zeitpunkt || '').localeCompare(String(a.zeitpunkt || '')));

  return (
    <div className={seitenWurzel}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('Bauherrenzugang')}</h1>
          <p className="text-sm text-muted-foreground">
            {project ? project.name : t('Kein aktives Projekt – bitte wählen Sie oben in der Kopfzeile ein Projekt.')}
          </p>
        </div>

        <p className={`rounded-md ${flaecheHinweis} px-3 py-2 text-sm`} data-testid="bauherr-modus">
          {CLOUD
            ? t('Der Bauherr sieht nur, was hier freigegeben ist — nie Honorar, Zeiten, Kalkulation, interne Notizen oder andere Projekte. Die Datenbank prüft das selbst.')
            : t('Lokal: Freigaben gelten für die Vorschau „Bauherr (Vorschau)“ unter „Ansicht als …“ oben in der Kopfzeile. Einladen und Dateien gibt es nur im Cloud-Betrieb.')}
        </p>
        {fehler && <p role="alert" className={`rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{fehler}</p>}
        {meldung && <p role="status" className={`rounded-md ${flaecheErfolg} px-3 py-2 text-sm`}>{meldung}</p>}

        {project && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="bz-auswahl" className="space-y-4">
              <h2 id="bz-auswahl" className="text-lg font-semibold">{t('Was der Bauherr sieht')}</h2>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">{t('Hinweis an den Bauherrn (erscheint in der Projektübersicht)')}</span>
                <input value={hinweis} onChange={(e) => setHinweis(e.target.value)} className={`w-full rounded-md ${flaecheFeld} px-2 py-1`} />
              </label>
              {!quellen && <p className="text-sm text-muted-foreground">{t('Wird geladen …')}</p>}
              {BAUHERR_ARTEN.map((art) => {
                const liste = kandidaten.filter((k) => k.art === art);
                if (liste.length === 0) return null;
                return (
                  <fieldset key={art} className={`rounded-lg ${flaecheKarte} p-3`} data-testid={`bz-art-${art}`}>
                    <legend className="px-1 text-sm font-semibold">{t(BAUHERR_LABELS[/** @type {keyof typeof BAUHERR_LABELS} */ (art)])}</legend>
                    {art === 'BauherrModell' && (
                      <p className="mb-1 text-xs text-muted-foreground" data-testid="bz-modell-hinweis">
                        {t('Die 3D-Ansicht entsteht im BIM-Studio aus dem Gebäudemodell und erneuert sich nach jeder gespeicherten Änderung. Nach der ersten Freigabe das Modell einmal im BIM-Studio öffnen.')}
                      </p>
                    )}
                    <ul className="space-y-1 text-sm">
                      {liste.map((k) => (
                        <li key={k.schluessel} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" disabled={Boolean(k.grund) || busy} checked={Boolean(auswahl[k.schluessel]?.an) && !k.grund}
                              onChange={(e) => setzen(k.schluessel, mussEntscheiden(k) ? { an: e.target.checked, entscheidung: e.target.checked } : { an: e.target.checked })} />
                            <span>{k.titel}</span>
                          </label>
                          {MIT_ENTSCHEIDUNG.includes(art) && !k.grund && (
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              <input type="checkbox" disabled={busy || (mussEntscheiden(k) && Boolean(auswahl[k.schluessel]?.an))} checked={Boolean(auswahl[k.schluessel]?.entscheidung)}
                                onChange={(e) => setzen(k.schluessel, { entscheidung: e.target.checked, an: e.target.checked || Boolean(auswahl[k.schluessel]?.an) })} />
                              {t('Entscheidung anfragen')}
                            </label>
                          )}
                          {k.grund && <span className="text-xs text-muted-foreground">— {t(k.grund)}</span>}
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                );
              })}
              {(
                <button type="button" data-testid="bz-freigeben" className={`rounded-md ${flaecheKnopf} px-4 py-2 text-sm font-medium disabled:opacity-50`}
                  disabled={busy || gewaehlt.length === 0} onClick={freigeben}>
                  {t('Auswahl für den Bauherrn freigeben')} ({gewaehlt.length})
                </button>
              )}

              {CLOUD && (
                <section aria-labelledby="bz-einladen" className={`space-y-2 rounded-lg ${flaecheKarte} p-3`} data-testid="bz-einladelink">
                  <h3 id="bz-einladen" className="text-sm font-semibold">{t('Einladelink erstellen')}</h3>
                  <p className="text-xs text-muted-foreground">{t('Ohne E-Mail: Der Eingeladene öffnet den Link, gibt selbst E-Mail und Passwort ein (oder Google) und sieht nur dieses Projekt.')}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">{t('Rolle')}</span>
                      {/* Only bauherr for now: the client projections of 0016 have the audience
                          bauherr, so any other external role would see nothing. Bidders are
                          invited per tender (AVA). The select stays for further roles. */}
                      <select value={linkRolle} onChange={(e) => setLinkRolle(/** @type {'bauherr'} */ (e.target.value))}
                        className={`rounded-md ${flaecheFeld} px-2 py-1 text-sm`}>
                        <option value="bauherr">{t('Bauherr')}</option>
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">{t('Gültig')}</span>
                      <select value={linkTage} onChange={(e) => setLinkTage(e.target.value)}
                        className={`rounded-md ${flaecheFeld} px-2 py-1 text-sm`}>
                        <option value="7">{t('7 Tage')}</option>
                        <option value="14">{t('14 Tage')}</option>
                        <option value="30">{t('30 Tage')}</option>
                      </select>
                    </label>
                    <button type="button" className={`rounded-md ${flaecheKnopf} px-3 py-1.5 text-sm font-medium disabled:opacity-50`}
                      disabled={busy} onClick={linkErstellen}>{t('Einladelink erstellen')}</button>
                  </div>
                  {link && (
                    <div className="space-y-2">
                      <label htmlFor="bz-link" className="sr-only">{t('Einladelink')}</label>
                      <input id="bz-link" readOnly value={link} onFocus={(e) => e.target.select()}
                        className="w-full rounded-md border border-input bg-muted px-2 py-1 font-mono text-xs text-foreground" />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={`rounded-md ${flaecheKnopfLeise} px-3 py-1.5 text-sm`}
                          onClick={() => { navigator.clipboard?.writeText(link).catch(() => {}); }}>{t('Link kopieren')}</button>
                        <a className={`rounded-md ${flaecheWhatsapp} px-3 py-1.5 text-sm font-medium`}
                          href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noopener noreferrer">{t('Per WhatsApp senden')}</a>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {freigegeben.length > 0 && (
                <section aria-labelledby="bz-freigegeben" className={`space-y-1 rounded-lg ${flaecheKarte} p-3 text-sm`}>
                  <h3 id="bz-freigegeben" className="font-semibold">{t('Freigegeben')}</h3>
                  <ul className="space-y-1">
                    {freigegeben.map(({ art, z }) => (
                      <li key={z.id} className="flex items-center justify-between gap-2">
                        <span>{t(BAUHERR_LABELS[/** @type {keyof typeof BAUHERR_LABELS} */ (art)])}: {z.titel || z.name || z.nummer || z.id}</span>
                        <button type="button" className="text-xs underline disabled:opacity-50" disabled={busy} onClick={() => zuruecknehmen(z.id, art)}>{t('Zurücknehmen')}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {CLOUD && (
                <section aria-labelledby="bz-rueck" className={`space-y-2 rounded-lg ${flaecheKarte} p-3 text-sm`}>
                  <h3 id="bz-rueck" className="font-semibold">{t('Rückmeldungen des Bauherrn')}</h3>
                  {rueckmeldungen.length === 0 && <p className="text-xs text-muted-foreground">{t('Noch keine Rückmeldungen.')}</p>}
                  <ul className="space-y-2">
                    {rueckmeldungen.map((r) => (
                      <li key={r.id} className={`rounded ${flaecheRuhe} p-2`}>
                        <p><strong>{t(r.art)}</strong>{r.bezug_entity ? ` · ${t(BAUHERR_LABELS[/** @type {keyof typeof BAUHERR_LABELS} */ (r.bezug_entity)] || r.bezug_entity)}` : ''}{r.option ? ` · ${t('Option')} ${r.option}` : ''} · {String(r.zeitpunkt || '').slice(0, 10)}</p>
                        {r.text && <p>{r.text}</p>}
                        {(r.art === 'frage' || r.art === 'kommentar') && (
                          <div className="mt-1 flex gap-2">
                            <label htmlFor={`bz-antwort-${r.id}`} className="sr-only">{t('Antwort')}</label>
                            <input id={`bz-antwort-${r.id}`} value={antwort[r.id] || ''} onChange={(e) => setAntwort((a) => ({ ...a, [r.id]: e.target.value }))}
                              placeholder={t('Antwort')} className={`flex-1 rounded-md ${flaecheFeld} px-2 py-1`} />
                            <button type="button" className={`rounded-md ${flaecheKnopfLeise} px-2 py-1 text-xs disabled:opacity-50`}
                              disabled={busy || !(antwort[r.id] || '').trim()} onClick={() => beantworten(r.id)}>{t('Antworten')}</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </section>

            <section aria-labelledby="bz-vorschau" className="space-y-2">
              <h2 id="bz-vorschau" className="text-lg font-semibold">{t('So sieht es der Bauherr')}</h2>
              <div className={`rounded-xl ${flaecheRuhe} p-3`} data-testid="bz-vorschau">
                <BauherrAnsicht daten={vorschau} vorschau />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
