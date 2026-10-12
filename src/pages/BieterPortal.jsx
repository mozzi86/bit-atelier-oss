// Bidder portal — the whole app for an EXTERNAL role (Phase 74-01 Task 14).
//
// App.jsx renders this instead of the office shell when the signed-in user's
// role is bidder/investor/gast (cloud build only). Externals never see AVA.jsx:
// its 16-entity Promise.all (AVA.jsx:90-110) would ask for Contact,
// LVPosition, Tender … — RLS answers with nothing, but the portal should not
// even ask. It reads exactly four kinds: TenderFreigabe, MengenFreigabe (the
// projections released by the office, 0012), the caller's own Bid and
// BcfRueckfrage rows.
//
// Writing: one bid per tender while the deadline runs (the database seals it,
// 0008/0011), withdrawal via RPC, questions as own rows. Prices are entered per
// released position; the bid carries line_items in the shape the office's
// price comparison reads (lib/bieterPortal.js).
//
// What this screen does NOT do yet (open in 74-01): attachments (bucket
// `gebote`, 0013), downloads of released model views (edge function
// `freigabe`), answers of the office to questions (projection, 0012).
//
// In:  the signed-in user (AuthContext). Out: the page. Side effects: entity
//      reads/writes through bitApi, RPC gebot_zuruecknehmen.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { bitApi } from '@core/api/bitApi';
import { gebotZuruecknehmen } from '@core/api/zugriff';
import { useAuth } from '@core/lib/AuthContext';
import { useI18n } from '@core/lib/i18n';
import { fristStatus, gebotAusPreisen, portalVergaben, vergabeVon } from '@ava/lib/bieterPortal';

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const DATUM = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** @param {string|undefined} iso @returns {string} */
const datum = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? DATUM.format(new Date(t)) : '—';
};

const feldKlasse =
  'w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
const knopfKlasse =
  'rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50';
const knopfLeise =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

/**
 * One released tender: quantities, own bid or the price form, own questions.
 * @param {{ eintrag: ReturnType<typeof portalVergaben>[number], fragen: any[], name: string,
 *   onGeaendert: () => void }} props
 * @returns {React.ReactElement}
 */
