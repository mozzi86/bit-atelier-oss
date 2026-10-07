import React, { useState, useMemo } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { InvokeLLM } from "@core/integrations/Core";
import { useI18n } from "@core/lib/i18n";
import { kgVorschlaege } from "@ava/lib/kgVorschlag";
import { din276Optionen, eur } from "./avaUtils";

const UNITS = ["m²", "m³", "m", "Stk", "t", "kg", "h", "psch", "St"];

// Create/edit a Leistungsverzeichnis position.
export default function LVPositionForm({ position, defaultTrade, onSubmit, onCancel, dinKatalog = [] }) {
  const [form, setForm] = useState(
    position || {
      oz: "",
      trade: defaultTrade || "Rohbau",
      title: "",
      short_text: "",
      long_text: "",
      unit: "m²",
      quantity: 0,
      // `null`, nicht 0: ohne Preisschicht GIBT es keinen Einheitspreis. Eine 0
      // sähe im Kostenanschlag wie ein belegter Nullpreis aus (W2-Konvention).
      unit_price: null,
      preis_schicht_id: null,
      // Dreistellig: „341 Tragende Innenwände", nicht der Sammeltopf „340".
      din276: "341",
      din276_fassung: "2018",
      din276_confidence: null,
      din276_hinweis: "",
      // Nachweis-GUIDs gehören HIERHIN, nicht in `bim_element_ids` — dort würden sie
      // den Modus still auf „auswahl" kippen und die Menge einfrieren (T-33-05).
      nachweis_element_ids: [],
      // Phase 25/33 — Mengen-Modus-Felder (schemalos, keine Pflichtfelder;
      // die eigentliche Modus-Wahl passiert im BIM-Mengen-Tab).
      mengen_modus: "handeingabe",
      filter_ref: null,
      mengenbasis: "area",
      handeingabe_grund: "",
      ausschluss_grund: null,
      menge_herkunft: null,
    }
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [kgBusy, setKgBusy] = useState(false);
  const { t } = useI18n();

  // Kostengruppen-Vorschlag über TypeSafe (Phase 76-03). Der Vorschlag füllt
  // nur das Formular — gespeichert wird er erst mit „Speichern" (T-33-23:
  // eine Kostengruppe wird durch die Annahme des Nutzers zur Zuordnung).
  const kgVorschlagen = async () => {
    const text = form.short_text || form.title;
    if (!text) return;
    setKgBusy(true);
    try {
      const r = await kgVorschlaege([text], dinKatalog, form.trade || null);
      const v = r.vorschlaege[0];
      if (v?.kg2018 != null) {
        set("din276", v.kg2018);
        set("din276_fassung", "2018");
        set("din276_confidence", v.confidence);
        set("din276_hinweis", `TypeSafe-Vorschlag · ${v.begruendung}`);
      } else {
        set("din276_confidence", "niedrig");
        set("din276_hinweis", `${t("Kein eindeutiger Vorschlag")} (${v?.begruendung || "—"})`);
      }
    } catch (e) {
      toast.error(e?.message || String(e));
    }
    setKgBusy(false);
  };

  // Dreistellige Kostengruppen BEIDER Fassungen aus dem Katalog `Din276Katalog`.
  // Die 15-Werte-Zehnerebene in `avaUtils` bleibt nur als Notnagel, wenn der Katalog
  // (noch) nicht geladen ist — mit ihr wären 394/353/351/354/391/344 nicht wählbar,
  // also genau die Kostengruppen, die das Realprojekt braucht.
  const dinOptionen = useMemo(() => din276Optionen(dinKatalog), [dinKatalog]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const generateLongText = async () => {
    if (!form.title && !form.short_text) return;
    setAiBusy(true);
    try {
      const prompt =
        `Formuliere einen fachlich korrekten, ausschreibungsreifen VOB-Langtext (Leistungsbeschreibung) ` +
        `für die folgende Bauleistung. Antworte nur mit dem Langtext, ohne Einleitung.\n` +
        `Position: ${form.title}\nKurztext: ${form.short_text}\nGewerk: ${form.trade}\nEinheit: ${form.unit}`;
      const res = await InvokeLLM({ prompt, add_context_from_internet: false });
      set("long_text", typeof res === "string" ? res.trim() : String(res));
    } catch {
      /* ignore */
    }
    setAiBusy(false);
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      ...form,
      quantity: Number(form.quantity) || 0,
      // NICHT `Number(...) || 0` — das machte aus „kein Preis" eine belegte 0.
      // Der Wert wird ohnehin nur noch aus der aktiven Preisschicht abgeleitet.
      unit_price: form.unit_price == null || form.unit_price === "" ? null : Number(form.unit_price),
    });
  };

  const gp = form.unit_price == null ? null : (Number(form.quantity) || 0) * Number(form.unit_price);

  return (
    <FormModal title={position ? "Position bearbeiten" : "Neue LV-Position"} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">OZ (Ordnungszahl)</Label>
            <Input value={form.oz} onChange={(e) => set("oz", e.target.value)} placeholder="1.1.10" />
          </div>
          <div>
            <Label className="text-xs">Gewerk / Los</Label>
            <Input value={form.trade} onChange={(e) => set("trade", e.target.value)} placeholder="Rohbau" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">DIN 276 Kostengruppe (dreistellig)</Label>
              <Button
                type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs"
                onClick={kgVorschlagen}
                disabled={kgBusy || (!form.short_text && !form.title)}
                title={!form.short_text && !form.title ? t("Erst Kurztext oder Titel eingeben") : undefined}
                aria-label={t("KG vorschlagen")}
                data-testid="kg-vorschlagen"
              >
                {kgBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                {t("KG vorschlagen")}
              </Button>
            </div>
            <Select value={form.din276} onValueChange={(v) => set("din276", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {dinOptionen.map((o) => (
                  <SelectItem key={`${o.code}-${o.fassung || "x"}`} value={o.code}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.din276_confidence === "niedrig" && (
              <p className="mt-1 text-xs text-amber-700" data-testid="kg-hinweis">
                Zuordnung unsicher{form.din276_hinweis ? `: ${form.din276_hinweis}` : ""} — bitte sichten.
              </p>
            )}
            {form.din276_confidence && form.din276_confidence !== "niedrig" && form.din276_hinweis && (
              <p className="mt-1 text-xs text-slate-500" data-testid="kg-hinweis">{form.din276_hinweis}</p>
            )}
          </div>
        </div>

        <div>
          <Label className="text-xs">Titel (Kurzbezeichnung)</Label>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} required placeholder="Beton Bodenplatte C25/30" />
        </div>

        <div>
          <Label className="text-xs">Kurztext</Label>
          <Input value={form.short_text} onChange={(e) => set("short_text", e.target.value)} placeholder="Stahlbeton Bodenplatte, d=40cm" />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Langtext (Leistungsbeschreibung)</Label>
            <Button type="button" variant="outline" size="sm" onClick={generateLongText} disabled={aiBusy}>
              {aiBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              KI-Langtext
            </Button>
          </div>
          <Textarea rows={4} value={form.long_text} onChange={(e) => set("long_text", e.target.value)} placeholder="VOB-konforme Leistungsbeschreibung…" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Einheit</Label>
            <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Menge</Label>
            <Input type="number" step="any" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Einheitspreis (EP) — abgeleitet</Label>
            {/* `unit_price` ist ein NUR-LESE-CACHE der aktiven Preisschicht
                (Phase 33 / W4). Es gibt hier bewusst kein Eingabefeld mehr:
                ein direkt getippter EP hat keine Herkunft, und ein Preis ohne
                Herkunft ist im Kostenanschlag nicht von einem belegten zu
                unterscheiden. Ein Handpreis entsteht als Schicht `art:"markt"`
                mit Pflicht-Beleg (Preisschichten-Panel). */}
            <div className="h-9 flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 tabular-nums">
              {form.unit_price == null ? "—" : eur(form.unit_price)}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Nur-Lese-Cache der aktiven Preisschicht. Handpreis nur als Marktpreis-Schicht mit Beleg.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-3 flex justify-between items-center">
          <span className="text-sm text-slate-500">Gesamtpreis (GP)</span>
          <span className="text-lg font-bold text-slate-800">
            {gp == null ? "— (kein Einheitspreis belegt)" : eur(gp)}
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>Abbrechen</Button>
          <Button type="submit" className="bg-gradient-to-r from-emerald-600 to-teal-600">Speichern</Button>
        </div>
      </form>
    </FormModal>
  );
}
