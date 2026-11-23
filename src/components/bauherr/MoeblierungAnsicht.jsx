// MoeblierungAnsicht — the client moves furniture in the released furnishing (W-1118-22).
//
// Shows the rooms of one storey as outlines with their furniture. A piece of furniture is picked by pressing it and moved by
// dragging — no tool to choose, no axis handles. It stays on the 5 cm grid, is pulled flush to a wall it comes close to and can
// never leave its room. A button (or the key R) turns the picked piece by a quarter turn; the arrow keys move it by 10 cm.
// "Rückgängig" is always there. Nothing is written while the client tries things out: "Vorschlag senden" sends the changed
// places as ONE proposal to the office, which decides — the building model is never touched from here.
//
// All geometry and checks are the pure @core/lib/bauherrMoeblierung.js (no catalogue, no designer code in the portal bundle).
// Works with a finger: pointer events with capture, `touch-action: none` on the plan.
//
// In:  one projection row BauherrMoeblierung, the preview flag, the feedback callback.
// Out: the view; side effect only through onRueckmeldung (art "moeblierung", proposal text).

import React, { useMemo, useRef, useState } from 'react';
import { useI18n } from '@core/lib/i18n';
import { flaecheFehler, flaecheErfolg, flaecheKnopf, flaecheKnopfLeise, flaecheLeise, flaecheWarnung } from '@core/lib/portalFlaeche';
import { aenderungenAus, drehen, moebelBox, platzieren, stehtImRaum, ueberlappt, umrissLesen, vorschlagText } from '@core/lib/bauherrMoeblierung';

const knopf = `rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${flaecheKnopf}`;
const knopfLeise = `rounded-md px-3 py-2 text-sm disabled:opacity-50 ${flaecheKnopfLeise}`;
/** Free strip around the storey in the drawing (m). */
const RAND_M = 0.4;
/** Step of the arrow keys (m) — the office's keyboard step for furniture. */
const TASTEN_M = 0.1;

/**
 * @param {{ zeile: Record<string, any>, vorschau?: boolean,
 *   onRueckmeldung?: (eingabe: { art: string, bezug?: Record<string, any>|null, vorschlag?: string }) => Promise<void> }} props
 *   zeile: projection row (raeume, moebel, aenderbar); vorschau: office preview — everything can be tried, nothing is sent
 * @returns {React.ReactElement|null}
 */
