// PlanListe — plan list of the active project (88-06, RE-17): create/edit plans,
// status forward (Vorabzug, Geprüft), release with name (writes an AuditLog entry),
// new revision index with change text (AuditLog too), PDF via dokumentAblegen.
//
// 106-11: the model state. Filing a PDF reads the state line the BIM studio wrote into its keywords and keeps it on the plan
// (additive field Plan.modellstand); the column "Modellstand" compares it with the current state of the project (stored model +
// change log): "aktuell" / "veraltet" (the drawn content changed since printing) and the note of unreleased AI changes ("offen",
// or "überholt" once they were released). Word + sign + border form, the tokens add colour (guard rail 5).
// Review 106-11: the state of a plan counts only while its file is filed (a new index clears both); a sheet of another project
// reads "unbekannt"; while the current state loads the column says so neutrally. Not tamper-proof: Plan.modellstand is a normal
// field and comes from the PDF's keywords (open decision, see 106-11-SUMMARY).
//
// In:  projectId, projektName (default short code). Loads/writes Plan, AuditLog,
//      Document (through dokumentAblegen); reads BimModel and AenderungsSchritt. Rules: src/lib/werkplanung/plaene.js,
//      @core/lib/zeigen/planStand.js.
// Out: UI; data-testids pl-neu, pl-form-*, pl-speichern, pl-zeile (data-nummer,
//      data-status, data-index), pl-status-*, pl-freigeben, pl-freigabe-von,
//      pl-freigabe-ok, pl-index, pl-index-text, pl-index-ok, pl-datei, pl-fehler,
//      pl-modellstand (data-status, data-vermerk).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import FormModal from "@core/components/common/FormModal";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useAuth } from "@core/lib/AuthContext";
import { fileToDataUrl } from "@core/lib/pdf";
import { dokumentAblegen } from "@core/lib/ablage";
import { Plus } from "lucide-react";
import { planStandVergleich, modellstandText } from "@core/lib/zeigen/planStand.js";
import { aktuellenModellStandLaden, modellstandAusPdf } from "@core/lib/zeigen/planStandLaden.js";
import {
  PLAN_FORMATE, planNummer, planStatusLabel, planPruefung, planUebergangErlaubt,
  statusPatch, freigabePatch, indexPatch, auditEintrag, neuerPlan,
} from "@/lib/werkplanung/plaene";

const LEER = { projekt_kurz: "", lph: "5", gewerk: "AR", nr: "", titel: "", massstab: "1:50", format: "A1" };
const fehlerText = (e) => (e instanceof Error ? e.message : String(e));

/** 106-11: look of the comparison states - word, sign and border form carry the meaning, the token class adds colour. */
const STAND_DARSTELLUNG = /** @type {Record<string, {wort: string, zeichen: string, klasse: string}>} */ ({
  aktuell: { wort: "aktuell", zeichen: "✓", klasse: "border-solid border-erfolg text-erfolg" },
  veraltet: { wort: "veraltet", zeichen: "!", klasse: "border-dashed border-warnung text-warnung" },
  unbekannt: { wort: "unbekannt", zeichen: "?", klasse: "border-dotted border-muted-foreground text-muted-foreground" },
  ohne: { wort: "kein Modellstand", zeichen: "–", klasse: "border-dotted border-border text-muted-foreground" },
  laedt: { wort: "wird geprüft …", zeichen: "…", klasse: "border-dotted border-border text-muted-foreground" },
});
const VERMERK_DARSTELLUNG = /** @type {Record<string, {wort: string, zeichen: string, klasse: string}>} */ ({
  offen: { wort: "enthält ungeprüfte KI-Änderungen", zeichen: "?", klasse: "border-dashed border-warnung text-warnung bg-warnung-flaeche" },
  ueberholt: { wort: "Vermerk überholt", zeichen: "↻", klasse: "border-dotted border-hinweis text-hinweis" },
  unbekannt: { wort: "Prüfstand unbekannt", zeichen: "?", klasse: "border-dotted border-warnung text-warnung" },
});

/**
 * @param {{projectId: string, projektName?: string}} props
 */
