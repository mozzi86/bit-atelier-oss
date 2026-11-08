// BauherrAnsicht — what the client of a project sees (Phase 110-02).
//
// ONE presentation for two places: the client portal (src/pages/BauherrPortal.jsx,
// cloud build, projections read from the database) and the office preview on
// /Bauherrenzugang ("so sieht es der Bauherr", projections built locally with
// the same whitelist). The component never reads entities itself; it gets the
// grouped rows of portalAufbereiten() and callbacks.
//
// In:  daten (portalAufbereiten), vorschau flag, callbacks for a decision or
//      question, a file download, the URL of the released 3D model (110-05)
//      and an upload. Out: the rendered view.
//      Side effects: only through the callbacks.

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useI18n } from '@core/lib/i18n';
import { BAUHERR_LABELS, rueckmeldungPruefen } from '@core/lib/bauherrProjektion';
import { flaecheAntwort, flaecheFeld, flaecheFehler, flaecheKarte, flaecheKnopf, flaecheKnopfLeise, flaecheLeise, flaecheRuhe, flaecheTitel } from '@core/lib/portalFlaeche';

// 110-05: the viewer (three, GLTFLoader) only loads when the client opens a model.
const Modell3D = lazy(() => import('./Modell3D'));

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const DATUM = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

/** @param {unknown} iso @returns {string} German date or '—' */
const datum = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? DATUM.format(new Date(t)) : '—';
};
/** @param {unknown} n @returns {string} euro amount or '—' */
const euro = (n) => (typeof n === 'number' && Number.isFinite(n) ? EURO.format(n) : '—');

const karte = `rounded-xl ${flaecheKarte} p-4 shadow-sm`;
const knopf = `rounded-md ${flaecheKnopf} px-3 py-1.5 text-sm font-medium disabled:opacity-50`;
const knopfLeise = `rounded-md ${flaecheKnopfLeise} px-3 py-1.5 text-sm font-medium disabled:opacity-50`;

/**
 * @typedef {{
 *   onRueckmeldung?: (eingabe: { art: string, bezug?: Record<string, any>|null, text?: string, option?: string }) => Promise<void>,
 *   onDatei?: (zeile: Record<string, any>) => void,
 *   onDateiUrl?: (zeile: Record<string, any>) => Promise<string>,
 *   onHochladen?: (datei: File, text: string) => Promise<void>,
 * }} Aktionen
 */

/**
 * Decision bar of one projection that asks for a decision.
 * @param {{ zeile: Record<string, any>, entscheidung: Record<string, any>|undefined, vorschau: boolean,
 *   onRueckmeldung?: Aktionen['onRueckmeldung'] }} props
 * @returns {React.ReactElement|null}
 */
