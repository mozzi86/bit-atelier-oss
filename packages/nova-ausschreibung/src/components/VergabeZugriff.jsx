// Access separation controls of one tender (Phase 74-01 Task 14): deadline
// (submission), release to invited bidders, invitation, opening act, answers
// to questions.
//
// Renders NOTHING unless all three hold: cloud build (DATENQUELLE supabase),
// the 0006 schema is live (user.zugriffstrennung — before the migrations the
// RPCs do not exist and every button would end in an error), and the user has
// an internal role. Which buttons show follows lib/vergabeZugriff.js; the
// database decides again (0009/0012) — this only avoids clicks into refusals.
//
// In:  tender (records row as the client sees it), contacts (for the
//      invitation), onGeaendert (reload after a change).
// Out: the panel. Side effects: RPCs via @core/api/zugriff, edge function
//      `einladung`, BcfRueckfrage list.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { bitApi } from "@core/api/bitApi";
import {
  einladungSenden, freigabeErteilen, freigabeZuruecknehmen, rueckfrageBeantworten, submissionAnlegen,
  submissionFrist, submissionLesen, submissionOeffnen,
} from "@core/api/zugriff";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { fristAusEingabe, vergabeAktionen } from "../lib/vergabeZugriff";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * @param {{ tender: any, contacts?: any[], onGeaendert?: () => void }} props
 * @returns {React.ReactElement|null}
 */
export default function VergabeZugriff({ tender, contacts = [], onGeaendert }) {
  const { user } = useAuth();
  const aktiv = DATENQUELLE === "supabase" && user?.zugriffstrennung === true && user?.intern === true;
  if (!aktiv) return null;
  return <VergabeZugriffInhalt tender={tender} contacts={contacts} rolle={user.role} onGeaendert={onGeaendert} />;
}

/**
 * @param {{ tender: any, contacts: any[], rolle: string, onGeaendert?: () => void }} props
 * @returns {React.ReactElement}
 */
