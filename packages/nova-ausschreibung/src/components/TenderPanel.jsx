import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import FormModal from "@core/components/common/FormModal";
// `Lock` was dropped on purpose (57-06 Task 5b): a padlock next to this action
// promises a technical seal that does not exist - the operator of the instance
// can read every bid at any time (74-01-PLAN.md G-1).
import { Plus, Send, Gavel, Trash2, Users, CalendarClock, ScrollText } from "lucide-react";
import { eur0, lvTotal, TENDER_STATUS, groupByTrade } from "./avaUtils";

// Ausschreibungs-Verwaltung: create tenders from LV positions, invite bidders,
// publish / close, and open the price comparison.
export default function TenderPanel({
  tenders, positions, contacts, bids, selectedTenderId, onSelect,
  onCreate, onUpdate, onDelete,
}) {
  const [showForm, setShowForm] = useState(false);
  const groups = groupByTrade(positions);
  const bidderContacts = contacts.filter((c) => ["contractor", "manufacturer", "engineer"].includes(c.category));

  const [form, setForm] = useState({ name: "", trade: "", deadline: "", invited: [] });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm({ name: "", trade: groups[0]?.trade || "", deadline: "", invited: [] });
    setShowForm(true);
  };

  const positionsForTrade = (trade) => positions.filter((p) => p.trade === trade);

  const submit = async (e) => {
    e.preventDefault();
    const posIds = positionsForTrade(form.trade).map((p) => p.id);
    await onCreate({
      name: form.name || `Ausschreibung ${form.trade}`,
      trade: form.trade,
      status: "draft",
      deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
      position_ids: posIds,
      invited_contact_ids: form.invited,
      awarded_bid_id: null,
      created_date: new Date().toISOString(),
    });
    setShowForm(false);
  };

  const toggleInvite = (id) =>
    set("invited", form.invited.includes(id) ? form.invited.filter((x) => x !== id) : [...form.invited, id]);

  const tenderPositions = (t) => positions.filter((p) => t.position_ids?.includes(p.id));
  const bidCount = (t) => bids.filter((b) => b.tender_id === t.id).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Ausschreibungen</h3>
          <p className="text-sm text-slate-500">{tenders.length} Lose · Bieter aus dem Adressbuch einladen</p>
        </div>
        <Button onClick={openNew} disabled={!groups.length} className="bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="w-4 h-4 mr-2" /> Ausschreibung
        </Button>
      </div>

      {/* Stands where the work happens, not in a collapsible (57-06 Task 5b).
          A sentence on the sales page does not cure a misleading control. */}
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Private Angebotsphase. Ein technischer Verschluss der Angebote gegenüber
        dem Betreiber dieser Instanz besteht nicht — für förmliche Vergaben nach
        VgV/UVgO ist dieses Modul nicht geeignet.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        {tenders.map((t) => {
          const st = TENDER_STATUS[t.status] || TENDER_STATUS.draft;
          const tp = tenderPositions(t);
          const sel = t.id === selectedTenderId;
          return (
            <Card key={t.id} className={sel ? "ring-2 ring-blue-500" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-blue-600" /> {t.name}
                  </CardTitle>
                  <Badge className={st.color}>{st.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><div className="text-xs text-slate-400">Positionen</div><div className="font-semibold">{tp.length}</div></div>
                  <div><div className="text-xs text-slate-400">Kostenanschlag</div><div className="font-semibold">{eur0(lvTotal(tp))}</div></div>
                  <div><div className="text-xs text-slate-400">Angebote</div><div className="font-semibold">{bidCount(t)}</div></div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {t.invited_contact_ids?.length || 0} eingeladen</span>
                  {t.deadline && <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> {new Date(t.deadline).toLocaleDateString("de-DE")}</span>}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant={sel ? "default" : "outline"} onClick={() => onSelect(t.id)}>
                    <Gavel className="w-3.5 h-3.5 mr-1" /> Preisspiegel
                  </Button>
                  {t.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => onUpdate(t.id, { status: "published" })}>
                      <Send className="w-3.5 h-3.5 mr-1" /> Veröffentlichen
                    </Button>
                  )}
                  {t.status === "published" && (
                    <Button size="sm" variant="outline" onClick={() => onUpdate(t.id, { status: "closed" })}>
                      <CalendarClock className="w-3.5 h-3.5 mr-1" /> Angebotsfrist beenden
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 ml-auto" onClick={() => onDelete(t.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showForm && (
        <FormModal title="Neue Ausschreibung" onClose={() => setShowForm(false)}>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-xs">Bezeichnung</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ausschreibung Rohbau" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Gewerk / Los</Label>
                <Select value={form.trade} onValueChange={(v) => set("trade", v)}>
                  <SelectTrigger><SelectValue placeholder="Gewerk…" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => <SelectItem key={g.trade} value={g.trade}>{g.trade} ({g.items.length} Pos.)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Abgabefrist</Label>
                <Input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Bieter einladen</Label>
              <div className="max-h-44 overflow-y-auto space-y-1 rounded-lg border p-2">
                {bidderContacts.length === 0 && <p className="text-xs text-slate-400">Keine Firmen im Adressbuch.</p>}
                {bidderContacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm rounded px-2 py-1 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={form.invited.includes(c.id)} onChange={() => toggleInvite(c.id)} />
                    <span className="font-medium">{c.company || c.name}</span>
                    <span className="text-xs text-slate-400">{c.role}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Abbrechen</Button>
              <Button type="submit" disabled={!form.trade} className="bg-gradient-to-r from-emerald-600 to-teal-600">Erstellen</Button>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}
