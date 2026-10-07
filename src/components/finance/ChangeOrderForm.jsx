// ChangeOrderForm — create or edit a change order (Nachtrag) on the Finance page
// (72-14, N-13).
//
// In:  the active project (a new change order belongs to it; shown, not chosen),
//      optionally the change order to edit, or a prefill for a new one
//      (vorbelegung, e.g. nachtragAusTicket from @core/lib/nachtraege — N-14).
// Out: onSubmit({title, description, cost_impact, submission_date[, status][, issue_id]})
//      — the page adds project_id/project_name and writes the record.
// Status changes of an existing change order go through the list actions
// (approve/reject), so the edit mode has no status field; a new change order
// starts undecided (pending or in_progress).
import React, { useState } from "react";
import { Link } from "react-router-dom";
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
import { Save } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { BEARBEITBARE_STATUS, nachtragStatusLabel } from "@core/lib/nachtraege";
import { ticketUrl } from "@ifc/lib/ticketLink";

/** yyyy-mm-dd of an ISO timestamp for <input type="date">, today as fallback. */
function tagAus(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Amount field → euros or null. Empty means "not quantified yet" (null), not 0 €.
 * @param {string|number} roh
 * @returns {number|null} euros
 */
function betragAus(roh) {
  const s = String(roh ?? "").trim();
  if (s === "") return null;
  const zahl = Number(s);
  return Number.isFinite(zahl) ? zahl : null;
}

/**
 * @param {object} props
 * @param {{id: string, name?: string}|null} [props.aktivesProjekt] project a new change order belongs to
 * @param {Record<string, any>|null} [props.nachtrag] change order to edit; absent = create
 * @param {{title?: string, description?: string, issue_id?: string|null,
 *   cost_impact?: number|null, ticket_titel?: string}|null} [props.vorbelegung]
 *   prefill of a new change order (ignored in edit mode); cost_impact in euros,
 *   ticket_titel only labels the reference line
 * @param {(daten: Record<string, any>) => Promise<void>|void} props.onSubmit
 * @param {() => void} props.onCancel
 */
export default function ChangeOrderForm({ aktivesProjekt = null, nachtrag = null, vorbelegung = null, onSubmit, onCancel }) {
  const { t } = useI18n();
  const bearbeiten = !!nachtrag;
  // Edit mode starts from the stored record, create mode from the prefill (if any).
  const quelle = bearbeiten ? nachtrag : vorbelegung;
  const [formData, setFormData] = useState(() => ({
    title: quelle?.title || "",
    description: quelle?.description || "",
    cost_impact: quelle?.cost_impact == null ? "" : String(quelle.cost_impact),
    status: "pending",
    submission_date: tagAus(nachtrag?.submission_date),
  }));
  const [saving, setSaving] = useState(false);

  // Edit mode shows the change order's own project (it may be a foreign one in
  // the "all projects" view); create mode the active project.
  const projektName = bearbeiten ? nachtrag.project_name : aktivesProjekt?.name;
  const ohneProjekt = !bearbeiten && !aktivesProjekt;
  // Ticket the change order refers to. In edit mode it is kept by the merge update
  // (the payload leaves issue_id out), in create mode it is written with the record.
  const issueId = quelle?.issue_id || null;
  const ticketTitel = bearbeiten ? "" : vorbelegung?.ticket_titel || "";

  const change = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (ohneProjekt) return;
    setSaving(true);
    try {
      const daten = {
        title: formData.title.trim(),
        description: formData.description,
        cost_impact: betragAus(formData.cost_impact),
        submission_date: formData.submission_date
          ? new Date(formData.submission_date).toISOString()
          : (nachtrag?.submission_date || new Date().toISOString()),
      };
      if (bearbeiten) await onSubmit(daten);
      else await onSubmit({ ...daten, status: formData.status, ...(issueId ? { issue_id: issueId } : {}) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Nachtrag bearbeiten") : t("Neuer Nachtrag")} onClose={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {issueId && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="nachtrag-bezug">
            {t("Bezug:")}{" "}
            <Link to={ticketUrl(issueId)} className="font-medium text-blue-700 underline-offset-4 hover:underline">
              {ticketTitel ? t("Ticket „{titel}“").replace("{titel}", ticketTitel) : t("Ticket öffnen")}
            </Link>
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="nachtrag-titel">{t("Titel")} *</Label>
          <Input
            id="nachtrag-titel"
            value={formData.title}
            onChange={(e) => change("title", e.target.value)}
            placeholder={t("z. B. Zusätzliche Tiefgaragenstellplätze")}
            required
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium leading-none">{t("Projekt")}</p>
          {projektName ? (
            <p className="text-sm text-slate-700" data-testid="nachtrag-projekt">{projektName}</p>
          ) : (
            <p className="text-sm text-amber-700" role="alert">
              {t("Kein aktives Projekt – bitte wählen Sie oben in der Kopfzeile ein Projekt.")}
            </p>
          )}
          {!bearbeiten && projektName && (
            <p className="text-xs text-slate-500">
              {t("Der Nachtrag wird dem aktiven Projekt zugeordnet. Ein anderes Projekt wählen Sie oben in der Kopfzeile.")}
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="nachtrag-kosten">{t("Kostenwirkung (€)")}</Label>
            <Input
              id="nachtrag-kosten"
              type="number"
              step="any"
              value={formData.cost_impact}
              onChange={(e) => change("cost_impact", e.target.value)}
              placeholder={t("leer = noch nicht beziffert, negativ = Einsparung")}
            />
          </div>
          {bearbeiten ? (
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{t("Status")}</p>
              <p className="text-sm text-slate-700">{t(nachtragStatusLabel(nachtrag.status))}</p>
              <p className="text-xs text-slate-500">
                {t("Über Genehmigen oder Ablehnen entscheiden Sie in der Liste.")}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="nachtrag-status">{t("Status")}</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => change("status", v)}
              >
                <SelectTrigger id="nachtrag-status" aria-label={t("Status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BEARBEITBARE_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(nachtragStatusLabel(s))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="nachtrag-datum">{t("Einreichungsdatum")}</Label>
            <Input
              id="nachtrag-datum"
              type="date"
              value={formData.submission_date}
              onChange={(e) => change("submission_date", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="nachtrag-beschreibung">{t("Beschreibung")}</Label>
          <Textarea
            id="nachtrag-beschreibung"
            value={formData.description}
            onChange={(e) => change("description", e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Abbrechen")}
          </Button>
          <Button type="submit" disabled={saving || ohneProjekt}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? t("Speichern…") : t("Nachtrag speichern")}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
