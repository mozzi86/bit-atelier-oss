// Katalog-Pflege (Phase 43, MOEBEL-04): eigene Möbeltypen des Projekts anlegen und löschen.
//
// In:  eigene (complexData.moebel_eigene), moeblierung (für die Sperre „in Benutzung"),
//      onChange(liste) — schreibt complexData.moebel_eigene.
// Out: Formular (Name, Breite, Tiefe, Kategorie, Benutzerseite) + Liste. Validierung und
//      Id-Vergabe macht neuerEigenerTyp in @designer/lib/moebel; Fehler stehen im Klartext.

import React, { useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { NumberField } from "@core/components/Field";
import { useI18n } from "@core/lib/i18n";
import { MOEBEL_KATEGORIEN, neuerEigenerTyp, typInBenutzung } from "@designer/lib/moebel";

const KATEGORIE_LABEL = { desk: "Tisch / Arbeitsplatz", chair: "Stuhl", furn: "Möbel", sanitaer: "Sanitär" };
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param {object} p
 * @param {Array<object>} p.eigene eigene Typen des Projekts
 * @param {Record<string, Array<object>>} p.moeblierung aktuelle Möblierung (Sperre beim Löschen)
 * @param {(liste: Array<object>) => void} [p.onChange]
 */
export default function MoebelKatalogPflege({ eigene = [], moeblierung = {}, onChange }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: "", b: 1.2, t: 0.6, kategorie: "furn", benutzerseite: false });
  const [fehler, setFehler] = useState("");

  const anlegen = () => {
    const res = neuerEigenerTyp(form, eigene);
    if (res.ok === false) { setFehler(res.fehler); return; }
    setFehler("");
    onChange?.([...eigene, res.typ]);
    setForm((f) => ({ ...f, name: "" }));
  };
  const loeschen = (id) => onChange?.(eigene.filter((e) => e.id !== id));

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4" data-testid="katalog-pflege">
      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-semibold text-slate-600">{t("Eigenen Möbeltyp anlegen")}</div>
        <label className="block text-xs text-slate-600">
          {t("Name")}
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("z. B. Sideboard Bauherr")} data-testid="kp-name" className="mt-1" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t("Breite")} suffix="m" min={0.05} step="0.05" value={form.b} onChange={(v) => setForm({ ...form, b: v })} />
          <NumberField label={t("Tiefe")} suffix="m" min={0.05} step="0.05" value={form.t} onChange={(v) => setForm({ ...form, t: v })} />
        </div>
        <label className="block text-xs text-slate-600">
          {t("Kategorie (Farbe)")}
          <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={form.kategorie}
            onChange={(e) => setForm({ ...form, kategorie: e.target.value })} data-testid="kp-kategorie">
            {MOEBEL_KATEGORIEN.map((k) => <option key={k} value={k}>{t(KATEGORIE_LABEL[k])}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={form.benutzerseite} onChange={(e) => setForm({ ...form, benutzerseite: e.target.checked })} data-testid="kp-benutzerseite" />
          {t("Benutzerseite (1,00 m Bewegungsfläche, ASR A1.2)")}
        </label>
        {fehler && (
          <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800" data-testid="kp-fehler">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" /> {fehler}
          </div>
        )}
        <Button type="button" size="sm" onClick={anlegen} data-testid="kp-anlegen">
          <Plus className="w-3.5 h-3.5 mr-1" /> {t("Typ anlegen")}
        </Button>
        <p className="text-[11px] text-slate-500">{t("Eigene Typen erscheinen im Katalog unter „Eigene“ und gelten für dieses Projekt.")}</p>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-semibold text-slate-600">{t("Eigene Typen")} ({eigene.length})</div>
        {eigene.length === 0 && <p className="text-xs text-slate-400">{t("Noch keine eigenen Typen.")}</p>}
        <ul className="divide-y" data-testid="kp-liste">
          {eigene.map((e) => {
            const benutzt = typInBenutzung(moeblierung, e.id);
            return (
              <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm" data-testid="kp-typ" data-id={e.id}>
                <span className="font-medium text-slate-800">{e.name}</span>
                <span className="text-xs text-slate-500">{de2(e.b)} × {de2(e.t)} m · {t(KATEGORIE_LABEL[e.kategorie] || "Möbel")}{e.benutzerseite ? ` · ${t("Benutzerseite")}` : ""}</span>
                <Button type="button" variant="ghost" size="icon" className="ml-auto h-7 w-7 text-red-500" disabled={benutzt}
                  title={benutzt ? t("In Benutzung — erst die Möbel dieses Typs entfernen") : t("Typ löschen")}
                  onClick={() => loeschen(e.id)} data-testid="kp-loeschen">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
