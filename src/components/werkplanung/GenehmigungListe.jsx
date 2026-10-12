// GenehmigungListe — permits tab of the page "Werkplanung & Baustelle" (88-04,
// RE-08/09/10): the permit procedures of the project (incl. deviation and exemption
// requests) with their statutory deadlines as guide values, status forward only with
// confirmation, and the register of conditions (Auflagen) up to the proof.
// The same deadlines appear in "Fristen & Termine" through the term source
// src/lib/termine/quellen/genehmigung.js.
//
// In:  projectId. Loads/writes Genehmigung, Auflage. Rules: src/lib/werkplanung/genehmigungen.js.
// Out: UI; data-testids gn-neu, gn-form-*, gn-speichern, gn-verfahren (data-art, data-status),
//      gn-frist (data-schluessel, data-datum, data-erledigt), gn-hinweis (data-art),
//      gn-status-<key>, gn-status-datum, gn-status-ok, gn-bearbeiten, au-neu, au-form-*,
//      au-speichern, au-zeile (data-status), au-erfuellt, au-nachweis, au-erfuellt-ok, gn-fehler.
import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import FormModal from "@core/components/common/FormModal";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useZugriff } from "@core/lib/ZugriffContext";
import { isoTag } from "@core/lib/kalender/datum.js";
import { Plus } from "lucide-react";
import {
  ARTEN, AUFLAGE_PHASEN, AUFLAGE_STATUS, STATUS, fristenVon, hinweise, naechsteStatus, normalisiereAuflage, normalisiereGenehmigung,
} from "@/lib/werkplanung/genehmigungen";

/** German text (i18n key) per hint; {…} filled from the hint's values. */
const HINWEIS_TEXT = Object.freeze({
  begruendung_fehlt: "Begründung fehlt ({norm})",
  auflage_vor_baubeginn: "Auflagen „vor Baubeginn“ noch offen: {anzahl}",
  baubeginn_vor_freigabe: "Baubeginn liegt vor Bescheid bzw. Wartefrist",
});

/** Date field a status change asks for (label = i18n key). */
const STATUS_DATUM = Object.freeze({
  eingereicht: { feld: "eingereicht_am", label: "Eingereicht am" },
  nachforderung: { feld: "nachforderung_frist", label: "Nachforderung einreichen bis" },
  genehmigt: { feld: "bescheid_am", label: "Bescheid vom" },
  abgelehnt: { feld: "bescheid_am", label: "Bescheid vom" },
});

const LEER = { art: "bauantrag", aktenzeichen: "", behoerde: "", eingereicht_am: "", vollstaendig_am: "", bescheid_am: "", baubeginn_am: "", begruendung: "", notiz: "", status: "vorbereitung" };
const LEER_AUFLAGE = { nr: "", text: "", phase: "vor_baubeginn", frist: "" };

