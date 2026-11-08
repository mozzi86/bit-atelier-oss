// Client portal — the whole app for the role `bauherr` (Phase 110-02).
//
// App.jsx renders this instead of the office shell (and instead of the bidder
// portal) when the signed-in user's membership has the role bauherr (cloud
// build only). It reads exactly the client kinds of BAUHERR_LESEN — the
// projections the office released for the client's project (0016), the
// office's answers, and the client's own rows. RLS answers every other entity
// with nothing anyway; the portal does not even ask.
//
// Writing: decisions and questions as BauherrRueckmeldung, own documents as
// BauherrUpload with the file in bucket `bauherr` — both immutable once
// written (0016). Files of the office open through the edge function
// `freigabe` (signed URL, 60 s, logged); the released building model (110-05)
// is a GLB the portal shows in 3D through the same signed URL.
//
// Preview (110-03, "Ansicht als … Bauherr (Vorschau)", local data paths): the
// same page for the office. It reads the same 13 kinds, keeps only what the
// client of the ACTIVE project would see (fuerBauherrSichtbar — the RLS rule of
// 0016 as a pure function) and disables every button; a bar leads back to the
// office view. The 3D model opens there too (read-only), from the local copy of
// the file the BIM studio wrote (blob store, modellVorschau.js).
//
// In:  the signed-in user (AuthContext), prop vorschau. Out: the page. Side
//      effects: entity reads/writes through bitApi, storage upload, edge function call.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { bitApi } from '@core/api/bitApi';
import { bauherrHochladen, freigabeDateiLink } from '@core/api/zugriff';
import { useAuth } from '@core/lib/AuthContext';
import { useI18n } from '@core/lib/i18n';
import { useProject } from '@core/lib/ProjectContext';
import { useZugriff } from '@core/lib/ZugriffContext.jsx';
import { bauherrDateiname, fuerBauherrSichtbar, portalAufbereiten } from '@core/lib/bauherrProjektion';
import { flaecheFehler, flaecheKarte, flaecheKnopfLeise, flaecheLeise, flaecheTitel, flaecheWarnung } from '@core/lib/portalFlaeche';
import BauherrAnsicht from '../components/bauherr/BauherrAnsicht';

/**
 * Reads every client kind. One list per entity — the explicit names keep the
 * unit test able to check that the portal asks for nothing else.
 * @returns {Promise<Record<string, any[]>>}
 */
async function allesLaden() {
  const [p, te, pl, mo, ko, dok, bem, fo, re, bet, ant, rue, up] = await Promise.all([
    bitApi.entities.BauherrProjekt.list(),
    bitApi.entities.BauherrTermin.list(),
    bitApi.entities.BauherrPlan.list(),
    bitApi.entities.BauherrModell.list(),
    bitApi.entities.BauherrKosten.list(),
    bitApi.entities.BauherrDokument.list(),
    bitApi.entities.BauherrBemusterung.list(),
    bitApi.entities.BauherrFoto.list(),
    bitApi.entities.BauherrRechnung.list(),
    bitApi.entities.BauherrBeteiligter.list(),
    bitApi.entities.BauherrAntwort.list(),
    bitApi.entities.BauherrRueckmeldung.list(),
    bitApi.entities.BauherrUpload.list(),
  ]);
  return {
    BauherrProjekt: p, BauherrTermin: te, BauherrPlan: pl, BauherrModell: mo, BauherrKosten: ko, BauherrDokument: dok,
    BauherrBemusterung: bem, BauherrFoto: fo, BauherrRechnung: re, BauherrBeteiligter: bet,
    BauherrAntwort: ant, BauherrRueckmeldung: rue, BauherrUpload: up,
  };
}

/**
 * The portal page.
 * @param {{ vorschau?: boolean }} props vorschau: office preview of the active project (local only)
 * @returns {React.ReactElement}
 */