function Entscheidung({ zeile, entscheidung, vorschau, onRueckmeldung }) {
  const { t } = useI18n();
  const [option, setOption] = useState('');
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  if (zeile.entscheidung_offen !== true) return null;
  const optionen = Array.isArray(zeile.optionen) ? zeile.optionen : [];
  const mehrere = optionen.length > 1;

  /** @param {string} art */
  const senden = async (art) => {
    const eingabe = { art, bezug: zeile, text, option: art === 'auswahl' ? option : undefined };
    const p = rueckmeldungPruefen(eingabe, zeile);
    if (!p.ok) { setFehler(t(p.grund || '')); return; }
    setFehler('');
    setBusy(true);
    try {
      await onRueckmeldung?.(eingabe);
      setText('');
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-warnung-flaeche p-3 text-sm text-warnung" data-testid="bauherr-entscheidung">
      {entscheidung ? (
        <p>
          {t('Ihre Entscheidung')}: <strong>{entscheidung.art === 'freigabe' ? t('freigegeben') : entscheidung.art === 'ablehnung' ? t('abgelehnt') : `${t('Auswahl')} ${entscheidung.option || ''}`}</strong>
          {' · '}{datum(entscheidung.zeitpunkt || entscheidung.created_date)}
        </p>
      ) : (
        <p className="font-medium">{t('Ihre Entscheidung ist angefragt.')}</p>
      )}
      {mehrere && (
        <fieldset className="space-y-1">
          <legend className="sr-only">{t('Option wählen')}</legend>
          {optionen.map((/** @type {any} */ o) => (
            <label key={o.schluessel} className="flex items-center gap-2">
              <input type="radio" name={`opt-${zeile.id}`} value={o.schluessel} checked={option === o.schluessel} onChange={() => setOption(o.schluessel)} />
              <span>{o.titel || o.schluessel}{typeof o.mehrkosten_brutto === 'number' ? ` (${euro(o.mehrkosten_brutto)})` : ''}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label htmlFor={`bem-${zeile.id}`} className="sr-only">{t('Bemerkung (optional)')}</label>
      <input
        id={`bem-${zeile.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('Bemerkung (optional)')}
        className={`w-full rounded-md ${flaecheFeld} px-2 py-1 text-sm`}
        disabled={vorschau || busy}
      />
      <div className="flex flex-wrap gap-2">
        {mehrere ? (
          <button type="button" className={knopf} disabled={vorschau || busy || !option} onClick={() => senden('auswahl')}>{t('Auswahl senden')}</button>
        ) : (
          <button type="button" className={knopf} disabled={vorschau || busy} onClick={() => senden('freigabe')}>{t('Freigeben')}</button>
        )}
        <button type="button" className={knopfLeise} disabled={vorschau || busy} onClick={() => senden('ablehnung')}>{t('Ablehnen')}</button>
      </div>
      {fehler && <p role="alert" className="text-fehler">{fehler}</p>}
    </div>
  );
}

/**
 * "3D ansehen" of a released building model (110-05): asks for the URL of the
 * GLB, then shows the lazy viewer below the row. A blob URL (office preview)
 * is released again when the view closes.
 * @param {{ zeile: Record<string, any>, onDateiUrl: NonNullable<Aktionen['onDateiUrl']> }} props
 * @returns {React.ReactElement}
 */
function ModellAnsicht({ zeile, onDateiUrl }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, [url]);

  const umschalten = async () => {
    if (url) { setUrl(''); return; }
    setBusy(true);
    setFehler('');
    try {
      setUrl(await onDateiUrl(zeile));
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <button type="button" className={knopfLeise} disabled={busy} aria-expanded={Boolean(url)} data-testid="bauherr-modell-oeffnen" onClick={umschalten}>
        {url ? t('3D-Ansicht schließen') : busy ? t('Wird geladen …') : t('3D ansehen')}
      </button>
      {fehler && <p role="alert" className={`rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{fehler}</p>}
      {url && (
        <Suspense fallback={<p className={`text-sm ${flaecheLeise}`}>{t('Gebäudemodell wird geladen …')}</p>}>
          <Modell3D url={url} titel={zeile.titel} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * One row of a section.
 * @param {{ art: string, zeile: Record<string, any>, entscheidung: Record<string, any>|undefined, vorschau: boolean } & Aktionen} props
 * @returns {React.ReactElement}
 */
function Eintrag({ art, zeile, entscheidung, vorschau, onRueckmeldung, onDatei, onDateiUrl }) {
  const { t } = useI18n();
  /** @type {React.ReactNode} */
  let inhalt;
  switch (art) {
    case 'BauherrTermin':
      inhalt = <p>{datum(zeile.beginn)}{zeile.ende ? ` – ${datum(zeile.ende)}` : ''} · <strong>{zeile.titel}</strong>{zeile.art ? ` · ${t(zeile.art)}` : ''}</p>;
      break;
    case 'BauherrPlan':
      inhalt = (
        <p>
          <span className="font-mono text-xs">{zeile.plannummer}{zeile.index ? ` ${t('Index')} ${zeile.index}` : ''}</span>{' '}
          <strong>{zeile.titel}</strong>{zeile.massstab ? ` · ${zeile.massstab}` : ''} · {t(zeile.status || '')} · {t('Stand')} {datum(zeile.stand)}
        </p>
      );
      break;
    case 'BauherrKosten':
      inhalt = (
        <div>
          <p><strong>{t(zeile.titel || 'Kosten')}</strong> · {t('Stand')} {datum(zeile.stand)}</p>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className={`border-b border-border text-left text-xs ${flaecheLeise}`}>
                <th className="py-1 pr-2 font-medium">{t('Kostengruppe')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('netto')}</th>
                <th className="py-1 text-right font-medium">{t('brutto')}</th>
              </tr>
            </thead>
            <tbody>
              {(zeile.gruppen || []).map((/** @type {any} */ g, /** @type {number} */ i) => (
                <tr key={g.kg || `ohne-kg-${i}`} className="border-b border-border">
                  <td className="py-1 pr-2">{g.kg ? `${g.kg} ` : ''}{g.bezeichnung ? t(g.bezeichnung) : ''}</td>
                  <td className="py-1 pr-2 text-right">{euro(g.betrag_netto)}</td>
                  <td className="py-1 text-right">{euro(g.betrag_brutto)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1 pr-2">{t('Summe')}</td>
                <td className="py-1 pr-2 text-right">{euro(zeile.summe_netto)}</td>
                <td className="py-1 text-right">{euro(zeile.summe_brutto)}</td>
              </tr>
            </tbody>
          </table>
          {zeile.hinweis && <p className={`mt-1 text-xs ${flaecheLeise}`}>{zeile.hinweis}</p>}
        </div>
      );
      break;
    case 'BauherrBemusterung':
      inhalt = (
        <div>
          <p><strong>{zeile.titel}</strong>{zeile.raum ? ` · ${zeile.raum}` : ''}{zeile.frist ? ` · ${t('Frist')} ${datum(zeile.frist)}` : ''}</p>
          {(zeile.optionen || []).length === 1 && (
            <p className={flaecheLeise}>
              {zeile.optionen[0].titel}{zeile.optionen[0].beschreibung ? ` — ${zeile.optionen[0].beschreibung}` : ''}
              {typeof zeile.optionen[0].mehrkosten_brutto === 'number' ? ` · ${t('Mehrkosten')} ${euro(zeile.optionen[0].mehrkosten_brutto)}` : ''}
            </p>
          )}
        </div>
      );
      break;
    case 'BauherrRechnung':
      inhalt = (
        <p>
          <strong>{t(zeile.titel || 'Rechnung')} {zeile.nummer}</strong> · {datum(zeile.datum)} · {euro(zeile.betrag_brutto)}
          {zeile.faellig_am ? ` · ${t('fällig')} ${datum(zeile.faellig_am)}` : ''} · {t(zeile.status || '')}
        </p>
      );
      break;
    case 'BauherrBeteiligter':
      inhalt = (
        <ul className="space-y-1">
          {(zeile.personen || []).map((/** @type {any} */ p, /** @type {number} */ i) => (
            <li key={i}>
              <strong>{p.name}</strong>{p.rolle ? ` · ${p.rolle}` : ''}{p.firma && p.firma !== p.name ? ` · ${p.firma}` : ''}
              {p.email && <> · <a className="underline" href={`mailto:${p.email}`}>{p.email}</a></>}
              {p.telefon ? ` · ${p.telefon}` : ''}
            </li>
          ))}
        </ul>
      );
      break;
    default:
      inhalt = <p><strong>{zeile.titel}</strong>{zeile.kategorie ? ` · ${zeile.kategorie}` : ''}{zeile.datum || zeile.stand ? ` · ${datum(zeile.datum || zeile.stand)}` : ''}{zeile.bemerkung ? ` — ${zeile.bemerkung}` : ''}</p>;
  }
  return (
    <li className="py-2" data-testid={`bauherr-zeile-${art}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className={`min-w-0 flex-1 text-sm ${flaecheTitel}`}>{inhalt}</div>
        {zeile.datei && art !== 'BauherrModell' && (
          <button type="button" className={knopfLeise} disabled={vorschau} onClick={() => onDatei?.(zeile)}>{t('Datei öffnen')}</button>
        )}
      </div>
      {/* The model opens read-only, so also in the office preview (local copy of the studio's file). */}
      {art === 'BauherrModell' && onDateiUrl && zeile.datei && <ModellAnsicht zeile={zeile} onDateiUrl={onDateiUrl} />}
      <Entscheidung zeile={zeile} entscheidung={entscheidung} vorschau={vorschau} onRueckmeldung={onRueckmeldung} />
    </li>
  );
}

/**
 * The client view of one project.
 * @param {{ daten: ReturnType<typeof import('@core/lib/bauherrProjektion').portalAufbereiten>, vorschau?: boolean } & Aktionen} props
 *   vorschau: office preview — every button is disabled except the read-only 3D view
 * @returns {React.ReactElement}
 */
export default function BauherrAnsicht({ daten, vorschau = false, onRueckmeldung, onDatei, onDateiUrl, onHochladen }) {
  const { t } = useI18n();
  const [frage, setFrage] = useState('');
  const [datei, setDatei] = useState(/** @type {File|null} */ (null));
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const p = daten.projekt;
  const leer = !p && Object.values(daten.abschnitte).every((l) => l.length === 0);

  /** @param {() => Promise<void>} fn */
  const ausfuehren = async (fn) => {
    setBusy(true);
    setFehler('');
    try { await fn(); } catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); } finally { setBusy(false); }
  };
  const fragen = () => ausfuehren(async () => {
    const eingabe = { art: 'frage', text: frage };
    const pr = rueckmeldungPruefen(eingabe);
    if (!pr.ok) throw new Error(t(pr.grund || ''));
    await onRueckmeldung?.(eingabe);
    setFrage('');
  });
  const hochladen = () => ausfuehren(async () => {
    if (!datei) return;
    await onHochladen?.(datei, notiz);
    setDatei(null);
    setNotiz('');
  });

  /** @type {Map<string, Record<string, any>[]>} */
  const antwortenJe = new Map();
  for (const a of daten.antworten) antwortenJe.set(a.bezug_id, [...(antwortenJe.get(a.bezug_id) || []), a]);
  const fragenListe = daten.rueckmeldungen.filter((r) => r.art === 'frage' || r.art === 'kommentar');

  return (
    <div className="space-y-4" data-testid="bauherr-ansicht">
      {p && (
        <section className={karte} aria-labelledby="bh-projekt">
          <h2 id="bh-projekt" className={`text-lg font-semibold ${flaecheTitel}`}>{p.name || t('Ihr Projekt')}</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {p.adresse && <div><dt className={`inline ${flaecheLeise}`}>{t('Adresse')}: </dt><dd className="inline">{p.adresse}</dd></div>}
            {p.status && <div><dt className={`inline ${flaecheLeise}`}>{t('Stand')}: </dt><dd className="inline">{t(p.status)}</dd></div>}
            {p.phase && <div><dt className={`inline ${flaecheLeise}`}>{t('Phase')}: </dt><dd className="inline">{p.phase}</dd></div>}
            {p.baubeginn && <div><dt className={`inline ${flaecheLeise}`}>{t('Baubeginn')}: </dt><dd className="inline">{datum(p.baubeginn)}</dd></div>}
            {p.fertigstellung && <div><dt className={`inline ${flaecheLeise}`}>{t('Fertigstellung')}: </dt><dd className="inline">{datum(p.fertigstellung)}</dd></div>}
          </dl>
          {p.hinweis && <p className="mt-2 text-sm">{p.hinweis}</p>}
        </section>
      )}

      {leer && (
        <p className={`rounded-md ${flaecheKarte} px-4 py-6 text-center text-sm ${flaecheLeise}`}>
          {t('Für Sie ist noch nichts freigegeben.')}
        </p>
      )}

      {Object.entries(daten.abschnitte).filter(([, liste]) => liste.length > 0).map(([art, liste]) => (
        <section key={art} className={karte} aria-labelledby={`bh-${art}`} data-testid={`bauherr-abschnitt-${art}`}>
          <h2 id={`bh-${art}`} className={`text-base font-semibold ${flaecheTitel}`}>{t(BAUHERR_LABELS[/** @type {keyof typeof BAUHERR_LABELS} */ (art)] || art)}</h2>
          <ul className="mt-1 divide-y divide-border">
            {liste.map((z, i) => (
              <Eintrag key={z.id || i} art={art} zeile={z} entscheidung={z.id ? daten.entscheidungen.get(z.id) : undefined}
                vorschau={vorschau} onRueckmeldung={onRueckmeldung} onDatei={onDatei} onDateiUrl={onDateiUrl} />
            ))}
          </ul>
        </section>
      ))}

      <section className={karte} aria-labelledby="bh-fragen">
        <h2 id="bh-fragen" className={`text-base font-semibold ${flaecheTitel}`}>{t('Fragen an das Büro')}</h2>
        {fragenListe.length === 0 && <p className={`mt-1 text-xs ${flaecheLeise}`}>{t('Noch keine Fragen.')}</p>}
        <ul className="mt-1 space-y-2 text-sm">
          {fragenListe.map((r) => (
            <li key={r.id} className={`rounded ${flaecheRuhe} px-2 py-1`}>
              <p>{r.text} <span className={`text-xs ${flaecheLeise}`}>· {datum(r.zeitpunkt || r.created_date)}</span></p>
              {(antwortenJe.get(r.id) || []).map((a) => <p key={a.id} className={`mt-1 border-l-2 ${flaecheAntwort} pl-2`}>{a.antwort}</p>)}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <label htmlFor="bh-frage" className="sr-only">{t('Frage stellen')}</label>
          <input id="bh-frage" value={frage} onChange={(e) => setFrage(e.target.value)} placeholder={t('Frage stellen')}
            className={`flex-1 rounded-md ${flaecheFeld} px-2 py-1 text-sm`} disabled={vorschau || busy} />
          <button type="button" className={knopfLeise} disabled={vorschau || busy || !frage.trim()} onClick={fragen}>{t('Senden')}</button>
        </div>
      </section>

      <section className={karte} aria-labelledby="bh-upload">
        <h2 id="bh-upload" className={`text-base font-semibold ${flaecheTitel}`}>{t('Eigene Unterlagen')}</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {daten.uploads.map((u) => <li key={u.id}>{u.titel} <span className={`text-xs ${flaecheLeise}`}>· {datum(u.zeitpunkt || u.created_date)}</span></li>)}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="bh-datei" className="sr-only">{t('Datei wählen')}</label>
          <input id="bh-datei" type="file" onChange={(e) => setDatei(e.target.files?.[0] || null)} disabled={vorschau || busy} className="text-sm" />
          <label htmlFor="bh-notiz" className="sr-only">{t('Bemerkung (optional)')}</label>
          <input id="bh-notiz" value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder={t('Bemerkung (optional)')}
            className={`min-w-[10rem] flex-1 rounded-md ${flaecheFeld} px-2 py-1 text-sm`} disabled={vorschau || busy} />
          <button type="button" className={knopfLeise} disabled={vorschau || busy || !datei} onClick={hochladen}>{t('Hochladen')}</button>
        </div>
      </section>

      {fehler && <p role="alert" className={`rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{fehler}</p>}
    </div>
  );
}