function VergabeZugriffInhalt({ tender, contacts, rolle, onGeaendert }) {
  const { t } = useI18n();
  const [submission, setSubmission] = useState(/** @type {any} */ (null));
  const [fragen, setFragen] = useState(/** @type {any[]} */ ([]));
  const [frist, setFrist] = useState("");
  const [grund, setGrund] = useState("");
  const [kontaktId, setKontaktId] = useState("");
  const [antwort, setAntwort] = useState({ frage: "", text: "" });
  const [meldung, setMeldung] = useState({ art: "", text: "" });
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try {
      setSubmission(await submissionLesen(tender.id));
      const alle = await bitApi.entities.BcfRueckfrage.list();
      setFragen((alle || []).filter((f) => String(f.tender_id || "") === tender.id));
    } catch (e) {
      setMeldung({ art: "fehler", text: String(/** @type {any} */ (e)?.message || e) });
    }
  }, [tender.id]);
  useEffect(() => { laden(); }, [laden]);

  const a = useMemo(() => vergabeAktionen({ rolle, submission }), [rolle, submission]);
  const eingeladen = contacts.filter((c) => (tender.invited_contact_ids || []).includes(c.id));

  /**
   * Runs one action; the action may return its own message ({ art, text }),
   * otherwise the fixed success text is shown.
   * @param {() => Promise<any>} fn @param {string} erfolg
   */
  const ausfuehren = async (fn, erfolg) => {
    setBusy(true);
    setMeldung({ art: "", text: "" });
    try {
      const r = await fn();
      setMeldung(r && typeof r === "object" && typeof r.text === "string" ? r : { art: "ok", text: erfolg });
      await laden();
      onGeaendert?.();
    } catch (e) {
      setMeldung({ art: "fehler", text: String(/** @type {any} */ (e)?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  const fristIso = fristAusEingabe(frist);
  const kontakt = eingeladen.find((c) => c.id === kontaktId);

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="vergabe-zugriff">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-slate-700">{t("Bieterzugang und Angebotsfrist")}</span>
        <span className="text-xs text-slate-500">
          {a.phase === "ohne" && t("Keine Angebotsfrist festgelegt")}
          {a.phase === "laeuft" && `${t("Angebotsfrist läuft bis")} ${DATUM.format(new Date(submission.frist))}`}
          {a.phase === "abgelaufen" && `${t("Frist abgelaufen am")} ${DATUM.format(new Date(submission.frist))} — ${t("noch nicht geöffnet")}`}
          {a.phase === "geoeffnet" && `${t("Geöffnet am")} ${DATUM.format(new Date(submission.geoeffnet_am))}`}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        {t("Angebote von Bietern sind bis zur Öffnung nach Fristablauf auch für das Büro unsichtbar. Ein technischer Verschluss gegenüber dem Betreiber der Plattform findet nicht statt.")}
      </p>

      {(a.anlegen || a.fristVerschieben) && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`frist-${tender.id}`} className="text-xs">{a.anlegen ? t("Angebotsfrist") : t("Neue Angebotsfrist")}</Label>
            <Input id={`frist-${tender.id}`} type="datetime-local" value={frist} onChange={(e) => setFrist(e.target.value)} className="h-8 w-52" />
          </div>
          {a.fristVerschieben && (
            <div className="flex-1">
              <Label htmlFor={`grund-${tender.id}`} className="text-xs">{t("Grund (wird protokolliert)")}</Label>
              <Input id={`grund-${tender.id}`} value={grund} onChange={(e) => setGrund(e.target.value)} className="h-8" />
            </div>
          )}
          {a.anlegen && (
            <Button size="sm" disabled={busy || !fristIso} onClick={() => ausfuehren(() => submissionAnlegen(tender.id, /** @type {string} */ (fristIso)), t("Angebotsfrist festgelegt."))}>
              {t("Angebotsfrist festlegen")}
            </Button>
          )}
          {a.fristVerschieben && (
            <Button size="sm" variant="outline" disabled={busy || !fristIso || !grund.trim()} onClick={() => ausfuehren(() => submissionFrist(tender.id, /** @type {string} */ (fristIso), grund.trim()), t("Angebotsfrist verschoben."))}>
              {t("Frist verschieben")}
            </Button>
          )}
        </div>
      )}

      {a.freigeben && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => ausfuehren(async () => {
            const r = await freigabeErteilen(tender.id);
            return { art: "ok", text: `${r?.mengen ?? 0} ${t("Positionen ohne Preise freigegeben.")}` };
          }, t("Für Bieter freigegeben."))}>
            {t("Für Bieter freigeben")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => ausfuehren(() => freigabeZuruecknehmen(tender.id), t("Freigabe zurückgenommen."))}>
            {t("Freigabe zurücknehmen")}
          </Button>
        </div>
      )}

      {a.einladen && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`einladen-${tender.id}`} className="text-xs">{t("Bieter einladen (Konto)")}</Label>
            <select id={`einladen-${tender.id}`} value={kontaktId} onChange={(e) => setKontaktId(e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm">
              <option value="">{t("Bitte wählen …")}</option>
              {eingeladen.map((c) => <option key={c.id} value={c.id} disabled={!c.email}>{c.company || c.name}{c.email ? "" : ` — ${t("ohne E-Mail")}`}</option>)}
            </select>
          </div>
          <Button size="sm" variant="outline" disabled={busy || !kontakt?.email} onClick={() => ausfuehren(() => einladungSenden({
            email: kontakt.email, rolle: "bidder", projektId: tender.project_id, vergabeId: tender.id, kontaktId: kontakt.id,
          }), t("Einladung versendet."))}>
            {t("Einladen")}
          </Button>
        </div>
      )}

      {a.oeffnen && (
        <Button size="sm" disabled={busy} onClick={() => {
          if (!window.confirm(t("Angebote jetzt öffnen? Die Öffnung ist einmalig und wird mit Niederschrift protokolliert."))) return;
          ausfuehren(async () => {
            const n = await submissionOeffnen(tender.id);
            const abweichend = (n || []).filter((g) => !g.hash_wie_protokolliert).length;
            return {
              art: abweichend ? "fehler" : "ok",
              text: `${(n || []).length} ${t("Angebote geöffnet.")}${abweichend ? ` ${abweichend} ${t("mit abweichendem Inhalts-Hash — Niederschrift prüfen.")}` : ""}`,
            };
          }, t("Angebote geöffnet."));
        }}>
          {t("Angebote öffnen")}
        </Button>
      )}

      {fragen.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-600">{t("Rückfragen der Bieter")} ({fragen.length})</div>
          <ul className="space-y-1 text-xs text-slate-600">{fragen.map((f) => <li key={f.id} className="rounded bg-white px-2 py-1">{f.text}</li>)}</ul>
        </div>
      )}
      {a.freigeben && (
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input aria-label={t("Frage (in eigenen Worten, ohne Bieternamen)")} placeholder={t("Frage (in eigenen Worten, ohne Bieternamen)")} value={antwort.frage} onChange={(e) => setAntwort((x) => ({ ...x, frage: e.target.value }))} className="h-8" />
          <Input aria-label={t("Antwort an alle Bieter")} placeholder={t("Antwort an alle Bieter")} value={antwort.text} onChange={(e) => setAntwort((x) => ({ ...x, text: e.target.value }))} className="h-8" />
          <Button size="sm" variant="outline" disabled={busy || !antwort.text.trim()} onClick={() => ausfuehren(async () => {
            await rueckfrageBeantworten(tender.id, antwort.frage.trim(), antwort.text.trim());
            setAntwort({ frage: "", text: "" });
          }, t("Antwort an alle Bieter veröffentlicht."))}>
            {t("Antworten")}
          </Button>
        </div>
      )}

      {meldung.text && (
        <p role={meldung.art === "fehler" ? "alert" : "status"} className={meldung.art === "fehler" ? "text-rose-700" : "text-emerald-700"}>{meldung.text}</p>
      )}
    </div>
  );
}
