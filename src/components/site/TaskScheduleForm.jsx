// TaskScheduleForm — create or edit a ScheduleTask of the construction schedule (site control room).
// 89-05: additive chain fields — trade from the STLB catalogue (gewerk_lb), construction section,
// award unit, predecessors (EA/AA/EE + lag), element GUIDs and linked BoQ items
// (src/lib/planung/bauablauf.js taskFelder); edit mode when `task` is given (no second editor).
//
// In:  contacts, tasks (predecessor choice), positionen (LVPosition rows of the project),
//      task (edit) | null (create). Out: onSubmit(data) — the page writes the record.
import React, { useState } from "react";
import { useI18n } from "@core/lib/i18n";
import { GEWERKE_KATALOG, ANORDNUNG, taskFelder } from "@/lib/planung/bauablauf";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Save } from "lucide-react";

const AREAS = ["Rohbau Nord", "Rohbau Süd", "TGA", "Fassade", "Außenanlagen", "Tiefgarage"];

/** yyyy-mm-dd of an ISO timestamp, or the fallback. */
const tag = (iso, fallback) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : fallback);

/**
 * @param {{contacts?: Array<any>, tasks?: Array<any>, positionen?: Array<any>, task?: any,
 *   onSubmit: (data: Record<string, any>) => Promise<void>|void, onCancel: () => void}} props
 */
