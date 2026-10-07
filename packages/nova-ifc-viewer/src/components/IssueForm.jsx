// IssueForm.jsx — create/edit dialog for a ticket (Issue).
//
// 72-13 (N-10): the model position is optional — a ticket without a model point
// has location null and no coordinate line. The element field edits the IFC
// GlobalId and writes element_guid AND the legacy element_id (contract in
// lib/ticketLink.js). A new ticket can be prefilled (title, GlobalId, source),
// e.g. from the ?neu=1 link. Priority and status show German labels while the
// stored values stay English keys.
//
// In (props): issue (edit) | null (new), location {x,y,z} in metres | null,
//   vorbelegung {title, element_guid, quelle} for a new ticket, onSubmit(data),
//   onCancel().
// Out: onSubmit receives the form fields; project, building and location are
//   added by the caller.

import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { useI18n } from "@core/lib/i18n";
import { Save, MapPin } from "lucide-react";
import {
  PRIORITAET_LABELS,
  TICKET_STATUS_LABELS,
  bauteilGuid,
  mitBauteilGuid,
} from "../lib/ticketLink";

const PRIORITIES = Object.keys(PRIORITAET_LABELS);
const STATUSES = Object.keys(TICKET_STATUS_LABELS);

/**
 * Initial form state: the edited ticket, or an empty ticket with the prefill.
 * @param {any} issue
 * @param {{title?: string, element_guid?: string, quelle?: string}|null|undefined} vorbelegung
 * @returns {Record<string, any>}
 */
function startWerte(issue, vorbelegung) {
  if (issue) return mitBauteilGuid(issue, bauteilGuid(issue));
  return mitBauteilGuid(
    {
      title: vorbelegung?.title || "",
      description: "",
      priority: "medium",
      status: "open",
      assignee: "",
      quelle: vorbelegung?.quelle || "manuell",
    },
    vorbelegung?.element_guid || ""
  );
}

export default function IssueForm({ issue, location, vorbelegung, onSubmit, onCancel }) {
  const { t } = useI18n();
  const [formData, setFormData] = useState(() => startWerte(issue, vorbelegung));
  const [saving, setSaving] = useState(false);
  const loc = issue?.location || location || null;

  const change = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit(mitBauteilGuid(formData, formData.element_guid));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal title={issue ? t("Ticket bearbeiten") : t("Neues Ticket")} onClose={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {loc ? (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            <MapPin className="w-4 h-4" />
            {t("Position im Modell")}: x {loc.x}, y {loc.y}, z {loc.z}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {t("Ohne Modellpunkt — das Ticket erscheint in der Liste, nicht als Marke im 3D-Modell.")}
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="ticketform-titel">{t("Titel")} *</Label>
          <Input
            id="ticketform-titel"
            autoFocus
            value={formData.title}
            onChange={(e) => change("title", e.target.value)}
            placeholder={t("z. B. Kollision Lüftungskanal / Unterzug")}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ticketform-beschreibung">{t("Beschreibung")}</Label>
          <Textarea
            id="ticketform-beschreibung"
            value={formData.description}
            onChange={(e) => change("description", e.target.value)}
          />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="ticketform-prioritaet">{t("Priorität")}</Label>
            <Select value={formData.priority} onValueChange={(v) => change("priority", v)}>
              <SelectTrigger id="ticketform-prioritaet" aria-label={t("Priorität")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(PRIORITAET_LABELS[p])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticketform-status">{t("Status")}</Label>
            <Select value={formData.status} onValueChange={(v) => change("status", v)}>
              <SelectTrigger id="ticketform-status" aria-label={t("Status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(TICKET_STATUS_LABELS[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticketform-zustaendig">{t("Zuständig")}</Label>
            <Input
              id="ticketform-zustaendig"
              value={formData.assignee}
              onChange={(e) => change("assignee", e.target.value)}
              placeholder={t("Name / Gewerk")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticketform-guid">{t("IFC-Bauteil (GlobalId)")}</Label>
            <Input
              id="ticketform-guid"
              value={formData.element_guid}
              onChange={(e) => setFormData((prev) => mitBauteilGuid(prev, e.target.value))}
              placeholder={t("z. B. 2O2Fr$t4X7Zf8NOew3FLOH")}
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Abbrechen")}
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? t("Speichern…") : t("Ticket speichern")}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