export default function PlanListe({ projectId, projektName = "" }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [plaene, setPlaene] = useState(/** @type {Array<any>} */ ([]));
  const [formular, setFormular] = useState(/** @type {null | {plan: any|null, werte: Record<string, string>}} */ (null));
  const [freigabe, setFreigabe] = useState(/** @type {null | {plan: any, von: string}} */ (null));
  const [neuIndex, setNeuIndex] = useState(/** @type {null | {plan: any, text: string}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  // undefined = still loading (neutral "wird geprüft …"), else the current state (modellStandUnbekannt when it failed)
  const [aktuell, setAktuell] = useState(/** @type {import("@core/lib/zeigen/planStand.js").ModellStand|undefined} */ (undefined));
  const projektRef = useRef(projectId);
  projektRef.current = projectId;
  const anfrageRef = useRef(0);

  const laden = useCallback(async () => {
    try {
      const r = await bitApi.entities.Plan.filter({ project_id: projectId });
      const liste = Array.isArray(r) ? r : [];
      liste.sort((a, b) => planNummer(a).basis.localeCompare(planNummer(b).basis, "de"));
      setPlaene(liste);
    } catch (e) { setFehler(`${t("Pläne konnten nicht geladen werden")}: ${fehlerText(e)}`); }
  }, [projectId, t]);
  useEffect(() => { laden(); }, [laden]);
  // 106-11: current model state; again when the window gets the focus back (a release or a model change in another tab)
  // only the newest answer for the CURRENT project counts (focus + visibility + upload can overlap; a slow answer of the previous
  // project must not be compared with this project's plans)
  const standLaden = useCallback(async () => {
    const nr = ++anfrageRef.current;
    const st = await aktuellenModellStandLaden(projectId);
    if (projektRef.current === projectId && nr === anfrageRef.current) setAktuell(st);
  }, [projectId]);
  useEffect(() => {
    setAktuell(undefined);
    standLaden();
    const neu = () => { if (document.visibilityState !== "hidden") standLaden(); };
    window.addEventListener("focus", neu);
    document.addEventListener("visibilitychange", neu);
    return () => { window.removeEventListener("focus", neu); document.removeEventListener("visibilitychange", neu); };
  }, [standLaden]);

  const kurzVorschlag = String(projektName || "").replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 3).toUpperCase();

  const speichern = async (e) => {
    e.preventDefault();
    if (!formular) return;
    setFehler(null);
    try {
      const daten = neuerPlan(formular.werte, projectId);
      if (formular.plan) {
        const { status: _s, index: _i, indizes: _x, freigabe: _f, datei_ref: _d, ...felder } = daten;
        await bitApi.entities.Plan.update(formular.plan.id, felder);
      } else {
        await bitApi.entities.Plan.create({ ...daten, created_date: new Date().toISOString() });
      }
      setFormular(null);
      await laden();
    } catch (err) { setFehler(`${t("Plan konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const status = async (plan, neu) => {
    const patch = statusPatch(plan, neu);
    if (!patch) return;
    try { await bitApi.entities.Plan.update(plan.id, patch); await laden(); }
    catch (err) { setFehler(`${t("Plan konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const freigeben = async () => {
    if (!freigabe) return;
    const patch = freigabePatch(freigabe.plan, freigabe.von);
    if (!patch) { setFehler(t("Freigabe nur aus „Geprüft“ und mit Namen")); return; }
    try {
      await bitApi.entities.Plan.update(freigabe.plan.id, patch);
      // The AuditLog entry is the liability record; written after the plan, never edited.
      await bitApi.entities.AuditLog.create(auditEintrag({ projectId, plan: { ...freigabe.plan, ...patch }, aktion: "freigabe", actor: patch.freigabe.von }));
      setFreigabe(null);
      await laden();
    } catch (err) { setFehler(`${t("Freigabe konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const indexNeu = async () => {
    if (!neuIndex) return;
    const patch = indexPatch(neuIndex.plan, neuIndex.text);
    if (!patch) { setFehler(t("Änderung beschreiben, dann neuen Index anlegen")); return; }
    try {
      await bitApi.entities.Plan.update(neuIndex.plan.id, patch);
      await bitApi.entities.AuditLog.create(auditEintrag({ projectId, plan: { ...neuIndex.plan, ...patch }, aktion: "index", actor: user?.full_name || user?.email || "Bediener", detail: neuIndex.text.trim() }));
      setNeuIndex(null);
      await laden();
    } catch (err) { setFehler(`${t("Index konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const dateiHochladen = async (plan, datei) => {
    if (!datei) return;
    try {
      const daten = await fileToDataUrl(datei);
      // 106-11: the model state the sheet was printed with (null = a PDF from elsewhere or from before 106-11)
      const modellstand = await modellstandAusPdf(new Uint8Array(await datei.arrayBuffer()));
      // Storage rule: dokumentAblegen routes > 1 MB into the object store (inhaltAblegen).
      const r = await dokumentAblegen({ projectId, name: datei.name, typ: "Plan-PDF", daten: String(daten), notiz: `Plan ${planNummer(plan).voll}` });
      if (!r.ok) throw new Error(r.grund || "Ablage fehlgeschlagen");
      await bitApi.entities.Plan.update(plan.id, { datei_ref: r.dokument?.id || null, modellstand });
      await Promise.all([laden(), standLaden()]);
    } catch (err) { setFehler(`${t("Plandatei konnte nicht abgelegt werden")}: ${fehlerText(err)}`); }
  };

  const feld = (key, label, props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`pl-form-${key}`}>{t(label)}</Label>
      <Input id={`pl-form-${key}`} data-testid={`pl-form-${key}`} value={formular?.werte[key] ?? ""}
        onChange={(e) => setFormular((f) => f && { ...f, werte: { ...f.werte, [key]: e.target.value } })} {...props} />
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Planliste")} ({plaene.length})</CardTitle>
        <Button size="sm" data-testid="pl-neu" onClick={() => setFormular({ plan: null, werte: { ...LEER, projekt_kurz: kurzVorschlag } })}>
          <Plus className="w-4 h-4 mr-1" />{t("Neuer Plan")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {plaene.length === 0 ? (
          <p className="text-sm text-slate-500">{t("Noch keine Pläne in diesem Projekt.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b">
                  <th className="py-2 px-2">{t("Plannummer")}</th>
                  <th className="py-2 px-2">{t("Planinhalt")}</th>
                  <th className="py-2 px-2">{t("Maßstab")}</th>
                  <th className="py-2 px-2">{t("Format")}</th>
                  <th className="py-2 px-2">{t("Index")}</th>
                  <th className="py-2 px-2">{t("Status")}</th>
                  <th className="py-2 px-2">{t("Freigabe")}</th>
                  <th className="py-2 px-2">{t("Modellstand")}</th>
                  <th className="py-2 px-2">{t("Hinweise")}</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {plaene.map((p) => {
                  const nr = planNummer(p);
                  const hw = planPruefung(p, plaene);
                  // the state belongs to the filed sheet: without a file (e.g. after a new index) the plan has none
                  const ps = p.datei_ref ? p.modellstand || null : null;
                  const laedt = aktuell === undefined && !!ps;
                  const vg = planStandVergleich(ps, aktuell);
                  const sd = laedt ? STAND_DARSTELLUNG.laedt : STAND_DARSTELLUNG[vg.status];
                  const vd = laedt ? null : VERMERK_DARSTELLUNG[vg.vermerk];
                  return (
                    <tr key={p.id} className="border-b last:border-0 align-top" data-testid="pl-zeile"
                      data-nummer={nr.voll} data-status={p.status} data-index={p.index || ""}>
                      <td className="py-1.5 px-2 font-mono text-xs">{nr.voll || "—"}</td>
                      <td className="py-1.5 px-2">{p.titel || "—"}</td>
                      <td className="py-1.5 px-2">{p.massstab || "—"}</td>
                      <td className="py-1.5 px-2">{p.format || "—"}</td>
                      <td className="py-1.5 px-2" title={(p.indizes || []).map((x) => `${x.index} ${x.datum}: ${x.aenderung}`).join(" · ")}>{p.index || "—"}</td>
                      <td className="py-1.5 px-2">{t(planStatusLabel(p.status))}</td>
                      <td className="py-1.5 px-2 text-xs">
                        {p.freigabe ? `${p.freigabe.von}, ${new Date(p.freigabe.am).toLocaleDateString("de-DE")}` : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-xs" data-testid="pl-modellstand" data-status={laedt ? "laedt" : vg.status} data-vermerk={laedt ? "keiner" : vg.vermerk}
                        title={ps ? modellstandText({ ...ps, grund: null, guids: [], herkunft_quellen: [], betroffen: [] }, t) : undefined}>
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${sd.klasse}`}><span aria-hidden="true">{sd.zeichen}</span>{t(sd.wort)}</span>
                          {vd && <span data-testid="pl-modellstand-vermerk" className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${vd.klasse}`}><span aria-hidden="true">{vd.zeichen}</span>{t(vd.wort)}</span>}
                          {!laedt && vg.hinweise.filter((h) => h.code !== "ohne_modellstand").map((h) => (
                            <span key={h.code} data-code={h.code} className={h.stufe === "warn" ? "text-warnung" : "text-muted-foreground"}>{t(h.text)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-xs">
                        {hw.map((h) => (
                          <div key={h.code} data-code={h.code} className={h.stufe === "warn" ? "text-amber-700" : "text-slate-500"}>{t(h.text)}</div>
                        ))}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {["vorabzug", "geprueft"].filter((s) => planUebergangErlaubt(p.status, s)).map((s) => (
                            <Button key={s} size="sm" variant="outline" data-testid={`pl-status-${s}`} onClick={() => status(p, s)}>
                              {t(planStatusLabel(s))}
                            </Button>
                          ))}
                          {planUebergangErlaubt(p.status, "freigegeben") && (
                            <Button size="sm" data-testid="pl-freigeben" onClick={() => setFreigabe({ plan: p, von: user?.full_name || "" })}>{t("Freigeben")}</Button>
                          )}
                          <Button size="sm" variant="outline" data-testid="pl-index" onClick={() => setNeuIndex({ plan: p, text: "" })}>{t("Neuer Index")}</Button>
                          {p.status !== "freigegeben" && (
                            <Button size="sm" variant="ghost" onClick={() => setFormular({ plan: p, werte: { projekt_kurz: p.projekt_kurz || "", lph: String(p.lph || ""), gewerk: p.gewerk || "", nr: String(p.nr || ""), titel: p.titel || "", massstab: p.massstab || "", format: p.format || "" } })}>
                              {t("Bearbeiten")}
                            </Button>
                          )}
                          <label className="cursor-pointer text-xs text-blue-700 underline-offset-4 hover:underline self-center">
                            {p.datei_ref ? t("PDF ersetzen") : t("PDF ablegen")}
                            <input type="file" accept="application/pdf" className="sr-only" data-testid="pl-datei"
                              onChange={(e) => dateiHochladen(p, e.target.files?.[0])} />
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="pl-fehler">{fehler}</p>}
        <p className="text-xs text-slate-400">
          {t("Plannummer nach dem Schema des Plankopfs: Projekt-LPH-Gewerk-Nr-Index. Freigabe und Indexwechsel stehen im Audit-Log.")}
        </p>
      </CardContent>

      {formular && (
        <FormModal title={formular.plan ? t("Plan bearbeiten") : t("Neuer Plan")} onClose={() => setFormular(null)}>
          <form onSubmit={speichern} className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {feld("projekt_kurz", "Projektkürzel")}
              {feld("lph", "Leistungsphase")}
              {feld("gewerk", "Fachsicht / Gewerk")}
              {feld("nr", "Laufende Nr.")}
            </div>
            {feld("titel", "Planinhalt", { required: true })}
            <div className="grid grid-cols-2 gap-3">
              {feld("massstab", "Maßstab")}
              <div className="space-y-1">
                <Label htmlFor="pl-form-format">{t("Format")}</Label>
                <select id="pl-form-format" data-testid="pl-form-format" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={formular.werte.format} onChange={(e) => setFormular((f) => f && { ...f, werte: { ...f.werte, format: e.target.value } })}>
                  {PLAN_FORMATE.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-500" data-testid="pl-form-vorschau">
              {t("Plannummer")}: <span className="font-mono">{planNummer({ ...formular.werte, index: formular.plan?.index || "" }).voll || "—"}</span>
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="pl-speichern">{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}

      {freigabe && (
        <FormModal title={t("Plan freigeben")} onClose={() => setFreigabe(null)}>
          <div className="space-y-3">
            <p className="text-sm">{planNummer(freigabe.plan).voll} · {freigabe.plan.titel}</p>
            <div className="space-y-1">
              <Label htmlFor="pl-freigabe-von">{t("Freigegeben von")}</Label>
              <Input id="pl-freigabe-von" data-testid="pl-freigabe-von" value={freigabe.von} onChange={(e) => setFreigabe({ ...freigabe, von: e.target.value })} />
            </div>
            <p className="text-xs text-slate-500">{t("Die Freigabe wird mit Name und Zeit im Audit-Log festgehalten und nicht mehr geändert.")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFreigabe(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="pl-freigabe-ok" disabled={!freigabe.von.trim()} onClick={freigeben}>{t("Freigeben")}</Button>
            </div>
          </div>
        </FormModal>
      )}

      {neuIndex && (
        <FormModal title={t("Neuer Index")} onClose={() => setNeuIndex(null)}>
          <div className="space-y-3">
            <p className="text-sm">{planNummer(neuIndex.plan).voll} → {t("Index")} {(() => { try { return planNummer({ ...neuIndex.plan, index: indexPatch(neuIndex.plan, "x")?.index }).voll; } catch { return "—"; } })()}</p>
            <div className="space-y-1">
              <Label htmlFor="pl-index-text">{t("Änderung")}</Label>
              <Input id="pl-index-text" data-testid="pl-index-text" value={neuIndex.text} onChange={(e) => setNeuIndex({ ...neuIndex, text: e.target.value })} />
            </div>
            <p className="text-xs text-slate-500">{t("Ein neuer Index setzt den Status auf „In Arbeit“ zurück; die alte Freigabe bleibt im Audit-Log.")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNeuIndex(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="pl-index-ok" disabled={!neuIndex.text.trim()} onClick={indexNeu}>{t("Index anlegen")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}