export default function MoeblierungAnsicht({ zeile, vorschau = false, onRueckmeldung }) {
  const { t } = useI18n();
  const raeume = useMemo(() => (Array.isArray(zeile?.raeume) ? zeile.raeume : []).map((/** @type {any} */ r) => ({ ...r, punkte: umrissLesen(r.umriss) })).filter((/** @type {any} */ r) => r.punkte.length >= 3), [zeile]);
  const freigegeben = useMemo(() => (Array.isArray(zeile?.moebel) ? zeile.moebel : []), [zeile]);
  const geschosse = useMemo(() => [...new Set(raeume.map((/** @type {any} */ r) => String(r.geschoss || '')))], [raeume]);
  const [geschoss, setGeschoss] = useState(/** @type {string|null} */ (null));
  const [moebel, setMoebel] = useState(/** @type {any[]} */ (freigegeben));
  const [verlauf, setVerlauf] = useState(/** @type {any[][]} */ ([]));
  const [gewaehlt, setGewaehlt] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');
  const [fehler, setFehler] = useState('');
  const svgRef = useRef(/** @type {SVGSVGElement|null} */ (null));
  const zugRef = useRef(/** @type {{ key: string, dx: number, dy: number, vorher: any[] }|null} */ (null));

  const aktiv = geschoss ?? geschosse[0] ?? '';
  const sichtbar = raeume.filter((/** @type {any} */ r) => String(r.geschoss || '') === aktiv);
  const raumNach = useMemo(() => new Map(raeume.map((/** @type {any} */ r) => [r.schluessel, r])), [raeume]);
  const schluessel = (/** @type {any} */ m) => `${m.raum}\u0000${m.id}`;
  const aenderungen = useMemo(() => aenderungenAus(freigegeben, moebel), [freigegeben, moebel]);

  // drawing frame of the storey in metres
  const rahmen = useMemo(() => {
    const p = sichtbar.flatMap((/** @type {any} */ r) => r.punkte);
    if (!p.length) return null;
    const x0 = Math.min(...p.map((/** @type {any} */ q) => q.x)) - RAND_M, y0 = Math.min(...p.map((/** @type {any} */ q) => q.y)) - RAND_M;
    const x1 = Math.max(...p.map((/** @type {any} */ q) => q.x)) + RAND_M, y1 = Math.max(...p.map((/** @type {any} */ q) => q.y)) + RAND_M;
    return { x0, y0, b: x1 - x0, h: y1 - y0 };
  }, [sichtbar]);

  if (!raeume.length) return null;

  /** Pointer position in metres of the drawing. @param {{clientX: number, clientY: number}} e */
  const meter = (e) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new window.DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  /** Replaces one piece. @param {any} neu */
  const setze = (neu) => setMoebel((alle) => alle.map((m) => (schluessel(m) === schluessel(neu) ? neu : m)));
  /** One undo step with the state before a change. @param {any[]} vorher */
  const merke = (vorher) => setVerlauf((v) => [...v.slice(-98), vorher]);

  /** @param {React.PointerEvent} e @param {any} m */
  const runter = (e, m) => {
    setGewaehlt(schluessel(m));
    setMeldung(''); setFehler('');
    const p = meter(e);
    if (!p) return;
    zugRef.current = { key: schluessel(m), dx: m.x - p.x, dy: m.y - p.y, vorher: moebel };
    /** @type {Element} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
  };
  /** @param {React.PointerEvent} e */
  const bewegt = (e) => {
    const z = zugRef.current;
    const p = z ? meter(e) : null;
    if (!z || !p) return;
    const m = moebel.find((x) => schluessel(x) === z.key);
    const raum = m ? raumNach.get(m.raum) : null;
    if (!m || !raum) return;
    const neu = platzieren(m, p.x + z.dx, p.y + z.dy, raum.punkte);
    if (neu !== m) setze(neu);
  };
  const hoch = () => {
    const z = zugRef.current;
    zugRef.current = null;
    // the whole drag is one undo step, and only when the piece really moved
    if (z && JSON.stringify(z.vorher) !== JSON.stringify(moebel)) merke(z.vorher);
  };

  const gewaehltes = moebel.find((m) => schluessel(m) === gewaehlt) || null;
  const dreheGewaehltes = () => {
    const raum = gewaehltes ? raumNach.get(gewaehltes.raum) : null;
    if (!gewaehltes || !raum) return;
    const neu = drehen(gewaehltes, raum.punkte);
    if (neu === gewaehltes) { setFehler(t('Gedreht passt das Möbel hier nicht in den Raum — erst verschieben.')); return; }
    setFehler('');
    merke(moebel); setze(neu);
  };
  /** @param {React.KeyboardEvent} e @param {any} m */
  const taste = (e, m) => {
    const raum = raumNach.get(m.raum);
    if (!raum) return;
    const schritt = { ArrowLeft: [-TASTEN_M, 0], ArrowRight: [TASTEN_M, 0], ArrowUp: [0, -TASTEN_M], ArrowDown: [0, TASTEN_M] }[e.key];
    if (schritt) {
      e.preventDefault();
      const neu = platzieren(m, m.x + schritt[0], m.y + schritt[1], raum.punkte, { fang_m: 0 });
      if (neu !== m) { merke(moebel); setze(neu); }
    } else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setGewaehlt(schluessel(m)); const neu = drehen(m, raum.punkte); if (neu !== m) { merke(moebel); setze(neu); } }
  };
  const rueckgaengig = () => {
    const letzter = verlauf[verlauf.length - 1];
    if (!letzter) return;
    setVerlauf((v) => v.slice(0, -1));
    setMoebel(letzter);
  };
  const zuruecksetzen = () => { if (aenderungen.length) merke(moebel); setMoebel(freigegeben); setGewaehlt(null); };

  const senden = async () => {
    setBusy(true); setFehler(''); setMeldung('');
    try {
      await onRueckmeldung?.({ art: 'moeblierung', bezug: zeile, vorschlag: vorschlagText(aenderungen) });
      setMeldung(t('Ihr Vorschlag ist beim Büro angekommen. Das Büro prüft ihn und meldet sich.'));
      setVerlauf([]);
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // furniture of the storey shown; a piece overlapping another one of its room is marked (reported, not forbidden)
  const imGeschoss = moebel.filter((m) => sichtbar.some((/** @type {any} */ r) => r.schluessel === m.raum));
  const kollidiert = new Set(imGeschoss.filter((a) => imGeschoss.some((b) => a !== b && a.raum === b.raum && ueberlappt(a, b))).map(schluessel));
  const geaendert = new Set(aenderungen.map(([rk, id]) => `${rk}\u0000${id}`));
  const darfSenden = zeile.aenderbar === true && !vorschau;
  // label size in metres so it reads at every sheet size: 1.6 % of the longer side, at least 12 cm
  const schrift = rahmen ? Math.max(0.12, Math.max(rahmen.b, rahmen.h) * 0.016) : 0.15;

  return (
    <div className="mt-2 space-y-2" data-testid="bauherr-moeblierung">
      <p className={`text-xs ${flaecheLeise}`}>
        {t('Möbel antippen und ziehen. Sie bleiben im Raum und rasten an der Wand ein. Gespeichert wird nichts — erst „Vorschlag senden“ schickt Ihre Fassung ans Büro.')}
      </p>
      {geschosse.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('Geschoss')}>
          {geschosse.map((g) => (
            <button key={g} type="button" className={g === aktiv ? knopf : knopfLeise} aria-pressed={g === aktiv} data-testid="bauherr-moebel-geschoss"
              onClick={() => { setGeschoss(g); setGewaehlt(null); }}>{g || t('Geschoss')}</button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={knopfLeise} disabled={!gewaehltes} onClick={dreheGewaehltes} data-testid="bauherr-moebel-drehen">{t('Drehen')}</button>
        <button type="button" className={knopfLeise} disabled={!verlauf.length} onClick={rueckgaengig} data-testid="bauherr-moebel-undo">{t('Rückgängig')}</button>
        <button type="button" className={knopfLeise} disabled={!aenderungen.length} onClick={zuruecksetzen} data-testid="bauherr-moebel-zurueck">{t('Alles wie freigegeben')}</button>
      </div>
      {/* its own line with a fixed height: the plan below must not jump when a piece is picked (a jump under the finger moves the piece) */}
      <p className={`min-h-[1.25rem] truncate text-xs ${flaecheLeise}`} data-testid="bauherr-moebel-anzahl" data-anzahl={aenderungen.length}>
        {gewaehltes ? `${gewaehltes.name} · ` : ''}{aenderungen.length} {t('Möbel geändert')}
      </p>
      {rahmen && (
        <svg ref={svgRef} viewBox={`${rahmen.x0} ${rahmen.y0} ${rahmen.b} ${rahmen.h}`} role="group" aria-label={`${t('Möblierung')} ${aktiv}`}
          className="w-full max-h-[70vh] rounded-md border border-border bg-card" style={{ touchAction: 'none' }}
          onPointerMove={bewegt} onPointerUp={hoch} onPointerCancel={hoch} data-testid="bauherr-moebel-plan">
          {sichtbar.map((/** @type {any} */ r) => (
            <g key={r.schluessel}>
              <polygon points={r.punkte.map((/** @type {any} */ q) => `${q.x},${q.y}`).join(' ')} className="fill-muted stroke-foreground" strokeWidth={schrift * 0.25} strokeLinejoin="round"
                onPointerDown={() => setGewaehlt(null)} data-raum={r.schluessel} />
              <text x={r.punkte.reduce((/** @type {number} */ s, /** @type {any} */ q) => s + q.x, 0) / r.punkte.length} y={Math.min(...r.punkte.map((/** @type {any} */ q) => q.y)) + schrift * 1.4}
                textAnchor="middle" fontSize={schrift} className="fill-muted-foreground" style={{ pointerEvents: 'none' }}>{r.name}</text>
            </g>
          ))}
          {imGeschoss.map((m) => {
            const k = moebelBox(m), key = schluessel(m), an = key === gewaehlt;
            const raum = raumNach.get(m.raum);
            const draussen = raum ? !stehtImRaum(m, raum.punkte) : false;
            return (
              <g key={key} tabIndex={0} role="button" aria-pressed={an}
                aria-label={`${m.name}, ${t('Raum')} ${raum?.name || ''}${geaendert.has(key) ? `, ${t('geändert')}` : ''}`}
                className="cursor-grab outline-none focus-visible:[&>rect]:stroke-ring" data-testid="bauherr-moebel" data-id={m.id} data-x={m.x} data-y={m.y} data-rot={m.rot}
                data-geaendert={geaendert.has(key) ? '1' : undefined}
                onPointerDown={(e) => runter(e, m)} onFocus={() => setGewaehlt(key)} onKeyDown={(e) => taste(e, m)}>
                <rect x={k.x0} y={k.y0} width={k.x1 - k.x0} height={k.y1 - k.y0} rx={schrift * 0.3}
                  className={`${an ? 'fill-accent stroke-primary' : 'fill-card stroke-foreground'} ${kollidiert.has(key) || draussen ? 'stroke-warnung' : ''}`}
                  strokeWidth={schrift * (an ? 0.35 : 0.18)} strokeDasharray={geaendert.has(key) ? `${schrift * 0.6} ${schrift * 0.4}` : undefined} />
                <text x={m.x} y={m.y + schrift * 0.35} textAnchor="middle" fontSize={schrift * 0.9} className="fill-foreground" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {String(m.name).length * schrift * 0.5 <= k.x1 - k.x0 ? m.name : String(m.name).slice(0, 2)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {kollidiert.size > 0 && <p role="status" className={`rounded-md ${flaecheWarnung} px-3 py-2 text-sm`}>{t('Einige Möbel überlappen sich. Sie können den Vorschlag trotzdem senden — das Büro sieht den Hinweis.')}</p>}
      {fehler && <p role="alert" className={`rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{fehler}</p>}
      {meldung && <p role="status" className={`rounded-md ${flaecheErfolg} px-3 py-2 text-sm`}>{meldung}</p>}
      {zeile.aenderbar === true ? (
        <button type="button" className={knopf} disabled={busy || !aenderungen.length || !darfSenden} onClick={senden} data-testid="bauherr-moebel-senden"
          title={vorschau ? t('Vorschau: hier wird nichts gesendet.') : undefined}>
          {busy ? t('Wird gesendet …') : t('Vorschlag senden')}
        </button>
      ) : (
        <p className={`text-xs ${flaecheLeise}`}>{t('Zum Ansehen freigegeben — das Büro hat keinen Vorschlag angefragt.')}</p>
      )}
    </div>
  );
}