/** @param {string} text @param {Record<string, any>} werte */
const fuellen = (text, werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
/** @param {unknown} e */
const fehlerText = (e) => (e instanceof Error ? e.message : String(e));
/** @param {string|null|undefined} iso */
const deDatum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
/** @param {ReadonlyArray<{key: string, label: string}>} liste @param {string} key */
const label = (liste, key) => liste.find((x) => x.key === key)?.label || key;
const heute = () => isoTag(new Date().toISOString()) || "";

/**
 * @param {{projectId: string}} props
 */
export default function GenehmigungListe({ projectId }) {
  const { t } = useI18n();
  const zugriff = useZugriff();
  const darfSchreiben = zugriff.darf("planung", "voll");
  const [verfahren, setVerfahren] = useState(/** @type {Array<any>} */ ([]));
  const [auflagen, setAuflagen] = useState(/** @type {Array<any>} */ ([]));
  const [formular, setFormular] = useState(/** @type {null | Record<string, any>} */ (null));
  const [wechsel, setWechsel] = useState(/** @type {null | {g: any, status: string, datum: string}} */ (null));
  const [auflageForm, setAuflageForm] = useState(/** @type {null | Record<string, any>} */ (null));
  const [erfuellen, setErfuellen] = useState(/** @type {null | {a: any, nachweis_ref: string, erledigt_am: string}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  const laden = useCallback(async () => {
    try {
      const [g, a] = await Promise.all([
        bitApi.entities.Genehmigung.filter({ project_id: projectId }),
        bitApi.entities.Auflage.filter({ project_id: projectId }),
      ]);
      const gl = Array.isArray(g) ? g : [];
      gl.sort((x, y) => String(x.created_date || "").localeCompare(String(y.created_date || "")));
      setVerfahren(gl);
      setAuflagen(Array.isArray(a) ? a : []);
    } catch (e) { setFehler(`${t("Genehmigungen konnten nicht geladen werden")}: ${fehlerText(e)}`); }
  }, [projectId, t]);
  useEffect(() => { laden(); }, [laden]);

  /** @param {() => Promise<any>} fn */
  const schreiben = async (fn) => {
    setFehler(null);
    try { await fn(); await laden(); return true; }
    catch (err) { setFehler(`${t("Änderung konnte nicht gespeichert werden")}: ${fehlerText(err)}`); return false; }
  };

  const speichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    if (!formular) return;
    const { id, created_date, updated_date, ...daten } = normalisiereGenehmigung(formular);
    const ok = await schreiben(() => (id
      ? bitApi.entities.Genehmigung.update(id, daten)
      : bitApi.entities.Genehmigung.create({ ...daten, project_id: projectId, created_date: new Date().toISOString() })));
    if (ok) setFormular(null);
  };

  const statusSetzen = async () => {
    if (!wechsel) return;
    const feld = /** @type {Record<string, {feld: string}>} */ (STATUS_DATUM)[wechsel.status]?.feld;
    /** @type {Record<string, any>} */
    const patch = { status: wechsel.status };
    if (feld && wechsel.datum) patch[feld] = wechsel.datum;
    if (wechsel.status === "nachforderung") patch.nachforderung_am = heute();
    const ok = await schreiben(() => bitApi.entities.Genehmigung.update(wechsel.g.id, patch));
    if (ok) setWechsel(null);
  };

  const auflageSpeichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    if (!auflageForm) return;
    const { id, ...daten } = normalisiereAuflage({ ...auflageForm, status: "offen" });
    const ok = await schreiben(() => bitApi.entities.Auflage.create({ ...daten, project_id: projectId, created_date: new Date().toISOString() }));
    if (ok) setAuflageForm(null);
  };

  const auflageErfuellen = async () => {
    if (!erfuellen) return;
    const ok = await schreiben(() => bitApi.entities.Auflage.update(erfuellen.a.id, { status: "erfuellt", nachweis_ref: erfuellen.nachweis_ref.trim(), erledigt_am: erfuellen.erledigt_am }));
    if (ok) setErfuellen(null);
  };

  const feld = (/** @type {string} */ key, /** @type {string} */ lbl, /** @type {Record<string, any>} */ props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`gn-form-${key}`}>{t(lbl)}</Label>
      <Input id={`gn-form-${key}`} data-testid={`gn-form-${key}`} value={formular?.[key] ?? ""} onChange={(e) => setFormular((f) => f && { ...f, [key]: e.target.value })} {...props} />
    </div>
  );
  const begruendungNoetig = !!ARTEN.find((a) => a.key === formular?.art)?.begruendungNoetig;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Genehmigungen")} ({verfahren.length})</CardTitle>
        {darfSchreiben && <Button size="sm" data-testid="gn-neu" onClick={() => setFormular({ ...LEER })}><Plus className="w-4 h-4 mr-1" />{t("Neues Verfahren")}</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">{t("Fristen nach BayBO sind Richtwerte – prüfen. Maßgeblich sind die Schreiben der Behörde.")}</p>
        {verfahren.length === 0 && <p className="text-sm text-slate-500">{t("Noch keine Verfahren.")}</p>}
        {verfahren.map((g) => {
          const art = ARTEN.find((a) => a.key === g.art);
          const fristen = fristenVon(g);
          const hw = hinweise(g, auflagen);
          const eigene = auflagen.filter((a) => a.genehmigung_id === g.id).sort((a, b) => String(a.nr || "").localeCompare(String(b.nr || ""), "de", { numeric: true }));
          return (
            <section key={g.id} className="rounded-lg border p-3 space-y-2" data-testid="gn-verfahren" data-art={g.art} data-status={g.status}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium">{t(art?.label || g.art)} <span className="text-xs text-slate-500">({art?.norm})</span></div>
                  <div className="text-xs text-slate-500">{[g.aktenzeichen && `${t("Az.")} ${g.aktenzeichen}`, g.behoerde].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5">{t(label(STATUS, g.status))}</span>
                  {darfSchreiben && naechsteStatus(g.status).map((s) => (
                    <Button key={s} size="sm" variant="outline" data-testid={`gn-status-${s}`}
                      onClick={() => setWechsel({ g, status: s, datum: g[/** @type {any} */ (STATUS_DATUM)[s]?.feld] || (s === "nachforderung" ? "" : heute()) })}>
                      {t(label(STATUS, s))}
                    </Button>
                  ))}
                  {darfSchreiben && <Button size="sm" variant="ghost" data-testid="gn-bearbeiten" onClick={() => setFormular({ ...LEER, ...g })}>{t("Bearbeiten")}</Button>}
                </div>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-4">
                <span>{t("Eingereicht am")}: {deDatum(g.eingereicht_am)}</span>
                {g.vollstaendig_am && <span>{t("Vollständig am")}: {deDatum(g.vollstaendig_am)}</span>}
                {g.bescheid_am && <span>{t("Bescheid vom")}: {deDatum(g.bescheid_am)}</span>}
                {g.baubeginn_am && <span>{t("Baubeginn am")}: {deDatum(g.baubeginn_am)}</span>}
              </div>
              {g.begruendung && <p className="text-xs"><span className="text-slate-500">{t("Begründung")}:</span> {g.begruendung}</p>}
              {fristen.length > 0 && (
                <ul className="text-xs space-y-0.5">
                  {fristen.map((f) => (
                    <li key={f.schluessel} data-testid="gn-frist" data-schluessel={f.schluessel} data-datum={f.datum} data-erledigt={f.erledigt ? "ja" : "nein"} className={f.erledigt ? "text-slate-400 line-through" : ""}>
                      {deDatum(f.datum)} · {t(f.label)} <span className="text-slate-400">({f.herkunft}{f.schluessel !== "nachforderung" ? `, ${t("Richtwert – prüfen")}` : ""})</span>
                    </li>
                  ))}
                </ul>
              )}
              {hw.map((h) => <p key={h.art} className="text-xs text-amber-700" data-testid="gn-hinweis" data-art={h.art}>{fuellen(t(/** @type {Record<string, string>} */ (HINWEIS_TEXT)[h.art]), h.werte)}</p>)}

              <div className="pt-1">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{t("Auflagen")} ({eigene.length})</div>
                  {darfSchreiben && <Button size="sm" variant="ghost" data-testid="au-neu" onClick={() => setAuflageForm({ ...LEER_AUFLAGE, genehmigung_id: g.id })}><Plus className="w-4 h-4 mr-1" />{t("Auflage")}</Button>}
                </div>
                {eigene.length > 0 && (
                  <table className="w-full text-xs mt-1">
                    <tbody>
                      {eigene.map((a) => (
                        <tr key={a.id} className="border-t align-top" data-testid="au-zeile" data-status={a.status}>
                          <td className="py-1 pr-2 font-mono">{a.nr}</td>
                          <td className="py-1 pr-2">{a.text}</td>
                          <td className="py-1 pr-2 whitespace-nowrap">{t(label(AUFLAGE_PHASEN, a.phase))}</td>
                          <td className="py-1 pr-2 whitespace-nowrap">{a.frist ? deDatum(a.frist) : ""}</td>
                          <td className="py-1 pr-2 whitespace-nowrap">{t(label(AUFLAGE_STATUS, a.status))}{a.nachweis_ref && <div className="text-slate-500">{a.nachweis_ref}</div>}</td>
                          <td className="py-1 text-right">
                            {darfSchreiben && a.status === "offen" && <Button size="sm" variant="outline" data-testid="au-erfuellt" onClick={() => setErfuellen({ a, nachweis_ref: "", erledigt_am: heute() })}>{t("Erfüllt")}</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          );
        })}
        {fehler && !formular && !wechsel && !auflageForm && !erfuellen && <p className="text-sm text-rose-700" role="alert" data-testid="gn-fehler">{fehler}</p>}
      </CardContent>

      {formular && (
        <FormModal title={formular.id ? t("Verfahren bearbeiten") : t("Neues Verfahren")} onClose={() => setFormular(null)}>
          <form onSubmit={speichern} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="gn-form-art">{t("Verfahrensart")}</Label>
              <select id="gn-form-art" data-testid="gn-form-art" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={formular.art} onChange={(e) => setFormular((f) => f && { ...f, art: e.target.value })}>
                {ARTEN.map((a) => <option key={a.key} value={a.key}>{t(a.label)} ({a.norm})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {feld("aktenzeichen", "Aktenzeichen")}
              {feld("behoerde", "Behörde")}
              {feld("eingereicht_am", "Eingereicht am", { type: "date" })}
              {feld("vollstaendig_am", "Vollständig am", { type: "date" })}
              {feld("bescheid_am", "Bescheid vom", { type: "date" })}
              {feld("baubeginn_am", "Baubeginn am", { type: "date" })}
            </div>
            <div className="space-y-1">
              <Label htmlFor="gn-form-begruendung">{t("Begründung")}{begruendungNoetig ? " *" : ""}</Label>
              <Textarea id="gn-form-begruendung" data-testid="gn-form-begruendung" rows={3} value={formular.begruendung || ""}
                placeholder={begruendungNoetig ? t("Warum ist die Abweichung bzw. Befreiung vertretbar?") : ""}
                onChange={(e) => setFormular((f) => f && { ...f, begruendung: e.target.value })} />
            </div>
            {feld("notiz", "Notiz")}
            {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="gn-fehler">{fehler}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="gn-speichern">{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}

      {wechsel && (
        <FormModal title={`${t(label(STATUS, wechsel.status))}?`} onClose={() => setWechsel(null)}>
          <div className="space-y-3">
            <p className="text-sm">{t("Der Status lässt sich danach nicht zurücksetzen.")}</p>
            {/** @type {any} */ (STATUS_DATUM)[wechsel.status] && (
              <div className="space-y-1">
                <Label htmlFor="gn-status-datum">{t(/** @type {any} */ (STATUS_DATUM)[wechsel.status].label)}</Label>
                <Input id="gn-status-datum" data-testid="gn-status-datum" type="date" value={wechsel.datum} onChange={(e) => setWechsel({ ...wechsel, datum: e.target.value })} />
              </div>
            )}
            {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="gn-fehler">{fehler}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setWechsel(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="gn-status-ok" onClick={statusSetzen}>{t("Bestätigen")}</Button>
            </div>
          </div>
        </FormModal>
      )}

      {auflageForm && (
        <FormModal title={t("Neue Auflage")} onClose={() => setAuflageForm(null)}>
          <form onSubmit={auflageSpeichern} className="space-y-3">
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <div className="space-y-1">
                <Label htmlFor="au-form-nr">{t("Nr.")}</Label>
                <Input id="au-form-nr" data-testid="au-form-nr" value={auflageForm.nr} onChange={(e) => setAuflageForm({ ...auflageForm, nr: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="au-form-phase">{t("Phase")}</Label>
                <select id="au-form-phase" data-testid="au-form-phase" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={auflageForm.phase} onChange={(e) => setAuflageForm({ ...auflageForm, phase: e.target.value })}>
                  {AUFLAGE_PHASEN.map((p) => <option key={p.key} value={p.key}>{t(p.label)}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="au-form-text">{t("Auflage")}</Label>
              <Textarea id="au-form-text" data-testid="au-form-text" rows={3} required value={auflageForm.text} onChange={(e) => setAuflageForm({ ...auflageForm, text: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="au-form-frist">{t("Frist")}</Label>
              <Input id="au-form-frist" data-testid="au-form-frist" type="date" value={auflageForm.frist} onChange={(e) => setAuflageForm({ ...auflageForm, frist: e.target.value })} />
            </div>
            {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="gn-fehler">{fehler}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setAuflageForm(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="au-speichern">{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}

      {erfuellen && (
        <FormModal title={t("Auflage erfüllt")} onClose={() => setErfuellen(null)}>
          <div className="space-y-3">
            <p className="text-sm">{erfuellen.a.text}</p>
            <div className="space-y-1">
              <Label htmlFor="au-nachweis">{t("Nachweis (Dokument, Schreiben, Prüfbericht)")}</Label>
              <Input id="au-nachweis" data-testid="au-nachweis" value={erfuellen.nachweis_ref} onChange={(e) => setErfuellen({ ...erfuellen, nachweis_ref: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="au-erledigt">{t("Erfüllt am")}</Label>
              <Input id="au-erledigt" type="date" value={erfuellen.erledigt_am} onChange={(e) => setErfuellen({ ...erfuellen, erledigt_am: e.target.value })} />
            </div>
            {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="gn-fehler">{fehler}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setErfuellen(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="au-erfuellt-ok" disabled={!erfuellen.nachweis_ref.trim()} onClick={auflageErfuellen}>{t("Speichern")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}