export default function BauherrPortal({ vorschau = false }) {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const { project } = useProject();
  const zugriff = useZugriff();
  const [zeilen, setZeilen] = useState(/** @type {Record<string, any[]>|null} */ (null));
  const [fehler, setFehler] = useState('');
  const vorschauProjekt = vorschau ? project?.id || null : null;

  const laden = useCallback(async () => {
    setFehler('');
    try {
      const alle = await allesLaden();
      // Cloud: RLS already returned only the client's rows. Preview: the same rule in JS.
      setZeilen(vorschau ? fuerBauherrSichtbar(alle, vorschauProjekt) : alle);
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
      setZeilen({});
    }
  }, [vorschau, vorschauProjekt]);
  useEffect(() => { laden(); }, [laden]);

  const daten = useMemo(() => portalAufbereiten(zeilen || {}), [zeilen]);
  // The project every write belongs to: the released overview, else any projection.
  const projektId = daten.projekt?.project_id
    || Object.values(daten.abschnitte).flat().find((z) => z?.project_id)?.project_id || null;

  /** @param {{ art: string, bezug?: Record<string, any>|null, text?: string, option?: string }} e */
  const rueckmelden = async (e) => {
    if (!projektId) throw new Error(t('Kein Projekt freigegeben — Rückmeldung nicht möglich.'));
    await bitApi.entities.BauherrRueckmeldung.create({
      project_id: projektId, art: e.art, bezug_id: e.bezug?.id || null, option: e.option || null, text: e.text || '',
    });
    await laden();
  };

  /** @param {Record<string, any>} zeile */
  const oeffnen = async (zeile) => {
    try {
      const url = await freigabeDateiLink(zeile.id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    }
  };

  /**
   * URL of the released 3D model: signed URL in the cloud, a blob URL of the
   * local copy in the office preview (released by ModellAnsicht).
   * @param {Record<string, any>} zeile projection row BauherrModell
   * @returns {Promise<string>}
   */
  const modellUrl = async (zeile) => {
    if (!vorschau) return freigabeDateiLink(zeile.id);
    const { vorschauModellUrl } = await import('../components/bauherr/modellVorschau');
    return vorschauModellUrl(zeile.datei);
  };

  /** @param {File} datei @param {string} text */
  const hochladen = async (datei, text) => {
    if (!projektId) throw new Error(t('Kein Projekt freigegeben — Hochladen nicht möglich.'));
    const name = bauherrDateiname(`${Date.now()}-${datei.name}`);
    if (!name) throw new Error(t('Dieser Dateiname ist nicht zulässig.'));
    await bauherrHochladen(projektId, datei, name, text);
    await laden();
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className={`border-b ${flaecheKarte}`}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className={`text-lg font-bold ${flaecheTitel}`}>{t('Bauherrenportal')}</h1>
            <p className={`text-xs ${flaecheLeise}`}>BIT-Atelier</p>
          </div>
          <div className={`flex items-center gap-3 text-sm ${flaecheLeise}`}>
            {vorschau ? (
              <button type="button" data-testid="bauherr-vorschau-ende" className={`rounded-md ${flaecheKnopfLeise} px-3 py-1.5 text-sm font-medium`}
                onClick={() => zugriff.wechsleNutzer(null)}>{t('Zurück zur Büro-Ansicht')}</button>
            ) : (
              <>
                <span>{user?.email}</span>
                <button type="button" className={`rounded-md ${flaecheKnopfLeise} px-3 py-1.5 text-sm font-medium`} onClick={() => logout()}>{t('Abmelden')}</button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6" data-testid="bauherrportal">
        {vorschau && (
          <p className={`rounded-md ${flaecheWarnung} px-3 py-2 text-sm`} data-testid="bauherr-vorschau-hinweis">
            {t('Vorschau: So sieht Ihr Bauherr das aktive Projekt — nur, was unter „Bauherrenzugang“ freigegeben ist. Knöpfe sind gesperrt.')}
            {project?.name ? ` (${project.name})` : ''}
          </p>
        )}
        {fehler && <p role="alert" className={`rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{fehler}</p>}
        {!zeilen ? (
          <p className={`text-sm ${flaecheLeise}`}>{t('Wird geladen …')}</p>
        ) : (
          <BauherrAnsicht daten={daten} vorschau={vorschau} onRueckmeldung={rueckmelden} onDatei={oeffnen} onDateiUrl={modellUrl} onHochladen={hochladen} />
        )}
      </main>
      <footer className={`mx-auto max-w-4xl px-4 pb-6 text-center text-xs ${flaecheLeise}`}>
        <Link to="/impressum" className="underline hover:text-foreground">{t('Impressum')}</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/datenschutz" className="underline hover:text-foreground">{t('Datenschutz')}</Link>
      </footer>
    </div>
  );
}
