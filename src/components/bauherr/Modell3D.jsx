// Modell3D — the released building model as a small read-only 3D view in the
// client portal (Phase 110-05).
//
// Loads ONE GLB (the BIM studio's scene, written by
// @designer/lib/bauherrModellAbgleich.js while the model is released) from a
// URL — in the cloud a signed URL of the edge function `freigabe` (60 s,
// fetched at once), in the office preview a blob URL of the local copy — and hands
// it to the viewer @designer/lib/bauherrBetrachter.js (drag to rotate, wheel /
// two fingers to zoom). The viewer module, with three and OrbitControls, is
// imported on demand, so the portal chunk does not carry them; three itself is
// never imported here (a dynamic namespace import would defeat tree-shaking).
//
// In:  url of the GLB, title for the accessible name. Out: the view.
// Side effects: one fetch; one WebGL context while mounted, released on unmount.

import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '@core/lib/i18n';
import { flaecheFehler, flaecheLeise, flaecheRuhe } from '@core/lib/portalFlaeche';

/** Height of the view, in CSS pixels. */
const HOEHE_PX = 360;

/**
 * The 3D view.
 * @param {{ url: string, titel?: string }} props url: GLB (signed or blob URL); titel: accessible name
 * @returns {React.ReactElement}
 */
export default function Modell3D({ url, titel }) {
  const { t } = useI18n();
  const flaeche = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [stand, setStand] = useState(/** @type {'laedt'|'bereit'|'fehler'} */ ('laedt'));

  useEffect(() => {
    const el = flaeche.current;
    if (!el || !url) return undefined;
    let aus = false;
    /** @type {{ beenden: () => void }|null} */
    let betrachter = null;
    setStand('laedt');
    (async () => {
      try {
        const [antwort, { betrachterStarten }] = await Promise.all([fetch(url), import('@designer/lib/bauherrBetrachter')]);
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
        const puffer = await antwort.arrayBuffer();
        if (aus) return;
        const b = await betrachterStarten(el, puffer);
        if (aus) { b.beenden(); return; }
        betrachter = b;
        setStand('bereit');
      } catch (e) {
        // WebGL missing, URL expired, file not a GLB: one plain message, the detail in the console.
        console.info('Modell3D:', /** @type {any} */ (e)?.message || e);
        if (!aus) setStand('fehler');
      }
    })();
    return () => {
      aus = true;
      betrachter?.beenden();
    };
  }, [url]);

  return (
    <div className="space-y-1" data-testid="bauherr-modell3d" data-stand={stand}>
      <div ref={flaeche} role="img" aria-label={`${t('Gebäudemodell in 3D')}${titel ? `: ${titel}` : ''}`}
        className={`relative w-full overflow-hidden rounded-lg ${flaecheRuhe}`} style={{ height: HOEHE_PX }}>
        {stand === 'laedt' && (
          <p className={`absolute inset-0 flex items-center justify-center text-sm ${flaecheLeise}`}>{t('Gebäudemodell wird geladen …')}</p>
        )}
      </div>
      {stand === 'fehler' ? (
        <p role="alert" className={`rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{t('Die 3D-Ansicht konnte nicht geladen werden.')}</p>
      ) : (
        <p className={`text-xs ${flaecheLeise}`}>{t('Ziehen zum Drehen, Mausrad oder zwei Finger zum Zoomen.')}</p>
      )}
    </div>
  );
}
