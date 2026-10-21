// AusstattungsKatalog — the project's equipment catalogue (99-02, D-P99-04): options per
// trade with extra/reduced price (catalogue price, not the BoQ unit price), standard rows
// with price 0, and the severity that decides the technical approvals (D-P99-01). Options
// are switched off, never deleted — requests keep pointing at them.
//
// In:  projectId, katalog (AusstattungsOption rows, sorted), onGeaendert() (reload).
//      Rules: src/lib/werkplanung/sonderwunsch.js.
// Out: UI; writes AusstattungsOption. data-testids sw-katalog, sw-k-neu, sw-k-form-*,
//      sw-k-speichern, sw-k-zeile (data-nr, data-aktiv), sw-k-aktiv, sw-k-fehler.
import React, { useRef, useState } from "react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import FormModal from "@core/components/common/FormModal";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";
import { Plus } from "lucide-react";
import {
  SCHWERE, FREIGABE_ROLLEN, KATALOG_EINHEITEN, neueKatalogOption, katalogHinweise, gewerkLabel,
} from "@/lib/werkplanung/sonderwunsch";

const LEER = { gewerk_lb: "", bezeichnung: "", art: "option", preis_eur: "", einheit: "psch", schwere: "ausstattung", beschreibung: "" };
const AUSWAHL = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";
const eur = (/** @type {unknown} */ v) => (Number(v) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fehlerText = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {{projectId: string, katalog: Array<any>, onGeaendert: () => Promise<void>|void}} props
 * @returns {import("react").JSX.Element}
 */
export default function AusstattungsKatalog({ projectId, katalog, onGeaendert }) {
  const { t } = useI18n();
  const [formular, setFormular] = useState(/** @type {null | Record<string, string>} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  // The K-number comes from the loaded catalogue: a second submit during the write would
  // hand it out twice (ref blocks within the same tick, state disables the button).
  const sperre = useRef(false);
  const [laeuft, setLaeuft] = useState(false);

  const speichern = async (/** @type {import("react").FormEvent} */ e) => {
    e.preventDefault();
    if (!formular || sperre.current) return;
    sperre.current = true; setLaeuft(true);
    setFehler(null);
    try {
      await bitApi.entities.AusstattungsOption.create({ ...neueKatalogOption(formular, { projectId, alle: katalog }), created_date: new Date().toISOString() });
      setFormular(null);
      await onGeaendert();
    } catch (err) { setFehler(`${t("Katalog konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
    finally { sperre.current = false; setLaeuft(false); }
  };

  const umschalten = async (/** @type {any} */ o) => {
    setFehler(null);
    try { await bitApi.entities.AusstattungsOption.update(o.id, { aktiv: o.aktiv === false }); await onGeaendert(); }
    catch (err) { setFehler(`${t("Katalog konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  };

  const freigabenText = (/** @type {string} */ schwere) => (SCHWERE.find((s) => s.key === schwere)?.freigaben || [])
    .map((r) => t(FREIGABE_ROLLEN.find((x) => x.key === r)?.label || r)).join(" + ");

  const setze = (/** @type {string} */ k, /** @type {string} */ v) => setFormular((f) => f && { ...f, [k]: v });

  return (
    <div className="space-y-2" data-testid="sw-katalog">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Ausstattungskatalog")} ({katalog.length})</h3>
        <Button size="sm" variant="outline" data-testid="sw-k-neu" onClick={() => setFormular({ ...LEER })}><Plus className="w-4 h-4 mr-1" />{t("Neue Option")}</Button>
      </div>
      {katalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Noch kein Katalog: Standard und Optionen je Gewerk mit Mehr-/Minderpreis anlegen.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 px-2">{t("Nr.")}</th>
                <th className="py-2 px-2">{t("Gewerk")}</th>
                <th className="py-2 px-2">{t("Bezeichnung")}</th>
                <th className="py-2 px-2 text-right">{t("Preis")}</th>
                <th className="py-2 px-2">{t("Freigabe durch")}</th>
                <th className="py-2 px-2">{t("Hinweise")}</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {katalog.map((o) => (
                <tr key={o.id} className={`border-b border-border last:border-0 align-top ${o.aktiv === false ? "opacity-50" : ""}`} data-testid="sw-k-zeile" data-nr={o.nr} data-aktiv={String(o.aktiv !== false)}>
                  <td className="py-1.5 px-2 font-mono text-xs">{o.nr}</td>
                  <td className="py-1.5 px-2 text-xs">{gewerkLabel(o.gewerk_lb)}</td>
                  <td className="py-1.5 px-2">{o.bezeichnung || "—"}{o.art === "standard" && <span className="ml-1 text-xs text-muted-foreground">({t("Standard")})</span>}
                    {o.beschreibung && <div className="text-xs text-muted-foreground">{o.beschreibung}</div>}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-xs">{eur(o.preis_eur)} / {o.einheit || "psch"}</td>
                  <td className="py-1.5 px-2 text-xs">{freigabenText(o.schwere)}</td>
                  <td className="py-1.5 px-2 text-xs">{katalogHinweise(o).map((h) => <div key={h.code} className="text-muted-foreground">{t(h.text)}</div>)}</td>
                  <td className="py-1.5 px-2 text-right">
                    <Button size="sm" variant="ghost" data-testid="sw-k-aktiv" onClick={() => umschalten(o)}>{o.aktiv === false ? t("Aktivieren") : t("Abschalten")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fehler && <p className="text-sm text-fehler" role="alert" data-testid="sw-k-fehler">{fehler}</p>}

      {formular && (
        <FormModal title={t("Neue Katalogoption")} onClose={() => setFormular(null)}>
          <form onSubmit={speichern} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sw-k-form-bezeichnung">{t("Bezeichnung")}</Label>
              <Input id="sw-k-form-bezeichnung" data-testid="sw-k-form-bezeichnung" required value={formular.bezeichnung} onChange={(e) => setze("bezeichnung", e.target.value)}
                placeholder={t("z. B. Parkett Eiche statt Laminat")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label htmlFor="sw-k-form-gewerk_lb">{t("Gewerk")}</Label>
                <select id="sw-k-form-gewerk_lb" data-testid="sw-k-form-gewerk_lb" className={AUSWAHL} value={formular.gewerk_lb} onChange={(e) => setze("gewerk_lb", e.target.value)}>
                  <option value="">—</option>
                  {STLB_LB.map((g) => <option key={g.lb} value={g.lb}>{g.lb} {g.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sw-k-form-art">{t("Art")}</Label>
                <select id="sw-k-form-art" data-testid="sw-k-form-art" className={AUSWAHL} value={formular.art} onChange={(e) => setze("art", e.target.value)}>
                  <option value="option">{t("Option")}</option>
                  <option value="standard">{t("Standard")}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sw-k-form-schwere">{t("Eingriff")}</Label>
                <select id="sw-k-form-schwere" data-testid="sw-k-form-schwere" className={AUSWAHL} value={formular.schwere} onChange={(e) => setze("schwere", e.target.value)}>
                  {SCHWERE.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sw-k-form-preis_eur">{t("Mehr-/Minderpreis (€ brutto)")}</Label>
                <Input id="sw-k-form-preis_eur" data-testid="sw-k-form-preis_eur" inputMode="decimal" disabled={formular.art === "standard"} value={formular.preis_eur} onChange={(e) => setze("preis_eur", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sw-k-form-einheit">{t("Einheit")}</Label>
                <select id="sw-k-form-einheit" data-testid="sw-k-form-einheit" className={AUSWAHL} value={formular.einheit} onChange={(e) => setze("einheit", e.target.value)}>
                  {KATALOG_EINHEITEN.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("Freigabe durch")}: {freigabenText(formular.schwere)}</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="sw-k-speichern" disabled={laeuft}>{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}