export default function TaskScheduleForm({ contacts = [], tasks = [], positionen = [], task = null, onSubmit, onCancel }) {
  const { t } = useI18n();
  const [data, setData] = useState(() => ({
    name: task?.name || "",
    trade: task?.trade || "",
    area: task?.area || AREAS[0],
    company_contact_id: task?.company_contact_id || contacts[0]?.id || "",
    start_date: tag(task?.start_date, "2026-06-15"),
    end_date: tag(task?.end_date, "2026-06-20"),
    progress: task?.progress ?? 0,
    status: task?.status || "planned",
    // 89-05 chain fields (additive)
    gewerk_lb: task?.gewerk_lb || "",
    bauabschnitt: task?.bauabschnitt || "",
    vergabeeinheit: task?.vergabeeinheit || "",
    vorgaenger: Array.isArray(task?.vorgaenger) ? task.vorgaenger : [],
    bauteil_guids: Array.isArray(task?.bauteil_guids) ? task.bauteil_guids.join("\n") : "",
    lv_position_ids: Array.isArray(task?.lv_position_ids) ? task.lv_position_ids : [],
  }));
  const andere = tasks.filter((x) => x.id !== task?.id);
  const vorg = (id) => data.vorgaenger.find((v) => v.id === id);
  const setVorg = (id, patch) => setData((d) => ({
    ...d,
    vorgaenger: patch === null ? d.vorgaenger.filter((v) => v.id !== id)
      : d.vorgaenger.some((v) => v.id === id) ? d.vorgaenger.map((v) => (v.id === id ? { ...v, ...patch } : v)) : [...d.vorgaenger, { id, art: "EA", abstand_tage: 0, ...patch }],
  }));
  const togglePos = (id) => setData((d) => ({ ...d, lv_position_ids: d.lv_position_ids.includes(id) ? d.lv_position_ids.filter((x) => x !== id) : [...d.lv_position_ids, id] }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const contact = contacts.find((c) => c.id === data.company_contact_id);
    await onSubmit({
      ...data,
      ...taskFelder(data),
      company_name: contact?.company || contact?.name || "",
      assignee_name: contact?.name || "",
      start_date: new Date(data.start_date + "T07:00:00").toISOString(),
      end_date: new Date(data.end_date + "T17:00:00").toISOString(),
    });
    setSaving(false);
  };

  return (
    <FormModal title={task ? t("Vorgang bearbeiten") : "Aufgabe planen & zuteilen"} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="tn">Aufgabe *</Label>
          <Input id="tn" data-testid="ts-name" value={data.name} onChange={(e) => set("name", e.target.value)} required placeholder="z. B. Estrich verlegen" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="tr">Gewerk</Label>
            <Input id="tr" value={data.trade} onChange={(e) => set("trade", e.target.value)} placeholder="z. B. Ausbau" />
          </div>
          <div className="space-y-1">
            <Label>Bereich</Label>
            <Select value={data.area} onValueChange={(v) => set("area", v)}>
              <SelectTrigger aria-label={t("Bereich")}><SelectValue /></SelectTrigger>
              <SelectContent>{AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Zuteilen an (aus Adressbuch)</Label>
          <Select value={data.company_contact_id} onValueChange={(v) => set("company_contact_id", v)}>
            <SelectTrigger aria-label={t("Zuteilen an (aus Adressbuch)")}><SelectValue placeholder="Firma/Person wählen..." /></SelectTrigger>
            <SelectContent>
              {contacts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.company ? ` — ${c.company}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contacts.length === 0 && <p className="text-xs text-amber-600">Keine Kontakte — lege zuerst welche im Adressbuch an.</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="sd">Start</Label>
            <Input id="sd" data-testid="ts-start" type="date" value={data.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed">Ende</Label>
            <Input id="ed" data-testid="ts-ende" type="date" value={data.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </div>
        </div>
        {/* 89-05: construction sequence chain */}
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="ts-kette">
          <legend className="px-1 text-sm font-medium">{t("Bauablauf-Kette")}</legend>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ts-gewerk">{t("Gewerk (STLB-Leistungsbereich)")}</Label>
              <select id="ts-gewerk" data-testid="ts-gewerk" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={data.gewerk_lb} onChange={(e) => set("gewerk_lb", e.target.value)}>
                <option value="">{t("— ohne Katalog —")}</option>
                {GEWERKE_KATALOG.map((g) => <option key={g.lb} value={g.lb}>{g.lb} {g.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-abschnitt">{t("Bauabschnitt")}</Label>
              <Input id="ts-abschnitt" data-testid="ts-abschnitt" value={data.bauabschnitt} onChange={(e) => set("bauabschnitt", e.target.value)} placeholder={t("z. B. BA 1")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-ve">{t("Vergabeeinheit")}</Label>
              <Input id="ts-ve" data-testid="ts-ve" value={data.vergabeeinheit} onChange={(e) => set("vergabeeinheit", e.target.value)} placeholder={t("z. B. VE 03 Rohbau")} />
            </div>
          </div>
          {andere.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("Vorgänger")}</p>
              <div className="max-h-36 overflow-auto space-y-1 rounded border p-2">
                {andere.map((x) => {
                  const v = vorg(x.id);
                  return (
                    <div key={x.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="ts-vorgaenger" data-name={x.name}>
                      <label className="flex items-center gap-1.5 flex-1 min-w-40">
                        <input type="checkbox" checked={!!v} onChange={(e) => setVorg(x.id, e.target.checked ? {} : null)} /> {x.name}
                      </label>
                      {v && (<>
                        <select aria-label={t("Anordnung")} className="h-7 rounded border px-1 text-xs" value={v.art} onChange={(e) => setVorg(x.id, { art: e.target.value })}>
                          {ANORDNUNG.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
                        </select>
                        <Input aria-label={t("Abstand (Tage)")} type="number" className="h-7 w-20 text-xs" value={v.abstand_tage} onChange={(e) => setVorg(x.id, { abstand_tage: Number(e.target.value) || 0 })} />
                      </>)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="ts-guids">{t("Bauteile (IFC-GUIDs, je Zeile eine)")}</Label>
            <textarea id="ts-guids" data-testid="ts-guids" rows={2} className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs font-mono"
              value={data.bauteil_guids} onChange={(e) => set("bauteil_guids", e.target.value)} />
          </div>
          {positionen.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("LV-Positionen")}</p>
              <div className="max-h-32 overflow-auto space-y-0.5 rounded border p-2 text-xs">
                {positionen.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5" data-testid="ts-position" data-oz={p.oz || ""}>
                    <input type="checkbox" checked={data.lv_position_ids.includes(p.id)} onChange={() => togglePos(p.id)} /> {p.oz} {p.title || p.short_text || ""}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button>
          <Button type="submit" data-testid="ts-speichern" disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Speichern..." : "Aufgabe zuteilen"}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
