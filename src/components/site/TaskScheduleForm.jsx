import React, { useState } from "react";
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

export default function TaskScheduleForm({ contacts = [], onSubmit, onCancel }) {
  const [data, setData] = useState({
    name: "",
    trade: "",
    area: AREAS[0],
    company_contact_id: contacts[0]?.id || "",
    start_date: "2026-06-15",
    end_date: "2026-06-20",
    progress: 0,
    status: "planned",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const contact = contacts.find((c) => c.id === data.company_contact_id);
    await onSubmit({
      ...data,
      company_name: contact?.company || contact?.name || "",
      assignee_name: contact?.name || "",
      start_date: new Date(data.start_date + "T07:00:00").toISOString(),
      end_date: new Date(data.end_date + "T17:00:00").toISOString(),
    });
    setSaving(false);
  };

  return (
    <FormModal title="Aufgabe planen & zuteilen" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="tn">Aufgabe *</Label>
          <Input id="tn" value={data.name} onChange={(e) => set("name", e.target.value)} required placeholder="z. B. Estrich verlegen" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="tr">Gewerk</Label>
            <Input id="tr" value={data.trade} onChange={(e) => set("trade", e.target.value)} placeholder="z. B. Ausbau" />
          </div>
          <div className="space-y-1">
            <Label>Bereich</Label>
            <Select value={data.area} onValueChange={(v) => set("area", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Zuteilen an (aus Adressbuch)</Label>
          <Select value={data.company_contact_id} onValueChange={(v) => set("company_contact_id", v)}>
            <SelectTrigger><SelectValue placeholder="Firma/Person wählen..." /></SelectTrigger>
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
            <Input id="sd" type="date" value={data.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed">Ende</Label>
            <Input id="ed" type="date" value={data.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button>
          <Button type="submit" disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Speichern..." : "Aufgabe zuteilen"}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