function VergabeKarte({ eintrag, fragen, name, onGeaendert }) {
  const { t } = useI18n();
  const { vergabe, mengen, gebot } = eintrag;
  const id = vergabeVon(vergabe);
  const status = fristStatus(vergabe.frist);
  const [preise, setPreise] = useState(/** @type {Record<string, string>} */ ({}));
  const [frage, setFrage] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const entwurf = useMemo(() => gebotAusPreisen(mengen, preise), [mengen, preise]);

  /** @param {() => Promise<unknown>} fn */
  const ausfuehren = async (fn) => {
    setBusy(true);
    setFehler('');
    try {
      await fn();
      onGeaendert();
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const abgeben = () => ausfuehren(() => bitApi.entities.Bid.create({
    tender_id: id,
    bidder_name: name,
    status: 'submitted',
    line_items: entwurf.line_items,
    total: entwurf.total,
  }));

  const zurueckziehen = () => {
    if (!gebot) return;
    if (!window.confirm(t('Angebot wirklich zurückziehen? Ein neues Angebot zu dieser Vergabe ist danach nicht möglich.'))) return;
    ausfuehren(() => gebotZuruecknehmen(gebot.id));
  };

  const fragen_ = fragen.filter((f) => String(f.tender_id || '') === id);
  const fragen_stellen = () => ausfuehren(async () => {
    await bitApi.entities.BcfRueckfrage.create({ tender_id: id, project_id: vergabe.project_id, text: frage.trim() });
    setFrage('');
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="portal-vergabe">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{vergabe.name || t('Vergabe')}</h2>
          {vergabe.trade && <p className="text-xs text-slate-500">{vergabe.trade}</p>}
        </div>
        <p className={`text-sm ${status === 'laeuft' ? 'text-emerald-700' : 'text-slate-500'}`}>
          {t('Angebotsfrist')}: {datum(vergabe.frist)}
          {' · '}
          {status === 'laeuft' ? t('läuft') : status === 'abgelaufen' ? t('abgelaufen') : t('nicht angegeben')}
        </p>
      </header>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2 font-medium">{t('OZ')}</th>
            <th className="py-1 pr-2 font-medium">{t('Kurztext')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('Menge')}</th>
            <th className="py-1 pr-2 font-medium">{t('Einheit')}</th>
            {!gebot && status === 'laeuft' && <th className="py-1 text-right font-medium">{t('Einheitspreis (€)')}</th>}
          </tr>
        </thead>
        <tbody>
          {mengen.map((m) => (
            <tr key={m.id} className="border-b border-slate-100">
              <td className="py-1 pr-2 font-mono text-xs">{m.oz}</td>
              <td className="py-1 pr-2">{m.kurztext}</td>
              <td className="py-1 pr-2 text-right">{m.quantity}</td>
              <td className="py-1 pr-2">{m.unit}</td>
              {!gebot && status === 'laeuft' && (
                <td className="py-1 text-right">
                  <input
                    aria-label={`${t('Einheitspreis')} ${m.oz || ''}`}
                    inputMode="decimal"
                    value={preise[m.id] || ''}
                    onChange={(e) => setPreise((p) => ({ ...p, [m.id]: e.target.value }))}
                    className={feldKlasse}
                  />
                </td>
              )}
            </tr>
          ))}
          {mengen.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-center text-slate-500">{t('Noch keine Mengen freigegeben.')}</td></tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 space-y-2 text-sm">
        {gebot ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2" data-testid="portal-eigenes-gebot">
            <span>
              {t('Ihr Angebot')}: <strong>{EURO.format(Number(gebot.total) || 0)}</strong>
              {' · '}{t('abgegeben')} {datum(gebot.submitted_date || gebot.created_date)}
              {' · '}{gebot.status === 'zurueckgezogen' ? t('zurückgezogen') : gebot.status === 'awarded' ? t('Zuschlag erteilt') : gebot.status === 'rejected' ? t('nicht berücksichtigt') : t('eingegangen')}
            </span>
            {status === 'laeuft' && gebot.status !== 'zurueckgezogen' && (
              <button type="button" className={knopfLeise} disabled={busy} onClick={zurueckziehen}>{t('Angebot zurückziehen')}</button>
            )}
          </div>
        ) : status === 'laeuft' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('Summe')}: <strong>{EURO.format(entwurf.total)}</strong>
              {entwurf.fehlend.length > 0 && mengen.length > 0 && (
                <span className="ml-2 text-xs text-amber-700">{t('Ohne Preis')}: {entwurf.fehlend.join(', ')}</span>
              )}
            </span>
            <button type="button" className={knopfKlasse} disabled={busy || !entwurf.ok} onClick={abgeben}>{t('Angebot abgeben')}</button>
          </div>
        ) : (
          <p className="text-slate-500">{t('Die Angebotsfrist ist abgelaufen; ein Angebot ist nicht mehr möglich.')}</p>
        )}
        {fehler && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{fehler}</p>}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-semibold text-slate-700">{t('Ihre Rückfragen')}</h3>
        {fragen_.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">{t('Noch keine Rückfragen.')}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {fragen_.map((f) => <li key={f.id} className="rounded bg-slate-50 px-2 py-1">{f.text}</li>)}
          </ul>
        )}
        {status === 'laeuft' && (
          <div className="mt-2 flex gap-2">
            <label htmlFor={`frage-${id}`} className="sr-only">{t('Rückfrage stellen')}</label>
            <input
              id={`frage-${id}`}
              value={frage}
              onChange={(e) => setFrage(e.target.value)}
              placeholder={t('Rückfrage stellen')}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <button type="button" className={knopfLeise} disabled={busy || !frage.trim()} onClick={fragen_stellen}>{t('Senden')}</button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The portal page.
 * @returns {React.ReactElement}
 */
export default function BieterPortal() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const [daten, setDaten] = useState(/** @type {{ vergaben: any[], mengen: any[], gebote: any[], fragen: any[] } | null} */ (null));
  const [fehler, setFehler] = useState('');

  const laden = useCallback(async () => {
    setFehler('');
    try {
      const [vergaben, mengen, gebote, fragen] = await Promise.all([
        bitApi.entities.TenderFreigabe.list(),
        bitApi.entities.MengenFreigabe.list(),
        bitApi.entities.Bid.list(),
        bitApi.entities.BcfRueckfrage.list(),
      ]);
      setDaten({ vergaben, mengen, gebote, fragen });
    } catch (e) {
      setFehler(String(/** @type {any} */ (e)?.message || e));
      setDaten({ vergaben: [], mengen: [], gebote: [], fragen: [] });
    }
  }, []);

  useEffect(() => { laden(); }, [laden]);

  const eintraege = useMemo(
    () => (daten ? portalVergaben(daten.vergaben, daten.mengen, daten.gebote) : []),
    [daten],
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800">{t('Bieterportal')}</h1>
            <p className="text-xs text-slate-500">BIT-Atelier</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{user?.email}</span>
            <button type="button" className={knopfLeise} onClick={() => logout()}>{t('Abmelden')}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6" data-testid="bieterportal">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
          {t('Ihr Angebot ist bis zur Öffnung nach Fristablauf nur für Sie lesbar und danach nicht mehr änderbar. Ein technischer Verschluss gegenüber dem Betreiber der Plattform findet nicht statt.')}
        </p>
        {fehler && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{fehler}</p>}
        {!daten && <p className="text-sm text-slate-500">{t('Wird geladen …')}</p>}
        {daten && eintraege.length === 0 && !fehler && (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
            {t('Für Sie ist derzeit keine Vergabe freigegeben.')}
          </p>
        )}
        {eintraege.map((e) => (
          <VergabeKarte
            key={vergabeVon(e.vergabe)}
            eintrag={e}
            fragen={daten?.fragen || []}
            name={user?.full_name || user?.email || ''}
            onGeaendert={laden}
          />
        ))}
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-6 text-center text-xs text-slate-500">
        <Link to="/impressum" className="underline hover:text-slate-700">{t('Impressum')}</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/datenschutz" className="underline hover:text-slate-700">{t('Datenschutz')}</Link>
      </footer>
    </div>
  );
}
